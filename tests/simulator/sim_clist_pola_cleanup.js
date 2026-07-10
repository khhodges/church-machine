// tests/simulator/sim_clist_pola_cleanup.js
//
// Feature test: the C-List viewer popup (simulator/clist-viewer.js) gained a
// "POLA" button next to "+ Add" that removes capabilities-block entries never
// referenced anywhere else in the source (Principle of Least Authority).
//
// This test asserts:
//   1. `_removeUnusedCapabilities()` correctly identifies and strips entries
//      whose declared name never appears outside the capabilities { } block,
//      while leaving referenced entries (and their rights) untouched.
//   2. Edge cases (no capabilities block, empty block, nothing unused) are
//      handled without mutating the editor and without a false "removed" toast.
//   3. Static wiring: the popup header markup includes a `pola-cleanup` button,
//      and the delegated click handler in `getOrCreatePopup()` routes clicks on
//      it to `_removeUnusedCapabilities()`.

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');

let failures = 0;
function check(cond, msg) {
    if (cond) {
        console.log(`PASS ${msg}`);
    } else {
        failures++;
        console.log(`FAIL ${msg}`);
    }
}

const src = fs.readFileSync(path.join(ROOT, 'simulator', 'clist-viewer.js'), 'utf8');

// ---------------------------------------------------------------------------
// 1. Static wiring checks (cheap, no sandbox needed)
// ---------------------------------------------------------------------------
check(/data-action="pola-cleanup"/.test(src),
    'a pola-cleanup button is rendered in the C-List popup header');
check(/\\u2696 POLA/.test(src) || /POLA<\/button>/.test(src),
    'the POLA button is labelled POLA');
check(/closest\(\s*'\[data-action="pola-cleanup"\]'\s*\)/.test(src),
    'delegated click handler listens for [data-action="pola-cleanup"]');
check(/if \(polaBtn\) \{ _removeUnusedCapabilities\(\); return; \}/.test(src),
    'clicking the POLA button invokes _removeUnusedCapabilities()');

// ---------------------------------------------------------------------------
// 2. Functional checks: extract the real implementation and exercise it
//    against a fabricated DOM/editor so the actual cleanup logic (not a
//    reimplementation) is under test.
// ---------------------------------------------------------------------------
function extractFn(name) {
    const re = new RegExp(`function ${name}\\([\\s\\S]*?\\n    \\}\\n`);
    const m = src.match(re);
    return m ? m[0] : null;
}

const parseCapEntriesSrc      = extractFn('_parseCapEntries');
const formatCapBlockSrc       = extractFn('_formatCapBlock');
const showPolaToastSrc        = extractFn('_showPolaToast');
const removeUnusedSrc         = extractFn('_removeUnusedCapabilities');

check(!!parseCapEntriesSrc, '_parseCapEntries function found in clist-viewer.js');
check(!!formatCapBlockSrc,  '_formatCapBlock function found in clist-viewer.js');
check(!!showPolaToastSrc,   '_showPolaToast function found in clist-viewer.js');
check(!!removeUnusedSrc,    '_removeUnusedCapabilities function found in clist-viewer.js');

if (parseCapEntriesSrc && formatCapBlockSrc && showPolaToastSrc && removeUnusedSrc) {
    function makeClassList() {
        const set = new Set();
        return {
            add:      (c) => set.add(c),
            remove:   (c) => set.delete(c),
            contains: (c) => set.has(c),
        };
    }

    function runScenario(srcText) {
        const state = {
            edValue: srcText,
            dispatched: false,
            showViewerCalls: [],
            toastMsgs: [],
            popupChildren: [],
        };

        const fakeEditor = {
            get value() { return state.edValue; },
            set value(v) { state.edValue = v; },
            dispatchEvent(evt) { state.dispatched = true; },
        };

        const fakePopup = {
            _toastEl: null,
            querySelector(sel) {
                if (sel === '.clist-pola-toast') return this._toastEl;
                return null;
            },
            appendChild(el) {
                this._toastEl = el;
                state.popupChildren.push(el);
            },
        };

        const sandbox = {
            activeEditor: null,
            document: {
                getElementById(id) { return id === 'asmEditor' ? fakeEditor : null; },
                createElement(tag) {
                    return { tagName: tag, classList: makeClassList(), textContent: '', offsetWidth: 0, _hideTimer: null };
                },
            },
            getOrCreatePopup() { return fakePopup; },
            showViewer(msg) { state.showViewerCalls.push(msg); },
            setTimeout: (fn) => 0,
            clearTimeout: () => {},
            Event: function Event(type, opts) { this.type = type; this.bubbles = !!(opts && opts.bubbles); },
            console,
        };
        vm.createContext(sandbox);

        const full = [
            parseCapEntriesSrc,
            formatCapBlockSrc,
            showPolaToastSrc,
            removeUnusedSrc,
            'this._removeUnusedCapabilities = _removeUnusedCapabilities;',
        ].join('\n');
        vm.runInContext(full, sandbox);
        sandbox._removeUnusedCapabilities();

        // Surface the toast message the real _showPolaToast wrote, whichever
        // path produced it (either the direct toast call or via showViewer).
        const directToastMsg = fakePopup._toastEl ? fakePopup._toastEl.textContent : null;
        return {
            finalSrc: state.edValue,
            dispatched: state.dispatched,
            showViewerCalls: state.showViewerCalls,
            toastMsg: directToastMsg,
        };
    }

    // -- Scenario A: mixed used/unused capabilities ---------------------------
    const mixedSrc = [
        'abstraction Demo {',
        'capabilities {',
        '    Boot.Thread E',
        '    Mint E',
        '    Navana E',
        '}',
        'IADD DR0, DR0, #1',
        'CALL Boot.Thread',
        'CALL Navana',
        'RETURN',
        '}',
    ].join('\n');

    const resultA = runScenario(mixedSrc);
    check(resultA.dispatched, 'scenario A: editor input event dispatched after a real cleanup');
    check(resultA.finalSrc.includes('Boot.Thread E'), 'scenario A: referenced capability Boot.Thread is kept');
    check(resultA.finalSrc.includes('Navana E'), 'scenario A: referenced capability Navana is kept');
    check(!/\bMint E\b/.test(resultA.finalSrc), 'scenario A: unreferenced capability Mint is removed');
    check(resultA.showViewerCalls.length === 1 && /Mint/.test(resultA.showViewerCalls[0] || ''),
        'scenario A: showViewer() is called with a message naming the removed capability');

    // -- Scenario B: everything is referenced — no-op ------------------------
    const cleanSrc = [
        'capabilities {',
        '    Salvation E',
        '}',
        'CALL Salvation',
        'RETURN',
    ].join('\n');
    const resultB = runScenario(cleanSrc);
    check(!resultB.dispatched, 'scenario B: no edit dispatched when nothing is unused');
    check(resultB.showViewerCalls.length === 0, 'scenario B: showViewer() not called when nothing changed');
    check(!!resultB.toastMsg && /POLA/.test(resultB.toastMsg),
        'scenario B: a toast confirms the C-List already follows POLA');

    // -- Scenario C: no capabilities block at all -----------------------------
    const noBlockSrc = 'IADD DR0, DR0, #1\nRETURN\n';
    const resultC = runScenario(noBlockSrc);
    check(!resultC.dispatched, 'scenario C: no edit dispatched when there is no capabilities block');
    check(resultC.finalSrc === noBlockSrc, 'scenario C: source is left byte-for-byte unchanged');
    check(!!resultC.toastMsg && /No capabilities block/.test(resultC.toastMsg),
        'scenario C: toast explains there is nothing to clean up');

    // -- Scenario D: empty capabilities block ---------------------------------
    const emptyBlockSrc = 'capabilities {\n}\nRETURN\n';
    const resultD = runScenario(emptyBlockSrc);
    check(!resultD.dispatched, 'scenario D: no edit dispatched for an already-empty block');
    check(!!resultD.toastMsg && /already empty/.test(resultD.toastMsg),
        'scenario D: toast reports the C-List is already empty');
}

// ---------------------------------------------------------------------------
// 3. Regression: buildContentAsync's Path 0 (source view) must stay selected
//    even when POLA empties the capabilities block, instead of falling
//    through to Path 1 (live-sim CR6), which shows an unrelated data source
//    (boot-hardwired capabilities like UART_DEV/LED_DEV/etc.) and makes it
//    look like POLA "added" GTs rather than removing unused ones.
// ---------------------------------------------------------------------------
function extractBlock(startMarker, endMarker) {
    const startIdx = src.indexOf(startMarker);
    const endIdx = src.indexOf(endMarker, startIdx);
    if (startIdx === -1 || endIdx === -1) return null;
    return src.slice(startIdx, endIdx);
}

const path0Src = extractBlock(
    '// \u2500\u2500 Path 0: source-declared capabilities',
    '// \u2500\u2500 Path 1: live sim'
);
check(!!path0Src, 'Path 0 block extracted from buildContentAsync for regression testing');

if (path0Src) {
    function runPath0(srcText) {
        const sandbox = {
            activeEditor: null,
            document: {
                getElementById(id) { return id === 'asmEditor' ? { value: srcText } : null; },
            },
            sim: null,
            PERM_COLORS: {},
            _namedBadgeHtml: function () { return ''; },
            escHtml: function (s) { return s; },
            _wrapRows: function (titleExtra, rows) { return { titleExtra: titleExtra, rows: rows }; },
            console,
        };
        vm.createContext(sandbox);
        const wrapped = '(function () {\n' + path0Src + '\n})()';
        return vm.runInContext(wrapped, sandbox);
    }

    // -- Scenario E: non-empty capabilities block resolves to Path 0 ---------
    const nonEmptySrc = 'capabilities {\n    Navana E\n}\nCALL Navana\nRETURN\n';
    const resultE = runPath0(nonEmptySrc);
    check(!!resultE && resultE.titleExtra === 'source',
        'scenario E: non-empty capabilities block renders Path 0 ("source")');
    check(!!resultE && /Navana/.test(resultE.rows),
        'scenario E: Path 0 rows include the declared capability name');

    // -- Scenario F: POLA-emptied capabilities block still resolves to Path 0,
    //    NOT falling through to Path 1 (live sim) ------------------------------
    const emptiedSrc = 'capabilities {\n}\nRETURN\n';
    const resultF = runPath0(emptiedSrc);
    check(!!resultF && resultF.titleExtra === 'source',
        'scenario F: POLA-emptied capabilities block still renders Path 0 ("source"), not Path 1 (live sim)');
    check(!!resultF && /No capabilities declared/.test(resultF.rows),
        'scenario F: empty Path 0 shows an explicit "no capabilities declared" message');
    check(!!resultF && !/UART_DEV|LED_DEV|BTN_DEV|TIMER_DEV|Boot\.NS|Boot\.Thread/.test(resultF.rows),
        'scenario F: empty Path 0 never leaks live-sim boot capability names');

    // -- Scenario G: no capabilities block at all returns undefined (falls through) --
    const noBlockSrc2 = 'IADD DR0, DR0, #1\nRETURN\n';
    const resultG = runPath0(noBlockSrc2);
    check(resultG === undefined,
        'scenario G: source with no capabilities block does not short-circuit Path 0 (falls through to Path 1)');
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
