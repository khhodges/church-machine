'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const Compiler = require('../../simulator/cloomc_compiler');
const {buildLump} = require('../../simulator/lump_builder');
const candidate = require('../../scripts/build_mint_v4_candidate').build();
function compile(source) {
    const c = new Compiler().compile(source, []);
    assert.deepEqual(c.errors, []);
    const b = buildLump(c);
    return b.words.slice(0, b.cw + 1);
}
const create = `
LOAD CR4, CR6, #1
LOAD CR1, CR6, #2
IADD DR2, DR0, #12
IADD DR3, DR0, #3
CALL CR4, #0
`;
const capture = `
LOAD CR9, CR6, #5
DREAD DR4, CR9, #159, DR0
LOAD CR9, CR6, #4
DWRITE DR4, CR9, #0, DR0
`;
const destroy = `
LOAD CR4, CR6, #1
LOAD CR1, CR6, #2
LOAD CR2, CR6, #3
LOAD CR2, CR2, #0
IADD DR2, DR0, #123
CALL CR4, #1
`;
const callers = {};
for (const [name, body] of Object.entries({
    reuse:create + capture + destroy + create,
    wrongProof:create,
    exhaust:create,
    stubOutform: 'LOAD CR4, CR6, #1\nCALL CR4, #2',
    stubInform: 'LOAD CR4, CR6, #1\nCALL CR4, #3',
    stale:create + capture + destroy + destroy
})) {
    const words = compile(`abstraction test.V4 {
capabilities { SELF E }
method Run {
${body}
IADD DR0, DR0, #0
}
}`);
    // Current boot CALL dispatches through selector one; retain the compiler's
    // method table rather than the historical selector-zero fixture shortcut.
    callers[name] = words;
}
console.log(JSON.stringify({mint:compile(candidate.source), verify:compile(candidate.verifier),
    cleaner:compile(fs.readFileSync('simulator/cloomc/mint_cleaner.cloomc','utf8')), callers}));
