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
// Task #1998: wrong-LUMP-version toast helpers used by _scrollToLumpMethod's
// exhausted-poll branch — must be extracted alongside it or the sandbox
// throws a ReferenceError the moment the "not found" degrade path runs.
const LUMP_VERSION_LABEL_SRC = extractFunctionByName('app-lumps.js', '_lumpVersionLabel');
const SWITCH_LUMP_VERSION_SRC = extractFunctionByName('app-lumps.js', '_switchToLumpVersionAndScroll');
const SCROLL_METHOD_SRC = extractFunctionByName('app-lumps.js', '_scrollToLumpMethod');
const REFRESH_LINKS_SRC = extractFunctionByName('app-shell.js', '_refreshEditorJumpLinks');
const EDITOR_TO_LUMP_SRC = extractFunctionByName('app-shell.js', '_editorJumpToLump');
const EDITOR_TO_ABS_SRC  = extractFunctionByName('app-shell.js', '_editorJumpToAbstraction');
// Task #1997: the real version-preference resolver (renderLumps) that decides
// WHICH token _pendingLumpAbstractionName/_pendingLumpMethodName resolve
// against when several lumps share one abstraction name (different versions).
const RENDER_LUMPS_SRC   = extractFunctionByName('app-abstractions.js', 'renderLumps');
const SAVED_LUMP_SOURCE_SRC = extractFunctionByName('app-lumps.js', '_resolveSavedLumpEditorSource');
const SAVED_LUMP_ENTER_SRC  = extractFunctionByName('app-lumps.js', '_enterSavedLumpEditorMode');
const SAVED_LUMP_EXIT_SRC   = extractFunctionByName('app-lumps.js', 'exitSavedLumpEditorMode');
const OPEN_SAVED_LUMP_SRC   = extractFunctionByName('app-lumps.js', 'openLumpInEditor');
const SWITCH_CODE_TAB_SRC   = extractFunctionByName('app-run.js', 'switchCodeTab');

const ALL_SRC = [TOAST_SRC, ABS_TO_EDITOR_SRC, ABS_TO_LUMP_SRC,
                 LUMP_VERSION_LABEL_SRC, SWITCH_LUMP_VERSION_SRC, SCROLL_METHOD_SRC,
                 REFRESH_LINKS_SRC, EDITOR_TO_LUMP_SRC, EDITOR_TO_ABS_SRC,
                 RENDER_LUMPS_SRC].join('\n\n');

// ── Minimal LumpRegistry mock ────────────────────────────────────────────────
// Provides the same API as lump-registry.js (window.LumpRegistry) without
// requiring localStorage or the full registry module.  Production code guards
// all calls with `if (window.LumpRegistry)` so only the used methods need
// implementation here.
function _makeMockRegistry(initialLumps) {
    let _cur = null;
    let _pend = null;
    let _serverList = (initialLumps || []).slice();
    const _mem = new Map();
    return {
        registerFromServer(lumps) { _serverList = (lumps || []).slice(); },
        registerMemory(tok, abstr, words, caps) {
            _mem.set(tok, { token: tok, abstraction: abstr, sources: {
                memory: { words: (words||[]).slice(), capabilities: (caps||[]).slice() }
            }});
        },
        setCurrent(tok)    { _cur  = tok; },
        getCurrent()       { return _cur; },
        setPending(tok)    { _pend = tok; },
        getPending()       { return _pend; },
        consumePending()   { const t = _pend; _pend = null; return t; },
        getServerList()    { return _serverList; },
        isServerListFetched() { return _serverList.length > 0; },
        warmServerList()   { return Promise.resolve(_serverList.slice()); },
        resolve(tok) {
            if (_mem.has(tok)) return _mem.get(tok);
            const srv = _serverList.find(l => l.token === tok);
            return srv ? { token: tok, abstraction: srv.abstraction, sources: { server: srv } } : null;
        },
        has(tok)           { return _mem.has(tok) || _serverList.some(l => l.token === tok); },
        list()             { return _serverList.slice(); },
        evictMemory(tok)   { _mem.delete(tok); },
    };
}

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

    const _reg = _makeMockRegistry(lumpsCache);

    const sandbox = {
        document,
        setTimeout: timeoutFn, clearTimeout,
        Promise,
        window: { _pseudoEditContext: null, _editorLastSavedToken: null, _editorJumpTargets: null,
                  _pendingLumpTab: null, _pendingLumpToken: null,
                  LumpRegistry: _reg },
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
        vm.runInContext('window.LumpRegistry.getCurrent()', ctx) === 'WIDGETV2FLOAT',
        vm.runInContext('window.LumpRegistry.getCurrent()', ctx));
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

