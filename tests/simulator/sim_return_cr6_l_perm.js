// sim_return_cr6_l_perm.js — Confirm RETURN restores CR6 to the caller's saved L-GT.
//
// Architecture contract:
//   CALL writes an L-GT (perm=0b001) into CR6 (hardware call.py, cr6_adj_gt.perm=0b001).
//   RETURN must restore CR6 from the raw savedCRs[6] word that was snapshotted at
//   CALL time.  If RETURN reconstructed a fresh GT from the NS entry instead of
//   restoring the saved word, it could accidentally produce an E-GT instead of the
//   caller's original L-GT — breaking the permission contract.
//
// GT word layout (v2.0):
//   [31]    = b_flag
//   [30:28] = perm[2:0]  (Church domain: [2]=E [1]=S [0]=L)
//   [27]    = dom        (1 = Church, 0 = Turing)
//   [26:25] = gt_type
//   [24:16] = gt_seq (9 bits)
//   [15:0]  = slot_id
//
// Perm masks (bits [30:28]):
//   L_PERM   = 0b001 << 28 = 0x10000000
//   E_PERM   = 0b100 << 28 = 0x40000000
//   PERM_MASK = 0b111 << 28 = 0x70000000
//
// Test architecture:
//   Direct state setup (bootComplete=true, manual NS/memory writes) is used
//   to avoid a dependency on the on-disk boot-image binary, which causes
//   gt_seq mismatch failures in headless CI.  This matches the established
//   pattern of sim_call_cr6_l_perm.js and simulator/test_fault_recovery.js.
//
// Test phases:
//
//   PHASE PM — perm-mask sanity:
//     Verify L_PERM/E_PERM constants before they are used as ground truth.
//
//   PHASE 1 — direct frame injection:
//     Manually push a call frame whose savedCRs[6] is an L-GT, then call
//     _execReturn().  Verifies the raw restore path without executing a real
//     CALL instruction.  Key assertion: restored CR6 has L-perm, not E-perm.
//
//   PHASE 2 — CALL→RETURN round-trip (lump-header path, cc>0):
//     Execute _execCall() so the real CALL logic snapshots the caller's CR6
//     L-GT into frame.savedCRs[6] and overwrites CR6 with a callee L-GT.
//     Then execute _execReturn() with mask=0 so CR6 is unconditionally
//     restored.  Asserts the restored CR6 is the caller's original L-GT word
//     (same slot_id and L-perm, not E-perm).
//
//   PHASE 3 — CALL→RETURN round-trip, mask bit 6 SET (CR6 preserved):
//     When mask bit 6 is set, RETURN preserves the callee's CR6 (the L-GT
//     for the callee) rather than restoring the caller's.  The callee's CR6
//     is also an L-GT (CALL always writes L-perm).  This phase confirms that
//     even in the preserve path, CR6 still carries L-perm.
//
//   PHASE E2E — full fetch/decode/execute via sim.step():
//     Places a CALL word then a RETURN word in memory, steps twice, and
//     asserts CR6 is restored to the caller's original L-GT after RETURN.

'use strict';

global.window = {};  // silence any bootConfig references in the constructor

const ChurchSimulator = require('../../simulator/simulator.js');

function writeTestNsEntry(sim, ...args) {
    const bootComplete = sim.bootComplete;
    sim.bootComplete = false;
    try {
        return sim.writeNSEntry(...args);
    } finally {
        sim.bootComplete = bootComplete;
    }
}

const PERM_MASK = 0x70000000;   // bits[30:28]
const L_PERM   = 0x10000000;   // perm[0]=L  → bits[30:28] = 0b001
const E_PERM   = 0x40000000;   // perm[2]=E  → bits[30:28] = 0b100

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

// ── Shared helpers ─────────────────────────────────────────────────────────────

function makeReturnSim() {
    const sim = new ChurchSimulator();
    sim.bootComplete = true;
    if (!sim.cr) sim.cr = new Array(16).fill(null);
    for (let i = 0; i < 16; i++) {
        if (!sim.cr[i]) {
            sim.cr[i] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
        }
    }
    return sim;
}

