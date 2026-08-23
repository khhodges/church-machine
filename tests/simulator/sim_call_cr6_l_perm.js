// sim_call_cr6_l_perm.js — Confirm CALL delivers an L-GT (perm=0b001) to CR6.
//
// Hardware reference: hardware/call.py line 345
//   cr6_adj_gt.perm.eq(0b001)   # L = perm[0] in Church domain
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
//   pattern of simulator/test_fault_recovery.js.
//
// Test phases:
//
//   PHASE PM — perm-mask sanity:
//     Verify L_PERM/E_PERM constants before they're used as ground truth.
//
//   PHASE 1 — lump-header path (cc>0) via _execCall():
//     _execCall enters the `hasLumpHeader` branch (~line 4251 of simulator.js).
//     Asserts perm=L, slot_id=callee slot.
//
//   PHASE 2 — non-lump-header path (cc=0) via _execCall():
//     _execCall enters the else branch (~line 4289 of simulator.js).
//     Asserts perm=L.
//
//   PHASE E2E — end-to-end through sim.step():
//     Places a real CALL instruction word (opcode=2, cond=AL, crDst=0) in
//     caller-lump memory, calls sim.step(), and asserts CR6.word0 has L-perm.
//     This is the full fetch → decode → execute path:
//       _fetchInstruction reads memory[cr14.word1 + 1 + pc]
//       decodeInstruction produces d.opcode=2
//       step() dispatches to _execCall(d)
//       _execCall sets CR6 with L-perm

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

// Build a minimal simulator with bootComplete=true and all CRs zero-initialised.
function makeCallSim() {
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
    const sim = makeCallSim();
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

// ── PHASE 1: lump-header path (cc > 0), via _execCall() ──────────────────────
console.log('\n--- PHASE 1: lump-header path (cc=2) ---');
{
    const CALLEE_BASE = 0x0200;
    const CALLEE_SLOT = 10;
    const CC = 2;
    const CW = 3;

    const sim = makeCallSim();
    const faults = installFaultCapture(sim);

    writeLumpHdr(sim, CALLEE_BASE, CC, CW);
    writeTestNsEntry(sim, CALLEE_SLOT, CALLEE_BASE, 63, 0, 0, 1, 0, CC, 0);

    sim.cr[0] = {
        word0: sim.createGT(0, CALLEE_SLOT, {E:1}, 1),
        word1: 0, word2: 0, word3: 0, m: 0
    };
    // CR12.word1=0 → skip thread-stack write; CR15.m=0 → _mwinWriteback is a no-op.
    sim.cr[12] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
    sim.cr[15] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };

    const result = sim._execCall({ crDst: 0, imm: 0 });

    assert('P1-NO-FAULT: _execCall (lump-header path) did not fault',
        faults.length === 0 && result !== null,
        faults.map(f => `[${f.type}] ${f.message}`).join('; ') || 'result was null');

    const cr6w0 = sim.cr[6].word0 >>> 0;
    const perm  = cr6w0 & PERM_MASK;

    assert('P1-L: CR6 has L-perm (perm=0b001) after CALL (lump-header path)',
        perm === L_PERM,
        `word0=0x${cr6w0.toString(16).toUpperCase()}, perm=0x${perm.toString(16).toUpperCase()}`);

    assert('P1-NOT-E: CR6 does NOT have E-perm after CALL (lump-header path)',
        perm !== E_PERM,
        `word0=0x${cr6w0.toString(16).toUpperCase()}`);

    const slotInCR6 = cr6w0 & 0xFFFF;
    assert('P1-SLOT: CR6 GT slot_id references the callee NS slot',
        slotInCR6 === CALLEE_SLOT,
        `got ${slotInCR6}, expected ${CALLEE_SLOT}`);
}

