'use strict';
// Exact shared compiler/builder instruction words. No saved catalog access.
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
const create = `
    LOAD CR1, CR6, #1
    LOAD CR2, CR6, #2
    LOAD CR3, CR6, #2
    IADD DR2, DR0, #12
    IADD DR3, DR0, #3
    CALL CR1, #0`;
const destroy = `
    LOAD CR1, CR6, #1
    LOAD CR2, CR6, #2
    LOAD CR3, CR6, #2
    LOAD CR7, CR6, #3
    LOAD CR7, CR7, #0
    IADD DR2, DR0, #39
    CALL CR1, #1`;
const writeRead = `
    IADD DR4, DR0, #123
    DWRITE DR4, CR1, #0, DR0
    DREAD DR6, CR1, #0, DR0`;
const staleRead = `
    LOAD CR7, CR6, #3
    LOAD CR7, CR7, #0
    DREAD DR6, CR7, #0, DR0`;
// Capture the actual issued token, never a pre-provisioned unissued C-list GT.
const capture = `
    LOAD CR9, CR6, #5
    DREAD DR4, CR9, #159, DR0
    LOAD CR9, CR6, #4
    DWRITE DR4, CR9, #0, DR0`;
const callers = {};
for (const [name, body] of Object.entries({
    reuse: create + capture + writeRead + destroy + create + writeRead,
    staleReleased: create + capture + writeRead + destroy + staleRead,
    staleReused: create + capture + writeRead + destroy + create + staleRead,
    readOnlyWrite: create + capture + `
        IADD DR8, DR0, #1
        BFINS DR4, DR8, #28, #3
        DWRITE DR4, CR9, #0, DR0
        LOAD CR1, CR6, #3
        LOAD CR1, CR1, #0` + writeRead,
})) {
    const caller = compile(`abstraction test.Lifecycle {
        capabilities { SELF E }
        method Run { ${body}
            HALT
        }
    }`);
    // Bootstrap selector zero enters word one directly, not a method table.
    // Caller has no branches; only the disposable harness omits its table.
    // Service dispatch tables and all service instructions remain unchanged.
    callers[name] = [caller[0], ...caller.slice(2)];
}
console.log(JSON.stringify({
    mint: file('mint'), cleaner: file('mint_cleaner'),
    verify: file('pkverify'), callers,
}));
