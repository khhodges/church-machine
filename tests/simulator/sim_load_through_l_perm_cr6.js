// sim_load_through_l_perm_cr6.js — Confirm LOAD through an L-perm CR6 never
// produces a PERMISSION fault.
//
// Background:
//   CALL delivers an L-perm GT (perm[0]=L, perm[2:0]=0b001) to CR6 — the
//   c-list root register.  The LOAD instruction fetches capabilities from the
//   c-list via mLoad.  The mLoad permission gate is intentionally bypassed for
//   CR6 (simulator.js _execLoad line: `d.crSrc === 6 ? null : 'L'`), so no
//   E-perm check fires regardless of what perm the CR6 GT carries.
//
//   Without this guard an L-perm CR6 (the normal post-CALL state) would cause
//   every subsequent LOAD from the c-list to fault with PERMISSION, making the
//   abstraction completely uncallable.
//
// GT word layout (v2.0):
//   [31]    = b_flag
//   [30:28] = perm[2:0]  (Church: [2]=E [1]=S [0]=L)
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
// CR6 word layout used by _execLoad:
//   word0 = GT for the c-list (L-perm, Church domain)
//   word1 = c-list base address (memory word index)
//   word2 = NS word1-style packed field; _execLoad reads clistCount from it
//           clistCount = (word2 >>> 17) & 0x1FF
//
// Test phases:
//
//   PHASE PM — perm-mask sanity:
//     Verify L_PERM/E_PERM constants and createGT encoding before using them.
//
//   PHASE 1 — direct _execLoad, imm=0:
//     CR6 = L-perm GT; c-list slot 0 holds a valid E-perm GT for a different NS
//     slot.  Calls _execLoad({crSrc:6, crDst:1, imm:0}) directly.
//     Asserts: no PERMISSION fault, result !== null, CR1 holds the loaded GT.
//
//   PHASE 2 — direct _execLoad, imm=1 (non-zero offset):
//     Same setup; c-list has 4 slots; slot 1 carries the target GT.
//     Guards that the range check also passes at a non-zero offset.
//
//   PHASE E2E — full fetch/decode/execute via sim.step():
//     Places a LOAD instruction (opcode=0) in caller-lump memory.
//     CR14 points at the caller lump (RX-perm).  CR6 = L-perm GT with a
//     populated c-list.  Calls sim.step() and asserts no fault + CR1 loaded.

'use strict';

global.window = {};  // silence bootConfig references in the constructor

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
const L_PERM   = 0x10000000;   // perm[0]=L → bits[30:28] = 0b001
const E_PERM   = 0x40000000;   // perm[2]=E → bits[30:28] = 0b100

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

