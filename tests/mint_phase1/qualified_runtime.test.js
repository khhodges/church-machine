'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {qualifiedFixture, verifyPins} = require('./qualified_fixture');
const {execute} = require('../../scripts/replay_protected_phase1');
const {provision} = require('../../simulator/mint/protected-runtime');
const {digest} = require('../../simulator/mint/protected-programs');
const Thread = require('../../simulator/thread_design');
const directory = process.env.PHASE1_LINKED_DIR;
assert(directory, 'Run scripts/run_protected_phase1.py to supply fresh qualified inputs');
const make = (scenario = 'mint') => {
    const result = qualifiedFixture(directory, scenario);
    verifyPins(result.evidence);
    return result;
};

test('all 17 approved entries plus 10 private descriptors fit with complete API frames', () => {
    const {plan, evidence} = make();
    const slots = [];
    for (let slot = 1; slot < 256; slot++) {
        if (plan.memory.slice(slot * 4, slot * 4 + 4).some(w => w !== 0)) slots.push(slot);
    }
    assert.deepEqual(slots, Array.from({length: 27}, (_, i) => i + 1));
    assert.equal(plan.memory[2], 26);
    assert.deepEqual(plan.threads.map(t => t.slot), [2, 11, 12]);
    assert.equal(evidence.footprint.runtimeStaticWords, 10340);
    assert.equal(evidence.footprint.sourceBearingStaticWords, 30372);
    assert(evidence.footprint.runtimeFits && !evidence.footprint.sourceBearingFits);
    assert.equal(plan.registry.owner, 0);
    assert.equal(plan.registry.recipient, 'ide.Mint');
    assert.deepEqual(plan.registry.replaceTargets, []);
    assert.deepEqual(plan.registry.destroyTargets, []);
    assert(plan.freeSlots.every(s => s > 27));
});

test('canonical code, exact bytes, links, grants, descriptor count and table aliases fail closed', () => {
    for (const mutate of [
        p => { p.memory[p.roles.mint.base + 1] ^= 1;
            p.roles.mint.hash = digest(Array.from(p.memory.slice(p.roles.mint.base,
                p.roles.mint.base + p.roles.mint.words))); },
        p => { p.roles.mint.readEntry++; },
        p => { p.roles.verifier.hash = '0'.repeat(64); },
        p => { p.registry.recipient = 'ide.Alice'; },
        p => { p.registry.owner = 1; },
        p => { p.registry.replaceTargets.push(10); },
        p => { p.registry.destroyTargets.push(10); },
        p => { p.memory[2]--; },
        p => { p.freeSlots.unshift(17); },
        p => { p.publicData[0].offset = 1; },
        p => { p.publicData[0].slot = 9; },
    ]) {
        const {plan} = make();
        mutate(plan);
        assert.throws(() => provision(plan), /MINT_PROVISION/);
    }
});

test('source/API artifacts reproduce every measured and pinned byte', () => {
    const {artifactFiles, evidence} = make();
    const {sha} = require('./qualified_fixture');
    for (const a of evidence.artifacts) {
        assert.equal(sha(artifactFiles[`slot-${a.slot}.api.lump`]), a.runtimeSha256);
        assert.equal(sha(artifactFiles[`slot-${a.slot}.source.lump`]), a.editingSha256);
        assert.equal(sha(artifactFiles[`slot-${a.slot}.cloomc`]), a.sourceSha256);
        assert.equal(artifactFiles[`slot-${a.slot}.api.lump`].length, a.runtimeWords * 4);
        assert.equal(artifactFiles[`slot-${a.slot}.source.lump`].length, a.editingWords * 4);
    }
});

test('report edits cannot authorize substituted candidate, source, links, or localized bytes', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'protected-inputs-'));
    try {
        const report = JSON.parse(fs.readFileSync(path.join(directory, 'report.json')));
        const files = ['report.json'];
        for (const e of report.entries.filter(e => e.candidateFilename)) {
            files.push(e.candidateFilename, `slot-${e.slot}.localized.lump`, `slot-${e.slot}.candidate.source`);
        }
        for (const file of files) fs.copyFileSync(path.join(directory, file), path.join(temp, file));
        const altered = structuredClone(report);
        altered.entries.find(e => e.slot === 10).binding.rows[0].newGT ^= 1;
        fs.writeFileSync(path.join(temp, 'report.json'), JSON.stringify(altered));
        assert.throws(() => verifyPins(qualifiedFixture(temp).evidence), /pins changed/);
        fs.copyFileSync(path.join(directory, 'report.json'), path.join(temp, 'report.json'));
        for (const file of files.filter(f => f !== 'report.json')) {
            const dest = path.join(temp, file), raw = fs.readFileSync(dest);
            const corrupt = Buffer.from(raw); corrupt[corrupt.length - 1] ^= 1;
            fs.writeFileSync(dest, corrupt);
            assert.throws(() => qualifiedFixture(temp));
            fs.writeFileSync(dest, raw);
        }
    } finally { fs.rmSync(temp, {recursive: true, force: true}); }
});

