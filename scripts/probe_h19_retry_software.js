'use strict';
// Offline exact-image observation only. Do not replace artifacts or repair state.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const Simulator = require('../simulator/simulator');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const imagePath = path.join(ROOT, 'generated-artifacts/amoeba-retry-image/candidate-le.bin');
const image = fs.readFileSync(imagePath);
assert.equal(sha(image), '5603d8e105e47ca0f6524e4553989387c088de19ac0e6b3f6fd9897e170cf16d');
const out = path.resolve(process.argv[2]);
fs.mkdirSync(out, {recursive: false});
const sim = Simulator.fromAscendingNamespaceImage(image,
    {word0: 0x02000001, word1: 0, word2: 255, word3: 0, m: 1});
assert(Buffer.from(sim.memory.buffer).equals(image));
sim.beginBoot();
for (let i = 0; i < 3; i++) assert(sim._bootStep(), JSON.stringify(sim.faultLog));
const threads = new Set();
let steps = 0;
const start = Date.now();
while (steps < 20000 && Date.now() - start < 15000 && !sim.halted && !sim.faultLog.length) {
    threads.add(sim.cr[12].word0 & 0xffff);
    sim.step();
    steps++;
}
assert.equal(sim.faultLog.length, 1, 'Expected a first fault within the probe budget');
const fault = sim.faultLog[0];
const modules = {};
for (const file of Object.keys(require.cache).sort()) {
    if (!file.startsWith(ROOT + path.sep) || file.includes('node_modules')) continue;
    const name = path.relative(ROOT, file);
    const content = fs.readFileSync(file);
    modules[name] = sha(content);
    const target = path.join(out, 'source-snapshot', name);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, content, {flag: 'wx'});
}
const result = {
    imageSha256: sha(image), importedBytesUnchanged: true,
    nodeVersion: process.version, steps, threads: [...threads],
    observationBoundary: 'Simulator faultLog pre-recovery snapshot; board snapshot is a later fault-hold observation',
    sourceIdentity: 'Current workspace JS, separately hashed; not claimed to be the frozen FPGA source',
    fault: {
        code: fault.faultCode, type: fault.type, message: fault.message,
        niaBytes: fault.physicalPC * 4, rawInstruction: fault.faultRawWord,
        threadSlot: fault.threadSlot, artifactSlot: fault.faultingAbstractionSlot,
        cr: fault.crSnapshot, dr: fault.drSnapshot, flags: fault.flagsSnapshot,
    },
    postStepSto: sim.sto, sourceSha256: modules,
    scope: 'Startup through first fault only; no fixture patch, grant change, or software reboot replay',
};
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
fs.writeFileSync(path.join(out, 'software-output.txt'), sim.output, {flag: 'wx'});
fs.writeFileSync(path.join(out, 'final-memory-le.bin'), Buffer.from(sim.memory.buffer), {flag: 'wx'});
console.log(JSON.stringify({
    steps, threads: result.threads, fault: {...result.fault, cr: undefined},
    postStepSto: sim.sto, sourceFiles: Object.keys(modules).length,
}, null, 2));
