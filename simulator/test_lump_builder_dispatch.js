'use strict';
// test_lump_builder_dispatch.js — Dispatch table fix regression suite for lump_builder.js
// Run: node simulator/test_lump_builder_dispatch.js
//
// Verifies that buildLump() correctly inserts a dispatch table between the
// header and method bodies for multi-method abstractions, and that private
// methods get dispatch-table entry = 0.
//
// Coverage:
//   DT1  — 2-method public abstraction layout
//   DT2  — private method dispatch entry = 0
//   DT3  — 3-method abstraction
//   DT4  — single-method regression (no dispatch table regression)
//   DT5  — English front-end compile → buildLump
//   DT6  — JS/CLOOMC++ front-end compile → buildLump
//   DT7  — Assembly front-end compile → buildLump
//   DT8  — Haskell front-end compile → buildLump
//   DT9  — Lambda front-end compile → buildLump
//   DT10 — Symbolic front-end compile → buildLump
//   DT11 — cross-method BRANCH patching (intra-LUMP private helper)
//   DT12 — alias methods point to the same body as the original
//   DT13 — Haskell 3-method abstraction: exact dispatch table entries + private = 0
//   DT14 — Symbolic Math 3-method abstraction: exact dispatch table entries + private = 0
//   DT15 — Lambda bare-lambda form (λx.body) desugars to run() method, cw > 0

const path = require('path');

// Node shim for ChurchAssembler (browser global required by CLOOMCCompiler)
global.ChurchAssembler = require(path.join(__dirname, 'assembler.js'));
const CLOOMCCompiler = require(path.join(__dirname, 'cloomc_compiler.js'));
const { buildLump }  = require(path.join(__dirname, 'lump_builder.js'));

let pass = 0;
let fail = 0;

function check(label, cond, detail) {
    if (cond) {
        console.log('PASS ' + label);
        pass++;
    } else {
        console.log('FAIL ' + label + (detail !== undefined ? ' — ' + detail : ''));
        fail++;
    }
}

// Extract cw field from header word
function headerCW(h) { return (h >>> 10) & 0x1FFF; }

// ── DT1: 2-method public abstraction ─────────────────────────────────────────
console.log('\n--- DT1: 2-method public abstraction dispatch layout ---');
{
    const result = {
        methods: [
            { name: 'Open',  code: [0xAA000001, 0xAA000002, 0xAA000003], visibility: 'public' },
            { name: 'Close', code: [0xBB000001, 0xBB000002],             visibility: 'public' },
        ],
        capabilities: [],
    };
    const { words, cw } = buildLump(result);
    // N=2 table entries, 3+2=5 body words → cw = 7
    check('DT1a: cw = N + totalBodyWords (2+5=7)', cw === 7, 'cw=' + cw);
    // Open body starts at lump-PC 2 → entry = 2+1 = 3
    check('DT1b: words[1] = dispatch entry for Open = 3', words[1] === 3, 'words[1]=' + words[1]);
    // Close body starts at lump-PC 2+3=5 → entry = 5+1 = 6
    check('DT1c: words[2] = dispatch entry for Close = 6', words[2] === 6, 'words[2]=' + words[2]);
    // First word of Open body at lump word words[1] = 3
    check('DT1d: words[3] = first word of Open body', words[3] === 0xAA000001, '0x' + words[3].toString(16));
    // First word of Close body at lump word 6
    check('DT1e: words[6] = first word of Close body', words[6] === 0xBB000001, '0x' + words[6].toString(16));
    // Header CW must encode the full cw
    check('DT1f: header CW field = 7', headerCW(words[0]) === 7, 'headerCW=' + headerCW(words[0]));
}

