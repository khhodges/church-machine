'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(__dirname + '/app-simulation-preparation.js', 'utf8');

function harness() {
    const calls = [];
    const panel = { innerHTML: '' };
    const prepared = {
        ok: true, preparationId: 'private-1', configurationHash: 'hash-1',
        sourceNamespaceFingerprint: 'saved-1', preparedRows: [{ slot: 1, address: 900 }],
        layoutChanges: [{ slot: 1, from: 800, to: 900 }],
        artifactBindings: [{ slot: 1, binaryHash: 'frozen-artifact' }],
        hardwareCertified: false, approvalRequired: true,
    };
    const context = {
        window: { _nsState: { namespaceFingerprint: 'saved-1', savedAbstractions: [{ slot: 1, address: 800 }] } },
        document: { getElementById: id => id === 'simulationPreparationPanel' ? panel : null },
        sim: { running: false, walkActive: false,
            bindSimulationConfiguration(image, configuration) {
                assert(image instanceof ArrayBuffer || image.byteLength === 12);
                const freeze = value => {
                    if (value && typeof value === 'object') {
                        Object.values(value).forEach(freeze); Object.freeze(value);
                    }
                    return value;
                };
                this.simulationConfiguration = freeze(configuration);
            },
            reset() { calls.push(['reset']); }, loadBootImage(image) {
            calls.push(['load', Array.from(new Uint32Array(image))]); return true;
        } },
        async fetch(url, options) {
            calls.push([url, JSON.parse(options.body)]);
            if (context.pause) await context.pause;
            const action = url.split('/').pop();
            return { ok: true, json: async () => context.response || (action === 'prepare' ? prepared : {
                preparationId: 'private-1', configurationHash: 'hash-1',
                approved: action === 'approve', activated: action === 'activate',
                words: [1, 2, 0xffffffff], imageHash: 'image-1',
            }) };
        },
        Uint32Array, JSON, Object, Number, String, Array, Error,
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    return { context, ui: context.window.SimulationPreparation, calls, panel, prepared };
}

(async () => {
    const h = harness();
    const saved = JSON.stringify(h.context.window._nsState);
    assert.strictEqual(await h.ui.activate(), false);
    assert.strictEqual(h.calls.length, 0);
    assert.strictEqual(await h.ui.prepare(), true);
    assert.deepStrictEqual(h.calls, [['/api/simulation/prepare', { namespaceFingerprint: 'saved-1' }]]);
    assert.match(h.panel.innerHTML, /Proposed private layout changes/);
    assert.match(h.panel.innerHTML, /900/);
    assert.match(h.panel.innerHTML, /Approve Configuration/);
    assert.match(h.panel.innerHTML, /Activate Simulation/);
    assert.strictEqual(h.context.sim.simulationConfiguration, undefined);
    assert.strictEqual(await h.ui.approve(), true);
    assert.strictEqual(h.calls.some(c => c[0] === 'load'), false, 'approval must not load or run');
    assert.strictEqual(await h.ui.activate(), true);
    assert.deepStrictEqual(h.calls[3], ['load', [1, 2, 0xffffffff]]);
    assert.strictEqual(JSON.stringify(h.context.window._nsState), saved, 'private flow cannot normalize saved rows');
    const config = h.context.sim.simulationConfiguration;
    assert.strictEqual(config.configurationHash, 'hash-1');
    assert(Object.isFrozen(config));
    assert(Object.isFrozen(config.preparedRows[0]));
    h.prepared.preparedRows[0].address = 123;
    assert.strictEqual(config.preparedRows[0].address, 900);
    assert.strictEqual(await h.ui.activate(), false, 'activation cannot replay without review');
    h.ui.invalidate();
    assert.strictEqual(h.context.sim.simulationConfiguration, config, 'draft changes preserve loaded evidence');

    const changed = harness();
    await changed.ui.prepare();
    changed.context.window._nsState.namespaceFingerprint = 'changed';
    assert.strictEqual(await changed.ui.approve(), false);
    assert.strictEqual(changed.calls.length, 1);

    const dirty = harness();
    dirty.context.window._nsTableDirty = true;
    assert.strictEqual(await dirty.ui.prepare(), false);
    assert.strictEqual(dirty.calls.length, 0);
    assert.match(dirty.panel.innerHTML, /Save the Namespace Table/);

    const pending = harness();
    let release;
    pending.context.pause = new Promise(resolve => { release = resolve; });
    const operation = pending.ui.prepare();
    pending.ui.invalidate();
    release();
    assert.strictEqual(await operation, false);
    assert.match(pending.panel.innerHTML, /Namespace changed while/);
    assert.strictEqual(await pending.ui.approve(), false);

    const mismatch = harness();
    await mismatch.ui.prepare();
    mismatch.context.response = { approved: true, preparationId: 'wrong', configurationHash: 'hash-1' };
    assert.strictEqual(await mismatch.ui.approve(), false);
    assert.match(mismatch.panel.innerHTML, /does not match/);

    const active = harness();
    active.context.sim.running = true;
    assert.strictEqual(await active.ui.prepare(), false);
    assert.strictEqual(active.calls.length, 0);
    assert.match(active.panel.innerHTML, /Stop Run or Walk/);
    assert.doesNotMatch(source, /save-table|boot-image\/generate|resolve-artifact/);
    console.log('private simulation preparation UI tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });