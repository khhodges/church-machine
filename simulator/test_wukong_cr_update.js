// simulator/test_wukong_cr_update.js
//
// Regression guard: back-to-back CALL trace packets (ev_type 0x06 / 0x07)
// must both update sim.cr[6].word0 and sim.cr[14].word0 correctly.
//
// IMPORTANT — production function extraction
// ------------------------------------------
// This test does NOT duplicate _wukongApplyCRUpdate().  It extracts the
// actual function body from simulator/app-run.js at runtime and wraps it
// so that the browser globals `sim` and `updateCRDisplay` become explicit
// parameters.  Any change to the production logic is therefore immediately
// reflected in the test without any manual sync.
//
// Background
// ----------
// A CALL instruction emits THREE consecutive hardware trace packets:
//   ev_type 0x06  TRACE_EV_CALL_CR6   — carries new CR6 word0 (L-cap)
//   ev_type 0x07  TRACE_EV_CALL_CR14  — carries new CR14 word0 (RX code cap)
//   ev_type 0x08  TRACE_EV_CALL_PUSH  — carries no GT (payload_gt == 0)
//
// The server stores the two GT values in a separate _wukong_latest_cr_gts
// dict so they survive being overwritten by the CALL_PUSH packet in the
// single _wukong_latest_trace slot.  The GET /hardware/wukong/trace response
// merges both dicts, giving the IDE persistent cr6_gt / cr14_gt fields to
// apply.  _wukongApplyCRUpdate(data) reads those fields and writes them into
// sim.cr.
//
// Phases
// ------
//   P1  — CALL_CR6 alone updates only cr[6].word0
//   P2  — CALL_CR14 alone updates only cr[14].word0
//   P3  — Back-to-back CR6 then CR14 data objects → both registers correct
//   P4  — CALL_PUSH merged response preserves cr6_gt / cr14_gt already stored
//   P5  — A second CALL sequence overwrites the first (no stale values)
//   P6  — A RESULT-only packet (no cr6_gt/cr14_gt) leaves registers untouched
//   P7  — displayNotify callback is invoked when a CR is updated
//   P8  — displayNotify is NOT invoked when no CR fields are present
//
// Run: node simulator/test_wukong_cr_update.js

'use strict';

const fs   = require('fs');
const path = require('path');

global.window = {};   // silence any bootConfig references in the ChurchSimulator constructor

const ChurchSimulator = require('./simulator.js');

// ---------------------------------------------------------------------------
// Extract _wukongApplyCRUpdate() from the production source
//
// The function uses two browser globals: `sim` (the simulator instance) and
// `updateCRDisplay` (UI refresh callback).  We extract the raw body text and
// re-wrap it as a plain function that accepts both as explicit parameters, so
// the production logic is exercised verbatim without requiring a browser env.
// ---------------------------------------------------------------------------

const APP_RUN_PATH = path.join(__dirname, 'app-run.js');
const appRunSrc    = fs.readFileSync(APP_RUN_PATH, 'utf8');

/**
 * Locate `function _wukongApplyCRUpdate(data) {` in the source and extract
 * its body by counting brace depth.  Throws if the function is not found.
 */
function extractFunctionBody(src, fnName) {
    const sig = 'function ' + fnName + '(data) {';
    const sigIdx = src.indexOf(sig);
    if (sigIdx === -1) {
        throw new Error('Could not locate ' + fnName + '() in ' + APP_RUN_PATH);
    }
    // Walk from the opening brace, tracking depth
    let depth = 0;
    let start = -1;
    let end   = -1;
    for (let i = sigIdx + sig.length - 1; i < src.length; i++) {
        if (src[i] === '{') {
            if (depth === 0) start = i + 1;
            depth++;
        } else if (src[i] === '}') {
            depth--;
            if (depth === 0) { end = i; break; }
        }
    }
    if (start === -1 || end === -1) {
        throw new Error('Could not parse body of ' + fnName + '()');
    }
    return src.slice(start, end);
}

const body = extractFunctionBody(appRunSrc, '_wukongApplyCRUpdate');

// Re-wrap the verbatim body with `sim` and `updateCRDisplay` as explicit params
// instead of browser globals.  This lets us pass a ChurchSimulator instance
// and a spy callback from Node without any browser environment.
// eslint-disable-next-line no-new-func
const _wukongApplyCRUpdate = new Function('data', 'sim', 'updateCRDisplay', body);

