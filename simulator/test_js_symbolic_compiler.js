'use strict';
// test_js_symbolic_compiler.js — JS return and Symbolic let-form regression suite
// Run: node simulator/test_js_symbolic_compiler.js
//
// Coverage:
//   JS1  — JS method body: return literal (return 0)
//   JS2  — JS method body: return parameter (return x)
//   JS3  — JS method body: return arithmetic (return x + y)
//   JS4  — JS method body: parenthesised return still works (return(x))
//   JS5  — JS bare return (no expression) still works
//   SY1  — Symbolic let-form: single let binding (one-liner abstraction)
//   SY2  — Symbolic let-form: multi-line abstraction with several let bindings
//   SY3  — Symbolic let-form: private let (name starts with _)
//   SY4  — Symbolic let-form: mixed method{} and let bindings in same abstraction
//   SY5  — Symbolic single-line abstraction body (content on same line as {)
//   SY6  — Symbolic multi-let: dispatch table entries are in ascending order

const path = require('path');

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

function errMsg(result) {
    return result.errors.map(e => e.message).join('; ');
}

// ── JS1: return literal ───────────────────────────────────────────────────────
console.log('\n--- JS1: JS method body with bare return literal ---');
{
    const c = new CLOOMCCompiler();
    const src = `abstraction Counter {
    public method Reset() {
        return 0
    }
}`;
    const result = c.compileJS(src, []);
    check('JS1a: compiles without errors', result.errors.length === 0, errMsg(result));
    check('JS1b: exactly 1 method', result.methods.length === 1, 'methods=' + result.methods.length);
    if (result.errors.length === 0 && result.methods.length === 1) {
        check('JS1c: method code is non-empty', result.methods[0].code.length > 0,
            'code.length=' + result.methods[0].code.length);
        const { words, cw } = buildLump(result);
        check('JS1d: cw > 0', cw > 0, 'cw=' + cw);
        check('JS1e: dispatch entry non-zero', words[1] !== 0, 'words[1]=' + words[1]);
    }
}

// ── JS2: return parameter ─────────────────────────────────────────────────────
console.log('\n--- JS2: JS method body with bare return parameter ---');
{
    const c = new CLOOMCCompiler();
    const src = `abstraction Identity {
    public method Get(x) {
        return x
    }
}`;
    const result = c.compileJS(src, []);
    check('JS2a: compiles without errors', result.errors.length === 0, errMsg(result));
    if (result.errors.length === 0 && result.methods.length === 1) {
        check('JS2b: method code is non-empty', result.methods[0].code.length > 0,
            'code.length=' + result.methods[0].code.length);
        const { cw } = buildLump(result);
        check('JS2c: cw > 0', cw > 0, 'cw=' + cw);
    }
}

// ── JS3: return arithmetic ────────────────────────────────────────────────────
console.log('\n--- JS3: JS method body with bare return arithmetic ---');
{
    const c = new CLOOMCCompiler();
    const src = `abstraction Math {
    public method Add(x, y) {
        return x + y
    }
}`;
    const result = c.compileJS(src, []);
    check('JS3a: compiles without errors', result.errors.length === 0, errMsg(result));
    if (result.errors.length === 0 && result.methods.length === 1) {
        check('JS3b: method code is non-empty', result.methods[0].code.length > 0,
            'code.length=' + result.methods[0].code.length);
        const { cw } = buildLump(result);
        check('JS3c: cw > 0', cw > 0, 'cw=' + cw);
    }
}

// ── JS4: parenthesised return still works ────────────────────────────────────
console.log('\n--- JS4: JS parenthesised return(expr) still works ---');
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
    check('JS4a: compiles without errors', result.errors.length === 0, errMsg(result));
    if (result.errors.length === 0 && result.methods.length >= 2) {
        check('JS4b: both methods have non-empty code',
            result.methods[0].code.length > 0 && result.methods[1].code.length > 0,
            'codes=' + result.methods.map(m => m.code.length).join(','));
        const { words } = buildLump(result);
        check('JS4c: both dispatch entries non-zero', words[1] !== 0 && words[2] !== 0,
            'words[1]=' + words[1] + ' words[2]=' + words[2]);
    }
}

