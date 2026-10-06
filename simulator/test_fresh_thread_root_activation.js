'use strict';
const assert = require('assert');
const fs = require('fs');
global.window = {bootConfig: JSON.parse(fs.readFileSync('server/boot-config.json'))};
const ChurchSimulator = require('./simulator.js');
const raw = fs.readFileSync('server/lumps/boot-image.bin');
const sim = new ChurchSimulator();
assert(sim.loadBootImage(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
for (let i = 0; !sim.bootComplete && !sim.halted && i < 32; i++) sim._bootStep();
assert(sim.bootComplete && !sim.halted, 'boot-specific root activation still works');
const base = sim.readNSEntry(11).word0_location;
const layout = sim._threadLayoutAtBase(base);
const sto = sim.memory[base + 17] & 4095;
assert.strictEqual(sim._unpackFrameWord(sim.memory[base + sto + 2]).returnPC, 0x7FFF);
const gt = sim.createGT(0, 11, {}, 1);
sim.cr[13] = {...sim.cr[13], word0: gt};
const snapshot = () => JSON.stringify({
    // mLoad may mark Namespace descriptors accessed; no Thread homes or
    // private stack words may be committed by the failed CHANGE.
    threads: [1, 11, 12].map(slot => {
        const b = sim.readNSEntry(slot).word0_location;
        const l = sim._threadLayoutAtBase(b);
        return Array.from(sim.memory.slice(b, b + l.lumpSize));
    }), cr: sim.cr, dr: Array.from(sim.dr),
    pc: sim.pc, sto: sim.sto, flags: sim.flags, slot: sim._currentThreadSlot,
});
// Observe the rejecting gate before ordinary fault recovery resets the machine.
const faults = [];
sim.fault = (type, message) => faults.push({type, message});
const before = snapshot();
assert.strictEqual(sim._execChange({crDst: 13, crSrc: 13, imm: 0}, sim.pc + 1), null);
assert.strictEqual(faults.at(-1).type, 'STACK_UNDERFLOW');
for (const [key, value] of Object.entries(JSON.parse(before))) {
    assert.deepStrictEqual(JSON.parse(snapshot())[key], value, `failed CHANGE preserves ${key}`);
}
assert.strictEqual(sim.selectConfiguredThread(11).ok, false, 'manual selection cannot bypass the fault');
assert.strictEqual(snapshot(), before);
// A genuine suspended continuation (not a poison root) remains resumable.
sim.memory[base + sto + 2] = sim._packFrameWord(1, 1, sto + 2);
assert(sim._execChange({crDst: 13, crSrc: 13, imm: 0}, sim.pc + 1));
assert.strictEqual(sim._currentThreadSlot, 11);
assert.strictEqual(sim.pc, 1);
assert.strictEqual(sim.sto, sto + 2);
sim.cr[13] = {...sim.cr[13], word0: gt};
const activeSTO = sim.sto;
assert(sim._execChange({crDst: 13, crSrc: 13, imm: 0}, sim.pc + 1));
assert.strictEqual(sim.pc, 2, 'self CHANGE resumes its real continuation');
assert.strictEqual(sim.sto, activeSTO);
assert.strictEqual(faults.length, 2);
// Loader accepts the generated two-frame layout, but rejects corruption
// of the retained poison root. Exercise Thread.3 as well as Thread.2.
const initialWords = new Uint32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
for (const slot of [11, 12]) {
    const b = initialWords[initialWords.length - (slot + 1) * 4];
    const l = sim._threadLayoutAtBase(b);
    const rootSTO = l.stackEnd - 2;
    initialWords[b + 17] = (1 << 12) | (rootSTO - 2);
    initialWords[b + rootSTO - 1] = initialWords[b + rootSTO + 1];
    initialWords[b + rootSTO] = (1 << 12) | rootSTO;
}
const initialized = new ChurchSimulator();
assert(initialized.loadBootImage(initialWords.buffer));
for (let i = 0; !initialized.bootComplete && !initialized.halted && i < 32; i++) initialized._bootStep();
assert(initialized.selectConfiguredThread(12).ok);
assert.strictEqual(initialized.pc, 0);
assert.strictEqual(initialized.cr[14].word0 & 65535, 10);
const rootFaults = [];
initialized.fault = type => rootFaults.push(type);
initialized._execReturn({imm: 0});
assert.deepStrictEqual(rootFaults, ['STACK_UNDERFLOW'], 'startup pop retains the root guard');
for (const offset of [1, 2]) {
    const broken = initialWords.slice();
    const b = broken[broken.length - 12 * 4];
    const rootSTO = (broken[b + 17] & 4095) + 2;
    broken[b + rootSTO + offset] ^= 1;
    const rejected = new ChurchSimulator();
    assert.strictEqual(rejected.loadBootImage(broken.buffer), false);
}
console.log('PASS poison-root CHANGE rejection, atomicity, boot and suspended continuations');
