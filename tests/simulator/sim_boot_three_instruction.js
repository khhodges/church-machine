// Regression coverage for the architectural three-instruction boot ROM.
// Run directly: node tests/simulator/sim_boot_three_instruction.js
const assert = require('assert');
const fs = require('fs');
const ChurchSimulator = require('../../simulator/simulator.js');

const sim = new ChurchSimulator();

// Imports must reject the retired in-range NIA=0 frame even though its Enter
// identity and stack geometry are otherwise valid.
{
    const staleWords = sim.memory.slice();
    const staleThread = sim.getThreadInstanceLayout(1);
    staleWords[staleThread.base + staleThread.stackEnd] =
        sim._packFrameWordRaw(0, 1, staleThread.stackEnd);
    const importer = new ChurchSimulator();
    assert.strictEqual(
        importer.loadBootImage(new Uint8Array(staleWords.buffer)),
        false,
        'boot-image import accepted the retired non-sentinel Thread root');
}

// Selection failure is atomic: neither the prior home nor Header V2 W4 moves.
const beforeHome = sim.inspectBootEntryBinding().homeGT;
const beforeHeader = sim.memory[4] >>> 0;
const rejected = sim.prepareBootEntry(255);
assert.strictEqual(rejected.ok, false, 'invalid boot selection must reject');
assert.strictEqual(sim.memory[4] >>> 0, beforeHeader, 'rejected selection changed Header V2');
assert.strictEqual(sim.inspectBootEntryBinding().homeGT, beforeHome,
    'rejected selection changed Boot.Thread CR0 home');

// Reissue the selected entry with a non-zero sequence, then prepare it. This
// catches the former hard-coded sequence-zero selection write.
const selected = sim.bootEntrySlot;
const entry = sim.readNSEntry(selected);
sim.withNamespaceWrite('boot three-instruction regression', () => {
    sim.writeNSEntry(selected, entry.word0_location,
        sim.parseNSWord1(entry.word1_limit).limit, 0, 0, 1, 7, 0, 0);
});
const prepared = sim.prepareBootEntry(selected);
assert.strictEqual(prepared.ok, true, 'valid executable boot selection must prepare');
assert.strictEqual(prepared.sequence, 7, 'prepared GT did not use live NS sequence');
assert.strictEqual(sim.inspectBootEntryBinding().ok, true, 'prepared binding is not coherent');

// Before the ROM consumes it, the prepared dormant frame occupies exactly
// +238..+243: four untouched stack words, Enter E-GT, and the canonical
// poison-root sentinel with saved STO=stackEnd.
{
    const threadBase = sim.getThreadInstanceLayout(1).base;
    assert.deepStrictEqual(
        Array.from(sim.memory.slice(threadBase + 238, threadBase + 244),
            word => word >>> 0),
        [0, 0, 0, 0, prepared.gt >>> 0,
            sim._packFrameWordRaw(0x7FFF, 1, 243)],
        'prepared raw Thread words +238..+243 are not canonical');
}

let retired = 0;
while (!sim.bootComplete && !sim.halted && retired < 4) {
    assert.strictEqual(sim._bootStep(), true, 'boot instruction did not retire');
    retired++;
}
assert.strictEqual(retired, 3, 'boot retired anything other than three instructions');
assert.strictEqual(sim.bootComplete, true, 'three-instruction boot did not complete');
assert.strictEqual(sim.halted, false, 'three-instruction boot faulted');
assert.deepStrictEqual(sim.bootProgress.map(row => row.instruction), [
    'LOAD CR15, CR15[0]', 'CHANGE CR12, CR15[1]', 'CALL CR0',
]);
assert(sim.bootProgress.every(row => row.status === 'completed'),
    'all three boot progress records must complete');
assert(sim.bootProgress.every(row => row.attemptId === sim.bootAttemptId),
    'boot records must be scoped to the current attempt');
assert.strictEqual(sim.cr[0].word0 >>> 0, prepared.gt,
    'CHANGE did not restore prepared CR0 home before CALL');
assert.notStrictEqual(sim.cr[5].word0 >>> 0, 0,
    'CHANGE CR12 did not restore the Thread heap capability');
