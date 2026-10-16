'use strict';

// Private RAM only: no saved LUMPs, server writes, or hardware. Keep the
// generated methods unmodified, including their compiler-selected RETURN masks.
const assert = require('assert');
global.window = {bootConfig: {step1: {
    totalNamespaceWords: 16384, namespaceLumpWords: 1024,
    threadLumpWords: 512, threadCount: 3,
}}};
const Sim = require('./simulator');
global.ChurchAssembler = require('./assembler');
const Compiler = require('./cloomc_compiler');
const {assembleLump} = require('./lump_assembler');
const R = require('./thread-heap-record');
const sim = new Sim();
for (let i = 0; !sim.bootComplete && !sim.halted && i < 32; i++) sim._bootStep();
assert(sim.bootComplete && !sim.halted);
// Capture the first fault, rather than allowing host recovery to hide it.
sim.fault = (type, message) => assert.fail(`${type}: ${message}`);
const slots = sim.configuredThreadSlots();
assert.strictEqual(slots.length, 3);
const threads = slots.map(slot => {
    const base = sim.readNSEntry(slot).word0_location;
    return {slot, base, layout: sim._threadLayoutAtBase(base)};
});
let nextBase = Math.max(...threads.map(t => t.base + t.layout.lumpSize));
function install(slot, code, caps = []) {
    const cc = caps.length + 1;
    let size = 64;
    while (size < code.length + cc + 1) size *= 2;
    const base = nextBase;
    nextBase += size;
    assert(nextBase <= sim.NS_TABLE_BASE);
    assert(!sim.readNSEntry(slot));
    assert(sim.memory.slice(base, nextBase).every(w => w === 0));
    const words = new Uint32Array(size);
    words[0] = sim.packLumpHeader(Math.log2(size) - 6, code.length, cc, 0);
    words.set(code, 1);
    words[size - cc] = Sim.SELF_CAPABILITY_PLACEHOLDER;
    words.set(caps, size - cc + 1);
    const header = sim.parseLumpHeader(words[0]);
    assert(sim.mintStep7Freespace(words, header).ok);
    const minted = sim._mintOrdinaryLumpIdentity(words, slot, base, {compilerOwnedSelf: true});
    assert(minted.ok, minted.message);
    sim.memory.set(minted.words, base);
    sim.withNamespaceWrite('private CallRecord frame test', () =>
        sim.writeNSEntry(slot, base, header.cw, 0, 0, 1,
            minted.entry.seq, cc, minted.entry.cacheToken));
    assert(sim.mLoad(minted.selfGT, 'E', 1).ok);
    return {slot, base, header, gt: minted.selfGT};
}
const compiled = new Compiler().compile(R.source(10), []);
assert.deepStrictEqual(compiled.errors, []);
const assembled = assembleLump(compiled.methods.map(m => m.code));
const record = install(30, assembled.buf.slice(1));
const recordCode = sim.memory.slice(record.base, record.base + record.header.lumpSize);
const method = name => {
    const index = compiled.methods.findIndex(m => m.name === name);
    assert(index >= 0, name);
    return index + 1; // CALL selectors name one-based method-table words.
};
const ins = (op, dst = 0, src = 0, imm = 0) =>
    sim.encodeInstruction(op, 14, dst, src, imm);
const load = row => ins(0, 1, 6, row << 4);
const call = name => ins(2, 1, 0, method(name));
const set = value => ins(21, 1, 0, 0x4000 | value);
const threadGT = slot => sim.createGT(sim._nsSequenceForWrite(slot), slot, {}, 1);
const change = row => [ins(0, 2, 6, row << 4), ins(4, 2, 2, 0)];
const wrapper = install(31, [
    ins(23, 0, 0, 1), // method-table entry dispatches to PC 1
    load(1), set(321), call('UpdateConditions'),
    ...change(2), // Suspend with the outer CALL frame still on the stack.
    load(1), call('Connect'),
    load(1), call('ReadConditions'), ins(3),
], [record.gt, threadGT(slots[1])]);
const outer = install(32, [
    load(1), ins(2, 1, 0, 1), ins(21, 4, 1, 0x4000),
    load(2), call('ReadState'),
    load(2), call('ReadCallerNameLength'),
    ...change(3),
    ins(21, 4, 1, 0x4000),
], [wrapper.gt, record.gt, threadGT(slots[1])]);
const other = install(33, [
    load(1), call('ReadConditions'),
    load(1), set(654), call('UpdateConditions'),
    ...change(2),
    load(1), call('ReadConditions'),
    ...change(2),
], [record.gt, threadGT(slots[0])]);

// Prepare an explicit, ordinary continuation above the retained poison root.
// This is fixture construction, not a shortcut in the executed CHANGE path.
const second = threads[1];
const root = sim._formatThreadRootSentinel(second.base, second.layout, other.gt, {image: true});
sim.memory[second.base + root.activeSTO - 1] = other.gt;
sim.memory[second.base + root.activeSTO] = sim._packFrameWord(0, 1, root.activeSTO);
sim.memory[second.base + 17] = sim._packProtectedIndicator(root.activeSTO - 2, 1, {}, 0);

