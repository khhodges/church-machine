'use strict';
// test_lump_save_error_surface.js
//
// Verifies the client-side error-surface logic by testing the REAL functions
// extracted from confirmSaveToNamespace() in simulator/app-run.js:
//   _lumpSaveHandleResponse      — handles resolved fetch (r.ok / !r.ok)
//   _lumpSaveHandleNetworkError  — handles rejected fetch (network error)
//
// Both functions live in simulator/lump_save_handler.js and are used verbatim
// by the production code path.  Changing or removing the real toast call in
// that module will break these tests.
//
// Run:  node simulator/test_lump_save_error_surface.js

const {
    _lumpSaveHandleResponse,
    _lumpSaveHandleNetworkError,
    _lumpSaveStaleConflictAction,
    _lumpSaveSubmittedSource,
} =
    require('./lump_save_handler.js');

let pass = 0;
let fail = 0;

function check(label, cond) {
    if (cond) {
        console.log('PASS', label);
        pass++;
    } else {
        console.log('FAIL', label);
        fail++;
    }
}

// ── Helper: run a handler with mocked browser globals, return recorded calls ─

/**
 * Call `fn` with browser globals (_showFpgaToast, window.LumpRegistry,
 * renderLumps) mocked, then restore them and return the recorded calls.
 */
function withMocks(opts, fn) {
    const toastCalls      = [];
    const registryCalls   = { setCurrent: [], setPending: [] };
    let   renderCalled    = false;

    // Install mocks into the global scope (Node.js global === browser window)
    global._showFpgaToast = function(title, body, level, duration) {
        toastCalls.push({ title, body, level, duration });
    };
    global.renderLumps = function() { renderCalled = true; };
    global.window = {
        LumpRegistry: opts.registry !== false ? {
            setCurrent: function(t) { registryCalls.setCurrent.push(t); },
            setPending: function(t) { registryCalls.setPending.push(t); },
        } : null,
    };

    try {
        fn();
    } finally {
        delete global._showFpgaToast;
        delete global.renderLumps;
        delete global.window;
    }

    return { toastCalls, registryCalls, renderCalled };
}

// ── Tests for _lumpSaveHandleResponse ────────────────────────────────────────

// T1: !r.ok with error body → toast fires with server message
{
    const r    = withMocks({}, () =>
        _lumpSaveHandleResponse(
            { ok: false, status: 422 },
            { error: 'c-list slot 5 >= cc=1', clist_inconsistent: true }
        )
    );
    check('T1a: 422 fires one toast',        r.toastCalls.length === 1);
    check('T1b: 422 toast level is error',   r.toastCalls[0] && r.toastCalls[0].level === 'error');
    check('T1c: 422 toast title correct',
        r.toastCalls[0] && r.toastCalls[0].title === 'LUMP Repository Save Failed');
    check('T1d: 422 toast body is actionable and preserves server message',
        r.toastCalls[0] &&
        r.toastCalls[0].body.includes('c-list slot 5 >= cc=1') &&
        r.toastCalls[0].body.includes('Data-change status is unknown.') &&
        r.toastCalls[0].body.includes('Next:'));
    check('T1e: 422 calls renderLumps',      r.renderCalled);
    check('T1f: 422 does not touch registry', r.registryCalls.setCurrent.length === 0);
}

// T2: !r.ok with no error field → explicitly states the missing reason
{
    const r = withMocks({}, () =>
        _lumpSaveHandleResponse(
            { ok: false, status: 422 },
            { clist_inconsistent: true }            // no 'error' key
        )
    );
    check('T2a: no error field → toast fires',          r.toastCalls.length === 1);
    check('T2b: no error field → missing reason and recovery are explicit',
        r.toastCalls[0] &&
        r.toastCalls[0].body.includes('The server did not provide a reason.') &&
        r.toastCalls[0].body.includes('Next:'));
    check('T2c: no error field → renderLumps called',   r.renderCalled);
}

// T3: !r.ok 500 with error body → toast body is server error string
{
    const r = withMocks({}, () =>
        _lumpSaveHandleResponse(
            { ok: false, status: 500 },
            { error: 'Internal server error' }
        )
    );
    check('T3a: 500 fires one toast',       r.toastCalls.length === 1);
    check('T3b: 500 toast level is error',  r.toastCalls[0] && r.toastCalls[0].level === 'error');
    check('T3c: 500 toast body preserves reason and recovery',
        r.toastCalls[0] &&
        r.toastCalls[0].body.includes('Internal server error') &&
        r.toastCalls[0].body.includes('Data-change status is unknown.') &&
        r.toastCalls[0].body.includes('Next:'));
}

