'use strict';
const assert = require('node:assert/strict');
const {fixture,BASE,SLOT} = require('./native_memory_queue_fixture');
const {compile} = require('./native_memory_queue_fixture');
const fs = require('node:fs');
for (const name of ['memory_queue_free_handler','memory_queue_mint','memory_queue_cleaner','memory_queue_scheduler']) {
    const source=fs.readFileSync(__dirname+'/cloomc/'+name+'.cloomc','utf8');
    let aliases=new Map();
    const raw=source.split('\n').map(line=>{
        if(/^\s*method\b/.test(line)) aliases=new Map();
        const declaration=line.match(/^\s*\.pet\s+(\w+)\s+((?:CR|DR)\d+)\s*$/);
        if(declaration){aliases.set(declaration[1],declaration[2]);return '';}
        const [code,...comments]=line.split(';');
        return code.replace(/"[^"]*"|\b[A-Za-z_]\w*\b/g,w=>aliases.get(w)||w)+
            (comments.length?';'+comments.join(';'):'');
    }).join('\n');
    assert.deepEqual(compile(source).result.methods.map(m=>m.code),
        compile(raw).result.methods.map(m=>m.code),name+' aliases preserve exact instructions');
}
const f = fixture();
const run = f.run();
assert.equal(run.fault, undefined, JSON.stringify(run.fault));
assert(f.s.halted);
const results = [f.s.memory[BASE.results+62],f.s.memory[BASE.results+63]];
assert.deepEqual(results.map(gt => gt & 0xffff).sort(), [22,23]);
assert.deepEqual(results.map(gt => [gt & 0xffff,(gt >>> 16)&511]).sort(),
    [[22,8],[23,14]]);
assert.deepEqual(Array.from(f.s.memory.slice(BASE.blocks,BASE.blocks+16)), Array(16).fill(0));
assert.deepEqual(Array.from(f.s.memory.slice(BASE.state+32,BASE.state+36)), [8,14,1,1]);
for (const slot of [SLOT.producer0,SLOT.producer1,SLOT.cleaner,SLOT.scheduler])
    assert(run.executedThreads.has(slot), `native Thread ${slot} executed`);
assert.equal(f.s.memory[BASE.word],0);
console.log('PASS exact native allocation, versioned release, independent Cleaner, zeroing and reallocation');
assert.deepEqual(run.events.filter(e=>e.kind==='released').map(e=>e.token&65535),[23,22]);
assert.deepEqual(run.events.filter(e=>e.kind==='clean').map(e=>e.token&65535),[23,22]);
for (const options of [
    {cleanerInitiallyReady:true,initialCursor:2},
    {yieldAfterReserve:[0,1]},
    {versions:[509,13]},
]) {
    const trial=fixture(options), result=trial.run();
    assert.equal(result.fault,undefined,JSON.stringify(result.fault));
    assert.equal(result.events.filter(e=>e.kind==='released').length,2);
    assert.deepEqual(result.events.filter(e=>e.kind==='released').map(e=>e.token),
        result.events.filter(e=>e.kind==='clean').map(e=>e.token),'FIFO is publication order');
}
for (const mode of ['exhaust','duplicate','stale-write']) {
    const trial=fixture({modes:[mode,'cycle'],active:[true,false]});
    const result=trial.run();
    assert(result.fault,mode);
    assert.equal(trial.s.parseNSWord1(trial.s.readNSEntry(22).word1_limit).gtSeq,
        mode==='exhaust'?7:8,'failed repeats never increment twice');
}
const retired=fixture({versions:[510,13],modes:['retire','cycle'],active:[true,false]});
assert.equal(retired.run().fault,undefined);
assert.equal(retired.s.memory[BASE.state+34],5);
assert.equal(retired.s.memory[BASE.state+32],511);
assert.equal(retired.s.readNSEntry(22).word0_location,0);
assert.equal(retired.s.validateMAC(retired.s.readNSEntry(22)),false);
assert.equal(retired.s.memory[BASE.state+9],0);

