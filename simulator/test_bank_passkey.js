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
new SystemAbstractions(registry);
sim.abstractionRegistry = registry;
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;