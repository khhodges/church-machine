'use strict';
// test_save_to_ns_dispatch.js — Unit tests for Task #1145
// Verifies that saveToNamespace / saveToNamespaceAt stores BRANCH-encoded
// method-table entries so CALL with methodIndex > 0 dispatches to the correct
// body instruction for multi-method LUMPs assembled and saved to the namespace.
//
// Run:  node simulator/test_save_to_ns_dispatch.js
//
// Background (Task #1134 / #1145):
//   Method-table entries at lump word (i+1) are BRANCH instructions (opcode 23,
//   15-bit signed offset).  branchOffset = bodyOffset - i.
//   CALL dispatcher: pc = (methodIndex-1) + soff = i + (bodyOffset-i) = bodyOffset.
//   Fetch: physAddr = lump_base + 1 + bodyOffset → body first instruction.
//
//   Before this fix, the CLOOMC++ high-level compiler path (app-run.js) wrote
//   bare 'codeOffset + 1' entries, causing the legacy dispatcher to land one
//   word past the body start (off-by-one).
//
// Coverage:
//   T001 — saveToNamespace stores BRANCH-encoded entries in memory
//   T002 — CALL dispatcher decode resolves to correct bodyOffset (2 methods)
//   T003 — _fetchInstruction returns sentinel for method 1 and method 2
//   T004 — saveToNamespaceAt stores BRANCH-encoded entries at specified slot
//   T005 — 3-method LUMP: each method dispatches to the correct sentinel
//   T006 — Bare legacy entries (pre-fix) resolve to the WRONG word (regression guard)

const ChurchSimulator = require('./simulator.js');

const BRANCH_OPCODE = 23;
const BRANCH_BASE   = (BRANCH_OPCODE << 27) >>> 0;

function branchWord(offset) {
    return ((BRANCH_BASE | (offset & 0x7FFF)) >>> 0);
}

// Decode a BRANCH method-table entry → lump-relative PC of the body.
// Mirrors the CALL dispatcher in simulator.js (opcode-17 path).
function decodeBranchEntry(tableEntryWord, methodIndex) {
    const opcode = (tableEntryWord >>> 27) & 0x1F;
    if (opcode !== BRANCH_OPCODE) return null;
    const soff = (tableEntryWord & 0x4000)
        ? ((tableEntryWord & 0x7FFF) | 0xFFFF8000)
        : (tableEntryWord & 0x7FFF);
    return (methodIndex - 1) + soff;
}

