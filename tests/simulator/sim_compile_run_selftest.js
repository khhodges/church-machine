// tests/simulator/sim_compile_run_selftest.js
//
// Headless harness for the Compile+Run path (Task #2028), as distinct from
// the real boot-lump-install path covered by sim_selftest_lump_runs.js.
//
// Replicates the logic in simulator/app-run.js's assembleAndLoad() /
// _applyPendingSimLoad() / _injectClistNow() verbatim (minus DOM access):
// compiles simulator/examples/post_flash_selftest.cloomc via CLOOMCCompiler,
// assembles method table + bodies exactly as assembleAndLoad() does, loads
// via sim.loadProgram(), pushes the Compile+Run sentinel CALL frame added to
// fix Task #2028, injects the boot c-list (CASE A/B), and runs to completion.
//
// Before the Task #2028 fix, this harness's trailing RETURN underflowed an
// empty call stack (loadProgram() resets callStack=[]) and faulted with
// STACK_UNDERFLOW instead of a clean DR0=0 completion — reproducing the bug
// exactly as it appears in the IDE's Compile+Run button, unlike
// sim_selftest_lump_runs.js which loads a pre-built lump and expects
// STACK_UNDERFLOW as its (different, already-normal) termination signal.
//
// Output (JSON to stdout): { bootComplete, compiled, steps, dr0, faultType,
//   faultMessage, terminatedBy, pass, failMessage }

'use strict';

const fs   = require('fs');
const path = require('path');

global.window = {
    bootConfig: {
        step1: {
            totalNamespaceWords: 16384,
            namespaceLumpWords:     64,
            threadLumpWords:       256,
        }
    }
};

const ROOT = path.resolve(__dirname, '..', '..');

const ChurchSimulator     = require(path.join(ROOT, 'simulator', 'simulator.js'));
const AbstractionRegistry = require(path.join(ROOT, 'simulator', 'abstractions.js'));
const SystemAbstractions  = require(path.join(ROOT, 'simulator', 'system_abstractions.js'));
const ChurchAssembler     = require(path.join(ROOT, 'simulator', 'assembler.js'));
global.ChurchAssembler    = ChurchAssembler; // Node global shim (cloomc_compiler.js checks typeof global)
const CLOOMCCompiler      = require(path.join(ROOT, 'simulator', 'cloomc_compiler.js'));

function fail(partial) {
    const out = Object.assign({
        bootComplete: false, compiled: false, steps: 0, dr0: null,
        faultType: null, faultMessage: null, terminatedBy: 'SETUP_FAILED',
        pass: false, failMessage: null,
    }, partial);
    process.stdout.write(JSON.stringify(out) + '\n');
    process.exit(1);
}

// ── Set up simulator with system abstractions ─────────────────────────────
const sim      = new ChurchSimulator();
const registry = new AbstractionRegistry();
const sys      = new SystemAbstractions(registry);
sim.initAbstractions(registry, sys, null);

// ── Boot the simulator ──────────────────────────────────────────────────────
const MAX_BOOT = 32;
let bootIters  = 0;
while (bootIters < MAX_BOOT && !sim.bootComplete && !sim.halted) {
    const advanced = sim._bootStep();
    bootIters++;
    if (!advanced) break;
}
if (!sim.bootComplete) {
    fail({ failMessage: `Boot did not complete after ${bootIters} iterations; halted=${sim.halted}` });
}

// ── Compile post_flash_selftest.cloomc via CLOOMCCompiler ──────────────────
const SRC_PATH = path.join(ROOT, 'simulator', 'examples', 'post_flash_selftest.cloomc');
const source   = fs.readFileSync(SRC_PATH, 'utf8');

const cloomcCompiler = new CLOOMCCompiler();
const result = cloomcCompiler.compile(source, []);
if (result.errors && result.errors.length > 0) {
    fail({ failMessage: 'Compile errors: ' + result.errors.map(e => `Line ${e.line || '?'}: ${e.message}`).join('; ') });
}

// ── Assemble method table + bodies (mirrors assembleAndLoad(), app-run.js) ─
const methods = result.methods || [];
const methodTableSize = methods.length;
const words = [];
let codeOffset = methodTableSize;
const methodTableEntries = [];
for (let i = 0; i < methods.length; i++) {
    const m = methods[i];
    const branchOffset = codeOffset - i;
    methodTableEntries.push(m.visibility === 'private' ? 0 : (((17 << 27) | (branchOffset & 0x7FFF)) >>> 0));
    codeOffset += (m.code || []).length;
}
for (const entry of methodTableEntries) words.push(entry);
for (const m of methods) {
    for (const w of (m.code || [])) words.push(w);
}

const lastAssembledCapabilities = (result.capabilities && result.capabilities.length > 0) ? result.capabilities.slice() : null;
const lastAssembledNamedSlots   = (result.namedSlots && result.namedSlots.length > 0) ? result.namedSlots.slice() : null;

