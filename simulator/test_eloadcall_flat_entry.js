'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

global.window = {
    bootConfig: {
        step1: {
            totalNamespaceWords: 16384,
            namespaceLumpWords: 64,
            threadLumpWords: 512,
        },
    },
};

const ChurchSimulator = require('./simulator.js');

// CapabilityTest's explicit method-0 ELOADCALL targets the flat SelfTest LUMP,
// whose word 1 is executable code rather than a method-table BRANCH. The
// fallback must fetch that word, not advance to word 2.
const bytes = fs.readFileSync(path.join(
    __dirname, '..', 'server', 'lumps', 'boot-image.bin'));
const image = bytes.buffer.slice(
    bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const sim = new ChurchSimulator();
sim.bootEntrySlot = 10;

assert.strictEqual(sim.loadBootImage(image), true,
    'committed boot image loads for CapabilityTest→SelfTest regression');

let bootSafety = 0;
while (!sim.bootComplete && !sim.halted && bootSafety++ < 32) {
    sim._bootStep();
}
assert.strictEqual(sim.bootComplete, true,
    'CapabilityTest boot completes before ELOADCALL regression');

let eloadcall = null;
for (let safety = 0; safety < 64 && !sim.halted; safety++) {
    const result = sim.step();
    if (result && result.instr && result.instr.opcode === 8) {
        eloadcall = result;
        break;
    }
}

assert.ok(eloadcall, 'CapabilityTest reaches its ELOADCALL to SelfTest');
assert.strictEqual(sim.cr[14].word1, 0x0200,
    'ELOADCALL installs SelfTest base in CR14');
assert.strictEqual(sim.pc, 0,
    'flat-LUMP ELOADCALL leaves logical PC at the first code word');
assert.strictEqual(sim._nextPhysicalAddr(), 0x0201,
    'the next fetch is SelfTest word 1, not word 2');

const firstSelfTest = sim.step();
assert.ok(firstSelfTest && firstSelfTest.instr,
    'SelfTest first instruction retires');
assert.strictEqual(firstSelfTest.physicalPC, 0x0201,
    'SelfTest first retirement is physical address 0x0201');
assert.strictEqual(sim.opName(firstSelfTest.instr.opcode), 'ISUB',
    'SelfTest first retirement is ISUB');
assert.strictEqual(sim._nextPhysicalAddr(), 0x0202,
    'only after ISUB retires does NIA advance to 0x0202');

console.log('ELOADCALL flat-entry regression passed');