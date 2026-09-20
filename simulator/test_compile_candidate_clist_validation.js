'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'app-compile.js'), 'utf8');
const start = source.indexOf('function _isCompilerSelfCapability(');
const end = source.indexOf('\n// The bootstrap has no symbolic/token projection layer', start);
assert.notStrictEqual(start, -1);
assert.notStrictEqual(end, -1);

let validations = 0;
const context = {
    CapabilityTokens: {
        isContextualSelf(cap) {
            return !!cap && /^_?SELF_?$/i.test(String(cap.name || ''));
        },
        validateClist(words, clistStart, caps) {
            validations++;
            const failed = words[clistStart + 1] === 0xBAD;
            return { ok: !failed, errors: failed ? ['row 1 token failed validation'] : [] };
        },
    },
    sim: {},
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);

const validCaps = [
    { name: 'SELF', symbolic_self: true, compiler_owned_self: true },
    { name: 'UART_DEV' },
];
const validWords = [0xF8000002, 0, 0, 0xFEED5E1F, 0x1234];
let result = context._validateCompiledCandidateClist(validWords, 3, validCaps);
assert.equal(result.ok, true);
assert.equal(validations, 1, 'the current candidate is validated on compile');

const fixedWords = validWords.slice();
fixedWords[4] = 0xBAD;
result = context._validateCompiledCandidateClist(fixedWords, 3, validCaps);
assert.equal(result.ok, false);
assert.match(result.errors.join(' '), /row 1 token failed validation/);
assert.equal(validations, 2, 'recompile reruns validation on the new candidate bytes');

result = context._validateCompiledCandidateClist(validWords, 3, [
    { name: 'UART_DEV' },
    { name: 'SELF' },
]);
assert.equal(result.ok, false);
assert.match(result.errors.join(' '), /row 0 must be SELF/);

result = context._validateCompiledCandidateClist(
    [0xF8000001, 0, 0xFEED5E1F], 2, validCaps);
assert.equal(result.ok, false);
assert.match(result.errors.join(' '), /declares 1 rows.*metadata has 2/);

const apiLayoutWords = new Array(2048).fill(0);
apiLayoutWords[0] = (((0x1F << 27) | (5 << 23) | (10 << 10) | 1) >>> 0);
let layout = context._deriveCompiledLumpLayout(apiLayoutWords);
assert.equal(layout.ok, true);
assert.equal(layout.clistStart, 2047);

const fullLayoutWords = new Array(8192).fill(0);
fullLayoutWords[0] = (((0x1F << 27) | (7 << 23) | (10 << 10) | 1) >>> 0);
layout = context._deriveCompiledLumpLayout(fullLayoutWords);
assert.equal(layout.ok, true);
assert.equal(layout.clistStart, 8191,
    'layout comes from authenticated full-source allocation, not a preliminary 2K build');

const tamperedHeader = fullLayoutWords.slice();
tamperedHeader[0] = (((0x1F << 27) | (5 << 23) | (10 << 10) | 1) >>> 0);
assert.equal(context._deriveCompiledLumpLayout(tamperedHeader).ok, false);

const overlappingClist = new Array(64).fill(0);
overlappingClist[0] = (((0x1F << 27) | (63 << 10) | 1) >>> 0);
assert.equal(context._deriveCompiledLumpLayout(overlappingClist).ok, false);

console.log('Compile candidate C-list validation regression: PASS');