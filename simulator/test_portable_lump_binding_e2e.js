'use strict';

// Browser/simulator installation path: the importer must link against the
// live Namespace identity registry, never a binding_candidates sidecar.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ChurchSimulator = require('./simulator.js');
const Binding = require('./portable_lump_binding.js');

const HASH = 'a'.repeat(64);
const ID = 'b'.repeat(64);
const appMemory = fs.readFileSync(path.join(__dirname, 'app-memory.js'), 'utf8');
const normalizeStart = appMemory.indexOf('function _normalizeLumpCatalogEntries(');
const normalizeEnd = appMemory.indexOf('\nlet _bdLimits', normalizeStart);
const catalogSandbox = {};
vm.createContext(catalogSandbox);
vm.runInContext(appMemory.slice(normalizeStart, normalizeEnd), catalogSandbox);
const catalogEntry = catalogSandbox._normalizeLumpCatalogEntries([{
    dot_name: 'church.Audit', issue_n: 3,
    identity_hash: ID, binary_hash: HASH, cache_token: 'a1b2c3d4',
    grants: ['L', 'S'], capability_type: 1, authorized: true,
}])[0];
const sim = new ChurchSimulator();
const dependencySlot = 40;
sim.registerSlotIdentity(dependencySlot, {
    ...catalogEntry,
}, { secure: true });
assert.equal(sim.getSlotIdentity(dependencySlot).cacheToken, 0xa1b2c3d4,
    'normal catalog cache token propagates into verified identity');
sim.withNamespaceWrite('portable binding E2E fixture', () => {
    sim.writeNSEntry(dependencySlot, 0x0200, 8, 0, 0, 1, 4, 0, 0xa1b2c3d4);
});

const words = new Uint32Array(64);
words[0] = sim.packLumpHeader(0, 1, 2, 0);
words[1] = 0; // NOP
words[62] = ChurchSimulator.SELF_CAPABILITY_PLACEHOLDER;
const contract = Binding.createContract('alice.Bank#7', [
    { name: '__SELF__', compiler_owned_self: true, rights: 'E', type: 'Inform' },
    { N: 'church.Audit#3', T: 'a1b2c3d4', binary_hash: HASH, identity_hash: ID,
        rights: 'L', type: 'Inform', relocation_row: 1 },
]);
const owner = { N: 'alice.Bank#7', binary_hash: 'c'.repeat(64),
    identity_hash: 'd'.repeat(64), verified: true };
assert.equal(sim.loadLumpBinary(words, 41, {
    portableBinding: contract, portableOwnerCandidate: owner,
    // Must be ignored: only the registered/live dependency is eligible.
    bindingCandidates: [{ N: 'church.Audit#3', T: 'a1b2c3d4', binary_hash: HASH,
        identity_hash: ID, rights: 'L', type: 'Inform', ns_slot: 99, sequence: 0, verified: true }],
}), true);
const installed = sim.memory[0x0400 + 63] >>> 0;
assert.equal(sim.parseGT(installed).index, dependencySlot);

// Removing the live registry record makes the same sidecar claim unusable.
const sim2 = new ChurchSimulator();
assert.equal(sim2.loadLumpBinary(words, 41, {
    portableBinding: contract, portableOwnerCandidate: owner,
    bindingCandidates: [{ N: 'church.Audit#3', T: 'a1b2c3d4', binary_hash: HASH,
        identity_hash: ID, rights: 'L', type: 'Inform', ns_slot: dependencySlot, sequence: 4, verified: true }],
}), false);

console.log('portable LUMP binding end-to-end tests passed');