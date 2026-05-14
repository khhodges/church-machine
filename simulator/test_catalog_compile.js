'use strict';
// test_catalog_compile.js — Unit tests for Task #1136: Compile & Save loop and history panel
// Run:  node simulator/test_catalog_compile.js
//
// Coverage:
//   T1 — _compileSaveToMethod stores compiled words and sets compiledLang/compiledAt
//   T2 — Second call to _compileSaveToMethod pushes previous entry onto history[0]
//   T3 — History is capped at _METHOD_HISTORY_LIMIT (20)
//   T4 — absRestoreMethodVersion loads correct src and sets _pseudoEditContext
//   T5 — Compile error stores compileError (non-null) and leaves compiled null
//   T6 — absUpdateMethod preserves existing compiled/compileError/history fields
//   T7 — _assembleLumpFromCatalog builds a buffer with correct word count for a 2-method abstraction

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

// ── Counters ───────────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;

function check(label, cond) {
    if (cond) {
        console.log('PASS ' + label);
        pass++;
    } else {
        console.log('FAIL ' + label);
        fail++;
    }
}

// ── Global stubs required by the browser scripts ──────────────────────────────
// userMethodData and userMethodLists are shared state used by all catalog funcs.
global.userMethodData  = {};
global.userMethodLists = {};

// Stub window — the catalog functions read/write window._pseudoEditContext and
// window._lastCatalogLumpWords / window._lastCatalogLumpName.
global.window = {
    _pseudoEditContext: null,
    _lastCatalogLumpWords: null,
    _lastCatalogLumpName: null
};

// Minimal document stub — getElementById returns null (the functions guard against
// that), createElement returns a throwaway object, body stubs ignore calls.
global.document = {
    getElementById: function() { return null; },
    createElement: function() {
        return {
            style: {},
            textContent: '',
            parentNode: null,
            innerHTML: '',
            href: '',
            download: '',
            click: function() {}
        };
    },
    body: {
        appendChild: function() {},
        removeChild: function() {}
    },
    addEventListener: function() {}
};

// Stub browser-only APIs used by _assembleLumpFromCatalog
global.Blob = class Blob { constructor(parts, opts) { this.parts = parts; this.opts = opts; } };
global.URL = {
    createObjectURL: function() { return 'blob:fake-url'; },
    revokeObjectURL: function() {}
};

// No-op functions called as side-effects (display/persistence).
global._absMethodsSave    = function() {};
global.showAbstractionDetail = function() {};
global._tryAutoAssembleLump  = function() {};
global.switchView            = function() {};
global.updateLineNumbers     = function() {};
global.updateSavePseudoBtn   = function() {};
global.setTimeout            = function() {};

// cloomcCompiler is set per-test (see makeMockCompiler / makeErrorCompiler below).
global.cloomcCompiler = null;

// abstractionRegistry is set per-test.
global.abstractionRegistry = null;

// ── Helpers to extract a named function from a JS source file ─────────────────
// Finds "function <name>(" in the source and extracts the entire function body
// by counting braces.  Works for non-nested top-level function declarations.
function extractFunction(src, name) {
    const marker = 'function ' + name + '(';
    const start  = src.indexOf(marker);
    if (start === -1) throw new Error('Function not found in source: ' + name);
    let depth  = 0;
    let i      = start;
    let opened = false;
    while (i < src.length) {
        if (src[i] === '{') { depth++; opened = true; }
        if (src[i] === '}') { depth--; }
        i++;
        if (opened && depth === 0) break;
    }
    return src.slice(start, i);
}

// Extract a simple var declaration line ("var NAME = ...;")
function extractVar(src, name) {
    const re = new RegExp('(var\\s+' + name + '\\s*=.*?;)', 's');
    const m  = re.exec(src);
    if (!m) throw new Error('Var not found in source: ' + name);
    return m[1];
}

// ── Load function definitions from source files ───────────────────────────────
const shellSrc  = fs.readFileSync(path.join(__dirname, 'app-shell.js'),     'utf8');
const detailSrc = fs.readFileSync(path.join(__dirname, 'app-absdetail.js'), 'utf8');