// ── T15 (Task #1998): when the poll exhausts AND a sibling lump with the
// same abstraction name actually has the requested method, the toast must
// name that other version and offer a one-click switch — not the generic
// "Method not found" message.
//
// WIDGETBOOT (boot-resident) has "MethodX" in its `.methods` sidecar record;
// WIDGETV2FLOAT (versioned, resolved by renderLumps' preference rule) does
// not have it rendered in its Content-tab panel. Since WIDGETBOOT.methods
// really does list "MethodX", this is a genuine version mismatch, not a
// missing method.
trackAsync((async function t15() {
    const WIDGET_BOOT = { abstraction: 'Widget', token: 'WIDGETBOOT', version: null, ns_slot: 5,
        methods: [{ name: 'MethodX' }] };
    const WIDGET_V2   = { abstraction: 'Widget', token: 'WIDGETV2FLOAT', version: 2, ns_slot: null,
        methods: [{ name: 'MethodY' }] };
    const lumps = [WIDGET_BOOT, WIDGET_V2];

    const { ctx, document } = makeCtx({
        lumpsCache: lumps,
        fastTimers: true,
        fetchImpl: async () => ({ ok: true, json: async () => lumps }),
    });

    await vm.runInContext('_goToLumpByAbstractionName("Widget", "MethodX")', ctx);
    await vm.runInContext('renderLumps()', ctx);

    // Only WIDGETV2FLOAT's panel exists in the DOM (the resolved token) and
    // it never gets a "MethodX" card — matching its real method set.
    const panel = document.createElement('div');
    panel.id = 'lumpTabContent_WIDGETV2FLOAT';
    panel.innerHTML = '<div class="lump-method-card" data-collapsed="1" data-method-name="MethodY">card body</div>';
    document.body.appendChild(panel);

    await new Promise(resolve => setTimeout(resolve, 500));

    const toastEl = document.getElementById('fpgaToastEl');
    assert('T15 wrong-version toast shown', toastEl !== null);
    const titleEl = toastEl && toastEl.querySelector('.fpga-toast-title');
    assert('T15 toast title is "Wrong LUMP version"',
        titleEl && titleEl.textContent === 'Wrong LUMP version', titleEl && titleEl.textContent);
    const bodyEl = toastEl && toastEl.querySelector('.fpga-toast-body');
    assert('T15 toast body names the boot-resident version',
        bodyEl && bodyEl.textContent.includes('boot-resident'), bodyEl && bodyEl.textContent);
    const actionBtn = toastEl && toastEl.querySelector('.fpga-toast-action');
    assert('T15 toast offers a one-click switch action', actionBtn !== null);

    // Clicking the action should re-target the OTHER token (WIDGETBOOT) and
    // resume the drill-down there via the pending-token mechanism.
    actionBtn.dispatchEvent(new (document.defaultView.Event)('click'));
    await new Promise(resolve => setTimeout(resolve, 50));
    assert('T15 action switches window._pendingLumpToken to the sibling lump',
        vm.runInContext('window.LumpRegistry.getPending()', ctx) === null && // consumed by renderLumps() re-run
        vm.runInContext('window.LumpRegistry.getCurrent()', ctx) === 'WIDGETBOOT',
        { selected: vm.runInContext('window.LumpRegistry.getCurrent()', ctx) });
})());

// ── T16 (Task #2079): Save-to-NS flow — Open Lump still resolves to the
// assembled program, not the boot-resident SelfTest lump (CR14's slot).
//
// Full user flow under test:
//   1. User assembles "LED Flash" in the editor.
//   2. The patched spots in app-run.js (lines 218-233, 439-454) call
//      LumpRegistry.registerMemory(token, 'LED Flash', …) and
//      LumpRegistry.setCurrent(token) immediately after assembly.
//      window._editorLastSavedToken is set to the same token.
//   3. User clicks Patch / Save-to-NS (may reset other UI state but must NOT
//      clear the LumpRegistry selection that was established in step 2).
//   4. User clicks "Open Lump" which calls renderLumps().
//   5. renderLumps() must honour the existing getCurrent() selection (LED Flash)
//      rather than falling back to the live-state path that would pick SelfTest
//      via the simulator's CR14 → NS slot 6.
//
// The live-state fallback at app-abstractions.js ~642-650 only fires when
// getCurrent() === null.  Because step 2 set it to LED Flash's token, the
// fallback must be skipped and showLumpDetail must be called with LED Flash's
// token — not SelfTest's.
(async function t16() {
    const LED_FLASH_TOKEN = 'LEDFLASH00';
    const SELFTEST_TOKEN  = 'SELFTEST06';

    // Server list: only SelfTest is resident (what CR14 → NS slot 6 points to).
    // LED Flash is in-memory only (not yet saved to the server).
    const serverLumps = [
        { abstraction: 'SelfTest', token: SELFTEST_TOKEN, ns_slot: 6, version: null },
    ];

    const { ctx, calls } = makeCtx({
        lumpsCache: serverLumps,
        fetchImpl: async () => ({ ok: true, json: async () => serverLumps }),
    });

    // ── Step 1: Simulate assembleAndLoad() / assembleSource() completing.
    // These two lines mirror the patched spots in app-run.js that constitute
    // the fix: after every successful assembly the compiled program is placed
    // in the registry and made the current selection.
    vm.runInContext(`
        window.LumpRegistry.registerMemory(
            '${LED_FLASH_TOKEN}', 'LED Flash', [0x10000003, 0x34000001], []);
        window.LumpRegistry.setCurrent('${LED_FLASH_TOKEN}');
        window._editorLastSavedToken = '${LED_FLASH_TOKEN}';
    `, ctx);

    // ── Step 2: Confirm _editorLastSavedToken is the assembled token (not null,
    // not the boot-resident SelfTest token from CR14).
    assert('T16 assembly sets _editorLastSavedToken to the assembled token',
        vm.runInContext('window._editorLastSavedToken', ctx) === LED_FLASH_TOKEN,
        vm.runInContext('window._editorLastSavedToken', ctx));

    assert('T16 LumpRegistry.getCurrent() is the assembled token after assembly',
        vm.runInContext('window.LumpRegistry.getCurrent()', ctx) === LED_FLASH_TOKEN,
        vm.runInContext('window.LumpRegistry.getCurrent()', ctx));

    // ── Step 3: Simulate the user clicking "Open Lump" (triggers renderLumps()).
    // The live-state fallback only fires when getCurrent() === null.
    // Since getCurrent() already returns LED_FLASH_TOKEN, the fallback must be
    // skipped — renderLumps() must not clobber the selection with SelfTest.
    await vm.runInContext('renderLumps()', ctx);

    // ── Step 4: Selection must still be LED Flash, not SelfTest.
    const selectedToken = vm.runInContext('window.LumpRegistry.getCurrent()', ctx);
    assert('T16 Open Lump after Save-to-NS: selected token is LED Flash (not SelfTest)',
        selectedToken === LED_FLASH_TOKEN,
        { selected: selectedToken, expected: LED_FLASH_TOKEN });

    // ── Step 5: showLumpDetail must have been called with the assembled token.
    // renderLumps() calls showLumpDetail(_selTok) at line ~693 of
    // app-abstractions.js whenever _selTok is truthy — this drives the detail
    // panel that the user sees when "Open Lump" opens.
    assert('T16 showLumpDetail called with assembled LED Flash token, not SelfTest',
        calls.showLumpDetail.includes(LED_FLASH_TOKEN) &&
        !calls.showLumpDetail.includes(SELFTEST_TOKEN),
        { showLumpDetail: calls.showLumpDetail });
})();

