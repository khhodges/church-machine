'use strict';
// test_catalog_lump.js — Unit tests for Task #1134
// Verifies _assembleLumpFromCatalog produces correct LUMP header and
// BRANCH-instruction method-table entries, and that the CALL dispatcher
// decodes them to the correct body address for each method index.
//
// Run:  node simulator/test_catalog_lump.js
//
// Method-table encoding (Task #1134):
//   Each method-table entry at lump word (i+1), lump-relative PC i, is a BRANCH
//   instruction (opcode 17, 15-bit signed offset).
//   branchOffset = bodyOffset - i
//   CALL dispatcher resolves: pc = (methodIndex-1) + soff = i + (bodyOffset-i) = bodyOffset
//   Fetch: physAddr = lump_base + 1 + bodyOffset → body first instruction.
//
// Coverage:
//   T001 — Header magic (bits 31-27 = 0x1F), cw, cc
//   T002 — BRANCH instruction encoding in method-table for 3-method abstraction
//   T003 — CALL dispatcher decode formula resolves to correct bodyOffset
//   T004 — Single-method edge case: BRANCH offset = N = 1, dispatches to body
//   T005 — Variable-length bodies (4 methods) accumulate offsets correctly
//   T006 — loadProgram post-boot places BRANCH words at lump_base+1+i
//   T007 — _fetchInstruction() end-to-end: pc set via CALL dispatcher decode,
//           fetch through mLoad(X) validation, word matches expected sentinel

const ChurchSimulator = require('./simulator.js');
const { assembleLump, decodeBranchEntry, BRANCH_OPCODE } = require('./lump_assembler.js');

const BRANCH_BASE   = (BRANCH_OPCODE << 27) >>> 0;  // 0x88000000

// Build an unsigned BRANCH word — always >>> 0 so comparisons against
// Uint32Array elements and sim.memory (unsigned) don't sign-mismatch.
function branchWord(offset) {
    return ((BRANCH_BASE | (offset & 0x7FFF)) >>> 0);
}

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

// ── T001: Header magic ─────────────────────────────────────────────────────────
console.log('\n--- T001: Header magic ---');
{
    const body0 = [0xAAAA0001, 0xAAAA0002];
    const body1 = [0xBBBB0001, 0xBBBB0002];
    const body2 = [0xCCCC0001, 0xCCCC0002];
    const { buf } = assembleLump([body0, body1, body2]);

    const magic = (buf[0] >>> 27) & 0x1F;
    check('T001a: header magic field = 0x1F', magic === 0x1F);

    // totalWords = 1 (header) + 3 (table) + 2+2+2 (bodies) = 10
    const cw = (buf[0] >>> 10) & 0x1FFF;
    check('T001b: header cw = 9 (totalWords - 1)', cw === 9);

    const cc = buf[0] & 0xFF;
    check('T001c: header cc = 0 (no capabilities)', cc === 0);
}

// ── T002: BRANCH instruction encoding in method-table ─────────────────────────
// N=3, body lengths [2, 3, 1]:
//   bodyOffset starts at 3 (= N)
//   i=0: branchOffset = 3-0 = 3;  BRANCH word = BRANCH_BASE | 3
//   i=1: branchOffset = 5-1 = 4;  BRANCH word = BRANCH_BASE | 4  (bodyOffset=5 after L0=2)
//   i=2: branchOffset = 8-2 = 6;  BRANCH word = BRANCH_BASE | 6  (bodyOffset=8 after L1=3)
console.log('\n--- T002: BRANCH instruction encoding ---');
{
    const body0 = [0x1001, 0x1002];
    const body1 = [0x2001, 0x2002, 0x2003];
    const body2 = [0x3001];
    const { buf, N } = assembleLump([body0, body1, body2]);

    check('T002a: N = 3', N === 3);

    // Table entries are BRANCH words (opcode 17 in bits 31-27)
    for (let i = 1; i <= 3; i++) {
        const entryOpcode = (buf[i] >>> 27) & 0x1F;
        check(`T002b.${i}: table entry ${i} has BRANCH opcode (17)`, entryOpcode === BRANCH_OPCODE);
    }

    // Verify specific offset values
    // buf[1] for method index 1: i=0, branchOffset=3 → branchWord(3)
    check('T002c: buf[1] = BRANCH +3 (method index 1)', buf[1] === branchWord(3));
    // buf[2] for method index 2: i=1, branchOffset=4 → branchWord(4)
    check('T002d: buf[2] = BRANCH +4 (method index 2)', buf[2] === branchWord(4));
    // buf[3] for method index 3: i=2, branchOffset=6 → branchWord(6)
    check('T002e: buf[3] = BRANCH +6 (method index 3)', buf[3] === branchWord(6));

    // Not old bare-address values (N+1=4, N+L0+1=6, N+L0+L1+1=9)
    check('T002f: table entry 1 is NOT old bare value 4', buf[1] !== 4);
    check('T002g: table entry 2 is NOT old bare value 6', buf[2] !== 6);
    check('T002h: table entry 3 is NOT old bare value 9', buf[3] !== 9);
}

