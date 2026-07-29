// tests/simulator/sim_asm_examples.js
//
// Headless harness for Task #1042.
//
// Extracts every built-in Assembly example from simulator/app-run.js,
// feeds each one through ChurchAssembler.assemble(), and verifies that
// zero errors are produced.  Any assembler error (privilege-zone violation,
// unknown label, out-of-range immediate, etc.) is reported as [FAIL].
//
// Exits 0 when all examples assemble cleanly, 1 if any fail.
//
// Usage:
//   node tests/simulator/sim_asm_examples.js

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

global.window = { bootConfig: {} };

const ChurchAssembler = require('../../simulator/assembler.js');

// ── Extract example sources from app-run.js ──────────────────────────────────

const ROOT       = path.resolve(__dirname, '..', '..');
const srcPath    = path.join(ROOT, 'simulator', 'app-run.js');
const srcText    = fs.readFileSync(srcPath, 'utf8');
const lines      = srcText.split('\n');

// Locate _TURING_DR_TEST_SOURCE block:
//   starts at the line beginning with  `const _TURING_DR_TEST_SOURCE = \``
//   ends   at the first subsequent line whose trimmed content is exactly  `\`;`
let turingStartIdx = -1;
let turingEndIdx   = -1;
for (let i = 0; i < lines.length; i++) {
    if (turingStartIdx < 0 && lines[i].startsWith('const _TURING_DR_TEST_SOURCE = `')) {
        turingStartIdx = i;
        continue;
    }
    if (turingStartIdx >= 0 && turingEndIdx < 0 && lines[i].trim() === '`;') {
        turingEndIdx = i;
        break;
    }
}
if (turingStartIdx < 0 || turingEndIdx < 0) {
    process.stderr.write('ERROR: Could not locate _TURING_DR_TEST_SOURCE block in app-run.js\n');
    process.exit(1);
}
const turingBlock = lines.slice(turingStartIdx, turingEndIdx + 1).join('\n');

// Locate examples block:
//   starts at the line whose trimmed content is `const examples = {`
//   ends   at the first subsequent line whose trimmed content is `};`
//   followed (after blank lines) by the `window._asmExampleSources` assignment.
//   To be safe we scan for the `window._asmExampleSources` sentinel and walk
//   backward to find the closing `};`.
let windowAssignIdx = -1;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('window._asmExampleSources') &&
        lines[i].includes('= examples')) {
        windowAssignIdx = i;
        break;
    }
}
if (windowAssignIdx < 0) {
    process.stderr.write('ERROR: Could not locate `window._asmExampleSources = examples` in app-run.js\n');
    process.exit(1);
}

// Walk backward from the assignment to find `    };`
let examplesEndIdx = -1;
for (let i = windowAssignIdx - 1; i >= 0; i--) {
    if (lines[i].trim() === '};') {
        examplesEndIdx = i;
        break;
    }
}

// Walk backward from examplesEndIdx to find `const examples = {`
let examplesStartIdx = -1;
for (let i = examplesEndIdx - 1; i >= 0; i--) {
    if (lines[i].trim() === 'const examples = {') {
        examplesStartIdx = i;
        break;
    }
}
if (examplesStartIdx < 0 || examplesEndIdx < 0) {
    process.stderr.write('ERROR: Could not locate examples object in app-run.js\n');
    process.exit(1);
}
const examplesBlock = lines.slice(examplesStartIdx, examplesEndIdx + 1).join('\n');

