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

const threadEntry = sim.readNSEntry(1);
const threadBase = threadEntry.word0_location;
const threadWordsBefore = sim.memory.slice(threadBase, threadBase + 256);
const capabilityEntry = sim.readNSEntry(10);
const capabilityBase = capabilityEntry.word0_location;
const capabilityBytes = fs.readFileSync(path.join(
    __dirname, '..', 'server', 'lumps', 'CapabilityTest.1.e4591c14.lump'));
const capabilityWords = [];
for (let offset = 0; offset < capabilityBytes.length; offset += 4) {
    capabilityWords.push(capabilityBytes.readUInt32BE(offset));
}

assert.strictEqual(sim.loadLumpBinary(capabilityWords, 10), true,
    'repository CapabilityTest saved LUMP deploys through the normal binary loader');
assert.strictEqual(sim.readNSEntry(10).word0_location, capabilityBase,
    'saved-LUMP replacement remains in Namespace slot 10 allocation');
assert.strictEqual(sim.readNSEntry(6).label, 'SelfTest',
    'saved-LUMP replacement does not overwrite SelfTest');
assert.strictEqual(sim.cr[12].word1, threadBase,
    'CR12 remains bound to Boot.Thread after saved-LUMP deployment');
assert.ok(sim._threadLayoutAtBase(threadBase),
    'Boot.Thread geometry remains valid after saved-LUMP deployment');
assert.deepStrictEqual(
    sim.memory.slice(threadBase, threadBase + 256),
    threadWordsBefore,
    'saved-LUMP deployment does not modify the active Thread body'
);
assert.strictEqual(sim.cr[6].word1,
    capabilityBase + sim.parseLumpHeader(capabilityWords[0]).lumpSize -
        sim.parseLumpHeader(capabilityWords[0]).cc,
    'CR6 points at CapabilityTest embedded c-list');

let eloadcall = null;
for (let safety = 0; safety < 64 && !sim.halted; safety++) {
    const result = sim.step();
    if (result && result.instr && result.instr.opcode === 8) {
        eloadcall = result;
        break;
    }
}

assert.ok(eloadcall, 'CapabilityTest reaches its ELOADCALL to SelfTest');
const selfTestBase = sim.readNSEntry(6).word0_location;
assert.strictEqual(sim.cr[14].word1, selfTestBase,
    'ELOADCALL installs SelfTest base in CR14');
assert.strictEqual(sim.pc, 0,
    'flat-LUMP ELOADCALL leaves logical PC at the first code word');
assert.strictEqual(sim._nextPhysicalAddr(), selfTestBase + 1,
    'the next fetch is SelfTest word 1, not word 2');

const firstSelfTest = sim.step();
assert.ok(firstSelfTest && firstSelfTest.instr,
    'SelfTest first instruction retires');
assert.strictEqual(firstSelfTest.physicalPC, selfTestBase + 1,
    'SelfTest first retirement is its first physical code word');
assert.strictEqual(sim.opName(firstSelfTest.instr.opcode), 'ISUB',
    'SelfTest first retirement is ISUB');
assert.strictEqual(sim._nextPhysicalAddr(), selfTestBase + 2,
    'only after ISUB retires does NIA advance to SelfTest word 2');

let wukongEloadcall = null;
for (let safety = 0; safety < 1000 && !sim.halted; safety++) {
    const result = sim.step();
    if (result && result.instr && result.instr.opcode === 8 &&
            (sim.cr[14].word0 & 0xFFFF) === 7) {
        wukongEloadcall = result;
        break;
    }
}
assert.ok(wukongEloadcall,
    'CapabilityTest returns from SelfTest and reaches its second ELOADCALL');
assert.strictEqual(sim.cr[14].word1, sim.readNSEntry(7).word0_location,
    'second ELOADCALL installs WukongCallHome in CR14');
assert.strictEqual(sim.cr[12].word1, threadBase,
    'CR12 remains bound to Boot.Thread through both ELOADCALL instructions');
assert.ok(sim._threadLayoutAtBase(sim.cr[12].word1),
    'active Thread geometry remains valid through both ELOADCALL instructions');
assert.strictEqual(sim.faultLog.length, 0,
    'valid CapabilityTest execution reaches WukongCallHome without faults');

const corrupt = new ChurchSimulator();
corrupt.bootEntrySlot = 10;
assert.strictEqual(corrupt.loadBootImage(image), true,
    'corrupt-Thread fault fixture loads the committed boot image');
bootSafety = 0;
while (!corrupt.bootComplete && !corrupt.halted && bootSafety++ < 32) {
    corrupt._bootStep();
}
const corruptThreadBase = corrupt.cr[12].word1;
corrupt.memory[corruptThreadBase] = 0;
let emittedTerminalFaults = 0;
corrupt.on('fault', () => { emittedTerminalFaults++; });
const target = corrupt.readNSEntry(6);
const targetGT = corrupt.createGT(
    corrupt.parseNSWord1(target.word1_limit).gtSeq, 6,
    {R:0,W:0,X:0,L:0,S:0,E:1}, 1);
assert.strictEqual(corrupt._writeCR(0, targetGT, target), false,
    'invalid active Thread geometry fails closed when a CR home is materialized');
assert.strictEqual(corrupt.faultLog.length, 1,
    'invalid Thread geometry raises exactly one terminal fault');
assert.strictEqual(emittedTerminalFaults, 1,
    'invalid Thread geometry emits exactly one fault for the modal listener');
assert.match(corrupt.faultLog[0].message, /active Thread.*invalid geometry/,
    'terminal fault remains explicit for the UI fault-modal listener');
const appRunSource = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
assert.match(appRunSource,
    /sim\.faultLog\.length > 0[\s\S]*showFaultModal\(terminalFault\)/,
    'run completion retains the visible terminal-fault modal fallback');

console.log('ELOADCALL flat-entry regression passed');