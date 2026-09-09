'use strict';

// Round-robin Thread regression: the UI operation must use the generated
// Namespace order, wrap exactly once, preserve private state, and fail before
// mutating the current context when a target descriptor is invalid.
const assert = require('assert');
const vm = require('vm');
global.window = { bootConfig: { step1: {
    totalNamespaceWords: 16384, namespaceLumpWords: 1024,
    threadLumpWords: 512, threadCount: 3,
} } };
const ChurchSimulator = require('./simulator.js');
const ThreadDesign = require('./thread_design.js');
// Regenerate the exact three-Thread image inputs used by the IDE. This catches
// a later boot-resident catalog embedding pass overwriting Thread#2/#3 without
// depending on the workspace-only, ignored boot-image.bin file.
const fs = require('fs');
const { spawnSync } = require('child_process');
global.window.bootConfig.step1 = {
    totalNamespaceWords: 16384, namespaceLumpWords: 64,
    threadLumpWords: 512, threadCount: 3,
};
const committed = new ChurchSimulator();
const generated = spawnSync('python', ['-c', [
    'import json, sys',
    'from server.boot_image import generate_boot_image',
    'cfg=json.load(open("server/boot-config.json"))',
    'cfg["step1"].update({"totalNamespaceWords":16384,"namespaceLumpWords":64,"threadLumpWords":512,"threadCount":3})',
    'sys.stdout.buffer.write(generate_boot_image(cfg, "server/lumps"))',
].join(';')], { cwd: process.cwd(), encoding: null });
assert.strictEqual(generated.status, 0,
    `committed image inputs must regenerate: ${String(generated.stderr || '')}`);
const image = generated.stdout.buffer.slice(
    generated.stdout.byteOffset,
    generated.stdout.byteOffset + generated.stdout.byteLength);

function establishBootedThreadFixture(sim, label) {
    assert.strictEqual(sim.loadBootImage(image), true,
        `${label} image must load: ${sim.lastBootImageError || 'unknown error'}`);
    let bootSafety = 0;
    while (!sim.bootComplete && !sim.halted && bootSafety++ < 32) {
        sim._bootStep();
    }
    assert.strictEqual(sim.bootComplete, true, `${label} must complete canonical boot`);
    assert.strictEqual(sim._currentThreadSlot, 1,
        `${label} canonical boot selects Thread.1`);
    assert.strictEqual(sim._liveThreadOwned, true,
        `${label} canonical boot gives Thread.1 ownership of the live banks`);
    const threadEntry = sim.readNSEntry(1);
    assert(threadEntry, `${label} canonical boot Thread entry must exist`);
    assert.strictEqual(sim.cr[12].word1, threadEntry.word0_location,
        `${label} canonical boot installs the Thread.1 base in CR12`);
    assert.strictEqual(sim.parseGT(sim.cr[12].word0).index, 1,
        `${label} canonical boot installs the Thread.1 identity in CR12`);
    assert.strictEqual(sim.sto, sim._readProtectedSto(threadEntry.word0_location),
        `${label} canonical boot installs Thread.1 protected STO`);
    assert(sim.cr[14].word0 && !ChurchSimulator.isNullGT(sim.cr[14].word0),
        `${label} canonical boot installs an executable identity`);
    return sim;
}

function makeBootedThreadFixture(label) {
    return establishBootedThreadFixture(new ChurchSimulator(), label);
}

establishBootedThreadFixture(committed, 'committed fixture');
const retiredIdentityImage = image.slice(0);
const retiredIdentityWords = new Uint32Array(retiredIdentityImage);
assert.strictEqual(retiredIdentityWords[1], 0x4E534832,
    'current physical Namespace Header V2 tag is present at word 1');
retiredIdentityWords[1] = 0x4E534831;
const retiredIdentitySim = new ChurchSimulator();
assert.strictEqual(retiredIdentitySim.loadBootImage(retiredIdentityImage), false,
    'boot loader rejects a retired Namespace Header format tag');
assert(retiredIdentitySim.lastBootImageError.includes('Namespace Header V2'),
    'retired Thread ABI rejection requests regeneration');
committed.cr[15].word0 = 0x1A000000;
assert.deepStrictEqual(committed.configuredThreadSlots(), [1, 11, 12],
    'committed image exposes all three Thread contexts');
const committedBases = [1, 11, 12].map(slot => committed.readNSEntry(slot).word0_location);
const entryLayouts = committedBases.map(base => committed._threadLayoutAtBase(base));
assert(entryLayouts.every(layout => layout && layout.valid),
    'committed Thread headers expose valid derived geometry');
assert(entryLayouts.every(layout => layout.lumpSize === 512),
    'Thread fixture exercises supported non-256-word Threads');
assert(committedBases[0] + entryLayouts[0].lumpSize <= committedBases[1] &&
       committedBases[1] + entryLayouts[1].lumpSize <= committedBases[2],
    'committed Thread bodies are non-overlapping at their derived sizes');
const entryWords = [1, 11, 12].map((slot, i) =>
    committed.memory[committedBases[i] + entryLayouts[i].capsStart] >>> 0);
const thread1InitialDRs = Array.from(
    {length: 16}, (_, i) => (0xA1001000 + i) >>> 0);
const thread2InitialDRs = Array.from(
    {length: 16}, (_, i) => (0xB2002000 + i) >>> 0);
const thread3InitialDRs = Array.from(
    {length: 16}, (_, i) => (0xC3003000 + i) >>> 0);
committed.dr.splice(0, 16, ...thread1InitialDRs);
for (let i = 0; i < 16; i++) {
    committed.memory[committedBases[1] + 1 + i] = thread2InitialDRs[i];
    committed.memory[committedBases[2] + 1 + i] = thread3InitialDRs[i];
}
const targetCapsBefore = committed.memory.slice(
    committedBases[1] + entryLayouts[1].capsStart,
    committedBases[1] + entryLayouts[1].capsStart + 12);
const cr15Before = {...committed.cr[15]};
committed.halted = true;

