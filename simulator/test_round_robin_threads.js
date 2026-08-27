'use strict';

// Round-robin scheduler regression: the UI operation must use the generated
// Namespace order, wrap exactly once, preserve private state, and fail before
// mutating the current context when a target descriptor is invalid.
const assert = require('assert');
global.window = { bootConfig: { step1: {
    totalNamespaceWords: 16384, namespaceLumpWords: 1024,
    threadLumpWords: 256, threadCount: 3,
} } };
const ChurchSimulator = require('./simulator.js');
const sim = new ChurchSimulator();
sim.bootComplete = true;
sim._currentThreadSlot = 1;

assert.deepStrictEqual(sim.configuredThreadSlots(), [1, 11, 12],
    'configured order is Thread.1, Thread#2, Thread#3');
sim.cr[0] = { word0: 0x11111111, word1: 1, word2: 2, word3: 3 };
sim.dr[1] = 0x11110001;
let switched = sim.advanceConfiguredThread();
assert(switched.ok && switched.slot === 11 && switched.position === 2,
    'first action selects Thread#2');

sim.cr[0] = { word0: 0x22222222, word1: 4, word2: 5, word3: 6 };
sim.dr[1] = 0x22220001;
switched = sim.advanceConfiguredThread();
assert(switched.ok && switched.slot === 12 && switched.position === 3,
    'second action selects Thread#3');
switched = sim.advanceConfiguredThread();
assert(switched.ok && switched.slot === 1 && switched.position === 1,
    'third action wraps to Thread.1');
assert.strictEqual(sim.cr[0].word0, 0x11111111, 'Thread.1 register state is restored');
assert.strictEqual(sim.dr[1], 0x11110001, 'Thread.1 DR state is restored');

const before = sim.activeThreadStatus();
const badBase = sim.readNSEntry(11).word0_location;
sim.memory[badBase] = 0; // invalid descriptor must be rejected before saving Thread.1
switched = sim.advanceConfiguredThread();
assert(!switched.ok, 'invalid target is rejected');
assert.strictEqual(sim.activeThreadStatus().slot, before.slot,
    'validation failure leaves active Thread unchanged');

global.window.bootConfig.step1.threadCount = 1;
const one = new ChurchSimulator();
one.bootComplete = true;
assert(one.advanceConfiguredThread().ok && one.advanceConfiguredThread().unchanged,
    'one-Thread configurations remain Thread.1');
console.log('PASS round-robin Thread scheduler');