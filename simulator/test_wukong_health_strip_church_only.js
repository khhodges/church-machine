// simulator/test_wukong_health_strip_church_only.js
//
// Regression guard: _wukongClassifyPipelineStages must still fire amber/red
// states (with filter-aware wording) when the board stops producing packets
// while the Turing filter (church_only) is on.
//
// Five cases exercised against the "Board trace" stage (stages[1]):
//   1. church_only=true  + traceAge< 3  → green
//   2. church_only=true  + traceAge=10  → amber, Turing-filter wording (NOT "board may be halted")
//   3. church_only=true  + traceAge=60  + totalPosts>0 → red, Turing-filter wording
//   4. church_only=true  + totalPosts=0              → red, no-packets wording
//   5. church_only=false + traceAge=10  → amber, original "board may be halted" wording
//
// Run: node simulator/test_wukong_health_strip_church_only.js

'use strict';

const fs   = require('fs');
const path = require('path');

let failures = 0;
function check(name, cond, detail) {
    if (cond) {
        console.log('  PASS  ' + name);
    } else {
        failures++;
        console.log('  FAIL  ' + name + (detail ? '  — ' + detail : ''));
    }
}

// ── Extract functions from app-run.js ─────────────────────────────────────────
const APP_RUN_PATH = path.join(__dirname, 'app-run.js');
const appRunSrc    = fs.readFileSync(APP_RUN_PATH, 'utf8');

function extractFunction(src, name) {
    const sig = 'function ' + name + '(';
    const sigIdx = src.indexOf(sig);
    if (sigIdx === -1) throw new Error('Cannot find function: ' + name);
    let i = src.indexOf('{', sigIdx);
    let depth = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
            depth--;
            if (depth === 0) return src.slice(sigIdx, i + 1);
        }
    }
    throw new Error('Unbalanced braces for function: ' + name);
}

// Build a minimal scope that satisfies both helper and main function.
// Pass the sandbox object in as a parameter so the inner code can assign to it.
const sandbox = {};
// eslint-disable-next-line no-new-func
new Function(
    'sandbox',
    extractFunction(appRunSrc, '_wukongAgeStr') + '\n' +
    extractFunction(appRunSrc, '_wukongClassifyPipelineStages') + '\n' +
    'sandbox._wukongAgeStr = _wukongAgeStr;\n' +
    'sandbox._wukongClassifyPipelineStages = _wukongClassifyPipelineStages;\n'
)(sandbox);

const classify = sandbox._wukongClassifyPipelineStages;

// Helper: call the classifier with a synthesised status object.
// We keep bridge_poll_age fresh (1 s) so the Bridge stage stays green and
// doesn't distract from the "Board trace" stage we're asserting on.
// We pass ideSeq=-1 so the IDE-events stage is rendered in server-only mode
// (no local cursor) and does not depend on timing.
function run(label, s) {
    const stages = classify(s, -1, null);
    const trace  = stages[1]; // "Board trace" is always index 1
    if (!trace || trace.name !== 'Board trace') {
        failures++;
        console.log('  FAIL  ' + label + '  — stages[1] is not "Board trace": ' + JSON.stringify(trace));
        return null;
    }
    return trace;
}

console.log('\nWukong health-strip — church_only filter tests\n');

// ── Case 1: church_only=true + traceAge < 3 → green ──────────────────────────
{
    const s = {
        bridge_poll_age: 1,
        last_trace_age:  1,
        total_bridge_polls: 10,
        total_trace_posts:  50,
        server_seq: 5,
        bridge: { church_only: true }
    };
    const t = run('case1', s);
    if (t) {
        check('case1: church_only=true + traceAge<3 → state=green',
              t.state === 'green', 'got ' + t.state);
    }
}

// ── Case 2: church_only=true + traceAge=10 → amber, Turing wording ───────────
{
    const s = {
        bridge_poll_age: 1,
        last_trace_age:  10,
        total_bridge_polls: 10,
        total_trace_posts:  50,
        server_seq: 5,
        bridge: { church_only: true }
    };
    const t = run('case2', s);
    if (t) {
        check('case2: church_only=true + traceAge=10 → state=amber',
              t.state === 'amber', 'got ' + t.state);
        check('case2: detail contains "Turing filter"',
              t.detail.includes('Turing filter'), 'detail: ' + t.detail);
        check('case2: detail does NOT contain "board may be halted"',
              !t.detail.includes('board may be halted'), 'detail: ' + t.detail);
    }
}

