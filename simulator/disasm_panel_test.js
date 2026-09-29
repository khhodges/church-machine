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
// requested row specs. Each spec is:
//   { desc, current, noDesc, addr, label }
//   desc    — string → sets data-desc attribute
//   current — bool  → adds .nia-disasm-current class
//   noDesc  — bool  → row has no data-desc (overrides desc)
//   addr    — numeric word address (defaults to its index)
function makeFixture(rowSpecs) {
    const dom = new JSDOM('<!DOCTYPE html><body></body>');
    const document = dom.window.document;

    const body = document.createElement('div');
    body.className = 'nia-disasm-body';
    document.body.appendChild(body);

    const rows = rowSpecs.map(function(spec, index) {
        const row = document.createElement('div');
        let cls = 'nia-disasm-row';
        if (spec.current) cls += ' nia-disasm-current';
        row.className = cls;
        row.dataset.addr = String(spec.addr === undefined ? index : spec.addr);
        if (spec.desc && !spec.noDesc) {
            row.dataset.desc = spec.desc;
        }
        row.textContent = spec.label || 'row';
        body.appendChild(row);
        return row;
    });

    // Attach the production click handler in the same environment it expects.
    const pinnedMap = new Map();
    const sandbox = {
        disasmBody: body,
        document: document,
        entryUid: 'test-entry',
        _disasmPinnedMap: pinnedMap,
    };
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

    return { document, body, rows, pinnedMap };
}

// Fire a synthetic click whose e.target is the given element. jsdom's click()
// bubbles to the delegated listener on .nia-disasm-body.
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
        console.log('FAIL ' + label + (detail !== undefined ? ' — ' + detail : ''));
        failed++;
    }
}

// ── DP-1: clicking a non-current row with data-desc inserts a desc sibling ───
{
    const { body, rows } = makeFixture([
        { label: 'row A', desc: 'Description for row A', addr: 100 },
    ]);

    click(rows[0]);
    const desc = body.querySelector('.nia-disasm-desc');
    assert('DP-1: click inserts a description element',
        desc !== null, 'querySelector returned null');
    assert('DP-1: description is immediately after the clicked row',
        desc && rows[0].nextElementSibling === desc, 'sibling mismatch');
}

// ── DP-2: at-most-one — clicking row B collapses row A's desc ────────────────
{
    const { body, rows } = makeFixture([
        { label: 'row A', desc: 'Description for row A', addr: 100 },
        { label: 'row B', desc: 'Description for row B', addr: 101 },
    ]);

    click(rows[0]);
    assert('DP-2: first click expands row A',
        body.querySelectorAll('.nia-disasm-desc').length === 1,
        'expected one description after clicking row A');

    click(rows[1]);
    const descs = body.querySelectorAll('.nia-disasm-desc');
    assert('DP-2: only one description remains after clicking row B',
        descs.length === 1, 'count=' + descs.length);
    assert('DP-2: remaining description belongs to row B',
        descs[0] && rows[1].nextElementSibling === descs[0], 'sibling mismatch');
    assert('DP-2: row A description was removed',
        !rows[0].nextElementSibling.classList.contains('nia-disasm-desc'),
        'row A still has a description sibling');
}

// ── DP-3: clicking the same expanded row a second time collapses it ───────────
{
    const { body, rows, pinnedMap } = makeFixture([
        { label: 'row A', desc: 'Description for row A', addr: 100 },
    ]);

    click(rows[0]);
    assert('DP-3: first click opens row A',
        body.querySelector('.nia-disasm-desc') !== null);

    click(rows[0]);
    assert('DP-3: second click removes row A description',
        body.querySelector('.nia-disasm-desc') === null,
        'description still present');
    assert('DP-3: second click clears the row pin',
        !pinnedMap.has('test-entry'), 'row pin remains');
}

// ── DP-4: the current row is not clickable ───────────────────────────────────
{
    const { body, rows } = makeFixture([
        { label: 'current row', desc: 'Current row description', current: true, addr: 100 },
    ]);

    click(rows[0]);
    assert('DP-4: clicking current row inserts no description',
        body.querySelector('.nia-disasm-desc') === null,
        'description found unexpectedly');
}

// ── DP-5: the expanded row receives .nia-row-expanded ────────────────────────
{
    const { rows } = makeFixture([
        { label: 'row A', desc: 'Description for row A', addr: 100 },
    ]);

    click(rows[0]);
    assert('DP-5: expanded row gains .nia-row-expanded',
        rows[0].classList.contains('nia-row-expanded'),
        'classList=' + rows[0].className);
}

// ── DP-6: collapsing a row removes .nia-row-expanded ─────────────────────────
{
    const { rows } = makeFixture([
        { label: 'row A', desc: 'Description for row A', addr: 100 },
    ]);

    click(rows[0]);
    click(rows[0]);
    assert('DP-6: collapsed row loses .nia-row-expanded',
        !rows[0].classList.contains('nia-row-expanded'),
        'classList=' + rows[0].className);
}

// ── DP-7: a row without data-desc is silently ignored ────────────────────────
{
    const { body, rows } = makeFixture([
        { label: 'row without description', noDesc: true, addr: 100 },
    ]);

    click(rows[0]);
    assert('DP-7: click on row without data-desc inserts no description',
        body.querySelector('.nia-disasm-desc') === null,
        'description found unexpectedly');
}

// ── DP-8: inserted description contains the data-desc text ───────────────────
{
    const expected = 'Load capability into register CR3 from namespace slot 7';
    const { body, rows } = makeFixture([
        { label: 'row A', desc: expected, addr: 100 },
    ]);

    click(rows[0]);
    const desc = body.querySelector('.nia-disasm-desc');
    assert('DP-8: inserted description text matches data-desc',
        desc && desc.textContent === expected,
        desc ? JSON.stringify(desc.textContent) : '(no description)');
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);