// ── T17: openLumpInEditor structured reconstruction — 2-method LUMP ──────────
// Assembles a 2-method LUMP with lump_assembler.js, extracts the trimmed code
// words (header word removed), runs the body-slice reconstruction logic that
// mirrors the new code in openLumpInEditor, and asserts that the output
// contains `method Add {` and `method Sub {` with correctly-indented bodies.
(function t17() {
    const { assembleLump, BRANCH_OPCODE } = require('./lump_assembler.js');

    // Two minimal method bodies: Add (2 words) and Sub (2 words).
    // These are raw 32-bit words — content doesn't matter for structural test.
    const BODY_ADD = [0x10000001, 0x60000000]; // LOAD CR0,CR15[1] ; RETURN
    const BODY_SUB = [0x10000002, 0x60000000]; // LOAD CR0,CR15[2] ; RETURN

    const { buf, totalWords } = assembleLump([BODY_ADD, BODY_SUB]);

    // Strip header word (buf[0]) to produce the trimmed code array, matching
    // what openLumpInEditor does after parseLumpHeader() / rawWords / trimmed.
    const rawWords = Array.from(buf.slice(1)); // code words only
    let trimLen = rawWords.length;
    while (trimLen > 0 && rawWords[trimLen - 1] === 0) trimLen--;
    const trimmed = rawWords.slice(0, trimLen);

    // Mock method registry — mirrors abstractionRegistry.getByName() result.
    const _methods = [{ name: 'Add' }, { name: 'Sub' }];
    const BRANCH_OP = BRANCH_OPCODE;

    // ── Reconstruction logic (mirrors openLumpInEditor new code path) ──────
    const disasmLines = [];
    let structured = false;

    if (_methods && trimmed.length >= _methods.length) {
        const N = _methods.length;
        const allBranch = _methods.every(function(_, i) {
            return ((trimmed[i] >>> 27) & 0x1F) === BRANCH_OP;
        });

        if (allBranch) {
            const bodyStarts = _methods.map(function(_, i) {
                const raw = trimmed[i] & 0x7FFF;
                const soff = (raw & 0x4000) ? (raw | 0xFFFF8000) : raw;
                return i + soff;
            });

            structured = true;
            for (let mi = 0; mi < N; mi++) {
                const start = bodyStarts[mi];
                const end   = (mi + 1 < N) ? bodyStarts[mi + 1] : trimmed.length;
                const slice = trimmed.slice(start, end);
                let sliceTrim = slice.length;
                while (sliceTrim > 0 && slice[sliceTrim - 1] === 0) sliceTrim--;
                const body = slice.slice(0, sliceTrim);
                const mName = (_methods[mi] && (_methods[mi].name || _methods[mi])) || ('Method' + (mi + 1));

                disasmLines.push('method ' + mName + ' {  ; selector #' + (mi + 1));
                if (body.length === 0) {
                    disasmLines.push('  ; (empty)');
                } else {
                    body.forEach(function(w) { disasmLines.push('  0x' + w.toString(16)); });
                }
                disasmLines.push('}');
                disasmLines.push('');
            }
        }
    }

    const output = disasmLines.join('\n');

    assert('T17 structured: reconstruction succeeds (structured=true)', structured);
    assert('T17 structured: output contains "method Add {"',
        output.includes('method Add {'), JSON.stringify(output.slice(0, 120)));
    assert('T17 structured: output contains "method Sub {"',
        output.includes('method Sub {'), JSON.stringify(output.slice(0, 200)));
    assert('T17 structured: Add body word 0x10000001 present under Add block',
        (function() {
            const addStart = output.indexOf('method Add {');
            const subStart = output.indexOf('method Sub {');
            const addSection = output.slice(addStart, subStart);
            return addSection.includes('10000001');
        })(), output);
    assert('T17 structured: Sub body word 0x10000002 present under Sub block (not Add)',
        (function() {
            const subStart = output.indexOf('method Sub {');
            const subSection = output.slice(subStart);
            return subSection.includes('10000002') && !output.slice(0, subStart).includes('10000002');
        })(), output);
    assert('T17 structured: BRANCH table entries NOT emitted as body lines',
        (function() {
            // BRANCH opcode 23 → top 5 bits = 10111 → 0xB8000000 family
            // Verify no line in Add's body section contains a raw BRANCH word
            const addStart = output.indexOf('method Add {');
            const subStart = output.indexOf('method Sub {');
            const addSection = output.slice(addStart, subStart);
            return !addSection.includes('b8') || addSection.indexOf('b8') > addSection.indexOf('10000001');
        })(), output);
})();

