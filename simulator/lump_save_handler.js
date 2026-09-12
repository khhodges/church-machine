'use strict';
// lump_save_handler.js — DOM-free handler for /api/lumps/save responses.
//
// Used by confirmSaveToNamespace() in app-run.js; exported for unit testing.
//
// All browser globals (_showFpgaToast, window, renderLumps) are accessed
// through typeof guards so the module loads cleanly in Node.js test harnesses.

if (typeof require === 'function' && typeof _formatActionableHttpError === 'undefined') {
    var _actionableErrors = require('./actionable_errors.js');
    var _formatActionableHttpError = _actionableErrors._formatActionableHttpError;
    var _formatActionableNetworkError = _actionableErrors._formatActionableNetworkError;
}
var _lumpSaveDiagnosticsInstance = null;
if (typeof require === 'function') {
    try {
        var _saveDiagnosticsModule = require('./save_diagnostics.js');
        var _lumpSaveDiagnosticsInstance = _saveDiagnosticsModule._saveDiagnostics;
    } catch (_) {
        var _lumpSaveDiagnosticsInstance = null;
    }
}
const _LUMP_SAVE_OPERATION_PREFIX = 'church.lump-save-operation:';
const _LUMP_SAVE_PENDING_PREFIX = 'church.lump-save-pending:';

function _lumpSaveDiagnosticsApi() {
    try {
        if (typeof window !== 'undefined' && window.LumpSaveDiagnostics) {
            return window.LumpSaveDiagnostics;
        }
        if (typeof globalThis !== 'undefined' && globalThis.LumpSaveDiagnostics &&
                globalThis.LumpSaveDiagnostics !== _lumpSaveDiagnosticsInstance) {
            return globalThis.LumpSaveDiagnostics;
        }
    } catch (_) {}
    if (_lumpSaveDiagnosticsInstance) return _lumpSaveDiagnosticsInstance;
    return null;
}

function _lumpSaveDiagnosticBegin(payload, entryPoint) {
    try {
        var diagnostics = _lumpSaveDiagnosticsApi();
        if (!diagnostics || !payload) return null;
        payload.metadata = payload.metadata &&
            typeof payload.metadata === 'object' ? payload.metadata : {};
        return diagnostics.begin(payload.metadata, entryPoint);
    } catch (_) {
        return null;
    }
}

function _lumpSaveDiagnosticEvent(payload, stage, event, values) {
    try {
        var diagnostics = _lumpSaveDiagnosticsApi();
        if (!diagnostics || !payload) return null;
        payload.metadata = payload.metadata &&
            typeof payload.metadata === 'object' ? payload.metadata : {};
        return diagnostics.record(payload.metadata, stage, event, values || {});
    } catch (_) {
        return null;
    }
}

function _lumpSaveDiagnosticStageStart(payload, stage, entryPoint, values) {
    try {
        var diagnostics = _lumpSaveDiagnosticsApi();
        if (!diagnostics || !payload) return null;
        payload.metadata = payload.metadata &&
            typeof payload.metadata === 'object' ? payload.metadata : {};
        return diagnostics.stageStart(payload.metadata, stage, entryPoint, values || {});
    } catch (_) {
        return null;
    }
}

function _lumpSaveDiagnosticStageComplete(payload, stage, outcome, values) {
    try {
        var diagnostics = _lumpSaveDiagnosticsApi();
        if (!diagnostics || !payload) return null;
        payload.metadata = payload.metadata &&
            typeof payload.metadata === 'object' ? payload.metadata : {};
        return diagnostics.stageComplete(payload.metadata, stage, outcome, values || {});
    } catch (_) {
        return null;
    }
}

function _lumpSaveDiagnosticStageException(payload, stage, error, values) {
    try {
        var diagnostics = _lumpSaveDiagnosticsApi();
        if (!diagnostics || !payload) return null;
        payload.metadata = payload.metadata &&
            typeof payload.metadata === 'object' ? payload.metadata : {};
        return diagnostics.stageException(payload.metadata, stage, error, values || {});
    } catch (_) {
        return null;
    }
}

