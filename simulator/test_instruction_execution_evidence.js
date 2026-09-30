'use strict';
const assert = require('assert');
global.window = {};
const Simulator = require('./simulator.js');
const word = (op, dst = 1, src = 1, imm = 0, cond = 14) =>
    ((op << 27) | (cond << 23) | (dst << 19) | (src << 15) | imm) >>> 0;

function fixture(words) {
    const sim = new Simulator();
    sim.writeNSEntry(4, 0x300, 63, 0, 0, 1, 0, 1, 0);
    sim.memory[0x300] = ((0x1f << 27) | (words.length << 10) | 1) >>> 0;
    words.forEach((w, i) => { sim.memory[0x301 + i] = w; });
    sim.bootComplete = true;
    sim.cr[14] = { word0: sim.createGT(0, 4, { R: 1, X: 1 }, 1),
        word1: 0x300, word2: 63, word3: 0, m: 0 };
    return sim;
}

// Aliasing every arithmetic operand must not recompute inputs from destination.
{
    const sim = fixture([word(21, 1, 1, 0x4001)]);
    sim.simulationConfiguration = { configurationHash: 'frozen-config', hardwareCertified: false,
        artifactBindings: [{ artifactHash: 'exact-artifact' }] };
    const evidence = sim.step().executionEvidence;
    sim.simulationConfiguration.artifactBindings[0].artifactHash = 'changed';
    assert.strictEqual(evidence.simulationConfiguration.artifactBindings[0].artifactHash, 'exact-artifact');
    assert.strictEqual(evidence.simulationConfiguration.hardwareCertified, false);
    assert(Object.isFrozen(evidence.simulationConfiguration));
    sim.reset();
    assert.strictEqual(sim.simulationConfiguration, null);
    assert.strictEqual(evidence.simulationConfiguration.configurationHash, 'frozen-config');
}
for (const op of [21, 22]) {
    for (const [dst, src, rhs] of [[1, 1, 2], [2, 1, 2], [1, 1, 1]]) {
        const sim = fixture([word(op, dst, src, rhs)]);
        sim.dr[1] = 10; sim.dr[2] = 3;
        const result = sim.step();
        const e = result.executionEvidence;
        const a = e.pre.dr[src], b = e.pre.dr[rhs];
        assert.strictEqual(e.post.dr[dst], (op === 21 ? a + b : a - b) >>> 0);
        assert(result.desc.includes(`${a} ${op === 21 ? '+' : '-'} ${b} =`));
        assert(Object.isFrozen(e.pre.dr));
        assert(Object.isFrozen(e.instruction.decoded));
        sim.dr[1] = 77;
        assert.strictEqual(e.pre.dr[1], 10);
    }
}
// An aliased destination must never be used to reconstruct the source. In
// particular this occurrence is 0 + 4096, not 4096 + 4096.
{
    const sim = fixture([word(21, 1, 1, 0x5000)]);
    const e = sim.step().executionEvidence;
    assert.match(e.description, /0 \+ 4096 = 4096/);
    assert.strictEqual(e.pre.dr[1], 0);
    assert.strictEqual(e.post.dr[1], 4096);
    assert(Object.isFrozen(e.effects));
}
{
    const sim = fixture([word(22, 1, 1, 0x4001), word(21, 0, 1, 0x7fff)]);
    const first = sim.step();
    assert(first.desc.includes('0 - 1 = 4294967295'));
    assert.strictEqual(first.executionEvidence.post.dr[1], 0xffffffff);
    const zero = sim.step();
    assert(zero.desc.includes('#16383'));
    assert(zero.desc.includes('DR0 destination discarded'));
    assert.strictEqual(zero.executionEvidence.post.dr[0], 0);
    assert(zero.executionEvidence.effects.some(e => e.register === 0 && e.value === 16382));
    assert(zero.executionEvidence.effects.some(e => e.register === 0 && e.value === 16382 && e.discarded));
}
for (const [op, imm, input, expected] of [
    [24, 1, 0x80000001, 2], [25, 1, 0x80000000, 0x40000000],
    [25, 33, 0x80000000, 0xc0000000], [24, 0, 7, 7],
    [18, (4 << 5) | 4, 0xab, 0xa], [19, (4 << 5) | 4, 0xab, 0xbb],
]) {
    const sim = fixture([word(op, 1, 1, imm)]);
    sim.dr[1] = input;
    const result = sim.step();
    assert.strictEqual(result.executionEvidence.pre.dr[1], input);
    assert.strictEqual(result.executionEvidence.post.dr[1], expected);
    if (op === 18 || op === 19) assert(result.pipeline[0].desc.includes('[7:4]'));
}
{
    const sim = fixture([word(21, 1, 1, 0x4001, 15), word(23, 0, 0, 0)]);
    const skipped = sim.step().executionEvidence;
    assert.strictEqual(skipped.outcome, 'skipped');
    assert.deepStrictEqual(skipped.pre.dr, skipped.post.dr);
    const loop1 = sim.step().executionEvidence;
    const loop2 = sim.step().executionEvidence;
    assert.notStrictEqual(loop1.occurrenceId, loop2.occurrenceId);
    assert.strictEqual(loop1.instruction.physicalPC, loop2.instruction.physicalPC);
    assert.strictEqual(loop1.pre.pc, loop2.pre.pc);
    assert.strictEqual(loop1.post.pc, loop2.post.pc);
    assert(Object.isFrozen(loop1.pre.artifact));
    assert(Object.isFrozen(loop1.post.flags));
    const epoch = loop2.epoch;
    sim.reset();
    assert.strictEqual(sim.lastStepEvidence, null);
    assert(sim._evidenceEpoch > epoch);
    assert.strictEqual(loop1.outcome, 'retired');
    assert.strictEqual(loop1.pre.artifact.slot, 4);
}
{
    const sim = fixture([word(21, 1, 1, 0x5000), word(23, 0, 0, 0x7fff)]);
    const first = sim.step().executionEvidence;
    const branch = sim.step().executionEvidence;
    assert.match(branch.description, /BRANCH -1 -> PC=0/);
    assert.strictEqual(branch.pre.pc, 1);
    assert.strictEqual(branch.post.pc, 0);
    const next = sim.step().executionEvidence;
    assert.notStrictEqual(next.occurrenceId, first.occurrenceId);
    assert.strictEqual(first.post.dr[1], 4096);
    assert.strictEqual(next.pre.dr[1], 4096);
    assert.match(next.description, /4096 \+ 4096 = 8192/);
}
// These faults happen after a successful fetch, including IDX1 admission.
for (const [encoded, type, message] of [
    [word(18, 1, 1, 0), 'BOUNDS', /BFEXT: invalid bitfield/],
    [word(10), 'INVALID_OP', /requires an admitted IDX1 execution envelope/],
    [word(17, 1, 0, 0x4000), 'NULL_CAP', /DWRITE: CR0 is NULL/],
]) {
    const sim = fixture([encoded]);
    sim.cr[0].word0 = 0;
    assert.strictEqual(sim.step(), null);
    const e = sim.lastStepEvidence;
    assert.strictEqual(e.outcome, 'fault');
    assert(e.instruction, `Fetched opcode ${encoded >>> 27} must retain instruction evidence`);
    assert.strictEqual(e.instruction.raw, encoded);
    assert.strictEqual(e.instruction.physicalPC, 0x301);
    assert.strictEqual(e.fault.type, type);
    assert.match(e.fault.message, message);
    assert(Object.isFrozen(e.instruction));
    assert(Object.isFrozen(e.fault));
}
// Genuine pre-fetch authority failures must not borrow the previous
// occurrence's instruction, even when bytes remain at the predicted address.
for (const [invalidate, type] of [
    [sim => { sim.cr[14].word0 = 0; }, 'NULL_CAP'],
    [sim => { sim.cr[14].word1 = sim.memory.length; }, 'BOUNDS'],
]) {
    const sim = fixture([word(21, 1, 1, 0x4001), word(10)]);
    const prior = sim.step().executionEvidence;
    invalidate(sim);
    assert.strictEqual(sim.step(), null);
    const e = sim.lastStepEvidence;
    assert.strictEqual(e.outcome, 'fault');
    assert.strictEqual(e.fault.type, type);
    assert.strictEqual(e.instruction, null);
    assert.notStrictEqual(e.occurrenceId, prior.occurrenceId);
    assert.strictEqual(prior.instruction.raw, word(21, 1, 1, 0x4001));
    assert.deepStrictEqual(e.pre.dr, e.post.dr);
}
{
    const sim = fixture([word(5, 15, 15)]);
    sim.cr[15].m = 1;
    const result = sim.step();
    assert(result.desc.includes('no-op'));
    assert.strictEqual(result.executionEvidence.pre.cr[15].m, 1);
    assert.strictEqual(result.executionEvidence.post.cr[15].m, 0);
}
{
    const sim = fixture([word(5, 12, 1)]);
    sim.cr[12].m = 1;
    const priorBase = sim.cr[12].word1;
    sim._execLoad = d => {
        sim.cr[12].word1 = 0x555;
        sim.pc++;
        return { instr: d, pc: 0, desc: 'LOAD synthetic non-Thread probe' };
    };
    const result = sim.step();
    assert(result.desc.includes('non-Thread probe accepted'));
    assert.strictEqual(result.executionEvidence.post.cr[12].word1, priorBase);
    assert.strictEqual(result.executionEvidence.post.cr[12].m, 0);
}
{
    const sim = fixture([word(21, 1, 1, 0x4001)]);
    const prior = sim.step().executionEvidence;
    sim._fetchInstruction = () => ({ ok: false, fault: 'BOUNDS', message: 'synthetic fetch fault' });
    assert.strictEqual(sim.step(), null);
    assert.strictEqual(sim.lastStepEvidence.instruction, null);
    assert.strictEqual(sim.lastStepEvidence.outcome, 'fault');
    assert.notStrictEqual(sim.lastStepEvidence.occurrenceId, prior.occurrenceId);
}
// Isolated data-memory fixture: only authority gates are synthetic; production
// offset decoding, reads/writes, register homes and evidence remain exercised.
{
    const sim = fixture([word(17, 1, 2, (2 << 4) | 1), word(16, 1, 2, 0x4005)]);
    sim.cr[2] = { word0: sim.createGT(0, 20, { R: 1, W: 1 }, 1),
        word1: 100, word2: 63, word3: 0, m: 0 };
    const originalLoad = sim.mLoad.bind(sim);
    sim.mLoad = (gt, perm, reg, addr) => reg === 2
        ? { ok: true, index: 20 } : originalLoad(gt, perm, reg, addr);
    sim._activeThreadBase = () => 200;
    sim.dr[1] = 3;
    sim.memory[105] = 99;
    const write = sim.step().executionEvidence;
    assert.strictEqual(sim.memory[105], 3);
    assert.deepStrictEqual(write.effects.find(e => e.kind === 'data-write'), {
        kind: 'data-write', address: 105, offset: 5, capability: 2,
        value: 3, device: false, previousMemoryWord: 99,
    });
    assert(write.effects.some(e => e.kind === 'memory-write' &&
        e.address === 105 && e.previousValue === 99 && e.value === 3));
    assert(write.effects.some(e => e.kind === 'memory-write' &&
        e.address === 202 && e.value === 3));
    assert.match(write.description, /DR1.*CR2 \+ 5.*← 3/);
    sim.memory[105] = 0xffffffff;
    const read = sim.step().executionEvidence;
    assert.strictEqual(read.post.dr[1], 0xffffffff);
    assert.strictEqual(read.effects.find(e => e.kind === 'data-read').value, 0xffffffff);
    assert(read.effects.some(e => e.kind === 'memory-write' &&
        e.address === 202 && e.previousValue === 3 && e.value === 0xffffffff));
}
// A failed isolated load can make provisional stores, but SWITCH restores
// them. Neither the post-image nor the historical effects may claim a write.
{
    const sim = fixture([word(5, 12, 1)]);
    sim.cr[12].m = 1;
    sim.memory[200] = 41;
    sim._execLoad = () => {
        sim._writeRuntimeWord(200, 42);
        sim.fault('BOUNDS', 'synthetic isolated-load failure');
        return null;
    };
    assert.strictEqual(sim.step(), null);
    assert.strictEqual(sim.memory[200], 41);
    assert.strictEqual(sim.lastStepEvidence.outcome, 'fault');
    assert(!sim.lastStepEvidence.effects.some(e => e.address === 200));
    assert.strictEqual(sim.lastStepEvidence.pre.cr[12].m, 1);
    assert.strictEqual(sim.lastStepEvidence.post.cr[12].m, 1);
}
// Real CALL/RETURN boundary: exact caller and callee capability snapshots.
{
    const sim = new Simulator();
    function lump(slot, base, code) {
        sim.writeNSEntry(slot, base, 63, 0, 0, 1, 0, 1, 0);
        sim.memory[base] = ((0x1f << 27) | (code.length << 10) | 1) >>> 0;
        code.forEach((w, i) => { sim.memory[base + 1 + i] = w; });
    }
    lump(4, 0x300, [word(2, 0, 0), 0]);
    lump(7, 0x700, [0, word(3, 0, 0), 0]);
    sim.cr[12] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
    sim.cr[14] = { word0: sim.createGT(0, 4, { R: 1, X: 1 }, 1),
        word1: 0x300, word2: 63, word3: 0, m: 0 };
    sim.cr[6] = { word0: sim.createGT(0, 4, { L: 1 }, 1),
        word1: 0x33f, word2: 63, word3: 0, m: 0 };
    sim.cr[0] = { word0: sim.createGT(0, 7, { E: 1 }, 1),
        word1: 0, word2: 0, word3: 0, m: 0 };
    sim._slotIdentity.set(4, { binaryHash: 'a'.repeat(64), generation: 1 });
    sim.bootComplete = true;
    let emitted;
    sim.on('step', r => { emitted = r.executionEvidence; });
    const call = sim.step().executionEvidence;
    assert.strictEqual(emitted, call);
    assert.strictEqual(call.instruction.physicalPC, 0x301);
    assert.strictEqual(call.instruction.raw, word(2, 0, 0));
    assert.strictEqual(call.pre.artifact.slot, 4);
    assert.strictEqual(call.post.artifact.slot, 7);
    assert.strictEqual(call.occurrenceId.split(':')[0], String(call.epoch));
    sim._slotIdentity.get(4).binaryHash = 'b'.repeat(64);
    assert.strictEqual(call.pre.artifact.identity.binaryHash, 'a'.repeat(64));
    const ret = sim.step().executionEvidence;
    assert.strictEqual(ret.instruction.physicalPC, 0x702);
    assert.strictEqual(ret.instruction.raw, word(3, 0, 0));
    assert.notStrictEqual(call.occurrenceId, ret.occurrenceId);
    assert.strictEqual(ret.pre.artifact.slot, 7);
    assert.strictEqual(ret.post.artifact.slot, 4);
    assert.strictEqual(call.post.callDepth, ret.pre.callDepth);
    assert.strictEqual(call.post.artifact.slot, 7);
    assert.strictEqual(ret.pre.artifact.slot, 7);
}
console.log('instruction execution evidence: passed');