// ── PHASE 2: non-lump-header path (cc = 0), via _execCall() ──────────────────
console.log('\n--- PHASE 2: non-lump-header path (cc=0) ---');
{
    const CALLEE_BASE = 0x0300;
    const CALLEE_SLOT = 11;
    const CC = 0;
    const CW = 3;

    const sim = makeCallSim();
    const faults = installFaultCapture(sim);

    writeLumpHdr(sim, CALLEE_BASE, CC, CW);
    writeTestNsEntry(sim, CALLEE_SLOT, CALLEE_BASE, 63, 0, 0, 1, 0, CC, 0);

    sim.cr[0] = {
        word0: sim.createGT(0, CALLEE_SLOT, {E:1}, 1),
        word1: 0, word2: 0, word3: 0, m: 0
    };
    sim.cr[12] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
    sim.cr[15] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };

    const result = sim._execCall({ crDst: 0, imm: 0 });

    assert('P2-NO-FAULT: _execCall (non-lump-header path) did not fault',
        faults.length === 0 && result !== null,
        faults.map(f => `[${f.type}] ${f.message}`).join('; ') || 'result was null');

    const cr6w0 = sim.cr[6].word0 >>> 0;
    const perm  = cr6w0 & PERM_MASK;

    assert('P2-L: CR6 has L-perm after CALL (non-lump-header path)',
        perm === L_PERM,
        `word0=0x${cr6w0.toString(16).toUpperCase()}, perm=0x${perm.toString(16).toUpperCase()}`);

    assert('P2-NOT-E: CR6 does NOT have E-perm (non-lump-header path)',
        perm !== E_PERM,
        `word0=0x${cr6w0.toString(16).toUpperCase()}`);
}

