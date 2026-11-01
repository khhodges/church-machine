'use strict';
// Software execution of the candidate's descriptor block, not full CREATE/RTL.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {prepare, adapt, sha} = require('../scripts/prepare_mint_word_candidate');
const {fixture} = require('../tests/simulator/cr6_contract_fixture');
const primaryPath = 'server/lumps/ide.Mint.1.a3b3dfad.lump';
const before = sha(fs.readFileSync(primaryPath));
const r = prepare();
assert.equal(before, r.receipt.originalBinarySha256);
assert.throws(() => adapt(r.saved.source + '\n'), /hash mismatch/);
assert.equal(r.candidate.api.passkey, 1);
const prefix = 'create_descriptor_prepare:', suffix = 'create_data_set_slot:';
const block = source => source.slice(source.indexOf(prefix), source.indexOf(suffix));
assert.equal(r.source.replace(block(r.source), ''), r.saved.source.replace(block(r.saved.source), ''),
    'all source outside descriptor block unchanged, including ignored passkey');
assert(!/LOAD\s+\w+,\s*CR6,\s*#[47]\b/.test(r.source), 'no verifier/approval load');
assert(r.source.includes('Phase 1: PassKey input is ignored'));
assert(r.candidate.words.slice(-8).every(w => w === 0), 'unbound C-list');
const fault = r.source.match(/TODO_CREATE_DESCRIPTOR_INPUT_INVALID:\s*\n\s*(HARDFAULT "[^"]+")/);
assert(fault);
const program = block(r.source) + '\ncreate_data_descriptor_ready:\n HALT\n' +
    'TODO_CREATE_DESCRIPTOR_INPUT_INVALID:\n ' + fault[1] + '\n';
const rol = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;
function run(base, size, seq = 0, fresh = 1) {
    const {sim, compile, activate} = fixture(true);
    activate(compile(30, program));
    sim.pc = 1;
    Object.assign(sim.dr, {1: 0, 2: seq, 3: fresh, 6: size, 7: 32, 8: base});
    const caps = JSON.stringify(sim.cr), memory = sim.memory.slice(), heap = sim.dr[5];
    let failed = false;
    sim.fault = () => { failed = true; sim.halted = true; };
    for (let budget = 1500; budget && !sim.halted; budget--) sim.step();
    assert(sim.halted, 'bounded execution');
    assert.equal(JSON.stringify(sim.cr), caps);
    assert.equal(sim.dr[5], heap);
    assert.equal(sim.dr[1], 0, 'descriptor readiness is not CREATE completion');
    const homes = sim._activeThreadBase() + 1;
    for (let i = 0; i < memory.length; i++)
        if (i < homes || i >= homes + 16) assert.equal(sim.memory[i], memory[i], `write at ${i}`);
    return {sim, failed};
}
const valid = [[0x4000, 8, 0, 1], [0x8000, 8, 1, 0], [0xffe0, 8, 509, 0],
    [0xfffc, 1, 256, 0], [0, 16384, 0, 1], [4, 1, 0, 1]];
for (const input of valid) {
    const {sim, failed} = run(...input);
    assert(!failed);
    const base = input[0] >>> 2, version = input[3] ? 0 : input[2] + 1;
    const w1 = ((version << 21) | (input[1] - 1)) >>> 0;
    const seal = (rol(base, 7) ^ rol(w1 & 0x3fffffff, 13) ^ 0xdeadbeef) >>> 0;
    assert.deepEqual(Array.from(sim.dr.slice(8, 12)),
        [base, w1, seal, ((89 << 25) | (version << 16) | 32) >>> 0]);
    assert.equal(sim.dr[12], 1);
    assert.equal(base * 4, input[0]);
}
const invalid = [[0x4001, 8], [0xffe4, 8], [0x10000, 1], [0x40000000, 1],
    [0xfffffffc, 1], [0, 16385], [0, 0], [0x4000, 8, 512, 0], [0x4000, 8, 1, 1]];
for (const input of invalid) {
    const {sim, failed} = run(...input);
    assert(failed);
    assert.notEqual(sim.dr[12], 1);
    assert.equal(sim.dr[8], input[0] >>> 0, 'no conversion on rejection');
}
for (const seq of [510, 511]) {
    const {sim, failed} = run(0x4000, 8, seq, 0);
    assert(!failed);
    assert.equal(sim.dr[12], 0);
    assert.equal(sim.dr[8], 0x4000, 'no conversion on retirement');
}
assert.equal(sha(fs.readFileSync(primaryPath)), before);
console.log('PASS: exact saved baseline, unchanged API/passkey, unbound candidate; 6 valid, 9 rejection, 2 retirement descriptor cases. No full CREATE or RTL claim.');
