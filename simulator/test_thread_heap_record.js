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
noWrite.cr[5].word0 = noWrite.createGT(0,11,{R:1},1);
const old = Array.from(noWrite.memory);
assert.throws(()=>R.importRecord(noWrite,0,R.sample()), /denied/);
assert.deepStrictEqual(Array.from(noWrite.memory),old);
const occupied=fixture(); occupied.memory[occupied.cr[5].word1]=55;
assert.throws(()=>R.importRecord(occupied,0,R.sample(),{replace:true}),/valid version/);
assert.equal(occupied.memory[occupied.cr[5].word1],55);

// Execute the generated method bodies using real ISA handlers and real heap
// capabilities. RETURN itself uses the separately-tested protected call frame.
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
