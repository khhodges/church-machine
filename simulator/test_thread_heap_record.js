'use strict';
const assert = require('assert');
global.window = {bootConfig: {step1: {totalNamespaceWords:16384, namespaceLumpWords:1024, threadLumpWords:256, threadCount:3}}};
const Sim = require('./simulator');
global.ChurchAssembler = require('./assembler');
const Compiler = require('./cloomc_compiler');
const R = require('./thread-heap-record');
function fixture() {
    const s = new Sim(), t = s.getThreadInstanceLayout(11);
    s.cr[12] = {word0:s.createGT(0,11,{R:1,W:1},2),word1:t.base,word2:255,word3:0,m:0};
    s.cr[5] = {word0:s.createGT(0,11,{R:1,W:1},1),word1:t.base+t.heapStart,word2:t.heapWords-1,word3:0,m:0};
    return s;
}
const s = fixture();
R.reservePool(s, 0, 174);
R.allocate(s, 10);
const original = Array.from(s.memory);
const first = R.importRecord(s, 10, {...R.sample(), callerName:'Zoë 東京',telephoneNumber:'+001234'});
assert.equal(first.revision, 1);
assert.equal(first.callerName, 'Zoë 東京');
assert.equal(first.telephoneNumber, '+001234');
const target = R.validateTarget(s,10);
for (let i=0;i<s.memory.length;i++) if(i<target.address || i>=target.address+58)
    assert.equal(s.memory[i],original[i], 'Only reserved heap words may change');
const before = Array.from(s.memory);
for (const bad of [{callerName:'😀'.repeat(17)},{conditions:-1},{telephoneNumber:123},{callState:'invalid'},{GT:123},{revision:42},{}]) {
    assert.throws(() => R.updateRecord(s,10,bad));
    assert.deepStrictEqual(Array.from(s.memory),before);
}
assert.throws(() => R.importRecord(s,10,R.sample()), /approval/);
assert.equal(R.updateRecord(s,10,{endpoint:'desk-12',callState:'connected'}).revision,2);
assert.equal(R.read(s,10).callerName,first.callerName);
assert.deepStrictEqual(JSON.parse(R.exportJson(s,10)),R.read(s,10));
assert.equal(R.importRecord(s,10,R.sample(),{replace:true}).revision,3);
s.running=true; assert.throws(()=>R.updateRecord(s,10,{conditions:1}), /Pause/); s.running=false;
assert.throws(()=>R.read(s,180),/fit/);
const noWrite = fixture();
R.reservePool(noWrite, 0, 58);
R.allocate(noWrite, 0);
noWrite.cr[5].word0 = noWrite.createGT(0,11,{R:1},1);
const old = Array.from(noWrite.memory);
assert.throws(()=>R.importRecord(noWrite,0,R.sample()), /denied/);
assert.deepStrictEqual(Array.from(noWrite.memory),old);
const occupied=fixture();
R.reservePool(occupied, 0, 58); R.allocate(occupied, 0);
occupied.memory[occupied.cr[5].word1]=55;
assert.throws(()=>R.importRecord(occupied,0,R.sample(),{replace:true}),/valid version/);
assert.equal(occupied.memory[occupied.cr[5].word1],55);

// Execute the generated method bodies using real ISA handlers and real heap
// capabilities. Full CALL/RETURN and CHANGE coverage runs below in the
// isolated step-driven frame fixture.
const result = new Compiler().compile(R.source(10),[]);
assert.deepStrictEqual(result.errors,[]);
function body(name, value) {
    if(value!==undefined) s._writeDR(1,value);
    const method=result.methods.find(m=>m.name===name); assert(method);
    for(const word of method.code) {
        const d=s.decodeInstruction(word);
        const op=word>>>27;
        if(op===3) break;
        const handler={16:'_execDread',17:'_execDwrite',21:'_execIadd'}[op];
        assert(handler, 'Unexpected opcode '+op);
        assert.notEqual(s[handler](d),null, name+' faulted');
    }
}
body('Connect');
assert.equal(R.read(s,10).callState,'connected');
body('UpdateConditions',5);
assert.equal(R.read(s,10).conditions,5);
body('ReadConditions'); assert.equal(s.dr[1],5);
body('ReadCallerNameLength'); assert.equal(s.dr[1],14);
body('Initialize');
assert.equal(R.read(s,10).callerName,'');
assert.equal(R.read(s,10).revision,1);
console.log('PASS heap ABI, UTF-8, atomic rejection, permissions, bounds, JSON round-trip, partial updates, and callable instruction bodies');

