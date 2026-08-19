'use strict';
// test_boot_entry_sync.js — Regression tests for Task #1202
// Confirms that the boot-entry label (bootEntrySlot) stays current immediately
// after a simulator reset (_autoLoadDefaultProgram path) and after a catalog
// LUMP is loaded into the simulator (_loadCatalogLumpIntoSim path).
//
// Run:  node simulator/test_boot_entry_sync.js
//
// Coverage:
//   T201 — _autoLoadDefaultProgram path: production function called with a
//           pre-booted sim whose bootEntrySlot differs from the UI variable;
//           asserts bootEntrySlot matches sim.bootEntrySlot immediately after.
//   T202 — _loadCatalogLumpIntoSim path: production function called with a
//           minimal program; asserts bootEntrySlot matches sim.bootEntrySlot
//           immediately after (no poll delay).
//   T203 — No-op guard: _syncBootEntryFromSim leaves bootEntrySlot unchanged
//           when it already matches sim — no spurious localStorage writes.
//   T204 — sim.loadProgram() preserves sim.bootEntrySlot across a program load
//           (guard against the extended-code path silently resetting the slot).
//   T205 — Sequential resets: bootEntrySlot tracks sim.bootEntrySlot across
//           three consecutive sync calls (order-dependent state regression).
//   T206 — Null sim guard: _syncBootEntryFromSim is safe when sim is null.

const vm   = require('vm');
const fs   = require('fs');
const path = require('path');

const ChurchSimulator    = require('./simulator.js');
const AbstractionRegistry = require('./abstractions.js');
const SystemAbstractions  = require('./system_abstractions.js');

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

// ── Source extraction ─────────────────────────────────────────────────────────
//
// Reads a top-level function definition verbatim from a source file.  The
// extractor counts `{` / `}` characters to find the closing brace; this is
// reliable for these functions which are at the top level and contain no
// template-literal `${…}` brace pairs that would confuse a naive counter
// (all such expansions in the three target functions are safe here because
// they are inside string literals, not top-level template tags).
//
// Rationale: loading the production source rather than a copy ensures the test
// catches any future change to the call sites (e.g. a removed _syncBootEntryFromSim
// call) that a hand-copied replica would silently miss.

function extractTopLevelFn(sourceFile, fnName) {
    const src   = fs.readFileSync(path.join(__dirname, sourceFile), 'utf8');
    const lines = src.split('\n');
    const startPattern = `function ${fnName}(`;
    let collecting = false;
    let depth = 0;
    const buf = [];

    for (const line of lines) {
        if (!collecting && line.startsWith(startPattern)) {
            collecting = true;
        }
        if (!collecting) continue;

        buf.push(line);
        for (const ch of line) {
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
        }
        if (depth === 0 && buf.length > 1) break;
    }

    if (buf.length === 0) {
        throw new Error(`extractTopLevelFn: "${fnName}" not found in ${sourceFile}`);
    }
    return buf.join('\n');
}

const syncFnSrc      = extractTopLevelFn('app-abstractions.js', '_syncBootEntryFromSim');
const autoLoadFnSrc  = extractTopLevelFn('app-run.js',          '_autoLoadDefaultProgram');
const loadCatalogSrc = extractTopLevelFn('app-absdetail.js',    '_loadCatalogLumpIntoSim');

// ── Sandbox factory ───────────────────────────────────────────────────────────
//
// Creates a vm sandbox that wires the three production functions together with
// a real ChurchSimulator and minimal stubs for all browser globals they touch.
//
// The three functions are evaluated inside the context so they close over the
// same `bootEntrySlot`, `sim`, `localStorage`, etc. variables — exactly as they
// would in the browser.  Assertions read sandbox.bootEntrySlot after each call.

function makeTestSim() {
    const sim = new ChurchSimulator();
    const registry = new AbstractionRegistry();
    new SystemAbstractions(registry);
    sim.abstractionRegistry = registry;
    sim.bootComplete = true;
    return sim;
}

