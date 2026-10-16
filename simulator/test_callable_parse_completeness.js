'use strict';
const assert = require('assert');
global.ChurchAssembler = require('./assembler');
const Compiler = require('./cloomc_compiler');
const good = `abstraction ide.Alice {
capabilities { SELF E }
method stash() {
IADD DR1, DR0, #999
DWRITE DR1, CR5, #9
RETURN }
method reveal() {
DREAD DR1, CR5, #9
RETURN }
}`;
for (const [name, source] of Object.entries({
    malformed: good.replace('reveal() {', 'reveal() ('),
    unclosed: good.slice(0, -1),
    trailing: good + '\nGARBAGE',
    data: good.replace(/\}$/, 'WORD 0 }'),
    duplicate: good.replace('reveal()', 'stash()'),
    prefix: 'GARBAGE\n' + good,
    missingMethodBrace: good.replace('RETURN }\n}', 'RETURN\n'),
})) {
    const result = new Compiler().compile(source, []);
    assert(result.errors.length, `${name} must fail, not issue a partial candidate`);
}
for (const source of [good, good.replace('IADD DR1', '; comment } { (\n// another }\n/* block } */\nIADD DR1'),
        good.replace('#999', '#999 ; comment } {')]) {
    const result = new Compiler().compile(source, []);
    assert.deepStrictEqual(result.errors, []);
    assert.deepStrictEqual(result.methods.map(m => [m.name, m.code.length]), [['stash', 3], ['reveal', 2]]);
}
console.log('PASS callable parse completeness and comment delimiter safety');