// T4: r.ok=true, resp.ok=true, token present → registry updated, no toast
{
    const r = withMocks({}, () =>
        _lumpSaveHandleResponse(
            { ok: true, status: 200 },
            { ok: true, token: 'deadbeef' }
        )
    );
    check('T4a: 200 ok fires no toast',          r.toastCalls.length === 0);
    check('T4b: 200 ok calls registry.setCurrent',
        r.registryCalls.setCurrent.length === 1 && r.registryCalls.setCurrent[0] === 'deadbeef');
    check('T4c: 200 ok calls registry.setPending',
        r.registryCalls.setPending.length === 1 && r.registryCalls.setPending[0] === 'deadbeef');
    check('T4d: 200 ok calls renderLumps',       r.renderCalled);
}

// T5: r.ok=true but resp.ok=false, no token → no registry update, no toast
{
    const r = withMocks({}, () =>
        _lumpSaveHandleResponse(
            { ok: true, status: 200 },
            { ok: false, error: 'validator rejected' }  // edge case: 200 but ok=false
        )
    );
    check('T5a: ok=false resp → no toast',             r.toastCalls.length === 0);
    check('T5b: ok=false resp → registry not updated', r.registryCalls.setCurrent.length === 0);
    check('T5c: ok=false resp → renderLumps called',   r.renderCalled);
}

// T6: r.ok=true, resp.ok=true, no LumpRegistry → still renders, no crash
{
    const r = withMocks({ registry: false }, () =>
        _lumpSaveHandleResponse(
            { ok: true, status: 200 },
            { ok: true, token: 'cafef00d' }
        )
    );
    check('T6a: no registry → no crash',       r.toastCalls.length === 0);
    check('T6b: no registry → renderLumps called', r.renderCalled);
}

// ── Tests for _lumpSaveHandleNetworkError ─────────────────────────────────────

// T7: network error → toast identifies operation, unchanged data, and recovery
{
    const r = withMocks({}, () =>
        _lumpSaveHandleNetworkError(new Error('connection refused'))
    );
    check('T7a: network error fires one toast',       r.toastCalls.length === 1);
    check('T7b: network error toast level is error',  r.toastCalls[0] && r.toastCalls[0].level === 'error');
    check('T7c: network error body is actionable',
        r.toastCalls[0] &&
        r.toastCalls[0].body.includes('Save could not reach the repository') &&
        r.toastCalls[0].body.includes('commit outcome is unknown') &&
        r.toastCalls[0].body.includes('Next:'));
    check('T7d: network error calls renderLumps',     r.renderCalled);
    check('T7e: network error does not touch registry',
        r.registryCalls.setCurrent.length === 0);
}

// T8: network error with no toast registered → no crash, renderLumps still fires
{
    let renderCalled = false;
    global.renderLumps = function() { renderCalled = true; };
    // _showFpgaToast intentionally NOT set
    try {
        _lumpSaveHandleNetworkError(new Error('timeout'));
    } finally {
        delete global.renderLumps;
    }
    check('T8a: no toast function → no crash',         true /* reached here */);
    check('T8b: no toast function → renderLumps fires', renderCalled);
}

// T9: stale editor conflicts offer all three safe outcomes
{
    check('T9a: stale editor conflict can reload latest source',
        _lumpSaveStaleConflictAction(
            { stale_editor_base: true }, () => true) === 'reload');
    const preserveAnswers = [false, true];
    check('T9b: stale editor conflict can preserve buffer separately',
        _lumpSaveStaleConflictAction(
            { stale_editor_base: true }, () => preserveAnswers.shift()) === 'preserve');
    const cancelAnswers = [false, false];
    check('T9c: stale editor conflict can cancel without saving',
        _lumpSaveStaleConflictAction(
            { stale_editor_base: true }, () => cancelAnswers.shift()) === 'cancel');
    check('T9d: ordinary errors are not stale editor conflicts',
        _lumpSaveStaleConflictAction({ error: 'bad binary' }, () => true) === null);
}

// T10: source verification follows the exact retained/rebuilt binary
{
    const retained = { selectedProfile: 'full', sourceText: 'method Main { RETURN }' };
    check('T10a: retained full-profile binary keeps its matching source',
        _lumpSaveSubmittedSource(retained, true, null, null) === retained.sourceText);
    check('T10b: retained API-only binary submits null source',
        _lumpSaveSubmittedSource(
            { selectedProfile: 'api', sourceText: retained.sourceText },
            true, null, null) === null);
    check('T10c: fallback compact binary keeps rebuilt source',
        _lumpSaveSubmittedSource(null, false, 'compact', 'RETURN') === 'RETURN');
    check('T10d: fallback API-only binary submits null source',
        _lumpSaveSubmittedSource(null, false, 'api', 'RETURN') === null);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('');
console.log(`${pass + fail} tests: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
