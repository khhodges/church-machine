'use strict';
const assert = require('node:assert/strict');
const Compiler = require('./cloomc_compiler');
const body = [
    '    // source evidence: braces { } in comments are not syntax',
    '    CALL CR6[ide.Mint], #0 ; mandatory method dispatch',
    '',
    '    RETURN ; preserve this too',
].join('\n');
const source = `abstraction test.MintCaller {
capabilities { SELF E, ide.Mint E }
method Run {
${body}
}
}`;
for (const uploads of [[], [{name: 'ide.Mint', rights: ['E']} ]]) {
    const result = new Compiler().compile(source, uploads);
    assert.deepEqual(result.errors, []);
    assert.ok(result.methods[0].sourceLines.includes(body), 'exact comments and blank lines');
    assert.deepEqual(result.capabilities.map(c => c.name), ['SELF', 'ide.Mint']);
    const call = result.methods[0].code[0] >>> 0;
    assert.equal(call >>> 27, 2);
    assert.equal((call >>> 18) & 1, 1, 'indexed mode, not a fabricated CR1 call');
    assert.equal(call & 31, 1, 'local Mint row');
    assert.equal((call >>> 5) & 127, 1, 'public method zero -> wire one');
}
const retired = new Compiler().compile(source.replace('CALL CR6[ide.Mint], #0', 'ELOADCALL CR1, CR6, #1'), []);
assert.ok(retired.errors.length, 'retired instruction cannot compile');
console.log('PASS focused Mint compiler baseline: exact source, local row, selector, retired rejection');
