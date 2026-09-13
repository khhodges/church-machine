// Regression coverage for the architectural three-instruction boot ROM.
// Run directly: node tests/simulator/sim_boot_three_instruction.js
const assert = require('assert');
const fs = require('fs');
const ChurchSimulator = require('../../simulator/simulator.js');

const sim = new ChurchSimulator();

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
    assert(stale._bootStep(), 'stale CR0: CHANGE failed');
    assert.strictEqual(stale._bootStep(), false, 'stale CR0: CALL unexpectedly retired');
    const fault = stale.faultLog.at(-1);
    assert.strictEqual(fault.type, 'VERSION', 'stale CR0 did not reach CALL version gate');
    assert.strictEqual(fault.bootEvidence.bootRomAddress, 2);
    assert.strictEqual(fault.bootEvidence.provenanceRegister, 'CR0');
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