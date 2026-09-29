'use strict';

// Disposable compiler fixtures only. Source layout generation is not admission.
const assert = require('node:assert/strict');
const Assembler = require('./assembler.js');
const codec = require('./idx1.js');

const compile = (source, sourceLayout) => new Assembler().assemble(source, {
    profile: 'IDX1', sourceLayout,
});
const source = [
    'entry:',
    'BRANCH body',
    'privateMethod:',
    '.word 0',
    'body:',
    'IADD DR11, DR0, #2',
    'LOAD CR1, CR6, DR11',
    'DREAD DR1, CR1, DR15 + 7',
    'CALL CR6[DR2 - 1], DR3 + 4',
    'RETURN',
].join('\n');
const result = compile(source, {
    fastEntry: 'entry',
    dispatch: [{ word: 'entry', kind: 'branch' },
        { word: 'privateMethod', kind: 'private' }],
});
assert.deepEqual(result.errors, []);
assert.equal(result.profile, 'IDX1');
assert.equal(result.executable, false);
assert.deepEqual(result.layout, {
    codeWords: 11,
    extents: [{ startWord: 1, endWord: 2, kind: 'code' },
        { startWord: 2, endWord: 3, kind: 'data' },
        { startWord: 3, endWord: 12, kind: 'code' }],
    instructionStarts: [1, 3, 4, 6, 8, 11],
    dispatch: [{ selector: 1, word: 1, kind: 'branch' },
        { selector: 2, word: 2, kind: 'private' }],
    fastEntry: 1,
});
assert.deepEqual(codec.decodePacket(result.words.slice(3, 5)).role0, {
    register: 11, magnitude: 0, subtract: false,
});
assert.deepEqual(codec.decodePacket(result.words.slice(7, 10)).role1, {
    register: 3, magnitude: 4, subtract: false,
});
assert.equal(result.sourceMap.find(entry => entry.line === 7).startWord, 4);
assert.equal(result.words[0] & 0x7FFF, 2);

// Every architectural DR is kept in the emitted descriptor, not sampled.
for (let register = 0; register < 16; register++) {
    const compiled = compile(`LOAD CR1, CR6, DR${register} + 32768\nRETURN`, {
        fastEntry: 1, dispatch: [],
    });
    assert.deepEqual(compiled.errors, []);
    assert.equal(codec.decodePacket(compiled.words.slice(0, 2)).role0.register, register);
}

const error = (text, layout, pattern) => {
    const rejected = compile(text, layout);
    assert(rejected.errors.length);
    assert.equal(rejected.layout, null);
    assert.match(rejected.errors.map(entry => entry.message).join('\n'), pattern);
};
error('LOAD CR1, CR6, DR11', { fastEntry: 2, dispatch: [] }, /instruction start/);
error('RETURN', { fastEntry: 'missing', dispatch: [] }, /Unknown IDX1 layout label/);
error('RETURN', { fastEntry: 1, dispatch: [{ word: 1 }] }, /explicit kind/);
error('LOAD CR1, CR6, DR11, 2', { fastEntry: 1, dispatch: [] }, /operand count/);
error('CALL CR3, DR1, DR2', { fastEntry: 1, dispatch: [] }, /operand count/);
error('BRANCH DR1, DR2', { fastEntry: 1, dispatch: [] }, /explicit condition/);
error('RETURN', { fastEntry: 1, dispatch: [], unexpected: true }, /requires only/);
error('RETURN', { fastEntry: 1, dispatch: [
    { word: 1, kind: 'branch' }, { word: 1, kind: 'branch' },
] }, /dispatch/);
const conflicting = new Assembler().assemble('RETURN', {
    profile: 'IDX1', sourceLayout: { fastEntry: 1, dispatch: [] },
    layout: { fastEntry: 1, dispatch: [], extents: [] },
});
assert.match(conflicting.errors[0].message, /not both/);
const malformed = new Assembler().assemble('RETURN', {
    profile: 'IDX1', layout: { fastEntry: 1, dispatch: [], extents: [null] },
});
assert(malformed.errors.length); // Malformed metadata is diagnostic, not a crash.

// IDX1 is never selected by seeing a register operand in legacy source.
const legacy = new Assembler().assemble('LOAD CR1, CR6, DR11');
assert(legacy.errors.length);
const literal = 'LOAD CR1, CR6, #2\nRETURN';
assert.deepEqual(compile(literal, { fastEntry: 1, dispatch: [] }).words,
    new Assembler().assemble(literal).words);
console.log('IDX1 source-layout compiler tests passed (no executable admission)');