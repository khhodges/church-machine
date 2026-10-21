'use strict';
// Exact private CLOOMC package, executed as instructions in disposable RAM.
// No allocator/Namespace provisioning or descriptor writes are simulated here.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
const {fixture} = require('../tests/simulator/cr6_contract_fixture');
const text = fs.readFileSync(`${__dirname}/cloomc/mint.cloomc`, 'utf8');
const block = text.split('; BEGIN NATIVE SLOT PACKAGE')[1]
    .split('; END NATIVE SLOT PACKAGE')[0];
const body = block.slice(block.indexOf('create_descriptor_prepare:'))
    .replace(/^\s*;.*$/gm, '');
const failure = text.match(/^TODO_CREATE_DESCRIPTOR_INPUT_INVALID:\n\s*(HARDFAULT "[^"]+")/m)[1];
const code = `${body}
create_data_descriptor_ready:
    HALT
TODO_CREATE_DESCRIPTOR_INPUT_INVALID:
    ${failure}
`;
const cases = [
    [0, 1, 2, 0, 1], [0x8000, 64, 15, 0, 0],
    [0xfffffffc, 1, 65535, 509, 0], [0x1000, 2097152, 2, 1, 0],
    [0x80000000, 512, 300, 256, 0],
    [0x2000, 64, 10, 510, 0], [0x2000, 64, 10, 511, 0],
    [0x2000, 64, 10, 511, 1],
];
let seed = 123456789;
for (let i = 0; i < 24; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    cases.push([seed & 0x7fffff00, 1 << (i % 21), 2 + i, seed % 510, 0]);
}
const expected = cases.map(([base, size, slot, seq, fresh]) => {
    const next = fresh ? 0 : seq + 1;
    return {base: base >>> 0, w1: (((size - 1) | (next << 21)) >>> 0), slot, next};
});
// Independent, canonical FPGA reference functions, not a duplicate JS formula.
const reference = spawnSync('python3', ['-c', `
import json, sys
from hardware.integrity32 import integrity32
from hardware.hw_types import make_gt, GT_TYPE_INFORM, PERM_MASK_R, PERM_MASK_W
print(json.dumps([{
    "w2": integrity32(v["base"], v["w1"]),
    "w3": make_gt(gt_type=GT_TYPE_INFORM, perms=PERM_MASK_R | PERM_MASK_W,
                  slot_id=v["slot"], gt_seq=v["next"], b_flag=1)
} for v in json.load(sys.stdin)]))
`], {input: JSON.stringify(expected), encoding: 'utf8'});
assert.equal(reference.status, 0, reference.stderr);
const fpga = JSON.parse(reference.stdout);

function execute(input) {
    const {sim, compile, activate} = fixture(true);
    activate(compile(30, code));
    sim.pc = 1;
    const [base, size, slot, seq, fresh] = input;
    Object.assign(sim.dr, {1: 0, 2: seq, 3: fresh, 6: size, 7: slot, 8: base});
    const cr = JSON.stringify(sim.cr);
    const heap = sim.dr[5], memory = sim.memory.slice(), depth = sim.callStack.length;
    let fault = null;
    sim.fault = (type, message) => { fault = {type, message}; sim.halted = true; };
    for (let budget = 1500; budget && !sim.halted; budget--) sim.step();
    assert(sim.halted, 'bounded termination');
    assert.equal(JSON.stringify(sim.cr), cr, 'no capability changes');
    // Register instructions maintain their architectural Thread DR homes.
    // No other memory (including all Namespace words) may change.
    const home = sim._activeThreadBase() + 1;
    for (let i = 0; i < memory.length; i++) {
        if (i >= home && i < home + 16) continue;
        assert.equal(sim.memory[i], memory[i], `unexpected memory write at ${i}`);
    }
    assert.equal(sim.callStack.length, depth, 'same context, no frame consumed');
    assert.equal(sim.dr[5], heap);
    assert.equal(sim.dr[6], size >>> 0);
    assert.equal(sim.dr[7], slot >>> 0);
    assert.equal(sim.dr[8], base >>> 0);
    assert.equal(sim.dr[1], 0, 'descriptor readiness is not CREATE completion');
    return {sim, fault};
}
cases.forEach((input, i) => {
    const {sim, fault} = execute(input);
    assert.equal(fault, null, JSON.stringify({input, fault}));
    if (input[3] >= 510) {
        assert.equal(sim.dr[12], 0);
        assert.equal(sim.dr[4], 511);
        assert.deepEqual(Array.from(sim.dr.slice(9, 12)), [0, 0, 0]);
    } else {
        assert.equal(sim.dr[12], 1);
        assert.deepEqual(Array.from(sim.dr.slice(8, 12)),
            [expected[i].base, expected[i].w1, fpga[i].w2, fpga[i].w3]);
    }
});
for (const bad of [
    [0x2000, 0, 10, 0, 0], [0x2000, 2097153, 10, 0, 0],
    [0x2001, 64, 10, 0, 0], [0x2000, 64, 1, 0, 0],
    [0x2000, 64, 65536, 0, 0], [0x2000, 64, 10, 512, 0],
    [0x2000, 64, 10, 0, 2], [0x2000, 64, 10, 1, 1],
]) assert(execute(bad).fault, `invalid input must fault: ${bad}`);
console.log(`PASS: native Mint slot package, ${cases.length} FPGA-reference cases + 8 invalid cases; no side effects`);
