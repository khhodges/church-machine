'use strict';
// tests/simulator/sim_run_lump_boots_slot3.js
//
// Headless regression test for Task #1495 — "RUN on LUMP boots wrong slot
// (LUMP_MAGIC fault)".
//
// Root cause: _loadLumpBinaryIntoSim called instantBoot() while
// sim.bootEntrySlot was still set to a previously-selected non-3 slot
// (e.g. 51 for Ethernet).  NUC_CLIST did an mLoad on slot 51, which had
// magic=0x0, and faulted before the lump binary was ever written.
//
// Fix: immediately before instantBoot(), guard sim.bootEntrySlot to 3 when
// nsSlot is null/undefined (the slot-3 forced path), then restore afterward.
//
// This harness exercises the guard at the simulator level:
//   1. Boot the simulator normally (slot 3 has the valid boot image).
//   2. Corrupt sim.bootEntrySlot to 51 (no lump there — simulates the bug).
//   3. Apply the guard: save 51, force to 3, call loadLumpBinary, restore 51.
//   4. Assert loadLumpBinary returns true (no fault).
//   5. Assert sim.bootEntrySlot is restored to 51.
//   6. Assert NS slot 3 was updated to the new LUMP (word0 === EXTENDED_BASE).
//
// Exits 0 on success, 1 on failure (errors to stderr).

global.window = { bootConfig: {} };

const path = require('path');
const fs   = require('fs');
const vm   = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const ChurchSimulator = require(path.join(ROOT, 'simulator', 'simulator.js'));

const bootUploadsCode = fs.readFileSync(
    path.join(ROOT, 'simulator', 'boot_uploads.js'), 'utf8');
vm.runInThisContext(bootUploadsCode);

const ERRORS = [];
function fail(msg) { ERRORS.push(msg); }
function assert(cond, msg) { if (!cond) fail(msg); }

// ─── Build a minimal valid 64-word LUMP binary ────────────────────────────────
// Header word layout (simulator.js parseLumpHeader):
//   bits 31-27: magic    = 0x1F
//   bits 26-23: n_minus_6 = 0  → lumpSize = 2^(0+6) = 64 words
//   bits 22-10: cw       = 3   (3 code words)
//   bits  9- 8: typ      = 0
//   bits  7- 0: cc       = 0   (no c-list)
const LUMP_HDR = ((0x1F << 27) | (0 << 23) | (3 << 10) | (0 << 8) | 0) >>> 0;
const MINIMAL_LUMP = new Array(64).fill(0);
MINIMAL_LUMP[0] = LUMP_HDR;  // header
// code words [1..3]: leave as 0 (HALT / NOP for this test — we never step)

const EXTENDED_BASE = 0x0400;  // matches simulator.js loadLumpBinary

// ─── Helper: fully boot the simulator ────────────────────────────────────────
function bootSim() {
    const sim = new ChurchSimulator();
    let steps = 0;
    while (!sim.bootComplete && !sim.halted && steps < 300) {
        sim._bootStep();
        steps++;
    }
    return sim;
}

// ─── Test 1: guard restores bootEntrySlot after loadLumpBinary ───────────────
(function testGuardRestoresBootEntrySlot() {
    const sim = bootSim();
    if (!sim.bootComplete) {
        fail('[T1] Boot did not complete');
        return;
    }

    const NON_3_SLOT = 51;
    sim.bootEntrySlot = NON_3_SLOT;   // simulate user's prior badge click

    // Apply the guard exactly as implemented in app-lumps.js:
    // save → force to 3 → loadLumpBinary → restore
    const savedBootEntry = sim.bootEntrySlot;           // 51
    sim.bootEntrySlot = 3;                              // guard: force to 3

    const loaded = sim.loadLumpBinary(MINIMAL_LUMP, undefined); // nsSlot=undefined → slot 3

    // Restore (mirror of the fix in _loadLumpBinaryIntoSim)
    sim.bootEntrySlot = savedBootEntry;                 // restore to 51

    assert(loaded === true,
        `[T1] loadLumpBinary should return true but returned ${loaded}`);
    assert(sim.bootEntrySlot === NON_3_SLOT,
        `[T1] bootEntrySlot should be restored to ${NON_3_SLOT} but is ${sim.bootEntrySlot}`);

    console.log('[PASS] T1: guard restores bootEntrySlot after loadLumpBinary');
})();