const cancelCode=`
    LOAD CR3, CR6, #3
    LOAD CR0, CR6, #1
    CALL CR0, #5
    RETURNAL #4
`;
for (const [label,allowed] of [
    ['reserve_complete',true],['irreversible_latched',false],['staged',false],
]) {
    const trial=fixture({modes:['cancel','cycle'],active:[true,false],
        transform:{mint0:text=>text.replace(label+':',label+':\n'+cancelCode)}});
    const result=trial.run();
    assert.equal(!!result.fault,!allowed,label);
    if(allowed) {
        assert.equal(trial.s.memory[BASE.state+34],1);
        assert.equal(trial.s.memory[BASE.state+10],0);
        assert.equal(trial.s.memory[BASE.state+32],7);
    }
}
// Compile faulting candidates; the host never emulates a service or repairs
// state. Each cut executes the compiler's fail-closed trap in the real machine.
for(const label of ['reserve_complete','irreversible_latched','version_advanced',
    'descriptor_complete','constructed','staged','terminal_invalidated']) {
    const terminal=label==='terminal_invalidated';
    const trial=fixture({versions:terminal?[510,13]:[7,13],modes:['retire','cycle'],
        active:[true,false],transform:{mint0:text=>text.replace(label+':',
            label+':\n HARDFAULT "injected publication cut"')}});
    const result=trial.run();
    assert(result.fault,label);
    assert.match(result.fault.message, /authored HARDFAULT EXPLICIT_FAULT: injected publication cut/);
    assert.equal(result.events.filter(e=>e.kind==='released').length,0,label);
    assert.equal(trial.s.memory[BASE.state+4],1,'no unpublished block became clean');
}
for(let offset=0;offset<8;offset++){
    const trial=fixture({active:[true,false],modes:['retire','cycle'],
        transform:{handler:text=>text.replace('DWRITE DR0, WorkingBlock, #0, Offset',
            `DWRITE DR0, WorkingBlock, #0, Offset
 MCMP Offset, #${offset}
 BRANCHNE continue_clear_cut
 HARDFAULT "injected clear cut"
continue_clear_cut:`)}});
    const result=trial.run();
    assert(result.fault,`clear word ${offset}`);
    assert.match(result.fault.message, /authored HARDFAULT EXPLICIT_FAULT: injected clear cut/);
    assert.equal(result.events.filter(e=>e.kind==='clean').length,0);
    assert.equal(trial.s.memory[BASE.state+34],4);
}
console.log('PASS FIFO completion order, wakeups, stale/duplicate release, exhaustion, retirement, cancellation and fault cuts');
// Before/after every state/custody write on the main lifecycle paths.
// Helper scalar scratch writes are included. These are independently compiled
// fault candidates, never host-side mutation during service execution.
const handlerSource=fs.readFileSync(__dirname+'/cloomc/memory_queue_free_handler.cloomc','utf8');
let exercised=0;
for(const method of ['Acquire','ReserveRelease','BeginInvalidate','StageReleased','CommitRelease','CleanOne']) {
    const start=handlerSource.indexOf('method '+method+'(');
    let end=handlerSource.indexOf('\nmethod ',start+1);
    if(end<0) end=handlerSource.length;
    const section=handlerSource.slice(start,end);
    for(const match of section.matchAll(/^.*(?:DWRITE|SAVE|LOAD \w+, NULL).*/gm)) {
        for(const before of [true,false]) {
            const position=start+match.index+(before?0:match[0].length);
            const trial=fixture({transform:{handler:text=>text.slice(0,position)+
                '\n HARDFAULT "injected custody transition cut"\n'+text.slice(position)}});
            const result=trial.run();
            assert(result.fault,method+' cut '+match[0]);
            exercised++;
        }
    }
}
console.log(`PASS ${exercised} before/after custody and state-write fault cuts`);
require('./test_native_fault_diagnostics');
