// save_lump_test.js — regression tests for saveToNamespace / saveToNamespaceAt
//
// Bug: both methods wrote a GT word at memory[loc] (word 0 of the lump slot)
// instead of a valid lump header.  CALL dispatch and lumpSaveLump both check
// bits[31:27] of word 0 for the 0x1F magic — without it they fail immediately.
//
// This file verifies the fix: word 0 is now packLumpHeader(...) with the
// correct magic, cw, n_minus_6, and that the NS entry limit17 is set to
// lumpSize - 1 (power-of-2 aligned, ≥ 64 words).
//
// Run with: node simulator/save_lump_test.js
'use strict';

// simulator.js uses some browser globals; stub the minimum needed for Node.js.
if (typeof window === 'undefined') {
    global.window = { bootConfig: null };
}
if (typeof BOOT_ABSTR_NS_SLOT === 'undefined') {
    global.BOOT_ABSTR_NS_SLOT = 3;
}

const ChurchSimulator = require('./simulator.js');

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
    if (condition) {
        console.log('PASS ' + label);
        passed++;
    } else {
        console.log('FAIL ' + label + (detail !== undefined ? ' — ' + detail : ''));
        failed++;
    }
}

// ── Helper: minimum power-of-2 lump size ≥ 64 that fits 1 + codeLen words ───

function expectedLumpSize(codeLen) {
    let s = 64;
    while (s < 1 + codeLen) s <<= 1;
    return s;
}

// ── T1: saveToNamespace — lump header magic is 0x1F ─────────────────────────
{
    const sim = new ChurchSimulator();
    const words = [0x00000001, 0x00000002, 0x00000003]; // 3 code words
    const idx = sim.saveToNamespace('TestAbstr', words, {R:0,W:0,X:1,L:0,S:0,E:0}, 1);
    const loc = idx * sim.SLOT_SIZE;
    const hdr = sim.parseLumpHeader(sim.memory[loc]);
    assert('T1 saveToNamespace: header magic = 0x1F', hdr.magic === 0x1F,
        `got 0x${hdr.magic.toString(16)}`);
}

// ── T2: saveToNamespace — cw field matches code length ───────────────────────
{
    const sim = new ChurchSimulator();
    const words = [0xAAAAAAAA, 0xBBBBBBBB, 0xCCCCCCCC, 0xDDDDDDDD]; // 4 words
    const idx = sim.saveToNamespace('TestCW', words, {R:0,W:0,X:1,L:0,S:0,E:0}, 1);
    const loc = idx * sim.SLOT_SIZE;
    const hdr = sim.parseLumpHeader(sim.memory[loc]);
    assert('T2 saveToNamespace: cw = code word count', hdr.cw === words.length,
        `got cw=${hdr.cw}, expected ${words.length}`);
}

// ── T3: saveToNamespace — lump size is power-of-2, ≥ 64 ─────────────────────
{
    const sim = new ChurchSimulator();
    const words = new Array(10).fill(0x12345678);
    const idx = sim.saveToNamespace('TestSize', words, {R:0,W:0,X:1,L:0,S:0,E:0}, 1);
    const loc = idx * sim.SLOT_SIZE;
    const hdr = sim.parseLumpHeader(sim.memory[loc]);
    const exp = expectedLumpSize(words.length);
    assert('T3 saveToNamespace: lumpSize is power-of-2 ≥ 64', hdr.lumpSize === exp,
        `got ${hdr.lumpSize}, expected ${exp}`);
}

// ── T4: saveToNamespace — code words start at word 1 ────────────────────────
{
    const sim = new ChurchSimulator();
    const words = [0xDEADBEEF, 0xCAFEBABE, 0x12345678];
    const idx = sim.saveToNamespace('TestWords', words, {R:0,W:0,X:1,L:0,S:0,E:0}, 1);
    const loc = idx * sim.SLOT_SIZE;
    let ok = true;
    for (let i = 0; i < words.length; i++) {
        if ((sim.memory[loc + 1 + i] >>> 0) !== (words[i] >>> 0)) { ok = false; break; }
    }
    assert('T4 saveToNamespace: code words stored at word 1..N', ok);
}

// ── T5: saveToNamespace — NS entry limit17 = lumpSize - 1 ───────────────────
{
    const sim = new ChurchSimulator();
    const words = new Array(5).fill(0xABCDEF01);
    const idx = sim.saveToNamespace('TestLimit', words, {R:0,W:0,X:1,L:0,S:0,E:0}, 1);
    const nse = sim.readNSEntry(idx);
    const lim = sim.parseNSWord1(nse.word1_limit);
    const exp = expectedLumpSize(words.length) - 1;
    assert('T5 saveToNamespace: NS limit17 = lumpSize - 1', lim.limit === exp,
        `got ${lim.limit}, expected ${exp}`);
}

// ── T6: saveToNamespace — parseLumpHeader.valid is true ─────────────────────
{
    const sim = new ChurchSimulator();
    const words = [0x00000001];
    const idx = sim.saveToNamespace('TestValid', words, {R:0,W:0,X:1,L:0,S:0,E:0}, 1);
    const loc = idx * sim.SLOT_SIZE;
    const hdr = sim.parseLumpHeader(sim.memory[loc]);
    assert('T6 saveToNamespace: parseLumpHeader.valid = true', hdr.valid === true,
        `magic=0x${hdr.magic.toString(16)}`);
}

