'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {method} = require('../scripts/create_mint_v4_draft');
const Compiler = require('./cloomc_compiler');
const draft = fs.readFileSync('simulator/drafts/mint_v4_integrated.cloomc', 'utf8');
const newer = fs.readFileSync('simulator/cloomc/mint.cloomc', 'utf8');
const stubs = fs.readFileSync('tests/fixtures/mint_stub.cloomc', 'utf8');
const body = text => text.slice(text.indexOf('{')).replace(/;\s*PROPOSED CONVERSION STUBS:[\s\S]*$/, '').trim();
assert(body(method(draft, 'DESTROY', 'MakeOutform')).startsWith(body(method(newer, 'DESTROY', 'MakeOutform'))));
for (const [name, next] of [['MakeOutform','MakeInform'], ['MakeInform',null]]) {
    assert.equal(method(draft, name, next), method(stubs, name, next));
}
assert(draft.includes('create_data_allocate:'));
assert(draft.includes('destroy_body:'));
assert(draft.includes('passkey required;'));
assert.equal((draft.match(/^method /gm) || []).length, 4);
const result = new Compiler().compile(draft, []);
assert(result.errors.some(e => e.message.includes('Typed ABI imports are not implemented')),
    'unfinished ABI body integration must not masquerade as accepted compiled output');
console.log('PASS integrated review draft retains CREATE, newer DESTROY, both conversion stubs; compilation fails closed on typed imports');
