// tests/simulator/sim_boot_run_idempotency.js
//
// Verifies that the boot-to-run transition cannot accidentally restart a
// running simulation.  Four test groups:
//
//   T1–T2  runSimGo() is a no-op when sim.running=true (mid-batch guard)
//   T3–T4  runSimGo() is a no-op when _simRunActive=true (between-batch guard)
//   T5–T8  instantBoot() is a safe no-op when sim.bootComplete is already true
//   T9–T14 _runStopped and _simRunActive flag lifecycle — source audit of every
//          set/clear site in the production code
//
// HOW THE BEHAVIORAL TESTS WORK
// ─────────────────────────────────────────────────────────────────────────
// app-run.js is a browser-only script (~13,000 lines).  We load it via
// Node's `vm` module into a jsdom context with a real booted ChurchSimulator
// injected as `sim`.  Small vm snippets then call the REAL runSimGo() and
// instantBoot() functions and report results through the shared context.
//
// DOM calls inside runSim() are safe because:
//   • document.getElementById() → returns null → guarded by `if (elem)`
//   • pipelineViz → injected as null → guarded by `if (pipelineViz)`
//   • switchView / openCRDetail → injected as no-op stubs
//
// The runSim() side effects (actual batch loop) are NOT triggered because
// we replace `runSim` with a minimal stub that only sets _simRunActive=true
// (the one guard-relevant side effect). This isolates the test to:
//   "does runSimGo() respect the guard and skip runSim() when appropriate?"
//
// WHY ALSO SOURCE AUDIT?
// ─────────────────────────────────────────────────────────────────────────
// Source audits (T9–T14) verify every SET/CLEAR site of the flags, catching
// cases where the guard is present but unreachable (e.g., cleared before it
// can block), or where a suspension path leaks _simRunActive=true forever.
// They fail immediately if a guard line is removed or mis-placed.

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

global.window = {
    bootConfig: {
        step1: {
            totalNamespaceWords: 16384,
            namespaceLumpWords:     64,
            threadLumpWords:       256,
        }
    }
};

const ROOT        = path.resolve(__dirname, '..', '..');
const APP_RUN_SRC = fs.readFileSync(path.join(ROOT, 'simulator', 'app-run.js'), 'utf8');

const ChurchSimulator     = require(path.join(ROOT, 'simulator', 'simulator.js'));
const AbstractionRegistry = require(path.join(ROOT, 'simulator', 'abstractions.js'));
const SystemAbstractions  = require(path.join(ROOT, 'simulator', 'system_abstractions.js'));

let failures = 0;
function check(cond, msg) {
    if (cond) { console.log(`PASS ${msg}`); }
    else       { failures++; console.log(`FAIL ${msg}`); }
}

// ── Boot a real sim ───────────────────────────────────────────────────────
function makeSim() {
    const sim      = new ChurchSimulator();
    const registry = new AbstractionRegistry();
    const sys      = new SystemAbstractions(registry);
    sim.initAbstractions(registry, sys, null);
    return sim;
}

function bootSim(sim) {
    let safety = 0;
    while (!sim.bootComplete && !sim.halted && safety++ < 50) sim._bootStep();
    return sim.bootComplete && !sim.halted;
}

// ── Build the jsdom + vm context ──────────────────────────────────────────
// app-run.js is loaded once into this context.  All behavioral tests run as
// vm snippets against it so they share the same lexical scope as the loaded
// script (letting snippets access `let` variables like _simRunActive).
const { JSDOM } = require('jsdom');

function buildContext(sim) {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>',
                          { url: 'http://localhost' });
    const ctx = vm.createContext({
        document:  dom.window.document,
        window:    dom.window,
        localStorage: {
            getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}
        },
        fetch:       () => Promise.resolve({ ok: false }),
        setTimeout, clearTimeout,
        setInterval: () => {}, clearInterval,
        console, JSON, Math, Object, Array, Promise, Error,
        parseInt, parseFloat, isNaN, Boolean, Number, String, RegExp,
        Uint32Array, DataView, Map, Set, WeakMap, WeakSet, Symbol, Proxy, ArrayBuffer,
        encodeURIComponent, decodeURIComponent, atob: () => '', btoa: () => '',
        // External stubs required by runSim() / switchView etc.
        switchView:        () => {},
        openCRDetail:      () => {},
        updateDashboard:   () => {},
        loadNamespaceState:() => {},
        pipelineViz:       null,   // guards: if (pipelineViz) { ... }
        sim,
    });
    vm.runInContext(APP_RUN_SRC, ctx);
    return ctx;
}

