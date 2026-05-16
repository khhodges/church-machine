'use strict';
// test_lump_roundtrip.js — Round-trip regression test for LUMP header encoding
// Task #1144
//
// Exercises the full  assembler → binary → loadProgram → step()  chain.
// Unlike test_catalog_lump.js (which manually sets memory and calls
// _fetchInstruction() directly), this test:
//   1. Assembles a multi-method LUMP using the same pure logic as
//      _assembleLumpFromCatalog (without DOM dependencies).
//   2. Loads it into a fully-booted ChurchSimulator via sim.loadProgram().
//   3. Places CALL instructions in the lump and calls sim.step() so the
//      full instruction-fetch → decode → _execCall → method-table dispatch
//      path is exercised.
//   4. Verifies that pc and _fetchInstruction() agree with the expected
//      body offsets computed from the assembled BRANCH table.
//
// Run:  node simulator/test_lump_roundtrip.js
//
// Coverage:
//   T-RT01 — 1-method LUMP: step(CALL m=1) → pc=1 → body sentinel fetched
//   T-RT02 — 3-method LUMP: step(CALL m=1) → pc=bodyOffset0 → SENTINEL0
//   T-RT03 — 3-method LUMP: step(CALL m=2) → pc=bodyOffset1 → SENTINEL1
//   T-RT04 — 3-method LUMP: step(CALL m=3) → pc=bodyOffset2 → SENTINEL2
//   T-RT05 — 4-method, variable-length bodies: step() for each method
//   T-RT06 — Regression gate: bare-address format (legacy) NOT accepted for
//             a freshly assembled LUMP (method table must use BRANCH opcode)

const fs   = require('fs');
const path = require('path');
const ChurchSimulator = require('./simulator.js');
const { assembleLump, BRANCH_OPCODE } = require('./lump_assembler.js');

// Load lump-audit.js (browser module — no module.exports) via Function shim
const _auditSrc = fs.readFileSync(path.join(__dirname, 'lump-audit.js'), 'utf8');
const _auditMod = new Function(_auditSrc + '\nreturn { lumpAudit, lumpAuditHasErrors };')();
const lumpAudit          = _auditMod.lumpAudit;
const lumpAuditHasErrors = _auditMod.lumpAuditHasErrors;

// ── Constants ─────────────────────────────────────────────────────────────────
const CALL_OPCODE   = 2;
const LUMP_SLOT     = 3;    // Boot.Abstr NS slot (same as simulator default)
const LUMP_BASE     = 0x80; // arbitrary physical base for tests

// ── Encode a CALL instruction targeting CR0 with a given method index ─────────
// CALL_AL CR0, imm=methodIndex  (cond=14=AL=Always, crDst=0, crSrc=0)
// cond=0 is EQ (execute only when Z flag set); AL (0xE) is unconditional.
const COND_AL = 14;
function callInstr(methodIndex) {
    return ((CALL_OPCODE << 27) | (COND_AL << 23) | (0 << 19) | (0 << 15) | (methodIndex & 0x7FFF)) >>> 0;
}

