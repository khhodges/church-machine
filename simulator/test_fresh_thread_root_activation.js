'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');

global.window = { bootConfig: { step1: {
    totalNamespaceWords: 16384,
    namespaceLumpWords: 64,
    threadLumpWords: 512,
    threadCount: 3,
} } };

const ChurchSimulator = require('./simulator.js');

const generated = spawnSync('python', ['-c', [
    'import json, sys',
    'from server.boot_image import generate_boot_image',
    'cfg=json.load(open("server/boot-config.json"))',
    'cfg["step1"].update({"totalNamespaceWords":16384,"namespaceLumpWords":64,"threadLumpWords":512,"threadCount":3})',
    'sys.stdout.buffer.write(generate_boot_image(cfg, "server/lumps"))',
].join(';')], { cwd: process.cwd(), encoding: null });
assert.strictEqual(generated.status, 0, String(generated.stderr || ''));

const image = generated.stdout.buffer.slice(
    generated.stdout.byteOffset,
    generated.stdout.byteOffset + generated.stdout.byteLength);
const sim = new ChurchSimulator();
assert.strictEqual(sim.loadBootImage(image), true, sim.lastBootImageError);
for (let safety = 0; !sim.bootComplete && !sim.halted && safety < 32; safety++) {
    sim._bootStep();
}
assert.strictEqual(sim.bootComplete, true, 'fixture completes canonical boot');

const threadEntry = sim.readNSEntry(11);
const threadBase = threadEntry.word0_location;
const layout = sim._threadLayoutAtBase(threadBase);
const enterGT = sim.memory[threadBase + layout.capsStart] >>> 0;
const root = sim._formatThreadRootSentinel(
    threadBase, layout, enterGT, { image: true });
assert(root, 'Thread.2 has a canonical root sentinel');

const activation = sim.advanceConfiguredThread();
assert.strictEqual(activation.ok, true, activation.reason);
assert.strictEqual(activation.slot, 11, 'CHANGE selects Thread.2');
assert.strictEqual(sim.pc, 0,
    'the 0x7FFF root poison marker starts fresh Thread code at PC 0');
assert.strictEqual(sim.sto, root.activeSTO,
    'fresh activation retains the root frame as the live stack bottom');
assert.notStrictEqual(sim.pc, 0x7FFF,
    'the root poison marker is never installed as executable PC');

console.log('fresh Thread root activation tests passed');