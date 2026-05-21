'use strict';
// test_pet_name_memory.js — Unit tests for petNameMemory population (Task #1544)
// Run:  node simulator/test_pet_name_memory.js
//
// Coverage:
//   T001 — Assembler: no capabilities block → namedSlots is empty
//   T002 — Assembler: single capability → namedSlots has one entry (index 0)
//   T003 — Assembler: three capabilities → namedSlots has indices [0, 1, 2]
//   T004 — Assembler: namedSlots length equals number of capabilities declared
//   T005 — markNamedSlots() adds slots to petNameMemory
//   T006 — markNamedSlots() is additive; does not clear pre-existing slots
//   T007 — markNamedSlots(null) / markNamedSlots(undefined) are no-ops
//   T008 — markNamedSlots() rejects slot >= 64 (silently skipped)
//   T009 — markNamedSlots() rejects negative slot index (silently skipped)
//   T010 — isNamedSlot() returns true for named, false for unnamed
//   T011 — DWRITE to IO_PORT_PET_NAME_WR marks the correct slot
//   T012 — DWRITE to IO_PORT_PET_NAME_WR uses value & 0x3F (low-6-bit mask)
//   T013 — DWRITE to IO_PORT_PET_NAME_WR bypasses mLoad (no lump needed)
//   T014 — DWRITE produces a trace line describing the operation
//   T015 — Boot default petNameMemory contains the expected named slots
//   T016 — Slot 4 is absent from boot defaults (gap in DEMO_CLIST_NAMED_SLOTS)
//   T017 — getState().petNameMemory returns an Array (not a Set)
//   T018 — getState().petNameMemory reflects additions from markNamedSlots()
//   T019 — getState().petNameMemory reflects additions from DWRITE intercept
//   T020 — Full round-trip: assemble → namedSlots → markNamedSlots → getState

const ChurchSimulator  = require('./simulator.js');
const ChurchAssembler  = require('./assembler.js');

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