// ── Set up a booted simulator with a lump loaded at LUMP_BASE ─────────────────
// extWords = lump payload words (without header) to pass to loadProgram.
// Returns { sim, lumpBaseActual, bodyOffsets }.
function setupSim(extWords) {
    const sim = new ChurchSimulator();
    sim.bootComplete = true;
    sim.nsCount = Math.max(sim.nsCount, LUMP_SLOT + 1);

    // Seed NS slot 3 with a large enough lump so loadProgram takes the
    // patch-in-place path (not the new-lump path at 0x0400).
    const INIT_CW  = 250;
    const GT_SEQ   = 5;
    const hdrWord  = ((0x1F << 27) | (0 << 23) | (INIT_CW << 10) | 0) >>> 0;
    sim.memory[LUMP_BASE] = hdrWord;

    const nsBase = sim.NS_TABLE_BASE + LUMP_SLOT * sim.NS_ENTRY_WORDS;
    sim.memory[nsBase + 0] = LUMP_BASE;
    sim.memory[nsBase + 1] = sim.packNSWord1(INIT_CW, 0, 0, 0, 0, 0);
    sim.memory[nsBase + 2] = sim.makeVersionSeals(GT_SEQ, LUMP_BASE, INIT_CW);

    // Give CR14 a valid initial RX GT so loadProgram can read/update it.
    const initGT = sim.createGT(GT_SEQ, LUMP_SLOT, {R:1,W:0,X:1,L:0,S:0,E:0}, 1);
    sim.cr[14] = {
        word0: initGT,
        word1: LUMP_BASE,
        word2: sim.memory[nsBase + 1],
        word3: sim.memory[nsBase + 2],
        m: 0
    };

    // Write the lump (patch-in-place: extWords.length <= INIT_CW)
    sim.loadProgram(extWords, 0);

    // Rebuild GT using the gt_seq stamped by loadProgram into NS[3].word2
    const lumpBaseActual = sim.memory[nsBase + 0];
    const gtSeqAfter     = (sim.memory[nsBase + 2] >>> 25) & 0x7F;

    // CR14: RX GT for instruction fetch
    const cr14GT = sim.createGT(gtSeqAfter, LUMP_SLOT, {R:1,W:0,X:1,L:0,S:0,E:0}, 1);
    sim.cr[14] = {
        word0: cr14GT,
        word1: lumpBaseActual,
        word2: sim.memory[nsBase + 1],
        word3: sim.memory[nsBase + 2],
        m: 0
    };

    // CR0: E-permission GT (CALL path requires E; crDst=0 in callInstr())
    const cr0GT = sim.createGT(gtSeqAfter, LUMP_SLOT, {R:0,W:0,X:0,L:0,S:0,E:1}, 1);
    sim.cr[0] = {
        word0: cr0GT,
        word1: lumpBaseActual,
        word2: sim.memory[nsBase + 1],
        word3: sim.memory[nsBase + 2],
        m: 0
    };

    // CR12: zero word0 + zero word1 → callThreadBase = cr[12].word1 = 0 (falsy)
    // → thread-stack writes are skipped inside _execCall without crashing
    // _resetAllMBits (which iterates all 16 CRs and sets .m = 0).
    sim.cr[12] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
    sim.sto = 243;

    return { sim, lumpBaseActual };
}

// ── Test harness ──────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;

function check(label, cond) {
    if (cond) {
        console.log(`PASS ${label}`);
        pass++;
    } else {
        console.log(`FAIL ${label}`);
        fail++;
    }
}

// ── T-RT01: Single-method LUMP — step(CALL m=1) → pc=1 → body sentinel ───────
// N=1: assembleLump([[SENTINEL]]) → BRANCH+1, SENTINEL
// Method-1 dispatch: branchOffset=1, pc = (1-1)+1 = 1 → body at lump_base+2.
// Method-0 shortcut also sets pc=1 (hard-coded, not tested here).
console.log('\n--- T-RT01: Single-method LUMP round-trip ---');
{
    const SENTINEL = 0xCAFEF001 >>> 0;
    const { buf, totalWords, bodyOffsets } = assembleLump([[SENTINEL]]);

    // words without header, plus one CALL m=1 at position 2 (after body)
    const baseWords = Array.from(buf.slice(1, totalWords));
    const extWords  = [...baseWords, callInstr(1)];  // positions: 0=BRANCH+1, 1=SENTINEL, 2=CALL

    const { sim, lumpBaseActual } = setupSim(extWords);

    check('T-RT01a: bodyOffset[0] = 1', bodyOffsets[0] === 1);

    // Fetch the CALL instruction at position 2 (lump-relative PC 2)
    sim.pc = 2;
    sim.step();
    check('T-RT01b: sim not halted after CALL m=1', !sim.halted);
    check('T-RT01c: pc after CALL m=1 = bodyOffset[0]=1', sim.pc === bodyOffsets[0]);

    // Verify _fetchInstruction from the body pc reaches SENTINEL
    const fetch = sim._fetchInstruction();
    check('T-RT01d: _fetchInstruction ok at bodyOffset', fetch.ok === true);
    check('T-RT01e: fetched word = SENTINEL', fetch.ok && fetch.word === SENTINEL);
    check('T-RT01f: physAddr = lumpBase+2 (lump_base+1+bodyOffset[0])',
          fetch.ok && fetch.addr === lumpBaseActual + 1 + bodyOffsets[0]);
}

