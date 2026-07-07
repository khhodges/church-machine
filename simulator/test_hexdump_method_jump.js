// test_hexdump_method_jump.js — regression tests for Task #1995 (Let users
// jump to a specific method from the LUMP hex dump too).
//
// Extracts the REAL production functions from app-lumps.js and exercises
// them against a real compiled LUMP (StringOps, which has 14 manifest
// methods with explicit offsets) to verify:
//   1. _computeLumpMethodWordRanges() derives correct, non-overlapping,
//      contiguous word ranges for every manifest method.
//   2. _scrollToLumpHexMethod() finds the <tr data-method-name="..."> rows
//      tagged by _fetchAndShowLumpBinary()'s annotation logic, scrolls to
//      the first one, and flashes the highlight class on all of them.
//   3. A method name with no matching rows degrades gracefully (toast,
//      no throw) rather than polling forever or crashing.
//
// Exercises: simulator/app-lumps.js — _computeLumpMethodWordRanges,
//                                      _scrollToLumpHexMethod
// Run with: node simulator/test_hexdump_method_jump.js
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { JSDOM } = require('jsdom');

function extractFunctionByName(srcPath, fnName) {
    const src = fs.readFileSync(path.resolve(__dirname, srcPath), 'utf8');
    const lines = src.split('\n');
    const startIdx = lines.findIndex(l =>
        new RegExp(`^(?:async\\s+)?function\\s+${fnName}\\s*\\(`).test(l.trimStart()));
    if (startIdx === -1) throw new Error(`Function ${fnName} not found in ${srcPath}`);
    let depth = 0, endIdx = startIdx;
    for (let i = startIdx; i < lines.length; i++) {
        for (const ch of lines[i]) {
            if (ch === '{') depth++;
            else if (ch === '}') { depth--; if (depth === 0) { endIdx = i; break; } }
        }
        if (depth === 0 && i > startIdx) break;
    }
    return lines.slice(startIdx, endIdx + 1).join('\n');
}

const RANGES_SRC = extractFunctionByName('app-lumps.js', '_computeLumpMethodWordRanges');
const SCROLL_SRC = extractFunctionByName('app-lumps.js', '_scrollToLumpHexMethod');
const TOAST_SRC  = extractFunctionByName('app-run.js', '_dismissFpgaToast') + '\n' +
                   extractFunctionByName('app-run.js', '_showFpgaToast');

const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../server/lumps/50ce4c64.json'), 'utf8'));
const binary   = fs.readFileSync(path.resolve(__dirname, '../server/lumps/50ce4c64.lump'));
const words = [];
for (let i = 0; i + 4 <= binary.length; i += 4) words.push(binary.readUInt32BE(i));

function makeCtx() {
    const dom = new JSDOM('<!DOCTYPE html><body><div id="lumpTabHexdump_TK"></div></body>');
    const document = dom.window.document;
    const sandbox = {
        document, setTimeout, clearTimeout, Promise, console,
        _escHtml: s => String(s),
        sim: null,
        _switchLumpTab: () => {},
    };
    const ctx = vm.createContext(new Proxy(sandbox, {
        get(target, prop, receiver) {
            if (prop in target) return Reflect.get(target, prop, receiver);
            if (typeof prop === 'string' && prop in globalThis) return globalThis[prop];
            if (typeof prop === 'string' && /^[_a-zA-Z]/.test(prop)) return function() {};
            return undefined;
        },
        set(target, prop, value, receiver) { return Reflect.set(target, prop, value, receiver); },
        has() { return true; },
    }));
    vm.runInContext(TOAST_SRC + '\n\n' + RANGES_SRC + '\n\n' + SCROLL_SRC, ctx, { filename: 'hexdump-method-jump.js' });
    return { ctx, document };
}

// Builds a hex table matching the tagging logic added to
// _fetchAndShowLumpBinary(): one <tr data-method-name="..."> per 8-word row
// that falls inside a method's range.
function buildHexTable(document, ranges) {
    const methodAtWord = idx => { for (const r of ranges) if (idx >= r.start && idx < r.end) return r.name; return null; };
    const COLS = 8;
    const rowCount = Math.ceil(words.length / COLS);
    let html = '<table><tbody>';
    for (let row = 0; row < rowCount; row++) {
        const baseIdx = row * COLS;
        const m = methodAtWord(baseIdx);
        html += `<tr${m ? ` data-method-name="${m}"` : ''}><td>row${row}</td></tr>`;
    }
    html += '</tbody></table>';
    document.getElementById('lumpTabHexdump_TK').innerHTML = html;
}

let passed = 0, failed = 0;
function assert(label, condition, detail) {
    if (condition) { console.log('PASS ' + label); passed++; }
    else { console.log('FAIL ' + label + (detail !== undefined ? ' \u2014 ' + detail : '')); failed++; }
}

// ── T1: ranges cover every manifest method, contiguously, in offset order ──
(function t1() {
    const { ctx } = makeCtx();
    const ranges = vm.runInContext('_computeLumpMethodWordRanges', ctx)(manifest, words);
    const liveMethods = manifest.methods.filter(m => !m.aliasOf);

    assert('T1 one range per manifest method', ranges.length === liveMethods.length,
        `${ranges.length} vs ${liveMethods.length}`);
    assert('T1 first method (Pack4) starts at word 1 (offset 0 + header)',
        ranges[0].name === 'Pack4' && ranges[0].start === 1, ranges[0]);

    let contiguous = true;
    for (let i = 1; i < ranges.length; i++) {
        if (ranges[i].start !== ranges[i - 1].end) { contiguous = false; break; }
    }
    assert('T1 ranges are contiguous (no gaps/overlaps)', contiguous, ranges);
})();

// ── T2: jump finds and highlights the right rows in the hex table ─────────
(function t2() {
    const { ctx, document } = makeCtx();
    const ranges = vm.runInContext('_computeLumpMethodWordRanges', ctx)(manifest, words);
    buildHexTable(document, ranges);

    vm.runInContext('_scrollToLumpHexMethod', ctx)('TK', 'IsUpper');
    const rows = document.querySelectorAll('#lumpTabHexdump_TK tr[data-method-name="IsUpper"]');
    assert('T2 IsUpper rows tagged in hex table', rows.length > 0, rows.length);

    setTimeout(() => {
        let highlighted = 0;
        rows.forEach(r => { if (r.classList.contains('lump-hex-method-highlight')) highlighted++; });
        assert('T2 all IsUpper rows highlighted', highlighted === rows.length, `${highlighted}/${rows.length}`);
        t3();
    }, 10);
})();

// ── T3: unknown method name degrades gracefully (toast, no throw, no hang) ─
function t3() {
    const { ctx, document } = makeCtx();
    const ranges = vm.runInContext('_computeLumpMethodWordRanges', ctx)(manifest, words);
    buildHexTable(document, ranges);

    let threw = false;
    try {
        // Force immediate give-up by starting past the retry ceiling.
        vm.runInContext('_scrollToLumpHexMethod', ctx)('TK', 'NoSuchMethod', 999);
    } catch (e) { threw = true; }
    assert('T3 unknown method does not throw', !threw);

    const toastEl = document.getElementById('fpgaToastEl');
    assert('T3 unknown method shows a toast', toastEl !== null);

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
}
