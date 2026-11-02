'use strict';
// Compiler and binary contract checks. Deliberately no queue simulator.
const assert = require('node:assert/strict');
const {prepare, wordsToBytes} = require('./build_free_handler_example');
const Codec = require('../simulator/lump-api-codec');
const r = prepare();
assert.deepEqual(r.compiled.errors, []);
assert.deepEqual(r.compiled.warnings, []);
assert.equal(r.api.name, 'ide.FreeHandler');
assert.equal(r.api.passkey, 1);
assert.deepEqual(Object.keys(r.api.methods).sort(),
    ['Free64', 'Free128', 'Free256', 'Release'].sort());
for (const [index, name] of ['Free64', 'Free128', 'Free256'].entries())
    assert.deepEqual(r.api.methods[name], [index, [], [2, 'RW']]);
assert.deepEqual(r.api.methods.Release, [3, [['target', 2, 'RW']], 0]);
assert.equal(r.packed.cc, 10);
assert(r.words.slice(-10).every(word => word === 0), 'unbound means NULL, not fabricated grants');
assert.equal(r.api.symbolic_binding.calls.length, 0);
assert.deepEqual(r.api.symbolic_binding.dependencies.map(d => d.relocation_row),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
assert(r.api.symbolic_binding.dependencies.slice(1).every(d => d.rights.join('') === 'RW'));
assert.deepEqual(r.state.slice(0, 12), [0, 0, 4, 0, 0, 2, 0, 0, 2, 0, 0, 0]);
assert.deepEqual(r.state.slice(12, 20), [0, 1, 2, 3, 4, 5, 6, 7]);
assert(r.state.slice(20).every(word => word === 0));
assert.equal(wordsToBytes(r.state, true).readUInt32LE(8), 4);
assert.equal(r.setup.objects.reduce((n, o) => n + o.words, 0), 1024);
assert(r.setup.objects.every(o => o.baseWord % o.words === 0 && o.limit === o.words - 1));
assert.deepEqual(r.setup.objects.map(o => o.slot), [32, 33, 34, 35, 36, 37, 38, 39]);

// Inspect the actual compiled instructions, not a second implementation.
// The first four code words are dispatch offsets, not instructions.
const executable = r.words.slice(1 + r.compiled.methods.length, 1 + r.packed.cw);
assert(executable.length > 0);
for (const word of executable) {
    const op = word >>> 27, dst = (word >>> 19) & 15, src = (word >>> 15) & 15;
    assert(![1, 2, 4, 5, 7, 8, 9].includes(op),
        `foreground code must not CALL, CHANGE, SWITCH, LAMBDA or SAVE (opcode ${op})`);
    if (op === 17) assert.equal(src, 7, 'all DWRITE authority is private State in CR7');
    if (op === 0 && (word & 0x7FFF) !== 0x4000) {
        // NULL-clear encoding is handled separately by the existing assembler.
        assert.equal(src, 6, 'non-NULL LOAD source must be CR6');
    }
}
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
assert.equal(shifted.setup.objects[7].baseWord, 8960);
assert.equal(shifted.setup.objects[7].slot, 51);
for (const bad of [
    {baseWord: 7169}, {baseWord: 0}, {baseWord: 16384},
    {firstSlot: 2}, {firstSlot: 57}, {firstSlot: 3.5},
]) assert.throws(() => prepare(bad));
console.log('PASS: real CLOOMC++ compile, four-method ABI, native instruction boundaries, embedded API, initialization, relocatable B/Y. No execution claim.');
