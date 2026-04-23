'use strict';
// Headless harness used by tests/test_mwin_writeback.py.
//
// Verifies four M-window writeback scenarios (GAP-03 fix):
//   1. Pass  — valid DR11/DR14/gt_seq: CR15 words updated, M cleared.
//   2. NULL  — DR11 bits[24:23]=0b00: INVALID_OP faulted, M cleared.
//   3. Integrity — DR14 corrupted: INVALID_OP faulted, M cleared.
//   4. Bypass — CR15.m=0: gate skipped, operation proceeds unmodified.
//
// Exits with code 0 on success, 1 on failure (errors written to stderr).

global.window = { bootConfig: {} };
const ChurchSimulator = require('../simulator/simulator.js');

const ERRORS = [];
function fail(msg) { ERRORS.push(msg); }
function hexW(n) { return '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0'); }

// ── Integrity32 reference (must match hardware/integrity32.py) ────────────────
function integrity32(w0, w1) {
    function rol32(x, n) { return (((x << n) | (x >>> (32 - n))) >>> 0); }
    const w1m = (w1 & 0xEFFFFFFF) >>> 0;
    return (rol32(w0 >>> 0, 7) ^ rol32(w1m, 13) ^ 0xDEADBEEF) >>> 0;
}

// ── Build a minimal Inform-type GT word ──────────────────────────────────────
// bits[24:23]=0b01 (Inform), bits[22:16]=gt_seq, bits[15:0]=slot_id
function informGT(slot, seq) {
    return ((1 << 23) | ((seq & 0x7F) << 16) | (slot & 0xFFFF)) >>> 0;
}

// ── Test 1: passing writeback commits DR11-DR13 to CR15 ─────────────────────
(function testMwinWbPass() {
    const sim = new ChurchSimulator();

    const W0 = informGT(5, 42);   // Inform GT, slot=5, gt_seq=42
    const W1 = 0x00001000;        // location
    const W2 = (42 << 21) >>> 0;  // gt_seq=42 in bits[27:21]

    // Open M-window: this sets DR14 = integrity32(W1,W2), DR15 = cr.word3
    sim.cr[15] = { word0: W0, word1: W1, word2: W2, word3: 0xABCDABCD, m: 1 };
    sim._setMWindow(15);

    // Verify DR14 was set correctly.
    const expectedInteg = integrity32(W1, W2);
    if (sim.dr[14] !== expectedInteg) {
        fail(`Test1 _setMWindow: DR14=${hexW(sim.dr[14])} expected ${hexW(expectedInteg)}`);
        return;
    }

    // Verify DR11-DR13 snapshot.
    if (sim.dr[11] !== W0) { fail(`Test1: DR11=${hexW(sim.dr[11])} expected ${hexW(W0)}`); return; }
    if (sim.dr[12] !== W1) { fail(`Test1: DR12=${hexW(sim.dr[12])} expected ${hexW(W1)}`); return; }
    if (sim.dr[13] !== W2) { fail(`Test1: DR13=${hexW(sim.dr[13])} expected ${hexW(W2)}`); return; }

    // Simulate the callee mutating DR11-DR13 while keeping invariants valid.
    const NEW_W1 = 0x00002000;
    const NEW_W2 = W2;
    sim.dr[12] = NEW_W1;
    sim.dr[13] = NEW_W2;
    // Recompute DR14 to reflect the updated values.
    sim.dr[14] = integrity32(NEW_W1, NEW_W2);

    // Run writeback.
    const ok = sim._mwinWriteback();
    if (!ok) {
        fail(`Test1: _mwinWriteback returned false (faulted) — expected true. fault=${sim.lastFault}`);
        return;
    }
    if (sim.cr[15].m !== 0) { fail(`Test1: CR15.m=${sim.cr[15].m} expected 0 after writeback`); return; }
    if ((sim.cr[15].word0 >>> 0) !== (W0 >>> 0)) {
        fail(`Test1: CR15.word0=${hexW(sim.cr[15].word0)} expected ${hexW(W0)}`); return;
    }
    if ((sim.cr[15].word1 >>> 0) !== NEW_W1) {
        fail(`Test1: CR15.word1=${hexW(sim.cr[15].word1)} expected ${hexW(NEW_W1)}`); return;
    }
    if ((sim.cr[15].word2 >>> 0) !== NEW_W2) {
        fail(`Test1: CR15.word2=${hexW(sim.cr[15].word2)} expected ${hexW(NEW_W2)}`); return;
    }
    if (!sim._mwinWbFired) { fail('Test1: _mwinWbFired not set'); return; }
    console.log('[PASS] Test1: valid M-window writeback committed DR11–DR13 to CR15');
})();