assert.strictEqual(sim.callStack.length, 1, 'root CALL did not leave its sentinel frame');
assert.strictEqual(sim.callStack[0].sentinel, true, 'root CALL frame is not the reset sentinel');
assert.strictEqual(sim.callStack[0].returnPC, 0x7FFF, 'root sentinel return PC is not poison');

// The canonical 256-word Thread has stackEnd=243.  Keep the six words at the
// raw stack/capability boundary explicit: no hidden companion or frame may be
// shifted into +238..+241, and the two CHURCH words must be the exact live
// boot identity and poison sentinel frame.
{
    const threadBase = sim.getThreadInstanceLayout(1).base;
    assert.deepStrictEqual(
        Array.from(sim.memory.slice(threadBase + 238, threadBase + 244),
            word => word >>> 0),
        [0, 0, 0, 0, prepared.gt >>> 0,
            sim._packFrameWordRaw(0x7FFF, 1, 243)],
        'raw Thread words +238..+243 do not match canonical root frame');
}

// Exact ROM words are independently encoded from the instruction definition.
assert.deepStrictEqual(sim.bootProgress.map(row => row.word >>> 0), [
    sim.encodeInstruction(0, 14, 15, 15, 0),
    sim.encodeInstruction(4, 14, 12, 15, 1),
    sim.encodeInstruction(2, 14, 0, 0, 0),
], 'boot progress words do not match LOAD/CHANGE/CALL opcode encodings');

// Root RETURN sees the sentinel, not a fabricated boot-ROM continuation.
sim._execReturn({ opcode: 3, cond: 14, imm: 0, mnemonic: 'RETURN' });
assert.strictEqual(sim.faultLog.at(-1).type, 'STACK_UNDERFLOW',
    'root RETURN must fault through the sentinel');

// Frame admission rejects a gap and a stale Enter companion before either
// image can become live.
{
    const gap = new ChurchSimulator();
    assert(gap._bootStep(), 'gap probe: LOAD failed');
    const gapLayout = gap.getThreadInstanceLayout(1);
    gap.memory[gapLayout.base + 17] =
        gap._packProtectedIndicator(gapLayout.stackEnd - 3, 1, {}, 0);
    assert.strictEqual(gap._bootStep(), false, 'malformed frame gap was admitted');
    assert(['TYPE', 'PERM_E'].includes(gap.faultLog.at(-1).type));
}
{
    const companion = new ChurchSimulator();
    assert(companion._bootStep(), 'companion probe: LOAD failed');
    const companionLayout = companion.getThreadInstanceLayout(1);
    const otherEntry = companion.readNSEntry(10);
    const otherSeq = companion.parseNSWord1(otherEntry.word1_limit).gtSeq;
    companion.memory[companionLayout.base + companionLayout.stackEnd - 1] =
        companion.createGT(otherSeq, 10, { E: 1 }, 1);
    assert.strictEqual(companion._bootStep(), false,
        'stale CHURCH Enter companion was admitted');
    assert(['TYPE', 'BOUNDS'].includes(companion.faultLog.at(-1).type),
        'stale companion reached an unexpected gate');
}

