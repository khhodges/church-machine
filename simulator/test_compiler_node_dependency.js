'use strict';
// Each case gets a fresh process: no accidental assembler-global inheritance.
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const path = require('node:path');
for (const setup of ['', 'global.ChurchAssembler = undefined;', 'global.ChurchAssembler = {};']) {
    const result = spawnSync(process.execPath, ['-e', `
        const assert = require('node:assert/strict');
        ${setup}
        const Compiler = require('./simulator/cloomc_compiler');
        const result = new Compiler().compile(
            'abstraction test.Dependency {\\ncapabilities { SELF E }\\nmethod Run {\\nRETURNAL\\n}\\n}', []);
        assert.deepEqual(result.errors, []);
        assert.equal(result.methods.length, 1);
    `], {cwd: path.join(__dirname, '..'), encoding: 'utf8'});
    assert.equal(result.status, 0, result.stdout + result.stderr);
}
console.log('PASS compiler Node dependency: absent, undefined and non-constructor globals');
