'use strict';
// test_ns_table_ops.js — Regression tests for NS slot Add/Clear + Boot survival
//
// Verifies that _nsTableClear() correctly revokes tokens and zeroes entries,
// and that sim.reset() (Boot) fully restores boot slots 0–6 without any
// corruption from prior Add/Clear operations.
//
// Run:  node simulator/test_ns_table_ops.js
//
// Coverage:
//   T401 — Add LUMP to slot 7: NS entry is valid after writeNSEntry
//   T402 — Add LUMP to slot 7: _tokenSlotMap records the token→slot mapping
//   T403 — _nsTableClear slot 7: NS entry word0_location drops to 0
//   T404 — _nsTableClear slot 7: gt_seq in NS word2 is bumped by exactly 1
//   T405 — _nsTableClear slot 7: token is removed from _tokenSlotMap
//   T406 — _nsTableClear slot 7: boot slots 0–5 are unchanged after Clear
//   T407 — Boot (sim.reset()) after Add: _tokenSlotMap is empty
//   T408 — Boot (sim.reset()) after Add: boot slots 0–6 are intact
//   T409 — Boot (sim.reset()) after Clear: _tokenSlotMap is still empty
//   T410 — Boot (sim.reset()) after Clear: boot slots 0–6 are intact
//   T411 — Boot (sim.reset()) after Add (no Clear): boot slots 0–6 are intact
//   T412 — After Boot, allocOrFindNsSlot returns slot 7 (programmable slot free)
//   T413 — _nsTableClear guards: slot < 7 is rejected (boot slots protected)

const vm   = require('vm');
const fs   = require('fs');
const path = require('path');

const ChurchSimulator     = require('./simulator.js');
const AbstractionRegistry = require('./abstractions.js');

let pass = 0;
let fail = 0;

function check(label, cond, detail) {
    if (cond) {
        console.log(`PASS ${label}`);
        pass++;
    } else {
        console.log(`FAIL ${label}${detail ? ': ' + detail : ''}`);
        fail++;
    }
}

// ── Extract _nsTableClear from app-memory.js (same technique as test_ns_slot_dynamic.js) ──
function extractTopLevelFn(sourceFile, fnName) {
    const src   = fs.readFileSync(path.join(__dirname, sourceFile), 'utf8');
    const lines = src.split('\n');
    const startPattern = `function ${fnName}(`;
    let collecting = false;
    let depth = 0;
    const buf = [];
    for (const line of lines) {
        if (!collecting && line.startsWith(startPattern)) collecting = true;
        if (!collecting) continue;
        buf.push(line);
        for (const ch of line) {
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
        }
        if (depth === 0 && buf.length > 1) break;
    }
    if (buf.length === 0) throw new Error(`"${fnName}" not found in ${sourceFile}`);
    return buf.join('\n');
}

const nsTableClearSrc = extractTopLevelFn('app-memory.js', '_nsTableClear');

// ── Minimal simulator factory ─────────────────────────────────────────────────
function makeSim() {
    const reg = new AbstractionRegistry();
    const sim = new ChurchSimulator();
    sim.abstractionRegistry = reg;
    sim.bootComplete = true;
    return sim;
}

// ── Capture snapshot of NS entries for slots 0–6 ────────────────────────────
function captureBootSlots(sim) {
    const snap = [];
    for (let i = 0; i <= 6; i++) {
        const base = sim.NS_TABLE_BASE + i * sim.NS_ENTRY_WORDS;
        snap.push({
            w0: sim.memory[base]     >>> 0,
            w1: sim.memory[base + 1] >>> 0,
            w2: sim.memory[base + 2] >>> 0,
            w3: sim.memory[base + 3] >>> 0,
        });
    }
    return snap;
}

function bootSlotsEqual(a, b) {
    for (let i = 0; i <= 6; i++) {
        if (a[i].w0 !== b[i].w0) return false;
        if (a[i].w1 !== b[i].w1) return false;
        if (a[i].w2 !== b[i].w2) return false;
        if (a[i].w3 !== b[i].w3) return false;
    }
    return true;
}

// ── Invoke _nsTableClear(slot) inside a minimal vm sandbox ───────────────────
// The function references `sim` as a global and calls `updateNamespace()`.
// We stub the latter so the function can run without a DOM.
function callNsTableClear(simInst, slot) {
    const sandbox = vm.createContext({
        sim: simInst,
        updateNamespace: function() {},
    });
    vm.runInContext(nsTableClearSrc, sandbox);
    vm.runInContext(`_nsTableClear(${slot});`, sandbox);
}

