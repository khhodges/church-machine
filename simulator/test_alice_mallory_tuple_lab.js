'use strict';
const assert = require('node:assert/strict');
const lab = require('./alice_mallory_lab');
const tupleLab = require('./alice_mallory_tuple_lab');

// Independent instruction/fault oracle, not copied from the scenario's expected list.
const cases = [
    ['tuple-alice', null, null, null],
    ['tuple-mallory', 16, 4, 'NULL_CAP'],
    ['tuple-mallory-own', 16, 5, null],
    ['tuple-mallory-foreign-read', 16, 5, 'RANGE'],
    ['tuple-mallory-foreign-write', 17, 5, 'RANGE'],
    ['tuple-mallory-range-read', 16, 5, 'RANGE'],
    ['tuple-mallory-range-write', 17, 5, 'RANGE'],
];
assert.deepEqual(Object.keys(tupleLab.cases).sort(), cases.map(c => c[0]).sort());
for (const [name, opcode, cr, faultType] of cases) {
    const s = lab.createScenario(name);
    const {sim, bodies} = s;
    assert.equal(s.limit, lab.scenarios[name].limit);
    assert.notEqual(bodies[1].slot, bodies[2].slot);
    // Stop before Mallory's ordinary instruction, not at a later recovery state.
    while (s.attempts < Math.min(7, s.limit)) lab.step(s);
    const aliceBefore = Array.from(sim.memory.slice(s.tupleAddress, s.tupleAddress + 58));
    const nsBefore = Array.from(sim.memory.slice(sim.NS_TABLE_BASE));
    if (opcode !== null) {
        const heap = {...sim.cr[5]};
        const drBefore = Array.from(sim.dr);
        assert.equal(drBefore[4], 0x13579bdf, 'nonzero destination / write source sentinel');
        assert.equal(sim._currentThreadSlot, bodies[2].slot);
        assert.equal(sim.parseGT(heap.word0).index, bodies[2].slot);
        assert.equal(heap.word1, bodies[2].base + bodies[2].layout.heapStart);
        assert.equal(sim.mLoad(heap.word0, 'R', 5, heap.word1 + 5).ok, true);
        assert.equal(sim.mLoad(heap.word0, 'W', 5, heap.word1 + 5).ok, true);
        assert.equal(sim.faultLog.length, 0);
        lab.step(s);
        const e = sim.lastStepEvidence;
        const entry = sim.readNSEntry(34);
        const imm = name.includes('foreign') ? 7 :
            0x4000 | (name.includes('range')
                ? bodies[2].layout.lumpSize - bodies[2].layout.heapStart : 5);
        const raw = sim.encodeInstruction(opcode, 14, 4, cr, imm) >>> 0;
        assert.equal(e.instruction.raw, raw);
        assert.deepEqual(e.instruction.decoded, {opcode, cond:14, crDst:4, crSrc:cr, imm, raw});
        assert.equal(e.instruction.physicalPC, entry.word0_location + 1);
        assert.equal(e.pre.pc, 0);
        assert.equal(e.pre.artifact.slot, 34);
        assert.deepEqual(e.pre.cr[5], heap);
        assert.deepEqual(e.pre.dr, drBefore);
        assert.equal(sim._currentThreadSlot, bodies[2].slot);
        assert.deepEqual(Array.from(sim.memory.slice(s.tupleAddress, s.tupleAddress + 58)), aliceBefore);
        // These scenarios do not edit the saved Namespace or even change the
        // already-live fixture Namespace during the attempted instruction.
        assert.deepEqual(Array.from(sim.memory.slice(sim.NS_TABLE_BASE)), nsBefore);
        if (faultType) {
            const fault = sim.faultLog[0];
            const target = name.includes('foreign') ? s.tupleAddress + 5 :
                bodies[2].base + bodies[2].layout.lumpSize;
            const reason = cr === 4 ? 'DREAD: CR4 is NULL' :
                `${opcode === 16 ? 'DREAD' : 'DWRITE'}: CR5: address ${target} outside valid range [${bodies[2].base}..${bodies[2].base + bodies[2].layout.lumpSize - 1}]`;
            if (cr === 5) {
                assert.equal(s.targetAddress, target);
                assert.equal((heap.word1 + s.offset) >>> 0, target);
                if (name.includes('foreign')) assert.equal(drBefore[7], (target - heap.word1) >>> 0);
                const gate = sim.auditLog.at(-1);
                assert.equal(gate.nsIndex, bodies[2].slot);
                assert.equal(gate.requiredPerm, opcode === 16 ? 'R' : 'W');
                for (const check of ['version', 'seal', 'perm']) assert.equal(gate.checks[check].pass, true);
                assert.equal(gate.checks.range.pass, false);
                assert.equal(gate.checks.range.address, target);
            }
            assert.equal(sim.faultLog.length, 1);
            assert.equal(fault.type, faultType);
            assert.equal(fault.rawDiagnosticReason, reason);
            assert.equal(fault.threadSlot, bodies[2].slot);
            assert.equal(fault.pc, 0);
            assert.equal(fault.physicalPC, entry.word0_location + 1);
            assert.equal(fault.faultRawWord, raw);
            assert.equal(fault.faultingAbstractionSlot, 34);
            assert.equal(fault.executionOccurrence, e.occurrenceId);
            assert.deepEqual(e.fault, {type:faultType, message:reason});
            assert.equal(e.outcome, 'fault');
            assert.equal(s.firstFaultEvidence, e);
            assert.deepEqual(e.effects, []);
            assert.deepEqual(Array.from(sim.dr), drBefore);
            assert.deepEqual(e.post.dr, drBefore);
            assert.deepEqual(fault.drSnapshot, drBefore);
            assert.deepEqual(Array.from(sim.memory.slice(bodies[2].base + bodies[2].layout.drStart,
                bodies[2].base + bodies[2].layout.drStart + 16)), drBefore);
            assert.equal(s.retired.length, 7);
            assert.equal(sim.halted, true);
            // A wrong fault reason, register change, or any tuple-word change
            // must invalidate PASS rather than leave a stale success message.
            const originalReason = fault.rawDiagnosticReason;
            fault.rawDiagnosticReason = 'wrong reason';
            assert.throws(() => lab.outcome(s), /Containment evidence/);
            fault.rawDiagnosticReason = originalReason;
            sim.dr[4] ^= 1;
            assert.throws(() => lab.outcome(s), /Containment evidence/);
            sim.dr[4] = drBefore[4];
            for (let i = 0; i < 58; i++) {
                sim.memory[s.tupleAddress + i] ^= 1;
                assert.throws(() => lab.outcome(s), /./, `Alice word ${i} must be protected`);
                sim.memory[s.tupleAddress + i] = aliceBefore[i];
            }
        } else {
            assert.equal(sim.faultLog.length, 0);
            assert.equal(e.outcome, 'retired');
            assert.equal(sim.dr[4], 913);
            assert.notEqual(sim.dr[4], aliceBefore[5]);
            assert.equal(sim.memory[s.malloryTupleAddress + 5], 913);
            assert.deepEqual(e.effects.filter(effect => effect.kind === 'data-read'),
                [{kind:'data-read', address:heap.word1 + 5, offset:5, capability:5, value:913, device:false}]);
            assert.equal(s.retired.length, 8);
        }
    }
    assert.match(lab.outcome(s), /^PASS:/);
    const beforeBoundary = {attempts:s.attempts, steps:sim.stepCount, faults:sim.faultLog.length,
        evidence:sim.lastStepEvidence, memory:sim.memory.slice()};
    lab.step(s);
    assert.equal(s.attempts, beforeBoundary.attempts);
    assert.equal(sim.stepCount, beforeBoundary.steps);
    assert.equal(sim.faultLog.length, beforeBoundary.faults);
    assert.equal(sim.lastStepEvidence, beforeBoundary.evidence);
    assert.deepEqual(sim.memory, beforeBoundary.memory);
    sim.memory[s.tupleAddress + 6] ^= 1;
    assert.throws(() => lab.outcome(s), /./, 'corrupt tuple must not retain a PASS');
    console.log(name + ': exact instruction, authority, evidence and bounded execution passed');
}
