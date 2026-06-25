'use strict';
// lump_assembler.js — Shared LUMP assembler logic
//
// Mirrors _assembleLumpFromCatalog in app-absdetail.js (browser source).
// Used by test_catalog_lump.js and test_lump_roundtrip.js so the encoding
// formula lives in exactly one place.
//
// Browser code (app-absdetail.js) cannot use require(), so it keeps its own
// inline copy — but any change to the BRANCH-encoding formula or header
// packing must be applied here and reflected there in the same commit.

const BRANCH_OPCODE = 23; // ★ v2.0 ISA: BRANCH is opcode 23 (was 17)

// Assemble a LUMP binary with a BRANCH-encoded method table.
//
// methodBodies — array of arrays of 32-bit unsigned words, one per method.
//
// Returns:
//   buf          — Uint32Array of exactly totalWords elements (header + table + bodies)
//   methodTable  — array of the assembled BRANCH words (one per method)
//   bodies       — array of body word arrays (same references as input)
//   bodyOffsets  — array of lump-relative PC of each method's first body word
//   totalWords   — total number of words in buf
//   N            — number of methods
function assembleLump(methodBodies) {
    const N = methodBodies.length;
    const methodTable = [];
    const bodies = [];
    const bodyOffsets = [];
    let bodyOffset = N;  // lump-relative PC of first body (table occupies PCs 0..N-1)

    for (let i = 0; i < N; i++) {
        const branchOffset = bodyOffset - i;   // relative to this entry's lump PC (= i)
        methodTable.push(((BRANCH_OPCODE << 27) | (branchOffset & 0x7FFF)) >>> 0);
        bodies.push(methodBodies[i]);
        bodyOffsets.push(bodyOffset);
        bodyOffset += methodBodies[i].length;
    }

    const totalWords = 1 + N + bodies.reduce(function(s, b) { return s + b.length; }, 0);
    const buf = new Uint32Array(totalWords);

    // Word 0: lump header — magic(5) | n_minus_6(4) | cw(13) | cc(8)
    let lumpSize = 64;
    while (lumpSize < totalWords) lumpSize *= 2;
    const n_minus_6 = Math.max(0, Math.round(Math.log2(lumpSize)) - 6);
    const cw = totalWords - 1;
    const cc = 0;
    buf[0] = ((0x1F << 27) | ((n_minus_6 & 0xF) << 23) | ((cw & 0x1FFF) << 10) | (cc & 0xFF)) >>> 0;

    for (let i = 0; i < N; i++) buf[1 + i] = methodTable[i] >>> 0;

    let wp = 1 + N;
    for (const body of bodies) {
        for (const w of body) buf[wp++] = w >>> 0;
    }

    return { buf, methodTable, bodies, bodyOffsets, totalWords, N };
}

// Decode the lump-relative body PC from a BRANCH method-table entry.
//
// Mirrors the CALL dispatcher formula used by the simulator:
//   tableEntryLumpPC = methodIndex - 1
//   new pc = tableEntryLumpPC + branchOffset = bodyOffset
//
// Returns the lump-relative PC of the method body, or null if the word is
// not a BRANCH instruction (legacy bare-address format).
function decodeBranchEntry(tableEntryWord, methodIndex) {
    const opcode = (tableEntryWord >>> 27) & 0x1F;
    if (opcode !== BRANCH_OPCODE) return null;
    const soff = (tableEntryWord & 0x4000)
        ? ((tableEntryWord & 0x7FFF) | 0xFFFF8000)
        : (tableEntryWord & 0x7FFF);
    return (methodIndex - 1) + soff;   // = bodyOffset (lump-relative PC of body)
}

module.exports = { assembleLump, decodeBranchEntry, BRANCH_OPCODE };