// ── T401–T402: Add LUMP to slot 7 ────────────────────────────────────────────
{
    const sim = makeSim();

    const TOKEN = 'test_token_abc';
    const NAME  = 'TestAbstr';

    // Simulate what _nsTableAddConfirm does (without the fetch):
    const slot = sim.allocOrFindNsSlot(TOKEN, NAME);
    sim.writeNSEntry(slot, 0x0400, 10, 0, 0, 1, 0, 0, 0);
    sim.nsLabels[slot] = NAME;

    const e = sim.readNSEntry(slot);
    check('T401: Add LUMP to slot 7 — NS entry is valid (isNSEntryValid)',
        sim.isNSEntryValid(slot),
        `slot=${slot}, valid=${sim.isNSEntryValid(slot)}`);

    check('T402: Add LUMP to slot 7 — _tokenSlotMap records token→slot',
        sim._tokenSlotMap.has(TOKEN) && sim._tokenSlotMap.get(TOKEN) === 7,
        `has=${sim._tokenSlotMap.has(TOKEN)}, slot=${sim._tokenSlotMap.get(TOKEN)}`);
}

// ── T403–T406: _nsTableClear slot 7 ──────────────────────────────────────────
{
    const sim = makeSim();

    const TOKEN = 'test_token_clear';
    const NAME  = 'ClearableAbstr';

    // Capture boot slots BEFORE add
    const bootBefore = captureBootSlots(sim);

    // Add
    const slot = sim.allocOrFindNsSlot(TOKEN, NAME);
    sim.writeNSEntry(slot, 0x0400, 10, 0, 0, 1, 0, 3, 0);
    sim.nsLabels[slot] = NAME;

    // Read gt_seq from word2 before clear
    const w2Before = sim.memory[sim.NS_TABLE_BASE + slot * sim.NS_ENTRY_WORDS + 2] >>> 0;
    const seqBefore = (w2Before >>> 25) & 0x7F;

    // Clear
    callNsTableClear(sim, slot);

    // After clear: word0_location should be 0
    const eAfter = sim.readNSEntry(slot);
    check('T403: _nsTableClear slot 7 — NS entry word0_location is 0 after clear',
        eAfter === null || eAfter.word0_location === 0,
        `word0_location=${eAfter ? eAfter.word0_location : 'null'}`);

    // After clear: gt_seq bumped by 1
    const w2After  = sim.memory[sim.NS_TABLE_BASE + slot * sim.NS_ENTRY_WORDS + 2] >>> 0;
    const seqAfter = (w2After >>> 25) & 0x7F;
    check('T404: _nsTableClear slot 7 — gt_seq bumped by 1',
        seqAfter === ((seqBefore + 1) & 0x7F),
        `seqBefore=${seqBefore}, seqAfter=${seqAfter}`);

    // After clear: token removed from _tokenSlotMap
    check('T405: _nsTableClear slot 7 — token removed from _tokenSlotMap',
        !sim._tokenSlotMap.has(TOKEN),
        `tokenSlotMap.has=${sim._tokenSlotMap.has(TOKEN)}`);

    // Boot slots 0–5 must be unchanged by the clear
    const bootAfterClear = captureBootSlots(sim);
    let bootSlotsSafe = true;
    for (let i = 0; i <= 5; i++) {
        if (bootBefore[i].w0 !== bootAfterClear[i].w0 ||
            bootBefore[i].w1 !== bootAfterClear[i].w1) {
            bootSlotsSafe = false;
            console.log(`  slot ${i} changed: w0 ${bootBefore[i].w0.toString(16)}→${bootAfterClear[i].w0.toString(16)}`);
        }
    }
    check('T406: _nsTableClear slot 7 — boot slots 0–5 unchanged',
        bootSlotsSafe);
}

// ── T407–T409: Boot (sim.reset()) after Add — _tokenSlotMap cleared ──────────
{
    const sim = makeSim();

    const TOKEN = 'test_token_boot1';
    const NAME  = 'BootAbstr1';

    // Add LUMP
    const slot = sim.allocOrFindNsSlot(TOKEN, NAME);
    sim.writeNSEntry(slot, 0x0400, 5, 0, 0, 1, 0, 0, 0);
    sim.nsLabels[slot] = NAME;

    // Capture boot slots before reset
    const bootBefore = captureBootSlots(sim);

    // Simulate Boot — calls sim.reset() which clears _tokenSlotMap and re-inits NS table
    sim.reset();

    check('T407: Boot after Add — _tokenSlotMap is empty',
        sim._tokenSlotMap.size === 0,
        `_tokenSlotMap.size=${sim._tokenSlotMap.size}`);

    // Boot slots 0-6 should be rebuilt by _initNamespaceTable
    const bootAfterReset = captureBootSlots(sim);
    let slotsMatch = true;
    for (let i = 0; i <= 6; i++) {
        if (bootBefore[i].w0 !== bootAfterReset[i].w0 ||
            bootBefore[i].w1 !== bootAfterReset[i].w1 ||
            bootBefore[i].w2 !== bootAfterReset[i].w2 ||
            bootBefore[i].w3 !== bootAfterReset[i].w3) {
            slotsMatch = false;
            console.log(`  slot ${i} mismatch after Boot:`);
            console.log(`    before: w0=0x${bootBefore[i].w0.toString(16)} w1=0x${bootBefore[i].w1.toString(16)}`);
            console.log(`    after:  w0=0x${bootAfterReset[i].w0.toString(16)} w1=0x${bootAfterReset[i].w1.toString(16)}`);
        }
    }
    check('T408: Boot after Add — boot slots 0–6 intact after sim.reset()',
        slotsMatch);

    check('T409: Boot after Add — _tokenSlotMap still empty (second check)',
        !sim._tokenSlotMap.has(TOKEN),
        `has token=${sim._tokenSlotMap.has(TOKEN)}`);
}

