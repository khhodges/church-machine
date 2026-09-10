'use strict';

// Regression coverage for boot faults whose destination CR has not been
// written yet. The fault message must still identify the architectural
// register the boot step was trying to populate.
const assert = require('assert');
const ChurchSimulator = require('./simulator.js');

const sim = new ChurchSimulator();
sim.reset();
sim.bootEntrySlot = 14;

for (let i = 0; i < 6 && !sim.halted; i++) sim._bootStep();

assert.strictEqual(sim.halted, true, 'invalid boot entry must fault during INIT_ABSTR');
assert(sim.faultLog.length > 0, 'boot fault must be recorded');
const fault = sim.faultLog[sim.faultLog.length - 1];
assert.strictEqual(
    fault.message,
    'INIT_ABSTR mLoad(CR6, Slot 14) failed: namespace index 14 out of bounds',
    'INIT_ABSTR must identify destination CR6 and preserve the exact reason'
);

console.log('PASS boot fault message identifies CR6 and preserves mLoad reason');