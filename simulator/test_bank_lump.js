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
        'MintKey,Deposit,Withdraw,Inspect,Revoke,ObtainPassKey,ExportRecovery,Recover,List');
const deposit = entry.methods.find(method => method.name === 'Deposit');
const mintKey = entry.methods.find(method => method.name === 'MintKey');
const recover = entry.methods.find(method => method.name === 'Recover');
check('BANK-LUMP09b: Bank records typed CR inputs while scalar values remain DR inputs',
    deposit &&
    JSON.stringify(deposit.inputs) === JSON.stringify([
        { name: 'owner_key', register: 'CR1', kind: 'capability', secure_type: 'BankOwnerKey', rights: ['E'] },
        { name: 'source', register: 'CR2', kind: 'capability', secure_type: 'Inform', rights: ['R'] },
        { name: 'offset', register: 'DR1', kind: 'value' },
        { name: 'words', register: 'DR2', kind: 'value' },
        { name: 'kind', register: 'DR3', kind: 'value' },
    ]) &&
    mintKey && mintKey.returns.register === 'CR1' &&
    mintKey.returns.secure_type === 'BankOwnerKey' &&
    recover && recover.inputs[0].register === 'DR1' && recover.inputs[1].register === 'CR1' &&
    entry.runtime_binding.credential_abi === 'capability-register-v1' &&
    !source.includes('owner_handle') && !source.includes('source_gt'));

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
    typeof bank.dispatch.MINTKEY === 'function' &&
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

console.log(`\n${pass} Bank LUMP checks passed.`);