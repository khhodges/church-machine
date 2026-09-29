'use strict';
// Isolated real CALL/RETURN regression: no boot image or external data.
const assert = require('assert');
global.window = {};
const Simulator = require('./simulator.js');
const Assembler = require('./assembler.js');
const cap = n => ({word0: n, word1: n + 1, word2: n + 2, word3: n + 3, m: 1});
const descriptor = c => [c.word0, c.word1, c.word2, c.word3];
const working = [0, 1, 2, 3, 4, 7, 8, 9, 10, 11];
function setup() {
    const s = new Simulator();
    for (const [slot, base] of [[5, 0x200], [12, 0x400], [13, 0x600]]) {
        s.memory[base] = ((0x1F << 27) | (4 << 10) | 2) >>> 0;
        s.writeNSEntry(slot, base, 63, 0, 0, 1, 0, 2, 0);
    }
    s.bootComplete = true;
    s.cr[12] = {word0: 0, word1: 0, word2: 0, word3: 0, m: 0};
    s.cr[15] = {...s.cr[12]};
    s.cr[6] = {word0: s.createGT(0, 5, {L:1}, 1), word1: 0x23E, word2: 63, word3: 0, m: 1};
    s.cr[14] = {word0: s.createGT(0, 5, {R:1,X:1}, 1), word1: 0x200, word2: 63, word3: 0, m: 0};
    s.cr[5] = cap(500);
    s.fault = (type, message) => { throw new Error(`${type}: ${message}`); };
    return s;
}
function call(s, slot = 12) {
    s.cr[0] = {word0: s.createGT(0, slot, {E:1}, 1), word1: 0, word2: 0, word3: 0, m: 0};
    const heap = descriptor(s.cr[5]);
    assert(s._execCall({crDst: 0, imm: 0}));
    assert.deepStrictEqual(descriptor(s.cr[5]), heap, 'CALL must not overwrite CR5');
}
function ret(s, mask) {
    assert(s._execReturn({imm: mask, crDst: 0, crSrc: 0, raw: 0}));
}
for (const mask of [0, 0xFFF, 0x895, 1 << 5, 1 << 6]) {
    const s = setup();
    const caller6 = descriptor(s.cr[6]);
    for (let repetition = 0; repetition < 3; repetition++) {
        call(s);
        const snapshot = s.callStack[s.callStack.length - 1];
        for (const i of working) {
            snapshot.savedCRs[i] = cap(9000 + i); // poison ignored snapshots
            s.cr[i] = cap(100 + i + repetition);
        }
        // Even a differing saved CR5 must not overwrite the live descriptor.
        snapshot.savedCRs[5] = cap(9999);
        const current = s.cr.map(descriptor);
        ret(s, mask);
        for (const i of working) {
            assert.deepStrictEqual(descriptor(s.cr[i]), mask & (1 << i) ? current[i] : [0,0,0,0]);
            assert.strictEqual(s.cr[i].m, 0);
        }
        assert.deepStrictEqual(descriptor(s.cr[5]), current[5]);
        assert.strictEqual(s.cr[5].m, 0, 'CR5 descriptor preservation is not M preservation');
        assert.deepStrictEqual(descriptor(s.cr[6]), caller6);
        assert.strictEqual(s.cr[6].m, 1);
    }
}
{
    const s = setup();
    const root6 = descriptor(s.cr[6]);
    call(s);
    const middle6 = descriptor(s.cr[6]);
    call(s, 13);
    s.cr[1] = cap(777);
    ret(s, 0xFFF);
    assert.deepStrictEqual(descriptor(s.cr[6]), middle6);
    assert.deepStrictEqual(descriptor(s.cr[1]), descriptor(cap(777)));
    ret(s, 0);
    assert.deepStrictEqual(descriptor(s.cr[6]), root6);
    assert.strictEqual(s.cr[1].word0, 0);
}
for (const mask of [0, 0xFFF, 0x895]) {
    const s = setup();
    const saved = s.cr.map(c => ({...c}));
    s.callStack.push({sz: 0, returnPC: 1, savedCRs: saved, savedSTO: 0});
    for (const i of working) s.cr[i] = cap(200 + i);
    s.cr[6] = cap(1234);
    ret(s, mask);
    for (const i of working) assert.strictEqual(s.cr[i].word0, mask & (1 << i) ? 200 + i : 0);
    assert.deepStrictEqual(descriptor(s.cr[6]), descriptor(saved[6]));
    assert.deepStrictEqual(descriptor(s.cr[5]), descriptor(saved[5]));
}
for (const value of ['-1', '4096', '0x1000', '1, 2']) {
    const a = new Assembler();
    a.assemble(`RETURN ${value}`);
    assert(a.errors.length, `reject mask ${value}`);
}
for (const mask of [0, 1, 32, 64, 0x895, 4095]) {
    const a = new Assembler();
    const word = a.assemble(`RETURN ${mask}`).words[0];
    assert.deepStrictEqual(a.errors, []);
    assert.deepStrictEqual(a.warnings, []);
    assert.strictEqual(word & 0xFFF, mask);
    assert.strictEqual(new Assembler().assemble(a.disassemble(word)).words[0], word);
}
console.log('PASS RETURN keep masks: zero/all/mixed/repeated/nested/CALL/CR5/CR6/LAMBDA/assembler');