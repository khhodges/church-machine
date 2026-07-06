// test_openin_links.js — regression tests for Task #1988: guard against
// abstraction-name drift silently breaking the symmetric Open-in links
// (Abstraction<->Editor, LUMP<->Abstraction, Editor<->LUMP).
//
// All four cross-view jump paths match a LUMP to its Abstraction by exact
// name string (`l.abstraction === name`). If an abstraction is renamed and
// a lump's sidecar/manifest `abstraction` field is not updated to match (or
// vice versa), the lookup silently fails: no crash, no test failure — just
// a missing button or a "No LUMP found" toast the developer never sees.
//
// This test extracts the REAL production functions (not reimplementations)
// from their source files and exercises them against:
//   1. A known abstraction ("SlideRule") with a matching LUMP + editor
//      context, verifying all four jump directions resolve correctly.
//   2. A deliberately mismatched name (simulating rename drift) for each
//      direction, verifying graceful degradation: no crash, no navigation,
//      and (where applicable) a warning toast.
//
// Exercises:
//   simulator/app-lumps.js — _absOpenInEditorByName, _goToLumpByAbstractionName
//   simulator/app-shell.js — _refreshEditorJumpLinks, _editorJumpToLump,
//                            _editorJumpToAbstraction
//   simulator/app-run.js   — _showFpgaToast, _dismissFpgaToast (toast plumbing)
//
// Run with: node simulator/test_openin_links.js
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { JSDOM } = require('jsdom');

// ── Source extraction (same pattern as lump_warning_test.js) ────────────────
// Pulls a named function (plus any immediately-preceding var/let decls) out
// of the real source file by scanning for balanced braces, so this test
// tracks the production code and does not need its own copy of the logic.
function extractFunctionByName(srcPath, fnName) {
    const src = fs.readFileSync(path.resolve(__dirname, srcPath), 'utf8');
    const lines = src.split('\n');

    const startIdx = lines.findIndex(l =>
        new RegExp(`^(?:async\\s+)?function\\s+${fnName}\\s*\\(`).test(l.trimStart()));
    if (startIdx === -1) throw new Error(`Function ${fnName} not found in ${srcPath}`);

    let declStart = startIdx;
    for (let i = startIdx - 1; i >= 0; i--) {
        const t = lines[i].trim();
        if (/^(?:let|var)\s+/.test(t)) { declStart = i; }
        else if (t === '' || t.startsWith('//')) { continue; }
        else { break; }
    }

    let depth = 0;
    let endIdx = startIdx;
    for (let i = startIdx; i < lines.length; i++) {
        for (const ch of lines[i]) {
            if (ch === '{') depth++;
            else if (ch === '}') { depth--; if (depth === 0) { endIdx = i; break; } }
        }
        if (depth === 0 && i > startIdx) break;
    }

    return lines.slice(declStart, endIdx + 1).join('\n');
}

const TOAST_SRC        = extractFunctionByName('app-run.js', '_dismissFpgaToast') + '\n' +
                          extractFunctionByName('app-run.js', '_showFpgaToast');
const ABS_TO_EDITOR_SRC = extractFunctionByName('app-lumps.js', '_absOpenInEditorByName');
const ABS_TO_LUMP_SRC   = extractFunctionByName('app-lumps.js', '_goToLumpByAbstractionName');
const REFRESH_LINKS_SRC = extractFunctionByName('app-shell.js', '_refreshEditorJumpLinks');
const EDITOR_TO_LUMP_SRC = extractFunctionByName('app-shell.js', '_editorJumpToLump');
const EDITOR_TO_ABS_SRC  = extractFunctionByName('app-shell.js', '_editorJumpToAbstraction');

const ALL_SRC = [TOAST_SRC, ABS_TO_EDITOR_SRC, ABS_TO_LUMP_SRC,
                 REFRESH_LINKS_SRC, EDITOR_TO_LUMP_SRC, EDITOR_TO_ABS_SRC].join('\n\n');