function _lumpSaveDiagnosticResponseMetadata(payload, response) {
    try {
        var diagnostics = _lumpSaveDiagnosticsApi();
        if (!diagnostics || !payload || !response) return;
        payload.metadata = payload.metadata &&
            typeof payload.metadata === 'object' ? payload.metadata : {};
        diagnostics.update(payload.metadata, {
            operation_id: response.operation_id,
            candidate_id: response.candidate_id,
            plan_id: response.plan_id || response.save_plan_id,
        });
    } catch (_) {}
}

/**
 * Handle the server response (resolved branch) from a /api/lumps/save POST.
 *
 * @param {object} r    — Fetch Response-like object: { ok, status }
 * @param {object} resp — Parsed JSON body
 */
function _lumpSaveHandleResponse(r, resp) {
    if (!r.ok) {
        var classification = _lumpSaveFailureClassification(r.status, resp);
        // Surface the server's rejection reason so the user can act on it.
        var _errMsg = _formatActionableHttpError(
            'Save to the LUMP repository', r.status, resp,
            {
                dataChanged: classification.committed,
                nextAction: classification.kind === 'ide'
                    ? 'The IDE must resolve this incident; your source and settings remain preserved.'
                    : 'Correct the exact field identified by the IDE, then save again.',
            });
        // Keep arbitrary server prose out of the console; the user-facing
        // formatter and bounded diagnostics carry only safe classifications.
        console.error('[confirmSaveToNamespace] server rejected save:',
            _lumpSaveFailureClassification(r.status, resp).kind, r.status);
        if (typeof _showFpgaToast === 'function') {
            _showFpgaToast('LUMP Repository Save Failed', _errMsg, 'error', 10000);
        }
    } else if (resp && resp.ok && resp.token) {
        // Use the server-returned token — it reflects the final binary
        // (server injects the self-GT into c-list[0] before hashing).
        if (typeof window !== 'undefined' && window.LumpRegistry) {
            window.LumpRegistry.setCurrent(resp.token);
            window.LumpRegistry.setPending(resp.token);
        }
    }
    // Always refresh the LUMP browser so the user sees the current state.
    if (typeof renderLumps === 'function') renderLumps();
}

/**
 * Handle the network-error (catch) branch from a /api/lumps/save POST.
 *
 * @param {Error} err — the rejection reason from fetch()
 */
function _lumpSaveHandleNetworkError(err) {
    console.error('[confirmSaveToNamespace] network error during save');
    if (typeof _showFpgaToast === 'function') {
        _showFpgaToast('LUMP Repository Save Failed',
                       'Save could not reach the repository, so its commit outcome is unknown. ' +
                       'Next: reload the LUMP repository to reconcile this operation before retrying.',
                       'error', 8000);
    }
    if (typeof renderLumps === 'function') renderLumps();
}

/**
 * Ask how to resolve a stale editor-base rejection.
 *
 * @returns {'reload'|'preserve'|'cancel'|null} null when this is not a stale
 *          editor conflict.
 */
function _lumpSaveStaleConflictAction(response, confirmImpl) {
    if (!response || response.stale_editor_base !== true) return null;
    var ask = typeof confirmImpl === 'function' ? confirmImpl : function() { return false; };
    if (ask(
        'This editor was opened from an older saved revision. A newer revision is now current.\n\n' +
        'Choose OK to reload the latest source. Choose Cancel to keep this buffer and save it as a separate revision.'
    )) return 'reload';
    return ask(
        'Preserve this older buffer as a separate revision? It will not silently replace the newer source.'
    ) ? 'preserve' : 'cancel';
}

/**
 * Return the source corresponding to the exact binary selected for this save.
 * The pending global is consumed before the network request, so callers must
 * pass the retained snapshot rather than reading window._pendingLumpData.
 */
function _lumpSaveSubmittedSource(snapshot, reusedSnapshot, fallbackProfile, fallbackSource) {
    var profile = reusedSnapshot && snapshot ? snapshot.selectedProfile : fallbackProfile;
    if (profile === 'api') return null;
    var source = reusedSnapshot && snapshot ? snapshot.sourceText : fallbackSource;
    return typeof source === 'string' ? source : '';
}

