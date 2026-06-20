'use strict';

// Lambda compiler execution tests
// Compiles Lambda methods via CLOOMCCompiler and runs them in ChurchSimulator,
// asserting correct arithmetic return values.

const ChurchSimulator = require('./simulator.js');
global.ChurchAssembler = require('./assembler.js');
const CLOOMCCompiler = require('./cloomc_compiler.js');

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
    if (condition) {
        console.log('PASS ' + label);
        passed++;
    } else {
        console.log('FAIL ' + label + (detail !== undefined ? ' — ' + detail : ''));
        failed++;
    }
}

const SOURCE = `-- LAMBDA CALCULUS
abstraction RationalArithmetic {
    method addDen(d1, d2) = d1 * d2
    method mulNum(n1, n2) = n1 * n2
    method divNum(n, d) = n / d
    method divDen(a, b) = b / a
    method isEqual(n1, d1, n2, d2) =
        if (n1 * d2) == (n2 * d1) then 1 else 0
}`;

const compiler = new CLOOMCCompiler();
const compiled = compiler.compileLambda(SOURCE);

const CODE_BASE = 0x200;
const MAX_STEPS = 200000;

function runMethod(methodName, args) {
    const method = compiled.methods && compiled.methods.find(m => m.name === methodName);
    if (!method) {
        return { error: 'Method ' + methodName + ' not found' };
    }
    const words = method.code;
    if (!words || words.length === 0) {
        return { error: 'Method ' + methodName + ' has no compiled code' };
    }

    const sim = new ChurchSimulator();

    // Bypass full boot: set up minimal execution state
    sim.bootComplete = true;

    // Write method code words to memory at CODE_BASE+1
    // (CODE_BASE is the lump header word; code starts at +1)
    for (let i = 0; i < words.length; i++) {
        sim.memory[CODE_BASE + 1 + i] = words[i] >>> 0;
    }

    // Point CR14 at the code region (word0 must be non-zero)
    const cr14GT = sim.createGT(0, 3, { R: 1, W: 0, X: 1, L: 0, S: 0, E: 0 }, 1);
    sim.cr[14] = { word0: cr14GT, word1: CODE_BASE, word2: 0, word3: 0, m: 0 };

    // Override mLoad to bypass full capability validation for pure unit testing.
    // The Lambda arithmetic instructions (IADD, ISUB, MCMP, BRANCH, RETURN) only
    // trigger mLoad during instruction fetch (_fetchInstruction), never for data.
    sim.mLoad = function (gt, perm, crIdx, addr) {
        if (!gt || gt === 0) {
            return { ok: false, fault: 'NULL_CAP', message: 'null GT' };
        }
        return {
            ok: true,
            parsed: { index: 3, gt_seq: 0, permissions: { R: 1, X: 1 } },
            entry: { word0_location: CODE_BASE, word1_limit: CODE_BASE + 0x1000 },
            index: 3,
        };
    };

    // Load argument registers (params → DR1, DR2, DR3, DR4, ...)
    sim.dr.fill(0);
    for (let i = 0; i < args.length; i++) {
        sim.dr[1 + i] = args[i] | 0;
    }
    sim.pc = 0;
    sim.halted = false;

    // Push a non-sentinel call frame so that RETURN can pop it cleanly.
    // No saved CRs/DRs/flags so the arithmetic results are preserved after return.
    sim.callStack.push({
        sentinel: false,
        sz: 1,
        returnPC: 0xFFF0,
        savedCRs: null,
        savedDRs: null,
        savedFlags: null,
    });
    const targetDepth = sim.callStack.length;

    // Step until RETURN pops the frame (depth shrinks) or we detect a problem
    let steps = 0;
    while (!sim.halted && sim.callStack.length >= targetDepth && steps < MAX_STEPS) {
        sim.step();
        steps++;
    }

    if (steps >= MAX_STEPS) {
        return { error: 'exceeded ' + MAX_STEPS + ' steps — possible infinite loop', steps };
    }
    if (sim.halted) {
        const faultMsg = sim.faultLog && sim.faultLog.length
            ? sim.faultLog[sim.faultLog.length - 1].message
            : 'unknown';
        return { error: 'simulator halted: ' + faultMsg, steps };
    }

    return { result: sim.dr[1] | 0, steps };
}

