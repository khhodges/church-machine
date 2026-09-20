'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const memory = fs.readFileSync(__dirname + '/app-memory.js', 'utf8');
const abstractions = fs.readFileSync(__dirname + '/app-abstractions.js', 'utf8');
const runSource = fs.readFileSync(__dirname + '/app-run.js', 'utf8');
assert.match(memory, /Promise\.resolve\(_openBootExecutionUpdate\(\)\)[\s\S]*\.finally\(function\(\)/);
assert.match(memory,
    /actionButton\.disabled = internalFailure;[\s\S]*Reload Namespace before retrying/);
assert.match(abstractions,
    /const pendingArtifactPins = Object\.freeze\([\s\S]*artifactPins: pendingArtifactPins/);
assert.match(abstractions,
    /JSON\.stringify\(live\[slot\]\)[\s\S]*JSON\.stringify\(pendingArtifactPins\[slot\]\)/);
assert.ok(abstractions.indexOf('const pendingArtifactPins') >
    abstractions.indexOf('async function savePreparedBootEntry'),
    'pending pins are declared inside the full preparation transaction');
assert.ok(abstractions.indexOf('const pendingArtifactPins') <
    abstractions.indexOf('const state = await _namespaceStateForMutation()',
        abstractions.indexOf('async function savePreparedBootEntry')),
    'pending pins are snapshotted before preparation awaits');

function extract(name, endMarker) {
    const start = memory.indexOf('function ' + name);
    const end = memory.indexOf(endMarker, start);
    if (start < 0 || end < 0) throw new Error('missing ' + name);
    return memory.slice(start, end);
}

// Namespace per-row pin intent is an exact immutable descriptor and remains
// pending until Prepare/Run submits it.
const pinContext = {
    window: {
        _prepareRunArtifactPins: {},
        _nsState: { abstractions: [{
            slot: 7, filename: 'WukongCallHome.1.658e6ba8.lump',
            token: '4a000007', lump_version: 11,
        }] },
    },
};
vm.createContext(pinContext);
vm.runInContext(extract('_nsPreparePinChange',
    'window._nsPreparePinChange = _nsPreparePinChange;'), pinContext);
assert.strictEqual(pinContext._nsPreparePinChange(7, true), true);
assert.deepStrictEqual(
    JSON.parse(JSON.stringify(pinContext.window._prepareRunArtifactPins['7'])),
    {
        filename: 'WukongCallHome.1.658e6ba8.lump',
        token: '4a000007',
        revision: 11,
    });
assert.strictEqual(pinContext._nsPreparePinChange(7, false), true);
assert.strictEqual(pinContext.window._prepareRunArtifactPins['7'], null);

// The banner action awaits Prepare/Run and surfaces its actual rejection.
const status = { textContent: '' };
const button = { disabled: false, textContent: '' };
const actionStart = memory.lastIndexOf('async function _openBootExecutionUpdate');
const actionEnd = memory.indexOf(
    'window._openBootExecutionUpdate = _openBootExecutionUpdate;', actionStart);
const actionContext = {
    window: {
        _bootExecutionRepairTarget: { failedSave: false, token: 'latest' },
        prepareAndRunSavedArtifact: async () => {
            throw new Error('Namespace changed in another tab (409)');
        },
    },
    document: {
        getElementById(id) {
            return id === 'bootExecutionUpdateStatus' ? status :
                (id === 'bootExecutionUpdateButton' ? button : null);
        },
    },
    Error,
};
vm.createContext(actionContext);
vm.runInContext(memory.slice(actionStart, actionEnd), actionContext);

function saveFunctionSource() {
    const start = abstractions.indexOf('async function savePreparedBootEntry()');
    const end = abstractions.indexOf(
        'window.savePreparedBootEntry = savePreparedBootEntry;', start);
    assert(start >= 0 && end > start, 'full savePreparedBootEntry function exists');
    return abstractions.slice(start, end);
}

function makePrepareContext(options) {
    const state = {
        namespaceFingerprint: 'before',
        abstractions: [{ slot: 7, boot: true, filename: 'boot.lump',
            token: 'old-token', lump_version: 3 }],
    };
    const pin = { filename: 'worker.lump', token: 'pin-before', revision: 4 };
    const calls = { preparation: [], renders: 0, fetchBody: null };
    const context = {
        window: {
            _prepareRunArtifactPins: { 9: pin },
            _refreshCommittedBootImageCache: async () => true,
            BootEntryUI: {
                noteImagePreparation(value) { calls.note = value; },
            },
        },
        document: {
            getElementById() { return null; },
        },
        bootEntrySlot: 7,
        _bootEntrySelectionRevision: 2,
        _preparedArtifactSelection: null,
        _setBootEntryPreparation(slot, status, message) {
            calls.preparation.push({ slot, status, message });
        },
        renderAbstractions() { calls.renders++; },
        async _namespaceStateForMutation() {
            // A real await boundary may permit checkbox edits. The transaction
            // must retain its own descriptor, not this subsequently edited one.
            pin.token = 'pin-edited-during-await';
            return state;
        },
        async fetch(url, request) {
            calls.fetchBody = JSON.parse(request.body);
            return {
                ok: options.ok,
                status: options.ok ? 200 : 409,
                async json() {
                    return options.ok ? {
                        ok: true,
                        namespaceFingerprint: 'after',
                        selections: [],
                        preparation: { status: 'prepared', configuredSlot: 7 },
                    } : { error: 'Namespace changed in another tab' };
                },
            };
        },
        _namespaceResponseError(action, response, body) {
            const error = new Error(action + ': ' + body.error);
            error.status = response.status;
            return error;
        },
        _bootEntryMessage(error, fallback) {
            return error && error.message ? error.message : fallback;
        },
        _applyNamespaceBootProjection() {},
        updateNamespace() {},
        Error,
        Object,
        JSON,
    };
    vm.createContext(context);
    vm.runInContext(saveFunctionSource(), context);
    return { context, calls, pin };
}

function createElement(tag) {
    return {
        tag,
        children: [],
        textContent: '',
        append(...items) { this.children.push(...items); },
        appendChild(item) { this.children.push(item); return item; },
        remove() { this.removed = true; },
        addEventListener() {},
    };
}

function allText(node) {
    return [node.textContent || ''].concat(
        (node.children || []).map(allText)).join(' ');
}

function modalFunctionsSource() {
    const start = runSource.indexOf('function _isInternalPreparationError(');
    const end = runSource.indexOf(
        'function _blockBootForMissingCommittedImage(', start);
    assert(start >= 0 && end > start, 'boot preparation modal functions exist');
    return runSource.slice(start, end);
}

(async () => {
    // Execute the complete production preparation function. No test global or
    // helper supplies pendingArtifactPins: this catches its former scope bug.
    const success = makePrepareContext({ ok: true });
    assert.strictEqual(await success.context.savePreparedBootEntry(), true);
    assert.deepStrictEqual(success.calls.fetchBody.artifactPins['9'], {
        filename: 'worker.lump', token: 'pin-before', revision: 4,
    });
    assert.strictEqual(success.context.window._prepareRunArtifactPins['9'],
        success.pin, 'an edit made in flight remains pending');
    assert.strictEqual(success.context.window._lastPrepareRunError, undefined);

    const rejected = makePrepareContext({ ok: false });
    assert.strictEqual(await rejected.context.savePreparedBootEntry(), false);
    assert.match(rejected.context.window._lastPrepareRunError.message,
        /Namespace changed in another tab/);
    assert.strictEqual(
        rejected.calls.preparation[rejected.calls.preparation.length - 1].status,
        'error');
    assert.deepStrictEqual(rejected.calls.fetchBody.artifactPins['9'], {
        filename: 'worker.lump', token: 'pin-before', revision: 4,
    });

    await assert.rejects(
        () => actionContext._openBootExecutionUpdate(),
        /Namespace changed in another tab \(409\)/);
    assert.notStrictEqual(status.textContent, 'Prepare/Run started.');

    const modalDocument = {
        body: createElement('body'),
        getElementById() { return null; },
        createElement,
    };
    const modalContext = {
        document: modalDocument,
        ReferenceError,
        TypeError,
        SyntaxError,
    };
    vm.createContext(modalContext);
    vm.runInContext(modalFunctionsSource(), modalContext);
    modalContext._showBootPreparationBlocked(
        'Run', new ReferenceError('pendingArtifactPins is not defined'));
    const internalText = allText(modalDocument.body.children[0]);
    assert.match(internalText, /IDE Boot Preparation Failure/);
    assert.match(internalText, /preparation commit state could not be confirmed/i);
    assert.match(internalText, /not a Thread fault, validation error, or security-policy rejection/);
    assert.doesNotMatch(internalText, /Choose the intended Lightning Bolt target/);
    assert.doesNotMatch(internalText, /Prepare boot image/);

    modalDocument.body.children.length = 0;
    modalContext._showBootPreparationBlocked(
        'Run', 'Choose a valid Namespace slot (0–255).');
    const validationText = allText(modalDocument.body.children[0]);
    assert.match(validationText, /Boot Preparation Blocked/);
    assert.match(validationText, /Choose the intended Lightning Bolt target/);
    assert.match(validationText, /Prepare boot image/);
    console.log('prepare/run UI function tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});