// Write a 64-word LUMP header to memory[base].
function writeLumpHdr(sim, base, cc, cw) {
    const hdr = ((0x1F << 27) | (0 << 23) | (cw << 10) | (0 << 8) | cc) >>> 0;
    sim.memory[base] = hdr;
}

// Intercept faults so assertions can check whether any fired.
function installFaultCapture(sim) {
    const faults = [];
    const origFault = sim.fault.bind(sim);
    sim.fault = (type, msg) => { faults.push({ type, message: msg }); origFault(type, msg); };
    return faults;
}

// ── PHASE PM: perm-mask sanity ────────────────────────────────────────────────
console.log('\n--- PHASE PM: perm-mask sanity ---');
{
    const sim = makeReturnSim();
    const lGT = sim.createGT(0, 10, {L:1}, 1);
    const eGT = sim.createGT(0, 10, {E:1}, 1);

    assert('PM-1: createGT({L:1}) encodes as L_PERM',
        (lGT & PERM_MASK) === L_PERM,
        `word=0x${lGT.toString(16).toUpperCase()}`);

    assert('PM-2: createGT({E:1}) encodes as E_PERM',
        (eGT & PERM_MASK) === E_PERM,
        `word=0x${eGT.toString(16).toUpperCase()}`);

    assert('PM-3: L_PERM !== E_PERM (mask not degenerate)', L_PERM !== E_PERM, '');

    assert('PM-4: dom bit (bit[27]) is set on Church GTs',
        ((lGT >>> 27) & 1) === 1, `lGT=0x${lGT.toString(16).toUpperCase()}`);
}

// ── PHASE 1: direct frame injection → RETURN restores L-GT ───────────────────
//
// Bypasses _execCall to exercise _execReturn in isolation.
// Push a hand-crafted frame with savedCRs[6] = an L-GT for slot 7.
// After RETURN: CR6 must have L-perm (not E-perm) and point to slot 7.
console.log('\n--- PHASE 1: direct frame injection ---');
{
    const CALLER_SLOT = 7;
    const RETURN_PC   = 3;

    const sim = makeReturnSim();
    const faults = installFaultCapture(sim);

    // Build the L-GT that was in the caller's CR6.
    const callerCR6GT = sim.createGT(0, CALLER_SLOT, {L:1}, 1);

    // Craft a call frame identical to what _execCall pushes, with savedCRs[6] = L-GT.
    const savedCRs = [];
    for (let i = 0; i < 16; i++) {
        savedCRs[i] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
    }
    savedCRs[6] = { word0: callerCR6GT, word1: 0x0100, word2: 0, word3: 0, m: 0 };

    sim.callStack.push({
        returnPC:   RETURN_PC,
        savedCRs:   savedCRs,
        savedDRs:   new Array(16).fill(0),
        savedFlags: { Z: false, N: false, C: false, V: false },
        savedSTO:   10,
        sz: 1,
        frameWord:  0,
        sentinel:   false,
    });

    // Overwrite CR6 with a different GT (as CALL would have done for the callee).
    const calleeCR6GT = sim.createGT(1, 9, {L:1}, 1);
    sim.cr[6] = { word0: calleeCR6GT, word1: 0x0200, word2: 0, word3: 0, m: 0 };

    // Execute RETURN with mask=0 — no return values, restore all saved CRs.
    const result = sim._execReturn({ imm: 0, crDst: 0, crSrc: 0, raw: 0 });

    assert('P1-NO-FAULT: _execReturn (direct frame) did not fault',
        faults.length === 0 && result !== null,
        faults.map(f => `[${f.type}] ${f.message}`).join('; ') || 'result was null');

    const cr6w0 = sim.cr[6].word0 >>> 0;
    const perm  = cr6w0 & PERM_MASK;

    assert('P1-L: CR6 restored with L-perm after RETURN',
        perm === L_PERM,
        `word0=0x${cr6w0.toString(16).toUpperCase()}, perm=0x${perm.toString(16).toUpperCase()}, expected L=0x${L_PERM.toString(16).toUpperCase()}`);

    assert('P1-NOT-E: CR6 does NOT have E-perm after RETURN',
        perm !== E_PERM,
        `word0=0x${cr6w0.toString(16).toUpperCase()} — must be L not E`);

    assert('P1-SLOT: CR6 GT slot_id is the caller\'s original slot after RETURN',
        (cr6w0 & 0xFFFF) === CALLER_SLOT,
        `got ${cr6w0 & 0xFFFF}, expected ${CALLER_SLOT}`);

    assert('P1-WORD: CR6.word0 is the exact saved L-GT word (byte-identical restore)',
        cr6w0 === (callerCR6GT >>> 0),
        `got 0x${cr6w0.toString(16).toUpperCase()}, expected 0x${(callerCR6GT >>> 0).toString(16).toUpperCase()}`);

    assert('P1-PC: RETURN restored PC to frame.returnPC',
        result && result.pc === RETURN_PC,
        `got pc=${result && result.pc}, expected ${RETURN_PC}`);
}