// Use vm.runInThisContext so each extracted piece lands in the Node.js global scope.
// (Direct eval() inside a 'use strict' module would only create local bindings.)
vm.runInThisContext(extractVar(shellSrc,      '_METHOD_HISTORY_LIMIT'));
vm.runInThisContext(extractFunction(shellSrc, '_compileSaveToMethod'));
vm.runInThisContext(extractFunction(detailSrc,'absRestoreMethodVersion'));
vm.runInThisContext(extractFunction(detailSrc,'absUpdateMethod'));
vm.runInThisContext(extractFunction(detailSrc,'_assembleLumpFromCatalog'));

// ── Mock factories ─────────────────────────────────────────────────────────────
// A mock compiler that succeeds and returns words for the named method.
function makeMockCompiler(methodName, words) {
    return {
        compile: function(src, opts) {
            return {
                language: 'assembly',
                errors: [],
                methods: [{ name: methodName, code: words.slice() }]
            };
        }
    };
}

// A mock compiler that always returns errors.
function makeErrorCompiler(errorMsg) {
    return {
        compile: function(src, opts) {
            return {
                language: 'assembly',
                errors: [{ line: 1, message: errorMsg }],
                methods: []
            };
        }
    };
}

// A mock abstractionRegistry that returns an abstraction with a fixed methods list.
function makeRegistry(absIdx, name, methods) {
    const abs = { name: name, methods: methods.slice() };
    return {
        getAbstraction: function(idx) { return idx === absIdx ? abs : null; }
    };
}

// Reset shared state between tests.
function resetState() {
    global.userMethodData  = {};
    global.userMethodLists = {};
    global.window._pseudoEditContext   = null;
    global.window._lastCatalogLumpWords = null;
    global.window._lastCatalogLumpName  = null;
    global.cloomcCompiler      = null;
    global.abstractionRegistry = null;
}

// ── T1: _compileSaveToMethod stores compiled words and sets compiledLang/compiledAt
console.log('\n--- T1: compile & save stores words + metadata ---');
{
    resetState();
    const absIdx     = 42;
    const methodName = 'run';
    const words      = [0xDEAD, 0xBEEF, 0x1234];
    global.cloomcCompiler = makeMockCompiler(methodName, words);

    const before = Date.now();
    _compileSaveToMethod('LOAD R0, #1\nRET', absIdx, methodName);
    const after = Date.now();

    const key = absIdx + ':' + methodName;
    const md  = global.userMethodData[key];

    check('T1a: entry exists in userMethodData',    md !== undefined && md !== null);
    check('T1b: compiled is an array',              Array.isArray(md.compiled));
    check('T1c: compiled matches expected words',   JSON.stringify(md.compiled) === JSON.stringify(words));
    check('T1d: compiledLang is "assembly"',        md.compiledLang === 'assembly');
    check('T1e: compiledAt is a recent timestamp',  md.compiledAt >= before && md.compiledAt <= after);
    check('T1f: compileError is null',              md.compileError === null);
    check('T1g: example src is stored',             md.example === 'LOAD R0, #1\nRET');
}

// ── T2: Second call pushes previous entry onto history[0]
console.log('\n--- T2: second compile pushes previous onto history ---');
{
    resetState();
    const absIdx     = 7;
    const methodName = 'init';
    const words1     = [0x0001];
    const words2     = [0x0002, 0x0003];
    global.cloomcCompiler = makeMockCompiler(methodName, words1);

    _compileSaveToMethod('SRC v1', absIdx, methodName);
    const firstAt = global.userMethodData[absIdx + ':' + methodName].compiledAt;

    global.cloomcCompiler = makeMockCompiler(methodName, words2);
    _compileSaveToMethod('SRC v2', absIdx, methodName);

    const md = global.userMethodData[absIdx + ':' + methodName];

    check('T2a: current compiled is v2 words', JSON.stringify(md.compiled) === JSON.stringify(words2));
    check('T2b: history array exists',         Array.isArray(md.history));
    check('T2c: history has exactly one entry',md.history.length === 1);
    check('T2d: history[0].compiled is v1 words', JSON.stringify(md.history[0].compiled) === JSON.stringify(words1));
    check('T2e: history[0].src is "SRC v1"',   md.history[0].src === 'SRC v1');
    check('T2f: history[0].savedAt equals firstAt', md.history[0].savedAt === firstAt);
}

