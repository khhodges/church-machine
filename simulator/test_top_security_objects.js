'use strict';
// Programmer-defined top-security object / PassKey regression tests.

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

function makeSim() {
    const sim = new ChurchSimulator();
    const registry = new AbstractionRegistry();
    new SystemAbstractions(registry);
    sim.abstractionRegistry = registry;
    sim.bootComplete = true;
    sim.mElevation = true;
    const init = registry.dispatchMethod(5, 'Init', sim, {});
    if (!init.ok) throw new Error(init.message);
    return { sim, registry };
}

console.log('\n--- Top-security object PassKey tests ---');
{
    const { sim, registry } = makeSim();
    let releaseCount = 0;
    const added = registry.dispatchMethod(5, 'SecureObjectAdd', sim, {
        name: 'Treasury.Vault',
        methods: {
            Inspect: () => ({ contents: 'sealed' }),
            Release: () => ({ released: ++releaseCount })
        }
    });
    check('TSO01: M-elevated programmer can add a top-security object', added.ok);
    check('TSO02: object receives an owner PassKey', added.ok && added.result.ownerPassKeyGT !== 0);

    const objectId = added.result.objectId;
    const ownerKey = added.result.ownerPassKey;
    const predictableGuess = sim.createGT(1, 1, { E: 1 }, 2);
    const guessed = registry.dispatchMethod(5, 'SecureObjectCall', sim, {
        objectId, method: 'Release', passKeyGT: predictableGuess, passKeyProof: [0, 0, 0, 0]
    });
    check('TSO03: a counter-derived GT plus a guessed proof cannot access a method', !guessed.ok && guessed.fault === 'PERM');
    const incorrectProof = ownerKey.proof.slice();
    incorrectProof[0] ^= 1;
    const proofMismatch = registry.dispatchMethod(5, 'SecureObjectCall', sim, {
        objectId, method: 'Release', passKey: { gt: ownerKey.gt, proof: incorrectProof }
    });
    check('TSO03b: an issued GT with a wrong proof cannot access a method',
        !proofMismatch.ok && proofMismatch.fault === 'PERM');

    const denied = registry.dispatchMethod(5, 'SecureObjectCall', sim, {
        objectId, method: 'Release', passKeyGT: 0, passKeyProof: [0, 0, 0, 0]
    });
    check('TSO04: missing key cannot call protected method', !denied.ok && denied.fault === 'PERM');
    check('TSO05: denied calls do not execute the protected handler', releaseCount === 0);

    const delegated = registry.dispatchMethod(5, 'SecureObjectMintPassKey', sim, {
        objectId, passKey: ownerKey, methods: ['Inspect']
    });
    check('TSO06: owner can delegate a method-limited PassKey', delegated.ok);

    const inspect = registry.dispatchMethod(5, 'SecureObjectCall', sim, {
        objectId, method: 'Inspect', passKey: delegated.result.passKey
    });
    check('TSO07: delegated key accesses its assigned method', inspect.ok && inspect.result.contents === 'sealed');

    const restricted = registry.dispatchMethod(5, 'SecureObjectCall', sim, {
        objectId, method: 'Release', passKey: delegated.result.passKey
    });
    check('TSO08: delegated key cannot access another protected method', !restricted.ok && restricted.fault === 'PERM');
    check('TSO09: restricted call does not execute handler', releaseCount === 0);

    const revoke = registry.dispatchMethod(5, 'SecureObjectRevoke', sim, {
        objectId, passKey: ownerKey, targetPassKeyGT: delegated.result.passKeyGT
    });
    check('TSO10: owner can revoke a delegated PassKey', revoke.ok);

    const stale = registry.dispatchMethod(5, 'SecureObjectCall', sim, {
        objectId, method: 'Inspect', passKey: delegated.result.passKey
    });
    check('TSO11: revoked delegated PassKey is rejected', !stale.ok && stale.fault === 'PERM');

    const ownerRelease = registry.dispatchMethod(5, 'SecureObjectCall', sim, {
        objectId, method: 'Release', passKey: ownerKey
    });
    check('TSO12: owner PassKey can call every protected method', ownerRelease.ok && releaseCount === 1);
    const registerProofCall = registry.dispatchMethod(5, 'SecureObjectCall', sim, {
        objectId,
        method: 'Release',
        passKeyGT: ownerKey.gt,
        dr2: ownerKey.proof[0],
        dr3: ownerKey.proof[1],
        dr4: ownerKey.proof[2],
        dr5: ownerKey.proof[3]
    });
    check('TSO12b: the GT plus DR2–DR5 proof form authorises a machine-style call',
        registerProofCall.ok && releaseCount === 2);

    const revokeObject = registry.dispatchMethod(5, 'SecureObjectRevoke', sim, {
        objectId, passKey: ownerKey
    });
    check('TSO13: owner can revoke the complete top-security object', revokeObject.ok);
    const revokedOwner = registry.dispatchMethod(5, 'SecureObjectCall', sim, {
        objectId, method: 'Release', passKey: ownerKey
    });
    check('TSO14: whole-object revocation rejects the owner and every remaining key',
        !revokedOwner.ok && revokedOwner.fault === 'REVOKED');
}

{
    const { sim, registry } = makeSim();
    sim.mElevation = false;
    const denied = registry.dispatchMethod(5, 'SecureObjectAdd', sim, {
        name: 'Denied', methods: ['Read']
    });
    check('TSO15: unprivileged code cannot define top-security objects', !denied.ok && denied.fault === 'PERM');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;