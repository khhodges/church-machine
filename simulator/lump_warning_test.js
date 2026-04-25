// lump_warning_test.js — regression tests for the "no LUMP" warning toast
// shown when double-clicking an abstraction that has no compiled LUMP.
//
// Exercises the REAL production functions extracted from:
//   simulator/app-run.js  — _fpgaToastTimer, _dismissFpgaToast, _showFpgaToast
//   simulator/app-lumps.js — _goToLumpByAbstractionName
//
// jsdom provides a real DOM so toast element creation and removal are verified
// against actual document state, not stubs.
//
// Run with: node simulator/lump_warning_test.js
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { JSDOM } = require('jsdom');

// ── Source extraction helpers ─────────────────────────────────────────────────
// Extract a named function (and any var/let declarations immediately preceding
// it) by scanning the raw source for function boundaries, so this test does
// not break when unrelated lines are added or removed elsewhere in the file.

function extractFunctionByName(srcPath, fnName) {
    const src = fs.readFileSync(path.resolve(__dirname, srcPath), 'utf8');
    const lines = src.split('\n');

    // Find the line where the function declaration starts.
    const startIdx = lines.findIndex(l =>
        new RegExp(`^(?:async\\s+)?function\\s+${fnName}\\s*\\(`).test(l.trimStart()));
    if (startIdx === -1) throw new Error(`Function ${fnName} not found in ${srcPath}`);

    // Walk backwards to collect any module-level var/let declarations that
    // immediately precede the function (e.g. _fpgaToastTimer).
    let declStart = startIdx;
    for (let i = startIdx - 1; i >= 0; i--) {
        const t = lines[i].trim();
        if (/^(?:let|var)\s+/.test(t)) { declStart = i; }
        else if (t === '' || t.startsWith('//')) { continue; }
        else { break; }
    }

    // Walk forward to find the matching closing brace.
    let depth = 0;
    let endIdx  = startIdx;
    for (let i = startIdx; i < lines.length; i++) {
        for (const ch of lines[i]) {
            if (ch === '{') depth++;
            else if (ch === '}') { depth--; if (depth === 0) { endIdx = i; break; } }
        }
        if (depth === 0 && i > startIdx) break;
    }

    return lines.slice(declStart, endIdx + 1).join('\n');
}

// Toast helpers: _fpgaToastTimer, _dismissFpgaToast, _showFpgaToast
const DISMISS_SRC  = extractFunctionByName('app-run.js', '_dismissFpgaToast');
const SHOW_SRC     = extractFunctionByName('app-run.js', '_showFpgaToast');
const TOAST_SRC    = DISMISS_SRC + '\n' + SHOW_SRC;

// Navigation function: _goToLumpByAbstractionName
const LUMP_NAV_SRC = extractFunctionByName('app-lumps.js', '_goToLumpByAbstractionName');

// ── Fake timer helpers ────────────────────────────────────────────────────────

function makeFakeTimers() {
    const pending = [];
    let   nextId  = 1;

    function fakeSetTimeout(fn, delay) {
        const id = nextId++;
        pending.push({ id, fn, remaining: delay, cancelled: false });
        return id;
    }
    function fakeClearTimeout(id) {
        const t = pending.find(t => t.id === id);
        if (t) t.cancelled = true;
    }
    function tick(ms) {
        // Snapshot before iterating so timers added by callbacks during this
        // tick are not processed in the same pass (they start their own delay).
        const snapshot = [...pending];
        for (const t of snapshot) {
            if (t.cancelled) continue;
            t.remaining -= ms;
            if (t.remaining <= 0) {
                t.cancelled = true;
                t.fn();
            }
        }
    }
    return { setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout, tick };
}

// ── VM context factory ────────────────────────────────────────────────────────
// Creates a fresh jsdom document + vm context with the real toast functions and
// a configurable navigation stub.  Returns { ctx, timers, switchCalls }.

