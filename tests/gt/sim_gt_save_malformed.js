'use strict';
// Headless harness for tests/gt/test_gt_save_malformed_perm.py.
//
// Tests that a SAVE instruction whose source CR contains a malformed GT
// (i.e. one with illegal permission bits placed directly into the CR,
// bypassing createGT()) produces a DOMAIN_PURITY fault before the write
// reaches any C-List slot in memory.
//
// This validates the defence-in-depth chain extended by Task #957:
//   parseGT() sets the 'malformed' flag for any GT whose permission bits
//   violate isDomainPure or isSinglePerm, and _execSave() now surfaces that
//   as a DOMAIN_PURITY fault before the GT is written to memory.
//
// GT bit layout (simulator parseGT):
//   bits [15: 0]  namespace slot index
//   bits [22:16]  gt_seq
//   bits [24:23]  type  (0b00=NULL 0b01=Inform 0b10=Outform 0b11=Abstract)
//   bits [31:25]  permBits: B=bit6 E=bit5 S=bit4 L=bit3 X=bit2 W=bit1 R=bit0
//
// SAVE opcode = 1 (simulator.js step(), case 1 → _execSave).
//
// Stdin:  (none — scenarios are hardcoded)
// Stdout: JSON array of result objects

global.window = { bootConfig: {} };

const { bootSim, setupCR6 } = require('../gates/sim_helpers');

// Craft GT words with malformed permission bits (matching the LOAD test):
//   X+E  — domain-impure (Turing X mixed with Church E)
//           permBits = X(bit2) | E(bit5) = 0b0100100 = 0x24
//   L+E  — multi-Church (two Church bits set, violates isSinglePerm)
//           permBits = L(bit3) | E(bit5) = 0b0101000 = 0x28
// Both use Inform type (0b01 at bits[24:23]) and index=1 (valid NS slot).
const MALFORMED_XE = ((0x24 << 25) | (0x01 << 23) | 1) >>> 0;
const MALFORMED_LE = ((0x28 << 25) | (0x01 << 23) | 1) >>> 0;

function runSaveFromCR(scenarioName, crGTWord) {
    const sim = bootSim();
    if (!sim.bootComplete) {
        return { name: scenarioName, error: 'boot did not complete' };
    }

    // Wire CR6 to a 2-slot scratch c-list at address 500.
    // setupCR6 installs a valid E-GT for the boot entry slot so the c-list
    // pointer itself (CR6) passes mLoad validation.  The c-list slot starts
    // empty; the test verifies nothing is written there after the fault.
    setupCR6(sim);

    // Place the malformed GT directly into CR1 word0, simulating a compromised
    // CR (e.g. from a boot-sequence bug or a future vulnerability).  This
    // bypasses the createGT() guards that normally prevent malformed GTs.
    sim.cr[1] = {
        word0: crGTWord,
        word1: 0,
        word2: 0,
        word3: 0,
        m:     0,
    };

    // Find the code-lump base from CR14.
    const cr14 = sim.cr[14];
    const codeBase = cr14 ? cr14.word1 : null;
    if (codeBase == null) return { name: scenarioName, error: 'CR14.word1 is null' };

    // Encode: SAVE CR1, [CR6 + 0]
    // opcode=1 (SAVE), cond=0xE (AL=Always), crDst=1, crSrc=6, imm=0
    const instr = sim.encodeInstruction(1, 0xE, 1, 6, 0);
    sim.memory[codeBase + 1] = instr >>> 0;

    sim.pc = 0;
    sim.halted = false;

    const faultsBefore = sim.faultLog ? sim.faultLog.length : 0;
    sim.step();
    const newFaults = sim.faultLog ? sim.faultLog.slice(faultsBefore) : [];

    // Verify the malformed GT was NOT propagated into the c-list slot.
    const slotAfter = sim.memory[500] || 0;

    return {
        name:        scenarioName,
        faulted:     newFaults.length > 0,
        faultCode:   newFaults.length ? newFaults[0].type    : null,
        faultMsg:    newFaults.length ? newFaults[0].message : null,
        slotWritten: slotAfter === crGTWord,
    };
}

const results = [
    // Scenario 1: X+E GT in CR1 — domain-impure → DOMAIN_PURITY fault on SAVE
    runSaveFromCR('malformed_xe_gt_save_faults_domain_purity', MALFORMED_XE),
    // Scenario 2: L+E GT in CR1 — multi-Church → DOMAIN_PURITY fault on SAVE
    runSaveFromCR('malformed_le_gt_save_faults_domain_purity', MALFORMED_LE),
];

process.stdout.write(JSON.stringify(results, null, 2) + '\n');
