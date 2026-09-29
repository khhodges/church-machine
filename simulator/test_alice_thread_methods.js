'use strict';

// Instruction-driven Boot.Thread -> Thread.2 -> Alice.Stash/Reveal -> Boot.Thread.
// Only fixture driver LUMPs are new; the saved Alice/Mallory binaries are untouched.
const assert = require('assert');
const {createAliceMalloryThreadFixture, installThreadDriver} =
    require('./test_alice_mallory_thread_setup.js');

const {sim, threadSlots, bodies, roles, nextBase} =
    createAliceMalloryThreadFixture();
const AL = 0xE;
const secret = 0x2A7;
const instruction = (opcode, dst, src, imm, cond = AL) =>
    sim.encodeInstruction(opcode, cond, dst, src, imm);
const iadd = (dst, value) => instruction(21, dst, 0, 0x4000 | value);
const change = (dst, slot, cond = AL) => instruction(4, dst, 15, slot, cond);

const installDriver = (slot, base, code, label, caps) =>
    installThreadDriver(sim, slot, base, code, label, caps);

const aliceRole = roles[0];
const malloryRole = roles[1];
const aliceBody = bodies[1];
const malloryBody = bodies[2];
const malloryThreadBefore = sim.memory.slice(
    malloryBody.base, malloryBody.base + malloryBody.layout.lumpSize);
const malloryResidentBefore = sim.memory.slice(
    malloryRole.base, malloryRole.base +
        sim.parseLumpHeader(sim.memory[malloryRole.base]).lumpSize);
const aliceCodeBefore = sim.memory.slice(
    aliceRole.base + 1, aliceRole.base + 9);
assert.notStrictEqual(sim.memory[aliceRole.base + 9], secret,
    'Alice private word does not already contain the test secret');
assert.strictEqual(sim.memory[aliceBody.base + aliceBody.layout.capsStart + 1],
    aliceRole.gt, 'Thread.2 private CR1 contains the real Alice E GT');
assert.strictEqual(sim.memory[malloryBody.base + malloryBody.layout.capsStart + 1],
    malloryRole.gt, 'dormant Mallory private CR1 remains separate');

const manager = installDriver(32, nextBase, [
    iadd(1, 101),
    change(14, threadSlots[1]),
    iadd(2, 303),
], 'Boot.Thread manager');
// Alice's RETURN mask is zero: it scrubs working CR1, rather than restoring
// caller CR snapshots. Keep the *existing* E GT in the driver's declared
// c-list row 1; after Stash, reload it using the RETURN-restored caller CR6.
// Neither RETURN nor the driver synthesizes an authority from a namespace slot.
const alice = installDriver(33, nextBase + 64, [
    iadd(2, 202),
    iadd(1, secret),
    instruction(2, 1, 0, 1), // CALL CR1, Alice.Stash
    instruction(0, 1, 6, 1), // LOAD CR1, CR6, 1 (real E GT from driver c-list)
    iadd(1, 0),             // clear the Stash argument before Reveal
    instruction(2, 1, 0, 2), // CALL CR1, Alice.Reveal
    instruction(22, 3, 1, 0x4000 | secret), // ISUB DR3, DR1, #secret
    change(15, threadSlots[0], 0), // CHANGEEQ only on actual Reveal success
    iadd(2, 999), // fail-closed continuation if the guarded CHANGE did not run
], 'Alice-context driver', [aliceRole.gt]);
assert.strictEqual(sim.memory[alice.base + 63], aliceRole.gt,
    'driver c-list row 1 retains the authentic Alice E GT');

sim.memory[aliceBody.base + aliceBody.layout.capsStart] = alice.gt;
assert(sim._formatThreadRootSentinel(
    aliceBody.base, aliceBody.layout, alice.gt, {image: true}),
'Alice context has a canonical driver CHURCH root');
assert.strictEqual(sim._readThreadResumeFrame(
    aliceBody.base, aliceBody.layout, aliceBody.slot).parsed.index, alice.slot);

const managerEntry = sim.readNSEntry(manager.slot);
sim._writeCR(0, manager.gt, managerEntry);
sim._installLumpHeaderContext(sim.parseGT(manager.gt), manager.slot,
    managerEntry, manager.header);
sim.pc = 0;
const managerCR1 = {...sim.cr[1]};
const managerCR14 = {...sim.cr[14]};
const managerDR4 = sim.dr[4];
assert.strictEqual(sim._currentThreadSlot, threadSlots[0]);
assert.strictEqual(sim.dr[0], 0);

const retired = [];
const expected = [
    [1, manager, 0, 21], [1, manager, 1, 4],
    [11, alice, 0, 21], [11, alice, 1, 21], [11, alice, 2, 2],
    [11, aliceRole, 2, 0], [11, aliceRole, 3, 17], [11, aliceRole, 4, 3],
    [11, alice, 3, 0], [11, alice, 4, 21], [11, alice, 5, 2],
    [11, aliceRole, 5, 0], [11, aliceRole, 6, 16], [11, aliceRole, 7, 3],
    [11, alice, 6, 22], [11, alice, 7, 4],
    [1, manager, 2, 21],
].map(([owner, resident, pc, opcode]) =>
    ({owner, pc, physicalPC: resident.base + 1 + pc, opcode}));