// ── T3: History is capped at _METHOD_HISTORY_LIMIT (20)
console.log('\n--- T3: history capped at _METHOD_HISTORY_LIMIT ---');
{
    resetState();
    const absIdx     = 3;
    const methodName = 'tick';
    const LIMIT      = _METHOD_HISTORY_LIMIT;

    check('T3a: _METHOD_HISTORY_LIMIT is 20', LIMIT === 20);

    // Compile LIMIT+3 times; history must never exceed LIMIT.
    for (let i = 0; i < LIMIT + 3; i++) {
        global.cloomcCompiler = makeMockCompiler(methodName, [i]);
        _compileSaveToMethod('SRC ' + i, absIdx, methodName);
    }

    const md = global.userMethodData[absIdx + ':' + methodName];
    check('T3b: history.length === _METHOD_HISTORY_LIMIT', md.history.length === LIMIT);
    check('T3c: most recent history entry is second-to-last compile',
          md.history[0].compiled[0] === LIMIT + 1);
}

// ── T4: absRestoreMethodVersion loads correct src and sets _pseudoEditContext
console.log('\n--- T4: absRestoreMethodVersion restores src and context ---');
{
    resetState();
    const absIdx     = 5;
    const methodName = 'decode';

    // Seed history manually (as _compileSaveToMethod would build it).
    global.userMethodData[absIdx + ':' + methodName] = {
        example:      'CURRENT SRC',
        compiled:     [0xFF],
        compiledAt:   Date.now(),
        compiledLang: 'assembly',
        compileError: null,
        history: [
            { src: 'OLD SRC v2', compiled: [0xAA], compileError: null, savedAt: 100, lang: 'assembly' },
            { src: 'OLD SRC v1', compiled: [0xBB], compileError: null, savedAt:  50, lang: 'assembly' }
        ]
    };

    // Stub the asmEditor element so we can verify it receives the restored src.
    const asmEditorStub = { value: '' };
    const origGetElementById = global.document.getElementById;
    global.document.getElementById = function(id) {
        if (id === 'asmEditor') return asmEditorStub;
        return null;
    };

    absRestoreMethodVersion(absIdx, methodName, 0);

    global.document.getElementById = origGetElementById;

    check('T4a: _pseudoEditContext.absIdx equals absIdx',
          global.window._pseudoEditContext &&
          global.window._pseudoEditContext.absIdx === absIdx);
    check('T4b: _pseudoEditContext.methodName equals methodName',
          global.window._pseudoEditContext &&
          global.window._pseudoEditContext.methodName === methodName);
    check('T4c: asmEditor.value is set to the restored history src',
          asmEditorStub.value === 'OLD SRC v2');
    check('T4d: userMethodData current entry is not mutated',
          global.userMethodData[absIdx + ':' + methodName].example === 'CURRENT SRC');
}

// T4e: restoring histIdx=1 loads the correct older entry
{
    const asmEditorStub2 = { value: '' };
    const origGetElementById = global.document.getElementById;
    global.document.getElementById = function(id) {
        if (id === 'asmEditor') return asmEditorStub2;
        return null;
    };
    global.window._pseudoEditContext = null;
    absRestoreMethodVersion(5, 'decode', 1);
    global.document.getElementById = origGetElementById;
    check('T4e: restoring histIdx=1 sets _pseudoEditContext',
          global.window._pseudoEditContext !== null &&
          global.window._pseudoEditContext.absIdx === 5);
    check('T4f: restoring histIdx=1 loads the correct older src',
          asmEditorStub2.value === 'OLD SRC v1');
}

// T4g: absRestoreMethodVersion with bad histIdx does nothing
{
    global.window._pseudoEditContext = null;
    absRestoreMethodVersion(5, 'decode', 99);
    check('T4g: bad histIdx does not set _pseudoEditContext',
          global.window._pseudoEditContext === null);
}

