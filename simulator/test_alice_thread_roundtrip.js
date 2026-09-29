'use strict';

// Isolated instruction-driven manager -> Alice context -> manager fixture.
// The only new executables are fixture-local driver LUMPs; saved Alice/Mallory,
// canonical boot residents, Namespace bootstrap, and assembler policy are untouched.
const assert = require('assert');
const {createAliceMalloryThreadFixture} =
    require('./test_alice_mallory_thread_setup.js');
const ChurchSimulator = require('./simulator.js');

const {sim, threadSlots, bodies, roles, nextBase} =
    createAliceMalloryThreadFixture();
const AL = 0xE;
const managerSlot = 32;
const aliceDriverSlot = 33;
const instruction = (opcode, dst, src, imm) =>
    sim.encodeInstruction(opcode, AL, dst, src, imm);
const iadd = (dst, value) => instruction(21, dst, 0, 0x4000 | value);
const change = (dst, slot) => instruction(4, dst, 15, slot);

function installDriver(slot, base, code, label) {
    assert(!sim.readNSEntry(slot), `${label} slot must be unused`);
    const words = Array(64).fill(0);
    words[0] = sim.packLumpHeader(0, code.length, 1, 0);
    code.forEach((word, i) => { words[1 + i] = word; });
    words[63] = ChurchSimulator.SELF_CAPABILITY_PLACEHOLDER;
    const header = sim.parseLumpHeader(words[0]);
    assert(header.valid && header.typ === 0 && header.cc === 1 &&
        header.cw === code.length && header.lumpSize === words.length,
    `${label} executable header must be valid`);
    assert(base + words.length <= sim.NS_TABLE_BASE &&
        sim.memory.slice(base, base + words.length).every(word => word === 0),
    `${label} must occupy empty fixture-only RAM`);
    const free = sim.mintStep7Freespace(words, header);
    assert(free.ok, `${label} invalid freespace: ${free.code || free.detail}`);
    const minted = sim._mintOrdinaryLumpIdentity(words, slot, base,
        {compilerOwnedSelf: true});
    assert(minted.ok, `${label} identity: ${minted.message}`);
    sim.memory.set(minted.words, base);
    sim.withNamespaceWrite('isolated Thread roundtrip driver fixture', () => {
        sim.writeNSEntry(slot, base, header.cw, 0, 0, 1,
            minted.entry.seq, header.cc, minted.entry.cacheToken);
    });
    assert.strictEqual(sim.memory[base + 63], minted.selfGT,
        `${label} c-list row 0 is the minted SELF Enter GT`);
    assert.strictEqual(sim.mLoad(minted.selfGT, 'E', 14).ok, true,
        `${label} Enter authority resolves`);
    return {slot, base, gt: minted.selfGT, header};
}

// DR0 starts at zero in each Thread. The manager's CHANGE must suspend at
// its next instruction so the restored manager can write DR2=303.
const manager = installDriver(managerSlot, nextBase, [
    iadd(1, 101),
    change(14, threadSlots[1]),
    iadd(2, 303),
], 'Boot.Thread manager');
const alice = installDriver(aliceDriverSlot, nextBase + 64, [
    iadd(1, 202),
    change(15, threadSlots[0]),
    iadd(2, 404), // Valid continuation if Alice is resumed in a later round.
], 'Alice-context driver');
assert.strictEqual(sim.dr[0], 0, 'manager DR0 is zero');
assert.strictEqual(sim.memory[bodies[1].base + bodies[1].layout.drStart], 0,
    'Alice-context DR0 is zero');

const aliceBody = bodies[1];
const malloryBody = bodies[2];
const aliceCR0 = aliceBody.base + aliceBody.layout.capsStart;
const aliceCR1 = aliceCR0 + 1;
const malloryCR1 = malloryBody.base + malloryBody.layout.capsStart + 1;
const malloryBefore = sim.memory.slice(
    malloryBody.base, malloryBody.base + malloryBody.layout.lumpSize);
assert.strictEqual(sim.memory[aliceCR1], roles[0].gt, 'Alice CR1 retains Alice E');
assert.strictEqual(sim.memory[malloryCR1], roles[1].gt, 'Mallory CR1 retains Mallory E');
sim.memory[aliceCR0] = alice.gt;
const aliceRoot = sim._formatThreadRootSentinel(
    aliceBody.base, aliceBody.layout, alice.gt, {image: true});
assert(aliceRoot, 'Alice context has a canonical driver CHURCH root');
assert.strictEqual(sim._readThreadResumeFrame(
    aliceBody.base, aliceBody.layout, aliceBody.slot).parsed.index, alice.slot,
'Alice root Enter identity names its driver, not the saved Alice binary');

