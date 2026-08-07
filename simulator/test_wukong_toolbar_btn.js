// test_wukong_toolbar_btn.js — Unit tests for the "⚡ Wukong" toolbar status button
//
// Verifies the production code in app-run.js (_wukongUpdateToolbarBtn and
// wukongConnBtnClick) against these contracted behaviours:
//
//   WB-1  Disconnected → button is dim (opacity 0.45), plain "⚡ Wukong" text,
//         default color/border, "not connected" tooltip
//   WB-2  Connected with a live NIA → opacity 1, green color/border, text
//         carries an "· NIA 0x…" ticker, "connected" tooltip
//   WB-3  Connected but no NIA yet → green, plain "⚡ Wukong" (no ticker)
//   WB-4  NIA fallback: _wukongHwNia null but _wukongLastHwNIA set → ticker
//         shows the last-known NIA
//   WB-5  Transition connected → disconnected restores the dim state exactly
//   WB-6  Click while disconnected → #wukongConnPopover appears
//   WB-7  Second click while popover open → popover is removed (toggle)
//   WB-8  Click while connected → HW Trace panel is shown (display:flex),
//         flash box-shadow applied, and scrollIntoView called
//   WB-9  Click while connected and panel body collapsed → header .click()
//         fired to expand it
//   WB-10 Click while connected → no popover is created
//
// Run with:  node simulator/test_wukong_toolbar_btn.js
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { JSDOM } = require('jsdom');

// ── Source extraction ─────────────────────────────────────────────────────────
// Pulls the contiguous block from `function _wukongUpdateToolbarBtn` through
// `window.wukongConnBtnClick = wukongConnBtnClick;` out of app-run.js so the
// tests always exercise the real production code.

function extractToolbarBtnCode(srcPath) {
    const src = fs.readFileSync(path.resolve(__dirname, srcPath), 'utf8');

    const startMarker = 'function _wukongUpdateToolbarBtn(';
    const endMarker   = 'window.wukongConnBtnClick = wukongConnBtnClick;';

    const start = src.indexOf(startMarker);
    if (start === -1) throw new Error(startMarker + ' not found in ' + srcPath);
    const end = src.indexOf(endMarker, start);
    if (end === -1) throw new Error(endMarker + ' not found after start marker in ' + srcPath);

    return src.slice(start, end + endMarker.length);
}

const TOOLBAR_SRC = extractToolbarBtnCode('app-run.js');

// ── Fixture ───────────────────────────────────────────────────────────────────
// Builds a fresh JSDOM env with the toolbar button + HW log panel and evaluates
// the extracted production code in a vm context with controllable stubs.

function makeEnv(opts) {
    opts = opts || {};
    const dom = new JSDOM(
        '<!DOCTYPE html><body>' +
        '<button id="toolbarWukongBtn" style="opacity:0.45;">\u26A1 Wukong</button>' +
        '<div id="wukong-hw-log" style="display:none;">' +
            '<div id="wukong-hw-log-hdr"></div>' +
            '<div id="wukong-hw-log-body"' + (opts.bodyCollapsed ? ' style="display:none;"' : '') + '></div>' +
        '</div>' +
        '</body>',
        { runScripts: 'outside-only' }
    );
    const window   = dom.window;
    const document = window.document;

    // jsdom has no scrollIntoView — record calls instead.
    const calls = { scrollIntoView: 0, hdrClick: 0 };
    window.HTMLElement.prototype.scrollIntoView = function() { calls.scrollIntoView++; };
    document.getElementById('wukong-hw-log-hdr').addEventListener('click', function() {
        calls.hdrClick++;
    });

    const sandbox = {
        window: window,
        document: document,
        setTimeout: function(fn, ms) { sandbox._timeouts.push({ fn: fn, ms: ms }); return sandbox._timeouts.length; },
        _timeouts: [],
        // Stubs for the connection-state globals the production code reads.
        _wukongConnected: false,
        _wukongIsConnected: function() { return sandbox._wukongConnected; },
        _wukongHwNia: null,
        _wukongLastHwNIA: null,
    };
    vm.createContext(sandbox);
    vm.runInContext(TOOLBAR_SRC, sandbox, { filename: 'app-run.extract.js' });
    sandbox._calls = calls;
    return sandbox;
}

// ── Tiny test harness ─────────────────────────────────────────────────────────

let passed = 0, failed = 0;
function check(id, desc, cond) {
    if (cond) { passed++; console.log('  PASS ' + id + '  ' + desc); }
    else      { failed++; console.error('  FAIL ' + id + '  ' + desc); }
}

// ── WB-1  Disconnected dim state ─────────────────────────────────────────────
(function() {
    const env = makeEnv();
    env._wukongConnected = false;
    vm.runInContext('_wukongUpdateToolbarBtn(_wukongIsConnected());', env);
    const tb = env.document.getElementById('toolbarWukongBtn');
    check('WB-1a', 'disconnected → opacity 0.45', tb.style.opacity === '0.45');
    check('WB-1b', 'disconnected → plain "⚡ Wukong" text', tb.textContent === '\u26A1 Wukong');
    check('WB-1c', 'disconnected → default color', tb.style.color === '');
    check('WB-1d', 'disconnected → default border color', tb.style.borderColor === '');
    check('WB-1e', 'disconnected → "not connected" tooltip',
        /not connected/i.test(tb.getAttribute('data-tooltip') || ''));
})();

