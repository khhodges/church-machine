'use strict';
// Emit private instruction images only. Never load a catalog or write artifacts.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const Assembler = require('../../simulator/assembler');
global.ChurchAssembler = Assembler;
const Compiler = require('../../simulator/cloomc_compiler');

const text = fs.readFileSync(path.join(__dirname, '../../simulator/cloomc/mint.cloomc'), 'utf8');
const block = text.split('; BEGIN NATIVE SLOT PACKAGE')[1].split('; END NATIVE SLOT PACKAGE')[0];
const body = block.slice(block.indexOf('create_descriptor_prepare:'));
const failure = text.match(/^TODO_CREATE_DESCRIPTOR_INPUT_INVALID:\n\s*(HARDFAULT "[^"]+")/m)[1];
function image(mutate = false) {
    assert.equal((body.match(/MCMP DR4, DR0/g) || []).length, 1);
    const source = (mutate ? body.replace('MCMP DR4, DR0', 'MCMP DR4, #0') : body) + `
create_data_descriptor_ready:
    HALT
TODO_CREATE_DESCRIPTOR_INPUT_INVALID:
    ${failure}
`;
    const assembled = new Assembler().assemble(source);
    assert.deepEqual(assembled.errors, []);
    // Match the compilation path used by test_mint_slot_descriptor.js; no
    // test-local relocation or branch re-encoding is allowed.
    const compiled = new Compiler().compile(`abstraction test.PrivateMint {
        capabilities { SELF E }
        method Run() { ${source} }
    }`, []);
    assert.deepEqual(compiled.errors, []);
    assert.deepEqual(compiled.methods[0].code.slice(0, assembled.words.length),
        assembled.words);
    return {words: assembled.words, labels: assembled.labels};
}
const compare = {};
for (const operand of ['DR0', '#0']) {
    const assembled = new Assembler().assemble(`MCMP DR4, ${operand}`);
    assert.deepEqual(assembled.errors, []);
    compare[operand] = assembled.words;
}
console.log(JSON.stringify({exact: image(), immediateMutation: image(true), compare}));
