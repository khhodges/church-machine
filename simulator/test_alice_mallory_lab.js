'use strict';
// Shared browser/Node scenario contract, plus preservation of every saved input.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const lab = require('./alice_mallory_lab');
const fixture = require('./test_alice_mallory_thread_setup');
const root = path.join(__dirname, '../server/lumps');
const manifestBytes = fs.readFileSync(path.join(root, 'manifest.json'));
const inputs = Object.fromEntries(Object.entries(fixture.savedFixtures).map(([name, file]) =>
    [name, fs.readFileSync(path.join(root, file))]));
const binaries = Object.fromEntries(Object.entries(inputs).map(([name, bytes]) =>
    [name, Array.from({length: bytes.length / 4}, (_, i) => bytes.readUInt32BE(i * 4))]));
const frozenInputs = JSON.stringify(binaries);

for (const name of ['setup', 'roundtrip', 'alice', 'mallory']) {
    const s = lab.createScenario(name, binaries);
    const roots = s.bodies.slice(1).map(body =>
        s.sim.memory.slice(body.base + body.layout.stackEnd - 1,
            body.base + body.layout.stackEnd + 1));
    for (const role of s.roles) {
        assert.equal(role.filename, fixture.savedFixtures[role.abstraction]);
        for (const [offset, original, adapted] of role.codeAdaptations) {
            assert.equal(binaries[role.abstraction][offset], original);
            assert.equal(s.sim.memory[role.base + offset], adapted);
        }
    }
    while (s.attempts < s.limit) lab.step(s);
    assert.match(lab.outcome(s), /^(PASS:|Setup validated)/);
    assert.equal(s.retired.length, name === 'mallory' ? 11 : s.limit);
    for (const [i, body] of s.bodies.slice(1).entries())
        assert.deepEqual(s.sim.memory.slice(body.base + body.layout.stackEnd - 1,
            body.base + body.layout.stackEnd + 1), roots[i], 'poison root never consumed or rewritten');
    const count = s.sim.stepCount;
    const memory = s.sim.memory.slice();
    lab.step(s);
    assert.equal(s.sim.stepCount, count, 'no execution beyond scenario boundary');
    assert.deepEqual(s.sim.memory, memory, 'bounded Step has no further side effects');
    if (name === 'mallory') {
        const e = s.evidence.at(-1);
        assert.equal(e.outcome, 'fault');
        assert.equal(e.instruction.raw, 0x070b0020);
        assert.equal(e.pre.artifact.slot, s.roles[1].slot);
        assert.equal(e.pre.pc, 1);
        assert.equal(e.post.halted, true);
        assert(s.retired.every(r => r.opcode !== 16), 'DREAD never retired');
        s.sim.memory[s.roles[0].base + 10] ^= 1;
        assert.throws(() => lab.outcome(s), /Mallory boundary/,
            'a changed non-secret Alice word also invalidates containment');
    } else if (name !== 'setup') {
        s.evidence.pop();
        assert.throws(() => lab.outcome(s), /Missing instruction/,
            'register markers without retirement evidence cannot pass');
    }
    console.log(`[PASS] shared ${name}: bounded occurrences and immutable inputs`);
}

// A fresh root alone is NOT a runnable continuation. Exercise the real decoded
// CHANGE path, not a substituted implementation or a host-selected success.
{
    const {sim, bodies, threadSlots} = fixture.createAliceMalloryThreadFixture();
    fixture.bindManagerTargets(sim, threadSlots);
    const outgoing = sim.memory.slice(bodies[0].base, bodies[0].base + bodies[0].layout.lumpSize);
    assert.equal(sim._execChange({crDst: 2, crSrc: 2, imm: 0}, sim.pc), null);
    assert.equal(sim.faultLog.at(-1).type, 'STACK_UNDERFLOW');
    assert.equal(sim._currentThreadSlot, bodies[0].slot);
    assert.deepEqual(sim.memory.slice(bodies[0].base,
        bodies[0].base + bodies[0].layout.lumpSize), outgoing,
    'invalid incoming continuation cannot suspend the outgoing owner');
}
assert.equal(JSON.stringify(binaries), frozenInputs, 'caller-owned saved words unchanged');
assert.deepEqual(fs.readFileSync(path.join(root, 'manifest.json')), manifestBytes);
for (const [name, bytes] of Object.entries(inputs))
    assert.deepEqual(fs.readFileSync(path.join(root, fixture.savedFixtures[name])), bytes,
        'saved artifact bytes unchanged');
console.log('[PASS] poison-root rejection, input copies and catalog preservation');
