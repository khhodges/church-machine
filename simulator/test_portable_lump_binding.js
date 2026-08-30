'use strict';

const assert = require('assert');
const Binding = require('./portable_lump_binding.js');

const H1 = '1'.repeat(64);
const H2 = '2'.repeat(64);
const contract = Binding.createContract('alice.Bank#7', [
    { name: '__SELF__', compiler_owned_self: true, rights: 'E', type: 'Inform' },
    {
        N: 'church.Audit#3', T: 'a1b2c3d4', binary_hash: H1, identity_hash: H2,
        rights: 'L', type: 'Inform', relocation_row: 1,
    },
]);

function mintGT(seq, slot, rights, type) {
    const church = rights.some(r => 'LSE'.includes(r));
    const bits = church
        ? (rights.includes('L') ? 1 : 0) | (rights.includes('S') ? 2 : 0) | (rights.includes('E') ? 4 : 0)
        : (rights.includes('R') ? 1 : 0) | (rights.includes('W') ? 2 : 0) | (rights.includes('X') ? 4 : 0);
    return ((bits << 28) | ((church ? 1 : 0) << 27) | (type << 25) | (seq << 16) | slot) >>> 0;
}

function destination(selfSlot, selfSeq, depSlot, depSeq, hash = H1) {
    return [
        {
            N: 'alice.Bank#7', rights: 'E', type: 'Inform',
            ns_slot: selfSlot, sequence: selfSeq, authorized: true,
        },
        {
            N: 'church.Audit#3', T: 'a1b2c3d4', binary_hash: hash, identity_hash: H2,
            rights: 'LS', type: 'Inform', ns_slot: depSlot, sequence: depSeq,
            authorized: true,
        },
    ];
}

const a = Binding.bind(contract, destination(8, 1, 12, 4), { mintGT });
const b = Binding.bind(contract, destination(19, 7, 23, 8), { mintGT });
assert.equal(a.ok, true);
assert.equal(b.ok, true);
assert.notEqual(a.words[0], b.words[0], 'Self must relocate');
assert.notEqual(a.words[1], b.words[1], 'dependency must relocate');
assert.equal(contract.dependencies[0].T, null, 'portable Self is symbolic');
assert.equal(contract.dependencies[1].relocation_row, 1);

const wrongIssue = destination(8, 1, 12, 4);
wrongIssue[1].N = 'church.Audit#4';
assert.equal(Binding.bind(contract, wrongIssue, { mintGT }).code, 'EXACT_ISSUE_NOT_FOUND');
assert.equal(Binding.bind(contract, destination(8, 1, 12, 4, H2), { mintGT }).code, 'BINARY_HASH_MISMATCH');

const weak = JSON.parse(JSON.stringify(contract));
weak.dependencies[1].binary_hash = null;
assert.equal(Binding.bind(weak, destination(8, 1, 12, 4), { mintGT }).code, 'LEGACY_T_ONLY');
assert.equal(Binding.bind(weak, destination(8, 1, 12, 4), {
    mintGT,
    trustPolicy: 'allow-authorized-t-only',
    authorizeLegacy: () => true,
}).ok, true);

const before = { 0: 0xfeed5e1f, 1: 0 };
const denied = destination(8, 1, 12, 4);
denied[1].authorized = false;
const result = Binding.bind(contract, denied, { mintGT, baseWords: before });
assert.equal(result.ok, false);
assert.deepEqual(before, { 0: 0xfeed5e1f, 1: 0 }, 'failed binding must not mutate caller state');

// Installation uses strict candidate mode: an importing sidecar cannot claim a
// destination that was not derived from verified registry bytes/live Namespace.
const strictOwner = {
    N: 'alice.Bank#7', rights: 'E', type: 'Inform', ns_slot: 8, sequence: 1,
    binary_hash: H1, identity_hash: H2, authorized: true, verified: true,
};
const strictDestination = destination(8, 1, 12, 4);
strictDestination[0] = strictOwner;
strictDestination[1].verified = true;
strictDestination[1].identity_hash = H2;
assert.equal(Binding.bind(contract, strictDestination, {
    mintGT, ownerCandidate: strictOwner, requireVerifiedCandidates: true,
}).ok, true, 'verified live candidates bind end-to-end');
strictDestination[1].verified = false;
assert.equal(Binding.bind(contract, strictDestination, {
    mintGT, ownerCandidate: strictOwner, requireVerifiedCandidates: true,
}).code, 'UNVERIFIED_DESTINATION');

const noSelf = JSON.parse(JSON.stringify(contract));
noSelf.dependencies.shift();
assert.equal(Binding.bind(noSelf, destination(8, 1, 12, 4), { mintGT }).code, 'INVALID_SELF',
    'a supplied contract cannot omit compiler-owned Self row zero');
const duplicateSelfRow = JSON.parse(JSON.stringify(contract));
duplicateSelfRow.dependencies[1].relocation_row = 0;
assert.equal(Binding.bind(duplicateSelfRow, destination(8, 1, 12, 4), { mintGT }).code,
    'DUPLICATE_RELOCATION_ROW', 'externally supplied contracts have exactly one row zero');
assert.throws(() => Binding.createContract('alice.Bank#7', [
    { name: '__SELF__', compiler_owned_self: true, rights: 'E', type: 'Inform' },
    { N: 'church.Unpinned#1', T: '01020304', binary_hash: H1, rights: 'L', type: 'Inform' },
]), /identity_hash/, 'strong JS descriptors require an identity hash');

const savedOwner = Binding.deriveOwner({
    petname: 'alice.devices', abstraction: 'Bank', issue_number: 7,
});
const loadedOwner = Binding.deriveOwner({
    petname: 'alice.devices', abstraction: 'Bank',
    dot_name: 'alice.devices.Bank', issue_n: 7,
});
assert.equal(savedOwner, 'alice.devices.Bank#7');
assert.equal(loadedOwner, savedOwner, 'nonempty-petname save/load owner derivation must be identical');

console.log('portable LUMP binding tests passed');