// ── DT2: private method dispatch entry = 0 ───────────────────────────────────
console.log('\n--- DT2: private method dispatch entry = 0 ---');
{
    const result = {
        methods: [
            { name: 'Run',    code: [0xCC000001], visibility: 'public'  },
            { name: 'Helper', code: [0xDD000001], visibility: 'private' },
        ],
        capabilities: [],
    };
    const { words } = buildLump(result);
    // N=2, Run body at lump-PC 2 → entry = 3
    check('DT2a: words[1] = public entry (non-zero)', words[1] !== 0, 'words[1]=' + words[1]);
    check('DT2b: words[2] = private entry = 0', words[2] === 0, 'words[2]=' + words[2]);
    // Body words still present in order
    check('DT2c: Run body word at words[3]', words[3] === 0xCC000001, '0x' + words[3].toString(16));
    check('DT2d: Helper body word at words[4]', words[4] === 0xDD000001, '0x' + words[4].toString(16));
}

// ── DT3: 3-method abstraction ────────────────────────────────────────────────
console.log('\n--- DT3: 3-method abstraction ---');
{
    const result = {
        methods: [
            { name: 'A', code: [0xA1, 0xA2],       visibility: 'public' },
            { name: 'B', code: [0xB1],             visibility: 'public' },
            { name: 'C', code: [0xC1, 0xC2, 0xC3], visibility: 'public' },
        ],
        capabilities: [],
    };
    const { words, cw } = buildLump(result);
    // N=3, bodies 2+1+3=6, cw=9
    check('DT3a: cw = 9', cw === 9, 'cw=' + cw);
    // A body at lump-PC 3 → entry 4
    check('DT3b: words[1] = 4 (entry for A)', words[1] === 4, 'words[1]=' + words[1]);
    // B body at lump-PC 5 → entry 6
    check('DT3c: words[2] = 6 (entry for B)', words[2] === 6, 'words[2]=' + words[2]);
    // C body at lump-PC 6 → entry 7
    check('DT3d: words[3] = 7 (entry for C)', words[3] === 7, 'words[3]=' + words[3]);
    check('DT3e: words[4] = A body[0]', words[4] === 0xA1, '0x' + words[4].toString(16));
    check('DT3f: words[6] = B body[0]', words[6] === 0xB1, '0x' + words[6].toString(16));
    check('DT3g: words[7] = C body[0]', words[7] === 0xC1, '0x' + words[7].toString(16));
}

// ── DT4: single-method regression ────────────────────────────────────────────
console.log('\n--- DT4: single-method regression ---');
{
    const result = {
        methods: [
            { name: 'Run', code: [0x11, 0x22], visibility: 'public' },
        ],
        capabilities: [],
    };
    const { words, cw } = buildLump(result);
    // N=1 table + 2 body words → cw=3
    check('DT4a: cw = 3', cw === 3, 'cw=' + cw);
    // Run body at lump-PC 1 → entry 2
    check('DT4b: words[1] = 2 (entry for Run)', words[1] === 2, 'words[1]=' + words[1]);
    check('DT4c: words[2] = first body word', words[2] === 0x11, '0x' + words[2].toString(16));
}

// ── DT5: English front-end ───────────────────────────────────────────────────
console.log('\n--- DT5: English front-end 2-method compile → buildLump ---');
{
    const c = new CLOOMCCompiler();
    // English block format: `public Name(params):` (no `method` keyword, no `{}`).
    // Standalone `{` / `}` lines are skipped; method body is indented statements.
    const src = `abstraction Counter {
    public Increment():
        return(1)
    public Reset():
        return(0)
}`;
    const result = c.compileEnglish(src, []);
    check('DT5a: English compiles without errors', result.errors.length === 0,
        result.errors.map(e => e.message).join('; '));
    if (result.errors.length === 0 && result.methods.length >= 2) {
        const { words } = buildLump(result);
        check('DT5b: dispatch entry 0 non-zero (public)', words[1] !== 0, 'words[1]=' + words[1]);
        check('DT5c: dispatch entry 1 non-zero (public)', words[2] !== 0, 'words[2]=' + words[2]);
        check('DT5d: entry 0 points to valid body word', words[words[1]] !== undefined,
            'words[' + words[1] + '] exists');
    }
}

