'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness(initialProfile, persisted) {
    const controls = {};
    const host = {
        innerHTML: '',
        querySelector: id => controls[id] ||= {},
        querySelectorAll: () => [],
    };
    const requests = [];
    const response = {
        ok: true, persisted, fingerprint: 'initial',
        document: {slotCount: 64, rows: [
            {slot: 1, name: 'Boot.NS', kind: 'namespace', sequence: 0},
            {slot: 2, name: 'Boot.Thread', kind: 'thread', sequence: 0},
            {slot: 9, name: 'Example', kind: 'lump', policy: 'Resident', sequence: 0},
        ]},
        projection: {rows: [], warnings: ['Unresolved binding warning']},
    };
    const scope = {
        document: {
            readyState: 'loading', addEventListener() {},
            getElementById: id => id === 'namespaceTable' ? host : null,
        },
        localStorage: {getItem: () => initialProfile, setItem() {}},
        NamespaceIdeNode: {savePending: async () => true},
        _nsRenderSavedVersionCell: () => '<td>NA</td>',
        fetch: async (url, options) => {
            requests.push({url, method: options.method});
            if (scope.fail) return {ok: false, json: async () => ({error: 'Save refused'})};
            const data = structuredClone(response);
            if (url.includes('phase1')) data.persisted = persisted;
            else if (initialProfile === 'phase1') data.persisted = !persisted;
            if (options.method === 'PUT') {
                data.persisted = true;
                data.document = JSON.parse(options.body).document;
            }
            return {ok: true, json: async () => data};
        },
        updateNamespace: () => {
            const api = scope.NamespaceDesignV1;
            if (api.state.document) api.renderRows('<table><tbody>', host);
            else api.render();
        },
    };
    scope.window = scope;
    vm.runInNewContext(fs.readFileSync(__dirname + '/namespace-design-v1.js', 'utf8'), scope);
    return {scope, api: scope.NamespaceDesignV1, host, controls, requests, response};
}

async function run() {
    for (const profile of ['ascending', 'phase1']) {
        for (const persisted of [true, false, undefined]) {
            const {api, host, scope, controls, requests} = harness(profile, persisted);
            await api.load();
            assert.match(host.innerHTML, new RegExp(profile === 'phase1' ? 'Phase 1' : 'Ascending layout'));
            assert.match(host.innerHTML, persisted === true ? /Saved design/ :
                persisted === false ? /Generated defaults — not saved/ : /Saved status unknown/);
            if (persisted === false) {
                assert.match(host.innerHTML, /No saved design file.*this environment/);
                assert.match(host.innerHTML, /not recovered user work/);
            }
            assert.deepEqual(requests.map(r => r.method), ['GET']);
            // An ordinary edit must supersede the saved label, while retaining origin.
            if (profile === 'phase1') api.capacity(80);
            else api.policy(9, 'Lazy');
            assert.match(host.innerHTML, /Unsaved local draft/);
            assert.match(host.innerHTML, /Local changes have not been saved/);
            assert.match(host.innerHTML, persisted === true ? /Loaded from a saved design/ :
                persisted === false ? /generated defaults, not recovered/ : /not confirmed saved/);
            assert.equal(requests.length, 1, 'editing must not save');
            scope.fail = true;
            await api.save();
            assert.match(host.innerHTML, /Unsaved local draft/);
            assert.match(controls['#nsSaveLayoutNote'].textContent, /Save refused/);
            scope.fail = false;
            await api.save();
            assert.equal(api.state.persisted, true);
            assert.equal(api.state.dirty, false);
            assert.match(host.innerHTML, /Saved design/);
            assert.doesNotMatch(host.innerHTML, /Unsaved local draft|Generated defaults/);
            // The successful save status remains visible even when binding is unavailable.
            assert.match(controls['#nsSaveLayoutNote'].textContent, /binding results are unavailable/);
        }
    }
    const {api, host, requests} = harness('phase1', false);
    await api.load();
    api.capacity(80);
    api.setProfile('ascending');
    await new Promise(resolve => setImmediate(resolve));
    assert.match(host.innerHTML, /Ascending layout · Saved design/);
    api.setProfile('phase1');
    assert.match(host.innerHTML, /Phase 1 · Unsaved local draft/);
    assert.match(host.innerHTML, /generated defaults, not recovered/);
    assert.equal(api.state.document.slotCount, 80);
    api.setProfile('legacy');
    api.setProfile('phase1');
    assert.match(host.innerHTML, /Phase 1 · Unsaved local draft/);
    assert.deepEqual(requests.map(r => r.method), ['GET', 'GET']);
    console.log('PASS Namespace profile, saved/generated evidence, dirty drafts, save results, and profile switching');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
