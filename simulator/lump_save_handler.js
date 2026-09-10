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
        console.error('[confirmSaveToNamespace] server rejected save:', _errMsg, resp);
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
    console.error('[confirmSaveToNamespace] network error during save:', err);
    if (typeof _showFpgaToast === 'function') {
        _showFpgaToast('LUMP Repository Save Failed',
                       'Save could not reach the repository. No data was changed. ' +
                       'Next: check your connection, then click Save again.',
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

/**
 * POST a save and classify failures without conflating response parsing with
 * transport.  The commit callback is invoked only for a valid successful JSON
 * response, allowing callers to keep simulator/UI state unchanged until the
 * durable server transaction has committed.
 */
function _lumpSaveRequest(fetchImpl, url, payload, onCommit, recovery) {
    return fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    }).then(function(r) {
        return r.text().then(function(body) {
            var resp;
            try {
                resp = JSON.parse(body);
            } catch (parseError) {
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
                if (classification.kind === 'ide' && classification.safeRetry &&
                        recovery && recovery.attempted !== true &&
                        typeof recovery.rebuildPayload === 'function') {
                    recovery.attempted = true;
                    return Promise.resolve(recovery.rebuildPayload(payload, resp))
                        .then(function(rebuilt) {
                            return _lumpSaveRequest(
                                fetchImpl, url, rebuilt, onCommit, recovery);
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
            if (typeof onCommit === 'function') onCommit(resp);
            return resp;
        });
    }).catch(function(err) {
        if (err && (
            err.kind === 'validation' ||
            err.kind === 'ide' ||
            err.kind === 'protocol' ||
            err.kind === 'server'
        )) throw err;
        var transportError = new Error(
            _formatActionableNetworkError('Save to the LUMP repository', err, {
                dataChanged: null,
                nextAction: 'Reload the LUMP repository to verify the save before retrying.',
            }));
        transportError.kind = 'transport';
        transportError.cause = err;
        throw transportError;
    });
}

if (typeof module !== 'undefined') {
    module.exports = {
        _lumpSaveHandleResponse,
        _lumpSaveHandleNetworkError,
        _lumpSaveStaleConflictAction,
        _lumpSaveSubmittedSource,
        _lumpSaveFailureClassification,
        _lumpSaveRequest,
        _formatActionableHttpError,
    };
}