// A root transaction cannot install a second sentinel.  A corrupted previous
// STO cannot loop RETURN back into itself, while a valid nested frame unwinds
// to the original root sentinel exactly once.
{
    const duplicate = new ChurchSimulator();
    runToCall(duplicate);
    assert.strictEqual(duplicate._execCall({
        opcode: 2, cond: 14, crDst: 0, crSrc: 0, imm: 0,
        mnemonic: 'CALL', bootRootContext: true,
    }), null, 'duplicate root sentinel was admitted');
    assert.strictEqual(duplicate.faultLog.at(-1).type, 'STACK_CORRUPT');
}
{
    const loop = new ChurchSimulator();
    runToCall(loop);
    const loopLayout = loop.getThreadInstanceLayout(1);
    const frameAddr = loop._unpackProtectedIndicator(
        loop.memory[loopLayout.base + 17] >>> 0).sto + 2;
    const frameWord = loop.memory[loopLayout.base + frameAddr] >>> 0;
    loop.memory[loopLayout.base + frameAddr] =
        (frameWord & ~0xFFF) |
        ((frameAddr - 2) & 0xFFF);
    assert.strictEqual(loop._execReturn({
        opcode: 3, cond: 14, imm: 0, mnemonic: 'RETURN',
    }), null, 'looping previous STO was admitted');
    assert.strictEqual(loop.faultLog.at(-1).type, 'STACK_CORRUPT');
}
{
    const zeroCompanion = new ChurchSimulator();
    runToCall(zeroCompanion);
    const zeroLayout = zeroCompanion.getThreadInstanceLayout(1);
    const zeroStoAddress = zeroLayout.base + 17;
    const beforeStoWord = zeroCompanion.memory[zeroStoAddress] >>> 0;
    const zeroFrameAddress = (beforeStoWord & 0xFFF) + 2;
    zeroCompanion.memory[zeroLayout.base + zeroFrameAddress - 1] = 0;
    assert.strictEqual(zeroCompanion._execReturn({
        opcode: 3, cond: 14, imm: 0, mnemonic: 'RETURN',
    }), null, 'zero Enter companion was admitted');
    assert(['TYPE', 'PERM_E'].includes(zeroCompanion.faultLog.at(-1).type));
    assert.strictEqual(zeroCompanion.memory[zeroStoAddress] >>> 0,
        beforeStoWord, 'zero companion fault mutated protected STO');
}
{
    const nested = new ChurchSimulator();
    runToCall(nested);
    assert(nested._execCall({
        opcode: 2, cond: 14, crDst: 0, crSrc: 0, imm: 0, mnemonic: 'CALL',
    }), 'nested CALL failed');
    assert(nested._execCall({
        opcode: 2, cond: 14, crDst: 0, crSrc: 0, imm: 0, mnemonic: 'CALL',
    }), 'second nested CALL failed');
    const nestedLayout = nested.getThreadInstanceLayout(1);
    const nestedGT = nested.cr[0].word0 >>> 0;
    assert.deepStrictEqual(
        Array.from(nested.memory.slice(nestedLayout.base + 238,
            nestedLayout.base + 244), word => word >>> 0),
        [nestedGT, nested._packFrameWordRaw(2, 1, 239),
            nestedGT, nested._packFrameWordRaw(2, 1, 241),
            nestedGT, nested._packFrameWordRaw(0x7FFF, 1, 243)],
        'nested raw Thread +238..+243 lost a contiguous frame pair');
    assert.strictEqual(nested.callStack.length, 3);
    assert(nested._execReturn({
        opcode: 3, cond: 14, imm: 0, mnemonic: 'RETURN',
    }), 'nested RETURN failed');
    assert.strictEqual(nested.callStack.length, 2,
        'first nested RETURN did not consume exactly one frame');
    assert(nested._execReturn({
        opcode: 3, cond: 14, imm: 0, mnemonic: 'RETURN',
    }), 'second nested RETURN failed');
    assert.strictEqual(nested.callStack.length, 1,
        'second nested RETURN did not consume exactly one frame');
    assert.strictEqual(nested.callStack[0].sentinel, true);
}
{
    const noSnapshot = new ChurchSimulator();
    runToCall(noSnapshot);
    assert(noSnapshot._execCall({
        opcode: 2, cond: 14, crDst: 0, crSrc: 0, imm: 0, mnemonic: 'CALL',
    }), 'no-snapshot nested CALL failed');
    const noSnapshotLayout = noSnapshot.getThreadInstanceLayout(1);
    // Deliberately retain an unrelated diagnostic shadow entry.  It must not
    // select the frame or redirect the packed NIA/STO return.
    noSnapshot.callStack = [{
        frameAddress: noSnapshotLayout.stackEnd,
        returnPC: 0x1234,
        savedCRs: null, savedDRs: null, savedFlags: null,
        sz: 1,
    }];
    assert(noSnapshot._execReturn({
        opcode: 3, cond: 14, imm: 0, mnemonic: 'RETURN',
    }), 'valid protected RETURN required a JS snapshot');
    assert.strictEqual(noSnapshot.pc, 2,
        'mismatched callStack redirected packed return NIA');
    assert.strictEqual(noSnapshot.callStack.length, 1,
        'RETURN popped an unrelated diagnostic shadow entry');
    const noSnapshotCR6 = noSnapshot.parseGT(noSnapshot.cr[6].word0);
    const noSnapshotCR14 = noSnapshot.parseGT(noSnapshot.cr[14].word0);
    assert.strictEqual(noSnapshotCR6.permissions.L, 1,
        'no-snapshot RETURN did not reconstruct caller CR6 L');
    assert.strictEqual(noSnapshotCR6.permissions.E, 0,
        'no-snapshot RETURN reconstructed caller CR6 with E');
    assert.strictEqual(noSnapshotCR14.permissions.X, 1,
        'no-snapshot RETURN did not reconstruct caller CR14 RX');
    assert.strictEqual(
        noSnapshot.memory[noSnapshotLayout.base + 17] & 0xFFF,
        noSnapshotLayout.stackEnd - 2,
        'valid no-snapshot RETURN did not restore protected predecessor STO');
}

