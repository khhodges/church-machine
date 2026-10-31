'use strict';
const assert = require('node:assert/strict');
const {build} = require('../scripts/build_mint_v4_candidate');
const contract = require('./lump-api-contract');
const codec = require('./lump-api-codec');
const {buildApiDefinition, buildLump} = require('./lump_builder');
const Compiler = require('./cloomc_compiler');
const candidate = build();
assert(candidate.source.includes('passkey required;'));
assert(candidate.source.includes('verification deferred to the Phase 2 bitstream'));
assert(!candidate.source.includes('LOAD CR3, CR6, #7'));
assert(!candidate.source.includes('CALL CR4, #0'));
assert(candidate.phase2Source.includes('CALL CR4, #0'));
const header = {cw:(candidate.words[0] >>> 10) & 8191, cc:candidate.words[0] & 255};
const serialized = contract.serialize(candidate.api, header);
assert(serialized.startsWith('{"name":"ide.Mint","passkey":1,"methods":'));
assert.deepEqual(contract.parse(serialized, header), candidate.api);
const view = codec.expand(candidate.api, candidate.words);
assert.equal(view.passkey, 1);
assert.throws(() => codec.encode(view, header), /canonical typed ABI/);
assert.deepEqual(view.methods.find(m => m.name === 'CREATE').inputs.map(p => p.register), ['DR2','DR3']);
assert.equal(view.methods.find(m => m.name === 'DESTROY').inputs[0].register, 'CR2');
assert.equal(view.methods.find(m => m.name === 'CREATE').returns.register, 'CR1');
assert.equal(view.capabilities.length, 8);
assert.equal(view.capabilities[4].name, 'ide.MintV4Verifier',
    'new ABI must not bind to the existing CR2-proof verifier by name');
assert.deepEqual(view.capabilities[7].rights, ['L','S']);
for (const mutate of [
    a => {a.passkey = 0;},
    a => {delete a.passkey;},
    a => {a.methods.CREATE[0] = 127;},
    a => {a.methods.DESTROY[0] = 0;},
    a => {a.methods.CREATE[2] = [2,'RL'];},
    a => {a.methods.DESTROY[1].push(['second',2,'RW']);},
    a => {a.methods.CREATE[1].push(['allocation',1]);},
    a => {a.methods.CREATE[2] = [5,'RW',[3,2]];},
    a => {delete a.imports;},
]) {
    const bad = structuredClone(candidate.api); mutate(bad);
    assert.throws(() => contract.validate(bad, header));
}
const words = candidate.words.slice(); words[1] = 0;
assert.throws(() => codec.expand(candidate.api, words), /method-table/);
const verifier = new Compiler().compile(candidate.verifier, []);
assert.deepEqual(verifier.errors, []);
assert.doesNotThrow(() => buildApiDefinition(verifier, buildLump(verifier).words));
console.log('PASS Mint v4 typed imports, native compilation, exact ABI round-trip, registers, LS rights, malformed APIs, method table and verifier compile');
