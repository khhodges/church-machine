'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {qualifiedFixture, verifyPins, sha} = require('../tests/mint_phase1/qualified_fixture');
const {provision} = require('../simulator/mint/protected-runtime');
const {digest} = require('../simulator/mint/protected-programs');

function execute(plan, budget) {
    const original = digest(Array.from(plan.memory)), runtime = provision(plan);
    assert.deepEqual(Object.keys(runtime).sort(), ['control', 'status', 'step']);
    let state = runtime.status();
    for (let i = 0; i < budget && !state.halted; i++) state = runtime.step();
    assert.equal(digest(Array.from(plan.memory)), original, 'Runtime changed initializer bytes');
    assert(Object.isFrozen(runtime) && Object.isFrozen(state));
    return state;
}
function replay(directory) {
    const scenarios = {};
    let common;
    for (const scenario of ['mint', 'workload', 'actors', 'alice-denied', 'mallory-denied']) {
        const {plan, evidence} = qualifiedFixture(directory, scenario);
        verifyPins(evidence);
        common ||= evidence;
        const budget = scenario === 'workload' ? 6000 : 20000;
        const states = Array.from({length: 3}, () => execute(plan, budget));
        assert.deepEqual(states[1], states[0]);
        assert.deepEqual(states[2], states[0]);
        const state = states[0];
        if (scenario.endsWith('-denied')) {
            assert.equal(state.fault, scenario === 'alice-denied' ? 'MINT_REQUESTER' : 'NO_CAPABILITY');
            assert.equal(state.publications, 0);
            assert.equal(state.memberCount, 26);
            assert(state.quarantined && !state.result && !state.useConfirmed);
        } else {
            assert.equal(state.fault, null, scenario);
            assert.equal(state.quarantined, false);
        }
        scenarios[scenario] = {imageSha256: evidence.initialImageSha256,
            repeatRuns: states.map(s => sha(JSON.stringify(s))), state};
    }
    const mint = scenarios.mint.state, workload = scenarios.workload.state;
    const actors = scenarios.actors.state;
    assert(mint.halted && mint.useConfirmed);
    assert.equal(mint.admissions, 2);
    assert.equal(mint.publications, 2);
    assert.equal(mint.memberCount, 28);
    assert.equal(mint.completedWrites, 8);
    assert.equal(mint.comparedWords, 8);
    assert.equal(mint.lambdaEntries, 4);
    assert.equal(mint.result, 0x3200001d);
    assert.equal(workload.steps, 6000);
    assert.equal(workload.halted, false);
    assert.equal(workload.execution.selfTestReturns, 14);
    assert.equal(workload.execution.selfTestFailures, 0);
    assert.equal(workload.execution.guardsPassed, 1176);
    assert.equal(workload.execution.guardsFailed, 0);
    assert(actors.halted);
    assert(actors.execution.slots[12].threadSteps > 0);
    assert.equal(actors.execution.slots[5].dataReads, 1);
    assert.equal(actors.execution.slots[5].dataWrites, 1);
    const coverage = common.entries.map(e => {
        const counts = {};
        // Keep negative-run counts out of normal workload totals.
        const runs = e.slot === 17 ? [scenarios['mallory-denied'].state] : [mint, workload, actors];
        for (const s of runs) {
            for (const [key, value] of Object.entries(s.execution.slots[e.slot] || {})) {
                counts[key] = (counts[key] || 0) + value;
            }
        }
        if (e.slot === 1) counts.namespaceSwitches = workload.execution.namespaceSwitches;
        assert(Object.values(counts).some(n => n > 0), `NS[${e.slot}] has no operational evidence`);
        return {slot: e.slot, name: e.name, counts,
            outcome: e.slot === 17 ? 'expected-protection-rejection' : 'operational'};
    });
    return {...common, scenario: undefined, initialImageSha256: undefined,
        status: 'passed', acceptance: 'isolated-complete-api-profile-bounded-replays',
        full17EntryBehaviorCoverage: true, normalOperationalEntries: 16,
        expectedRejectionEntries: [17], unexpectedFaults: 0, scenarios, coverage,
        sourceBearingRuntimeAccepted: false, singleContinuousRun: false};
}
if (require.main === module) {
    const directory = process.argv[2], report = replay(directory);
    const built = qualifiedFixture(directory);
    verifyPins(built.evidence);
    const artifactDirectory = path.join(directory, 'protected-artifacts');
    fs.mkdirSync(artifactDirectory, {recursive: true});
    for (const [name, raw] of Object.entries(built.artifactFiles)) {
        fs.writeFileSync(path.join(artifactDirectory, name), raw);
    }
    const files = ['simulator/mint/protected-runtime.js', 'simulator/mint/protected-policy.js',
        'simulator/mint/protected-programs.js', 'simulator/mint/provision-validation.js',
        'simulator/mint/combined-ls-profile.js', 'simulator/mint/execution-counters.js',
        'simulator/mint/fault-injection.js', 'simulator/namespace-runtime-core.js',
        'simulator/namespace-runtime-view.js', 'simulator/simulator.js',
        'simulator/assembler.js', 'simulator/lump_builder.js',
        'tests/mint_phase1/protected_fixture.js', 'tests/mint_phase1/qualified_fixture.js',
        'tests/mint_phase1/qualified-pins.json', 'scripts/replay_protected_phase1.js',
        'simulator/examples/alice.cloomc', 'simulator/examples/mallory.cloomc'];
    report.fingerprints = Object.fromEntries(files.map(file =>
        [file, sha(fs.readFileSync(path.join(__dirname, '..', file)))]));
    fs.writeFileSync(path.join(directory, 'protected-report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('PASS sealed complete Namespace: 17 original + 10 private, 3 positive and 2 denied scenarios, each repeated 3 times');
}
module.exports = {replay, execute};
