'use strict';

// Canonical Bank LUMP regression coverage.
// Run: node simulator/test_bank_lump.js

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LUMPS_DIR = path.join(ROOT, 'server', 'lumps');
const source = fs.readFileSync(path.join(__dirname, 'cloomc', 'bank.cloomc'), 'utf8');
const { buildBankArtifact } = require(path.join(ROOT, 'scripts', 'build_bank_lump.js'));
const BankLumpBinding = require('./bank_lump_binding.js');
const BankLumpIdentity = require('./bank_lump_identity.js');
const ChurchSimulator = require('./simulator.js');
const AbstractionRegistry = require('./abstractions.js');
const SystemAbstractions = require('./system_abstractions.js');

let pass = 0;
function check(label, condition) {
    assert.ok(condition, label);
    console.log(`PASS ${label}`);
    pass++;
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

const artifact = buildBankArtifact();
const manifest = JSON.parse(fs.readFileSync(path.join(LUMPS_DIR, 'manifest.json'), 'utf8'));
const entries = manifest.filter(entry => entry.dot_name === 'Bank' || entry.abstraction === 'Bank');
check('BANK-LUMP01: exactly one canonical Bank manifest entry exists', entries.length === 1);

const entry = entries[0];
const binaryPath = path.join(LUMPS_DIR, entry.filename);
const sidecarPath = path.join(LUMPS_DIR, entry.sidecar_file);
const binary = fs.readFileSync(binaryPath);
const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
const header = binary.readUInt32BE(0);
const size = 1 << (((header >>> 23) & 0x0F) + 6);
const cw = (header >>> 10) & 0x1FFF;
const cc = header & 0xFF;

check('BANK-LUMP02: Bank source remains a compilable CLOOMC abstraction',
    artifact.compiled.abstractionName === 'Bank' && artifact.compiled.errors.length === 0 &&
    source.includes('abstraction Bank'));
check('BANK-LUMP03: checked-in binary is the canonical compiler serialization',
    binary.equals(artifact.binary));
check('BANK-LUMP04: header, binary size, code words, and c-list count agree',
    size === binary.length / 4 && size === entry.lump_size && size === sidecar.lump_size &&
    cw === entry.cw && cw === sidecar.cw && cc === 1 && cc === entry.cc && cc === sidecar.cc);
check('BANK-LUMP05: Bank carries the compiler-owned symbolic SELF identity in c-list row zero',
    binary.readUInt32BE((size - cc) * 4) === artifact.selfGT &&
    sidecar.permissions.c_list_row_0.live_lockbox_authority === false);
check('BANK-LUMP06: Bank is a self-defining tier-2 CLOOMC LUMP',
    ((binary.readUInt32BE((cw + 1) * 4) >>> 24) & 0xFF) === 0xAB &&
    sidecar.sourceStorageTier === 2 && sidecar.source === source);
const createSource = source.slice(source.indexOf('method Create'), source.indexOf('// Read and Inspect'));
check('BANK-LUMP06b: embedded Create source records validation, atomic commit, and post-commit issuance',
    createSource.includes('validation_failed:') &&
    createSource.includes('custody_commit:') &&
    createSource.includes('create_issued:') &&
    createSource.includes('complete seal, token, SELF') &&
    createSource.includes('atomically allocates, registers, copies, and proof-binds') &&
    createSource.includes('Only a successful private commit may issue BankVariable authority') &&
    !/method Create[\s\S]*?\{\s*return\(1\)/.test(createSource));
const embeddedContentHeader = binary.readUInt32BE((cw + 1) * 4);
const embeddedApiLength = embeddedContentHeader & 0xFFFF;
const embeddedApi = JSON.parse(binary.subarray((cw + 1) * 4 + 4,
    (cw + 1) * 4 + 4 + embeddedApiLength).toString('utf8'));
const embeddedSourceHeaderOffset = (cw + 1) * 4 + 4 + Math.ceil(embeddedApiLength / 4) * 4;
const embeddedSourceLength = binary.readUInt32BE(embeddedSourceHeaderOffset);
const embeddedSource = binary.subarray(embeddedSourceHeaderOffset + 4,
    embeddedSourceHeaderOffset + 4 + embeddedSourceLength).toString('utf8');
check('BANK-LUMP06c: binary self-definition embeds the canonical Bank source and Create policy',
    embeddedSource === source &&
    embeddedApi.capability_abi.Create.policy.input_register === 'CR1' &&
    embeddedApi.capability_abi.Create.policy.result_register === 'CR0' &&
    embeddedApi.capability_abi.Create.policy.status_register === 'DR0');
check('BANK-LUMP07: manifest and sidecar bind the canonical identity and binary',
    entry.token === sidecar.token &&
    entry.token === sha256(Buffer.concat([Buffer.from('Bank', 'utf8'), binary])).slice(0, 8) &&
    entry.binary_hash === sha256(binary) &&
    entry.identity_hash === sha256('Bank#1') &&
    sidecar.identity_hash === entry.identity_hash &&
    sidecar.identity_string === 'Bank#1');
const artifactValidation = BankLumpBinding.validateArtifact({
    manifestEntry: entry, sidecar, binary,
});
check('BANK-LUMP07b: the full manifest artifact validates before runtime selection',
    artifactValidation.ok &&
    BankLumpIdentity.token === entry.token &&
    BankLumpIdentity.binary_hash === entry.binary_hash &&
    BankLumpIdentity.self_gt === artifact.selfGT);
check('BANK-LUMP07c: tampered fixed-slot metadata is rejected before runtime dispatch',
    !BankLumpBinding.validateArtifact({
        manifestEntry: { ...entry, ns_slot: 54 }, sidecar, binary,
    }).ok);
check('BANK-LUMP08: Bank is dynamic and never claims a fixed boot slot',
    entry.ns_slot === null && entry.ns_slot_policy === 'dynamic' &&
    entry.boot_resident === false && entry.runtime_binding.fixed_hardware_boot_slot === false);
check('BANK-LUMP09: manifest method table and E grant match the compiled artifact',
    JSON.stringify(entry.methods) === JSON.stringify(artifact.manifestEntry.methods) &&
    JSON.stringify(entry.grants) === JSON.stringify(['E']) &&
     entry.methods.map(method => method.name).join(',') ===
         'Create,Read,InspectVariable,Release,RevokeVariable');
const create = entry.methods.find(method => method.name === 'Create');
check('BANK-LUMP09b: Bank records typed CR inputs while scalar values remain DR inputs',
    create &&
    JSON.stringify(create.inputs) === JSON.stringify([
        { name: 'lump', register: 'CR1', kind: 'capability', secure_type: 'Inform', rights: ['R'] },
    ]) &&
    create.returns.register === 'CR0' && create.returns.secure_type === 'BankVariable' &&
    entry.capability_abi.Create.returns_nullable === true &&
    entry.capability_abi.Create.policy.validation === 'complete-self-defining-lump-before-private-custody' &&
    entry.capability_abi.Create.policy.commit === 'atomic-private-custody-or-cleanup' &&
    entry.capability_abi.Create.policy.issuance === 'nullable-typed-bankvariable-capability-after-commit' &&
    entry.capability_abi.Create.policy.input_register === 'CR1' &&
    entry.capability_abi.Create.policy.result_register === 'CR0' &&
    entry.capability_abi.Create.policy.status_register === 'DR0' &&
    entry.capability_abi.Create.error_codes.IDENTITY === 0x103 &&
    entry.capability_abi.Create.error_codes.NO_CAPABILITY === 0x101 &&
     !Object.keys(entry.capability_abi).some(name =>
         ['MintKey', 'Deposit', 'Withdraw', 'Inspect', 'Revoke',
             'ObtainPassKey', 'ExportRecovery', 'Recover', 'List'].includes(name)) &&
    entry.runtime_binding.credential_abi === 'capability-register-v1' &&
     !source.includes('owner_key') && !source.includes('source_gt') &&
     !JSON.stringify(entry).includes('BankOwnerKey'));

const registry = new AbstractionRegistry();
const systemAbs = new SystemAbstractions(registry);
const bank = registry.getByName('Bank');
const sim = new ChurchSimulator();
sim.initAbstractions(registry, systemAbs, null);
check('BANK-LUMP10: symbolic Bank name resolves to the existing dynamic runtime binding',
    bank && bank.index === 54 && bank.freedNSSlot === true &&
    BankLumpBinding.resolveRuntime(registry, BankLumpIdentity).ok &&
    systemAbs.bankRuntimeBinding.token === entry.token &&
    systemAbs.bankRuntimeBinding.index === bank.index &&
     typeof bank.dispatch.MINTKEY !== 'function' &&
    systemAbs.registry === registry);
check('BANK-LUMP10b: runtime gate rejects a non-canonical Bank identity projection',
    !BankLumpBinding.resolveRuntime(registry, {
        ...BankLumpIdentity,
        identity_hash: '0'.repeat(64),
    }).ok);
check('BANK-LUMP10c: runtime gate rejects a tampered canonical token',
    !BankLumpBinding.resolveRuntime(registry, {
        ...BankLumpIdentity,
        token: '00000000',
    }).ok);
check('BANK-LUMP10d: runtime gate rejects a tampered canonical binary seal',
    !BankLumpBinding.resolveRuntime(registry, {
        ...BankLumpIdentity,
        binary_hash: '0'.repeat(64),
    }).ok);
const matchingWrongRegistry = {
    getByName() {
        return { index: 999, freedNSSlot: true };
    },
};
check('BANK-LUMP10e: runtime gate rejects a changed registry index even with a matching dynamic descriptor',
    !BankLumpBinding.resolveRuntime(matchingWrongRegistry, {
        ...BankLumpIdentity,
        runtime_binding: { ...BankLumpIdentity.runtime_binding, registry_index: 999 },
    }).ok);
check('BANK-LUMP10f: runtime gate rejects a changed custody authority label',
    !BankLumpBinding.resolveRuntime(registry, {
        ...BankLumpIdentity,
        runtime_binding: { ...BankLumpIdentity.runtime_binding, authority: 'untrusted custody' },
    }).ok);
check('BANK-LUMP11: Bank registry identity does not materialize an NS[54] boot entry',
    !sim.isNSEntryValid(54));

// Verified BankVariable custody. The caller may describe a LUMP, but Create
// recomputes every identity field from the source bytes before it allocates.
sim.bootComplete = true;
sim.mElevation = true;
registry.dispatchMethod(5, 'Init', sim, {});
const sourceWords = [];
for (let i = 0; i < artifact.binary.length; i += 4) {
    sourceWords.push(artifact.binary.readUInt32BE(i));
}
const sourceAllocation = registry.dispatchMethod(7, 'Allocate', sim, { size: sourceWords.length });
const sourceRegistration = registry.dispatchMethod(5, 'Add', sim, {
    location: sourceAllocation.result.location,
    limit: sourceAllocation.result.size - 1,
    gtType: 1,
    label: 'Bank.Create.Source'
});
sourceWords.forEach((word, index) => {
    sim.memory[sourceAllocation.result.location + index] = word;
});
const sourceCapability = {
    register: 'CR1', kind: 'capability', secure_type: 'Inform',
    gt_type: 'Inform', rights: ['R'],
    gt: sim.createGT(sourceRegistration.result.version, sourceRegistration.result.nsIndex, { R: 1 }, 1),
    metadata: {
        dot_name: entry.dot_name, issue_n: entry.issue_n, token: entry.token,
        binary_hash: entry.binary_hash, identity_hash: entry.identity_hash,
        self_gt: entry.self_gt, identity_string: sidecar.identity_string
    }
};
const allocationsBeforeRejectedCreate = Object.keys(systemAbs._memoryState.allocations).sort();
const forgedToken = registry.dispatchMethod(54, 'Create', sim, {
    capabilities: { lump: { ...sourceCapability, metadata: { ...sourceCapability.metadata, token: '00000000' } } }
});
check('BANK-LUMP12: forged token metadata fails before Bank allocates private custody',
    !forgedToken.ok && forgedToken.fault === 'IDENTITY' &&
    sim.dr[0] === 0x103 && sim.cr[0].word0 === 0 &&
    (!sim._bankCapabilityRegisters || !sim._bankCapabilityRegisters.CR0) &&
    JSON.stringify(Object.keys(systemAbs._memoryState.allocations).sort()) ===
        JSON.stringify(allocationsBeforeRejectedCreate));
const alteredCode = sourceWords.slice();
alteredCode[10] = (alteredCode[10] ^ 1) >>> 0;
const alteredCodeCreate = registry.dispatchMethod(54, 'Create', sim, {
    lumpValue: { words: alteredCode, metadata: sourceCapability.metadata }
});
check('BANK-LUMP12b: altered binary bytes fail their canonical integrity seal before allocation',
    !alteredCodeCreate.ok && alteredCodeCreate.fault === 'IDENTITY' &&
    sim.dr[0] === 0x103 && sim.cr[0].word0 === 0 &&
    JSON.stringify(Object.keys(systemAbs._memoryState.allocations).sort()) ===
        JSON.stringify(allocationsBeforeRejectedCreate));
const alteredSelf = sourceWords.slice();
alteredSelf[alteredSelf.length - 1] ^= 1;
const alteredSelfBinary = Buffer.alloc(alteredSelf.length * 4);
alteredSelf.forEach((word, index) => alteredSelfBinary.writeUInt32BE(word >>> 0, index * 4));
const alteredSelfMetadata = {
    ...sourceCapability.metadata,
    token: sha256(Buffer.concat([Buffer.from(entry.dot_name, 'utf8'), alteredSelfBinary])).slice(0, 8),
    binary_hash: sha256(alteredSelfBinary)
};
const alteredSelfCreate = registry.dispatchMethod(54, 'Create', sim, {
    lumpValue: { words: alteredSelf, metadata: alteredSelfMetadata }
});
check('BANK-LUMP12c: a self-consistent hash claim cannot bypass the c-list SELF identity check',
    !alteredSelfCreate.ok && alteredSelfCreate.fault === 'IDENTITY' &&
    sim.dr[0] === 0x103 && sim.cr[0].word0 === 0 &&
    JSON.stringify(Object.keys(systemAbs._memoryState.allocations).sort()) ===
        JSON.stringify(allocationsBeforeRejectedCreate));
const missingCapability = registry.dispatchMethod(54, 'Create', sim, {
    lumpValue: { words: sourceWords, metadata: sourceCapability.metadata }
});
check('BANK-LUMP13: a value form is allowed only when canonical seals accompany it',
    missingCapability.ok && missingCapability.result.variableCapability.register === 'CR0' &&
    missingCapability.result.variableCapability.secure_type === 'BankVariable' &&
    missingCapability.result.nsIndex === undefined &&
    missingCapability.result.metadata.capacity >= sourceWords.length &&
    sim.dr[0] === 1 && sim.cr[0].word0 === missingCapability.result.variableCapability.gt);
const variable = missingCapability.result;
const recordFor = capability => Object.values(systemAbs._bankState.variables).find(item =>
    item.sanctumKey && item.sanctumKey.gt === capability.gt);
const wrongRegister = registry.dispatchMethod(54, 'InspectVariable', sim, {
    capabilities: { variable: { ...variable.variableCapability, register: 'CR3' } }
});
check('BANK-LUMP13b: CR3 and other registers cannot substitute for CR0 authority',
    !wrongRegister.ok && wrongRegister.fault === 'NO_CAPABILITY' && sim.dr[0] === 0x101 &&
    sim.cr[0].word0 === variable.variableCapability.gt);
const badVariableCapability = registry.dispatchMethod(54, 'InspectVariable', sim, {
    capabilities: { variable: { ...variable.variableCapability, secure_type: 'Inform', gt_type: 'Inform' } }
});
check('BANK-LUMP14: raw or wrong-typed variable authority cannot inspect custody',
    !badVariableCapability.ok && badVariableCapability.fault === 'NO_CAPABILITY');
const inspected = registry.dispatchMethod(54, 'InspectVariable', sim, {
    variableId: variable.variableId, capabilities: { variable: variable.variableCapability }
});
check('BANK-LUMP14b: InspectVariable materializes status and scalar metadata in distinct DR registers',
    inspected.ok && sim.dr[0] === 1 && sim.dr[1] === sourceWords.length &&
    sim.dr[2] === variable.metadata.capacity && sim.dr[3] === entry.issue_n &&
    sim.dr[4] === 1 && inspected.registers.DR1 === sourceWords.length);
const outOfBoundsRead = registry.dispatchMethod(54, 'Read', sim, {
    offset: sourceWords.length - 1, words: 2,
    capabilities: { variable: variable.variableCapability }
});
check('BANK-LUMP15: BankVariable reads reject encoded-bound violations without allocation',
    !outOfBoundsRead.ok && outOfBoundsRead.fault === 'BOUNDS' && sim.dr[0] === 0x105 &&
    sim.cr[0].word0 === variable.variableCapability.gt && sim.cr[4].word0 === 0);
const read = registry.dispatchMethod(54, 'Read', sim, {
    offset: 0, words: sourceWords.length
});
const readEntry = read.ok && sim.readNSEntry(sim.parseGT(read.result.readableCapability.gt).index);
check('BANK-LUMP16: BankVariable reads return a fresh typed Inform capability with identical LUMP bytes',
    read.ok && read.result.readableCapability.register === 'CR4' &&
    sim.dr[0] === 1 && sim.cr[4].word0 === read.result.readableCapability.gt &&
    readEntry && sourceWords.every((word, index) =>
        sim.memory[readEntry.word0_location + index] === word));
const nested = registry.dispatchMethod(54, 'Create', sim, {
    capabilities: {
        lump: { ...read.result.readableCapability, register: 'CR1', metadata: sourceCapability.metadata }
    }
});
check('BANK-LUMP17: a read LUMP round-trips into an independently managed nested variable',
    nested.ok && nested.result.variableCapability.gt !== variable.gt &&
    nested.result.metadata.token === entry.token);
const nestedRecord = Object.values(systemAbs._bankState.variables).find(item =>
    item.sanctumKey && item.sanctumKey.gt === nested.result.variableCapability.gt);
const revoke = registry.dispatchMethod(54, 'RevokeVariable', sim, {
    capabilities: { variable: nested.result.variableCapability }
});
const reused = registry.dispatchMethod(7, 'Allocate', sim, { size: sourceWords.length });
check('BANK-LUMP18: revocation zeroizes the full rounded private allocation before reuse',
    revoke.ok && reused.ok && reused.result.location === nestedRecord.location &&
    Array.from(sim.memory.slice(reused.result.location,
        reused.result.location + reused.result.size)).every(word => word === 0));
const quarantineCandidate = registry.dispatchMethod(54, 'Create', sim, {
    lumpValue: { words: sourceWords, metadata: sourceCapability.metadata }
});
const quarantinedRecord = recordFor(quarantineCandidate.result.variableCapability);
const dispatchBeforeForcedRemoveFailure = registry.dispatchMethod.bind(registry);
registry.dispatchMethod = (index, method, ...args) =>
    index === 5 && method === 'Remove'
        ? { ok: false, fault: 'FORCED', message: 'forced cleanup failure' }
        : dispatchBeforeForcedRemoveFailure(index, method, ...args);
const failedRelease = registry.dispatchMethod(54, 'Release', sim, {
    capabilities: { variable: quarantineCandidate.result.variableCapability }
});
registry.dispatchMethod = dispatchBeforeForcedRemoveFailure;
const postFailureRead = registry.dispatchMethod(54, 'Read', sim, {
    capabilities: { variable: quarantineCandidate.result.variableCapability }
});
const afterFailedCleanupAllocation = registry.dispatchMethod(7, 'Allocate', sim, { size: sourceWords.length });
check('BANK-LUMP18b: failed Namespace cleanup quarantines zeroed storage and revokes the old variable capability',
    !failedRelease.ok && failedRelease.fault === 'NAMESPACE' &&
    failedRelease.error_code === 0x10C && sim.cr[0].word0 === 0 &&
    !postFailureRead.ok && postFailureRead.fault === 'REVOKED' &&
    afterFailedCleanupAllocation.ok && afterFailedCleanupAllocation.result.location !== quarantinedRecord.location &&
    Array.from(sim.memory.slice(quarantinedRecord.location,
        quarantinedRecord.location + quarantinedRecord.capacity)).every(word => word === 0));
const createAllocationsBeforeNsFailure = Object.keys(systemAbs._memoryState.allocations).sort();
const originalAllocOrFind = sim.allocOrFindNsSlot;
sim.allocOrFindNsSlot = () => null;
const namespaceExhausted = registry.dispatchMethod(54, 'Create', sim, {
    capabilities: { lump: sourceCapability }
});
sim.allocOrFindNsSlot = originalAllocOrFind;
check('BANK-LUMP19: Namespace failure rolls back verified Create before publishing a variable',
    !namespaceExhausted.ok && namespaceExhausted.fault === 'NS_FULL' &&
    sim.dr[0] === 0x10A && sim.cr[0].word0 === 0 &&
    JSON.stringify(Object.keys(systemAbs._memoryState.allocations).sort()) ===
        JSON.stringify(createAllocationsBeforeNsFailure));
const releaseRecord = Object.values(systemAbs._bankState.variables).find(item =>
    item.sanctumKey && item.sanctumKey.gt === variable.variableCapability.gt);
const released = registry.dispatchMethod(54, 'Release', sim, {
    capabilities: { variable: variable.variableCapability }
});
const releasedReuse = registry.dispatchMethod(7, 'Allocate', sim, { size: sourceWords.length });
check('BANK-LUMP20: release invalidates the BankVariable and zeroizes its private allocation',
    released.ok && releasedReuse.ok && releasedReuse.result.location === releaseRecord.location &&
    sim.dr[0] === 1 && sim.cr[0].word0 === 0 &&
    Array.from(sim.memory.slice(releasedReuse.result.location,
        releasedReuse.result.location + releasedReuse.result.size)).every(word => word === 0) &&
    !registry.dispatchMethod(54, 'InspectVariable', sim, {
        capabilities: { variable: variable.variableCapability }
    }).ok);

const staleCreate = registry.dispatchMethod(54, 'Create', sim, {
    lumpValue: { words: alteredCode, metadata: sourceCapability.metadata }
});
check('BANK-LUMP21: failed Create clears any previously materialized CR0 authority',
    !staleCreate.ok && staleCreate.fault === 'IDENTITY' &&
    sim.dr[0] === 0x103 && sim.cr[0].word0 === 0 &&
    !sim._bankCapabilityRegisters.CR0);

console.log(`\n${pass} Bank LUMP checks passed.`);