// ── DT6: JS/CLOOMC++ front-end ───────────────────────────────────────────────
console.log('\n--- DT6: JS front-end 2-method compile → buildLump ---');
{
    const c = new CLOOMCCompiler();
    const src = `abstraction Widget {
    public method Show() {
        return(1)
    }
    public method Hide() {
        return(0)
    }
}`;
    const result = c.compileJS(src, []);
    check('DT6a: JS compiles without errors', result.errors.length === 0,
        result.errors.map(e => e.message).join('; '));
    if (result.errors.length === 0 && result.methods.length >= 2) {
        const { words } = buildLump(result);
        check('DT6b: dispatch entry 0 non-zero', words[1] !== 0, 'words[1]=' + words[1]);
        check('DT6c: dispatch entry 1 non-zero', words[2] !== 0, 'words[2]=' + words[2]);
    }
}

// ── DT7: Assembly front-end ──────────────────────────────────────────────────
console.log('\n--- DT7: Assembly front-end single-method compile → buildLump ---');
{
    const c = new CLOOMCCompiler();
    const result = c.compileAssembly('RETURN', []);
    check('DT7a: Assembly compiles without errors', result.errors.length === 0,
        result.errors.map(e => e.message).join('; '));
    if (result.errors.length === 0 && result.methods.length > 0) {
        const { words } = buildLump(result);
        check('DT7b: dispatch entry non-zero', words[1] !== 0, 'words[1]=' + words[1]);
    }
}

// ── DT8: Haskell front-end ───────────────────────────────────────────────────
console.log('\n--- DT8: Haskell front-end 2-method compile → buildLump ---');
{
    const c = new CLOOMCCompiler();
    const src = `abstraction MathOps {
    public method Double(x) = x + x
    public method Triple(x) = x + x + x
}`;
    const result = c.compileHaskell(src, []);
    check('DT8a: Haskell compiles without errors', result.errors.length === 0,
        result.errors.map(e => e.message).join('; '));
    if (result.errors.length === 0 && result.methods.length >= 2) {
        const { words } = buildLump(result);
        const nonAliasIdx = result.methods.findIndex(m => !m.aliasOf);
        check('DT8b: first public dispatch entry non-zero',
            words[1 + nonAliasIdx] !== 0, 'words[' + (1 + nonAliasIdx) + ']=' + words[1 + nonAliasIdx]);
    }
}

// ── DT9: Lambda front-end ────────────────────────────────────────────────────
console.log('\n--- DT9: Lambda front-end compile → buildLump ---');
{
    const c = new CLOOMCCompiler();
    const src = `abstraction LambdaTest {
    public method Apply(x) = λy.x + y
}`;
    const result = c.compileLambda(src, []);
    check('DT9a: Lambda compiles without errors', result.errors.length === 0,
        result.errors.map(e => e.message).join('; '));
    if (result.errors.length === 0 && result.methods.length > 0) {
        const { words } = buildLump(result);
        check('DT9b: dispatch entry non-zero', words[1] !== 0, 'words[1]=' + words[1]);
    }
}

// ── DT10: Symbolic (Ada) front-end ───────────────────────────────────────────
console.log('\n--- DT10: Symbolic front-end compile → buildLump ---');
{
    const c = new CLOOMCCompiler();
    // Symbolic front-end uses Ada-style block format; the `= expr` shorthand is
    // Haskell-style and not accepted by compileSymbolic.
    const src = `abstraction SymTest {
    method Compute() {
        V1 = 0
    }
}`;
    const result = c.compileSymbolic(src, []);
    check('DT10a: Symbolic compiles without errors', result.errors.length === 0,
        result.errors.map(e => e.message).join('; '));
    if (result.errors.length === 0 && result.methods.length > 0) {
        const { words } = buildLump(result);
        check('DT10b: dispatch entry non-zero', words[1] !== 0, 'words[1]=' + words[1]);
    }
}

