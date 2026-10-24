'use strict';
const assert = require('node:assert/strict');
const {fixture} = require('./cr6_contract_fixture');

for (const header of [
    (31 << 27) | (1 << 10) | 255,
    (31 << 27) | (64 << 10),
    (31 << 27) | (1 << 8) | (1 << 10),
    1 << 10,
    (31 << 27) | (3 << 23) | (1 << 10),
]) {
    const {sim, install, activate} = fixture(true);
    const caller = install(30, [0, 0]);
    const target = install(31, [0, 0]);
    activate(caller);
    sim.cr[0] = {word0: target.gt, word1: target.base,
        word2: 63, word3: 0, m: 0};
    sim.memory[target.base] = header >>> 0;
    const crs = structuredClone(sim.cr);
    const stack = structuredClone(sim.callStack);
    const memory = sim.memory.slice();
    let fault;
    sim.fault = (type) => { fault = type; };
    assert.equal(sim._execCall({crDst: 0, imm: 0}), null);
    assert.equal(fault, 'BOUNDS');
    assert.deepEqual(sim.cr, crs);
    assert.deepEqual(sim.callStack, stack);
    assert.deepEqual(sim.memory, memory);
}
{
    const {sim} = fixture(true);
    const gt = sim.createGT(0, 4097, {E: 1, B: 1}, 1);
    const memory = sim.memory.slice();
    assert.equal(sim.mSave(gt, null, 0).ok, false);
    assert.deepEqual(sim.memory, memory);
}
console.log('PASS audit: invalid CALL geometry leaves context unchanged; out-of-range SAVE rejected');
