'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const lumps = fs.readFileSync('simulator/app-lumps.js', 'utf8');
const start = lumps.indexOf('function _revealFaultInstruction(');
const end = lumps.indexOf('// Keep the last exact binary', start);
const words = [(0xF8000000 | (3 << 10)) >>> 0, 0x17030007, 0x071b0001, 0x07230002];
const rows = [];
let status = '', selected = null, scrolled = false, tab = null;
const editor = { value: 'CALL\nLOAD\nLOAD CR4', setSelectionRange: (a, b) => { selected = [a, b]; } };
const ctx = {
    window: { _faultNavigationBinary: { token: 'test', words } },
    document: {
        getElementById: id => id === 'asmEditor' ? editor : {
            set textContent(value) { rows.length = 0; },
            appendChild: row => rows.push(row),
        },
        createElement: () => ({ style: {}, setAttribute() {},
            scrollIntoView() { scrolled = true; } }),
    },
    assembler: { disassemble: word => 'instruction ' + word.toString(16) },
    switchCodeTab: name => { tab = name; },
    _setDisassemblyPresentationStatus: value => { status = value; },
    _jumpToAsmLine: line => { assert.equal(line, 3); },
    ChurchAssembler: class {
        assemble() { return { words: words.slice(1), errors: [] }; }
        getLastLineNums() { return [1, 2, 3]; }
    },
};
vm.createContext(ctx);
vm.runInContext(lumps.slice(start, end), ctx);
assert.equal(ctx._revealFaultInstruction('test', 3, 0x07230002), true);
assert.equal(rows.length, 3);
assert.equal(rows[2].className, 'fault-code-line-highlight');
assert.match(rows[2].textContent, /^\+3  0x07230002/);
assert.equal(scrolled, true);
assert.equal(tab, 'disassembly');
assert.equal(editor.value.slice(...selected), 'LOAD CR4');
selected = null;
assert.equal(ctx._revealFaultInstruction('test', 3, 0xFFFFFFFF), false);
assert.match(status, /does not match/);
assert.equal(selected, null);
assert.equal(ctx._revealFaultInstruction('other', 3, 0x07230002), false);
assert.equal(ctx._revealFaultInstruction('test', null, 0x07230002), false);
ctx.ChurchAssembler = class {
    assemble() { return { words: [99], errors: [] }; }
};
assert.equal(ctx._revealFaultInstruction('test', 3, 0x07230002), true);
assert.equal(selected, null, 'divergent source is not selected');

const run = fs.readFileSync('simulator/app-run.js', 'utf8');
const navStart = run.indexOf('async function _faultModalOpenExecutedSource(');
const navEnd = run.indexOf('function faultModalEditCode(', navStart);
let opened = false, revealed = null;
const nav = {
    _faultModalNsIdxForLump: 7, _faultModalInstrIdx: 2, _faultModalRawWord: 0x07230002,
    faultModalDismiss() {},
    sim: { lumpTokenAtSlot: () => 'test' },
    window: {},
    openLumpInEditor: async token => {
        await Promise.resolve();
        opened = true;
        nav.window._editorOpenLumpToken = token;
    },
    _revealFaultInstruction: (...args) => {
        assert(opened, 'navigation awaits editor load');
        revealed = args;
    },
};
vm.createContext(nav);
vm.runInContext(run.slice(navStart, navEnd), nav);
(async () => {
    await nav.faultModalOpenBinaryLump(7);
    assert.deepEqual(revealed, ['test', 3, 0x07230002]);
    console.log('Fault code navigation: exact offset, highlight, source match, mismatch and async open passed');
})().catch(error => { console.error(error); process.exitCode = 1; });