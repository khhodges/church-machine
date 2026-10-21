'use strict';
// Exact saved words are supplied by the server integration test. Provisioning
// is private fixture state; execution uses ordinary fetch/CALL/fault handling.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {Sim, fixture} = require('./cr6_contract_fixture');
const {words, digest} = JSON.parse(fs.readFileSync(0, 'utf8'));
const {sim, install, compile, activate} = fixture(true);
const cw = (words[0] >>> 10) & 8191;
const callee = install(31, words.slice(1, cw + 1));
sim.memory.set(words, callee.base);
sim._slotIdentity.set(31, {binaryHash: digest, secure: true});
const caller = compile(30, 'LOAD CR1, CR6, #1\nCALL CR1, #0\nIADD DR1, DR0, #77\nHALT',
    [callee.gt]);
activate(caller);
sim.fault = Sim.prototype.fault;
sim.dr[1] = 0;
let calls = 0;
for (let steps = 0; steps < 50 && !sim.halted; steps++) {
    const retired = sim.step();
    if (retired && retired.instr.opcode === 2) calls++;
}
assert.equal(calls, 1);
const fault = sim.faultLog.at(-1);
assert.equal(fault.type, 'INVALID_OP', JSON.stringify(fault));
assert.equal(fault.faultRawWord, 0xf7000000);
assert.equal(sim.dr[1], 0, 'neither following instruction nor caller continuation executes');
assert.deepEqual(fault.faultCodeWords, words.slice(0, cw + 1));
const offset = fault.physicalPC - callee.base;
process.stdout.write(JSON.stringify({offset, code: fault.faultCodeWords, raw: fault.faultRawWord}));