// ── T003: CALL dispatcher decode formula → correct bodyOffset ─────────────────
// Decodes each BRANCH table entry via decodeBranchEntry() and verifies the
// resulting lump-relative PC points to the correct body first word.
console.log('\n--- T003: Dispatcher decode resolves to correct bodyOffset ---');
{
    const SENTINEL0 = 0xDEAD0001 >>> 0;
    const SENTINEL1 = 0xDEAD0002 >>> 0;
    const SENTINEL2 = 0xDEAD0003 >>> 0;

    const body0 = [SENTINEL0, 0xFFFF0001];
    const body1 = [SENTINEL1, 0xFFFF0002, 0xFFFF0003];
    const body2 = [SENTINEL2];
    const { buf } = assembleLump([body0, body1, body2]);

    // Write LUMP into simulator memory at LUMP_BASE to test fetch formula
    const sim = new ChurchSimulator();
    const LUMP_BASE = 0x20;
    for (let i = 0; i < buf.length; i++) {
        sim.memory[LUMP_BASE + i] = buf[i] >>> 0;
    }

    // Method index 1: dispatcher reads memory[LUMP_BASE+1] = BRANCH word
    //   decodeBranchEntry → bodyOffset = (1-1) + 3 = 3
    //   physAddr = LUMP_BASE + 1 + 3 = LUMP_BASE + 4 → SENTINEL0
    const bodyPC1 = decodeBranchEntry(sim.memory[LUMP_BASE + 1], 1);
    check('T003a: dispatch decode for method 1 → bodyOffset=3', bodyPC1 === 3);
    check('T003b: memory[LUMP_BASE+1+3] = SENTINEL0', sim.memory[LUMP_BASE + 1 + bodyPC1] === SENTINEL0);

    // Method index 2: body at bodyOffset = 3+2 = 5
    //   BRANCH at i=1: branchOffset = 5-1=4, entry lump PC=1, decode: (2-1)+4=5
    const bodyPC2 = decodeBranchEntry(sim.memory[LUMP_BASE + 2], 2);
    check('T003c: dispatch decode for method 2 → bodyOffset=5', bodyPC2 === 5);
    check('T003d: memory[LUMP_BASE+1+5] = SENTINEL1', sim.memory[LUMP_BASE + 1 + bodyPC2] === SENTINEL1);

    // Method index 3: body at bodyOffset = 5+3 = 8
    //   BRANCH at i=2: branchOffset = 8-2=6, decode: (3-1)+6=8
    const bodyPC3 = decodeBranchEntry(sim.memory[LUMP_BASE + 3], 3);
    check('T003e: dispatch decode for method 3 → bodyOffset=8', bodyPC3 === 8);
    check('T003f: memory[LUMP_BASE+1+8] = SENTINEL2', sim.memory[LUMP_BASE + 1 + bodyPC3] === SENTINEL2);
}

