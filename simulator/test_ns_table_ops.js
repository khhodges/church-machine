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
//   T425 — Clear removes symbolic slots 14 and 15 without redraw rehydration

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
const hydrateSymbolicSrc = extractTopLevelFn('app-memory.js', '_hydrateNsSymbolicState');
const inheritSavedMetadataSrc = extractTopLevelFn('app-memory.js', '_nsInheritSavedArtifactMetadata');

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
        window: {},
        updateNamespace: function() {},
        _setNsDirty: function() {},
    });
    vm.runInContext(nsTableClearSrc, sandbox);
    vm.runInContext(`_nsTableClear(${slot});`, sandbox);
}

function callNsTableClearWithHydration(simInst, slots) {
    const nsState = {
        abstractions: slots.map(slot => ({
            name: `Future.Service${slot}`,
            slot,
            seq: 0,
            symbolic: true,
            implementationMissing: true,
            resident: false,
        })),
    };
    const sandbox = vm.createContext({
        sim: simInst,
        window: { _nsState: nsState },
        _setNsDirty: function() {},
        updateNamespace: function() {},
    });
    vm.runInContext(hydrateSymbolicSrc, sandbox);
    sandbox.updateNamespace = function() {
        vm.runInContext('_hydrateNsSymbolicState();', sandbox);
    };
    vm.runInContext(nsTableClearSrc, sandbox);
    for (const slot of slots) {
        vm.runInContext(`_nsTableClear(${slot});`, sandbox);
    }
    return sandbox;
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

{
    const sim = makeSim();
    sim.defineSymbolicAbstraction('Future.Service14', 14);
    sim.defineSymbolicAbstraction('Future.Service15', 15);
    const sandbox = callNsTableClearWithHydration(sim, [14, 15]);
    check('T425: clearing symbolic slots 14 and 15 survives Namespace redraw',
        !sim.isNSEntryValid(14) && !sim.isNSEntryValid(15) &&
        !sim.symbolicEntryAt(14) && !sim.symbolicEntryAt(15) &&
        sandbox.window._nsState.abstractions.length === 0,
        `valid14=${sim.isNSEntryValid(14)}, valid15=${sim.isNSEntryValid(15)}`);
}

// ── Summary ───────────────────────────────────────────────────────────────────
// ── Symbolic definitions: validation, allocation, sequence, and GT ─────────────
{
    const sim = makeSim();
    const first = sim.firstUserNsSlot();
    sim._nsFreeSequences[first] = 7;
    const result = sim.defineSymbolicAbstraction('Future.Service', null);
    check('T414: symbolic abstraction auto-allocates through shared allocator',
        result.slot === first);
    check('T415: symbolic abstraction uses retained sequence',
        result.seq === 7);
    check('T416: symbolic abstraction mints local Inform E GT',
        result.gt === sim.createGT(7, first, { E: 1 }, 1));
    check('T417: symbolic abstraction is a valid code-free Namespace entry',
        sim.isNSEntryValid(first) && sim.readNSEntry(first).word0_location === 0 &&
        sim.symbolicEntryAt(first).implementationMissing === true);
    let malformedRejected = false;
    try { sim.defineSymbolicAbstraction('NotDotted', null); } catch (_) { malformedRejected = true; }
    check('T418: symbolic abstraction rejects malformed non-dotted name', malformedRejected);
    let duplicateRejected = false;
    try { sim.defineSymbolicAbstraction('future.service', null); } catch (_) { duplicateRejected = true; }
    check('T419: symbolic abstraction rejects duplicate live dot-name', duplicateRejected);
}

{
    const sim = makeSim();
    const result = sim.defineSymbolicAbstraction('Fresh.Sequence', null);
    check('T420: fresh symbolic abstraction starts at sequence zero',
        result.seq === 0);
    const load = sim.mLoad(result.gt, 'X', result.slot);
    check('T421: symbolic mLoad fails with actionable implementation-missing error',
        load && load.ok === false && load.fault === 'CODE_NOT_RESIDENT' &&
        /implementation is missing.*Install a matching LUMP/i.test(load.message),
        load && load.message);

    let callFault = null;
    sim.cr[0].word0 = result.gt;
    sim._mwinWriteback = () => true;
    sim.fault = (type, message) => { callFault = { type, message }; };
    sim._execCall({ crDst: 0, imm: 0 });
    check('T422: symbolic CALL fails with actionable implementation-missing error',
        callFault && callFault.type === 'CODE_NOT_RESIDENT' &&
        /implementation is missing.*Install a matching LUMP/i.test(callFault.message),
        callFault && callFault.message);
}

{
    const sim = makeSim();
    const slot = sim.firstUserNsSlot();
    sim._nsFreeSequences[slot] = 7;
    sim.defineSymbolicAbstraction('Race.Safe', slot);
    sim._nsSymbolicEntries = {};
    sim.nsLabels[slot] = 'Slot ' + slot;
    const sandbox = vm.createContext({
        sim,
        window: { _nsState: { abstractions: [{
            name: 'Race.Safe', slot, seq: 7, type: 'Inform',
            symbolic: true, implementationMissing: true, resident: false,
        }] } },
    });
    vm.runInContext(hydrateSymbolicSrc, sandbox);
    vm.runInContext('_hydrateNsSymbolicState();', sandbox);
    check('T423: boot-first hydration restores retained-sequence symbolic metadata',
        sim.symbolicEntryAt(slot) && sim.symbolicEntryAt(slot).seq === 7 &&
        sim.nsLabels[slot] === 'Race.Safe');

    const namespaceWords = sim.exportHardwareImage().namespace;
    sim.loadImageFromBinary(namespaceWords, new Uint32Array(64), null);
    vm.runInContext('_hydrateNsSymbolicState();', sandbox);
    check('T423b: ns-state-first hydration survives the later boot-image load',
        sim.symbolicEntryAt(slot) && sim.symbolicEntryAt(slot).seq === 7 &&
        sim.parseNSWord1(sim.memory[sim._nsSlotBase(slot) + 1]).gtSeq === 7);
}

{
    const sandbox = vm.createContext({});
    vm.runInContext(inheritSavedMetadataSrc, sandbox);
    const inherited = vm.runInContext(
        `_nsInheritSavedArtifactMetadata(
            {name:'Old.Service', symbolic:true, implementationMissing:true, resident:false},
            {name:'Old.Service', token:'deadbeef', filename:'Old.Service.lump',
             binaryHash:'a'.repeat(64), resident:true},
            true)`,
        sandbox);
    check('T424: symbolic saves never inherit stale binary metadata',
        inherited.token === undefined && inherited.filename === undefined &&
        inherited.binaryHash === undefined && inherited.resident === false);
}

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

// Read-only, variable-sized allocation used by the real Add LUMP modal.
{
    const sim = makeSim();
    const before = sim.memory.slice();
    const first = sim.findFreeLumpRange(512);
    check('T416: 512-word Alice-sized LUMP has a complete aligned extent',
        first === 0x800 && first + 512 <= sim.NS_TABLE_BASE);
    check('T417: allocation preflight does not mutate memory or Namespace',
        sim.memory.every((word, index) => word === before[index]));

    sim.memory[first] = sim.packLumpHeader(3, 9, 2, 0);
    const slot = sim.firstUserNsSlot();
    writeEntry(sim, slot, first, 9, 0, 0, 1, 0, 2, 0);
    check('T418: next 512-word body cannot overlap previous body',
        sim.findFreeLumpRange(512) === first + 512);

    sim.memory[first] = 0; // lazy header absent; manifest still owns full extent
    sim.lazyManifest[slot] = { allocBase: first, allocSize: 512 };
    check('T419: evicted lazy body retains full reservation',
        sim.findFreeLumpRange(512) === first + 512);
    delete sim.lazyManifest[slot];
    const failedBefore = sim.memory.slice();
    let unknown = '';
    try { sim.findFreeLumpRange(512); } catch (err) { unknown = err.message; }
    check('T420: unknown size at programmable address fails closed without mutation',
        /trustworthy allocation size/.test(unknown) &&
        sim.memory.every((word, index) => word === failedBefore[index]));
}
{
    const sim = makeSim();
    sim.NS_TABLE_BASE = 0xa00;
    sim.nsCount = sim.firstUserNsSlot();
    sim.memory[0x800] = sim.packLumpHeader(3, 9, 2, 0);
    writeEntry(sim, sim.firstUserNsSlot(), 0x800, 9, 0, 0, 1, 0, 2, 0);
    const before = sim.memory.slice();
    check('T421: no room below Namespace table returns OOM without mutation',
        sim.findFreeLumpRange(512) === null &&
        sim.memory.every((word, index) => word === before[index]));
}
{
    const sim = makeSim();
    const slot = sim.firstUserNsSlot();
    sim.memory[0x1000] = sim.packLumpHeader(3, 9, 2, 0);
    writeEntry(sim, slot, 0x1000, 9, 0, 0, 1, 0, 2, 0);
    check('T421a: earlier free gap is usable below a higher resident body',
        sim.findFreeLumpRange(512) === 0x800);
    sim._activeThreadBase = () => 0x800;
    sim._threadLayoutAtBase = () => ({ lumpSize: 512 });
    check('T421b: active Thread interval is never allocated over',
        sim.findFreeLumpRange(512) === 0xa00);
    const before = sim.memory.slice();
    let bad = '';
    try { sim.findFreeLumpRange(500); } catch (err) { bad = err.message; }
    check('T421c: malformed non-power-of-two extent rejected without writes',
        /Invalid LUMP allocation bounds/.test(bad) &&
        sim.memory.every((word, index) => word === before[index]));
}
{
    const sim = makeSim();
    const before = sim.memory.slice(0, sim.NS_TABLE_BASE);
    const missing = sim.defineSymbolicAbstraction('Future.Absent', null, {
        status: 'missing', diagnostic: 'No saved library artifact exists.'
    });
    const invalid = sim.defineSymbolicAbstraction('Future.Broken', null, {
        status: 'invalid', diagnostic: 'Invalid LUMP header',
        token: 'deadbeef', filename: 'Future.Broken.deadbeef.lump'
    });
    const validDesign = sim.defineSymbolicAbstraction('Future.Selected', null, {
        status: 'unresolved', diagnostic: 'Design only; install required.',
        token: '1234abcd', filename: 'Future.Selected.1234abcd.lump'
    });
    const petName = sim.defineSymbolicAbstraction('My future idea!', null, {
        status: 'missing', diagnostic: 'No saved library artifact exists.'
    });
    check('T425: missing abstraction accepts a non-canonical pet name',
        sim.symbolicEntryAt(petName.slot).name === 'My future idea!');
    const secondPet = sim.defineSymbolicAbstraction('My future idea!', null, {
        status: 'missing', diagnostic: 'A separate design placement.'
    });
    check('T425a: duplicate pet name still allocates a distinct free slot',
        secondPet.slot !== petName.slot);
    check('T426: missing, invalid and valid-library designs occupy distinct slots without body writes',
        new Set([missing.slot, invalid.slot, validDesign.slot]).size === 3 &&
        sim.memory.slice(0, sim.NS_TABLE_BASE).every((word, i) => word === before[i]));
    let collision = '';
    try {
        sim.defineSymbolicAbstraction('Future.Another', invalid.slot, {
            status: 'missing', diagnostic: 'Absent'
        });
    } catch (err) { collision = err.message; }
    check('T427: design slot collision is rejected', /already occupied/.test(collision));

    const rows = [missing, invalid, validDesign].map(result => ({
        ...sim.symbolicEntryAt(result.slot)
    }));
    const saved = JSON.parse(JSON.stringify({ abstractions: rows }));
    const reloaded = makeSim();
    const sandbox = vm.createContext({
        sim: reloaded, window: { _nsState: saved }
    });
    vm.runInContext(hydrateSymbolicSrc, sandbox);
    vm.runInContext('_hydrateNsSymbolicState();', sandbox);
    check('T428: persisted exact design identity and diagnostic survive hydration',
        reloaded.symbolicEntryAt(invalid.slot).selection.filename ===
            'Future.Broken.deadbeef.lump' &&
        reloaded.symbolicEntryAt(missing.slot).selection.status === 'missing' &&
        reloaded.readNSEntry(invalid.slot).word0_location === 0);
    const result = reloaded.mLoad(
        reloaded.createGT(invalid.seq, invalid.slot, { E: 1 }, 1),
        'E', 0, 0);
    check('T429: design placement cannot resolve capability execution',
        !result.ok && result.fault === 'CODE_NOT_RESIDENT');
    callNsTableClear(reloaded, invalid.slot);
    check('T430: Clear removes selected design binding and releases slot',
        !reloaded.symbolicEntryAt(invalid.slot) &&
        !reloaded.isNSEntryValid(invalid.slot));
}

console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