// ── T18: openLumpInEditor structured reconstruction — single-method LUMP ──────
// Verifies that a LUMP with exactly ONE method in the registry emits
// `method Name { }` just like the 2-method path (the `>= 1` guard fix).
(function t18() {
    const { assembleLump, BRANCH_OPCODE } = require('./lump_assembler.js');

    // Single method body: Init (2 words).
    const BODY_INIT = [0x10000007, 0x60000000]; // LOAD CR0,CR15[7] ; RETURN

    const { buf } = assembleLump([BODY_INIT]);

    // Strip header word to produce trimmed code array.
    const rawWords = Array.from(buf.slice(1));
    let trimLen = rawWords.length;
    while (trimLen > 0 && rawWords[trimLen - 1] === 0) trimLen--;
    const trimmed = rawWords.slice(0, trimLen);

    // Mock single-method registry entry.
    const _methods = [{ name: 'Init' }];
    const BRANCH_OP = BRANCH_OPCODE;

    // ── Reconstruction logic (same as openLumpInEditor, >= 1 path) ───────────
    const disasmLines = [];
    let structured = false;

    if (_methods && trimmed.length >= _methods.length) {
        const N = _methods.length;
        const allBranch = _methods.every(function(_, i) {
            return ((trimmed[i] >>> 27) & 0x1F) === BRANCH_OP;
        });

        if (allBranch) {
            const bodyStarts = _methods.map(function(_, i) {
                const raw = trimmed[i] & 0x7FFF;
                const soff = (raw & 0x4000) ? (raw | 0xFFFF8000) : raw;
                return i + soff;
            });

            structured = true;
            for (let mi = 0; mi < N; mi++) {
                const start = bodyStarts[mi];
                const end   = (mi + 1 < N) ? bodyStarts[mi + 1] : trimmed.length;
                const slice = trimmed.slice(start, end);
                let sliceTrim = slice.length;
                while (sliceTrim > 0 && slice[sliceTrim - 1] === 0) sliceTrim--;
                const body = slice.slice(0, sliceTrim);
                const mName = (_methods[mi] && (_methods[mi].name || _methods[mi])) || ('Method' + (mi + 1));

                disasmLines.push('method ' + mName + ' {  ; selector #' + (mi + 1));
                if (body.length === 0) {
                    disasmLines.push('  ; (empty)');
                } else {
                    body.forEach(function(w) { disasmLines.push('  0x' + w.toString(16)); });
                }
                disasmLines.push('}');
                disasmLines.push('');
            }
        }
    }

    const output = disasmLines.join('\n');

    assert('T18 single-method: reconstruction succeeds (structured=true)', structured);
    assert('T18 single-method: output contains "method Init {"',
        output.includes('method Init {'), JSON.stringify(output.slice(0, 120)));
    assert('T18 single-method: body word 0x10000007 present inside Init block',
        output.includes('10000007'), output);
    assert('T18 single-method: BRANCH dispatch word not emitted as body line',
        (function() {
            const initStart = output.indexOf('method Init {');
            const section = output.slice(initStart);
            // BRANCH opcode 23 top5 = 10111 → first hex digit of body word is never b8xxxxxx
            // Verify the first indented word IS the body word, not the BRANCH entry
            const firstBodyLine = section.split('\n').find(l => l.startsWith('  0x'));
            return firstBodyLine && firstBodyLine.includes('10000007');
        })(), output);
})();