// ── Test 2: NULL DR11 (bits[24:23]=0b00) → INVALID_OP, M cleared ────────────
(function testMwinWbNullDR11() {
    const sim = new ChurchSimulator();

    // Set CR15.m=1 and put a NULL-type GT in DR11.
    sim.cr[15] = { word0: 0, word1: 0x1000, word2: 0, word3: 0, m: 1 };
    sim.dr[11] = 0;                            // bits[24:23]=0b00 → NULL type
    sim.dr[12] = 0x1000;
    sim.dr[13] = 0;
    sim.dr[14] = integrity32(0x1000, 0);       // valid integrity

    const ok = sim._mwinWriteback();
    if (ok) { fail('Test2: _mwinWriteback returned true on NULL DR11 (expected false)'); return; }
    if (sim.cr[15].m !== 0) { fail(`Test2: CR15.m=${sim.cr[15].m} expected 0`); return; }
    const f2 = sim.faultLog[sim.faultLog.length - 1];
    if (!f2 || f2.type !== 'INVALID_OP') {
        fail(`Test2: expected INVALID_OP fault, got ${JSON.stringify(f2)}`); return;
    }
    console.log('[PASS] Test2: NULL DR11 faulted INVALID_OP and cleared M');
})();

// ── Test 3: corrupted DR14 (integrity mismatch) → INVALID_OP, M cleared ─────
(function testMwinWbIntegrityFail() {
    const sim = new ChurchSimulator();

    const W0 = informGT(7, 10);
    const W1 = 0x00003000;
    const W2 = (10 << 21) >>> 0;

    sim.cr[15] = { word0: W0, word1: W1, word2: W2, word3: 0, m: 1 };
    sim.dr[11] = W0;
    sim.dr[12] = W1;
    sim.dr[13] = W2;
    sim.dr[14] = (integrity32(W1, W2) ^ 0xDEAD) >>> 0;  // deliberately corrupted

    const ok = sim._mwinWriteback();
    if (ok) { fail('Test3: _mwinWriteback returned true on integrity mismatch (expected false)'); return; }
    if (sim.cr[15].m !== 0) { fail(`Test3: CR15.m=${sim.cr[15].m} expected 0`); return; }
    const f3 = sim.faultLog[sim.faultLog.length - 1];
    if (!f3 || f3.type !== 'INVALID_OP') {
        fail(`Test3: expected INVALID_OP fault, got ${JSON.stringify(f3)}`); return;
    }
    console.log('[PASS] Test3: corrupted DR14 faulted INVALID_OP and cleared M');
})();

// ── Test 4: M=0 bypass — gate skipped entirely, no fault, no writeback ───────
(function testMwinWbBypass() {
    const sim = new ChurchSimulator();

    sim.cr[15] = { word0: 0xDEAD, word1: 0x1000, word2: 0, word3: 0, m: 0 };
    sim.dr[11] = 0;
    sim.dr[12] = 0;
    sim.dr[13] = 0;
    sim.dr[14] = 0;

    const ok = sim._mwinWriteback();
    if (!ok) { fail('Test4: _mwinWriteback returned false when M=0 (expected true)'); return; }
    if (sim._mwinWbFired) { fail('Test4: _mwinWbFired should be false when M=0'); return; }
    if ((sim.cr[15].word0 >>> 0) !== 0xDEAD) {
        fail(`Test4: CR15.word0 mutated to ${hexW(sim.cr[15].word0)}, expected 0x0000DEAD`); return;
    }
    console.log('[PASS] Test4: M=0 bypass — gate skipped, CR15 unchanged');
})();

