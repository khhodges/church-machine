'use strict';
const assert = require('node:assert/strict');
const lab = require('./alice_mallory_ascending_lab');
for (let run = 0; run < 3; run++) {
    const secret = [1, 0x2A7, 4095][run];
    const state = lab.create(null, {secret});
    const {sim, roles, bodies} = state;
    assert.deepEqual(state.threadSlots, [2, 11, 12]);
    assert.equal(sim.cr[15].word1, 0);
    assert.equal(sim.cr[15].word2, 255);
    for (let i = 1; i <= 2; i++) {
        const body = bodies[i];
        assert.equal(sim.memory[body.base + body.layout.capsStart + 1], roles[i - 1].gt);
        const home = sim.memory.slice(body.base + body.layout.capsStart,
            body.base + body.layout.capsStart + 12);
        assert(!Array.from(home).some(gt => gt && sim.parseGT(gt).index === roles[2 - i].slot),
            'No other actor authority in primed Thread homes');
    }
    while (!state.passed) lab.step(state);
    assert(state.aliceReturned);
    assert.equal(sim._currentThreadSlot, 12);
    assert.equal(state.firstFaultEvidence.instruction.decoded.opcode, 0);
    assert.equal(state.firstFaultEvidence.instruction.physicalPC, roles[1].base + 2,
        'First rejection is Mallory LOAD of the absent C-list row');
    assert.equal(sim.parseGT(state.firstFaultEvidence.pre.cr[12].word0).index, 12);
    assert(!state.retired.some(row => row.owner === 12 && row.opcode === 16),
        'Mallory must never reach its data-read instruction');
    assert.equal(sim.faultLog.length, 1);
    assert.equal(sim.memory[roles[0].base + 9], secret);
    assert(state.retired.some(row => row.owner === 11 && row.opcode === 2));
    assert(state.retired.some(row => row.owner === 12 && row.opcode === 2));
    assert(!state.retired.some(row => row.opcode === 5), 'No SWITCH in the test');
    console.log(lab.outcome(state));
}
