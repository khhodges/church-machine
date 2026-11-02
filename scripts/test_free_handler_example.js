'use strict';
// Compiler and binary contract checks. Deliberately no queue simulator.
const assert = require('node:assert/strict');
const {prepare, wordsToBytes} = require('./build_free_handler_example');
const Codec = require('../simulator/lump-api-codec');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const r = prepare();
assert.equal(r.amoebaApi.name, 'ide.FreeThreadStartup');
assert.equal(r.amoebaApi.symbolic_binding.owner, 'ide.FreeThreadStartup');
assert.deepEqual(r.amoebaApi.symbolic_binding.dependencies.map(d => d.name),
    ['SELF', 'Boot.Thread']);
assert(r.setup.thread.relocations.every(rel => rel.name === 'ide.FreeThreadStartup'));
const {bindPreparedBlock} = require('./free_handler_bindings');
const Simulator = require('../simulator/simulator');
const tokenFactory = new Simulator();
const slots = {'ide.B1.Inventory': 25, 'ide.B1.State': 21,
    'ide.FreeHandlerBlocks': 24, 'ide.FreeThreadStartup': 22,
    ...Object.fromEntries(r.setup.objects.map(o => [o.name, o.slot]))};
const trusted = (name, rights) => {
    assert(name in slots, `unrecognized canonical target ${name}`);
    return tokenFactory.createGT(0, slots[name], Object.fromEntries(rights.map(p => [p, 1])), 1) >>> 0;
};
const portableBefore = JSON.stringify([r.clist, r.inventory, r.directory, r.thread]);
const bound = bindPreparedBlock(r, trusted);
assert.equal(bound.clist[64], trusted('ide.B1.FreeClist', ['E']));
assert(bound.clist.slice(65).every(x => x === 0));
assert.equal(bound.inventory[62] & 0x07FFFFFF, bound.inventory[63] & 0x07FFFFFF);
assert.equal(bound.thread[501], 0);
assert.equal(JSON.stringify([r.clist, r.inventory, r.directory, r.thread]), portableBefore,
    'offline binding does not mutate portable templates');
assert.throws(() => bindPreparedBlock(r, () => 0), /Missing trusted grant/);
assert.throws(() => bindPreparedBlock(r, (name, rights) => {
    if (name === 'ide.B1.FreeThread' && rights.join('') === 'S')
        return trusted('ide.B1.FreeClist', rights);
    return trusted(name, rights);
}), /Wrong destination slot/, 'ThreadSetup cannot bind a different object');
assert.throws(() => bindPreparedBlock(r, (name, rights) =>
    name === 'ide.B1.FreeClist' && rights.join('') === 'LS'
        ? trusted(name, ['S']) : trusted(name, rights)), /Wrong form or permissions/);
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
assert.equal(r.packed.cc, 3);
assert(r.words.slice(-3).every(word => word === 0), 'unbound means NULL, not fabricated grants');
assert.equal(r.api.symbolic_binding.calls.length, 0);
assert.deepEqual(r.api.symbolic_binding.dependencies.map(d => d.relocation_row),
    [0, 1, 2]);
assert.deepEqual(r.api.symbolic_binding.dependencies.map(d => d.rights.join('')),
    ['E', 'L', 'R']);
assert.equal(r.setup.inventory.bindings[10].aliasOf, r.setup.objects[7].name);
assert.equal(r.setup.inventory.bindings[10].slot, r.setup.objects[7].slot);
assert.equal(r.setup.inventory.bindings[10].name, 'ide.B1.ThreadSetup');
assert.deepEqual(r.setup.objects.map(o => o.name),
    ['FreeData0','FreeData1','FreeData2','FreeData3','FreeData4','FreeData5','FreeClist','FreeThread'].map(n => 'ide.B1.' + n));
assert.deepEqual(r.setup.clist.relocations,
    [{wordOffset: 64, name: 'ide.B1.FreeClist', rights: ['E'], slot: 38}]);
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
        assert([6, 9, 10].includes(src), 'LOAD only uses SELF directory, directory or selected inventory');
    }
}
assert.equal(executable.filter(word => word >>> 27 === 1).length, 1);
assert(r.clist.slice(64).every(word => word === 0), 'portable SELF is unresolved; remaining 63 entries are NULL');
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
const shifted = prepare({baseWord: 8192, firstSlot: 44, blockName: 'B2'});
assert.deepEqual(shifted.binary, r.binary, 'B/Y are destination binding inputs, not source patches');
assert.equal(shifted.setup.objects[7].baseWord, 9216);
assert.equal(shifted.setup.objects[7].slot, 51);
assert.equal(shifted.setup.objects[0].name, 'ide.B2.FreeData0');
assert.equal(shifted.setup.thread.initializationGrant.aliasOf, 'ide.B2.FreeThread');
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
console.log('PASS: shared six-method ABI, private SAVE CR1 boundary, SELF relocation, block names, Thread alias and byte-identical B1/B2 code.');