function makeSim() {
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

// Intercept faults; return the faults array.
function installFaultCapture(sim) {
    const faults = [];
    const orig = sim.fault.bind(sim);
    sim.fault = (type, msg, extra) => { faults.push({ type, message: msg }); orig(type, msg, extra); };
    return faults;
}

// Encode clistCount into the CR6.word2 field that _execLoad parses via
// parseNSWord1: clistCount = (word2 >>> 17) & 0x1FF.
function encodeClistCount(count) {
    return (count << 17) >>> 0;
}

// Write a lump header to memory[base].  Matches writeLumpHdr in the model test.
function writeLumpHdr(sim, base, cc, cw) {
    const hdr = ((0x1F << 27) | (0 << 23) | (cw << 10) | (0 << 8) | cc) >>> 0;
    sim.memory[base] = hdr;
}

// ── PHASE PM: perm-mask sanity ────────────────────────────────────────────────
console.log('\n--- PHASE PM: perm-mask sanity ---');
{
    const sim = makeSim();
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

// ── PHASE 1: _execLoad with L-perm CR6, imm=0 ────────────────────────────────
//
// CR6.word0 = L-perm GT for NS slot CR6_SLOT.
// C-list at CLIST_BASE; slot 0 holds an E-perm GT for NS slot TARGET_SLOT.
// _execLoad reads memory[CLIST_BASE + 0], validates, and writes it to CR1.
//
console.log('\n--- PHASE 1: _execLoad with L-perm CR6, imm=0 ---');
{
    const CR6_SLOT    = 20;   // NS slot for CR6's own GT
    const TARGET_SLOT = 21;   // NS slot for the GT stored in the c-list
    const CLIST_BASE  = 0x0200;
    const CLIST_COUNT = 4;

    const sim = makeSim();
    const faults = installFaultCapture(sim);

    // NS entries: both need valid seals so mLoad's validateMAC passes.
    writeTestNsEntry(sim, CR6_SLOT,    CLIST_BASE, 63, 0, 0, 1, 0, CLIST_COUNT, 0);
    writeTestNsEntry(sim, TARGET_SLOT, 0x0300,     63, 0, 0, 1, 0, 0, 0);

    // CR6 = L-perm GT (gt_seq=0 matches the NS entry written with version=0).
    const cr6GT = sim.createGT(0, CR6_SLOT, {L:1}, 1);
    sim.cr[6] = {
        word0: cr6GT,
        word1: CLIST_BASE,
        word2: encodeClistCount(CLIST_COUNT),
        word3: 0,
        m: 0,
    };

    // C-list slot 0: a valid E-perm Church GT for TARGET_SLOT.
    const targetGT = sim.createGT(0, TARGET_SLOT, {E:1}, 1);
    sim.memory[CLIST_BASE + 0] = targetGT >>> 0;

    // CR12.word1=0 → _writeCR skips thread-home write (threadBase is falsy).
    sim.cr[12] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };

    const cr6Perm = cr6GT & PERM_MASK;
    assert('P1-SETUP: CR6 GT has L-perm before LOAD',
        cr6Perm === L_PERM,
        `perm=0x${cr6Perm.toString(16).toUpperCase()}`);

    const result = sim._execLoad({ crSrc: 6, crDst: 1, imm: 0, cond: 14, raw: 0 });

    const permFaults = faults.filter(f => f.type === 'PERMISSION');
    assert('P1-NO-PERM-FAULT: LOAD through L-perm CR6 did not produce a PERMISSION fault',
        permFaults.length === 0,
        permFaults.map(f => f.message).join('; ') || 'ok');

    assert('P1-SUCCESS: _execLoad returned a non-null result',
        result !== null,
        faults.map(f => `[${f.type}] ${f.message}`).join('; ') || 'result was null');

    if (result) {
        const cr1w0 = sim.cr[1].word0 >>> 0;
        assert('P1-LOADED: CR1 holds the target GT after LOAD',
            cr1w0 === (targetGT >>> 0),
            `CR1.word0=0x${cr1w0.toString(16).toUpperCase()}, expected=0x${(targetGT >>> 0).toString(16).toUpperCase()}`);
    }
}

// ── PHASE 2: _execLoad with L-perm CR6, imm=1 (non-zero offset) ──────────────
//
// Same structure as Phase 1 but the target GT sits at c-list slot 1 (imm=1).
// Guards that the rangeOverride calculation also passes at a non-zero offset:
//   absAddr = CLIST_BASE + 1
//   clistRange = { base: CLIST_BASE, upperBound: CLIST_BASE + CLIST_COUNT - 1 }
//   CLIST_BASE + 1 is within that range when CLIST_COUNT >= 2.
//
console.log('\n--- PHASE 2: _execLoad with L-perm CR6, imm=1 ---');
{
    const CR6_SLOT    = 22;
    const TARGET_SLOT = 23;
    const CLIST_BASE  = 0x0280;
    const CLIST_COUNT = 4;

    const sim = makeSim();
    const faults = installFaultCapture(sim);

    writeTestNsEntry(sim, CR6_SLOT,    CLIST_BASE, 63, 0, 0, 1, 0, CLIST_COUNT, 0);
    writeTestNsEntry(sim, TARGET_SLOT, 0x0380,     63, 0, 0, 1, 0, 0, 0);

    const cr6GT = sim.createGT(0, CR6_SLOT, {L:1}, 1);
    sim.cr[6] = {
        word0: cr6GT,
        word1: CLIST_BASE,
        word2: encodeClistCount(CLIST_COUNT),
        word3: 0,
        m: 0,
    };

    // Slot 0 is null/zero; slot 1 holds the target GT.
    sim.memory[CLIST_BASE + 0] = 0;
    const targetGT = sim.createGT(0, TARGET_SLOT, {E:1}, 1);
    sim.memory[CLIST_BASE + 1] = targetGT >>> 0;

    sim.cr[12] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };

    const result = sim._execLoad({ crSrc: 6, crDst: 2, imm: 1, cond: 14, raw: 0 });

    const permFaults = faults.filter(f => f.type === 'PERMISSION');
    assert('P2-NO-PERM-FAULT: LOAD at imm=1 through L-perm CR6 did not produce a PERMISSION fault',
        permFaults.length === 0,
        permFaults.map(f => f.message).join('; ') || 'ok');

    assert('P2-SUCCESS: _execLoad(imm=1) returned a non-null result',
        result !== null,
        faults.map(f => `[${f.type}] ${f.message}`).join('; ') || 'result was null');

    if (result) {
        const cr2w0 = sim.cr[2].word0 >>> 0;
        assert('P2-LOADED: CR2 holds the target GT after LOAD at imm=1',
            cr2w0 === (targetGT >>> 0),
            `CR2.word0=0x${cr2w0.toString(16).toUpperCase()}, expected=0x${(targetGT >>> 0).toString(16).toUpperCase()}`);
    }
}

