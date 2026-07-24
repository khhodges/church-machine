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

// ── Source A: basic arithmetic (fits within 4-temp budget) ────────────────────
// Each multiply uses 2 temp registers (result DR + counter DR for iterative-add
// loop), so any expression with two or more multiplications in the same
// sub-expression tree will exhaust all four temps (DR12–DR15).
//
// Budget breakdown for methods in SOURCE:
//   addDen = d1 * d2        → 2 temps (result + counter) ✓
//   mulNum = n1 * n2        → 2 temps ✓
//   equalInts = if x==y     → 1 temp for the boolean result ✓
//
const SOURCE = `-- LAMBDA CALCULUS
abstraction RationalArithmetic {
    method addDen(d1, d2) = d1 * d2
    method mulNum(n1, n2) = n1 * n2
    method equalInts(x, y) = if x == y then 1 else 0
    method divNum(n, d) = n / d
    method divDen(a, b) = b / a
    method modNum(a, b) = a % b
    method idivNum(a, b) = a // b
    method gcd(a, b) = if b == 0 then a else gcd b (a % b)
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
        if (!gt || ChurchSimulator.isNullGT(gt)) {
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

assert('COMP4 equalInts method compiled',
    !!(compiled.methods && compiled.methods.find(function (m) {
        return m.name === 'equalInts' && m.code && m.code.length > 0;
    })));

assert('COMP5 divNum method compiled',
    !!(compiled.methods && compiled.methods.find(function (m) {
        return m.name === 'divNum' && m.code && m.code.length > 0;
    })));

assert('COMP6 divDen method compiled',
    !!(compiled.methods && compiled.methods.find(function (m) {
        return m.name === 'divDen' && m.code && m.code.length > 0;
    })));

assert('COMP7 modNum method compiled',
    !!(compiled.methods && compiled.methods.find(function (m) {
        return m.name === 'modNum' && m.code && m.code.length > 0;
    })));

assert('COMP8 idivNum method compiled',
    !!(compiled.methods && compiled.methods.find(function (m) {
        return m.name === 'idivNum' && m.code && m.code.length > 0;
    })));

assert('COMP9 gcd method compiled',
    !!(compiled.methods && compiled.methods.find(function (m) {
        return m.name === 'gcd' && m.code && m.code.length > 0;
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

// ── Runtime: equalInts ────────────────────────────────────────────────────────
console.log('\n--- Runtime: equalInts ---');
{
    const r = runMethod('equalInts', [7, 7]);
    assert('EXEC19 equalInts(7,7) runs without error', !r.error, r.error);
    assert('EXEC20 equalInts(7,7) = 1', !r.error && r.result === 1,
        'got ' + r.result + ' in ' + r.steps + ' steps');
}
{
    const r = runMethod('equalInts', [3, 5]);
    assert('EXEC21 equalInts(3,5) runs without error', !r.error, r.error);
    assert('EXEC22 equalInts(3,5) = 0', !r.error && r.result === 0,
        'got ' + r.result + ' in ' + r.steps + ' steps');
}

// ── Runtime: modNum ───────────────────────────────────────────────────────────
console.log('\n--- Runtime: modNum ---');
{
    const r = runMethod('modNum', [10, 3]);
    assert('EXEC13 modNum(10,3) runs without error', !r.error, r.error);
    assert('EXEC14 modNum(10,3) = 1', !r.error && r.result === 1,
        'got ' + r.result + ' in ' + r.steps + ' steps');
}
{
    const r = runMethod('modNum', [9, 3]);
    assert('EXEC15 modNum(9,3) runs without error', !r.error, r.error);
    assert('EXEC16 modNum(9,3) = 0', !r.error && r.result === 0,
        'got ' + r.result + ' in ' + r.steps + ' steps');
}

// ── Runtime: idivNum ──────────────────────────────────────────────────────────
console.log('\n--- Runtime: idivNum ---');
{
    const r = runMethod('idivNum', [10, 3]);
    assert('EXEC17 idivNum(10,3) runs without error', !r.error, r.error);
    assert('EXEC18 idivNum(10,3) = 3', !r.error && r.result === 3,
        'got ' + r.result + ' in ' + r.steps + ' steps');
}

// ── Runtime: gcd ──────────────────────────────────────────────────────────────
console.log('\n--- Runtime: gcd ---');
{
    const r = runMethod('gcd', [12, 8]);
    assert('EXEC19 gcd(12,8) runs without error', !r.error, r.error);
    assert('EXEC20 gcd(12,8) = 4', !r.error && r.result === 4,
        'got ' + r.result + ' in ' + r.steps + ' steps');
}
{
    const r = runMethod('gcd', [7, 3]);
    assert('EXEC21 gcd(7,3) runs without error', !r.error, r.error);
    assert('EXEC22 gcd(7,3) = 1', !r.error && r.result === 1,
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

// ── Source B: 3-and-4 temp expressions ────────────────────────────────────────
// Verify that expressions using 3 or exactly 4 simultaneous temporaries
// compile and produce correct results — these sit at the edge of the budget.
//
// Budget trace for productOfSums(a,b,c,d) = (a+b) * (c+d):
//   a+b  → t0=DR12  (1 temp in use)
//   c+d  → t1=DR13  (2 temps in use)
//   t0*t1 → result=DR14 + counter=DR15  (all 4 temps in use, but none needed
//            after this so the method returns without overflowing)  ✓
//
// Budget trace for mulAndAdd(a,b,c) = a*b + c:
//   a*b  → result=DR12, counter=DR13  (2 temps in use)
//   DR12+c → t2=DR14   (3 temps in use)  ✓
//
const SOURCE2 = `-- LAMBDA CALCULUS
abstraction ComplexArithmetic {
    method productOfSums(a, b, c, d) = (a + b) * (c + d)
    method mulAndAdd(a, b, c) = a * b + c
}`;

console.log('\n--- ComplexArithmetic compilation ---');
const compiler2 = new CLOOMCCompiler();
const compiled2 = compiler2.compileLambda(SOURCE2);

assert('COMP5 ComplexArithmetic compiles without errors',
    compiled2.errors.length === 0,
    compiled2.errors.map(function (e) { return e.message; }).join('; '));

assert('COMP6 productOfSums method compiled',
    !!(compiled2.methods && compiled2.methods.find(function (m) {
        return m.name === 'productOfSums' && m.code && m.code.length > 0;
    })));

assert('COMP7 mulAndAdd method compiled',
    !!(compiled2.methods && compiled2.methods.find(function (m) {
        return m.name === 'mulAndAdd' && m.code && m.code.length > 0;
    })));

function runMethod2(methodName, args) {
    const method = compiled2.methods && compiled2.methods.find(function (m) { return m.name === methodName; });
    if (!method) return { error: 'Method ' + methodName + ' not found' };
    const words = method.code;
    if (!words || words.length === 0) return { error: 'Method ' + methodName + ' has no code' };

    const sim = new ChurchSimulator();
    sim.bootComplete = true;
    for (let i = 0; i < words.length; i++) {
        sim.memory[CODE_BASE + 1 + i] = words[i] >>> 0;
    }
    const cr14GT = sim.createGT(0, 3, { R: 1, W: 0, X: 1, L: 0, S: 0, E: 0 }, 1);
    sim.cr[14] = { word0: cr14GT, word1: CODE_BASE, word2: 0, word3: 0, m: 0 };
    sim.mLoad = function (gt) {
        if (!gt || ChurchSimulator.isNullGT(gt)) return { ok: false, fault: 'NULL_CAP', message: 'null GT' };
        return { ok: true, parsed: { index: 3, gt_seq: 0, permissions: { R: 1, X: 1 } }, entry: { word0_location: CODE_BASE, word1_limit: CODE_BASE + 0x1000 }, index: 3 };
    };
    sim.dr.fill(0);
    for (let i = 0; i < args.length; i++) { sim.dr[1 + i] = args[i] | 0; }
    sim.pc = 0;
    sim.halted = false;
    sim.callStack.push({ sentinel: false, sz: 1, returnPC: 0xFFF0, savedCRs: null, savedDRs: null, savedFlags: null });
    const targetDepth = sim.callStack.length;
    let steps = 0;
    while (!sim.halted && sim.callStack.length >= targetDepth && steps < MAX_STEPS) {
        sim.step();
        steps++;
    }
    if (steps >= MAX_STEPS) return { error: 'exceeded ' + MAX_STEPS + ' steps', steps };
    if (sim.halted) {
        const faultMsg = sim.faultLog && sim.faultLog.length
            ? sim.faultLog[sim.faultLog.length - 1].message : 'unknown';
        return { error: 'simulator halted: ' + faultMsg, steps };
    }
    return { result: sim.dr[1] | 0, steps };
}

// ── Runtime: productOfSums ────────────────────────────────────────────────────
// (3+4) * (5+6) = 7 * 11 = 77
console.log('\n--- Runtime: productOfSums (4-temp boundary) ---');
{
    const r = runMethod('isEqual', [1, 2, 1, 3]);
    assert('EXEC11 isEqual(1,2,1,3) runs without error', !r.error, r.error);
    assert('EXEC12 isEqual(1,2,1,3) = 0', !r.error && r.result === 0,
        'got ' + r.result + ' in ' + r.steps + ' steps');
}

// ── Runtime: productOfSums — first case ───────────────────────────────────────
{
    const r = runMethod2('productOfSums', [3, 4, 5, 6]);
    assert('EXEC23  productOfSums(3,4,5,6) runs without error', !r.error, r.error);
    assert('EXEC24 productOfSums(3,4,5,6) = 77', !r.error && r.result === 77,
        'got ' + r.result + ' in ' + r.steps + ' steps');
}
// (1+0) * (2+3) = 1 * 5 = 5  (edge: zero addend)
{
    const r = runMethod2('productOfSums', [1, 0, 2, 3]);
    assert('EXEC11 productOfSums(1,0,2,3) = 5', !r.error && r.result === 5,
        'got ' + r.result + ' in ' + r.steps + ' steps');
}
// (0+0) * (9+1) = 0  (edge: zero product)
{
    const r = runMethod2('productOfSums', [0, 0, 9, 1]);
    assert('EXEC12 productOfSums(0,0,9,1) = 0', !r.error && r.result === 0,
        'got ' + r.result + ' in ' + r.steps + ' steps');
}

// ── Runtime: mulAndAdd ────────────────────────────────────────────────────────
// 3*4 + 5 = 12 + 5 = 17
console.log('\n--- Runtime: mulAndAdd (3-temp expression) ---');
{
    const r = runMethod2('mulAndAdd', [3, 4, 5]);
    assert('EXEC13 mulAndAdd(3,4,5) runs without error', !r.error, r.error);
    assert('EXEC14 mulAndAdd(3,4,5) = 17', !r.error && r.result === 17,
        'got ' + r.result + ' in ' + r.steps + ' steps');
}
// 0*7 + 3 = 3  (edge: zero multiplicand)
{
    const r = runMethod2('mulAndAdd', [0, 7, 3]);
    assert('EXEC15 mulAndAdd(0,7,3) = 3', !r.error && r.result === 3,
        'got ' + r.result + ' in ' + r.steps + ' steps');
}
// 6*6 + 0 = 36
{
    const r = runMethod2('mulAndAdd', [6, 6, 0]);
    assert('EXEC16 mulAndAdd(6,6,0) = 36', !r.error && r.result === 36,
        'got ' + r.result + ' in ' + r.steps + ' steps');
}

// ── Haskell front-end: modulo, integer division, plain division ───────────────

const HASKELL_SOURCE = `abstraction HaskellArith {
    method hmodNum(a, b) = a % b
    method hidivNum(a, b) = a // b
    method hdivNum(n, d) = n / d
}`;

const haskellCompiler = new CLOOMCCompiler();
const haskellCompiled = haskellCompiler.compile(HASKELL_SOURCE, []);

function runHaskellMethod(methodName, args) {
    const method = haskellCompiled.methods && haskellCompiled.methods.find(function (m) { return m.name === methodName; });
    if (!method) return { error: 'Method ' + methodName + ' not found' };
    const words = method.code;
    if (!words || words.length === 0) return { error: 'Method ' + methodName + ' has no compiled code' };
    const sim = new ChurchSimulator();
    sim.bootComplete = true;
    for (let i = 0; i < words.length; i++) {
        sim.memory[CODE_BASE + 1 + i] = words[i] >>> 0;
    }
    const cr14GT = sim.createGT(0, 3, { R: 1, W: 0, X: 1, L: 0, S: 0, E: 0 }, 1);
    sim.cr[14] = { word0: cr14GT, word1: CODE_BASE, word2: 0, word3: 0, m: 0 };
    sim.mLoad = function (gt) {
        if (!gt || ChurchSimulator.isNullGT(gt)) return { ok: false, fault: 'NULL_CAP', message: 'null GT' };
        return { ok: true, parsed: { index: 3, gt_seq: 0, permissions: { R: 1, X: 1 } }, entry: { word0_location: CODE_BASE, word1_limit: CODE_BASE + 0x1000 }, index: 3 };
    };
    sim.dr.fill(0);
    for (let i = 0; i < args.length; i++) { sim.dr[1 + i] = args[i] | 0; }
    sim.pc = 0;
    sim.halted = false;
    sim.callStack.push({ sentinel: false, sz: 1, returnPC: 0xFFF0, savedCRs: null, savedDRs: null, savedFlags: null });
    const targetDepth = sim.callStack.length;
    let steps = 0;
    while (!sim.halted && sim.callStack.length >= targetDepth && steps < MAX_STEPS) {
        sim.step();
        steps++;
    }
    if (steps >= MAX_STEPS) return { error: 'exceeded ' + MAX_STEPS + ' steps', steps };
    if (sim.halted) {
        const faultMsg = sim.faultLog && sim.faultLog.length ? sim.faultLog[sim.faultLog.length - 1].message : 'unknown';
        return { error: 'simulator halted: ' + faultMsg, steps };
    }
    return { result: sim.dr[1] | 0, steps };
}

console.log('\n--- Haskell front-end compilation ---');

assert('HCOMP1 Haskell source detected as haskell language',
    haskellCompiled.language === 'haskell',
    'got language: ' + haskellCompiled.language);

assert('HCOMP2 haskellCompiled produces no errors',
    haskellCompiled.errors.length === 0,
    haskellCompiled.errors.map(function (e) { return e.message; }).join('; '));

assert('HCOMP3 hmodNum method compiled',
    !!(haskellCompiled.methods && haskellCompiled.methods.find(function (m) {
        return m.name === 'hmodNum' && m.code && m.code.length > 0;
    })));

assert('HCOMP4 hidivNum method compiled',
    !!(haskellCompiled.methods && haskellCompiled.methods.find(function (m) {
        return m.name === 'hidivNum' && m.code && m.code.length > 0;
    })));

assert('HCOMP5 hdivNum method compiled',
    !!(haskellCompiled.methods && haskellCompiled.methods.find(function (m) {
        return m.name === 'hdivNum' && m.code && m.code.length > 0;
    })));

console.log('\n--- Haskell runtime: hmodNum (%) ---');
{
    const r = runHaskellMethod('hmodNum', [10, 3]);
    assert('HEXEC1 hmodNum(10,3) runs without error', !r.error, r.error);
    assert('HEXEC2 hmodNum(10,3) = 1', !r.error && r.result === 1,
        'got ' + r.result + ' in ' + r.steps + ' steps');
}
{
    const r = runHaskellMethod('hmodNum', [9, 3]);
    assert('HEXEC3 hmodNum(9,3) runs without error', !r.error, r.error);
    assert('HEXEC4 hmodNum(9,3) = 0', !r.error && r.result === 0,
        'got ' + r.result + ' in ' + r.steps + ' steps');
}

console.log('\n--- Haskell runtime: hidivNum (//) ---');
{
    const r = runHaskellMethod('hidivNum', [10, 3]);
    assert('HEXEC5 hidivNum(10,3) runs without error', !r.error, r.error);
    assert('HEXEC6 hidivNum(10,3) = 3', !r.error && r.result === 3,
        'got ' + r.result + ' in ' + r.steps + ' steps');
}
{
    const r = runHaskellMethod('hidivNum', [12, 4]);
    assert('HEXEC7 hidivNum(12,4) runs without error', !r.error, r.error);
    assert('HEXEC8 hidivNum(12,4) = 3', !r.error && r.result === 3,
        'got ' + r.result + ' in ' + r.steps + ' steps');
}

console.log('\n--- Haskell runtime: hdivNum (/) ---');
{
    const r = runHaskellMethod('hdivNum', [20, 4]);
    assert('HEXEC9 hdivNum(20,4) runs without error', !r.error, r.error);
    assert('HEXEC10 hdivNum(20,4) = 5', !r.error && r.result === 5,
        'got ' + r.result + ' in ' + r.steps + ' steps');
}

// ── Regression: non-tail self-calls must not be silently miscompiled ──────────
// A self-call that is NOT in tail position (i.e. the result feeds into another
// operation, like (f (n-1)) + 1) cannot be compiled by the tail-loop mechanism.
// The compiler should report an error rather than emit a silently wrong result.
console.log('\n--- Regression: non-tail recursion rejected ---');
{
    const ntSrc = `-- LAMBDA CALCULUS
