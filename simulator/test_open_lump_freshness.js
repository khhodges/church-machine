'use strict';
// test_open_lump_freshness.js — Regression test for Task #2647
//
// Confirms that openLumpInEditor's fresh-compilation redirect always
// opens the newest in-memory compilation, not the old saved binary.
//
// The logic under test lives in openLumpInEditor() (app-lumps.js) at
// the block labelled "Fresh-compilation redirect (dot.name.hash protocol)".
// This test extracts that block directly from the production source so
// that reverting the fix causes the test to fail.
//
// Run:  node simulator/test_open_lump_freshness.js
//
// Coverage:
//   T1 — newer in-memory compilation redirects to the new token
//   T2 — no redirect when no in-memory compilation exists
//   T3 — no redirect when in-memory compilation is OLDER than the saved entry
//   T4 — picks the NEWEST in-memory entry when several candidates exist
//   T5 — no redirect when the in-memory entry has a different abstraction name
//   T6 — redirect block is present in the production source (structural guard)

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

// ── Counters ──────────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;

function check(label, cond, got) {
    if (cond) {
        console.log('PASS ' + label);
        pass++;
    } else {
        console.log('FAIL ' + label + (got !== undefined ? '  got: ' + JSON.stringify(got) : ''));
        fail++;
    }
}

// ── Extract the fresh-compilation redirect block from the production source ──
// Finds the `if (window.LumpRegistry)` block that immediately follows the
// "Fresh-compilation redirect" comment inside openLumpInEditor(), extracts it
// verbatim, and wraps it as a testable function:
//
//   doRedirect(token, window) → redirected_token
//
// If the block is missing (i.e. the fix was reverted), the extraction throws
// and the whole test suite fails.
function extractRedirectBlock() {
    const srcPath = path.join(__dirname, 'app-lumps.js');
    const src = fs.readFileSync(srcPath, 'utf8');
    const lines = src.split('\n');

    // Locate the comment that marks the redirect block.
    const markerIdx = lines.findIndex(l =>
        l.includes('Fresh-compilation redirect (dot.name.hash protocol)'));
    if (markerIdx === -1)
        throw new Error(
            'app-lumps.js: redirect block marker not found.\n' +
            'The "Fresh-compilation redirect (dot.name.hash protocol)" comment ' +
            'is missing — the fix may have been reverted.');

    // The `if (window.LumpRegistry) {` line follows within a few lines.
    let ifLineIdx = -1;
    for (let i = markerIdx; i < Math.min(markerIdx + 40, lines.length); i++) {
        if (/^\s*if\s*\(window\.LumpRegistry\)/.test(lines[i])) {
            ifLineIdx = i;
            break;
        }
    }
    if (ifLineIdx === -1)
        throw new Error(
            'app-lumps.js: `if (window.LumpRegistry)` not found after redirect comment ' +
            '(searched ' + 40 + ' lines — if the comment block grew, increase the window).');

    // Scan brace depth to find the closing `}` of the if block.
    let depth = 0;
    let endIdx = ifLineIdx;
    outer: for (let i = ifLineIdx; i < lines.length; i++) {
        for (const ch of lines[i]) {
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) { endIdx = i; break outer; }
            }
        }
    }

    const block = lines.slice(ifLineIdx, endIdx + 1).join('\n');

    // Verify the block actually contains the core redirect assignment.
    if (!block.includes('_fresherEntry')) {
        throw new Error(
            'app-lumps.js: extracted redirect block does not contain `_fresherEntry`.\n' +
            'The redirect logic appears to have changed; update this test.');
    }

    // Wrap as a standalone function.
    // `lump` is declared but not used in assertions — it mirrors the production
    // variable that gets updated inside the block.
    return '(function doRedirect(token, window) {\n' +
           '  var lump = null;\n' +
           block + '\n' +
           '  return token;\n' +
           '})';
}

// ── Load lump-registry.js into an isolated vm sandbox ────────────────────────
// The IIFE writes to window.LumpRegistry; we supply a `window` alias that
// points back to the sandbox so property assignments land on the sandbox object.
const registrySrc = fs.readFileSync(path.join(__dirname, 'lump-registry.js'), 'utf8');

function makeSandbox() {
    const localStorageData = {};
    const sandbox = {
        localStorage: {
            getItem:    function (k) { return Object.prototype.hasOwnProperty.call(localStorageData, k) ? localStorageData[k] : null; },
            setItem:    function (k, v) { localStorageData[k] = String(v); },
            removeItem: function (k) { delete localStorageData[k]; },
        },
        fetch:   function () { return Promise.resolve({ ok: false }); },
        Date:    Date,
        Object:  Object,
        Array:   Array,
        Map:     Map,
        Promise: Promise,
    };
    // `window` inside lump-registry.js must resolve to the sandbox itself so
    // that `window.LumpRegistry = LumpRegistry` writes to the sandbox.
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(registrySrc, sandbox);
    return sandbox;
}

