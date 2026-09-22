'use strict';

const assert = require('assert');
const crypto = require('crypto');
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
const lumpsDir = path.join(__dirname, '..', 'server', 'lumps');
const WUKONG_FIXTURE = Object.freeze({
    abstraction: 'WukongCallHome',
    filename: 'WukongCallHome.1.ba8b8e76.lump',
    sha256: '5ceb0eafe823710de8c682e3399fc5aed3313ad5f00ebc5e2f3b290b1b19ef01',
});
const CAPABILITY_FIXTURE = Object.freeze({
    abstraction: 'CapabilityTest',
    filename: 'CapabilityTest.1.8efa26a3.lump',
    sha256: '5ade31ec3dff80e622242d889566d24ce301a43ce69c6597669fa9bff9e0e4d3',
});

function readWords(entry) {
    const bytes = fs.readFileSync(path.join(lumpsDir, entry.filename));
    assert.strictEqual(
        crypto.createHash('sha256').update(bytes).digest('hex'),
        entry.sha256,
        `${entry.filename} immutable fixture digest`
    );
    const words = [];
    for (let offset = 0; offset < bytes.length; offset += 4) {
        words.push(bytes.readUInt32BE(offset));
    }
    return words;
}

function installOptions(sim, slot) {
    const entry = sim.readNSEntry(slot);
    return {
        compilerOwnedSelf: true,
        remintCompilerOwnedSelf: true,
        sourceSelfSlot: slot,
        sourceSelfSeq: sim.parseNSWord1(entry.word1_limit).gtSeq,
    };
}

const bootBytes = fs.readFileSync(path.join(lumpsDir, 'boot-image.bin'));
const bootImage = bootBytes.buffer.slice(
    bootBytes.byteOffset, bootBytes.byteOffset + bootBytes.byteLength);
const sim = new ChurchSimulator();
assert.strictEqual(sim.loadBootImage(bootImage), true, 'committed boot image loads');
while (!sim.bootComplete && !sim.halted) sim._bootStep();
assert.strictEqual(sim.bootComplete, true, 'isolated simulator boot completes');

const wukong = WUKONG_FIXTURE;
const capabilityTest = CAPABILITY_FIXTURE;
const wukongWords = readWords(wukong);
const capabilityWords = readWords(capabilityTest);
const wukongSlot = 7;
const capabilitySlot = 10;

assert.strictEqual(
    sim.loadLumpBinary(wukongWords, wukongSlot, installOptions(sim, wukongSlot)),
    true,
    `exact active ${wukong.filename} installs`
);

// Model direct execution of the saved Wukong LUMP. Its first word is a
// one-entry method table, so executable code begins at logical PC 1.
const wukongEntry = sim.readNSEntry(wukongSlot);
const wukongHeader = sim.parseLumpHeader(wukongWords[0]);
const wukongSeq = sim.parseNSWord1(wukongEntry.word1_limit).gtSeq;
const wukongEnter = sim.parseGT(
    sim.createGT(wukongSeq, wukongSlot, { E: 1 }, 1));
sim._installLumpHeaderContext(
    wukongEnter, wukongSlot, wukongEntry, wukongHeader);
sim.pc = 1;
sim.halted = false;
sim.programName = 'WukongCallHome';

const expectedClistBase =
    wukongEntry.word0_location + wukongHeader.lumpSize - wukongHeader.cc;
assert.strictEqual(sim.cr[6].word1, expectedClistBase,
    'direct Wukong context starts with its embedded c-list');

// Replacing an unrelated resident used to overwrite CR6 unconditionally.
// That produced the field failure: Wukong LOAD CR3,CR6[1] read
// CapabilityTest row 1/4-era state and DWRITE then faulted on BTN_DEV.
assert.strictEqual(
    sim.loadLumpBinary(
        capabilityWords, capabilitySlot, installOptions(sim, capabilitySlot)),
    true,
    `exact active ${capabilityTest.filename} deploys in the background`
);
assert.strictEqual(sim.parseGT(sim.cr[14].word0).index, wukongSlot,
    'background deployment preserves active Wukong code context');
assert.strictEqual(sim.parseGT(sim.cr[6].word0).index, wukongSlot,
    'background deployment preserves active Wukong c-list identity');
assert.strictEqual(sim.cr[6].word1, expectedClistBase,
    'background deployment preserves active Wukong c-list base');

for (let step = 0; step < 4; step++) {
    assert(sim.step(), `Wukong instruction ${step + 1} retires`);
}
assert.strictEqual(sim.cr[3].word0 >>> 0, 0x32000003,
    'LOAD CR3, CR6[1] materializes LED_DEV RW');
assert.strictEqual(sim.cr[4].word0 >>> 0, 0x32000002,
    'LOAD CR4, CR6[2] materializes UART_DEV RW');
assert.strictEqual(sim.faultLog.length, 0,
    'Wukong DWRITE through CR3 retires without weakening W permission checks');
assert.strictEqual(sim.ledBits & 1, 1, 'Wukong turns LED0 on');

// Explicit "Load into Sim" remains a direct-run operation even if another
// resident owns CR14. It atomically activates both views without changing the
// prepared LightningBolt selection.
const preparedSlot = sim.bootEntrySlot;
assert.strictEqual(
    sim.loadLumpBinary(capabilityWords, capabilitySlot, {
        ...installOptions(sim, capabilitySlot),
        activateExecution: true,
    }),
    true,
    'explicit direct-run load activates the requested immutable fixture'
);
assert.strictEqual(sim.parseGT(sim.cr[14].word0).index, capabilitySlot,
    'explicit direct-run load activates target CR14');
assert.strictEqual(sim.parseGT(sim.cr[6].word0).index, capabilitySlot,
    'explicit direct-run load activates matching target CR6');
assert.strictEqual(sim.bootEntrySlot, preparedSlot,
    'explicit direct-run load does not change prepared boot selection');

const appLumpsSource = fs.readFileSync(
    path.join(__dirname, 'app-lumps.js'), 'utf8');
const loaderStart = appLumpsSource.indexOf(
    'async function _loadLumpBinaryIntoSim(');
const loaderEnd = appLumpsSource.indexOf(
    '\nasync function _lumpGTNameCommit', loaderStart);
const savedLumpLoader = appLumpsSource.slice(loaderStart, loaderEnd);
assert(savedLumpLoader.includes('rawWords,\n            _targetSlot,'),
    'saved-LUMP direct run installs into its resolved live Namespace slot');
assert(savedLumpLoader.includes('activateExecution: true'),
    'saved-LUMP direct run explicitly requests execution activation');

console.log('Wukong direct-run c-list context regression passed');