// ── JS5: bare return (no expression) ─────────────────────────────────────────
console.log('\n--- JS5: JS bare return (no expression) still emits RETURN ---');
{
    const c = new CLOOMCCompiler();
    const src = `abstraction Noop {
    public method Run() {
        return
    }
}`;
    const result = c.compileJS(src, []);
    check('JS5a: compiles without errors', result.errors.length === 0, errMsg(result));
    if (result.errors.length === 0 && result.methods.length === 1) {
        check('JS5b: method has at least 1 instruction (RETURN)', result.methods[0].code.length >= 1,
            'code.length=' + result.methods[0].code.length);
    }
}

// ── SY1: single let binding (multi-line abstraction) ─────────────────────────
console.log('\n--- SY1: Symbolic single let binding ---');
{
    const c = new CLOOMCCompiler();
    const src = `abstraction Math {
    let add x y = x + y
}`;
    const result = c.compileSymbolic(src, []);
    check('SY1a: compiles without errors', result.errors.length === 0, errMsg(result));
    check('SY1b: exactly 1 method', result.methods.length === 1, 'methods=' + result.methods.length);
    if (result.errors.length === 0 && result.methods.length === 1) {
        check('SY1c: method name is "add"', result.methods[0].name === 'add',
            'name=' + result.methods[0].name);
        check('SY1d: params are [x, y]',
            JSON.stringify(result.methods[0].params) === JSON.stringify(['x', 'y']),
            'params=' + JSON.stringify(result.methods[0].params));
        check('SY1e: method code is non-empty', result.methods[0].code.length > 0,
            'code.length=' + result.methods[0].code.length);
        const { words, cw } = buildLump(result);
        check('SY1f: cw > 0', cw > 0, 'cw=' + cw);
        check('SY1g: dispatch entry non-zero', words[1] !== 0, 'words[1]=' + words[1]);
    }
}

// ── SY2: multi-let dispatch table ────────────────────────────────────────────
console.log('\n--- SY2: Symbolic multi-let produces N-entry dispatch table ---');
{
    const c = new CLOOMCCompiler();
    const src = `abstraction Arith {
    let add x y = x + y
    let sub x y = x - y
    let double x = x + x
}`;
    const result = c.compileSymbolic(src, []);
    check('SY2a: compiles without errors', result.errors.length === 0, errMsg(result));
    check('SY2b: exactly 3 methods', result.methods.length === 3, 'methods=' + result.methods.length);
    if (result.errors.length === 0 && result.methods.length === 3) {
        check('SY2c: method names correct',
            result.methods[0].name === 'add' && result.methods[1].name === 'sub' && result.methods[2].name === 'double',
            'names=' + result.methods.map(m => m.name).join(','));
        check('SY2d: all methods have non-empty code',
            result.methods.every(m => m.code.length > 0),
            'codes=' + result.methods.map(m => m.code.length).join(','));
        const { words, cw } = buildLump(result);
        check('SY2e: cw > 3 (table entries + body words)', cw > 3, 'cw=' + cw);
        check('SY2f: 3 dispatch table entries all non-zero',
            words[1] !== 0 && words[2] !== 0 && words[3] !== 0,
            'entries=' + words[1] + ',' + words[2] + ',' + words[3]);
        check('SY2g: dispatch entries in ascending order',
            words[1] < words[2] && words[2] < words[3],
            'entries=' + words[1] + ',' + words[2] + ',' + words[3]);
    }
}

// ── SY3: private let (name starts with _) ────────────────────────────────────
console.log('\n--- SY3: Symbolic private let (underscore prefix) ---');
{
    const c = new CLOOMCCompiler();
    const src = `abstraction Ops {
    let pub x = x + 1
    let _priv x = x - 1
}`;
    const result = c.compileSymbolic(src, []);
    check('SY3a: compiles without errors', result.errors.length === 0, errMsg(result));
    check('SY3b: exactly 2 methods', result.methods.length === 2, 'methods=' + result.methods.length);
    if (result.errors.length === 0 && result.methods.length === 2) {
        check('SY3c: pub visibility is public', result.methods[0].visibility === 'public',
            'vis=' + result.methods[0].visibility);
        check('SY3d: _priv visibility is private', result.methods[1].visibility === 'private',
            'vis=' + result.methods[1].visibility);
        const { words } = buildLump(result);
        check('SY3e: pub dispatch entry non-zero', words[1] !== 0, 'words[1]=' + words[1]);
        check('SY3f: _priv dispatch entry = 0', words[2] === 0, 'words[2]=' + words[2]);
    }
}

