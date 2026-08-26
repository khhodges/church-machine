'use strict';
// Regression coverage for the Save to Namespace replacement-slot picker.
// Run: node simulator/test_save_ns_slot_picker.js

const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('simulator/app-run.js', 'utf8');
const start = source.indexOf('function _collectSaveNamespaceSlotCandidates(');
const end = source.indexOf('\nfunction _currentSaveNamespaceLumpName()', start);
if (start < 0 || end < 0) {
    throw new Error('Could not locate _collectSaveNamespaceSlotCandidates in app-run.js');
}

const sandbox = {};
vm.runInNewContext(source.slice(start, end), sandbox);
const collect = sandbox._collectSaveNamespaceSlotCandidates;

let passed = 0;
function check(label, condition) {
    if (!condition) throw new Error(`FAIL: ${label}`);
    console.log(`PASS: ${label}`);
    passed++;
}

const liveSlots = new Map([
    [12, { label: 'Live Release' }],
    [14, { label: 'Live Wins' }],
]);
const sim = {
    MAX_NS_ENTRIES: 32,
    nsCount: 11, // A boot image that has no user slots in its stored count.
    firstUserNsSlot: () => 11,
    readNSEntry: slot => liveSlots.get(slot) || null,
};

const result = collect(
    sim,
    [
        { ns_slot: 6, abstraction: 'SelfTest' },       // protected factory slot
        { ns_slot: 13, abstraction: 'Catalog Release' },
        { ns_slot: 14, abstraction: 'Catalog Loses' }, // live entry wins
        { ns_slot: '16', abstraction: 'String Slot' },
        { ns_slot: null, abstraction: 'Dynamic Only' },
    ],
    {
        15: 'Persisted Release',
        14: 'Persisted Loses',
        6: 'Protected SelfTest',
    }
);

check('finds a live user slot above stale nsCount',
    result.some(entry => entry.slot === 12 && entry.label === 'Live Release'));
check('includes a catalog-backed existing user slot',
    result.some(entry => entry.slot === 13 && entry.label === 'Catalog Release'));
check('includes a persisted slot-label record',
    result.some(entry => entry.slot === 15 && entry.label === 'Persisted Release'));
check('accepts numeric server slot metadata', 
    result.some(entry => entry.slot === 16 && entry.label === 'String Slot'));
check('live namespace label takes precedence over saved metadata',
    result.some(entry => entry.slot === 14 && entry.label === 'Live Wins'));
check('does not expose protected system slots',
    !result.some(entry => entry.slot === 6));
check('sorts slots numerically',
    result.map(entry => entry.slot).join(',') === '12,13,14,15,16');

console.log(`\n${passed} picker checks passed`);