// ── DT11: cross-method BRANCH patching ───────────────────────────────────────
console.log('\n--- DT11: cross-method BRANCH patching for private helper ---');
{
    // Simulate a compiler result where public method A BRANCHes to private method B.
    // A has code [BRANCH_placeholder], crossMethodRefs = [{addr:0, target:'B'}]
    // B has code [RETURN_word]
    const RETURN_WORD = ((3 << 27) | (14 << 23)) >>> 0; // RETURN AL
    const BRANCH_WORD = ((17 << 27) | (14 << 23)) >>> 0; // BRANCH AL offset=0 placeholder

    const result = {
        methods: [
            {
                name: 'A',
                code: [BRANCH_WORD],
                visibility: 'public',
                crossMethodRefs: [{ addr: 0, target: 'B' }],
            },
            {
                name: 'B',
                code: [RETURN_WORD],
                visibility: 'private',
            },
        ],
        capabilities: [],
    };
    const { words, cw } = buildLump(result);
    // N=2, A body at lump-PC 2, B body at lump-PC 3
    // BRANCH at branchLumpPC=2, target=3, relOffset=1
    check('DT11a: cw = 4 (2 table + 1 A body + 1 B body)', cw === 4, 'cw=' + cw);
    check('DT11b: A dispatch entry non-zero (public)', words[1] !== 0, 'words[1]=' + words[1]);
    check('DT11c: B dispatch entry = 0 (private)', words[2] === 0, 'words[2]=' + words[2]);
    // words[3] = A body word 0 (BRANCH) = lump word for lump-PC 2
    const branchWord = words[3];
    const encodedOffset = branchWord & 0x7FFF;
    check('DT11d: BRANCH offset patched to 1 (B is 1 word ahead)', encodedOffset === 1,
        'encodedOffset=' + encodedOffset);
    check('DT11e: BRANCH opcode still intact', ((branchWord >>> 27) & 0x1F) === 17,
        'opcode=' + ((branchWord >>> 27) & 0x1F));
}

// ── DT12: alias methods ───────────────────────────────────────────────────────
console.log('\n--- DT12: alias method shares body with original ---');
{
    const result = {
        methods: [
            { name: 'Run',    code: [0xF1, 0xF2], visibility: 'public' },
            { name: 'Execute', aliasOf: 'Run',    visibility: 'public' },
        ],
        capabilities: [],
    };
    const { words, cw } = buildLump(result);
    // N=2, Run body at lump-PC 2 → entry 3.  Execute aliasOf Run → same entry 3.
    // Body: only Run's 2 words (Execute has no code). cw = 2 + 2 = 4.
    check('DT12a: cw = 4 (2 table + 2 body words, no alias body)', cw === 4, 'cw=' + cw);
    check('DT12b: Run entry non-zero', words[1] !== 0, 'words[1]=' + words[1]);
    check('DT12c: Execute entry = Run entry (same body)', words[2] === words[1],
        'Run=' + words[1] + ' Execute=' + words[2]);
}