// ── T7: saveToNamespace — large code (> 63 words → 128-word lump) ───────────
{
    const sim = new ChurchSimulator();
    const words = new Array(70).fill(0x11111111); // needs lumpSize = 128
    const idx = sim.saveToNamespace('TestLarge', words, {R:0,W:0,X:1,L:0,S:0,E:0}, 1);
    const loc = idx * sim.SLOT_SIZE;
    const hdr = sim.parseLumpHeader(sim.memory[loc]);
    assert('T7 saveToNamespace (70 words): lumpSize = 128', hdr.lumpSize === 128,
        `got ${hdr.lumpSize}`);
    assert('T7 saveToNamespace (70 words): magic = 0x1F', hdr.magic === 0x1F,
        `got 0x${hdr.magic.toString(16)}`);
    assert('T7 saveToNamespace (70 words): cw = 70', hdr.cw === 70,
        `got ${hdr.cw}`);
}

// ── T8: saveToNamespaceAt — lump header magic is 0x1F ───────────────────────
{
    const sim = new ChurchSimulator();
    const words = [0x00000001, 0x00000002];
    sim.saveToNamespaceAt(7, 'SlotSeven', words, {R:0,W:0,X:1,L:0,S:0,E:0}, 1);
    const loc = 7 * sim.SLOT_SIZE;
    const hdr = sim.parseLumpHeader(sim.memory[loc]);
    assert('T8 saveToNamespaceAt: header magic = 0x1F', hdr.magic === 0x1F,
        `got 0x${hdr.magic.toString(16)}`);
}

// ── T9: saveToNamespaceAt — cw and code words correct ───────────────────────
{
    const sim = new ChurchSimulator();
    const words = [0x11111111, 0x22222222, 0x33333333];
    sim.saveToNamespaceAt(5, 'SlotFive', words, {R:0,W:0,X:1,L:0,S:0,E:0}, 1);
    const loc = 5 * sim.SLOT_SIZE;
    const hdr = sim.parseLumpHeader(sim.memory[loc]);
    assert('T9 saveToNamespaceAt: cw = 3', hdr.cw === words.length,
        `got ${hdr.cw}`);
    let ok = true;
    for (let i = 0; i < words.length; i++) {
        if ((sim.memory[loc + 1 + i] >>> 0) !== (words[i] >>> 0)) { ok = false; break; }
    }
    assert('T9 saveToNamespaceAt: code words at words 1..N', ok);
}

// ── T10: saveToNamespaceAt — NS entry limit17 = lumpSize - 1 ────────────────
{
    const sim = new ChurchSimulator();
    const words = new Array(8).fill(0xF0F0F0F0);
    sim.saveToNamespaceAt(9, 'SlotNine', words, {R:0,W:0,X:1,L:0,S:0,E:0}, 1);
    const nse = sim.readNSEntry(9);
    const lim = sim.parseNSWord1(nse.word1_limit);
    const exp = expectedLumpSize(words.length) - 1;
    assert('T10 saveToNamespaceAt: NS limit17 = lumpSize - 1', lim.limit === exp,
        `got ${lim.limit}, expected ${exp}`);
}

// ── T11: saveToNamespace — overwrite by label keeps correct header ───────────
{
    const sim = new ChurchSimulator();
    const words1 = [0xAAAAAAAA, 0xBBBBBBBB];
    const words2 = [0x11111111, 0x22222222, 0x33333333, 0x44444444];
    const idx1 = sim.saveToNamespace('Overwrite', words1, {R:0,W:0,X:1,L:0,S:0,E:0}, 1);
    const idx2 = sim.saveToNamespace('Overwrite', words2, {R:0,W:0,X:1,L:0,S:0,E:0}, 1);
    assert('T11 overwrite uses same slot index', idx1 === idx2, `${idx1} vs ${idx2}`);
    const loc = idx2 * sim.SLOT_SIZE;
    const hdr = sim.parseLumpHeader(sim.memory[loc]);
    assert('T11 overwrite: magic = 0x1F', hdr.magic === 0x1F);
    assert('T11 overwrite: cw updated to 4', hdr.cw === 4, `got ${hdr.cw}`);
}

// ── T12: regression — old code wrote GT word at word 0 (magic ≠ 0x1F) ───────
//
// With the old code, memory[loc] = createGT(0, idx, {X:1}, 1):
//   b_flag=0, perms={X} → permBits=0b000100 → bits[30:25] → bit 27 set
//   bits[31:27] = 0b00001 = 0x01 ≠ 0x1F → parseLumpHeader.valid = false
//
// The fix writes packLumpHeader which always sets bits[31:27] = 0x1F.
// This test double-checks the old value would have failed, as documentation.
{
    const sim = new ChurchSimulator();
    // Simulate what the old code did: write a GT word at word 0.
    const fakeGT = sim.createGT(0, 10, {R:0,W:0,X:1,L:0,S:0,E:0}, 1);
    const oldHdr = sim.parseLumpHeader(fakeGT);
    assert('T12 regression guard: old GT word had magic ≠ 0x1F', oldHdr.magic !== 0x1F,
        `magic=0x${oldHdr.magic.toString(16)} (should not be 0x1F)`);
    // And confirm the fix produces valid magic:
    const sim2 = new ChurchSimulator();
    const words = [0x00000001, 0x00000002];
    const idx = sim2.saveToNamespace('RegCheck', words, {R:0,W:0,X:1,L:0,S:0,E:0}, 1);
    const loc = idx * sim2.SLOT_SIZE;
    const newHdr = sim2.parseLumpHeader(sim2.memory[loc]);
    assert('T12 regression: fixed code produces magic = 0x1F', newHdr.magic === 0x1F,
        `got 0x${newHdr.magic.toString(16)}`);
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
