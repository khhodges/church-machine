'use strict';
// Compiler and binary contract checks. Deliberately no queue simulator.
const assert = require('node:assert/strict');
const {prepare, wordsToBytes} = require('./build_free_handler_example');
const Codec = require('../simulator/lump-api-codec');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const r = prepare();
assert.deepEqual(r.compiled.errors, []);
assert.deepEqual(r.compiled.warnings, []);
assert.equal(r.api.name, 'ide.FreeHandler');
assert.equal(r.api.passkey, 1);
assert.deepEqual(Object.keys(r.api.methods).sort(),
    ['Free64', 'Free128', 'Free256', 'FreeCList', 'FreeThread', 'Release'].sort());
for (const [index, name] of ['Free64', 'Free128', 'Free256'].entries())
    assert.deepEqual(r.api.methods[name], [index, [], [2, 'RW']]);
assert.deepEqual(r.api.methods.FreeCList, [3, [], [2, 'LS']]);
assert.deepEqual(r.api.methods.FreeThread, [4, [['application', 2, 'E']], [2, '']]);
assert.deepEqual(r.api.methods.Release, [5, [['target', 2, '']], 0]);
assert.equal(r.packed.cc, 11);
assert(r.words.slice(-11).every(word => word === 0), 'unbound means NULL, not fabricated grants');
assert.equal(r.api.symbolic_binding.calls.length, 0);
assert.deepEqual(r.api.symbolic_binding.dependencies.map(d => d.relocation_row),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
assert.deepEqual(r.api.symbolic_binding.dependencies.map(d => d.rights.join('')),
    ['E', 'RW', 'RW', 'RW', 'RW', 'RW', 'RW', 'RW', 'LS', '', 'S']);
assert.equal(r.api.symbolic_binding.dependencies[9].name, r.api.symbolic_binding.dependencies[10].name);
assert.deepEqual(r.state.slice(0, 12), [0, 0, 3, 0, 0, 2, 0, 0, 1, 0, 0, 0]);
assert.deepEqual(r.state.slice(12, 20), [0, 1, 2, 0, 3, 4, 5, 0]);
assert(r.state.slice(20).every(word => word === 0));
assert.equal(wordsToBytes(r.state, true).readUInt32LE(8), 3);
assert.equal(r.setup.objects.reduce((n, o) => n + o.words, 0), 1344);
assert.equal(r.setup.poolWords, 1536);
assert(r.setup.objects.every(o => o.baseWord % o.words === 0 && o.limit === o.words - 1));
assert.deepEqual(r.setup.objects.map(o => o.slot), [32, 33, 34, 35, 36, 37, 38, 39]);

// Inspect the actual compiled instructions, not a second implementation.
// The first six code words are dispatch offsets, not instructions.
const executable = r.words.slice(1 + r.compiled.methods.length, 1 + r.packed.cw);
assert(executable.length > 0);
for (const word of executable) {
    const op = word >>> 27, dst = (word >>> 19) & 15, src = (word >>> 15) & 15;
    assert(![2, 4, 5, 7, 8, 9].includes(op),
        `foreground code must not CALL, CHANGE, SWITCH or LAMBDA (opcode ${op})`);
    if (op === 1) {
        assert.equal(dst, 2, 'SAVE source is application input');
        assert.equal(src, 8, 'SAVE uses private Thread S capability');
        assert.equal(word & 0x7FFF, 1 << 4, 'compact index encodes literal row 1');
    }
    if (op === 17) assert.equal(src, 7, 'all DWRITE authority is private State in CR7');
    if (op === 0 && (word & 0x7FFF) !== 0x4000) {
        // NULL-clear encoding is handled separately by the existing assembler.
        assert.equal(src, 6, 'non-NULL LOAD source must be CR6');
    }
}
assert.equal(executable.filter(word => word >>> 27 === 1).length, 1);
assert(r.clist.slice(64).every(word => word === 0), 'all 64 C-list entries start NULL');
assert.equal(r.clist[0] & 255, 64);
const layout = r.setup.thread.layout;
assert.equal(layout.capsStart, 500);
assert.equal(r.setup.thread.applicationHome, 501);
assert.equal(r.thread[501], 0, 'application is supplied only at allocation time');
assert.equal(r.thread[layout.protectedStoOffset], (1 << 12) | (layout.stackEnd - 4));
assert.equal((r.thread[layout.stackEnd] >>> 13) & 0x7FFF, 0x7FFF, 'canonical poison root');
assert.equal((r.thread[layout.stackEnd - 2] >>> 13) & 0x7FFF, r.setup.thread.amoeba.startPC);
assert.deepEqual(r.setup.thread.relocations.map(x => x.wordOffset),
    [layout.stackEnd - 1, layout.stackEnd - 3, 500]);
assert(r.setup.thread.relocations.every(x => r.thread[x.wordOffset] === 0));
assert.deepEqual(r.objectWords.slice(768, 896), r.clist);
assert.deepEqual(r.objectWords.slice(1024), r.thread);
for (const method of r.compiled.methods) {
    const returns = method.code.map((word, i) => ({word, i})).filter(x => x.word >>> 27 === 3);
    assert.equal(returns.length, 2);
    assert.equal(returns[0].word & 0xFFF, 2, 'authored return retains only CR1');
    assert.equal(returns[1].i, method.code.length - 1);
    assert.equal(method.code[returns[1].i - 1] >>> 0, 0xF7000000,
        'compiler-added terminal RETURN follows an unconditional HARDFAULT');
}
assert.equal(r.binary.readUInt32BE(0), r.words[0] >>> 0);
const frame = r.packed.cw + 1;
assert.equal(r.words[frame] >>> 24, 0xAB);
const apiLength = r.words[frame] & 65535;
const embedded = JSON.parse(r.binary.subarray((frame + 1) * 4,
    (frame + 1) * 4 + apiLength).toString('utf8'));
assert.deepEqual(embedded, r.api);
const expanded = Codec.expand(r.api, r.words);
assert(expanded, 'existing API reader accepts compiled contract');
const shifted = prepare({baseWord: 8192, firstSlot: 44});
assert.deepEqual(shifted.binary, r.binary, 'B/Y are destination binding inputs, not source patches');
assert.equal(shifted.setup.objects[7].baseWord, 9216);
assert.equal(shifted.setup.objects[7].slot, 51);
for (const bad of [
    {baseWord: 7169}, {baseWord: 0}, {baseWord: 15360}, {baseWord: 16384},
    {firstSlot: 2}, {firstSlot: 57}, {firstSlot: 3.5},
]) assert.throws(() => prepare(bad));
const compileUI = fs.readFileSync(path.join(__dirname, '../simulator/app-compile.js'), 'utf8');
const maps = {};
for (const name of ['_CLOOMC_FILE_EXAMPLES', '_CLOOMC_FILE_LANGUAGES']) {
    const declaration = compileUI.match(new RegExp(`const ${name} = (\\{[\\s\\S]*?\\n\\});`));
    assert(declaration, `missing ${name}`);
    maps[name] = vm.runInNewContext('(' + declaration[1] + ')');
}
const context = vm.createContext({
    window: {_cloomcFileExamples: maps._CLOOMC_FILE_EXAMPLES,
        _cloomcFileLanguages: maps._CLOOMC_FILE_LANGUAGES},
    document: {addEventListener() {}}, console,
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../simulator/app-source-library.js'), 'utf8'), context);
const entries = vm.runInContext('_buildSLRegistry()', context).filter(x => x.key === 'free_handler');
assert.equal(entries.length, 1, 'example is discoverable once in the actual Source Library');
assert.equal(entries[0].name, 'FreeHandler');
assert.equal(entries[0].loader, 'cloomc');
assert.equal(maps._CLOOMC_FILE_EXAMPLES.free_handler, '/simulator/examples/free_handler.cloomc');
console.log('PASS: six-method ABI, private SAVE CR1 boundary, empty C-list, offline Thread skeleton, embedded API, initialization and relocatable B/Y.');