// ── VM context factory ───────────────────────────────────────────────────────
// Builds a jsdom document (with the two editor jump buttons present, matching
// index.html) plus a real _lumpsCache / abstractionRegistry pair and spies for
// every production entry point (switchView, showLumpDetail,
// showAbstractionDetail, openLumpInEditor).
function makeCtx({ lumpsCache = [], abstractions = [], fetchImpl = null } = {}) {
    const dom = new JSDOM(
        '<!DOCTYPE html><body>' +
        '<button id="editorJumpToLumpBtn" style="display:none;"></button>' +
        '<button id="editorJumpToAbsBtn" style="display:none;"></button>' +
        '</body>'
    );
    const document = dom.window.document;

    const calls = {
        switchView: [],
        showLumpDetail: [],
        showAbstractionDetail: [],
        openLumpInEditor: [],
    };

    const registry = {
        getByName(name) {
            return abstractions.find(a => a.name === name) || null;
        },
        getAbstraction(idx) {
            return abstractions.find(a => a.index === idx) || null;
        },
    };

    const sandbox = {
        document,
        setTimeout, clearTimeout,
        Promise,
        window: { _pseudoEditContext: null, _editorLastSavedToken: null, _editorJumpTargets: null },
        _lumpsCache: lumpsCache,
        _pendingLumpAbstractionName: null,
        abstractionRegistry: registry,
        switchView: (v) => calls.switchView.push(v),
        showLumpDetail: (t) => calls.showLumpDetail.push(t),
        showAbstractionDetail: (i) => calls.showAbstractionDetail.push(i),
        openLumpInEditor: async (t) => { calls.openLumpInEditor.push(t); },
        fetch: fetchImpl || (async () => { throw new Error('fetch not configured'); }),
    };

    const ctx = vm.createContext(new Proxy(sandbox, {
        get(target, prop, receiver) {
            if (prop in target) return Reflect.get(target, prop, receiver);
            if (typeof prop === 'string' && prop in globalThis) return globalThis[prop];
            if (typeof prop === 'string' && /^[_a-zA-Z]/.test(prop)) return function() {};
            return undefined;
        },
        set(target, prop, value, receiver) {
            return Reflect.set(target, prop, value, receiver);
        },
        has() { return true; },
    }));

    vm.runInContext(ALL_SRC, ctx, { filename: 'openin-links.js' });

    return { ctx, document, calls, sandbox };
}

// ── Test harness ─────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
function assert(label, condition, detail) {
    if (condition) { console.log('PASS ' + label); passed++; }
    else { console.log('FAIL ' + label + (detail !== undefined ? ' \u2014 ' + detail : '')); failed++; }
}

// Known-good fixture: "SlideRule" abstraction with a matching compiled LUMP.
const SLIDE_RULE_LUMP = { abstraction: 'SlideRule', token: '0x0700' };
const SLIDE_RULE_ABS  = { index: 4, name: 'SlideRule' };

// ── T1: Abstraction -> Editor (name matches) ─────────────────────────────────
(async function t1() {
    const { ctx, calls } = makeCtx({ lumpsCache: [SLIDE_RULE_LUMP] });
    await vm.runInContext('_absOpenInEditorByName("SlideRule")', ctx);
    assert('T1 Abstraction->Editor: openLumpInEditor called with matching token',
        calls.openLumpInEditor[0] === '0x0700', calls.openLumpInEditor);
})();

// ── T2: Abstraction -> LUMP (name matches) ───────────────────────────────────
(async function t2() {
    const { ctx, calls, sandbox } = makeCtx({ lumpsCache: [SLIDE_RULE_LUMP] });
    await vm.runInContext('_goToLumpByAbstractionName("SlideRule")', ctx);
    assert('T2 Abstraction->LUMP: switchView("lumps") called',
        calls.switchView[0] === 'lumps', calls.switchView);
    assert('T2 Abstraction->LUMP: _pendingLumpAbstractionName set',
        vm.runInContext('_pendingLumpAbstractionName', ctx) === 'SlideRule');
})();

// ── T3: Editor -> LUMP and Editor -> Abstraction (editing a saved LUMP) ──────
(async function t3() {
    const { ctx, document, calls } = makeCtx({
        lumpsCache: [SLIDE_RULE_LUMP],
        abstractions: [SLIDE_RULE_ABS],
    });
    vm.runInContext('window._editorLastSavedToken = "0x0700"', ctx);
    await vm.runInContext('_refreshEditorJumpLinks()', ctx);

    const targets = vm.runInContext('window._editorJumpTargets', ctx);
    assert('T3 targets resolved: token', targets.token === '0x0700', targets);
    assert('T3 targets resolved: absIdx', targets.absIdx === 4, targets);

    const lumpBtn = document.getElementById('editorJumpToLumpBtn');
    const absBtn  = document.getElementById('editorJumpToAbsBtn');
    assert('T3 LUMP jump button shown', lumpBtn.style.display === '', lumpBtn.style.display);
    assert('T3 Abstraction jump button shown', absBtn.style.display === '', absBtn.style.display);

    vm.runInContext('_editorJumpToLump()', ctx);
    assert('T3 Editor->LUMP: switchView("lumps")', calls.switchView.includes('lumps'));
    assert('T3 Editor->LUMP: showLumpDetail("0x0700")', calls.showLumpDetail[0] === '0x0700', calls.showLumpDetail);

    vm.runInContext('_editorJumpToAbstraction()', ctx);
    assert('T3 Editor->Abstraction: switchView("abstractions")', calls.switchView.includes('abstractions'));
    assert('T3 Editor->Abstraction: showAbstractionDetail(4)', calls.showAbstractionDetail[0] === 4, calls.showAbstractionDetail);
})();

