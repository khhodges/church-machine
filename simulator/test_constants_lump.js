'use strict';
// test_constants_lump.js — Runtime test for Constants lump (token 00001200)
//
// Loads the Constants lump binary and calls each of the 5 read-only methods
// (Pi, E, Phi, Zero, One) in the simulator, asserting the IEEE-754 value
// DREAD computes for DR0 matches the bit pattern baked into the lump at data
// offsets 19–23.
//
// Architecture note — DR0 is the hardwired zero register:
//   After every instruction step(), the simulator unconditionally clears DR0
//   to enforce the "zero register" convention.  The Constants methods write
//   the constant to DR0 via DREAD, but that write is zeroed before the caller
//   sees it.  The test intercepts the _writeDR call that DREAD makes (before
//   step() zeroes it) to verify the correct IEEE-754 bit pattern was read from
//   the data region.  This validates:
//     1. The c-list is correctly wired (LOAD succeeds → CR0.word1 = data base).
//     2. The data region holds the right IEEE-754 constants at offsets 0–4.
//     3. The DREAD offset indexing (indexed via DR{N} = N) is correctly encoded.
//     4. No fault is triggered at any step (LOAD, DREAD, RETURN).
//
// ISA structure of each method (3 instructions each, method at code offset M):
//   word[M+0]  LOAD  AL CR0, CR6, 0     — load data-R cap from c-list[0] into CR0
//   word[M+1]  DREAD AL DR0, CR0, imm   — indexed read: offset = dr[imm & 0xF]
//   word[M+2]  RETURN AL                — return to caller
//
// DREAD indexed-mode decoding (imm & 0x4000 == 0):
//   dreadBase = (imm >> 4) & 0x3FF   (0 for all Constants methods)
//   dreadDRx  = imm & 0xF            (index register: DR0, DR1, DR2, DR3, DR4)
//   offset    = dreadBase + dr[dreadDRx]
//
//   Pi:   imm=0 → offset = DR0 = 0 (already 0)    reads data[0] = Pi
//   E:    imm=1 → offset = DR1 = 1 (pre-set)       reads data[1] = E
//   Phi:  imm=2 → offset = DR2 = 2 (pre-set)       reads data[2] = Phi
//   Zero: imm=3 → offset = DR3 = 3 (pre-set)       reads data[3] = 0.0
//   One:  imm=4 → offset = DR4 = 4 (pre-set)       reads data[4] = 1.0
//
// Coverage:
//   CONST-SETUP-1..11  File exists; header cw=23, cc=2; raw data word checks.
//   CONST-01a/b        Pi()   — no fault; DREAD computes DR0 = 0x40490FDB.
//   CONST-02a/b        E()    — no fault; DREAD computes DR0 = 0x402DF854.
//   CONST-03a/b        Phi()  — no fault; DREAD computes DR0 = 0x3FCF1BBD.
//   CONST-04a/b        Zero() — no fault; DREAD computes DR0 = 0x00000000.
//   CONST-05a/b        One()  — no fault; DREAD computes DR0 = 0x3F800000.
//
// Run:  node simulator/test_constants_lump.js

const fs   = require('fs');
const path = require('path');
const ChurchSimulator = require('./simulator.js');

function writeTestNsEntry(sim, ...args) {
    const bootComplete = sim.bootComplete;
    sim.bootComplete = false;
    try {
        return sim.writeNSEntry(...args);
    } finally {
        sim.bootComplete = bootComplete;
    }
}

let pass = 0;
let fail = 0;

function check(label, cond, detail) {
    if (cond) {
        console.log('PASS ' + label);
        pass++;
    } else {
        console.log('FAIL ' + label + (detail ? ' — ' + detail : ''));
        fail++;
    }
}

// ── Constants ─────────────────────────────────────────────────────────────────
const LUMP_PATH = path.join(__dirname, '..', 'server', 'lumps', 'Constants.1.e494696f.lump');

// NS slot assignments for the test harness
const CONSTANTS_NS_SLOT = 9;   // Constants abstraction (code + c-list)
const DATA_NS_SLOT      = 10;  // self-data-R capability (points to data words 19–23)
const THREAD_NS_SLOT    = 15;  // dummy thread lump (needed by DREAD + RETURN cleanup)

