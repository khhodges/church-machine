/**
 * simulator/test_pipeline_health_stages.js
 *
 * Unit tests for the pipeline-health stage classification logic used by the
 * IDE's Wukong health strip.  The function under test is inlined here
 * (identical to the copy in app-run.js) so the test has no browser
 * dependencies and can run in plain Node.js.
 *
 * Run: node simulator/test_pipeline_health_stages.js
 */

'use strict';

// ── Inline the classifier (keep in sync with app-run.js) ──────────────────

function _ageStr(a) {
    if (a === null || a === undefined) return 'never';
    if (a < 2)    return a.toFixed(1) + 's ago';
    if (a < 120)  return Math.round(a) + 's ago';
    if (a < 7200) return Math.round(a / 60) + 'min ago';
    return Math.round(a / 3600) + 'h ago';
}

/**
 * Classify the four hardware-pipeline stages from a server status snapshot.
 *
 * @param {Object}      s        – /hardware/wukong/status JSON
 * @param {number}      ideSeq   – IDE's _wukongLastEventSeq (−1 = unknown)
 * @param {number|null} ideLastTs– IDE's _wukongLastTraceTs  (unix seconds)
 * @returns {Array<{name,state,detail}>}
 */
function _wukongClassifyPipelineStages(s, ideSeq, ideLastTs) {
    var stages = [];
    var bridgeAge  = (s && s.bridge_poll_age  !== undefined) ? s.bridge_poll_age  : null;
    var traceAge   = (s && s.last_trace_age   !== undefined) ? s.last_trace_age   : null;
    var totalPolls = (s && s.total_bridge_polls != null)     ? s.total_bridge_polls : 0;
    var totalPosts = (s && s.total_trace_posts  != null)     ? s.total_trace_posts  : 0;
    var serverSeq  = (s && s.server_seq        != null)     ? s.server_seq         : 0;
    var bi         = (s && s.boot_info) || {};

    // Stage 1: Bridge
    var bridge;
    if (bridgeAge !== null && bridgeAge < 3) {
        bridge = { state: 'green', detail: 'Polling \u2014 last ' + _ageStr(bridgeAge) };
    } else if (bridgeAge !== null && bridgeAge < 30) {
        bridge = { state: 'amber', detail: 'Last poll ' + _ageStr(bridgeAge) + ' \u2014 bridge may be stalling' };
    } else if (totalPolls === 0) {
        bridge = { state: 'red',
            detail: 'No bridge polling ever received \u2014 is the bridge script running and pointed at this server? ' +
                    '(check https://lab.cloomc.org vs the dev URL)' };
    } else {
        bridge = { state: 'red',
            detail: 'Bridge stopped ' + _ageStr(bridgeAge) + ' \u2014 bridge script may have crashed or lost network' };
    }
    stages.push({ name: 'Bridge', state: bridge.state, detail: bridge.detail });

    // Stage 2: Board trace
    var trace;
    if (traceAge !== null && traceAge < 3) {
        trace = { state: 'green', detail: 'Trace packets flowing \u2014 last ' + _ageStr(traceAge) };
    } else if (traceAge !== null && traceAge < 30) {
        trace = { state: 'amber', detail: 'Last trace ' + _ageStr(traceAge) + ' \u2014 board may be halted' };
    } else if (totalPosts === 0) {
        if (totalPolls > 0) {
            trace = { state: 'red',
                detail: 'Bridge is polling but no trace packets ever received \u2014 ' +
                        'board may not be running, or bridge may be on the wrong serial port' };
        } else {
            trace = { state: 'red',
                detail: 'No trace packets ever received \u2014 is the board powered and the FPGA bitstream loaded?' };
        }
    } else {
        trace = { state: 'red',
            detail: 'No trace in ' + _ageStr(traceAge) + ' \u2014 board halted or UART disconnected' };
    }
    stages.push({ name: 'Board trace', state: trace.state, detail: trace.detail });

    // Stage 3: Boot info
    var boot;
    if (bi.tu_version !== undefined && Object.keys(bi).length) {
        if (bi.stale_tu) {
            boot = { state: 'amber',
                detail: 'Sentinel seen \u2014 bitstream is STALE (TU v' + bi.tu_version + ') \u2014 reflash the board' };
        } else {
            boot = { state: 'green',
                detail: 'Sentinel seen \u2014 TU v' + bi.tu_version +
                        (bi.build_version != null ? ', build v' + bi.build_version : '') };
        }
    } else {
        boot = { state: 'red',
            detail: 'Boot sentinel not seen \u2014 board may not have booted yet, or the bridge attached after boot. ' +
                    "Click \u21BA Reboot (sends 'f') to re-arm." };
    }
    stages.push({ name: 'Boot info', state: boot.state, detail: boot.detail });

    // Stage 4: IDE event feed
    var ide;
    if (typeof ideSeq === 'number' && ideSeq >= 0) {
        var nowSec = Date.now() / 1000;
        if (ideSeq > 0) {
            if (ideLastTs && (nowSec - ideLastTs) < 10) {
                ide = { state: 'green',
                    detail: ideSeq + ' events received \u2014 last ' + _ageStr(nowSec - ideLastTs) };
            } else if (ideLastTs) {
                ide = { state: 'amber',
                    detail: ideSeq + ' events received, but last ' + _ageStr(nowSec - ideLastTs) + ' ago' };
            } else {
                ide = { state: 'green', detail: ideSeq + ' events received' };
            }
        } else if (serverSeq > 0) {
            ide = { state: 'amber',
                detail: 'Server has ' + serverSeq + ' events but IDE event feed is at 0 \u2014 page may need a refresh' };
        } else {
            ide = { state: 'red', detail: 'No events received yet \u2014 waiting for trace packets to arrive' };
        }
    } else {
        if (serverSeq > 0) {
            ide = { state: 'green', detail: serverSeq + ' total events on server queue' };
        } else {
            ide = { state: 'red', detail: 'No events on server yet \u2014 awaiting first trace packet' };
        }
    }
    stages.push({ name: 'IDE events', state: ide.state, detail: ide.detail });

    return stages;
}