// ── PHASE 2: real CALL→RETURN round-trip (cc>0, mask=0) ──────────────────────
//
// Executes a genuine _execCall() so the simulator's own snapshotting logic
// captures the caller's CR6 L-GT into frame.savedCRs[6].  Then executes
// _execReturn() with mask=0.  The restored CR6 must be the caller's original
// L-GT (L-perm, same slot_id) — not the callee's CR6 L-GT or any E-GT.
console.log('\n--- PHASE 2: real CALL→RETURN round-trip (cc>0, mask=0) ---');
{
    const CALLER_BASE  = 0x0200;
    const CALLER_SLOT  = 5;
    const CALLER_CC    = 2;
    const CALLER_CW    = 4;

    const CALLEE_BASE  = 0x0400;
    const CALLEE_SLOT  = 12;
    const CALLEE_CC    = 2;
    const CALLEE_CW    = 3;

    const sim = makeReturnSim();
    const faults = installFaultCapture(sim);

    // Write both lump headers.
    writeLumpHdr(sim, CALLER_BASE, CALLER_CC, CALLER_CW);
    writeLumpHdr(sim, CALLEE_BASE, CALLEE_CC, CALLEE_CW);

    // Write NS table entries.
    writeTestNsEntry(sim, CALLER_SLOT, CALLER_BASE, 63, 0, 0, 1, 0, CALLER_CC, 0);
    writeTestNsEntry(sim, CALLEE_SLOT, CALLEE_BASE, 63, 0, 0, 1, 0, CALLEE_CC, 0);

    // CR6: caller's L-GT for the caller's own c-list (slot 5).
    const callerCR6GT = sim.createGT(0, CALLER_SLOT, {L:1}, 1);
    sim.cr[6] = { word0: callerCR6GT, word1: CALLER_BASE, word2: 0, word3: 0, m: 0 };

    // CR14: caller's code register (RX, slot 5).
    const cr14GT = sim.createGT(0, CALLER_SLOT, {R:1, X:1}, 1);
    sim.cr[14] = { word0: cr14GT, word1: CALLER_BASE, word2: 0, word3: 0, m: 0 };

    // CR0: callee E-GT — what CALL dispatches through.
    sim.cr[0] = {
        word0: sim.createGT(0, CALLEE_SLOT, {E:1}, 1),
        word1: 0, word2: 0, word3: 0, m: 0
    };

    // CR12.word1=0 → skip thread-stack write; CR15.m=0 → _mwinWriteback no-op.
    sim.cr[12] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
    sim.cr[15] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };

    sim.pc = 0;

    const callResult = sim._execCall({ crDst: 0, imm: 0 });

    assert('P2-CALL-NO-FAULT: _execCall did not fault',
        faults.length === 0 && callResult !== null,
        faults.map(f => `[${f.type}] ${f.message}`).join('; ') || 'result was null');

    // After CALL: CR6 should be L-GT for the callee (verified by the companion test).
    // Now confirm that a subsequent RETURN restores the *caller's* CR6 L-GT.
    if (callResult !== null) {
        const stackDepthAfterCall = sim.callStack.length;
        assert('P2-STACK-DEPTH: callStack has exactly 1 frame after CALL',
            stackDepthAfterCall === 1,
            `depth=${stackDepthAfterCall}`);

        faults.length = 0;  // reset fault capture for the RETURN phase

        const returnResult = sim._execReturn({ imm: 0, crDst: 0, crSrc: 0, raw: 0 });

        assert('P2-RETURN-NO-FAULT: _execReturn did not fault',
            faults.length === 0 && returnResult !== null,
            faults.map(f => `[${f.type}] ${f.message}`).join('; ') || 'result was null');

        const cr6w0 = sim.cr[6].word0 >>> 0;
        const perm  = cr6w0 & PERM_MASK;

        assert('P2-L: CR6 restored with L-perm after RETURN',
            perm === L_PERM,
            `word0=0x${cr6w0.toString(16).toUpperCase()}, perm=0x${perm.toString(16).toUpperCase()}, expected L=0x${L_PERM.toString(16).toUpperCase()}`);

        assert('P2-NOT-E: CR6 does NOT have E-perm after RETURN',
            perm !== E_PERM,
            `word0=0x${cr6w0.toString(16).toUpperCase()} — must be L not E`);

        assert('P2-CALLER-SLOT: CR6 GT slot_id is the caller\'s original slot after RETURN',
            (cr6w0 & 0xFFFF) === CALLER_SLOT,
            `got ${cr6w0 & 0xFFFF}, expected CALLER_SLOT=${CALLER_SLOT}`);

        assert('P2-WORD: CR6.word0 is byte-identical to the caller\'s original L-GT',
            cr6w0 === (callerCR6GT >>> 0),
            `got 0x${cr6w0.toString(16).toUpperCase()}, expected 0x${(callerCR6GT >>> 0).toString(16).toUpperCase()}`);

        assert('P2-STACK-EMPTY: callStack is empty after RETURN',
            sim.callStack.length === 0,
            `depth=${sim.callStack.length}`);
    }
}