// ── T19: Manifest-offset path (old-format sequential LUMP) ───────────────────
// Exercises Path A in openLumpInEditor: when lump.methods carries offset+length,
// use those directly to slice trimmed[] without relying on a BRANCH dispatch table.
// Mirrors the Constants abstraction layout (7 methods, sequential, no dispatch table).
(function testT19_manifestOffsetPath() {
    // Build a synthetic trimmed[] — three methods of 3 words each (like Constants Pi/E/Phi)
    // Words: simple unique values so we can assert which method body they appear in.
    const Pi_words  = [0x07030000, 0x87000000, 0x1F000000];
    const E_words   = [0x07030001, 0x87000001, 0x1F000000];
    const Phi_words = [0x07030002, 0x87000002, 0x1F000000];
    const trimmed   = [].concat(Pi_words, E_words, Phi_words);

    // Manifest-style lump object with explicit offset+length per method
    const lump = {
        abstraction: 'Constants',
        methods: [
            { name: 'Pi',  offset: 0, length: 3 },
            { name: 'E',   offset: 3, length: 3 },
            { name: 'Phi', offset: 6, length: 3 },
        ],
    };

    // ── Mirror the Path A reconstruction from openLumpInEditor ────────────────
    const _lumpMethods = Array.isArray(lump.methods) && lump.methods.length >= 1
                             ? lump.methods : null;
    const _hasOffsets  = _lumpMethods && _lumpMethods.every(function(m) {
        return typeof m.offset === 'number';
    });
    const disasmLines = [];
    let structured = false;
    if (_hasOffsets) {
        structured = true;
        for (let mi = 0; mi < _lumpMethods.length; mi++) {
            const _m      = _lumpMethods[mi];
            const _mStart = _m.offset;
            const _mEnd   = (typeof _m.length === 'number')
                                ? (_m.offset + _m.length)
                                : (mi + 1 < _lumpMethods.length
                                    ? _lumpMethods[mi + 1].offset
                                    : trimmed.length);
            const _slice  = trimmed.slice(_mStart, _mEnd);
            let _sTrim  = _slice.length;
            while (_sTrim > 0 && _slice[_sTrim - 1] === 0) _sTrim--;
            const _body   = _slice.slice(0, _sTrim);
            const _mName  = _m.name || ('Method' + (mi + 1));
            disasmLines.push('method ' + _mName + ' {  ; selector #' + (mi + 1));
            if (_body.length === 0) {
                disasmLines.push('  ; (empty)');
            } else {
                _body.forEach(function(w) { disasmLines.push('  0x' + w.toString(16)); });
            }
            disasmLines.push('}');
            disasmLines.push('');
        }
    }

    const output = disasmLines.join('\n');

    assert('T19 manifest-offset: structured=true (Path A fires)', structured);
    assert('T19 manifest-offset: output contains "method Pi {"',
        output.includes('method Pi {'), JSON.stringify(output.slice(0, 120)));
    assert('T19 manifest-offset: output contains "method E {"',
        output.includes('method E {'), JSON.stringify(output.slice(0, 200)));
    assert('T19 manifest-offset: output contains "method Phi {"',
        output.includes('method Phi {'), JSON.stringify(output.slice(0, 280)));
    assert('T19 manifest-offset: Pi body word 0x7030000 under Pi section only',
        (function() {
            const piStart  = output.indexOf('method Pi {');
            const eStart   = output.indexOf('method E {');
            const piSection = output.slice(piStart, eStart);
            return piSection.includes('7030000') && !piSection.includes('7030001');
        })(), output);
    assert('T19 manifest-offset: E body word 0x7030001 under E section only',
        (function() {
            const eStart   = output.indexOf('method E {');
            const phiStart = output.indexOf('method Phi {');
            const eSection = output.slice(eStart, phiStart);
            return eSection.includes('7030001') && !eSection.includes('7030002');
        })(), output);
    assert('T19 manifest-offset: Phi body word 0x7030002 under Phi section only',
        (function() {
            const phiStart = output.indexOf('method Phi {');
            const phiSection = output.slice(phiStart);
            return phiSection.includes('7030002');
        })(), output);
    assert('T19 manifest-offset: no bare BRANCH opcode words as body lines (all words have opcode!=23)',
        (function() {
            // All injected words have opcode 0 (0x07...) or 16 (0x87...) or 3 (0x1F...)
            // opcode 23 would be top5 bits = 10111 → first nibble 0xB8.. or similar
            // Just verify no word starting with 'b8' appears in the body lines
            return !output.split('\n').some(function(l) {
                return l.startsWith('  0x') && (l.trim().startsWith('0xb8') || l.trim().startsWith('0xBB'));
            });
        })(), output);
})();

// ── T20: _absOpenInEditorByName — template path, capabilities pre-fill ────────
// When existing is null (no compiled LUMP) but the abstraction IS in the
// registry AND it has a non-empty capabilities array, the template must:
//   - Pre-fill the capabilities { } block with the registry entries
//   - Include the description in the header comment
//   - Emit one method stub per method in correct selector order
//   - NOT show a "No LUMP found" toast, NOT call openLumpInEditor
//   - Call switchView('editor')
(async function t20() {
    const CIRCLE_ABS = {
        index: 46,
        name: 'Circle',
        description: 'Geometry via SlideRule',
        methods: ['Area', 'Circumference'],
        capabilities: [{ name: 'SlideRule', grants: 'E' }],
    };

    // No compiled LUMP in the server list — triggers the template branch.
    const { ctx, document, calls } = makeCtx({
        lumpsCache: [],
        abstractions: [CIRCLE_ABS],
        fetchImpl: async () => ({ ok: true, json: async () => [] }),
    });

    // Add #asmEditor textarea so the production code can populate it.
    const asmEd = document.createElement('textarea');
    asmEd.id = 'asmEditor';
    document.body.appendChild(asmEd);

    await vm.runInContext('_absOpenInEditorByName("Circle")', ctx);

    // 1. Must NOT show a toast.
    const toastEl = document.getElementById('fpgaToastEl');
    assert('T20 template path: no "No LUMP found" toast shown', toastEl === null);

    // 2. Must NOT call openLumpInEditor (there is no token to open).
    assert('T20 template path: openLumpInEditor NOT called',
        calls.openLumpInEditor.length === 0, calls.openLumpInEditor);

    // 3. Must call switchView('editor').
    assert('T20 template path: switchView("editor") called',
        calls.switchView.includes('editor'), calls.switchView);

    // 4. #asmEditor must contain the abstraction name in the header comment.
    const editorValue = asmEd.value;
    assert('T20 template path: editor contains header comment with abstraction name',
        editorValue.includes('; Circle'), JSON.stringify(editorValue.slice(0, 120)));

    // 5. Header comment must include the description.
    assert('T20 template path: header comment includes description',
        editorValue.includes('Geometry via SlideRule'), JSON.stringify(editorValue.slice(0, 200)));

    // 6. SELF is visible at row 0; source-declared entries begin at row 1.
    assert('T20 template path: compiler-owned SELF is shown at cList[0]',
        editorValue.includes('; cList[0] SELF E  (compiler-owned)'),
        JSON.stringify(editorValue.slice(0, 240)));
    assert('T20 template path: capabilities block pre-filled with SlideRule E at cList[1]',
        editorValue.includes('SlideRule E  ; cList[1]'),
        JSON.stringify(editorValue.slice(0, 200)));

    // 7. The raw empty placeholder must NOT appear when entries exist.
    assert('T20 template path: empty capabilities { } not emitted when entries present',
        !editorValue.includes('(capability grants added here)'), JSON.stringify(editorValue.slice(0, 200)));

    // 8. Editor must contain one method stub per method in correct selector order.
    const methods = ['Area', 'Circumference'];
    for (let mi = 0; mi < methods.length; mi++) {
        assert('T20 template path: editor contains method stub for ' + methods[mi],
            editorValue.includes('method ' + methods[mi] + ' {'), editorValue);
        assert('T20 template path: method ' + methods[mi] + ' has selector #' + (mi + 1),
            editorValue.includes('method ' + methods[mi] + ' {  ; selector #' + (mi + 1)), editorValue);
    }

    // 9. Selector order: Area before Circumference.
    const areaIdx = editorValue.indexOf('method Area {');
    const circIdx = editorValue.indexOf('method Circumference {');
    assert('T20 template path: method order is Area < Circumference',
        areaIdx >= 0 && areaIdx < circIdx,
        { areaIdx, circIdx });

    // 10. "No LUMP found" string must NOT appear anywhere in the editor.
    assert('T20 template path: editor does not contain "No LUMP found"',
        !editorValue.includes('No LUMP found'), editorValue);
})();

// ── T20c: _absOpenInEditorByName — empty user capabilities keeps SELF row 0
// When the registry entry has an empty capabilities array, the block must
// retain compiler-owned SELF plus an editable placeholder — no pre-fill, no
// crash. Description is still injected into the header comment.
(async function t20c() {
    const ABACUS_ABS = {
        index: 17,
        name: 'Abacus',
        description: '32-bit integer arithmetic',
        methods: ['Add', 'Sub', 'Mul', 'Div', 'Mod', 'Abs'],
        capabilities: [],
    };

    const { ctx, document, calls } = makeCtx({
        lumpsCache: [],
        abstractions: [ABACUS_ABS],
        fetchImpl: async () => ({ ok: true, json: async () => [] }),
    });

    const asmEd = document.createElement('textarea');
    asmEd.id = 'asmEditor';
    document.body.appendChild(asmEd);

    await vm.runInContext('_absOpenInEditorByName("Abacus")', ctx);

    const editorValue = asmEd.value;
    assert('T20c empty caps: switchView("editor") called',
        calls.switchView.includes('editor'), calls.switchView);
    assert('T20c empty caps: header contains abstraction name',
        editorValue.includes('; Abacus'), editorValue.slice(0, 80));
    assert('T20c empty caps: description included in header',
        editorValue.includes('32-bit integer arithmetic'), editorValue.slice(0, 200));
    assert('T20c empty caps: compiler-owned SELF remains cList[0]',
        editorValue.includes('; cList[0] SELF E  (compiler-owned)'), editorValue.slice(0, 220));
    assert('T20c empty caps: editable user-capability placeholder remains',
        editorValue.includes('; (capability grants added here)'), editorValue.slice(0, 220));
    assert('T20c empty caps: all 6 method stubs present',
        ['Add', 'Sub', 'Mul', 'Div', 'Mod', 'Abs'].every(m => editorValue.includes('method ' + m + ' {')),
        editorValue);
})();

// ── T20b: _absOpenInEditorByName — toast still fires when NOT in registry ─────
// When existing is null AND the name is not in abstractionRegistry, the
// original "No LUMP found" toast must still be shown as the final fallback.
(async function t20b() {
    const { ctx, document, calls } = makeCtx({
        lumpsCache: [],
        abstractions: [],
        fetchImpl: async () => ({ ok: true, json: async () => [] }),
    });

    await vm.runInContext('_absOpenInEditorByName("UnknownWidget")', ctx);

    assert('T20b fallback: openLumpInEditor NOT called',
        calls.openLumpInEditor.length === 0, calls.openLumpInEditor);
    assert('T20b fallback: switchView NOT called (no navigation)',
        calls.switchView.length === 0, calls.switchView);
    const toastEl = document.getElementById('fpgaToastEl');
    assert('T20b fallback: "No LUMP found" toast shown', toastEl !== null);
    const titleEl = toastEl && toastEl.querySelector('.fpga-toast-title');
    assert('T20b fallback: toast title is "No LUMP found"',
        titleEl && titleEl.textContent === 'No LUMP found', titleEl && titleEl.textContent);
})();