test('full-set suspended Thread chains participate in Mint liveness', () => {
    for (const slot of [11, 12]) {
        const {plan} = make(), t = plan.threads.find(t => t.slot === slot);
        const layout = Thread.layout(t.words, 32);
        plan.memory[t.base + layout.stackEnd] ^= 1;
        const state = execute(plan, 20000);
        assert.equal(state.fault, 'MINT_LIVE_CONTEXT');
        assert.equal(state.completedWrites, 0);
        assert.equal(state.memberCount, 26);
    }
});

test('publication readback, exhaustion and fault cuts remain fail-closed at the measured placement', () => {
    for (let word = 0; word < 4; word++) {
        const {plan} = make();
        plan.dropPublicationWord = word;
        const state = execute(plan, 20000);
        assert.equal(state.fault, 'MINT_READBACK');
        assert.equal(state.publications, 0);
        assert.equal(state.memberCount, 26);
        assert.equal(state.result, 0);
    }
    for (const mutate of [
        p => { p.freeSlots = []; },
        p => { p.allocationEnd = p.allocationStart + 4; },
    ]) {
        const {plan} = make(); mutate(plan);
        const state = execute(plan, 20000);
        assert.equal(state.fault, 'MINT_EXHAUSTED');
        assert(state.publications <= 1);
        assert.equal(state.memberCount, 26 + state.publications);
    }
    const {plan} = make(); plan.faultAt = 'write-2';
    const state = execute(plan, 20000);
    assert.equal(state.fault, 'MINT_INJECTED');
    assert.equal(state.completedWrites, 3);
    assert.equal(state.publications, 0);
    assert.equal(state.memberCount, 26);
});

test('qualified workload access does not weaken update exclusion or result publication', () => {
    for (const [kind, at, fault] of [
        ['activation', 'read', 'MINT_ACTIVATION'], ['switch', 'read', 'MINT_ACTIVATION'],
        ['write-request', 'verifying', 'MINT_EXCLUSION'], ['aba', 'read', 'MINT_EXCLUSION'],
        ['alias-result', 'published-lambda', 'MINT_RESULT_WRITE'],
        ['stale-registry', 'verified-return', 'MINT_CONTEXT'],
    ]) {
        const {plan} = make(); plan.negativeProbe = {kind, at};
        const state = execute(plan, 20000);
        assert.equal(state.fault, fault);
        assert(state.quarantined && !state.result && !state.useConfirmed);
    }
});

test('public Namespace identity never becomes a table read grant', () => {
    const {plan} = make('actors');
    const base = plan.memory[16 * 4], size = (plan.memory[16 * 4 + 1] & 0x1fffff) + 1;
    // Negative trusted initializer: replace Alice's BTN row with a root R alias.
    // This is not a permitted input to the positive pinned replay.
    plan.memory[base + size - 6 + 2] = 0x12000001;
    const state = execute(plan, 20000);
    assert.equal(state.fault, 'MINT_PRIVATE');
    assert.equal(state.publications, 0);
});

test('aggregate observations are immutable and never expose a core, private words or live references', () => {
    const {plan} = make(), runtime = provision(plan), before = runtime.status();
    assert.deepEqual(Object.keys(runtime).sort(), ['control', 'status', 'step']);
    for (let i = 0; i < 100; i++) runtime.step();
    const state = runtime.control('snapshot');
    assert(Object.isFrozen(state.execution) && Object.isFrozen(state.execution.slots));
    assert.equal(before.steps, 0);
    assert.deepEqual(before.execution.slots, {});
    assert.throws(() => { state.execution.slots[9].retired = 999; }, TypeError);
    const serialized = JSON.stringify(state);
    for (const key of ['memory', 'registers', 'proof', 'context', 'descriptor', 'source']) {
        assert(!serialized.includes(`"${key}"`));
    }
    // Input edits cannot reach the private running copy.
    plan.memory.fill(0);
    let final;
    for (let i = 0; i < 20000; i++) { final = runtime.step(); if (final.halted) break; }
    assert.equal(final.fault, null);
    assert(final.useConfirmed);
    const reset = runtime.control('reset');
    assert.equal(reset.fault, 'MINT_RESET');
    assert.deepEqual(runtime.step(), reset);
});
