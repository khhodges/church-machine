// test_rci_threading.js — Unit tests for RCI source-line threading (Task #1412)
// Run:  node simulator/test_rci_threading.js
//
// Coverage:
//   RCI1 — lumpAudit() with lineNums array: violations carry correct sourceLine
//   RCI2 — lumpAudit() without lineNums: violations fall back to sourceLine: null
//   RCI3 — lumpAudit() with partial lineNums (slot missing): falls back to null for that slot
//   RCI4 — compileAssembly result carries lineNums with length matching assembled word count
//   RCI5 — compileAssembly lineNums values are correct 1-based source line numbers
//   RCI6 — lumpAudit() with lineNums: BRANCH violation carries correct sourceLine from lineNums
//   RCI7 — lumpAudit() with multiple RCI violations: each violation gets its own sourceLine
'use strict';

// ── Load modules ─────────────────────────────────────────────────────────────
// lump-audit.js has no module.exports in browser mode, so we load it via the
// Node.js-appended export shim added to the file.
const { lumpAudit } = require('./lump-audit.js');
// rci-show-errs.js exports the production mapping function used by app-compile.js
const { mapRciAuditErrorsToShowErrs } = require('./rci-show-errs.js');

// compileAssembly lives inside CLOOMCCompiler; it also needs ChurchAssembler
// visible in global scope (same pattern used by the compiler in the browser).
global.ChurchAssembler = require('./assembler.js');
const CLOOMCCompiler = require('./cloomc_compiler.js');

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
    if (condition) {
        console.log('PASS ' + label);
        passed++;
    } else {
        console.log('FAIL ' + label + (detail ? ' — ' + detail : ''));
        failed++;
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal 64-word LUMP binary.
 *
 * Header encoding (word 0):
 *   bits[31:27] = 0x1F (magic)
 *   bits[26:23] = nMinus6   (lumpSize = 2^(nMinus6+6); 0 → 64 words)
 *   bits[22:10] = cw        (code word count)
 *   bits[ 7: 0] = cc        (c-list capacity)
 *
 * @param {number[]} codeWords  Words to place at positions [1..cw].
 * @param {number}   cc         C-list capacity (number of c-list slots).
 * @returns {number[]}          64-element array of unsigned 32-bit integers.
 */
function buildLump64(codeWords, cc) {
    const cw = codeWords.length;
    const lumpSize = 64;
    const nMinus6 = 0; // 2^(0+6) = 64
    const header = ((0x1F << 27) | (nMinus6 << 23) | (cw << 10) | cc) >>> 0;
    const words = new Array(lumpSize).fill(0);
    words[0] = header;
    for (let i = 0; i < cw; i++) words[1 + i] = codeWords[i] >>> 0;
    return words;
}

// Instruction encoders (mirrors CLOOMCCompiler.encode):
function encodeInstr(opcode, cond, dst, src, imm) {
    return (
        ((opcode & 0x1F) << 27) |
        ((cond   & 0xF)  << 23) |
        ((dst    & 0xF)  << 19) |
        ((src    & 0xF)  << 15) |
        (imm & 0x7FFF)
    ) >>> 0;
}

const AL   = 14; // always-execute condition
const RETURN_AL = encodeInstr(3, AL, 0, 0, 0);  // 0x1F000000

// LOAD opcode=0, crSrc=6 (c-list access), slot=N
function loadViaSlot(slot) {
    return encodeInstr(0, AL, 0, 6, slot);
}

// ── RCI1: lumpAudit with lineNums → violations carry correct sourceLine ───────
{
    // cc=1 means valid slots are [0] (0-based); slot 2 (>= cc=1) is a range violation.
    const words = buildLump64([loadViaSlot(2), RETURN_AL], 1);
    // lineNums is indexed by word position in the lump binary (0=header, 1=first code word, …)
    const lineNums = [null, 7, 8]; // word[1] came from source line 7
    const results  = lumpAudit(words, null, lineNums);
    const rci = results.find(r => r.ruleId === 'RCI');

    assert('RCI1 audit produces an RCI result', !!rci, 'no RCI entry found');
    assert('RCI1 RCI severity is error', rci && rci.severity === 'error',
        rci ? rci.severity : '–');
    assert('RCI1 violations array present', rci && Array.isArray(rci.violations),
        rci ? JSON.stringify(rci.violations) : '–');
    const v = rci && rci.violations && rci.violations[0];
    assert('RCI1 first violation exists', !!v, 'no violation object');
    assert('RCI1 sourceLine matches lineNums[1] = 7',
        v && v.sourceLine === 7, v ? String(v.sourceLine) : '–');
}

// ── RCI2: lumpAudit without lineNums → violation sourceLine is null ───────────
{
    const words   = buildLump64([loadViaSlot(2), RETURN_AL], 1);
    const results = lumpAudit(words, null /*, no lineNums */);
    const rci = results.find(r => r.ruleId === 'RCI');

    assert('RCI2 audit produces an RCI result', !!rci, 'no RCI entry');
    const v = rci && rci.violations && rci.violations[0];
    assert('RCI2 first violation exists', !!v, 'no violation object');
    assert('RCI2 sourceLine is null when lineNums omitted',
        v && v.sourceLine === null, v ? String(v.sourceLine) : '–');
}

// ── RCI3: partial lineNums (entry missing for the violating word) → null ──────
{
    const words    = buildLump64([loadViaSlot(2), RETURN_AL], 1);
    // lineNums[1] is explicitly undefined (sparse array) — treat as null
    const lineNums = [null]; // length 1, so lineNums[1] is undefined
    const results  = lumpAudit(words, null, lineNums);
    const rci      = results.find(r => r.ruleId === 'RCI');

    const v = rci && rci.violations && rci.violations[0];
    assert('RCI3 violation exists with partial lineNums', !!v, 'no violation');
    assert('RCI3 sourceLine is null when lineNums[wi] is undefined',
        v && v.sourceLine === null, v ? String(v.sourceLine) : '–');
}

// ── RCI4: compileAssembly carries lineNums with length matching word count ─────
{
    const compiler = new CLOOMCCompiler();
    // A simple 3-instruction assembly program (3 source lines → 3 code words)
    const src = 'RETURN\nRETURN\nRETURN\n';
    const result = compiler.compileAssembly(src, []);

    assert('RCI4 compileAssembly succeeds with no errors',
        result.errors.length === 0, result.errors.map(e => e.message).join('; '));
    assert('RCI4 result carries lineNums array',
        Array.isArray(result.lineNums), typeof result.lineNums);

    const wordCount = result.methods.length > 0 ? result.methods[0].code.length : 0;
    assert('RCI4 lineNums length equals word count',
        result.lineNums.length === wordCount,
        `lineNums.length=${result.lineNums.length}, words=${wordCount}`);
}

// ── RCI5: compileAssembly lineNums values are correct 1-based line numbers ─────
{
    const compiler = new CLOOMCCompiler();
    // Three instructions on lines 1, 2, 3 respectively
    const src = 'RETURN\nRETURN\nRETURN\n';
    const result = compiler.compileAssembly(src, []);

    assert('RCI5 compileAssembly succeeds',
        result.errors.length === 0, result.errors.map(e => e.message).join('; '));

    const ln = result.lineNums;
    assert('RCI5 lineNums[0] = 1 (first instruction on line 1)',
        Array.isArray(ln) && ln[0] === 1, ln ? String(ln[0]) : '–');
    assert('RCI5 lineNums[1] = 2 (second instruction on line 2)',
        Array.isArray(ln) && ln[1] === 2, ln ? String(ln[1]) : '–');
    assert('RCI5 lineNums[2] = 3 (third instruction on line 3)',
        Array.isArray(ln) && ln[2] === 3, ln ? String(ln[2]) : '–');

    // Also verify the lineNums on the method object is the same array content
    const methodLn = result.methods.length > 0 ? result.methods[0].lineNums : null;
    assert('RCI5 method.lineNums matches result.lineNums',
        methodLn !== null && JSON.stringify(methodLn) === JSON.stringify(ln),
        methodLn ? JSON.stringify(methodLn) : '(none)');
}

// ── RCI6: BRANCH violation also threads lineNums when provided ────────────────
{
    // Build a lump where the single code word is a BRANCH with out-of-range offset.
    // BRANCH opcode=23 (v2.0 ISA), cond=AL, offset=10 (target codeIdx=0+10=10, but cw=1 so out-of-range)
    const BRANCH_AL_FAR = encodeInstr(23, AL, 0, 0, 10);
    const words    = buildLump64([BRANCH_AL_FAR], 0 /* cc=0 */);
    const lineNums = [null, 99]; // word[1] came from source line 99
    const results  = lumpAudit(words, null, lineNums);
    const rci = results.find(r => r.ruleId === 'RCI');

    assert('RCI6 BRANCH out-of-range produces RCI error', rci && rci.severity === 'error',
        rci ? rci.severity : 'no RCI');
    const v = rci && rci.violations && rci.violations[0];
    assert('RCI6 BRANCH violation present', !!v, 'no violation');
    // lumpAudit threads lineNums for BRANCH violations the same way it does for Church ops
    assert('RCI6 BRANCH violation sourceLine matches lineNums[1] = 99',
        v && v.sourceLine === 99, v ? String(v.sourceLine) : '–');

    // Confirm fallback: without lineNums the BRANCH violation gets sourceLine: null
    const resultsNoLN = lumpAudit(words, null);
    const rciNoLN = resultsNoLN.find(r => r.ruleId === 'RCI');
    const vNoLN   = rciNoLN && rciNoLN.violations && rciNoLN.violations[0];
    assert('RCI6 BRANCH violation sourceLine is null when lineNums omitted',
        vNoLN && vNoLN.sourceLine === null, vNoLN ? String(vNoLN.sourceLine) : '–');
}

// ── RCI7: multiple violations each get their own sourceLine ───────────────────
{
    // cc=1; two LOAD instructions both accessing out-of-range slot 5
    const words = buildLump64([loadViaSlot(5), loadViaSlot(5), RETURN_AL], 1);
    const lineNums = [null, 10, 11, 12]; // words[1]=line10, words[2]=line11
    const results  = lumpAudit(words, null, lineNums);
    const rci = results.find(r => r.ruleId === 'RCI');

    assert('RCI7 audit produces RCI error with two violations',
        rci && rci.severity === 'error' && rci.violations && rci.violations.length === 2,
        rci ? `violations=${rci.violations ? rci.violations.length : 'none'}` : 'no RCI');

    const v0 = rci && rci.violations && rci.violations[0];
    const v1 = rci && rci.violations && rci.violations[1];
    assert('RCI7 first violation sourceLine = 10',
        v0 && v0.sourceLine === 10, v0 ? String(v0.sourceLine) : '–');
    assert('RCI7 second violation sourceLine = 11',
        v1 && v1.sourceLine === 11, v1 ? String(v1.sourceLine) : '–');
}

// ── RCI clean-pass: lumpAudit with lineNums but no violations ─────────────────
{
    // cc=1 and the single LOAD accesses slot 0 (the only valid 0-based slot, range 0..cc-1)
    const words   = buildLump64([loadViaSlot(0), RETURN_AL], 1);
    const lineNums = [null, 3, 4];
    const results  = lumpAudit(words, null, lineNums);
    const rci = results.find(r => r.ruleId === 'RCI');

    assert('RCI-pass RCI severity is pass when no violations',
        rci && rci.severity === 'pass', rci ? rci.severity : 'no RCI');
    assert('RCI-pass violations array absent or empty on pass',
        !rci || !rci.violations || rci.violations.length === 0,
        rci && rci.violations ? String(rci.violations.length) : 'ok');
}

// ── RCI8: slot 0 is valid for a 1-slot lump (regression for off-by-one bug) ──
{
    // cc=1: valid range is 0..cc-1 = 0..0. Slot 0 must pass RCI.
    const words   = buildLump64([loadViaSlot(0), RETURN_AL], 1);
    const results = lumpAudit(words, null);
    const rci = results.find(r => r.ruleId === 'RCI');

    assert('RCI8 slot 0 with cc=1: RCI result present', !!rci, 'no RCI entry');
    assert('RCI8 slot 0 with cc=1: severity is pass (not a violation)',
        rci && rci.severity === 'pass', rci ? rci.severity : '–');
    assert('RCI8 slot 0 with cc=1: no violations array',
        !rci || !rci.violations || rci.violations.length === 0,
        rci && rci.violations ? String(rci.violations.length) : 'ok');
}

// ── RCI9: slot 1 is out of range for a 1-slot lump (0-based boundary check) ──
{
    // cc=1: valid range is 0..0. Slot 1 >= cc=1 must be flagged as a violation.
    const words   = buildLump64([loadViaSlot(1), RETURN_AL], 1);
    const results = lumpAudit(words, null);
    const rci = results.find(r => r.ruleId === 'RCI');

    assert('RCI9 slot 1 with cc=1: RCI result present', !!rci, 'no RCI entry');
    assert('RCI9 slot 1 with cc=1: severity is error',
        rci && rci.severity === 'error', rci ? rci.severity : '–');
    assert('RCI9 slot 1 with cc=1: violation references slot 1',
        rci && Array.isArray(rci.violations) && rci.violations.some(v => v.slot === 1),
        rci && rci.violations ? JSON.stringify(rci.violations.map(v => v.slot)) : '–');
}

// ── Display-layer mapping (Task #1417) ───────────────────────────────────────
//
// DSP1–DSP8 use the real production function mapRciAuditErrorsToShowErrs()
// from rci-show-errs.js (the same function called by app-compile.js at both
// _showAsmErrors call sites).  This ensures tests fail if the production path
// regresses, rather than testing a local copy of the logic.
//
// Mapping contract:
//   • RCI error with violations: one entry per violation that has sourceLine > 0
//     (line = sourceLine); if none qualify, one fallback entry with line: null.
//   • Non-RCI error: one entry with line: null.

// DSP1: single violation with sourceLine → line set
{
    const words    = buildLump64([loadViaSlot(2), RETURN_AL], 1);
    const lineNums = [null, 12, 13];
    const errors   = lumpAudit(words, null, lineNums).filter(r => r.severity === 'error');
    const show     = mapRciAuditErrorsToShowErrs(errors);

    assert('DSP1 one show-error entry produced', show.length === 1, `got ${show.length}`);
    assert('DSP1 line equals sourceLine (12)', show[0] && show[0].line === 12,
        show[0] ? String(show[0].line) : '–');
    assert('DSP1 message starts with [RCI]', show[0] && show[0].message.startsWith('[RCI]'),
        show[0] ? show[0].message : '–');
}

// DSP2: single violation without lineNums → line: null
{
    const words  = buildLump64([loadViaSlot(2), RETURN_AL], 1);
    const errors = lumpAudit(words, null).filter(r => r.severity === 'error');
    const show   = mapRciAuditErrorsToShowErrs(errors);

    assert('DSP2 one show-error entry produced', show.length === 1, `got ${show.length}`);
    assert('DSP2 line is null when no lineNums', show[0] && show[0].line === null,
        show[0] ? String(show[0].line) : '–');
}

// DSP3: multiple violations each with sourceLine → one entry per violation
{
    const words    = buildLump64([loadViaSlot(5), loadViaSlot(5), RETURN_AL], 1);
    const lineNums = [null, 20, 21, 22];
    const errors   = lumpAudit(words, null, lineNums).filter(r => r.severity === 'error');
    const show     = mapRciAuditErrorsToShowErrs(errors);

    assert('DSP3 two entries produced', show.length === 2, `got ${show.length}`);
    assert('DSP3 first entry line = 20', show[0] && show[0].line === 20,
        show[0] ? String(show[0].line) : '–');
    assert('DSP3 second entry line = 21', show[1] && show[1].line === 21,
        show[1] ? String(show[1].line) : '–');
}

// DSP4: two violations — first has sourceLine, second does not → only first emitted
{
    const words    = buildLump64([loadViaSlot(5), loadViaSlot(5), RETURN_AL], 1);
    const lineNums = [null, 30]; // lineNums[2] missing → second violation gets null
    const errors   = lumpAudit(words, null, lineNums).filter(r => r.severity === 'error');
    const show     = mapRciAuditErrorsToShowErrs(errors);

    assert('DSP4 only violations with non-null sourceLine become entries',
        show.length === 1, `got ${show.length}`);
    assert('DSP4 entry line = 30', show[0] && show[0].line === 30,
        show[0] ? String(show[0].line) : '–');
}

// DSP5: all violations have sourceLine null → single fallback with line: null
{
    const words  = buildLump64([loadViaSlot(3), RETURN_AL], 1);
    const errors = lumpAudit(words, null).filter(r => r.severity === 'error');
    const show   = mapRciAuditErrorsToShowErrs(errors);

    assert('DSP5 fallback: one entry when all violations have null sourceLine',
        show.length === 1, `got ${show.length}`);
    assert('DSP5 fallback line is null', show[0] && show[0].line === null,
        show[0] ? String(show[0].line) : '–');
    assert('DSP5 fallback message starts with [RCI]',
        show[0] && show[0].message.startsWith('[RCI]'),
        show[0] ? show[0].message : '–');
}

// DSP6: non-RCI audit error → line: null, message contains ruleId
{
    const fake  = [{ ruleId: 'R1', severity: 'error', message: 'Bad magic', detail: 'word[0]' }];
    const show  = mapRciAuditErrorsToShowErrs(fake);

    assert('DSP6 non-RCI produces one entry', show.length === 1, `got ${show.length}`);
    assert('DSP6 line is null for non-RCI', show[0] && show[0].line === null,
        show[0] ? String(show[0].line) : '–');
    assert('DSP6 message includes [R1]', show[0] && show[0].message.includes('[R1]'),
        show[0] ? show[0].message : '–');
}

// DSP7: RCI + non-RCI mixed → both mapped correctly
{
    const words    = buildLump64([loadViaSlot(2), RETURN_AL], 1);
    const lineNums = [null, 7, 8];
    const rciErrs  = lumpAudit(words, null, lineNums).filter(r => r.severity === 'error');
    const mixed    = [{ ruleId: 'R99', severity: 'error', message: 'Fake', detail: 'injected' }, ...rciErrs];
    const show     = mapRciAuditErrorsToShowErrs(mixed);

    assert('DSP7 two entries total (R99 + RCI)', show.length === 2, `got ${show.length}`);
    assert('DSP7 first entry [R99] has null line',
        show[0] && show[0].line === null && show[0].message.includes('[R99]'),
        show[0] ? JSON.stringify(show[0]) : '–');
    assert('DSP7 second entry [RCI] has line = 7',
        show[1] && show[1].line === 7 && show[1].message.startsWith('[RCI]'),
        show[1] ? JSON.stringify(show[1]) : '–');
}

// DSP8: BRANCH violation with sourceLine → line set on entry
{
    const BRANCH_FAR = encodeInstr(23, AL, 0, 0, 10); // offset 10 out-of-range for cw=1 (v2.0: BRANCH=opcode 23)
    const words      = buildLump64([BRANCH_FAR], 0);
    const lineNums   = [null, 99];
    const errors     = lumpAudit(words, null, lineNums).filter(r => r.severity === 'error');
    const show       = mapRciAuditErrorsToShowErrs(errors);

    assert('DSP8 one show-error entry for BRANCH violation', show.length === 1, `got ${show.length}`);
    assert('DSP8 BRANCH violation line = 99', show[0] && show[0].line === 99,
        show[0] ? String(show[0].line) : '–');
    assert('DSP8 BRANCH violation message starts with [RCI]',
        show[0] && show[0].message.startsWith('[RCI]'),
        show[0] ? show[0].message : '–');
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
