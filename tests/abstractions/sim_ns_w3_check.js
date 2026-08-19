// Headless harness used by tests/test_sim_ns_abstract_gt.py.
//
// Verifies two simulator-level cache-token (word3) properties:
//   1. getNSTableMemoryDump() exposes word3 as raw[3] for each NS entry.
//   2. _writeCR gates word3 on mElevation: visible when elevated, 0 otherwise.
//
// Exits with code 0 on success, 1 on failure (errors written to stderr).

'use strict';

global.window = { bootConfig: {} };
const ChurchSimulator = require('../../simulator/simulator.js');

const ERRORS = [];
function fail(msg) { ERRORS.push(msg); }

// ─── Test helpers ────────────────────────────────────────────────────────────

function hexW(n) { return '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0'); }

// ─── Test 1: getNSTableMemoryDump() has 4 raw words including word3 ──────────

(function testDumpIncludesW3() {
    const sim = new ChurchSimulator();
    // Slot 0 always exists after init; write a known W3 into it.
    const CACHE_TOKEN = 0xC0FFEE42;
    sim.memory[sim._nsSlotBase(0) + 3] = CACHE_TOKEN >>> 0;

    const dump = sim.getNSTableMemoryDump();
    if (!dump || dump.length === 0) {
        fail('getNSTableMemoryDump() returned empty array');
        return;
    }
    const entry = dump[0];
    if (!Array.isArray(entry.raw)) {
        fail('dump[0].raw is not an array');
        return;
    }
    if (entry.raw.length !== 4) {
        fail(`dump[0].raw.length=${entry.raw.length}, expected 4`);
        return;
    }
    if ((entry.raw[3] >>> 0) !== CACHE_TOKEN) {
        fail(`dump[0].raw[3]=${hexW(entry.raw[3])}, expected ${hexW(CACHE_TOKEN)}`);
        return;
    }
    console.log(`[PASS] getNSTableMemoryDump raw[3] = ${hexW(CACHE_TOKEN)}`);
})();

// ─── Test 2: _writeCR gates word3 on mElevation ──────────────────────────────

(function testWriteCRMElevationGate() {
    const CACHE_TOKEN = 0xC0FFEE42;

    // Manually write NS slot 5 with a known arbitrary cache value.
    function makeSimWithSlot5() {
        const sim = new ChurchSimulator();
        const base = sim._nsSlotBase(5);
        // Read what init wrote and patch W3.
        sim.memory[base + 3] = CACHE_TOKEN >>> 0;
        return sim;
    }

    // Elevated: word3 should equal AGT.
    {
        const sim = makeSimWithSlot5();
        sim.mElevation = true;
        const entry = sim.readNSEntry(5);
        if (!entry) { fail('readNSEntry(5) returned null (elevated)'); return; }
        // Build a minimal GT word pointing to slot 5.
        const gt32 = (5 & 0xFFFF) | (1 << 25);  // slot=5, gtType=Inform
        sim._writeCR(0, gt32, entry);
        const got = (sim.cr[0].word3 >>> 0);
        if (got !== CACHE_TOKEN) {
            fail(`_writeCR elevated: cr[0].word3=${hexW(got)}, expected ${hexW(CACHE_TOKEN)}`);
        } else {
            console.log(`[PASS] _writeCR elevated: cr[0].word3 = ${hexW(CACHE_TOKEN)}`);
        }
    }

    // User mode: word3 must be 0.
    {
        const sim = makeSimWithSlot5();
        sim.mElevation = false;
        const entry = sim.readNSEntry(5);
        if (!entry) { fail('readNSEntry(5) returned null (user mode)'); return; }
        const gt32 = (5 & 0xFFFF) | (1 << 25);
        sim._writeCR(0, gt32, entry);
        const got = (sim.cr[0].word3 >>> 0);
        if (got !== 0) {
            fail(`_writeCR user-mode: cr[0].word3=${hexW(got)}, expected 0x00000000`);
        } else {
            console.log('[PASS] _writeCR user-mode: cr[0].word3 = 0x00000000');
        }
    }
})();

// ─── Report ──────────────────────────────────────────────────────────────────

if (ERRORS.length > 0) {
    for (const e of ERRORS) process.stderr.write(`[FAIL] ${e}\n`);
    process.exit(1);
}
process.exit(0);