// Simulator Thread admission must reject exactly the malformed Thread
// geometries rejected by hardware CHANGE preflight, before saving live state.
const targetHeaderOriginal = committed.memory[committedBases[1]] >>> 0;
const malformedThreadHeaders = [
    { name: 'zero stack', word: committed.packLumpHeader(3, 0, 64, 2) },
    { name: 'zero heap', word: committed.packLumpHeader(3, 32, 0, 2) },
    { name: 'overlapping heap and stack', word: committed.packLumpHeader(3, 220, 20, 2) },
    { name: 'unsupported allocation size', word: committed.packLumpHeader(8, 32, 64, 2) },
];
for (const malformed of malformedThreadHeaders) {
    committed.memory[committedBases[1]] = malformed.word;
    const drBeforeReject = [...committed.dr];
    const rejected = committed.advanceConfiguredThread();
    assert.strictEqual(rejected.ok, false,
        `${malformed.name} Thread is rejected by CHANGE admission`);
    assert.deepStrictEqual(committed.dr, drBeforeReject,
        `${malformed.name} rejection occurs before outgoing context save`);
    assert.strictEqual(committed._currentThreadSlot, 1,
        `${malformed.name} rejection does not activate the target`);
}
committed.memory[committedBases[1]] = targetHeaderOriginal;

assert.strictEqual(committed.advanceConfiguredThread().slot, 11);
assert.strictEqual(committed.halted, false,
    'manual CHANGE clears the outgoing HALT latch so execution controls can run');
assert.strictEqual(committed.cr[12].word1, committedBases[1],
    'manual CHANGE installs the selected Thread base into live CR12');
assert.strictEqual(committed.parseGT(committed.cr[12].word0).index, 11,
    'manual CHANGE installs the selected Thread identity into live CR12');
assert.deepStrictEqual(committed.dr, thread2InitialDRs,
    'manual CHANGE restores all sixteen saved DRs into the live register bank');
assert.strictEqual(committed.cr[0].word0, entryWords[1],
    'manual CHANGE restores saved CR0 into the live capability bank');
assert.strictEqual(committed.pc, 0,
    'dormant Thread uses direct selector PC 0 with the canonical code base');
assert.strictEqual(committed.cr[14].word0 & 0xFFFF,
    committed.cr[0].word0 & 0xFFFF, 'CR14 target is derived from restored CR0');
const firstEntry = committed.readNSEntry(committed.cr[0].word0 & 0xFFFF);
const firstHeader = committed.parseLumpHeader(
    committed.memory[firstEntry.word0_location] >>> 0);
const cr14Perms = committed.parseGT(committed.cr[14].word0).permissions;
const cr6Perms = committed.parseGT(committed.cr[6].word0).permissions;
assert.strictEqual(committed.cr[14].word1, firstEntry.word0_location,
    'CHANGE reloads CR14 with the canonical raw LUMP base');
assert.deepStrictEqual(
    {R: cr14Perms.R, W: cr14Perms.W, X: cr14Perms.X, L: cr14Perms.L},
    {R: 1, W: 0, X: 1, L: 0},
    'CHANGE header microcode reloads CR14 with RX permissions');
assert.strictEqual(committed.cr[14].m, 1,
    'CHANGE header microcode installs CR14 with the same M state as CALL');
assert.strictEqual(committed.cr[6].word1,
    firstEntry.word0_location + firstHeader.lumpSize - firstHeader.cc,
    'CHANGE header microcode reloads CR6 at the LUMP c-list tail');
assert.deepStrictEqual(
    {R: cr6Perms.R, W: cr6Perms.W, X: cr6Perms.X, L: cr6Perms.L},
    {R: 0, W: 0, X: 0, L: 1},
    'CHANGE header microcode reloads CR6 with L-only permissions');
assert.strictEqual(committed.cr[6].m, 1,
    'CHANGE header microcode installs CR6 with the same M state as CALL');
assert.strictEqual(committed.cr[6].word2, committed.cr[14].word2,
    'CR6 and CR14 share the validated Namespace limit metadata');
assert.strictEqual(committed.cr[6].word3, committed.cr[14].word3,
    'CR6 and CR14 share the validated Namespace seal metadata');
assert.deepStrictEqual(committed.cr[15], cr15Before,
    'manual Thread CHANGE does not replace the live Namespace root in CR15');
assert.deepStrictEqual(
    committed.memory.slice(
        committedBases[1] + entryLayouts[1].capsStart,
        committedBases[1] + entryLayouts[1].capsStart + 12),
    targetCapsBefore,
    'privileged restore reads the incoming capability homes without rewriting them');
assert.strictEqual(committed._fetchInstruction().addr,
    firstEntry.word0_location + 1,
    'first fetch after dormant CHANGE executes code LUMP word 1');
const selectedStep = committed.step();
assert(selectedStep,
    'Step executes after selecting a Thread that was switched from HALT');
assert.strictEqual(selectedStep.physicalPC, firstEntry.word0_location + 1,
    'Step executes the selected Thread entry rather than the outgoing context');
for (let i = 0; i < 16; i++) {
    committed.dr[i] = (0xD4004000 + i) >>> 0;
}
committed.pc = 0x2A;
committed.flags = {N: true, Z: false, C: true, V: false};
committed.sto = entryLayouts[1].stackEnd - 4;
const suspendedThread2 = {
    crWords: committed.cr.slice(0, 12).map(reg => reg.word0 >>> 0),
    dr: [...committed.dr],
    pc: committed.pc,
    flags: {...committed.flags},
    sto: committed.sto,
};
assert.strictEqual(committed.advanceConfiguredThread().slot, 12);
assert.strictEqual(committed.cr[12].word1, committedBases[2],
    'the next CHANGE moves live CR12 to Thread#3');
assert.deepStrictEqual(committed.dr, thread3InitialDRs,
    'the next CHANGE restores all sixteen Thread#3 data registers');
const dormantThread2Row = committed.threadStatusRows().find(row => row.slot === 11);
assert.strictEqual(dormantThread2Row.nia, 0x2A,
    'the dormant Thread card reads NIA from the CHANGE-saved Thread object');
assert.deepStrictEqual(dormantThread2Row.indicatorFlags, suspendedThread2.flags,
    'the dormant Thread card reads FLAGS from its own CHANGE-saved Thread object');
const thread2Indicator = committed._unpackProtectedIndicator(
    committed.memory[committedBases[1] + 17] >>> 0);
const thread2ResumeFrame = committed._unpackFrameWord(
    committed.memory[committedBases[1] + thread2Indicator.sto + 2] >>> 0);
assert.strictEqual(thread2ResumeFrame.returnPC, 0x2A,
    'CHANGE writes the outgoing NIA into the canonical CHURCH frame');