function makeSandbox(sim, initialBootEntrySlot) {
    const lsStore = {};

    const sandbox = {
        // ── Simulator state ────────────────────────────────────────────────
        sim,
        bootEntrySlot: initialBootEntrySlot,

        // ── app-run.js module-level vars used by _autoLoadDefaultProgram ──
        lastAssembledWords: [],
        lastMethodTableSize: 0,
        _defaultProgramLoaded: false,
        _pendingSimLoad: false,
        BOOT_ABSTR_NS_SLOT: 3,

        // ── browser APIs (stubbed) ─────────────────────────────────────────
        localStorage: {
            setItem(k, v) { lsStore[k] = String(v); },
            getItem(k)    { return Object.prototype.hasOwnProperty.call(lsStore, k) ? lsStore[k] : null; },
        },
        window: {
            _lastCatalogLumpWords: null,
            _lastCatalogLumpName:  null,
            lumpEditorRenderResidentPanel: null,
        },
        document: {
            querySelector()  { return null; },
            getElementById() { return null; },
        },
        currentView:       'code',
        selectedAbsIndex:  null,

        // ── Stub functions (no-ops; do not affect the sync invariant) ──────
        renderAbstractions:          () => {},
        updateNamespace:             () => {},
        _reapplyStickyPatches:       () => {},
        _injectClistNow:             () => {},
        _applyBootLumpPetNames:      () => {},
        loadExample:                 () => {},
        updateLiveLumpBanner:        () => {},
        updateDashboard:             () => {},
        instantBoot:                 () => true,
        console,
    };

    const ctx = vm.createContext(sandbox);

    // Evaluate the three production function definitions in the shared context.
    vm.runInContext(syncFnSrc,      ctx, { filename: 'app-abstractions.js' });
    vm.runInContext(autoLoadFnSrc,  ctx, { filename: 'app-run.js' });
    vm.runInContext(loadCatalogSrc, ctx, { filename: 'app-absdetail.js' });

    return { ctx, sandbox, lsStore };
}

// ── T201: _autoLoadDefaultProgram path ───────────────────────────────────────
//
// After a simulator reset the boot sequence may restore sim.bootEntrySlot from
// the encoded boot image (a value different from the UI variable).
// _autoLoadDefaultProgram must call _syncBootEntryFromSim so the Resident panel
// label immediately reflects the restored slot — with no poll delay.
//
// Setup: _defaultProgramLoaded=true (second+ boot cycle), lastAssembledWords=[]
// (no user program) → _autoLoadDefaultProgram takes the no-assembled-words branch
// and calls _syncBootEntryFromSim() on line 1227 of app-run.js.
console.log('\n--- T201: _autoLoadDefaultProgram path — sync after boot-image restore ---');
{
    const sim = makeTestSim();
    const { ctx, sandbox, lsStore } = makeSandbox(sim, 3);

    // Simulate a boot-image restore: sim.bootEntrySlot updated to 7 (differs from UI's 3)
    sim.bootEntrySlot = 7;
    // Second+ boot cycle: _defaultProgramLoaded=true, no assembled program
    sandbox._defaultProgramLoaded = true;
    sandbox.lastAssembledWords    = [];

    // Pre-condition: divergence is present before the function runs
    check('T201a: bootEntrySlot (3) diverges from sim.bootEntrySlot (7) before call',
        sandbox.bootEntrySlot === 3 && sim.bootEntrySlot === 7);

    // Call the production function — it must invoke _syncBootEntryFromSim internally
    vm.runInContext('_autoLoadDefaultProgram()', ctx);

    // Post-condition: bootEntrySlot must match sim immediately (no poll delay)
    check('T201b: bootEntrySlot matches sim.bootEntrySlot immediately after _autoLoadDefaultProgram()',
        sandbox.bootEntrySlot === sim.bootEntrySlot);
    check('T201c: bootEntrySlot updated to 7 (the sim-restored slot)',
        sandbox.bootEntrySlot === 7);
    check('T201d: localStorage written with new slot string "7"',
        lsStore['bootEntrySlot'] === '7');
    check('T201e: sim.bootEntrySlot is 7 — unchanged by the sync (read-only toward sim)',
        sim.bootEntrySlot === 7);
}