// ── T004: Single-method edge case ─────────────────────────────────────────────
// N=1: table entry at buf[1] (lump PC 0), BRANCH offset = 1-0 = 1.
// Dispatcher methodIndex=1: bodyOffset = (1-1) + 1 = 1.
// Fetch: lump_base + 1 + 1 = lump_base + 2 → body first instruction.
// NOTE: methodIndex=0 hard-codes pc=1 (lump_base+2), matching the BRANCH decode.
console.log('\n--- T004: Single-method edge case ---');
{
    const SENTINEL = 0xCAFE0001 >>> 0;
    const { buf } = assembleLump([[SENTINEL, 0xDEAD]]);

    // N=1: i=0, branchOffset = 1-0 = 1
    check('T004a: buf[1] = BRANCH +1', buf[1] === branchWord(1));

    // Decode: (methodIndex=1 - 1) + 1 = 1 (lump-relative PC of body)
    const bodyPC = decodeBranchEntry(buf[1], 1);
    check('T004b: dispatch decode → bodyOffset=1', bodyPC === 1);

    // Body is at buf[2] (lump word 2)
    check('T004c: buf[2] = SENTINEL (body first word)', buf[2] === SENTINEL);

    // Verify consistency with methodIndex=0 hard-coded path (pc=1)
    check('T004d: decoded bodyOffset=1 matches hard-coded pc=1 for methodIndex=0', bodyPC === 1);
}

// ── T005: Variable-length bodies ──────────────────────────────────────────────
// 4 methods, body lengths [1, 4, 2, 3] → bodyOffsets: 4, 5, 9, 11
console.log('\n--- T005: Variable-length body accumulation ---');
{
    const body0 = [0xA0];
    const body1 = [0xB0, 0xB1, 0xB2, 0xB3];
    const body2 = [0xC0, 0xC1];
    const body3 = [0xD0, 0xD1, 0xD2];
    const { buf, totalWords, N } = assembleLump([body0, body1, body2, body3]);

    check('T005a: N = 4', N === 4);
    check('T005b: totalWords = 1+4+1+4+2+3 = 15', totalWords === 15);

    // Expected BRANCH words:
    // i=0: bodyOffset=4, branchOffset=4-0=4  → BRANCH_BASE|4
    // i=1: bodyOffset=5, branchOffset=5-1=4  → BRANCH_BASE|4
    // i=2: bodyOffset=9, branchOffset=9-2=7  → BRANCH_BASE|7
    // i=3: bodyOffset=11,branchOffset=11-3=8 → BRANCH_BASE|8
    check('T005c: table entry 1 = BRANCH +4', buf[1] === branchWord(4));
    check('T005d: table entry 2 = BRANCH +4', buf[2] === branchWord(4));
    check('T005e: table entry 3 = BRANCH +7', buf[3] === branchWord(7));
    check('T005f: table entry 4 = BRANCH +8', buf[4] === branchWord(8));

    // Verify dispatcher decodes to correct bodyOffsets
    check('T005g: method 1 → bodyOffset=4', decodeBranchEntry(buf[1], 1) === 4);
    check('T005h: method 2 → bodyOffset=5', decodeBranchEntry(buf[2], 2) === 5);
    check('T005i: method 3 → bodyOffset=9', decodeBranchEntry(buf[3], 3) === 9);
    check('T005j: method 4 → bodyOffset=11', decodeBranchEntry(buf[4], 4) === 11);

    // Verify body words land at the right absolute lump positions
    check('T005k: buf[5]  = body0[0] = 0xA0', buf[5]  === 0xA0);
    check('T005l: buf[6]  = body1[0] = 0xB0', buf[6]  === 0xB0);
    check('T005m: buf[10] = body2[0] = 0xC0', buf[10] === 0xC0);
    check('T005n: buf[12] = body3[0] = 0xD0', buf[12] === 0xD0);
}