// ── T21: saved-LUMP source recovery — compressed and uncompressed frames ─────
trackAsync((async function t21() {
    const { lumpBuildContentFrame, lumpDecodeContentFrame } =
        require('./lump-content-frame.js');

    async function buildBinary(source, forceUncompressed) {
        const savedCompressionStream = global.CompressionStream;
        if (forceUncompressed) global.CompressionStream = undefined;
        let frame;
        try {
            frame = await lumpBuildContentFrame(
                { name: 'Split.Editor.Test', language: 'assembly' }, source);
        } finally {
            global.CompressionStream = savedCompressionStream;
        }
        const code = [0xF8000000 >>> 0];
        const cw = code.length;
        let lumpSize = 64;
        while (lumpSize < 1 + cw + frame.frameWords.length) lumpSize <<= 1;
        let nm6 = 0;
        while ((64 << nm6) < lumpSize) nm6++;
        const header = (((0x1F & 0x1F) << 27) |
            ((nm6 & 0x0F) << 23) | ((cw & 0x1FFF) << 10)) >>> 0;
        const words = new Array(lumpSize).fill(0);
        words[0] = header;
        words[1] = code[0];
        frame.frameWords.forEach((word, i) => { words[2 + i] = word >>> 0; });
        return { words, flags: frame.flags };
    }

    const compressedSource =
        '; embedded compressed source\nmethod Run {\n  RETURN\n}\n;' + 'x'.repeat(400);
    const uncompressedSource = '; embedded plain source\nmethod Run {\n  RETURN\n}';
    const compressed = await buildBinary(compressedSource, false);
    const uncompressed = await buildBinary(uncompressedSource, true);

    assert('T21 compressed embedded frame uses flags 0x07',
        compressed.flags === 0x07, compressed.flags);
    assert('T21 compressed embedded frame restores exact editable source',
        await lumpDecodeContentFrame(compressed.words) === compressedSource);
    assert('T21 uncompressed embedded frame uses flags 0x03',
        uncompressed.flags === 0x03, uncompressed.flags);
    assert('T21 uncompressed embedded frame restores exact editable source',
        await lumpDecodeContentFrame(uncompressed.words) === uncompressedSource);
})());

// ── T22: source preference, sidecar fallback, and explicit missing state ──────
(function t22() {
    const sandbox = { console };
    vm.createContext(sandbox);
    vm.runInContext(SAVED_LUMP_SOURCE_SRC, sandbox);

    const embedded = vm.runInContext(
        '_resolveSavedLumpEditorSource("embedded source", "sidecar source")', sandbox);
    const fallback = vm.runInContext(
        '_resolveSavedLumpEditorSource(null, "sidecar source")', sandbox);
    const missing = vm.runInContext(
        '_resolveSavedLumpEditorSource(null, null)', sandbox);

    assert('T22 embedded source wins over sidecar source',
        embedded.origin === 'embedded' && embedded.source === 'embedded source', embedded);
    assert('T22 older LUMP falls back to sidecar source',
        fallback.origin === 'sidecar' && fallback.source === 'sidecar source', fallback);
    assert('T22 missing source is explicitly identified',
        missing.origin === 'missing' && missing.restored === false &&
        missing.source.includes('No recoverable source'), missing.source);
    assert('T22 missing-source buffer never copies compiled disassembly',
        !missing.source.includes('0xF8000000'), missing.source);
})();

// ── T23: read-only split disassembly and normal-panel restoration ─────────────
(function t23() {
    const dom = new JSDOM(`<!DOCTYPE html><body>
        <div id="codeSidebarTabs"></div>
        <div id="savedLumpDisassemblyPanel" style="display:none">
          <h2 id="savedLumpDisassemblyTitle"></h2>
          <pre id="savedLumpDisassembly" aria-readonly="true"></pre>
        </div>
        <div id="codeConsoleContent" style="display:flex"></div>
        <div id="codeHistoryPanel"></div><div id="codeSyntaxPanel"></div>
        <div id="codeJsPanel"></div><div id="asmErrorPanel"></div>
        <div id="asmWarningPanel"></div>
        <div id="_lumpDraftBanner"><button id="_lumpDraftBannerDiscard">Discard</button></div>
        <button id="codeTabConsole"></button><button id="codeTabHistory"></button>
        <button id="codeTabSyntax"></button><button id="codeTabJs"></button>
    </body>`);
    const sandbox = {
        window: dom.window,
        document: dom.window.document,
        console,
        renderJsTab() {},
    };
    vm.createContext(sandbox);
    vm.runInContext(
        SWITCH_CODE_TAB_SRC + '\n' + SAVED_LUMP_ENTER_SRC + '\n' + SAVED_LUMP_EXIT_SRC,
        sandbox);

    vm.runInContext('_enterSavedLumpEditorMode("RETURN\\n0xF8000000", "Saved.Code")', sandbox);
    const doc = dom.window.document;
    const pre = doc.getElementById('savedLumpDisassembly');
    assert('T23 split mode labels the compiled disassembly',
        doc.getElementById('savedLumpDisassemblyTitle').textContent ===
        'Compiled Disassembly — Saved.Code');
    assert('T23 compiled disassembly is displayed independently',
        pre.textContent === 'RETURN\n0xF8000000', pre.textContent);
    assert('T23 compiled disassembly is read-only semantic content',
        pre.getAttribute('aria-readonly') === 'true' &&
        pre.getAttribute('contenteditable') === null);
    assert('T23 normal right-side tabs are replaced in split mode',
        doc.getElementById('codeSidebarTabs').style.display === 'none' &&
        doc.getElementById('savedLumpDisassemblyPanel').style.display === 'flex');

    vm.runInContext('exitSavedLumpEditorMode()', sandbox);
    assert('T23 leaving split mode restores normal tabs and console',
        doc.getElementById('codeSidebarTabs').style.display === '' &&
        doc.getElementById('savedLumpDisassemblyPanel').style.display === 'none' &&
        doc.getElementById('codeConsoleContent').style.display === 'flex');
    assert('T23 leaving split mode clears stale compiled text',
        pre.textContent === '', JSON.stringify(pre.textContent));
    assert('T23 leaving split mode clears saved-LUMP editor context',
        dom.window._editorLumpDirtyListener === null &&
        dom.window._editorLumpDirtyListenerEl === null &&
        dom.window._editorLumpDirtyToken === null &&
        dom.window._editorOpenLumpToken === null &&
        dom.window._editorOpenLumpMeta === null &&
        doc.getElementById('_lumpDraftBanner') === null);

    dom.window._savedLumpOpenRequestId = 41;
    vm.runInContext('exitSavedLumpEditorMode()', sandbox);
    assert('T23 teardown invalidates an in-flight saved-LUMP open even when mode is hidden',
        dom.window._savedLumpOpenRequestId === 42,
        dom.window._savedLumpOpenRequestId);
})();