// ── Build the redirect function in a given sandbox ────────────────────────────
const REDIRECT_FN_SRC = extractRedirectBlock(); // throws on missing block

function buildRedirectFn(sandbox) {
    // Evaluate to a function; call it with (token, sandbox) so it uses the
    // sandbox's window.LumpRegistry rather than any global.
    return vm.runInContext(REDIRECT_FN_SRC, sandbox);
}

// ── T6 — structural guard: redirect block exists in production source ─────────
// (extractRedirectBlock() above already throws if it's missing; reaching here
//  means the block was found and the core variable was present.)
check('T6 redirect block exists in production source (app-lumps.js)',
      REDIRECT_FN_SRC.includes('_fresherEntry') &&
      REDIRECT_FN_SRC.includes('_sessionEpoch'));

// ── T1 — newer in-memory compilation redirects to the new token ──────────────
{
    const sb  = makeSandbox();
    const LR  = sb.window.LumpRegistry;

    const OLD_TOKEN = 'aabb1100';
    const NEW_TOKEN = 'ccdd2200';
    const ABS_NAME  = 'Foo.Bar';

    // Pin SESSION_EPOCH=0 so all timestamps qualify as current-session; this
    // test verifies the newer-timestamp redirect logic, not the epoch guard.
    LR.SESSION_EPOCH = 0;

    // Register the old token via server (simulates a saved LUMP).
    LR.registerFromServer([{ token: OLD_TOKEN, abstraction: ABS_NAME }]);
    // Pin fetchedAt to a controlled value.
    LR.resolve(OLD_TOKEN).sources.server.fetchedAt = 1000;

    // Register the new token as an in-memory compilation with a later timestamp.
    LR.registerMemory(NEW_TOKEN, ABS_NAME, [0x00000001, 0x00000002], []);
    LR.resolve(NEW_TOKEN).sources.memory.registeredAt = 2000;

    const redirected = buildRedirectFn(sb)(OLD_TOKEN, sb);
    check('T1 redirects old saved token to newer in-memory compilation',
          redirected === NEW_TOKEN, redirected);
}

// ── T2 — no in-memory compilation → token unchanged ──────────────────────────
{
    const sb = makeSandbox();
    const LR = sb.window.LumpRegistry;

    const OLD_TOKEN = 'aabb1100';
    LR.registerFromServer([{ token: OLD_TOKEN, abstraction: 'Foo.Bar' }]);
    LR.resolve(OLD_TOKEN).sources.server.fetchedAt = 5000;

    const redirected = buildRedirectFn(sb)(OLD_TOKEN, sb);
    check('T2 no redirect when no in-memory compilation exists',
          redirected === OLD_TOKEN, redirected);
}

// ── T3 — in-memory compilation is OLDER than saved → no redirect ──────────────
{
    const sb = makeSandbox();
    const LR = sb.window.LumpRegistry;

    const OLD_TOKEN = 'aabb1100';
    const MEM_TOKEN = 'ccdd2200';
    const ABS_NAME  = 'Foo.Bar';

    LR.registerFromServer([{ token: OLD_TOKEN, abstraction: ABS_NAME }]);
    LR.resolve(OLD_TOKEN).sources.server.fetchedAt = 9000;  // saved AFTER compile

    LR.registerMemory(MEM_TOKEN, ABS_NAME, [0x00000001], []);
    LR.resolve(MEM_TOKEN).sources.memory.registeredAt = 1000;  // older

    const redirected = buildRedirectFn(sb)(OLD_TOKEN, sb);
    check('T3 no redirect when in-memory compilation is older than saved version',
          redirected === OLD_TOKEN, redirected);
}

// ── T4 — multiple in-memory candidates → picks the NEWEST ────────────────────
{
    const sb = makeSandbox();
    const LR = sb.window.LumpRegistry;

    const OLD_TOKEN  = 'aabb1100';
    const MID_TOKEN  = 'ccdd2200';
    const BEST_TOKEN = 'eeff3300';
    const ABS_NAME   = 'Foo.Bar';

    // Pin SESSION_EPOCH=0 so all timestamps qualify; this test verifies
    // the "pick the newest" logic, not the epoch guard.
    LR.SESSION_EPOCH = 0;

    LR.registerFromServer([{ token: OLD_TOKEN, abstraction: ABS_NAME }]);
    LR.resolve(OLD_TOKEN).sources.server.fetchedAt = 1000;

    LR.registerMemory(MID_TOKEN,  ABS_NAME, [1], []);
    LR.registerMemory(BEST_TOKEN, ABS_NAME, [1, 2], []);
    LR.resolve(MID_TOKEN).sources.memory.registeredAt  = 2000;
    LR.resolve(BEST_TOKEN).sources.memory.registeredAt = 3000;  // newest

    const redirected = buildRedirectFn(sb)(OLD_TOKEN, sb);
    check('T4 picks the newest in-memory compilation when multiple candidates exist',
          redirected === BEST_TOKEN, redirected);
}