// ── Case 3: church_only=true + traceAge=60 + totalPosts>0 → red, Turing wording
{
    const s = {
        bridge_poll_age: 1,
        last_trace_age:  60,
        total_bridge_polls: 10,
        total_trace_posts:  50,
        server_seq: 5,
        bridge: { church_only: true }
    };
    const t = run('case3', s);
    if (t) {
        check('case3: church_only=true + traceAge=60 + totalPosts>0 → state=red',
              t.state === 'red', 'got ' + t.state);
        check('case3: detail contains "Turing filter"',
              t.detail.includes('Turing filter'), 'detail: ' + t.detail);
        check('case3: detail does NOT contain "board may be halted"',
              !t.detail.includes('board may be halted'), 'detail: ' + t.detail);
    }
}

// ── Case 4: church_only=true + totalPosts=0 → red, no-packets wording ─────────
// traceAge=null (no trace ever means no age); totalPolls>0 so Bridge is alive.
{
    const s = {
        bridge_poll_age: 1,
        last_trace_age:  null,
        total_bridge_polls: 10,
        total_trace_posts:  0,
        server_seq: 0,
        bridge: { church_only: true }
    };
    const t = run('case4', s);
    if (t) {
        check('case4: church_only=true + totalPosts=0 → state=red',
              t.state === 'red', 'got ' + t.state);
        // The no-packets branch wording is the same regardless of church_only.
        // Verify it does NOT accidentally say "board may be halted".
        check('case4: detail does NOT contain "board may be halted"',
              !t.detail.includes('board may be halted'), 'detail: ' + t.detail);
        // And it does flag that no trace packets were ever received.
        check('case4: detail mentions no trace packets received',
              t.detail.toLowerCase().includes('no trace'), 'detail: ' + t.detail);
    }
}

// ── Case 5: church_only=false + traceAge=10 → amber, original wording ─────────
{
    const s = {
        bridge_poll_age: 1,
        last_trace_age:  10,
        total_bridge_polls: 10,
        total_trace_posts:  50,
        server_seq: 5,
        bridge: { church_only: false }
    };
    const t = run('case5', s);
    if (t) {
        check('case5: church_only=false + traceAge=10 → state=amber',
              t.state === 'amber', 'got ' + t.state);
        check('case5: detail contains "board may be halted"',
              t.detail.includes('board may be halted'), 'detail: ' + t.detail);
    }
}

// ── Bridge stage helper ───────────────────────────────────────────────────────
// Returns stages[0] ("Bridge"), verifying the name and failing loudly on mismatch.
function runBridge(label, s) {
    const stages = classify(s, -1, null);
    const br = stages[0];
    if (!br || br.name !== 'Bridge') {
        failures++;
        console.log('  FAIL  ' + label + '  — stages[0] is not "Bridge": ' + JSON.stringify(br));
        return null;
    }
    return br;
}

console.log('\nWukong health-strip — Bridge stage + church_only filter tests\n');

// ── Case 6: church_only=true + bridgeAge<3 → green + "Turing filter" ──────────
{
    const s = {
        bridge_poll_age:    1,
        last_trace_age:     1,
        total_bridge_polls: 10,
        total_trace_posts:  50,
        server_seq: 5,
        bridge: { church_only: true }
    };
    const br = runBridge('case6', s);
    if (br) {
        check('case6: church_only=true + bridgeAge<3 → state=green',
              br.state === 'green', 'got ' + br.state);
        check('case6: detail is non-empty',
              br.detail && br.detail.length > 0, 'detail: ' + br.detail);
        check('case6: detail contains "Turing filter"',
              br.detail.includes('Turing filter'), 'detail: ' + br.detail);
    }
}

// ── Case 7: church_only=true + bridgeAge=15 → amber + "Turing filter" ─────────
{
    const s = {
        bridge_poll_age:    15,
        last_trace_age:     1,
        total_bridge_polls: 10,
        total_trace_posts:  50,
        server_seq: 5,
        bridge: { church_only: true }
    };
    const br = runBridge('case7', s);
    if (br) {
        check('case7: church_only=true + bridgeAge=15 → state=amber',
              br.state === 'amber', 'got ' + br.state);
        check('case7: detail is non-empty',
              br.detail && br.detail.length > 0, 'detail: ' + br.detail);
        check('case7: detail contains "Turing filter"',
              br.detail.includes('Turing filter'), 'detail: ' + br.detail);
    }
}