const offset = 10;
const firstRecord = {...R.sample(), callerName: 'Zoë 東京', conditions: 111};
const secondRecord = {...R.sample(), callerName: 'Other Thread', conditions: 222};
const address = t => t.base + t.layout.heapStart + offset;
R.reservePool(sim, offset, R.schema.words);
R.allocate(sim, offset);
R.importRecord(sim, offset, firstRecord);
const firstHeap = {...sim.cr[5]};
const untouched = threads[2];
const untouchedWords = sim.memory.slice(untouched.base, untouched.base + untouched.layout.lumpSize);
const entry = sim.readNSEntry(outer.slot);
sim._writeCR(0, outer.gt, entry);
sim._installLumpHeaderContext(sim.parseGT(outer.gt), outer.slot, entry, outer.header);
sim.pc = 0;
const initialSTO = sim.sto;
const retired = [];
function until(resident, pc, owner) {
    for (let budget = 300; budget > 0; budget--) {
        if (sim.cr[14].word1 === resident.base && sim.pc === pc &&
                sim._currentThreadSlot === owner) return;
        assert(!sim.halted);
        const before = {owner: sim._currentThreadSlot, slot: sim.parseGT(sim.cr[14].word0).index,
            pc: sim.pc, sto: sim.sto};
        let result;
        try { result = sim.step(); }
        catch (error) {
            throw new Error(error.message + '\nRecent retirements: ' +
                JSON.stringify(retired.slice(-12)), {cause: error});
        }
        assert(result && result.instr && !result.skipped, 'instruction must retire');
        retired.push({...before, opcode: result.instr.opcode});
        const t = threads.find(t => t.slot === sim._currentThreadSlot);
        assert.strictEqual(sim.cr[5].word1, t.base + t.layout.heapStart, 'CR5 follows active Thread');
        assert.strictEqual(sim.cr[5].word2, t.layout.heapWords - 1);
        assert.strictEqual(sim.parseGT(sim.cr[5].word0).index, t.slot);
        if (t === threads[0]) assert.deepStrictEqual(sim.cr[5], firstHeap, 'first CR5 continuity');
    }
    assert.fail(`did not reach slot ${resident.slot} PC ${pc} in Thread ${owner}`);
}
until(wrapper, 4, slots[0]);
assert.strictEqual(sim.sto, initialSTO - 2, 'nested method returned but outer frame remains');
assert.strictEqual(sim.dr[1], 321, 'UpdateConditions returns its DR1 input');
assert.deepStrictEqual(R.read(sim, offset), {...firstRecord, revision: 2, conditions: 321});
const firstSuspendedBytes = sim.memory.slice(address(threads[0]), address(threads[0]) + R.schema.words);
until(other, 0, slots[1]);
R.reservePool(sim, offset, R.schema.words);
R.allocate(sim, offset);
R.importRecord(sim, offset, secondRecord);
until(other, 2, slots[1]);
assert.strictEqual(sim.dr[1], 222, 'same generated reader sees the second Thread, never first record');
assert.deepStrictEqual(R.read(sim, offset), {...secondRecord, revision: 1});
const suspended = sim._readThreadResumeFrame(threads[0].base, threads[0].layout, slots[0]);
assert.strictEqual(suspended.parsed.index, wrapper.slot);
assert.strictEqual(suspended.frame.returnPC, 6, 'resume after CHANGE, inside wrapper');
until(other, 5, slots[1]);
assert.strictEqual(sim.dr[1], 654);
assert.deepStrictEqual(R.read(sim, offset), {...secondRecord, revision: 2, conditions: 654});
assert.deepStrictEqual(sim.memory.slice(address(threads[0]), address(threads[0]) + R.schema.words),
    firstSuspendedBytes, 'second Thread writes cannot alter first record');
until(wrapper, 6, slots[0]);
assert.strictEqual(sim.dr[1], 321, 'suspended DR1 restored independently');
assert.strictEqual(sim.sto, initialSTO - 2, 'outer frame survived suspension');
assert.deepStrictEqual(R.read(sim, offset), {...firstRecord, revision: 2, conditions: 321});
until(wrapper, 8, slots[0]);
assert.strictEqual(sim.dr[1], 2, 'Connect returns connected state');
until(outer, 2, slots[0]);
assert.strictEqual(sim.dr[1], 321, 'ReadConditions returned through both CALL frames');
assert.strictEqual(sim.sto, initialSTO, 'both frames popped');
assert.strictEqual(sim.parseGT(sim.cr[6].word0).index, outer.slot, 'caller c-list reconstructed');
until(outer, 5, slots[0]);
assert.strictEqual(sim.dr[1], 2, 'ReadState result reaches caller');
until(outer, 7, slots[0]);
assert.strictEqual(sim.dr[1], Buffer.byteLength(firstRecord.callerName), 'UTF-8 length returned');
assert.deepStrictEqual(R.read(sim, offset),
    {...firstRecord, revision: 3, conditions: 321, callState: 'connected'});
until(other, 9, slots[1]);
assert.strictEqual(sim.dr[1], 654, 'second record survives its own suspend/resume');
until(outer, 9, slots[0]);
assert.strictEqual(sim.dr[1], Buffer.byteLength(firstRecord.callerName), 'first result survives another switch');
assert.deepStrictEqual(sim.memory.slice(untouched.base, untouched.base + untouched.layout.lumpSize),
    untouchedWords, 'third Thread remains byte-for-byte untouched');
const calls = retired.filter(r => r.opcode === 2).length;
assert.strictEqual(calls, 9, 'all expected calls executed');
assert.strictEqual(retired.filter(r => r.opcode === 3).length, calls, 'all actual RETURNs executed');
assert.strictEqual(retired.filter(r => r.opcode === 4).length, 4, 'four actual Thread switches');
assert(retired.some(r => r.slot === record.slot && r.sto === initialSTO - 4),
    'generated methods executed at nested protected-frame depth');
assert.deepStrictEqual(sim.memory.slice(record.base, record.base + record.header.lumpSize),
    recordCode, 'shared generated executable remains immutable');
console.log('PASS generated CallRecord: nested CALL/RETURN, suspended frames, DR1, CR5, and Thread isolation');