function runToCall(machine) {
    assert(machine._bootStep(), 'LOAD CR15 failed unexpectedly');
    assert(machine._bootStep(), 'CHANGE CR12 failed unexpectedly');
    machine._bootStep();
}

// CALL authority is the CR0 restored by CHANGE. A competing UI-slot mutation
// after CHANGE cannot redirect the already-restored capability.
{
    const midBoot = new ChurchSimulator();
    assert(midBoot._bootStep());
    assert(midBoot._bootStep());
    const cr0Before = midBoot.cr[0].word0 >>> 0;
    midBoot.bootEntrySlot = 7; // adversarial stale UI state; no prepare transaction
    assert(midBoot._bootStep(), 'CALL must consume restored CR0, not UI slot');
    assert.strictEqual(midBoot.cr[0].word0 >>> 0, cr0Before);
    assert.strictEqual(midBoot.parseGT(midBoot.cr[14].word0).index,
        midBoot.parseGT(cr0Before).index, 'mid-boot UI change redirected CALL');
}

function expectCallFault(name, replacement, expectedType) {
    const machine = new ChurchSimulator();
    assert(machine._bootStep(), `${name}: LOAD failed`);
    const home = machine.inspectBootEntryBinding().homeAddress;
    machine.memory[home] = replacement >>> 0;
    assert(machine._bootStep(), `${name}: CHANGE did not retire`);
    assert.strictEqual(machine._bootStep(), false, `${name}: CALL unexpectedly retired`);
    const fault = machine.faultLog.at(-1);
    assert.strictEqual(fault.type, expectedType, `${name}: wrong real CALL gate`);
    assert(fault.bootEvidence, `${name}: missing immutable boot fault evidence`);
    assert.strictEqual(fault.bootEvidence.attemptId, machine.bootAttemptId);
    assert.strictEqual(fault.bootEvidence.instructionWord,
        machine.bootProgress[2].word >>> 0);
    assert.strictEqual(fault.bootEvidence.bootRomAddress, 2);
    assert.strictEqual(fault.bootEvidence.domain, 'boot-rom');
    assert.strictEqual(fault.bootEvidence.provenanceRegister, 'CR0');
    assert.strictEqual(fault.bootEvidence.gate, expectedType);
}

expectCallFault('null CR0', 0, 'NULL_CAP');
{
    const nullProbe = new ChurchSimulator();
    assert(nullProbe._bootStep());
    nullProbe.memory[nullProbe.inspectBootEntryBinding().homeAddress] = 0;
    assert(nullProbe._bootStep());
    assert.strictEqual(nullProbe._bootStep(), false);
    const evidence = nullProbe.faultLog.at(-1).bootEvidence;
    assert.strictEqual(evidence.slot, null, 'NULL GT evidence must not decode slot 0');
    assert.strictEqual(evidence.sequence, null, 'NULL GT evidence must not decode sequence 0');
    assert.strictEqual(evidence.evidenceProvenance, 'simulator-exact-boot-program');
}
{
    const denied = new ChurchSimulator();
    const deniedGT = denied.createGT(
        denied.readNSEntry(denied.bootEntrySlot).gtSeq,
        denied.bootEntrySlot, { R: 1 }, 1);
    expectCallFault('non-E CR0', deniedGT, 'PERMISSION');
}
{
    const stale = new ChurchSimulator();
    const selectedEntry = stale.readNSEntry(stale.bootEntrySlot);
    const oldGT = stale.inspectBootEntryBinding().homeGT;
    stale.withNamespaceWrite('stale boot GT regression', () => {
        stale.writeNSEntry(stale.bootEntrySlot, selectedEntry.word0_location,
            stale.parseNSWord1(selectedEntry.word1_limit).limit, 0, 0, 1, 9, 0, 0);
    });
    assert(stale._bootStep(), 'stale CR0: LOAD failed');
    const home = stale.inspectBootEntryBinding().homeAddress;
    stale.memory[home] = oldGT;
    assert.strictEqual(stale._bootStep(), false,
        'stale CHURCH companion was admitted by CHANGE');
    const fault = stale.faultLog.at(-1);
    assert.strictEqual(fault.type, 'VERSION',
        'stale CHURCH companion reached an unexpected gate');
    assert.strictEqual(stale.memory[stale.getThreadInstanceLayout(1).base + 17] & 0xFFF,
        241, 'rejected stale companion mutated protected STO');
}

