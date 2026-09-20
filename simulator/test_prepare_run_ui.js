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
    abstractions.indexOf('let state = await _namespaceStateForMutation()',
        abstractions.indexOf('async function savePreparedBootEntry')),
    'pending pins are snapshotted before preparation awaits');
assert.match(runSource,
    /function _canPrepareSavedArtifactWhileIdle\(\)[\s\S]*!_simRunActive[\s\S]*!sim\.running[\s\S]*!sim\.walkActive/);
assert.match(runSource,
    /Promise\.resolve\(\)\.then\(function\(\)[\s\S]*_queueIdleArtifactReconciliation\(window\._nsState\)/);
assert.match(memory, /latest\.binaryHash \|\| ''/);
assert.match(memory,
    /state\.namespaceFingerprint[\s\S]*control\.attempted\[plan\.key\] = true/);

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

function retryHelpersSource() {
    const start = abstractions.indexOf('function _prepareRunRowPrecondition(');
    const end = abstractions.indexOf('function _applyNamespaceBootProjection(', start);
    assert(start >= 0 && end > start, 'Prepare/Run retry helpers exist');
    return abstractions.slice(start, end);
}

function makePrepareContext(options) {
    options = options || {};
    const state = {
        namespaceFingerprint: 'before',
        abstractions: [{ slot: 7, boot: true, filename: 'boot.lump',
            token: 'old-token', lump_version: 3 }],
    };
    const pin = { filename: 'worker.lump', token: 'pin-before', revision: 4 };
    const calls = {
        preparation: [], renders: 0, fetchBody: null, fetchBodies: [],
        refreshes: 0,
    };
    const responses = (options.responses || [{
        ok: options.ok,
        status: options.ok ? 200 : 409,
        body: options.ok ? {
            ok: true,
            namespaceFingerprint: 'after',
            selections: [],
            preparation: { status: 'prepared', configuredSlot: 7 },
        } : { error: 'Namespace changed in another tab' },
    }]).slice();
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
        async _namespaceStateForMutation(refresh) {
            // A real await boundary may permit checkbox edits. The transaction
            // must retain its own descriptor, not this subsequently edited one.
            pin.token = 'pin-edited-during-await';
            if (refresh) {
                calls.refreshes++;
                if (options.refreshError) throw options.refreshError;
                return options.refreshedState || Object.assign({}, state, {
                    namespaceFingerprint: 'refreshed',
                });
            }
            return state;
        },
        async fetch(url, request) {
            calls.fetchBody = JSON.parse(request.body);
            calls.fetchBodies.push(calls.fetchBody);
            if (options.transportError) throw options.transportError;
            const reply = responses.shift();
            return {
                ok: reply.ok,
                status: reply.status,
                async json() { return reply.body; },
            };
        },
        _namespaceResponseError(action, response, body) {
            const error = new Error(action + ': ' + body.error);
            error.status = response.status;
            error.body = body;
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
    vm.runInContext(retryHelpersSource() + saveFunctionSource(), context);
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

function reconciliationFunctionsSource() {
    const start = memory.indexOf(
        'window._idleArtifactReconciliation = window._idleArtifactReconciliation ||');
    const end = memory.indexOf('function _renderBootExecutionFreshness(', start);
    assert(start >= 0 && end > start, 'idle reconciliation functions exist');
    return memory.slice(start, end);
}

function makeReconciliationContext(options) {
    const calls = { prepare: 0, execute: 0 };
    const row = {
        slot: 7,
        filename: 'WukongCallHome.old.lump',
        token: '4a000007',
        lump_version: 1,
    };
    if (options.pinned) {
        row.artifact_pin = {
            filename: row.filename, token: row.token, revision: 1,
        };
    }
    const state = {
        namespaceFingerprint: 'cas-fingerprint',
        abstractions: [row],
        executionFreshness: {
            status: 'stale',
            warnings: [{
                slot: 7,
                abstraction: 'WukongCallHome',
                selected: { filename: row.filename, token: row.token, version: 1 },
                latest: {
                    filename: 'WukongCallHome.new.lump',
                    token: '4a000107',
                    version: 2,
                    binaryHash: 'sha256:new',
                },
            }],
        },
    };
    const context = {
        window: {
            _nsState: state,
            _prepareRunArtifactPins: {},
            _canPrepareSavedArtifactWhileIdle: () => options.idle,
            async prepareSavedArtifactForRun() {
                calls.prepare++;
                if (options.fail) throw new Error('CAS changed in another tab');
                // Preparation commits state only. An execution callback exists
                // solely to prove this path never invokes it.
                state.executionFreshness = { status: 'current', warnings: [] };
                return true;
            },
            executeProgram() { calls.execute++; },
        },
        _renderBootExecutionFreshness() {},
        Error,
        Promise,
        Object,
        Array,
        Number,
        String,
    };
    vm.createContext(context);
    vm.runInContext(reconciliationFunctionsSource(), context);
    return { context, calls, state };
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

    const conflict = {
        ok: false, status: 409, body: {
            ok: false,
            errorCode: 'NAMESPACE_FINGERPRINT_CONFLICT',
            error: 'Namespace changed in another tab',
            dataChanged: false, committed: false, safe_retry: true,
        },
    };
    const accepted = {
        ok: true, status: 200, body: {
            ok: true, namespaceFingerprint: 'after', selections: [],
            preparation: { status: 'prepared', configuredSlot: 7 },
        },
    };
    const recovered = makePrepareContext({ responses: [conflict, accepted] });
    assert.strictEqual(await recovered.context.savePreparedBootEntry(), true);
    assert.strictEqual(recovered.calls.fetchBodies.length, 2);
    assert.strictEqual(recovered.calls.refreshes, 1);
    assert.strictEqual(recovered.calls.fetchBodies[1].namespaceFingerprint, 'refreshed');
    assert.deepStrictEqual(recovered.calls.fetchBodies[1].artifactPins['9'], {
        filename: 'worker.lump', token: 'pin-before', revision: 4,
    }, 'retry preserves the immutable caller pin snapshot');

    const repeated = makePrepareContext({ responses: [conflict, conflict] });
    assert.strictEqual(await repeated.context.savePreparedBootEntry(), false);
    assert.strictEqual(repeated.calls.fetchBodies.length, 2,
        'a repeated safe CAS conflict is bounded to one retry');

    const validation = makePrepareContext({ responses: [{
        ok: false, status: 409, body: {
            errorCode: 'ARTIFACT_VALIDATION_FAILED',
            error: 'digest approval is missing',
            dataChanged: false, committed: false, safe_retry: true,
        },
    }] });
    assert.strictEqual(await validation.context.savePreparedBootEntry(), false);
    assert.strictEqual(validation.calls.fetchBodies.length, 1,
        'an arbitrary validation 409 is not replayed');
    assert.strictEqual(validation.calls.refreshes, 0);

    const refreshFailure = makePrepareContext({
        responses: [conflict],
        refreshError: new Error('authoritative refresh unavailable'),
    });
    assert.strictEqual(await refreshFailure.context.savePreparedBootEntry(), false);
    assert.strictEqual(refreshFailure.calls.fetchBodies.length, 1);

    const changedState = {
        namespaceFingerprint: 'other',
        abstractions: [
            { slot: 7, boot: false, name: 'DifferentOccupant',
                filename: 'different.lump', token: 'different', lump_version: 8 },
            { slot: 8, boot: true, name: 'OtherTarget',
                filename: 'other.lump', token: 'other', lump_version: 1 },
        ],
    };
    const changedTarget = makePrepareContext({
        responses: [conflict], refreshedState: changedState,
    });
    assert.strictEqual(await changedTarget.context.savePreparedBootEntry(), false);
    assert.strictEqual(changedTarget.calls.fetchBodies.length, 1,
        'a changed target or occupant is never overwritten by retry');
    assert.match(changedTarget.context.window._lastPrepareRunError.message,
        /target or exact-artifact pins changed/);

    const changedPinState = {
        namespaceFingerprint: 'other-pin',
        abstractions: [
            { slot: 7, boot: true, filename: 'boot.lump',
                token: 'old-token', lump_version: 3 },
            { slot: 9, name: 'Worker', filename: 'worker-new.lump',
                token: 'pin-from-other-tab', lump_version: 5,
                artifact_pin: {
                    filename: 'worker-new.lump',
                    token: 'pin-from-other-tab', revision: 5,
                } },
        ],
    };
    const changedPin = makePrepareContext({
        responses: [conflict], refreshedState: changedPinState,
    });
    assert.strictEqual(await changedPin.context.savePreparedBootEntry(), false);
    assert.strictEqual(changedPin.calls.fetchBodies.length, 1,
        'changed persisted pin authority is never silently overwritten');

    const unknownCommit = makePrepareContext({
        transportError: new Error('connection reset after upload'),
    });
    assert.strictEqual(await unknownCommit.context.savePreparedBootEntry(), false);
    assert.strictEqual(unknownCommit.calls.fetchBodies.length, 1,
        'ambiguous transport commit is never replayed');

    const shared = makePrepareContext({ responses: [accepted] });
    const sharedResults = await Promise.all([
        shared.context.savePreparedBootEntry(),
        shared.context.savePreparedBootEntry(),
    ]);
    assert.deepStrictEqual(sharedResults, [true, true]);
    assert.strictEqual(shared.calls.fetchBodies.length, 1,
        'all preparation entry points share one in-flight mutation');

    const idle = makeReconciliationContext({ idle: true });
    assert.strictEqual(idle.context._queueIdleArtifactReconciliation(idle.state), true);
    await idle.context.window._idleArtifactReconciliation.inFlight;
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(idle.calls.prepare, 1,
        'idle stale assignment uses exactly one preparation transaction');
    assert.strictEqual(idle.calls.execute, 0,
        'automatic reconciliation never executes the prepared artifact');
    assert.strictEqual(
        idle.context._queueIdleArtifactReconciliation(idle.state), false,
        'committed current state does not prepare again');

    const running = makeReconciliationContext({ idle: false });
    assert.strictEqual(
        running.context._queueIdleArtifactReconciliation(running.state), false,
        'active execution queues preparation for explicit Run');
    assert.strictEqual(running.calls.prepare, 0);

    const pinned = makeReconciliationContext({ idle: true, pinned: true });
    assert.strictEqual(
        pinned.context._queueIdleArtifactReconciliation(pinned.state), false,
        'exact pins are never automatically advanced');
    assert.strictEqual(pinned.calls.prepare, 0);

    const failed = makeReconciliationContext({ idle: true, fail: true });
    assert.strictEqual(failed.context._queueIdleArtifactReconciliation(failed.state), true);
    await failed.context.window._idleArtifactReconciliation.inFlight.catch(() => {});
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(
        failed.context._queueIdleArtifactReconciliation(failed.state), false,
        'the same CAS fingerprint and candidate identity is attempted once');
    assert.strictEqual(failed.calls.prepare, 1,
        'failure does not create a retry/render storm');

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

    modalDocument.body.children.length = 0;
    const casFailure = new Error('Namespace changed after the bounded retry.');
    casFailure.nextAction = 'Review the refreshed Namespace and retry only if intent still matches.';
    modalContext._showBootPreparationBlocked('Run', casFailure);
    const casText = allText(modalDocument.body.children[0]);
    assert.match(casText, /Review the refreshed Namespace/);
    assert.doesNotMatch(casText, /Choose the intended Lightning Bolt target/);

    const prepareAndRunStart = runSource.indexOf(
        'function prepareAndRunSavedArtifact(');
    const prepareAndRunEnd = runSource.indexOf(
        'window.prepareAndRunSavedArtifact = prepareAndRunSavedArtifact;',
        prepareAndRunStart);
    const explicitCalls = { prepare: 0, run: 0, modal: 0 };
    const explicitContext = {
        window: {
            async prepareSavedArtifactForRun() {
                explicitCalls.prepare++;
                throw new Error('final preparation rejection');
            },
            IDEActions: { run() { explicitCalls.run++; } },
        },
        _showBootPreparationBlocked() { explicitCalls.modal++; },
        Promise,
    };
    vm.createContext(explicitContext);
    vm.runInContext(
        runSource.slice(prepareAndRunStart, prepareAndRunEnd), explicitContext);
    assert.strictEqual(
        await explicitContext.prepareAndRunSavedArtifact(false), false);
    assert.deepStrictEqual(explicitCalls, { prepare: 1, run: 0, modal: 1 },
        'explicit Run cannot execute before successful preparation');
    console.log('prepare/run UI function tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});