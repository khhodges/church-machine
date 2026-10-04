'use strict';
const assert = require('node:assert/strict');
const S = require('./simulator');

// Disposable RAM only. Literal instruction words and distinct row targets
// make this independent of the assembler and of the saved production catalog.
function fixture(word, dr2) {
    const sim = new S();
    sim.bootComplete = false;
    sim.writeNSEntry(20, 0x200, 63, 0, 0, 1, 0, 4, 0);
    sim.writeNSEntry(22, 0x400, 63, 0, 0, 1, 0, 0, 0);
    const targets = [];
    for (let i = 0; i < 4; i++) {
        sim.writeNSEntry(30 + i, 0x600 + i * 64, 63, 0, 0, 1, 0, 0, 0);
        sim.markLive(30 + i);
        targets.push(sim.createGT(0, 30 + i, { E: 1 }, 1) >>> 0);
        sim.memory[0x200 + i] = targets[i];
    }
    sim.bootComplete = true;
    sim.markLive(20);
    sim.markLive(22);
    const cr = (word0, word1, word2 = 0) => ({word0, word1, word2, word3: 0, m: 0});
    sim.cr[6] = cr(sim.createGT(0, 20, { L: 1 }, 1), 0x200, 4 << 17);
    sim.cr[14] = cr(sim.createGT(0, 22, { R: 1, X: 1 }, 1), 0x400);
    sim.cr[12] = cr(0, 0);
    sim.memory[0x400] = ((31 << 27) | (1 << 10)) >>> 0;
    sim.memory[0x401] = word;
    sim.pc = 0;
    sim.dr[2] = dr2;
    return {sim, targets};
}

for (const word of [0x07230020, 0x07230002]) {
    for (const dr2 of [1, 2, 9]) {
        const {sim, targets} = fixture(word, dr2);
        const decoded = sim.decodeInstruction(word);
        assert.equal(decoded.raw, word);
        assert.equal(decoded.crDst, 4);
        assert.equal(decoded.crSrc, 6);
        const fixed = word === 0x07230020;
        assert.equal(decoded.indexRegister, fixed ? 0 : 2);
        assert.equal(decoded.indexMagnitude, fixed ? 2 : 0);
        assert.equal(sim._resolveCompactIndex(decoded).imm, fixed ? 2 : dr2);
        const before = {...sim.cr[4]};
        sim.step(); // Real fetch, decode, operand access, and fault recording.
        if (!fixed && dr2 === 9) {
            const fault = sim.faultLog.at(-1);
            assert.equal(fault.type, 'NO_CAPABILITY');
            assert.match(fault.rawDiagnosticReason, /index 9 is out of bounds/);
            assert.equal(fault.faultRawWord, word);
            assert.deepEqual(sim.cr[4], before);
            console.log('runtime DR2=9: bounds fault preserves 0x07230002');
        } else {
            assert.equal(sim.faultLog.length, 0);
            assert.equal(sim.cr[4].word0 >>> 0, targets[fixed ? 2 : dr2]);
            assert.equal(sim._instrHistory.at(-1).raw, word);
            console.log(`0x${word.toString(16)}, DR2=${dr2}: loaded row ${fixed ? 2 : dr2}`);
        }
    }
}
console.log('PASS exact fault LOAD pair through simulator execution and fault capture');