assert.strictEqual(committed.advanceConfiguredThread().slot, 1);
assert.strictEqual(committed.cr[0].word0, entryWords[0],
    'committed image restores Thread.1 CR0 entry authority after wraparound');
assert.deepStrictEqual(committed.dr, thread1InitialDRs,
    'committed image restores all sixteen Thread.1 DRs after wraparound');
assert.strictEqual(committed.cr[12].word1, committedBases[0],
    'wraparound restores Thread.1 as the live CR12 context');

// Run uses the same step engine as the Walk control.  A one-instruction run
// after manual CHANGE must therefore retire from the selected Thread too.
committed.halted = true;
assert.strictEqual(committed.advanceConfiguredThread().slot, 11);
assert.deepStrictEqual(committed.dr, suspendedThread2.dr,
    'CHANGE restores DRs from the selected Thread object');
assert.deepStrictEqual(
    committed.cr.slice(0, 12).map(reg => reg.word0 >>> 0),
    suspendedThread2.crWords,
    'CHANGE restores CR0–CR11 from the selected Thread object');
assert.strictEqual(committed.pc, suspendedThread2.pc,
    'CHANGE resumes at the NIA stored in the selected Thread object');
assert.deepStrictEqual(committed.flags, suspendedThread2.flags,
    'CHANGE restores condition flags from the selected Thread object');
assert.strictEqual(committed.sto, suspendedThread2.sto,
    'CHANGE restores protected STO from the selected Thread object');

// CHANGE must pass every non-NULL saved capability through mLoad before it
// saves the outgoing context or exposes any incoming register.
const invalidGT = makeBootedThreadFixture('invalid-GT fixture');
invalidGT.dr.splice(0, 16, ...thread1InitialDRs);
const invalidTargetBase = invalidGT.readNSEntry(11).word0_location;
const invalidTargetLayout = invalidGT._threadLayoutAtBase(invalidTargetBase);
const invalidTargetCR0Addr = invalidTargetBase + invalidTargetLayout.capsStart;
invalidGT.memory[invalidTargetCR0Addr] =
    (invalidGT.memory[invalidTargetCR0Addr] ^ 0x00010000) >>> 0;
const invalidOutgoingDRHomes = invalidGT.memory.slice(
    committedBases[0] + 1, committedBases[0] + 17);
const rejectedGT = invalidGT.advanceConfiguredThread();
assert.strictEqual(rejectedGT.ok, false,
    'CHANGE rejects a stale-generation GT restored from a Thread capability home');
assert.strictEqual(invalidGT._currentThreadSlot, 1,
    'failed mLoad validation does not activate the incoming Thread');
assert.deepStrictEqual(invalidGT.dr, thread1InitialDRs,
    'failed mLoad validation leaves all live outgoing DRs unchanged');
assert.deepStrictEqual(
    invalidGT.memory.slice(committedBases[0] + 1, committedBases[0] + 17),
    invalidOutgoingDRHomes,
    'failed mLoad validation occurs before saving any outgoing DR home');
assert.strictEqual(invalidGT.faultLog.at(-1).type, 'VERSION',
    'CHANGE surfaces the ISA mLoad generation fault');

const selectedRun = committed.run(1);
assert.strictEqual(selectedRun.steps, 1,
    'Run retires an instruction after selecting a Thread from HALT');
assert.strictEqual(committed.cr[12].word1, committedBases[1],
    'Run keeps the selected Thread installed as the live context');

// CapabilityTest's first LOAD may replace CR0 with SelfTest while execution
// remains in CapabilityTest. The CHURCH frame preserves that split.
const selfTestGT = entryWords[0];
const capEntry = committed.readNSEntry(10);
const capGT = committed.createGT(
    committed.parseNSWord1(capEntry.word1_limit).gtSeq, 10, {E: 1}, 1);
const capHeader = committed.parseLumpHeader(committed.memory[capEntry.word0_location]);
committed._installLumpHeaderContext(committed.parseGT(capGT), 10, capEntry, capHeader);
committed._writeCR(0, selfTestGT, committed.readNSEntry(selfTestGT & 0xFFFF));
committed.dr[3] = 0xCAFE0003;
committed.cr[2] = {...committed.cr[0]};
committed.pc = 0;
committed.flags = {N: true, Z: true, C: false, V: true};
committed.sto = entryLayouts[1].stackEnd - 6;
const capabilityPrivate = {
    dr3: committed.dr[3], cr2: committed.cr[2].word0, pc: committed.pc,
    flags: {...committed.flags}, sto: committed.sto,
};
assert.strictEqual(committed.cr[0].word0 & 0xFFFF, 6,
    'CapabilityTest first LOAD leaves CR0 at SelfTest');
assert.strictEqual(committed.cr[14].word0 & 0xFFFF, 10,
    'CapabilityTest execution identity remains CR14');
const capabilityToThread3 = committed.advanceConfiguredThread();
assert(capabilityToThread3.ok, `${capabilityToThread3.reason}; ${committed.lastFault || committed.faultMessage || ''}`);
assert.strictEqual(capabilityToThread3.slot, 12);
const thread3ToThread1 = committed.advanceConfiguredThread();
assert(thread3ToThread1.ok, thread3ToThread1.reason);
assert.strictEqual(thread3ToThread1.slot, 1);
const thread1ToThread2 = committed.advanceConfiguredThread();
assert(thread1ToThread2.ok, thread1ToThread2.reason);
assert.strictEqual(thread1ToThread2.slot, 11);
assert.strictEqual(committed.cr[0].word0 & 0xFFFF, 6,
    'switch-back retains the independently mutated CR0 identity');
assert.strictEqual(committed.cr[14].word0 & 0xFFFF, 10,
    'switch-back restores CapabilityTest through its CHURCH Enter frame');
assert.strictEqual(committed.dr[3], capabilityPrivate.dr3);
assert.strictEqual(committed.cr[2].word0, capabilityPrivate.cr2);
assert.strictEqual(committed.pc, capabilityPrivate.pc);
assert.deepStrictEqual(committed.flags, capabilityPrivate.flags);
assert.strictEqual(committed.sto, capabilityPrivate.sto);

// Switching saved images is a memory-image operation, not a boot-phase
// operation. It must work while the loaded image is stopped before boot.
const preBoot = new ChurchSimulator();
assert.strictEqual(preBoot.loadBootImage(image), true,
    `pre-boot fixture image must load: ${preBoot.lastBootImageError || 'unknown error'}`);