// ── T202: _loadCatalogLumpIntoSim path ───────────────────────────────────────
//
// When the user clicks "Load into Sim" in the Abstractions panel,
// _loadCatalogLumpIntoSim calls sim.loadProgram(words, 0) then
// _syncBootEntryFromSim.  The test verifies the label updates immediately.
//
// Setup: window._lastCatalogLumpWords is a minimal 3-word program; the sim
// is pre-booted.  After sim.loadProgram() the sim.bootEntrySlot is still 3
// (the value it held before the load) and the UI variable is stale at 12.
console.log('\n--- T202: _loadCatalogLumpIntoSim path — sync after catalog lump load ---');
{
    const sim = makeTestSim();
    const { ctx, sandbox, lsStore } = makeSandbox(sim, 12);  // UI stale at 12

    // sim.bootEntrySlot is 3 (default after boot)
    sim.bootEntrySlot = 3;

    // Provide a minimal 3-word catalog LUMP in window (what the button does)
    sandbox.window._lastCatalogLumpWords = [0x00000000, 0x00000000, 0x00000000];
    sandbox.window._lastCatalogLumpName  = 'TestCatalogAbs';

    // Pre-condition: UI is stale
    check('T202a: bootEntrySlot (12) diverges from sim.bootEntrySlot (3) before call',
        sandbox.bootEntrySlot === 12 && sim.bootEntrySlot === 3);

    // Call the production function — it calls sim.loadProgram() then _syncBootEntryFromSim()
    vm.runInContext('_loadCatalogLumpIntoSim()', ctx);

    // Post-condition: sync must have fired inside _loadCatalogLumpIntoSim
    check('T202b: bootEntrySlot matches sim.bootEntrySlot immediately after _loadCatalogLumpIntoSim()',
        sandbox.bootEntrySlot === sim.bootEntrySlot);
    check('T202c: bootEntrySlot updated to 3 (sim.bootEntrySlot)',
        sandbox.bootEntrySlot === 3);
    check('T202d: localStorage written with slot "3"',
        lsStore['bootEntrySlot'] === '3');
}

// ── T203: No-op guard ─────────────────────────────────────────────────────────
//
// _syncBootEntryFromSim must be a no-op when bootEntrySlot already matches
// sim.bootEntrySlot.  Spurious localStorage writes would cause unneeded
// re-renders and difficult-to-diagnose UI flicker.
console.log('\n--- T203: sync is a no-op when already in sync ---');
{
    const sim = makeTestSim();
    const { ctx, sandbox, lsStore } = makeSandbox(sim, 5);  // UI at 5
    sim.bootEntrySlot = 5;                                   // sim also at 5

    vm.runInContext('_syncBootEntryFromSim()', ctx);

    check('T203a: bootEntrySlot unchanged (still 5) after no-op sync',
        sandbox.bootEntrySlot === 5);
    check('T203b: localStorage NOT written when no change needed',
        !Object.prototype.hasOwnProperty.call(lsStore, 'bootEntrySlot'));
}

// ── T204: sim.loadProgram() must not clobber sim.bootEntrySlot ───────────────
//
// The extended-code path in loadProgram() rewrites NS-slot-3 metadata and
// CR14/CR6 registers.  A regression here could silently reset bootEntrySlot
// back to BOOT_ABSTR_NS_SLOT (3), making every subsequent _syncBootEntryFromSim
// call appear to "fix" a divergence that loadProgram() itself created.
//
// This test loads a minimal program into a real ChurchSimulator and verifies
// that sim.bootEntrySlot survives the call — then confirms the sync correctly
// propagates the preserved slot to the UI variable.
console.log('\n--- T204: sim.loadProgram() preserves sim.bootEntrySlot ---');
{
    const sim = makeTestSim();
    sim.bootEntrySlot = 9;          // user has selected slot 9

    try { sim.loadProgram([0x00000000, 0x00000000], 0); } catch (_) { /* pre-boot is OK */ }

    check('T204a: sim.bootEntrySlot preserved across sim.loadProgram() (still 9)',
        sim.bootEntrySlot === 9);

    // Now confirm the sync path propagates the preserved slot correctly
    const { ctx, sandbox, lsStore } = makeSandbox(sim, 3);  // UI is stale at 3
    vm.runInContext('_syncBootEntryFromSim()', ctx);

    check('T204b: sync after loadProgram() propagates user-selected slot 9 to UI',
        sandbox.bootEntrySlot === 9);
    check('T204c: localStorage carries "9"', lsStore['bootEntrySlot'] === '9');
}

