'use strict';
// test_history_roundtrip.js — Unit tests for Task #1141
// Verify history survives a full export-then-import roundtrip.
// Run:  node simulator/test_history_roundtrip.js
//
// Coverage:
//   T1 — Full roundtrip: all fields (purpose, example, compiled, history) preserved
//   T2 — Roundtrip with multiple methods: each method restored independently
//   T3 — Schema: bad version number is rejected
//   T4 — Schema: missing "methods" key is rejected
//   T5 — Schema: non-array "compiled" field is rejected
//   T6 — Schema: non-array "history" field is rejected
//   T7 — Schema: missing or invalid "abstractionName" is rejected
//   T8 — Import merges into existing data, not replace
//   T9 — Unknown methods in the file are skipped (not an error)
//  T10 — Entry with no recognised fields is rejected

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

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

global.userMethodData  = {};
global.userMethodLists = {};

// lastImportError is set by our stub of _absHistoryImportError
let lastImportError = null;
global._absHistoryImportError = function(absIdx, msg) {
    lastImportError = msg;
};

// lastExportedBlob captures what _exportAbsHistory hands to Blob()
let lastExportedBlob = null;
global.Blob = class Blob {
    constructor(parts) {
        lastExportedBlob = parts.join('');
    }
};
global.URL = {
    createObjectURL: function() { return 'blob:fake'; },
    revokeObjectURL: function() {}
};

// Minimal document stub — _exportAbsHistory creates an <a> element and clicks it
global.document = {
    getElementById: function() { return null; },
    createElement: function(tag) {
        return {
            style:      { display: '' },
            textContent: '',
            innerHTML:   '',
            href:        '',
            download:    '',
            type:        '',
            accept:      '',
            files:       null,
            click:       function() {},
            addEventListener: function() {},
            parentNode:  null
        };
    },
    body: {
        appendChild: function() {},
        removeChild: function() {}
    },
    addEventListener: function() {}
};

// No-op side-effect functions called after a successful import
global._absMethodsSave       = function() {};
global.showAbstractionDetail = function() {};
global.setTimeout            = function(fn, delay) {};
global.confirm               = function() { return true; };

// ── Helper: build a fake abstractionRegistry ──────────────────────────────────

function makeRegistry(absIdx, name, methods) {
    const abs = { name: name, methods: methods.slice() };
    return {
        getAbstraction: function(idx) { return idx === absIdx ? abs : null; }
    };
}

// ── Helper: extract a named function from source ──────────────────────────────

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

// ── Load the functions under test ─────────────────────────────────────────────

const detailSrc = fs.readFileSync(path.join(__dirname, 'app-absdetail.js'), 'utf8');
vm.runInThisContext(extractFunction(detailSrc, '_exportAbsHistory'));
vm.runInThisContext(extractFunction(detailSrc, '_importAbsHistory'));

// ── Helper: call _exportAbsHistory, return the parsed JSON payload ────────────

function doExport(absIdx) {
    lastExportedBlob = null;
    _exportAbsHistory(absIdx);
    if (!lastExportedBlob) throw new Error('_exportAbsHistory did not produce a Blob');
    return JSON.parse(lastExportedBlob);
}

// ── Helper: call the import validation+merge logic synchronously ──────────────
// _importAbsHistory uses a FileReader + file-input, so we stub FileReader to
// call reader.onload immediately with the supplied JSON string.