// Evaluate both blocks in a vm sandbox to obtain the `examples` object.
// The examples block references `_TURING_DR_TEST_SOURCE`, so both must be
// evaluated together.
//
// `const` declarations inside vm.runInNewContext are script-scoped and do
// not land on the sandbox; stripping the `const` keyword from the examples
// assignment makes it an implicit global that IS visible on the sandbox.
const fixedExamples = examplesBlock.replace(
    /^(\s*)const examples = \{/m, '$1__examples__ = {'
);

const sandbox = {};
try {
    vm.runInNewContext(turingBlock + '\n' + fixedExamples, sandbox);
} catch (err) {
    process.stderr.write(`ERROR: Failed to evaluate example sources: ${err.message}\n`);
    process.exit(1);
}

const examples = sandbox.__examples__;
if (!examples || typeof examples !== 'object') {
    process.stderr.write('ERROR: examples object is null or not an object after evaluation\n');
    process.exit(1);
}

// ── Standard boot namespace symbol map ───────────────────────────────────────
//
// Derived from simulator/simulator.js _buildNamespaceEntries() (the array index
// is the NS slot number; null entries are freed slots).  This mirrors what the
// browser IDE injects via assembler.setNamespace() after booting, so that
// named loads (LOAD CR0, Salvation) and dot-notation calls
// (CALL Constants.Pi) resolve correctly in headless tests.
const STANDARD_NS_SYMBOLS = {
    'Boot.NS':      0,
    'Boot.Thread':  1,
    // slot 2 freed
    'LED flash':    3,
    'Salvation':    4,
    'Navana':       5,
    'Mint':         6,
    'Memory':       7,
    'Scheduler':    8,
    'Stack':        9,
    'DijkstraFlag': 10,
    // slots 11-14 freed
    'Display':      15,
    'SlideRule':    16,
    'Abacus':       17,
    'Constants':    18,
    'Loader':       19,
    'SUCC':         20,
    'PRED':         21,
    'ADD':          22,
    'SUB':          23,
    'MUL':          24,
    'ISZERO':       25,
    'TRUE':         26,
    'FALSE':        27,
    // slots 28-30 freed
    'Tunnel':       31,
    'Keystone':     32,
    // slots 33-42 freed
    'PAIR':         43,
    'GC':           44,
    'Thread':       45,
    // slot 46 freed
    'Billing':      47,
    'TuringMemory': 48,
    'ChurchMemory': 49,

    // DEMO_CLIST hardware-device shorthands (boot C-List slots 8–17).
    // LED0–LED5 are already handled by the assembler's built-in regex, but
    // bare `LED` (no digit) and device names such as UART, BTN, SlideRule,
    // Timer, and Display are resolved via this table.  The slot numbers
    // match the DEMO_CLIST layout in simulator.js getClistSlotNames().
    'LED':        8,   // bare LED shorthand (same as LED0)
    'UART':      14,
    'BTN':       15,
    'Timer':     17,
};

// ── Method conventions ────────────────────────────────────────────────────────
//
// Build a method convention map so dot-notation CALL / ELOADCALL (e.g.
// `CALL Constants.Pi`, `CALL Salvation.main`) can resolve method selectors.
//
// The primary source is server/lumps/manifest.json — each entry's `methods`
// array is 0-indexed: position 0 → selector 0, position 1 → selector 1, …
//
// Supplement the manifest with a small hardcoded table for abstractions whose
// lumps predate manifest method entries (e.g. Salvation selector 0xF = 15).
const STANDARD_METHOD_CONVENTIONS = (() => {
    const conv = {};

    // Load from manifest (authoritative for all catalogued abstractions).
    const manifestPath = path.join(ROOT, 'server', 'lumps', 'manifest.json');
    try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        for (const entry of manifest) {
            const name    = entry.abstraction || entry.name || '';
            const methods = entry.methods || [];
            if (!name || methods.length === 0) continue;
            const methodMap = {};
            methods.forEach((m, idx) => {
                if (m.name) methodMap[m.name] = { index: idx };
            });
            // If the same abstraction name appears twice (variant groups like
            // SlideRule/SlideRule (Haskell) share the same NS slot), merge rather than
            // overwrite so both method sets are known.
            conv[name] = Object.assign(conv[name] || {}, methodMap);
        }
    } catch (e) {
        process.stderr.write(`WARN: Could not read manifest for method conventions: ${e.message}\n`);
    }

    // Hardcoded supplement: Salvation is not yet in the manifest.
    // Selector 0xF (15) is the method-offset index for `main` as documented
    // in app-run.js ("CALL CR0, 0xF  ; 0xF = method-offset index for main").
    if (!conv['Salvation']) conv['Salvation'] = {};
    conv['Salvation']['main'] = { index: 15 };

    // Hardcoded supplement: SelfTest — boot-resident lump.  The manifest entry
    // has no `methods` array, so conventions must be seeded here so that
    // `SelfTest Run` in the bare-space sugar example resolves to index 0 (the
    // fast-path entry point) rather than falling back to the unvalidated index-0
    // placeholder with a warning.
    if (!conv['SelfTest']) conv['SelfTest'] = {};
    conv['SelfTest']['Run']  = { index: 0 };
    conv['SelfTest']['Stop'] = { index: 1 };

    return conv;
})();

// Seed the class-wide shared namespace and method conventions so every
// ChurchAssembler instance created below inherits them automatically
// (mirrors setNamespace() / setSharedMethodConventions() behaviour in the IDE).
{
    const _seed = new ChurchAssembler();
    _seed.setNamespace(STANDARD_NS_SYMBOLS);
    _seed.setSharedMethodConventions(STANDARD_METHOD_CONVENTIONS);
}

// ── Assemble every example ────────────────────────────────────────────────────

const ERRORS = [];
let passCount = 0;

// Emit the total example count before iterating so the pytest wrapper can
// parse it and use a dynamic assertion rather than a hardcoded lower bound.
const allExampleKeys = Object.keys(examples);
process.stdout.write(`TOTAL_EXAMPLES=${allExampleKeys.length}\n`);