preBoot.bootComplete = false;
preBoot._currentThreadSlot = 1;
const preBootThread1Base = preBoot.readNSEntry(1).word0_location;
const preBootThread1Layout = preBoot._threadLayoutAtBase(preBootThread1Base);
const preBootThread1EntryGT = preBoot.memory[
    preBootThread1Base + preBootThread1Layout.capsStart] >>> 0;
assert.strictEqual(preBoot.cr[0].word0, 0,
    'pre-boot live CR0 starts reset and does not represent Thread.1');
assert.strictEqual(preBoot.advanceConfiguredThread().slot, 11,
    'saved Thread images can be selected before the boot ceremony runs');
assert.strictEqual(preBoot._liveThreadOwned, true,
    'the first pre-boot restore establishes live Thread ownership');
assert.strictEqual(preBoot.memory[
    preBootThread1Base + preBootThread1Layout.capsStart], preBootThread1EntryGT,
    'pre-boot browsing does not overwrite Thread.1 saved CR0 with reset live state');
const preBootThread2 = {
    dr3: 0xA1B2C3D4,
    cr2: preBoot.cr[2].word0,
    pc: 3,
    flags: { N: true, Z: false, C: true, V: false },
    sto: preBoot.sto,
};
preBoot.dr[3] = preBootThread2.dr3;
preBoot.pc = preBootThread2.pc;
preBoot.flags = { ...preBootThread2.flags };
assert.strictEqual(preBoot.selectConfiguredThread(1).slot, 1,
    'pre-boot browsing can revisit Thread.1 non-sequentially');
const thread2Base = preBoot.readNSEntry(11).word0_location;
const thread2Protected = preBoot._unpackProtectedIndicator(
    preBoot.memory[thread2Base + 17] >>> 0);
assert.strictEqual(thread2Protected.sz, 1,
    'switching away leaves the restored pre-boot Thread dormant with a protected CHURCH frame');
assert.strictEqual(preBoot.selectConfiguredThread(12).slot, 12,
    'pre-boot browsing can jump directly from Thread.1 to Thread.3');
assert.strictEqual(preBoot.selectConfiguredThread(11).slot, 11,
    'pre-boot browsing restores a previously active Thread');
assert.strictEqual(preBoot.dr[3], preBootThread2.dr3,
    'pre-boot switch-back restores the exact saved DR homes');
assert.strictEqual(preBoot.cr[2].word0, preBootThread2.cr2,
    'pre-boot switch-back restores the exact saved CR homes');
assert.strictEqual(preBoot.pc, preBootThread2.pc,
    'pre-boot switch-back restores the exact saved NIA');
assert.deepStrictEqual(preBoot.flags, preBootThread2.flags,
    'pre-boot switch-back restores the exact saved flags');
assert.strictEqual(preBoot.sto, preBootThread2.sto,
    'pre-boot switch-back restores the exact saved STO');
const preBootNoOpMemory = new Uint32Array(preBoot.memory);
assert.strictEqual(preBoot.selectConfiguredThread(11).unchanged, true,
    'selecting the active pre-boot Thread remains a no-op');
assert.deepStrictEqual(preBoot.memory, preBootNoOpMemory,
    'active pre-boot selection does not rewrite any Thread image');
assert.strictEqual(preBoot.selectConfiguredThread(1).slot, 1,
    'pre-boot browsing cycles back to Thread.1');
assert.strictEqual(preBoot.cr[0].word0, preBootThread1EntryGT,
    'cycling back restores Thread.1 original saved CR0');
assert.strictEqual(preBoot.faultLog.length, 0,
    'cycling among stopped saved images never raises a machine fault');
assert.strictEqual(preBoot.loadBootImage(new ArrayBuffer(0)), false,
    'a rejected replacement image remains non-mutating');
assert.strictEqual(preBoot._liveThreadOwned, true,
    'rejected image replacement preserves live Thread ownership');
assert.strictEqual(preBoot.loadBootImage(image), true,
    'a valid replacement image can replace an owned pre-boot context');
assert.strictEqual(preBoot._liveThreadOwned, false,
    'successful image replacement clears live Thread ownership');
const unownedSameSlot = preBoot.selectConfiguredThread(1);
assert.strictEqual(unownedSameSlot.ok, true,
    'selecting the displayed slot while unowned restores its Thread');
assert.strictEqual(unownedSameSlot.unchanged, undefined,
    'same-slot selection is only a no-op when that Thread owns the live banks');
assert.strictEqual(preBoot._liveThreadOwned, true,
    'same-slot restoration establishes ownership after image replacement');

assert.strictEqual(preBoot.selectConfiguredThread(11).slot, 11,
    'pre-boot boot-transition fixture selects a non-default Thread');
const beforeBootThread2 = {
    dr3: 0xC0DEC0DE,
    pc: 2,
    flags: { N: false, Z: true, C: false, V: true },
    sto: preBoot.sto,
};
preBoot.dr[3] = beforeBootThread2.dr3;
preBoot.pc = beforeBootThread2.pc;
preBoot.flags = { ...beforeBootThread2.flags };
let bootSafety = 0;
while (!preBoot.bootComplete && !preBoot.halted && bootSafety++ < 32) {
    preBoot._bootStep();
}
assert.strictEqual(preBoot.bootComplete, true,
    'boot completes after browsing a non-default Thread');
assert.strictEqual(preBoot._currentThreadSlot, 1,
    'boot synchronizes selection with the Thread installed into CR12');
assert.strictEqual(preBoot._liveThreadOwned, true,
    'boot establishes ownership for its installed Thread');
assert.strictEqual(preBoot.selectConfiguredThread(11).slot, 11,
    'the pre-boot selected Thread remains resumable after boot');
assert.strictEqual(preBoot.dr[3], beforeBootThread2.dr3,
    'boot preserves the pre-boot selected Thread data homes');
assert.strictEqual(preBoot.pc, beforeBootThread2.pc,
    'boot preserves the pre-boot selected Thread NIA');
assert.deepStrictEqual(preBoot.flags, beforeBootThread2.flags,
    'boot preserves the pre-boot selected Thread flags');
assert.strictEqual(preBoot.sto, beforeBootThread2.sto,
    'boot preserves the pre-boot selected Thread STO');

