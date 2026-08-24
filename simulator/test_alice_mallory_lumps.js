'use strict';

global.window = { bootConfig: {} };

const fs = require('fs');
const path = require('path');
const { bootSim } = require('../tests/gates/sim_helpers');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'server/lumps/manifest.json'), 'utf8'));

function wordsFor(dotName) {
  const entry = manifest.find(row => row.dot_name === dotName);
  if (!entry) throw new Error(`missing manifest record for ${dotName}`);
  const raw = fs.readFileSync(path.join(ROOT, 'server/lumps', entry.filename));
  const words = [];
  for (let i = 0; i < raw.length; i += 4) words.push(raw.readUInt32BE(i));
  return words;
}

function install(dotName, slot) {
  const sim = bootSim();
  if (!sim.bootComplete) throw new Error('boot did not complete');
  if (!sim.loadLumpBinary(wordsFor(dotName), slot, {
    compilerOwnedSelf: true,
    privateDataRows: [1],
  })) {
    throw new Error(`failed to install ${dotName}: ${sim.output}`);
  }
  sim.nsLabels[slot] = dotName;
  return sim;
}

function callMethod(sim, slot, selector) {
  const callerBase = sim.cr[14].word1;
  const nsBase = sim._nsSlotBase(slot);
  const seq = sim.parseNSWord1(sim.memory[nsBase + 1]).gtSeq;
  sim.cr[1].word0 = sim.createGT(seq, slot, { E: 1 }, 1);
  sim.memory[callerBase + 1] = sim.encodeInstruction(2, 0xE, 1, 0, selector);
  sim.pc = 0;
  sim.halted = false;
  sim.step();
}

function stepUntilReturned(sim, maxSteps = 20) {
  const initialDepth = sim.callStack.length;
  for (let i = 0; i < maxSteps && sim.callStack.length >= initialDepth; i++) sim.step();
}

(function testAliceStashReveal() {
  const slot = 30;
  const sim = install('ide.Alice', slot);
  const secret = 0xC0FFEE42;
  sim.dr[1] = secret;
  callMethod(sim, slot, 1);
  stepUntilReturned(sim);
  if (sim.faultLog.length) {
    const fault = sim.faultLog[0];
    throw new Error(`Alice.Stash faulted: ${fault.type}: ${fault.message}\n${sim.output}`);
  }

  sim.dr[1] = 0;
  callMethod(sim, slot, 2);
  stepUntilReturned(sim);
  if (sim.faultLog.length) {
    const fault = sim.faultLog[0];
    throw new Error(`Alice.Reveal faulted: ${fault.type}: ${fault.message}\n${sim.output}`);
  }
  if ((sim.dr[1] >>> 0) !== secret) {
    throw new Error(`Alice.Reveal returned 0x${(sim.dr[1] >>> 0).toString(16)}, expected 0x${secret.toString(16)}`);
  }
  console.log('[PASS] Alice.Stash/Reveal persists and returns the private word');
})();

(function testMalloryNoCapability() {
  const slot = 31;
  const sim = install('ide.Mallory', slot);
  callMethod(sim, slot, 1);
  sim.step();
  const fault = sim.faultLog[sim.faultLog.length - 1];
  if (!fault || fault.type !== 'NO_CAPABILITY') {
    throw new Error(`Mallory.Steal expected NO_CAPABILITY, got ${fault ? fault.type : 'no fault'}`);
  }
  console.log('[PASS] Mallory.Steal deterministically faults NO_CAPABILITY');
})();

(function testReturnDataRegisterAbi() {
  const sim = bootSim();
  const savedDRs = Array.from({ length: 16 }, (_, i) => (0xA1000000 + i) >>> 0);
  const calleeDRs = Array.from({ length: 16 }, (_, i) => (0xB2000000 + i) >>> 0);
  for (let i = 0; i < 16; i++) sim.dr[i] = calleeDRs[i];
  sim.callStack.push({
    returnPC: 7,
    savedCRs: sim.cr.map(cap => ({ ...cap })),
    savedDRs,
    savedFlags: { ...sim.flags },
    savedSTO: sim.sto,
    sz: 1,
    frameWord: 0,
    sentinel: false,
  });
  const result = sim._execReturn({ imm: 0, crDst: 0, crSrc: 0, raw: 0 });
  if (!result || sim.faultLog.length) {
    throw new Error(`RETURN ABI check faulted: ${JSON.stringify(sim.faultLog)}`);
  }
  if (sim.dr[0] !== 0) throw new Error(`RETURN restored nonzero DR0: 0x${sim.dr[0].toString(16)}`);
  for (let i = 1; i <= 3; i++) {
    if ((sim.dr[i] >>> 0) !== calleeDRs[i]) {
      throw new Error(`RETURN did not preserve caller-saved DR${i}`);
    }
  }
  for (let i = 4; i < 16; i++) {
    if ((sim.dr[i] >>> 0) !== savedDRs[i]) {
      throw new Error(`RETURN did not restore callee-saved DR${i}`);
    }
  }
  console.log('[PASS] RETURN preserves DR1–DR3 and restores DR4–DR15');
})();