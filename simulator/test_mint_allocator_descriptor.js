'use strict';
// Only disposable RAM provisioning. Execute the real contiguous allocator,
// package and continuation; never replace instructions or manufacture outputs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {fixture} = require('../tests/simulator/cr6_contract_fixture');
const text = fs.readFileSync(`${__dirname}/cloomc/mint.cloomc`, 'utf8');
const body = text.slice(text.indexOf('create_data_allocate:'),
    text.indexOf('create_data_set_slot:'));
const failures = [...new Set([...body.matchAll(/\bTODO_CREATE_\w+/g)].map(m => m[0]))];
const code = body + '\ncreate_data_set_slot:\nHALT\n' + failures.map(name => {
    const match = text.match(new RegExp(`^${name}:\\n\\s*(HARDFAULT "[^"]+")`, 'm'));
    assert(match, `real failure label ${name}`);
    return `${name}:\n${match[1]}`;
}).join('\n');
const STATE = 0x3000, POOL = 0x3100, SLOT = 39, HISTORY = 16;
function setup({seq = 0, fresh = 1, size = 8, mutate = () => {}} = {}) {
    const {sim, compile, activate} = fixture(true);
    const gt = (slot, rights) => sim.createGT(0, slot,
        Object.fromEntries([...rights].map(p => [p, 1])), 1);
    sim.withNamespaceWrite('disposable native allocator fixture', () => {
        sim.writeNSEntry(43, STATE, 127, 0, 0, 1, 0, 0, 0);
        sim.writeNSEntry(44, POOL, 63, 0, 0, 1, 0, 0, 0);
    });
    sim.memory.set([0, 8, 64, 7, 9, POOL * 4, HISTORY, SLOT, SLOT], STATE);
    sim.memory[STATE + HISTORY + SLOT] = seq | (fresh << 9);
    sim.memory.fill(0xdeadbeef, POOL, POOL + 64);
    activate(compile(30, code, [gt(43, 'RW'), gt(43, 'L'), gt(44, 'RW')]));
    sim.pc = 1;
    sim.dr[6] = size;
    sim.dr[5] = 123456;
    // Deliberately hostile caller scratch: native loads must replace it.
    sim.dr[2] = 511; sim.dr[3] = 1; sim.dr[8] = 0xfffffffc;
    sim.cr[1] = {word0: 0, word1: 0, word2: 0, word3: 0, m: 0};
    mutate(sim);
    return sim;
}
function run(sim) {
    let steps = 0;
    while (!sim.halted && steps++ < 2000) sim.step();
    assert(sim.halted && steps < 2000, 'bounded native termination');
    assert.equal(sim.dr[1], 0, 'not CREATE completion');
    assert.equal(sim.cr[1].word0, 0, 'no issued authority');
    assert.equal(sim.dr[5], 123456);
}
for (const [seq, fresh, next] of [[0, 1, 0], [0, 0, 1], [509, 0, 510]]) {
    const sim = setup({seq, fresh});
    run(sim);
    const w0 = (POOL + 8) * 4, w1 = (next << 21) | 7;
    assert.deepEqual(Array.from(sim.dr.slice(8, 12)), [
        w0, w1, sim._integrity32(w0, w1) >>> 0,
        (0xb2000000 | (next << 16) | SLOT) >>> 0,
    ]);
    assert.equal(sim.memory[STATE + HISTORY + SLOT], next | 1024);
    assert.equal(sim.memory[STATE + 1], 16);
    assert.equal(sim.memory[STATE + 3], 8);
    assert.deepEqual(Array.from(sim.memory.slice(POOL + 8, POOL + 16)), Array(8).fill(0));
    assert.equal(sim.memory[POOL + 7], 0xdeadbeef);
    assert.equal(sim.memory[POOL + 16], 0xdeadbeef);
    const descriptor = Array.from(sim.memory.slice(sim.NS_TABLE_BASE + SLOT * 4,
        sim.NS_TABLE_BASE + SLOT * 4 + 4));
    assert.deepEqual(descriptor, [0, 0, 0, 0], 'publication remains blocked');
    // Queue contains a duplicate: replay must not allocate the reserved slot.
    sim.pc = 1; sim.halted = false;
    let fault;
    sim.fault = (type, message) => { fault = {type, message}; sim.halted = true; };
    run(sim);
    assert(fault);
    assert.equal(sim.memory[STATE + 1], 16);
    assert.equal(sim.memory[STATE + 3], 8);
}
for (const seq of [510, 511]) {
    const sim = setup({seq, fresh: 0});
    let fault;
    sim.fault = (type, message) => { fault = {type, message}; sim.halted = true; };
    for (let retry = 0; retry < 2; retry++) {
        sim.pc = 1; sim.halted = false; fault = null;
        run(sim);
        assert(fault, 'retirement must hard fault');
        assert.equal(sim.dr[4], 511);
        assert.equal(sim.dr[12], 0);
        assert.deepEqual(Array.from(sim.dr.slice(9, 12)), [0, 0, 0]);
        assert.equal(sim.memory[STATE + HISTORY + SLOT], 511);
        assert.equal(sim.memory[STATE + 1], 8);
        assert.equal(sim.memory[STATE + 3], 7);
        assert(sim.memory.slice(POOL, POOL + 64).every(w => w === 0xdeadbeef));
    }
}
const invalid = [
    {size: 0}, {size: 2097153}, {seq: 1, fresh: 1},
    {mutate: s => { s.memory[STATE + 1] = 65; }},
    {mutate: s => { s.memory[STATE + 1] = 60; }},
    {mutate: s => { s.memory[STATE + 3] = 9; }},
    {mutate: s => { s.memory[STATE + 3] = 6; }},
    {mutate: s => { s.memory[STATE + 6] = 8; }},
    {mutate: s => { s.memory[STATE + 7] = 65536; }},
    {mutate: s => { s.memory[STATE + 7] = 1; }},
    {mutate: s => { s.memory[STATE + 5] = 3; }},
    {mutate: s => { s.memory[STATE + 5] = 0xfffffff0; }},
    {mutate: s => { s.memory[STATE + 6] = 0xfffffff0; }},
    {mutate: s => { s.memory[STATE + HISTORY + SLOT] = 2048; }},
    {mutate: s => { s.memory[STATE + HISTORY + SLOT] = 1024; }},
    {mutate: s => { s.memory[STATE + 6] = 120; }},
    {mutate: s => { s.memory[STATE + 2] = 128; s.dr[6] = 64; }},
];
for (const scenario of invalid) {
    const sim = setup(scenario);
    const state = sim.memory.slice(STATE, STATE + 128);
    let fault;
    sim.fault = (type, message) => { fault = {type, message}; sim.halted = true; };
    run(sim);
    assert(fault, `invalid case ${invalid.indexOf(scenario)}: ${JSON.stringify(scenario)}`);
    assert.deepEqual(sim.memory.slice(STATE, STATE + 128), state);
    assert(sim.memory.slice(POOL, POOL + 64).every(w => w === 0xdeadbeef));
}
console.log('PASS: native allocator → descriptor → reservation/zeroing; trusted history, duplicate rejection, retirement retries and invalid state fail closed');