const invalidResumeFrame = makeBootedThreadFixture('resume-frame fixture');
const invalidCodeTargetBase = invalidResumeFrame.readNSEntry(11).word0_location;
const invalidCodeLayout = invalidResumeFrame._threadLayoutAtBase(invalidCodeTargetBase);
const invalidResumeSTO = invalidResumeFrame.memory[
    invalidCodeTargetBase + invalidCodeLayout.protectedStoOffset] & 0xFFF;
const invalidCodeDRBefore = [...invalidResumeFrame.dr];
invalidResumeFrame.memory[invalidCodeTargetBase + invalidResumeSTO + 1] = 0;
const rejectedCodeIdentity = invalidResumeFrame.advanceConfiguredThread();
assert.strictEqual(rejectedCodeIdentity.ok, false,
    'canonical CHANGE rejects an invalid CHURCH Enter frame immediately');
assert.strictEqual(invalidResumeFrame._currentThreadSlot, 1,
    'invalid CHURCH frame leaves the outgoing Thread selected');
assert.deepStrictEqual(invalidResumeFrame.dr, invalidCodeDRBefore,
    'invalid CHURCH frame is checked before outgoing state is saved');

const longNiaImage = image.slice(0);
const longNiaWords = new Uint32Array(longNiaImage);
const longThreadBase = committedBases[1];
const longLayout = entryLayouts[1];
const longResumeSTO =
    longNiaWords[longThreadBase + longLayout.protectedStoOffset] & 0xFFF;
const longEnterGT = longNiaWords[longThreadBase + longResumeSTO + 1] >>> 0;
const longCodeNsBase =
    longNiaWords.length - ((longEnterGT & 0xFFFF) + 1) * 4;
const longCodeBase = longNiaWords[longCodeNsBase] >>> 0;
longNiaWords[longCodeBase] = (
    (longNiaWords[longCodeBase] & ~(0x1FFF << 10)) | (48 << 10)
) >>> 0;
const longPackedAddr = longThreadBase + longResumeSTO + 2;
longNiaWords[longPackedAddr] = (
    (longNiaWords[longPackedAddr] & ~(0x7FFF << 13)) | (40 << 13)
) >>> 0;
const longNiaSim = new ChurchSimulator();
assert.strictEqual(longNiaSim.loadBootImage(longNiaImage), true,
    'boot loader accepts a valid resume NIA beyond the Thread stack-word count');
const outOfCodeImage = longNiaImage.slice(0);
const outOfCodeWords = new Uint32Array(outOfCodeImage);
outOfCodeWords[longPackedAddr] = (
    (outOfCodeWords[longPackedAddr] & ~(0x7FFF << 13)) | (48 << 13)
) >>> 0;
assert.strictEqual((outOfCodeWords[longPackedAddr] >>> 13) & 0x7FFF, 48);
assert.strictEqual((outOfCodeWords[longCodeBase] >>> 10) & 0x1FFF, 48);
const outOfCodeSim = new ChurchSimulator();
assert.strictEqual(outOfCodeSim.loadBootImage(outOfCodeImage), false,
    'boot loader rejects a resume NIA outside the Enter target code extent');

const underflowFrame = makeBootedThreadFixture('underflow-frame fixture');
const underflowTargetBase = underflowFrame.readNSEntry(11).word0_location;
const underflowLayout = underflowFrame._threadLayoutAtBase(underflowTargetBase);
underflowFrame.memory[underflowTargetBase + underflowLayout.protectedStoOffset] =
    0x1000 | (underflowLayout.stackStart - 2);
const underflowOutgoingHomes = underflowFrame.memory.slice(1, 17);
const underflowOutgoingCaps = underflowFrame.memory.slice(
    entryLayouts[0].capsStart, entryLayouts[0].capsEnd + 1);
assert.strictEqual(underflowFrame.advanceConfiguredThread().ok, false,
    'CHANGE rejects an underflowed CHURCH resume-frame pointer');
assert.deepStrictEqual(underflowFrame.memory.slice(1, 17), underflowOutgoingHomes,
    'incoming frame rejection is atomic for outgoing DR homes');
assert.deepStrictEqual(
    underflowFrame.memory.slice(entryLayouts[0].capsStart, entryLayouts[0].capsEnd + 1),
    underflowOutgoingCaps,
    'incoming frame rejection is atomic for outgoing CR homes');

const malformedSavedSTO = makeBootedThreadFixture('malformed-saved-STO fixture');
const malformedFrameBase = malformedSavedSTO.readNSEntry(11).word0_location;
const malformedFrameLayout = malformedSavedSTO._threadLayoutAtBase(malformedFrameBase);
const malformedFramePointer = malformedSavedSTO.memory[
    malformedFrameBase + malformedFrameLayout.protectedStoOffset] & 0xFFF;
malformedSavedSTO.memory[malformedFrameBase + malformedFramePointer + 2] =
    0x1000 | malformedFrameLayout.stackStart;
const malformedSourceDRHomes = malformedSavedSTO.memory.slice(1, 17);
assert.strictEqual(malformedSavedSTO.advanceConfiguredThread().ok, false,
    'CHANGE rejects a CHURCH frame with an unpaired saved STO');
assert.deepStrictEqual(malformedSavedSTO.memory.slice(1, 17), malformedSourceDRHomes,
    'malformed packed saved STO rejects atomically before DR-home save');

const outgoingUnderflow = makeBootedThreadFixture('outgoing-underflow fixture');
const outgoingEntry = outgoingUnderflow.readNSEntry(entryWords[0] & 0xFFFF);
const outgoingHeader = outgoingUnderflow.parseLumpHeader(
    outgoingUnderflow.memory[outgoingEntry.word0_location] >>> 0);
outgoingUnderflow._writeCR(0, entryWords[0], outgoingEntry);
outgoingUnderflow._installLumpHeaderContext(
    outgoingUnderflow.parseGT(entryWords[0]), entryWords[0] & 0xFFFF,
    outgoingEntry, outgoingHeader);
const outgoingThreadBase = outgoingUnderflow.readNSEntry(1).word0_location;
const outgoingLayout = outgoingUnderflow._threadLayoutAtBase(outgoingThreadBase);
outgoingUnderflow.sto = outgoingLayout.stackStart;
const outgoingSourceDRHomes = outgoingUnderflow.memory.slice(1, 17);
const outgoingSourceCaps = outgoingUnderflow.memory.slice(
    outgoingThreadBase + outgoingLayout.capsStart,
    outgoingThreadBase + outgoingLayout.capsEnd + 1);
