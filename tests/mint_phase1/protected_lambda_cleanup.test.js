'use strict';

// Real private-core execution through the public facade. No injected runtime
// methods, PC changes or register mutations supply cleanup.
const assert = require('node:assert/strict');
const {fixture} = require('./protected_fixture');
const {provision} = require('../../simulator/mint/protected-runtime');
const {digest} = require('../../simulator/mint/protected-programs');

for (const options of [{}, {proof: [0, 0, 0, 0], expectedProof: [0, 0, 0, 0]}]) {
    const plan = fixture(options);
    const original = digest(Array.from(plan.memory));
    const runtime = provision(plan);
    let before, state = runtime.status();
    for (let step = 0; step < 20000 && !state.halted; step++) {
        before = state;
        state = runtime.step();
    }
    assert.equal(state.fault, 'MINT_CLEANUP_UNBOUND');
    assert.equal(state.halted, true);
    assert.equal(state.quarantined, true);
    assert.equal(state.lambdaEntries, 1, 'actual private Lambda entry was executed');
    assert.equal(before.phase, 'read', 'failure occurs at the validated read-Lambda return');
    assert.equal(state.protectedReturns, 0, 'no Lambda or public return succeeds');
    assert.equal(state.completedWrites, 0, 'no Namespace slot is published');
    assert.equal(state.publications, 0);
    assert.equal(state.result, 0, 'no result capability escapes');
    assert.equal(state.useConfirmed, false);
    assert.deepEqual(runtime.step(), state, 'quarantine cannot resume');
    assert.deepEqual(runtime.control('pause'), state);
    assert.deepEqual(runtime.control('snapshot'), state);
    assert.equal(digest(Array.from(plan.memory)), original, 'no initializer mutation');
}
console.log('PASS: protected Mint fails closed at Lambda RETURN; no illegal cleanup, publication or result');