function _lumpSaveFailureClassification(status, response) {
    var resp = response && typeof response === 'object' ? response : {};
    var ideOwned = resp.failure_owner === 'ide' || resp.namespace_identity_failed === true ||
        resp.canonicalization_failed === true || resp.approval_binding_failed === true ||
        resp.atomic_transition_failed === true;
    if (ideOwned) {
        return {
            kind: 'ide',
            committed: resp.committed === true ? true :
                (resp.committed === false ? false : null),
            safeRetry: resp.committed === false && resp.safe_retry === true,
        };
    }
    return {
        kind: status >= 500 ? 'server' : (status >= 400 ? 'validation' : 'protocol'),
        committed: resp.committed === true ? true :
            (resp.committed === false ? false : null),
        safeRetry: false,
    };
}

function _lumpSaveNewOperationId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'save-' + Date.now().toString(36) + '-' +
        Math.random().toString(36).slice(2, 14);
}

function _lumpSaveDefaultOperationKey(payload) {
    var metadata = payload && payload.metadata || {};
    var words = payload && Array.isArray(payload.binary) ? payload.binary : [];
    var fingerprint = 2166136261;
    for (var i = 0; i < words.length; i++) {
        fingerprint ^= words[i] >>> 0;
        fingerprint = Math.imul(fingerprint, 16777619) >>> 0;
    }
    return ['save', metadata.abstraction || '',
        metadata.ns_slot == null ? 'dynamic' : metadata.ns_slot,
        metadata.version || metadata.issue_number || '', metadata.source_hash || '',
        words.length, fingerprint.toString(16)].join(':');
}

// A save operation is an idempotency key, not a request id.  Keep it in the
// payload so a retry after a lost response (including one after a page refresh)
// asks the server about the same durable operation rather than creating a
// second revision.  Callers provide operation_key only as a browser-storage
// lookup key; it is never an authority field for the server.
function _lumpSaveEnsureOperationId(payload) {
    if (!payload || typeof payload !== 'object') {
        throw new Error('Save payload metadata is unavailable');
    }
    if (!payload.metadata || typeof payload.metadata !== 'object') payload.metadata = {};
    var metadata = payload.metadata;
    // The diagnostic attempt is deliberately separate from operation_key and
    // operation_id. It links plan/approval/commit/reconciliation retries but
    // cannot alter canonical identity or idempotency.
    _lumpSaveDiagnosticBegin(payload, 'save');
    var operationId = String(metadata.operation_id || '');
    if (!metadata.operation_key) metadata.operation_key = _lumpSaveDefaultOperationKey(payload);
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(operationId)) {
        var storageKey = metadata.operation_key
            ? _LUMP_SAVE_OPERATION_PREFIX + String(metadata.operation_key)
            : null;
        if (storageKey && typeof sessionStorage !== 'undefined') {
            try { operationId = String(sessionStorage.getItem(storageKey) || ''); } catch (_) {}
        }
        if (!/^[A-Za-z0-9._:-]{8,128}$/.test(operationId)) {
            operationId = _lumpSaveNewOperationId();
        }
        if (storageKey && typeof sessionStorage !== 'undefined') {
            try { sessionStorage.setItem(storageKey, operationId); } catch (_) {}
        }
        metadata.operation_id = operationId;
    }
    try {
        var diagnostics = _lumpSaveDiagnosticsApi();
        if (diagnostics) diagnostics.update(metadata, { operation_id: operationId });
    } catch (_) {}
    return operationId;
}

function _lumpSavePersistPendingOperation(operationId, url, payload) {
    try {
        sessionStorage.setItem(_LUMP_SAVE_PENDING_PREFIX + operationId,
            JSON.stringify({ operation_id: operationId, url: url, payload: payload }));
    } catch (_) {}
}

// A settled operation must not become the accidental idempotency key for a
// later, deliberate Save of the same artifact. Unknown outcomes intentionally
// retain their key so retry/reconciliation cannot duplicate a revision.
function _lumpSaveRetireOperationId(payload) {
    var metadata = payload && payload.metadata;
    if (!metadata || typeof metadata !== 'object') return;
    try {
        if (metadata.operation_key) {
            sessionStorage.removeItem(_LUMP_SAVE_OPERATION_PREFIX + metadata.operation_key);
        }
    } catch (_) {}
    try { sessionStorage.removeItem(_LUMP_SAVE_PENDING_PREFIX + metadata.operation_id); } catch (_) {}
    delete metadata.operation_id;
}

function _lumpSaveReadJson(response) {
    if (!response || typeof response.text !== 'function') {
        return Promise.reject(new Error('save-operation reconciliation returned no response body'));
    }
    return response.text().then(function(text) {
        try {
            return text ? JSON.parse(text) : {};
        } catch (_) {
            throw new Error('save-operation reconciliation did not return JSON');
        }
    });
}