// Memory layout within the simulator
const EXTENDED_BASE = 0x0400;  // Constants lump base (matches loadLumpBinary target)
const DATA_OFFSET   = 19;      // word index of first data word (Pi) within the lump
const THREAD_BASE   = 0x1000;  // dummy thread lump base
const THREAD_LIMIT  = 512;     // covers caps zone (offset 244–255) and DR zone (1–16)

// Expected IEEE-754 single-precision bit patterns — taken from the raw binary,
// not the manifest description (the manifest comment for E has a minor typo).
const EXPECTED = {
    Pi:   0x40490FDB >>> 0,   // π ≈ 3.14159265
    E:    0x402DF854 >>> 0,   // e ≈ 2.71828183 (Euler's number)
    Phi:  0x3FCF1BBD >>> 0,   // φ ≈ 1.61803398
    Zero: 0x00000000 >>> 0,   // 0.0
    One:  0x3F800000 >>> 0,   // 1.0
};

// ── Helper: read a .lump binary as big-endian uint32 words ────────────────────
// Matches the format served by Flask /api/lump/<token>/words.
function readLumpFile(filePath) {
    const buf = fs.readFileSync(filePath);
    const n   = buf.length >> 2;
    const w   = [];
    for (let i = 0; i < n; i++) w.push(buf.readUInt32BE(i * 4));
    return w;
}

