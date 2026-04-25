'use strict';

// Unit tests for _computeReferencedCListSlots() (simulator/app-memory.js).
//
// The function performs a forward sequential scan of instruction words and
// returns { direct, indirect, clobberWarnings } describing which c-list slots
// (accessed via CR6) are referenced directly or indirectly, and where a
// previously-aliased CR was overwritten before use.
//
// ISA encoding (bits 31:27=opcode, 22:19=crDst, 18:15=crSrc, 14:0=imm):
//   LOAD  (0): crDst ← memory[crSrc + imm]   crSrc is the address base
//   SAVE  (1): memory[crSrc + imm] ← crDst   crSrc is the address base
//   ELOADCALL  (8): crSrc is the c-list base
//   XLOADLAMBDA(9): crSrc is the c-list base
//
// For all four opcodes, crSrc === 6 means CR6 is the c-list base → direct ref.
// Only LOAD (opcode 0) writes crDst as a register; SAVE/ELOADCALL/XLOADLAMBDA
// do not overwrite crDst.
//
// These tests verify:
//   T1  Basic direct references via all four opcodes
//   T2  Simple one-hop alias (CR1 = CR6[5], SAVE [CR1+3] = indirect slot 3)
//   T3  Clobbered alias (CR1 overwritten before indirect use → NOT indirect,
//       clobber warning recorded)
//   T4  Chained alias (CR1 ← CR6[5], CR2 ← CR1[3], SAVE [CR2+7] → indirect)
//   T5  Source-order sensitivity (alias established AFTER a SAVE → that SAVE
//       must NOT be marked indirect)
//   T6  Conditional alias: forward branch skips alias setup but the pass is
//       conservative — alias kept live at the merge point
//   T7  Clobber then re-alias (one clobber warning; re-aliased access is indirect)
//   T8  Multiple aliases, one clobbered, one still active
//
// Exits 0 on success, non-zero on any failure.

const fs   = require('fs');
const path = require('path');

// ── Extract _computeReferencedCListSlots from the live production file ────────
// Identical extraction strategy used by sim_clist_analysis.js — brace-counting
// parser so the test always exercises the real implementation, never a copy.