// ── T-RT02 / T-RT03 / T-RT04: 3-method LUMP — step(CALL m) for m=1,2,3 ──────
// Bodies: [SENTINEL0], [SENTINEL1], [SENTINEL2] (each 1 word)
// assembleLump computes branchOffsets and packs header+table+bodies.
// CALL instructions are appended after the bodies at extWord positions 6,7,8.
console.log('\n--- T-RT02/RT03/RT04: 3-method LUMP round-trip ---');
{
    const SENTINEL0 = 0xDEADF002 >>> 0;
    const SENTINEL1 = 0xDEADF003 >>> 0;
    const SENTINEL2 = 0xDEADF004 >>> 0;
    const bodies    = [[SENTINEL0], [SENTINEL1], [SENTINEL2]];
    const { buf, totalWords, bodyOffsets } = assembleLump(bodies);

    // Append 3 CALL instructions so we can test each method independently
    const baseWords = Array.from(buf.slice(1, totalWords));
    const extWords  = [
        ...baseWords,
        callInstr(1),   // at lump PC N+3 = 6
        callInstr(2),   // at lump PC 7
        callInstr(3),   // at lump PC 8
    ];
    const N = 3;
    const callPC = [N + bodies.reduce((s,b)=>s+b.length,0) + 0,   // = 6
                    N + bodies.reduce((s,b)=>s+b.length,0) + 1,   // = 7
                    N + bodies.reduce((s,b)=>s+b.length,0) + 2];  // = 8

    // T-RT02: CALL method 1
    {
        const { sim, lumpBaseActual } = setupSim(extWords);
        sim.pc = callPC[0];  // = 6
        sim.step();
        check('T-RT02a: sim not halted after CALL m=1', !sim.halted);
        check('T-RT02b: pc after CALL m=1 = bodyOffset[0]', sim.pc === bodyOffsets[0]);
        const fetch = sim._fetchInstruction();
        check('T-RT02c: _fetchInstruction ok', fetch.ok === true);
        check('T-RT02d: fetched word = SENTINEL0', fetch.ok && fetch.word === SENTINEL0);
        check('T-RT02e: physAddr = lump_base+1+bodyOffset[0]',
              fetch.ok && fetch.addr === lumpBaseActual + 1 + bodyOffsets[0]);
    }

    // T-RT03: CALL method 2
    {
        const { sim, lumpBaseActual } = setupSim(extWords);
        sim.pc = callPC[1];  // = 7
        sim.step();
        check('T-RT03a: sim not halted after CALL m=2', !sim.halted);
        check('T-RT03b: pc after CALL m=2 = bodyOffset[1]', sim.pc === bodyOffsets[1]);
        const fetch = sim._fetchInstruction();
        check('T-RT03c: _fetchInstruction ok', fetch.ok === true);
        check('T-RT03d: fetched word = SENTINEL1', fetch.ok && fetch.word === SENTINEL1);
        check('T-RT03e: physAddr = lump_base+1+bodyOffset[1]',
              fetch.ok && fetch.addr === lumpBaseActual + 1 + bodyOffsets[1]);
    }

    // T-RT04: CALL method 3
    {
        const { sim, lumpBaseActual } = setupSim(extWords);
        sim.pc = callPC[2];  // = 8
        sim.step();
        check('T-RT04a: sim not halted after CALL m=3', !sim.halted);
        check('T-RT04b: pc after CALL m=3 = bodyOffset[2]', sim.pc === bodyOffsets[2]);
        const fetch = sim._fetchInstruction();
        check('T-RT04c: _fetchInstruction ok', fetch.ok === true);
        check('T-RT04d: fetched word = SENTINEL2', fetch.ok && fetch.word === SENTINEL2);
        check('T-RT04e: physAddr = lump_base+1+bodyOffset[2]',
              fetch.ok && fetch.addr === lumpBaseActual + 1 + bodyOffsets[2]);
    }
}

