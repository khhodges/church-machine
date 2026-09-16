'use strict';

// Regression coverage for the saved-LUMP compiled disassembly C-list block.
// The embedded API supplies the declared canonical name and rights; the
// immutable binary supplies the actual token word stored in each C-list row.

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

const source = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');
const displayNameSource = extractFunction(source, '_displayLumpCapabilityName');
const displayName = vm.runInNewContext(
    displayNameSource + '\n_displayLumpCapabilityName',
    {}
);
const formatterSource = extractFunction(source, '_formatSavedLumpCapabilities');
const formatCapabilities = vm.runInNewContext(
    formatterSource + '\n_formatSavedLumpCapabilities',
    {}
);

const caps = [
    { name: '__SELF__', rights: ['E'], grants: ['E'] },
    { dot_name: 'New.WukongCallHome', grants: ['E'] },
];
assert.equal(displayName(caps[0], 0), 'SELF',
    'compiler-internal __SELF__ must never replace the public SELF name');
assert.equal(displayName({ name: 'SELF' }, 0), 'SELF');
assert.equal(displayName({ name: 'SelfTest' }, 1), 'SelfTest');
const words = new Array(20).fill(0);
words[16] = 0x1234abcd;
words[17] = 0xfeed0001;

const output = formatCapabilities(caps, words, 16);
assert.equal(
    output,
    '#0 SELF  token=0x1234ABCD  rights=E\n' +
    '  #1 New.WukongCallHome  token=0xFEED0001  rights=E'
);

assert(
    source.includes('_formatSavedLumpCapabilities(\n                    _lCaps, serverWords, _clistStart)'),
    'saved-LUMP disassembly uses the binary-backed C-list formatter'
);
assert(
    source.includes('var _clistStart = lhdr.lumpSize - lhdr.cc;'),
    'saved-LUMP disassembly locates C-list rows from the authoritative header'
);
assert(
    source.includes('JSON.stringify(apiDefinition, null, 2)'),
    'raw embedded API inspection remains byte-faithful instead of rewriting sealed names'
);
assert(
    source.includes("disasmLines.push('capabilities {');") &&
    source.includes("disasmLines.push('  ' + _capItems);") &&
    source.includes("disasmLines.push('}');"),
    'saved-LUMP disassembly renders the C-list as a multiline block'
);

console.log('saved-LUMP disassembly C-list tests passed');