// ── PHASE E2E: end-to-end through sim.step() ──────────────────────────────────
//
// Sets up two abstractions:
//   Caller (slot 5, at CALLER_BASE): a 64-word code lump with a CALL instruction
//     at code word 0 (CALLER_BASE+1, the first instruction slot).
//   Callee (slot 10, at CALLEE_BASE): a 64-word lump with cc=2 (hasLumpHeader).
//
// CR14 points at the caller lump with RX permission so _fetchInstruction
// succeeds.  CR0 holds an E-perm GT for the callee.  PC=0.
//
// sim.step() exercises the full fetch → decode → execute path:
//   _fetchInstruction() reads memory[cr14.word1 + 1 + pc] = memory[CALLER_BASE+1]
//   decodeInstruction()  produces d.opcode=2 (CALL), d.crDst=0, d.imm=0
//   step() dispatches to _execCall(d)
//   _execCall sets CR6 with L-perm (perm=0b001), matching hardware call.py
//
// CALL instruction encoding (encodeInstruction):
//   opcode=2  cond=14(AL)  crDst=0  crSrc=0  imm=0
//   → (2<<27)|(14<<23)|(0<<19)|(0<<15)|0 = 0x10700000
console.log('\n--- PHASE E2E: full fetch/decode/execute via sim.step() ---');
{
    const CALLER_BASE = 0x0400;
    const CALLER_SLOT = 5;
    const CALLER_CC   = 2;
    const CALLER_CW   = 4;    // at least 1 code word for the CALL instruction

    const CALLEE_BASE = 0x0500;
    const CALLEE_SLOT = 13;
    const CALLEE_CC   = 2;    // cc>0 → hasLumpHeader path → L-perm set
    const CALLEE_CW   = 3;

    const sim = makeCallSim();
    const faults = installFaultCapture(sim);

    // ── Write both lumps into memory ──────────────────────────────────────────

    // Caller lump: header at CALLER_BASE, code word at CALLER_BASE+1.
    writeLumpHdr(sim, CALLER_BASE, CALLER_CC, CALLER_CW);
    // CALL instruction: opcode=2, cond=14(AL), crDst=0, crSrc=0, imm=0.
    const CALL_WORD = sim.encodeInstruction(2, 14, 0, 0, 0);
    sim.memory[CALLER_BASE + 1] = CALL_WORD;   // code word 0 (PC=0)

    // Callee lump: header at CALLEE_BASE.
    writeLumpHdr(sim, CALLEE_BASE, CALLEE_CC, CALLEE_CW);

    // ── Write NS table entries ────────────────────────────────────────────────
    // Caller slot: RX-perm (Turing domain) so CR14 mLoad('X') passes.
    // clistCount = CALLER_CC for the NS entry (not for GT perm).
    writeTestNsEntry(sim, CALLER_SLOT, CALLER_BASE, 63, 0, 0, 1, 0, CALLER_CC, 0);
    // Callee slot: E-perm (Church domain) called via CR0.
    writeTestNsEntry(sim, CALLEE_SLOT, CALLEE_BASE, 63, 0, 0, 1, 0, CALLEE_CC, 0);

    // ── Set up capability registers ───────────────────────────────────────────
    // CR14: code register → caller lump, RX-perm Inform GT.
    //   word1 = CALLER_BASE  (lump base, used as: fetchAddr = word1 + 1 + pc)
    const cr14GT = sim.createGT(0, CALLER_SLOT, {R:1, W:0, X:1, L:0, S:0, E:0}, 1);
    sim.cr[14] = {
        word0: cr14GT,
        word1: CALLER_BASE,  // fetchAddr = CALLER_BASE + 1 + pc (pc=0) = CALLER_BASE+1
        word2: 0,
        word3: 0,
        m:     0,
    };

    // CR0: callee E-perm GT — this is what the CALL dispatches through.
    sim.cr[0] = {
        word0: sim.createGT(0, CALLEE_SLOT, {E:1}, 1),
        word1: 0, word2: 0, word3: 0, m: 0
    };

    // CR12.word1=0 → skip thread-stack write in _execCall.
    sim.cr[12] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
    // CR15.m=0 → _mwinWriteback returns true immediately (no M-window pending).
    sim.cr[15] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };

    // ── PC = 0, then step() ───────────────────────────────────────────────────
    sim.pc = 0;

    // Confirm the CALL instruction word is in memory where _fetchInstruction reads it.
    const fetchAddr = CALLER_BASE + 1 + 0;  // cr14.word1 + 1 + pc
    assert('E2E-SETUP: CALL opcode word is at fetchAddr in memory',
        sim.memory[fetchAddr] === CALL_WORD,
        `mem[0x${fetchAddr.toString(16)}]=0x${(sim.memory[fetchAddr]||0).toString(16).toUpperCase()}, expected 0x${CALL_WORD.toString(16).toUpperCase()}`);

    const result = sim.step();

    assert('E2E-NO-FAULT: sim.step() executed CALL without faulting',
        faults.length === 0 && result !== null,
        faults.map(f => `[${f.type}] ${f.message}`).join('; ') || 'result was null');

    if (result) {
        assert('E2E-OPCODE: step() dispatched opcode=2 (CALL)',
            result.instr && result.instr.opcode === 2,
            `instr=${JSON.stringify(result.instr)}`);
    }

    const cr6w0 = sim.cr[6].word0 >>> 0;
    const perm  = cr6w0 & PERM_MASK;

    assert('E2E-L: CR6 has L-perm (perm=0b001) after sim.step() CALL',
        perm === L_PERM,
        `word0=0x${cr6w0.toString(16).toUpperCase()}, perm=0x${perm.toString(16).toUpperCase()}, expected L=0x${L_PERM.toString(16).toUpperCase()}`);

    assert('E2E-NOT-E: CR6 does NOT have E-perm after sim.step() CALL',
        perm !== E_PERM,
        `word0=0x${cr6w0.toString(16).toUpperCase()} — must be L not E (hardware: call.py perm=0b001)`);

    assert('E2E-SLOT: CR6 GT slot_id references the callee NS slot',
        (cr6w0 & 0xFFFF) === CALLEE_SLOT,
        `got ${cr6w0 & 0xFFFF}, expected ${CALLEE_SLOT}`);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
