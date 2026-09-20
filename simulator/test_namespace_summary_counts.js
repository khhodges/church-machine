'use strict';

// Cheap focused verification of the real browser count/policy functions.  The
// production declarations are extracted from app-memory.js so this test cannot
// silently drift into a second implementation of the summary algorithm.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'app-memory.js'), 'utf8');

function extractFunction(name) {
    const marker = `function ${name}(`;
    const start = source.indexOf(marker);
    assert.notStrictEqual(start, -1, `missing production function ${name}`);
    const bodyStart = source.indexOf('{', start);
    let depth = 0;
    let quote = null;
    let escaped = false;
    for (let index = bodyStart; index < source.length; index++) {
        const char = source[index];
        if (quote) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === quote) quote = null;
            continue;
        }
        if (char === '"' || char === "'" || char === '`') {
            quote = char;
        } else if (char === '{') {
            depth++;
        } else if (char === '}' && --depth === 0) {
            return source.slice(start, index + 1);
        }
    }
    throw new Error(`unterminated production function ${name}`);
}

const entries = new Map([
    [0, { label: 'Boot.NS', word0_location: 100 }],
    [1, { label: 'Worker.Thread', word0_location: 200 }],
    [2, { label: 'Tunnel', word0_location: 300 }],
    [3, { label: 'Ethernet', word0_location: 400 }],
    [4, { label: 'Pending.Empty', word0_location: 500 }],
    [13, { label: 'M_BIT_DEV', word0_location: 600 }],
]);
const threadSlots = new Set([1]);
const context = {
    console,
    window: {
        _nsState: {
            namespaceFingerprint: 'fixture-a',
            abstractions: [
                { slot: 2, load_policy: 'Lazy' },
                { slot: 3, load_policy: 'Resident' },
                { slot: 4, load_policy: 'Empty' },
            ],
        },
        bootConfig: { slotRules: {}, step2: { lumps: [] } },
        _nsPrefetchDirty: false,
        _nsPrefetchDirtySlots: {},
    },
    ChurchArchitectureContracts: {
        boot: {
            minimalSlots: { 'Boot.NS': 0, 'Boot.Thread': 1 },
            devices: {},
            namedCatalogSlots: [2, 3],
        },
    },
    sim: {
        MAX_NS_ENTRIES: 256,
        nsCount: 14,
        nsLabels: Object.fromEntries(
            Array.from(entries, ([slot, entry]) => [slot, entry.label])),
        lazyManifest: {},
        _nsFreeSequences: { 5: 2 },
        readNSEntry(slot) {
            return entries.get(slot) || null;
        },
    },
    _threadLayoutForSlot(slot) {
        return { valid: threadSlots.has(slot) };
    },
};
context.globalThis = context;
vm.createContext(context);
[
    '_architectureBootSlots',
    '_isBootstrapSlot',
    '_isResidentIORegister',
    '_nsSlotHasResidentThreadBody',
    '_nsSavedLoadPolicy',
    '_namespaceSummarySnapshot',
].forEach(name => vm.runInContext(extractFunction(name), context));

function snapshot() {
    return vm.runInContext('_namespaceSummarySnapshot()', context);
}

// Mixed policies use the row's effective policy, while Thread and I/O are
// fixed resident. Slot 13 proves the inclusive trailing-row behavior.
let current = snapshot();
assert.strictEqual(current.slots[0].classification, 'resident');
assert.strictEqual(current.slots[1].classification, 'resident');
assert.strictEqual(current.slots[2].classification, 'lazy');
assert.strictEqual(current.slots[3].classification, 'resident');
assert.strictEqual(current.slots[13].classification, 'resident');
assert.deepStrictEqual(
    {
        resident: current.counts.resident,
        lazy: current.counts.lazy,
        garbage: current.counts.garbage,
        free: current.counts.free,
    },
    { resident: 4, lazy: 1, garbage: 1, free: 250 });

// Empty is projected capacity, not revocation garbage. A cleared generation is
// Garbage and therefore excluded from Free until the slot is reissued.
assert.strictEqual(current.slots[4].classification, 'free');
assert.strictEqual(current.slots[5].classification, 'garbage');
assert.strictEqual(
    current.counts.resident + current.counts.lazy +
        current.counts.garbage + current.counts.free,
    current.counts.max);

// An unsaved row policy and a fixed-catalog slotRule both win while dirty.
context.window.bootConfig.step2.lumps = [
    { nsSlot: 4, loadPolicy: 'Resident', resident: true },
];
context.window.bootConfig.slotRules['2'] = 'Resident';
context.window._nsPrefetchDirty = true;
context.window._nsPrefetchDirtySlots = { 2: true, 4: true };
current = snapshot();
assert.strictEqual(current.slots[2].classification, 'resident');
assert.strictEqual(current.slots[4].classification, 'resident');

// A settled authoritative refresh supersedes the old local projection.
context.window._nsPrefetchDirty = false;
context.window._nsPrefetchDirtySlots = {};
context.window._nsState = {
    namespaceFingerprint: 'fixture-b',
    abstractions: [
        { slot: 2, load_policy: 'Lazy' },
        { slot: 3, load_policy: 'Lazy' },
        { slot: 4, load_policy: 'Empty' },
    ],
};
current = snapshot();
assert.strictEqual(current.slots[2].classification, 'lazy');
assert.strictEqual(current.slots[3].classification, 'lazy');
assert.strictEqual(current.slots[4].classification, 'free');

// Clear/reissue transition: the retained generation is Garbage, then an
// occupied reissue removes it and follows authoritative Resident policy.
entries.delete(3);
context.sim._nsFreeSequences[3] = 8;
current = snapshot();
assert.strictEqual(current.slots[3].classification, 'garbage');
entries.set(3, { label: 'Ethernet', word0_location: 700 });
delete context.sim._nsFreeSequences[3];
context.window._nsState.abstractions =
    context.window._nsState.abstractions.map(row =>
        row.slot === 3 ? { slot: 3, load_policy: 'Resident' } : row);
current = snapshot();
assert.strictEqual(current.slots[3].classification, 'resident');

console.log('namespace summary counts: 18 assertions passed');