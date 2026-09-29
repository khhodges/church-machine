'use strict';

const assert = require('assert');
const Simulator = require('./simulator.js');
const Registry = require('./abstractions.js');
const System = require('./system_abstractions.js');
const Tokens = require('./capability_tokens.js');
const Builder = require('./lump_builder.js');
const fs = require('fs');
const vm = require('vm');
const Content = require('./lump-content-frame.js');

const sim = new Simulator();
const registry = new Registry();
const system = new System(registry);
sim.initAbstractions(registry, system, null);
const wideA = '0x1234567890abcdef000000000001';
const wideB = '0x1234567890abcdee000000000001';
const identityA = sim.resolveCapabilityName(wideA, ['E']);
const identityB = sim.resolveCapabilityName(wideB, ['E']);
assert.strictEqual(identityA.ok, true, identityA.error);
assert.strictEqual(identityB.ok, true, identityB.error);
assert.notStrictEqual(identityA.nsIndex, identityB.nsIndex,
    'IDs sharing the low slot-sized and GT-sized bits must never alias');
assert.strictEqual(sim.resolveCapabilityName(wideA, ['E']).nsIndex, identityA.nsIndex);
assert.strictEqual(sim.symbolicEntryAt(identityA.nsIndex).targetIdentity.token, wideA);
assert.strictEqual(sim.symbolicEntryAt(identityB.nsIndex).targetIdentity.token, wideB);
const beforeMissingLoad = Array.from(sim.memory);
assert.strictEqual(sim.mLoad(identityA.gt, 'E').fault, 'CODE_NOT_RESIDENT',
    'resolving an identity succeeds without a body; actual load requires it');
assert.deepStrictEqual(Array.from(sim.memory), beforeMissingLoad,
    'failed target load does not alter Namespace or artifact words');

const compiled = {
    abstractionName: 'Synthetic.Owner',
    methods: [{ name: 'Ping', code: [0x18000000] }],
    capabilities: [
        { name: 'SELF', rights: ['E'], compiler_owned_self: true },
        { name: wideA, token: wideA, rights: ['R'] },
    ],
};
const packed = Builder.buildLump(compiled);
const api = Builder.buildApiDefinition(compiled, packed.words);
const artifact = Builder.embedSelfDefinition(packed.words, api, 'synthetic fixture', 2);
const artifactBase = 0x6000;
sim.memory.set(artifact, artifactBase);
const owner = registry.dispatchMethod(5, 'Add', sim, {
    label: 'Synthetic.Owner', location: artifactBase, limit: artifact.length - 1, gtType: 1,
});
assert.strictEqual(owner.ok, true);
const localizedOwner = sim._mintOrdinaryLumpIdentity(
    artifact, owner.result.nsIndex, artifactBase, { compilerOwnedSelf: true });
assert.strictEqual(localizedOwner.ok, true, localizedOwner.message);
assert.strictEqual(localizedOwner.words.at(-1), 0,
    'installing SELF does not eagerly resolve unused dependencies');
assert.strictEqual(artifact.at(-2), 0, 'immutable compiler artifact is not rewritten');
sim.programCapabilities = [{ name: 'Stale.Editor', rights: ['E'] },
    { name: 'Wrong.Target', rights: ['E'] }];
const capAddress = artifactBase + artifact.length - 1;
const loadedGT = sim._resolveDeclaredSlot(0, 1, capAddress, 'LOAD');
assert.strictEqual(sim.parseGT(loadedGT).index, identityA.nsIndex,
    'binary reload uses full embedded ID instead of stale editor metadata');
assert.strictEqual((loadedGT >>> 28) & 7, 1, 'binary reload retains requested R');
assert.strictEqual(api.capabilities[1].token, wideA);
const saveCode = fs.readFileSync(require.resolve('./app-run.js'), 'utf8')
    .match(/function _validateFinalLumpSaveBinary\(words, capabilities\) \{[\s\S]*?\n\}/)[0];
const checkSave = vm.runInNewContext(saveCode + '\n_validateFinalLumpSaveBinary', {
    CapabilityTokens: Tokens, sim,
    lumpDecodeContentFrameApi: Content.lumpDecodeContentFrameApi,
});
assert.strictEqual(checkSave(artifact, compiled.capabilities), true,
    'final browser Save validation accepts authenticated embedded symbolic rows');
