'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
global.ChurchAssembler = require('./assembler');
const Compiler = require('./cloomc_compiler');
const {fixture} = require('../tests/simulator/cr6_contract_fixture');
const asm = new ChurchAssembler();
const word = asm.assemble('LOAD CR1, NULL').words[0];
assert.equal(word, 0x07084000);
assert.match(asm.disassemble(word), /CR1, NULL/);
assert.equal(asm.assemble('LOAD CR1, CR6, #0').words[0] & 0x7fff, 0);
assert.equal(asm.assemble('LOAD CR1, CR6, #-0').words[0] & 0x7fff, 0);
for (const target of [6, 12, 13, 14, 15]) {
    assert(asm.assemble(`LOAD CR${target}, NULL`).errors.length);
}
const compiled = new Compiler().compile(`abstraction test.Null {
capabilities { SELF E }
method Run() { LOAD CR1, NULL }
}`, []);
assert.deepEqual(compiled.errors, []);
assert.equal(compiled.capabilities.length, 1, 'no NULL C-list row');
for (const dst of [0,1,2,3,4,5,7,8,9,10,11]) {
    const {sim, compile, activate} = fixture(true);
    const domain = compile(30, `LOAD CR${dst}, NULL\nIADD DR1, DR0, #17\nHALT`);
    activate(domain);
    sim.pc = 1; // fixture routing prefix precedes the method body
    sim.cr[dst] = {word0: domain.gt, word1: 33, word2: 44, word3: 55, m: 1};
    const home = sim._activeThreadBase() + sim._threadLayoutAtBase(sim._activeThreadBase()).capsStart + dst;
    sim.memory[home] = domain.gt;
    const beforeFlags = {...sim.flags};
    sim.step();
    assert.deepEqual(sim.cr[dst], {word0:0, word1:0, word2:0, word3:0, m:0});
    assert.equal(sim.memory[home], 0, 'saved home cannot resurrect old GT');
    assert.deepEqual(sim.flags, beforeFlags);
    sim.step();
    assert.equal(sim.dr[1], 17);
}
{
    const {sim, compile, activate} = fixture(true);
    activate(compile(30, 'LOADEQ CR1, NULL\nHALT'));
    sim.pc = 1;
    sim.flags.Z = false;
    sim.cr[1] = {word0: 123, word1: 2, word2: 3, word3: 4, m: 1};
    sim.step();
    assert.equal(sim.cr[1].word0, 123, 'false condition has no clear side effect');
}
console.log('PASS: direct NULL encoding, compiler, C-list cost, native fetch, cache/home/M clearing and condition skip');