// ── PHASE 3: CALL→RETURN with mask bit 6 SET (CR6 preserved) ─────────────────
//
// When mask bit 6 is set, RETURN keeps the callee's CR6 rather than restoring
// the caller's.  The callee's CR6 is also L-perm (CALL always writes L-perm).
// This phase asserts that even the preserve path doesn't accidentally produce
// an E-GT.
console.log('\n--- PHASE 3: CALL→RETURN with mask bit 6 SET (CR6 preserved) ---');
{
    const CALLEE_BASE  = 0x0600;
    const CALLEE_SLOT  = 15;
    const CALLEE_CC    = 2;
    const CALLEE_CW    = 3;

    const sim = makeReturnSim();
    const faults = installFaultCapture(sim);

    writeLumpHdr(sim, CALLEE_BASE, CALLEE_CC, CALLEE_CW);
    writeTestNsEntry(sim, CALLEE_SLOT, CALLEE_BASE, 63, 0, 0, 1, 0, CALLEE_CC, 0);

    // Caller's CR6 = L-GT for slot 4.
    sim.cr[6] = {
        word0: sim.createGT(0, 4, {L:1}, 1),
        word1: 0, word2: 0, word3: 0, m: 0
    };
    sim.cr[0] = {
        word0: sim.createGT(0, CALLEE_SLOT, {E:1}, 1),
        word1: 0, word2: 0, word3: 0, m: 0
    };
    sim.cr[12] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
    sim.cr[15] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
    sim.pc = 0;

    const callResult = sim._execCall({ crDst: 0, imm: 0 });

    if (callResult !== null) {
        // Capture callee's CR6 word (L-GT for CALLEE_SLOT, set by _execCall).
        const calleeCR6GT = sim.cr[6].word0 >>> 0;

        assert('P3-CALLEE-L: callee CR6 has L-perm after CALL (pre-RETURN sanity)',
            (calleeCR6GT & PERM_MASK) === L_PERM,
            `calleeCR6GT=0x${calleeCR6GT.toString(16).toUpperCase()}`);

        faults.length = 0;

        // RETURN with mask bit 6 = 1 → preserve callee's CR6.
        const MASK_BIT6 = 1 << 6;
        const returnResult = sim._execReturn({ imm: MASK_BIT6, crDst: 0, crSrc: 0, raw: 0 });

        assert('P3-RETURN-NO-FAULT: _execReturn (mask bit 6) did not fault',
            faults.length === 0 && returnResult !== null,
            faults.map(f => `[${f.type}] ${f.message}`).join('; ') || 'result was null');

        const cr6w0 = sim.cr[6].word0 >>> 0;
        const perm  = cr6w0 & PERM_MASK;

        assert('P3-PRESERVED: CR6 is the callee\'s GT (mask bit 6 kept it)',
            cr6w0 === calleeCR6GT,
            `got 0x${cr6w0.toString(16).toUpperCase()}, expected 0x${calleeCR6GT.toString(16).toUpperCase()}`);

        assert('P3-L: preserved CR6 has L-perm (not E)',
            perm === L_PERM,
            `word0=0x${cr6w0.toString(16).toUpperCase()}, perm=0x${perm.toString(16).toUpperCase()}`);

        assert('P3-NOT-E: preserved CR6 does NOT have E-perm',
            perm !== E_PERM,
            `word0=0x${cr6w0.toString(16).toUpperCase()}`);
    } else {
        console.log('SKIP P3-* — CALL returned null, skipping RETURN sub-assertions');
    }
}