abstraction NonTailTest {
    method f(n) = if n == 0 then 0 else (f (n - 1)) + 1
}`;
    const ntCompiler = new CLOOMCCompiler();
    const ntResult = ntCompiler.compileLambda(ntSrc);
    assert('COMP10 non-tail self-call produces compile error (not silent miscompilation)',
        ntResult.errors && ntResult.errors.length > 0,
        'expected compile error for non-tail recursion, got none; methods: ' +
            JSON.stringify((ntResult.methods || []).map(function(m) { return m.name; })));
}

// ── Register exhaustion guard ─────────────────────────────────────────────────
// Expressions requiring 5+ simultaneous temporaries exhaust DR12–DR15.
// Because each '*' emits an iterative-add loop using 2 temp registers (one for
// the running product, one for the countdown counter), any method that keeps
// two products live at the same time triggers the limit.
//
// The guard in _allocTemp emits a compiler WARNING (not an error) so that
// compilation still succeeds while surfacing the diagnosis.  The generated
// code falls back to DR12 and may produce wrong results for expressions with
// 5+ simultaneous live temporaries, but the method is still emitted so the
// programmer can see the warning and fix the expression.
//
// Test EXHAUST1–EXHAUST2: (a*b + c*d) + (e*f + g*h)
//   Temp allocation trace:
//     a*b  → t0=DR12(result) + t1=DR13(counter)  — locals['_t12','_t13']
//     c*d  → t2=DR14(result) + t3=DR15(counter)  — locals['_t14','_t15']
//     t0+t2  → needs t4 ← ALL 4 TEMPS IN USE → exhaustion guard fires
//
console.log('\n--- Register exhaustion guard ---');
{
    const exhaustSource = `-- LAMBDA CALCULUS
