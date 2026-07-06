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
const SCROLL_METHOD_SRC = extractFunctionByName('app-lumps.js', '_scrollToLumpMethod');
const REFRESH_LINKS_SRC = extractFunctionByName('app-shell.js', '_refreshEditorJumpLinks');
const EDITOR_TO_LUMP_SRC = extractFunctionByName('app-shell.js', '_editorJumpToLump');
const EDITOR_TO_ABS_SRC  = extractFunctionByName('app-shell.js', '_editorJumpToAbstraction');
// Task #1997: the real version-preference resolver (renderLumps) that decides
// WHICH token _pendingLumpAbstractionName/_pendingLumpMethodName resolve
// against when several lumps share one abstraction name (different versions).
const RENDER_LUMPS_SRC   = extractFunctionByName('app-abstractions.js', 'renderLumps');

const ALL_SRC = [TOAST_SRC, ABS_TO_EDITOR_SRC, ABS_TO_LUMP_SRC, SCROLL_METHOD_SRC,
                 REFRESH_LINKS_SRC, EDITOR_TO_LUMP_SRC, EDITOR_TO_ABS_SRC,
                 RENDER_LUMPS_SRC].join('\n\n');

// ── VM context factory ───────────────────────────────────────────────────────
// Builds a jsdom document (with the two editor jump buttons present, matching
// index.html) plus a real _lumpsCache / abstractionRegistry pair and spies for
// every production entry point (switchView, showLumpDetail,
// showAbstractionDetail, openLumpInEditor).
function makeCtx({ lumpsCache = [], abstractions = [], fetchImpl = null,
                    lumpsListHtmlId = 'lumpsListContent', fastTimers = false } = {}) {
    const dom = new JSDOM(
        '<!DOCTYPE html><body>' +
        '<button id="editorJumpToLumpBtn" style="display:none;"></button>' +
        '<button id="editorJumpToAbsBtn" style="display:none;"></button>' +
        `<div id="${lumpsListHtmlId}"></div>` +
        '</body>'
    );
    const document = dom.window.document;

    const calls = {
        switchView: [],
        showLumpDetail: [],
        showAbstractionDetail: [],
        openLumpInEditor: [],
        switchLumpTab: [],
    };

    const registry = {
        getByName(name) {
            return abstractions.find(a => a.name === name) || null;
        },
        getAbstraction(idx) {
            return abstractions.find(a => a.index === idx) || null;
        },
    };

    // fastTimers: used by tests that exercise _scrollToLumpMethod's retry
    // poll (up to 40 * 100ms) via renderLumps rather than calling it
    // directly with a pre-set _attempt — collapses only the poll's known
    // 100ms retry interval to 0ms so a full "not found" degrade path runs
    // in milliseconds. Other delays (e.g. the toast's own 2000ms/400ms
    // auto-dismiss timers) are left untouched so the toast is still present
    // when the test asserts on it shortly afterward.
    const timeoutFn = fastTimers ? (fn, ms) => setTimeout(fn, ms === 100 ? 0 : ms) : setTimeout;

    const sandbox = {
        document,
        setTimeout: timeoutFn, clearTimeout,
        Promise,
        window: { _pseudoEditContext: null, _editorLastSavedToken: null, _editorJumpTargets: null,
                  _pendingLumpTab: null, _pendingLumpToken: null },
        _lumpsCache: lumpsCache,
        _pendingLumpAbstractionName: null,
        _pendingLumpMethodName: null,
        _lumpSortOrder: 'name',
        abstractionRegistry: registry,
        switchView: (v) => calls.switchView.push(v),
        showLumpDetail: (t) => calls.showLumpDetail.push(t),
        showAbstractionDetail: (i) => calls.showAbstractionDetail.push(i),
        openLumpInEditor: async (t) => { calls.openLumpInEditor.push(t); },
        fetch: fetchImpl || (async () => { throw new Error('fetch not configured'); }),
        // Minimal real behaviour (not spies) so renderLumps' own control flow
        // (which relies on the sorted array + escaped html) does not throw
        // before reaching the version-resolution / drill-down logic under test.
        _lumpsSorted: (lumps) => lumps.slice(),
        _escHtml: (s) => String(s == null ? '' : s),
        _lumpDateStr: () => '',
        _getLiveLumpState: () => null,
        updateLiveLumpBanner: () => {},
        _updateLumpRepoCount: () => {},
        _switchLumpTab: (tk, tab) => calls.switchLumpTab.push([tk, tab]),
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
let pendingAsync = 0;
function assert(label, condition, detail) {
    if (condition) { console.log('PASS ' + label); passed++; }
    else { console.log('FAIL ' + label + (detail !== undefined ? ' \u2014 ' + detail : '')); failed++; }
}
// Long-running async tests (real setTimeout polling, e.g. T13) register
// themselves here so the summary below waits for them instead of racing a
// fixed delay against their completion.
function trackAsync(promise) {
    pendingAsync++;
    return promise.finally(() => { pendingAsync--; });
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

// ── T9: Abstraction -> LUMP with a method name drills into the Content tab ──
// _goToLumpByAbstractionName(name, methodName) should still navigate to the
// LUMP Browser (same as T2) but must also stash the method name so the
// caller (renderLumps in app-abstractions.js) can request the Content tab
// and scroll to that method's card once it renders.
(async function t9() {
    const { ctx, calls } = makeCtx({ lumpsCache: [SLIDE_RULE_LUMP] });
    await vm.runInContext('_goToLumpByAbstractionName("SlideRule", "Compute")', ctx);
    assert('T9 Abstraction->LUMP (method): switchView("lumps") called',
        calls.switchView[0] === 'lumps', calls.switchView);
    assert('T9 Abstraction->LUMP (method): _pendingLumpMethodName set',
        vm.runInContext('_pendingLumpMethodName', ctx) === 'Compute');
})();

// ── T10: _scrollToLumpMethod finds, expands, and highlights a method card ───
(async function t10() {
    const { ctx, document } = makeCtx({});
    const panel = document.createElement('div');
    panel.id = 'lumpTabContent_0700';
    panel.innerHTML =
        '<div class="lump-method-card" data-collapsed="1" data-method-name="Compute">card body</div>';
    document.body.appendChild(panel);
    vm.runInContext('_scrollToLumpMethod("0700", "Compute")', ctx);
    const card = panel.querySelector('.lump-method-card');
    assert('T10 method card expanded', card.getAttribute('data-collapsed') === '0');
    assert('T10 method card highlighted', card.classList.contains('lump-method-card-highlight'));
})();

// ── T11 (DRIFT): _scrollToLumpMethod on a missing method name does not crash
(async function t11() {
    const { ctx, document } = makeCtx({});
    const panel = document.createElement('div');
    panel.id = 'lumpTabContent_0700';
    panel.innerHTML = '<div class="lump-method-card" data-collapsed="1" data-method-name="Other">x</div>';
    document.body.appendChild(panel);
    let threw = false;
    try {
        vm.runInContext('_scrollToLumpMethod("0700", "Missing", 40)', ctx);
    } catch (e) { threw = true; }
    assert('T11 DRIFT: missing method name does not throw', !threw);
})();

// ── T12: _scrollToLumpMethod after a mid-session Content-tab reload
// (LUMP shrunk / re-forked) targets the freshly-rendered card, not a
// detached reference from the render that existed before the reload ────────
// Simulates: user drills into "Compute" while the OLD render is showing ->
// LUMP gets Shrunk/re-forked -> caller does `delete _lumpContentLoaded[tk]`
// and re-fetches -> _renderLumpCodeContent wipes bodyEl.innerHTML and
// builds all-new `.lump-method-card` elements (new DOM node identities,
// same data-method-name) -> a second drill-down into "Compute" must land
// on the NEW card and must never mutate the OLD, now-detached one.
(async function t12() {
    const { ctx, document } = makeCtx({});
    const panel = document.createElement('div');
    panel.id = 'lumpTabContent_0700';
    document.body.appendChild(panel);

    const bodyEl = document.createElement('div');
    bodyEl.id = 'lumpContentBody_0700';
    panel.appendChild(bodyEl);

    // Pre-resize render: stale card, already visited once (collapsed=0).
    bodyEl.innerHTML = '<div class="lump-method-card" data-collapsed="0" ' +
        'data-method-name="Compute" data-body="stale-13-words">card body OLD</div>';
    const oldCard = bodyEl.querySelector('.lump-method-card');
    oldCard.classList.add('lump-method-card-highlight');

    // Drill-down #1 (pre-resize): resolves the OLD card, as expected.
    vm.runInContext('_scrollToLumpMethod("0700", "Compute")', ctx);
    assert('T12 pre-resize drill-down hits the pre-existing card',
        bodyEl.querySelector('.lump-method-card') === oldCard);

    // Simulate Shrink/re-fork: caller does `delete _lumpContentLoaded[tk]`
    // and `_loadLumpContent` -> `_renderLumpCodeContent` re-fetches and
    // wipes bodyEl.innerHTML, building a brand-new card for the same
    // method name (auto-detected boundary this time, e.g. after Shrink
    // collapsed the manifest methods array to zero entries).
    oldCard.remove(); // now fully detached — must never be touched again
    bodyEl.innerHTML = '<div class="lump-method-card" data-collapsed="1" ' +
        'data-method-name="Compute" data-body="fresh-4-words">card body NEW</div>';
    const newCard = bodyEl.querySelector('.lump-method-card');

    // Drill-down #2 (post-resize): must resolve to the NEW card only.
    vm.runInContext('_scrollToLumpMethod("0700", "Compute")', ctx);

    assert('T12 post-resize drill-down expands the NEW card',
        newCard.getAttribute('data-collapsed') === '0');
    assert('T12 post-resize drill-down highlights the NEW card',
        newCard.classList.contains('lump-method-card-highlight'));
    assert('T12 post-resize drill-down never re-touches the detached OLD card',
        oldCard.getAttribute('data-collapsed') === '0' && !oldCard.isConnected,
        { collapsed: oldCard.getAttribute('data-collapsed'), connected: oldCard.isConnected });
})();

// ── T13: _scrollToLumpMethod polling picks up a card that only appears
// AFTER the reload finishes (Content tab was mid-fetch when the jump was
// requested — the realistic race after a Shrink/re-fork navigation) ───────
trackAsync((async function t13() {
    const { ctx, document } = makeCtx({});
    const panel = document.createElement('div');
    panel.id = 'lumpTabContent_0700';
    document.body.appendChild(panel);

    const bodyEl = document.createElement('div');
    bodyEl.id = 'lumpContentBody_0700';
    bodyEl.className = 'lump-hex-loading';
    bodyEl.textContent = 'Loading\u2026';
    panel.appendChild(bodyEl);

    // Kick off the drill-down while the Content tab is still loading
    // (attempt 0 finds nothing and schedules a retry ~100ms out).
    vm.runInContext('_scrollToLumpMethod("0700", "Compute")', ctx);
    assert('T13 no card yet: nothing to expand', bodyEl.querySelector('.lump-method-card') === null);

    // Reload completes mid-poll: bodyEl is repopulated with the new card
    // (auto-detected boundary, marked with the "[~]" UI badge elsewhere,
    // but the data-method-name attribute itself stays the plain name).
    await new Promise(resolve => setTimeout(resolve, 30));
    bodyEl.className = '';
    bodyEl.innerHTML = '<div class="lump-method-card" data-collapsed="1" ' +
        'data-method-name="Compute">card body (auto-detected)</div>';
    const card = bodyEl.querySelector('.lump-method-card');

    // Wait past the 100ms retry interval for the poll to catch the new card.
    await new Promise(resolve => setTimeout(resolve, 200));
    assert('T13 poll finds the card once it appears', card.getAttribute('data-collapsed') === '0');
    assert('T13 poll highlights the newly-appeared card',
        card.classList.contains('lump-method-card-highlight'));
})());

// ── T14 (Task #1997): drill-down survives renderLumps() re-resolving
// _selectedLumpToken to a DIFFERENT lump version than the one the user was
// looking at when they double-clicked a method.
//
// Two lumps share the abstraction name "Widget" but are different
// tokens/versions with disjoint method sets:
//   - WIDGETBOOT — boot-resident (ns_slot set, no version), has "MethodX".
//   - WIDGETV2FLOAT — a newer, versioned floating fork, has "MethodY" only.
// renderLumps()'s "prefer user-saved (versioned, floating) over
// boot-resident" rule (app-abstractions.js ~566-569) must pick
// WIDGETV2FLOAT over WIDGETBOOT. The drill-down must then be attempted
// against the RESOLVED token (WIDGETV2FLOAT), not whatever token was
// selected before renderLumps ran — and since "MethodX" does not exist on
// WIDGETV2FLOAT, it must degrade to the not-found toast rather than
// silently matching same-named-but-wrong-version content.
trackAsync((async function t14() {
    const WIDGET_BOOT  = { abstraction: 'Widget', token: 'WIDGETBOOT',    version: null, ns_slot: 5 };
    const WIDGET_V2     = { abstraction: 'Widget', token: 'WIDGETV2FLOAT', version: 2,    ns_slot: null };
    const lumps = [WIDGET_BOOT, WIDGET_V2];

    const { ctx, document, calls } = makeCtx({
        lumpsCache: lumps,
        fastTimers: true,
        fetchImpl: async () => ({ ok: true, json: async () => lumps }),
    });

    // Simulate the user having been on the boot-resident version and
    // double-clicking "MethodX" (only present there) to jump to the LUMP.
    await vm.runInContext('_goToLumpByAbstractionName("Widget", "MethodX")', ctx);
    assert('T14 setup: switchView("lumps") called', calls.switchView[0] === 'lumps', calls.switchView);
    assert('T14 setup: _pendingLumpAbstractionName set to "Widget"',
        vm.runInContext('_pendingLumpAbstractionName', ctx) === 'Widget');
    assert('T14 setup: _pendingLumpMethodName set to "MethodX"',
        vm.runInContext('_pendingLumpMethodName', ctx) === 'MethodX');

    // The Content tab (for whichever token gets resolved) only has "MethodY"
    // rendered — matching WIDGETV2FLOAT's real method set, not WIDGETBOOT's.
    const panel = document.createElement('div');
    panel.id = 'lumpTabContent_WIDGETV2FLOAT';
    panel.innerHTML = '<div class="lump-method-card" data-collapsed="1" data-method-name="MethodY">card body</div>';
    document.body.appendChild(panel);
    // A same-named "MethodX" card also exists under the STALE boot token's
    // panel, simulating the old version's content still being cached in the
    // DOM from a prior view — it must never be the one that gets matched.
    const stalePanel = document.createElement('div');
    stalePanel.id = 'lumpTabContent_WIDGETBOOT';
    stalePanel.innerHTML = '<div class="lump-method-card" data-collapsed="1" data-method-name="MethodX">stale card</div>';
    document.body.appendChild(stalePanel);
    const staleCard = stalePanel.querySelector('.lump-method-card');

    // renderLumps() is what actually resolves _pendingLumpAbstractionName
    // against the live lump list — this is the "pick a different LUMP
    // version" step under test.
    await vm.runInContext('renderLumps()', ctx);

    assert('T14 renderLumps resolved _selectedLumpToken to the versioned floating fork (not boot-resident)',
        vm.runInContext('_selectedLumpToken', ctx) === 'WIDGETV2FLOAT',
        vm.runInContext('_selectedLumpToken', ctx));
    assert('T14 renderLumps requested the Content tab for the RESOLVED token',
        calls.switchLumpTab.length === 1 && calls.switchLumpTab[0][0] === 'WIDGETV2FLOAT' && calls.switchLumpTab[0][1] === 'content',
        calls.switchLumpTab);
    assert('T14 showLumpDetail called with the resolved token',
        calls.showLumpDetail.includes('WIDGETV2FLOAT'), calls.showLumpDetail);

    // Give the (fast-timer) retry poll a moment to exhaust its attempts —
    // it must give up on the resolved token's panel (which only has
    // MethodY) rather than silently finding/highlighting the stale
    // same-named "MethodX" card that still lives under the OLD token's panel.
    // 40 attempts * setTimeout(fn, 0) still costs Node's ~1ms floor per hop.
    await new Promise(resolve => setTimeout(resolve, 500));

    const toastEl = document.getElementById('fpgaToastEl');
    assert('T14 DRIFT: method-not-found toast shown for the resolved (v2) token, not a false match',
        toastEl !== null);
    const titleEl = toastEl && toastEl.querySelector('.fpga-toast-title');
    assert('T14 toast title is "Method not found"',
        titleEl && titleEl.textContent === 'Method not found', titleEl && titleEl.textContent);
    assert('T14 the stale same-named card under the OLD token panel was never touched',
        staleCard.getAttribute('data-collapsed') === '1' && !staleCard.classList.contains('lump-method-card-highlight'),
        { collapsed: staleCard.getAttribute('data-collapsed'), highlighted: staleCard.classList.contains('lump-method-card-highlight') });
})());

// ── Summary ───────────────────────────────────────────────────────────────────
(function waitAndSummarize() {
    setTimeout(function() {
        if (pendingAsync > 0) { waitAndSummarize(); return; }
        console.log('\n' + passed + ' passed, ' + failed + ' failed');
        if (failed > 0) process.exit(1);
    }, 50);
})();
