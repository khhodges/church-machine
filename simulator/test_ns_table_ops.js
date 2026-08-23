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
//   T401 — Add LUMP to first user slot: NS entry is valid after writeNSEntry
//   T402 — Add LUMP: _tokenSlotMap records the token→slot mapping
//   T403 — _nsTableClear first user slot: NS entry word0_location drops to 0
//   T404 — _nsTableClear: gt_seq in NS word2 is bumped by exactly 1
//   T405 — _nsTableClear: token is removed from _tokenSlotMap
//   T406 — _nsTableClear: built-in slots are unchanged after Clear
//   T407 — Boot (sim.reset()) after Add: _tokenSlotMap is empty
//   T408 — Boot (sim.reset()) after Add: boot slots 0–6 are intact
//   T409 — Boot (sim.reset()) after Clear: _tokenSlotMap is still empty
//   T410 — Boot (sim.reset()) after Clear: boot slots 0–6 are intact
//   T411 — Boot (sim.reset()) after Add (no Clear): boot slots 0–6 are intact
//   T412 — After Boot, allocOrFindNsSlot returns first user slot
//   T413 — _nsTableClear guards: slots 0–10 are rejected

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

function writeEntry(sim, ...args) {
    return sim.withNamespaceWrite('test programmer action', () => {
        sim.writeNSEntry(...args);
    });
}