// ── Helper: set up a fully-wired simulator for Constants lump execution ────────
//
// Memory layout:
//   [0x0400..0x043F]  64-word Constants lump (header + code + zeros + data + c-list)
//   [0x043E]          c-list[0]: R-perm GT → DATA_NS_SLOT (data region base = 0x0413)
//
// NS entries:
//   Slot 9  (CONSTANTS_NS_SLOT) — code entry: location=0x0400, limit=cw=23, cc=2
//   Slot 10 (DATA_NS_SLOT)      — data entry: location=0x0413, limit=4 (5 words)
//   Slot 15 (THREAD_NS_SLOT)    — thread:    location=0x1000, limit=512
//
// CR state:
//   CR14  R+X code cap for slot 9  — instruction fetch
//   CR6   L-perm cap for slot 9    — LOAD reads c-list via CR6
//   CR12  R+W thread cap for slot 15 — non-null word1 satisfies DREAD null-check;
//                                       valid GT satisfies _clearCR/_threadWrite
//   CR15  null (no M-window)
//
// After LOAD CR0, CR6, 0:
//   CR0.word0 = R-perm GT for DATA_NS_SLOT
//   CR0.word1 = DATA_LOC = 0x0413  (data region base)
//
// After DREAD DR0, CR0, imm (indexed mode: offset = dr[imm & 0xF]):
//   DREAD reads memory[0x0413 + offset] = data word[offset]
//   DREAD calls _writeDR(0, constant) — the value we intercept
//   step() then calls _writeDR(0, 0) — DR0 zeroed (hardwired zero convention)
function setupSim(rawWords) {
    const sim = new ChurchSimulator();
    sim.bootComplete = true;

    // 1. Load the 64-word Constants binary into memory at EXTENDED_BASE
    for (let i = 0; i < rawWords.length; i++) {
        sim.memory[EXTENDED_BASE + i] = rawWords[i] >>> 0;
    }

    const hdr        = sim.parseLumpHeader(rawWords[0]);
    const CLIST_BASE = (EXTENDED_BASE + hdr.lumpSize - hdr.cc) >>> 0;  // 0x043E
    const DATA_LOC   = (EXTENDED_BASE + DATA_OFFSET) >>> 0;              // 0x0413

    // 2. NS entry — Constants code (slot 9)
    //    location=EXTENDED_BASE, limit=cw=23, Inform type, cc in clistCount field
    writeTestNsEntry(sim, CONSTANTS_NS_SLOT, EXTENDED_BASE, hdr.cw, 0, 0, 1, 0, hdr.cc, 0);

    // 3. NS entry — Constants data region (slot 10)
    //    location=DATA_LOC=0x0413, limit=4 (upper bound = 0x0417, covers offsets 0..4)
    writeTestNsEntry(sim, DATA_NS_SLOT, DATA_LOC, 4, 0, 0, 1, 0, 0, 0);

    // 4. NS entry — dummy thread lump (slot 15)
    //    Covers DR zone (threadBase+1..+16) and caps zone (threadBase+244..+255).
    writeTestNsEntry(sim, THREAD_NS_SLOT, THREAD_BASE, THREAD_LIMIT, 0, 0, 1, 0, 0, 0);

    // 5. CR14 = R+X code cap for Constants (instruction fetch)
    const codeGT    = sim.createGT(0, CONSTANTS_NS_SLOT, {R: 1, X: 1}, 1);
    const codeEntry = sim.readNSEntry(CONSTANTS_NS_SLOT);
    sim.cr[14] = {
        word0: codeGT,
        word1: EXTENDED_BASE,
        word2: codeEntry ? codeEntry.word1_limit : 0,
        word3: 0,
        m: 0,
    };

    // 6. CR6 = L-perm c-list cap for Constants
    //    word1 = CLIST_BASE (c-list base address in memory)
    //    word2 = packed NS word1 encoding clistCount=cc=2 (used by LOAD when crSrc===6
    //            to determine the c-list size for the range override)
    const clistGT = sim.createGT(0, CONSTANTS_NS_SLOT, {L: 1}, 1);
    sim.cr[6] = {
        word0: clistGT,
        word1: CLIST_BASE,
        word2: sim.packNSWord1(hdr.cw, 0, 0, 0, hdr.cc),
        word3: 0,
        m: 0,
    };

    // 7. c-list[0] = R-perm GT for the data NS slot
    //    LOAD CR0, CR6, 0 reads memory[CLIST_BASE + 0] and installs it into CR0.
    //    _writeCR sets CR0.word1 = DATA_NS_SLOT entry.word0_location = DATA_LOC = 0x0413.
    const dataGT = sim.createGT(0, DATA_NS_SLOT, {R: 1}, 1);
    sim.memory[CLIST_BASE + 0] = dataGT >>> 0;

    // 8. CR12 = R+W thread cap for the dummy thread lump
    //    DREAD requires cr12.word1 != 0 to pass its null-check.
    //    _clearCR / _threadWrite call mLoad(cr12.word0, ...) during RETURN cleanup —
    //    the thread NS entry (slot 15) covers the relevant address range.
    const threadGT = sim.createGT(0, THREAD_NS_SLOT, {R: 1, W: 1}, 1);
    sim.cr[12] = {
        word0: threadGT,
        word1: THREAD_BASE,
        word2: 0,
        word3: 0,
        m: 0,
    };

    // 9. CR15 = null (no M-window; _mwinWriteback is a no-op)
    sim.cr[15] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };

    return { sim, CLIST_BASE, DATA_LOC };
}