// Build the words[] array that is passed to saveToNamespace (no header word).
// Uses BRANCH-encoded method-table entries — the correct format after task #1145.
function buildWords(methodBodies) {
    const N = methodBodies.length;
    const words = [];
    let bodyOffset = N;  // lump-relative PC of first body (table PCs = 0..N-1)
    for (let i = 0; i < N; i++) {
        const branchOffset = bodyOffset - i;
        words.push(branchWord(branchOffset));
        bodyOffset += methodBodies[i].length;
    }
    for (const body of methodBodies) {
        for (const w of body) words.push(w >>> 0);
    }
    return words;
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

// ── T001: saveToNamespace writes BRANCH-encoded entries to memory ──────────────
console.log('\n--- T001: saveToNamespace writes BRANCH-encoded method-table entries ---');
{
    const SENTINEL0 = 0xDEAD1001 >>> 0;
    const SENTINEL1 = 0xDEAD1002 >>> 0;

    // 2-method LUMP: body0=[SENTINEL0, 0xFFFF] (len=2), body1=[SENTINEL1] (len=1)
    // N=2: i=0 bodyOffset=2, branchOffset=2-0=2 → BRANCH+2
    //       i=1 bodyOffset=4, branchOffset=4-1=3 → BRANCH+3
    // words = [BRANCH+2, BRANCH+3, SENTINEL0, 0xFFFF, SENTINEL1]
    const words = buildWords([[SENTINEL0, 0xFFFF], [SENTINEL1]]);

    const sim = new ChurchSimulator();
    sim.bootComplete = true;

    const slot = sim.saveToNamespace('TestAbstr', words, { R:0,W:0,X:1,L:0,S:0,E:0 }, 1);

    const entry = sim.readNSEntry(slot);
    check('T001a: NS entry written (not null)', entry !== null);

    const lumpBase = entry ? entry.word0_location : 0;

    // Word 0 at lumpBase = lump header (magic = 0x1F)
    const magic = (sim.memory[lumpBase] >>> 27) & 0x1F;
    check('T001b: lump header magic = 0x1F', magic === 0x1F);

    // Table entry for method 1 at memory[lumpBase + 1] = words[0] = BRANCH+2
    check('T001c: memory[lumpBase+1] = BRANCH+2 (method 1)', sim.memory[lumpBase + 1] === branchWord(2));

    // Table entry for method 2 at memory[lumpBase + 2] = words[1] = BRANCH+3
    check('T001d: memory[lumpBase+2] = BRANCH+3 (method 2)', sim.memory[lumpBase + 2] === branchWord(3));

    // Body of method 1 starts at lumpBase+3 (lump-relative PC 2)
    check('T001e: memory[lumpBase+3] = SENTINEL0', sim.memory[lumpBase + 3] === SENTINEL0);

    // Body of method 2 starts at lumpBase+5 (lump-relative PC 4 = N + len(body0) = 2+2)
    check('T001f: memory[lumpBase+5] = SENTINEL1', sim.memory[lumpBase + 5] === SENTINEL1);

    // Entries are NOT old bare values (codeOffset+1 = 3 and 4 respectively)
    check('T001g: method 1 entry is NOT old bare value 3', sim.memory[lumpBase + 1] !== 3);
    check('T001h: method 2 entry is NOT old bare value 4', sim.memory[lumpBase + 2] !== 4);
}

// ── T002: CALL dispatcher decode resolves to correct bodyOffset ───────────────
console.log('\n--- T002: CALL dispatcher decode from NS memory ---');
{
    const SENTINEL0 = 0xDEAD2001 >>> 0;
    const SENTINEL1 = 0xDEAD2002 >>> 0;

    const words = buildWords([[SENTINEL0, 0xFFFF], [SENTINEL1]]);

    const sim = new ChurchSimulator();
    sim.bootComplete = true;
    const slot = sim.saveToNamespace('TestAbstr2', words, { R:0,W:0,X:1,L:0,S:0,E:0 }, 1);
    const entry = sim.readNSEntry(slot);
    const lumpBase = entry.word0_location;

    // Method index 1: read memory[lumpBase+1], decode BRANCH entry
    // branchOffset=2, soff=2, decode=(1-1)+2=2, body at lumpBase+1+2=lumpBase+3
    const bodyPC1 = decodeBranchEntry(sim.memory[lumpBase + 1], 1);
    check('T002a: dispatch decode method 1 → bodyOffset=2', bodyPC1 === 2);
    check('T002b: memory[lumpBase+1+bodyOffset1] = SENTINEL0', sim.memory[lumpBase + 1 + bodyPC1] === SENTINEL0);

    // Method index 2: read memory[lumpBase+2], decode BRANCH entry
    // i=1, bodyOffset=4 (N+len(body0)=2+2), branchOffset=4-1=3, soff=3, decode=(2-1)+3=4
    const bodyPC2 = decodeBranchEntry(sim.memory[lumpBase + 2], 2);
    check('T002c: dispatch decode method 2 → bodyOffset=4', bodyPC2 === 4);
    check('T002d: memory[lumpBase+1+bodyOffset2] = SENTINEL1', sim.memory[lumpBase + 1 + bodyPC2] === SENTINEL1);
}

// ── T003: _fetchInstruction returns sentinel for each method index ─────────────
console.log('\n--- T003: _fetchInstruction end-to-end for saved NS slot ---');
{
    const GT_SEQ    = 7;
    const SENTINEL0 = 0xDEAD3001 >>> 0;
    const SENTINEL1 = 0xDEAD3002 >>> 0;

    const words = buildWords([[SENTINEL0, 0xFFFF], [SENTINEL1]]);
    const cw = words.length;  // 5 words (2 table + 3 body words)

    const sim = new ChurchSimulator();
    sim.bootComplete = true;
    const slot = sim.saveToNamespace('TestAbstr3', words, { R:0,W:0,X:1,L:0,S:0,E:0 }, 1);
    const entry = sim.readNSEntry(slot);
    const lumpBase = entry.word0_location;

    // Build a valid RX GT pointing at the slot so mLoad(X) passes
    const nsWord2  = sim.memory[sim.NS_TABLE_BASE + slot * sim.NS_ENTRY_WORDS + 2];
    const gtSeq    = (nsWord2 >>> 25) & 0x7F;
    const cr14GT   = sim.createGT(gtSeq, slot, { R:1, W:0, X:1, L:0, S:0, E:0 }, 1);
    sim.cr[14] = {
        word0: cr14GT,
        word1: lumpBase,
        word2: sim.memory[sim.NS_TABLE_BASE + slot * sim.NS_ENTRY_WORDS + 1],
        word3: nsWord2,
        m: 0
    };

    // Method 1: dispatcher decode → pc=2, fetch → SENTINEL0
    const bodyPC1 = decodeBranchEntry(sim.memory[lumpBase + 1], 1);
    check('T003a: dispatch decode method 1 → pc=2', bodyPC1 === 2);
    sim.pc = bodyPC1;
    const fetch1 = sim._fetchInstruction();
    check('T003b: _fetchInstruction ok for method 1', fetch1.ok === true);
    check('T003c: fetched word = SENTINEL0', fetch1.ok && fetch1.word === SENTINEL0);
    check('T003d: physAddr = lumpBase+3', fetch1.ok && fetch1.addr === lumpBase + 3);

    // Method 2: dispatcher decode → pc=4, fetch → SENTINEL1
    const bodyPC2 = decodeBranchEntry(sim.memory[lumpBase + 2], 2);
    check('T003e: dispatch decode method 2 → pc=4', bodyPC2 === 4);
    sim.pc = bodyPC2;
    const fetch2 = sim._fetchInstruction();
    check('T003f: _fetchInstruction ok for method 2', fetch2.ok === true);
    check('T003g: fetched word = SENTINEL1', fetch2.ok && fetch2.word === SENTINEL1);
    check('T003h: physAddr = lumpBase+5', fetch2.ok && fetch2.addr === lumpBase + 5);
}

// ── T004: saveToNamespaceAt stores BRANCH-encoded entries at specified slot ────
console.log('\n--- T004: saveToNamespaceAt at explicit slot ---');
{
    const SENTINEL0 = 0xDEAD4001 >>> 0;
    const SENTINEL1 = 0xDEAD4002 >>> 0;

    const words = buildWords([[SENTINEL0], [SENTINEL1]]);

    const sim = new ChurchSimulator();
    sim.bootComplete = true;
    // Ensure NS is initialised past slot 30 before saving there
    for (let i = 0; i < 31; i++) {
        if (!sim.readNSEntry(i)) {
            sim.nsLabels[i] = '';
        }
    }
    sim.nsCount = Math.max(sim.nsCount, 31);

    const TARGET_SLOT = 30;
    sim.saveToNamespaceAt(TARGET_SLOT, 'TestAt', words, { R:0,W:0,X:1,L:0,S:0,E:0 }, 1);

    const entry = sim.readNSEntry(TARGET_SLOT);
    check('T004a: NS entry written at slot 30', entry !== null);

    const lumpBase = entry ? entry.word0_location : 0;

    // N=2, body lengths [1,1]: i=0 branchOffset=2-0=2, i=1 branchOffset=3-1=2
    // Decode: method 1 → (1-1)+2=2, method 2 → (2-1)+2=3
    const bodyPC1 = decodeBranchEntry(sim.memory[lumpBase + 1], 1);
    const bodyPC2 = decodeBranchEntry(sim.memory[lumpBase + 2], 2);
    check('T004b: method 1 dispatch → bodyOffset=2', bodyPC1 === 2);
    check('T004c: memory[lumpBase+1+2] = SENTINEL0', sim.memory[lumpBase + 1 + bodyPC1] === SENTINEL0);
    check('T004d: method 2 dispatch → bodyOffset=3', bodyPC2 === 3);
    check('T004e: memory[lumpBase+1+3] = SENTINEL1', sim.memory[lumpBase + 1 + bodyPC2] === SENTINEL1);

    // Entries are NOT old bare values (codeOffset+1 = 3 and 4)
    check('T004f: method 1 entry is NOT old bare value 3', sim.memory[lumpBase + 1] !== 3);
    check('T004g: method 2 entry is NOT old bare value 4', sim.memory[lumpBase + 2] !== 4);
}

// ── T005: 3-method LUMP — each method dispatches to the correct sentinel ───────
console.log('\n--- T005: 3-method LUMP dispatch ---');
{
    const S0 = 0xDEAD5001 >>> 0;
    const S1 = 0xDEAD5002 >>> 0;
    const S2 = 0xDEAD5003 >>> 0;

    // body lengths [2, 3, 1]; N=3
    // bodyOffsets: 3, 5, 8
    // BRANCH entries: i=0 branchOffset=3, i=1 branchOffset=4 (5-1), i=2 branchOffset=6 (8-2)
    const words = buildWords([[S0, 0xFFFF], [S1, 0xFFFF, 0xFFFF], [S2]]);

    const sim = new ChurchSimulator();
    sim.bootComplete = true;
    const slot = sim.saveToNamespace('ThreeMethod', words, { R:0,W:0,X:1,L:0,S:0,E:0 }, 1);
    const entry = sim.readNSEntry(slot);
    const lumpBase = entry.word0_location;

    // Verify BRANCH words
    check('T005a: table entry 1 = BRANCH+3', sim.memory[lumpBase + 1] === branchWord(3));
    check('T005b: table entry 2 = BRANCH+4', sim.memory[lumpBase + 2] === branchWord(4));
    check('T005c: table entry 3 = BRANCH+6', sim.memory[lumpBase + 3] === branchWord(6));

    // Dispatcher decodes
    const pc1 = decodeBranchEntry(sim.memory[lumpBase + 1], 1);
    const pc2 = decodeBranchEntry(sim.memory[lumpBase + 2], 2);
    const pc3 = decodeBranchEntry(sim.memory[lumpBase + 3], 3);
    check('T005d: method 1 → bodyOffset=3', pc1 === 3);
    check('T005e: method 2 → bodyOffset=5', pc2 === 5);
    check('T005f: method 3 → bodyOffset=8', pc3 === 8);

    // Sentinels at correct addresses
    check('T005g: memory[lumpBase+1+3] = S0', sim.memory[lumpBase + 1 + pc1] === S0);
    check('T005h: memory[lumpBase+1+5] = S1', sim.memory[lumpBase + 1 + pc2] === S1);
    check('T005i: memory[lumpBase+1+8] = S2', sim.memory[lumpBase + 1 + pc3] === S2);
}

// ── T006: Regression guard — old bare entries would fetch the WRONG word ───────
// This test documents that the pre-fix 'codeOffset+1' bare entries (non-BRANCH)
// land one word past the body start when used with the legacy dispatcher path.
// After the fix, words contain BRANCH-encoded entries so this path is not taken.
console.log('\n--- T006: Regression guard — bare entries miss body start ---');
{
    const SENTINEL = 0xDEAD6001 >>> 0;
    const WRONG    = 0xFFFF6666 >>> 0;  // word AFTER sentinel (body[1])

    // 2-method LUMP: method 1 body = [SENTINEL, WRONG]
    // Pre-fix: table entry for method 1 would be codeOffset+1 = N+1 = 3 (bare, not BRANCH)
    // Legacy dispatcher: pc = 3 → physAddr = lumpBase+1+3 = lumpBase+4 → WRONG
    // Correct (post-fix BRANCH): pc = 2 → physAddr = lumpBase+1+2 = lumpBase+3 → SENTINEL

    const sim = new ChurchSimulator();
    sim.bootComplete = true;

    const N = 2;
    // Manually build old-style bare entries (simulating pre-fix CLOOMC++ compiler output)
    const oldStyleWords = [];
    let codeOffset = N;
    // Method 0: bare entry = codeOffset + 1 = 3
    oldStyleWords.push(codeOffset + 1);  // old bug: off-by-one
    codeOffset += 2;  // body0 = [SENTINEL, WRONG]
    // Method 1: bare entry = codeOffset + 1 = 6
    oldStyleWords.push(codeOffset + 1);
    codeOffset += 1;  // body1 = [0x9999]
    oldStyleWords.push(SENTINEL);
    oldStyleWords.push(WRONG);
    oldStyleWords.push(0x9999);

    // Write directly to memory to simulate pre-fix scenario
    const OLD_SLOT = 20;
    sim.nsCount = Math.max(sim.nsCount, OLD_SLOT + 1);
    const oldLumpBase = OLD_SLOT * sim.SLOT_SIZE;
    const oldCW = oldStyleWords.length;
    let oldLumpSize = 64;
    while (oldLumpSize < 1 + oldCW) oldLumpSize <<= 1;
    const oldNm6 = Math.max(0, Math.ceil(Math.log2(oldLumpSize)) - 6);
    sim.memory[oldLumpBase] = sim.packLumpHeader(oldNm6, oldCW, 0, 0);
    for (let i = 0; i < oldCW; i++) sim.memory[oldLumpBase + 1 + i] = oldStyleWords[i] >>> 0;

    // Legacy dispatcher for old bare entry (method index 1)
    const oldTableEntry = sim.memory[oldLumpBase + 1] >>> 0;  // = 3 (bare, not BRANCH)
    const oldEntryOpcode = (oldTableEntry >>> 27) & 0x1F;
    check('T006a: old entry is NOT BRANCH-encoded (opcode != 17)', oldEntryOpcode !== BRANCH_OPCODE);

    // Legacy path: pc = tableEntry = 3; physAddr = lumpBase+1+3 = lumpBase+4 → WRONG
    const legacyPC = oldTableEntry;
    const legacyAddr = oldLumpBase + 1 + legacyPC;
    check('T006b: legacy pc = 3 (bare entry value)', legacyPC === 3);
    check('T006c: legacy fetch hits WRONG (not SENTINEL)', sim.memory[legacyAddr] === WRONG);

    // BRANCH-encoded path (post-fix): pc = 2; physAddr = lumpBase+1+2 = lumpBase+3 → SENTINEL
    const correctWords = buildWords([[SENTINEL, WRONG], [0x9999]]);
    const slot2 = sim.saveToNamespace('PostFix', correctWords, { R:0,W:0,X:1,L:0,S:0,E:0 }, 1);
    const entry2 = sim.readNSEntry(slot2);
    const lumpBase2 = entry2.word0_location;
    const newTableEntry = sim.memory[lumpBase2 + 1] >>> 0;
    const newEntryOpcode = (newTableEntry >>> 27) & 0x1F;
    check('T006d: new entry IS BRANCH-encoded (opcode = 17)', newEntryOpcode === BRANCH_OPCODE);
    const fixedPC = decodeBranchEntry(newTableEntry, 1);
    check('T006e: fixed pc = 2 (correct body start)', fixedPC === 2);
    check('T006f: fixed fetch hits SENTINEL', sim.memory[lumpBase2 + 1 + fixedPC] === SENTINEL);
}

// ── T007: end-to-end _execCall dispatch via saved NS slot ─────────────────────
// Calls _execCall() — the CALL instruction handler — directly with a CR holding
// a valid E-perm GT pointing at the saved NS slot.  Verifies sim.pc is set to
// the correct body offset (BRANCH-decoded from the method table in memory) for
// each method index.  CR12.word1=0 means the call-frame hardware write is
// skipped (no thread stack needed); CR15.m=0 means _mwinWriteback is a no-op.
console.log('\n--- T007: end-to-end _execCall dispatch from saved NS slot ---');
{
    const SENTINEL0 = 0xDEAD7001 >>> 0;
    const SENTINEL1 = 0xDEAD7002 >>> 0;

    // 2-method LUMP: body0=[SENTINEL0, 0xFFFF] (len=2), body1=[SENTINEL1] (len=1)
    // N=2: bodyOffsets = 2 and 4 for methods 1 and 2 respectively
    const words = buildWords([[SENTINEL0, 0xFFFF], [SENTINEL1]]);

    // ── Method index 1 ──────────────────────────────────────────────────────────
    const sim1 = new ChurchSimulator();
    sim1.bootComplete = true;
    const slot1 = sim1.saveToNamespace('T7Target', words, { R:0, W:0, X:0, L:0, S:0, E:1 }, 1);
    const entry1 = sim1.readNSEntry(slot1);

    // Namespace sequence is authoritative in W1[29:21].  Do not derive it
    // from the integrity word or assume a forward NS-table layout.
    const gt_seq1 = entry1.gtSeq;

    // E-perm Inform GT (type=1) pointing at the saved slot — exactly what CALL validates
    const eGT1 = sim1.createGT(gt_seq1, slot1, { R:0, W:0, X:0, L:0, S:0, E:1 }, 1);
    sim1.cr[0] = { word0: eGT1, word1: entry1.word0_location, word2: entry1.word1_limit, word3: entry1.word2_seals, m: 0 };
    // CR12.word1 = 0 (default) → callThreadBase = 0 (falsy) → no thread write
    // CR15.m = 0 (default) → _mwinWriteback returns true immediately (no-op)

    const result1 = sim1._execCall({ opcode: 2, cond: 0, crDst: 0, crSrc: 0, imm: 1 });
    check('T007a: _execCall returns non-null for method 1', result1 !== null);
    // Method 1: BRANCH entry at lumpBase+1 → branchOffset=2 → pc=(1-1)+2=2
    check('T007b: sim.pc = 2 (bodyOffset for method 1) after CALL', sim1.pc === 2);
    check('T007c: sentinel0 reachable at lumpBase+1+pc (lumpBase+3)', sim1.memory[entry1.word0_location + 1 + sim1.pc] === SENTINEL0);

    // ── Method index 2 ──────────────────────────────────────────────────────────
    // Fresh sim to avoid call-stack / CR state contamination from method-1 CALL
    const sim2 = new ChurchSimulator();
    sim2.bootComplete = true;
    const slot2 = sim2.saveToNamespace('T7Target2', words, { R:0, W:0, X:0, L:0, S:0, E:1 }, 1);
    const entry2 = sim2.readNSEntry(slot2);
    const gt_seq2 = entry2.gtSeq;
    const eGT2 = sim2.createGT(gt_seq2, slot2, { R:0, W:0, X:0, L:0, S:0, E:1 }, 1);
    sim2.cr[0] = { word0: eGT2, word1: entry2.word0_location, word2: entry2.word1_limit, word3: entry2.word2_seals, m: 0 };

    const result2 = sim2._execCall({ opcode: 2, cond: 0, crDst: 0, crSrc: 0, imm: 2 });
    check('T007d: _execCall returns non-null for method 2', result2 !== null);
    // Method 2: BRANCH entry at lumpBase+2 → branchOffset=3 → pc=(2-1)+3=4
    check('T007e: sim.pc = 4 (bodyOffset for method 2) after CALL', sim2.pc === 4);
    check('T007f: sentinel1 reachable at lumpBase+1+pc (lumpBase+5)', sim2.memory[entry2.word0_location + 1 + sim2.pc] === SENTINEL1);
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
