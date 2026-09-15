'use strict';

// Task #3472 focused regression checks. Run: node simulator/test_boot_entry_sync.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const abstractions = fs.readFileSync(path.join(__dirname, 'app-abstractions.js'), 'utf8');
const memory = fs.readFileSync(path.join(__dirname, 'app-memory.js'), 'utf8');
const runner = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
const simulator = fs.readFileSync(path.join(__dirname, 'simulator.js'), 'utf8');

function extract(source, name) {
    const start = source.indexOf('function ' + name + '(');
    assert.notStrictEqual(start, -1, name + ' missing');
    const brace = source.indexOf('{', start);
    let depth = 0;
    for (let i = brace; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(name + ' unterminated');
}

// A plan identity is four fields, not just a slot. This prevents an old
// descriptor revision being selected after a concurrent Namespace change.
const planApiStart = memory.indexOf('window.NamespacePlan = (function()');
const planApiEnd = memory.indexOf('function _hydrateNsSymbolicState', planApiStart);
const planApi = memory.slice(planApiStart, planApiEnd);
assert(planApi.includes("['slot', 'seq', 'token', 'filename']"));
assert(planApi.includes('expected_revision: current.revision'));
assert(planApi.includes('response.status === 409'));
assert(planApi.includes('await load(true)'));
assert(planApi.includes('markers.length !== 1'));

const prepare = extract(abstractions, 'setBootEntrySlot');
assert(prepare.startsWith('async function'));
assert(prepare.includes('await window.NamespacePlan.choose('));
assert(!prepare.includes('localStorage'));
assert(!prepare.includes('/api/boot-config'));

const save = extract(abstractions, 'savePreparedBootEntry');
assert(save.includes("fetch('/api/boot-image/generate'"));
assert(!save.includes('/api/boot-config'));
assert(!save.includes('entrySlot'));

// The image loader refuses a known persisted-plan disagreement before it
// copies image words; imported bytes cannot silently become plan authority.
assert(simulator.includes('namespacePlan.assertImageSlot(discoveredBootEntrySlot)'));
assert(simulator.includes('Generate an image from the saved plan.'));

const hardware = extract(runner, '_wukongLoadToHardware');
assert(hardware.includes('await window.NamespacePlan.load()'));
assert(!hardware.includes('/api/boot-config'));
assert(!hardware.includes('entrySlot'));

// Default-entry boot guard needs both the persisted plan and matching image.
const hasImage = extract(runner, '_bootHasCommittedImage');
const context = {
    window: { bootImage: new ArrayBuffer(8), bootImageAvailable: true,
        NamespacePlan: { get: () => ({ plan: { slot: 2 } }) } },
    sim: { bootEntrySlot: 2 },
};
vm.createContext(context);
vm.runInContext(hasImage + '\nok = _bootHasCommittedImage();', context);
assert.equal(context.ok, true);
context.sim.bootEntrySlot = 7;
vm.runInContext('ok = _bootHasCommittedImage();', context);
assert.equal(context.ok, false);

console.log('PASS Namespace plan boot-entry synchronization checks passed');