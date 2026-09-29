'use strict';

// Instruction-driven Boot.Thread -> Thread.2 Alice.Stash -> Boot.Thread ->
// Thread.3 Mallory.Steal. Stop at the first fault; do not recover or reboot.
const assert = require('assert');
const {createAliceMalloryThreadFixture, installThreadDriver} =
    require('./test_alice_mallory_thread_setup.js');

const {sim, threadSlots, bodies, roles, nextBase} =
    createAliceMalloryThreadFixture();
const [aliceRole, malloryRole] = roles;
const [managerBody, aliceBody, malloryBody] = bodies;
const secret = 0x2A7;
const instruction = (opcode, dst, src, imm) =>
    sim.encodeInstruction(opcode, 0xE, dst, src, imm);
const iadd = (dst, value) => instruction(21, dst, 0, 0x4000 | value);
const change = (dst, slot) => instruction(4, dst, 15, slot);
const driver = (slot, offset, code, label, caps = []) =>
    installThreadDriver(sim, slot, nextBase + offset, code, label, caps);

assert.notStrictEqual(sim.memory[aliceRole.base + 9], secret,
    'Alice private word must not already equal the fixture secret');
const manager = driver(32, 0, [
    iadd(2, 101),
    change(14, threadSlots[1]),
    change(14, threadSlots[2]),
    iadd(2, 999), // never execute after Mallory's fault
], 'Boot.Thread manager');
const alice = driver(33, 64, [
    iadd(1, secret),
    instruction(2, 1, 0, 1), // CALL CR1, real Alice.Stash
    change(15, threadSlots[0]),
], 'Alice-context driver');
const mallory = driver(34, 128, [
    instruction(2, 1, 0, 1), // CALL CR1, real Mallory.Steal
    iadd(2, 999), // never execute after Mallory's fault
], 'Mallory-context driver');

for (const [body, resident] of [[aliceBody, alice], [malloryBody, mallory]]) {
    sim.memory[body.base + body.layout.capsStart] = resident.gt;
    assert(sim._formatThreadRootSentinel(
        body.base, body.layout, resident.gt, {image: true}),
    'dedicated driver must have a canonical CHURCH root');
    assert.strictEqual(sim._readThreadResumeFrame(
        body.base, body.layout, body.slot).parsed.index, resident.slot);
}
assert.strictEqual(sim.memory[aliceBody.base + aliceBody.layout.capsStart + 1],
    aliceRole.gt, 'Thread.2 has the real Alice Enter GT');
assert.strictEqual(sim.memory[malloryBody.base + malloryBody.layout.capsStart + 1],
    malloryRole.gt, 'Thread.3 has only the real Mallory Enter GT in CR1');
assert.strictEqual(sim.memory[mallory.base + 63], mallory.gt,
    'Mallory driver declares SELF only, no Alice authority');
assert.strictEqual(mallory.header.cc, 1, 'Mallory driver declares no additional capabilities');
const malloryCaps = sim.memory.slice(
    malloryBody.base + malloryBody.layout.capsStart,
    malloryBody.base + malloryBody.layout.capsEnd + 1);
assert(!malloryCaps.includes(aliceRole.gt),
    'Thread.3 private capability homes contain no Alice Enter GT');
for (const gt of malloryCaps.filter(Boolean)) {
    assert.notStrictEqual(sim.parseGT(gt).index, aliceRole.slot,
        'Thread.3 has no capability of any permission to Alice resident');
}
const malloryHeader = sim.parseLumpHeader(sim.memory[malloryRole.base]);
assert.strictEqual(malloryHeader.cc, 2, 'saved Mallory c-list has rows 0 and 1 only');
const scratch = sim.memory[malloryRole.base + malloryHeader.lumpSize - 1];
const scratchGT = sim.parseGT(scratch);
assert.strictEqual(scratchGT.index, malloryRole.slot,
    'Mallory private RW scratch addresses its own resident, not Alice');
assert.deepStrictEqual(
    [scratchGT.permissions.R, scratchGT.permissions.W],
    [1, 1], 'Mallory scratch is a private RW capability');
assert(!malloryCaps.includes(scratch), 'Thread.3 never receives even its resident RW directly');

const managerEntry = sim.readNSEntry(manager.slot);
sim._writeCR(0, manager.gt, managerEntry);
sim._installLumpHeaderContext(sim.parseGT(manager.gt), manager.slot,
    managerEntry, manager.header);
sim.pc = 0;
assert.strictEqual(sim._currentThreadSlot, managerBody.slot);

const retired = [];
const expected = [
    [managerBody.slot, manager, 0, 21],
    [managerBody.slot, manager, 1, 4],
    [aliceBody.slot, alice, 0, 21],
    [aliceBody.slot, alice, 1, 2],
    [aliceBody.slot, aliceRole, 2, 0],
    [aliceBody.slot, aliceRole, 3, 17],
    [aliceBody.slot, aliceRole, 4, 3],
    [aliceBody.slot, alice, 2, 4],
    [managerBody.slot, manager, 2, 4],
    [malloryBody.slot, mallory, 0, 2],
].map(([owner, resident, pc, opcode]) =>
    ({owner, pc, physicalPC: resident.base + 1 + pc, opcode}));
