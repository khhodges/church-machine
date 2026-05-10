'use strict';
// Headless harness for tests/gt/test_gt_load_malformed_audit.py.
//
// Tests that a GT word with malformed permissions written directly into a
// C-List slot in memory produces the correct AUDIT TRAIL — specifically that
// auditLog contains a 'malformedGT' gate entry and that faultLog[0] carries
// the malformedReason field — in addition to raising a DOMAIN_PURITY fault.
//
// This validates the defence-in-depth audit pipeline introduced by Task #958:
//   _execLoad() pushes a malformedGT entry to auditLog before calling fault(),
//   and fault() spreads the meta object (including malformedReason) into the
//   faultLog entry via the spread operator.
//
// Scenario: R+L GT in a C-List slot.
//   R is a Turing permission (bit0); L is a Church permission (bit3).
//   Mixing them violates isDomainPure.  The resulting malformedReason is
//   'domain-impure permissions (RL)'.
//
// GT bit layout (simulator parseGT):
//   bits [15: 0]  namespace slot index
//   bits [22:16]  gt_seq
//   bits [24:23]  type  (0b00=NULL 0b01=Inform 0b10=Outform 0b11=Abstract)
//   bits [31:25]  permBits: B=bit6 E=bit5 S=bit4 L=bit3 X=bit2 W=bit1 R=bit0
//
// Stdin:  (none — scenario is hardcoded)
// Stdout: JSON object with all fields needed by the Python assertions

global.window = { bootConfig: {} };

const { bootSim, setupCR6 } = require('../gates/sim_helpers');

// R+L: Turing R (bit0) mixed with Church L (bit3) → domain-impure
//   permBits = 0b0001001 = 0x09
//   Inform type (0b01 at bits[24:23]), index=1
const MALFORMED_RL = ((0x09 << 25) | (0x01 << 23) | 1) >>> 0;

function runLoadMalformedAudit() {
    const sim = bootSim();
    if (!sim.bootComplete) {
        return { error: 'boot did not complete' };
    }

    // Wire CR6 to a 2-slot scratch c-list at address 500.
    setupCR6(sim);

    // Write the malformed R+L GT word directly into c-list slot 0 (address 500),
    // bypassing createGT() to simulate adversarial memory tampering.
    sim.memory[500] = MALFORMED_RL >>> 0;

    // Find the code-lump base from CR14.
    const cr14 = sim.cr[14];
    const codeBase = cr14 ? cr14.word1 : null;
    if (codeBase == null) return { error: 'CR14.word1 is null' };

    // Encode: LOAD CR1, [CR6 + 0]
    // opcode=0 (LOAD), cond=0xE (AL=Always), crDst=1, crSrc=6, imm=0
    const instr = sim.encodeInstruction(0, 0xE, 1, 6, 0);
    sim.memory[codeBase + 1] = instr >>> 0;

    sim.pc = 0;
    sim.halted = false;

    const faultLenBefore = sim.faultLog ? sim.faultLog.length : 0;

    sim.step();

    // step() resets this.auditLog = [] at the very start (simulator.js line 2691),
    // so the entire auditLog after step() belongs to this instruction.
    const newAuditEntries = sim.auditLog ? sim.auditLog.slice() : [];
    const newFaults       = sim.faultLog ? sim.faultLog.slice(faultLenBefore) : [];

    // Locate the first malformedGT audit entry produced by this step.
    const malformedGTEntry = newAuditEntries.find(e => e.gate === 'malformedGT') || null;

    // Capture the first fault entry and its malformedReason field.
    const firstFault = newFaults.length > 0 ? newFaults[0] : null;

    return {
        // Fault basics
        faulted:            newFaults.length > 0,
        faultCode:          firstFault ? firstFault.type            : null,
        faultMessage:       firstFault ? firstFault.message         : null,
        faultMalformedReason: firstFault ? (firstFault.malformedReason || null) : null,
        // Audit trail
        malformedGTEntryFound: malformedGTEntry !== null,
        auditGate:          malformedGTEntry ? malformedGTEntry.gate   : null,
        auditReason:        malformedGTEntry ? malformedGTEntry.reason : null,
        auditResult:        malformedGTEntry ? malformedGTEntry.result : null,
        auditChecks:        malformedGTEntry ? malformedGTEntry.checks : null,
        // Raw counts for diagnostics
        newAuditCount: newAuditEntries.length,
        newFaultCount:  newFaults.length,
    };
}

const result = runLoadMalformedAudit();
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