assert.throws(() => checkSave(artifact, [compiled.capabilities[0],
    { ...compiled.capabilities[1], token: '0x00000001' }]), /validation/);
assert.throws(() => checkSave(artifact, [compiled.capabilities[0],
    { ...compiled.capabilities[1], rights: ['E'] }]), /validation/);
const targetBody = 0x7000;
sim.memory[targetBody] = (0x1f << 27 | 1 << 10) >>> 0;
sim.memory[targetBody + 1] = 0x18000000;
const targetRegistered = registry.dispatchMethod(5, 'Add', sim, {
    label: wideA, location: targetBody, limit: 63, gtType: 1,
    targetIdentity: { token: wideA },
});
assert.strictEqual(targetRegistered.ok, true);
assert.strictEqual(targetRegistered.result.nsIndex, identityA.nsIndex);
assert.strictEqual(sim.mLoad(identityA.gt, 'E').ok, true,
    'load succeeds after target registration: ' + JSON.stringify(sim.mLoad(identityA.gt, 'E')));
assert.strictEqual(sim.symbolicEntryAt(identityB.nsIndex).implementationMissing, true,
    'registering one full ID does not satisfy a different colliding prefix');
sim._rebuildNamespaceFreeList();
const first = sim._nsFreeList[0];
const before = Array.from(sim.memory);
const bad = sim.resolveCapabilityName('Future.Network', ['E', 'W']);
assert.strictEqual(bad.ok, false);
assert.deepStrictEqual(Array.from(sim.memory), before);
const resolved = sim.resolveCapabilityName('Future.Network', ['R', 'W']);
assert.strictEqual(resolved.ok, true, resolved.error);
assert.strictEqual(resolved.nsIndex, first);
assert.strictEqual(sim.symbolicEntryAt(first).implementationMissing, true);
assert.strictEqual(sim.parseGT(resolved.gt).index, first);
assert.strictEqual((resolved.gt >>> 28) & 7, 3, 'requested RW, not invented E');
const remaining = sim._nsFreeList.slice();
assert.strictEqual(sim.resolveCapabilityName('Future.Network', ['R']).nsIndex, first);
assert.deepStrictEqual(sim._nsFreeList, remaining, 'idempotent resolution does not consume another slot');
sim.withNamespaceWrite('isolated test release', () => sim.clearNSEntry(first));
assert.strictEqual(sim._nsFreeList[0], first, 'released slot is the head');
const reused = sim.resolveCapabilityName('Future.Other', ['L']);
assert.strictEqual(reused.nsIndex, first);
assert.strictEqual((reused.gt >>> 16) & 511, ((resolved.gt >>> 16) + 1) & 511);
const install = registry.dispatchMethod(5, 'Add', sim, {
    label: 'Future.Other', location: 0x4000, limit: 63, gtType: 1,
});
assert.strictEqual(install.ok, true);
assert.strictEqual(install.result.nsIndex, first, 'later registration reuses reserved identity');
assert.strictEqual(sim.symbolicEntryAt(first), null);
assert.strictEqual(sim.readNSEntry(first).word0_location, 0x4000);
assert.strictEqual(sim._nsSequenceForWrite(first), (reused.gt >>> 16) & 511);
const words = Array.from(sim.memory);
sim._nsFreeList = [];
const exhausted = sim.resolveCapabilityName('Future.Exhausted', ['E']);
assert.strictEqual(exhausted.ok, false);
assert.match(exhausted.error, /free NS slots/);
assert.deepStrictEqual(Array.from(sim.memory), words);
assert.strictEqual(sim.resolveCapabilityName('Future.Other', ['E']).ok, true,
    'existing binding works even when the free list is empty');

const caps = [{ name: 'Future.Uncreated', rights: ['R', 'W'] }];
const binary = Array(64).fill(0);
const materialized = Tokens.materialize(caps, binary, 63, { sim, lumps: [] });
assert.strictEqual(materialized.ok, true);
assert.strictEqual(Tokens.validateClist(binary, 63, materialized.resolvedCaps, {
    sim, allowPendingPlaceholders: true,
}).ok, true, 'save formatting accepts declarations without allocating Namespace');
assert.deepStrictEqual(Array.from(sim.memory), words);
console.log('symbolic lazy resolution tests passed');