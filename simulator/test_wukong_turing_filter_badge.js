// simulator/test_wukong_turing_filter_badge.js
//
// Regression guard: the amber "Turing filter ON" badge in the HW Trace panel
// header must show when the bridge is running with --church-only (suppressing
// bare Turing RESULT packets) and hide when it is not.
//
// The badge is driven by s.bridge.church_only from GET /hardware/wukong/status,
// written there by the bridge via POST /hardware/wukong/bridge-status.  A
// regression in either the server field or the JS display logic would silently
// leave users unaware that trace packets are being filtered.
//
// Tests
// ─────
// T1-T5  Badge-visibility formula unit tests (inline, no vm)
// T6-T7  Source-level structural checks on app-run.js
// T8-T9  vm execution of _wukongRefreshHealthStrip with mocked fetch + DOM
//
// Run: node simulator/test_wukong_turing_filter_badge.js

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const APP_RUN_PATH = path.join(__dirname, 'app-run.js');
const appRunSrc    = fs.readFileSync(APP_RUN_PATH, 'utf8');

// ── Test harness ──────────────────────────────────────────────────────────────
let passed = 0, failed = 0;

function assert(label, condition, detail) {
    if (condition) {
        console.log('PASS ' + label);
        passed++;
    } else {
        console.log('FAIL ' + label + (detail != null ? ' — ' + detail : ''));
        failed++;
    }
}

// ── Source extraction helpers (mirrored from test_wukong_reconnect_halt_badge) ─

function extractFn(src, sig) {
    const i0 = src.indexOf(sig);
    if (i0 === -1) throw new Error('Cannot find: ' + sig);
    let depth = 0, start = -1, end = -1;
    for (let i = i0; i < src.length; i++) {
        if (src[i] === '{') { if (depth === 0) start = i; depth++; }
        else if (src[i] === '}') { if (--depth === 0) { end = i; break; } }
    }
    if (end === -1) throw new Error('Unbalanced braces for: ' + sig);
    return src.slice(i0, end + 1);
}

function extractSimpleLet(src, name) {
    const re = new RegExp('let\\s+' + name + '\\s*=\\s*[^;\\n]+;');
    const m  = src.match(re);
    if (!m) throw new Error('Cannot find let: ' + name);
    return m[0];
}

// ── Production badge-visibility formula (mirrored from _wukongRefreshHealthStrip) ──
//
// filterBadge.style.display = churchOnly ? '' : 'none';
// where: var churchOnly = !!(s && s.bridge && s.bridge.church_only);
//
function computeChurchOnly(statusPayload) {
    const s = statusPayload;
    return !!(s && s.bridge && s.bridge.church_only);
}

function badgeDisplay(statusPayload) {
    return computeChurchOnly(statusPayload) ? '' : 'none';
}

// ── T1: church_only:true → badge visible ─────────────────────────────────────
{
    const s = { bridge: { church_only: true } };
    assert('T1a: church_only:true — churchOnly is true',
        computeChurchOnly(s) === true,
        'got ' + computeChurchOnly(s));
    assert('T1b: church_only:true — display is "" (visible)',
        badgeDisplay(s) === '',
        'display=' + badgeDisplay(s));
}

// ── T2: church_only:false → badge hidden ─────────────────────────────────────
{
    const s = { bridge: { church_only: false } };
    assert('T2a: church_only:false — churchOnly is false',
        computeChurchOnly(s) === false,
        'got ' + computeChurchOnly(s));
    assert('T2b: church_only:false — display is "none" (hidden)',
        badgeDisplay(s) === 'none',
        'display=' + badgeDisplay(s));
}

// ── T3: bridge key absent → badge hidden ─────────────────────────────────────
{
    const s = { bridge: {} };
    assert('T3: bridge present but church_only absent — badge hidden',
        badgeDisplay(s) === 'none',
        'display=' + badgeDisplay(s));
}

// ── T4: no bridge key at all → badge hidden ───────────────────────────────────
{
    const s = {};
    assert('T4: no bridge key — badge hidden',
        badgeDisplay(s) === 'none',
        'display=' + badgeDisplay(s));
}

// ── T5: null/undefined payload → badge hidden ────────────────────────────────
{
    assert('T5a: null payload — badge hidden',
        badgeDisplay(null) === 'none',
        'display=' + badgeDisplay(null));
    assert('T5b: undefined payload — badge hidden',
        badgeDisplay(undefined) === 'none',
        'display=' + badgeDisplay(undefined));
}

