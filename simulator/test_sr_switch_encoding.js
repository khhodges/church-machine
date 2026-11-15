'use strict';
// Public indexed handoff encoding; no instruction-word rewriting in fixtures.
const assert = require('node:assert/strict');
const Compiler = require('./cloomc_compiler');
const builder = require('./lump_builder');
function compile(instruction) {
    const result = new Compiler().compile(`abstraction test.SwitchEncoding {
        capabilities { SELF E }
        method Run() { ${instruction}
        RETURN }
    }`, []);
    return result;
}
for (const [instruction, expected] of [
    ['SWITCH CR1, DR1', 0x2f008001],
    ['SWITCH CR11, DR15', 0x2f05800f],
    ['SWITCH CR1, DR1+3', 0x2f008031],
    ['SWITCH CR1, DR1-3', 0x2f00c031],
    ['SWITCH CR15, CR1, DR1', 0x2f788001], // historical form unchanged
]) {
    const result = compile(instruction);
    assert.deepEqual(result.errors, [], instruction);
    const words = builder.buildLump(result).words;
    assert.equal(words[words[1]] >>> 0, expected, instruction);
}
for (const instruction of [
    'SWITCH CR12, DR1', 'SWITCH CR15, DR1',
    'SWITCH CR1, DR16', 'SWITCH CR1, DR1+1024',
]) {
    assert(compile(instruction).errors.length, instruction);
}
console.log('PASS SR indexed SWITCH encoding and legacy isolation');