for (const [name, source] of Object.entries(examples)) {
    if (typeof source !== 'string' || source.trim() === '') {
        // Treat an empty or non-string source as a failure — every key in the
        // examples object must have real assembly code to be worth testing.
        process.stderr.write(`[FAIL] ${name}: source is empty or not a string — every example must contain assembly code\n`);
        ERRORS.push(name);
        continue;
    }

    const asm    = new ChurchAssembler();
    const result = asm.assemble(source);

    if (result.errors.length === 0) {
        process.stdout.write(`[PASS] ${name}: assembled cleanly (${result.words.length} words)\n`);
        passCount++;
    } else {
        const msgs = result.errors.map(e => `  line ${e.line}: ${e.message}`).join('\n');
        process.stderr.write(`[FAIL] ${name}:\n${msgs}\n`);
        ERRORS.push(name);
    }
}

// ── Bare-space sugar method-index verification ────────────────────────────────
//
// Re-assembles the 'selftest_bare_space_sugar' example with the full shared
// conventions active and verifies that:
//   (a) it assembles with zero errors,
//   (b) the first assembled word is an ELOADCALL instruction (opcode 8),
//   (c) the c-list row encoded in imm[4:0] is 0 (SelfTest is the first and
//       only capabilities entry, so it occupies slot 0), and
//   (d) the method index encoded in imm[11:5] is 1 (1-based), i.e. method
//       index 0 (Run) stored as 1-based = 1 in the 7-bit funct7 field.
//
// If any of these assertions fail, the suite exits non-zero just like a
// regular assembly error would — so a future assembler change that silently
// mis-encodes the bare-space sugar will be caught here.

const BARE_SPACE_KEY = 'selftest_bare_space_sugar';
const bsSrc = examples[BARE_SPACE_KEY];

if (!bsSrc) {
    process.stderr.write(`[FAIL] method-index check: example '${BARE_SPACE_KEY}' not found in examples object\n`);
    ERRORS.push(BARE_SPACE_KEY + ':method-index-check');
} else {
    const bsAsm = new ChurchAssembler();
    const bsResult = bsAsm.assemble(bsSrc);

    let bsOk = true;

    if (bsResult.errors.length > 0) {
        const msgs = bsResult.errors.map(e => `  line ${e.line}: ${e.message}`).join('\n');
        process.stderr.write(`[FAIL] ${BARE_SPACE_KEY} method-index check — assembly errors:\n${msgs}\n`);
        bsOk = false;
    }

    if (bsResult.words.length === 0) {
        process.stderr.write(`[FAIL] ${BARE_SPACE_KEY} method-index check — no words assembled (expected at least 1)\n`);
        bsOk = false;
    }

    if (bsResult.words.length > 0) {
        const w       = bsResult.words[0] >>> 0;
        const opcode  = (w >>> 27) & 0x1F;
        const imm15   = w & 0x7FFF;
        const clistRow       = imm15 & 0x1F;
        const methIdx1based  = (imm15 >>> 5) & 0x7F;
        const methIdx0based  = methIdx1based - 1;

        // opcode must be 8 (ELOADCALL)
        if (opcode !== 8) {
            process.stderr.write(
                `[FAIL] ${BARE_SPACE_KEY} method-index check — first word opcode is ${opcode} (0x${opcode.toString(16)}), expected 8 (ELOADCALL)\n`);
            bsOk = false;
        }

        // c-list row must be 0 (SelfTest is the sole capabilities entry)
        if (clistRow !== 0) {
            process.stderr.write(
                `[FAIL] ${BARE_SPACE_KEY} method-index check — ELOADCALL c-list row is ${clistRow}, expected 0 (SelfTest declared as first capability)\n`);
            bsOk = false;
        }

        // method index 0 (Run) is stored 1-based as 1 in bits[11:5]
        if (methIdx1based !== 1) {
            process.stderr.write(
                `[FAIL] ${BARE_SPACE_KEY} method-index check — ELOADCALL method index (1-based) is ${methIdx1based}, expected 1 (method 0 = Run)\n` +
                `       (0-based index decoded: ${methIdx0based}; c-list row: ${clistRow}; word: 0x${w.toString(16).padStart(8,'0')})\n`);
            bsOk = false;
        }

        if (bsOk) {
            process.stdout.write(
                `[PASS] ${BARE_SPACE_KEY} method-index check — ` +
                `ELOADCALL opcode=${opcode}, clist-row=${clistRow}, method-idx(0-based)=${methIdx0based} ` +
                `(word=0x${w.toString(16).padStart(8,'0')})\n`);
        }
    }

    if (!bsOk) {
        ERRORS.push(BARE_SPACE_KEY + ':method-index-check');
    }
}

// ── Final report ──────────────────────────────────────────────────────────────

const total = passCount + ERRORS.length;
process.stdout.write(`\n${passCount}/${total} examples assembled without errors.\n`);

if (ERRORS.length > 0) {
    process.stderr.write(`\n${ERRORS.length} example(s) FAILED: ${ERRORS.join(', ')}\n`);
    process.exit(1);
}
process.exit(0);