assert.strictEqual(outgoingUnderflow.advanceConfiguredThread().ok, false,
    'CHANGE rejects an outgoing Thread without two-word frame space');
assert.deepStrictEqual(outgoingUnderflow.memory.slice(1, 17), outgoingSourceDRHomes,
    'outgoing frame-space rejection is atomic for DR homes');
assert.deepStrictEqual(
    outgoingUnderflow.memory.slice(
        outgoingThreadBase + outgoingLayout.capsStart,
        outgoingThreadBase + outgoingLayout.capsEnd + 1),
    outgoingSourceCaps,
    'outgoing frame-space rejection is atomic for CR homes');

const malformed = makeBootedThreadFixture('malformed-header fixture');
const malformedTargetBase = malformed.readNSEntry(11).word0_location;
const malformedTargetLayout = malformed._threadLayoutAtBase(malformedTargetBase);
const malformedEntryGT = malformed.memory[
    malformedTargetBase + malformedTargetLayout.capsStart] >>> 0;
const malformedCodeEntry = malformed.readNSEntry(
    malformed.parseGT(malformedEntryGT).index);
malformed.memory[malformedCodeEntry.word0_location] = 0;
malformed.halted = true;
const malformedSelection = malformed.advanceConfiguredThread();
assert.strictEqual(malformedSelection.ok, false,
    'canonical CHANGE rejects a malformed executable LUMP before selection');
assert(malformed.faultLog.length > 0,
    'malformed CR14 code GT produces an immediate architecture fault');

// The browser declares `let sim` in app-shell.js. Top-level `let` bindings are
// not mirrored onto window, so the toolbar handler must use the lexical `sim`
// binding rather than silently returning when window.sim is absent.
function functionSource(source, name) {
    const functionStart = source.indexOf(`function ${name}(`);
    const methodStart = source.search(new RegExp(`\\n\\s*${name}\\([^)]*\\) \\{`));
    const start = functionStart >= 0 ? functionStart : methodStart;
    assert(start >= 0, `${name} must exist in app-run.js`);
    const brace = source.indexOf('{', start);
    let depth = 0;
    for (let i = brace; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`Could not extract ${name}`);
}

const appRunSource = fs.readFileSync(__dirname + '/app-run.js', 'utf8');
const simulatorSource = fs.readFileSync(__dirname + '/simulator.js', 'utf8');
const advanceSource = functionSource(simulatorSource, 'advanceConfiguredThread');
const selectSource = functionSource(simulatorSource, 'selectConfiguredThread');
assert(selectSource.includes("crDst: 14, crSrc: 15, imm: target, mnemonic: 'CHANGE'"),
    'exact manual selection invokes the decoded CHANGE descriptor shape');
assert(!/\b(scheduler|saveOutgoing|deferEntryFault)\s*:/.test(selectSource),
    'exact manual selection carries no alternate save/defer semantics');
assert(advanceSource.includes('this.selectConfiguredThread('),
    'round-robin compatibility delegates to exact Thread selection');
assert(!appRunSource.includes('nextThreadBtn') && !appRunSource.includes('nextConfiguredThread'),
    'browser control code no longer exposes the redundant Next Thread control');
const indexSource = fs.readFileSync(__dirname + '/index.html', 'utf8');
assert(!indexSource.includes('nextThreadBtn') && !indexSource.includes('Next Thread'),
    'rendered toolbar no longer contains the Next Thread button');
const uiSim = makeBootedThreadFixture('UI fixture');
const uiBootBase = uiSim.readNSEntry(1).word0_location;
const uiBootLayout = uiSim._threadLayoutAtBase(uiBootBase);
const uiBootEntryGT = uiSim.memory[uiBootBase + uiBootLayout.capsStart] >>> 0;
uiSim.pc = 0x2A;
const initialThreadRows = uiSim.threadStatusRows();
assert.strictEqual(initialThreadRows.length, 3,
    'Thread status strip shows only the three configured Thread images');
assert.strictEqual(initialThreadRows[0].active, true,
    'Thread status strip highlights the selected Thread');
assert.strictEqual(initialThreadRows[0].nia, 0x2A,
    'active Thread status uses the live logical NIA');
const capabilityTestParsed = uiSim.parseGT(uiBootEntryGT);
const capabilityTestGT = uiSim.createGT(
    capabilityTestParsed.gt_seq,
    capabilityTestParsed.index,
    {R: 1, W: 0, X: 1, L: 0, S: 0, E: 0},
    capabilityTestParsed.type);
uiSim.cr[14] = {
    ...uiSim.cr[14],
    word0: capabilityTestGT,
    word1: 0x0D00,
};
uiSim.nsLabels[capabilityTestParsed.index] = 'CapabilityTest';
uiSim.pc = 0x000C;
const capabilityTestRows = uiSim.threadStatusRows();
assert.strictEqual(capabilityTestRows[0].gtPetName, 'CapabilityTest',
    'active Thread card distinguishes the executing CapabilityTest identity');
assert.strictEqual(capabilityTestRows[0].physicalAddress, 0x0D0D,
    'CapabilityTest base 0x0D00 + header + relative NIA 0x000C is 0x0D0D');
assert.strictEqual(capabilityTestRows[1].physicalAddress, null,
    'dormant Thread cards do not synthesize a physical address from live code state');
assert.strictEqual(initialThreadRows[1].nia, 0,
    'never-selected dormant Threads expose their Thread object initial NIA');
assert(initialThreadRows.every(row => row.gtPetName && row.gtPetName !== 'Invalid GT'),
    'each configured Thread status resolves a GT pet name');
assert.strictEqual(uiSim.threadStatusRows(99).length, 3,
    'Thread status output remains capped by the configured Thread count');
assert.strictEqual(uiSim.threadStatusRows(2).length, 2,
    'Thread status output honours a smaller requested display limit');
const status = { textContent: '' };
const consoleEl = { textContent: '', scrollTop: 0, scrollHeight: 0 };
let dashboardUpdates = 0;
let openedCR = null;
const uiContext = {
    window: {}, // deliberately has no window.sim
    sim: uiSim,
    document: {
        getElementById(id) {
            return {
                activeThreadStatus: status,
                editorConsole: consoleEl,
            }[id] || null;
        },
    },
    updateDashboard() { dashboardUpdates++; },
    openCRDetail(crIndex) { openedCR = crIndex; },
};
vm.createContext(uiContext);
vm.runInContext([
    'let _simRunActive = false;',
    functionSource(appRunSource, 'updateThreadControl'),
    functionSource(appRunSource, 'selectThreadContext'),
].join('\n'), uiContext);
uiContext.updateThreadControl();
assert.strictEqual(status.textContent, 'Thread.1 · 1/3',
    'active Thread status remains visible without a Next Thread button');
