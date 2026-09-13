'use strict';

// Regression test: the served simulator's boot trace is the prepared-CR0
// three-instruction program.  Keep this historical suite name because it is
// part of the normal registry, but do not encode the retired B:05 FSM here.

const assert = require('assert');
const ChurchSimulator = require('./simulator.js');

const sim = new ChurchSimulator();
assert.strictEqual(sim._bootStep(), true, 'LOAD CR15 did not retire');
assert.strictEqual(sim._bootStep(), true, 'CHANGE CR12 did not retire');
assert.strictEqual(sim._bootStep(), true, 'CALL CR0 did not retire');

assert.strictEqual(sim.bootComplete, true, 'three-instruction boot did not complete');
assert.strictEqual(sim.halted, false, 'three-instruction boot halted');
assert.deepStrictEqual(
    sim.bootProgress.map(row => row.instruction),
    ['LOAD CR15, CR15[0]', 'CHANGE CR12, CR15[1]', 'CALL CR0'],
);
assert.ok(
    sim._tracePacketsBuf.every(packet => packet.nia === 0 || packet.nia === 1 || packet.nia === 2),
    'boot trace contains a retired instruction address',
);
assert.strictEqual(sim.bootPathVersion, 'three-instruction-v1');

console.log('boot_gt_words: PASS three-instruction boot trace contract');