/**
 * Convenience wrapper that mirrors how _wukongApplyCRUpdate() is called in the
 * browser (where `sim` and `updateCRDisplay` are outer-scope globals).
 * Returns the display-notify spy call count so tests can assert it.
 */
function applyCRUpdate(sim, data) {
    let displayCalls = 0;
    function displaySpy() { displayCalls++; }
    _wukongApplyCRUpdate(data, sim, displaySpy);
    return displayCalls;
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
    if (condition) {
        console.log('PASS ' + label);
        passed++;
    } else {
        console.log('FAIL ' + label + (detail ? ' — ' + detail : ''));
        failed++;
    }
}

function makeSim() {
    const sim = new ChurchSimulator();
    sim.bootComplete = true;
    // Ensure all CR slots exist (boot normally populates them; skip that here)
    for (let i = 0; i < 16; i++) {
        if (!sim.cr[i]) {
            sim.cr[i] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
        }
    }
    return sim;
}

function hex(v) { return '0x' + (v >>> 0).toString(16).padStart(8, '0').toUpperCase(); }

// ---------------------------------------------------------------------------
// PHASE 1 — CALL_CR6 packet: only cr[6].word0 is written
// ---------------------------------------------------------------------------
{
    const sim    = makeSim();
    const CR6_GT = 0x1A2B3C4D;

    applyCRUpdate(sim, { cr6_gt: CR6_GT });

    assert('P1a: cr[6].word0 updated after CALL_CR6 packet',
        (sim.cr[6].word0 >>> 0) === CR6_GT,
        'expected ' + hex(CR6_GT) + ', got ' + hex(sim.cr[6].word0));

    assert('P1b: cr[14].word0 unchanged after CALL_CR6 packet',
        sim.cr[14].word0 === 0,
        'expected 0, got ' + hex(sim.cr[14].word0));
}

// ---------------------------------------------------------------------------
// PHASE 2 — CALL_CR14 packet: only cr[14].word0 is written
// ---------------------------------------------------------------------------
{
    const sim     = makeSim();
    const CR14_GT = 0xDEADBEEF;

    applyCRUpdate(sim, { cr14_gt: CR14_GT });

    assert('P2a: cr[14].word0 updated after CALL_CR14 packet',
        (sim.cr[14].word0 >>> 0) === CR14_GT,
        'expected ' + hex(CR14_GT) + ', got ' + hex(sim.cr[14].word0));

    assert('P2b: cr[6].word0 unchanged after CALL_CR14 packet',
        sim.cr[6].word0 === 0,
        'expected 0, got ' + hex(sim.cr[6].word0));
}

// ---------------------------------------------------------------------------
// PHASE 3 — Back-to-back CALL packets: both registers end up correct
//
// The server accumulates cr6_gt/cr14_gt in _wukong_latest_cr_gts so each
// GET response includes both once both CALL_CR6 and CALL_CR14 have arrived.
// Model this: first poll gets only cr6_gt; second poll gets cr6_gt + cr14_gt.
// ---------------------------------------------------------------------------
{
    const sim     = makeSim();
    const CR6_GT  = 0xAAAA1111;
    const CR14_GT = 0xBBBB2222;

    // IDE polls after CALL_CR6 arrives → only cr6_gt in response
    applyCRUpdate(sim, { cr6_gt: CR6_GT });
    // IDE polls after CALL_CR14 arrives → both fields present in response
    applyCRUpdate(sim, { cr6_gt: CR6_GT, cr14_gt: CR14_GT });

    assert('P3a: cr[6].word0 correct after back-to-back CALL packets',
        (sim.cr[6].word0 >>> 0) === CR6_GT,
        'expected ' + hex(CR6_GT) + ', got ' + hex(sim.cr[6].word0));

    assert('P3b: cr[14].word0 correct after back-to-back CALL packets',
        (sim.cr[14].word0 >>> 0) === CR14_GT,
        'expected ' + hex(CR14_GT) + ', got ' + hex(sim.cr[14].word0));
}

