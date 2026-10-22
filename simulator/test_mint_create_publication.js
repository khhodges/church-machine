'use strict';
// Exact compiled Mint methods, real CALL/RETURN and LOAD, disposable RAM only.
// This is not saved-design provisioning or physical-byte-address acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {fixture} = require('../tests/simulator/cr6_contract_fixture');
const Compiler = require('./cloomc_compiler');
const {assembleLump} = require('./lump_assembler');
const source = fs.readFileSync(`${__dirname}/cloomc/mint.cloomc`, 'utf8');
const compiled = new Compiler().compile(source, []);
assert.deepEqual(compiled.errors, []);
const assembled = assembleLump(compiled.methods.map(m => m.code));
assert.deepEqual(assembled.errors || [], []);
const STATE = 0x3000, POOL = 0x900, SLOT = 39, HISTORY = 16;
function setup({method = 0, occupied = false, seq = 0, fresh = 1, issueOnly = false} = {}) {
    const f = fixture(true), {sim} = f;
    const gt = (slot, rights) => sim.createGT(0, slot,
        Object.fromEntries([...rights].map(p => [p, 1])), 1);
    sim.withNamespaceWrite('disposable Mint publication test', () => {
        sim.writeNSEntry(43, STATE, 127, 0, 0, 1, 0, 1, 0);
        sim.writeNSEntry(44, POOL, 63, 0, 0, 1, 0, 0, 0);
        sim.writeNSEntry(45, sim.NS_TABLE_BASE, sim.nsCount * 4 - 1, 0, 0, 1, 0, 0, 0);
    });
    // Publication component uses ascending FPGA geometry. This occupied fixture
    // intentionally fills that destination, not the legacy simulator's slot.
    if (occupied) sim.memory[sim.NS_TABLE_BASE + SLOT * 4] = POOL * 4;
    sim.memory.set([sim.packLumpHeader(1, 0, 1, 0),
        8, 64, 7, 9, POOL * 4, HISTORY, SLOT, SLOT], STATE);
    sim.memory[STATE + HISTORY + SLOT] = seq | (fresh << 9);
    sim.memory.fill(0xdeadbeef, POOL, POOL + 64);
    const verifySource = fs.readFileSync(`${__dirname}/cloomc/pkverify.cloomc`, 'utf8');
    const verify = new Compiler().compile(verifySource, []);
    assert.deepEqual(verify.errors, []);
    const verifyImage = assembleLump(verify.methods.map(m => m.code));
    const verifier = f.install(29, verifyImage.buf.slice(1));
    const caps = [gt(43, 'RW'), gt(43, 'L'), gt(44, 'RW'), verifier.gt, gt(45, 'RW')];
    let mint;
    if (issueOnly) {
        // Isolated issuance evidence: pre-provision the already-published entry
        // in the legacy simulator's descending table. Never remap live writes.
        const next = fresh ? 0 : seq + 1, w0 = (POOL + 8) * 4, w1 = next << 21 | 7;
        const token = (0xb2000000 | next << 16 | SLOT) >>> 0;
        sim.memory.set([w0, w1, sim._integrity32(w0, w1) >>> 0, token], sim._nsSlotBase(SLOT));
        sim.memory[STATE + 1] = 16;
        sim.memory[STATE + 3] = 8;
        sim.memory[STATE + HISTORY + SLOT] = next | 1024;
        sim.memory.fill(0, POOL + 8, POOL + 16);
        Object.assign(sim.dr, {6: 8, 7: SLOT, 8: w0, 9: w1,
            10: sim._integrity32(w0, w1) >>> 0, 11: token});
        const body = source.slice(source.indexOf('create_data_account_and_issue:'),
            source.indexOf('create_data_slot_lambda:'));
        const labels = [...new Set([...body.matchAll(/\bTODO_CREATE_\w+/g)].map(m => m[0]))];
        const failures = labels.map(label => source.match(
            new RegExp(`^${label}:\\n\\s*HARDFAULT "[^"]+"`, 'm'))[0]).join('\n');
        mint = f.compile(30, `LOAD CR7, CR6, #1\n${body}\n${failures}`, caps);
    } else mint = f.install(30, assembled.buf.slice(1), caps);
    const caller = f.compile(31, `LOAD CR1, CR6, #1\nCALL CR1, #${method}\nHALT`, [mint.gt]);
    f.activate(caller);
    sim.pc = 1;
    sim.dr[2] = 8 | 4;
    sim.dr[3] = 3;
    sim.cr[2] = {word0: 0xffffffff, word1: 0, word2: 0, word3: 0, m: 0};
    sim.cr[3] = {word0: 0, word1: 0, word2: 0, word3: 0, m: 0};
    sim.cr[4] = {...sim.cr[3]};
    return {sim, caller, mint};
}
function run(f, hook = () => {}) {
    let fault = null, steps = 0;
    f.sim.fault = (type, message) => {
        fault = {type, message, pc: f.sim.pc, dr: Array.from(f.sim.dr),
            cr1: f.sim.cr[1], parsed: f.sim.parseGT(f.sim.cr[1].word0),
            trace: f.sim.output.slice(-1700)};
        f.sim.halted = true;
    };
    while (!f.sim.halted && steps++ < 4000) {
        hook(f.sim);
        f.sim.step();
    }
    assert(steps < 4000, 'bounded execution');
    return fault;
}
for (const [seq, fresh, next] of [[0, 1, 0], [0, 0, 1], [509, 0, 510]]) {
    const f = setup({seq, fresh, issueOnly: true}), {sim} = f;
    assert.equal(run(f), null);
    assert.equal(sim.cr[14].word1, f.caller.base, 'returned to caller code');
    assert.equal(sim.dr[1], 1);
    assert.equal(sim.cr[1].word0 >>> 0, (0xb2000000 | next << 16 | SLOT) >>> 0);
    assert.equal(sim.memory[STATE + 1], 16, 'debited once');
    assert.equal(sim.memory[STATE + 3], 8);
    assert.equal(sim.memory[STATE + HISTORY + SLOT], next | 1024);
    assert.equal(sim.memory[STATE + 127], 0, 'scratch GT removed');
    const w0 = (POOL + 8) * 4, w1 = (next << 21) | 7;
    assert.deepEqual(Array.from(sim.memory.slice(sim._nsSlotBase(SLOT),
        sim._nsSlotBase(SLOT) + 4)),
    [w0, w1, sim._integrity32(w0, w1) >>> 0, sim.cr[1].word0 >>> 0]);
    assert(sim.memory.slice(POOL + 8, POOL + 16).every(w => w === 0));
    assert.equal(sim.memory[POOL + 7], 0xdeadbeef);
    assert.equal(sim.memory[POOL + 16], 0xdeadbeef);
}
{
    const f = setup();
    const fault = run(f);
    assert(fault && /namespace index 39 out of bounds/.test(fault.message),
        'legacy descending Namespace must not masquerade as FPGA ascending acceptance');
    assert.equal(f.sim.dr[1], 0);
    assert.equal(f.sim.cr[1].word0, 0);
    assert.notEqual(f.sim.cr[14].word1, f.caller.base);
}
for (const opts of [{occupied: true}, {seq: 510, fresh: 0},
    {seq: 511, fresh: 0}, {method: 1}, {method: 2}, {method: 3}]) {
    const f = setup(opts);
    assert(run(f), JSON.stringify(opts));
    assert.notEqual(f.sim.cr[14].word1, f.caller.base, 'fault never returned');
}
console.log('PASS: complete source compiles; isolated native issuance/RETURN; legacy geometry mismatch and unsupported methods fault without returning');
module.exports = {setup, run, source, compiled, assembled, STATE, POOL, SLOT, HISTORY};