// ── Helper: call one Constants method and return the result ────────────────────
//   methodOffset — word offset of the method's first instruction in the code section
//                  (0=Pi, 3=E, 6=Phi, 9=Zero, 12=One)
//   drPreset     — { drIdx: value } — DRs to pre-set before execution
//                  DREAD uses indexed mode: offset = dr[imm & 0xF], so each method
//                  requires its index register pre-set to the data slot index:
//                  Pi:dr{0}=0, E:dr{1}=1, Phi:dr{2}=2, Zero:dr{3}=3, One:dr{4}=4
//
// Execution sequence: 3 steps — LOAD, DREAD, RETURN.
//
// DR0 interception:
//   step() zeroes DR0 after every instruction (hardwired-zero convention).
//   We intercept _writeDR to capture the value that the DREAD instruction writes
//   to DR0 during step 2, before step() zeroes it.  The interception uses a flag
//   (captureActive) that is set only during the DREAD step so that step 1 LOAD's
//   zeroing is not accidentally captured.  The first _writeDR(0, …) call while
//   captureActive is true is the DREAD result; the second is step()'s zeroing.
//
// Returns { dreadDR0, ok, faultMsg }
//   dreadDR0  — value that DREAD computed for DR0 (before hardwired-zero cleared it)
//   ok        — true if no fault occurred and the simulator did not halt
//   faultMsg  — fault description string if ok=false, null otherwise
function runMethod(rawWords, methodOffset, drPreset) {
    const { sim } = setupSim(rawWords);

    // Zero all DRs; then apply per-method pre-set values
    sim.dr.fill(0);
    if (drPreset) {
        for (const drIdx of Object.keys(drPreset)) {
            sim.dr[parseInt(drIdx, 10)] = drPreset[drIdx] >>> 0;
        }
    }

    // Push a non-sentinel CALL frame so RETURN can pop it cleanly.
    // savedDRs=null → RETURN does not restore the caller's DRs.
    sim.callStack.push({
        sentinel:   false,
        sz:         1,
        returnPC:   0,
        savedCRs:   null,
        savedDRs:   null,
        savedFlags: null,
    });

    sim.pc     = methodOffset;
    sim.halted = false;

    // Intercept _writeDR to capture the DREAD result for DR0.
    // captureActive is set only while step 2 (DREAD) is in progress so that
    // the step-1 LOAD's post-instruction zeroing of DR0 is not captured.
    let captureActive = false;
    let dreadWrites   = [];  // all DR0 writes during the DREAD step
    const origWriteDR = sim._writeDR.bind(sim);
    sim._writeDR = function (drIdx, value) {
        if (captureActive && drIdx === 0) {
            dreadWrites.push(value >>> 0);
        }
        origWriteDR(drIdx, value);
    };

    let faultMsg = null;

    // Step 1: LOAD CR0, CR6, 0
    sim.step();
    if (sim.faultLog && sim.faultLog.length > 0) {
        const f = sim.faultLog[sim.faultLog.length - 1];
        faultMsg = `[LOAD] [${f.type}] ${f.message}`;
    } else if (sim.halted) {
        faultMsg = '[LOAD] simulator halted unexpectedly';
    }

    // Step 2: DREAD DR0, CR0, imm
    if (!faultMsg) {
        captureActive = true;
        sim.step();
        captureActive = false;
        if (sim.faultLog && sim.faultLog.length > 0) {
            const f = sim.faultLog[sim.faultLog.length - 1];
            faultMsg = `[DREAD] [${f.type}] ${f.message}`;
        } else if (sim.halted) {
            faultMsg = '[DREAD] simulator halted unexpectedly';
        }
    }

    // Step 3: RETURN AL
    if (!faultMsg) {
        sim.step();
        if (sim.faultLog && sim.faultLog.length > 0) {
            const f = sim.faultLog[sim.faultLog.length - 1];
            faultMsg = `[RETURN] [${f.type}] ${f.message}`;
        } else if (sim.halted) {
            faultMsg = '[RETURN] simulator halted unexpectedly';
        }
    }

    // dreadWrites[0] = value DREAD computed for DR0 (the IEEE-754 constant)
    // dreadWrites[1] = 0 (step()'s unconditional DR0 zero-clear, if it fired)
    const dreadDR0 = dreadWrites.length > 0 ? dreadWrites[0] : null;

    return {
        dreadDR0,
        ok:       faultMsg === null,
        faultMsg: faultMsg,
    };
}

// ── CONST-SETUP: Verify lump file and binary header ───────────────────────────
console.log('\n--- CONST-SETUP: Verify Constants lump binary ---');

const lumpExists = fs.existsSync(LUMP_PATH);
check('CONST-SETUP-1: Constants.1.e494696f.lump exists', lumpExists, LUMP_PATH);

