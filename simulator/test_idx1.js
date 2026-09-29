'use strict';

// Synthetic codec and arithmetic fixtures only; no live simulator/workloads.
const assert = require('assert');
const IDX1 = require('./idx1.js');

const vectors = [
    ['52B00002', '070B0000'], ['53B07FFF', '070B0000'],
    ['52200001', '0F308000'], ['52200000', '2F630000'],
    ['52300001', '27610000'], ['52300001', '27778000'],
    ['52200004', '17030060'], ['55400001', '17030007'],
    ['56200004', '17030000', '01400001'],
    ['54900000', '17180000'], ['52FFFFFF', '87094000'],
    ['52200000', '8F0B4000'], ['52300002', '97090008'],
    ['52200000', '9F098004'], ['53000002', 'B8800000'],
];
for (const hex of vectors) {
    const words = hex.map(w => parseInt(w, 16));
    const decoded = IDX1.decodePacket(words);
    assert.deepStrictEqual(IDX1.encodePacket(decoded), words);
    assert.strictEqual(decoded.length, words.length);
}
assert.strictEqual(vectors.length, 15);
assert.deepStrictEqual(IDX1.decodePacket(vectors[8].map(w => parseInt(w, 16))).mask, 3);
assert.deepStrictEqual(IDX1.evaluatePacket(vectors[8].map(w => parseInt(w, 16)),
    { 2: 5, 4: 2 }).values, { role0: 9, role1: 1 });
const dual = vectors[8].map(w => parseInt(w, 16));
assert.deepStrictEqual(IDX1.evaluatePacket(dual, { 2: 5, 4: 9 }).values,
    { role0: 9, role1: 8 });
assert.deepStrictEqual(IDX1.evaluatePacket(vectors[7].map(w => parseInt(w, 16)),
    { 4: 2 }).values, { role1: 1 });
assert.throws(() => IDX1.evaluatePacket(dual, { 2: 0xFFFFFFFF, 4: 0 }),
    e => e.code === 'INDEX_ARITHMETIC'); // role0 first, no slot read
assert.throws(() => IDX1.evaluatePacket(dual, { 2: 5, 4: 0 }),
    e => e.code === 'INDEX_ARITHMETIC'); // role1 also checked before slot selection
assert.strictEqual(IDX1.evaluatePacket(vectors[14].map(w => parseInt(w, 16)),
    {}, { pc: 2, flags: { N: false, Z: false, C: false, V: false },
        codeStart: 0, codeEnd: 6, starts: new Set([0, 2, 4]) }).target, 0);

const invalid = [
    ['50B00002', '070B0000'], ['56200004', '17030000'],
    ['56200004', '17030000', '03400001'],
    ['52B00002', '070B0001'], ['54B00002', '070B0000'],
    ['52B00002', '57000000'], ['52B00002', '47000000'],
    ['52B00002', 'F7000000'], ['52200000', '87090000'],
    ['52200000', '170B0000'], ['52200004', '17031060'],
    ['52300001', '27010000'], ['52200000', '2F7F8000'],
    ['52300002', '97090000'], ['53B00000', '070B0000'],
    ['5AB00002', '070B0000'],
];
invalid.forEach((hex, index) => {
    const words = hex.map(w => parseInt(w, 16));
    assert.throws(() => IDX1.decodePacket(words),
        e => e.code === (index === 1 ? 'FETCH' : 'STRUCTURE'), `invalid packet ${index}`);
});

for (let reg = 0; reg < 16; reg++) {
    for (const mag of [0, 1, 32767, 32768, 1048574, 1048575]) {
        for (const subtract of [false, true]) {
            if (subtract && mag === 0) continue;
            const desc = { register: reg, magnitude: mag, subtract };
            const words = IDX1.encodePacket({ w1: 0x070B0000, role0: desc });
            assert.deepStrictEqual(IDX1.decodePacket(words).role0, desc);
            for (const value of [0, 1, 0x7FFFFFFF, 0x80000000, 0xFFFFFFFF]) {
                const snapshot = { [reg]: value, 0: 0xFFFFFFFF };
                const base = reg === 0 ? 0 : value;
                const expected = base + (subtract ? -mag : mag);
                if (expected < 0 || expected > 0xFFFFFFFF)
                    assert.throws(() => IDX1.evaluateDescriptor(desc, snapshot),
                        e => e.code === 'INDEX_ARITHMETIC');
                else assert.strictEqual(IDX1.evaluateDescriptor(desc, snapshot), expected);
                const signed = base >= 0x80000000 ? base - 0x100000000 : base;
                assert.strictEqual(IDX1.evaluateDescriptor(desc, snapshot, true),
                    signed + (subtract ? -mag : mag));
            }
        }
    }
}

