'use strict';

const assert = require('assert');
const ChurchSimulator = require('./simulator.js');

const sim = new ChurchSimulator();
sim.nsLabels[6] = 'SelfTest';
sim.nsLabels[3] = 'LED_DEV';
sim.cr[0].word0 = sim.createGT(0, 6, { E: 1 }, 1);
sim.cr[1].word0 = sim.createGT(0, 3, { R: 1, W: 1 }, 1);
sim.cr[14].word0 = sim.createGT(0, 6, { R: 1, X: 1 }, 1);
sim._currentInstrLabel = { opName: 'CALL' };

sim.fault('BOUNDS', 'fetch address 0xB7000991 out of memory');

const fault = sim.faultLog.at(-1);
assert.strictEqual(fault.pet_names.CR0, 'SelfTest',
    'fault snapshot resolves CR0 through its captured Namespace slot');
assert.strictEqual(fault.pet_names.CR1, 'LED_DEV',
    'fault snapshot resolves ordinary GTs through captured Namespace labels');
assert.strictEqual(
    fault.diagnosticNote,
    'CALL BOUNDS fault in SelfTest: fetch address 0xB7000991 out of memory',
    'fault snapshot includes a useful default note');

const fetchSim = new ChurchSimulator();
fetchSim.bootComplete = true;
fetchSim.nsLabels[6] = 'SelfTest';
fetchSim.cr[14].word0 = fetchSim.createGT(0, 6, { R: 1, X: 1 }, 1);
fetchSim.cr[14].word1 = 0x200;
fetchSim.pc = fetchSim.memory.length;
const fetch = fetchSim._fetchInstruction();
assert.strictEqual(fetch.ok, false);
assert.match(fetch.message, /PC 0x[0-9A-F]+ via CR14 \(SelfTest\)/,
    'fetch-bounds message names the logical PC, code register, and pet name');
assert.match(fetch.message, /outside physical memory bounds$/,
    'fetch-bounds message distinguishes address bounds from memory exhaustion');
assert.deepStrictEqual(
    { register: fetch.meta.pcRegister, petName: fetch.meta.pcPetName },
    { register: 'CR14', petName: 'SelfTest' },
    'fetch-bounds metadata preserves the code register and pet name');

console.log('PASS fault snapshot pet names and note');