// ── Compilation checks ────────────────────────────────────────────────────────
console.log('\n--- Compilation ---');

assert('COMP1 compileLambda produces no errors',
    compiled.errors.length === 0,
    compiled.errors.map(function (e) { return e.message; }).join('; '));

assert('COMP2 addDen method compiled',
    !!(compiled.methods && compiled.methods.find(function (m) {
        return m.name === 'addDen' && m.code && m.code.length > 0;
    })));

assert('COMP3 mulNum method compiled',
    !!(compiled.methods && compiled.methods.find(function (m) {
        return m.name === 'mulNum' && m.code && m.code.length > 0;
    })));

assert('COMP4 isEqual method compiled',
    !!(compiled.methods && compiled.methods.find(function (m) {
        return m.name === 'isEqual' && m.code && m.code.length > 0;
    })));

assert('COMP5 divNum method compiled',
    !!(compiled.methods && compiled.methods.find(function (m) {
        return m.name === 'divNum' && m.code && m.code.length > 0;
    })));

assert('COMP6 divDen method compiled',
    !!(compiled.methods && compiled.methods.find(function (m) {
        return m.name === 'divDen' && m.code && m.code.length > 0;
    })));

// ── Runtime: addDen ───────────────────────────────────────────────────────────
console.log('\n--- Runtime: addDen ---');
{
    const r = runMethod('addDen', [3, 4]);
    assert('EXEC1 addDen(3,4) runs without error', !r.error, r.error);
    assert('EXEC2 addDen(3,4) = 12', !r.error && r.result === 12,
        'got ' + r.result + ' in ' + r.steps + ' steps');
}

// ── Runtime: mulNum ───────────────────────────────────────────────────────────
console.log('\n--- Runtime: mulNum ---');
{
    const r = runMethod('mulNum', [5, 6]);
    assert('EXEC3 mulNum(5,6) runs without error', !r.error, r.error);
    assert('EXEC4 mulNum(5,6) = 30', !r.error && r.result === 30,
        'got ' + r.result + ' in ' + r.steps + ' steps');
}

// ── Runtime: divNum ───────────────────────────────────────────────────────────
console.log('\n--- Runtime: divNum ---');
{
    const r = runMethod('divNum', [30, 5]);
    assert('EXEC5 divNum(30,5) runs without error', !r.error, r.error);
    assert('EXEC6 divNum(30,5) = 6', !r.error && r.result === 6,
        'got ' + r.result + ' in ' + r.steps + ' steps');
}

// ── Runtime: divDen ───────────────────────────────────────────────────────────
console.log('\n--- Runtime: divDen ---');
{
    const r = runMethod('divDen', [3, 6]);
    assert('EXEC7 divDen(3,6) runs without error', !r.error, r.error);
    assert('EXEC8 divDen(3,6) = 2', !r.error && r.result === 2,
        'got ' + r.result + ' in ' + r.steps + ' steps');
}

// ── Runtime: isEqual — equal fractions ───────────────────────────────────────
console.log('\n--- Runtime: isEqual ---');
{
    const r = runMethod('isEqual', [1, 2, 2, 4]);
    assert('EXEC9 isEqual(1,2,2,4) runs without error', !r.error, r.error);
    assert('EXEC10 isEqual(1,2,2,4) = 1', !r.error && r.result === 1,
        'got ' + r.result + ' in ' + r.steps + ' steps');
}

// ── Runtime: isEqual — unequal fractions ─────────────────────────────────────
{
    const r = runMethod('isEqual', [1, 2, 1, 3]);
    assert('EXEC11 isEqual(1,2,1,3) runs without error', !r.error, r.error);
    assert('EXEC12 isEqual(1,2,1,3) = 0', !r.error && r.result === 0,
        'got ' + r.result + ' in ' + r.steps + ' steps');
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n--- Summary ---');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
    process.exit(1);
}
