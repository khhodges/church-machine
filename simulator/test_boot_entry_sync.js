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

// The reviewed identity is still exact, but NamespacePlan was superseded by
// the shared Namespace fingerprint and explicit artifact-selection transaction.
const marker = extract(abstractions, '_commitNamespaceBootMarker');
assert(marker.includes("fetch('/api/namespace/boot-marker'"));
for (const field of ['slot: target', 'revision:', 'token:', 'filename:',
    'namespaceFingerprint: fingerprint']) assert(marker.includes(field), field);
assert(marker.includes('if (!fingerprint)'));
assert(marker.includes('if (!response.ok || !body || body.ok !== true)'));

const prepare = extract(abstractions, 'setBootEntrySlot');
assert(prepare.includes('selectArtifactForPreparation('));
assert(prepare.includes('await _commitNamespaceBootMarker(idx)'));
assert(!prepare.includes('localStorage'));
assert(!prepare.includes('/api/boot-config'));

// Hardware remains an explicitly authorized destination, not a simulation
// startup fallback. Its delivery/ACK contract has dedicated behavioral tests.
const hardware = extract(runner, '_wukongLoadToHardware');
assert(hardware.includes("authorizeDestination('runtime')"));
assert(!hardware.includes('/api/boot-config'));

// A saved marker or shared image cache alone cannot activate a simulation.
// Exact image/provenance validation is tested by test_simulation_image_binding.
const hasImage = extract(runner, '_bootHasCommittedImage');
const context = {
    window: { bootImage: new ArrayBuffer(8), bootImageAvailable: true,
        NamespacePlan: { get: () => ({ plan: { slot: 2 } }) } },
    sim: { bootEntrySlot: 2 },
};
vm.createContext(context);
vm.runInContext(hasImage + '\nok = _bootHasCommittedImage();', context);
assert.equal(context.ok, false);
context.sim.simulationConfiguration = { configurationHash: 'approved-exact-inputs' };
context.sim._bootImageLoaded = true;
vm.runInContext('ok = _bootHasCommittedImage();', context);
assert.equal(context.ok, true);
context.sim._bootImageLoaded = false;
vm.runInContext('ok = _bootHasCommittedImage();', context);
assert.equal(context.ok, false);

console.log('PASS Namespace plan boot-entry synchronization checks passed');