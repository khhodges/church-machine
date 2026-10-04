#!/usr/bin/env node
'use strict';

// Ordinary Namespace Save is not an image build or a simulator activation.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, 'app-memory.js'), 'utf8');
const saveCode = source.slice(source.indexOf('function _nsTableRowsForSave(state)'),
    source.indexOf('// ── NS label click'));
const clone = value => JSON.parse(JSON.stringify(value));
const originalRows = [
    {slot: 12, name: 'Thread.3', location: '0x00001290', limit: '0x000FF',
        seq: 0, seal: '0x12345678', type: 'Inform', f: 0, g: 0, resident: true},
    {slot: 14, name: 'Alice', filename: 'Alice.exact.lump', binary_hash: 'a'.repeat(64),
        token: '01234567', lump_version: 2, location: '0x400', limit: '0x9',
        seq: 0, seal: '0xDEAE9EEF', type: 'Inform', resident: true,
        load_policy: 'Resident', extraMetadata: {preserve: ['all', 'fields']}},
];
function harness() {
    const calls = [];
    const note = {textContent: ''};
    const win = {
        _nsState: {namespaceFingerprint: 'reviewed-fingerprint',
            abstractions: clone(originalRows), savedAbstractions: clone(originalRows)},
        _nsTableSaveError: null, _nsTableDirty: true,
        _nsExplicitArtifactBindings: {}, _nsDraftAssignments: {},
        _nsPrefetchDirtySlots: {}, bootImage: new Uint8Array([1, 2, 3]),
        bootConfig: {untouched: true},
    };
    const sim = {
        memory: new Uint32Array([4, 5, 6]),
        readNSEntry() { throw new Error('Untouched saved rows must not read execution memory'); },
        prepareBootEntry() { throw new Error('Save must not prepare execution'); },
        snapshotPersistentMemory() { throw new Error('Save must not capture an image'); },
    };
    const context = {
        window: win, sim, document: {getElementById() { return note; }},
        _setNsDirty(value) { win._nsTableDirty = value; },
        async _actionableJsonResponse(response) {
            if (response.error) throw response.error;
            return response.data;
        },
        async fetch(url, options) {
            if (url === '/api/namespace/review-upgrades') {
                if (context.checkError) return {error: context.checkError};
                if (context.onCheck) await context.onCheck();
                return {data: context.report || {upgrades: [], reviewFingerprint: 'fresh-catalog'}};
            }
            calls.push({url, options});
            const payload = JSON.parse(options.body);
            if (context.onFetch) await context.onFetch(payload);
            if (context.error) return {error: context.error};
            return {data: {ok: true, abstractions: payload.ns_state.abstractions,
                savedAbstractions: payload.ns_state.abstractions,
                namespaceFingerprint: 'committed-fingerprint', imageRebuilt: false,
                imageStatus: 'not-rebuilt'}};
        },
    };
    vm.createContext(context);
    vm.runInContext(saveCode, context);
    return {win, sim, calls, context, note};
}