uiSim.running = true;
const runningSlot = uiSim.activeThreadStatus().slot;
uiContext.selectThreadContext(12);
assert.strictEqual(uiSim.activeThreadStatus().slot, runningSlot,
    'direct Thread selection is rejected while Run owns execution');
uiSim.running = false;
vm.runInContext('_simRunActive = true;', uiContext);
uiContext.selectThreadContext(12);
assert.strictEqual(uiSim.activeThreadStatus().slot, runningSlot,
    'direct Thread selection is rejected between Run batches while the UI run lifecycle owns execution');
vm.runInContext('_simRunActive = false;', uiContext);

// Walk executes one instruction and then waits for its next timer tick. During
// that interval sim.running is false, so invoke the real Walk lifecycle with
// only the next-step callback stubbed.
uiContext.pipelineViz = null;
uiContext.switchView = () => {};
vm.runInContext([
    'let walkRunning = false;',
    'let walkTimer = null;',
    'let walkBootTimer = null;',
    functionSource(appRunSource, 'updateWalkBtn'),
    'function walkNext() {}',
    functionSource(appRunSource, 'finishWalk'),
    functionSource(appRunSource, 'walkToggle'),
].join('\n'), uiContext);
vm.runInContext('walkToggle();', uiContext);
assert.strictEqual(uiSim.walkActive, true,
    'Walk start holds the simulator Thread-switch lock');
assert.strictEqual(uiSim.running, false,
    'the Walk between-ticks fixture is not covered by sim.running');

const walkContextBefore = {
    slot: uiSim.activeThreadStatus().slot,
    cr: JSON.parse(JSON.stringify(uiSim.cr)),
    dr: [...uiSim.dr],
    pc: uiSim.pc,
    physicalPC: uiSim.physicalPC,
    halted: uiSim.halted,
    running: uiSim.running,
    stepCount: uiSim.stepCount,
};
uiContext.selectThreadContext(12);
assert.deepStrictEqual({
    slot: uiSim.activeThreadStatus().slot,
    cr: JSON.parse(JSON.stringify(uiSim.cr)),
    dr: [...uiSim.dr],
    pc: uiSim.pc,
    physicalPC: uiSim.physicalPC,
    halted: uiSim.halted,
    running: uiSim.running,
    stepCount: uiSim.stepCount,
}, walkContextBefore,
    'the UI guard rejects a between-ticks switch without mutating its Thread context');

vm.runInContext('walkToggle();', uiContext);
assert.strictEqual(uiSim.walkActive, false,
    'Walk stop releases the simulator Thread-switch lock');

const finishRunSource = functionSource(appRunSource, 'finishRun');
assert(finishRunSource.includes('updateThreadControl();'),
    'run cleanup refreshes the independently-owned Thread toolbar state');
const dashboardUpdatesBeforeThreadClicks = dashboardUpdates;
uiContext.selectThreadContext(12);
assert.strictEqual(uiSim.activeThreadStatus().slot, 12,
    'browser-shaped row selection switches directly from Thread.1 to Thread.3');
assert.strictEqual(openedCR, 12,
    'Thread row selection opens the selected Thread CR12 memory-map view');
assert.strictEqual(status.textContent, 'Thread.3 · 3/3',
    'toolbar status follows the newly active Thread LUMP');
const dashboardAfterSwitch = dashboardUpdates;
uiContext.selectThreadContext(12);
assert.strictEqual(dashboardUpdates, dashboardAfterSwitch + 1,
    'active-row selection is architecturally unchanged');
assert.strictEqual(openedCR, 12,
    'active-row no-op does not replace the open CR12 detail');
uiContext.selectThreadContext(1);
assert.strictEqual(uiSim.activeThreadStatus().slot, 1,
    'direct row selection restores the saved boot Thread');
assert.strictEqual(status.textContent, 'Thread.1 · 1/3',
    'toolbar status follows the restored boot Thread');
assert.strictEqual(dashboardUpdates - dashboardUpdatesBeforeThreadClicks, 3,
    'each row selection refreshes the Thread strip and dashboard');

const activeBeforeInvalid = uiSim.activeThreadStatus().slot;
const invalidExact = uiSim.selectConfiguredThread(999);
assert.strictEqual(invalidExact.ok, false, 'exact selection rejects a non-Thread Namespace slot');
assert.strictEqual(uiSim.activeThreadStatus().slot, activeBeforeInvalid,
    'invalid exact selection leaves the active context unchanged');

const stripSource = functionSource(appRunSource, 'updateThreadIdentityStrip');
assert(stripSource.includes('_simRunActive || sim.running || sim.walkActive'),
    'Thread rows remain locked during the full asynchronous Run lifecycle');
assert(stripSource.includes('sim.threadStatusRows(10)'),
    'Thread strip obtains every architecturally supported configured Thread');
assert(stripSource.includes('const pageSize = 4'),
    'Thread strip keeps the dashboard limited to four simultaneous rows');
assert(stripSource.includes("pager.setAttribute('aria-label', 'Thread context pages')"),
    'overflow Thread paging exposes an accessible group label');
assert(stripSource.includes('previous.disabled = executionLocked') &&
       stripSource.includes('next.disabled = executionLocked'),
    'overflow paging is locked for the same Run and Walk lifecycle as Thread rows');
assert(stripSource.includes('updateThreadIdentityStrip();'),
    'paging reveals another ordered group without changing Thread allocation');
assert(stripSource.includes("card.setAttribute('role', 'button')"),
    'Thread rows expose button semantics');
assert(stripSource.includes("card.setAttribute('tabindex', selectable ? '0' : '-1')"),
    'only selectable inactive Thread rows enter keyboard tab order');
assert(stripSource.includes("event.key !== 'Enter' && event.key !== ' '"),
    'Thread rows support Enter and Space activation');
assert(stripSource.includes("card.setAttribute('aria-current', 'true')"),
    'active Thread rows expose their current state');
const selectHandlerSource = functionSource(appRunSource, 'selectThreadContext');
assert(selectHandlerSource.includes('_simRunActive || sim.walkActive || sim.running'),
    'activation-time guard rejects stale row handlers between Run batches');
