'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {buildApiDefinition, embedSelfDefinition} = require('./lump_builder.js');
const {lumpDecodeContentFrameApi} = require('./lump-content-frame.js');
for (const cap of [null, {}, {name: ''}, {name: '   '}]) {
    assert.throws(() => buildApiDefinition({capabilities: [cap]}),
        /no PetName.*programmer.*recompile/);
}
const cap = {name: 'Device', rights: ['R'], N: 'example.Device#1',
    T: '12345678', binary_hash: 'a'.repeat(64),
    identity_hash: 'b'.repeat(64), identity_string: 'example.Device#1'};
const before = JSON.stringify(cap);
const words = Array(64).fill(0);
words[0] = ((31 << 27) | (1 << 10) | 1) >>> 0;
words[1] = 0x18000000;
const api = buildApiDefinition({abstractionName: 'Example',
    capabilities: [cap], methods: []}, words);
const binary = embedSelfDefinition(words, api, '', 0);
const recovered = lumpDecodeContentFrameApi(binary);
assert.deepStrictEqual(recovered.capabilities[0], cap);
assert.equal(JSON.stringify(cap), before);
function check(candidate) {
    return buildApiDefinition({capabilities: [candidate]}, words);
}
for (const [key, value] of [
    ['T', 12345678], ['T', 'ABCDEF12'], ['T', '1234'],
    ['binary_hash', 'a'.repeat(63)], ['identity_hash', null],
    ['N', 'example.Device'], ['N', ' example.Device#1'],
    ['identity_string', 'example.Other#1'], ['token', '87654321'],
]) {
    const invalid = {...cap, [key]: value};
    const snapshot = JSON.stringify(invalid);
    assert.throws(() => check(invalid), /C-list row 0.*Correct the supplied identity/);
    assert.equal(JSON.stringify(invalid), snapshot);
}
for (const key of ['N', 'T', 'binary_hash', 'identity_hash']) {
    const partial = {...cap};
    delete partial.identity_string;
    delete partial[key];
    assert.throws(() => check(partial), /partial identity lock/);
}
assert.equal(check({name: 'Unpinned', rights: ['E']}).capabilities[0].N, undefined);
assert.doesNotThrow(() => check({name: 'SELF', rights: ['E']}));
assert.doesNotThrow(() => check({...cap, token: cap.T}));
const aliases = {...cap, token: cap.T};
delete aliases.T;
delete aliases.N;
assert.doesNotThrow(() => check(aliases));
const worker = fs.readFileSync(path.join(__dirname, '../server/compile_worker.js'), 'utf8');
assert(!worker.includes('warnings.push({ message: `self-definition not embedded'));
assert(worker.includes('No standalone candidate was produced'));
console.log('Standalone definition requirements passed (names, byte roundtrip, failure policy).');