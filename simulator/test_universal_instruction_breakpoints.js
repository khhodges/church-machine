'use strict';

const assert = require('assert');
global.window = {};
const ChurchSimulator = require('./simulator.js');

function makeSimulator(words) {
    const sim = new ChurchSimulator();
    sim.bootComplete = false;
    sim.loadProgram(words, 1);
    sim.bootComplete = true;
    sim.halted = false;
    sim.pc = 0;
    sim.cr[14] = {
        word0: sim.createGT(0, 1, { R: 1, X: 1 }, 1),
        word1: 0,
        word2: words.length,
        word3: 0,
        m: 0,
    };
    return sim;
}

const universalOperations = new Map([
    [0, 'LOAD'],
    [1, 'SAVE'],
    [2, 'CALL'],
    [3, 'RETURN'],
    [4, 'CHANGE'],
    [5, 'SWITCH'],
    [8, 'ELOADCALL'],
    [9, 'XLOADCALL'],
]);

for (const [opcode, operation] of universalOperations) {
    const word = ((opcode << 27) | (14 << 23)) >>> 0;
    const sim = makeSimulator([word]);
    const result = sim.run(1, new Set(), new Set([opcode]));
    assert.strictEqual(result.stopReason, 'breakpoint',
        `${operation} universal breakpoint pauses before execution`);
    assert.strictEqual(result.breakpointAddr, 1,
        `${operation} reports its physical instruction address`);
    assert.strictEqual(sim.stepCount, 0,
        `${operation} has not executed when the breakpoint fires`);

    const resumed = sim.run(1, new Set(), new Set([opcode]));
    assert.notStrictEqual(resumed.stopReason, 'breakpoint',
        `${operation} resumes through the current universal breakpoint once`);
}

for (const sentinel of [0, (15 << 23) >>> 0]) {
    const sim = makeSimulator([sentinel]);
    const hit = sim.checkBreakpointBeforeExecute(new Set(), new Set([0]));
    assert.strictEqual(hit, null,
        'universal LOAD does not stop on HALT or NOP');
}

console.log('universal instruction breakpoint regressions passed');