// ── T-RT05: 4-method LUMP, variable-length bodies — step() for each method ────
// Body lengths: [1, 3, 2, 4] → bodyOffsets: 4, 5, 8, 10
// CALL instructions at positions 1+N+sum(bodyLens)+0..+3 = 1+4+10 = 15..18
console.log('\n--- T-RT05: 4-method variable-length bodies round-trip ---');
{
    const S = [0xBEEF0001>>>0, 0xBEEF0002>>>0, 0xBEEF0003>>>0, 0xBEEF0004>>>0];
    const bodyDefs = [
        [S[0]],
        [S[1], 0x00000001, 0x00000002],
        [S[2], 0x00000010],
        [S[3], 0x00000100, 0x00000101, 0x00000102],
    ];
    const { buf, totalWords, bodyOffsets, N } = assembleLump(bodyDefs);

    // Expected bodyOffsets: 4, 5, 8, 10
    check('T-RT05a: bodyOffset[0] = 4',  bodyOffsets[0] === 4);
    check('T-RT05b: bodyOffset[1] = 5',  bodyOffsets[1] === 5);
    check('T-RT05c: bodyOffset[2] = 8',  bodyOffsets[2] === 8);
    check('T-RT05d: bodyOffset[3] = 10', bodyOffsets[3] === 10);

    const baseWords = Array.from(buf.slice(1, totalWords));
    const callBase  = baseWords.length;  // position of first CALL instruction in extWords

    const extWords = [
        ...baseWords,
        callInstr(1), callInstr(2), callInstr(3), callInstr(4),
    ];

    for (let m = 1; m <= 4; m++) {
        const { sim, lumpBaseActual } = setupSim(extWords);
        sim.pc = callBase + (m - 1);   // lump PC of CALL instruction for method m
        sim.step();
        const bo = bodyOffsets[m - 1];
        check(`T-RT05e.${m}: sim not halted after CALL m=${m}`, !sim.halted);
        check(`T-RT05f.${m}: pc after CALL m=${m} = bodyOffset[${m-1}]=${bo}`, sim.pc === bo);
        const fetch = sim._fetchInstruction();
        check(`T-RT05g.${m}: _fetchInstruction ok`, fetch.ok === true);
        check(`T-RT05h.${m}: fetched word = S[${m-1}]`, fetch.ok && fetch.word === S[m - 1]);
    }
}