// ── Source-extraction helper ──────────────────────────────────────────────
function extractFunctionBody(src, name) {
    const pattern = new RegExp(`function ${name}\\s*\\(`);
    const start   = src.search(pattern);
    if (start < 0) return null;
    let depth = 0, i = start;
    while (i < src.length && src[i] !== '{') i++;
    const bodyStart = i;
    while (i < src.length) {
        if      (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
        i++;
    }
    return src.slice(bodyStart, i + 1);
}

// ══════════════════════════════════════════════════════════════════════════
// T1–T2: runSimGo() is blocked by sim.running=true  (mid-batch guard)
// ══════════════════════════════════════════════════════════════════════════
//
// Calls the REAL runSimGo() with sim.running=true and verifies runSim() is
// not invoked — i.e., the guard `if (sim.running || _simRunActive) return;`
// fires before any side-effecting call.

console.log('\n── T1–T2: runSimGo() blocked when sim.running=true ──────────────');

{
    const sim = makeSim();
    bootSim(sim);
    const ctx = buildContext(sim);

    vm.runInContext(`
var _t1_runSimCalled = 0;
var _origRunSim1 = runSim;
runSim = function() { _t1_runSimCalled++; };
sim.running = true;
runSimGo();
_t1_result = _t1_runSimCalled;
runSim = _origRunSim1;
sim.running = false;
`, ctx);

    check(ctx._t1_result === 0,
        'T1: runSimGo() does not call runSim() when sim.running=true');

    // Verify sim state is completely undisturbed after the blocked call
    vm.runInContext(`
_t2_result = {
    bootComplete: sim.bootComplete,
    halted:       sim.halted,
    faultCount:   sim.faultLog.length,
    runningNow:   sim.running,
};
`, ctx);
    const r = ctx._t2_result;
    check(r.bootComplete === true && r.halted === false
          && r.faultCount === 0   && r.runningNow === false,
        'T2: sim state (bootComplete, halted, faultCount, running) unchanged after blocked call');
}

// ══════════════════════════════════════════════════════════════════════════
// T3–T4: runSimGo() is blocked by _simRunActive=true (between-batch guard)
// ══════════════════════════════════════════════════════════════════════════
//
// Simulates the between-batch gap: first call to runSimGo() proceeds and its
// runSim() stub sets _simRunActive=true (the real side effect that makes the
// guard meaningful).  A second call in the same synchronous tick is then
// blocked.

console.log('\n── T3–T4: runSimGo() blocked when _simRunActive=true ────────────');

{
    const sim = makeSim();
    bootSim(sim);
    const ctx = buildContext(sim);

    vm.runInContext(`
// Stub _applyPendingSimLoad to avoid reading uninitialized implicit globals
// (those are only set after a real compile + load flow, not needed here).
var _origApply3 = _applyPendingSimLoad;
_applyPendingSimLoad = function() {};

// Stub runSim to replicate only the guard-relevant side effect.
// The real runSim() sets:  _runStopped = false;  _simRunActive = true;
// Everything else (DOM updates, setTimeout batch loop) is not needed here.
var _t3_runSimCalls = 0;
var _origRunSim3 = runSim;
runSim = function() {
    _t3_runSimCalls++;
    _runStopped   = false;
    _simRunActive = true;
};

// First call — should proceed (sim.running=false, _simRunActive=false)
runSimGo();
var _afterFirst = _t3_runSimCalls;   // expected: 1

// Second call in same tick — _simRunActive is now true, guard fires
runSimGo();
var _afterSecond = _t3_runSimCalls;  // expected: still 1

_t3_result = { afterFirst: _afterFirst, afterSecond: _afterSecond,
               simRunActiveSet: _simRunActive };

// Cleanup
runSim = _origRunSim3;
_applyPendingSimLoad = _origApply3;
_simRunActive = false;
`, ctx);

    check(ctx._t3_result.afterFirst === 1,
        'T3: first runSimGo() call proceeds normally (runSim called once)');
    check(ctx._t3_result.afterSecond === 1,
        'T4: second runSimGo() call is blocked by _simRunActive=true (runSim not called again)');
}

// ══════════════════════════════════════════════════════════════════════════
// T5–T8: instantBoot() is a safe no-op when bootComplete is already true
// ══════════════════════════════════════════════════════════════════════════
//
// Calls the REAL instantBoot() on an already-booted sim and verifies:
//   • return value is true  (the early-return guard value)
//   • _bootStep() is never called  (no re-running of boot microcode)
//   • calling it twice gives identical results with no state mutation

console.log('\n── T5–T8: instantBoot() no-op when bootComplete=true ────────────');

{
    const sim = makeSim();
    bootSim(sim);
    const ctx = buildContext(sim);

    vm.runInContext(`
// Spy on sim._bootStep to detect any re-boot attempt
var _t5_bootSteps = 0;
var _origBoot5 = sim._bootStep.bind(sim);
sim._bootStep = function() { _t5_bootSteps++; return _origBoot5(); };

// Capture state before
var _cr14w0_before = sim.cr[14] ? sim.cr[14].word0 : null;
var _faults_before = sim.faultLog.length;
var _bootStep_before = sim.bootStep;

var _r1 = instantBoot();    // first call on booted sim
var _r2 = instantBoot();    // second call — must also be a no-op

_t5_result = {
    r1: _r1, r2: _r2,
    bootStepsCalled: _t5_bootSteps,
    cr14Unchanged:   (sim.cr[14] ? sim.cr[14].word0 : null) === _cr14w0_before,
    faultsUnchanged: sim.faultLog.length === _faults_before,
    bootStepUnchanged: sim.bootStep === _bootStep_before,
};
sim._bootStep = _origBoot5;
`, ctx);

    const r = ctx._t5_result;
    check(r.r1 === true,
        'T5: instantBoot() returns true on already-booted sim (first call)');
    check(r.r2 === true,
        'T6: instantBoot() returns true on already-booted sim (second call — idempotent)');
    check(r.bootStepsCalled === 0,
        'T7: _bootStep() is never called when bootComplete=true — no re-boot microcode');
    check(r.cr14Unchanged && r.faultsUnchanged && r.bootStepUnchanged,
        'T8: CR14 base, fault count, and bootStep counter unchanged — zero side effects');
}

// ══════════════════════════════════════════════════════════════════════════
// T9–T14: _runStopped and _simRunActive flag lifecycle — source audit
// ══════════════════════════════════════════════════════════════════════════
//
// Verifies all six flag management sites in the production source.
// These checks fail immediately if any guard line is removed or mis-placed.
//
//   _simRunActive lifecycle:
//     T9  — declared false
//     T10 — set true at runSim() batch-start (after _runStopped=false)
//     T11 — cleared false as first line of finishRun()
//     T12 — cleared false before awaitingLump early-return
//     T13 — cleared false before _lazySuspended early-return
//     T14 — _runStopped set true in stopSim()

console.log('\n── T9–T14: _runStopped / _simRunActive flag lifecycle audit ─────');

{
    check(APP_RUN_SRC.includes('let _simRunActive = false;'),
        'T9: _simRunActive declared as `let _simRunActive = false;`');

    check(APP_RUN_SRC.includes('_runStopped = false;\n    _simRunActive = true;'),
        'T10: _simRunActive set true immediately after _runStopped=false in runSim()');

    const finishRunBody = extractFunctionBody(APP_RUN_SRC, 'finishRun');
    check(finishRunBody !== null
          && finishRunBody.trimStart().startsWith('{\n        _simRunActive = false;'),
        'T11: _simRunActive=false is the first statement in finishRun()');

    // Window of 1200 chars covers both suspension blocks fully
    // (measured: ~925 chars for awaitingLump, ~1019 for _lazySuspended).
    const awIdx  = APP_RUN_SRC.indexOf('if (sim.awaitingLump) {');
    const awSect = awIdx >= 0 ? APP_RUN_SRC.slice(awIdx, awIdx + 1200) : '';
    check(awSect.indexOf('_simRunActive = false;') >= 0
          && awSect.indexOf('_simRunActive = false;') < awSect.indexOf('return;'),
        'T12: _simRunActive cleared before return in sim.awaitingLump suspension path');

    const lzIdx  = APP_RUN_SRC.indexOf('if (sim._lazySuspended) {');
    const lzSect = lzIdx >= 0 ? APP_RUN_SRC.slice(lzIdx, lzIdx + 1200) : '';
    check(lzSect.indexOf('_simRunActive = false;') >= 0
          && lzSect.indexOf('_simRunActive = false;') < lzSect.indexOf('return;'),
        'T13: _simRunActive cleared before return in sim._lazySuspended suspension path');

    const stopSimBody = extractFunctionBody(APP_RUN_SRC, 'stopSim');
    check(stopSimBody !== null && stopSimBody.includes('_runStopped = true;'),
        'T14: stopSim() sets _runStopped=true');
}

// ══════════════════════════════════════════════════════════════════════════

console.log('\n────────────────────────────────────────────────────────────────');

const result = {
    pass:     failures === 0,
    failures: failures,
    total:    14,
};
process.stdout.write(JSON.stringify(result) + '\n');
process.exit(failures === 0 ? 0 : 1);