function makeCtx({ lumpsCache = [], fetchImpl = null } = {}) {
    const dom = new JSDOM('<!DOCTYPE html><body></body>');
    const document = dom.window.document;
    const timers = makeFakeTimers();
    const switchCalls = [];

    const ctx = vm.createContext({
        document,
        // Fake timer hooks forwarded to our controllable fake clock.
        setTimeout:   timers.setTimeout,
        clearTimeout: timers.clearTimeout,
        // Navigation spy — never navigates in tests.
        switchView: (v) => switchCalls.push(v),
        // Mutable cache exposed via context so the cold-cache path can update it.
        _lumpsCache: lumpsCache,
        _pendingLumpAbstractionName: null,
        // fetch stub passed in per test.
        fetch: fetchImpl || (async () => { throw new Error('fetch not configured'); }),
        // Required by async function support in vm.
        Promise,
    });

    // Evaluate the real production source inside the context.
    vm.runInContext(TOAST_SRC,    ctx, { filename: 'app-run.js' });
    vm.runInContext(LUMP_NAV_SRC, ctx, { filename: 'app-lumps.js' });

    return { ctx, document, timers, switchCalls };
}

// ── Test harness ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
    if (condition) {
        console.log('PASS ' + label);
        passed++;
    } else {
        console.log('FAIL ' + label + (detail !== undefined ? ' \u2014 ' + detail : ''));
        failed++;
    }
}

// ── T1: Warm cache, no matching LUMP → toast rendered in DOM ─────────────────
(async function t1() {
    const { ctx, document, switchCalls } = makeCtx({
        lumpsCache: [{ abstraction: 'Adder', token: '0xabc' }],
    });

    await vm.runInContext('_goToLumpByAbstractionName("Counter")', ctx);

    const el = document.getElementById('fpgaToastEl');
    assert('T1 toast element inserted into DOM (warm cache, no match)',
        el !== null);

    const titleEl = el && el.querySelector('.fpga-toast-title');
    assert('T1 toast title is "No LUMP found"',
        titleEl && titleEl.textContent === 'No LUMP found',
        titleEl && titleEl.textContent);

    const bodyEl = el && el.querySelector('.fpga-toast-body');
    assert('T1 toast body contains abstraction name',
        bodyEl && bodyEl.textContent.includes('Counter'),
        bodyEl && bodyEl.textContent);

    assert('T1 toast body contains "No compiled LUMP found"',
        bodyEl && bodyEl.textContent.includes('No compiled LUMP found'),
        bodyEl && bodyEl.textContent);

    assert('T1 toast has warn CSS class',
        el && el.classList.contains('fpga-toast-warn'),
        el && el.className);

    assert('T1 switchView not called',
        switchCalls.length === 0, switchCalls.length);
})();

// ── T2: Warm cache, LUMP found → navigate, no toast ─────────────────────────
(async function t2() {
    const { ctx, document, switchCalls } = makeCtx({
        lumpsCache: [{ abstraction: 'Adder', token: '0xabc' }],
    });

    await vm.runInContext('_goToLumpByAbstractionName("Adder")', ctx);

    const el = document.getElementById('fpgaToastEl');
    assert('T2 no toast when LUMP found (warm cache)',
        el === null, el && el.outerHTML);

    assert('T2 switchView called with "lumps"',
        switchCalls[0] === 'lumps', switchCalls[0]);
})();

// ── T3: Cold cache, fetch returns no match → toast rendered ──────────────────
(async function t3() {
    const { ctx, document, switchCalls } = makeCtx({
        lumpsCache: [],
        fetchImpl: async () => ({
            ok: true,
            json: async () => [{ abstraction: 'Adder', token: '0xabc' }],
        }),
    });

    await vm.runInContext('_goToLumpByAbstractionName("Counter")', ctx);

    const el = document.getElementById('fpgaToastEl');
    assert('T3 toast element inserted into DOM (cold cache, no match)',
        el !== null);

    const titleEl = el && el.querySelector('.fpga-toast-title');
    assert('T3 toast title is "No LUMP found"',
        titleEl && titleEl.textContent === 'No LUMP found',
        titleEl && titleEl.textContent);

    const bodyEl = el && el.querySelector('.fpga-toast-body');
    assert('T3 toast body contains abstraction name',
        bodyEl && bodyEl.textContent.includes('Counter'),
        bodyEl && bodyEl.textContent);

    assert('T3 toast has warn CSS class',
        el && el.classList.contains('fpga-toast-warn'),
        el && el.className);

    assert('T3 switchView not called',
        switchCalls.length === 0, switchCalls.length);
})();