// The server deliberately returns committed:false only when it can prove no
// transition occurred, and committed:null when it cannot tell.  Never invent a
// negative result from a network failure or a missing operation route.
function _lumpSaveReconcile(fetchImpl, operationId, metadata) {
    if (!operationId) return Promise.resolve({ committed: null });
    var diagnosticPayload = { metadata: Object.assign({}, metadata || {},
        { operation_id: operationId }) };
    _lumpSaveDiagnosticStageStart(diagnosticPayload, 'reconcile',
        'save.reconcile', { outcome: 'unknown' });
    return fetchImpl('/api/lumps/save-operations/' + encodeURIComponent(operationId), {
        method: 'GET',
        cache: 'no-store',
        headers: { 'X-Lump-Save-Operation': operationId },
    }).then(function(response) {
        return _lumpSaveReadJson(response).then(function(body) {
            if (!response.ok || !body || typeof body !== 'object') {
                _lumpSaveDiagnosticStageComplete(diagnosticPayload, 'reconcile',
                    'unknown', { http_status: response.status });
                return { committed: null };
            }
            if (body.committed === true && body.response && body.response.ok === true) {
                _lumpSaveDiagnosticResponseMetadata(diagnosticPayload, body.response);
                _lumpSaveDiagnosticStageComplete(diagnosticPayload, 'reconcile',
                    'committed', { http_status: response.status });
                return { committed: true, response: body.response };
            }
            if (body.committed === false) {
                _lumpSaveDiagnosticResponseMetadata(diagnosticPayload, body.response);
                _lumpSaveDiagnosticStageComplete(diagnosticPayload, 'reconcile',
                    'rejected', { http_status: response.status });
                return { committed: false, response: body.response || null };
            }
            _lumpSaveDiagnosticStageComplete(diagnosticPayload, 'reconcile',
                'unknown', { http_status: response.status });
            return { committed: null };
        });
    }).catch(function(error) {
        _lumpSaveDiagnosticStageException(diagnosticPayload, 'reconcile', error,
            { outcome: 'unknown' });
        return { committed: null };
    });
}

function _lumpSaveReconcilePendingOperations(fetchImpl, onOutcome) {
    if (typeof sessionStorage === 'undefined' || !fetchImpl) return Promise.resolve([]);
    var pending = [];
    try {
        for (var i = 0; i < sessionStorage.length; i++) {
            var key = sessionStorage.key(i);
            if (!key || key.indexOf(_LUMP_SAVE_PENDING_PREFIX) !== 0) continue;
            var record = JSON.parse(sessionStorage.getItem(key) || '{}');
            if (record.operation_id) pending.push(record);
        }
    } catch (_) {}
    return Promise.all(pending.map(function(record) {
        return _lumpSaveReconcile(fetchImpl, record.operation_id,
            record.payload && record.payload.metadata).then(function(outcome) {
            if (outcome.committed !== null) {
                // Clear both the pending journal and its logical-operation
                // mapping. A future deliberate save of this same payload must
                // create a new id rather than replay this settled operation.
                _lumpSaveRetireOperationId(record.payload || {
                    metadata: { operation_id: record.operation_id },
                });
            }
            try {
                sessionStorage.setItem('church.lump-save-status:' + record.operation_id,
                    JSON.stringify({ operation_id: record.operation_id,
                        kind: outcome.committed === true ? 'committed' :
                            (outcome.committed === false ? 'rejected' : 'unknown'),
                        message: outcome.committed === true ? 'Repository reconciliation proved this save committed.' :
                            (outcome.committed === false ? 'Repository reconciliation proved this save was rejected.' :
                                'Repository reconciliation could not determine this save outcome.'),
                        updated_at: Date.now() }));
            } catch (_) {}
            if (typeof onOutcome === 'function') onOutcome(record, outcome);
            return { record: record, outcome: outcome };
        });
    }));
}

/**
 * POST a save and classify failures without conflating response parsing with
 * transport.  The commit callback is invoked only for a valid successful JSON
 * response, allowing callers to keep simulator/UI state unchanged until the
 * durable server transaction has committed.
 */
