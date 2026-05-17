// tests/simulator/sim_selftest_lump_runs.js
//
// Headless harness used by tests/simulator/test_selftest_lump_runs.py.
//
// Loads server/lumps/d906a27f.lump into a fresh boot image via
// ChurchSimulator.loadLumpBinary(), runs the simulator to completion, and
// verifies that DR0 === 0 (all 81 self-tests passed).
//
// The Post-Flash Self-Test uses DR0 as its result register:
//   DR0 = 0   — all 81 tests passed
//   DR0 = N   — test N was the first to fail (fail-fast)
//
// The selftest ends with RETURN.  Because loadLumpBinary() resets the call
// stack, RETURN on an empty stack triggers a STACK_UNDERFLOW fault which
// causes the simulator to halt.  We intercept fault() to read DR0 before
// the fault handler zeroes registers.
//
// Output (JSON to stdout):
//   {
//     "bootComplete":  true,
//     "loaded":        true,
//     "steps":         <number of step() calls>,
//     "dr0":           <DR0 value captured on first fault>,
//     "faultType":     "STACK_UNDERFLOW" | other,
//     "faultMessage":  <fault message string>,
//     "terminatedBy":  "RETURN" | "HALT" | "MAX_STEPS" | "UNEXPECTED_FAULT",
//     "pass":          true | false,
//     "failSection":   null | "SECTION X <description> test N",
//     "failMessage":   null | "SECTION X <description> test N was the first to fail (DR0=N)"
//   }

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

// ── Set up simulator with system abstractions ─────────────────────────────────
const sim      = new ChurchSimulator();
const registry = new AbstractionRegistry();
const sys      = new SystemAbstractions(registry);
sim.initAbstractions(registry, sys, null);

// ── Boot the simulator ────────────────────────────────────────────────────────
const MAX_BOOT = 32;
let bootIters  = 0;
while (bootIters < MAX_BOOT && !sim.bootComplete && !sim.halted) {
    const advanced = sim._bootStep();
    bootIters++;
    if (!advanced) break;
}

if (!sim.bootComplete) {
    const out = {
        bootComplete: false,
        loaded: false,
        steps: 0,
        dr0: null,
        faultType: null,
        faultMessage: null,
        terminatedBy: 'BOOT_FAILED',
        pass: false,
        failMessage: `Boot did not complete after ${bootIters} iterations; halted=${sim.halted}`,
    };
    process.stdout.write(JSON.stringify(out) + '\n');
    process.exit(1);
}

// ── Load d906a27f.lump binary ─────────────────────────────────────────────────
const LUMP_PATH = path.join(ROOT, 'server', 'lumps', 'd906a27f.lump');
let lumpBytes;
try {
    lumpBytes = fs.readFileSync(LUMP_PATH);
} catch (e) {
    const out = {
        bootComplete: true,
        loaded: false,
        steps: 0,
        dr0: null,
        faultType: null,
        faultMessage: null,
        terminatedBy: 'LUMP_NOT_FOUND',
        pass: false,
        failMessage: `Cannot read lump file: ${e.message}`,
    };
    process.stdout.write(JSON.stringify(out) + '\n');
    process.exit(1);
}

// Parse big-endian 32-bit words
const wordCount = lumpBytes.length / 4;
const lumpWords = [];
for (let i = 0; i < wordCount; i++) {
    lumpWords.push(lumpBytes.readUInt32BE(i * 4));
}

// loadLumpBinary places the lump at 0x0400 (extended-code area), updates
// NS slot 3 (Boot.Abstr), CR14 (code register), and CR6 (c-list register).
const loaded = sim.loadLumpBinary(lumpWords, 3);

if (!loaded) {
    const out = {
        bootComplete: true,
        loaded: false,
        steps: 0,
        dr0: null,
        faultType: null,
        faultMessage: null,
        terminatedBy: 'LOAD_FAILED',
        pass: false,
        failMessage: 'loadLumpBinary returned false — see sim.output for details',
    };
    process.stdout.write(JSON.stringify(out) + '\n');
    process.exit(1);
}

// ── Intercept fault() to capture DR0 at the moment of the first fault ────────
// The selftest ends with RETURN; since loadLumpBinary() cleared the call stack
// there is no sentinel frame, so RETURN triggers fault('STACK_UNDERFLOW').
// fault() then sets halted=true.  We read DR0 here — before any recovery path
// can clear it — because DR0 was set by the selftest before RETURN was called.
//
// We also watch for any unexpected earlier fault (not STACK_UNDERFLOW) which
// would indicate a real error (e.g. LOAD validation failure) rather than
// normal completion.
let capturedDR0      = null;
let capturedFaultType = null;
let capturedFaultMsg  = null;

const origFault = sim.fault.bind(sim);
sim.fault = function(type, msg, meta) {
    if (capturedDR0 === null) {
        // First fault — capture state before any recovery handler fires
        capturedDR0       = sim.dr[0] >>> 0;
        capturedFaultType = type;
        capturedFaultMsg  = msg;
    }
    origFault(type, msg, meta);
};

// ── Run to completion ─────────────────────────────────────────────────────────
const MAX_STEPS = 100000;
let steps = 0;

while (steps < MAX_STEPS && !sim.halted && sim.bootComplete) {
    const r = sim.step();
    steps++;
    if (!r) break;  // null result means a fault or skip
}

// ── DR0 → section name mapping ────────────────────────────────────────────────
// Matches the section table in simulator/examples/post_flash_selftest.cloomc
const SELFTEST_SECTIONS = [
    { first: 1,  last: 15, name: 'SECTION A', desc: 'Data register independence' },
    { first: 16, last: 23, name: 'SECTION B', desc: 'IADD arithmetic' },
    { first: 24, last: 30, name: 'SECTION C', desc: 'ISUB arithmetic' },
    { first: 31, last: 36, name: 'SECTION D', desc: 'SHL shift-left' },
    { first: 37, last: 41, name: 'SECTION E', desc: 'SHR logical right' },
    { first: 42, last: 45, name: 'SECTION F', desc: 'SHR arithmetic right' },
    { first: 46, last: 57, name: 'SECTION G', desc: 'Branch conditions' },
    { first: 58, last: 62, name: 'SECTION H', desc: 'BFEXT / BFINS bit-field operations' },
    { first: 63, last: 73, name: 'SECTION I', desc: 'TPERM presets + domain purity' },
    { first: 74, last: 77, name: 'SECTION J', desc: 'TPERM EXACT credential-pinning' },
    { first: 78, last: 79, name: 'SECTION K', desc: 'CHANGE (CR swap) + permission verify' },
    { first: 80, last: 81, name: 'SECTION L', desc: 'LOAD from multiple c-list slots' },
];

function drToSection(n) {
    for (const s of SELFTEST_SECTIONS) {
        if (n >= s.first && n <= s.last) {
            return `${s.name} ${s.desc} test ${n}`;
        }
    }
    return null;
}

// ── Determine termination reason and pass/fail ────────────────────────────────
let terminatedBy;
if (capturedDR0 !== null) {
    // A fault was intercepted — classify by type
    terminatedBy = (capturedFaultType === 'STACK_UNDERFLOW') ? 'RETURN' : 'UNEXPECTED_FAULT';
} else if (steps >= MAX_STEPS) {
    // Loop hit step limit without any fault — probably an infinite loop
    capturedDR0  = sim.dr[0] >>> 0;
    terminatedBy = 'MAX_STEPS';
} else {
    // Loop exited because !sim.bootComplete (e.g. _returnToBoot) without a fault
    capturedDR0  = sim.dr[0] >>> 0;
    terminatedBy = 'HALT';
}

const pass = (capturedDR0 === 0) && (terminatedBy === 'RETURN');

let failSection = null;
let failMessage = null;
if (!pass) {
    if (terminatedBy === 'RETURN') {
        // Normal termination but DR0 != 0: a specific test failed
        failSection = drToSection(capturedDR0);
        const sectionLabel = failSection || `test ${capturedDR0}`;
        failMessage = `${sectionLabel} was the first to fail (DR0=${capturedDR0})`;
    } else if (terminatedBy === 'UNEXPECTED_FAULT') {
        failMessage = (
            `Unexpected fault [${capturedFaultType}] after ${steps} steps: ${capturedFaultMsg}. ` +
            `DR0=${capturedDR0} at fault time.`
        );
    } else {
        failMessage = `Selftest terminated unexpectedly (${terminatedBy}) after ${steps} steps; DR0=${capturedDR0}`;
    }
}

// ── Emit JSON report ──────────────────────────────────────────────────────────
const faultLog = (sim.faultLog || []).map(f => ({ type: f.type, message: f.message }));

const out = {
    bootComplete: true,
    loaded: true,
    steps,
    dr0: capturedDR0,
    faultType: capturedFaultType,
    faultMessage: capturedFaultMsg,
    faultLog,
    terminatedBy,
    pass,
    failSection,
    failMessage,
};

process.stdout.write(JSON.stringify(out) + '\n');
process.exit(pass ? 0 : 1);