for (let i = 0; i < expected.length; i++) {
    assert(!sim.halted, `unexpected HALT before instruction ${i + 1}`);
    const owner = sim._currentThreadSlot;
    const pc = sim.pc;
    const result = sim.step();
    assert(result && result.instr && !result.skipped,
        `instruction ${i + 1} must retire via sim.step`);
    assert.strictEqual(sim.faultLog.length, 0,
        `instruction ${i + 1} fault: ${sim.faultLog.at(-1)?.message}`);
    retired.push({owner, pc, physicalPC: result.physicalPC,
        opcode: result.instr.opcode});
    if (i === 7) {
        assert.strictEqual(sim.cr[1].word0, 0,
            'Alice.Stash RETURN scrubs CR1; caller must reload E authority');
        assert.strictEqual(sim.parseGT(sim.cr[6].word0).index, alice.slot,
            'RETURN reconstructs the driver c-list CR6 from the protected frame');
        assert.strictEqual(sim.memory[aliceRole.base + 9], secret,
            'Stash wrote Alice private data through its real resident capability');
    }
    if (i === 8) assert.strictEqual(sim.cr[1].word0, aliceRole.gt,
        'LOAD restores the existing Alice E GT, not synthetic return authority');
    if (i === 13) assert.strictEqual(sim.dr[1], secret,
        'Reveal returned the secret to the Alice-context driver before CHANGE');
    if (i === 14) {
        assert.strictEqual(sim.dr[1], secret, 'Reveal result survives comparison');
        assert.strictEqual(sim.dr[3], 0, 'driver comparison is zero');
        assert.strictEqual(sim.flags.Z, true, 'CHANGEEQ guard tests actual success');
    }
    if (i === 15) {
        assert.strictEqual(sim._currentThreadSlot, threadSlots[0],
            'guarded CHANGE returned to Boot.Thread');
        assert.strictEqual(sim.memory[aliceBody.base + aliceBody.layout.drStart + 1],
            secret, 'Thread.2 saved Reveal result in its own DR1 home');
        assert.strictEqual(sim.memory[aliceBody.base + aliceBody.layout.drStart + 2],
            202, 'Thread.2 saved its own DR2 marker');
    }
}
console.log('[METHODS] retired ' + JSON.stringify(retired));
assert.deepStrictEqual(retired, expected,
    'real Stash and Reveal must retire in order between the two CHANGE instructions');
assert.strictEqual(sim._currentThreadSlot, threadSlots[0]);
assert.strictEqual(sim._liveThreadOwned, true);
assert.strictEqual(sim.dr[1], 101, 'manager DR1 preserved independently');
assert.strictEqual(sim.dr[2], 303, 'manager continuation retired');
assert.strictEqual(sim.dr[4], managerDR4, 'manager callee-saved DR4 preserved');
assert.deepStrictEqual(sim.cr[1], managerCR1, 'manager CR1 preserved independently');
assert.deepStrictEqual(sim.cr[14], managerCR14, 'manager execution identity restored');
assert.strictEqual(sim.memory[aliceBody.base + aliceBody.layout.drStart + 1],
    secret, 'Thread.2 private DR1 saved after Reveal');
assert.strictEqual(sim.memory[aliceBody.base + aliceBody.layout.drStart + 2],
    202, 'Thread.2 private DR2 saved after Reveal');
assert.strictEqual(sim.memory[aliceBody.base + aliceBody.layout.drStart + 3],
    0, 'Thread.2 private comparison result saved');
assert.strictEqual(sim.memory[aliceBody.base + aliceBody.layout.capsStart + 1],
    0, 'Reveal RETURN scrubs Thread.2 CR1; E GT remains only in its declared c-list');
assert.strictEqual(sim.memory[alice.base + 63], aliceRole.gt,
    'driver c-list still retains the authentic Alice E authority for a later reload');
const aliceResume = sim._readThreadResumeFrame(
    aliceBody.base, aliceBody.layout, aliceBody.slot);
assert.strictEqual(aliceResume.parsed.index, alice.slot,
    'Thread.2 suspended frame names its driver');
assert.strictEqual(aliceResume.frame.returnPC, 8,
    'Thread.2 frame saves instruction following guarded CHANGE');
assert.deepStrictEqual(sim.memory.slice(aliceRole.base + 1, aliceRole.base + 9),
    aliceCodeBefore, 'saved Alice executable instructions unchanged');
assert.strictEqual(sim.memory[aliceRole.base + 9], secret,
    'only Alice private resident data changed to the stashed secret');
assert.deepStrictEqual(sim.memory.slice(
    malloryBody.base, malloryBody.base + malloryBody.layout.lumpSize),
malloryThreadBefore, 'dormant Mallory Thread entire body unchanged');
assert.deepStrictEqual(sim.memory.slice(
    malloryRole.base, malloryRole.base + malloryResidentBefore.length),
malloryResidentBefore, 'dormant Mallory resident unchanged');
assert.strictEqual(sim.faultLog.length, 0, 'no machine fault');
console.log('[PASS] Thread.2 real Alice.Stash/Reveal via CALL/RETURN; ' +
    'guarded CHANGE returns to manager continuation; Mallory dormant.');