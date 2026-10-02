'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const Simulator = require('./simulator.js');
const text = fs.readFileSync(__dirname + '/app-memory.js', 'utf8');
function fn(name) {
    const start = text.indexOf('function ' + name + '(');
    const end = text.indexOf('\n}', start) + 2;
    assert(start >= 0);
    return text.slice(start, end);
}
const sim = new Simulator();
const tunnel = {slot: 8, name: 'Tunnel', seq: 7};
const rows = [{slot: 0, name: 'Boot.NS'}, {slot: 1, name: 'Boot.Thread'},
    {slot: 6, name: 'Boot.Target', boot: true}, tunnel];
const window = {_nsState: {savedAbstractions: rows, abstractions: rows,
    namespaceFingerprint: 'a'.repeat(64)}, alert() {}};
const ctx = vm.createContext({sim, window, updateNamespace() {}, _setNsDirty() {},
    _blockFrozenSimulationEdit: () => true});
for (const name of ['_nsTableClear', '_nsTableRowsForSave', '_nsDraftSequence', '_nsFindDraftSlot'])
    vm.runInContext(fn(name), ctx);
const run = code => vm.runInContext(code, ctx);
const memory = Buffer.from(sim.memory.buffer).toString('hex');
assert.strictEqual(run('_nsTableClear(0)'), false);
assert.strictEqual(run('_nsTableClear(1)'), false);
assert.strictEqual(run('_nsTableClear(6)'), false);
assert.strictEqual(run('_nsTableClear(8)'), true);
assert(!run('_nsTableRowsForSave(window._nsState)').some(row => row.slot === 8));
assert.strictEqual(run('_nsDraftSequence(8)'), 8);
assert.strictEqual(Buffer.from(sim.memory.buffer).toString('hex'), memory);
assert.strictEqual(rows.length, 4, 'committed snapshot stays intact until Save');
// Save/reload response carries the server-owned retained generation, not a
// browser cache or the old loaded image's descriptor.
window._nsState = {savedAbstractions: rows.filter(r => r.slot !== 8),
    abstractions: rows.filter(r => r.slot !== 8), namespaceFingerprint: 'b'.repeat(64),
    freeSlotSequences: {'8': 8}, save_mode: 'table-only'};
window._nsDeletedSlots = {};
assert.strictEqual(run('_nsDraftSequence(8)'), 8);
window._nsState.savedAbstractions.push(...[2,3,4,5,7].map(slot => ({slot, name: 'Retained'})));
assert.strictEqual(run('_nsFindDraftSlot()'), 8, 'normal allocator offers empty catalog slot');
sim.simulationConfiguration = {};
assert.strictEqual(run('_nsTableClear(8)'), false);
// A frozen running image must not prevent editing the separate saved design.
window._nsState = {savedAbstractions: rows, abstractions: rows,
    namespaceFingerprint: 'c'.repeat(64)};
window._nsDeletedSlots = {};
assert.strictEqual(run('_nsTableClear(8)'), true);
assert(!run('_nsTableRowsForSave(window._nsState)').some(row => row.slot === 8));
assert.strictEqual(run('_nsTableClear(6)'), false, 'saved boot entry stays protected');
assert.strictEqual(Buffer.from(sim.memory.buffer).toString('hex'), memory);
assert.strictEqual(rows.length, 4, 'frozen design edits preserve saved inputs');
window._nsState = null;
assert.strictEqual(run('_nsTableClear(8)'), false, 'legacy live-memory edits remain blocked');
console.log('Namespace design Clear protections, retained generation, allocation and machine isolation passed');

const local = new Simulator();
local.bootComplete = false;
local.withNamespaceWrite('fixture', () => local.writeNSEntry(8, 1280, 1, 0, 0, 1, 7, 0, 0));
local.lazyManifest = {8: {label: 'Tunnel'}};
const oldGT = local.createGT(7, 8, {E: 1}, 1);
local.bootComplete = true;
local.withNamespaceWrite('explicit clear', () => local.clearNSEntry(8));
assert(!local.lazyManifest[8]);
local._rebuildNamespaceFreeList();
assert.strictEqual(local.allocOrFindNsSlot('new', 'Replacement'), 8);
local.withNamespaceWrite('reissue', () => local.writeNSEntry(8, 1408, 1, 0, 0, 1, 8, 0, 0));
assert.strictEqual(local.parseGT(oldGT).gt_seq, 7);
assert.notStrictEqual(local.parseGT(oldGT).gt_seq,
    local.parseNSWord1(local.memory[local._nsSlotBase(8) + 1]).gtSeq);
assert.strictEqual(local.parseNSWord1(local.memory[local._nsSlotBase(8) + 1]).gtSeq, 8);

// The compiled-program placement path must not alias the old slot-11 base
// when a catalog slot becomes allocatable, nor when code exceeds the stride.
const placement = new Simulator();
placement.bootComplete = false;
placement.writeNsEntryForProgram(11, {words: new Array(400).fill(0), label: 'Retained'});
const retainedBase = placement.readNSEntry(11).word0_location;
const retainedSize = placement.parseLumpHeader(placement.memory[retainedBase]).lumpSize;
placement.memory[retainedBase + 1] = 0x12345678;
placement.withNamespaceWrite('fixture', () => placement.writeNSEntry(8, 1280, 1, 0, 0, 1, 7, 0, 0));
placement.bootComplete = true;
placement.withNamespaceWrite('clear', () => placement.clearNSEntry(8));
placement.writeNsEntryForProgram(8, {words: [0], label: 'Replacement'});
const replacementBase = placement.readNSEntry(8).word0_location;
assert(replacementBase >= retainedBase + retainedSize ||
    replacementBase + 64 <= retainedBase);
placement.cr[14] = {word0: placement.createGT(8, 8, {E: 1}, 1),
    word1: replacementBase,
    word2: placement.memory[placement._nsSlotBase(8) + 1],
    word3: placement.memory[placement._nsSlotBase(8) + 2], m: 0};
placement.loadProgram([0x18000000], 0, 8);
assert.strictEqual(placement.memory[replacementBase + 1], 0x18000000);
assert.strictEqual(placement.memory[retainedBase + 1], 0x12345678);
assert.strictEqual(placement.readNSEntry(8).gtSeq, 8);