let rawWords = null;
if (lumpExists) {
    rawWords = readLumpFile(LUMP_PATH);
    check('CONST-SETUP-2: lump is 64 words (256 bytes)',
        rawWords.length === 64, `got ${rawWords.length}`);

    const sim0 = new ChurchSimulator();
    const hdr  = sim0.parseLumpHeader(rawWords[0]);

    check('CONST-SETUP-3: header magic = 0x1F (valid LUMP)',
        hdr.valid, `magic=0x${hdr.magic.toString(16)}`);
    check('CONST-SETUP-4: header cw = 23',
        hdr.cw === 23, `got cw=${hdr.cw}`);
    check('CONST-SETUP-5: header cc = 2 (self-data-R + spare)',
        hdr.cc === 2, `got cc=${hdr.cc}`);
    check('CONST-SETUP-6: header lumpSize = 64',
        hdr.lumpSize === 64, `got lumpSize=${hdr.lumpSize}`);

    // Verify raw data words at offsets 19–23 match expected IEEE-754 bit patterns.
    // These are the values the DREAD instructions in each method read at runtime.
    const w19 = rawWords[19] >>> 0;
    const w20 = rawWords[20] >>> 0;
    const w21 = rawWords[21] >>> 0;
    const w22 = rawWords[22] >>> 0;
    const w23 = rawWords[23] >>> 0;

    check('CONST-SETUP-7: word[19] = Pi   (0x40490FDB = π ≈ 3.14159265)',
        w19 === EXPECTED.Pi,
        `got 0x${w19.toString(16).padStart(8, '0')}`);
    check('CONST-SETUP-8: word[20] = E    (0x402DF854 = e ≈ 2.71828183)',
        w20 === EXPECTED.E,
        `got 0x${w20.toString(16).padStart(8, '0')}`);
    check('CONST-SETUP-9: word[21] = Phi  (0x3FCF1BBD = φ ≈ 1.61803398)',
        w21 === EXPECTED.Phi,
        `got 0x${w21.toString(16).padStart(8, '0')}`);
    check('CONST-SETUP-10: word[22] = Zero (0x00000000 = 0.0)',
        w22 === EXPECTED.Zero,
        `got 0x${w22.toString(16).padStart(8, '0')}`);
    check('CONST-SETUP-11: word[23] = One  (0x3F800000 = 1.0)',
        w23 === EXPECTED.One,
        `got 0x${w23.toString(16).padStart(8, '0')}`);
}

// ── CONST-01..05: Method execution tests ─────────────────────────────────────
//
// For each method:
//   a) verify no fault occurs during LOAD → DREAD → RETURN
//   b) verify the value that DREAD writes to DR0 (before step() zeroes it)
//      matches the expected IEEE-754 constant from the data region
//
// DREAD indexed-mode offset per method:
//   Pi:   imm=0 → dreadDRx=DR0=0 → data[0] = Pi
//   E:    imm=1 → dreadDRx=DR1   → data[1] = E     (pre-set DR1=1)
//   Phi:  imm=2 → dreadDRx=DR2   → data[2] = Phi   (pre-set DR2=2)
//   Zero: imm=3 → dreadDRx=DR3   → data[3] = Zero  (pre-set DR3=3)
//   One:  imm=4 → dreadDRx=DR4   → data[4] = One   (pre-set DR4=4)
if (rawWords) {
    const methods = [
        { id: '01', name: 'Pi',   offset: 0,  drPreset: { 0: 0 }, expected: EXPECTED.Pi   },
        { id: '02', name: 'E',    offset: 3,  drPreset: { 1: 1 }, expected: EXPECTED.E    },
        { id: '03', name: 'Phi',  offset: 6,  drPreset: { 2: 2 }, expected: EXPECTED.Phi  },
        { id: '04', name: 'Zero', offset: 9,  drPreset: { 3: 3 }, expected: EXPECTED.Zero },
        { id: '05', name: 'One',  offset: 12, drPreset: { 4: 4 }, expected: EXPECTED.One  },
    ];

    for (const m of methods) {
        console.log(`\n--- CONST-${m.id}: Constants.${m.name}() ---`);
        const r = runMethod(rawWords, m.offset, m.drPreset);

        check(
            `CONST-${m.id}a: ${m.name}() executes without fault (LOAD → DREAD → RETURN)`,
            r.ok,
            r.faultMsg || ''
        );
        check(
            `CONST-${m.id}b: ${m.name}() DREAD computes correct IEEE-754 value` +
            ` (expected 0x${m.expected.toString(16).padStart(8, '0')})`,
            r.dreadDR0 === m.expected,
            r.dreadDR0 !== null
                ? `got 0x${r.dreadDR0.toString(16).padStart(8, '0')}`
                : 'DREAD did not write to DR0 (dreadDR0 = null)'
        );
    }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\nTotal: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