// Canonical boot already owns the live manager banks. Install its fixture
// executable through the existing header/CR helpers, never by swapping banks.
const managerEntry = sim.readNSEntry(manager.slot);
sim._writeCR(0, manager.gt, managerEntry);
sim._installLumpHeaderContext(sim.parseGT(manager.gt), manager.slot,
    managerEntry, manager.header);
sim.pc = 0; // Fixture driver begins at its own first instruction, not boot's NIA.
assert.strictEqual(sim.cr[14].word0 & 0xFFFF, manager.slot,
    'live manager CR14 names its fixture driver');
assert.strictEqual(sim._currentThreadSlot, threadSlots[0],
    'Boot.Thread remains manager before stepping');
assert.strictEqual(sim.dr[0], 0, 'manager DR0 remains zero');

const retired = [];
for (let i = 0; i < 5; i++) {
    assert(!sim.halted, `unexpected HALT before instruction ${i + 1}`);
    const owner = sim._currentThreadSlot;
    const pc = sim.pc;
    const result = sim.step();
    assert(result && result.instr && !result.skipped,
        `instruction ${i + 1} must retire via sim.step`);
    assert.strictEqual(sim.faultLog.length, 0,
        `instruction ${i + 1} fault: ${sim.faultLog.at(-1)?.message}`);
    retired.push({owner, pc, physicalPC: result.physicalPC,
        opcode: result.instr.opcode, dst: result.instr.crDst,
        target: result.instr.imm});
    if (i === 3) {
        assert.strictEqual(sim._currentThreadSlot, threadSlots[0],
            'Alice CHANGE returned control to Boot.Thread');
        assert.strictEqual(sim.dr[1], 101, 'manager DR1 restored from its own Thread');
        assert.strictEqual(sim.memory[aliceBody.base + aliceBody.layout.drStart + 1],
            202, 'Alice DR1 saved in its own Thread');
        assert.strictEqual(sim.cr[14].word0 & 0xFFFF, manager.slot,
            'manager Enter identity restored from its CHURCH frame');
        assert.strictEqual(sim._unpackProtectedIndicator(sim.memory[
            aliceBody.base + aliceBody.layout.protectedStoOffset]).sz, 1,
        'Alice suspended state has a canonical CHURCH indicator');
        assert.deepStrictEqual(sim.memory.slice(
            malloryBody.base, malloryBody.base + malloryBody.layout.lumpSize),
        malloryBefore, 'Mallory body untouched throughout handoff');
    }
    if (sim.dr[2] === 303) break;
}
const expected = [
    {owner: 1, pc: 0, physicalPC: manager.base + 1, opcode: 21, dst: 1, target: 0x4065},
    {owner: 1, pc: 1, physicalPC: manager.base + 2, opcode: 4, dst: 14, target: 11},
    {owner: 11, pc: 0, physicalPC: alice.base + 1, opcode: 21, dst: 1, target: 0x40CA},
    {owner: 11, pc: 1, physicalPC: alice.base + 2, opcode: 4, dst: 15, target: 1},
    {owner: 1, pc: 2, physicalPC: manager.base + 3, opcode: 21, dst: 2, target: 0x412F},
];
console.log('[ROUNDTRIP] retired ' + JSON.stringify(retired));
assert.deepStrictEqual(retired, expected,
    'CHANGE must save the following NIA: manager must retire its DR2=303 continuation, ' +
    'not repeat the CHANGE instruction on resume');
assert.strictEqual(sim._currentThreadSlot, 1, 'manager owns live registers');
assert.strictEqual(sim._liveThreadOwned, true, 'manager is live');
assert.strictEqual(sim.dr[1], 101, 'manager private DR1 survives the roundtrip');
assert.strictEqual(sim.dr[2], 303, 'manager continuation executes');
assert.strictEqual(sim.memory[aliceBody.base + aliceBody.layout.drStart + 1], 202,
    'Alice saved DR1 holds 202');
const aliceResume = sim._readThreadResumeFrame(
    aliceBody.base, aliceBody.layout, aliceBody.slot);
assert.strictEqual(aliceResume.parsed.index, alice.slot,
    'Alice suspended CHURCH Enter names its driver');
assert.strictEqual(aliceResume.frame.returnPC, 2,
    'Alice suspended frame saves the instruction following CHANGE');
assert.strictEqual(sim.cr[14].word0 & 0xFFFF, manager.slot,
    'manager execution identity restored');
