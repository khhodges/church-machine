// Regression coverage for exact CALL/RETURN instruction location resolution.
'use strict';

const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync(__dirname + '/app-run.js', 'utf8');
const marker = 'function _callReturnInstructionLocation(';
const start = src.indexOf(marker);
if (start < 0) throw new Error('drill-down resolver not found');
let depth = 0;
let end = -1;
for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) { end = i + 1; break; }
}
if (end < 0) throw new Error('could not extract drill-down resolver');

const sandbox = {
    sim: {
        memory: [0, 0x10000000, 0x10000000, 0x18000000],
        nsLabels: { 2: 'Nested.Abs' },
        callStack: [{}, {}],
    },
    _cmDecodeWord(word, addr) {
        return { mnemonic: word === 0x10000000 ? 'CALL' : 'RETURN',
            text: (word === 0x10000000 ? 'CALL' : 'RETURN') + ' @' + addr };
    },
    _nsOwnerOf(addr) {
        return { nsIdx: 2, label: 'Nested.Abs', base: 0 };
    },
};
vm.runInNewContext(src.slice(start, end) + '\nthis.resolve = _callReturnInstructionLocation;', sandbox);

const first = sandbox.resolve({ kind: 'CALL', nia: 1, instrWord: 0x10000000,
    nia_label: 'Nested.Abs.outer' }, {});
const second = sandbox.resolve({ kind: 'RETURN', nia: 3, instrWord: 0x18000000,
    nia_label: 'Nested.Abs.inner' }, {});
assert.strictEqual(first.physicalAddress, 1);
assert.strictEqual(second.physicalAddress, 3);
assert.notStrictEqual(first.physicalAddress, second.physicalAddress);
assert.strictEqual(first.method, 'outer');
assert.strictEqual(second.method, 'inner');
assert.strictEqual(first.rawWord, 0x10000000);
assert.strictEqual(second.rawWord, 0x18000000);

const sourceLess = sandbox.resolve({ kind: 'RETURN', nia: 2 }, {});
assert.strictEqual(sourceLess.physicalAddress, 2);
assert.strictEqual(sourceLess.rawWord, 0x10000000);
assert.strictEqual(sourceLess.lump, 'Nested.Abs');

console.log('CALL/RETURN drill-down resolver tests passed');