// ── SY4: mixed method{} and let bindings ────────────────────────────────────
console.log('\n--- SY4: Symbolic mixed method{} and let bindings ---');
{
    const c = new CLOOMCCompiler();
    const src = `abstraction Mixed {
    method Compute(x) {
        let r = x + x
        return r
    }
    let helper x = x + 1
}`;
    const result = c.compileSymbolic(src, []);
    check('SY4a: compiles without errors', result.errors.length === 0, errMsg(result));
    check('SY4b: exactly 2 methods', result.methods.length === 2, 'methods=' + result.methods.length);
    if (result.errors.length === 0 && result.methods.length === 2) {
        check('SY4c: first method is Compute', result.methods[0].name === 'Compute',
            'name=' + result.methods[0].name);
        check('SY4d: second method is helper', result.methods[1].name === 'helper',
            'name=' + result.methods[1].name);
        check('SY4e: both methods have non-empty code',
            result.methods.every(m => m.code.length > 0),
            'codes=' + result.methods.map(m => m.code.length).join(','));
        const { words, cw } = buildLump(result);
        check('SY4f: cw > 0', cw > 0, 'cw=' + cw);
        check('SY4g: both dispatch entries non-zero', words[1] !== 0 && words[2] !== 0,
            'entries=' + words[1] + ',' + words[2]);
    }
}

// ── SY5: single-line abstraction body (inline after {) ───────────────────────
console.log('\n--- SY5: Symbolic single-line abstraction body ---');
{
    const c = new CLOOMCCompiler();
    const src = `abstraction Math { let add x y = x + y }`;
    const result = c.compileSymbolic(src, []);
    check('SY5a: compiles without errors', result.errors.length === 0, errMsg(result));
    check('SY5b: exactly 1 method', result.methods.length === 1, 'methods=' + result.methods.length);
    if (result.errors.length === 0 && result.methods.length === 1) {
        check('SY5c: method name is "add"', result.methods[0].name === 'add',
            'name=' + result.methods[0].name);
        check('SY5d: method code is non-empty', result.methods[0].code.length > 0,
            'code.length=' + result.methods[0].code.length);
    }
}

// ── SY6: multi-let ascending dispatch table entries ──────────────────────────
console.log('\n--- SY6: Symbolic multi-let dispatch entries are ascending ---');
{
    const c = new CLOOMCCompiler();
    const src = `abstraction Ops {
    let f1 x = x + 1
    let f2 x = x + 2
    let f3 x = x + 3
    let f4 x = x + 4
}`;
    const result = c.compileSymbolic(src, []);
    check('SY6a: compiles without errors', result.errors.length === 0, errMsg(result));
    check('SY6b: exactly 4 methods', result.methods.length === 4, 'methods=' + result.methods.length);
    if (result.errors.length === 0 && result.methods.length === 4) {
        const { words, cw } = buildLump(result);
        check('SY6c: 4 dispatch table entries all non-zero',
            words[1] !== 0 && words[2] !== 0 && words[3] !== 0 && words[4] !== 0,
            'entries=' + [words[1], words[2], words[3], words[4]].join(','));
        const entries = [words[1], words[2], words[3], words[4]];
        let ascending = true;
        for (let i = 1; i < entries.length; i++) {
            if (entries[i] <= entries[i - 1]) { ascending = false; break; }
        }
        check('SY6d: all dispatch entries strictly ascending', ascending,
            'entries=' + entries.join(','));
        check('SY6e: cw > 4 (4 entries + at least 1 body word each)',
            cw > 4, 'cw=' + cw);
    }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════');
console.log('Results: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
