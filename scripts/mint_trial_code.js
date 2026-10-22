'use strict';
// Exact current native code, without catalog reads or publication.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
global.ChurchAssembler = require('../simulator/assembler');
const Compiler = require('../simulator/cloomc_compiler');
const {assembleLump} = require('../simulator/lump_assembler');
const output = {};
for (const name of ['mint', 'pkverify']) {
    const source = fs.readFileSync(path.join(__dirname, '../simulator/cloomc', `${name}.cloomc`), 'utf8');
    const compiled = new Compiler().compile(source, []);
    assert.deepEqual(compiled.errors, []);
    const assembled = assembleLump(compiled.methods.map(m => m.code));
    output[name] = {
        source, capabilities: compiled.capabilities,
        // Keep compiler method words and assembler dispatch words unchanged.
        code: Array.from(assembled.buf.slice(1))
    };
}
console.log(JSON.stringify(output));
