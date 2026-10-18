'use strict';

// Draft-source checks, not acceptance of a functioning Mint implementation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
global.ChurchAssembler = require('./assembler');
global.METHOD_REGISTER_CONVENTIONS = {};
global.BOOT_UPLOADS = [];
const Compiler = require('./cloomc_compiler');
const source = fs.readFileSync(path.join(__dirname,
    'cloomc/mint.cloomc'), 'utf8');
assert.match(source, /CURRENT EDITABLE SOURCE/);
assert.equal(fs.existsSync(path.join(__dirname,
    'cloomc/drafts/Mint-Phase1-API-DRAFT.cloomc')), false,
    'There must not be a competing editable Mint draft');
const methods = [...source.matchAll(/^method (\w+) \{([\s\S]*?)^\}/gm)];
assert.deepEqual(methods.map(m => m[1]),
    ['CREATE', 'DESTROY', 'MakeOutform', 'MakeInform']);

const compiled = new Compiler().compile(source, []);
assert.ok(compiled.errors.length > 0, 'Unfinished draft must not compile as runnable Mint');
assert.ok(compiled.errors.every(e => /^Undefined label: TODO_/.test(e.message)),
    JSON.stringify(compiled.errors.filter(e => !/^Undefined label: TODO_/.test(e.message))));
assert.equal(compiled.methods.length, 0, 'No partly valid method may escape as a successful draft');

for (const [, name, body] of methods) {
    assert.match(body, /TPERM CR1, CLEAR/);
    assert.match(body, /IADD DR1, DR0, #0/);
    assert.doesNotMatch(body, /IADD DR1, DR0, #1\b/, 'Wrapper must not manufacture success');
    assert.match(body, /TPERM CR2, NULL\s+BRANCHEQ TODO_RUNTIME_FAULT/);
    assert.match(body, /TPERM CR3, R\s+BRANCHNE TODO_RUNTIME_FAULT/);
    assert.match(body, /DREAD DR2, CR3, #3/);
    assert.match(body, /MCMP DR1, #1\s+BRANCHNE TODO_RUNTIME_FAULT/);
    const result = body.slice(body.indexOf(`${name === 'CREATE' ? 'create' :
        name === 'DESTROY' ? 'destroy' : name === 'MakeOutform' ? 'outform' : 'inform'}_result:`));
    assert.match(result, name === 'DESTROY'
        ? /TPERM CR1, NULL\s+BRANCHNE TODO_RUNTIME_FAULT/
        : /TPERM CR1, NULL\s+BRANCHEQ TODO_RUNTIME_FAULT/);
    assert.match(body, new RegExp(`RETURNAL #${name === 'DESTROY' ? 0 : 2}`));
    assert.doesNotMatch(body, /^\s*MINT\s/m, 'No private profile instructions');
}
const create = methods[0][2], destroy = methods[1][2];
assert.match(create, /DREAD DR2, CR4, #11/);
assert.match(create, /DREAD DR2, CR4, #10/);
assert.match(create, /MCMP DR2, #257/);
assert.match(create, /BRANCH TODO_CREATE_TYPED_INPUTS/);
assert.match(create, /BRANCH TODO_CREATE_RESULT_TYPE/);
assert.ok(destroy.indexOf('TODO_DESTROY_REJECT_RESIDENT_AND_OUTFORM') <
    destroy.indexOf('destroy_body:'));

// Verify masked-return encodings through the ordinary assembler, not a
// private post-assembly lowering. No service source is patched for tests.
for (const mask of [0, 2]) {
    const a = new global.ChurchAssembler();
    const r = a.assemble(`RETURNAL #${mask}`);
    assert.deepEqual(a.errors, []);
    assert.equal(r.words[0] & 0xfff, mask);
}
console.log('PASS: four draft APIs, native input/result guards, explicit unresolved gates, no success stub');
