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

const sandbox = { Number, Boolean, parseInt, String, Date };
vm.createContext(sandbox);
vm.runInContext(extractFunction('_lumpRepositoryName'), sandbox);
vm.runInContext(extractFunction('_latestPrimaryLump'), sandbox);
vm.runInContext(extractFunction('_latestRepositoryLump'), sandbox);
vm.runInContext(extractFunction('_repositoryPrimaryLumps'), sandbox);

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
const latestSavedRows = [
    { token: 'boot-capability-test', abstraction: 'CapabilityTest',
      lump_version: 99, approved: true, compiled_at: '2026-09-08T12:00:00Z' },
    { token: 'latest-capability-test', abstraction: 'CapabilityTest',
      lump_version: 19, approved: false, archived: true,
      compiled_at: '2026-09-09T12:00:00Z' },
];
assert.strictEqual(
    sandbox._latestPrimaryLump(latestSavedRows, 'CapabilityTest').token,
    'boot-capability-test',
    'archived revisions never replace the active catalogue selection');

const dotNameRows = [
    { token: 'bare-anyname', abstraction: 'anyname',
      compiled_at: '2026-09-10T12:00:00Z' },
    { token: 'new-anyname', abstraction: 'anyname', dot_name: 'New.anyname',
      compiled_at: '2026-09-10T12:00:00Z' },
    { token: 'old-new-anyname', abstraction: 'anyname', dot_name: 'New.anyname',
      archived: true, lump_version: 99,
      compiled_at: '2026-09-11T12:00:00Z' },
];
const repositoryRows = sandbox._repositoryPrimaryLumps(dotNameRows);
assert.deepStrictEqual(
    repositoryRows.map(row => row.token).sort(),
    ['bare-anyname', 'new-anyname'],
    'Repository keeps distinct canonical dot names, including New.anyname, while excluding archived history');
assert.strictEqual(
    sandbox._latestRepositoryLump(dotNameRows, 'New.anyname').token,
    'new-anyname',
    'archived New.anyname history cannot replace its active revision');
assert(source.includes('const _primaryLumps = _repositoryPrimaryLumps(lumps)') &&
       source.includes('const name  = lump.dot_name || lump.abstraction ||'),
    'top-level repository groups by canonical dot name and displays it');
assert(source.includes('_currentRow.archived === true'),
    'persisted archived selection is repaired on reload');
assert(source.includes('_latestPrimaryLump(lumps, _liveRow.abstraction)') &&
       source.includes('_latestLiveRevision ? _latestLiveRevision.token : _liveToken'),
    'live execution identity selects the latest saved artifact for editor and Run');
assert(editorSource.includes('lump && lump.archived === true') &&
       editorSource.includes('_primaryCandidates[0].token !== token') &&
       editorSource.includes('window.LumpRegistry.setCurrent(token)'),
    'Open in Editor redirects only an older archived token to the latest save');

console.log('PASS LUMP browser selects the current documented revision');