// ── Test 5 (was 5): gt_seq mismatch → INVALID_OP, M cleared ─────────────────
(function testMwinWbGtSeqMismatch() {
    const sim = new ChurchSimulator();

    // DR11: Inform GT with gt_seq=42, slot=9
    const W0_seq42 = ((1 << 23) | (42 << 16) | 9) >>> 0;
    // DR12: some location
    const W1 = 0x00004000;
    // DR13: gt_seq field bits[27:21] = 99 — deliberately mismatches DR11[22:16]=42
    const W2_seq99 = (99 << 21) >>> 0;

    sim.cr[15] = { word0: W0_seq42, word1: W1, word2: W2_seq99, word3: 0, m: 1 };
    sim.dr[11] = W0_seq42;
    sim.dr[12] = W1;
    sim.dr[13] = W2_seq99;
    sim.dr[14] = integrity32(W1, W2_seq99);    // valid integrity for these words

    const ok = sim._mwinWriteback();
    if (ok) { fail('Test_gtseq: _mwinWriteback returned true on gt_seq mismatch (expected false)'); return; }
    if (sim.cr[15].m !== 0) { fail(`Test_gtseq: CR15.m=${sim.cr[15].m} expected 0`); return; }
    const fgt = sim.faultLog[sim.faultLog.length - 1];
    if (!fgt || fgt.type !== 'INVALID_OP') {
        fail(`Test_gtseq: expected INVALID_OP fault, got ${JSON.stringify(fgt)}`); return;
    }
    console.log('[PASS] Test6: gt_seq mismatch (DR11[22:16]!=DR13[27:21]) faulted INVALID_OP and cleared M');
})();

// ── Integrity32 spot-check against hardware/integrity32.py vectors ───────────
// Expected values computed by running hardware/integrity32.py directly:
//   python3 -c "from hardware.integrity32 import integrity32; ..."
(function testIntegrity32Vectors() {
    const sim = new ChurchSimulator();
    const cases = [
        // [w0, w1, expected_from_python]
        [0x00000000, 0x00000000, 0xDEADBEEF],
        [0x12345678, 0xABCDEF01, 0x7966B79F],
        [0xFFFFFFFF, 0xFFFFFFFF, 0xDEADBCEF],
    ];
    for (const [w0, w1, expected] of cases) {
        const got = sim._integrity32(w0, w1);
        if (got !== expected) {
            fail(`integrity32(${hexW(w0)}, ${hexW(w1)}): got ${hexW(got)} expected ${hexW(expected)}`);
        }
    }
    // G-bit (bit 28) masking: result with bit28 set in w1 must equal result without.
    // Python: integrity32(0x11111111, 0x00000000) == integrity32(0x11111111, 0x10000000) == 0x56253667
    const baseNoG = sim._integrity32(0x11111111, 0x00000000);
    const baseGbit = sim._integrity32(0x11111111, 0x10000000);
    if (baseNoG !== 0x56253667) {
        fail(`integrity32 G-bit base: got ${hexW(baseNoG)} expected 0x56253667`);
    }
    if (baseGbit !== 0x56253667) {
        fail(`integrity32 G-bit mask broken: got ${hexW(baseGbit)} expected 0x56253667`);
    }
    console.log('[PASS] Test5: _integrity32 matches hardware/integrity32.py vectors and masks G-bit correctly');
})();

// ── Test 7: _clearMWindow(15, true) hard-faults (guard for CR15 misuse) ───────
(function testClearMWindowCR15Guard() {
    const sim = new ChurchSimulator();
    sim.cr[15] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
    let threw = false;
    try {
        sim._clearMWindow(15, true);
    } catch (e) {
        threw = true;
    }
    if (!threw) {
        fail('Test7: _clearMWindow(15, true) did not throw — guard missing');
        return;
    }
    console.log('[PASS] Test7: _clearMWindow(15, writeBack=true) throws as expected (guard active)');
})();

// ── Report ────────────────────────────────────────────────────────────────────
if (ERRORS.length > 0) {
    for (const e of ERRORS) process.stderr.write('[FAIL] ' + e + '\n');
    process.exit(1);
}
process.exit(0);
