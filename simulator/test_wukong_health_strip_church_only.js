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

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('\n' + (failures === 0 ? 'All tests passed.' : failures + ' test(s) FAILED.') + '\n');
process.exit(failures === 0 ? 0 : 1);
