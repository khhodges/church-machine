'use strict';
// test_receive_lump_crc.js — CRC validation tests for ChurchSimulator.receiveLump()
//
// Verifies that:
//   1. A valid lump (correct CRC preamble) installs successfully (ok: true).
//   2. A lump with a flipped CRC preamble raises OUTFORM_CRC.
//   3. A lump with a flipped payload byte raises OUTFORM_CRC.
//
// Usage:
//   node tests/test_receive_lump_crc.js

global.window = {
    bootConfig: {
        step1: {
            totalNamespaceWords:  16384,
            namespaceLumpWords:      64,
            threadLumpWords:        256,
        },
        step2: { lumps: [] },
        step3: { baseNamedNsCount: 17, emptySlotCount: 0 },
    },
};

const ChurchSimulator = require('../../simulator/simulator.js');

// ── Lump construction helpers ──────────────────────────────────────────────────
//
// Minimal valid lump payload (64 words, n_minus_6=0 → lumpSize=64):
//   word 0  — lump header: magic=0x1F, n_minus_6=0, cw=1, typ=0, cc=0
//   word 1  — one code word (HALT-like zero instruction)
//   words 2-63 — zero padding
//
// lump header encoding:
//   bits 31:27  magic      = 0x1F
//   bits 26:23  n_minus_6  = 0   (lumpSize = 1 << (0+6) = 64)
//   bits 22:10  cw         = 1   (one code word)
//   bits 9:8    typ        = 0
//   bits 7:0    cc         = 0   (no c-list entries)

const LUMP_SIZE = 64;
const LUMP_HDR  = ((0x1F << 27) | (0 << 23) | (1 << 10) | (0 << 8) | 0) >>> 0;

function makeValidPayload() {
    const payload = new Array(LUMP_SIZE).fill(0);
    payload[0] = LUMP_HDR;
    payload[1] = 0x00000000;
    return payload;
}

function makeValidLump(sim) {
    const payload = makeValidPayload();
    const crc = sim._crc32Words(payload);
    return [crc, ...payload];
}

function makeSim() {
    const sim = new ChurchSimulator();
    sim.awaitingLump = { nsIndex: 5, retryPC: 0 };
    return sim;
}

// ── Assertion helpers ──────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;

function check(condition, description) {
    if (condition) {
        console.log(`  PASS  ${description}`);
        pass++;
    } else {
        console.error(`  FAIL  ${description}`);
        fail++;
    }
}

// ── Test 1: valid lump installs successfully ───────────────────────────────────

console.log('\nTest 1: valid lump with correct CRC preamble → ok: true');
{
    const sim    = makeSim();
    const lump   = makeValidLump(sim);
    const result = sim.receiveLump(lump);

    check(result.ok === true,          'result.ok is true');
    check(sim.faultLog.length === 0,   'no fault raised');
    check(sim.awaitingLump === null,   'awaitingLump cleared after install');
    check(sim.halted === false,        'simulator not halted');
}

// ── Test 2: corrupted CRC preamble → OUTFORM_CRC ──────────────────────────────

console.log('\nTest 2: lump with flipped CRC preamble → OUTFORM_CRC fault');
{
    const sim  = makeSim();
    const lump = makeValidLump(sim);
    lump[0]    = (lump[0] ^ 0xDEADBEEF) >>> 0;
    const result = sim.receiveLump(lump);

    check(result.ok === false,                     'result.ok is false');
    check(sim.faultLog.length > 0,                 'a fault was raised');
    check(sim.faultLog[0].type === 'OUTFORM_CRC',  `fault type is OUTFORM_CRC (got: ${sim.faultLog[0]?.type})`);
    check(sim.awaitingLump === null,               'awaitingLump cleared on fault');
    check(sim.halted === true,                     'simulator halted on fault');
}

// ── Test 3: flipped payload byte → OUTFORM_CRC ────────────────────────────────

console.log('\nTest 3: lump with flipped payload byte → OUTFORM_CRC fault');
{
    const sim  = makeSim();
    const lump = makeValidLump(sim);
    lump[2]    = (lump[2] ^ 0xFF000000) >>> 0;
    const result = sim.receiveLump(lump);

    check(result.ok === false,                     'result.ok is false');
    check(sim.faultLog.length > 0,                 'a fault was raised');
    check(sim.faultLog[0].type === 'OUTFORM_CRC',  `fault type is OUTFORM_CRC (got: ${sim.faultLog[0]?.type})`);
    check(sim.awaitingLump === null,               'awaitingLump cleared on fault');
    check(sim.halted === true,                     'simulator halted on fault');
}

// ── Summary ────────────────────────────────────────────────────────────────────

console.log(`\n─────────────────────────────────────────────────────`);
console.log(`${pass + fail} assertions: ${pass} passed, ${fail} failed`);
if (fail > 0) {
    process.exit(1);
}
