'use strict';
// lump_save_handler.js — DOM-free handler for /api/lumps/save responses.
//
// Used by confirmSaveToNamespace() in app-run.js; exported for unit testing.
//
// All browser globals (_showFpgaToast, window, renderLumps) are accessed
// through typeof guards so the module loads cleanly in Node.js test harnesses.

/**
 * Handle the server response (resolved branch) from a /api/lumps/save POST.
 *
 * @param {object} r    — Fetch Response-like object: { ok, status }
 * @param {object} resp — Parsed JSON body
 */
function _lumpSaveHandleResponse(r, resp) {
    if (!r.ok) {
        // Surface the server's rejection reason so the user can act on it.
        var _errMsg = (resp && resp.error) ? resp.error : ('HTTP ' + r.status);
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
                       'Network error \u2014 check your connection.', 'error', 8000);
    }
    if (typeof renderLumps === 'function') renderLumps();
}

/**
 * POST a save and classify failures without conflating response parsing with
 * transport.  The commit callback is invoked only for a valid successful JSON
 * response, allowing callers to keep simulator/UI state unchanged until the
 * durable server transaction has committed.
 */
function _lumpSaveRequest(fetchImpl, url, payload, onCommit) {
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
                    'Server/protocol error (HTTP ' + r.status + '): expected JSON' +
                    (excerpt ? '; received: ' + excerpt : '.'));
                protocolError.kind = 'protocol';
                protocolError.status = r.status;
                throw protocolError;
            }
            if (!r.ok || !resp || resp.ok !== true) {
                var responseError = new Error(
                    (resp && resp.error) || ('Server rejected save (HTTP ' + r.status + ').'));
                responseError.kind = r.status >= 500
                    ? 'server'
                    : (!r.ok ? 'validation' : 'protocol');
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
            err.kind === 'protocol' ||
            err.kind === 'server'
        )) throw err;
        var transportError = new Error(
            'Network error \u2014 the save request did not reach the server.');
        transportError.kind = 'transport';
        transportError.cause = err;
        throw transportError;
    });
}

if (typeof module !== 'undefined') {
    module.exports = {
        _lumpSaveHandleResponse,
        _lumpSaveHandleNetworkError,
        _lumpSaveRequest,
    };
}
