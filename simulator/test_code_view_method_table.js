'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function extractFunction(source, name) {
    const start = source.indexOf('function ' + name + '(');
    assert.notEqual(start, -1, 'missing production function ' + name);
    const brace = source.indexOf('{', start);
    let depth = 0;
    for (let i = brace; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error('unbalanced production function ' + name);
}

const source = fs.readFileSync(path.join(__dirname, 'app-memory.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(extractFunction(source, '_codeViewMethodEntries'), context);

// WukongCallHome-style legacy table: physical LUMP word 2 is selector #1 data,
// targeting logical code PC 1 / LUMP word 2, and must never reach disassembly.
const legacy = context._codeViewMethodEntries(
    [0x00000002, 0x071b0001, 0x07230002, 0xaf084001], []);
assert.equal(legacy.length, 1);
assert.equal(legacy[0].selector, 1);
assert.equal(legacy[0].kind, 'legacy');
assert.equal(legacy[0].targetIndex, 1);
assert.equal(legacy[0].lumpWord, 2);
assert.equal(legacy[0].method, null, 'metadata-free entry must not invent a name');

// Declared tables retain binary-authoritative branch/private decoding while
// carrying authentic names and visibility metadata when available.
const branch = offset => ((23 << 27) | (offset & 0x7fff)) >>> 0;
const methods = [
    { name: 'PublicEntry' },
    { name: 'PrivateHelper', _internal: true },
    { name: 'SecondEntry' },
];
const declared = context._codeViewMethodEntries(
    [branch(3), 0, branch(2), 0x18000000, 0x18000000, 0x18000000], methods);
assert.equal(declared.length, 3);
assert.deepEqual(
    Array.from(declared, entry => [entry.selector, entry.kind, entry.targetIndex, entry.lumpWord]),
    [[1, 'branch', 3, 4], [2, 'private', null, null], [3, 'branch', 4, 5]]);
assert.equal(declared[0].method.name, 'PublicEntry');
assert.equal(declared[1].method._internal, true);

// An ordinary instruction at word 1 is not enough evidence for a table.
assert.equal(context._codeViewMethodEntries(
    [0x071b0001, 0x07230002, 0xaf084001], []).length, 0);

// Stale declared metadata cannot override incompatible resident bytes.
assert.equal(context._codeViewMethodEntries(
    [0x071b0001, 0x07230002], [{ name: 'Stale' }]).length, 0);

assert(source.includes('.method_entry&nbsp;&nbsp;#${_entry.selector}'),
    'Code View renders selector entries rather than instructions');
assert(source.includes('target 0x${_targetAddr.toString(16)'),
    'Code View renders the decoded physical target');

console.log('Code View method-table regression tests passed.');