(async function() {
    let h = harness();
    const stateBefore = clone(h.win._nsState);
    const imageBefore = h.win.bootImage;
    const memoryBefore = h.sim.memory;
    const configBefore = clone(h.win.bootConfig);
    assert.strictEqual(await h.win._nsTableSave(), true);
    assert.strictEqual(h.calls.length, 1, 'one protected transaction; no incidental GET/build/config requests');
    assert.strictEqual(h.calls[0].url, '/api/namespace/save-table');
    assert.deepStrictEqual(JSON.parse(h.calls[0].options.body), {
        namespaceFingerprint: stateBefore.namespaceFingerprint,
        ns_state: {abstractions: originalRows},
        upgradeReview: {draft: originalRows, reviewFingerprint: 'fresh-catalog', slots: []},
    });
    assert.strictEqual(h.win.bootImage, imageBefore);
    assert.strictEqual(h.sim.memory, memoryBefore);
    assert.deepStrictEqual(h.win.bootConfig, configBefore);
    assert.strictEqual(h.win._nsState.namespaceFingerprint, 'committed-fingerprint');
    assert.strictEqual(h.win._nsTableDirty, false);
    assert.match(h.note.textContent, /Built image, bitstream, and active simulation unchanged/);

    h = harness();
    h.win._nsPrefetchDirtySlots = {'14': true};
    h.win.bootConfig.step2 = {lumps: [{nsSlot: 14, loadPolicy: 'Lazy'}]};
    assert.strictEqual(await h.win._nsTableSave(), true);
    const changed = JSON.parse(h.calls[0].options.body).ns_state.abstractions;
    assert.deepStrictEqual(changed[0], originalRows[0], 'unrelated rows remain exact');
    assert.deepStrictEqual(changed[1], {...originalRows[1], resident: false, load_policy: 'Lazy'});

    h = harness();
    h.win._nsDraftAssignments = {'15': {name: 'Mallory', slot: 15}};
    const symbolic = {name: 'Mallory', slot: 15, seq: 4, symbolic: true,
        implementationMissing: true,
        selection: {status: 'unresolved', filename: 'Mallory.exact.lump',
            token: 'aabbccdd', binaryHash: 'b'.repeat(64), diagnostic: 'Design selection'}};
    h.sim.symbolicEntryAt = slot => slot === 15 ? symbolic : null;
    h.sim.readNSEntry = slot => {
        assert.strictEqual(slot, 15, 'only explicit draft descriptor may be read');
        return {word0_location: 0, word1_limit: 0, word2_seals: 987, gtType: 1};
    };
    h.sim.parseNSWord1 = () => ({f: 0, g: 0, limit: 0, gtSeq: 4});
    assert.strictEqual(await h.win._nsTableSave(), true);
    const draftRows = JSON.parse(h.calls[0].options.body).ns_state.abstractions;
    assert.deepStrictEqual(draftRows.slice(0, 2), originalRows);
    assert.deepStrictEqual(draftRows[2].selection, symbolic.selection);
    assert.strictEqual(draftRows[2].seal, '0x000003DB', 'no automatic resealing');
    assert.strictEqual(draftRows[2].resident, undefined, 'no inferred residency');

    h = harness();
    h.context.error = new Error('Namespace changed since review; reload');
    assert.strictEqual(await h.win._nsTableSave(), false);
    assert.strictEqual(h.calls.length, 1, 'stale state is not automatically refreshed or retried');
    assert.strictEqual(h.win._nsTableDirty, true);
    assert.strictEqual(h.win._nsState.namespaceFingerprint, 'reviewed-fingerprint');
    assert.match(h.win._nsTableSaveError, /changed since review/);

    h = harness();
    h.context.error = Object.assign(new Error('Cancelled'), {code: 'change_rejected'});
    assert.strictEqual(await h.win._nsTableSave(), false);
    assert.strictEqual(h.win._nsTableSaveCancelled, true);
    assert.strictEqual(h.win._nsTableDirty, true);
    assert.deepStrictEqual(h.win._nsState.abstractions, originalRows);

    h = harness();
    delete h.win._nsState.namespaceFingerprint;
    assert.strictEqual(await h.win._nsTableSave(), false);
    assert.strictEqual(h.calls.length, 0, 'missing reviewed fingerprint cannot authorize fresh-state save');

    h = harness();
    h.context.onFetch = async () => { h.win._nsTableRowEdits = {'14': {name: 'Later draft'}}; };
    assert.strictEqual(await h.win._nsTableSave(), true);
    assert.strictEqual(h.win._nsTableDirty, true, 'newer edits are not discarded by an older receipt');
    assert.strictEqual(h.win._nsState.abstractions[1].name, 'Later draft');
    assert.strictEqual(h.win._nsState.namespaceFingerprint, 'committed-fingerprint');
    assert.strictEqual(await h.win._nsTableSave(), true);
    assert.strictEqual(JSON.parse(h.calls[1].options.body).ns_state.abstractions[1].name, 'Later draft');

    h = harness();
    delete h.win._nsState.savedAbstractions[1].filename;
    delete h.win._nsState.savedAbstractions[1].token;
    h.win._nsState.abstractions[0].thread_layout = {size: 256, heap: 20};
    h.win._nsState.abstractions[0].displayOnly = true;
    h.win._nsTableRowEdits = {'12': {name: 'Explicit Thread label'}};
    const legacyBaseline = clone(h.win._nsState.savedAbstractions);
    assert.strictEqual(await h.win._nsTableSave(), true);
    const legacyRows = JSON.parse(h.calls[0].options.body).ns_state.abstractions;
    assert.deepStrictEqual(legacyRows, [{...legacyBaseline[0], name: 'Explicit Thread label'}, legacyBaseline[1]]);
    assert.strictEqual(legacyRows[1].filename, undefined);
    assert.strictEqual(legacyRows[1].token, undefined);
    assert.strictEqual(legacyRows[0].thread_layout, undefined);
    assert.strictEqual(legacyRows[0].displayOnly, undefined);

    h = harness();
    h.win._nsDeletedSlots = {'14': true};
    assert.strictEqual(await h.win._nsTableSave(), true);
    assert.deepStrictEqual(JSON.parse(h.calls[0].options.body).ns_state.abstractions, [originalRows[0]]);
    h = harness();
    delete h.win._nsState.savedAbstractions;
    assert.strictEqual(await h.win._nsTableSave(), false);
    assert.strictEqual(h.calls.length, 0, 'never fall back to an enriched projection');

    for (const message of [
        'NS[15] [0x400,0x500) overlaps NS[7] [0x110,0x510) (word addresses, full allocations)',
        'Namespace revision changed; review the current revision',
    ]) {
        h = harness();
        const draft = {slot: 15, name: 'PendingAdd', filename: 'Pending.exact.lump',
            token: '12345678', binary_hash: 'b'.repeat(64), resident: true,
            load_policy: 'Resident', location: '0x400', limit: '0x9',
            seq: 0, seal: '0x12345678', type: 'Inform', f: 0, g: 0};
        h.win._nsExplicitArtifactBindings = {'15': clone(draft)};
        h.context.error = new Error(message);
        const beforeState = clone(h.win._nsState);
        const beforeMemory = Array.from(h.sim.memory);
        assert.strictEqual(await h.win._nsTableSave(), false);
        assert.deepStrictEqual(h.win._nsExplicitArtifactBindings['15'], draft);
        assert.deepStrictEqual(h.win._nsState, beforeState);
        assert.deepStrictEqual(Array.from(h.sim.memory), beforeMemory);
        assert(h.note.textContent.includes(message), 'show exact conflicting slots and full ranges');
        assert(h.note.textContent.includes('draft is retained'));
        assert.strictEqual(h.calls.length, 1, 'no implicit retry or refreshed CAS');
        assert.deepStrictEqual(JSON.parse(h.calls[0].options.body).ns_state.abstractions.at(-1), draft);
    }
    for (const choices of [[14], [], null]) {
        h = harness();
        h.context.report = {reviewFingerprint: 'reviewed', upgrades: [{
            slot: 14, blocked: null,
            replacement: {...originalRows[1], lump_version: 3, token: 'abcdef01'},
        }]};
        h.context._nsChooseUpgrades = async () => choices;
        assert.strictEqual(await h.win._nsTableSave(), choices !== null);
        if (choices === null) {
            assert.strictEqual(h.calls.length, 0);
            assert.deepStrictEqual(h.win._nsState.savedAbstractions, originalRows);
        } else {
            const payload = JSON.parse(h.calls[0].options.body);
            assert.strictEqual(payload.ns_state.abstractions[1].lump_version,
                choices.length ? 3 : 2);
            assert.strictEqual(h.win._nsTableDirty, false);
        }
        assert.deepStrictEqual(Array.from(h.sim.memory), [4, 5, 6]);
    }
    h = harness();
    h.context.checkError = new Error('Catalog unavailable');
    assert.strictEqual(await h.win._nsTableSave(), false);
    assert.strictEqual(h.calls.length, 0);
    assert.match(h.note.textContent, /Catalog unavailable/);
    h = harness();
    h.context.onCheck = async () => { h.win._nsTableRowEdits = {'14': {name: 'Changed'}}; };
    assert.strictEqual(await h.win._nsTableSave(), false);
    assert.strictEqual(h.calls.length, 0);
    assert.match(h.note.textContent, /draft changed during review/);
    const addCode = source.slice(source.indexOf('function _nsTableAddConfirm()'),
        source.indexOf('// Explicit recovery for an unsaved executable Add'));
    for (const forbidden of ['sim.writePersistentWord(', 'sim.writeNSEntry(',
        'sim.registerSlotIdentity(', 'sim._tokenSlotMap.set(', 'sim.lazyManifest',
        'sim.allocOrFindNsSlot(', 'updateNamespace()']) {
        assert(!addCode.includes(forbidden), `Add must not optimistically mutate runtime: ${forbidden}`);
    }
    assert(addCode.includes("locationInput.value = '0x'"), 'retry retains proposed address');
    assert(addCode.includes('slotInputEl.value = String(slot)'), 'retry retains proposed slot');
    assert.ok(!saveCode.includes('generate:'));
    assert.ok(!saveCode.includes('data_b64'));
    assert.ok(!saveCode.includes('boot_config:'));
    assert.ok(!saveCode.includes('updateNamespace('), 'save must not invoke memory-hydrating redraw');
    assert.ok(!source.includes('Image evidence only; approved revision not verified — '));
    assert.ok(source.includes('Row geometry checked — '));
    assert.ok(source.includes('Built image is not verified against the saved Namespace revision.'));
    console.log('Namespace-only save: exact rows, isolation, policy edits, stale CAS, cancellation, and concurrent drafts PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });