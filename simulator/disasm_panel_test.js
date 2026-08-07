// disasm_panel_test.js — Unit tests for the click-to-expand disassembly row feature
//
// Verifies the production click handler in app-misc.js (the "Click-to-expand"
// section) against four contracted behaviours:
//
//   DP-1  Clicking a non-current row with data-desc inserts a .nia-disasm-desc sibling
//   DP-2  At-most-one constraint: clicking row B collapses row A's desc first
//   DP-3  Clicking the same already-expanded row collapses it
//   DP-4  The .nia-disasm-current row is not clickable (no desc inserted)
//   DP-5  The expanded row receives the .nia-row-expanded class
//   DP-6  When a row collapses, .nia-row-expanded is removed from it
//   DP-7  A row without data-desc is silently ignored (no desc inserted)
//   DP-8  The inserted desc element contains the data-desc text
//
// Run with:  node simulator/disasm_panel_test.js
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { JSDOM } = require('jsdom');

// ── Source extraction ─────────────────────────────────────────────────────────
// Extracts the self-contained `disasmBody.addEventListener(...)` statement from
// app-misc.js by locating the known comment marker and matching parentheses.

function extractClickHandler(srcPath) {
    const src = fs.readFileSync(path.resolve(__dirname, srcPath), 'utf8');

    const marker = '// Click-to-expand: any non-current disassembly row with a description';
    const markerIdx = src.indexOf(marker);
    if (markerIdx === -1) {
        throw new Error('Click-to-expand comment marker not found in ' + srcPath);
    }

    const aeIdx = src.indexOf('disasmBody.addEventListener(', markerIdx);
    if (aeIdx === -1) {
        throw new Error('disasmBody.addEventListener( not found after marker in ' + srcPath);
    }

    // Walk forward tracking paren depth to find the matching close paren.
    let depth = 0;
    let end   = -1;
    for (let i = aeIdx; i < src.length; i++) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') {
            if (--depth === 0) { end = i; break; }
        }
    }
    if (end === -1) throw new Error('Could not find end of addEventListener call');

    return src.slice(aeIdx, end + 1) + ';';
}

const HANDLER_SRC = extractClickHandler('app-misc.js');

// ── DOM fixture helpers ───────────────────────────────────────────────────────

// Build a fresh JSDOM environment with a .nia-disasm-body containing the
// requested row specs.  Each spec is:
//   { desc, current, noDesc }
//   desc    — string → sets data-desc attribute (omit or falsy for no attr)
//   current — bool  → adds .nia-disasm-current class
//   noDesc  — bool  → row has no data-desc (overrides desc)
function makeFixture(rowSpecs) {
    const dom = new JSDOM('<!DOCTYPE html><body></body>');
    const document = dom.window.document;

    const body = document.createElement('div');
    body.className = 'nia-disasm-body';
    document.body.appendChild(body);

    const rows = rowSpecs.map(function(spec) {
        const row = document.createElement('div');
        let cls = 'nia-disasm-row';
        if (spec.current) cls += ' nia-disasm-current';
        row.className = cls;
        if (spec.desc && !spec.noDesc) {
            row.dataset.desc = spec.desc;
        }
        row.textContent = spec.label || 'row';
        body.appendChild(row);
        return row;
    });

    // Attach the production click handler (requires disasmBody in scope).
    // _disasmPinnedMap is declared at file-scope in app-misc.js (outside the
    // extracted snippet).  Without it in the sandbox the Proxy fallback would
    // return function(){}, making .set()/.delete() throw TypeError.  Supply the
    // real Map here so the handler pins/unpins rows exactly as it does in the
    // browser.
    const sandbox = { disasmBody: body, document: document, _disasmPinnedMap: new Map() };
    const ctx = vm.createContext(new Proxy(sandbox, {
        get(target, prop, receiver) {
            if (prop in target) return Reflect.get(target, prop, receiver);
            if (typeof prop === 'string' && prop in globalThis) return globalThis[prop];
            if (typeof prop === 'string' && /^[_a-zA-Z]/.test(prop)) return function() {};
            return undefined;
        },
        has() { return true; },
    }));
    vm.runInContext(HANDLER_SRC, ctx, { filename: 'app-misc.js' });

    return { document, body, rows };
}

// Fire a synthetic click whose e.target is the given element.
// jsdom's dispatchEvent / click() honours event bubbling so the delegated
// listener on .nia-disasm-body receives it with the correct e.target.
function click(el) {
    el.click();
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

// ── DP-1: clicking a non-current row with data-desc inserts a desc sibling ───
{
    const { body, rows } = makeFixture([
        { label: 'row A', desc: 'Alpha instruction explanation' },
    ]);

    click(rows[0]);

    const desc = body.querySelector('.nia-disasm-desc');
    assert('DP-1: desc element inserted after click',
        desc !== null, 'querySelector returned null');
    assert('DP-1: desc is immediately after the clicked row',
        desc && rows[0].nextElementSibling === desc, 'sibling mismatch');
}

// ── DP-2: at-most-one — clicking row B collapses row A's desc ────────────────
{
    const { body, rows } = makeFixture([
        { label: 'row A', desc: 'Explanation A' },
        { label: 'row B', desc: 'Explanation B' },
    ]);

    click(rows[0]);
    const descAfterA = body.querySelectorAll('.nia-disasm-desc');
    assert('DP-2: exactly one desc after first click',
        descAfterA.length === 1, 'count=' + descAfterA.length);

    click(rows[1]);
    const descs = body.querySelectorAll('.nia-disasm-desc');
    assert('DP-2: still exactly one desc after second click',
        descs.length === 1, 'count=' + descs.length);
    assert('DP-2: the remaining desc belongs to row B',
        descs[0] && rows[1].nextElementSibling === descs[0], 'sibling mismatch');
    assert('DP-2: row A has no desc sibling',
        rows[0].nextElementSibling !== null
            ? !rows[0].nextElementSibling.classList.contains('nia-disasm-desc')
            : true,
        'row A still has desc');
}

// ── DP-3: clicking the same expanded row a second time collapses it ───────────
{
    const { body, rows } = makeFixture([
        { label: 'row A', desc: 'Toggle me' },
    ]);

    click(rows[0]);
    assert('DP-3: desc present after first click',
        body.querySelector('.nia-disasm-desc') !== null);

    click(rows[0]);
    assert('DP-3: desc removed after second click (toggle collapse)',
        body.querySelector('.nia-disasm-desc') === null,
        'desc still in DOM');
}

// ── DP-4: .nia-disasm-current row click is a no-op ───────────────────────────
{
    const { body, rows } = makeFixture([
        { label: 'current row', desc: 'Should not expand', current: true },
    ]);

    click(rows[0]);

    // The current row's desc element (if any) would carry .nia-disasm-desc-current,
    // added by the HTML builder — not by the click handler.  The click handler
    // must NOT insert an additional .nia-disasm-desc (without the -current suffix).
    const nonCurrentDescs = body.querySelectorAll('.nia-disasm-desc:not(.nia-disasm-desc-current)');
    assert('DP-4: current row click inserts no desc',
        nonCurrentDescs.length === 0, 'count=' + nonCurrentDescs.length);
}

// ── DP-5: expanded row receives .nia-row-expanded class ──────────────────────
{
    const { body, rows } = makeFixture([
        { label: 'row A', desc: 'Alpha' },
    ]);

    click(rows[0]);
    assert('DP-5: .nia-row-expanded added to clicked row',
        rows[0].classList.contains('nia-row-expanded'),
        'classList=' + rows[0].className);
}

// ── DP-6: .nia-row-expanded removed when a row collapses ─────────────────────
{
    const { body, rows } = makeFixture([
        { label: 'row A', desc: 'Alpha' },
        { label: 'row B', desc: 'Beta'  },
    ]);

    // Expand row A, then click row B — row A should lose the class.
    click(rows[0]);
    assert('DP-6: row A expanded after first click',
        rows[0].classList.contains('nia-row-expanded'));

    click(rows[1]);
    assert('DP-6: row A loses .nia-row-expanded after row B clicked',
        !rows[0].classList.contains('nia-row-expanded'),
        'classList=' + rows[0].className);
    assert('DP-6: row B gains .nia-row-expanded',
        rows[1].classList.contains('nia-row-expanded'),
        'classList=' + rows[1].className);
}

// ── DP-7: row without data-desc is silently ignored ──────────────────────────
{
    const { body, rows } = makeFixture([
        { label: 'no-desc row', noDesc: true },
    ]);

    click(rows[0]);
    assert('DP-7: clicking row without data-desc inserts no desc',
        body.querySelector('.nia-disasm-desc') === null,
        'desc found unexpectedly');
}

// ── DP-8: inserted desc contains the data-desc text ──────────────────────────
{
    const expected = 'Load capability into register CR3 from namespace slot 7';
    const { body, rows } = makeFixture([
        { label: 'row X', desc: expected },
    ]);

    click(rows[0]);
    const desc = body.querySelector('.nia-disasm-desc');
    assert('DP-8: desc textContent matches data-desc attribute',
        desc && desc.textContent === expected,
        desc ? JSON.stringify(desc.textContent) : '(no desc)');
}

// ─────────────────────────────────────────────────────────────────────────────
// DB tests: _cmBuildDisasmHtml HTML layout
//
//   DB-1  Current row has .nia-disasm-current; its inline desc has
//          .nia-disasm-desc-current immediately after it
//   DB-2  Null-word rows before the NIA are collapsed (no DOM node rendered);
//          the leading separator .nia-nodata-sep appears; null-word rows AFTER
//          the NIA are rendered with .nia-no-data
//   DB-3  Spotlight block (.chlog-modal-spotlight) is rendered when the current
//          word has a mnemonic
//   DB-4  Spotlight HTML is empty when the word at the NIA is null
// ─────────────────────────────────────────────────────────────────────────────

// ── Source extraction ─────────────────────────────────────────────────────────

function extractBuildDisasmHtml(srcPath) {
    const src = fs.readFileSync(path.resolve(__dirname, srcPath), 'utf8');
    const marker = 'function _cmBuildDisasmHtml(';
    const startIdx = src.indexOf(marker);
    if (startIdx === -1) {
        throw new Error('_cmBuildDisasmHtml not found in ' + srcPath);
    }
    // Walk forward matching braces to find the closing brace of the function.
    let depth = 0;
    let end   = -1;
    for (let i = startIdx; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
            if (--depth === 0) { end = i; break; }
        }
    }
    if (end === -1) throw new Error('Could not find end of _cmBuildDisasmHtml');
    return src.slice(startIdx, end + 1);
}

