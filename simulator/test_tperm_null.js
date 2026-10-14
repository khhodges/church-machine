'use strict';
const assert = require('node:assert/strict');
global.window = {};
const Simulator = require('./simulator');
const Assembler = require('./assembler');
const encode = (preset, cond = 14) =>
    ((6 << 27) | (cond << 23) | (2 << 19) | (3 << 15) | preset) >>> 0;
for (const preset of ['NULL', '15']) {
    const a = new Assembler();
    a.assemble(`TPERM CR2, ${preset}`);
    assert.deepEqual(a.errors, []);
    assert.match(a.disassemble(encode(15)), /CR2, NULL$/);
}
for (const preset of ['NULLB', '31']) {
    const a = new Assembler();
    a.assemble(`TPERM CR2, ${preset}`);
    assert.ok(a.errors.length);
}
assert.match(new Assembler().disassemble(encode(31)), /#31$/);

const nulls = [0, 1, 0xf9ffffff]; // type 00, including B, domain, perms, seq and slot
const nonNulls = [0x02000000, 0x04000001, 0xfe550123];
const cases = [];
for (const left of [...nulls, ...nonNulls]) cases.push([15, left, 0, null, nulls.includes(left)]);
for (const left of [...nulls, ...nonNulls])
    for (const right of [...nulls, ...nonNulls])
        cases.push([14, left, right, nulls.includes(left) || nulls.includes(right) ? 'NULL_CAP' : null, left === right]);
cases.push([31, 0, 0, 'TPERM_RSV', false]);
for (const [preset, left, right, fault, z] of cases) for (const cond of [14, 0, 15]) {
    const s = new Simulator();
    s.bootComplete = false;
    s.writeNSEntry(22, 0x400, 63, 0, 0, 1, 0, 0, 0);
    s.markLive(22);
    s.bootComplete = true;
    const cap = word0 => ({word0, word1: 0, word2: 0, word3: 0, m: 0});
    s.cr[14] = {...cap(s.createGT(0, 22, {R: 1, X: 1}, 1)), word1: 0x400};
    s.cr[12] = cap(0);
    s.cr[2] = {...cap(left), word1: 123, word2: 456, m: 1};
    s.cr[3] = {...cap(right), word1: 789};
    s.memory[0x400] = ((31 << 27) | (1 << 10)) >>> 0;
    const word = encode(preset, cond);
    s.memory[0x401] = word;
    s.pc = 0;
    const flags = {N: true, Z: false, C: true, V: true};
    s.flags = {...flags};
    const cr = structuredClone(s.cr), dr = Array.from(s.dr), memory = s.memory.slice();
    let captured = null;
    // Observe the pre-recovery boundary and verify attribution before invoking
    // the real fault handler, which may perform architectural recovery.
    const realFault = s.fault.bind(s);
    s.fault = (type, message, meta) => {
        assert.deepEqual(s.flags, flags);
        assert.deepEqual(s.cr, cr);
        assert.equal(s.pc, 0);
        assert.equal(s._currentInstrLabel.instrWord >>> 0, word);
        assert.equal(s._currentInstrLabel.physicalPC, 0x401);
        captured = type;
        realFault(type, message, meta);
    };
    s.step();
    assert.equal(captured, cond === 14 ? fault : null);
    if (!captured) {
        assert.deepEqual(s.cr, cr);
        assert.deepEqual(Array.from(s.dr), dr);
        assert.deepEqual(s.memory, memory);
        assert.deepEqual(s.flags, cond === 14 ? {N: !z, Z: z, C: false, V: false} : flags);
        assert.equal(s.pc, 1);
    } else {
        const record = s.faultLog.at(-1);
        assert.equal(record.pc, 0);
        assert.equal(record.physicalPC, 0x401);
        assert.equal(record.faultRawWord, word);
        assert.deepEqual(record.flagsSnapshot, flags);
        assert.deepEqual(record.crSnapshot, cr);
    }
}
console.log('PASS TPERM NULL/EXACT: architectural types, reserved modifier, predicates, preservation and attribution');
