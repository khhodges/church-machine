'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const lumps = fs.readFileSync('simulator/app-lumps.js', 'utf8');
const start = lumps.indexOf('function _revealFaultInstruction(');
const end = lumps.indexOf('// Keep the last exact binary', start);
const words = [(0xF8000000 | (3 << 10)) >>> 0, 0x17030007, 0x071b0001, 0x07230002];
const hash = 'a'.repeat(64);
const evidence = {
    artifact: { identity: { binaryHash: hash, secure: true } },
    codeWords: words.slice(), occurrence: 'epoch:388',
    location: 'WukongCallHome +3', pc: '0x0913', dr: [0, 0, 2]
};
const rows = [];
let status = '', selected = null, scrolled = false, tab = null;
const editor = { value: 'CALL\nLOAD\nLOAD CR4', setSelectionRange: (a, b) => { selected = [a, b]; } };
const ctx = {
    window: { _faultNavigationBinary: { token: 'test', words, binaryHash: hash,
        filename: 'WukongCallHome.1.saved.lump' } },
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
assert.equal(ctx._revealFaultInstruction('test', 3, 0x07230002, evidence), true);
assert.equal(rows.length, 3);
assert.equal(rows[2].className, 'fault-code-line-highlight');
assert.match(rows[2].textContent, /^\+3  0x07230002/);
assert.equal(scrolled, true);
assert.equal(tab, 'disassembly');
assert.equal(editor.value.slice(...selected), 'LOAD CR4');
selected = null;
assert.equal(ctx._revealFaultInstruction('test', 3, 0xFFFFFFFF, evidence), false);
assert.match(status, /does not match/);
assert.equal(selected, null);
assert.equal(ctx._revealFaultInstruction('other', 3, 0x07230002), false);
assert.equal(ctx._revealFaultInstruction('test', null, 0x07230002), false);
ctx.ChurchAssembler = class {
    assemble() { return { words: [99], errors: [] }; }
};
assert.equal(ctx._revealFaultInstruction('test', 3, 0x07230002, evidence), true);
assert.equal(selected, null, 'divergent source is not selected');
assert.equal(ctx._revealFaultInstruction('test', 3, 0x07230002), false);
assert.match(status, /identity unverified/);
const before = JSON.stringify(ctx.window._faultNavigationBinary);
const draftBefore = editor.value;
const other = { ...evidence, artifact: { identity: { secure: true, binaryHash: 'b'.repeat(64) } } };
assert.equal(ctx._revealFaultInstruction('test', 3, 0x07230002, other), false);
assert.match(status, /different saved revision/);
assert.equal(JSON.stringify(ctx.window._faultNavigationBinary), before);
assert.equal(editor.value, draftBefore);
assert.equal(selected, null);
const ChurchAssembler = require('./assembler.js');
ctx.assembler = new ChurchAssembler();
ctx.window._faultNavigationBinary.words = words.slice();
ctx.window._faultNavigationBinary.words[3] = 0x07230020;
assert.equal(ctx._revealFaultInstruction('test', 3, 0x07230002, evidence), false);
assert.match(status, /0x07230002 LOAD\s+CR4, CR6, DR2/);
assert.match(status, /0x07230020 LOAD\s+CR4, CR6\[0x0002\]/);
assert.match(status, /Runtime index DR2 captured value 0x00000002/);
assert.match(status, /PC 0x0913/);
assert.match(status, /Cause unknown/);
assert.equal(editor.value, draftBefore);
ctx.window._faultNavigationBinary.words = words.slice();
const partial = { ...evidence, codeWords: [words[0], 99, words[2], words[3]] };
assert.equal(ctx._revealFaultInstruction('test', 3, words[3], partial), false,
    'one identical word and a registered hash cannot prove complete code');

const run = fs.readFileSync('simulator/app-run.js', 'utf8');
const petStart = run.indexOf('    function _petDisasm(');
const petEnd = run.indexOf('    // Rewrite the raw simulator fault message', petStart);
const pet = vm.createContext({ _petCR: {6: 'WukongCallHome'}, _petDR: {} });
vm.runInContext(run.slice(petStart, petEnd), pet);
const rendered = pet._petDisasm(new ChurchAssembler().disassemble(0x07230002));
assert.match(rendered, /CR6 \(.*WukongCallHome.*\), DR2/);
assert.doesNotMatch(rendered, /UART_TX/);
const navStart = run.indexOf('async function _faultModalOpenExecutedSource(');
const navEnd = run.indexOf('function faultModalEditCode(', navStart);
let opened = false, revealed = null;
const nav = {
    _faultModalNsIdxForLump: 7, _faultModalInstrIdx: 2, _faultModalRawWord: 0x07230002,
    _faultModalEvidence: evidence,
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
    assert.deepEqual(revealed, ['test', 3, 0x07230002, evidence]);
    // A reset/reinstallation changes what is inspected, never the old evidence.
    nav.sim.lumpTokenAtSlot = () => 'replacement';
    await nav.faultModalOpenBinaryLump(7);
    assert.deepEqual(revealed, ['replacement', 3, 0x07230002, evidence]);
    console.log('Fault code navigation: exact offset, highlight, source match, mismatch and async open passed');
})().catch(error => { console.error(error); process.exitCode = 1; });