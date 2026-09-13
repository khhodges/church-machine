'use strict';

// Regression coverage for invalid prepared CR0. The fault must identify the
// CALL CR0 boot-ROM instruction and preserve the exact gate reason.
const assert = require('assert');
const ChurchSimulator = require('./simulator.js');

const sim = new ChurchSimulator();
sim._bootStep();
const home = sim.inspectBootEntryBinding().homeAddress;
sim.memory[home] = sim.createGT(0, 14, { E: 1 }, 1);
sim._bootStep();
assert.strictEqual(sim._bootStep(), false, 'invalid prepared CR0 must fault during CALL CR0');
assert.strictEqual(sim.halted, true, 'invalid prepared CR0 must halt');
assert(sim.faultLog.length > 0, 'boot fault must be recorded');
const fault = sim.faultLog[sim.faultLog.length - 1];
assert.strictEqual(
    fault.message,
    'CALL: CR0: namespace index 14 out of bounds',
    'CALL CR0 must preserve the exact bounds reason'
);
assert.strictEqual(fault.bootEvidence.bootRomAddress, 2);
assert.strictEqual(fault.bootEvidence.provenanceRegister, 'CR0');
assert.strictEqual(fault.bootEvidence.gate, 'BOUNDS');

console.log('PASS CALL CR0 fault identifies provenance and preserves bounds reason');