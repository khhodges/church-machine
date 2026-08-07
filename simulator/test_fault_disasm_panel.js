// test_fault_disasm_panel.js — Regression tests for the fault-panel "View instruction →" feature
//
// Verifies the core behaviours of _wukongOpenFaultDisasm and friends:
//
//   FP-1  _wukongLookupWordForFault falls back to sim.memory when caches are empty
//   FP-2  _wukongBuildFaultDisasmHtml: hasData=true when sim.memory contains words
//   FP-3  _wukongBuildFaultDisasmHtml: loading placeholder when no data source available
//   FP-4  Initial open creates panel with correct data-nia and .nia-disasm-current row
//   FP-5  Same-NIA reopen scrolls/flashes the current row (no content rebuild)
//   FP-6  Different-NIA reopen rebuilds content with new NIA as current row
//
// Run with:  node simulator/test_fault_disasm_panel.js
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { JSDOM } = require('jsdom');

// ── Source extraction ─────────────────────────────────────────────────────────

// Extract a named function (including nested braces) from a JS source string.
function extractFunction(src, name) {
    const marker = 'function ' + name + '(';
    const startIdx = src.indexOf(marker);
    if (startIdx === -1) throw new Error('function ' + name + ' not found');
    let depth = 0, end = -1;
    for (let i = startIdx; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) { end = i; break; }
    }
    if (end === -1) throw new Error('Could not find closing brace of ' + name);
    return src.slice(startIdx, end + 1);
}

const APP_RUN_SRC = fs.readFileSync(path.resolve(__dirname, 'app-run.js'), 'utf8');
const APP_MISC_SRC = fs.readFileSync(path.resolve(__dirname, 'app-misc.js'), 'utf8');

// Extract all the fault-disasm functions we want to test.
const LOOKUP_FN      = extractFunction(APP_RUN_SRC, '_wukongLookupWordForFault');
const WORDS_AROUND   = extractFunction(APP_RUN_SRC, '_wukongWordsAroundForFault');
const BUILD_FN       = extractFunction(APP_RUN_SRC, '_wukongBuildFaultDisasmHtml');
const APPLY_FN       = extractFunction(APP_RUN_SRC, '_wukongApplyFaultDisasmContent');
const SCHEDULE_FN    = extractFunction(APP_RUN_SRC, '_wukongScheduleFaultDisasmRerender');
const OPEN_FN        = extractFunction(APP_RUN_SRC, '_wukongOpenFaultDisasm');
const REBUILD_FN     = extractFunction(APP_RUN_SRC, '_wukongRebuildFaultDisasmContent');
const SYNC_FN        = extractFunction(APP_RUN_SRC, '_wukongSyncFaultDisasmPanel');
const BUILD_HTML_SRC = extractFunction(APP_MISC_SRC, '_cmBuildDisasmHtml');

const ALL_FAULT_FNS = [
    LOOKUP_FN, WORDS_AROUND, BUILD_FN, APPLY_FN, SCHEDULE_FN, OPEN_FN, REBUILD_FN, SYNC_FN
].join('\n');

// ── Test harness ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
    if (condition) {
        console.log('PASS ' + label);
        passed++;
    } else {
        console.log('FAIL ' + label + (detail !== undefined ? ' — ' + detail : ''));
        failed++;
    }
}

