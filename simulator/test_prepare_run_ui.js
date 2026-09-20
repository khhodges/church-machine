'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const memory = fs.readFileSync(__dirname + '/app-memory.js', 'utf8');
const abstractions = fs.readFileSync(__dirname + '/app-abstractions.js', 'utf8');
assert.match(memory, /Promise\.resolve\(_openBootExecutionUpdate\(\)\)[\s\S]*\.finally\(function\(\)/);
assert.match(memory, /actionButton\.disabled = false;[\s\S]*Prepare latest & Run/);
assert.match(abstractions,
    /pendingArtifactPins = Object\.assign\([\s\S]*artifactPins: pendingArtifactPins/);
assert.match(abstractions,
    /JSON\.stringify\(live\[slot\]\)[\s\S]*JSON\.stringify\(pendingArtifactPins\[slot\]\)/);

function extract(name, endMarker) {
    const start = memory.indexOf('function ' + name);
    const end = memory.indexOf(endMarker, start);
    if (start < 0 || end < 0) throw new Error('missing ' + name);
    return memory.slice(start, end);
}

// Namespace per-row pin intent is an exact immutable descriptor and remains
// pending until Prepare/Run submits it.
const pinContext = {
    window: {
        _prepareRunArtifactPins: {},
        _nsState: { abstractions: [{
            slot: 7, filename: 'WukongCallHome.1.658e6ba8.lump',
            token: '4a000007', lump_version: 11,
        }] },
    },
};
vm.createContext(pinContext);
vm.runInContext(extract('_nsPreparePinChange',
    'window._nsPreparePinChange = _nsPreparePinChange;'), pinContext);
assert.strictEqual(pinContext._nsPreparePinChange(7, true), true);
assert.deepStrictEqual(
    JSON.parse(JSON.stringify(pinContext.window._prepareRunArtifactPins['7'])),
    {
        filename: 'WukongCallHome.1.658e6ba8.lump',
        token: '4a000007',
        revision: 11,
    });
assert.strictEqual(pinContext._nsPreparePinChange(7, false), true);
assert.strictEqual(pinContext.window._prepareRunArtifactPins['7'], null);

// The banner action awaits Prepare/Run and surfaces its actual rejection.
const status = { textContent: '' };
const button = { disabled: false, textContent: '' };
const actionStart = memory.lastIndexOf('async function _openBootExecutionUpdate');
const actionEnd = memory.indexOf(
    'window._openBootExecutionUpdate = _openBootExecutionUpdate;', actionStart);
const actionContext = {
    window: {
        _bootExecutionRepairTarget: { failedSave: false, token: 'latest' },
        prepareAndRunSavedArtifact: async () => {
            throw new Error('Namespace changed in another tab (409)');
        },
    },
    document: {
        getElementById(id) {
            return id === 'bootExecutionUpdateStatus' ? status :
                (id === 'bootExecutionUpdateButton' ? button : null);
        },
    },
    Error,
};
vm.createContext(actionContext);
vm.runInContext(memory.slice(actionStart, actionEnd), actionContext);

(async () => {
    await assert.rejects(
        () => actionContext._openBootExecutionUpdate(),
        /Namespace changed in another tab \(409\)/);
    assert.notStrictEqual(status.textContent, 'Prepare/Run started.');
    console.log('prepare/run UI function tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});