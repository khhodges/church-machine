'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync(
    path.join(__dirname, 'app-abstractions.js'), 'utf8');
const editorSource = fs.readFileSync(
    path.join(__dirname, 'app-lumps.js'), 'utf8');

function extractFunction(name) {
    const start = source.indexOf('function ' + name + '(');
    assert(start >= 0, name + ' exists');
    const brace = source.indexOf('{', start);
    let depth = 0;
    for (let i = brace; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}' && --depth === 0) {
            return source.slice(start, i + 1);
        }
    }
    throw new Error('unterminated ' + name);
}

const sandbox = { Number, Boolean, parseInt, String };
vm.createContext(sandbox);
vm.runInContext(extractFunction('_latestPrimaryLump'), sandbox);

const rows = [
    { token: 'c7425d6c', abstraction: 'CapabilityTest',
      archived: true, lump_version: 1, approved: false },
    { token: 'd74af54b', abstraction: 'CapabilityTest',
      archived: true, lump_version: 14, approved: false },
    { token: '9ce28c0b', abstraction: 'CapabilityTest',
      lump_version: 11, approved: false },
    { token: 'c7657c2d', abstraction: 'CapabilityTest',
      lump_version: 12, approved: false },
    { token: '00000a00', abstraction: 'CapabilityTest',
      lump_version: 18, approved: true, has_source: true }
];

const selected = sandbox._latestPrimaryLump(rows, 'CapabilityTest');
assert.strictEqual(selected.token, '00000a00',
    'current approved documented revision wins over archived legacy revisions');
assert(source.includes("lumps.filter(l => l.archived !== true)"),
    'top-level repository excludes archived revisions');
assert(source.includes('_currentRow.archived === true'),
    'persisted archived selection is repaired on reload');
assert(editorSource.includes('lump && lump.archived === true') &&
       editorSource.includes('server.archived !== true') &&
       editorSource.includes('window.LumpRegistry.setCurrent(token)'),
    'Open in Editor redirects archived tokens to the current server artifact');

console.log('PASS LUMP browser selects the current documented revision');