// ── DT13: Haskell multi-method dispatch table ─────────────────────────────────
console.log('\n--- DT13: Haskell 3-method dispatch table layout ---');
{
    const c = new CLOOMCCompiler();
    // 3-method abstraction: Add (public, 3 words), Sub (public, 3 words),
    // Helper (private, 4 words).  N=3, total body=10, expected cw=13.
    const src = `abstraction Arithmetic {
    public method Add(x, y) = x + y
    public method Sub(x, y) = x - y
    private method Helper(x) = x + 1
}`;
    const result = c.compileHaskell(src, []);
    check('DT13a: Haskell compiles without errors', result.errors.length === 0,
        result.errors.map(e => e.message).join('; '));
    check('DT13b: exactly 3 methods emitted', result.methods.length === 3,
        'methods=' + result.methods.length);
    if (result.errors.length === 0 && result.methods.length === 3) {
        const { words, cw } = buildLump(result);
        // N=3 dispatch entries + 3+3+4 body words = 13
        check('DT13c: cw = 13 (3 entries + 10 body words)', cw === 13, 'cw=' + cw);
        // Add body at word index 4 → entry = 4
        check('DT13d: words[1] = 4 (Add dispatch entry)', words[1] === 4, 'words[1]=' + words[1]);
        // Sub body at word index 7 → entry = 7
        check('DT13e: words[2] = 7 (Sub dispatch entry)', words[2] === 7, 'words[2]=' + words[2]);
        // Helper is private → entry = 0
        check('DT13f: words[3] = 0 (Helper private entry)', words[3] === 0, 'words[3]=' + words[3]);
        // Verify Add body is reachable via the dispatch entry
        check('DT13g: words[words[1]] non-zero (Add body present)',
            words[words[1]] !== 0 && words[words[1]] !== undefined,
            'words[' + words[1] + ']=0x' + (words[words[1]] || 0).toString(16));
        // Verify Sub body is reachable via the dispatch entry
        check('DT13h: words[words[2]] non-zero (Sub body present)',
            words[words[2]] !== 0 && words[words[2]] !== undefined,
            'words[' + words[2] + ']=0x' + (words[words[2]] || 0).toString(16));
        // Dispatch entries are in ascending order (Add precedes Sub in the lump)
        check('DT13i: Add entry < Sub entry (correct body order)',
            words[1] < words[2], 'Add=' + words[1] + ' Sub=' + words[2]);
    }
}

// ── DT14: Symbolic Math multi-method dispatch table ───────────────────────────
console.log('\n--- DT14: Symbolic Math 3-method dispatch table layout ---');
{
    const c = new CLOOMCCompiler();
    // 3-method abstraction: Add (public, 3 words), Square (public, 3 words),
    // Helper (private, 2 words).  N=3, total body=8, expected cw=11.
    const src = `abstraction Calculator {
    public method Add(x, y) {
        let result = x + y
        return result
    }
    public method Square(x) {
        let r = x + x
        return r
    }
    private method Helper(x) {
        return x
    }
}`;
    const result = c.compileSymbolic(src, []);
    check('DT14a: Symbolic compiles without errors', result.errors.length === 0,
        result.errors.map(e => e.message).join('; '));
    check('DT14b: exactly 3 methods emitted', result.methods.length === 3,
        'methods=' + result.methods.length);
    if (result.errors.length === 0 && result.methods.length === 3) {
        const { words, cw } = buildLump(result);
        // N=3 dispatch entries + 3+3+2 body words = 11
        check('DT14c: cw = 11 (3 entries + 8 body words)', cw === 11, 'cw=' + cw);
        // Add body at word index 4 → entry = 4
        check('DT14d: words[1] = 4 (Add dispatch entry)', words[1] === 4, 'words[1]=' + words[1]);
        // Square body at word index 7 → entry = 7
        check('DT14e: words[2] = 7 (Square dispatch entry)', words[2] === 7, 'words[2]=' + words[2]);
        // Helper is private → entry = 0
        check('DT14f: words[3] = 0 (Helper private entry)', words[3] === 0, 'words[3]=' + words[3]);
        // Verify Add body is reachable via the dispatch entry
        check('DT14g: words[words[1]] non-zero (Add body present)',
            words[words[1]] !== 0 && words[words[1]] !== undefined,
            'words[' + words[1] + ']=0x' + (words[words[1]] || 0).toString(16));
        // Verify Square body is reachable via the dispatch entry
        check('DT14h: words[words[2]] non-zero (Square body present)',
            words[words[2]] !== 0 && words[words[2]] !== undefined,
            'words[' + words[2] + ']=0x' + (words[words[2]] || 0).toString(16));
        // Dispatch entries are in ascending order (Add precedes Square in the lump)
        check('DT14i: Add entry < Square entry (correct body order)',
            words[1] < words[2], 'Add=' + words[1] + ' Square=' + words[2]);
    }
}