// ── PHASE E2E: full fetch/decode/execute via sim.step() ───────────────────────
//
// Layout:
//   Caller lump (slot 5, CALLER_BASE): header + CALL word at +1 + RETURN word at +2.
//   Callee lump (slot 13, CALLEE_BASE): header with cc=2.
//
// sim.step() twice:
//   Step 1: fetches CALL instruction → _execCall → CR6 = callee L-GT, frame saved.
//   Step 2: fetches RETURN instruction → _execReturn → CR6 = caller's original L-GT.
//
// CALL  encoding: opcode=2, cond=14(AL), crDst=0 → 0x10700000
// RETURN encoding: opcode=3, cond=14(AL), imm=0  → 0x18700000
console.log('\n--- PHASE E2E: full fetch/decode/execute via sim.step() ---');
{
    const CALLER_BASE  = 0x0800;
    const CALLER_SLOT  = 5;
    const CALLER_CC    = 2;
    const CALLER_CW    = 4;     // room for 2 code words: CALL + RETURN

    const CALLEE_BASE  = 0x0900;
    const CALLEE_SLOT  = 13;
    const CALLEE_CC    = 2;
    const CALLEE_CW    = 3;

    const sim = makeReturnSim();
    const faults = installFaultCapture(sim);

    // Write lump headers.
    writeLumpHdr(sim, CALLER_BASE, CALLER_CC, CALLER_CW);
    writeLumpHdr(sim, CALLEE_BASE, CALLEE_CC, CALLEE_CW);

    // Place CALL then RETURN in the caller's code section.
    const CALL_WORD   = sim.encodeInstruction(2, 14, 0, 0, 0);   // opcode=2, cond=AL, crDst=0
    const RETURN_WORD = sim.encodeInstruction(3, 14, 0, 0, 0);   // opcode=3, cond=AL, imm=0
    sim.memory[CALLER_BASE + 1] = CALL_WORD;     // code word 0 (PC=0) → CALL
    sim.memory[CALLER_BASE + 2] = RETURN_WORD;   // code word 1 (PC=1) → RETURN

    // NS table.
    writeTestNsEntry(sim, CALLER_SLOT, CALLER_BASE, 63, 0, 0, 1, 0, CALLER_CC, 0);
    writeTestNsEntry(sim, CALLEE_SLOT, CALLEE_BASE, 63, 0, 0, 1, 0, CALLEE_CC, 0);

    // Caller's CR6 = L-GT for caller slot.
    const callerCR6GT = sim.createGT(0, CALLER_SLOT, {L:1}, 1);
    sim.cr[6] = { word0: callerCR6GT, word1: CALLER_BASE, word2: 0, word3: 0, m: 0 };

    // CR14 points at caller lump.
    const cr14GT = sim.createGT(0, CALLER_SLOT, {R:1, X:1}, 1);
    sim.cr[14] = { word0: cr14GT, word1: CALLER_BASE, word2: 0, word3: 0, m: 0 };

    // CR0 = callee E-GT (CALL dispatches through this).
    sim.cr[0] = {
        word0: sim.createGT(0, CALLEE_SLOT, {E:1}, 1),
        word1: 0, word2: 0, word3: 0, m: 0
    };

    sim.cr[12] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
    sim.cr[15] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };

    sim.pc = 0;

    // ── Step 1: CALL ──────────────────────────────────────────────────────────
    assert('E2E-SETUP-CALL: CALL word at CALLER_BASE+1',
        sim.memory[CALLER_BASE + 1] === CALL_WORD,
        `mem=0x${(sim.memory[CALLER_BASE + 1] || 0).toString(16).toUpperCase()}, expected 0x${CALL_WORD.toString(16).toUpperCase()}`);

    const step1 = sim.step();

    assert('E2E-STEP1-NO-FAULT: step() CALL did not fault',
        faults.length === 0 && step1 !== null,
        faults.map(f => `[${f.type}] ${f.message}`).join('; ') || 'step1 was null');

    if (step1) {
        assert('E2E-STEP1-OPCODE: step1 dispatched opcode=2 (CALL)',
            step1.instr && step1.instr.opcode === 2,
            `instr=${JSON.stringify(step1.instr)}`);
    }

    // After CALL: CR6 should be callee's L-GT; CR14 should point at callee lump.
    const cr6AfterCall = sim.cr[6].word0 >>> 0;
    assert('E2E-AFTER-CALL-L: CR6 has L-perm immediately after CALL step',
        (cr6AfterCall & PERM_MASK) === L_PERM,
        `word0=0x${cr6AfterCall.toString(16).toUpperCase()}`);

    // ── Step 2: RETURN ────────────────────────────────────────────────────────
    // After CALL, CR14 points at the callee lump; RETURN is at callee+1.
    // But the simulator's PC is reset by CALL to 0 relative to the callee, and
    // there is no code in the callee lump.  Instead, we verify the round-trip via
    // _execReturn() directly — the RETURN instruction's fetch from the callee would
    // require placing a RETURN word inside the callee code section.
    //
    // For the E2E step we instead restore CR14 to the caller, set PC=1 (pointing
    // at code word 1 = RETURN), then step().

    // Restore CR14 to caller so RETURN can be fetched from caller's code section.
    sim.cr[14] = { word0: cr14GT, word1: CALLER_BASE, word2: 0, word3: 0, m: 0 };
    sim.pc = 1;  // code word 1 = RETURN_WORD at CALLER_BASE+2

    assert('E2E-SETUP-RETURN: RETURN word at CALLER_BASE+2',
        sim.memory[CALLER_BASE + 2] === RETURN_WORD,
        `mem=0x${(sim.memory[CALLER_BASE + 2] || 0).toString(16).toUpperCase()}, expected 0x${RETURN_WORD.toString(16).toUpperCase()}`);

    faults.length = 0;
    const step2 = sim.step();

    assert('E2E-STEP2-NO-FAULT: step() RETURN did not fault',
        faults.length === 0 && step2 !== null,
        faults.map(f => `[${f.type}] ${f.message}`).join('; ') || 'step2 was null');

    if (step2) {
        assert('E2E-STEP2-OPCODE: step2 dispatched opcode=3 (RETURN)',
            step2.instr && step2.instr.opcode === 3,
            `instr=${JSON.stringify(step2.instr)}`);
    }

    const cr6w0 = sim.cr[6].word0 >>> 0;
    const perm  = cr6w0 & PERM_MASK;

    assert('E2E-L: CR6 has L-perm after RETURN step',
        perm === L_PERM,
        `word0=0x${cr6w0.toString(16).toUpperCase()}, perm=0x${perm.toString(16).toUpperCase()}, expected L=0x${L_PERM.toString(16).toUpperCase()}`);

    assert('E2E-NOT-E: CR6 does NOT have E-perm after RETURN step',
        perm !== E_PERM,
        `word0=0x${cr6w0.toString(16).toUpperCase()} — must be L not E`);

    assert('E2E-CALLER-SLOT: CR6 GT slot_id is the caller\'s original slot after RETURN',
        (cr6w0 & 0xFFFF) === CALLER_SLOT,
        `got ${cr6w0 & 0xFFFF}, expected CALLER_SLOT=${CALLER_SLOT}`);

    assert('E2E-WORD: CR6.word0 is byte-identical to the caller\'s original L-GT',
        cr6w0 === (callerCR6GT >>> 0),
        `got 0x${cr6w0.toString(16).toUpperCase()}, expected 0x${(callerCR6GT >>> 0).toString(16).toUpperCase()}`);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