// ---------------------------------------------------------------------------
// PHASE 4 — CALL_PUSH merged response: stored CRs are preserved
//
// After CALL_PUSH (ev_type=0x08, payload_gt=0) overwrites the latest-trace
// slot, the GET response still carries cr6_gt / cr14_gt from
// _wukong_latest_cr_gts.  applyWukongCRUpdate must not zero out the registers
// because of the payload_gt=0 — it only writes when the field is present.
// ---------------------------------------------------------------------------
{
    const sim     = makeSim();
    const CR6_GT  = 0x11223344;
    const CR14_GT = 0x55667788;

    // Both CRs updated by the prior two CALL packets
    applyCRUpdate(sim, { cr6_gt: CR6_GT, cr14_gt: CR14_GT });

    // GET response after CALL_PUSH: latest-trace has ev_type=0x08/payload_gt=0
    // but cr6_gt / cr14_gt are still present from the separate dict.
    applyCRUpdate(sim, { ev_type: 0x08, payload_gt: 0, cr6_gt: CR6_GT, cr14_gt: CR14_GT });

    assert('P4a: cr[6].word0 intact after CALL_PUSH merged response',
        (sim.cr[6].word0 >>> 0) === CR6_GT,
        'expected ' + hex(CR6_GT) + ', got ' + hex(sim.cr[6].word0));

    assert('P4b: cr[14].word0 intact after CALL_PUSH merged response',
        (sim.cr[14].word0 >>> 0) === CR14_GT,
        'expected ' + hex(CR14_GT) + ', got ' + hex(sim.cr[14].word0));
}

// ---------------------------------------------------------------------------
// PHASE 5 — Second CALL sequence overwrites the first (no stale values)
// ---------------------------------------------------------------------------
{
    const sim = makeSim();

    // First CALL
    applyCRUpdate(sim, { cr6_gt: 0xAAAA0001, cr14_gt: 0xBBBB0001 });
    // Second CALL
    applyCRUpdate(sim, { cr6_gt: 0xAAAA0002, cr14_gt: 0xBBBB0002 });

    assert('P5a: cr[6].word0 updated by second CALL sequence',
        (sim.cr[6].word0 >>> 0) === 0xAAAA0002,
        'expected ' + hex(0xAAAA0002) + ', got ' + hex(sim.cr[6].word0));

    assert('P5b: cr[14].word0 updated by second CALL sequence',
        (sim.cr[14].word0 >>> 0) === 0xBBBB0002,
        'expected ' + hex(0xBBBB0002) + ', got ' + hex(sim.cr[14].word0));
}

// ---------------------------------------------------------------------------
// PHASE 6 — RESULT packet (no cr6_gt / cr14_gt): registers untouched
// ---------------------------------------------------------------------------
{
    const sim = makeSim();
    sim.cr[6].word0  = 0xCAFEBABE;
    sim.cr[14].word0 = 0xDEADC0DE;

    // A RESULT packet carries ev_type=0x00, payload_gt=<result>, no CR fields
    applyCRUpdate(sim, { ev_type: 0x00, payload_gt: 42 });

    assert('P6a: RESULT packet does not overwrite cr[6].word0',
        (sim.cr[6].word0 >>> 0) === 0xCAFEBABE,
        'expected ' + hex(0xCAFEBABE) + ', got ' + hex(sim.cr[6].word0));

    assert('P6b: RESULT packet does not overwrite cr[14].word0',
        (sim.cr[14].word0 >>> 0) === 0xDEADC0DE,
        'expected ' + hex(0xDEADC0DE) + ', got ' + hex(sim.cr[14].word0));
}

// ---------------------------------------------------------------------------
// PHASE 7 — displayNotify callback IS invoked when a CR is updated
// ---------------------------------------------------------------------------
{
    const sim   = makeSim();
    const calls = applyCRUpdate(sim, { cr6_gt: 0x12345678 });

    assert('P7: displayNotify called once when a CR is updated',
        calls === 1,
        'expected 1 call, got ' + calls);
}

// ---------------------------------------------------------------------------
// PHASE 8 — displayNotify is NOT invoked when no CR fields present
// ---------------------------------------------------------------------------
{
    const sim   = makeSim();
    const calls = applyCRUpdate(sim, { ev_type: 0x00, payload_gt: 0 });

    assert('P8: displayNotify not called when no CR fields present',
        calls === 0,
        'expected 0 calls, got ' + calls);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('');
console.log((passed + failed) + ' tests: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
