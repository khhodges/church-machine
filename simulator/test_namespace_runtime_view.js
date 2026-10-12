'use strict';
const assert = require('node:assert/strict');
const view = require('./namespace-runtime-view');

const memory = new Uint32Array(16384);
function root(base, count = 64) {
    memory[base] = ((31 << 27) | (count << 10) | (1 << 8)) >>> 0;
    memory[base + 1] = base;
    memory[base + 2] = 1;
    return {word0: 0x02000001, word1: base, word2: count * 4 - 1, word3: 0, m: 1};
}
const old = root(0), destination = root(8192);
function put(base, slot, location, sequence, cc) {
    const offset = base + slot * 4;
    memory.set([location, (sequence << 21) | 20, 123, 456], offset);
    memory[location] = ((31 << 27) | (20 << 10) | cc) >>> 0;
}
put(0, 10, 512, 7, 3);
put(8192, 10, 8704, 8, 5);
const before = memory.slice();
assert.equal(view.slotAddress(memory, old, 10), 40);
assert.equal(view.slotAddress(memory, destination, 10), 8232);
assert.equal(view.readEntry(memory, old, 10).gtSeq, 7);
assert.equal(view.readEntry(memory, destination, 10).gtSeq, 8);
assert.equal(view.readEntry(memory, destination, 10).clistCount, 5);
assert.equal(view.readEntry(memory, old, 10).clistCount, 3);
assert.deepEqual(memory, before, 'reads never change versions, seals or G bits');
// Destination-only, old-only, and identical generation/slot cases are all
// reads from the selected root, not identity shortcuts.
put(0, 11, 640, 0, 1);
assert.equal(view.readEntry(memory, destination, 11), null);
put(8192, 12, 8832, 0, 2);
assert.equal(view.readEntry(memory, old, 12), null);
assert.equal(view.readEntry(memory, destination, 12).word0_location, 8832);
put(8192, 10, 8704, 7, 5);
assert.notEqual(view.readEntry(memory, destination, 10).word0_location,
    view.readEntry(memory, old, 10).word0_location);
assert.equal(view.readEntry(memory, destination, 0), null);
assert.equal(view.readEntry(memory, destination, 64), null);
assert.throws(() => view.slotAddress(memory, destination, 0), /metadata/);
for (const invalid of [{...destination, word2: 63}, {...destination, word1: 16384},
    {...destination, word0: 0}, {...destination, word2: 0x800000ff}]) {
    assert.throws(() => view.geometry(memory, invalid), view.NamespaceGeometryError);
}
memory[8193] = 0;
assert.throws(() => view.geometry(memory, destination), /base disagrees/);
memory[8193] = 8192;
memory[8195] = 1;
assert.throws(() => view.geometry(memory, destination), /reserved/);
console.log('Active-CR15 geometry and uncached isolated entry reads passed.');
console.log('These are lookup unit tests, not full SWITCH handoff conformance.');