assert.deepStrictEqual(IDX1.parseExpression('DR11 + #0x2'),
    { register: 11, magnitude: 2, subtract: false });
assert.deepStrictEqual(IDX1.parseExpression('DR9 - 0'),
    { register: 9, magnitude: 0, subtract: false });
assert.deepStrictEqual(IDX1.parseExpression('#0b101'),
    { register: 0, magnitude: 5, subtract: false });
assert.deepStrictEqual(IDX1.parseSelector('selector(1)'),
    { register: 0, magnitude: 1, subtract: false });
assert.deepStrictEqual(IDX1.parseSelector('DR4 - 1'),
    { register: 4, magnitude: 1, subtract: true });
for (const bad of ['DR16', 'DR1+1048576', 'DR2+DR3', 'DR1 + -1',
    'selector(1)', '1.2', '0x100000', 'DR1 + 1 + 2']) {
    assert.throws(() => IDX1.parseExpression(bad), e => e.code === 'STRUCTURE');
}
assert.throws(() => IDX1.parseSelector('1'), e => e.code === 'STRUCTURE');
assert.throws(() => IDX1.encodePacket({ w1: 0x070B0000, role1:
    { register: 1, magnitude: 1, subtract: false } }), e => e.code === 'STRUCTURE');
assert.throws(() => IDX1.encodePacket({ w1: 0x070B0000, role0:
    { register: 1, magnitude: 1048576, subtract: false } }), e => e.code === 'STRUCTURE');

const load = vectors[0].map(w => parseInt(w, 16));
const nv = [load[0], (load[1] & ~0x07800000) | (15 << 23)];
assert.strictEqual(IDX1.evaluatePacket(nv, { 11: 0xFFFFFFFF }, { pc: 8 }).nextPC, 10);
assert.strictEqual(IDX1.evaluatePacket(nv, { 11: 0xFFFFFFFF }).executed, false);
assert.throws(() => IDX1.evaluatePacket([nv[0], nv[1] | 1], {}, { pc: 8 }),
    e => e.code === 'STRUCTURE'); // malformed packet fails even under NV
assert.strictEqual(IDX1.evaluatePacket([dual[0], (dual[1] & ~0x07800000) |
    (15 << 23), dual[2]], {}, { pc: 8 }).nextPC, 11);
assert.throws(() => IDX1.evaluatePacket(load, { 11: 0xFFFFFFFF }),
    e => e.code === 'INDEX_ARITHMETIC');
assert.throws(() => IDX1.evaluatePacket(vectors[1].map(w => parseInt(w, 16)), { 11: 1 }),
    e => e.code === 'INDEX_ARITHMETIC');
assert.throws(() => IDX1.evaluatePacket(load, { 11: 2 }, { limits: { role0: 4 } }),
    e => e.code === 'CONTAINMENT');
assert.throws(() => IDX1.evaluatePacket(vectors[12].map(w => parseInt(w, 16)), { 3: 23 }),
    e => e.code === 'CONTAINMENT'); // position 25 + width 8
assert.throws(() => IDX1.evaluatePacket(vectors[14].map(w => parseInt(w, 16)),
    {}, { pc: 3, flags: { N: false, Z: false, C: false, V: false },
        codeStart: 0, codeEnd: 6, starts: new Set([0, 2, 4]) }),
    e => e.code === 'CONTAINMENT');
assert.strictEqual(IDX1.conditionPasses(14), true);
assert.strictEqual(IDX1.conditionPasses(15), false);
console.log('IDX1 synthetic packet/descriptor tests passed');