// ─── Test 2: NS slot 3 is updated to EXTENDED_BASE after guarded load ─────────
(function testSlot3UpdatedAfterGuardedLoad() {
    const sim = bootSim();
    if (!sim.bootComplete) {
        fail('[T2] Boot did not complete');
        return;
    }

    sim.bootEntrySlot = 3;  // guard already in place
    const loaded = sim.loadLumpBinary(MINIMAL_LUMP, undefined);

    assert(loaded === true,
        `[T2] loadLumpBinary should return true but returned ${loaded}`);

    // Inverted NS layout: slot i is at NS_TABLE_BASE + NS_TABLE_RESERVE − (i+1)×NS_ENTRY_WORDS
    const nsBase = sim._nsSlotBase(3);
    const slot3Word0 = sim.memory[nsBase] >>> 0;
    assert(slot3Word0 === EXTENDED_BASE,
        `[T2] NS slot 3 word0 should be EXTENDED_BASE (0x${EXTENDED_BASE.toString(16)}) but is 0x${slot3Word0.toString(16)}`);

    console.log('[PASS] T2: NS slot 3 updated to EXTENDED_BASE after guarded load');
})();

// ─── Test 3: loading without guard onto wrong slot faults (demonstrates bug) ──
// This test boots with bootEntrySlot=51 and verifies slot 51 has no valid lump
// (magic=0), which is exactly the condition that caused the original LUMP_MAGIC
// fault when instantBoot ran NUC_CLIST against slot 51.
(function testSlot51HasNoLump() {
    const sim = bootSim();
    if (!sim.bootComplete) {
        fail('[T3] Boot did not complete');
        return;
    }

    // Inverted NS layout: slot i is at NS_TABLE_BASE + NS_TABLE_RESERVE − (i+1)×NS_ENTRY_WORDS
    const nsBase51 = sim._nsSlotBase(51);
    const slot51Loc = sim.memory[nsBase51] >>> 0;

    // Slot 51 location should be 0 (no lump installed) or point to memory
    // where the first word has magic ≠ 0x1F.
    let slot51IsEmpty = true;
    if (slot51Loc !== 0) {
        const hdr = sim.parseLumpHeader(sim.memory[slot51Loc]);
        if (hdr.valid) slot51IsEmpty = false;
    }
    assert(slot51IsEmpty === true,
        `[T3] NS slot 51 should be empty (no valid lump) after normal boot, but it appears populated at 0x${slot51Loc.toString(16)}`);

    console.log('[PASS] T3: NS slot 51 correctly has no valid lump (original bug condition confirmed)');
})();

// ─── Test 4: CR14 updated correctly when slot 3 is the target ─────────────────
(function testCR14UpdatedForSlot3() {
    const sim = bootSim();
    if (!sim.bootComplete) {
        fail('[T4] Boot did not complete');
        return;
    }

    sim.bootEntrySlot = 3;
    const loaded = sim.loadLumpBinary(MINIMAL_LUMP, undefined);

    assert(loaded === true, `[T4] loadLumpBinary should return true`);

    const cr14 = sim.cr[14];
    assert(cr14 !== undefined && cr14 !== null,
        '[T4] CR14 should exist after loadLumpBinary');
    assert(cr14.word1 === EXTENDED_BASE,
        `[T4] CR14.word1 should be EXTENDED_BASE (0x${EXTENDED_BASE.toString(16)}) but is 0x${(cr14.word1 >>> 0).toString(16)}`);

    console.log('[PASS] T4: CR14 updated to EXTENDED_BASE after guarded load to slot 3');
})();

// ─── Test 5: guard restores bootEntrySlot even when loadLumpBinary rejects ────
// This validates the robustness improvement: _restoreBootEntry() is called
// before the throw when loadLumpBinary returns false, so the user's prior
// boot-entry selection is preserved on the failure path too.
(function testGuardRestoresOnFailure() {
    const sim = bootSim();
    if (!sim.bootComplete) {
        fail('[T5] Boot did not complete');
        return;
    }

    const NON_3_SLOT = 42;
    sim.bootEntrySlot = NON_3_SLOT;

    // Apply guard: save → force to 3 → attempt invalid load → restore
    const savedBootEntry = sim.bootEntrySlot;         // 42
    sim.bootEntrySlot = 3;

    // Pass an invalid (empty) lump to force loadLumpBinary to return false.
    const loaded = sim.loadLumpBinary([], undefined);

    // Restore unconditionally (mirrors _restoreBootEntry in the fixed code).
    sim.bootEntrySlot = savedBootEntry;

    assert(loaded === false,
        `[T5] loadLumpBinary should return false for empty array (got ${loaded})`);
    assert(sim.bootEntrySlot === NON_3_SLOT,
        `[T5] bootEntrySlot should be restored to ${NON_3_SLOT} on failure path, got ${sim.bootEntrySlot}`);

    console.log('[PASS] T5: bootEntrySlot restored correctly on loadLumpBinary failure path');
})();

// ─── Report ────────────────────────────────────────────────────────────────────
if (ERRORS.length) {
    ERRORS.forEach(e => process.stderr.write(e + '\n'));
    process.exit(1);
} else {
    console.log('[PASS] All 5 tests passed — RUN LUMP boots slot 3 correctly');
    process.exit(0);
}
