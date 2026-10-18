'use strict';
// Public aggregate evidence only. No addresses, register values, proof words,
// instruction traces, callbacks or references into the protected machine.
function create() {
    return {slots: {}, selfTestReturns: 0, selfTestFailures: 0,
        guardsPassed: 0, guardsFailed: 0, namespaceSwitches: 0};
}
function before(s) {
    const slot = s.cr[14].word0 & 65535;
    const address = s.cr[14].word1 + 1 + s.pc, word = s.memory[address] >>> 0;
    const d = s.decodeInstruction(word);
    // Same emitted guard shape used by the qualified candidate replay.
    const next = s.memory[address + 1] >>> 0;
    return {slot, thread: s.cr[12].word0 & 65535, pc: s.pc, d,
        dataSlot: s.cr[d.crSrc]?.word0 & 65535,
        guard: slot === 6 && d.opcode === 23 &&
            (next >>> 15) === (0xaf084000 >>> 15) && (next & 0x4000) &&
            (next & 0x3fff) && s.memory[address + 2] === 0x1f000000,
        statusFailed: slot === 6 && d.opcode === 3 && s.dr[1] !== 0};
}
function record(c, s, b, result) {
    const count = (slot, key) => {
        c.slots[slot] ||= {};
        c.slots[slot][key] = (c.slots[slot][key] || 0) + 1;
    };
    count(b.slot, 'retired');
    count(b.thread, 'threadSteps');
    if (!result?.skipped && [16, 17].includes(b.d.opcode)) {
        count(b.dataSlot, b.d.opcode === 16 ? 'dataReads' : 'dataWrites');
    }
    if (b.guard) c[result?.skipped ? 'guardsFailed' : 'guardsPassed']++;
    if (b.slot === 6 && b.d.opcode === 3 && (s.cr[14].word0 & 65535) === 10) {
        c.selfTestReturns++;
        if (b.statusFailed) c.selfTestFailures++;
    }
    if (b.d.opcode === 5 && b.d.crDst === 15 && !result?.skipped) c.namespaceSwitches++;
}
function snapshot(c) {
    const slots = Object.freeze(Object.fromEntries(Object.entries(c.slots)
        .map(([k, v]) => [k, Object.freeze({...v})])));
    return Object.freeze({...c, slots});
}
function tableAccess(c, key) {
    if (!c) return;
    c.slots[14] ||= {};
    c.slots[14][key] = (c.slots[14][key] || 0) + 4;
}
module.exports = {create, before, record, snapshot, tableAccess};
