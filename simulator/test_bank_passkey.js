'use strict';

// Bank authority regression coverage.  The public Bank surface is deliberately
// capability-only; its sanctum credential is never returned to this caller.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ChurchSimulator = require('./simulator.js');
const AbstractionRegistry = require('./abstractions.js');
const SystemAbstractions = require('./system_abstractions.js');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'server/lumps/manifest.json')));
const entry = manifest.find(item => item.dot_name === 'Bank');
const binary = fs.readFileSync(path.join(root, 'server/lumps', entry.filename));
const words = Array.from({ length: binary.length / 4 }, (_, i) => binary.readUInt32BE(i * 4));
const registry = new AbstractionRegistry();
const system = new SystemAbstractions(registry);
const sim = new ChurchSimulator();
sim.initAbstractions(registry, system, null);
sim.bootComplete = true;
sim.mElevation = true;
registry.dispatchMethod(5, 'Init', sim, {});

function check(label, condition) {
    assert.ok(condition, label);
    console.log(`PASS ${label}`);
}

const allocation = registry.dispatchMethod(7, 'Allocate', sim, { size: words.length });
const added = registry.dispatchMethod(5, 'Add', sim, {
    location: allocation.result.location, limit: allocation.result.size - 1,
    gtType: 1, label: 'Bank.Create.Source'
});
words.forEach((word, i) => { sim.memory[allocation.result.location + i] = word; });
const source = {
    register: 'CR1', kind: 'capability', secure_type: 'Inform',
    gt_type: 'Inform', rights: ['R'],
    gt: sim.createGT(added.result.version, added.result.nsIndex, { R: 1 }, 1),
    metadata: {
        dot_name: entry.dot_name, issue_n: entry.issue_n, token: entry.token,
        binary_hash: entry.binary_hash, identity_hash: entry.identity_hash,
        self_gt: entry.self_gt, identity_string: 'Bank#1'
    }
};

const created = registry.dispatchMethod(54, 'Create', sim, { capabilities: { lump: source } });
check('BANK01: Create returns a typed BankVariable capability in CR0',
    created.ok && created.result.variableCapability.register === 'CR0' &&
    created.result.variableCapability.secure_type === 'BankVariable' &&
    created.result.variableCapability.gt_type === 'Abstract' &&
    Array.isArray(created.result.variableCapability.proof) === false &&
    sim.cr[0].word0 !== 0);
check('BANK02: no sanctum credential or private location crosses Create',
    created.result.variableCapability.gt !== undefined &&
    created.result.variableCapability.variable_id === undefined &&
    created.result.variableId === undefined &&
    created.result.metadata.variableId === undefined &&
    created.result.metadata.location === undefined &&
    created.result.metadata.nsIndex === undefined);
check('BANK03: Bank does not expose legacy owner-key methods',
    ['MINTKEY', 'DEPOSIT', 'WITHDRAW', 'INSPECT', 'REVOKE', 'OBTAINPASSKEY',
        'EXPORTRECOVERY', 'RECOVER', 'LIST'].every(name => typeof registry.getByName('Bank').dispatch[name] !== 'function'));

const variable = created.result.variableCapability;
const inspected = registry.dispatchMethod(54, 'InspectVariable', sim, {
    capabilities: { variable }
});
check('BANK04: typed BankVariable authorizes safe scalar inspection',
    inspected.ok && inspected.registers.DR0 === 1 && inspected.registers.DR1 === words.length &&
    inspected.result.location === undefined && inspected.result.nsIndex === undefined);

const rawGt = registry.dispatchMethod(54, 'InspectVariable', sim, {
    variableId: created.result.variableId, dr1: variable.gt,
    capabilities: { variable: { ...variable, register: 'CR3' } }
});
check('BANK05: scalar IDs, raw GTs, and reconstructed handles do not authorize',
    !rawGt.ok && rawGt.fault === 'NO_CAPABILITY' && sim.dr[0] === 0x101);

const read = registry.dispatchMethod(54, 'Read', sim, {
    capabilities: { variable }, offset: 0, words: words.length
});
check('BANK06: typed capability flow reads through a fresh Inform capability',
    read.ok && read.result.readableCapability.register === 'CR4' &&
    read.result.readableCapability.secure_type === 'Inform');

const released = registry.dispatchMethod(54, 'Release', sim, { capabilities: { variable } });
check('BANK07: release retires the variable and clears CR0',
    released.ok && sim.cr[0].word0 === 0 &&
    !registry.dispatchMethod(54, 'InspectVariable', sim, { capabilities: { variable } }).ok);

console.log('\nBank capability-only checks passed.');