assert(stripSource.includes('selectThreadContext(row.slot)'),
    'overflow pages select Threads through the canonical visible-row handler');

// The configured maximum is architectural Namespace order, not a four-card UI
// limit: every Thread.1..Thread.10 resolves through the identical CHANGE path.
global.window.bootConfig.step1 = {
    totalNamespaceWords: 32768, namespaceLumpWords: 1024,
    threadLumpWords: 256, threadCount: 10,
};
const maxThreads = new ChurchSimulator();
maxThreads.bootComplete = false; // canonical boot rule: no reset-bank save
maxThreads._currentThreadSlot = 1;
const maxSlots = maxThreads.configuredThreadSlots();
assert.strictEqual(maxSlots.length, 10, 'maximum configuration exposes Thread.1 through Thread.10');
assert.strictEqual(maxThreads.threadStatusRows(10).length, 10,
    'status-row API exposes all ten configured Threads for paged rendering');

class FakeElement {
    constructor(tagName) {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.attributes = {};
        this.dataset = {};
        this.listeners = {};
        this.hidden = false;
        this.disabled = false;
        this.textContent = '';
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] || null; }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    appendChild(child) { this.children.push(child); return child; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = [...children]; }
    click() {
        if (!this.disabled && this.listeners.click) this.listeners.click({type: 'click'});
    }
}

const pagingStrip = new FakeElement('div');
const pagingSelections = [];
const pagingContext = {
    sim: {
        running: false,
        walkActive: false,
        threadStatusRows(limit) {
            return maxThreads.threadStatusRows(limit);
        },
    },
    document: {
        getElementById(id) { return id === 'threadIdentityStrip' ? pagingStrip : null; },
        createElement(tagName) { return new FakeElement(tagName); },
    },
    selectThreadContext(slot) { pagingSelections.push(slot); },
};
vm.createContext(pagingContext);
vm.runInContext([
    'let _simRunActive = false;',
    'let _threadIdentityPage = 0;',
    functionSource(appRunSource, 'updateThreadIdentityStrip'),
].join('\n'), pagingContext);

function renderedThreadCards() {
    return pagingStrip.children.filter(child =>
        child.className && child.className.includes('thread-identity-card'));
}
function renderedPager() {
    return pagingStrip.children.find(child =>
        child.className === 'thread-identity-pager');
}

pagingContext.updateThreadIdentityStrip();
assert.deepStrictEqual(
    renderedThreadCards().map(card => Number(card.dataset.threadSlot)),
    maxSlots.slice(0, 4),
    'first page renders the first four configured Threads in Namespace order');
let pager = renderedPager();
assert(pager, 'ten configured Threads render paging controls');
assert.strictEqual(pager.attributes.role, 'group',
    'paging controls expose group semantics');
assert.strictEqual(pager.children[0].tagName, 'BUTTON',
    'previous-page control uses a keyboard-native button');
assert.strictEqual(pager.children[0].disabled, true,
    'previous-page control is disabled at the first boundary');
assert.strictEqual(pager.children[2].disabled, false,
    'next-page control is enabled before the last page');

pager.children[2].click();
assert.deepStrictEqual(
    renderedThreadCards().map(card => Number(card.dataset.threadSlot)),
    maxSlots.slice(4, 8),
    'next-page control reveals the next four configured Threads');
renderedThreadCards()[3].listeners.keydown({
    key: 'Enter',
    preventDefault() {},
});
assert.deepStrictEqual(pagingSelections, [maxSlots[7]],
    'keyboard activation on an overflow row uses the canonical selectThreadContext handler');

pager = renderedPager();
pager.children[2].click();
assert.deepStrictEqual(
    renderedThreadCards().map(card => Number(card.dataset.threadSlot)),
    maxSlots.slice(8, 10),
    'last page renders the final two configured Threads without extra rows');
pager = renderedPager();
assert.strictEqual(pager.children[2].disabled, true,
    'next-page control is disabled at the last boundary');
assert.strictEqual(pager.children[0].disabled, false,
    'previous-page control remains available on the last page');

pagingContext.sim.running = true;
pagingContext.updateThreadIdentityStrip();
pager = renderedPager();
assert.strictEqual(pager.children[0].disabled, true);
assert.strictEqual(pager.children[2].disabled, true,
    'Run ownership disables both overflow paging controls');
assert(renderedThreadCards().every(card => card.attributes.tabindex === '-1'),
    'Run ownership removes overflow Thread rows from keyboard tab order');

pagingContext.sim.running = false;
pagingContext.sim.walkActive = true;
pagingContext.updateThreadIdentityStrip();
pager = renderedPager();
assert.strictEqual(pager.children[0].disabled, true);
assert.strictEqual(pager.children[2].disabled, true,
    'Walk ownership disables both overflow paging controls');
assert(renderedThreadCards().every(card => card.attributes.tabindex === '-1'),
    'Walk ownership removes overflow Thread rows from keyboard tab order');

const visitedMaxSlots = [];
for (let i = 0; i < maxSlots.length; i++) {
    const switched = maxThreads.advanceConfiguredThread();
    assert.strictEqual(switched.ok, true, `canonical CHANGE selects maximum Thread ${i + 2}`);
    visitedMaxSlots.push(switched.slot);
}
assert.deepStrictEqual(visitedMaxSlots, maxSlots.slice(1).concat(maxSlots[0]),
    'maximum Thread configuration cycles once through every Namespace-selected context');

const nonElevated = new ChurchSimulator();
nonElevated.bootComplete = true;
nonElevated.mElevation = false;
nonElevated.cr[0] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
nonElevated.flags = {N: true, Z: false, C: true, V: false};
const flagsBeforeRejectedSwitch = {...nonElevated.flags};
const rejectedChange = nonElevated._execChange({
    crDst: 12, crSrc: 0, imm: 1, mnemonic: 'CHANGE',
});
assert.strictEqual(rejectedChange, null,
    'non-elevated CHANGE CR12 returns an architecture fault instead of throwing');
assert(nonElevated.faultLog.length > 0 &&
       nonElevated.faultLog[nonElevated.faultLog.length - 1].type === 'NULL_CAP',
    'non-elevated CHANGE CR12 records an architecture fault');
assert.deepStrictEqual(nonElevated.flags, flagsBeforeRejectedSwitch,
    'failed isolated context switch preserves the retained machine FLAGS');
console.log('PASS round-robin Thread switching');