// ── T006: loadProgram post-boot writes BRANCH words at lump_base+1+i ──────────
console.log('\n--- T006: loadProgram post-boot memory layout ---');
{
    const SENTINEL0 = 0xFACE0001 >>> 0;
    const SENTINEL1 = 0xFACE0002 >>> 0;

    // 2-method LUMP: body lengths [2, 1]
    // N=2: i=0 branchOffset=2, i=1 branchOffset=3
    const body0 = [SENTINEL0, 0xFFFF];
    const body1 = [SENTINEL1];
    const { buf } = assembleLump([body0, body1]);

    // words = buf without header, as passed to loadProgram
    const words = Array.from(buf).slice(1);  // [BRANCH+2, BRANCH+3, SENTINEL0, 0xFFFF, SENTINEL1]

    const sim2 = new ChurchSimulator();
    sim2.bootComplete = true;

    const ABSTR_SLOT = 3;
    const nsBase2 = sim2.NS_TABLE_BASE + ABSTR_SLOT * sim2.NS_ENTRY_WORDS;
    const lumpBase = 0x40;  // non-zero
    sim2.memory[nsBase2 + 0] = lumpBase;
    const hdrWord = ((0x1F << 27) | (0 << 23) | (62 << 10) | 0) >>> 0;
    sim2.memory[lumpBase] = hdrWord;
    if (sim2.packNSWord1) {
        sim2.memory[nsBase2 + 1] = sim2.packNSWord1(62, 0, 0, 0, 0, 0, 0);
    }
    sim2.cr[14] = { word0: 0x00000001, word1: lumpBase, word2: 0, word3: 0, m: 0 };

    sim2.loadProgram(words, 0);

    // BRANCH words in memory after loadProgram
    const expectedBranch0 = branchWord(2);
    const expectedBranch1 = branchWord(3);
    check('T006a: memory[lump_base+1] = BRANCH +2 (method 1)', sim2.memory[lumpBase + 1] === expectedBranch0);
    check('T006b: memory[lump_base+2] = BRANCH +3 (method 2)', sim2.memory[lumpBase + 2] === expectedBranch1);
    check('T006c: memory[lump_base+3] = SENTINEL0', sim2.memory[lumpBase + 3] === SENTINEL0);
    check('T006d: memory[lump_base+5] = SENTINEL1', sim2.memory[lumpBase + 5] === SENTINEL1);

    // Verify dispatcher decode for each method
    // Method index 1: reads lumpBase+1 → BRANCH+2; decode: (1-1)+2=2; physAddr=lumpBase+1+2=lumpBase+3
    const bodyPC1 = decodeBranchEntry(sim2.memory[lumpBase + 1], 1);
    check('T006e: dispatch decode method 1 → bodyOffset=2', bodyPC1 === 2);
    check('T006f: memory[lump_base+1+2] = SENTINEL0', sim2.memory[lumpBase + 1 + bodyPC1] === SENTINEL0);

    // Method index 2: reads lumpBase+2 → BRANCH+3; decode: (2-1)+3=4; physAddr=lumpBase+1+4=lumpBase+5
    const bodyPC2 = decodeBranchEntry(sim2.memory[lumpBase + 2], 2);
    check('T006g: dispatch decode method 2 → bodyOffset=4', bodyPC2 === 4);
    check('T006h: memory[lump_base+1+4] = SENTINEL1', sim2.memory[lumpBase + 1 + bodyPC2] === SENTINEL1);
}