// ── Case 8: church_only=true + bridgeAge=null + totalPolls=0 → red (no-polls) ─
{
    const s = {
        bridge_poll_age:    null,
        last_trace_age:     null,
        total_bridge_polls: 0,
        total_trace_posts:  0,
        server_seq: 0,
        bridge: { church_only: true }
    };
    const br = runBridge('case8', s);
    if (br) {
        check('case8: church_only=true + bridgeAge=null + totalPolls=0 → state=red',
              br.state === 'red', 'got ' + br.state);
        check('case8: detail is non-empty',
              br.detail && br.detail.length > 0, 'detail: ' + br.detail);
        check('case8: detail contains "Turing filter"',
              br.detail.includes('Turing filter'), 'detail: ' + br.detail);
    }
}

// ── Case 9: church_only=true + bridgeAge=60 + totalPolls>0 → red (stalled) ────
{
    const s = {
        bridge_poll_age:    60,
        last_trace_age:     1,
        total_bridge_polls: 20,
        total_trace_posts:  100,
        server_seq: 10,
        bridge: { church_only: true }
    };
    const br = runBridge('case9', s);
    if (br) {
        check('case9: church_only=true + bridgeAge=60 + totalPolls>0 → state=red',
              br.state === 'red', 'got ' + br.state);
        check('case9: detail is non-empty',
              br.detail && br.detail.length > 0, 'detail: ' + br.detail);
        check('case9: detail contains "Turing filter"',
              br.detail.includes('Turing filter'), 'detail: ' + br.detail);
    }
}

// ── IDE event feed stage helper ───────────────────────────────────────────────
// Returns stages[3] ("IDE events"), verifying the name and failing loudly on
// mismatch.  Pass ideSeq and ideLastTs directly so we can exercise the full
// IDE-cursor path (not the server-only ideSeq=-1 path used elsewhere).
function runIde(label, s, ideSeq, ideLastTs) {
    const stages = classify(s, ideSeq, ideLastTs);
    const ide = stages[3];
    if (!ide || ide.name !== 'IDE events') {
        failures++;
        console.log('  FAIL  ' + label + '  — stages[3] is not "IDE events": ' + JSON.stringify(ide));
        return null;
    }
    return ide;
}

console.log('\nWukong health-strip — IDE event feed stage + church_only filter tests\n');

// ── Case 10: church_only=true + ideSeq stale → amber ─────────────────────────
// Simulates the bridge dropping while the filter is on: ideSeq is positive but
// the last event arrived 20 s ago, pushing the IDE feed into amber.
{
    const nowSec = Date.now() / 1000;
    const s = {
        bridge_poll_age:    1,
        last_trace_age:     1,
        total_bridge_polls: 10,
        total_trace_posts:  50,
        server_seq:         20,
        bridge: { church_only: true }
    };
    const ide = runIde('case10', s, 20, nowSec - 20);
    if (ide) {
        check('case10: church_only=true + ideSeq stale (20s) → state=amber',
              ide.state === 'amber', 'got ' + ide.state);
        check('case10: detail is non-empty',
              ide.detail && ide.detail.length > 0, 'detail: ' + ide.detail);
    }
}

// ── Case 11: church_only=true + ideSeq=0 + serverSeq=0 → red ─────────────────
// Bridge drops before any packets arrive; both IDE cursor and server queue are
// at zero, so the IDE event feed must show red.
{
    const s = {
        bridge_poll_age:    null,
        last_trace_age:     null,
        total_bridge_polls: 0,
        total_trace_posts:  0,
        server_seq:         0,
        bridge: { church_only: true }
    };
    const ide = runIde('case11', s, 0, null);
    if (ide) {
        check('case11: church_only=true + ideSeq=0 + serverSeq=0 → state=red',
              ide.state === 'red', 'got ' + ide.state);
        check('case11: detail is non-empty',
              ide.detail && ide.detail.length > 0, 'detail: ' + ide.detail);
    }
}

// ── Case 12: church_only=true + ideSeq=0 + serverSeq>0 → amber ───────────────
// Server accumulated events while the filter was on, but the IDE cursor is still
// at 0 (e.g. page not yet refreshed after reconnect).  Stage 4 should be amber.
{
    const s = {
        bridge_poll_age:    1,
        last_trace_age:     1,
        total_bridge_polls: 10,
        total_trace_posts:  50,
        server_seq:         15,
        bridge: { church_only: true }
    };
    const ide = runIde('case12', s, 0, null);
    if (ide) {
        check('case12: church_only=true + ideSeq=0 + serverSeq>0 → state=amber',
              ide.state === 'amber', 'got ' + ide.state);
        check('case12: detail is non-empty',
              ide.detail && ide.detail.length > 0, 'detail: ' + ide.detail);
    }
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('\n' + (failures === 0 ? 'All tests passed.' : failures + ' test(s) FAILED.') + '\n');
process.exit(failures === 0 ? 0 : 1);
