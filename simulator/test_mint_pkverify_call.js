'use strict';
// Isolated execution of the exact CREATE authorization block, not a complete
// Mint service. Allocation entry is a test-only stop; allocator tests cover
// the subsequent real pool/slot capacity checks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {fixture} = require('../tests/simulator/cr6_contract_fixture');
const Compiler = require('./cloomc_compiler');
const {assembleLump} = require('./lump_assembler');
const mint = fs.readFileSync(`${__dirname}/cloomc/mint.cloomc`, 'utf8');
const block = mint.match(/^create_data_authorize:\n([\s\S]*?)^create_data_allocate:/m)[1];
const rejection = mint.match(/^TODO_CREATE_PKVERIFY_NOT_APPROVED:\n\s*(HARDFAULT "[^"]+")/m)[1];
assert.match(mint, /ide\.MintPool RW, ide\.PkVerify E/);
assert.doesNotMatch(block, /EXACT|BRANCHEQ create_data_allocate/);
assert.doesNotMatch(mint, /TODO_CREATE_PKVERIFY_AND_ALLOWANCE/);
assert.doesNotMatch(mint, /TODO_CREATE_ALLOWANCE/);
assert.match(block, /BRANCH create_data_allocate/);
const verifierSource = fs.readFileSync(`${__dirname}/cloomc/pkverify.cloomc`, 'utf8');
const verified = new Compiler().compile(verifierSource, []);
assert.deepEqual(verified.errors, []);
const assembled = assembleLump(verified.methods.map(m => m.code));
assert.deepEqual(assembled.errors || [], []);

for (const approved of [true, false]) {
    const {sim, install, compile, activate} = fixture(true);
    const verifier = approved ? install(32, assembled.buf.slice(1))
        : compile(32, 'IADD DR1, DR0, #0\nRETURNAL #12');
    const caller = compile(30, `${block.replace(/^\s*;.*$/gm, '')}
create_data_allocate:
    IADD DR7, DR0, #99
    HALT
TODO_CREATE_PKVERIFY_NOT_APPROVED:
    ${rejection}
`, [0, 0, 0, verifier.gt]);
    activate(caller);
    sim.pc = 1;
    sim.dr[6] = 512;
    sim.dr[7] = 0;
    const depth = sim.callStack.length;
    let calls = 0, returns = 0, fault = null;
    sim.fault = (type, message) => { fault = {type, message}; sim.halted = true; };
    for (let budget = 40; budget && !sim.halted; budget--) {
        const event = sim.step();
        if (event?.instr?.opcode === 2) calls++;
        if (event?.instr?.opcode === 3) returns++;
    }
    assert.equal(calls, 1);
    assert.equal(returns, 1);
    assert(sim.halted);
    assert.equal(sim.callStack.length, depth);
    assert.equal(sim.cr[14].word1, caller.base);
    assert.equal(sim.dr[6], 512);
    assert.equal(sim.dr[1], 0, 'verification must not report CREATE completion');
    if (approved) {
        assert.equal(fault, null);
        assert.equal(sim.dr[7], 99, 'approved call reaches allocation');
    } else {
        assert(fault, 'non-approved response must fault');
        assert.equal(sim.dr[7], 0, 'rejected call cannot reach allocation');
    }
}
console.log('PASS: Mint CREATE calls PkVerify, resumes with DR6 intact, rejects non-approval');