// ── T-RT06: Regression gate — legacy bare-address table entries ────────────────
// If _assembleLumpFromCatalog were to revert to writing bare lump-relative
// addresses instead of BRANCH instructions, the CALL dispatcher would treat
// them as non-BRANCH entries and use the bare value as the PC directly.
// This test verifies that our assembled LUMP uses BRANCH-encoded entries
// (opcode 17), which the dispatcher decodes correctly, and that the bare-
// address value would give the WRONG pc (catching any such regression).
console.log('\n--- T-RT06: Regression gate — BRANCH encoding vs. bare address ---');
{
    const SENTINEL = 0xFACE1006 >>> 0;
    // 2-method LUMP: body lengths [2, 1]
    // N=2, bodyOffset0=2, bodyOffset1=4
    const bodyA = [SENTINEL, 0x00000001];
    const bodyB = [0x00000002];
    const { buf, totalWords, bodyOffsets } = assembleLump([bodyA, bodyB]);

    const baseWords = Array.from(buf.slice(1, totalWords));
    const callPos   = baseWords.length;
    const extWords  = [...baseWords, callInstr(1)];

    // Verify the assembled method-table entry IS a BRANCH word (not bare address)
    const tableEntry1 = buf[1];  // buf[1+0] = table entry for method 1
    const tableEntry1Opcode = (tableEntry1 >>> 27) & 0x1F;
    check('T-RT06a: table entry 1 has BRANCH opcode (17)', tableEntry1Opcode === BRANCH_OPCODE);

    // The bare lump-relative address of bodyA (pre-task-1134 format) would be N=2.
    // With BRANCH encoding, the decoded bodyOffset = 2. Both coincidentally agree
    // for method 1 of a 2-method LUMP — test method 2 where they diverge.
    //
    // For method 2: bare address = 4 (N + len(bodyA) = 2+2 = 4).
    // BRANCH decoded:  bodyOffset = (2-1) + branchOffset.
    //   branchOffset for i=1: bodyOffset1 - i = 4 - 1 = 3.
    //   decoded: (2-1) + 3 = 4.  Same again (for uniform-1-word bodies they agree).
    //
    // Use bodyA=[2 words] so legacy and BRANCH give different results for method 1:
    //   bare: tableEntry = bodyOffset0 = 2
    //   BRANCH: branchOffset = 2-0=2; decoded = (1-1)+2 = 2.  Still equal!
    //
    // The key regression is: verify the table entries ARE BRANCH words (opcode 17),
    // so if the code ever switched back to bare addresses, this check catches it.
    const tableEntry2 = buf[2];  // table entry for method 2
    const tableEntry2Opcode = (tableEntry2 >>> 27) & 0x1F;
    check('T-RT06b: table entry 2 has BRANCH opcode (17)', tableEntry2Opcode === BRANCH_OPCODE);

    // Round-trip step() for method 1 verifies the BRANCH path in the simulator
    {
        const { sim } = setupSim(extWords);
        sim.pc = callPos;
        sim.step();
        check('T-RT06c: sim not halted (BRANCH path executed)', !sim.halted);
        check('T-RT06d: pc after CALL m=1 = bodyOffset[0]', sim.pc === bodyOffsets[0]);
        const fetch = sim._fetchInstruction();
        check('T-RT06e: fetched word = SENTINEL via BRANCH-decoded bodyOffset',
              fetch.ok && fetch.word === SENTINEL);
    }

    // If the bare-address value happens to match bodyOffset for method 1 here,
    // confirm by checking method 2 in a variable-body arrangement where they differ.
    // N=3, body lengths [3, 1, 1]:
    //   bodyOffsets: 3, 6, 7
    //   bare addresses (pre-task-1134): method 2 would store lump word 7 (wrong; body at 6).
    const SENT2A = 0xF001A000>>>0, SENT2B = 0xF001B000>>>0, SENT2C = 0xF001C000>>>0;
    const m3bodies = [[SENT2A, 0x1, 0x2], [SENT2B], [SENT2C]];
    const r3 = assembleLump(m3bodies);
    const base3 = Array.from(r3.buf.slice(1, r3.totalWords));
    const ext3  = [...base3, callInstr(2)];  // call method 2

    const { sim: sim3 } = setupSim(ext3);
    sim3.pc = base3.length;  // position of callInstr(2)
    sim3.step();
    check('T-RT06f: sim not halted (3-method, variable body, CALL m=2)', !sim3.halted);
    check('T-RT06g: pc = bodyOffset[1]=6  (BRANCH path; bare address would give 7)',
          sim3.pc === r3.bodyOffsets[1]);
    const fetch3 = sim3._fetchInstruction();
    check('T-RT06h: fetched word = SENT2B (correct body, not bare-address word)',
          fetch3.ok && fetch3.word === SENT2B);
}

// ── T-RT07: Thread LUMP header encoding round-trip ────────────────────────────
// Mirrors the packHdr logic in simulator/app-lump-editor.js (renderThreadPanel).
// Constants from the editor (static, never change):
//   DR_WORDS  = 16   (DR0–DR15)
//   CAP_WORDS = 12   (CR0–CR11 GT home slots)
// Header word bit layout:
//   [31:27] magic   = 0x1F
//   [26:23] n_minus_6
//   [22:10] cw      (heap words)
//   [ 9: 8] typ     = 2  (Thread = binary 10)
//   [ 7: 0] cc      (stackFrames)
console.log('\n--- T-RT07: Thread LUMP header encoding round-trip ---');
{
    const DR_WORDS  = 16;
    const CAP_WORDS = 12;

    // Chosen test values
    const lumpPow2    = 8;          // 256-word lump
    const stackFrames = 20;         // 20 frames × 2 words = 40 stack words

    // Derived values
    const lumpSize   = 1 << lumpPow2;                               // 256
    const n_minus_6  = lumpPow2 - 6;                                // 2
    const stackWords = stackFrames * 2;                              // 40
    const heap       = lumpSize - 1 - DR_WORDS - stackWords - CAP_WORDS; // 187
    const cw         = heap;
    const cc         = stackFrames;
    const typ        = 2;   // Thread

    // Pack (mirrors app-lump-editor.js packHdr)
    const word = (
        (0x1F          << 27) |
        ((n_minus_6 & 0xF)  << 23) |
        ((cw  & 0x1FFF)     << 10) |
        ((typ & 0x3)        <<  8) |
        (cc   & 0xFF)
    ) >>> 0;

    // Unpack and assert each field
    const upMagic    = (word >>> 27) & 0x1F;
    const upNMinus6  = (word >>> 23) & 0xF;
    const upCW       = (word >>> 10) & 0x1FFF;
    const upTyp      = (word >>>  8) & 0x3;
    const upCC       =  word         & 0xFF;

    check('T-RT07a: magic = 0x1F',                     upMagic   === 0x1F);
    check('T-RT07b: n_minus_6 = lumpPow2 - 6 = 2',    upNMinus6 === n_minus_6);
    check('T-RT07c: cw = heap words = 187',            upCW      === cw);
    check('T-RT07d: typ = 2 (Thread)',                 upTyp     === 2);
    check('T-RT07e: cc = stackFrames = 20',            upCC      === cc);

    // Second case: lumpPow2=10 (1024 words), stackFrames=64
    const lp2b    = 10;
    const sfb     = 64;
    const lsb     = 1 << lp2b;                                     // 1024
    const nmb     = lp2b - 6;                                       // 4
    const swb     = sfb * 2;                                        // 128
    const heapB   = lsb - 1 - DR_WORDS - swb - CAP_WORDS;          // 867
    const wordB   = (
        (0x1F          << 27) |
        ((nmb  & 0xF)  << 23) |
        ((heapB & 0x1FFF) << 10) |
        ((2    & 0x3)  <<  8) |
        (sfb   & 0xFF)
    ) >>> 0;

    check('T-RT07f: case2 n_minus_6 = 4',   ((wordB >>> 23) & 0xF)    === nmb);
    check('T-RT07g: case2 cw = 867',        ((wordB >>> 10) & 0x1FFF) === heapB);
    check('T-RT07h: case2 cc = 64',         ( wordB         & 0xFF)   === sfb);
    check('T-RT07i: case2 typ = 2',         ((wordB >>>  8) & 0x3)    === 2);
}