function extractFunctionSource(src, name) {
    const pattern = new RegExp('function\\s+' + name + '\\s*\\(');
    const match   = pattern.exec(src);
    if (!match) throw new Error('Cannot find function ' + name + ' in source');

    let i = match.index;
    while (i < src.length && src[i] !== '{') i++;

    let depth = 0;
    const bodyStart = i; // eslint-disable-line no-unused-vars
    while (i < src.length) {
        if      (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
        i++;
    }
    return src.slice(match.index, i);
}

const srcPath = path.resolve(__dirname, '../../simulator/app-memory.js');
const appSrc  = fs.readFileSync(srcPath, 'utf8');
const fnSrc   = extractFunctionSource(appSrc, '_computeReferencedCListSlots');

// Build the function with `sim` injected as a parameter so it is fully
// isolated from any real browser globals.
const _makeAnalyzer = new Function('sim', fnSrc + '\nreturn _computeReferencedCListSlots;');

// ─── Shared helpers ───────────────────────────────────────────────────────────

const ERRORS = [];
function fail(label, msg) {
    ERRORS.push(`[FAIL] ${label}: ${msg}`);
    process.stderr.write(`[FAIL] ${label}: ${msg}\n`);
}
function pass(label) {
    process.stdout.write(`[PASS] ${label}\n`);
}

function makeHarness(words) {
    const sim      = { memory: words.slice() };
    const analyze  = _makeAnalyzer(sim);
    return {
        run: (count) => analyze(0, count !== undefined ? count : words.length),
    };
}

// ─── Instruction encoding ─────────────────────────────────────────────────────
// crDst at bits[22:19], crSrc at bits[18:15], imm at bits[14:0]

function encodeLoad(crDst, crSrc, imm) {
    return (((0 & 0x1F) << 27) | ((crDst & 0xF) << 19) | ((crSrc & 0xF) << 15) | (imm & 0x7FFF)) >>> 0;
}
function encodeSave(crDst, crSrc, imm) {
    return (((1 & 0x1F) << 27) | ((crDst & 0xF) << 19) | ((crSrc & 0xF) << 15) | (imm & 0x7FFF)) >>> 0;
}
function encodeELoadCall(crDst, crSrc, imm) {
    return (((8 & 0x1F) << 27) | ((crDst & 0xF) << 19) | ((crSrc & 0xF) << 15) | (imm & 0x7FFF)) >>> 0;
}
function encodeXLoadLambda(crDst, crSrc, imm) {
    return (((9 & 0x1F) << 27) | ((crDst & 0xF) << 19) | ((crSrc & 0xF) << 15) | (imm & 0x7FFF)) >>> 0;
}
function encodeBranch(condCode, signedOffset) {
    return (((17 & 0x1F) << 27) | ((condCode & 0xF) << 23) | (signedOffset & 0x7FFF)) >>> 0;
}

// ─── T1: Basic direct references ─────────────────────────────────────────────
// All four opcodes with crSrc=6 should produce a direct entry.

(function testT1BasicDirect() {
    const label = 'T1: direct references via all four opcodes';
    const words = [
        encodeLoad(1, 6, 5),        // LOAD CR1, [CR6+5]        → direct slot 5
        encodeSave(2, 6, 10),       // SAVE CR2, [CR6+10]       → direct slot 10
        encodeELoadCall(0, 6, 20),  // ELOADCALL CR0, [CR6+20]  → direct slot 20
        encodeXLoadLambda(0, 6, 30),// XLOADLAMBDA CR0,[CR6+30] → direct slot 30
    ];
    const { direct, indirect, clobberWarnings } = makeHarness(words).run();
    let ok = true;
    for (const s of [5, 10, 20, 30]) {
        if (!direct.has(s)) { fail(label, `Expected slot ${s} in direct`); ok = false; }
    }
    if (indirect.size !== 0) { fail(label, `Expected no indirect slots, got ${indirect.size}`); ok = false; }
    if (clobberWarnings.length !== 0) { fail(label, `Expected no clobber warnings`); ok = false; }
    if (ok) pass(label);
})();

// ─── T2: Simple one-hop alias ─────────────────────────────────────────────────
// LOAD CR1 from CR6 slot 5 → CR1 aliased.
// SAVE CR0, [CR1+3] → crSrc=1 which is aliased → indirect slot 3.

(function testT2SimpleAlias() {
    const label = 'T2: simple one-hop alias (CR1 = CR6[5], SAVE CR0,[CR1+3])';
    const words = [
        encodeLoad(1, 6, 5),  // CR1 ← c-list[5]      → direct slot 5, CR1 aliased
        encodeSave(0, 1, 3),  // SAVE CR0, [CR1+3]     → indirect slot 3
    ];
    const { direct, indirect, clobberWarnings } = makeHarness(words).run();
    let ok = true;
    if (!direct.has(5))    { fail(label, 'slot 5 missing from direct'); ok = false; }
    if (!indirect.has(3))  { fail(label, 'slot 3 missing from indirect'); ok = false; }
    if (indirect.has(5))   { fail(label, 'slot 5 must not appear in indirect'); ok = false; }
    if (clobberWarnings.length !== 0) { fail(label, `Unexpected clobber warning`); ok = false; }
    if (ok) pass(label);
})();

// ─── T3: Clobbered alias ─────────────────────────────────────────────────────
// CR1 aliased from CR6, then overwritten by LOAD from CR3 (not aliased).
// Subsequent SAVE CR0,[CR1+9] must NOT produce an indirect entry.
// A clobberWarning must be recorded for CR1 at the clobbering instruction.

(function testT3ClobberedAlias() {
    const label = 'T3: clobbered alias (CR1 overwritten before indirect use)';
    const words = [
        encodeLoad(1, 6, 5),  // CR1 ← c-list[5]       → direct slot 5, CR1 aliased (word 0)
        encodeLoad(1, 3, 7),  // CR1 ← [CR3+7]          → CR1 clobbered (word 1)
        encodeSave(0, 1, 9),  // SAVE CR0, [CR1+9]      → crSrc=1 not aliased → NOT indirect
    ];
    const { direct, indirect, clobberWarnings } = makeHarness(words).run();
    let ok = true;
    if (!direct.has(5))    { fail(label, 'slot 5 missing from direct'); ok = false; }
    if (indirect.has(9))   { fail(label, 'slot 9 must NOT be in indirect (alias was clobbered)'); ok = false; }
    if (indirect.size !== 0) { fail(label, `Expected no indirect slots, got ${indirect.size}`); ok = false; }
    if (clobberWarnings.length !== 1) {
        fail(label, `Expected 1 clobber warning, got ${clobberWarnings.length}`); ok = false;
    } else {
        const cw = clobberWarnings[0];
        if (cw.cr !== 1)               { fail(label, `Warning cr should be 1, got ${cw.cr}`); ok = false; }
        if (cw.word !== 1)             { fail(label, `Warning word index should be 1, got ${cw.word}`); ok = false; }
        if (cw.prevAliasedAtWord !== 0){ fail(label, `prevAliasedAtWord should be 0, got ${cw.prevAliasedAtWord}`); ok = false; }
    }
    if (ok) pass(label);
})();

// ─── T4: Chained alias ───────────────────────────────────────────────────────
// CR1 ← CR6[5]     (direct slot 5, CR1 aliased)
// CR2 ← [CR1+3]    (indirect slot 3, CR2 also aliased via chain)
// SAVE CR0,[CR2+7] (indirect slot 7 via CR2 chain)

(function testT4ChainedAlias() {
    const label = 'T4: chained alias (CR1=CR6[5], CR2=CR1[3], SAVE CR0,[CR2+7])';
    const words = [
        encodeLoad(1, 6, 5),  // CR1 ← c-list[5]    → direct slot 5, CR1 aliased
        encodeLoad(2, 1, 3),  // CR2 ← [CR1+3]      → indirect slot 3, CR2 aliased
        encodeSave(0, 2, 7),  // SAVE CR0, [CR2+7]  → indirect slot 7
    ];
    const { direct, indirect, clobberWarnings } = makeHarness(words).run();
    let ok = true;
    if (!direct.has(5))    { fail(label, 'slot 5 missing from direct'); ok = false; }
    if (!indirect.has(3))  { fail(label, 'slot 3 missing from indirect (first hop)'); ok = false; }
    if (!indirect.has(7))  { fail(label, 'slot 7 missing from indirect (second hop via chain)'); ok = false; }
    if (indirect.has(5))   { fail(label, 'slot 5 must not appear in indirect'); ok = false; }
    if (clobberWarnings.length !== 0) { fail(label, `Unexpected clobber warning`); ok = false; }
    if (ok) pass(label);
})();

// ─── T5: Source-order sensitivity ────────────────────────────────────────────
// SAVE CR0,[CR1+9] appears BEFORE CR1 is ever aliased.
// The earlier SAVE must NOT be counted as indirect (no back-propagation).

(function testT5OrderSensitivity() {
    const label = 'T5: source-order (alias after use must not back-propagate)';
    const words = [
        encodeSave(0, 1, 9),  // SAVE CR0, [CR1+9] → CR1 not yet aliased → NOT indirect
        encodeLoad(1, 6, 5),  // CR1 ← c-list[5]   → alias established here (too late)
    ];
    const { direct, indirect, clobberWarnings } = makeHarness(words).run();
    let ok = true;
    if (!direct.has(5))   { fail(label, 'slot 5 missing from direct'); ok = false; }
    if (indirect.has(9))  { fail(label, 'slot 9 must NOT be in indirect (use preceded alias)'); ok = false; }
    if (indirect.size !== 0) { fail(label, `Expected no indirect slots, got ${indirect.size}`); ok = false; }
    if (clobberWarnings.length !== 0) { fail(label, `Unexpected clobber warning`); ok = false; }
    if (ok) pass(label);
})();

// ─── T6: Conditional alias (forward branch skips alias setup) ─────────────────
// The forward pass is conservative: it does not model which path a branch takes.
// An alias established on the non-branch path (word 1) is still live at the
// merge point (word 3), so the subsequent SAVE IS counted as indirect.
//
// Word 0: BRANCHEQ +3  (jump to word 3 when equal — skips words 1-2)
// Word 1: LOAD CR1,[CR6+5]  (only executes on the non-branch path)
// Word 2: NOP
// Word 3: SAVE CR0,[CR1+9]  (CR1 may or may not be aliased here at runtime)
//
// Conservative result: slot 9 IS in indirect (potential false positive, but safe).

(function testT6ConditionalAlias() {
    const label = 'T6: conditional alias — conservative: slot 9 counted as indirect';
    const EQ = 0;
    const words = [
        encodeBranch(EQ, 3),     // word 0: BRANCHEQ +3  → may skip to word 3
        encodeLoad(1, 6, 5),     // word 1: CR1 ← c-list[5]  (alias on non-branch path)
        0,                       // word 2: NOP
        encodeSave(0, 1, 9),     // word 3: SAVE CR0,[CR1+9]
    ];
    const { direct, indirect, clobberWarnings } = makeHarness(words).run();
    let ok = true;
    if (!direct.has(5))   { fail(label, 'slot 5 missing from direct'); ok = false; }
    if (!indirect.has(9)) {
        fail(label, 'slot 9 missing from indirect (conservative forward pass)'); ok = false;
    }
    if (clobberWarnings.length !== 0) { fail(label, `Unexpected clobber warning`); ok = false; }
    if (ok) pass(label);
})();

// ─── T7: Clobber then re-alias ────────────────────────────────────────────────
// CR1 aliased, clobbered (one warning), then re-aliased via a second LOAD from
// CR6.  The access AFTER re-aliasing must be counted as indirect.

(function testT7ClobberThenReAlias() {
    const label = 'T7: clobber then re-alias (warning emitted; re-aliased use is indirect)';
    const words = [
        encodeLoad(1, 6, 5),   // CR1 ← c-list[5]     → direct slot 5, CR1 aliased
        encodeLoad(1, 3, 0),   // CR1 ← [CR3+0]       → CR1 clobbered  → clobber warning
        encodeLoad(1, 6, 11),  // CR1 ← c-list[11]    → direct slot 11, CR1 re-aliased
        encodeSave(0, 1, 4),   // SAVE CR0, [CR1+4]   → indirect slot 4
    ];
    const { direct, indirect, clobberWarnings } = makeHarness(words).run();
    let ok = true;
    if (!direct.has(5))    { fail(label, 'slot 5 missing from direct'); ok = false; }
    if (!direct.has(11))   { fail(label, 'slot 11 missing from direct'); ok = false; }
    if (!indirect.has(4))  { fail(label, 'slot 4 missing from indirect (after re-alias)'); ok = false; }
    if (indirect.has(0))   { fail(label, 'imm 0 from clobber load must not be in indirect'); ok = false; }
    if (clobberWarnings.length !== 1) {
        fail(label, `Expected 1 clobber warning, got ${clobberWarnings.length}`); ok = false;
    } else if (clobberWarnings[0].cr !== 1) {
        fail(label, `Warning should name CR1, got CR${clobberWarnings[0].cr}`); ok = false;
    }
    if (ok) pass(label);
})();

// ─── T8: Multiple aliases, one clobbered ──────────────────────────────────────
// CR1 and CR2 both aliased from CR6.
// CR1 is then clobbered by LOAD from CR4 → clobber warning for CR1.
// SAVE CR0,[CR1+13] → NOT indirect (CR1 clobbered).
// SAVE CR0,[CR2+15] → indirect slot 15 (CR2 still aliased).

(function testT8MultipleAliasesOneClobbered() {
    const label = 'T8: multiple aliases (CR1 clobbered, CR2 still active)';
    const words = [
        encodeLoad(1, 6, 2),   // CR1 ← c-list[2]    → direct slot 2
        encodeLoad(2, 6, 8),   // CR2 ← c-list[8]    → direct slot 8
        encodeLoad(1, 4, 0),   // CR1 ← [CR4+0]      → CR1 clobbered (clobber warning)
        encodeSave(0, 1, 13),  // SAVE CR0,[CR1+13]  → NOT indirect (CR1 clobbered)
        encodeSave(0, 2, 15),  // SAVE CR0,[CR2+15]  → indirect slot 15 (CR2 alive)
    ];
    const { direct, indirect, clobberWarnings } = makeHarness(words).run();
    let ok = true;
    if (!direct.has(2))    { fail(label, 'slot 2 missing from direct'); ok = false; }
    if (!direct.has(8))    { fail(label, 'slot 8 missing from direct'); ok = false; }
    if (indirect.has(13))  { fail(label, 'slot 13 must NOT be indirect (CR1 clobbered)'); ok = false; }
    if (!indirect.has(15)) { fail(label, 'slot 15 missing from indirect (CR2 still aliased)'); ok = false; }
    if (clobberWarnings.length !== 1) {
        fail(label, `Expected 1 clobber warning, got ${clobberWarnings.length}`); ok = false;
    } else if (clobberWarnings[0].cr !== 1) {
        fail(label, `Clobber warning should name CR1, got CR${clobberWarnings[0].cr}`); ok = false;
    }
    if (ok) pass(label);
})();

// ─── Report ───────────────────────────────────────────────────────────────────

if (ERRORS.length > 0) {
    process.stderr.write(`\n${ERRORS.length} test(s) failed.\n`);
    process.exit(1);
}
process.exit(0);
