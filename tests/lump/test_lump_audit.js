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

function makeWellFormed({ cw = 2, cc = 1, nMinus6 = 0, typ = 0 } = {}) {
    const lumpSize = 1 << (nMinus6 + 6);
    const header   = buildHeader({ nMinus6, cw, cc, typ });
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

// ─── Test 4: non-zero freespace — RFS error ───────────────────────────────
console.log('\nTest 4: Dirty freespace (RFS error)');
{
    const words = makeWellFormed({ cw: 2, cc: 0, nMinus6: 0 });
    words[3] = 0xDEADBEEF;
    const results = lumpAudit(words, null);
    assertRule(results, 'RFS', 'error', 'RFS freespace error');
    assert(lumpAuditHasErrors(results),    'has errors');
    assert(!lumpAuditHasWarnings(results), 'no warnings');
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

// ─── Test 6: cw=0, typ=00 (executable) — RB1 error ───────────────────────
console.log('\nTest 6: cw=0 typ=00 (RB1 fail)');
{
    const words = makeWellFormed({ cw: 0, cc: 0, nMinus6: 0, typ: 0 });
    const results = lumpAudit(words, null);
    assertRule(results, 'RB1', 'error', 'RB1 cw=0 typ=00 error');
    assert(lumpAuditHasErrors(results), 'has errors');
}

// ─── Test 6b: cw=0, typ=01 (data lump) — RB1 pass ────────────────────────
console.log('\nTest 6b: cw=0 typ=01 (data lump — RB1 pass)');
{
    const words = makeWellFormed({ cw: 0, cc: 0, nMinus6: 0, typ: 1 });
    const results = lumpAudit(words, null);
    assertRule(results, 'RB1', 'pass', 'RB1 cw=0 typ=01 data lump pass');
    assert(!lumpAuditHasErrors(results), 'no errors');
}

// ─── Test 6c: typ=10 (Thread/clist-only) — RB1 pass ─────────────────────
// For Thread lumps, cw is reinterpreted as sw (stack words) and cc as
// heapWords. Both must be >0; geometry must fit: 17+sw+cc ≤ lumpSize-12.
// 64-word lump (nMinus6=0): sw=2, hw=4 → 1+16+4+2+12=35 ≤ 64 ✓
console.log('\nTest 6c: typ=10 Thread — sw=2, heapWords=4, geometry valid (RB1 pass)');
{
    const words = makeWellFormed({ cw: 2, cc: 4, nMinus6: 0, typ: 2 });
    const results = lumpAudit(words, null);
    assertRule(results, 'RB1', 'pass', 'RB1 typ=10 Thread geometry valid pass');
    assert(!lumpAuditHasErrors(results), 'no errors');
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
// v2.0 ISA: BRANCH is opcode 23 (opcode 17 = DWRITE, not BRANCH).
function branchWord(offset) {
    return (23 << 27) | (offset & 0x7FFF);
}

// ─── Test 11: RCI pass — no Church c-list instructions ───────────────────
console.log('\nTest 11: RCI pass (no Church c-list instructions)');
{
    // makeWellFormed uses 0x01000000 code words: op=0, crSrc=0 (not 6) → no c-list access
    const words   = makeWellFormed({ cw: 3, cc: 1, nMinus6: 0 });
    const results = lumpAudit(words, null);
    assertRule(results, 'RCI', 'pass', 'RCI pass with non-c-list code words');
}

// ─── Test 12: RCI pass — LOAD via CR6 slot 0 with cc=1 (0-based) ─────────
console.log('\nTest 12: RCI pass (in-range LOAD via CR6, 0-based)');
{
    const words   = makeWellFormed({ cw: 2, cc: 1, nMinus6: 0 });
    words[1]      = churchWord(0, 0);   // LOAD CR6, slot=0 — within cc=1 (0-based: valid range 0..0)
    const results = lumpAudit(words, null);
    assertRule(results, 'RCI', 'pass', 'RCI pass: LOAD slot 0, cc=1');
    assert(!lumpAuditHasErrors(results), 'no errors');
}

// ─── Test 12b: RCI error — slot 1 is out of range for cc=1 (0-based) ─────
console.log('\nTest 12b: RCI error (slot 1 out of range for cc=1, 0-based ISA)');
{
    const words   = makeWellFormed({ cw: 2, cc: 1, nMinus6: 0 });
    words[1]      = churchWord(0, 1);   // LOAD CR6, slot=1 — invalid (0-based: only slot 0 in cc=1 lump)
    const results = lumpAudit(words, null);
    assertRule(results, 'RCI', 'error', 'RCI error: slot 1 out of range for cc=1');
    assert(lumpAuditHasErrors(results), 'has errors');
    assert(results.find(r => r.ruleId === 'RCI').detail.includes('slot 1'), 'detail mentions slot 1');
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

// ─── Test 20: RPN pass — all slots named via pet_names.CR (0-based keys) ─
// c-list slot uses a valid non-null Inform GT so RNC does not fire a warning.
// 0x5A000001 = Church Inform E-GT (bits[26:25]=01, bit27=1, bit30=1), slot=1.
console.log('\nTest 20: RPN pass (all slots named in manifest, 0-based keys)');
{
    const words    = makeWellFormed({ cw: 2, cc: 1, nMinus6: 0 });
    words[1]       = churchWord(0, 0);   // LOAD via slot 0 (0-based: valid range 0..0)
    words[63]      = 0x5A000001;         // non-null Inform GT — suppresses RNC warning
    const manifest = { cw: 2, cc: 1, lump_size: 64, pet_names: { CR: { '0': 'LED0' } } };
    const results  = lumpAudit(words, manifest);
    assertRule(results, 'RPN', 'pass', 'RPN pass: slot 0 named "LED0"');
    assert(!lumpAuditHasErrors(results),   'no errors');
    assert(!lumpAuditHasWarnings(results), 'no warnings');
    assert(results.find(r => r.ruleId === 'RPN').detail.includes('LED0'), 'detail mentions LED0');
}

// ─── Test 21: RPN pass — name via capabilities[] fallback (0-based) ──────
console.log('\nTest 21: RPN pass (name via capabilities array, 0-based)');
{
    const words    = makeWellFormed({ cw: 2, cc: 1, nMinus6: 0 });
    words[1]       = churchWord(0, 0);   // LOAD via slot 0 (0-based: valid range 0..0)
    const manifest = { cw: 2, cc: 1, lump_size: 64, capabilities: [{ name: 'LED0' }] };
    const results  = lumpAudit(words, manifest);
    assertRule(results, 'RPN', 'pass', 'RPN pass: slot 0 named via capabilities[0]');
}

// ─── Test 22: RPN warn — Church instruction uses unnamed slot (0-based) ───
console.log('\nTest 22: RPN warn (Church instruction uses unnamed slot, 0-based)');
{
    const words    = makeWellFormed({ cw: 2, cc: 1, nMinus6: 0 });
    words[1]       = churchWord(0, 0);   // LOAD via slot 0 — but no name for slot 0
    const manifest = { cw: 2, cc: 1, lump_size: 64, pet_names: { CR: {} } };
    const results  = lumpAudit(words, manifest);
    assertRule(results, 'RPN', 'warn', 'RPN warn: unnamed slot in Church instruction');
    assert(lumpAuditHasWarnings(results), 'has warnings');
    assert(!lumpAuditHasErrors(results),  'no errors');
}

// ─── Test 23: RPN warn — no pet_names in manifest at all (0-based) ───────
console.log('\nTest 23: RPN warn (no pet_names in manifest, 0-based)');
{
    const words    = makeWellFormed({ cw: 2, cc: 1, nMinus6: 0 });
    words[1]       = churchWord(0, 0);   // LOAD via slot 0 (0-based: valid range 0..0)
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

// ─── Test 25: RPN pass — cc=2, both slots named (0-based keys) ──────────
// Both c-list slots use valid non-null Inform GTs so RNC does not fire.
console.log('\nTest 25: RPN pass (cc=2, both slots named, 0-based keys)');
{
    const words    = makeWellFormed({ cw: 3, cc: 2, nMinus6: 0 });
    words[1]       = churchWord(0, 0);   // LOAD slot 0 (0-based: valid range 0..1)
    words[2]       = churchWord(8, 1);   // ELOADCALL slot 1 (0-based: valid range 0..1)
    words[62]      = 0x5A000001;         // non-null Inform GT for slot 0
    words[63]      = 0x5A000002;         // non-null Inform GT for slot 1
    const manifest = {
        cw: 3, cc: 2, lump_size: 64,
        pet_names: { CR: { '0': 'LED0', '1': 'UART0' } },
    };
    const results = lumpAudit(words, manifest);
    assertRule(results, 'RPN', 'pass', 'RPN pass: cc=2 both slots named');
    assert(!lumpAuditHasErrors(results),   'no errors');
    assert(!lumpAuditHasWarnings(results), 'no warnings');
}

// ─── Thread lump helpers ──────────────────────────────────────────────────

// Build a Thread lump header (typ=10).
// cw field = sw (stack words), cc field = heapWords.
function makeThreadHeader({ nMinus6 = 2, sw = 32, hw = 64 } = {}) {
    return buildHeader({ nMinus6, cw: sw, typ: 2, cc: hw });
}

// Build a valid 256-word Thread lump (n-6=2 → lumpSize=256, sw=32, hw=64).
// Layout per CM_LUMP_SPECIFICATION.md Appendix A:
//   Word 0:      header (magic=0x1F, n-6=2, sw=32, typ=10, heapWords=64)
//   Words 1..16: DR0..DR15 data registers (may be non-zero for a live thread)
//   Words 17..80: heap zone (heapWords=64 words; may be non-zero)
//   Words 81..211: freespace (collision zone; all-zero at creation time)
//   Words 212..243: stack zone (sw=32 words; grows downward; may be non-zero)
//   Words 244..255: caps zone (12 architecture-fixed GT Word 0 values)
//
// fsStart = 17 + heapWords = 17 + 64 = 81
// fsEnd   = lumpSize - 12 - sw = 256 - 12 - 32 = 212
function makeValidThread({ sw = 32, hw = 64, nMinus6 = 2 } = {}) {
    const lumpSize = 1 << (nMinus6 + 6);
    const words = new Array(lumpSize).fill(0);
    words[0] = makeThreadHeader({ nMinus6, sw, hw });
    // Non-zero DRs and stack (live thread state — not freespace, so allowed)
    for (let i = 1; i <= 16; i++) words[i] = 0x12340000 + i;   // DR0..DR15
    const stackMin = lumpSize - 12 - sw;
    for (let i = stackMin; i < lumpSize - 12; i++) words[i] = 0xABCD0000 + i; // stack
    // Caps zone (12 words at lumpSize-12): valid or null GTs
    for (let i = lumpSize - 12; i < lumpSize; i++) words[i] = 0x4A000000 + (i - (lumpSize - 12));
    // Freespace (81..211): all-zero (already zeroed by fill(0))
    return words;
}

// ─── Test 28: Valid Thread lump — all rules pass ──────────────────────────
console.log('\nTest 28: Valid Thread lump (sw=32, hw=64, non-zero DRs/stack/caps)');
{
    const words = makeValidThread();
    const results = lumpAudit(words, null);
    assertRule(results, 'RB1', 'pass', 'RB1 pass: Thread geometry valid');
    assertRule(results, 'RFS', 'pass', 'RFS pass: Thread freespace (words 81..211) zeroed');
    assertRule(results, 'RGT', 'pass', 'RGT pass: Thread caps zone valid');
    assert(!lumpAuditHasErrors(results), 'no errors');
    // RCI should not fire for Thread lumps (DRs are not code)
    assert(!results.find(r => r.ruleId === 'RCI'), 'RCI not emitted for Thread lump');
}

// ─── Test 29: Namespace lump (typ=10, cw=0) — RB1 pass ──────────────────
// cw=0 distinguishes Namespace from Thread.  Any cc value is structurally valid.
console.log('\nTest 29: Namespace LUMP (cw=0, cc=4) — RB1 pass');
{
    const lumpSize = 64;
    const words = new Array(lumpSize).fill(0);
    words[0] = makeThreadHeader({ nMinus6: 0, sw: 0, hw: 4 });  // cw=0,cc=4,typ=10
    const results = lumpAudit(words, null);
    assertRule(results, 'RB1', 'pass', 'RB1 pass: Namespace LUMP (cw=0, typ=10)');
    assert(!lumpAuditHasErrors(results), 'no errors');
    // RCI/RPN should not fire for typ=10 lumps
    assert(!results.find(r => r.ruleId === 'RCI'), 'RCI not emitted for Namespace');
}

// ─── Test 30: Thread with cc=0 (heapWords=0) — RB1 error ─────────────────
console.log('\nTest 30: Thread lump with heapWords=0 — RB1 error');
{
    const lumpSize = 64;
    const words = new Array(lumpSize).fill(0);
    words[0] = makeThreadHeader({ nMinus6: 0, sw: 4, hw: 0 });
    const results = lumpAudit(words, null);
    assertRule(results, 'RB1', 'error', 'RB1 error: Thread heapWords=0');
    assert(lumpAuditHasErrors(results), 'has errors');
}

// ─── Test 31: Thread with zones overflow — RB1 error ─────────────────────
// sw=20, hw=20 → 29+20+20=69 > lumpSize=64 → geometry doesn't fit.
console.log('\nTest 31: Thread lump with sw+heap overflow — RB1 error');
{
    const lumpSize = 64;
    const words = new Array(lumpSize).fill(0);
    words[0] = makeThreadHeader({ nMinus6: 0, sw: 20, hw: 20 });
    const results = lumpAudit(words, null);
    assertRule(results, 'RB1', 'error', 'RB1 error: Thread zone overflow');
    assert(lumpAuditHasErrors(results), 'has errors');
}

// ─── Test 32: Thread dirty freespace — RFS error ──────────────────────────
// Thread with sw=2, hw=4 in a 64-word lump:
//   freespace = words 21..49 (= 17+4..64-12-2-1+1=50). Dirty word at 30.
console.log('\nTest 32: Thread lump with dirty freespace — RFS error');
{
    const lumpSize = 64;
    const sw = 2, hw = 4;
    const words = new Array(lumpSize).fill(0);
    words[0] = makeThreadHeader({ nMinus6: 0, sw, hw });
    words[30] = 0xDEADBEEF;  // dirty freespace (words 21..49)
    const results = lumpAudit(words, null);
    assertRule(results, 'RFS', 'error', 'RFS error: Thread dirty freespace');
    assert(lumpAuditHasErrors(results), 'has errors');
}

// ─── Test 33: Thread with malformed cap (bit26=1) — RGT error ─────────────
// Valid geometry but caps zone has a GT with bit26=1.
console.log('\nTest 33: Thread lump with malformed cap GT (bit26=1) — RGT error');
{
    const words = makeValidThread();
    words[244] = 0x04000001;  // caps[0]: bit26=1 → spare non-zero → RGT error
    const results = lumpAudit(words, null);
    assertRule(results, 'RGT', 'error', 'RGT error: Thread cap spare bit 26 = 1');
    assert(lumpAuditHasErrors(results), 'has errors');
}

// ─── Test 34: Data lump (typ=01) with cw≠0 — RB1 error ──────────────────
console.log('\nTest 34: Data lump (typ=01) with cw=3 — RB1 error');
{
    const words = makeWellFormed({ cw: 3, cc: 0, nMinus6: 0, typ: 1 });
    const results = lumpAudit(words, null);
    assertRule(results, 'RB1', 'error', 'RB1 error: Data lump with cw≠0');
    assert(lumpAuditHasErrors(results), 'has errors');
}

// ─── Test 35: Data lump (typ=01) with cc≠0 — RB1 error ──────────────────
console.log('\nTest 35: Data lump (typ=01) with cc=2 — RB1 error');
{
    const words = makeWellFormed({ cw: 0, cc: 2, nMinus6: 0, typ: 1 });
    const results = lumpAudit(words, null);
    assertRule(results, 'RB1', 'error', 'RB1 error: Data lump with cc≠0');
    assert(lumpAuditHasErrors(results), 'has errors');
}

// ─── Test 36: Data lump (typ=01) with cw=0, cc=0 — RB1 pass ─────────────
console.log('\nTest 36: Data lump (typ=01) with cw=0, cc=0 — RB1 pass');
{
    const words = makeWellFormed({ cw: 0, cc: 0, nMinus6: 0, typ: 1 });
    const results = lumpAudit(words, null);
    assertRule(results, 'RB1', 'pass', 'RB1 pass: Data lump cw=0, cc=0');
    assert(!lumpAuditHasErrors(results), 'no errors');
}

// ─── Test 37: Data lump (typ=01) with non-zero body — no RFS error ───────
// Data LUMP body is programmer-defined payload, not freespace.
// Non-zero body words must NOT trigger RFS error in JS audit.
console.log('\nTest 37: Data lump (typ=01) with non-zero body — RFS skipped (no error)');
{
    const lumpSize = 64;
    const words = new Array(lumpSize).fill(0);
    words[0] = buildHeader({ nMinus6: 0, cw: 0, typ: 1, cc: 0 });
    // Non-zero data payload at several body offsets
    words[1]  = 0xDEADBEEF;
    words[15] = 0xCAFEBABE;
    words[30] = 0x12345678;
    const results = lumpAudit(words, null);
    // RFS must NOT emit an error for data LUMP payload
    const rfs = results.find(r => r.ruleId === 'RFS');
    assert(!rfs || rfs.severity !== 'error', 'RFS does not error on data LUMP payload');
    assert(!lumpAuditHasErrors(results), 'no errors overall');
}

// ─── Test 38: Thread with RETURN-shaped DR values — no RSM result ────────
// In a Thread lump, words 1..sw are DR0..DRsw-1 (data registers), not code.
// DR values that happen to encode a RETURN opcode (op=3 in bits[31:27])
// must NOT trigger RSM stub-method warnings.
// RETURN opcode 3 encodes as: (3 << 27) = 0x18000000 (bits[31:27]=00011)
console.log('\nTest 38: Thread with RETURN-shaped DR values — RSM not emitted');
{
    const words = makeValidThread();
    // Overwrite DR0..DR1 with RETURN-encoded values (op=3 in top 5 bits)
    words[1]  = 0x18000000;  // DR0: looks like RETURN to naive instruction scanner
    words[2]  = 0x18000000;  // DR1: second consecutive RETURN
    const results = lumpAudit(words, null);
    assert(!results.find(r => r.ruleId === 'RSM'), 'RSM not emitted for Thread DR state');
    assert(!lumpAuditHasErrors(results), 'no errors');
}

// ─── Test 39: Malformed data lump (cw=1, cc=1) — only RB1 fires ──────────
// A data lump with nonzero cw/cc is rejected by RB1. But body bytes that look
// like code instructions or GTs must NOT produce RCI, RGT, or RPN results —
// those rules do not apply to data LUMP types at all.
console.log('\nTest 39: Malformed data lump (cw=1, cc=1) — only RB1 fires, no RCI/RGT/RPN');
{
    const lumpSize = 64;
    const words = new Array(lumpSize).fill(0);
    words[0] = buildHeader({ nMinus6: 0, cw: 1, typ: 1, cc: 1 });
    words[1]  = 0x18000000;  // DR-like value: bits[31:27]=3 (RETURN op) — not real code
    words[63] = 0x04000001;  // GT-like value: bit26=1 — not a real c-list entry
    const results = lumpAudit(words, null);
    assertRule(results, 'RB1', 'error', 'RB1 error: malformed data lump (cw/cc≠0)');
    assert(!results.find(r => r.ruleId === 'RCI'), 'RCI not emitted for data LUMP');
    assert(!results.find(r => r.ruleId === 'RGT'), 'RGT not emitted for data LUMP');
    assert(!results.find(r => r.ruleId === 'RPN'), 'RPN not emitted for data LUMP');
}

// ─── Test 26: RGT pass — spec v1.2 GTs with spare bit 26 = 0 ─────────────
// Valid GTs from spec v1.2 have bit26=0 regardless of type.
// Vectors:
//   0x5A000001: Church dom, E-perm, bit26=0, bit25=1 — spare=0 → pass
//   0x4A000006: Church dom, E-perm, bit26=0 — spare=0 → pass (SelfTest GT)
//   0x48800010: Church dom, E-perm, bit26=0 — spare=0 → pass (BernoulliNumbers GT)
console.log('\nTest 26: RGT pass (spec v1.2 GTs, spare bit26=0)');
{
    const lumpSize = 64;
    const cw = 1, cc = 3, nMinus6 = 0;
    const words = new Array(lumpSize).fill(0);
    words[0] = buildHeader({ nMinus6, cw, cc });
    words[1] = 0x01000000;   // valid code word
    words[61] = 0x5A000001;  // Church Inform GT, bit26=0 → spare check pass
    words[62] = 0x4A000006;  // Church Inform E-GT, bit26=0 → spare check pass
    words[63] = 0x48800010;  // spec-format Inform GT, bit26=0 → spare check pass
    const results = lumpAudit(words, null);
    assertRule(results, 'RGT', 'pass', 'RGT pass: spec v1.2 GTs with bit26=0');
    assert(!lumpAuditHasErrors(results), 'no errors');
}

// ─── Test 27: RGT error — spare bit 26 = 1 (violates spec v1.2) ──────────
// 0x04000001: bits[31:24] = 0x04 = 0000_0100 → bit26=1 (spare non-zero).
// Per spec v1.2, any GT Word 0 with bit26=1 is malformed.
console.log('\nTest 27: RGT error (spare bit 26 = 1, violates spec v1.2)');
{
    const lumpSize = 64;
    const cw = 1, cc = 1, nMinus6 = 0;
    const words = new Array(lumpSize).fill(0);
    words[0] = buildHeader({ nMinus6, cw, cc });
    words[1] = 0x01000000;   // valid code word
    words[63] = 0x04000001;  // bit26=1 → spare non-zero → RGT error
    const results = lumpAudit(words, null);
    assertRule(results, 'RGT', 'error', 'RGT error: spare bit 26 = 1');
    assert(lumpAuditHasErrors(results), 'has errors');
    const rgt = results.find(r => r.ruleId === 'RGT');
    assert(rgt.detail.includes('bit 26'), 'detail mentions bit 26');
    assert(rgt.detail.includes('0x04000001'.toUpperCase()) ||
           rgt.detail.includes('04000001'), 'detail includes the offending GT word');
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