// ── Capture snapshot of NS entries for slots 0–6 ────────────────────────────
function captureBootSlots(sim) {
    const snap = [];
    for (let i = 0; i <= 6; i++) {
        const base = sim._nsSlotBase(i);
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
        _setNsDirty: function() {},
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
    writeEntry(sim, slot, 0x0400, 10, 0, 0, 1, 0, 0, 0);
    sim.nsLabels[slot] = NAME;

    const e = sim.readNSEntry(slot);
    check('T401: Add LUMP to first user slot — NS entry is valid (isNSEntryValid)',
        sim.isNSEntryValid(slot),
        `slot=${slot}, valid=${sim.isNSEntryValid(slot)}`);

    check('T402: Add LUMP — _tokenSlotMap records token→slot (first free programmable slot)',
        sim._tokenSlotMap.has(TOKEN) && sim._tokenSlotMap.get(TOKEN) === slot,
        `has=${sim._tokenSlotMap.has(TOKEN)}, slot=${sim._tokenSlotMap.get(TOKEN)}, expected=${slot}`);
}

// ── T403–T406: _nsTableClear first user slot ─────────────────────────────────
{
    const sim = makeSim();

    const TOKEN = 'test_token_clear';
    const NAME  = 'ClearableAbstr';

    // Capture boot slots BEFORE add
    const bootBefore = captureBootSlots(sim);

    // Add
    const slot = sim.allocOrFindNsSlot(TOKEN, NAME);
    writeEntry(sim, slot, 0x0400, 10, 0, 0, 1, 0, 3, 0);
    sim.nsLabels[slot] = NAME;

    // Canonical NS ABI: gt_seq lives in W1[29:21] (authority word), not W2
    // (W2 is now a pure integrity32 hash). Read the sequence via parseNSWord1.
    const w1Before  = sim.memory[sim._nsSlotBase(slot) + 1] >>> 0;
    const seqBefore = sim.parseNSWord1(w1Before).gtSeq & 0x1FF;

    // Clear
    callNsTableClear(sim, slot);

    // A free slot is represented by four zero words so first-free allocation
    // can immediately reuse it.
    const eAfter = sim.readNSEntry(slot);
    const rawAfter = Array.from(sim.memory.slice(
        sim._nsSlotBase(slot), sim._nsSlotBase(slot) + sim.NS_ENTRY_WORDS));
    check('T403: _nsTableClear user slot — all four NS words are zero after clear',
        eAfter === null && rawAfter.every(word => word === 0),
        `entry=${JSON.stringify(eAfter)}, raw=${rawAfter.join(',')}`);

    // The bumped sequence stays out-of-band while free, then Navana.ADD uses it
    // when the slot is reissued.
    const seqAfter = sim._nsFreeSequences[slot];
    check('T404: _nsTableClear user slot — bumped gt_seq retained for reissue',
        seqAfter === ((seqBefore + 1) & 0x1FF),
        `seqBefore=${seqBefore}, remembered=${seqAfter}`);

    // After clear: token removed from _tokenSlotMap
    check('T405: _nsTableClear user slot — token removed from _tokenSlotMap',
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
    check('T406: _nsTableClear user slot — boot slots 0–5 unchanged',
        bootSlotsSafe);
}

// ── T407–T409: Boot (sim.reset()) after Add — _tokenSlotMap cleared ──────────
{
    const sim = makeSim();

    const TOKEN = 'test_token_boot1';
    const NAME  = 'BootAbstr1';

    // Add LUMP
    const slot = sim.allocOrFindNsSlot(TOKEN, NAME);
    writeEntry(sim, slot, 0x0400, 5, 0, 0, 1, 0, 0, 0);
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
    writeEntry(sim, slot, 0x0400, 8, 0, 0, 1, 0, 0, 0);
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
    writeEntry(sim, slot, 0x0400, 12, 0, 0, 1, 0, 0, 0);
    sim.nsLabels[slot] = NAME;

    // Boot
    sim.reset();

    const bootAfterReset = captureBootSlots(sim);
    check('T411b: Boot after Add (no Clear) — boot slots 0–6 match reference',
        bootSlotsEqual(refSlots, bootAfterReset),
        JSON.stringify(bootAfterReset.map((s, i) =>
            `slot${i}:0x${s.w0.toString(16)}`)));
}

// ── T412: After Boot, allocator returns the first user slot ──────────────────
{
    const sim = makeSim();

    // Add LUMP to the first free programmable slot, then Boot.
    const preSlot = sim.allocOrFindNsSlot('tok_before_boot', 'PreBoot');
    writeEntry(sim, preSlot, 0x0400, 5, 0, 0, 1, 0, 0, 0);
    sim.nsLabels[preSlot] = 'PreBoot';

    sim.reset();

    // After reset the boot catalog restores the same free programmable slot:
    // allocOrFindNsSlot must hand back the same first-free slot (not a bumped one),
    // proving the pre-boot Add left no residue in the NS table after boot.
    const newSlot = sim.allocOrFindNsSlot('tok_after_boot', 'PostBoot');
    check('T412: After Boot, allocOrFindNsSlot returns the first free programmable slot',
        newSlot === preSlot,
        `newSlot=${newSlot}, preSlot=${preSlot}`);
}

// ── T413: _nsTableClear guard — built-in slots are rejected ─────────────────
{
    const sim = makeSim();

    // Capture boot slot 6 (SelfTest) before attempted clear
    const snapBefore = captureBootSlots(sim);

    // Attempt to clear boot slot 6 — should be silently rejected.
    callNsTableClear(sim, 6);

    const snapAfter = captureBootSlots(sim);

    check('T413: _nsTableClear rejects built-in slot 6',
        snapBefore[6].w0 === snapAfter[6].w0 &&
        snapBefore[6].w1 === snapAfter[6].w1 &&
        snapBefore[6].w2 === snapAfter[6].w2,
        `w0: ${snapBefore[6].w0.toString(16)} → ${snapAfter[6].w0.toString(16)}`);
}

// ── Summary ───────────────────────────────────────────────────────────────────
// ── T414: binary image paths preserve W1/W2/W3 exactly ───────────────────────
{
    const seed = makeSim();
    const loc = 0x0123;
    const w1 = seed.packNSWord1(0x12345, 0x101, 1, 0);
    const w2 = seed._integrity32(loc, w1);
    const w3 = 0xC0FFEE42;
    const nsWords = new Uint32Array(256);
    nsWords[4] = loc; nsWords[5] = w1; nsWords[6] = w2; nsWords[7] = w3;

    const fromImage = makeSim();
    fromImage.loadImageFromBinary(nsWords, new Uint32Array(64), null);
    const imageOut = fromImage.exportHardwareImage().namespace;
    check('T414a: loadImage/export preserves nonzero gt_seq W1 and integrity W2',
        imageOut[5] === w1 && imageOut[6] === w2);
    check('T414b: loadImage/export preserves nonzero cache token W3',
        imageOut[7] === w3);

    const fromHardware = makeSim();
    fromHardware.loadHardwareBinary(
        new Uint32Array([seed.packLumpHeader(0, 1, 0, 0), 0]),
        new Uint32Array([0, 0, 0, 0, loc, w1, w2, w3]),
        new Uint32Array(0), null, null);
    const hardwareOut = fromHardware.exportHardwareImage().namespace;
    check('T414c: loadHardwareBinary/export preserves canonical W1/W2',
        hardwareOut[5] === w1 && hardwareOut[6] === w2);
    check('T414d: loadHardwareBinary/export preserves W3 verbatim',
        hardwareOut[7] === w3);

    fromHardware._nsUiTypeHint[1] = 2; // deliberately stale presentation hint
    const free = fromHardware._findFreeSlot(64);
    check('T414e: stale UI type hint cannot hide resident memory from allocator',
        free >= loc + 64, `free=${free}, resident=[${loc},${loc + 64})`);
    fromHardware.reset();
    check('T414f: reset clears non-authoritative UI type hints',
        fromHardware._nsUiTypeHint[1] !== 2);
}

// ── T415: Navana.Init does NOT add any NS entries ─────────────────────────────
// task #2941: Navana.Init must not auto-register SlideRule, Constants, or any
// Scheduler/IRQ entry in the Namespace table.  The NS table after Init must
// match the committed boot-image entries exactly — no more, no less.
{
    const AbstractionRegistry = require('./abstractions.js');

    const sim = makeSim();
    const nsCountBefore = sim.nsCount;
    const snapBefore = [];
    for (let i = 0; i < Math.min(64, nsCountBefore + 5); i++) {
        const base = sim._nsSlotBase(i);
        snapBefore.push({
            w0: sim.memory[base]     >>> 0,
            w1: sim.memory[base + 1] >>> 0,
            w2: sim.memory[base + 2] >>> 0,
            w3: sim.memory[base + 3] >>> 0,
        });
    }

    // Trigger Navana.Init (the path that previously added SlideRule and Constants)
    if (sim.abstractionRegistry) {
        sim.abstractionRegistry.dispatchMethod(5, 'Init', sim, {});
    }

    const nsCountAfter = sim.nsCount;
    check('T415a: Navana.Init does not increase nsCount',
        nsCountAfter === nsCountBefore,
        `nsCountBefore=${nsCountBefore}, nsCountAfter=${nsCountAfter}`);

    // Verify no new valid NS entries appeared above nsCountBefore
    let extraEntries = 0;
    for (let i = nsCountBefore; i < nsCountBefore + 10; i++) {
        if (sim.isNSEntryValid(i)) {
            extraEntries++;
            console.log(`  T415b: unexpected valid NS entry at slot ${i} after Navana.Init`);
        }
    }
    check('T415b: Navana.Init adds zero new valid NS entries',
        extraEntries === 0,
        `extraEntries=${extraEntries}`);

    // Verify existing boot slots are unchanged
    let bootSlotsChanged = false;
    for (let i = 0; i < Math.min(snapBefore.length, nsCountBefore); i++) {
        const base = sim._nsSlotBase(i);
        const w0 = sim.memory[base]     >>> 0;
        const w1 = sim.memory[base + 1] >>> 0;
        if (w0 !== snapBefore[i].w0 || w1 !== snapBefore[i].w1) {
            bootSlotsChanged = true;
            console.log(`  T415c: boot slot ${i} changed after Navana.Init: w0 ${snapBefore[i].w0.toString(16)}→${w0.toString(16)}`);
        }
    }
    check('T415c: Navana.Init leaves all existing NS slots unchanged',
        !bootSlotsChanged);
}

console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