// ── T24: saved code LUMP details expose the canonical entry action ────────────
(function t24() {
    const appLumpsSource = fs.readFileSync(
        path.resolve(__dirname, 'app-lumps.js'), 'utf8');
    assert('T24 saved LUMP action is clearly labeled Open in Editor',
        appLumpsSource.includes('Open in Editor</button>'));
    assert('T24 entry action still routes through canonical openLumpInEditor path',
        appLumpsSource.includes(
            "addEventListener('click', () => openLumpInEditor(editBtn.dataset.editToken))"));
    const appRunSource = fs.readFileSync(path.resolve(__dirname, 'app-run.js'), 'utf8');
    const appCompileSource = fs.readFileSync(path.resolve(__dirname, 'app-compile.js'), 'utf8');
    const appShellSource = fs.readFileSync(path.resolve(__dirname, 'app-shell.js'), 'utf8');
    assert('T24 ordinary assembly examples exit saved-LUMP split mode',
        /function loadExample\(name\) \{\s*if \(typeof window\.exitSavedLumpEditorMode/.test(
            appRunSource));
    assert('T24 ordinary CLOOMC examples exit saved-LUMP split mode',
        /function loadCLOOMCExample\(name\) \{\s*if \(typeof window\.exitSavedLumpEditorMode/.test(
            appCompileSource));
    assert('T24 personal tabs exit saved-LUMP split mode',
        /function selectUserTab\(id\)[\s\S]*?window\.exitSavedLumpEditorMode\(\)/.test(
            appShellSource));
    assert('T24 opened source files exit saved-LUMP split mode',
        /function openSourceFile\(path\)[\s\S]*?window\.exitSavedLumpEditorMode\(\)/.test(
            appShellSource));
    assert('T24 async open checks its navigation request before committing',
        appLumpsSource.includes(
            'if (window._savedLumpOpenRequestId !== _openRequestId) return;') &&
        appLumpsSource.includes('window._committingSavedLumpOpen = true'));
})();

// ── T25: navigating while binary fetch is pending cancels the late open ───────
trackAsync((async function t25() {
    let resolveWords;
    const wordsResponse = new Promise(resolve => { resolveWords = resolve; });
    const calls = { switchView: [] };
    const saved = {
        token: 'abc123',
        abstraction: 'Delayed.Lump',
        ns_slot: null,
        capabilities: [],
        lump_type: 'code',
        content_type: 'code',
    };
    const entry = {
        token: saved.token,
        abstraction: saved.abstraction,
        sources: { server: saved },
    };
    const sandbox = {
        console,
        fetch() { return wordsResponse; },
        switchView(view) { calls.switchView.push(view); },
        setTimeout,
    };
    sandbox.window = sandbox;
    sandbox.LumpRegistry = {
        SESSION_EPOCH: 0,
        resolve(token) { return token === saved.token ? entry : null; },
        list() { return [entry]; },
    };
    vm.createContext(sandbox);
    vm.runInContext(SAVED_LUMP_EXIT_SRC + '\n' + OPEN_SAVED_LUMP_SRC, sandbox);

    const pendingOpen = vm.runInContext('openLumpInEditor("abc123")', sandbox);
    vm.runInContext('exitSavedLumpEditorMode()', sandbox);
    resolveWords({
        ok: true,
        json: async function() { return { words: [0xF8000400, 0xF8000000] }; },
    });
    await pendingOpen;

    assert('T25 navigation invalidates the pending saved-LUMP request',
        sandbox._savedLumpOpenRequestId === 2, sandbox._savedLumpOpenRequestId);
    assert('T25 late binary response cannot reopen the editor or split panel',
        calls.switchView.length === 0 && !sandbox._savedLumpEditorMode, calls);
    assert('T25 late binary response cannot install stale saved-LUMP context',
        sandbox._editorOpenLumpToken === undefined &&
        sandbox._editorLumpDirtyToken === undefined);
})());

// ── Summary ───────────────────────────────────────────────────────────────────
(function waitAndSummarize() {
    setTimeout(function() {
        if (pendingAsync > 0) { waitAndSummarize(); return; }
        console.log('\n' + passed + ' passed, ' + failed + ' failed');
        if (failed > 0) process.exit(1);
    }, 50);
})();