// ── T4: Cold cache, fetch returns matching LUMP → navigate, no toast ─────────
(async function t4() {
    const { ctx, document, switchCalls } = makeCtx({
        lumpsCache: [],
        fetchImpl: async () => ({
            ok: true,
            json: async () => [{ abstraction: 'Counter', token: '0xdef' }],
        }),
    });

    await vm.runInContext('_goToLumpByAbstractionName("Counter")', ctx);

    const el = document.getElementById('fpgaToastEl');
    assert('T4 no toast when LUMP found (cold cache)',
        el === null, el && el.outerHTML);

    assert('T4 switchView called with "lumps"',
        switchCalls[0] === 'lumps', switchCalls[0]);
})();

// ── T5: Empty name → nothing happens ─────────────────────────────────────────
(async function t5() {
    const { ctx, document, switchCalls } = makeCtx({ lumpsCache: [] });

    await vm.runInContext('_goToLumpByAbstractionName("")', ctx);

    const el = document.getElementById('fpgaToastEl');
    assert('T5 no toast for empty name', el === null);
    assert('T5 no navigation for empty name', switchCalls.length === 0, switchCalls.length);
})();

// ── T6: Auto-dismiss — toast element removed after 2000 ms + 400 ms fade ─────
// The real _showFpgaToast schedules:
//   setTimeout(startFade, 2000)  → adds 'fpga-toast-fade' class
//   setTimeout(removeEl, 400)    → removes element from DOM
// Advance fake clock through both phases and verify DOM state.
(async function t6() {
    const { ctx, document, timers } = makeCtx({
        lumpsCache: [{ abstraction: 'Adder', token: '0xabc' }],
    });

    await vm.runInContext('_goToLumpByAbstractionName("Counter")', ctx);

    const elBefore = document.getElementById('fpgaToastEl');
    assert('T6 toast present before timeout',
        elBefore !== null);

    // Advance to the fade-start trigger (2000 ms).
    timers.tick(2000);

    const elAfterFadeStart = document.getElementById('fpgaToastEl');
    assert('T6 toast still in DOM immediately after fade trigger (element not yet removed)',
        elAfterFadeStart !== null);

    assert('T6 toast has fpga-toast-fade class after 2000 ms',
        elAfterFadeStart && elAfterFadeStart.classList.contains('fpga-toast-fade'),
        elAfterFadeStart && elAfterFadeStart.className);

    // Advance through the removal delay (400 ms).
    timers.tick(400);

    const elAfterRemoval = document.getElementById('fpgaToastEl');
    assert('T6 toast element removed from DOM after 2000 + 400 ms',
        elAfterRemoval === null,
        elAfterRemoval && elAfterRemoval.outerHTML);
})();

// ── T7: Second toast dismisses first timer (no stale timers) ─────────────────
(async function t7() {
    const { ctx, document, timers } = makeCtx({
        lumpsCache: [
            { abstraction: 'X', token: '0x1' },
            { abstraction: 'Y', token: '0x2' },
        ],
    });

    // Show first toast.
    await vm.runInContext('_goToLumpByAbstractionName("Counter")', ctx);
    const el1 = document.getElementById('fpgaToastEl');
    assert('T7 first toast in DOM', el1 !== null);

    // Show second toast before the first one expires.
    await vm.runInContext('_goToLumpByAbstractionName("Counter")', ctx);
    const el2 = document.getElementById('fpgaToastEl');
    assert('T7 second toast in DOM', el2 !== null);

    // Advance only the second toast's timer.
    timers.tick(2000);
    timers.tick(400);

    const elFinal = document.getElementById('fpgaToastEl');
    assert('T7 toast removed after second cycle (no ghost from first timer)',
        elFinal === null,
        elFinal && elFinal.outerHTML);
})();

// ── Summary ───────────────────────────────────────────────────────────────────
setTimeout(function() {
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    if (failed > 0) process.exit(1);
}, 50);
