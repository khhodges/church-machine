'use strict';
const assert = require('assert');
const {execFileSync} = require('child_process');
const Tokens = require('./capability_tokens.js');
global.ChurchAssembler = require('./assembler.js');
const Compiler = require('./cloomc_compiler.js');
const compile = declaration => JSON.parse(execFileSync('node',
    ['server/compile_worker.js'], {input: JSON.stringify({
        language: 'assembly',
        source: `; Abstraction: Owner\ncapabilities { ${declaration}, NewIdea RW }\nRETURN`
    }), encoding: 'utf8'}));
for (const self of ['SELF', 'SELF E', '__SELF__']) {
    const result = compile(self);
    assert.strictEqual(result.ok, true, result.error);
    assert.deepStrictEqual(result.capabilities[0].rights, ['E']);
    assert.strictEqual(Tokens.resolveCapability(result.capabilities[0], {}).error, null);
    assert.deepStrictEqual(result.capabilities[1].rights, ['R', 'W']);
}
assert.strictEqual(compile('SELF RW').ok, false);
const errors = [];
new Compiler()._buildROM([{name: 'Other', rights: ['X']}],
    [{name: 'Other', authored_rights: ['R']}], errors);
assert.ok(!errors.some(e => /cannot redefine/.test(e.message)),
    'short-name upload metadata cannot establish foreign ownership');
assert.match(Tokens.checkLeafOwnership(
    {name: 'Other', canonical_leaf: 'global.remote.Other', rights: ['X']},
    {node: 'global.local', definitions: {'global.remote.Other': ['R']}}).error,
    /Foreign leaf/);
console.log('PASS SELF remains E; foreign permissions require IDE-instance evidence');