// ── Load program (mirrors _applyPendingSimLoad(), app-run.js) ──────────────
sim.loadProgram(words, 0);
if (methodTableSize > 0) sim.pc = methodTableSize;

// Task #2028 fix: push the Compile+Run sentinel CALL frame (mirrors
// simulator.js's NUC_CLIST sentinel push, since loadProgram() resets
// callStack=[] and Compile+Run never runs the real boot NUC_CLIST step).
if (sim.callStack && sim.callStack.length === 0) {
    const sp_max = 243; // THREAD_CAPS_OFFSET(244) - 1
    const sentinelFrameWord = sim._packFrameWordRaw(0x7FFF, 1, sp_max);
    sim.callStack.push({
        sentinel: true,
        returnPC: 0x7FFF,
        savedCRs: sim.cr.map(c => ({...c})),
        savedDRs: [...sim.dr],
        savedFlags: {...sim.flags},
        savedSTO: sp_max,
        sz: 1,
        frameWord: sentinelFrameWord,
    });
    const threadBase = sim.cr[12] && sim.cr[12].word1;
    if (threadBase) {
        sim.memory[threadBase + sp_max] = sentinelFrameWord;
    }
    sim.sto = sp_max - 2;
}

// ── Inject c-list (mirrors _injectClistNow(), app-run.js CASE A/B) ─────────
(function injectClistNow() {
    if (!sim.bootComplete || !sim.demoClistGTs || !sim.demoClistGTs.length) return;
    sim.resetNamedSlots();
    const _hasUserCaps = !!(lastAssembledCapabilities && lastAssembledCapabilities.length > 0);
    const _devSlotMap = {
        LED0: 3, LED1: 3, LED2: 3, LED3: 3, LED4: 3, LED5: 3,
        UART: 2, BTN: 4, Timer: 5, Display: 2,
    };
    const BOOT_ABSTR_SLOT = sim.bootEntrySlot;
    const nsBase    = sim.NS_TABLE_BASE + BOOT_ABSTR_SLOT * sim.NS_ENTRY_WORDS;
    const w1f       = sim.parseNSWord1(sim.memory[nsBase + 1]);
    const lumpBase  = sim.memory[nsBase] >>> 0;
    const lumpHdr   = sim.memory[lumpBase] >>> 0;
    const hdrParsed = sim.parseLumpHeader(lumpHdr);
    const SLOT_SIZE = hdrParsed.lumpSize;

    if (_hasUserCaps) {
        const cc        = lastAssembledCapabilities.length;
        const clistBase = lumpBase + SLOT_SIZE - cc;
        for (let i = 0; i < cc; i++) {
            const cap     = lastAssembledCapabilities[i];
            const capName = (typeof cap === 'string' ? cap : (cap.name || '')).trim();
            const rights  = typeof cap === 'string' ? [] : (cap.rights || []);
            if (!capName) { sim.memory[clistBase + i] = 0; continue; }
            if (capName.toUpperCase() === 'BOOT.NUCS') {
                sim.memory[clistBase + i] = sim.createGT(0, 1, {X:1}, 1) >>> 0;
                continue;
            }
            if (capName.toUpperCase() === 'BOOT.ABSTR') {
                sim.memory[clistBase + i] = sim.createGT(0, sim.bootEntrySlot, {E:1}, 1) >>> 0;
                continue;
            }
            const devKey = Object.keys(_devSlotMap).find(k => k.toLowerCase() === capName.toLowerCase());
            if (devKey !== undefined) {
                sim.memory[clistBase + i] = (sim.demoClistGTs[_devSlotMap[devKey]] || 0) >>> 0;
                continue;
            }
            let nsIdx = -1;
            for (const [idx, lbl] of Object.entries(sim.nsLabels)) {
                if (lbl.toUpperCase() === capName.toUpperCase()) { nsIdx = parseInt(idx); break; }
            }
            if (nsIdx >= 0) {
                const perms = {R:0, W:0, X:0, L:0, S:0, E:1};
                for (const r of rights) {
                    if      (r === 'R') perms.R = 1;
                    else if (r === 'W') perms.W = 1;
                    else if (r === 'X') perms.X = 1;
                    else if (r === 'E') perms.E = 1;
                }
                sim.memory[clistBase + i] = sim.createGT(0, nsIdx, perms, 1) >>> 0;
                continue;
            }
            const _pendingWord = (typeof ChurchSimulator !== 'undefined' && ChurchSimulator.makePendingGT)
                ? ChurchSimulator.makePendingGT(capName) : 0;
            sim.memory[clistBase + i] = _pendingWord >>> 0;
        }
        sim.memory[lumpBase] = ((lumpHdr & ~0xFF) | (cc & 0xFF)) >>> 0;
        const nsWord1B = sim.packNSWord1(w1f.limit, w1f.b, w1f.g, w1f.gtType, cc);
        sim.memory[nsBase + 1] = nsWord1B;
        const cr6GTb = sim.createGT(0, BOOT_ABSTR_SLOT, {R:0,W:0,X:0,L:0,S:0,E:1}, 1);
        sim.cr[6] = { word0: cr6GTb, word1: clistBase >>> 0, word2: nsWord1B >>> 0, word3: sim.memory[nsBase + 2] >>> 0, m: 0 };
        if (lastAssembledNamedSlots && lastAssembledNamedSlots.length > 0) sim.markNamedSlots(lastAssembledNamedSlots);
    } else {
        const cc        = sim.demoClistGTs.length;
        const clistBase = lumpBase + SLOT_SIZE - cc;
        for (let i = 0; i < cc; i++) sim.memory[clistBase + i] = sim.demoClistGTs[i] >>> 0;
        sim.memory[lumpBase] = ((lumpHdr & ~0xFF) | (cc & 0xFF)) >>> 0;
        const nsWord1A = sim.packNSWord1(w1f.limit, w1f.b, w1f.g, w1f.gtType, cc);
        sim.memory[nsBase + 1] = nsWord1A;
        const cr6GTa = sim.createGT(0, BOOT_ABSTR_SLOT, {R:0,W:0,X:0,L:0,S:0,E:1}, 1);
        sim.cr[6] = { word0: cr6GTa, word1: clistBase >>> 0, word2: nsWord1A >>> 0, word3: sim.memory[nsBase + 2] >>> 0, m: 0 };
    }
})();

// ── Intercept fault() to capture DR0 at the moment of the first fault ──────
let capturedDR0       = null;
let capturedFaultType = null;
let capturedFaultMsg  = null;
const origFault = sim.fault.bind(sim);
sim.fault = function(type, msg, meta) {
    if (capturedDR0 === null) {
        capturedDR0       = sim.dr[0] >>> 0;
        capturedFaultType = type;
        capturedFaultMsg  = msg;
    }
    origFault(type, msg, meta);
};

// ── Run to completion ────────────────────────────────────────────────────
const MAX_STEPS = 100000;
let steps = 0;
while (steps < MAX_STEPS && !sim.halted) {
    const r = sim.step();
    steps++;
    if (!r) break;
}

// Termination classification mirrors sim_selftest_lump_runs.js's convention:
// this selftest's normal, designed termination point IS a STACK_UNDERFLOW
// fault (RETURN unwinding past the top-level frame) — that is how a
// self-contained top-level abstraction signals "done" back to the boot
// layer with no OS/scheduler above it. What Task #2028 actually fixes is
// *which* RETURN-underflow happens: pre-fix, Compile+Run had no call frame
// at all, so RETURN hit the "stack is empty (no sentinel pushed)" case —
// a different, boot-install-incompatible code path. Post-fix, Compile+Run
// pushes the same sentinel frame the real boot-lump-install flow pushes, so
// the trailing RETURN unwinds through *that* sentinel — 'RETURN through
// sentinel frame' — exactly matching real-boot termination semantics.
let terminatedBy;
if (capturedDR0 !== null) {
    terminatedBy = (capturedFaultType === 'STACK_UNDERFLOW' && /sentinel frame/i.test(capturedFaultMsg || ''))
        ? 'RETURN_THROUGH_SENTINEL'
        : (capturedFaultType === 'STACK_UNDERFLOW' ? 'RETURN_NO_SENTINEL' : 'UNEXPECTED_FAULT');
} else if (steps >= MAX_STEPS) {
    capturedDR0  = sim.dr[0] >>> 0;
    terminatedBy = 'MAX_STEPS';
} else {
    capturedDR0  = sim.dr[0] >>> 0;
    terminatedBy = 'HALT';
}

const pass = (capturedDR0 === 0) && (terminatedBy === 'RETURN_THROUGH_SENTINEL');

let failMessage = null;
if (!pass) {
    if (terminatedBy === 'RETURN_NO_SENTINEL') {
        failMessage = `Task #2028 regression: Compile+Run's trailing RETURN hit an empty call stack with no sentinel frame (pre-fix behavior) after ${steps} steps: ${capturedFaultMsg}`;
    } else if (terminatedBy === 'UNEXPECTED_FAULT') {
        failMessage = `Unexpected fault [${capturedFaultType}] after ${steps} steps: ${capturedFaultMsg}. DR0=${capturedDR0} at fault time.`;
    } else if (terminatedBy === 'RETURN_THROUGH_SENTINEL') {
        failMessage = `Selftest completed but DR0=${capturedDR0} (test ${capturedDR0} was the first to fail)`;
    } else {
        failMessage = `Selftest terminated unexpectedly (${terminatedBy}) after ${steps} steps; DR0=${capturedDR0}`;
    }
}

const out = {
    bootComplete: true,
    compiled: true,
    steps,
    dr0: capturedDR0,
    faultType: capturedFaultType,
    faultMessage: capturedFaultMsg,
    terminatedBy,
    pass,
    failMessage,
};
process.stdout.write(JSON.stringify(out) + '\n');
process.exit(pass ? 0 : 1);