// ── Test harness ───────────────────────────────────────────────────────────

var pass = 0, fail = 0;
function test(name, fn) {
    try {
        fn();
        console.log('  PASS  ' + name);
        pass++;
    } catch (e) {
        console.error('  FAIL  ' + name);
        console.error('        ' + e.message);
        fail++;
    }
}
function eq(actual, expected, msg) {
    if (actual !== expected) throw new Error(
        (msg ? msg + ': ' : '') + 'expected ' + JSON.stringify(expected) + ' got ' + JSON.stringify(actual));
}
function includes(str, sub, msg) {
    if (typeof str !== 'string' || !str.includes(sub)) throw new Error(
        (msg ? msg + ': ' : '') + 'expected ' + JSON.stringify(str) + ' to contain ' + JSON.stringify(sub));
}

// ── Bridge stage tests ─────────────────────────────────────────────────────

console.log('\nBridge stage');

test('fresh bridge → green', function() {
    var s = { bridge_poll_age: 0.5, total_bridge_polls: 10, total_trace_posts: 0,
              last_trace_age: null, server_seq: 0, boot_info: {} };
    var st = _wukongClassifyPipelineStages(s, -1, null)[0];
    eq(st.state, 'green');
});

test('bridge age 2.9 s → green', function() {
    var s = { bridge_poll_age: 2.9, total_bridge_polls: 5, total_trace_posts: 0,
              last_trace_age: null, server_seq: 0, boot_info: {} };
    eq(_wukongClassifyPipelineStages(s, -1, null)[0].state, 'green');
});

test('bridge age 3 s → amber', function() {
    var s = { bridge_poll_age: 3.0, total_bridge_polls: 5, total_trace_posts: 0,
              last_trace_age: null, server_seq: 0, boot_info: {} };
    eq(_wukongClassifyPipelineStages(s, -1, null)[0].state, 'amber');
});

test('bridge age 29 s → amber', function() {
    var s = { bridge_poll_age: 29, total_bridge_polls: 5, total_trace_posts: 0,
              last_trace_age: null, server_seq: 0, boot_info: {} };
    eq(_wukongClassifyPipelineStages(s, -1, null)[0].state, 'amber');
});