// ── T5 — different abstraction name → no redirect ─────────────────────────────
{
    const sb = makeSandbox();
    const LR = sb.window.LumpRegistry;

    const OLD_TOKEN = 'aabb1100';
    const NEW_TOKEN = 'ccdd2200';

    LR.registerFromServer([{ token: OLD_TOKEN, abstraction: 'Foo.Bar' }]);
    LR.resolve(OLD_TOKEN).sources.server.fetchedAt = 1000;

    // Different abstraction name — must NOT redirect even though it's newer.
    LR.registerMemory(NEW_TOKEN, 'Different.Name', [1], []);
    LR.resolve(NEW_TOKEN).sources.memory.registeredAt = 9999;

    const redirected = buildRedirectFn(sb)(OLD_TOKEN, sb);
    check('T5 no redirect when in-memory entry has a different abstraction name',
          redirected === OLD_TOKEN, redirected);
}

// ── T7 — post-reload state: fetchedAt=0, no memory entry → no redirect ───────
// After a page reload both in-memory timestamps reset to zero and any
// previously-compiled (unsaved) entries are gone.  The redirect block must
// NOT redirect in this state — it should silently open the saved token,
// which is the last known-good binary.  This test pins that behaviour so
// future changes to the timestamp logic cannot accidentally break it.
{
    const sb = makeSandbox();
    const LR = sb.window.LumpRegistry;

    const SAVED_TOKEN = 'aabb1100';

    // Server entry present — but fetchedAt is 0 (reset after page reload).
    LR.registerFromServer([{ token: SAVED_TOKEN, abstraction: 'Foo.Bar' }]);
    LR.resolve(SAVED_TOKEN).sources.server.fetchedAt = 0;

    // No in-memory entry at all (cleared by reload).

    const redirected = buildRedirectFn(sb)(SAVED_TOKEN, sb);
    check('T7 no redirect in post-reload state (fetchedAt=0, no memory entry)',
          redirected === SAVED_TOKEN, redirected);
}

// ── T8 — session-epoch guard: pre-session in-memory entry must NOT redirect ───
// Scenario: the user opens a fresh page.  The server list hasn't loaded yet so
// savedFetchedAt=0.  A phantom in-memory entry exists whose registeredAt is
// BEFORE SESSION_EPOCH (e.g. left over from a hypothetical earlier run or a
// clock anomaly).  Without the epoch guard that entry would win (it beats 0)
// and redirect away from the real saved binary.  With the guard it is rejected.
{
    const sb = makeSandbox();
    const LR = sb.window.LumpRegistry;

    const SAVED_TOKEN = 'aabb1100';
    const MEM_TOKEN   = 'ccdd2200';
    const ABS_NAME    = 'Foo.Bar';

    // Pin SESSION_EPOCH to a known value so the test is deterministic.
    const EPOCH = 5000;
    LR.SESSION_EPOCH = EPOCH;

    // Server entry present but not yet fetched (fetchedAt = 0).
    LR.registerFromServer([{ token: SAVED_TOKEN, abstraction: ABS_NAME }]);
    LR.resolve(SAVED_TOKEN).sources.server.fetchedAt = 0;

    // In-memory entry registered BEFORE the session epoch — pre-session.
    LR.registerMemory(MEM_TOKEN, ABS_NAME, [0x00000001], []);
    LR.resolve(MEM_TOKEN).sources.memory.registeredAt = EPOCH - 1;  // just before epoch

    const redirected = buildRedirectFn(sb)(SAVED_TOKEN, sb);
    check('T8a no redirect when in-memory entry is older than SESSION_EPOCH (even if > savedFetchedAt=0)',
          redirected === SAVED_TOKEN, redirected);
}

// ── T8b — session-epoch guard allows valid current-session compilation ─────────
// A real compile in the same session (registeredAt >= SESSION_EPOCH) and newer
// than the saved binary should still redirect as expected.
{
    const sb = makeSandbox();
    const LR = sb.window.LumpRegistry;

    const SAVED_TOKEN = 'aabb1100';
    const NEW_TOKEN   = 'ccdd2200';
    const ABS_NAME    = 'Foo.Bar';

    const EPOCH = 5000;
    LR.SESSION_EPOCH = EPOCH;

    LR.registerFromServer([{ token: SAVED_TOKEN, abstraction: ABS_NAME }]);
    LR.resolve(SAVED_TOKEN).sources.server.fetchedAt = 1000;

    // In-memory entry registered AT the epoch (>= SESSION_EPOCH) and newer than saved.
    LR.registerMemory(NEW_TOKEN, ABS_NAME, [0x00000001, 0x00000002], []);
    LR.resolve(NEW_TOKEN).sources.memory.registeredAt = EPOCH;  // exactly at epoch

    const redirected = buildRedirectFn(sb)(SAVED_TOKEN, sb);
    check('T8b redirect when in-memory entry is at or after SESSION_EPOCH and newer than saved',
          redirected === NEW_TOKEN, redirected);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + (pass + fail) + ' tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
