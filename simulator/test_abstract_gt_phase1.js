'use strict';

// Real compiled CLOOMC, ordinary CALL/RETURN and ordinary memory access.
// Provisioning touches only a disposable simulator's RAM; no live artifacts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture } = require('../tests/simulator/cr6_contract_fixture');
const Compiler = require('./cloomc_compiler');
const { assembleLump } = require('./lump_assembler');
const api = require('./abstract_gt_phase1');

const compiled = new Compiler().compile(api.source(), []);
assert.deepEqual(compiled.errors, []);
assert.deepEqual(compiled.methods.map(m => m.name), ['Constant', 'NewProof']);
const lump = assembleLump(compiled.methods.map(m => m.code));
assert.deepEqual(lump.errors || [], []);
// RAM-only fixture has no signed diagnostic sidecar. Assert the actual
// HARDFAULT instruction site instead of relying on its generic runtime text.
const faultSites = new Map();
let methodOffset = compiled.methods.length;
for (const method of compiled.methods) {
    const assembler = new global.ChurchAssembler();
    const body = method.sourceLines.replace(/^method[^{]+\{/, '').replace(/\}\s*$/, '');
    assembler.assemble(body);
    assert.deepEqual(assembler.errors, []);
    for (const [, label] of body.matchAll(/^(\w+):\s*\n\s*HARDFAULT/gm)) {
        faultSites.set(methodOffset + assembler.labels[label], label);
    }
    methodOffset += method.code.length;
}
function expectFault(result, site) {
    assert(result.fault, `Expected fault at ${site}`);
    assert.equal(result.faultSite, site, JSON.stringify(result.fault));
}
const approved = fs.readFileSync(path.join(__dirname,
    '../docs/reviews/mint-phase1/abstract-constants.md'), 'utf8');
assert.deepEqual([...approved.matchAll(/^\| \d+ \| ([A-Z0-9_]+) \|/gm)]
    .map(m => m[1]), api.NAMES);
assert.equal(new Set(api.NAMES).size, 100);
assert.throws(() => api.encodeName(''), RangeError);
assert.throws(() => api.encodeName('A'.repeat(32)), RangeError);
assert.throws(() => api.encodeName('a b'), RangeError);
assert.throws(() => api.stateImage(0), RangeError);
assert.throws(() => api.packAbstract(2, 0), RangeError);
const secure = api.randomImage(16);
assert.equal(secure.length, 18);
assert.equal(secure[1], 16);

function setup(randomWords = [1, 2, 3], capacity = 4) {
    const f = fixture(true);
    const s = f.sim;
    const STATE = 0x2400, RANDOM = 0x2500, NAME = 0x2540, CATALOGUE = 0x2800;
    function data(slot, base, words, size, rights) {
        s.memory.fill(0, base, base + size);
        s.memory.set(words, base);
        s.memory[base] = s.packLumpHeader(Math.log2(size) - 6, 0, 0, 0);
        s.withNamespaceWrite('TEST ONLY AbstractGTManager private inputs', () =>
            s.writeNSEntry(slot, base, size - 1, 0, 0, 1, 0, 0, 0));
        return s.createGT(0, slot, rights, 1);
    }
    const state = data(43, STATE, api.stateImage(capacity), 256, {R: 1, W: 1});
    const catalogue = data(44, CATALOGUE, api.catalogueImage(), 4096, {R: 1});
    s.withNamespaceWrite('TEST ONLY private one-word scratch L view', () =>
        s.writeNSEntry(45, STATE + 4, 0, 0, 0, 1, 0, 0, 0));
    const scratch = s.createGT(0, 45, {L: 1}, 1);
    const random = data(46, RANDOM, Uint32Array.from([0, randomWords.length, ...randomWords]),
        64, {R: 1});
    const name = data(47, NAME, api.encodeName('PI'), 64, {R: 1});
    const manager = f.install(32, lump.buf.slice(1), [state, catalogue, scratch, random]);
    const callers = [0, 1].map((selector, i) => f.compile(30 + i, `
        LOAD CR2, CR6, #1
        LOAD CR0, CR6, #2
        CALL CR0, #${selector}
        HALT
    `, [name, manager.gt]));
    let fault;
    s.fault = (type, message) => { fault = {type, message}; s.halted = true; };
    function invoke(method, text) {
        const words = typeof text === 'string' ? api.encodeName(text) : text;
        s.memory.fill(0, NAME + 1, NAME + 64);
        s.memory.set(words.slice(1), NAME + 1);
        fault = null;
        s.halted = false;
        f.activate(callers[method]);
        let budget = 50000;
        while (!s.halted && budget-- > 0) s.step();
        assert(s.halted, 'bounded real instruction execution');
        return {fault, faultSite: fault && faultSites.get(s.pc),
            gt: s.cr[1].word0 >>> 0, status: s.dr[1]};
    }
    return {s, invoke, STATE, RANDOM, NAME, CATALOGUE, manager};
}

const constants = setup();
for (const [i, name] of api.NAMES.entries()) {
    const result = constants.invoke(0, name);
    assert.equal(result.fault, null, `${name}: ${JSON.stringify(result.fault)}`);
    assert.equal(result.status, 1);
    assert.equal(result.gt, api.packAbstract(0, i + 1));
    assert.equal(constants.s.memory[constants.STATE + 4], 0, 'scratch erased');
    for (const reg of [0, 2, 3, 4, 7, 8, 9, 10, 11]) {
        assert.equal(constants.s.cr[reg].word0, 0, `private CR${reg} erased on RETURN`);
    }
    for (const reg of [2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
        assert.equal(constants.s.dr[reg], 0, `working DR${reg} erased`);
    }
}
assert.equal(constants.invoke(0, 'PHI').gt, constants.invoke(0, 'GOLDEN_RATIO').gt);
expectFault(constants.invoke(0, 'UNKNOWN'), 'constant_unknown');
expectFault(setup().invoke(0, [0, 0]), 'constant_bad_name');

// Restart fixtures after hard faults. A hard fault is not a retry mechanism.
const proofs = setup([0xffffffff, 0xffffffff, 0x12345678, 0], 3);
let result = proofs.invoke(1, 'Mint');
assert.equal(result.fault, null, JSON.stringify(result.fault));
assert.equal(result.status, 1);
assert.equal(result.gt, api.packAbstract(1, 0x7ffffff));
assert.equal(result.gt >>> 31, 0, 'B=0');
assert.equal((result.gt >>> 29) & 3, 1, 'proof subtype');
assert.equal((result.gt >>> 25) & 3, 3, 'Abstract outer type');
assert.equal(proofs.s.memory[proofs.STATE + 1], 1);
assert.equal(proofs.s.memory[proofs.STATE + 3], 1);
result = proofs.invoke(1, 'Other');
assert.equal(result.fault, null, JSON.stringify(result.fault));
assert.equal(result.gt, api.packAbstract(1, 0x2345678));
assert.equal(proofs.s.memory[proofs.STATE + 3], 3, 'collision consumes another random word');
result = proofs.invoke(1, 'Third');
assert.equal(result.fault, null);
assert.equal(result.gt, api.packAbstract(1, 0), 'zero payload is a valid non-NULL Abstract GT');
const beforeDuplicate = Array.from(proofs.s.memory.slice(proofs.STATE, proofs.STATE + 256));
result = proofs.invoke(1, 'Mint');
expectFault(result, 'proof_duplicate');
assert.deepEqual(Array.from(proofs.s.memory.slice(proofs.STATE, proofs.STATE + 256)), beforeDuplicate);

const full = setup([1, 2], 1);
assert.equal(full.invoke(1, 'Mint').fault, null);
expectFault(full.invoke(1, 'Second'), 'proof_full');
assert.equal(full.s.memory[full.STATE + 3], 1);

const exhausted = setup([], 2);
expectFault(exhausted.invoke(1, 'Mint'), 'proof_no_random');
assert.equal(exhausted.s.memory[exhausted.STATE + 1], 0);
const collisionExhaustion = setup([12, 12], 2);
assert.equal(collisionExhaustion.invoke(1, 'Mint').fault, null);
expectFault(collisionExhaustion.invoke(1, 'Other'), 'proof_no_random');
assert.equal(collisionExhaustion.s.memory[collisionExhaustion.STATE + 1], 1);
assert.equal(collisionExhaustion.s.memory[collisionExhaustion.STATE + 3], 2);
const malformed = setup();
expectFault(malformed.invoke(1, [0, 1, 32]), 'proof_bad_name');
assert.equal(malformed.s.memory[malformed.STATE + 3], 0);
const corrupt = setup();
corrupt.s.memory[corrupt.STATE + 1] = 99;
expectFault(corrupt.invoke(1, 'Mint'), 'proof_bad_state');
const names = setup([1, 2, 3, 4]);
for (const name of ['Mint', 'mint', 'Mints', 'A'.repeat(31)]) {
    assert.equal(names.invoke(1, name).fault, null, 'full case-sensitive name comparison');
}
const badCatalogue = setup();
badCatalogue.s.memory[badCatalogue.CATALOGUE + 1] = 0;
expectFault(badCatalogue.invoke(0, 'PI'), 'constant_bad_catalogue');
const wrongSubtype = setup();
wrongSubtype.s.memory[wrongSubtype.CATALOGUE + 3] = api.packAbstract(1, 1);
expectFault(wrongSubtype.invoke(0, 'ZERO'), 'constant_bad_catalogue');
const badCursor = setup();
badCursor.s.memory[badCursor.STATE + 3] = 100;
expectFault(badCursor.invoke(1, 'Mint'), 'proof_bad_state');
// Removing the manager's supplied executable invalidates the ordinary CALL.
// No host dispatcher or entry bypass is available to complete the request.
const noAuthority = setup();
noAuthority.s.memory[noAuthority.manager.base] = 0;
assert(noAuthority.invoke(1, 'Mint').fault);
assert.equal(noAuthority.s.memory[noAuthority.STATE + 1], 0);
console.log('AbstractGTManager: 100 constants, alias, native proof creation, collision retry, duplicate/full/exhausted/malformed rejection passed.');