// ── T410–T411: Boot after Clear — boot slots intact ──────────────────────────
{
    const sim = makeSim();

    const TOKEN = 'test_token_boot2';
    const NAME  = 'BootAbstr2';

    // Capture the reference boot-slot snapshot from a fresh sim
    const refSim = makeSim();
    const refSlots = captureBootSlots(refSim);

    // Add LUMP, then Clear, then Boot
    const slot = sim.allocOrFindNsSlot(TOKEN, NAME);
    sim.writeNSEntry(slot, 0x0400, 8, 0, 0, 1, 0, 0, 0);
    sim.nsLabels[slot] = NAME;

    callNsTableClear(sim, slot);

    // Boot
    sim.reset();

    check('T410: Boot after Clear — _tokenSlotMap is empty',
        sim._tokenSlotMap.size === 0,
        `_tokenSlotMap.size=${sim._tokenSlotMap.size}`);

    const bootAfterReset = captureBootSlots(sim);
    check('T411: Boot after Clear — boot slots 0–6 match reference snapshot',
        bootSlotsEqual(refSlots, bootAfterReset),
        JSON.stringify(bootAfterReset.map((s, i) =>
            `slot${i}:0x${s.w0.toString(16)}`)));
}

// ── T411 variant: Boot after Add (no Clear) — boot slots intact ───────────────
{
    const sim = makeSim();

    const TOKEN = 'test_token_boot3';
    const NAME  = 'BootAbstr3';

    const refSim = makeSim();
    const refSlots = captureBootSlots(refSim);

    // Add LUMP but do NOT clear — just Boot directly
    const slot = sim.allocOrFindNsSlot(TOKEN, NAME);
    sim.writeNSEntry(slot, 0x0400, 12, 0, 0, 1, 0, 0, 0);
    sim.nsLabels[slot] = NAME;

    // Boot
    sim.reset();

    const bootAfterReset = captureBootSlots(sim);
    check('T411b: Boot after Add (no Clear) — boot slots 0–6 match reference',
        bootSlotsEqual(refSlots, bootAfterReset),
        JSON.stringify(bootAfterReset.map((s, i) =>
            `slot${i}:0x${s.w0.toString(16)}`)));
}

// ── T412: After Boot, allocOrFindNsSlot returns slot 7 ───────────────────────
{
    const sim = makeSim();

    // Add LUMP, then Boot
    sim.allocOrFindNsSlot('tok_before_boot', 'PreBoot');
    sim.writeNSEntry(7, 0x0400, 5, 0, 0, 1, 0, 0, 0);
    sim.nsLabels[7] = 'PreBoot';

    sim.reset();

    // After reset slot 7 should be free again (boot catalog has null at slot 7)
    const newSlot = sim.allocOrFindNsSlot('tok_after_boot', 'PostBoot');
    check('T412: After Boot, allocOrFindNsSlot returns slot 7 (programmable slot free)',
        newSlot === 7,
        `newSlot=${newSlot}`);
}

// ── T413: _nsTableClear guard — slot < 7 is rejected ─────────────────────────
{
    const sim = makeSim();

    // Capture boot slot 6 (SelfTest) before attempted clear
    const snapBefore = captureBootSlots(sim);

    // Attempt to clear boot slot 6 — should be silently rejected (slot < 7 guard)
    callNsTableClear(sim, 6);

    const snapAfter = captureBootSlots(sim);

    check('T413: _nsTableClear rejects slot < 7 — boot slot 6 unchanged',
        snapBefore[6].w0 === snapAfter[6].w0 &&
        snapBefore[6].w1 === snapAfter[6].w1 &&
        snapBefore[6].w2 === snapAfter[6].w2,
        `w0: ${snapBefore[6].w0.toString(16)} → ${snapAfter[6].w0.toString(16)}`);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