const multi = fixture();
assert.throws(() => R.importRecord(multi, 0, R.sample()), /No allocation/);
assert.throws(() => R.allocate(multi), /Reserve/);
R.reservePool(multi, 0, 116);
const a = R.allocate(multi), b = R.allocate(multi);
assert.equal(a.offset, 0); assert.equal(b.offset, 58);
assert.throws(() => R.allocate(multi, 1), /collision/); // all-zero owned records still collide
assert.throws(() => R.allocate(multi), /exhausted/);
assert.throws(() => R.allocate(multi, 116), /pool/);
R.importRecord(multi, a.offset, {...R.sample(), callerName: 'A'});
R.importRecord(multi, b.offset, {...R.sample(), callerName: 'B'});
R.updateRecord(multi, a.offset, {conditions: 123});
assert.equal(R.read(multi, b.offset).conditions, 0);
const bBytes = Array.from(multi.memory.slice(multi.cr[5].word1 + 58, multi.cr[5].word1 + 116));
R.release(multi, a.offset);
assert.deepStrictEqual(Array.from(multi.memory.slice(multi.cr[5].word1 + 58, multi.cr[5].word1 + 116)), bBytes);
assert.throws(() => R.release(multi, a.offset), /No allocation/);
assert.throws(() => R.read(multi, a.offset), /No allocation/);
const reused = R.allocate(multi);
assert.equal(reused.offset, a.offset); assert.notEqual(reused.id, a.id);
assert.equal(R.read(multi, b.offset).callerName, 'B');
const copy = fixture();
assert.equal(R.allocations(copy).records.length, 0);
multi._controlFlowDiagnosticResetGeneration++;
assert.equal(R.allocations(multi).records.length, 0);
assert.throws(() => R.read(multi, b.offset), /No allocation/);
R.reservePool(multi, 0, 116);
assert.equal(R.allocate(multi).offset, 0);
assert.throws(() => R.allocate(multi), /exhausted/); // surviving bytes are not adopted
multi.memory = multi.memory.slice();
assert.equal(R.allocations(multi).pool, null);
console.log('PASS explicit ownership, zero-filled collision, exhaustion, isolated updates/release, reuse, and lifetime invalidation');

const lifetime = fixture();
R.reservePool(lifetime, 0, 116); R.allocate(lifetime);
const originalCR12 = {...lifetime.cr[12]}, originalCR5 = {...lifetime.cr[5]};
const other = lifetime.getThreadInstanceLayout(12);
lifetime.cr[12] = {word0: lifetime.createGT(0,12,{R:1,W:1},2), word1: other.base, word2:255};
lifetime.cr[5] = {word0: lifetime.createGT(0,12,{R:1,W:1},1), word1: other.base+other.heapStart, word2:other.heapWords-1};
R.reservePool(lifetime, 0, 58); R.allocate(lifetime);
R.importRecord(lifetime, 0, {...R.sample(), callerName:'Other Thread'});
lifetime.cr[12] = originalCR12; lifetime.cr[5] = originalCR5;
assert.equal(R.allocations(lifetime).pool.words, 116);
assert.equal(R.allocations(lifetime).records.length, 1);
lifetime.cr[12].word0 = lifetime.createGT(0,11,{R:1},2);
assert.equal(R.allocations(lifetime).records.length, 1, 'permission changes cannot fork ownership');
lifetime.emit('threadReset', {slot:12});
assert.equal(R.allocations(lifetime).records.length, 1);
lifetime.emit('threadReset', {slot:11});
assert.equal(R.allocations(lifetime).pool, null);
R.reservePool(lifetime, 0, 58); R.allocate(lifetime);
lifetime.emit('programLoaded', {addr: originalCR5.word1, length:58});
assert.equal(R.allocations(lifetime).pool, null);

const atomic = fixture();
R.reservePool(atomic, 0, 116); R.allocate(atomic);
R.importRecord(atomic, 0, R.sample());
const atomicBefore = Array.from(atomic.memory);
const realLoad = atomic.mLoad.bind(atomic);
atomic.mLoad = (...args) => args[1] === 'W' && args[3] === atomic.cr[5].word1 + 57
    ? {ok:false,message:'last word denied'} : realLoad(...args);
assert.throws(() => R.release(atomic, 0), /denied/);
assert.deepStrictEqual(Array.from(atomic.memory), atomicBefore);
assert.equal(R.allocations(atomic).records.length, 1);
atomic.walkActive = true;
assert.throws(() => R.allocate(atomic), /Pause/);
atomic.walkActive = false;
console.log('PASS Thread isolation, lifecycle events, permission identity, and atomic release rejection');

// Exercise the actual dialog handlers without running the full IDE.
const {JSDOM} = require('jsdom');
const fs = require('fs');
const dom = new JSDOM('<!doctype html><body></body>', {runScripts:'outside-only'});
const win = dom.window, uiSim = fixture();
win.ThreadHeapRecord = R;
win.eval(fs.readFileSync(require.resolve('./app-heap-record'), 'utf8'));
win.getThreadHeapRecordContext = () => uiSim;
win.openThreadHeapRecord();
const q = selector => win.document.querySelector(selector);
const click = text => {
    const button = [...win.document.querySelectorAll('button')].find(b => b.textContent === text);
    assert(button, text); button.click();
};
click('Reserve pool at offset…'); click('Confirm exclusive reservation');
click('Allocate next');
click('Import / replace...'); click('Confirm import');
click('Allocate next');
click('Import / replace...'); click('Confirm import');
assert.equal(R.allocations(uiSim).records.length, 2);
assert.match(q('#thrAllocations').textContent, /58\.\.115/);
q('#thrOffset').value = 0;
click('Release…');
click('Cancel');
assert.equal(R.allocations(uiSim).records.length, 2);
click('Release…'); click('Confirm erase and release');
assert.equal(R.allocations(uiSim).records.length, 1);
assert.equal(R.read(uiSim,58).callerName, R.sample().callerName);
click('Allocate next');
click('Import / replace...');
R.release(uiSim,0); R.allocate(uiSim,0); // identical zero bytes, different owner
click('Confirm import');
assert.match(q('#thrStatus').textContent, /changed/);
assert.throws(() => R.read(uiSim,0), /valid version/);
dom.window.close();
console.log('PASS dialog reserve, allocate, import, list, cancel, release, and stale reuse confirmation');

require('./test_thread_heap_record_frames');
require('./test_thread_heap_record_authority');