// ── T007: _fetchInstruction() end-to-end dispatch ─────────────────────────────
// Sets pc via the CALL dispatcher decode formula, then calls _fetchInstruction()
// through the real mLoad(X) path with a validated NS entry and RX GT.
console.log('\n--- T007: _fetchInstruction() end-to-end dispatch ---');
{
    const GT_SEQ    = 5;
    const LUMP_SLOT = 3;
    const LUMP_BASE = 0x80;

    const SENTINEL0 = 0xBEEF0001 >>> 0;
    const SENTINEL1 = 0xBEEF0002 >>> 0;

    // 2-method LUMP: body0=[SENTINEL0, 0xFFFF], body1=[SENTINEL1]
    // N=2: BRANCH words [BRANCH+2, BRANCH+3]; bodies at lump PCs 2..3 and 4
    const body0 = [SENTINEL0, 0xFFFF];
    const body1 = [SENTINEL1];
    const { buf } = assembleLump([body0, body1]);
    const words = Array.from(buf).slice(1);  // strip header
    const cw = words.length;                 // 5

    // Set up sim with valid NS entry and RX GT so mLoad(X) passes
    const sim7 = new ChurchSimulator();
    sim7.bootComplete = true;
    sim7.nsCount = Math.max(sim7.nsCount, LUMP_SLOT + 1);

    const lumpSize7 = 64;
    const n_minus_6_7 = Math.max(0, Math.round(Math.log2(lumpSize7)) - 6);
    sim7.memory[LUMP_BASE] = ((0x1F << 27) | ((n_minus_6_7 & 0xF) << 23) | ((cw & 0x1FFF) << 10)) >>> 0;

    const nsBase7 = sim7.NS_TABLE_BASE + LUMP_SLOT * sim7.NS_ENTRY_WORDS;
    sim7.memory[nsBase7 + 0] = LUMP_BASE;
    sim7.memory[nsBase7 + 1] = sim7.packNSWord1(cw, 0, 0, 0, 0, 0, 0);
    sim7.memory[nsBase7 + 2] = sim7.makeVersionSeals(GT_SEQ, LUMP_BASE, cw);

    sim7.loadProgram(words, 0);  // writes words to LUMP_BASE+1..+5, re-syncs NS + CR14

    // Build CR14 GT with gt_seq matching the (possibly recomputed) NS word2
    const gtSeqAfter = (sim7.memory[nsBase7 + 2] >>> 25) & 0x7F;
    const cr14GT = sim7.createGT(gtSeqAfter, LUMP_SLOT, { R:1, W:0, X:1, L:0, S:0, E:0 }, 1);
    const lumpBaseActual = sim7.memory[nsBase7 + 0];
    sim7.cr[14] = {
        word0: cr14GT,
        word1: lumpBaseActual,
        word2: sim7.memory[nsBase7 + 1],
        word3: sim7.memory[nsBase7 + 2],
        m: 0
    };

    // Verify BRANCH words in memory
    check('T007a: memory[lump_base+1] = BRANCH +2', sim7.memory[lumpBaseActual + 1] === branchWord(2));
    check('T007b: memory[lump_base+2] = BRANCH +3', sim7.memory[lumpBaseActual + 2] === branchWord(3));

    // Method index 1: CALL dispatcher decode → pc = (1-1) + 2 = 2
    //   _fetchInstruction: physAddr = lump_base + 1 + 2 = lump_base + 3 → SENTINEL0
    const pc1 = decodeBranchEntry(sim7.memory[lumpBaseActual + 1], 1);
    check('T007c: dispatcher decode method 1 → pc=2', pc1 === 2);
    sim7.pc = pc1;
    const fetch1 = sim7._fetchInstruction();
    check('T007d: _fetchInstruction ok for method 1', fetch1.ok === true);
    check('T007e: fetched word for method 1 = SENTINEL0', fetch1.ok && fetch1.word === SENTINEL0);
    check('T007f: fetch physAddr = lump_base+3', fetch1.ok && fetch1.addr === lumpBaseActual + 3);

    // Method index 2: CALL dispatcher decode → pc = (2-1) + 3 = 4
    //   _fetchInstruction: physAddr = lump_base + 1 + 4 = lump_base + 5 → SENTINEL1
    const pc2 = decodeBranchEntry(sim7.memory[lumpBaseActual + 2], 2);
    check('T007g: dispatcher decode method 2 → pc=4', pc2 === 4);
    sim7.pc = pc2;
    const fetch2 = sim7._fetchInstruction();
    check('T007h: _fetchInstruction ok for method 2', fetch2.ok === true);
    check('T007i: fetched word for method 2 = SENTINEL1', fetch2.ok && fetch2.word === SENTINEL1);
    check('T007j: fetch physAddr = lump_base+5', fetch2.ok && fetch2.addr === lumpBaseActual + 5);
}

// ── Summary ────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log(`Results: ${pass} passed, ${fail} failed`);
if (fail > 0) {
    console.error('SOME TESTS FAILED');
    process.exit(1);
} else {
    console.log('ALL TESTS PASSED');
}
