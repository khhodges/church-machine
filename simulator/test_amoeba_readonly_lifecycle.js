'use strict';
const assert=require('node:assert/strict');
const {fixture,action,executeTarget,S,B}=require('./amoeba_readonly_fixture');
const retireCollect=[action(0),action(1),action(2)].join('\n');
const results=f=>Array.from(f.s.memory.slice(B.results,B.results+f.s.memory[B.results+62]));
function good(options) {
    const f=fixture(options),r=f.run();
    assert.equal(r.fault,undefined,r.fault?.message);
    return {f,r};
}
for(const delay of [0,150]) {
    const {f,r}=good({delay});
    assert.deepEqual(results(f),[0,17,0,0,0,29,0,0,0,17]);
    assert.deepEqual(r.requests,[S.a,S.a,S.b,S.b,S.a]);
    assert.deepEqual(Array.from(f.s.memory.slice(B.pool,B.pool+f.size)),f.records.get(S.a));
    for(const [slot,version,token] of [[S.a,7,0xabc123],[S.b,11,0xdef456]]) {
        const ns=f.s.readNSEntry(slot);
        assert.equal(f.s.parseNSWord1(ns.word1_limit).gtSeq,version);
        assert.equal(ns.word3_cache_token,token);
        assert(f.s.validateMAC(ns));
    }
    assert.equal(f.s.readNSEntry(S.a).word0_location,B.pool);
    assert.equal(f.s.readNSEntry(S.b).word0_location,B.absentB);
    const free=r.writes.filter(w=>w.address===B.state+1 && w.value===0);
    assert.equal(free.length,2,'two explicit collections, no automatic eviction');
    // A clean allocation becomes available only after complete native zeroing.
    for(const event of free) {
        const end=r.writes.indexOf(event);
        const start=r.writes.slice(0,end).findLastIndex(w=>w.address===B.state+1&&w.value===3);
        const clears=r.writes.slice(start,end).filter(w=>w.address>=B.pool&&w.address<B.pool+f.size);
        assert.equal(clears.length,f.size);
        assert(clears.every(w=>w.value===0));
    }
}
console.log('PASS native load/execute/retire/collect/reuse/reload, identities and delayed delivery');

for(const pin of ['home','return','suspended']) {
    const {f,r}=good({body:retireCollect,pin});
    assert.deepEqual(results(f),[0,0,1],pin);
    assert.equal(f.s.memory[B.state],S.a);
    assert.equal(f.s.memory[B.state+1],1);
    assert.deepEqual(r.requests,[S.a],'pinned body does not need redelivery');
    assert.deepEqual(Array.from(f.s.memory.slice(B.pool,B.pool+f.size)),f.records.get(S.a));
}
// A real CALL from the target into Amoeba leaves its return companion live.
// No host-injected pin is used in this case.
const nested=good({
    body:[action(0),executeTarget(),action(2)].join('\n'),
    targetBody:`IADD DR1, DR0, #40
        LOAD CR0, CR6, #1
        CALL CR0, #1
        IADD DR1, DR0, #40
        LOAD CR0, CR6, #1
        CALL CR0, #2
        RETURN`
});
assert.deepEqual(results(nested.f),[0,1,0]);
assert.equal(nested.f.s.memory[B.state+1],0,
    'popped target frame must not retain the block forever');
console.log('PASS real target RETURN protection and saved Thread continuation/home roots');

const immutable=good({body:retireCollect,readonly:false});
assert.deepEqual(results(immutable.f),[0,0,4]);
assert.deepEqual(immutable.r.requests,[S.a]);
for(const tamper of [0,2,25,63]) {
    const {f}=good({body:retireCollect,tamper});
    assert.deepEqual(results(f),[0,0,3],`modified word ${tamper}`);
    assert.equal(f.s.memory[B.state+1],1);
    assert.equal(f.s.memory[B.pool+tamper],(f.records.get(S.a)[tamper]^1)>>>0);
    assert.equal(f.s.readNSEntry(S.a).word0_location,B.pool);
}
const occupied=good({body:[action(0),action(0,S.b),action(0)].join('\n')});
assert.deepEqual(results(occupied.f),[0,2,0]);
assert.deepEqual(occupied.r.requests,[S.a]);
console.log('PASS mutable/modified exclusions, idempotent residency and exhaustion without eviction');

for(const options of [
    {body:action(0),badDescriptor:true},
    {body:retireCollect,badThread:true},
    {body:[action(0),action(2)].join('\n')},
    {body:action(0,99)},
    {body:action(0),corruptDelivery:true},
    {body:[retireCollect,action(2)].join('\n')},
]) {
    const f=fixture(options),r=f.run();
    assert(r.fault,JSON.stringify(options));
    assert.match(r.fault.message,/Amoeba/);
}
// Interruption between every destructive publication/clear instruction must
// leave the reusable flag closed. These are compiled faults, not host writes.
for(const marker of [
    'DWRITE DR4, CR2, #1\n        ; Detach',
    'DWRITE DR9, CR7, #0',
    'DWRITE DR9, CR7, #2',
    'DWRITE DR0, CR3, DR6',
    'DWRITE DR0, CR2, #0',
]) {
    const f=fixture({body:retireCollect,transform:text=>text.replace(marker,
        marker.split('\n')[0]+'\n HARDFAULT "injected native lifecycle cut"\n'+
        marker.split('\n').slice(1).join('\n'))});
    const r=f.run();
    assert(r.fault,marker);
    assert.notEqual(f.s.memory[B.state+1],0,marker);
}
console.log('PASS malformed state, explicit retirement requirement and fail-closed native interruption cuts');

for(const word of Array.from({length:64},(_,i)=>i)) {
    const f=fixture({body:retireCollect,transform:text=>text.replace(
        'DWRITE DR0, CR3, DR6',`DWRITE DR0, CR3, DR6
        MCMP DR6, #${word}
        BRANCHNE after_clear_cut
        HARDFAULT "injected clear cut"
    after_clear_cut:`)});
    const r=f.run();
    assert(r.fault,`clear interruption ${word}`);
    assert.equal(f.s.memory[B.state+1],3);
    assert.equal(f.s.readNSEntry(S.a).word0_location,B.absentA);
}
for(const instruction of ['DWRITE DR9, CR7, #0','DWRITE DR9, CR7, #2']) {
    const f=fixture({body:retireCollect,transform:text=>text.replace(instruction,
        `${instruction}
        LOAD CR11, CR6, #2
        DREAD DR12, CR11, #1
        MCMP DR12, #3
        BRANCHNE after_detach_cut
        HARDFAULT "injected detach cut"
    after_detach_cut:`)});
    assert(f.run().fault);
    assert.equal(f.s.memory[B.state+1],3);
}
console.log('PASS every clear-word interruption and both reclamation descriptor publication cuts');
