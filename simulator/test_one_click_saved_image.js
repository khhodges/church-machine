'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const {webcrypto} = require('crypto');
const source = fs.readFileSync(__dirname + '/app-simulation-preparation.js', 'utf8');

function setup(failure) {
    let reads = 0, loads = 0;
    const output = {textContent: ''};
    const image = new Uint32Array([123, 456]).buffer;
    const context = {
        window: {_nsTableDirty: true, TargetState: {authorize: () => ({ok: true})}},
        crypto: webcrypto, Uint8Array, console,
        document: {getElementById: id => id === 'editorConsole' ? output : null},
        fetch: async (url, options) => {
            reads++;
            assert.strictEqual(url, '/api/boot-image/binary?simulator=1');
            assert.strictEqual(options.method, undefined, 'read-only request');
            if (failure === 'network') throw new Error('network unavailable');
            return {ok: failure !== 'http', status: 409,
                json: async () => ({error: 'invalid saved image'}),
                arrayBuffer: async () => image,
                headers: {get: () => 'true'}};
        },
        sim: {
            activateSimulationConfiguration(bytes, config) {
                if (failure === 'invalid') throw new Error('invalid body');
                assert.strictEqual(bytes, image);
                assert.strictEqual(config.approved, false);
                assert.strictEqual(config.hardwareCertified, false);
                assert.strictEqual(config.origin, 'saved-image');
                loads++;
                this.simulationConfiguration = config;
                this._bootImageLoaded = true;
            },
        },
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    return {context, output, api: context.window.SimulationPreparation,
        counts: () => ({reads, loads})};
}
(async () => {
    const test = setup();
    await Promise.all([test.api.activateSavedImage(), test.api.activateSavedImage()]);
    assert.deepStrictEqual(test.counts(), {reads: 1, loads: 1});
    assert.strictEqual(test.context.window._nsTableDirty, true);
    assert.match(test.output.textContent, /Warning: saved inputs/);
    await test.api.activateSavedImage();
    assert.deepStrictEqual(test.counts(), {reads: 1, loads: 1}, 'resume never reloads');
    for (const failure of ['network', 'http', 'invalid']) {
        const bad = setup(failure);
        await assert.rejects(bad.api.activateSavedImage());
        assert.strictEqual(bad.counts().loads, 0);
        assert.strictEqual(bad.context.sim.simulationConfiguration, undefined);
        await assert.rejects(bad.api.activateSavedImage());
        assert.strictEqual(bad.counts().reads, 2, 'failure releases single-flight lock');
    }
    console.log('One-click saved image: PASS');
})().catch(error => {console.error(error); process.exitCode = 1;});