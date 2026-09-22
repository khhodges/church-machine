'use strict';

// Runtime VM coverage for the Namespace-only boot authority bridge. These
// tests execute the production helper functions with transport doubles; they
// do not mock the marker decision itself or read/write live artifacts.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const abstractions = fs.readFileSync(
    path.join(__dirname, 'app-abstractions.js'), 'utf8');
const memory = fs.readFileSync(
    path.join(__dirname, 'app-memory.js'), 'utf8');

function extract(source, name) {
    const functionStart = source.indexOf(`function ${name}(`);
    assert.notStrictEqual(functionStart, -1, `${name} not found`);
    const asyncPrefix = source.lastIndexOf('async ', functionStart);
    const start = asyncPrefix >= 0 &&
        source.slice(asyncPrefix, functionStart) === 'async '
        ? asyncPrefix : functionStart;
    const next = [
        source.indexOf('\nfunction ', start + 1),
        source.indexOf('\nasync function ', start + 1),
        source.indexOf('\n(function ', start + 1),
    ].filter(index => index >= 0);
    const end = next.length ? Math.min(...next) : source.length;
    return source.slice(start, end).trim();
}

const markerSource = [
    'let bootEntrySlot = null;',
    'let _bootEntrySelectionRevision = 0;',
    'let _namespaceBootMarkerInFlight = null;',
    "let _preparedArtifactSelection = { selection: { slot: 10, revision: 7 }, artifact: { token: 'selected-token', filename: 'Selected.lump' } };",
    extract(abstractions, '_namespaceResponseError'),
    extract(abstractions, '_namespaceStateForMutation'),
    extract(abstractions, '_applyNamespaceBootProjection'),
    extract(abstractions, '_commitNamespaceBootMarker'),
].join('\n');

async function runMarker(fetchImpl, initialState) {
    const calls = [];
    const context = {
        window: {
            _nsState: initialState,
            BuildApprovalView: { _authHeaders: () => ({}) },
        },
        localStorage: {
            getItem: key => key === 'bootEntrySlot' ? '2' : null,
            setItem: () => { throw new Error('boot slot must not use browser storage'); },
        },
        fetch: async (url, options) => {
            calls.push({ url, options });
            return fetchImpl(url, options);
        },
        sim: {
            _bootImageLoaded: true,
            inspectBootEntryBinding: () => ({ targetSlot: 6 }),
        },
        _setBootEntryPreparation: () => {},
        updateNamespace: () => {},
        renderAbstractions: () => {},
        Number, String, Object, Error, JSON, Promise,
    };
    vm.runInNewContext(
        `${markerSource}\nresult = _commitNamespaceBootMarker(10);\n` +
        'result.then(() => { observedSlot = bootEntrySlot; }).catch(() => {});',
        context);
    return { value: context.result, context, calls };
}

async function main() {
    const initial = {
        namespaceFingerprint: 'fp-old',
        abstractions: [
            { name: 'CapabilityTest', slot: 10, boot: false },
            { name: 'SelfTest', slot: 6, boot: true },
        ],
    };

    const success = await runMarker(async (_url, options) => {
        assert.strictEqual(options.method, 'POST');
        const body = JSON.parse(options.body);
        assert.deepStrictEqual(body, {
            slot: 10,
            revision: 7,
            token: 'selected-token',
            filename: 'Selected.lump',
            namespaceFingerprint: 'fp-old',
        });
        return {
            ok: true,
            status: 200,
            json: async () => ({
                ok: true,
                slot: 10,
                namespaceFingerprint: 'fp-new',
            }),
        };
    }, initial);
    const successResult = await success.value;
    assert.strictEqual(successResult.namespaceFingerprint, 'fp-new');
    assert.strictEqual(success.context.window._nsState.namespaceFingerprint, 'fp-new');
    assert.strictEqual(
        success.context.window._nsState.abstractions.find(row => row.slot === 10).boot,
        true);
    assert.strictEqual(
        success.context.window._nsState.abstractions.find(row => row.slot === 6).boot,
        false);
    assert.strictEqual(success.context.observedSlot, 10,
        'the legacy bootEntrySlot localStorage value must not override Namespace');

    const rejected = await runMarker(async (_url, _options) => ({
        ok: false,
        status: 409,
        json: async () => ({
            ok: false,
            error: 'Namespace target is not resident',
            dataChanged: false,
        }),
    }), initial);
    await assert.rejects(rejected.value, /Namespace .*failed/);
    assert.strictEqual(rejected.context.window._nsState, initial,
        'rejected marker must not update the local Namespace projection');

    const stale = await runMarker(async (_url, _options) => ({
        ok: false,
        status: 409,
        json: async () => ({
            ok: false,
            error: 'Namespace changed in another tab; reload before changing the boot marker',
            currentNamespaceFingerprint: 'fp-concurrent',
            dataChanged: false,
        }),
    }), initial);
    await assert.rejects(stale.value, /Namespace changed in another tab/);
    assert.strictEqual(stale.context.window._nsState.namespaceFingerprint, 'fp-old',
        'stale CAS rejection must retain the inspected snapshot');

    const policyContext = {
        window: {
            _nsState: {
                abstractions: [{
                    slot: 10,
                    resident: true,
                    boot_resident: true,
                    load_policy: 'Resident',
                }],
                namespaceFingerprint: 'fp-policy',
            },
            bootConfig: {
                step2: { lumps: [{ nsSlot: 10, loadPolicy: 'Lazy' }] },
            },
            _nsPrefetchDirty: false,
        },
        _nsSlotHasResidentThreadBody: () => false,
        Number, Array, String, Object,
    };
    vm.runInNewContext(
        `${extract(memory, '_nsSavedLoadPolicy')}\n` +
        'policy = _nsSavedLoadPolicy(10, null);',
        policyContext);
    assert.strictEqual(policyContext.policy, 'Resident',
        'authoritative Namespace policy must beat stale boot-config Lazy');

    const saveStart = memory.indexOf('window._nsTableSave = async function(btn)');
    const saveEnd = memory.indexOf('\n};', saveStart) + 3;
    const saveSource = memory.slice(saveStart, saveEnd);
    const saveCalls = [];
    const saveState = {
        namespaceFingerprint: 'fp-save',
        abstractions: [{
            name: 'CapabilityTest', slot: 6, seq: 0, boot: true,
            token: 'stale-token',
            filename: 'CapabilityTest.archived.lump',
            binary_hash: 'a'.repeat(64), load_policy: 'Resident',
            resident: true, boot_resident: true,
        }],
    };
    const selectedHash = 'b'.repeat(64);
    const saveContext = {
        window: {
            _nsState: saveState,
            _nsTableSaveError: null,
            _nsTableDirty: false,
            bootImage: new ArrayBuffer(8),
            bootImageAvailable: true,
            BootEntryUI: { get: () => ({ status: 'prepared', slot: 6 }) },
            LumpSaveDiagnostics: null,
            _refreshCommittedBootImageCache: async () => {},
            _applyNamespaceBootProjection: () => {},
            _nsExplicitArtifactBindings: {
                6: {
                    name: 'CapabilityTest',
                    slot: 6,
                    seq: 0,
                    token: 'selected-token',
                    filename: 'CapabilityTest.selected.lump',
                    binary_hash: selectedHash,
                    load_policy: 'Resident',
                    resident: true,
                    boot_resident: true,
                },
            },
        },
        // Misleading catalog variants are deliberately visible in the VM. The
        // save payload must use the committed/staged Namespace selection only.
        _lumpsCache: [
            {
                abstraction: 'CapabilityTest',
                token: 'selected-token',
                filename: 'CapabilityTest.archived-same-token.lump',
                binary_hash: 'c'.repeat(64),
                archived: true,
            },
            {
                abstraction: 'CapabilityTest',
                token: 'different-token',
                filename: 'CapabilityTest.newer.lump',
                binary_hash: 'd'.repeat(64),
            },
            {
                abstraction: 'AbsentFromNamespace',
                token: 'absent-token',
                filename: 'AbsentFromNamespace.lump',
                binary_hash: 'e'.repeat(64),
            },
        ],
        bootEntrySlot: 6,
        sim: {
            _bootImageLoaded: true,
            NS_TABLE_BASE: 10,
            NS_TABLE_RESERVE: 10,
            NS_ENTRY_WORDS: 4,
            MAX_NS_ENTRIES: 7,
            nsCount: 7,
            memory: new Uint32Array(64),
            nsLabels: ['(free)', '(free)', '(free)', '(free)', '(free)', '(free)',
                'CapabilityTest'],
            inspectBootEntryBinding: () => ({ targetSlot: 6 }),
            snapshotPersistentMemory: () => new Uint32Array(20),
            readNSEntry: slot => slot === 6 ? ({
                word0_location: 0x100,
                word1_limit: 0x20000001,
                word2_seals: 0x1234,
                gtType: 1,
            }) : null,
            parseNSWord1: () => ({ gtSeq: 0, limit: 1, f: 0, g: 0 }),
            makeVersionSeals: () => 0x1234,
            symbolicEntryAt: () => null,
        },
        fetch: async (url, options) => {
            saveCalls.push({ url, options });
            if (url === '/api/boot-image/save-ns') {
                return {
                    ok: true, status: 200,
                    json: async () => ({ ok: true }),
                };
            }
            if (url === '/api/boot-image/ns-state') {
                return {
                    ok: true, status: 200,
                    json: async () => Object.assign({}, saveState, {
                        namespaceFingerprint: 'fp-after-save',
                    }),
                };
            }
            throw new Error(`unexpected fetch ${url}`);
        },
        _actionableJsonResponse: async (response) => response.json(),
        _setNsDirty: () => {},
        btoa: value => Buffer.from(value, 'binary').toString('base64'),
        Uint8Array, Uint32Array, ArrayBuffer, Number, String, Object, JSON,
        Promise, Error, Map, Math,
    };
    vm.runInNewContext(
        `${extract(memory, '_nsInheritSavedArtifactMetadata')}\n` +
        `${extract(memory, '_nsApplyArtifactBindingForSave')}\n${saveSource}\n` +
        'result = window._nsTableSave();', saveContext);
    assert.strictEqual(await saveContext.result, true);
    assert.ok(!saveCalls.some(call => call.url === '/api/namespace/boot-marker'),
        'save payload regression must exercise save-ns directly, not be masked by marker rejection');
    const saveCall = saveCalls.find(call => call.url === '/api/boot-image/save-ns');
    assert.ok(saveCall, 'Namespace save endpoint was called');
    const savePayload = JSON.parse(saveCall.options.body);
    assert.strictEqual(savePayload.namespaceFingerprint, 'fp-save');
    assert.strictEqual(savePayload.ns_state.abstractions[0].token, 'selected-token');
    assert.strictEqual(
        savePayload.ns_state.abstractions[0].filename,
        'CapabilityTest.selected.lump');
    assert.strictEqual(
        savePayload.ns_state.abstractions[0].binary_hash,
        selectedHash);
    assert.strictEqual(savePayload.ns_state.abstractions[0].slot, 6);
    assert.strictEqual(savePayload.ns_state.abstractions[0].seq, 0);
    assert.strictEqual(savePayload.ns_state.abstractions[0].load_policy, 'Resident');
    assert.strictEqual(savePayload.ns_state.abstractions[0].boot, true);
    assert.strictEqual(savePayload.boot_config, null,
        'boot-config must not be a competing boot-plan authority');

    console.log('Namespace boot authority runtime checks passed.');
}

main().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