// ── T205: Sequential resets — bootEntrySlot tracks across multiple cycles ────
//
// Three consecutive _autoLoadDefaultProgram cycles model a real IDE session
// with multiple resets.  Each cycle changes sim.bootEntrySlot and expects
// bootEntrySlot to follow immediately.  Catches order-dependent state bugs.
console.log('\n--- T205: sequential resets — bootEntrySlot tracks across three cycles ---');
{
    const sim = makeTestSim();
    const { ctx, sandbox, lsStore } = makeSandbox(sim, 3);
    sandbox._defaultProgramLoaded = true;
    sandbox.lastAssembledWords    = [];

    // Cycle 1: boot image restores slot 5
    sim.bootEntrySlot = 5;
    vm.runInContext('_autoLoadDefaultProgram()', ctx);
    check('T205a: cycle 1 — bootEntrySlot === 5', sandbox.bootEntrySlot === 5);
    check('T205b: cycle 1 — matches sim',          sandbox.bootEntrySlot === sim.bootEntrySlot);

    // Cycle 2: next reset restores slot 11
    sim.bootEntrySlot = 11;
    vm.runInContext('_autoLoadDefaultProgram()', ctx);
    check('T205c: cycle 2 — bootEntrySlot === 11', sandbox.bootEntrySlot === 11);
    check('T205d: cycle 2 — matches sim',           sandbox.bootEntrySlot === sim.bootEntrySlot);
    check('T205e: cycle 2 — localStorage carries "11"', lsStore['bootEntrySlot'] === '11');

    // Cycle 3: reset back to slot 3
    sim.bootEntrySlot = 3;
    vm.runInContext('_autoLoadDefaultProgram()', ctx);
    check('T205f: cycle 3 — bootEntrySlot === 3', sandbox.bootEntrySlot === 3);
    check('T205g: cycle 3 — matches sim',          sandbox.bootEntrySlot === sim.bootEntrySlot);
}

// ── T206: Null sim guard ──────────────────────────────────────────────────────
//
// The production _syncBootEntryFromSim starts with `if (!sim) return`.
// Verify the production code (not a replica) handles null without throwing and
// leaves bootEntrySlot unchanged.
console.log('\n--- T206: null sim guard — production _syncBootEntryFromSim is safe ---');
{
    const sim = makeTestSim();
    const { ctx, sandbox, lsStore } = makeSandbox(sim, 8);

    // Temporarily set sim to null in the context
    ctx.sim = null;
    let threw = false;
    try { vm.runInContext('_syncBootEntryFromSim()', ctx); } catch (e) { threw = true; }

    check('T206a: _syncBootEntryFromSim() does not throw when sim is null', !threw);
    check('T206b: bootEntrySlot unchanged (still 8) when sim is null', sandbox.bootEntrySlot === 8);
    check('T206c: localStorage not written when sim is null',
        !Object.prototype.hasOwnProperty.call(lsStore, 'bootEntrySlot'));
}

