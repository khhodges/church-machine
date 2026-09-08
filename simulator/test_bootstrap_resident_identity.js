'use strict';

// Task #3321: bootstrap identity is the literal full runtime row-0 SELF GT.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ChurchSimulator = require('./simulator.js');

function wordsFor(sim, slot, row0) {
    const size = 64;
    const words = new Array(size).fill(0);
    words[0] = sim.packLumpHeader(0, 1, 1, 0);
    words[1] = 0; // HALT
    words[size - 1] = row0 >>> 0;
    return words;
}

function residentFixture() {
    const sim = new ChurchSimulator();
    const slot = sim.bootEntrySlot;
    const entry = sim.readNSEntry(slot);
    assert(entry && sim.isNSEntryValid(slot), 'fallback boot entry is resident');
    sim._bootstrapResidentSlots[slot] = true;
    const seq = sim.parseNSWord1(entry.word1_limit).gtSeq;
    const self = sim.createGT(seq, slot, { E: 1 }, 1) >>> 0;
    return { sim, slot, self };
}

{
    const { sim, slot, self } = residentFixture();
    const checked = sim._validateBootstrapResidentSelf(wordsFor(sim, slot, self), slot);
    assert.strictEqual(checked.ok, true);
    assert.strictEqual(checked.selfGT, self);
    assert.strictEqual(ChurchSimulator.formatRuntimeGT(self),
        `0x${self.toString(16).toUpperCase().padStart(8, '0')}`);
}

{
    const { sim, slot, self } = residentFixture();
    const shiftedSlotToken = ((slot << 8) >>> 0);
    assert.notStrictEqual(shiftedSlotToken, self, 'fixture rejects the old slot shift');
    const checked = sim._validateBootstrapResidentSelf(wordsFor(sim, slot, shiftedSlotToken), slot);
    assert.strictEqual(checked.ok, false);
    assert.strictEqual(checked.code, 'BOOTSTRAP_SELF');
}

{
    const { sim, slot, self } = residentFixture();
    const checked = sim._validateBootstrapResidentSelf(wordsFor(sim, slot, self), slot,
        { identityContract: 'portable' });
    assert.strictEqual(checked.ok, false);
    assert.strictEqual(checked.code, 'BOOTSTRAP_CONTRACT');
}

{
    const { sim, slot, self } = residentFixture();
    delete sim._bootstrapResidentSlots[slot];
    const checked = sim._validateBootstrapResidentSelf(wordsFor(sim, slot, self), slot);
    assert.strictEqual(checked.ok, false);
    assert.strictEqual(checked.code, 'BOOTSTRAP_NONRESIDENT');
}

// The boot-image descriptor table, not generated API metadata, is the frozen
// inventory authority.  The repository image intentionally predates the
// correction, so repair only an in-memory test copy and prove all actual
// executable resident descriptors are checked.
function correctedBootImage() {
    const bytes = fs.readFileSync(path.join(__dirname, '..', 'server', 'lumps', 'boot-image.bin'));
    const image = new Uint32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const probe = new ChurchSimulator();
    const expectedSlots = [6, 7, 10];
    for (const slot of expectedSlots) {
        const nsBase = image.length - (slot + 1) * probe.NS_ENTRY_WORDS;
        const location = image[nsBase] >>> 0;
        const lump = probe.parseLumpHeader(image[location] >>> 0);
        assert.strictEqual(lump.valid && lump.typ === 0 && lump.cc > 0, true,
            `NS[${slot}] is an executable frozen resident`);
        const seq = probe.parseNSWord1(image[nsBase + 1] >>> 0).gtSeq;
        const self = probe.createGT(seq, slot, { E: 1 }, 1);
        image[location + lump.lumpSize - lump.cc] = self;
        image[nsBase + 3] = self;
    }
    const bootNsBase = image.length - (expectedSlots[0] + 1) * probe.NS_ENTRY_WORDS;
    image[4] = ((image[bootNsBase] >>> 0) * 4) >>> 0;
    return { image, expectedSlots };
}

