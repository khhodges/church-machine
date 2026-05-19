'use strict';
// Shared helpers for gate test harnesses.
//
// Consumers must set  global.window = { bootConfig: {} }  before requiring
// this module (every harness already does this at its top line).

const ChurchSimulator = require('../../simulator/simulator.js');

// ─── bootSim ─────────────────────────────────────────────────────────────────
// Create a fresh ChurchSimulator and run _bootStep() until boot completes,
// the machine halts, or the safety limit (300 steps) is reached.
// Returns the simulator instance (caller checks sim.bootComplete).

function bootSim() {
    const sim = new ChurchSimulator();
    let steps = 0;
    while (!sim.bootComplete && !sim.halted && steps < 300) {
        sim._bootStep();
        steps++;
    }
    return sim;
}

// ─── setupCR6 ────────────────────────────────────────────────────────────────
// Point CR6 at a 2-slot scratch region starting at address 500 (safely between
// the code buffer at ~384 and the NS table at 64512).
//
// After a full boot with cc=0 (no c-list in the default boot entry) the
// NUC_CLIST step leaves CR6 all-zeros.  Instructions that dereference a c-list
// via CR6 (LOAD, ELOADCALL, XLOADLAMBDA …) will fault NULL_CAP before reaching
// the gate under test.  This helper wires CR6 to a valid c-list capability so
// the test can populate individual c-list slots and exercise the target path.

function setupCR6(sim) {
    const slotIdx = sim.bootEntrySlot;
    const nsBase  = sim.NS_TABLE_BASE + slotIdx * sim.NS_ENTRY_WORDS;
    const gt_seq  = (sim.memory[nsBase + 2] >>> 25) & 0x7F;
    const eGT     = sim.createGT(gt_seq, slotIdx, { E: 1 }, 1);
    sim.cr[6] = {
        word0: eGT,
        word1: 500,
        word2: sim.packNSWord1(2, 0, 0, 0, 2),
        word3: 0,
        m:     0,
    };
}

module.exports = { bootSim, setupCR6 };
