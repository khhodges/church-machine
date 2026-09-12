'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const appRun = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
const callbackStart = appRun.indexOf(
    "_lumpSaveRequest(fetch, '/api/lumps/save', _svPayload, async function(resp)");
assert(callbackStart >= 0, 'save callback exists');
const callbackSource = appRun.slice(callbackStart, callbackStart + 3500);

assert(callbackSource.includes('LumpRegistry.registerFromServer(['),
    'successful save registers the canonical server artifact');
assert(callbackSource.includes('LumpRegistry.evictMemory(resp.token)'),
    'successful save evicts code-only memory words for the saved token');
assert(!callbackSource.includes(
    'LumpRegistry.registerMemory(resp.token, label, _svWords, _caps)'),
    'successful save never misregisters code words as a complete saved artifact');

const registrySource = fs.readFileSync(
    path.join(__dirname, 'lump-registry.js'), 'utf8');
const storage = {};
const sandbox = {
    localStorage: {
        getItem: key => storage[key] || null,
        setItem: (key, value) => { storage[key] = String(value); },
        removeItem: key => { delete storage[key]; }
    },
    fetch: () => Promise.resolve({ ok: false }),
    Date, Object, Array, Map, Promise
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(registrySource, sandbox);

const registry = sandbox.LumpRegistry;
registry.registerMemory('65582d53', 'CapabilityTest', [0x12345678], []);
registry.registerFromServer([{
    token: '65582d53',
    abstraction: 'CapabilityTest',
    filename: 'CapabilityTest.2.65582d53.lump',
    ns_slot: 14
}]);
registry.evictMemory('65582d53');

const saved = registry.resolve('65582d53');
assert(saved && saved.sources.server,
    'server metadata survives eviction of the pre-save memory source');
assert(!saved.sources.memory,
    'code-only pre-save memory source no longer shadows the saved binary');

console.log('PASS saved LUMP reopens from the authoritative server binary');