function _lumpSaveRequest(fetchImpl, url, payload, onCommit, recovery) {
    var operationId = _lumpSaveEnsureOperationId(payload);
    _lumpSaveDiagnosticStageStart(payload, 'commit', 'save.request', {
        outcome: 'unknown'
    });
    _lumpSavePersistPendingOperation(operationId, url, payload);
    function commit(resp) {
        _lumpSaveDiagnosticResponseMetadata(payload, resp);
        _lumpSaveDiagnosticStageComplete(payload, 'commit', 'committed', {
            http_status: resp && resp.status
        });
        // A durable save remains successful if rendering, a toast, or a local
        // simulator refresh throws.  That exception is post-commit UI work, not
        // a transport failure and must not cause a duplicate retry.
        if (typeof onCommit === 'function') {
            _lumpSaveDiagnosticStageStart(payload, 'reload', 'save.callback',
                { outcome: 'unknown' });
            try {
                var callbackResult = onCommit(resp);
                if (callbackResult && typeof callbackResult.then === 'function') {
                    return callbackResult.catch(function(postCommitError) {
                        _lumpSaveDiagnosticStageException(payload, 'reload',
                            postCommitError, { outcome: 'unknown' });
                        console.error('[LUMP save] committed; post-commit callback failed');
                        resp.post_commit_error = String(
                            postCommitError && postCommitError.message || postCommitError);
                    }).then(function() {
                        if (!resp.post_commit_error) {
                            _lumpSaveDiagnosticStageComplete(payload, 'reload',
                                'committed', {});
                        }
                        _lumpSaveRetireOperationId(payload);
                        return resp;
                    });
                }
                _lumpSaveDiagnosticStageComplete(payload, 'reload', 'committed', {});
            } catch (postCommitError) {
                _lumpSaveDiagnosticStageException(payload, 'reload', postCommitError,
                    { outcome: 'unknown' });
                console.error('[LUMP save] committed; post-commit callback failed');
                resp.post_commit_error = String(
                    postCommitError && postCommitError.message || postCommitError);
            }
        } else {
            // The caller owns its own refresh when no callback is supplied;
            // retain that uncertainty rather than claiming UI reload success.
            _lumpSaveDiagnosticStageStart(payload, 'reload', 'save.request',
                { outcome: 'unknown' });
            _lumpSaveDiagnosticStageComplete(payload, 'reload', 'unknown', {});
        }
        _lumpSaveRetireOperationId(payload);
        return resp;
    }
    function post() {
        return fetchImpl(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Lump-Save-Operation': operationId,
        },
        body: JSON.stringify(payload),
        }).then(function(r) {
        return r.text().then(function(body) {
            var resp;
            try {
                resp = JSON.parse(body);
            } catch (parseError) {
                _lumpSaveDiagnosticStageException(payload, 'commit', parseError, {
                    http_status: r.status,
                    outcome: 'unknown'
                });
                var excerpt = String(body || '').replace(/\s+/g, ' ').trim().slice(0, 240);
                var protocolError = new Error(
                    _formatActionableHttpError('Save to the LUMP repository', r.status, excerpt, {
                        dataChanged: null,
                        nextAction: 'Reload the LUMP repository to verify the save before retrying.',
                    }));
                protocolError.kind = 'protocol';
                protocolError.status = r.status;
                throw protocolError;
            }
            if (!r.ok || !resp || resp.ok !== true) {
                var classification = _lumpSaveFailureClassification(r.status, resp);
                _lumpSaveDiagnosticResponseMetadata(payload, resp);
                _lumpSaveDiagnosticStageComplete(payload, 'commit',
                    classification.committed === false ? 'rejected' : 'unknown', {
                        http_status: r.status,
                        error: resp && resp.error ? new Error(String(resp.error)) : null,
                    });
                if (classification.kind === 'ide' && classification.safeRetry &&
                        recovery && recovery.attempted !== true &&
                        typeof recovery.rebuildPayload === 'function') {
                    recovery.attempted = true;
                    return Promise.resolve(recovery.rebuildPayload(payload, resp))
                        .then(function(rebuilt) {
                            // The server proved this attempt did not commit.
                            // A corrected canonical payload is a new attempt,
                            // while unknown outcomes above keep their original
                            // key for reconciliation instead of duplicating.
                            _lumpSaveRetireOperationId(payload);
                            rebuilt.metadata = rebuilt.metadata || {};
                            delete rebuilt.metadata.operation_id;
                            return _lumpSaveRequest(fetchImpl, url, rebuilt, onCommit, recovery);
                        });
                }
                var responseError = new Error(
                    _formatActionableHttpError('Save to the LUMP repository', r.status, resp, {
                        dataChanged: classification.committed,
                        nextAction: classification.kind === 'ide'
                            ? 'The IDE must resolve this incident; your source and settings remain preserved.'
                            : 'Correct the identified field, then save again.',
                    }));
                responseError.kind = classification.kind;
                responseError.committed = classification.committed;
                responseError.status = r.status;
                responseError.response = resp;
                throw responseError;
            }
            return commit(resp);
        });
        });
    }
    return post().catch(function(err) {
        if (!err || (err.kind !== 'protocol' && err.kind !== 'validation' &&
                err.kind !== 'ide' && err.kind !== 'server')) {
            _lumpSaveDiagnosticStageException(payload, 'commit', err,
                { outcome: 'unknown' });
        }
        if (err && err.kind === 'protocol') {
            // A proxy can discard a successful JSON response and replace it
            // with HTML. Reconcile before reporting that protocol problem.
            return _lumpSaveReconcile(fetchImpl, operationId, payload.metadata).then(function(reconciliation) {
                if (reconciliation.committed === true) return commit(reconciliation.response);
                if (reconciliation.committed === false) _lumpSaveRetireOperationId(payload);
                err.committed = reconciliation.committed;
                err.operation_id = operationId;
                throw err;
            });
        }
        if (err && (
            err.kind === 'validation' ||
            err.kind === 'ide' ||
            err.kind === 'server'
        )) {
            // Even a syntactically valid rejection is not labelled
            // "uncommitted" unless the operation ledger proves it. This also
            // makes server-created diagnostic candidates discoverable after a
            // validation incident.
            return _lumpSaveReconcile(fetchImpl, operationId, payload.metadata).then(function(reconciliation) {
                if (reconciliation.committed === true) return commit(reconciliation.response);
                if (reconciliation.committed === false) _lumpSaveRetireOperationId(payload);
                err.committed = reconciliation.committed;
                err.operation_id = operationId;
                throw err;
            });
        }
        return _lumpSaveReconcile(fetchImpl, operationId, payload.metadata).then(function(reconciliation) {
            if (reconciliation.committed === true) return commit(reconciliation.response);
            if (reconciliation.committed === false) _lumpSaveRetireOperationId(payload);
            var transportError = new Error(
                _formatActionableNetworkError('Save to the LUMP repository', err, {
                    dataChanged: reconciliation.committed === false ? false : null,
                    nextAction: reconciliation.committed === false
                        ? 'The repository proved no save was committed. Retry Save with the same operation.'
                        : 'The repository could not prove whether the save committed. Reload the LUMP repository before retrying.',
                }));
            transportError.kind = 'transport';
            transportError.committed = reconciliation.committed;
            transportError.operation_id = operationId;
            transportError.cause = err;
            throw transportError;
        });
    });
}

if (typeof module !== 'undefined') {
    module.exports = {
        _lumpSaveHandleResponse,
        _lumpSaveHandleNetworkError,
        _lumpSaveStaleConflictAction,
        _lumpSaveSubmittedSource,
        _lumpSaveFailureClassification,
        _lumpSaveDefaultOperationKey,
        _lumpSaveEnsureOperationId,
        _lumpSaveRetireOperationId,
        _lumpSaveReconcile,
        _lumpSaveReconcilePendingOperations,
        _lumpSaveRequest,
        _lumpSaveDiagnostics: _lumpSaveDiagnosticsApi,
        _formatActionableHttpError,
    };
}

// Reconcile retained unknown saves when the browser reloads. The visible save
// dialog reads the stored outcome; dispatching the event also lets any active
// surface refresh its truthful status without issuing a second mutation.
if (typeof window !== 'undefined' && typeof fetch === 'function' &&
        typeof setTimeout === 'function') {
    setTimeout(function() {
        _lumpSaveReconcilePendingOperations(fetch, function(record, outcome) {
            try {
                window.dispatchEvent(new CustomEvent('lump-save-reconciled', {
                    detail: { operation_id: record.operation_id, outcome: outcome },
                }));
            } catch (_) {}
        });
    }, 0);
}
