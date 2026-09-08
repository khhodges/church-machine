// Headless harness used by tests/test_dr0_invariant.py.
//
// Verifies the DR0 zero-register invariant:
//   sim.dr[0] === 0 after every instruction step.
//
// Coverage:
//   - IADD, ISUB, MCMP, BFEXT, BFINS, SHL, SHR, BRANCH (Turing arithmetic)
//   - DREAD (data read from capability-protected memory)
//   - CALL -> LED.Set/Clear/Toggle/State (signed-return path, preserveDR1=true)
//   - Confirms DR1 receives the signed result from each LED method
//
// Exits 0 on success, 1 on failure (errors to stderr).

'use strict';

global.window = { bootConfig: {} };

const ChurchSimulator    = require('../../simulator/simulator.js');
const AbstractionRegistry = require('../../simulator/abstractions.js');
const DeviceAbstractions  = require('../../simulator/device_abstractions.js');

const ERRORS = [];
function fail(label, msg) {
    ERRORS.push(`[FAIL] ${label}: ${msg}`);
    process.stderr.write(`[FAIL] ${label}: ${msg}\n`);
}
function pass(label) {
    process.stdout.write(`[PASS] ${label}\n`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Encode a 32-bit instruction word (mirrors sim.encodeInstruction)
function enc(opcode, cond, crDst, crSrc, imm) {
    return (
        ((opcode & 0x1F) << 27) |
        ((cond   & 0xF)  << 23) |
        ((crDst  & 0xF)  << 19) |
        ((crSrc  & 0xF)  << 15) |
        (imm & 0x7FFF)
    ) >>> 0;
}

const AL = 0xE; // Always condition

// Create a fresh sim instance (no boot needed for pre-boot Turing tests).
function makeSim() {
    return new ChurchSimulator();
}

// Create a sim with the device abstraction registry wired in.
function makeSimWithDevAbs() {
    const sim      = new ChurchSimulator();
    const registry = new AbstractionRegistry();
    const devAbs   = new DeviceAbstractions(registry);
    sim.initAbstractions(registry, null, devAbs);
    return sim;
}

// Execute one step in pre-boot mode by placing instrWord at memory[pc] and
// calling step().  Returns the step result, or null if the sim faulted.
// Precondition: sim.bootComplete === false.
function stepPreBoot(sim, instrWord) {
    const pc = sim.pc;
    sim.memory[pc] = instrWord >>> 0;
    const result = sim.step();
    return result;
}

// Assert DR0 === 0 after a step, reporting failures under label.
function assertDR0Zero(sim, label) {
    const v = sim.dr[0] >>> 0;
    if (v !== 0) {
        fail(label, `DR0=${v} (expected 0)`);
        return false;
    }
    return true;
}

// ─── Turing arithmetic / bitfield / shift / branch tests ─────────────────────
// All run in pre-boot mode: bootComplete=false, instructions fetched from
// memory[pc] directly.  No CR12/CR14/CR15 needed for these opcodes.

(function testIadd() {
    const label = 'IADD DR1, DR2, #7';
    const sim = makeSim();
    sim.dr[2] = 10 >>> 0;
    // IADD opcode=21, cond=AL, crDst=1, crSrc=2, imm=0x4007 (bit14=1 => immediate mode, value=7)
    const instr = enc(21, AL, 1, 2, 0x4007);
    const r = stepPreBoot(sim, instr);
    if (!r) { fail(label, 'step() returned null (fault)'); return; }
    if (!assertDR0Zero(sim, label)) return;
    if ((sim.dr[1] >>> 0) !== 17) {
        fail(label, `DR1=${sim.dr[1]} expected 17`); return;
    }
    pass(label);
})();

(function testIaddDR0dst() {
    // Even if the destination is DR0 (e.g. IADD DR0, DR1, #5), DR0 must be
    // zeroed afterward by step().
    const label = 'IADD DR0 dst stays zero';
    const sim = makeSim();
    sim.dr[1] = 42 >>> 0;
    const instr = enc(21, AL, 0, 1, 0x4005); // IADD DR0, DR1, #5
    const r = stepPreBoot(sim, instr);
    if (!r) { fail(label, 'step() returned null (fault)'); return; }
    if (!assertDR0Zero(sim, label)) return;
    pass(label);
})();

(function testIsub() {
    const label = 'ISUB DR1, DR2, #3';
    const sim = makeSim();
    sim.dr[2] = 10 >>> 0;
    // ISUB opcode=22, crDst=1, crSrc=2, imm=0x4003 (immediate mode, value=3)
    const instr = enc(22, AL, 1, 2, 0x4003);
    const r = stepPreBoot(sim, instr);
    if (!r) { fail(label, 'step() returned null (fault)'); return; }
    if (!assertDR0Zero(sim, label)) return;
    if ((sim.dr[1] >>> 0) !== 7) {
        fail(label, `DR1=${sim.dr[1]} expected 7`); return;
    }
    pass(label);
})();

(function testIsubDR0dst() {
    const label = 'ISUB DR0 dst stays zero';
    const sim = makeSim();
    sim.dr[1] = 20 >>> 0;
    const instr = enc(22, AL, 0, 1, 0x4002); // ISUB DR0, DR1, #2
    const r = stepPreBoot(sim, instr);
    if (!r) { fail(label, 'step() returned null (fault)'); return; }
    if (!assertDR0Zero(sim, label)) return;
    pass(label);
})();

(function testMcmp() {
    const label = 'MCMP DR1, DR2';
    const sim = makeSim();
    sim.dr[1] = 5 >>> 0;
    sim.dr[2] = 5 >>> 0;
    // MCMP opcode=20, crDst=1, crSrc=2, imm=0
    const instr = enc(20, AL, 1, 2, 0);
    const r = stepPreBoot(sim, instr);
    if (!r) { fail(label, 'step() returned null (fault)'); return; }
    if (!assertDR0Zero(sim, label)) return;
    if (!sim.flags.Z) { fail(label, 'Z flag not set after MCMP equal operands'); return; }
    pass(label);
})();

(function testBfext() {
    const label = 'BFEXT DR1, DR2, pos=0, w=4';
    const sim = makeSim();
    sim.dr[2] = 0xFF >>> 0;
    // BFEXT opcode=18, crDst=1, crSrc=2, imm=(pos=0)<<5 | w=4 = 4
    const instr = enc(18, AL, 1, 2, 4);
    const r = stepPreBoot(sim, instr);
    if (!r) { fail(label, 'step() returned null (fault)'); return; }
    if (!assertDR0Zero(sim, label)) return;
    if ((sim.dr[1] >>> 0) !== 0xF) {
        fail(label, `DR1=0x${sim.dr[1].toString(16)} expected 0xF`); return;
    }
    pass(label);
})();

(function testBfins() {
    const label = 'BFINS DR1, DR2, pos=4, w=4';
    const sim = makeSim();
    sim.dr[1] = 0x00 >>> 0; // destination
    sim.dr[2] = 0xA >>> 0;  // value to insert
    // BFINS opcode=19, crDst=1, crSrc=2, imm=(pos=4)<<5 | w=4 = 128+4 = 132
    const instr = enc(19, AL, 1, 2, 132);
    const r = stepPreBoot(sim, instr);
    if (!r) { fail(label, 'step() returned null (fault)'); return; }
    if (!assertDR0Zero(sim, label)) return;
    if ((sim.dr[1] >>> 0) !== 0xA0) {
        fail(label, `DR1=0x${sim.dr[1].toString(16)} expected 0xA0`); return;
    }
    pass(label);
})();

(function testShl() {
    const label = 'SHL DR1, DR2, 2';
    const sim = makeSim();
    sim.dr[2] = 1 >>> 0;
    // SHL opcode=24, crDst=1, crSrc=2, imm=2
    const instr = enc(24, AL, 1, 2, 2);
    const r = stepPreBoot(sim, instr);
    if (!r) { fail(label, 'step() returned null (fault)'); return; }
    if (!assertDR0Zero(sim, label)) return;
    if ((sim.dr[1] >>> 0) !== 4) {
        fail(label, `DR1=${sim.dr[1]} expected 4`); return;
    }
    pass(label);
})();

(function testShr() {
    const label = 'SHR DR1, DR2, 1 (LSR)';
    const sim = makeSim();
    sim.dr[2] = 4 >>> 0;
    // SHR opcode=25, crDst=1, crSrc=2, imm=1 (arith bit=0 => LSR)
    const instr = enc(25, AL, 1, 2, 1);
    const r = stepPreBoot(sim, instr);
    if (!r) { fail(label, 'step() returned null (fault)'); return; }
    if (!assertDR0Zero(sim, label)) return;
    if ((sim.dr[1] >>> 0) !== 2) {
        fail(label, `DR1=${sim.dr[1]} expected 2`); return;
    }
    pass(label);
})();

(function testBranch() {
    const label = 'BRANCH +1';
    const sim = makeSim();
    // BRANCH opcode=23, cond=AL, crDst=0, crSrc=0, imm=1
    // Place the instruction at pc=0; branch goes to pc=0+1=1
    const instr = enc(23, AL, 0, 0, 1);
    const startPC = sim.pc; // 0
    const r = stepPreBoot(sim, instr);
    if (!r) { fail(label, 'step() returned null (fault)'); return; }
    if (!assertDR0Zero(sim, label)) return;
    if (sim.pc !== startPC + 1) {
        fail(label, `PC=${sim.pc} expected ${startPC + 1}`); return;
    }
    pass(label);
})();

// ─── DREAD test ───────────────────────────────────────────────────────────────
// DREAD requires CR12 (for thread DR-zone sync) and a valid data capability in
// the source CR.  We manually configure both without running the boot sequence.

(function testDread() {
    const label = 'DREAD DR1, CR1, 5';
    const sim = makeSim();

    // CR12 must have a non-zero word1 so _writeDR can sync the DR to the thread lump.
    // Use a safe address deep in memory (well past the NS table).
    sim.cr[12].word1 = 0x40; // minimal non-zero thread base within memory[]

    // Build a valid E=0/R=1 Inform GT for NS slot 0.
    // NS slot 0 is always written by _initNamespaceTable() with gt_seq=0 and a
    // valid CRC-16 seal.  An R-only GT with gt_seq=0 passes mLoad's seal and
    // version checks.
    const dataGT = sim.createGT(0, 0, {R:1, W:0, X:0, L:0, S:0, E:0}, 1);
    sim.cr[1].word0 = dataGT;
    sim.cr[1].word1 = 0; // NS slot 0 starts at word address 0

    // Write a known value at offset 5 from CR1's base (memory[5]).
    // We cannot use offset 0 because stepPreBoot() writes the instruction word
    // to memory[pc=0], which would clobber the data at memory[0].
    sim.memory[5] = 0xDEAD >>> 0;

    // DREAD opcode=16, cond=AL, crDst(drIdx)=1, crSrc=1, imm=0x4005
    // bit14=1 → immediate mode, offset=5.
    // Reads memory[cr[1].word1 + 5] = memory[0 + 5] = memory[5] = 0xDEAD.
    const instr = enc(16, AL, 1, 1, 0x4005);
    const r = stepPreBoot(sim, instr);
    if (!r) {
        fail(label, `step() returned null (fault): ${(sim.faultLog.slice(-1)[0]||{}).message}`);
        return;
    }
    if (!assertDR0Zero(sim, label)) return;
    if ((sim.dr[1] >>> 0) !== 0xDEAD) {
        fail(label, `DR1=0x${sim.dr[1].toString(16)} expected 0xDEAD`); return;
    }
    pass(label);
})();

// ─── CALL → Abstract LED CALL dispatch path ──────────────────────────────────
// Task #406: LED[0] is now an Abstract GT (type=0b11, no NS slot, no lump).
// CALL on an Abstract LED GT routes to _dispatchAbstractCall via the M-window.
// DR1[1:0] = method selector (0=Set, 1=Clear, 2=Toggle, 3=State).
// DR1 is written back with the LED state (0=off, 1=on) after each method.
// DR0 must remain zero (step() zeros DR0 after every instruction).

function makeCallLEDSim(dr1Method) {
    const sim = makeSimWithDevAbs();

    // Build an Abstract LED GT for LED[0] (Task #406: no NS slot, no lump).
    // ab_type=I/O (0x00), device_class=LED (0x01), device_data=0 (pin 0).
    const ab_data = (ChurchSimulator.DEVICE_CLASS_LED << 8) | 0;
    const ledGT = sim.createAbstractGT(ChurchSimulator.AB_TYPE_IO, {R:1, W:1}, 0, ab_data);
    sim.cr[0].word0 = ledGT;
    sim.cr[0].word1 = 0;   // Abstract GTs have no physical lump — word1 is unused

    // DR1 selects the LED method: 0=Set, 1=Clear, 2=Toggle, 3=State
    sim.dr[1] = dr1Method >>> 0;

    return sim;
}

// LED.Set: turns LED[0] on; DR1 = new LED state (1 = on).
(function testCallLEDSet() {
    const label = 'CALL CR0 → LED.Set (preserveDR1 signed-return)';
    const sim = makeCallLEDSim(0); // DR1=0 → Set
    const instr = enc(2, AL, 0, 0, 0); // CALL opcode=2, crDst=0
    const r = stepPreBoot(sim, instr);
    if (!r) {
        fail(label, `step() returned null (fault): ${(sim.faultLog.slice(-1)[0]||{}).message}`);
        return;
    }
    if (!assertDR0Zero(sim, label)) return;
    if ((sim.dr[1] | 0) !== 1) {
        fail(label, `DR1=${sim.dr[1] | 0} expected 1 (LED[0] now on)`); return;
    }
    pass(label);
})();

// LED.Clear: turns LED[0] off; DR1 = new LED state (0 = off).
(function testCallLEDClear() {
    const label = 'CALL CR0 → LED.Clear (preserveDR1 signed-return)';
    const sim = makeCallLEDSim(1); // DR1=1 → Clear
    const instr = enc(2, AL, 0, 0, 0);
    const r = stepPreBoot(sim, instr);
    if (!r) {
        fail(label, `step() returned null (fault): ${(sim.faultLog.slice(-1)[0]||{}).message}`);
        return;
    }
    if (!assertDR0Zero(sim, label)) return;
    if ((sim.dr[1] | 0) !== 0) {
        fail(label, `DR1=${sim.dr[1] | 0} expected 0 (LED[0] now off)`); return;
    }
    pass(label);
})();

// LED.Toggle: LED[0] starts off, toggle → on; DR1 = new state (1 = on).
(function testCallLEDToggle() {
    const label = 'CALL CR0 → LED.Toggle (preserveDR1 signed-return)';
    const sim = makeCallLEDSim(2); // DR1=2 → Toggle
    const instr = enc(2, AL, 0, 0, 0);
    const r = stepPreBoot(sim, instr);
    if (!r) {
        fail(label, `step() returned null (fault): ${(sim.faultLog.slice(-1)[0]||{}).message}`);
        return;
    }
    if (!assertDR0Zero(sim, label)) return;
    if ((sim.dr[1] | 0) !== 1) {
        fail(label, `DR1=${sim.dr[1] | 0} expected 1 (LED[0] toggled on)`); return;
    }
    pass(label);
})();

// LED.State: reads LED[0] state (initially off = 0); DR1 = 0.
(function testCallLEDState() {
    const label = 'CALL CR0 → LED.State (preserveDR1 signed-return, result=0=off)';
    const sim = makeCallLEDSim(3); // DR1=3 → State
    const instr = enc(2, AL, 0, 0, 0);
    const r = stepPreBoot(sim, instr);
    if (!r) {
        fail(label, `step() returned null (fault): ${(sim.faultLog.slice(-1)[0]||{}).message}`);
        return;
    }
    if (!assertDR0Zero(sim, label)) return;
    // LED[0] initial state = off → State returns 0
    if ((sim.dr[1] | 0) !== 0) {
        fail(label, `DR1=${sim.dr[1] | 0} expected 0 (LED[0] off)`); return;
    }
    pass(label);
})();

// Confirm LED.State returns 1 (on) after LED.Set has been called.
(function testCallLEDStateAfterSet() {
    const label = 'CALL CR0 → LED.State = 1 after LED.Set';
    const sim = makeCallLEDSim(0); // DR1=0 → Set first
    const setInstr   = enc(2, AL, 0, 0, 0);
    const stateInstr = enc(2, AL, 0, 0, 0);

    // Step 1: LED.Set — DR1=0 (Set method)
    sim.memory[0] = setInstr;
    sim.step(); // Set LED[0] on; DR1 = 1; advance PC to 1
    if (sim.halted) { fail(label, 'faulted during LED.Set step'); return; }
    if (!assertDR0Zero(sim, label + ' after Set')) return;

    // Step 2: LED.State — change DR1 to 3 (State) before next step
    sim.dr[1] = 3 >>> 0;
    sim.memory[1] = stateInstr;
    const r = sim.step();
    if (!r) { fail(label, `step() returned null after Set`); return; }
    if (!assertDR0Zero(sim, label + ' after State')) return;
    if ((sim.dr[1] | 0) !== 1) {
        fail(label, `DR1=${sim.dr[1] | 0} expected 1 (LED[0] on after Set)`); return;
    }
    pass(label);
})();

// ─── Skipped-instruction test (condition false) ───────────────────────────────
// When the condition is false, step() advances PC and emits a "skipped" result
// WITHOUT executing the instruction.  DR0 must still be 0 (it was 0 before and
// step() does NOT call _writeDR(0,0) on the skip path — but DR0 starts at 0
// from reset, and the skip path must not corrupt it).

(function testSkippedInstrDR0() {
    const label = 'Skipped instruction (NV cond) DR0 invariant';
    const sim = makeSim();
    sim.dr[0] = 0; // should already be 0 after reset
    // IADD with NV (Never) condition: will be skipped
    const nv = 0xF; // Never condition
    const instr = enc(21, nv, 1, 2, 0x4007);
    const r = stepPreBoot(sim, instr);
    if (!r) { fail(label, 'step() returned null'); return; }
    // The "skipped" result still has pc/instr fields but no execution
    if ((sim.dr[0] >>> 0) !== 0) {
        fail(label, `DR0=${sim.dr[0]} after skipped instruction (expected 0)`); return;
    }
    pass(label);
})();

// ─── M-window clear-only (M-bit cleared, words unchanged) ────────────────────
// Verifies that _clearMWindow(crIdx) clears the M-bit and leaves CR words intact.
// The old writeBack=true path was removed in Task #448 — _clearMWindow is now
// purely a M-bit clear; all CR word commits go through _mwinWriteback().

(function testMWindowClearOnly() {
    const label = 'M-window clear: _setMWindow then _clearMWindow clears M-bit only (no writeback)';
    const sim = makeSim();

    // Initialise CR[2] with known sentinel values
    sim.cr[2].word0 = 0x11111111;
    sim.cr[2].word1 = 0x22222222;
    sim.cr[2].word2 = 0x33333333;
    sim.cr[2].word3 = 0x44444444;

    // Open the M-window: copies CR[2] words into DR11–DR14
    sim._setMWindow(2);
    if (sim.cr[2].m !== 1) { fail(label, 'Expected cr[2].m=1 after _setMWindow'); return; }
    if (sim.dr[11] !== 0x11111111) { fail(label, `DR11=${sim.dr[11].toString(16)} expected 0x11111111`); return; }

    // Simulate an abstraction modifying the shadow DRs
    sim.dr[11] = 0xAAAAAAAA >>> 0;
    sim.dr[12] = 0xBBBBBBBB >>> 0;

    // _clearMWindow: clears M-bit only, does NOT write DR values back to CR
    sim._clearMWindow(2);
    if (sim.cr[2].m !== 0) { fail(label, 'Expected cr[2].m=0 after _clearMWindow'); return; }

    if (sim.cr[2].word0 !== 0x11111111) {
        fail(label, `cr[2].word0=${sim.cr[2].word0.toString(16)} expected 0x11111111 (no writeback)`); return; }
    if (sim.cr[2].word1 !== 0x22222222) {
        fail(label, `cr[2].word1=${sim.cr[2].word1.toString(16)} expected 0x22222222 (no writeback)`); return; }
    if (sim.cr[2].word2 !== 0x33333333) {
        fail(label, `cr[2].word2=${sim.cr[2].word2.toString(16)} expected 0x33333333 (no writeback)`); return; }
    if (sim.cr[2].word3 !== 0x44444444) {
        fail(label, `cr[2].word3=${sim.cr[2].word3.toString(16)} expected 0x44444444 (no writeback)`); return; }
    pass(label);
})();

// ─── M-reset at CALL boundary ─────────────────────────────────────────────────
// Verifies that executing CALL resets M=1 on every CR (including bystander CRs).

(function testMResetAtCallBoundary() {
    const label = 'M-reset at CALL boundary: all CRn(M) cleared to 0';
    const sim = makeSimWithDevAbs();

    // Load Abstract LED[0] GT into CR0 (same setup as LED CALL tests)
    const ab_data = (ChurchSimulator.DEVICE_CLASS_LED << 8) | 0;
    const ledGT = sim.createAbstractGT(ChurchSimulator.AB_TYPE_IO, {R:1, W:1}, 0, ab_data);
    sim.cr[0].word0 = ledGT;
    sim.dr[1] = 3 >>> 0; // DR1=3 → State (read-only, no side-effects on LED state)

    // Manually assert M=1 on bystander CRs (not involved in the CALL)
    sim.cr[5].m = 1;
    sim.cr[9].m = 1;
    sim.cr[14].m = 1;

    // Execute the Abstract LED CALL — _resetAllMBits() fires at the CALL boundary
    const instr = enc(2, AL, 0, 0, 0); // CALL opcode=2, crDst=0
    const r = stepPreBoot(sim, instr);
    if (!r) {
        fail(label, `step() returned null (fault): ${(sim.faultLog.slice(-1)[0]||{}).message}`);
        return;
    }

    // All M bits must be 0 after the CALL
    for (let i = 0; i < 16; i++) {
        if (sim.cr[i].m !== 0) {
            fail(label, `cr[${i}].m=${sim.cr[i].m} expected 0 after CALL`); return;
        }
    }
    pass(label);
})();

// ─── DREAD indexed mode — bounds overflow tests ──────────────────────────────
// These tests verify that large DRx values do NOT wrap around the 32-bit boundary
// and falsely appear in-bounds. The saturating-sum fix (rawOff > 0xFFFFFFFF →
// clamped to 0xFFFFFFFF before mLoad) must trigger a BOUNDS fault, not a silent
// pass.  All three cases were vulnerable before the fix:
//
//   base=0, DRx=0xFFFFFFFF → rawOff=0xFFFFFFFF (saturated; mLoad sees huge absAddr)
//   base=1, DRx=0xFFFFFFFF → rawOff=2^32   → saturated → 0xFFFFFFFF
//   base=2, DRx=0xFFFFFFFE → rawOff=2^32   → saturated → 0xFFFFFFFF

(function testDreadIndexedOverflowBase0() {
    const label = 'DREAD indexed — base=0 DRx=0xFFFFFFFF must BOUNDS fault';
    const sim = makeSim();
    sim.cr[12].word1 = 0x40;  // required: non-zero thread base for DR write-back
    const dataGT = sim.createGT(0, 0, {R:1, W:0, X:0, L:0, S:0, E:0}, 1);
    sim.cr[1].word0 = dataGT;
    sim.cr[1].word1 = 0;
    // Indexed mode: imm[14]=0, base[13:4]=0, DRx[3:0]=2  (imm = 0x0002)
    sim.dr[2] = 0xFFFFFFFF | 0;               // rawOff = 0 + 0xFFFFFFFF = 0xFFFFFFFF
    const imm = (0 << 4) | 2;
    const instr = enc(16, AL, 1, 1, imm);
    const r = stepPreBoot(sim, instr);
    if (r !== null) { fail(label, 'step() did not fault — overflow wraps to in-bounds'); return; }
    const fl = sim.faultLog.slice(-1)[0] || {};
    // faultCode is numeric (RANGE=0x10=16, BOUNDS=0x08=8); accept either
    const RANGE = ChurchSimulator.FAULT_CODES.RANGE;
    const BOUNDS = ChurchSimulator.FAULT_CODES.BOUNDS;
    if (fl.faultCode !== RANGE && fl.faultCode !== BOUNDS) {
        fail(label, `expected BOUNDS/RANGE fault, got: ${fl.faultCode} — ${fl.message}`); return;
    }
    pass(label);
})();

(function testDreadIndexedOverflowBase1() {
    const label = 'DREAD indexed — base=1 DRx=0xFFFFFFFF must BOUNDS fault (sum=2^32)';
    const sim = makeSim();
    sim.cr[12].word1 = 0x40;
    const dataGT = sim.createGT(0, 0, {R:1, W:0, X:0, L:0, S:0, E:0}, 1);
    sim.cr[1].word0 = dataGT;
    sim.cr[1].word1 = 0;
    // base=1, DR3=0xFFFFFFFF → rawOff = 1 + 4294967295 = 4294967296 > 0xFFFFFFFF → saturated
    sim.dr[3] = 0xFFFFFFFF | 0;
    const imm = (1 << 4) | 3;
    const instr = enc(16, AL, 1, 1, imm);
    const r = stepPreBoot(sim, instr);
    if (r !== null) { fail(label, 'step() did not fault — overflow must saturate and fault BOUNDS'); return; }
    const fl = sim.faultLog.slice(-1)[0] || {};
    const RANGE = ChurchSimulator.FAULT_CODES.RANGE;
    const BOUNDS = ChurchSimulator.FAULT_CODES.BOUNDS;
    if (fl.faultCode !== RANGE && fl.faultCode !== BOUNDS) {
        fail(label, `expected BOUNDS/RANGE fault, got: ${fl.faultCode} — ${fl.message}`); return;
    }
    pass(label);
})();

(function testDreadIndexedOverflowBase2() {
    const label = 'DREAD indexed — base=2 DRx=0xFFFFFFFE must BOUNDS fault (sum=2^32)';
    const sim = makeSim();
    sim.cr[12].word1 = 0x40;
    const dataGT = sim.createGT(0, 0, {R:1, W:0, X:0, L:0, S:0, E:0}, 1);
    sim.cr[1].word0 = dataGT;
    sim.cr[1].word1 = 0;
    // base=2, DR4=0xFFFFFFFE → rawOff = 2 + 4294967294 = 4294967296 > 0xFFFFFFFF → saturated
    sim.dr[4] = 0xFFFFFFFE | 0;
    const imm = (2 << 4) | 4;
    const instr = enc(16, AL, 1, 1, imm);
    const r = stepPreBoot(sim, instr);
    if (r !== null) { fail(label, 'step() did not fault — sum=2^32 must not wrap to 0'); return; }
    const fl = sim.faultLog.slice(-1)[0] || {};
    const RANGE = ChurchSimulator.FAULT_CODES.RANGE;
    const BOUNDS = ChurchSimulator.FAULT_CODES.BOUNDS;
    if (fl.faultCode !== RANGE && fl.faultCode !== BOUNDS) {
        fail(label, `expected BOUNDS/RANGE fault, got: ${fl.faultCode} — ${fl.message}`); return;
    }
    pass(label);
})();

(function testDreadIndexedInBounds() {
    const label = 'DREAD indexed — base=0 DRx=5 in-bounds succeeds';
    const sim = makeSim();
    sim.cr[12].word1 = 0x40;  // required for DR write-back (see existing DREAD test)
    const dataGT = sim.createGT(0, 0, {R:1, W:0, X:0, L:0, S:0, E:0}, 1);
    sim.cr[1].word0 = dataGT;
    sim.cr[1].word1 = 0;
    sim.memory[5] = 0xBEEF >>> 0;
    // DR5=5, base=0 → rawOff=5 → in-bounds; should load memory[5]=0xBEEF into DR1
    sim.dr[5] = 5 >>> 0;
    const imm = (0 << 4) | 5;                  // base=0, DRx=DR5 → imm14=0 (indexed)
    const instr = enc(16, AL, 1, 1, imm);
    const r = stepPreBoot(sim, instr);
    if (!r) {
        const fl = sim.faultLog.slice(-1)[0] || {};
        fail(label, `step() faulted unexpectedly: ${fl.faultCode} — ${fl.message}`); return;
    }
    if ((sim.dr[1] >>> 0) !== 0xBEEF) {
        fail(label, `DR1=0x${sim.dr[1].toString(16)} expected 0xBEEF`); return;
    }
    pass(label);
})();

// ─── Report ──────────────────────────────────────────────────────────────────

if (ERRORS.length > 0) {
    process.stderr.write(`\n${ERRORS.length} test(s) failed.\n`);
    process.exit(1);
}
process.exit(0);