// ── T5: Compile error stores compileError (non-null) and leaves compiled null
console.log('\n--- T5: compile error stores compileError, compiled stays null ---');
{
    resetState();
    const absIdx     = 11;
    const methodName = 'parse';
    global.cloomcCompiler = makeErrorCompiler('unexpected token');

    _compileSaveToMethod('BAD SOURCE !!@@', absIdx, methodName);

    const md = global.userMethodData[absIdx + ':' + methodName];

    check('T5a: entry exists after error compile', md !== undefined);
    check('T5b: compiled is null',                md.compiled === null);
    check('T5c: compileError is non-null',        md.compileError !== null && md.compileError !== undefined);
    check('T5d: compileError contains line info', md.compileError.includes('Line 1'));
    check('T5e: compileError contains the message', md.compileError.includes('unexpected token'));
    check('T5f: compiledLang is still set',       md.compiledLang === 'assembly');
    check('T5g: example src is stored',           md.example === 'BAD SOURCE !!@@');
}

// T5h: a second error compile pushes the first error into history
{
    global.cloomcCompiler = makeErrorCompiler('another error');
    _compileSaveToMethod('BAD AGAIN', 11, 'parse');

    const md = global.userMethodData['11:parse'];
    check('T5h: second error compile creates history entry',
          Array.isArray(md.history) && md.history.length === 1);
    check('T5i: history[0].compileError is non-null from first compile',
          md.history[0].compileError !== null);
}

// ── T6: absUpdateMethod preserves compiled/compileError/history fields
console.log('\n--- T6: absUpdateMethod preserves compile state ---');
{
    resetState();
    const absIdx     = 99;
    const methodName = 'greet';
    const key        = absIdx + ':' + methodName;

    // Pre-seed existing compile state.
    global.userMethodData[key] = {
        compiled:     [0xABCD],
        compileError: null,
        compiledAt:   12345,
        compiledLang: 'assembly',
        example:      'OLD EXAMPLE',
        purpose:      'old purpose',
        history:      [{ src: 'earlier', compiled: [0x0], compileError: null, savedAt: 0, lang: 'assembly' }]
    };

    // absUpdateMethod reads from DOM elements; since getElementById returns null,
    // the function returns early (fc = null → mName = null → returns).
    // We test that by providing a minimal document.getElementById that returns a
    // form element and textareas — overridden just for this test.
    const origGetElementById = global.document.getElementById;
    global.document.getElementById = function(id) {
        if (id === 'abs-form-' + absIdx) {
            return { dataset: { editTarget: methodName } };
        }
        if (id === 'abs-edit-desc-' + absIdx) {
            return { value: 'new purpose text' };
        }
        if (id === 'abs-edit-code-' + absIdx) {
            return { value: 'NEW EXAMPLE CODE' };
        }
        return null;
    };
    // showAbstractionDetail is a no-op globally, which is fine here.
    absUpdateMethod(absIdx);
    global.document.getElementById = origGetElementById;

    const md = global.userMethodData[key];

    check('T6a: purpose updated to new value',    md.purpose === 'new purpose text');
    check('T6b: example updated to new value',    md.example === 'NEW EXAMPLE CODE');
    check('T6c: compiled field is preserved',     JSON.stringify(md.compiled) === JSON.stringify([0xABCD]));
    check('T6d: compileError preserved (null)',   md.compileError === null);
    check('T6e: compiledAt preserved',            md.compiledAt === 12345);
    check('T6f: compiledLang preserved',          md.compiledLang === 'assembly');
    check('T6g: history array preserved',         Array.isArray(md.history) && md.history.length === 1);
}

