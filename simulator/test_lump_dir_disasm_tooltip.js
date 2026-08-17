// test_lump_dir_disasm_tooltip.js — Regression tests for the Lumps Directory
// _disMnem() c-list name annotation feature (Task #2747).
//
// Verifies:
//   DT-1  LOAD from CR6 (src=6) appends → Name when slot is in clistNames
//   DT-2  SAVE with src=CR6 appends → Name when slot is in clistNames
//   DT-3  ELOADCALL uses imm & 0x1F for slot; nonzero method field handled correctly
//   DT-4  CALL does not append cap name (imm is a method selector, not a c-list slot)
//   DT-4b ELOADCALL via non-CR6 register does NOT append cap name
//   DT-5  LOAD from a register other than CR6 does not append cap name
//   DT-6  slot not in clistNames does not append cap name
//   DT-7  empty clistNames never appends cap name
//
// Run with: node simulator/test_lump_dir_disasm_tooltip.js
'use strict';

const fs   = require('fs');
const path = require('path');

// ── Extract the ISA tables + _disMnem block from the HTML ────────────────────
// OPNAMES/CONDS are defined just before _disMnem in the same IIFE.
// _disMnem closes over `clistNames`, which we inject as a parameter.

function extractDisMnemBlock() {
    const html = fs.readFileSync(
        path.resolve(__dirname, '../docs/figures/Lumps Directory.html'), 'utf8');

    const opStart = html.indexOf('const OPNAMES = {');
    if (opStart === -1) throw new Error('OPNAMES table not found');
    const opEnd = html.indexOf('};\n', opStart) + 3;

    const condStart = html.indexOf('const CONDS = [', opEnd);
    if (condStart === -1) throw new Error('CONDS array not found');
    const condEnd = html.indexOf('];\n', condStart) + 3;

    const fnMarker = 'function _disMnem(w32)';
    const fnStart  = html.indexOf(fnMarker, condEnd);
    if (fnStart === -1) throw new Error('_disMnem function not found');
    let depth = 0, fnEnd = -1;
    for (let i = fnStart; i < html.length; i++) {
        if (html[i] === '{') depth++;
        else if (html[i] === '}') { if (--depth === 0) { fnEnd = i; break; } }
    }
    if (fnEnd === -1) throw new Error('Could not find closing brace of _disMnem');

    return html.slice(opStart, opEnd) +
           html.slice(condStart, condEnd) +
           html.slice(fnStart, fnEnd + 1);
}

const DISMNEM_BLOCK = extractDisMnemBlock();

// Build a _disMnem function bound to a given mock clistNames map.
function makeDisMnem(mockClistNames) {
    // eslint-disable-next-line no-new-func
    const factory = new Function('clistNames', `${DISMNEM_BLOCK}\nreturn _disMnem;`);
    return factory(mockClistNames);
}

// ── Instruction word encoding ────────────────────────────────────────────────
// w32 = (op<<27)|(cond<<23)|(dst<<19)|(src<<15)|imm  — cond 14 = AL (always)
function encodeWord(op, dst, src, imm, cond = 14) {
    return ((op & 0x1F) * (1 << 27)) |
           ((cond & 0xF) * (1 << 23)) |
           ((dst  & 0xF) * (1 << 19)) |
           ((src  & 0xF) * (1 << 15)) |
           (imm & 0x7FFF);
}

// ── Test harness ─────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function check(id, desc, actual, expected) {
    if (actual === expected) {
        console.log(`  ✓ ${id}  ${desc}`);
        passed++;
    } else {
        console.error(`  ✗ ${id}  ${desc}`);
        console.error(`       expected: ${JSON.stringify(expected)}`);
        console.error(`       actual:   ${JSON.stringify(actual)}`);
        failed++;
    }
}

const CLIST_TWO   = { 0: 'Boot.NS', 1: 'SelfTest' };
const CLIST_EMPTY = {};

// ── DT-1  LOAD from CR6 appends abstraction name ─────────────────────────────
console.log('\n── DT-1  LOAD from CR6 appends abstraction name ─────────────────────────');
{
    const d = makeDisMnem(CLIST_TWO);
    const line1 = d(encodeWord(/*LOAD*/0, /*dst*/0, /*src=CR6*/6, /*imm*/1));
    check('DT-1a', 'line contains slot=#1',    line1.includes('slot=#1'),    true);
    check('DT-1b', 'appends → SelfTest',        line1.includes('→ SelfTest'), true);

    const line0 = d(encodeWord(0, 0, 6, 0));
    check('DT-1c', 'slot=#0 appends → Boot.NS', line0.includes('→ Boot.NS'), true);
}

// ── DT-2  SAVE with src=CR6 appends abstraction name ─────────────────────────
console.log('\n── DT-2  SAVE with src=CR6 appends abstraction name ─────────────────────');
{
    const d = makeDisMnem(CLIST_TWO);
    // SAVE op=1, dst=2, src=CR6, imm=0
    const line = d(encodeWord(/*SAVE*/1, /*dst*/2, /*src=CR6*/6, /*imm*/0));
    check('DT-2a', 'line is SAVE with slot=#0',  line.includes('SAVE') && line.includes('slot=#0'), true);
    check('DT-2b', 'SAVE src=CR6 → Boot.NS',     line.includes('→ Boot.NS'), true);

    // slot=1 → SelfTest
    const line1 = d(encodeWord(1, 0, 6, 1));
    check('DT-2c', 'SAVE slot=#1 → SelfTest',    line1.includes('→ SelfTest'), true);
}

// ── DT-3  ELOADCALL uses imm & 0x1F; nonzero method field ────────────────────
console.log('\n── DT-3  ELOADCALL slot/method split and name annotation ────────────────');
{
    const d = makeDisMnem(CLIST_TWO);
    // slot=1, method=3  →  imm = (3<<5)|1 = 97
    const line = d(encodeWord(/*ELOADCALL*/8, 0, /*src=CR6*/6, (3 << 5) | 1));
    check('DT-3a', 'line starts with ELOADCALL', line.startsWith('ELOADCALL'), true);
    check('DT-3b', 'slot field shows #1',         line.includes('slot=#1'),    true);
    check('DT-3c', 'method field shows #3',        line.includes('method=#3'), true);
    check('DT-3d', 'appends → SelfTest (slot 1)', line.includes('→ SelfTest'), true);

    // slot=0, method=5  →  imm = (5<<5)|0 = 160
    const line2 = d(encodeWord(8, 0, 6, (5 << 5) | 0));
    check('DT-3e', 'slot=#0 appends → Boot.NS',  line2.includes('→ Boot.NS'), true);
    check('DT-3f', 'method=#5 shown correctly',   line2.includes('method=#5'), true);
}

// ── DT-4  CALL does NOT append cap name ──────────────────────────────────────
console.log('\n── DT-4  CALL does NOT append cap name ──────────────────────────────────');
{
    const d = makeDisMnem(CLIST_TWO);
    // CALL op=2, dst=0, src=1 (not CR6), imm=1 (same as a valid clistNames key)
    const line = d(encodeWord(/*CALL*/2, 0, 1, 1));
    check('DT-4a', 'line starts with CALL',       line.startsWith('CALL'), true);
    check('DT-4b', 'CALL does not append →',      !line.includes('→'),     true);
}

// ── DT-4b  ELOADCALL via non-CR6 does NOT append cap name ────────────────────
console.log('\n── DT-4b ELOADCALL via non-CR6 does NOT append cap name ─────────────────');
{
    const d = makeDisMnem(CLIST_TWO);
    // ELOADCALL op=8, src=5 (not CR6), slot=0, method=0
    const line = d(encodeWord(8, 0, /*src=CR5*/5, 0));
    check('DT-4b-1', 'line starts with ELOADCALL', line.startsWith('ELOADCALL'), true);
    check('DT-4b-2', 'non-CR6 src: no → appended', !line.includes('→'),          true);
}

// ── DT-5  LOAD from non-CR6 register does NOT append cap name ────────────────
console.log('\n── DT-5  LOAD from non-CR6 does NOT append cap name ─────────────────────');
{
    const d = makeDisMnem(CLIST_TWO);
    // LOAD op=0, src=5 (not CR6), imm=1
    const line = d(encodeWord(0, 0, /*src=CR5*/5, 1));
    check('DT-5a', 'line is LOAD with slot=#1',  line.includes('LOAD') && line.includes('slot=#1'), true);
    check('DT-5b', 'non-CR6 source: no →',       !line.includes('→'), true);
}

// ── DT-6  slot not in clistNames does NOT append cap name ─────────────────────
console.log('\n── DT-6  slot not in clistNames does NOT append cap name ────────────────');
{
    const d = makeDisMnem(CLIST_TWO); // only slots 0 and 1
    const line = d(encodeWord(0, 0, 6, /*imm*/5)); // slot 5 absent
    check('DT-6a', 'missing slot: no →', !line.includes('→'), true);
}

// ── DT-7  empty clistNames never appends cap name ─────────────────────────────
console.log('\n── DT-7  empty clistNames never appends cap name ────────────────────────');
{
    const d = makeDisMnem(CLIST_EMPTY);
    check('DT-7a', 'LOAD no →',      !d(encodeWord(0, 0, 6, 0)).includes('→'), true);
    check('DT-7b', 'SAVE no →',      !d(encodeWord(1, 0, 6, 0)).includes('→'), true);
    check('DT-7c', 'ELOADCALL no →', !d(encodeWord(8, 0, 6, 0)).includes('→'), true);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