abstraction ExhaustTest {
    method deepSum(a, b, c, d, e, f, g, h) = (a * b + c * d) + (e * f + g * h)
}`;
    const exhaustCompiled = new CLOOMCCompiler().compileLambda(exhaustSource);
    assert('EXHAUST1 deepSum triggers temp-exhaustion compile warning',
        exhaustCompiled.warnings && exhaustCompiled.warnings.length > 0,
        'expected a compile warning; got none');
    assert('EXHAUST2 exhaustion warning mentions register or exhaust',
        exhaustCompiled.warnings && exhaustCompiled.warnings.some(function (w) { return /register|exhaust/i.test(w.message); }),
        'warning messages: ' + (exhaustCompiled.warnings || []).map(function (w) { return w.message; }).join('; '));
}

// Test EXHAUST3–EXHAUST4: (a+b)*(c+d) + (e+f)*(g+h)
//   Temp allocation trace:
//     a+b  → t0=DR12
//     c+d  → t1=DR13  (t0 live)
//     t0*t1 → t2=DR14(result) + t3=DR15(counter)  (t0,t1 live)
//     e+f  → needs t4 ← ALL 4 TEMPS IN USE → exhaustion guard fires
//
{
    const exhaustSource2 = `-- LAMBDA CALCULUS
abstraction ExhaustTest2 {
    method nestedProducts(a, b, c, d, e, f, g, h) = (a + b) * (c + d) + (e + f) * (g + h)
}`;
    const exhaustCompiled2 = new CLOOMCCompiler().compileLambda(exhaustSource2);
    assert('EXHAUST3 nestedProducts triggers temp-exhaustion compile warning',
        exhaustCompiled2.warnings && exhaustCompiled2.warnings.length > 0,
        'expected a compile warning; got none');
    assert('EXHAUST4 exhaustion warning mentions register or exhaust',
        exhaustCompiled2.warnings && exhaustCompiled2.warnings.some(function (w) { return /register|exhaust/i.test(w.message); }),
        'warning messages: ' + (exhaustCompiled2.warnings || []).map(function (w) { return w.message; }).join('; '));
}

// Test EXHAUST5–EXHAUST6: isEqual-style cross-product comparison
//   n1*d2 == n2*d1  needs two multiplications with their results live at the
//   same time for the == comparison → 5 temps → exhaustion.
//
{
    const exhaustSource3 = `-- LAMBDA CALCULUS