// ── T7: _assembleLumpFromCatalog builds correct word count for a 2-method abstraction
console.log('\n--- T7: _assembleLumpFromCatalog word count for 2-method abstraction ---');
{
    resetState();
    const absIdx  = 20;
    const method1 = 'open';
    const method2 = 'close';
    const words1  = [0x0001, 0x0002, 0x0003];       // 3 words
    const words2  = [0x000A, 0x000B];                // 2 words

    global.userMethodData[absIdx + ':' + method1] = {
        compiled: words1.slice(), example: '', compiledLang: 'assembly',
        compileError: null, compiledAt: Date.now()
    };
    global.userMethodData[absIdx + ':' + method2] = {
        compiled: words2.slice(), example: '', compiledLang: 'assembly',
        compileError: null, compiledAt: Date.now()
    };
    global.abstractionRegistry = makeRegistry(absIdx, 'FileHandle', [method1, method2]);

    _assembleLumpFromCatalog(absIdx);

    // Expected layout: header(1) + method_table(2) + body1(3) + body2(2) = 8 words total.
    // _lastCatalogLumpWords stores buf.slice(1, totalWords) → 7 words (no header).
    const N        = 2;
    const bodyLen  = words1.length + words2.length;          // 5
    const expected = 1 + N + bodyLen;                        // 8 total words
    const stored   = global.window._lastCatalogLumpWords;

    check('T7a: _lastCatalogLumpWords is an array', Array.isArray(stored));
    check('T7b: word count (excl header) = N + bodyLen',
          stored !== null && stored.length === N + bodyLen);  // 7

    // Verify method table entries — each points to the start of the body
    // (1-indexed word address within the lump).
    // method 0 body starts at lump-word 1 + N = 3 → methodTable[0] = 3 + 1 = 4? 
    // Actually: bodyOffset starts at N, body0 at offset N → lump word N+1 (1-indexed).
    //   methodTable[0] = bodyOffset + 1 = N + 1 = 3
    //   methodTable[1] = N + 1 + words1.length = 3 + 3 = 6
    check('T7c: method table entry 0 points past header+table',
          stored[0] === N + 1);           // lump word 3 (1-indexed)
    check('T7d: method table entry 1 follows body of method 0',
          stored[1] === N + 1 + words1.length);  // lump word 6

    // Verify body words are present in order after the table.
    check('T7e: first word of method 0 body at table offset',
          stored[N] === words1[0]);        // stored[2] = 0x0001
    check('T7f: last word of method 0 body',
          stored[N + words1.length - 1] === words1[words1.length - 1]);
    check('T7g: first word of method 1 body follows method 0',
          stored[N + words1.length] === words2[0]);
    check('T7h: _lastCatalogLumpName is "FileHandle"',
          global.window._lastCatalogLumpName === 'FileHandle');

    // Verify header word encodes magic 0x1F
    // The buf array includes the header; stored skips it. Re-derive buf[0] fields.
    // total = 8 words → lumpSize = 64 → n_minus_6 = 0
    // buf[0] = (0x1F << 27) | (0 << 23) | (7 << 10) | 0
    const cw        = expected - 1;   // 7
    const expectedH = (((0x1F << 27) | ((0 & 0xF) << 23) | ((cw & 0x1FFF) << 10)) >>> 0);
    // We can derive buf[0] from stored by re-reading file output, but since the function
    // writes buf.slice(1, ...) to window._lastCatalogLumpWords, the header is not in stored.
    // Verify via total count instead.
    check('T7i: stored length is totalWords-1 (header excluded)',
          stored.length === expected - 1);
}

// T7j: _assembleLumpFromCatalog returns early when abstractionRegistry has no methods
{
    resetState();
    global.abstractionRegistry = makeRegistry(99, 'Empty', []);
    global.window._lastCatalogLumpWords = null;
    _assembleLumpFromCatalog(99);
    check('T7j: no lump built for abstraction with no methods',
          global.window._lastCatalogLumpWords === null);
}

// T7k: method with no compiled words uses placeholder [0]
{
    resetState();
    const absIdx = 33;
    global.userMethodData[absIdx + ':stub'] = { compiled: null };  // not compiled
    global.abstractionRegistry = makeRegistry(absIdx, 'Stub', ['stub']);

    _assembleLumpFromCatalog(absIdx);

    const stored = global.window._lastCatalogLumpWords;
    // N=1 method, placeholder body=[0] → total=1+1+1=3, stored length=2
    check('T7k: placeholder [0] used for uncompiled method',
          stored !== null && stored.length === 2);
}

// ── Summary ────────────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════');
console.log('Results: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) {
    console.log('SOME TESTS FAILED');
    process.exit(1);
} else {
    console.log('ALL TESTS PASSED');
}