// ── PHASE E2E: full fetch / decode / execute via sim.step() ───────────────────
//
// Two abstractions:
//   Caller (slot 5, at CALLER_BASE): lump with a LOAD instruction at code word 0.
//     Encoding: opcode=0, cond=14(AL), crDst=1, crSrc=6, imm=0
//     → (0<<27)|(14<<23)|(1<<19)|(6<<15)|0 = 0x07000000|0x00080000|0x00030000
//              = encodeInstruction(0, 14, 1, 6, 0)
//   C-list lump (slot 25, at CLIST_BASE): the GT stored in the c-list at slot 0.
//
// CR14 = RX-perm GT for caller lump (so _fetchInstruction passes its X-check).
// CR6  = L-perm GT pointing at the c-list.
// PC   = 0.
//
// Expected path:
//   _fetchInstruction() reads memory[CALLER_BASE + 1 + 0]  → LOAD opcode word
//   decodeInstruction() → { opcode:0, crDst:1, crSrc:6, imm:0 }
//   step() dispatches to _execLoad(d)
//   _execLoad: crSrc===6 → mLoad(cr6GT, null, 6, ...) — PERMISSION bypass
//   No PERMISSION fault; CR1 receives the c-list GT.
//
console.log('\n--- PHASE E2E: full fetch/decode/execute via sim.step() ---');
{
    const CALLER_SLOT  = 5;
    const CALLER_BASE  = 0x0400;
    const CALLER_CC    = 2;
    const CALLER_CW    = 4;   // enough for 1 code word

    const CR6_SLOT     = 30;
    const CLIST_BASE   = 0x0500;
    const CLIST_COUNT  = 4;

    const TARGET_SLOT  = 31;
    const TARGET_BASE  = 0x0600;

    const sim = makeSim();
    const faults = installFaultCapture(sim);

    // ── Write caller lump into memory ─────────────────────────────────────────
    writeLumpHdr(sim, CALLER_BASE, CALLER_CC, CALLER_CW);
    // LOAD instruction: opcode=0, cond=14(AL), crDst=1, crSrc=6, imm=0.
    const LOAD_WORD = sim.encodeInstruction(0, 14, 1, 6, 0);
    sim.memory[CALLER_BASE + 1] = LOAD_WORD;  // code word 0 (PC=0)

    // ── NS entries ───────────────────────────────────────────────────────────
    writeTestNsEntry(sim, CALLER_SLOT, CALLER_BASE, 63, 0, 0, 1, 0, CALLER_CC, 0);
    writeTestNsEntry(sim, CR6_SLOT,   CLIST_BASE,  63, 0, 0, 1, 0, CLIST_COUNT, 0);
    writeTestNsEntry(sim, TARGET_SLOT, TARGET_BASE, 63, 0, 0, 1, 0, 0, 0);

    // ── CR14: code register for caller lump (RX-perm) ────────────────────────
    const cr14GT = sim.createGT(0, CALLER_SLOT, {R:1, X:1}, 1);  // Turing RX, type=1 (Inform)
    sim.cr[14] = {
        word0: cr14GT,
        word1: CALLER_BASE,   // fetchAddr = CALLER_BASE + 1 + pc (pc=0)
        word2: 0,
        word3: 0,
        m: 0,
    };

    // ── CR6: L-perm GT pointing at the c-list ────────────────────────────────
    const cr6GT = sim.createGT(0, CR6_SLOT, {L:1}, 1);  // Church L
    sim.cr[6] = {
        word0: cr6GT,
        word1: CLIST_BASE,
        word2: encodeClistCount(CLIST_COUNT),
        word3: 0,
        m: 0,
    };

    // ── C-list slot 0: E-perm GT for TARGET_SLOT ─────────────────────────────
    const targetGT = sim.createGT(0, TARGET_SLOT, {E:1}, 1);
    sim.memory[CLIST_BASE + 0] = targetGT >>> 0;

    // CR12.word1=0 → _writeCR skips thread-home frame write.
    sim.cr[12] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };

    // ── Confirm setup ─────────────────────────────────────────────────────────
    const fetchAddr = CALLER_BASE + 1 + 0;
    assert('E2E-SETUP: LOAD opcode word is at fetchAddr in memory',
        sim.memory[fetchAddr] === LOAD_WORD,
        `mem[0x${fetchAddr.toString(16)}]=0x${(sim.memory[fetchAddr]||0).toString(16).toUpperCase()}, expected=0x${LOAD_WORD.toString(16).toUpperCase()}`);

    assert('E2E-SETUP-CR6: CR6 has L-perm before step()',
        (cr6GT & PERM_MASK) === L_PERM,
        `perm=0x${(cr6GT & PERM_MASK).toString(16).toUpperCase()}`);

    // ── Execute ───────────────────────────────────────────────────────────────
    sim.pc = 0;
    const result = sim.step();

    const permFaults = faults.filter(f => f.type === 'PERMISSION');
    assert('E2E-NO-PERM-FAULT: sim.step() LOAD through L-perm CR6 did not produce a PERMISSION fault',
        permFaults.length === 0,
        permFaults.map(f => f.message).join('; ') || 'ok');

    assert('E2E-NO-FAULT: sim.step() produced no fault at all',
        faults.length === 0 && result !== null,
        faults.map(f => `[${f.type}] ${f.message}`).join('; ') || 'result was null');

    if (result) {
        assert('E2E-OPCODE: step() dispatched opcode=0 (LOAD)',
            result.instr && result.instr.opcode === 0,
            `instr=${JSON.stringify(result.instr)}`);
    }

    const cr1w0 = sim.cr[1].word0 >>> 0;
    assert('E2E-LOADED: CR1 holds the c-list target GT after LOAD via sim.step()',
        cr1w0 === (targetGT >>> 0),
        `CR1.word0=0x${cr1w0.toString(16).toUpperCase()}, expected=0x${(targetGT>>>0).toString(16).toUpperCase()}`);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