let secretBeforeMallory;
for (let i = 0; i < expected.length; i++) {
    assert(!sim.halted, `unexpected HALT before instruction ${i + 1}`);
    const owner = sim._currentThreadSlot;
    const pc = sim.pc;
    const result = sim.step();
    assert(result && result.instr && !result.skipped,
        `instruction ${i + 1} must retire`);
    assert.strictEqual(sim.faultLog.length, 0, `unexpected fault at instruction ${i + 1}`);
    assert.strictEqual(result.executionEvidence.outcome, 'retired');
    retired.push({owner, pc, physicalPC: result.physicalPC,
        opcode: result.instr.opcode});
    if (i === 5) {
        assert.strictEqual(sim.memory[aliceRole.base + 9], secret,
            'real Alice.Stash DWRITE seeded private resident word');
    }
    if (i === 7) {
        assert.strictEqual(sim._currentThreadSlot, managerBody.slot);
        secretBeforeMallory = sim.memory[aliceRole.base + 9];
        assert.strictEqual(secretBeforeMallory, secret);
    }
}
assert.deepStrictEqual(retired, expected, 'bounded genuine CALL/RETURN and CHANGE path');
assert.strictEqual(sim._currentThreadSlot, malloryBody.slot);
assert.strictEqual(sim.pc, 1, 'CALL selector 1 enters Steal at its LOAD, PC 1');
const stepsBeforeFault = sim.stepCount;
const successesBeforeFault = sim.executionStats.successful;
const faultResult = sim.step();
const evidence = sim.lastStepEvidence;
const fault = sim.faultLog.at(-1);
assert.strictEqual(faultResult, null, 'faulting LOAD cannot retire');
assert.strictEqual(sim.faultLog.length, 1, 'first and only fault');
assert.strictEqual(fault.type, 'NO_CAPABILITY');
assert.strictEqual(fault.threadSlot, malloryBody.slot);
assert.strictEqual(fault.pc, 1);
assert.strictEqual(fault.physicalPC, malloryRole.base + 2);
assert.strictEqual(fault.faultRawWord, sim.memory[malloryRole.base + 2],
    'fault log captures the exact saved Mallory LOAD word');
assert.match(fault.rawDiagnosticReason, /LOAD: c-list has no capability at row 2 \(declared rows: 0–1\)/);
assert.strictEqual(evidence.outcome, 'fault');
assert.strictEqual(evidence.fault.type, 'NO_CAPABILITY');
assert.strictEqual(evidence.pre.artifact.slot, malloryRole.slot);
assert.strictEqual(evidence.pre.pc, 1);
assert.strictEqual(evidence.instruction.physicalPC, malloryRole.base + 2);
assert.strictEqual(evidence.instruction.raw, fault.faultRawWord);
assert.strictEqual(evidence.instruction.decoded.opcode, 0, 'issuing instruction is LOAD');
assert.strictEqual(evidence.instruction.decoded.crDst, 1);
assert.strictEqual(evidence.instruction.decoded.crSrc, 6);
assert.strictEqual(evidence.instruction.decoded.imm, 2);
assert.strictEqual(sim.stepCount, stepsBeforeFault + 1,
    'only the failing LOAD was attempted after the last retirement');
assert.strictEqual(sim.executionStats.successful, successesBeforeFault,
    'faulting LOAD did not retire');
assert(retired.every(item => item.opcode !== 16),
    'no DREAD retired before the fault');
assert.strictEqual(evidence.instruction.decoded.opcode, 0,
    'last attempt was LOAD, not the following DREAD');
assert.strictEqual(sim.memory[aliceRole.base + 9], secretBeforeMallory,
    'Alice private secret word is unchanged across Mallory execution');
assert.strictEqual(sim.halted, true, 'production fault latch stops execution');
assert.strictEqual(evidence.post.halted, true, 'boundary records the faulted HALT latch');
assert.strictEqual(sim._currentThreadSlot, malloryBody.slot,
    'no reset or manager continuation executed at this boundary');
assert.strictEqual(sim.bootComplete, true, 'fault has not triggered a reboot');
assert.strictEqual(sim.pc, 1, 'fault did not advance to DREAD or recovery');
assert.notStrictEqual(sim.dr[2], 999, 'manager and Mallory continuations did not execute');
console.log('[MALLORY] retired ' + JSON.stringify(retired));
console.log('[MALLORY] fault ' + JSON.stringify({
    type: fault.type, threadSlot: fault.threadSlot, pc: fault.pc,
    physicalPC: fault.physicalPC, raw: fault.faultRawWord,
    instruction: evidence.instruction.decoded, outcome: evidence.outcome,
    halted: sim.halted, secretBeforeMallory, secretAtFault: sim.memory[aliceRole.base + 9],
}));
console.log('[PASS] first Mallory Steal LOAD row 2 faults NO_CAPABILITY; ' +
    'DREAD unattempted; Alice secret unchanged; no recovery or following instruction.');