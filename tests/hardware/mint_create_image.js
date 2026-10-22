'use strict';
// Compiler output only: no catalog access, saved artifacts, or opcode rewriting.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
global.ChurchAssembler = require('../../simulator/assembler');
const Compiler = require('../../simulator/cloomc_compiler');
const {buildLump} = require('../../simulator/lump_builder');

function compile(source) {
    const result = new Compiler().compile(source, []);
    assert.deepEqual(result.errors, []);
    const image = buildLump(result);
    return image.words.slice(0, 1 + image.cw);
}
function file(name) {
    return compile(fs.readFileSync(path.join(__dirname,
        '../../simulator/cloomc', name + '.cloomc'), 'utf8'));
}
const callers = [];
for (let method = 0; method < 4; method++) {
    const caller = compile(`abstraction test.MintCaller {
        capabilities { SELF E }
        method Run {
            LOAD CR1, CR6, #1
            LOAD CR2, CR6, #2
            LOAD CR3, CR6, #2
            IADD DR2, DR0, #12
            IADD DR3, DR0, #3
            CALL CR1, #${method}
            ${Array.from({length: 8}, (_, i) =>
                `IADD DR4, DR0, #${80 + i}
                 DWRITE DR4, CR1, #${i}, DR0
                 DREAD DR${6 + i}, CR1, #${i}, DR0`).join('\n')}
            HALT
        }
    }`);
    // Root bootstrap uses CALL selector zero (entry at word one). The
    // disposable harness caller has no method table; Mint/PkVerify retain
    // their complete builder output, including their dispatch tables.
    callers.push([caller[0], ...caller.slice(2)]);
}
console.log(JSON.stringify({mint: file('mint'), verify: file('pkverify'), callers}));