// ── T4: Editor -> LUMP derived from a catalog-method edit context ────────────
// (absIdx known, token unknown — the reverse derivation direction.)
(async function t4() {
    const { ctx, document } = makeCtx({
        lumpsCache: [SLIDE_RULE_LUMP],
        abstractions: [SLIDE_RULE_ABS],
    });
    vm.runInContext('window._pseudoEditContext = { absIdx: 4 }', ctx);
    await vm.runInContext('_refreshEditorJumpLinks()', ctx);

    const targets = vm.runInContext('window._editorJumpTargets', ctx);
    assert('T4 token derived from abstraction name match', targets.token === '0x0700', targets);
    assert('T4 absIdx passthrough', targets.absIdx === 4, targets);

    const lumpBtn = document.getElementById('editorJumpToLumpBtn');
    assert('T4 LUMP jump button shown', lumpBtn.style.display === '', lumpBtn.style.display);
})();

// ── T5 (DRIFT): Abstraction -> Editor with a mismatched name ─────────────────
// Simulates a lump sidecar/manifest whose `abstraction` field still says the
// OLD name after the abstraction was renamed. The lookup must degrade
// gracefully: warning toast shown, no crash, no editor navigation.
(async function t5() {
    const staleLump = { abstraction: 'SlideRuleOLD', token: '0x0700' };
    const { ctx, document, calls } = makeCtx({ lumpsCache: [staleLump] });

    await vm.runInContext('_absOpenInEditorByName("SlideRule")', ctx);

    assert('T5 DRIFT Abstraction->Editor: openLumpInEditor NOT called',
        calls.openLumpInEditor.length === 0, calls.openLumpInEditor);

    const toastEl = document.getElementById('fpgaToastEl');
    assert('T5 DRIFT Abstraction->Editor: warning toast shown', toastEl !== null);
    const titleEl = toastEl && toastEl.querySelector('.fpga-toast-title');
    assert('T5 DRIFT toast title is "No LUMP found"',
        titleEl && titleEl.textContent === 'No LUMP found', titleEl && titleEl.textContent);
})();

// ── T6 (DRIFT): Abstraction -> LUMP with a mismatched name ───────────────────
(async function t6() {
    const staleLump = { abstraction: 'SlideRuleOLD', token: '0x0700' };
    const { ctx, document, calls } = makeCtx({ lumpsCache: [staleLump] });

    await vm.runInContext('_goToLumpByAbstractionName("SlideRule")', ctx);

    assert('T6 DRIFT Abstraction->LUMP: switchView NOT called (no blind navigation)',
        calls.switchView.length === 0, calls.switchView);

    const toastEl = document.getElementById('fpgaToastEl');
    assert('T6 DRIFT Abstraction->LUMP: warning toast shown', toastEl !== null);
})();

// ── T7 (DRIFT): Editor -> Abstraction with a mismatched name ─────────────────
// The lump on disk still points at the old abstraction name; the registry
// only knows the new one. _refreshEditorJumpLinks must fail to derive an
// absIdx and hide the button rather than jumping to the wrong abstraction
// (or throwing).
(async function t7() {
    const staleLump = { abstraction: 'SlideRuleOLD', token: '0x0700' };
    const { ctx, document, calls } = makeCtx({
        lumpsCache: [staleLump],
        abstractions: [SLIDE_RULE_ABS], // registry only knows "SlideRule"
    });
    vm.runInContext('window._editorLastSavedToken = "0x0700"', ctx);
    await vm.runInContext('_refreshEditorJumpLinks()', ctx);

    const targets = vm.runInContext('window._editorJumpTargets', ctx);
    assert('T7 DRIFT: absIdx could not be resolved (stayed null)', targets.absIdx === null, targets);

    const absBtn = document.getElementById('editorJumpToAbsBtn');
    assert('T7 DRIFT: Abstraction jump button hidden', absBtn.style.display === 'none', absBtn.style.display);

    // Calling the jump function anyway must no-op, not throw or navigate.
    vm.runInContext('_editorJumpToAbstraction()', ctx);
    assert('T7 DRIFT: _editorJumpToAbstraction did not navigate',
        calls.switchView.length === 0 && calls.showAbstractionDetail.length === 0);
})();

// ── T8 (DRIFT): empty/undefined name never crashes any jump function ────────
(async function t8() {
    const { ctx, calls } = makeCtx({ lumpsCache: [SLIDE_RULE_LUMP] });
    let threw = false;
    try {
        await vm.runInContext('_absOpenInEditorByName("")', ctx);
        await vm.runInContext('_goToLumpByAbstractionName("")', ctx);
    } catch (e) { threw = true; }
    assert('T8 empty name: no exception thrown', !threw);
    assert('T8 empty name: no navigation triggered', calls.switchView.length === 0 && calls.openLumpInEditor.length === 0);
})();

// ── Summary ───────────────────────────────────────────────────────────────────
setTimeout(function() {
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    if (failed > 0) process.exit(1);
}, 50);
