'use strict';

const assert = require('assert');
const ChurchSimulator = require('./simulator.js');

const sim = new ChurchSimulator();
const entryWords = sim.NS_ENTRY_WORDS;
const fallbackHeader = sim.parseNamespaceHeaderV2(sim.memory, 0);
assert(fallbackHeader.valid, fallbackHeader.errors.join(' '));
assert.strictEqual(sim.readNSEntry(1).word0_location >= ChurchSimulator.NAMESPACE_HEADER_V2_WORDS, true,
    'fallback Thread body begins after the physical V2 header');
assert.strictEqual(sim.memory[sim.NS_TABLE_BASE - 3], 0,
    'fallback does not write retired tail nsCount metadata');
assert.strictEqual(sim.memory[sim.NS_TABLE_BASE - 4], 0,
    'fallback does not write retired tail Thread-count metadata');

// Every representable Namespace RAM exponent is decoded with the Namespace
// n-13 floor, not the ordinary/Thread n-6 floor.
for (let field = 0; field <= 9; field++) {
    const size = 2 ** (field + 13);
    const slots = Math.min(0x1FFF, (size - 64) / entryWords);
    const table = size - slots * entryWords;
    const words = sim.packNamespaceHeaderV2(size, slots, table, 64);
    const decoded = sim.parseNamespaceHeaderV2(words);
    assert(decoded.valid, decoded.errors.join(' '));
    assert.strictEqual(decoded.namespaceSize, size);
    assert.strictEqual(decoded.slotCount, slots);
    assert.strictEqual(decoded.header.typ, 1);
    assert.strictEqual(decoded.header.cc, 0);
}

// Plain cw is the complete count: no cc extension is accepted in V2.
for (const slots of [0, 1, 63, 64, 255, 256, 1024, 8191]) {
    const size = 0x400000;
    const table = size - slots * entryWords;
    const words = sim.packNamespaceHeaderV2(size, slots, table, 64);
    const decoded = sim.parseNamespaceHeaderV2(words);
    assert(decoded.valid, `slot count ${slots}: ${decoded.errors.join(' ')}`);
    assert.strictEqual(decoded.slotCount, slots);
    assert.strictEqual(decoded.tableOffset + slots * 4, size);
    assert.strictEqual(decoded.bootEntryWord, 64);
}

const canonical = sim.packNamespaceHeaderV2(65536, 1024, 61440, 64);
assert(sim.parseNamespaceHeaderV2(canonical).valid, 'canonical boot-entry round trip');
for (const [name, mutate] of [
    ['nonzero cc', words => { words[0] |= 1; }],
    ['wrong type', words => { words[0] = sim.packLumpHeader(3, 1024, 0, 2); }],
    ['bad table geometry', words => { words[2]--; }],
    ['bad base', words => { words[1] = 1; }],
    ['out-of-range boot entry', words => { words[4] = 65536; }],
    ['bad seal boundary', words => { words[5]++; }],
    ['bad version marker', words => { words[1] = 0; }],
]) {
    const words = canonical.slice();
    mutate(words);
    assert.strictEqual(sim.parseNamespaceHeaderV2(words).valid, false, name);
}

// Thread retains ordinary n-6 size interpretation.
const thread = sim.parseLumpHeader(sim.packLumpHeader(3, 32, 12, 2));
assert.strictEqual(thread.lumpSize, 512);
assert.strictEqual(thread.namespaceSize, null);
console.log('Namespace Header V2 simulator tests passed');