abstraction ExhaustTest3 {
    method crossEqual(n1, d1, n2, d2) = if n1 * d2 == n2 * d1 then 1 else 0
}`;
    const exhaustCompiled3 = new CLOOMCCompiler().compileLambda(exhaustSource3);
    assert('EXHAUST5 crossEqual (two muls + comparison) triggers temp-exhaustion warning',
        exhaustCompiled3.warnings && exhaustCompiled3.warnings.length > 0,
        'expected a compile warning; got none');
    assert('EXHAUST6 exhaustion warning mentions register or exhaust',
        exhaustCompiled3.warnings && exhaustCompiled3.warnings.some(function (w) { return /register|exhaust/i.test(w.message); }),
        'warning messages: ' + (exhaustCompiled3.warnings || []).map(function (w) { return w.message; }).join('; '));
}

// Test EXHAUST7: guard emits exactly ONE warning per method (not repeated per call)
{
    const dedupeSource = `-- LAMBDA CALCULUS
abstraction ExhaustDedupeTest {
    method deepExpr(a, b, c, d) = a * b + c * d
}`;
    const dedupeCompiled = new CLOOMCCompiler().compileLambda(dedupeSource);
    const exhaustionWarnings = (dedupeCompiled.warnings || []).filter(function (w) {
        return /register|exhaust/i.test(w.message);
    });
    assert('EXHAUST7 guard fires at most once per method (no warning-flood)',
        exhaustionWarnings.length <= 1,
        'got ' + exhaustionWarnings.length + ' exhaustion warnings; expected at most 1');
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n--- Summary ---');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
    process.exit(1);
}