{
    const { image, expectedSlots } = correctedBootImage();
    const sim = new ChurchSimulator();
    const inventory = sim._bootstrapResidentInventory(image, 64, image.length - 64 * 4);
    assert.strictEqual(inventory.ok, true);
    assert.deepStrictEqual(Object.keys(inventory.slots).map(Number).sort((a, b) => a - b),
        expectedSlots, 'inventory contains every and only frozen executable resident');
    sim.memory = new Uint32Array(image.length);
    assert.strictEqual(sim.loadBootImage(image.buffer), true);
    assert.deepStrictEqual(Object.keys(sim._bootstrapResidentSlots).map(Number).sort((a, b) => a - b),
        expectedSlots, 'boot loader records all three exact resident identities');
}

for (const [label, replacement] of [
    ['another resident dependency GT', (_sim, expected) => expected[6]],
    ['old slot-shift token', () => 0x00000A00],
    ['hash/projection-looking token', () => 0x0A123456],
]) {
    const { image } = correctedBootImage();
    const probe = new ChurchSimulator();
    const slot = 7;
    const nsBase = image.length - (slot + 1) * probe.NS_ENTRY_WORDS;
    const location = image[nsBase] >>> 0;
    const lump = probe.parseLumpHeader(image[location] >>> 0);
    const expected = {};
    for (const sibling of [6, 7, 10]) {
        const siblingBase = image.length - (sibling + 1) * probe.NS_ENTRY_WORDS;
        expected[sibling] = probe.createGT(
            probe.parseNSWord1(image[siblingBase + 1] >>> 0).gtSeq, sibling, { E: 1 }, 1);
    }
    image[location + lump.lumpSize - lump.cc] = replacement(probe, expected) >>> 0;
    const sim = new ChurchSimulator();
    const inventory = sim._bootstrapResidentInventory(image, 64, image.length - 64 * 4);
    assert.strictEqual(inventory.ok, false, `${label} is rejected`);
    assert.match(inventory.errors.join(' '), /NS\[7\].*row 0/i);
}

{
    const { image } = correctedBootImage();
    const probe = new ChurchSimulator();
    const slot = 10;
    const nsBase = image.length - (slot + 1) * probe.NS_ENTRY_WORDS;
    // Change only the descriptor generation. Row 0 and W3 still agree with
    // each other, but neither is the full GT derived from the live descriptor.
    image[nsBase + 1] = (image[nsBase + 1] ^ (1 << 21)) >>> 0;
    const inventory = probe._bootstrapResidentInventory(image, 64, image.length - 64 * 4);
    assert.strictEqual(inventory.ok, false, 'sequence-only mismatch is rejected');
    assert.match(inventory.errors.join(' '), /NS\[10\].*row 0/i);
    assert.match(inventory.errors.join(' '), /NS\[10\].*W3/i);
    probe.memory = new Uint32Array(image.length);
    const before = Array.from(probe.memory);
    assert.strictEqual(probe.loadBootImage(image.buffer), false);
    assert.deepStrictEqual(Array.from(probe.memory), before,
        'sequence mismatch rejects the image before changing RAM');
}

{
    const { image } = correctedBootImage();
    const probe = new ChurchSimulator();
    const slot = 6;
    const nsBase = image.length - (slot + 1) * probe.NS_ENTRY_WORDS;
    // Preserve the exact row-0 SELF and corrupt only descriptor W3.
    image[nsBase + 3] = 0xDEADBEEF;
    const inventory = probe._bootstrapResidentInventory(image, 64, image.length - 64 * 4);
    assert.strictEqual(inventory.ok, false, 'W3-only mismatch is rejected');
    assert.match(inventory.errors.join(' '), /NS\[6\].*W3/i);
    probe.memory = new Uint32Array(image.length);
    const before = Array.from(probe.memory);
    assert.strictEqual(probe.loadBootImage(image.buffer), false);
    assert.deepStrictEqual(Array.from(probe.memory), before,
        'W3 mismatch rejects the image before changing RAM');
}

console.log('bootstrap resident identity tests passed');