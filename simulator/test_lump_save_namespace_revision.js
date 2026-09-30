'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync('simulator/app-lumps.js', 'utf8');
const start = source.indexOf('async function _freezeLumpSaveNamespaceRevision(');
const end = source.indexOf('async function _confirmLumpSavePlan(', start);
let calls = 0;
const context = { window: {}, fetch: async () => {
    calls++;
    return { ok: true, json: async () => ({
        namespaceFingerprint: `revision-${calls}`, abstractions: []
    }) };
} };
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
(async () => {
    const metadata = { ns_slot: 14 };
    await context._freezeLumpSaveNamespaceRevision(metadata);
    assert.strictEqual(metadata.namespaceFingerprint, 'revision-1');
    await context._freezeLumpSaveNamespaceRevision(metadata);
    assert.strictEqual(calls, 1, 'retry cannot refresh reviewed authority');
    await context._freezeLumpSaveNamespaceRevision({ ns_slot: null });
    assert.strictEqual(calls, 1, 'library-only save needs no Namespace lookup');
    const newEntry = { new_entry: true };
    await context._freezeLumpSaveNamespaceRevision(newEntry);
    assert.strictEqual(newEntry.namespaceFingerprint, 'revision-2');
    const promotion = { promotion_binding: { ns_slot: 14 } };
    await context._freezeLumpSaveNamespaceRevision(promotion);
    assert.strictEqual(promotion.namespaceFingerprint, 'revision-3');
    context.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(context._freezeLumpSaveNamespaceRevision({ ns_slot: 7 }), /503/);
    const run = fs.readFileSync('simulator/app-run.js', 'utf8');
    const reload = run.slice(run.indexOf('async function _reloadCommittedLumpArtifact('),
        run.indexOf('async function _refreshNamespaceAuthorityAfterLumpSave('));
    assert(!reload.includes('sim.loadLumpBinary'), 'save must not splice runtime bytes');
    assert(!reload.includes('sim.nsLabels'), 'save must not rename runtime slots');
    assert(run.includes('namespaceFingerprint: _saveNSNamespaceFingerprint'));
    console.log('Save Namespace revision and no-runtime-install checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });