'use strict';
// Bank.ObtainPassKey tests: fresh credentials for an existing stored object.

const ChurchSimulator = require('./simulator.js');
const AbstractionRegistry = require('./abstractions.js');
const SystemAbstractions = require('./system_abstractions.js');

let pass = 0;
let fail = 0;
function check(label, condition) {
    if (condition) {
        console.log(`PASS ${label}`);
        pass++;
    } else {
        console.log(`FAIL ${label}`);
        fail++;
    }
}

const sim = new ChurchSimulator();
const registry = new AbstractionRegistry();
const systemAbs = new SystemAbstractions(registry);
sim.initAbstractions(registry, systemAbs, null);
sim.bootComplete = true;
sim.mElevation = true;
registry.dispatchMethod(5, 'Init', sim, {});

let accessCount = 0;
const stored = registry.dispatchMethod(5, 'SecureObjectAdd', sim, {
    name: 'Stored.Lockbox',
    methods: { Open: () => ({ opened: ++accessCount }) }
});
check('BANK01: stored object exists before requesting its Bank passkey', stored.ok);

const ownerKey = stored.result.ownerPassKey;
const obtained = registry.dispatchMethod(54, 'ObtainPassKey', sim, {
    objectId: stored.result.objectId,
    passKey: ownerKey
});
check('BANK02: Bank obtains a fresh passkey with the owner credential', obtained.ok);
check('BANK03: Bank returns a GT and private proof pair',
    obtained.ok && obtained.result.passKey.gt !== 0 &&
    Array.isArray(obtained.result.passKey.proof) &&
    obtained.result.passKey.proof.length === 4);
check('BANK04: Bank does not return a Namespace slot as the authority',
    obtained.ok && obtained.result.nsIndex === undefined);

const opened = registry.dispatchMethod(5, 'SecureObjectCall', sim, {
    objectId: stored.result.objectId,
    method: 'Open',
    passKey: obtained.result.passKey
});
check('BANK05: obtained passkey authorises the stored object method',
    opened.ok && opened.result.opened === 1 && accessCount === 1);

const wrongObject = registry.dispatchMethod(54, 'ObtainPassKey', sim, {
    objectId: stored.result.objectId + 1,
    passKey: ownerKey
});
check('BANK06: Bank rejects an unknown stored-object id', !wrongObject.ok);

const wrongOwner = registry.dispatchMethod(54, 'ObtainPassKey', sim, {
    objectId: stored.result.objectId,
    passKey: obtained.result.passKey
});
check('BANK07: a delegated object passkey cannot mint another Bank passkey', !wrongOwner.ok);

registry.dispatchMethod(5, 'SecureObjectRevoke', sim, {
    objectId: stored.result.objectId,
    passKey: ownerKey
});
const stale = registry.dispatchMethod(54, 'ObtainPassKey', sim, {
    objectId: stored.result.objectId,
    passKey: ownerKey
});
check('BANK08: Bank rejects the owner credential after object revocation',
    !stale.ok && stale.fault === 'REVOKED');

// Full custody lifecycle against a real Namespace-backed source region.
const sourceAllocation = registry.dispatchMethod(7, 'Allocate', sim, { size: 8 });
const sourceRegistration = registry.dispatchMethod(5, 'Add', sim, {
    location: sourceAllocation.result.location,
    limit: sourceAllocation.result.size - 1,
    gtType: 1,
    label: 'Test.SourceRegion'
});
const sourceWords = [0x4c554d50, 0x00010003, 0xdeadbeef, 0xcafebabe];
sourceWords.forEach((word, index) => {
    sim.memory[sourceAllocation.result.location + index] = word;
});
const sourceGT = sim.createGT(
    sourceRegistration.result.version,
    sourceRegistration.result.nsIndex,
    { R: 1, W: 1 },
    1
);

sim.mElevation = true;
// An attacker can pre-register an alias at a predictable future allocator
// address; Bank must still reject the alias once that address becomes custody.
const predictedLockboxLocation = systemAbs._memoryState.nextFreeAddr;
const preExistingAlias = registry.dispatchMethod(5, 'Add', sim, {
    location: predictedLockboxLocation,
    limit: 63,
    gtType: 1,
    label: 'Attacker.PreExistingAlias'
});
const preExistingAliasGT = sim.createGT(
    preExistingAlias.result.version,
    preExistingAlias.result.nsIndex,
    { R: 1 },
    1
);
const minted = registry.dispatchMethod(54, 'MintKey', sim, { capacity: 8 });
check('BANK09: MintKey creates an opaque dynamic lockbox key', minted.ok &&
    minted.result.lockboxId > 0 && minted.result.bankKey.gt !== undefined &&
    minted.result.nsIndex === undefined);
const lockboxId = minted.result.lockboxId;
const bankKey = minted.result.bankKey;
const firstLockbox = systemAbs._bankState.lockboxes[lockboxId];
const reissued = registry.dispatchMethod(54, 'ObtainPassKey', sim, { lockboxId, bankKey });
const reissuedKey = reissued.result.passKey;
check('BANK09b: a lockbox backing entry is Outform, not a public memory region',
    firstLockbox && sim.readNSEntry(firstLockbox.nsIndex).gtType === 2 &&
    sim._bankPrivateSlots[firstLockbox.nsIndex].lockboxId === lockboxId);
const guessedBackingGT = sim.createGT(firstLockbox.nsVersion, firstLockbox.nsIndex, { R: 1 }, 1);
check('BANK09c: guessed Inform GTs cannot resolve private Bank backing storage',
    !sim.mLoad(guessedBackingGT, 'R', null, firstLockbox.location).ok);
const aliasedRegistration = registry.dispatchMethod(5, 'Add', sim, {
    location: firstLockbox.location,
    limit: 0,
    gtType: 1,
    label: 'Attacker.BankAlias'
});
check('BANK09d: Navana refuses an Inform alias for active private Bank custody',
    !aliasedRegistration.ok && aliasedRegistration.fault === 'NO_CAPABILITY');
const deposited = registry.dispatchMethod(54, 'Deposit', sim, {
    lockboxId, bankKey, sourceGT, words: sourceWords.length, kind: 'lump'
});
check('BANK10: Deposit accepts a bounded LUMP region', deposited.ok &&
    deposited.result.contentsType === 'lump' && deposited.result.contentsWords === sourceWords.length);
const attackerBox = registry.dispatchMethod(54, 'MintKey', sim, { capacity: 4 });
const aliasExfiltration = registry.dispatchMethod(54, 'Deposit', sim, {
    lockboxId: attackerBox.result.lockboxId,
    bankKey: attackerBox.result.bankKey,
    sourceGT: preExistingAliasGT,
    words: 1
});
check('BANK10b: pre-existing Namespace aliases cannot read Bank custody',
    firstLockbox.location === predictedLockboxLocation &&
    !aliasExfiltration.ok && aliasExfiltration.fault === 'NO_CAPABILITY');
const inspected = registry.dispatchMethod(54, 'Inspect', sim, { lockboxId, bankKey });
check('BANK11: Inspect exposes custody metadata but not storage authority',
    inspected.ok && inspected.result.deposited &&
    inspected.result.capacity >= sourceWords.length &&
    inspected.result.location === undefined && inspected.result.nsIndex === undefined);
const boundsBox = registry.dispatchMethod(54, 'MintKey', sim, { capacity: 4 });
const badDeposit = registry.dispatchMethod(54, 'Deposit', sim, {
    lockboxId: boundsBox.result.lockboxId,
    bankKey: boundsBox.result.bankKey,
    sourceGT, sourceOffset: sourceAllocation.result.size - 1, words: 2
});
check('BANK12: invalid source bounds fail without changing custody',
    !badDeposit.ok && badDeposit.fault === 'BOUNDS' &&
    registry.dispatchMethod(54, 'Inspect', sim, {
        lockboxId: boundsBox.result.lockboxId, bankKey: boundsBox.result.bankKey
    }).result.contentsWords === 0);
const staleSourceBox = registry.dispatchMethod(54, 'MintKey', sim, { capacity: 4 });
const staleSourceGT = sim.createGT(
    (sourceRegistration.result.version + 1) & 0x1FF,
    sourceRegistration.result.nsIndex,
    { R: 1, W: 1 },
    1
);
const staleSourceDeposit = registry.dispatchMethod(54, 'Deposit', sim, {
    lockboxId: staleSourceBox.result.lockboxId,
    bankKey: staleSourceBox.result.bankKey,
    sourceGT: staleSourceGT,
    words: 1
});
check('BANK12b: stale source capabilities cannot alter a lockbox',
    !staleSourceDeposit.ok && staleSourceDeposit.fault === 'STALE_KEY' &&
    registry.dispatchMethod(54, 'Inspect', sim, {
        lockboxId: staleSourceBox.result.lockboxId, bankKey: staleSourceBox.result.bankKey
    }).result.contentsWords === 0);
const noReadBox = registry.dispatchMethod(54, 'MintKey', sim, { capacity: 4 });
const noReadGT = sim.createGT(
    sourceRegistration.result.version,
    sourceRegistration.result.nsIndex,
    { W: 1 },
    1
);
const noReadDeposit = registry.dispatchMethod(54, 'Deposit', sim, {
    lockboxId: noReadBox.result.lockboxId,
    bankKey: noReadBox.result.bankKey,
    sourceGT: noReadGT,
    words: 1
});
check('BANK12c: a source capability without R permission is rejected',
    !noReadDeposit.ok && noReadDeposit.fault === 'PERM' &&
    registry.dispatchMethod(54, 'Inspect', sim, {
        lockboxId: noReadBox.result.lockboxId, bankKey: noReadBox.result.bankKey
    }).result.contentsWords === 0);

const withdrawn = registry.dispatchMethod(54, 'Withdraw', sim, { lockboxId, passKey: reissuedKey });
check('BANK13: Withdraw returns a fresh memory GT', withdrawn.ok &&
    withdrawn.result.gt !== undefined && withdrawn.result.words === sourceWords.length);
const releasedEntry = sim.readNSEntry(sim.parseGT(withdrawn.result.gt).index);
check('BANK14: withdrawn GT resolves to an independent copied region',
    releasedEntry && sourceWords.every((word, index) => sim.memory[releasedEntry.word0_location + index] === word));
const reusedAfterWithdraw = registry.dispatchMethod(7, 'Allocate', sim, { size: 4 });
check('BANK14b: withdrawal zeroizes custody memory before allocator reuse',
    reusedAfterWithdraw.ok && reusedAfterWithdraw.result.location === firstLockbox.location &&
    Array.from(sim.memory.slice(reusedAfterWithdraw.result.location,
        reusedAfterWithdraw.result.location + reusedAfterWithdraw.result.size)).every(word => word === 0));
const duplicateWithdraw = registry.dispatchMethod(54, 'Withdraw', sim, { lockboxId, passKey: reissuedKey });
check('BANK15: duplicate withdrawal is rejected after quarantine', !duplicateWithdraw.ok);
const revokedUnderlyingKey = registry.dispatchMethod(5, 'SecureObjectCall', sim, {
    objectId: firstLockbox.securityObjectId,
    method: 'Inspect',
    passKey: reissuedKey
});
check('BANK15b: withdrawal revokes the underlying delegated PassKey too',
    !revokedUnderlyingKey.ok && revokedUnderlyingKey.fault === 'REVOKED');

const second = registry.dispatchMethod(54, 'MintKey', sim, { capacity: 4 });
const secondLockbox = systemAbs._bankState.lockboxes[second.result.lockboxId];
const secondDeposit = registry.dispatchMethod(54, 'Deposit', sim, {
    lockboxId: second.result.lockboxId,
    bankKey: second.result.bankKey,
    sourceGT,
    words: sourceWords.length
});
const secondRevoke = registry.dispatchMethod(54, 'Revoke', sim, {
    lockboxId: second.result.lockboxId, bankKey: second.result.bankKey
});
const reusedAfterRevoke = registry.dispatchMethod(7, 'Allocate', sim, { size: 4 });
check('BANK16: Revoke invalidates a populated lockbox and clears its backing storage',
    secondDeposit.ok && secondRevoke.ok && secondRevoke.result.revoked &&
    reusedAfterRevoke.ok && reusedAfterRevoke.result.location === secondLockbox.location &&
    Array.from(sim.memory.slice(reusedAfterRevoke.result.location,
        reusedAfterRevoke.result.location + reusedAfterRevoke.result.size)).every(word => word === 0));
const revokedInspect = registry.dispatchMethod(54, 'Inspect', sim, {
    lockboxId: second.result.lockboxId, bankKey: second.result.bankKey
});
check('BANK17: revoked keys cannot inspect custody', !revokedInspect.ok && revokedInspect.fault === 'REVOKED');
const listed = registry.dispatchMethod(54, 'List', sim, {});
check('BANK18: List returns safe metadata for lockbox records',
    listed.ok && listed.result.some(entry => entry.lockboxId === lockboxId) &&
    listed.result.every(entry => entry.location === undefined && entry.nsIndex === undefined));

const rollbackBox = registry.dispatchMethod(54, 'MintKey', sim, { capacity: 4 });
const rollbackRecord = systemAbs._bankState.lockboxes[rollbackBox.result.lockboxId];
const rollbackDeposit = registry.dispatchMethod(54, 'Deposit', sim, {
    lockboxId: rollbackBox.result.lockboxId,
    bankKey: rollbackBox.result.bankKey,
    sourceGT,
    words: sourceWords.length
});
const rollbackDestination = systemAbs._memoryState.nextFreeAddr;
const originalDispatch = registry.dispatchMethod;
registry.dispatchMethod = function(index, method, targetSim, methodArgs) {
    if (index === 5 && method === 'Remove' && methodArgs &&
            methodArgs.index === rollbackRecord.nsIndex) {
        return { ok: false, fault: 'INJECTED', message: 'old lockbox removal refused' };
    }
    return originalDispatch.call(this, index, method, targetSim, methodArgs);
};
const rollbackWithdraw = registry.dispatchMethod(54, 'Withdraw', sim, {
    lockboxId: rollbackBox.result.lockboxId, bankKey: rollbackBox.result.bankKey
});
registry.dispatchMethod = originalDispatch;
check('BANK19: failed withdrawal zeroizes the copied destination before release',
    rollbackDeposit.ok && !rollbackWithdraw.ok &&
    Array.from(sim.memory.slice(rollbackDestination, rollbackDestination + 64))
        .every(word => word === 0));

sim.reset();
check('BANK20: same-instance reset clears Bank custody, credentials, and private guards',
    systemAbs.getBankLockboxes().length === 0 &&
    Object.keys(sim._bankPrivateSlots).length === 0 &&
    sim._bankPrivateRanges.length === 0 &&
    Object.keys(systemAbs._memoryState.allocations).length === 0 &&
    !registry.dispatchMethod(54, 'Inspect', sim, { lockboxId, bankKey }).ok);
registry.dispatchMethod(5, 'Init', sim, {});
sim.mElevation = true;
sim.allocOrFindNsSlot = () => null; // model a Namespace with no free dynamic slot
const allocationKeysBeforeExhaustion = Object.keys(systemAbs._memoryState.allocations).sort();
const exhausted = registry.dispatchMethod(54, 'MintKey', sim, { capacity: 4 });
check('BANK21: Namespace exhaustion rolls back the unregistered lockbox allocation',
    !exhausted.ok && exhausted.fault === 'NS_FULL' &&
    systemAbs.getBankLockboxes().length === 0 &&
    JSON.stringify(Object.keys(systemAbs._memoryState.allocations).sort()) ===
        JSON.stringify(allocationKeysBeforeExhaustion));

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;