assert.deepStrictEqual(sim.memory.slice(
    malloryBody.base, malloryBody.base + malloryBody.layout.lumpSize),
malloryBefore, 'dormant Mallory Thread entire body unchanged');
assert.strictEqual(sim.faultLog.length, 0, 'no machine fault');
console.log('[PASS] instruction-driven Boot.Thread -> Thread.2 -> Boot.Thread roundtrip; ' +
    'manager DR1=101, Alice DR1=202, continuation DR2=303, Mallory unchanged.');

// A switch requested between instructions has not retired the pending
// instruction. Its CHURCH frame must retain that exact NIA, unlike the CHANGE
// at manager PC 1 above (whose frame recorded PC 2).
sim.pc = 2;
sim.flags = {N: true, Z: false, C: true, V: false};
const pendingFlags = {...sim.flags};
assert.strictEqual(sim.selectConfiguredThread(threadSlots[1]).ok, true);
assert.strictEqual(sim._readThreadResumeFrame(
    bodies[0].base, bodies[0].layout, threadSlots[0]).frame.returnPC, 2,
'manual selection saves the pending PC without advancing it');
assert.strictEqual(sim.selectConfiguredThread(threadSlots[0]).ok, true);
assert.strictEqual(sim.pc, 2, 'manual switch restores pending instruction PC');
assert.deepStrictEqual(sim.flags, pendingFlags, 'manual switch preserves private flags');

// Direct callers supply the same pending NIA; the execution boundary alone
// supplies a following NIA for an instruction that has retired.
const direct = {crDst: 14, crSrc: 15, imm: threadSlots[1], mnemonic: 'CHANGE'};
assert(sim._execChange(direct, sim.pc), 'direct switch succeeds');
assert.strictEqual(sim._readThreadResumeFrame(
    bodies[0].base, bodies[0].layout, threadSlots[0]).frame.returnPC, 2,
'direct switch saves the pending PC unchanged');
assert(sim._execChange({...direct, imm: threadSlots[0]}, sim.pc),
    'direct return succeeds');
assert.strictEqual(sim.pc, 2, 'direct return restores pending PC');

// Invalid incoming frame is rejected before outgoing homes or frame change.
const aliceIndicator = sim._unpackProtectedIndicator(
    sim.memory[aliceBody.base + aliceBody.layout.protectedStoOffset]);
const aliceEnterAddr = aliceBody.base + aliceIndicator.sto + 1;
const validEnter = sim.memory[aliceEnterAddr];
sim.memory[aliceEnterAddr] = 0;
const beforeReject = sim.memory.slice(
    bodies[0].base, bodies[0].base + bodies[0].layout.lumpSize);
assert.strictEqual(sim._execChange(direct, sim.pc), null,
    'invalid incoming Enter rejects direct switch');
assert.strictEqual(sim._currentThreadSlot, threadSlots[0],
    'rejection retains outgoing ownership');
assert.deepStrictEqual(sim.memory.slice(
    bodies[0].base, bodies[0].base + bodies[0].layout.lumpSize),
beforeReject, 'rejection leaves outgoing private object untouched');
sim.memory[aliceEnterAddr] = validEnter;
sim.halted = false; // The expected fault latches HALT; the next fixture is independent.

// A failed condition skips CHANGE without entering its handoff path.
const skipDriver = installDriver(34, nextBase + 128, [
    iadd(1, 1),
    sim.encodeInstruction(4, 0, 14, 15, threadSlots[1]), // CHANGEEQ
    iadd(2, 1),
], 'conditional-skip driver');
const skipEntry = sim.readNSEntry(skipDriver.slot);
sim._writeCR(0, skipDriver.gt, skipEntry);
sim._installLumpHeaderContext(sim.parseGT(skipDriver.gt),
    skipDriver.slot, skipEntry, skipDriver.header);
sim.pc = 1;
sim.flags.Z = false;
const beforeSkip = sim.memory.slice(
    bodies[0].base, bodies[0].base + bodies[0].layout.lumpSize);
const skipped = sim.step();
assert(skipped && skipped.skipped,
    `CHANGEEQ must skip when Z is false: ${sim.faultLog.at(-1)?.message || 'no fault'}; halted=${sim.halted}`);
assert.strictEqual(sim.pc, 2, 'skipped CHANGE advances the pending PC normally');
assert.strictEqual(sim._currentThreadSlot, threadSlots[0],
    'skipped CHANGE does not select the incoming Thread');
assert.deepStrictEqual(sim.memory.slice(
    bodies[0].base, bodies[0].base + bodies[0].layout.lumpSize),
beforeSkip, 'skipped CHANGE does not suspend outgoing private state');
console.log('[PASS] manual/direct pending NIA, rejection atomicity, conditional skip.');