// ── T207: fallback placeholder anchored to canonical Boot.Abstr slot ─────────
//
// Task #2867: _initNamespaceTable() used to write its synthetic Boot.Abstr
// placeholder header at the USER-SELECTED bootEntrySlot.  With CapabilityTest
// (slot 10) selected and no boot image, that fabricated an executable-looking
// 3-word header at slot 10's location (0x0300) over zero code words, and left
// the canonical slot 6 without its placeholder.  The placeholder must ALWAYS
// anchor to sim._bootAbstrSlot (6); a selected non-canonical entry must remain
// visibly non-resident (invalid header magic) so boot faults clearly instead
// of running zeros.
console.log('\n--- T207: fallback placeholder stays at canonical slot 6 (CapabilityTest selected) ---');
{
    const sim = new ChurchSimulator();
    sim.bootEntrySlot = 10;      // user selects CapabilityTest
    sim.reset();                 // fallback init — no boot image loaded

    const canonical = sim._bootAbstrSlot;
    check('T207a: _bootAbstrSlot is the canonical architectural slot 6', canonical === 6);

    const loc6  = sim.memory[sim._nsSlotBase(6)]  >>> 0;
    const loc10 = sim.memory[sim._nsSlotBase(10)] >>> 0;
    const hdr6  = sim.parseLumpHeader(sim.memory[loc6]  >>> 0);
    const hdr10 = sim.parseLumpHeader(sim.memory[loc10] >>> 0);

    check('T207b: canonical slot 6 carries a valid placeholder lump header',
        !!hdr6 && hdr6.valid === true);
    check('T207c: selected slot 10 does NOT carry a fabricated executable header',
        !hdr10 || hdr10.valid !== true);
    check('T207d: bootEntrySlot selection (10) survives the fallback init',
        sim.bootEntrySlot === 10);

    // Selecting the canonical slot itself must still yield a bootable placeholder.
    const sim2 = new ChurchSimulator();
    sim2.bootEntrySlot = 6;
    sim2.reset();
    const loc6b = sim2.memory[sim2._nsSlotBase(6)] >>> 0;
    const hdr6b = sim2.parseLumpHeader(sim2.memory[loc6b] >>> 0);
    check('T207e: canonical-entry fallback still writes a valid placeholder at slot 6',
        !!hdr6b && hdr6b.valid === true && hdr6b.cw > 0);
}

// ── T208: rejected boot image must not be marked available ───────────────────
//
// Task #2867: the app-shell startup probe and app-memory reset/generate/upload
// paths must gate window.bootImage / window.bootImageAvailable on
// loadBootImage()'s boolean verdict.  Source-level contract check: every
// call site that sets bootImageAvailable=true must do so only after a
// `sim.loadBootImage(...) === true` comparison (except the save path, which
// re-uploads an image that was already accepted).
console.log('\n--- T208: acceptance state gated on loadBootImage() verdict ---');
{
    const shellSrc = fs.readFileSync(path.join(__dirname, 'app-shell.js'),  'utf8');
    const memSrc   = fs.readFileSync(path.join(__dirname, 'app-memory.js'), 'utf8');

    // app-shell startup probe: must check the loader verdict and have a
    // false-branch that clears availability.
    const shellGates = /loadBootImage\((?:buf|window\.bootImage)\)\s*===\s*true/.test(shellSrc);
    const shellClears = /bootImageAvailable\s*=\s*false/.test(shellSrc);
    check('T208a: app-shell startup probe gates on loadBootImage() === true', shellGates);
    check('T208b: app-shell clears bootImageAvailable on rejection', shellClears);

    // app-memory: _maybeApplyBootImage / generateBootImage / uploadBootImageFile
    const memGateCount = (memSrc.match(/loadBootImage\((?:buf|window\.bootImage)\)\s*===\s*true/g) || []).length;
    check('T208c: app-memory has >=4 loader-verdict gates (reset x2, generate, upload)',
        memGateCount >= 4);
    const memClearCount = (memSrc.match(/bootImageAvailable\s*=\s*false/g) || []).length;
    check('T208d: app-memory clears bootImageAvailable on rejection in >=4 paths',
        memClearCount >= 4);

    // Behavioural check: a stale image (no format tag) is rejected by the loader.
    const sim = new ChurchSimulator();
    const staleWords = new Uint32Array(sim.memory.length);
    // all zeros — no BOOT_IMAGE_FORMAT_TAG anywhere
    const verdict = sim.loadBootImage(staleWords.buffer);
    check('T208e: loadBootImage() returns false for an image without the format tag',
        verdict === false);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`boot-entry-sync results: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
