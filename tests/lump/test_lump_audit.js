/**
 * Unit tests for simulator/lump-audit.js
 *
 * Run with Node.js:
 *   node tests/lump/test_lump_audit.js
 *
 * The module is loaded via a minimal shim (no DOM required).
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const src = fs.readFileSync(
    path.join(__dirname, '../../simulator/lump-audit.js'),
    'utf8'
);

const _mod = new Function(
    src + '\nreturn { lumpAudit, lumpAuditHasErrors, lumpAuditHasWarnings };'
)();
const lumpAudit           = _mod.lumpAudit;
const lumpAuditHasErrors  = _mod.lumpAuditHasErrors;
const lumpAuditHasWarnings = _mod.lumpAuditHasWarnings;

let passed = 0;
let failed = 0;

function assert(condition, label) {
    if (condition) {
        console.log(`  \u2713 ${label}`);
        passed++;
    } else {
        console.error(`  \u2717 FAIL: ${label}`);
        failed++;
    }
}

function assertRule(results, ruleId, severity, label) {
    const r = results.find(x => x.ruleId === ruleId);
    if (!r) {
        console.error(`  \u2717 FAIL: ${label} — rule ${ruleId} not found in results`);
        failed++;
        return;
    }
    if (r.severity !== severity) {
        console.error(`  \u2717 FAIL: ${label} — expected severity '${severity}', got '${r.severity}' (detail: ${r.detail})`);
        failed++;
        return;
    }
    console.log(`  \u2713 ${label}`);
    passed++;
}

function buildHeader({ magic = 0x1F, nMinus6 = 0, cw = 1, typ = 0, cc = 0 } = {}) {
    return ((magic & 0x1F) << 27) |
           ((nMinus6 & 0xF) << 23) |
           ((cw & 0x1FFF) << 10) |
           ((typ & 0x3) << 8) |
           (cc & 0xFF);
}

function makeWellFormed({ cw = 2, cc = 1, nMinus6 = 0 } = {}) {
    const lumpSize = 1 << (nMinus6 + 6);
    const header   = buildHeader({ nMinus6, cw, cc });
    const words    = new Array(lumpSize).fill(0);
    words[0] = header;
    for (let i = 1; i <= cw; i++) words[i] = 0x01000000;
    return words;
}

// ─── Test 1: well-formed LUMP — all checks pass ──────────────────────────
console.log('\nTest 1: Well-formed LUMP (all pass)');
{
    const words   = makeWellFormed({ cw: 2, cc: 1, nMinus6: 0 });
    const results = lumpAudit(words, null);
    assertRule(results, 'R1',  'pass', 'R1 magic pass');
    assertRule(results, 'R2',  'pass', 'R2 size pass');
    assertRule(results, 'RB1', 'pass', 'RB1 cw>=1 pass');
    assertRule(results, 'RB2', 'pass', 'RB2 bounds pass');
    assertRule(results, 'RFS', 'pass', 'RFS freespace pass');
    assert(!lumpAuditHasErrors(results),   'no errors');
    assert(!lumpAuditHasWarnings(results), 'no warnings');
}

// ─── Test 2: bad magic — R1 error ────────────────────────────────────────
console.log('\nTest 2: Bad magic (R1 fail)');
{
    const words   = makeWellFormed({ cw: 2, cc: 0, nMinus6: 0 });
    words[0] = buildHeader({ magic: 0x0E, nMinus6: 0, cw: 2, cc: 0 });
    const results = lumpAudit(words, null);
    assertRule(results, 'R1', 'error', 'R1 magic error');
    assert(lumpAuditHasErrors(results), 'has errors');
}

// ─── Test 3: truncated binary — R2 error ─────────────────────────────────
console.log('\nTest 3: Truncated binary (R2 fail)');
{
    const words = makeWellFormed({ cw: 4, cc: 0, nMinus6: 0 });
    const truncated = words.slice(0, 32);
    const results = lumpAudit(truncated, null);
    assertRule(results, 'R2', 'error', 'R2 size error');
    assert(lumpAuditHasErrors(results), 'has errors');
}

// ─── Test 4: non-zero freespace — RFS warn ────────────────────────────────
console.log('\nTest 4: Dirty freespace (RFS warn)');
{
    const words = makeWellFormed({ cw: 2, cc: 0, nMinus6: 0 });
    words[3] = 0xDEADBEEF;
    const results = lumpAudit(words, null);
    assertRule(results, 'RFS', 'warn', 'RFS freespace warn');
    assert(lumpAuditHasWarnings(results), 'has warnings');
    assert(!lumpAuditHasErrors(results),  'no errors');
}

// ─── Test 5: cw+cc overflow — RB2 error ──────────────────────────────────
console.log('\nTest 5: cw+cc bounds overflow (RB2 fail)');
{
    const lumpSize = 64;
    const cw = 60;
    const cc = 10;
    const nMinus6 = 0;
    const header = buildHeader({ nMinus6, cw, cc });
    const words = new Array(lumpSize).fill(0);
    words[0] = header;
    const results = lumpAudit(words, null);
    assertRule(results, 'RB2', 'error', 'RB2 bounds error');
    assert(lumpAuditHasErrors(results), 'has errors');
}

// ─── Test 6: cw=0 — RB1 error ────────────────────────────────────────────
console.log('\nTest 6: cw=0 (RB1 fail)');
{
    const words = makeWellFormed({ cw: 0, cc: 0, nMinus6: 0 });
    const results = lumpAudit(words, null);
    assertRule(results, 'RB1', 'error', 'RB1 cw=0 error');
    assert(lumpAuditHasErrors(results), 'has errors');
}

// ─── Test 7: manifest coherence — RMC pass ───────────────────────────────
console.log('\nTest 7: Manifest coherent (RMC pass)');
{
    const words = makeWellFormed({ cw: 2, cc: 1, nMinus6: 0 });
    const manifest = { cw: 2, cc: 1, lump_size: 64 };
    const results  = lumpAudit(words, manifest);
    assertRule(results, 'RMC', 'pass', 'RMC manifest pass');
    assert(!lumpAuditHasErrors(results), 'no errors');
}

// ─── Test 8: manifest mismatch — RMC error ───────────────────────────────
console.log('\nTest 8: Manifest mismatch (RMC fail)');
{
    const words = makeWellFormed({ cw: 2, cc: 1, nMinus6: 0 });
    const manifest = { cw: 99, cc: 1, lump_size: 64 };
    const results  = lumpAudit(words, manifest);
    assertRule(results, 'RMC', 'error', 'RMC manifest error');
    assert(lumpAuditHasErrors(results), 'has errors');
}

// ─── Test 9: empty binary ────────────────────────────────────────────────
console.log('\nTest 9: Empty binary (R0 error)');
{
    const results = lumpAudit([], null);
    assertRule(results, 'R0', 'error', 'R0 empty binary error');
    assert(lumpAuditHasErrors(results), 'has errors');
}

// ─── Test 10: lumpAuditHasErrors / lumpAuditHasWarnings helpers ──────────
console.log('\nTest 10: Helper functions');
{
    const pass  = [{ ruleId: 'R1', severity: 'pass', message: 'OK', detail: '' }];
    const warn  = [{ ruleId: 'RFS', severity: 'warn', message: 'Dirty', detail: '' }];
    const err   = [{ ruleId: 'R1', severity: 'error', message: 'Bad', detail: '' }];
    assert(!lumpAuditHasErrors(pass) && !lumpAuditHasWarnings(pass), 'all-pass: no errors or warnings');
    assert(!lumpAuditHasErrors(warn) && lumpAuditHasWarnings(warn),  'warn only: no errors, has warnings');
    assert(lumpAuditHasErrors(err)   && !lumpAuditHasWarnings(err),  'error only: has errors, no warnings');
}

// ─── Helpers for RCI / RPN tests ─────────────────────────────────────────

// Build a Church-instruction word that accesses the c-list via CR6.
// op: 0=LOAD, 1=SAVE, 8=ELOADCALL, 9=XLOADLAMBDA; slot = c-list slot index.
function churchWord(op, slot) {
    return ((op & 0x1F) << 27) | (6 << 15) | (slot & 0x7FFF);
}

// Build a BRANCH word with a 15-bit signed offset.
function branchWord(offset) {
    return (17 << 27) | (offset & 0x7FFF);
}

// ─── Test 11: RCI pass — no Church c-list instructions ───────────────────
console.log('\nTest 11: RCI pass (no Church c-list instructions)');
{
    // makeWellFormed uses 0x01000000 code words: op=0, crSrc=0 (not 6) → no c-list access
    const words   = makeWellFormed({ cw: 3, cc: 1, nMinus6: 0 });
    const results = lumpAudit(words, null);
    assertRule(results, 'RCI', 'pass', 'RCI pass with non-c-list code words');
}

// ─── Test 12: RCI pass — LOAD via CR6 slot 0 with cc=1 ───────────────────
console.log('\nTest 12: RCI pass (in-range LOAD via CR6)');
{
    const words   = makeWellFormed({ cw: 2, cc: 1, nMinus6: 0 });
    words[1]      = churchWord(0, 0);   // LOAD CR6, slot=0 — within cc=1
    const results = lumpAudit(words, null);
    assertRule(results, 'RCI', 'pass', 'RCI pass: LOAD slot 0, cc=1');
    assert(!lumpAuditHasErrors(results), 'no errors');
}

// ─── Test 13: RCI error — LOAD via CR6 slot out of range ─────────────────
console.log('\nTest 13: RCI error (slot >= cc)');
{
    const words   = makeWellFormed({ cw: 2, cc: 1, nMinus6: 0 });
    words[1]      = churchWord(0, 5);   // LOAD CR6, slot=5 — cc=1, 5 >= 1 → error
    const results = lumpAudit(words, null);
    assertRule(results, 'RCI', 'error', 'RCI error: LOAD slot 5, cc=1');
    assert(lumpAuditHasErrors(results), 'has errors');
    assert(results.find(r => r.ruleId === 'RCI').detail.includes('slot 5'), 'detail mentions slot 5');
}

// ─── Test 14: RCI error — SAVE via CR6 slot out of range ─────────────────
console.log('\nTest 14: RCI error (SAVE slot out of range)');
{
    const words   = makeWellFormed({ cw: 2, cc: 2, nMinus6: 0 });
    words[1]      = churchWord(1, 9);   // SAVE CR6, slot=9 — cc=2, 9 >= 2 → error
    const results = lumpAudit(words, null);
    assertRule(results, 'RCI', 'error', 'RCI error: SAVE slot 9, cc=2');
}

// ─── Test 15: RCI error — ELOADCALL/XLOADLAMBDA out of range ─────────────
console.log('\nTest 15: RCI error (ELOADCALL and XLOADLAMBDA out of range)');
{
    const words = makeWellFormed({ cw: 3, cc: 1, nMinus6: 0 });
    words[1] = churchWord(8, 2);   // ELOADCALL slot=2, cc=1 → error
    words[2] = churchWord(9, 7);   // XLOADLAMBDA slot=7, cc=1 → error
    const results = lumpAudit(words, null);
    assertRule(results, 'RCI', 'error', 'RCI error: ELOADCALL+XLOADLAMBDA out of range');
    const detail = results.find(r => r.ruleId === 'RCI').detail;
    assert(detail.includes('ELOADCALL'),   'detail mentions ELOADCALL');
    assert(detail.includes('XLOADLAMBDA'), 'detail mentions XLOADLAMBDA');
}

// ─── Test 16: RCI error — BRANCH target out of range (forward) ───────────
console.log('\nTest 16: RCI error (BRANCH target >= cw)');
{
    // cw=2: valid targets are 0 and 1. code[0] (word[1]) BRANCH +10 → target=10 → error.
    const words   = makeWellFormed({ cw: 2, cc: 0, nMinus6: 0 });
    words[1]      = branchWord(10);   // BRANCH +10 from code[0] → target=10 >= cw=2
    const results = lumpAudit(words, null);
    assertRule(results, 'RCI', 'error', 'RCI error: BRANCH forward out of range');
    assert(results.find(r => r.ruleId === 'RCI').detail.includes('BRANCH'), 'detail mentions BRANCH');
}

// ─── Test 17: RCI error — BRANCH target < 0 (backward past start) ────────
console.log('\nTest 17: RCI error (BRANCH target < 0)');
{
    // code[0] (word[1]) BRANCH -1 → target = 0 + (-1) = -1 → error
    const words   = makeWellFormed({ cw: 2, cc: 0, nMinus6: 0 });
    words[1]      = branchWord(-1);
    const results = lumpAudit(words, null);
    assertRule(results, 'RCI', 'error', 'RCI error: BRANCH backward past start');
}

// ─── Test 18: RCI pass — BRANCH self-loop (offset=0) ─────────────────────
console.log('\nTest 18: RCI pass (BRANCH self-loop, offset=0)');
{
    // code[0] BRANCH 0 → target=0 — valid (infinite self-loop)
    const words   = makeWellFormed({ cw: 2, cc: 0, nMinus6: 0 });
    words[1]      = branchWord(0);
    const results = lumpAudit(words, null);
    assertRule(results, 'RCI', 'pass', 'RCI pass: BRANCH self-loop');
}

// ─── Test 19: RCI pass — BRANCH backward one step ────────────────────────
console.log('\nTest 19: RCI pass (BRANCH backward one step)');
{
    // cw=2. code[1] (word[2]) BRANCH -1 → target = 1 + (-1) = 0 — valid
    const words   = makeWellFormed({ cw: 2, cc: 0, nMinus6: 0 });
    words[2]      = branchWord(-1);
    const results = lumpAudit(words, null);
    assertRule(results, 'RCI', 'pass', 'RCI pass: BRANCH back one step');
}

// ─── Test 20: RPN pass — all slots named via pet_names.CR ────────────────
console.log('\nTest 20: RPN pass (all slots named in manifest)');
{
    const words    = makeWellFormed({ cw: 2, cc: 1, nMinus6: 0 });
    words[1]       = churchWord(0, 0);   // LOAD via slot 0
    const manifest = { cw: 2, cc: 1, lump_size: 64, pet_names: { CR: { '0': 'LED0' } } };
    const results  = lumpAudit(words, manifest);
    assertRule(results, 'RPN', 'pass', 'RPN pass: slot 0 named "LED0"');
    assert(!lumpAuditHasErrors(results),   'no errors');
    assert(!lumpAuditHasWarnings(results), 'no warnings');
    assert(results.find(r => r.ruleId === 'RPN').detail.includes('LED0'), 'detail mentions LED0');
}

// ─── Test 21: RPN pass — name via capabilities[] fallback ────────────────
console.log('\nTest 21: RPN pass (name via capabilities array)');
{
    const words    = makeWellFormed({ cw: 2, cc: 1, nMinus6: 0 });
    words[1]       = churchWord(0, 0);
    const manifest = { cw: 2, cc: 1, lump_size: 64, capabilities: [{ name: 'LED0' }] };
    const results  = lumpAudit(words, manifest);
    assertRule(results, 'RPN', 'pass', 'RPN pass: slot 0 named via capabilities');
}

// ─── Test 22: RPN warn — Church instruction uses unnamed slot ─────────────
console.log('\nTest 22: RPN warn (Church instruction uses unnamed slot)');
{
    const words    = makeWellFormed({ cw: 2, cc: 1, nMinus6: 0 });
    words[1]       = churchWord(0, 0);   // LOAD via slot 0 — but no name for slot 0
    const manifest = { cw: 2, cc: 1, lump_size: 64, pet_names: { CR: {} } };
    const results  = lumpAudit(words, manifest);
    assertRule(results, 'RPN', 'warn', 'RPN warn: unnamed slot in Church instruction');
    assert(lumpAuditHasWarnings(results), 'has warnings');
    assert(!lumpAuditHasErrors(results),  'no errors');
}

// ─── Test 23: RPN warn — no pet_names in manifest at all ─────────────────
console.log('\nTest 23: RPN warn (no pet_names in manifest)');
{
    const words    = makeWellFormed({ cw: 2, cc: 1, nMinus6: 0 });
    words[1]       = churchWord(0, 0);
    const manifest = { cw: 2, cc: 1, lump_size: 64 };   // no pet_names, no capabilities
    const results  = lumpAudit(words, manifest);
    assertRule(results, 'RPN', 'warn', 'RPN warn: no pet_names data in manifest');
}

// ─── Test 24: RPN skipped — cc=0 (no c-list) ─────────────────────────────
console.log('\nTest 24: RPN skipped (cc=0)');
{
    const words    = makeWellFormed({ cw: 2, cc: 0, nMinus6: 0 });
    const manifest = { cw: 2, cc: 0, lump_size: 64, pet_names: { CR: {} } };
    const results  = lumpAudit(words, manifest);
    assert(!results.find(r => r.ruleId === 'RPN'), 'RPN not emitted when cc=0');
}

// ─── Test 25: RPN pass — cc=2, both slots named ───────────────────────────
console.log('\nTest 25: RPN pass (cc=2, both slots named)');
{
    const words    = makeWellFormed({ cw: 3, cc: 2, nMinus6: 0 });
    words[1]       = churchWord(0, 0);   // LOAD slot 0
    words[2]       = churchWord(8, 1);   // ELOADCALL slot 1
    const manifest = {
        cw: 3, cc: 2, lump_size: 64,
        pet_names: { CR: { '0': 'LED0', '1': 'UART0' } },
    };
    const results = lumpAudit(words, manifest);
    assertRule(results, 'RPN', 'pass', 'RPN pass: cc=2 both slots named');
    assert(!lumpAuditHasErrors(results),   'no errors');
    assert(!lumpAuditHasWarnings(results), 'no warnings');
}

// ─── Summary ─────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
if (failed === 0) {
    console.log(`\u2713 All ${passed} assertions passed.\n`);
    process.exit(0);
} else {
    console.error(`\u2717 ${failed} assertion${failed !== 1 ? 's' : ''} failed, ${passed} passed.\n`);
    process.exit(1);
}