function doImport(absIdx, jsonString) {
    lastImportError = null;

    // Stub FileReader to fire onload synchronously
    global.FileReader = class FileReader {
        readAsText() {
            if (typeof this.onload === 'function') {
                this.onload({ target: { result: jsonString } });
            }
        }
    };

    // Stub document.createElement so that the file <input> fires 'change'
    // immediately (simulating a file having been selected).
    const origCreate = global.document.createElement.bind(global.document);
    let changeHandler = null;
    global.document.createElement = function(tag) {
        if (tag === 'input') {
            const el = origCreate(tag);
            el.addEventListener = function(evt, fn) {
                if (evt === 'change') changeHandler = fn;
            };
            // click() triggers the change event with one fake file
            el.click = function() {
                if (changeHandler) {
                    el.files = [{ name: 'test.json' }];
                    changeHandler();
                }
            };
            return el;
        }
        return origCreate(tag);
    };

    // Also stub window.addEventListener (called once for the focus guard)
    global.window = { addEventListener: function() {}, removeEventListener: function() {} };

    _importAbsHistory(absIdx);

    global.document.createElement = origCreate;
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 — Full roundtrip: all field types preserved
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- T1: Full roundtrip — all field types preserved ---');
{
    const absIdx = 7;
    global.abstractionRegistry = makeRegistry(absIdx, 'TestAbs', ['init', 'run']);

    // Seed userMethodData with rich data for both methods
    userMethodData[`${absIdx}:init`] = {
        purpose:    'Initialises the subsystem',
        example:    'LOAD DR0, #1\nCALL Memory\n',
        compiled:   [0x1000, 0x2000, 0xFFFF],
        compiledLang: 'assembly',
        compiledAt: '2026-05-14T10:00:00Z',
        history:    [{ compiled: [0x0800], compiledAt: '2026-05-01T00:00:00Z' }]
    };
    userMethodData[`${absIdx}:run`] = {
        purpose: 'Runs the main loop',
        example: 'CALL Memory\n',
        compiled: [0x3000],
        history:  []
    };

    const payload = doExport(absIdx);

    // Wipe and re-import
    userMethodData[`${absIdx}:init`] = {};
    userMethodData[`${absIdx}:run`]  = {};

    doImport(absIdx, JSON.stringify(payload));

    const init = userMethodData[`${absIdx}:init`];
    const run  = userMethodData[`${absIdx}:run`];

    check('T1a: init purpose restored', init.purpose === 'Initialises the subsystem');
    check('T1b: init example restored', init.example === 'LOAD DR0, #1\nCALL Memory\n');
    check('T1c: init compiled is array of 3', Array.isArray(init.compiled) && init.compiled.length === 3);
    check('T1d: init compiled[0] correct', init.compiled[0] === 0x1000);
    check('T1e: init history is array of 1', Array.isArray(init.history) && init.history.length === 1);
    check('T1f: init compiledLang restored', init.compiledLang === 'assembly');
    check('T1g: init compiledAt restored', init.compiledAt === '2026-05-14T10:00:00Z');
    check('T1h: run purpose restored', run.purpose === 'Runs the main loop');
    check('T1i: run compiled[0] correct', run.compiled[0] === 0x3000);
    check('T1j: no import error', lastImportError === null);
}

// ─────────────────────────────────────────────────────────────────────────────
// T2 — Multiple methods each restored independently
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- T2: Multiple methods — each restored independently ---');
{
    const absIdx = 3;
    const methods = ['alpha', 'beta', 'gamma'];
    global.abstractionRegistry = makeRegistry(absIdx, 'MultiAbs', methods);

    for (const m of methods) {
        userMethodData[`${absIdx}:${m}`] = {
            purpose: 'Purpose of ' + m,
            compiled: [methods.indexOf(m) * 100]
        };
    }

    const payload = doExport(absIdx);

    // Wipe all
    for (const m of methods) userMethodData[`${absIdx}:${m}`] = {};

    doImport(absIdx, JSON.stringify(payload));

    let allOk = true;
    for (const m of methods) {
        const md = userMethodData[`${absIdx}:${m}`];
        if (md.purpose !== 'Purpose of ' + m) allOk = false;
        if (!Array.isArray(md.compiled) || md.compiled[0] !== methods.indexOf(m) * 100) allOk = false;
    }
    check('T2a: all three methods restored correctly', allOk);
    check('T2b: no import error', lastImportError === null);
}

// ─────────────────────────────────────────────────────────────────────────────
// T3 — Schema: bad version number is rejected
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- T3: Bad version rejected ---');
{
    const absIdx = 1;
    global.abstractionRegistry = makeRegistry(absIdx, 'Abs1', ['go']);

    const badPayload = {
        version: 99,
        abstractionName: 'Abs1',
        methods: { go: { purpose: 'should not appear' } }
    };
    userMethodData[`${absIdx}:go`] = {};

    doImport(absIdx, JSON.stringify(badPayload));

    check('T3a: import error set for bad version', lastImportError !== null);
    check('T3b: error mentions version', lastImportError !== null && lastImportError.includes('version'));
    check('T3c: userMethodData not modified', !userMethodData[`${absIdx}:go`].purpose);
}

// ─────────────────────────────────────────────────────────────────────────────
// T4 — Schema: missing "methods" key is rejected
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- T4: Missing "methods" key rejected ---');
{
    const absIdx = 2;
    global.abstractionRegistry = makeRegistry(absIdx, 'Abs2', ['step']);

    const badPayload = {
        version: 1,
        abstractionName: 'Abs2'
        // methods key intentionally absent
    };
    userMethodData[`${absIdx}:step`] = {};

    doImport(absIdx, JSON.stringify(badPayload));

    check('T4a: import error set for missing methods', lastImportError !== null);
    check('T4b: error mentions "methods"', lastImportError !== null && lastImportError.toLowerCase().includes('methods'));
}

// ─────────────────────────────────────────────────────────────────────────────
// T5 — Schema: non-array "compiled" field is rejected
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- T5: Non-array compiled rejected ---');
{
    const absIdx = 4;
    global.abstractionRegistry = makeRegistry(absIdx, 'Abs4', ['tick']);

    const badPayload = {
        version: 1,
        abstractionName: 'Abs4',
        methods: {
            tick: { purpose: 'ok', compiled: 'not-an-array' }
        }
    };
    userMethodData[`${absIdx}:tick`] = {};

    doImport(absIdx, JSON.stringify(badPayload));

    check('T5a: import error set for non-array compiled', lastImportError !== null);
    check('T5b: error mentions "compiled"', lastImportError !== null && lastImportError.includes('compiled'));
}

// ─────────────────────────────────────────────────────────────────────────────
// T6 — Schema: non-array "history" field is rejected
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- T6: Non-array history rejected ---');
{
    const absIdx = 5;
    global.abstractionRegistry = makeRegistry(absIdx, 'Abs5', ['tock']);

    const badPayload = {
        version: 1,
        abstractionName: 'Abs5',
        methods: {
            tock: { purpose: 'ok', history: { not: 'an array' } }
        }
    };
    userMethodData[`${absIdx}:tock`] = {};

    doImport(absIdx, JSON.stringify(badPayload));

    check('T6a: import error set for non-array history', lastImportError !== null);
    check('T6b: error mentions "history"', lastImportError !== null && lastImportError.includes('history'));
}

// ─────────────────────────────────────────────────────────────────────────────
// T7 — Schema: missing/invalid "abstractionName" is rejected
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- T7: Missing abstractionName rejected ---');
{
    const absIdx = 6;
    global.abstractionRegistry = makeRegistry(absIdx, 'Abs6', ['foo']);

    const badPayload = {
        version: 1,
        // abstractionName intentionally absent
        methods: { foo: { purpose: 'x' } }
    };
    userMethodData[`${absIdx}:foo`] = {};

    doImport(absIdx, JSON.stringify(badPayload));

    check('T7a: import error set for missing abstractionName', lastImportError !== null);
    check('T7b: error mentions abstractionName', lastImportError !== null && lastImportError.includes('abstractionName'));
}

// ─────────────────────────────────────────────────────────────────────────────
// T8 — Import merges into existing data rather than replacing it
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- T8: Import merges, not replaces ---');
{
    const absIdx = 9;
    global.abstractionRegistry = makeRegistry(absIdx, 'Abs9', ['bar']);

    // Existing local data has a field not in the exported file
    userMethodData[`${absIdx}:bar`] = {
        purpose: 'local purpose',
        compiled: [0xABCD]
    };

    // Export only has 'example' field
    const importPayload = {
        version: 1,
        abstractionName: 'Abs9',
        methods: {
            bar: { example: 'imported example code' }
        }
    };

    doImport(absIdx, JSON.stringify(importPayload));

    const md = userMethodData[`${absIdx}:bar`];
    check('T8a: imported example field present', md.example === 'imported example code');
    check('T8b: pre-existing purpose preserved', md.purpose === 'local purpose');
    check('T8c: pre-existing compiled preserved', Array.isArray(md.compiled) && md.compiled[0] === 0xABCD);
    check('T8d: no import error', lastImportError === null);
}

// ─────────────────────────────────────────────────────────────────────────────
// T9 — Unknown methods in the file are silently skipped
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- T9: Unknown methods silently skipped ---');
{
    const absIdx = 10;
    global.abstractionRegistry = makeRegistry(absIdx, 'Abs10', ['known']);

    userMethodData[`${absIdx}:known`]   = {};
    userMethodData[`${absIdx}:unknown`] = {};

    const importPayload = {
        version: 1,
        abstractionName: 'Abs10',
        methods: {
            known:   { purpose: 'kept' },
            unknown: { purpose: 'skipped — not in methods list' }
        }
    };

    doImport(absIdx, JSON.stringify(importPayload));

    check('T9a: known method imported', userMethodData[`${absIdx}:known`].purpose === 'kept');
    check('T9b: unknown method not touched by import logic', !userMethodData[`${absIdx}:unknown`].purpose);
    check('T9c: no import error', lastImportError === null);
}

// ─────────────────────────────────────────────────────────────────────────────
// T10 — Entry with no recognised fields is rejected
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- T10: Entry with no recognised fields rejected ---');
{
    const absIdx = 11;
    global.abstractionRegistry = makeRegistry(absIdx, 'Abs11', ['baz']);

    userMethodData[`${absIdx}:baz`] = {};

    const badPayload = {
        version: 1,
        abstractionName: 'Abs11',
        methods: {
            baz: { unknownField: 'ignored', anotherUnknown: 42 }
        }
    };

    doImport(absIdx, JSON.stringify(badPayload));

    check('T10a: import error set for unrecognised fields', lastImportError !== null);
    check('T10b: error mentions recognised fields', lastImportError !== null && lastImportError.includes('recognised'));
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILURES DETECTED') +
            ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