// ── DT15: Bare lambda form desugars to method run() ──────────────────────────
console.log('\n--- DT15: Lambda bare-lambda form (λx.body) desugars to run(), cw > 0 ---');
{
    const c = new CLOOMCCompiler();

    // Identity: λx.x  → run(x) = x
    const srcId = `abstraction Identity {
    capabilities {}
    λx.x
}`;
    const rId = c.compileLambda(srcId, []);
    check('DT15a: Identity (λx.x) compiles without errors', rId.errors.length === 0,
        rId.errors.map(e => e.message).join('; '));
    check('DT15b: Identity produces exactly 1 method', rId.methods.length === 1,
        'methods=' + rId.methods.length);
    check('DT15c: Identity method named "run"',
        rId.methods.length > 0 && rId.methods[0].name === 'run',
        rId.methods.length > 0 ? rId.methods[0].name : '(none)');
    check('DT15d: Identity method has param "x"',
        rId.methods.length > 0 && rId.methods[0].params[0] === 'x',
        rId.methods.length > 0 ? JSON.stringify(rId.methods[0].params) : '(none)');
    if (rId.errors.length === 0 && rId.methods.length > 0) {
        const { cw } = buildLump(rId);
        check('DT15e: Identity lump cw > 0 (not silent empty)', cw > 0, 'cw=' + cw);
    }

    // Constant: λx.λy.x  → run(x, y) = x
    const srcK = `abstraction Constant {
    capabilities {}
    λx.λy.x
}`;
    const rK = c.compileLambda(srcK, []);
    check('DT15f: Constant (λx.λy.x) compiles without errors', rK.errors.length === 0,
        rK.errors.map(e => e.message).join('; '));
    check('DT15g: Constant method has params ["x","y"]',
        rK.methods.length > 0 &&
        rK.methods[0].params[0] === 'x' && rK.methods[0].params[1] === 'y',
        rK.methods.length > 0 ? JSON.stringify(rK.methods[0].params) : '(none)');
    if (rK.errors.length === 0 && rK.methods.length > 0) {
        const { cw } = buildLump(rK);
        check('DT15h: Constant lump cw > 0', cw > 0, 'cw=' + cw);
    }

    // Two-terms: λf.λx.f(x)  → run(f, x) = f(x)
    const src2 = `abstraction TwoTerms {
    capabilities {}
    λf.λx.f(x)
}`;
    const r2 = c.compileLambda(src2, []);
    check('DT15i: TwoTerms (λf.λx.f(x)) compiles without errors', r2.errors.length === 0,
        r2.errors.map(e => e.message).join('; '));
    check('DT15j: TwoTerms method has params ["f","x"]',
        r2.methods.length > 0 &&
        r2.methods[0].params[0] === 'f' && r2.methods[0].params[1] === 'x',
        r2.methods.length > 0 ? JSON.stringify(r2.methods[0].params) : '(none)');
    if (r2.errors.length === 0 && r2.methods.length > 0) {
        const { cw } = buildLump(r2);
        check('DT15k: TwoTerms lump cw > 0', cw > 0, 'cw=' + cw);
    }

    // Bare backslash notation: \x.x  (ASCII alternative for λ)
    const srcBS = `abstraction BsTest {
    capabilities {}
    \\x.x
}`;
    const rBS = c.compileLambda(srcBS, []);
    check('DT15l: Backslash form (\\x.x) compiles without errors', rBS.errors.length === 0,
        rBS.errors.map(e => e.message).join('; '));
    if (rBS.errors.length === 0 && rBS.methods.length > 0) {
        const { cw } = buildLump(rBS);
        check('DT15m: Backslash form lump cw > 0', cw > 0, 'cw=' + cw);
    }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════');
console.log('Results: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
