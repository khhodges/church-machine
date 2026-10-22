'use strict';
const assert=require('node:assert/strict');
const {setup,STATE,POOL,SLOT}=require('./test_mint_destroy_v1');
{
    const {s,invoke,cleaner}=setup();
    assert.equal(invoke(cleaner,0,{6:8,7:SLOT}),null);
    const address=s.dr[2];
    assert.equal(address,POOL*4);
    assert(s.memory.slice(POOL,POOL+8).every(x=>x===0));
    s.memory[POOL]=123;
    assert.equal(invoke(cleaner,2,{6:8,7:SLOT,8:address}),null);
    assert.equal(invoke(cleaner,1,{6:8,7:SLOT,8:address}),null);
    assert.equal(s.memory[POOL],123,'release is not synchronous cleaning');
    assert.equal(invoke(cleaner,0,{6:4,7:SLOT+1}),null);
    assert.equal(s.dr[2],address,'another slot can reuse the released block');
    assert(s.memory.slice(POOL,POOL+8).every(x=>x===0),'whole capacity cleared, not only request');
    const state=Array.from(s.memory.slice(STATE,STATE+512));
    assert(invoke(cleaner,1,{6:4,7:SLOT+1,8:address+4}),'wrong base rejected');
    assert.deepEqual(Array.from(s.memory.slice(STATE,STATE+512)),state);
    assert(invoke(cleaner,0,{6:4,7:SLOT+1}),'duplicate live allocation rejected');
    assert.deepEqual(Array.from(s.memory.slice(STATE,STATE+512)),state);
}
{
    const {s,invoke,cleaner}=setup();
    assert.equal(invoke(cleaner,0,{6:16,7:SLOT}),null);
    const before=Array.from(s.memory.slice(STATE,STATE+512));
    assert(invoke(cleaner,0,{6:1,7:SLOT+1}),'pool exhaustion faults');
    assert.deepEqual(Array.from(s.memory.slice(STATE,STATE+512)),before,'exhaustion does not consume state');
    assert.equal(invoke(cleaner,1,{6:16,7:SLOT,8:POOL*4}),null);
    assert(invoke(cleaner,1,{6:16,7:SLOT,8:POOL*4}),'double release rejected');
    assert.equal(invoke(cleaner,0,{6:16,7:SLOT+1}),null,'released block satisfies request at exhausted cursor');
    assert.equal(s.dr[2],POOL*4);
}
console.log('PASS V1 native Cleaner allocation, release, whole-block zeroing, reuse, exhaustion and invalid requests');

// Every retired Allocate write, including equal-value writes, is a cut.
// These are RAM-stop/re-entry checks, NOT power-loss persistence evidence.
for(const recycled of [false,true]) {
    function prepare() {
        const x=setup();
        if(recycled) {
            assert.equal(x.invoke(x.cleaner,0,{6:8,7:SLOT}),null);
            x.s.memory.fill(0xdeadbeef,POOL,POOL+8);
            assert.equal(x.invoke(x.cleaner,1,{6:8,7:SLOT,8:POOL*4}),null);
        }
        return x;
    }
    const baseline=prepare();
    let writes=0;
    assert.equal(baseline.invoke(baseline.cleaner,0,{6:8,7:SLOT+1},{},
        (_,trace)=>{if(trace.includes('DWRITE '))writes++;return false;}),null);
    assert.equal(writes,13,'reservation, four record writes and eight zero writes');
    for(let cut=1;cut<=writes;cut++) {
        const x=prepare();
        let seen=0;
        const stopped=x.invoke(x.cleaner,0,{6:8,7:SLOT+1},{},(_,trace)=>
            trace.includes('DWRITE ') && ++seen===cut);
        assert.equal(stopped.type,'TEST_CUT');
        assert.equal(x.s.dr[1],0,'no completion before all zeroing retires');
        const reserved=Array.from(x.s.memory.slice(POOL,POOL+8));
        // A separate request can leak this reservation, but cannot receive it.
        assert.equal(x.invoke(x.cleaner,0,{6:8,7:SLOT+2}),null);
        assert.equal(x.s.dr[2],(POOL+8)*4,`cut ${cut}: no interrupted block reuse`);
        assert.deepEqual(Array.from(x.s.memory.slice(POOL,POOL+8)),reserved);
        assert(x.s.memory.slice(POOL+8,POOL+16).every(word=>word===0));
    }
}
for(const method of [1,2]) {
    for(const inputs of [
        {6:8,7:SLOT+1,8:POOL*4},
        {6:9,7:SLOT,8:POOL*4},
        {6:0,7:SLOT,8:POOL*4},
        {6:8,7:SLOT,8:POOL*4+4},
    ]) {
        const {s,invoke,cleaner}=setup();
        assert.equal(invoke(cleaner,0,{6:8,7:SLOT}),null);
        s.memory[POOL]=0x12345678;
        const state=Array.from(s.memory.slice(STATE,STATE+512));
        const pool=Array.from(s.memory.slice(POOL,POOL+256));
        assert(invoke(cleaner,method,inputs),'reject non-owned or malformed release');
        assert.equal(s.dr[1],0,'failed release/validation never reports completion');
        assert.deepEqual(Array.from(s.memory.slice(STATE,STATE+512)),state);
        assert.deepEqual(Array.from(s.memory.slice(POOL,POOL+256)),pool);
    }
}
{
    const {s,invoke,cleaner}=setup();
    assert.equal(invoke(cleaner,0,{6:8,7:SLOT}),null);
    s.memory[POOL]=0x12345678;
    const stopped=invoke(cleaner,1,{6:8,7:SLOT,8:POOL*4},{},
        (_,trace)=>trace.includes('DWRITE '));
    assert.equal(stopped.type,'TEST_CUT');
    assert.equal(s.dr[1],0,'release store is not outward completion');
    assert.equal(s.memory[POOL],0x12345678);
    assert(invoke(cleaner,1,{6:8,7:SLOT,8:POOL*4}),'duplicate release faults after cut');
    assert.equal(invoke(cleaner,0,{6:4,7:SLOT+1}),null);
    assert.equal(s.dr[2],POOL*4);
    assert(s.memory.slice(POOL,POOL+8).every(word=>word===0));
}
console.log('PASS Cleaner every-write RAM cuts, failed-release containment and interrupted-release reuse');