// Malformed Thread geometry is rejected by CHANGE and carries B:01 evidence.
{
    const malformed = new ChurchSimulator();
    assert(malformed._bootStep());
    const thread = malformed.readNSEntry(1);
    malformed.memory[thread.word0_location] = 0;
    assert.strictEqual(malformed._bootStep(), false);
    const fault = malformed.faultLog.at(-1);
    assert(fault.bootEvidence, 'malformed Thread fault lacks boot evidence');
    assert.strictEqual(fault.bootEvidence.bootRomAddress, 1);
    assert.strictEqual(fault.bootEvidence.provenanceRegister, 'CR15');
}

// A recovery reset starts a new attempt and retains reset/call-home as events,
// never as extra instruction-progress rows.
{
    const recovered = new ChurchSimulator();
    runToCall(recovered);
    assert(recovered.bootComplete);
    const firstAttempt = recovered.bootAttemptId;
    recovered.fault('TEST_RECOVERY', 'force recovery attempt');
    recovered._returnToBoot();
    assert.strictEqual(recovered.bootProgress.length, 3);
    assert.strictEqual(recovered.bootAttemptId, firstAttempt + 1);
    runToCall(recovered);
    assert(recovered.bootComplete, 'fault recovery did not boot');
    assert(recovered.auditLog.some(row => row.stepCtx === 'RESET_EVENT'),
        'reset event was not retained separately');
    assert(recovered.auditLog.some(row => row.stepCtx === 'CALL_HOME_EVENT'),
        'call-home event was not retained separately');
}

// Import commits the binary byte-for-byte and its Header V2 target wins over
// an old browser/simulator selection. No post-copy descriptor "correction" is
// permitted.
{
    const priorWindow = global.window;
    global.window = { bootConfig: { step1: { totalNamespaceWords: 16384 } } };
    const imported = new ChurchSimulator();
    imported.bootEntrySlot = 6; // stale browser-side selection
    const bytes = fs.readFileSync('server/lumps/boot-image.bin');
    const expected = new Uint32Array(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    assert.strictEqual(imported.loadBootImage(expected.buffer), true,
        imported.lastBootImageError || 'import failed');
    assert.deepStrictEqual(Array.from(imported.memory), Array.from(expected),
        'loadBootImage mutated imported authority bytes');
    assert.strictEqual(imported.bootEntrySlot, 10,
        'old local selection overrode imported Header V2 authority');
    global.window = priorWindow;
}

// A full fallback reset builds its default image; it must not replay a prior
// prepared non-default slot into the new CR0 home as an implicit repair.
{
    const resetProbe = new ChurchSimulator();
    assert(resetProbe.prepareBootEntry(6).ok);
    resetProbe.bootEntrySlot = 10; // stale selection absent an explicit prepare
    resetProbe.reset();
    const home = resetProbe.getThreadInstanceLayout(1).base +
        resetProbe.getThreadInstanceLayout(1).capsStart;
    assert.strictEqual(resetProbe.parseGT(resetProbe.memory[home]).index,
        resetProbe._bootAbstrSlot, 'reset replayed stale selection into CR0 home');
}

console.log('sim_boot_three_instruction: PASS');