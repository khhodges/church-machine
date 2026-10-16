'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('simulator/namespace-design-v1.js', 'utf8');
const key = 'church_namespace_design_profile';
function browser(storage = new Map(), {failure = false, blocked = false, ready = false} = {}) {
    const nodes = {
        namespaceDesignProfile: {value:'ascending'},
        namespaceTable: {innerHTML:''},
        bootCapacityPanel: {hidden:false},
    };
    const requests = [], writes = [];
    let initialize;
    const context = {
        document: {
            readyState: ready ? 'complete' : 'loading',
            getElementById: id => nodes[id] || null,
            addEventListener(event, callback) { initialize = callback; },
        },
        localStorage: {
            getItem(k) { if (blocked) throw Error('blocked'); return storage.get(k) ?? null; },
            setItem(k, v) { if (blocked) throw Error('blocked'); writes.push([k,v]); storage.set(k,v); },
        },
        async fetch(url, options) {
            requests.push({url, options});
            if (failure) throw Error('Network unavailable');
            return {ok:true, async json() {
                return {ok:true, document:{rows:[], slotCount:256}, fingerprint:url, projection:{}};
            }};
        },
        updateNamespace(useDesign) { if (!useDesign) context.NamespaceDesignV1.render(); },
    };
    context.window = context;
    vm.runInNewContext(source, context);
    if (!ready) initialize();
    return {api:context.NamespaceDesignV1, nodes, requests, writes};
}
const settled = () => new Promise(resolve => setImmediate(resolve));
(async () => {
    for (const view of ['phase1', 'ascending', 'legacy']) {
        const storage = new Map();
        const first = browser(storage);
        await settled();
        first.api.setProfile(view);
        await settled();
        assert.deepEqual(first.writes, [[key, view]]);
        const restored = browser(storage, {ready:true});
        await settled();
        assert.equal(restored.nodes.namespaceDesignProfile.value, view);
        assert.equal(restored.api.state.active, view !== 'legacy');
        assert.equal(restored.nodes.bootCapacityPanel.hidden, view !== 'legacy');
        assert.deepEqual(restored.writes, []);
        assert.deepEqual(restored.requests.map(r => r.url), view === 'legacy' ? [] :
            ['/api/namespace/design-v1' + (view === 'phase1' ? '?profile=phase1' : '')]);
        assert.ok([...first.requests, ...restored.requests].every(r => r.options.method === 'GET'));
    }
    for (const invalid of [null, '', 'PHASE1', 'unknown', '{"profile":"phase1"}']) {
        const b = browser(new Map(invalid === null ? [] : [[key, invalid]]));
        await settled();
        assert.equal(b.nodes.namespaceDesignProfile.value, 'ascending');
        assert.equal(b.api.state.profile, 'ascending');
        assert.deepEqual(b.writes, []);
    }
    for (const view of ['phase1', 'ascending']) {
        const storage = new Map([[key,view]]);
        const b = browser(storage, {failure:true});
        await settled();
        assert.equal(b.nodes.namespaceDesignProfile.value, view);
        assert.equal(b.api.state.document, null);
        assert.equal(b.api.state.dirty, false);
        assert.match(b.nodes.namespaceTable.innerHTML, /Network unavailable.*Retry/);
        assert.equal(storage.get(key), view);
        await b.api.load();
        assert.equal(b.requests.length, 2);
        assert.equal(b.requests[0].url, b.requests[1].url);
        b.api.setProfile('legacy');
        assert.equal(storage.get(key), 'legacy');
        assert.equal(b.requests.length, 2);
    }
    const storage = new Map();
    const b = browser(storage);
    await settled();
    b.api.state.document.unsaved = 'ascending draft';
    b.api.state.dirty = true;
    b.api.setProfile('phase1');
    // Busy switches must not persist a rejected selection.
    b.api.setProfile('legacy');
    assert.equal(storage.get(key), 'phase1');
    assert.equal(b.nodes.namespaceDesignProfile.value, 'phase1');
    await settled();
    assert.equal(b.api.state.document.unsaved, undefined);
    b.api.setProfile('ascending');
    assert.equal(b.api.state.document.unsaved, 'ascending draft');
    assert.equal(b.api.state.dirty, true);
    b.api.setProfile('invalid');
    assert.equal(storage.get(key), 'ascending');
    const reload = browser(storage);
    await settled();
    assert.equal(reload.api.state.document.unsaved, undefined);
    assert.equal(reload.api.state.dirty, false);
    const unavailable = browser(new Map(), {blocked:true});
    await settled();
    unavailable.api.setProfile('phase1');
    await settled();
    assert.equal(unavailable.api.state.profile, 'phase1');
    assert.equal(unavailable.nodes.namespaceDesignProfile.value, 'phase1');
    console.log('PASS Namespace view preference, isolation, reload, storage and fetch failures');
})().catch(error => { console.error(error); process.exitCode = 1; });