// ── T6: Source-level check — _wukongRefreshHealthStrip reads s.bridge.church_only ─
{
    const fnBody = extractFn(appRunSrc, 'async function _wukongRefreshHealthStrip(');

    assert('T6a: _wukongRefreshHealthStrip reads s.bridge.church_only',
        fnBody.includes('s.bridge.church_only'),
        'field access not found in function body');

    assert('T6b: _wukongRefreshHealthStrip sets filterBadge.style.display',
        fnBody.includes('filterBadge.style.display'),
        'display assignment not found in function body');

    // Confirm the ternary form: visible when churchOnly, hidden otherwise.
    assert('T6c: display assignment uses churchOnly ternary (visible=\'\', hidden=\'none\')',
        fnBody.includes("churchOnly ? '' : 'none'"),
        'ternary form not found');

    // Confirm the badge is guarded (not always updated even if absent from DOM).
    assert('T6d: filterBadge assignment is inside an if(filterBadge) guard',
        fnBody.includes('if (filterBadge)'),
        'filterBadge guard not found');
}

// ── T7: Source-level check — badge element ID is correct ─────────────────────
{
    const fnBody = extractFn(appRunSrc, 'async function _wukongRefreshHealthStrip(');
    assert('T7: getElementById looks up wukong-hw-log-filter-badge',
        fnBody.includes('wukong-hw-log-filter-badge'),
        'element ID not found in function body');
}

// ── T8-T9: vm execution — _wukongRefreshHealthStrip actually updates the badge ─
//
// Extract the production function and its module-scope let declarations into a
// minimal vm context with a mocked fetch and DOM, then await the async call and
// read back the badge element's style.display.

function buildRefreshCtx(statusPayload) {
    const stripEl = { innerHTML: '' };
    const badgeEl = { style: { display: 'UNSET' } };

    const ctx = vm.createContext({
        // Async fetch stub returns the supplied payload.
        fetch: async function() {
            return {
                ok:   true,
                json: async function() { return statusPayload; },
            };
        },
        // DOM: return the strip and badge elements by ID.
        document: {
            getElementById: function(id) {
                if (id === 'wukong-health-strip')        return stripEl;
                if (id === 'wukong-hw-log-filter-badge') return badgeEl;
                return null;
            },
        },
        // Stubs for helpers called by _wukongRefreshHealthStrip.
        _wukongClassifyPipelineStages: function() { return []; },
        _wukongHealthStripHtml:        function() { return ''; },
        _wukongUpdateRelayBanner:      function() {},
        console: console,
    });

    // Inject module-scope state variables.
    const decls = [
        extractSimpleLet(appRunSrc, '_wukongRelayEnabled'),
        extractSimpleLet(appRunSrc, '_wukongRelaySourceUrl'),
        extractSimpleLet(appRunSrc, '_wukongRelayLastOk'),
        extractSimpleLet(appRunSrc, '_wukongRelayLastRx'),
        extractSimpleLet(appRunSrc, '_wukongLastEventSeq'),
        extractSimpleLet(appRunSrc, '_wukongLastTraceTs'),
        extractFn(appRunSrc, 'async function _wukongRefreshHealthStrip('),
    ].join('\n');

    vm.runInContext(decls, ctx);
    return { ctx, badgeEl };
}

// Wrap the async vm tests in an async IIFE so we can await them.
(async function main() {

    // ── T8: church_only:true → badge is visible after _wukongRefreshHealthStrip ─
    {
        const { ctx, badgeEl } = buildRefreshCtx({ bridge: { church_only: true } });
        const p = vm.runInContext('_wukongRefreshHealthStrip()', ctx);
        await p;
        assert('T8: church_only:true — badge display="" (visible) after refresh',
            badgeEl.style.display === '',
            'display=' + JSON.stringify(badgeEl.style.display));
    }

    // ── T9: church_only:false → badge is hidden after _wukongRefreshHealthStrip ─
    {
        const { ctx, badgeEl } = buildRefreshCtx({ bridge: { church_only: false } });
        const p = vm.runInContext('_wukongRefreshHealthStrip()', ctx);
        await p;
        assert('T9: church_only:false — badge display="none" (hidden) after refresh',
            badgeEl.style.display === 'none',
            'display=' + JSON.stringify(badgeEl.style.display));
    }

    // ── T10: bridge absent → badge is hidden after _wukongRefreshHealthStrip ───
    {
        const { ctx, badgeEl } = buildRefreshCtx({});
        const p = vm.runInContext('_wukongRefreshHealthStrip()', ctx);
        await p;
        assert('T10: no bridge field — badge display="none" (hidden) after refresh',
            badgeEl.style.display === 'none',
            'display=' + JSON.stringify(badgeEl.style.display));
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log('');
    console.log((passed + failed) + ' tests: ' + passed + ' passed, ' + failed + ' failed');
    if (failed > 0) process.exit(1);

})().catch(function(err) {
    console.error('Unexpected error: ' + (err && err.message || err));
    process.exit(1);
});