test('bridge age 30+ s and was seen → red', function() {
    var s = { bridge_poll_age: 90, total_bridge_polls: 3, total_trace_posts: 0,
              last_trace_age: null, server_seq: 0, boot_info: {} };
    eq(_wukongClassifyPipelineStages(s, -1, null)[0].state, 'red');
});

test('bridge never seen (total_bridge_polls=0, age=null) → red with wrong-server hint', function() {
    var s = { bridge_poll_age: null, total_bridge_polls: 0, total_trace_posts: 0,
              last_trace_age: null, server_seq: 0, boot_info: {} };
    var st = _wukongClassifyPipelineStages(s, -1, null)[0];
    eq(st.state, 'red');
    includes(st.detail, 'lab.cloomc.org', 'should mention wrong-server hint');
});

// ── Board trace stage tests ────────────────────────────────────────────────

console.log('\nBoard trace stage');

test('fresh trace → green', function() {
    var s = { bridge_poll_age: 0.5, total_bridge_polls: 5, total_trace_posts: 10,
              last_trace_age: 0.3, server_seq: 10, boot_info: {} };
    eq(_wukongClassifyPipelineStages(s, -1, null)[1].state, 'green');
});

test('trace age 3-29 s → amber', function() {
    var s = { bridge_poll_age: 0.5, total_bridge_polls: 5, total_trace_posts: 10,
              last_trace_age: 15, server_seq: 10, boot_info: {} };
    eq(_wukongClassifyPipelineStages(s, -1, null)[1].state, 'amber');
});

test('trace never seen and bridge polling → red with serial-port hint', function() {
    var s = { bridge_poll_age: 0.5, total_bridge_polls: 5, total_trace_posts: 0,
              last_trace_age: null, server_seq: 0, boot_info: {} };
    var st = _wukongClassifyPipelineStages(s, -1, null)[1];
    eq(st.state, 'red');
    includes(st.detail, 'serial port', 'should mention wrong serial port');
});

test('trace never seen and bridge never seen → red without serial-port hint', function() {
    var s = { bridge_poll_age: null, total_bridge_polls: 0, total_trace_posts: 0,
              last_trace_age: null, server_seq: 0, boot_info: {} };
    var st = _wukongClassifyPipelineStages(s, -1, null)[1];
    eq(st.state, 'red');
    includes(st.detail, 'powered', 'should mention board power');
});

test('trace was seen but now stale (>30 s) → red', function() {
    var s = { bridge_poll_age: 0.5, total_bridge_polls: 5, total_trace_posts: 100,
              last_trace_age: 90, server_seq: 100, boot_info: {} };
    eq(_wukongClassifyPipelineStages(s, -1, null)[1].state, 'red');
});

// ── Boot info stage tests ──────────────────────────────────────────────────

console.log('\nBoot info stage');

test('sentinel seen, not stale → green', function() {
    var s = { bridge_poll_age: 1, total_bridge_polls: 5, total_trace_posts: 10,
              last_trace_age: 0.5, server_seq: 10,
              boot_info: { tu_version: 4, build_version: 2, stale_tu: false } };
    var st = _wukongClassifyPipelineStages(s, -1, null)[2];
    eq(st.state, 'green');
    includes(st.detail, 'TU v4');
    includes(st.detail, 'build v2');
});

test('sentinel seen, stale → amber', function() {
    var s = { bridge_poll_age: 1, total_bridge_polls: 5, total_trace_posts: 10,
              last_trace_age: 0.5, server_seq: 10,
              boot_info: { tu_version: 2, stale_tu: true } };
    var st = _wukongClassifyPipelineStages(s, -1, null)[2];
    eq(st.state, 'amber');
    includes(st.detail, 'STALE');
});

test('sentinel not seen → red with reboot hint', function() {
    var s = { bridge_poll_age: 1, total_bridge_polls: 5, total_trace_posts: 10,
              last_trace_age: 0.5, server_seq: 10, boot_info: {} };
    var st = _wukongClassifyPipelineStages(s, -1, null)[2];
    eq(st.state, 'red');
    includes(st.detail, 'Reboot');
});

