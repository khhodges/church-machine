'use strict';
// Non-RTL instruction execution only. No complete CREATE or hardware claim.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {fixture} = require('../tests/simulator/cr6_contract_fixture');
const {descriptorProgram} = require('../scripts/mint_word_address_demo');
const sourcePath = path.join(__dirname, 'cloomc/mint.cloomc');
const original = fs.readFileSync(sourcePath, 'utf8');
const program = descriptorProgram(original);
const rol = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;
const seal = (base, authority) =>
    (rol(base, 7) ^ rol(authority & 0x3fffffff, 13) ^ 0xdeadbeef) >>> 0;

function execute([base, size, slot, seq, fresh]) {
    const {sim, compile, activate} = fixture(true);
    activate(compile(30, program));
    sim.pc = 1;
    Object.assign(sim.dr, {1: 0, 2: seq, 3: fresh, 6: size, 7: slot, 8: base});
    const cr = JSON.stringify(sim.cr), heap = sim.dr[5];
    const memory = sim.memory.slice(), depth = sim.callStack.length;
    let fault = null;
    sim.fault = (type, message) => { fault = {type, message}; sim.halted = true; };
    for (let budget = 1500; budget && !sim.halted; budget--) sim.step();
    assert(sim.halted, 'bounded termination');
    assert.equal(JSON.stringify(sim.cr), cr, 'no capability changes');
    const home = sim._activeThreadBase() + 1;
    for (let i = 0; i < memory.length; i++) {
        if (i >= home && i < home + 16) continue;
        assert.equal(sim.memory[i], memory[i], `unexpected write at ${i}`);
    }
    assert.equal(sim.callStack.length, depth);
    assert.equal(sim.dr[5], heap);
    assert.equal(sim.dr[6], size >>> 0);
    assert.equal(sim.dr[7], slot >>> 0);
    assert.equal(sim.dr[1], 0, 'not CREATE completion');
    return {sim, fault};
}

const valid = [
    [0x4000, 8, 32, 0, 1],
    [0x8000, 8, 33, 1, 0],
    [0xffe0, 8, 34, 509, 0], // final eight RAM words
    [0xfffc, 1, 65535, 256, 0],
    [0, 16384, 2, 0, 1], // geometric boundary, not a provisioning grant
    [4, 1, 3, 0, 1], // word address need not itself be four-aligned
];
for (const input of valid) {
    const {sim, fault} = execute(input);
    assert.equal(fault, null, JSON.stringify({input, fault}));
    const base = input[0] >>> 2;
    const next = input[4] ? 0 : input[3] + 1;
    const w1 = ((input[1] - 1) | (next << 21)) >>> 0;
    const gt = ((89 << 25) | (next << 16) | input[2]) >>> 0;
    assert.equal(sim.dr[12], 1);
    assert.deepEqual(Array.from(sim.dr.slice(8, 12)), [base, w1, seal(base, w1), gt]);
    assert.equal(base * 4, input[0], 'frozen BIT resolves original byte address');
    assert(base + (w1 & 0x1fffff) < 16384, 'frozen BIT extent check');
    if (base !== 0) assert.notEqual(sim.dr[10], seal(input[0], w1));
}
const invalid = [
    [0x4001, 8, 32, 0, 1], [0xffe4, 8, 32, 0, 1],
    [0x10000, 1, 32, 0, 1], [0xfffffffc, 1, 32, 0, 1],
    [0x40000000, 1, 32, 0, 1], // MMIO is not a resident allocation
    [0, 16385, 32, 0, 1], [0x4000, 0, 32, 0, 1],
    [0x4000, 2097153, 32, 0, 1], [0x4000, 8, 1, 0, 1],
    [0x4000, 8, 65536, 0, 1], [0x4000, 8, 32, 512, 0],
    [0x4000, 8, 32, 0, 2], [0x4000, 8, 32, 1, 1],
    [4, 8, 1, 0, 1], // scratch word-base 1 must not appear as readiness
];
for (const input of invalid) {
    const {sim, fault} = execute(input);
    assert(fault, `must fault: ${input}`);
    assert.equal(sim.dr[12] === 1, false, 'never report descriptor ready');
    assert.equal(sim.dr[8], input[0] >>> 0, 'reject before conversion');
}
for (const seq of [510, 511]) {
    const {sim, fault} = execute([0x4000, 8, 32, seq, 0]);
    assert.equal(fault, null);
    assert.equal(sim.dr[4], 511);
    assert.equal(sim.dr[12], 0);
    assert.equal(sim.dr[8], 0x4000, 'retired descriptor not converted');
    assert.deepEqual(Array.from(sim.dr.slice(9, 12)), [0, 0, 0]);
}
for (const drift of [
    original.replace('    BRANCH create_descriptor_integrity', ''),
    original.replace('; END NATIVE SLOT PACKAGE', ''),
    original.replaceAll('    BFEXT DR4, DR7, #16, #16',
        '    BFEXT DR4, DR7, #16, #16\n    BFEXT DR4, DR7, #16, #16'),
]) assert.throws(() => descriptorProgram(drift), /source contract changed/);
assert.equal(fs.readFileSync(sourcePath, 'utf8'), original);
console.log(`PASS: demo descriptor ${valid.length} valid, ${invalid.length} invalid, 2 retirement, 3 drift checks; no publication`);
