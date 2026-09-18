'use strict';

const assert = require('assert');
const ChurchSimulator = require('./simulator.js');

const sim = new ChurchSimulator();
sim.nsLabels[6] = 'SelfTest';
sim.nsLabels[3] = 'LED_DEV';
sim.cr[0].word0 = sim.createGT(0, 6, { E: 1 }, 1);
sim.cr[1].word0 = sim.createGT(0, 3, { R: 1, W: 1 }, 1);
const bootThreadEntry = sim.readNSEntry(1);
const bootThreadSeq = sim.parseNSWord1(bootThreadEntry.word1_limit).gtSeq;
sim.cr[5] = {
    word0: sim.createGT(bootThreadSeq, 1, { R: 1, W: 1 }, 1),
    word1: bootThreadEntry.word0_location >>> 0,
    word2: bootThreadEntry.word1_limit >>> 0,
    word3: bootThreadEntry.word3_cache_token >>> 0,
    m: 0,
};
sim.cr[14].word0 = sim.createGT(0, 6, { R: 1, X: 1 }, 1);
sim._petNameCRMap = {
    1: 'Input.Buffer',
    14: 'Program.Image',
};
sim._currentInstrLabel = { opName: 'CALL' };

sim.fault('BOUNDS', 'fetch address 0xB7000991 out of memory');

const fault = sim.faultLog.at(-1);
assert.strictEqual(fault.pet_names.CR0, 'SelfTest',
    'fault snapshot resolves CR0 through its captured Namespace slot');
assert.strictEqual(fault.pet_names.CR1, 'Input.Buffer',
    'fault snapshot preserves an explicit pet name for an ordinary CR');
assert.strictEqual(fault.pet_names.CR5, 'Boot.Thread.Heap',
    'fault snapshot qualifies CR5 as the Boot.Thread Heap subregion');
assert.strictEqual(fault.pet_names.CR14, 'Program.Image',
    'fault snapshot preserves the source-defined CR14 pet name');
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