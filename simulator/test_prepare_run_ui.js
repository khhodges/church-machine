'use strict';
// Compatibility entrypoints must lead only to private simulation review.
// Publication/CAS-retry tests for the retired shared Prepare/Run transaction
// are deliberately replaced: that transaction is no longer a simulator action.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const abstractions = fs.readFileSync(__dirname + '/app-abstractions.js', 'utf8');
const preparation = fs.readFileSync(__dirname + '/app-simulation-preparation.js', 'utf8');
const memory = fs.readFileSync(__dirname + '/app-memory.js', 'utf8');
const run = fs.readFileSync(__dirname + '/app-run.js', 'utf8');
function fn(source, name) {
    const match = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
    assert(match, name);
    return source.slice(match.index, source.indexOf('\n}', match.index) + 2);
}
assert.doesNotMatch(abstractions, /\/api\/boot-image\/generate|Retry boot-image cache|Prepare boot image<\/button>/);
assert.doesNotMatch(abstractions, /simulationPreparationAbstractionsPanel/);
assert.match(memory, /Advanced — Simulation configuration[\s\S]*simulationPreparationPanel[\s\S]*SimulationPreparation\.markup\(\)/,
    'optional private preparation belongs in the advanced Namespace panel');
assert.doesNotMatch(fn(run, '_showBootPreparationBlocked'), /click Prepare boot image|committed image is prepared/);
assert.doesNotMatch(fn(run, '_ensureCommittedImageForBoot'), /fetch|generateBootImage|savePreparedBootEntry/);
assert.match(fn(memory, 'generateBootImage'), /\/api\/boot-image\/generate/,
    'independent explicit hardware publication remains available');
assert.doesNotMatch(fn(memory, 'generateBootImage'), /sim\.loadBootImage|sim\.reset|SimulationPreparation\.activate/);
const calls = [];
const panels = { simulationPreparationPanel: { innerHTML: '' } };
const saved = { namespaceFingerprint: 'saved-design', abstractions: [{ slot: 6, boot: true }] };
const pins = { 6: { revision: 1, token: 'exact', filename: 'exact.lump' } };
const context = {
    window: { _nsState: saved, _prepareRunArtifactPins: pins },
    document: { getElementById: id => panels[id] || null },
    sim: { running: false, walkActive: false,
        reset() { throw new Error('review cannot reset'); },
        loadBootImage() { throw new Error('review cannot load'); } },
    async fetch(url, options) {
        calls.push({ url, payload: JSON.parse(options.body) });
        assert.strictEqual(url, '/api/simulation/prepare', 'no simulator entrypoint reaches legacy generation');
        return { ok: true, json: async () => ({
            preparationId: 'review', configurationHash: 'configuration', imageHash: 'image',
            sourceNamespaceFingerprint: 'saved-design', preparedRows: [],
            layoutChanges: [], artifactBindings: [], hardwareCertified: false,
        }) };
    },
};
vm.createContext(context);
vm.runInContext(preparation, context);
for (const name of ['savePreparedBootEntry', 'refreshPreparedBootImageCache', 'prepareSavedArtifactForRun']) {
    vm.runInContext(fn(abstractions, name), context);
}
(async () => {
    const before = JSON.stringify(saved);
    for (const name of ['savePreparedBootEntry', 'refreshPreparedBootImageCache', 'prepareSavedArtifactForRun']) {
        assert.strictEqual(await context[name](), true, name);
        assert.strictEqual(JSON.stringify(saved), before, 'preparation cannot adopt or rewrite Namespace rows');
        assert.strictEqual(context.window._prepareRunArtifactPins, pins, 'compatibility alias preserves exact draft intent');
        assert(!context.sim.simulationConfiguration, 'review neither approves nor activates');
    }
    assert.strictEqual(calls.length, 3);
    assert(calls.every(call => JSON.stringify(call.payload) === '{"namespaceFingerprint":"saved-design"}'));
    assert.match(panels.simulationPreparationPanel.innerHTML, /Prepare for Simulation/);
    assert.match(panels.simulationPreparationPanel.innerHTML, /Approve Configuration/);
    assert.match(panels.simulationPreparationPanel.innerHTML, /Activate Simulation/);
    delete context.window.SimulationPreparation;
    await assert.rejects(context.savePreparedBootEntry(), /unavailable/);
    assert.strictEqual(calls.length, 3, 'missing private API cannot fall back to generation');
    console.log('private preparation compatibility entrypoint tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });