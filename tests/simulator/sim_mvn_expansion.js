// Headless harness for Task #1033.
//
// Verifies that the MVN pseudo-instruction expands to the correct word
// sequence in both the same-register and different-register cases.
//
// Strategy: assemble the MVN form, then assemble the expected expansion
// directly, and compare word-for-word.  This exercises the production
// assembler code path and does not require hard-coded magic numbers.
//
// Covers both assembler copies:
//   simulator/assembler.js   (IDE / web path)
//   church_sim/assembler.js  (hardware-sim path)
//
// Exits 0 on success, 1 on any failure.

'use strict';

global.window = { bootConfig: {} };

const SimAssembler      = require('../../simulator/assembler.js');
const ChurchSimAssembler = require('../../church_sim/assembler.js');

const ERRORS = [];
function fail(label, msg) {
    ERRORS.push(`[FAIL] ${label}: ${msg}`);
    process.stderr.write(`[FAIL] ${label}: ${msg}\n`);
}
function pass(label) {
    process.stdout.write(`[PASS] ${label}\n`);
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function assemble(AsmClass, source, label) {
    const asm = new AsmClass();
    const result = asm.assemble(source);
    if (result.errors && result.errors.length > 0) {
        result.errors.forEach(e => {
            fail(label, `Assembler error at line ${e.line}: ${e.message}`);
        });
        return null;
    }
    return result.words;
}

function wordsEqual(a, b) {
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if ((a[i] >>> 0) !== (b[i] >>> 0)) return false;
    }
    return true;
}

function wordStr(words) {
    if (!words) return '(null)';
    return '[' + words.map(w => '0x' + (w >>> 0).toString(16).padStart(8, '0')).join(', ') + ']';
}

// ─── Tests ────────────────────────────────────────────────────────────────────

//
// For each assembler class run four tests:
//
//   T1  MVN DR1, DR1  (same-register, DR1)
//       Expected expansion (4 instructions, scratch = DR0):
//         ISUB DR0, DR1, DR1
//         ISUB DR0, DR0, DR1
//         ISUB DR0, DR0, #1
//         IADD DR1, DR0, #0
//
//   T2  MVN DR0, DR0  (same-register, DR0 — scratch must flip to DR1)
//       Expected expansion (4 instructions, scratch = DR1):
//         ISUB DR1, DR0, DR0
//         ISUB DR1, DR1, DR0
//         ISUB DR1, DR1, #1
//         IADD DR0, DR1, #0
//
//   T3  MVN DR2, DR1  (different registers)
//       Expected expansion (3 instructions):
//         ISUB DR2, DR1, DR1
//         ISUB DR2, DR2, DR1
//         ISUB DR2, DR2, #1
//
//   T4  MVN DR1, DR3  (different registers, src ≠ dst)
//       Expected expansion (3 instructions):
//         ISUB DR1, DR3, DR3
//         ISUB DR1, DR1, DR3
//         ISUB DR1, DR1, #1
//

const CASES = [
    {
        id:  'T1',
        src: 'MVN DR1, DR1',
        exp: [
            'ISUB DR0, DR1, DR1',
            'ISUB DR0, DR0, DR1',
            'ISUB DR0, DR0, #1',
            'IADD DR1, DR0, #0',
        ].join('\n'),
        desc: 'MVN DR1, DR1 (same-register) → 4-instruction scratch-register expansion',
    },
    {
        id:  'T2',
        src: 'MVN DR0, DR0',
        exp: [
            'ISUB DR1, DR0, DR0',
            'ISUB DR1, DR1, DR0',
            'ISUB DR1, DR1, #1',
            'IADD DR0, DR1, #0',
        ].join('\n'),
        desc: 'MVN DR0, DR0 (same-register, DR0) → scratch flips to DR1',
    },
    {
        id:  'T3',
        src: 'MVN DR2, DR1',
        exp: [
            'ISUB DR2, DR1, DR1',
            'ISUB DR2, DR2, DR1',
            'ISUB DR2, DR2, #1',
        ].join('\n'),
        desc: 'MVN DR2, DR1 (different registers) → 3-instruction normal expansion',
    },
    {
        id:  'T4',
        src: 'MVN DR1, DR3',
        exp: [
            'ISUB DR1, DR3, DR3',
            'ISUB DR1, DR1, DR3',
            'ISUB DR1, DR1, #1',
        ].join('\n'),
        desc: 'MVN DR1, DR3 (different registers, src≠dst) → 3-instruction normal expansion',
    },
];

for (const [asmName, AsmClass] of [
    ['simulator/assembler.js',   SimAssembler],
    ['church_sim/assembler.js',  ChurchSimAssembler],
]) {
    for (const tc of CASES) {
        const label = `${asmName} ${tc.id}`;

        const got = assemble(AsmClass, tc.src, label);
        const exp = assemble(AsmClass, tc.exp, label);

        if (got === null || exp === null) {
            // assemble() already called fail() for each error
            continue;
        }

        if (!wordsEqual(got, exp)) {
            fail(label, (
                `${tc.desc}\n` +
                `  Expected ${exp.length} word(s): ${wordStr(exp)}\n` +
                `  Got      ${got.length} word(s): ${wordStr(got)}`
            ));
        } else {
            pass(`${label}: ${tc.desc}`);
        }
    }
}

// ─── Final result ─────────────────────────────────────────────────────────────

if (ERRORS.length > 0) {
    process.exit(1);
} else {
    process.stdout.write(`\nAll ${CASES.length * 2} MVN expansion checks passed.\n`);
    process.exit(0);
}