// ── WB-2  Connected green + NIA ticker ───────────────────────────────────────
(function() {
    const env = makeEnv();
    env._wukongConnected = true;
    env._wukongHwNia = 0x0140;
    vm.runInContext('_wukongUpdateToolbarBtn(_wukongIsConnected());', env);
    const tb = env.document.getElementById('toolbarWukongBtn');
    check('WB-2a', 'connected → opacity 1', tb.style.opacity === '1');
    check('WB-2b', 'connected → green color', /68,\s*221,\s*136|#44dd88/i.test(tb.style.color));
    check('WB-2c', 'connected → green border', /68,\s*221,\s*136/.test(tb.style.borderColor));
    check('WB-2d', 'connected → NIA ticker "· NIA 0x0140"',
        tb.textContent === '\u26A1 Wukong \u00B7 NIA 0x0140');
    check('WB-2e', 'connected → "connected" tooltip',
        /connected/i.test(tb.getAttribute('data-tooltip') || '') &&
        !/not connected/i.test(tb.getAttribute('data-tooltip') || ''));
})();

// ── WB-3  Connected, no NIA yet ──────────────────────────────────────────────
(function() {
    const env = makeEnv();
    env._wukongConnected = true;
    env._wukongHwNia = null;
    env._wukongLastHwNIA = null;
    vm.runInContext('_wukongUpdateToolbarBtn(_wukongIsConnected());', env);
    const tb = env.document.getElementById('toolbarWukongBtn');
    check('WB-3a', 'connected, no NIA → plain text (no ticker)', tb.textContent === '\u26A1 Wukong');
    check('WB-3b', 'connected, no NIA → still green opacity 1', tb.style.opacity === '1');
})();

// ── WB-4  NIA fallback to _wukongLastHwNIA ───────────────────────────────────
(function() {
    const env = makeEnv();
    env._wukongConnected = true;
    env._wukongHwNia = null;
    env._wukongLastHwNIA = 0x2C;
    vm.runInContext('_wukongUpdateToolbarBtn(_wukongIsConnected());', env);
    const tb = env.document.getElementById('toolbarWukongBtn');
    check('WB-4', 'falls back to last-known NIA (0x002C)',
        tb.textContent === '\u26A1 Wukong \u00B7 NIA 0x002C');
})();

// ── WB-5  Connected → disconnected transition restores dim state ────────────
(function() {
    const env = makeEnv();
    env._wukongConnected = true;
    env._wukongHwNia = 0x40;
    vm.runInContext('_wukongUpdateToolbarBtn(_wukongIsConnected());', env);
    env._wukongConnected = false;
    vm.runInContext('_wukongUpdateToolbarBtn(_wukongIsConnected());', env);
    const tb = env.document.getElementById('toolbarWukongBtn');
    check('WB-5a', 'transition → dim again (opacity 0.45)', tb.style.opacity === '0.45');
    check('WB-5b', 'transition → ticker text cleared', tb.textContent === '\u26A1 Wukong');
    check('WB-5c', 'transition → green color cleared', tb.style.color === '');
    check('WB-5d', 'transition → tooltip back to "not connected"',
        /not connected/i.test(tb.getAttribute('data-tooltip') || ''));
})();

// ── WB-6 / WB-7  Click while disconnected → popover toggle ──────────────────
(function() {
    const env = makeEnv();
    env._wukongConnected = false;
    vm.runInContext('wukongConnBtnClick();', env);
    const pop = env.document.getElementById('wukongConnPopover');
    check('WB-6a', 'disconnected click → popover appears', !!pop);
    check('WB-6b', 'popover mentions "Not connected"', !!pop && /Not connected/.test(pop.textContent));
    check('WB-6c', 'popover mentions the bridge script', !!pop && /bridge/i.test(pop.textContent));
    vm.runInContext('wukongConnBtnClick();', env);
    check('WB-7', 'second click → popover removed (toggle)',
        env.document.getElementById('wukongConnPopover') === null);
})();

// ── WB-8 / WB-10  Click while connected → panel flash, no popover ────────────
(function() {
    const env = makeEnv();
    env._wukongConnected = true;
    vm.runInContext('wukongConnBtnClick();', env);
    const panel = env.document.getElementById('wukong-hw-log');
    check('WB-8a', 'connected click → panel shown (display:flex)', panel.style.display === 'flex');
    check('WB-8b', 'connected click → flash box-shadow applied',
        /68,\s*221,\s*136|#44dd88/i.test(panel.style.boxShadow));
    check('WB-8c', 'connected click → scrollIntoView called', env._calls.scrollIntoView === 1);
    check('WB-8d', 'expanded body → header click NOT fired', env._calls.hdrClick === 0);
    check('WB-10', 'connected click → no popover created',
        env.document.getElementById('wukongConnPopover') === null);
    // Flash timeout restores the previous shadow.
    const flashTimeout = env._timeouts.find(function(t) { return t.ms === 1600; });
    check('WB-8e', 'flash scheduled to clear after 1600ms', !!flashTimeout);
    if (flashTimeout) {
        flashTimeout.fn();
        check('WB-8f', 'flash cleared → box-shadow restored', !/44dd88/i.test(panel.style.boxShadow));
    }
})();

// ── WB-9  Click while connected with collapsed body → header expand click ────
(function() {
    const env = makeEnv({ bodyCollapsed: true });
    env._wukongConnected = true;
    vm.runInContext('wukongConnBtnClick();', env);
    check('WB-9', 'collapsed body → header .click() fired to expand', env._calls.hdrClick === 1);
})();

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