const BUILD_HTML_SRC = extractBuildDisasmHtml('app-misc.js');

// ── Fixture helpers ───────────────────────────────────────────────────────────

// Minimal HTML-escape matching what _escHtml does in production.
function _escHtmlMock(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Run _cmBuildDisasmHtml in an isolated vm context with mock dependencies.
// opts may override: decodeWord(word,addr), roleAnnotation(d), plainEnglish(d).
function runBuildDisasmHtml(niaInt, words, opts) {
    opts = opts || {};
    const mockDecodeWord = opts.decodeWord || function(word, addr) {
        return {
            addr: addr,
            hex:  (word >>> 0).toString(16).toUpperCase().padStart(8, '0'),
            mnemonic: 'MOCK',
            text: 'MOCK ' + addr,
            dst: 1, src: 2, imm: 0,
        };
    };
    const mockRoleAnnotation = opts.roleAnnotation || function() { return ''; };
    const mockPlainEnglish   = opts.plainEnglish   || function() { return 'mock plain english'; };

    const sandbox = {
        _cmDecodeWord:        mockDecodeWord,
        _instrRoleAnnotation: mockRoleAnnotation,
        _instrPlainEnglish:   mockPlainEnglish,
        _escHtml:             _escHtmlMock,
        _cmBuildDisasmHtml:   undefined,
    };
    const ctx = vm.createContext(new Proxy(sandbox, {
        get(target, prop, receiver) {
            if (prop in target) return Reflect.get(target, prop, receiver);
            if (typeof prop === 'string' && prop in globalThis) return globalThis[prop];
            return undefined;
        },
        has() { return true; },
    }));
    vm.runInContext(BUILD_HTML_SRC, ctx, { filename: 'app-misc.js' });
    return ctx._cmBuildDisasmHtml(niaInt, words);
}

// Parse an HTML string and return the body element for querying.
function parseFragment(html) {
    const dom = new JSDOM('<!DOCTYPE html><body>' + html + '</body>');
    return dom.window.document.body;
}

// ── DB-1: current row and its inline desc ────────────────────────────────────
{
    const words = [{ wordAddr: 100, word: 0x00000001 }];
    const result = runBuildDisasmHtml(100, words);
    const body   = parseFragment(result.rowsHtml);

    const currentRow  = body.querySelector('.nia-disasm-current');
    const currentDesc = body.querySelector('.nia-disasm-desc-current');

    assert('DB-1: current row has .nia-disasm-current',
        currentRow !== null, 'querySelector returned null');
    assert('DB-1: inline desc after current row has .nia-disasm-desc-current',
        currentDesc !== null, 'querySelector returned null');
    assert('DB-1: .nia-disasm-desc-current is immediate sibling after current row',
        currentRow !== null && currentDesc !== null &&
        currentRow.nextElementSibling === currentDesc,
        'sibling mismatch');
}

// ── DB-2: leading no-data collapse and post-NIA no-data rows ─────────────────
{
    const words = [
        { wordAddr: 98,  word: null },   // before NIA — must be collapsed
        { wordAddr: 99,  word: null },   // before NIA — must be collapsed
        { wordAddr: 100, word: 0x00000001 }, // NIA — always rendered
        { wordAddr: 101, word: null },   // after NIA — rendered with .nia-no-data
    ];
    const result = runBuildDisasmHtml(100, words);
    const body   = parseFragment(result.rowsHtml);

    assert('DB-2: leading .nia-nodata-sep separator is present',
        body.querySelector('.nia-nodata-sep') !== null,
        'separator element not found');

    assert('DB-2: null row at addr 98 (before NIA) is not rendered',
        body.querySelector('[data-addr="98"]') === null,
        'found row with data-addr=98');
    assert('DB-2: null row at addr 99 (before NIA) is not rendered',
        body.querySelector('[data-addr="99"]') === null,
        'found row with data-addr=99');

    const niаRow = body.querySelector('[data-addr="100"]');
    assert('DB-2: current row (addr 100) is rendered',
        niаRow !== null, 'NIA row not found');

    const postRow = body.querySelector('[data-addr="101"]');
    assert('DB-2: null row after NIA (addr 101) is rendered with .nia-no-data',
        postRow !== null && postRow.classList.contains('nia-no-data'),
        postRow ? 'classList=' + postRow.className : 'row not found');
}

// ── DB-3: spotlight block rendered when mnemonic is known ────────────────────
{
    const words = [{ wordAddr: 100, word: 0x00000001 }];
    const result = runBuildDisasmHtml(100, words, {
        plainEnglish: function() { return 'Load capability from namespace'; },
    });
    const body = parseFragment(result.spotlightHtml);
    assert('DB-3: spotlight block present when current word has a mnemonic',
        body.querySelector('.chlog-modal-spotlight') !== null,
        'spotlight element not found');
}

// ── DB-4: spotlight absent when current word is null ─────────────────────────
{
    const words = [{ wordAddr: 100, word: null }];
    const result = runBuildDisasmHtml(100, words);
    assert('DB-4: spotlight HTML is empty string when current word is null',
        result.spotlightHtml === '',
        'spotlightHtml=' + JSON.stringify(result.spotlightHtml));
}

// ─────────────────────────────────────────────────────────────────────────────
// DH tests: _wukongRefreshDisasmHwCursor class toggling
//
//   DH-1  Calling _wukongRefreshDisasmHwCursor with _wukongLastHwNIA set to
//          an address applies .nia-disasm-hw-current to the matching row and
//          leaves non-matching rows without it.
//   DH-2  Calling _wukongRefreshDisasmHwCursor with a different address
//          removes .nia-disasm-hw-current from the previously-highlighted row
//          and adds it to the new one.
// ─────────────────────────────────────────────────────────────────────────────

// ── Source extraction ─────────────────────────────────────────────────────────

function extractRefreshHwCursor(srcPath) {
    const src = fs.readFileSync(path.resolve(__dirname, srcPath), 'utf8');
    const marker = 'function _wukongRefreshDisasmHwCursor()';
    const startIdx = src.indexOf(marker);
    if (startIdx === -1) throw new Error('_wukongRefreshDisasmHwCursor not found in ' + srcPath);
    let depth = 0, end = -1;
    for (let i = startIdx; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { if (--depth === 0) { end = i; break; } }
    }
    if (end === -1) throw new Error('Could not find end of _wukongRefreshDisasmHwCursor');
    return src.slice(startIdx, end + 1);
}

const HW_CURSOR_SRC = extractRefreshHwCursor('app-run.js');

// Build a DOM fixture with .nia-disasm-row elements carrying data-addr attributes,
// then run _wukongRefreshDisasmHwCursor in a sandbox that owns _wukongLastHwNIA.
function makeHwCursorSandbox(addrs, hwNia) {
    const dom = new JSDOM('<!DOCTYPE html><body></body>');
    const document = dom.window.document;

    const rows = addrs.map(function(addr) {
        const row = document.createElement('div');
        row.className = 'nia-disasm-row';
        row.dataset.addr = String(addr);
        document.body.appendChild(row);
        return row;
    });

    const sandbox = {
        document:           document,
        _wukongLastHwNIA:   hwNia,
    };
    const ctx = vm.createContext(new Proxy(sandbox, {
        get(target, prop, receiver) {
            if (prop in target) return Reflect.get(target, prop, receiver);
            if (typeof prop === 'string' && prop in globalThis) return globalThis[prop];
            return undefined;
        },
        has() { return true; },
    }));
    vm.runInContext(HW_CURSOR_SRC, ctx, { filename: 'app-run.js' });

    return { ctx, rows };
}

// Helper: run the cursor function and return the result.
function runHwCursor(ctx) {
    vm.runInContext('_wukongRefreshDisasmHwCursor();', ctx, { filename: 'app-run.js' });
}

// ── DH-1: hw-current applied to the matching row only ────────────────────────
{
    const addrs = [100, 101, 102];
    const { ctx, rows } = makeHwCursorSandbox(addrs, 101);

    runHwCursor(ctx);

    assert('DH-1: matching row (addr 101) gains .nia-disasm-hw-current',
        rows[1].classList.contains('nia-disasm-hw-current'),
        'classList=' + rows[1].className);
    assert('DH-1: non-matching row (addr 100) does not get .nia-disasm-hw-current',
        !rows[0].classList.contains('nia-disasm-hw-current'),
        'classList=' + rows[0].className);
    assert('DH-1: non-matching row (addr 102) does not get .nia-disasm-hw-current',
        !rows[2].classList.contains('nia-disasm-hw-current'),
        'classList=' + rows[2].className);
}

// ── DH-2: hw-current moves when the NIA changes ──────────────────────────────
{
    const addrs = [200, 201];
    const { ctx, rows } = makeHwCursorSandbox(addrs, 200);

    // First call — row 0 highlighted.
    runHwCursor(ctx);
    assert('DH-2: row 0 highlighted before NIA change',
        rows[0].classList.contains('nia-disasm-hw-current'),
        'classList=' + rows[0].className);

    // Move the NIA to addr 201 and re-run.
    ctx._wukongLastHwNIA = 201;
    runHwCursor(ctx);

    assert('DH-2: row 0 loses .nia-disasm-hw-current after NIA moves',
        !rows[0].classList.contains('nia-disasm-hw-current'),
        'classList=' + rows[0].className);
    assert('DH-2: row 1 gains .nia-disasm-hw-current after NIA moves',
        rows[1].classList.contains('nia-disasm-hw-current'),
        'classList=' + rows[1].className);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