test('boot_info null → red', function() {
    var s = { bridge_poll_age: 1, total_bridge_polls: 5, total_trace_posts: 10,
              last_trace_age: 0.5, server_seq: 10, boot_info: null };
    eq(_wukongClassifyPipelineStages(s, -1, null)[2].state, 'red');
});

// ── IDE event feed stage tests ─────────────────────────────────────────────

console.log('\nIDE event feed stage');

test('ideSeq -1 and server has events → green (fpga page context)', function() {
    var s = { bridge_poll_age: 1, total_bridge_polls: 5, total_trace_posts: 10,
              last_trace_age: 0.5, server_seq: 50, boot_info: {} };
    var st = _wukongClassifyPipelineStages(s, -1, null)[3];
    eq(st.state, 'green');
    includes(st.detail, '50');
});

test('ideSeq -1 and no server events → red', function() {
    var s = { bridge_poll_age: null, total_bridge_polls: 0, total_trace_posts: 0,
              last_trace_age: null, server_seq: 0, boot_info: {} };
    eq(_wukongClassifyPipelineStages(s, -1, null)[3].state, 'red');
});

test('ideSeq > 0 and fresh ts → green (IDE context)', function() {
    var nowTs = Date.now() / 1000;
    var s = { bridge_poll_age: 1, total_bridge_polls: 5, total_trace_posts: 10,
              last_trace_age: 0.5, server_seq: 10, boot_info: {} };
    var st = _wukongClassifyPipelineStages(s, 5, nowTs - 2)[3];
    eq(st.state, 'green');
    includes(st.detail, '5 events');
});

test('ideSeq > 0 and stale ts → amber (IDE context)', function() {
    var nowTs = Date.now() / 1000;
    var s = { bridge_poll_age: 5, total_bridge_polls: 5, total_trace_posts: 10,
              last_trace_age: 15, server_seq: 10, boot_info: {} };
    var st = _wukongClassifyPipelineStages(s, 5, nowTs - 60)[3];
    eq(st.state, 'amber');
});

test('ideSeq=0 but server has events → amber with refresh hint', function() {
    var s = { bridge_poll_age: 1, total_bridge_polls: 5, total_trace_posts: 10,
              last_trace_age: 0.5, server_seq: 20, boot_info: {} };
    var st = _wukongClassifyPipelineStages(s, 0, null)[3];
    eq(st.state, 'amber');
    includes(st.detail, 'refresh');
});

test('ideSeq=0 and no server events → red', function() {
    var s = { bridge_poll_age: null, total_bridge_polls: 0, total_trace_posts: 0,
              last_trace_age: null, server_seq: 0, boot_info: {} };
    eq(_wukongClassifyPipelineStages(s, 0, null)[3].state, 'red');
});

// ── Always returns 4 stages ────────────────────────────────────────────────

console.log('\nStructure');

test('always returns exactly 4 stages', function() {
    var s = { bridge_poll_age: null, total_bridge_polls: 0, total_trace_posts: 0,
              last_trace_age: null, server_seq: 0, boot_info: {} };
    var stages = _wukongClassifyPipelineStages(s, -1, null);
    if (stages.length !== 4) throw new Error('expected 4 stages, got ' + stages.length);
});

test('each stage has name, state, and detail', function() {
    var s = { bridge_poll_age: null, total_bridge_polls: 0, total_trace_posts: 0,
              last_trace_age: null, server_seq: 0, boot_info: {} };
    _wukongClassifyPipelineStages(s, -1, null).forEach(function(st, i) {
        if (!st.name)   throw new Error('stage ' + i + ' missing name');
        if (!st.state)  throw new Error('stage ' + i + ' missing state');
        if (!st.detail) throw new Error('stage ' + i + ' missing detail');
        if (!['green','amber','red'].includes(st.state))
            throw new Error('stage ' + i + ' bad state: ' + st.state);
    });
});

test('handles null status object without throwing', function() {
    var stages = _wukongClassifyPipelineStages(null, -1, null);
    if (stages.length !== 4) throw new Error('expected 4 stages');
    stages.forEach(function(st) {
        if (st.state !== 'red') throw new Error('expected all-red for null status, got ' + st.state);
    });
});

// ── Summary ────────────────────────────────────────────────────────────────

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
