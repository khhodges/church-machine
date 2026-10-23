'use strict';
// Complete compiled Passkey, PkVerify and Mint; private simulator RAM only.
// Genesis provisioning below is fixture setup, not a new runtime service.
// No instruction interception, allocator stubs, forced continuations or writes
// to saved Namespace bindings. Authorization acceptance stops naturally at an
// exhausted allocator (CREATE) / NULL target (DESTROY); it is not evidence of
// byte-addressed CREATE lifecycle acceptance in this word-addressed simulator.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {fixture} = require('../tests/simulator/cr6_contract_fixture');
const Compiler = require('./cloomc_compiler');
const {assembleLump} = require('./lump_assembler');
const api = require('./abstract_gt_phase1');
global.window.bootConfig.step1.totalNamespaceWords = 32768;
const STATE = 0x5000, NAME = 0x4800, MINTSTATE = 0x4900;

function image(name) {
    const source = fs.readFileSync(`${__dirname}/cloomc/${name}.cloomc`, 'utf8');
    const compiled = new Compiler().compile(source, []);
    assert.deepEqual(compiled.errors, []);
    const assembled = assembleLump(compiled.methods.map(m => m.code));
    assert.deepEqual(assembled.errors || [], []);
    const labels = new Map();
    let offset = compiled.methods.length;
    for (const method of compiled.methods) {
        const assembler = new global.ChurchAssembler();
        assembler.assemble(method.sourceLines.replace(/^\s*method[^{]+\{/, '').replace(/\}\s*$/, ''));
        assert.deepEqual(assembler.errors, []);
        for (const [label, pc] of Object.entries(assembler.labels)) labels.set(label, offset + pc);
        offset += method.code.length;
    }
    return {code: assembled.buf.slice(1), labels};
}
const passkey = image('passkey'), verify = image('pkverify'), mint = image('mint');
function setup() {
    const f = fixture(true), s = f.sim;
    // These private domains have no lazy catalog names; do not inherit the
    // boot program's unrelated PetNameMemory declarations.
    s.programCapabilities = [];
    function data(slot, base, words, rights) {
        const size = Math.max(64, 2 ** Math.ceil(Math.log2(words.length)));
        s.memory.set(words, base);
        s.memory[base] = s.packLumpHeader(Math.log2(size) - 6, 0, 0, 0);
        s.withNamespaceWrite('TEST ONLY Genesis Passkey provisioning', () =>
            s.writeNSEntry(slot, base, size - 1, 0, 0, 1, 0, 0, 0));
        return s.createGT(0, slot, rights, 1);
    }
    const state = data(43, STATE, api.stateImage(2), {R: 1, W: 1});
    const name = data(44, NAME, api.encodeName('Mint'), {R: 1});
    const allocator = data(45, MINTSTATE, [0, 0, 0, 7, 7, 0, 16], {R: 1, W: 1});
    s.withNamespaceWrite('TEST ONLY Passkey private scratch view', () =>
        s.writeNSEntry(46, STATE + 4, 0, 0, 0, 1, 0, 0, 0));
    const scratch = s.createGT(0, 46, {L: 1}, 1);
    const issuer = f.install(32, passkey.code, [state, scratch]);
    const genesis = f.compile(30, `
        LOAD CR2, CR6, #1
        LOAD CR0, CR6, #2
        CALL CR0, #0
        HALT`, [name, issuer.gt]);
    let fault, trace;
    s.fault = (type, message) => { fault = {type, message, pc: s.pc, base: s.cr[14].word1}; s.halted = true; };
    function run(domain) {
        fault = null; trace = [];
        f.activate(domain); s.halted = false;
        for (let steps = 0; steps < 10000 && !s.halted; steps++) {
            trace.push({base: s.cr[14].word1, pc: s.pc});
            s.step();
        }
        assert(s.halted, `bounded unmodified simulator execution: ${JSON.stringify(trace.slice(-12))}; ${s.output.slice(-1500)}`);
        return {fault, trace};
    }
    assert.equal(run(genesis).fault, null);
    assert.equal(s.dr[1], 1);
    const approved = s.cr[1].word0 >>> 0;
    assert.equal(approved >>> 31, 0, 'issued B=0 proof');
    assert.equal((approved >>> 29) & 3, 1, 'Abstract proof');
    assert.equal(s.memory[STATE + 4], 0, 'issuance scratch erased');
    s.memory.set(api.encodeName('Other').slice(1), NAME + 1);
    assert.equal(run(genesis).fault, null);
    const other = s.cr[1].word0 >>> 0;
    assert.notEqual(other, approved, 'independently issued proof');
    const verifier = f.install(33, verify.code);
    return {f, s, run, allocator, approved, other, verifier};
}

for (const method of [0, 1]) {
    for (const variant of ['approved', 'other', 'changed-bit', 'null', 'missing-reference', 'spoofed-reference', 'target-preserved']) {
        if (variant === 'target-preserved' && method !== 1) continue;
        const {f, s, run, allocator, approved, other, verifier} = setup();
        const candidate = variant === 'null' ? 0 :
            variant === 'changed-bit' ? approved ^ 1 :
            ['other', 'spoofed-reference'].includes(variant) ? other : approved;
        const reference = variant === 'missing-reference' ? 0 : approved;
        const bindings = [allocator, 0, 0, verifier.gt, 0, 0];
        if (variant !== 'missing-reference') bindings.push(reference);
        const service = f.install(34, mint.code, bindings);
        const caller = f.compile(35, `
            LOAD CR1, CR6, #1
            ${candidate ? 'LOAD CR2, CR6, #2' : 'LOAD CR2, NULL'}
            ${candidate ? 'LOAD CR3, CR6, #3' : 'LOAD CR3, NULL'}
            LOAD CR4, NULL
            ${variant === 'target-preserved' ? 'LOAD CR7, CR6, #4' : 'LOAD CR7, NULL'}
            IADD DR2, DR0, #${variant === 'target-preserved' ? 1 : 12}
            IADD DR3, DR0, #3
            CALL CR1, #${method}
            HALT`, [service.gt, candidate, candidate, allocator]);
        const beforeState = Array.from(s.memory.slice(MINTSTATE, MINTSTATE + 64));
        const beforeProofs = Array.from(s.memory.slice(STATE, STATE + 128));
        const {fault, trace} = run(caller);
        assert(fault, `${variant}: natural rejection/exhaustion must hard fault`);
        const authorized = ['approved', 'target-preserved'].includes(variant);
        const expected = method === 0
            ? authorized ? 'TODO_CREATE_SLOTS_EXHAUSTED' :
                variant === 'null' ? 'TODO_CREATE_INPUT_CREDENTIAL_NULL' : 'TODO_CREATE_PKVERIFY_NOT_APPROVED'
            : variant === 'target-preserved' ? 'destroy_v1_bad' :
                authorized ? 'TODO_DESTROY_INPUT_TARGET_NULL' :
                variant === 'null' ? 'TODO_DESTROY_INPUT_CREDENTIAL_NULL' : 'TODO_DESTROY_PKVERIFY_NOT_APPROVED';
        assert.equal(fault.base, service.base, JSON.stringify(fault));
        if (variant === 'missing-reference') {
            assert.equal(fault.type, 'NO_CAPABILITY');
            assert.match(fault.message, /index 7 is out of bounds/);
        } else assert.equal(fault.pc, mint.labels.get(expected), `${method}/${variant}: ${JSON.stringify(fault)}`);
        assert.equal(trace.some(t => t.base === verifier.base), !['null', 'missing-reference'].includes(variant));
        if (method === 0) assert.equal(trace.some(t =>
            t.base === service.base && t.pc === mint.labels.get('create_v1_allocate')), authorized);
        assert.equal(s.dr[1], 0, 'authorization never reports operation completion');
        assert.equal(s.cr[1].word0, 0, 'no result authority on denied/incomplete operation');
        assert.deepEqual(Array.from(s.memory.slice(MINTSTATE, MINTSTATE + 64)), beforeState);
        assert.deepEqual(Array.from(s.memory.slice(STATE, STATE + 128)), beforeProofs);
    }
}
console.log('PASS: complete compiled Passkey → Genesis provisioning → Mint → EXACT PkVerify; approved and rejected CREATE/DESTROY, no protected-state writes');
