'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {fixture} = require('../tests/simulator/cr6_contract_fixture');
const Compiler = require('./cloomc_compiler');
const {assembleLump} = require('./lump_assembler');
const source = fs.readFileSync(`${__dirname}/cloomc/pkverify.cloomc`, 'utf8');
const result = new Compiler().compile(source, []);
assert.deepEqual(result.errors, []);
assert.equal(result.methods.length, 1);
assert.equal(result.methods[0].name, 'Verify');
const binary = assembleLump(result.methods.map(m => m.code));
assert.deepEqual(binary.errors || [], []);
for (const credential of [0, 0xffffffff, 0x12345678]) {
    const {sim, install, compile, activate} = fixture(true);
    const verifier = install(32, binary.buf.slice(1));
    const caller = compile(30,
        'LOAD CR1, CR6, #1\nCALL CR1, #0\nHALT', [verifier.gt]);
    activate(caller);
    sim.pc = 1;
    // Deliberately invalid/NULL credentials and inaccessible proofs: the
    // Phase 1 service must not try to validate or dereference either.
    sim.cr[2] = {word0: credential >>> 0, word1: 0, word2: 0, word3: 0, m: 0};
    sim.cr[3] = {word0: credential >>> 0, word1: 0xffffff00, word2: 0, word3: 0, m: 0};
    sim.dr[6] = 512;
    const depth = sim.callStack.length;
    let called = false, returned = false;
    for (let step = 0; step < 30 && !sim.halted; step++) {
        const event = sim.step();
        assert(event);
        if (!event.instr) continue; // HALT has no decoded instruction.
        if (event.instr.opcode === 2) called = true;
        if (event.instr.opcode === 3) {
            returned = true;
            assert.equal(sim.dr[1], 1, 'APPROVED');
            assert.equal(sim.dr[6], 512, 'allocation size preserved');
            assert.equal(sim.cr[2].word0 >>> 0, credential >>> 0);
            assert.equal(sim.cr[3].word0 >>> 0, credential >>> 0);
            assert.equal(sim.cr[14].word1, caller.base);
            assert.equal(sim.callStack.length, depth);
        }
    }
    assert(called && returned && sim.halted, 'ordinary call, return and caller continuation');
}
console.log('PASS: Phase 1 PkVerify always APPROVED through native CALL/RETURN');
