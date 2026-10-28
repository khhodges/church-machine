'use strict';
// Historical filename retained for the configured validation command.
// Normative CALL contract: exact E-only CR6 identity, c-list base, M=1.
const assert = require('node:assert/strict');
const {fixture, checkContext} = require('./cr6_contract_fixture');

// A Namespace access limit may exclude the tail c-list without truncating the
// physical allocation. CALL must bound code by that limit and derive CR6 from
// the validated LUMP header, never enlarge the Namespace's ordinary access.
for (const limit of [3, 4, 62, 63]) {
    const {sim} = fixture();
    const base = 0x200;
    sim.memory[base] = sim.packLumpHeader(0, 4, 1, 0);
    sim.memory[base + 1] = 2;
    sim.withNamespaceWrite('code access-bound fixture', () =>
        sim.writeNSEntry(30, base, limit, 0, 0, 1, 7, 1, 0));
    const gt = sim.createGT(7, 30, {E: 1}, 1);
    sim.cr[0].word0 = gt;
    const depth = sim.callStack.length;
    let fault;
    sim.fault = type => { fault = type; };
    const result = sim._execCall({crDst: 0, imm: 1});
    if (limit < 4) {
        assert.equal(result, null);
        assert.equal(fault, 'BOUNDS');
        assert.equal(sim.callStack.length, depth, 'failed admission must not push a frame');
    } else {
        assert(result);
        assert.equal(fault, undefined);
        checkContext(sim, {gt, base, clistBase: base + 63});
        assert.equal(sim.parseNSWord1(sim.readNSEntry(30).word1_limit).limit, limit,
            'CALL must not widen the stored Namespace access bound');
    }
}

// Mandatory dispatch offsets: executable BRANCH words are not table entries.
for (const [method, entry, target, fault] of [
    [1, 0xBF000001, null, 'BOUNDS'], [3, 0xBF007FFF, null, 'BOUNDS'],
    [1, 0xBF000003, null, 'BOUNDS'], [1, 2, 2, null], [1, 4, 4, null],
    [1, 0, null, 'PRIVATE_METHOD'],
    [1, 0xBF007FFF, null, 'BOUNDS'], [1, 0xBF004000, null, 'BOUNDS'],
    [1, 0xBF003FFF, null, 'BOUNDS'], [1, 0xBF000004, null, 'BOUNDS'],
    [1, 5, null, 'BOUNDS'], [1, 0xAF084001, null, 'BOUNDS'],
    [5, 2, null, 'BOUNDS'],
]) {
    const {sim} = fixture();
    const base = 0x200;
    sim.memory[base] = sim.packLumpHeader(0, 4, 1, 0);
    sim.withNamespaceWrite('dispatch fixture', () =>
        sim.writeNSEntry(30, base, 63, 0, 0, 1, 7, 1, 0));
    sim.memory[base + method] = entry >>> 0;
    const gt = sim.createGT(7, 30, {E: 1}, 1);
    sim.cr[0].word0 = gt;
    let actualFault;
    sim.fault = type => { actualFault = type; };
    const result = sim._execCall({crDst: 0, imm: method});
    if (fault) {
        assert.equal(result, null);
        assert.equal(actualFault, fault);
    } else {
        assert(result);
        assert.equal(actualFault, undefined);
        assert.equal(sim.pc, target - 1);
        checkContext(sim, {gt, base, clistBase: base + 63});
    }
}

// Both ordinary reconstruction paths: canonical header and legacy raw c-list.
for (const cc of [2, 0]) {
  for (const B of [0, 1]) {
    const {sim} = fixture();
    const slot = 30, base = 0x200, seq = 19;
    sim.memory[base] = sim.packLumpHeader(0, 3, cc, 0);
    sim.memory[base + 1] = 2;
    sim.withNamespaceWrite('CALL path fixture', () =>
        sim.writeNSEntry(slot, base, 63, 0, 0, 1, seq, cc, 0));
    const gt = sim.createGT(seq, slot, {E: 1, B}, 1);
    sim.cr[0].word0 = gt;
    const heap = {...sim.cr[5], word1: 123, m: 1};
    const window = {...sim.cr[13], word1: 456, m: 1};
    sim.cr[5] = {...heap};
    sim.cr[13] = {...window};
    sim.cr[4].m = 1;
    assert(sim._execCall({crDst: 0, imm: 1}));
    assert.equal(sim.cr[6].word0, gt);
    assert.equal(sim.cr[6].word1, cc ? base + 64 - cc : base);
    assert.equal(sim.cr[6].m, 1);
    assert.equal(sim.cr[4].m, 0);
    assert.deepEqual(sim.cr[5], {...heap, m: 0});
    assert.deepEqual(sim.cr[13], {...window, m: 0});
  }
}

// Real fetch/decode/execute, with no post-CALL register repair.
{
    const {sim, install, activate} = fixture();
    const callee = install(31, [2, sim.encodeInstruction(3, 14, 0, 0, 0)]);
    const caller = install(30, [2, sim.encodeInstruction(2, 14, 0, 0, 1)]);
    activate(caller);
    sim.pc = 1;
    sim.cr[0].word0 = callee.gt;
    assert.equal(sim.step().instr.opcode, 2);
    checkContext(sim, callee);
    assert.equal(sim.callStack[0].companionGT, caller.gt);
}
console.log('PASS CALL: E-only identity, both reconstruction paths, dispatch bounds and boundary resets');

// Nonzero generations must survive both directions, not be replaced by the
// callee generation or refreshed from a current Namespace entry.
{
    const {sim} = fixture();
    const caller = {slot: 30, base: 0x200, clistBase: 0x23F};
    const callee = {slot: 31, base: 0x300, clistBase: 0x33F};
    for (const [domain, seq] of [[caller, 19], [callee, 27]]) {
        sim.memory[domain.base] = sim.packLumpHeader(0, 3, 1, 0);
        sim.memory[domain.base + 1] = 2;
        sim.memory[domain.base + 2] = sim.encodeInstruction(3, 14, 0, 0, 0);
        sim.withNamespaceWrite('nonzero generation fixture', () =>
            sim.writeNSEntry(domain.slot, domain.base, 63, 0, 0, 1, seq, 1, 0));
        domain.gt = sim.createGT(seq, domain.slot, {E: 1}, 1);
    }
    sim._installLumpHeaderContext(sim.parseGT(caller.gt), caller.slot,
        sim.readNSEntry(caller.slot), sim.parseLumpHeader(sim.memory[caller.base]));
    sim.cr[0].word0 = callee.gt;
    sim.pc = 1;
    assert(sim._execCall({crDst: 0, imm: 1}));
    checkContext(sim, callee);
    assert.equal(sim.callStack.at(-1).companionGT, caller.gt);
    assert(sim.step());
    checkContext(sim, caller);
}

require('./sim_call_dispatch_required');
