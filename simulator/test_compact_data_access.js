'use strict';
const assert = require('node:assert/strict');
const A = require('./assembler');
global.ChurchAssembler = A;
const C = require('./cloomc_compiler');
const IDE = require('./idx1-ide');
const {fixture} = require('../tests/simulator/cr6_contract_fixture');
function word(source) {
    const r = new A().assemble(source);
    assert.deepEqual(r.errors, [], source);
    assert.equal(r.words.length, 1);
    return r.words[0] >>> 0;
}
for (const [source, expected] of [
    ['DREAD DR8, CR2, #408', 0x87411980],
    ['DWRITE DR8, CR2, #408', 0x8f411980],
    ['DREAD DR8, CR2, DR11 - 25', 0x8741419b],
    ['DREAD DR8, CR2, #-25, DR11', 0x8741419b],
    ['DREAD DR8, CR2, DR15 + 1023', 0x87413fff],
    ['DREAD DR8, CR2, DR15 - 1023', 0x87417fff],
]) {
    assert.equal(word(source), expected);
    assert.equal(word(new A().disassemble(expected)), expected);
    assert.equal(IDE.requiresProfile(source), false);
}
for (const op of ['DREAD', 'DWRITE']) {
    for (const bad of ['#1024', '#-1024', '#16383', 'DR16', '1.5',
        'DR1 + 1024', '#3, DR16', '#3, DR2, junk']) {
        assert(new A().assemble(`${op} DR8, CR2, ${bad}`).errors.length, bad);
    }
    for (const [expression, value, offset] of [
        ['#3', 0, 3], ['DR9 + 3', 2, 5], ['DR9 - 3', 8, 5],
        ['DR9', 5, 5], ['DR9 - 0', 5, 5],
    ]) {
        const {sim, install, activate} = fixture(true);
        const target = install(30, [0,0,0,0,0,0,0]);
        const gt = sim.createGT(0, target.slot, {R:1,W:1}, 1);
        assert(sim.mLoad(gt, 'R', 2).ok);
        activate(install(31, [word(`${op} DR8, CR2, ${expression}`)]));
        sim.cr[2] = {word0:gt, word1:target.base, word2:63, word3:0, m:0};
        sim.dr[9] = value;
        sim.dr[8] = 123;
        sim.memory[target.base + offset] = 456;
        sim.step();
        if (op === 'DREAD') assert.equal(sim.dr[8], 456);
        else assert.equal(sim.memory[target.base + offset], 123);
    }
    for (const [expression, value] of [['DR9 - 1', 0], ['DR9 + 1', 0xffffffff]]) {
        const {sim} = fixture(true);
        sim.dr[9] = value;
        let fault;
        sim.fault = (type) => { fault = type; };
        const before = sim.memory.slice();
        const d = {crDst:8, crSrc:2, imm:word(`${op} DR8, CR2, ${expression}`)&32767};
        sim[op === 'DREAD' ? '_execDread' : '_execDwrite'](d);
        assert.equal(fault, 'BOUNDS');
        assert.deepEqual(sim.memory, before);
    }
}
assert.equal(new C().encode(16,14,8,2,408), 0x87411980);
assert.equal(new C().encode(17,14,8,2,-25), 0x8f414190);
assert.throws(() => new C().encode(16,14,8,2,1024), /1023/);
console.log('PASS compact data-access encoding, roundtrip, real execution and containment');