// Boot default named slots — mirrors hardware/boot_rom.py DEMO_CLIST_NAMED_SLOTS
// and the initialiser in simulator.js constructor.
const BOOT_NAMED_SLOTS = new Set([0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
const IO_PORT_PET_NAME_WR = 0xFFFFFF38;

// Build a minimal simulator (no registry needed for these tests).
function makeSim() {
    return new ChurchSimulator();
}

// Assemble a snippet and return the full result object.
function assemble(src) {
    const asm = new ChurchAssembler();
    return asm.assemble(src);
}

// ── T001–T004: Assembler namedSlots ───────────────────────────────────────────
console.log('\n--- T001–T004: Assembler namedSlots output ---');
{
    // T001 — no capabilities block → namedSlots must be empty
    const result = assemble(`
HALT
`);
    check('T001: no capabilities block → namedSlots is []',
        Array.isArray(result.namedSlots) && result.namedSlots.length === 0);
}
{
    // T002 — single capability
    const result = assemble(`
capabilities { MyLib E }
HALT
`);
    check('T002: single capability → namedSlots = [0]',
        Array.isArray(result.namedSlots) &&
        result.namedSlots.length === 1 &&
        result.namedSlots[0] === 0);
}
{
    // T003 — three capabilities
    const result = assemble(`
capabilities {
  Alpha E
  Beta  E
  Gamma E
}
HALT
`);
    check('T003a: three capabilities → namedSlots has 3 entries',
        Array.isArray(result.namedSlots) && result.namedSlots.length === 3);
    check('T003b: namedSlots = [0, 1, 2]',
        result.namedSlots[0] === 0 &&
        result.namedSlots[1] === 1 &&
        result.namedSlots[2] === 2);
}
{
    // T004 — length equals declared capability count; also ensure no errors
    const result = assemble(`
capabilities { A E, B E, C E, D E }
HALT
`);
    check('T004a: namedSlots.length === capabilities.length',
        result.namedSlots.length === result.capabilities.length);
    check('T004b: no assembler errors',
        result.errors.length === 0);
}

// ── T005–T010: markNamedSlots() and isNamedSlot() ─────────────────────────────
console.log('\n--- T005–T010: markNamedSlots / isNamedSlot ---');
{
    // T005 — markNamedSlots adds slots
    const sim = makeSim();
    sim.markNamedSlots([20, 30, 40]);
    check('T005a: slot 20 added by markNamedSlots', sim.isNamedSlot(20));
    check('T005b: slot 30 added by markNamedSlots', sim.isNamedSlot(30));
    check('T005c: slot 40 added by markNamedSlots', sim.isNamedSlot(40));
}
{
    // T006 — markNamedSlots is additive; pre-existing boot slots survive
    const sim = makeSim();
    sim.markNamedSlots([25]);
    check('T006a: newly added slot 25 present',   sim.isNamedSlot(25));
    check('T006b: boot slot 0 still present',      sim.isNamedSlot(0));
    check('T006c: boot slot 13 still present',     sim.isNamedSlot(13));
}
{
    // T007 — markNamedSlots(null/undefined) must not throw or clear state
    const sim = makeSim();
    let threw = false;
    try {
        sim.markNamedSlots(null);
        sim.markNamedSlots(undefined);
    } catch (e) {
        threw = true;
    }
    check('T007a: markNamedSlots(null) does not throw', !threw);
    check('T007b: boot slots still intact after no-op call', sim.isNamedSlot(0));
}
{
    // T008 — slot >= 64 is silently rejected
    const sim = makeSim();
    sim.markNamedSlots([64, 100, 255]);
    check('T008a: slot 64 not added (out of range)',  !sim.isNamedSlot(64));
    check('T008b: slot 100 not added (out of range)', !sim.isNamedSlot(100));
}
{
    // T009 — negative slot index silently rejected
    const sim = makeSim();
    sim.markNamedSlots([-1, -10]);
    check('T009: negative slots not added', !sim.isNamedSlot(-1) && !sim.isNamedSlot(-10));
}
{
    // T010 — isNamedSlot true/false for known/unknown slots
    const sim = makeSim();
    sim.markNamedSlots([35]);
    check('T010a: isNamedSlot(35) true after markNamedSlots', sim.isNamedSlot(35));
    check('T010b: isNamedSlot(36) false (never added)',       !sim.isNamedSlot(36));
    check('T010c: isNamedSlot(4) false (boot gap)',           !sim.isNamedSlot(4));
}

// ── T011–T014: DWRITE to IO_PORT_PET_NAME_WR ──────────────────────────────────
console.log('\n--- T011–T014: DWRITE to IO_PORT_PET_NAME_WR ---');
{
    // T011 — basic DWRITE intercept marks the correct slot
    const sim = makeSim();
    // Set CR5.word0 = non-null, non-abstract GT; word1 = 0xFFFFFF38 so that
    // (loc + offset) >>> 0 = 0xFFFFFF38 with imm = 0.
    sim.cr[5] = { word0: 1, word1: IO_PORT_PET_NAME_WR, word2: 0, word3: 0, m: 0 };
    sim.dr[0] = 22; // slot index to register
    const beforePC = sim.pc;
    const result = sim._execDwrite({ crDst: 0, crSrc: 5, imm: 0 });
    check('T011a: _execDwrite returns a result (not null/undefined)', !!result);
    check('T011b: slot 22 now named after DWRITE intercept', sim.isNamedSlot(22));
    check('T011c: pc advanced by 1', sim.pc === beforePC + 1);
}
{
    // T012 — DR value masked to low 6 bits (value & 0x3F)
    const sim = makeSim();
    sim.cr[5] = { word0: 1, word1: IO_PORT_PET_NAME_WR, word2: 0, word3: 0, m: 0 };
    // DR value 0x80 | 15 = 143; 143 & 0x3F = 15
    sim.dr[1] = 0x8F; // 0x8F & 0x3F = 0x0F = 15
    sim._execDwrite({ crDst: 1, crSrc: 5, imm: 0 });
    check('T012a: slot 15 marked (0x8F & 0x3F = 15)', sim.isNamedSlot(15));
    check('T012b: slot 0x8F (143) not marked (out of 6-bit range)',
        !sim.isNamedSlot(0x8F));
}
{
    // T013 — DWRITE intercept returns early (bypasses mLoad) even when no
    //         valid lump exists for the CR.  We set word2/word3 to 0 (no seal),
    //         which would normally cause an mLoad failure, but the intercept
    //         fires before that check and should still succeed.
    const sim = makeSim();
    sim.cr[5] = { word0: 1, word1: IO_PORT_PET_NAME_WR, word2: 0, word3: 0, m: 0 };
    sim.dr[0] = 45;
    let threw = false;
    let result = null;
    try {
        result = sim._execDwrite({ crDst: 0, crSrc: 5, imm: 0 });
    } catch (e) {
        threw = true;
    }
    check('T013a: no exception thrown (mLoad bypassed)', !threw);
    check('T013b: slot 45 registered despite missing lump', sim.isNamedSlot(45));
    check('T013c: machine not halted after intercept', !sim.halted);
}
{
    // T014 — DWRITE output contains a human-readable descriptor
    const sim = makeSim();
    sim.cr[5] = { word0: 1, word1: IO_PORT_PET_NAME_WR, word2: 0, word3: 0, m: 0 };
    sim.dr[0] = 33;
    sim._execDwrite({ crDst: 0, crSrc: 5, imm: 0 });
    check('T014a: output contains "IO_PORT_PET_NAME_WR"',
        sim.output.includes('IO_PORT_PET_NAME_WR'));
    check('T014b: output mentions the slot index (33)',
        sim.output.includes('33'));
}

// ── T015–T019: getState().petNameMemory ───────────────────────────────────────
console.log('\n--- T015–T019: getState().petNameMemory ---');
{
    // T015 — boot defaults are all present in getState()
    const sim = makeSim();
    const state = sim.getState();
    const arr = state.petNameMemory;
    check('T015a: getState().petNameMemory is an Array', Array.isArray(arr));
    const stateSet = new Set(arr);
    let allPresent = true;
    for (const s of BOOT_NAMED_SLOTS) {
        if (!stateSet.has(s)) { allPresent = false; break; }
    }
    check('T015b: all boot-default slots present in getState()', allPresent);
}
{
    // T016 — slot 4 is absent from boot defaults (gap in DEMO_CLIST_NAMED_SLOTS)
    const sim = makeSim();
    const state = sim.getState();
    check('T016: slot 4 absent from boot-default petNameMemory',
        !state.petNameMemory.includes(4));
}
{
    // T017 — getState() returns an Array, not a Set (JSON-serialisable)
    const sim = makeSim();
    const mem = sim.getState().petNameMemory;
    check('T017a: petNameMemory is an Array', Array.isArray(mem));
    check('T017b: petNameMemory is not a Set instance', !(mem instanceof Set));
}
{
    // T018 — additions via markNamedSlots() appear in subsequent getState() calls
    const sim = makeSim();
    sim.markNamedSlots([50, 55, 60]);
    const mem = sim.getState().petNameMemory;
    const s = new Set(mem);
    check('T018a: slot 50 reflected in getState() after markNamedSlots', s.has(50));
    check('T018b: slot 55 reflected in getState() after markNamedSlots', s.has(55));
    check('T018c: slot 60 reflected in getState() after markNamedSlots', s.has(60));
}
{
    // T019 — additions via DWRITE intercept appear in getState()
    const sim = makeSim();
    sim.cr[5] = { word0: 1, word1: IO_PORT_PET_NAME_WR, word2: 0, word3: 0, m: 0 };
    sim.dr[0] = 47;
    sim._execDwrite({ crDst: 0, crSrc: 5, imm: 0 });
    const mem = sim.getState().petNameMemory;
    check('T019: slot 47 reflected in getState() after DWRITE intercept',
        new Set(mem).has(47));
}

// ── T020: Full round-trip ──────────────────────────────────────────────────────
console.log('\n--- T020: Full round-trip assemble → markNamedSlots → getState ---');
{
    // Assemble a program with a capabilities block, feed namedSlots into a fresh
    // sim via markNamedSlots(), then verify getState() contains those slots.
    const result = assemble(`
capabilities {
  WidgetA E
  WidgetB E
  WidgetC E
}
HALT
`);
    check('T020a: no assembler errors', result.errors.length === 0);
    check('T020b: namedSlots has 3 entries', result.namedSlots.length === 3);

    const sim = makeSim();
    sim.markNamedSlots(result.namedSlots);

    const mem = new Set(sim.getState().petNameMemory);
    check('T020c: slot 0 present after round-trip', mem.has(0));
    check('T020d: slot 1 present after round-trip', mem.has(1));
    check('T020e: slot 2 present after round-trip', mem.has(2));
    // Boot defaults should still be there too
    check('T020f: boot slot 5 still present after round-trip', mem.has(5));
}

// ── Final summary ──────────────────────────────────────────────────────────────
console.log('');
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
if (fail === 0) {
    console.log(`  ALL ${pass} ASSERTIONS PASSED`);
} else {
    console.log(`  ${pass} passed, ${fail} FAILED`);
}
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
process.exit(fail > 0 ? 1 : 0);
