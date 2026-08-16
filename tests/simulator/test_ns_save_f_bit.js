#!/usr/bin/env node
// test_ns_save_f_bit.js — guard: the Save NS Table path must write the F bit
// truthfully via parseNSWord1(), never as a hardcoded literal.
//
// Two checks:
//  1. Functional: whatever parseNSWord1(word1).f reports for a word with
//     bit[30] set is what an F=<x> entry round-trips to.  In v2.0 the F flag
//     is retired and parseNSWord1 returns f:0 by design (bit[30] is the GC
//     liveness mark) — the save path must follow the parser, so if F is ever
//     reintroduced the saved value tracks it automatically.
//  2. Source guard: the ns_state rich-row builder in app-memory.js derives
//     `f:` from `_pW1.f` (the parseNSWord1 result) and contains no `f: 0`
//     hardcode (the regression this test was written for).

'use strict';

const fs   = require('fs');
const path = require('path');

let failures = 0;
function assert(name, cond) {
    if (cond) { console.log(`  ok   ${name}`); }
    else      { console.error(`  FAIL ${name}`); failures++; }
}

// ── 1. Functional: parseNSWord1 F semantics round-trip ──────────────────────
global.localStorage = {
    _s: {},
    getItem(k) { return this._s[k] !== undefined ? this._s[k] : null; },
    setItem(k, v) { this._s[k] = String(v); },
    removeItem(k) { delete this._s[k]; },
};
const ChurchSimulator = require(path.join(__dirname, '..', '..', 'simulator', 'simulator.js'));
const sim = new ChurchSimulator();

// Word1 with bit[30] set (would have been F=1 in v1.x; GC liveness in v2.0).
const w1WithBit30 = ((1 << 30) | (1 << 26) | (5 << 17) | 0x3A) >>> 0;
const parsed = sim.parseNSWord1(w1WithBit30);

// The saved F value must equal what the parser reports — for v2.0 that is 0
// (F retired; bit[30] is NOT the F flag).  The save path mirrors _pW1.f, so
// this pins the parser contract the save path relies on.
assert('parseNSWord1 exposes an f field', typeof parsed.f === 'number');
assert('v2.0: bit[30] is not reported as F (f === 0, GC liveness mark)', parsed.f === 0);
assert('gtType still decodes correctly with bit[30] set', parsed.gtType === 1);
assert('g bit unaffected by bit[30]', parsed.g === 0);

// ── 2. Source guard: save path uses _pW1.f, no hardcoded f ──────────────────
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'simulator', 'app-memory.js'), 'utf8');

// Locate the ns_state rich-row builder block.
const blockStart = src.indexOf('const nsAbstractions = [');
const blockEnd   = src.indexOf('const nsState =', blockStart);
assert('ns_state rich-row builder block found', blockStart !== -1 && blockEnd > blockStart);
const block = src.slice(blockStart, blockEnd);

assert('save path reads F via parseNSWord1 result (_pW1.f)', /f:\s*_pW1\.f\b/.test(block));
assert('save path has no `f: 0` hardcode', !/f:\s*0\s*[,}]/.test(block));

if (failures) {
    console.error(`\ntest_ns_save_f_bit: ${failures} check(s) FAILED`);
    process.exit(1);
}
console.log('\ntest_ns_save_f_bit: all checks passed.');
