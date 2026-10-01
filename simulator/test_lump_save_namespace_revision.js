'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync('simulator/app-lumps.js', 'utf8');
const start = source.indexOf('function _artifactOnlyLumpSaveMetadata(');
const end = source.indexOf('async function _confirmLumpSavePlan(', start);
const context = { window: {}, fetch: () => { throw new Error('No Namespace lookup permitted'); } };
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
const metadata = { abstraction: 'ide.Alice', ns_slot: 14, new_entry: true,
    namespaceFingerprint: 'old', namespace_sequence: 2, ns_slot_policy: 'dynamic',
    promotion_binding: { ns_slot: 14 }, resident: true, grants: ['E'],
    capability_type: 'inform', load_policy: 'Resident',
    editor_base: { token: 'old' }, compiler_record: { signed: 'opaque' } };
context._artifactOnlyLumpSaveMetadata(metadata);
assert.strictEqual(metadata.artifact_only, true);
for (const key of ['ns_slot', 'new_entry', 'namespaceFingerprint', 'namespace_sequence',
    'ns_slot_policy', 'promotion_binding', 'resident', 'grants', 'capability_type',
    'load_policy']) assert(!(key in metadata), key);
assert.strictEqual(metadata.editor_base.token, 'old');
assert.strictEqual(metadata.compiler_record.signed, 'opaque');
metadata.save_as_copy = true;
context._artifactOnlyLumpSaveMetadata(metadata);
assert.strictEqual(metadata.save_as_latest, false);
assert(!('editor_base' in metadata));
const run = fs.readFileSync('simulator/app-run.js', 'utf8');
const save = run.slice(run.indexOf('async function confirmSaveToNamespace()'),
    run.indexOf('function saveNamespace()'));
assert(!save.includes('_refreshNamespaceAuthorityAfterLumpSave()'));
assert(!save.includes('_acceptCommittedNamespaceSlotLabel(resp'));
assert(!save.includes('ns_slot:'));
assert(save.includes('_saveApproval.plan.portable_binding'));
assert(save.includes('rebuilt.metadata.portable_binding = plan.portable_binding'));
assert(source.includes('metadata.portable_binding = plan.portable_binding'));
assert(source.includes('target.compiler_record = plan.compiler_record'));
const reload = run.slice(run.indexOf('async function _reloadCommittedLumpArtifact('),
    run.indexOf('async function _refreshNamespaceAuthorityAfterLumpSave('));
assert(!reload.includes('sim.loadLumpBinary'));
assert(!reload.includes('sim.nsLabels'));
console.log('Artifact-only metadata, portable proof, and no-runtime-install checks passed');