// ── T-RT07j/k: over-capacity guard — cw clamps to 0, RB1 fires as error ───────
// Mirror the guard in app-lump-editor.js renderThreadPanel():
//   heap = lumpSize - 1 - DR_WORDS - stackWords - CAP_WORDS
//   cw   = overCapacity ? 0 : heap
// We choose a tiny lump (lumpPow2=6, 64 words) with a large stackFrames (30),
// which makes heap <= 0.
console.log('\n--- T-RT07j/k: Thread LUMP over-capacity guard ---');
{
    const DR_WORDS    = 16;
    const CAP_WORDS   = 12;
    const lumpPow2    = 6;    // 64-word lump — smallest legal Thread LUMP
    const stackFrames = 30;   // 30 × 2 = 60 stack words  →  heap = 64-1-16-60-12 = -25

    const lumpSize   = 1 << lumpPow2;                                   // 64
    const n_minus_6  = lumpPow2 - 6;                                    // 0
    const stackWords = stackFrames * 2;                                  // 60
    const heap       = lumpSize - 1 - DR_WORDS - stackWords - CAP_WORDS; // -25
    const overCapacity = heap <= 0;

    // Editor guard: cw = 0 when over-capacity
    const cw = overCapacity ? 0 : heap;
    const cc = stackFrames;

    check('T-RT07j: heap <= 0 when over-capacity',  overCapacity === true);
    check('T-RT07j: cw clamps to 0 (not negative)', cw === 0);

    // Build a minimal binary (64 words) with this header so lumpAudit has a
    // properly-sized array to inspect (R2 must pass for RB1 to be reached).
    const hdr = (
        (0x1F          << 27) |
        ((n_minus_6 & 0xF)  << 23) |
        ((cw  & 0x1FFF)     << 10) |
        ((2   & 0x3)        <<  8) |   // typ = 2 (Thread)
        (cc   & 0xFF)
    ) >>> 0;
    const words = new Array(lumpSize).fill(0);
    words[0] = hdr;

    const auditResults = lumpAudit(words, null);
    const rb1 = auditResults.find(r => r.ruleId === 'RB1');
    check('T-RT07k: RB1 rule present in audit results', rb1 !== undefined);
    check('T-RT07k: RB1 severity === \'error\' for cw=0', rb1 !== undefined && rb1.severity === 'error');
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log(`Results: ${pass} passed, ${fail} failed`);
if (fail > 0) {
    console.error('SOME TESTS FAILED');
    process.exit(1);
} else {
    console.log('ALL TESTS PASSED');
}