// Minimal _escHtml matching the production version.
function _escHtmlMock(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Build a _cmBuildDisasmHtml function in a vm context with mock helpers.
function makeBuildHtml() {
    const sandbox = {
        _cmDecodeWord: function(word, addr) {
            return { hex: (word >>> 0).toString(16).padStart(8,'0'), text: 'MOCK ' + addr,
                     mnemonic: 'MOCK', dst: 1, src: 2, imm: 0 };
        },
        _instrRoleAnnotation: function() { return ''; },
        _instrPlainEnglish:   function() { return ''; },
        _escHtml: _escHtmlMock,
        _cmBuildDisasmHtml: undefined,
        _hwBreakpoints: { has: function() { return false; } },
        _wukongIsConnected: function() { return false; },
    };
    const ctx = vm.createContext(new Proxy(sandbox, {
        get(t, p, r) {
            if (p in t) return Reflect.get(t, p, r);
            if (typeof p === 'string' && p in globalThis) return globalThis[p];
            return undefined;
        },
        has() { return true; },
    }));
    vm.runInContext(BUILD_HTML_SRC, ctx);
    return ctx._cmBuildDisasmHtml;
}
const _cmBuildDisasmHtmlMock = makeBuildHtml();

// ── Shared sandbox factory ────────────────────────────────────────────────────

// Build a vm context that has all the fault-panel functions plus mock dependencies.
// opts:
//   cmCache   — object { wordAddr: word } to use as the ROM/LUMP cache (via _cmLookupWord)
//   simMemory — flat array (index=wordAddr→word) for sim.memory
//   dom       — a JSDOM document to use (if omitted, a fresh one is created)
function makeContext(opts) {
    opts = opts || {};
    const dom = opts.dom || new JSDOM('<!DOCTYPE html><body></body>');
    const document = dom.window.document;
    const window   = dom.window;

    // JSDOM does not implement scrollIntoView; stub it on the prototype.
    if (!window.Element.prototype.scrollIntoView) {
        window.Element.prototype.scrollIntoView = function() {};
    }

    const cmCache = opts.cmCache || {};
    const simMemory = opts.simMemory || null;

    const scrolledIntoView = [];
    const flashedRows      = [];

    const sandbox = {
        // DOM
        document,
        requestAnimationFrame: function(cb) { cb(); },

        // Production dependencies
        _cmLookupWord: function(addr) {
            return (addr in cmCache) ? cmCache[addr] : null;
        },
        _cmBuildDisasmHtml: _cmBuildDisasmHtmlMock,
        _cmFetchWordCaches: function() { /* no-op */ },
        _chlogMakeDraggable: function() { /* no-op */ },
        _wukongSetHwBreakpoint: function() { /* no-op */ },
        _escHtml: _escHtmlMock,

        // sim object (live memory fallback)
        sim: simMemory ? { memory: simMemory } : undefined,

        // Spies to track side-effects
        _scrolledIntoView: scrolledIntoView,
        _flashedRows: flashedRows,

        // Stubs for unused runtime paths
        setTimeout: function() {},
    };

    // Wire the production functions.
    const ctx = vm.createContext(new Proxy(sandbox, {
        get(t, p, r) {
            if (p in t) return Reflect.get(t, p, r);
            if (typeof p === 'string' && p in globalThis) return globalThis[p];
            if (typeof p === 'string' && /^[_a-zA-Z]/.test(p)) return function() {};
            return undefined;
        },
        has() { return true; },
    }));

    vm.runInContext(ALL_FAULT_FNS, ctx);

    // Attach helpers onto body so document.getElementById works.
    ctx.document = document;

    return { ctx, document, dom, scrolledIntoView, flashedRows };
}

// ── FP-1: _wukongLookupWordForFault falls back to sim.memory ─────────────────
{
    const simMem = new Array(200).fill(null);
    simMem[42] = 0xDEADBEEF;

    const { ctx } = makeContext({ cmCache: {}, simMemory: simMem });
    const result = ctx._wukongLookupWordForFault(42);
    assert('FP-1: returns word from sim.memory when cache is empty',
        (result >>> 0) === 0xDEADBEEF,
        'got ' + (result === null ? 'null' : '0x' + (result >>> 0).toString(16)));
}

// FP-1b: ROM cache wins over sim.memory
{
    const simMem = new Array(200).fill(null);
    simMem[10] = 0x11111111;

    const { ctx } = makeContext({ cmCache: { 10: 0x22222222 }, simMemory: simMem });
    const result = ctx._wukongLookupWordForFault(10);
    assert('FP-1b: ROM cache word takes priority over sim.memory',
        (result >>> 0) === 0x22222222,
        'got 0x' + (result >>> 0).toString(16));
}

// FP-1c: returns null when neither cache nor sim.memory has the word
{
    const { ctx } = makeContext({ cmCache: {}, simMemory: null });
    const result = ctx._wukongLookupWordForFault(99);
    assert('FP-1c: returns null when no data source available',
        result === null, 'got ' + result);
}

// ── FP-2: _wukongBuildFaultDisasmHtml hasData when sim.memory has words ───────
{
    // Populate sim.memory with a word at the target NIA.
    const NIA = 50;
    const simMem = new Array(100).fill(null);
    simMem[NIA] = 0xABCD1234;

    const { ctx } = makeContext({ cmCache: {}, simMemory: simMem });
    const r = ctx._wukongBuildFaultDisasmHtml(NIA);
    assert('FP-2: hasData=true when sim.memory contains words',
        r.hasData === true, 'hasData=' + r.hasData);
    assert('FP-2: rowsHtml contains .nia-disasm-current row',
        r.built.rowsHtml.includes('nia-disasm-current'),
        'nia-disasm-current not found in rowsHtml');
}

// ── FP-3: loading placeholder when no data available ──────────────────────────
{
    const { ctx } = makeContext({ cmCache: {}, simMemory: null });
    const r = ctx._wukongBuildFaultDisasmHtml(50);
    assert('FP-3: hasData=false when neither cache nor sim.memory available',
        r.hasData === false, 'hasData=' + r.hasData);
    assert('FP-3: rowsHtml contains loading placeholder class',
        r.built.rowsHtml.includes('wukong-fault-disasm-loading'),
        'loading class not found in rowsHtml');
}

// ── FP-4: initial open creates panel with correct data-nia ────────────────────
{
    const NIA = 30;
    const simMem = new Array(100).fill(null);
    for (let i = NIA - 8; i <= NIA + 8; i++) simMem[i] = i === NIA ? 0x1 : 0x0;

    const dom = new JSDOM('<!DOCTYPE html><body></body>');
    const { ctx, document } = makeContext({ simMemory: simMem, dom });

    ctx._wukongOpenFaultDisasm(NIA);

    const panel = document.getElementById('wukong-fault-disasm');
    assert('FP-4: panel element created in document',
        panel !== null, 'getElementById returned null');
    assert('FP-4: panel data-nia matches requested NIA',
        panel && parseInt(panel.dataset.nia, 10) === NIA,
        'data-nia=' + (panel && panel.dataset.nia));
    assert('FP-4: panel contains .nia-disasm-current row',
        panel && panel.querySelector('.nia-disasm-current') !== null,
        'nia-disasm-current not found');

    // Clean up for next test.
    if (panel) panel.remove();
}

// ── FP-5: same-NIA reopen flashes the current row, does NOT rebuild ───────────
{
    const NIA = 20;
    const simMem = new Array(100).fill(null);
    simMem[NIA] = 0x2;

    const dom = new JSDOM('<!DOCTYPE html><body></body>');
    const { ctx, document } = makeContext({ simMemory: simMem, dom });

    // Open the panel once.
    ctx._wukongOpenFaultDisasm(NIA);
    const panelAfterFirst = document.getElementById('wukong-fault-disasm');
    // Record the current row element identity.
    const rowBeforeReopen = panelAfterFirst && panelAfterFirst.querySelector('.nia-disasm-current');

    // Reopen with the same NIA.
    ctx._wukongOpenFaultDisasm(NIA);
    const panelAfterSecond = document.getElementById('wukong-fault-disasm');
    const rowAfterReopen   = panelAfterSecond && panelAfterSecond.querySelector('.nia-disasm-current');

    assert('FP-5: same-NIA reopen keeps panel in DOM',
        panelAfterSecond !== null, 'panel gone after reopen');
    assert('FP-5: data-nia unchanged after same-NIA reopen',
        panelAfterSecond && parseInt(panelAfterSecond.dataset.nia, 10) === NIA,
        'data-nia=' + (panelAfterSecond && panelAfterSecond.dataset.nia));
    assert('FP-5: same DOM row element retained (no rebuild)',
        rowBeforeReopen && rowAfterReopen && rowBeforeReopen === rowAfterReopen,
        'row was replaced');

    if (panelAfterSecond) panelAfterSecond.remove();
}

// ── FP-6: different-NIA reopen rebuilds content with new NIA as current row ───
{
    const NIA_A = 10;
    const NIA_B = 50;
    const simMem = new Array(100).fill(null);
    simMem[NIA_A] = 0x3;
    simMem[NIA_B] = 0x4;

    const dom = new JSDOM('<!DOCTYPE html><body></body>');
    const { ctx, document } = makeContext({ simMemory: simMem, dom });

    // Open panel for NIA_A.
    ctx._wukongOpenFaultDisasm(NIA_A);
    const panel = document.getElementById('wukong-fault-disasm');

    // Reopen for a different NIA (NIA_B).
    ctx._wukongOpenFaultDisasm(NIA_B);
    const panelAfterRebuild = document.getElementById('wukong-fault-disasm');

    assert('FP-6: panel is still the same element (not removed and re-created)',
        panel !== null && panel === panelAfterRebuild,
        'panel was replaced rather than updated in-place');
    assert('FP-6: data-nia updated to new NIA after rebuild',
        panelAfterRebuild && parseInt(panelAfterRebuild.dataset.nia, 10) === NIA_B,
        'data-nia=' + (panelAfterRebuild && panelAfterRebuild.dataset.nia));

    // Verify the current row in the rebuilt panel corresponds to NIA_B.
    const currentRow = panelAfterRebuild && panelAfterRebuild.querySelector('.nia-disasm-current');
    const currentAddr = currentRow && parseInt(currentRow.dataset.addr, 10);
    assert('FP-6: rebuilt panel has .nia-disasm-current at NIA_B address',
        currentAddr === NIA_B,
        'current row addr=' + currentAddr + ' expected=' + NIA_B);

    // The old NIA_A address must no longer be the current row.
    const allCurrentRows = panelAfterRebuild
        ? Array.from(panelAfterRebuild.querySelectorAll('.nia-disasm-current'))
        : [];
    const oldNiaStillCurrent = allCurrentRows.some(function(r) {
        return parseInt(r.dataset.addr, 10) === NIA_A;
    });
    assert('FP-6: old NIA_A address is no longer the current row after rebuild',
        !oldNiaStillCurrent,
        'NIA_A row still has .nia-disasm-current');

    if (panelAfterRebuild) panelAfterRebuild.remove();
}

// ── FP-7: stale async callback cannot overwrite a later fault's panel ─────────
// Scenario: fault A opens the panel with no data (loading placeholder).
//           fault B rebuilds the panel for a different NIA before the cache lands.
//           The stale NIA-A callback fires — the panel must remain at NIA_B.
{
    const NIA_A = 10;
    const NIA_B = 60;

    // Capture the scheduled callbacks instead of letting them run on a real timer.
    const capturedCallbacks = [];

    const dom = new JSDOM('<!DOCTYPE html><body></body>');
    dom.window.Element.prototype.scrollIntoView = function() {};

    // NIA_A words: nothing in cache or memory yet — will get loading placeholder.
    // NIA_B words: available in sim.memory so rebuild has real content.
    const simMem = new Array(100).fill(null);
    simMem[NIA_B] = 0x99;

    const cmCache = {};  // empty — NIA_A has no data from cache either

    const document = dom.window.document;

    const sandbox = {
        document,
        requestAnimationFrame: function(cb) { cb(); },
        _cmLookupWord: function(addr) { return (addr in cmCache) ? cmCache[addr] : null; },
        _cmBuildDisasmHtml: _cmBuildDisasmHtmlMock,
        _cmFetchWordCaches: function() {},
        _chlogMakeDraggable: function() {},
        _wukongSetHwBreakpoint: function() {},
        _escHtml: _escHtmlMock,
        // sim.memory starts empty so NIA_A gets loading placeholder.
        sim: { memory: new Array(100).fill(null) },
        // Intercept setTimeout so we can fire the callback manually.
        setTimeout: function(cb) { capturedCallbacks.push(cb); },
    };

    const ctx = vm.createContext(new Proxy(sandbox, {
        get(t, p, r) {
            if (p in t) return Reflect.get(t, p, r);
            if (typeof p === 'string' && p in globalThis) return globalThis[p];
            if (typeof p === 'string' && /^[_a-zA-Z]/.test(p)) return function() {};
            return undefined;
        },
        has() { return true; },
    }));
    vm.runInContext(ALL_FAULT_FNS, ctx);

    // Step 1: open panel for NIA_A — no data, gets loading placeholder.
    ctx._wukongOpenFaultDisasm(NIA_A);
    const panel = document.getElementById('wukong-fault-disasm');
    const hasLoadingAfterA = panel && panel.querySelector('.wukong-fault-disasm-loading') !== null;
    assert('FP-7: panel shows loading placeholder for NIA_A (no data available)',
        hasLoadingAfterA, 'loading element not found');

    const cbCountAfterA = capturedCallbacks.length;
    assert('FP-7: a scheduled retry callback was queued for NIA_A',
        cbCountAfterA >= 1, 'no callbacks queued, count=' + cbCountAfterA);

    // Step 2: fault B arrives — rebuild the panel for NIA_B (has data via sim.memory).
    // Give NIA_B words to sim.memory so the rebuild succeeds.
    ctx.sim = { memory: simMem };
    ctx._wukongOpenFaultDisasm(NIA_B);

    assert('FP-7: panel data-nia updated to NIA_B after rebuild',
        panel && parseInt(panel.dataset.nia, 10) === NIA_B,
        'data-nia=' + (panel && panel.dataset.nia));

    // Step 3: fire the stale NIA_A callback — it must not overwrite NIA_B content.
    const staleCallback = capturedCallbacks[cbCountAfterA - 1];
    if (staleCallback) staleCallback();

    assert('FP-7: data-nia remains NIA_B after stale NIA_A callback fires',
        panel && parseInt(panel.dataset.nia, 10) === NIA_B,
        'data-nia=' + (panel && panel.dataset.nia));
    assert('FP-7: .nia-disasm-current row is at NIA_B after stale callback',
        (function() {
            if (!panel) return false;
            var cur = panel.querySelector('.nia-disasm-current');
            return cur && parseInt(cur.dataset.addr, 10) === NIA_B;
        })(),
        'current row addr does not match NIA_B');

    if (panel) panel.remove();
}

// ── FP-8: sync — fault_valid=true + same NIA — no rebuild, stale banner removed ─
// Open the panel, inject a fake stale banner, then call sync with the same NIA.
// The banner should disappear and the DOM row identity should be preserved.
{
    const NIA = 40;
    const simMem = new Array(100).fill(null);
    for (let i = NIA - 8; i <= NIA + 8; i++) simMem[i] = i === NIA ? 0x5 : 0x0;

    const dom = new JSDOM('<!DOCTYPE html><body></body>');
    const { ctx, document } = makeContext({ simMemory: simMem, dom });

    // Open the panel.
    ctx._wukongOpenFaultDisasm(NIA);
    const panel = document.getElementById('wukong-fault-disasm');

    // Inject a fake stale banner as if a previous fault-clear had run.
    const fakeBanner = document.createElement('div');
    fakeBanner.className = 'wukong-fault-disasm-stale-banner';
    fakeBanner.textContent = 'stale';
    if (panel && panel.firstChild) panel.insertBefore(fakeBanner, panel.firstChild);
    else if (panel) panel.appendChild(fakeBanner);

    // Also dim the body to simulate the cleared state.
    const body = panel && panel.querySelector('.nia-disasm-body');
    if (body) body.style.opacity = '0.4';

    // Record the row identity before the sync call.
    const rowBefore = panel && panel.querySelector('.nia-disasm-current');

    // Sync: same NIA, fault still valid → banner removed, opacity restored, no rebuild.
    ctx._wukongSyncFaultDisasmPanel(true, NIA);

    assert('FP-8: stale banner removed when fault_valid=true at same NIA',
        panel && panel.querySelector('.wukong-fault-disasm-stale-banner') === null,
        'stale banner still present');
    const bodyAfter = panel && panel.querySelector('.nia-disasm-body');
    assert('FP-8: disasm body opacity restored after fault_valid=true',
        bodyAfter && bodyAfter.style.opacity === '',
        'opacity=' + (bodyAfter && bodyAfter.style.opacity));
    const rowAfter = panel && panel.querySelector('.nia-disasm-current');
    assert('FP-8: same DOM row retained (no rebuild) at same NIA',
        rowBefore && rowAfter && rowBefore === rowAfter,
        'row was replaced');

    if (panel) panel.remove();
}

// ── FP-9: sync — fault_valid=true + different NIA — panel rebuilds ────────────
{
    const NIA_A = 20;
    const NIA_B = 70;
    const simMem = new Array(100).fill(null);
    for (let i = NIA_A - 8; i <= NIA_A + 8; i++) simMem[i] = 0x1;
    for (let i = NIA_B - 8; i <= NIA_B + 8; i++) simMem[i] = 0x2;

    const dom = new JSDOM('<!DOCTYPE html><body></body>');
    const { ctx, document } = makeContext({ simMemory: simMem, dom });

    ctx._wukongOpenFaultDisasm(NIA_A);
    const panel = document.getElementById('wukong-fault-disasm');

    // Sync: different NIA, fault valid → rebuild.
    ctx._wukongSyncFaultDisasmPanel(true, NIA_B);

    assert('FP-9: panel data-nia updated to new NIA after sync rebuild',
        panel && parseInt(panel.dataset.nia, 10) === NIA_B,
        'data-nia=' + (panel && panel.dataset.nia));
    const currentRow = panel && panel.querySelector('.nia-disasm-current');
    assert('FP-9: rebuilt panel current row is at new NIA address',
        currentRow && parseInt(currentRow.dataset.addr, 10) === NIA_B,
        'current addr=' + (currentRow && currentRow.dataset.addr));

    if (panel) panel.remove();
}

// ── FP-10: sync — fault_valid=false — stale banner + dimmed rows ─────────────
{
    const NIA = 30;
    const simMem = new Array(100).fill(null);
    for (let i = NIA - 8; i <= NIA + 8; i++) simMem[i] = i === NIA ? 0x7 : 0x0;

    const dom = new JSDOM('<!DOCTYPE html><body></body>');
    const { ctx, document } = makeContext({ simMemory: simMem, dom });

    ctx._wukongOpenFaultDisasm(NIA);
    const panel = document.getElementById('wukong-fault-disasm');

    // Sync: fault cleared → stale banner injected, body dimmed.
    ctx._wukongSyncFaultDisasmPanel(false, NIA);

    const banner = panel && panel.querySelector('.wukong-fault-disasm-stale-banner');
    assert('FP-10: stale banner injected when fault_valid=false',
        banner !== null, 'stale banner not found');
    const body = panel && panel.querySelector('.nia-disasm-body');
    assert('FP-10: disasm body opacity dimmed when fault_valid=false',
        body && parseFloat(body.style.opacity) < 1,
        'opacity=' + (body && body.style.opacity));

    if (panel) panel.remove();
}

// ── FP-11: sync — second fault-clear does not duplicate the banner ────────────
{
    const NIA = 35;
    const simMem = new Array(100).fill(null);
    for (let i = NIA - 8; i <= NIA + 8; i++) simMem[i] = i === NIA ? 0x8 : 0x0;

    const dom = new JSDOM('<!DOCTYPE html><body></body>');
    const { ctx, document } = makeContext({ simMemory: simMem, dom });

    ctx._wukongOpenFaultDisasm(NIA);
    const panel = document.getElementById('wukong-fault-disasm');

    // Call sync twice with fault_valid=false.
    ctx._wukongSyncFaultDisasmPanel(false, NIA);
    ctx._wukongSyncFaultDisasmPanel(false, NIA);

    const banners = panel ? panel.querySelectorAll('.wukong-fault-disasm-stale-banner') : [];
    assert('FP-11: exactly one stale banner present after two fault-clear syncs',
        banners.length === 1,
        'banner count=' + banners.length);

    if (panel) panel.remove();
}

// ── FP-12: ev_type 0x08 (CALL_PUSH) marks the disasm panel stale ─────────────
// When a CALL_PUSH packet arrives while the panel shows a previous fault, the
// panel must receive the stale banner (fault has cleared / execution moved on).
{
    const NIA_FAULT = 25;
    const NIA_CALL  = 26;
    const simMem = new Array(100).fill(null);
    for (let i = NIA_FAULT - 8; i <= NIA_FAULT + 8; i++) simMem[i] = 0xA;
    for (let i = NIA_CALL  - 8; i <= NIA_CALL  + 8; i++) simMem[i] = 0xB;

    const dom = new JSDOM('<!DOCTYPE html><body></body>');
    const { ctx, document } = makeContext({ simMemory: simMem, dom });

    // Open the panel for a fault at NIA_FAULT.
    ctx._wukongOpenFaultDisasm(NIA_FAULT);
    const panel = document.getElementById('wukong-fault-disasm');

    // Simulate a CALL_PUSH packet (fault_valid=false) arriving at NIA_CALL.
    // _wukongSyncFaultDisasmPanel must be called even though ev_type 0x08 would
    // normally trigger an early return in _wukongAppendTrace.
    ctx._wukongSyncFaultDisasmPanel(false, NIA_CALL);

    const banner = panel && panel.querySelector('.wukong-fault-disasm-stale-banner');
    assert('FP-12: CALL_PUSH (ev_type 0x08) causes stale banner on open panel',
        banner !== null, 'stale banner not found after CALL_PUSH sync');
    const body = panel && panel.querySelector('.nia-disasm-body');
    assert('FP-12: CALL_PUSH dims the disasm body',
        body && parseFloat(body.style.opacity) < 1,
        'opacity=' + (body && body.style.opacity));

    if (panel) panel.remove();
}

// ── FP-13: ev_type 0x09 (RETURN_POP) marks the disasm panel stale ────────────
{
    const NIA_FAULT  = 35;
    const NIA_RETURN = 36;
    const simMem = new Array(100).fill(null);
    for (let i = NIA_FAULT  - 8; i <= NIA_FAULT  + 8; i++) simMem[i] = 0xC;
    for (let i = NIA_RETURN - 8; i <= NIA_RETURN + 8; i++) simMem[i] = 0xD;

    const dom = new JSDOM('<!DOCTYPE html><body></body>');
    const { ctx, document } = makeContext({ simMemory: simMem, dom });

    ctx._wukongOpenFaultDisasm(NIA_FAULT);
    const panel = document.getElementById('wukong-fault-disasm');

    // Simulate a RETURN_POP packet (fault_valid=false).
    ctx._wukongSyncFaultDisasmPanel(false, NIA_RETURN);

    const banner = panel && panel.querySelector('.wukong-fault-disasm-stale-banner');
    assert('FP-13: RETURN_POP (ev_type 0x09) causes stale banner on open panel',
        banner !== null, 'stale banner not found after RETURN_POP sync');

    if (panel) panel.remove();
}

// ── FP-14: integration — sync is called before CALL/RETURN early returns ──────
// Verify that _wukongSyncFaultDisasmPanel appears BEFORE the CALL_PUSH block
// in _wukongAppendTrace source so future edits cannot silently break coverage.
{
    const APPEND_FN_SRC = extractFunction(APP_RUN_SRC, '_wukongAppendTrace');
    const syncCallIdx   = APPEND_FN_SRC.indexOf('_wukongSyncFaultDisasmPanel');
    // The CALL_PUSH early-return block starts with "if (evType === 0x08)".
    const callPushIdx   = APPEND_FN_SRC.indexOf('if (evType === 0x08)');
    assert('FP-14: _wukongSyncFaultDisasmPanel call exists before CALL_PUSH block',
        syncCallIdx !== -1 && callPushIdx !== -1 && syncCallIdx < callPushIdx,
        'syncCall=' + syncCallIdx + ' callPush=' + callPushIdx);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
