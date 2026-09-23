'use strict';
const assert = require('assert');
const fs = require('fs');
const {JSDOM} = require('jsdom');
const script = fs.readFileSync('simulator/build-handoff.js', 'utf8');
const wrapper = fs.readFileSync('simulator/change-confirmation.js', 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

(async () => {
    const dom = new JSDOM('<div id="panel"></div>', {url: 'https://ide.example/simulator/', runScripts: 'outside-only'});
    const w = dom.window;
    w.Request = Request; w.Response = Response; w.Headers = Headers;
    w._savedLumpEditorMode = true;
    const panel = w.document.getElementById('panel');
    const identity = {token: '4a000007', filename: 'Example.1.saved.lump', binary_hash: 'a'.repeat(64),
        lump_version: 16, compiled_at: '2026-09-22T12:00:00+00:00', eligible: true};
    let released = false, revision = 0, fail = false, pending = null;
    let requests = [];
    w.fetch = async (url, options) => {
        const request = url instanceof Request ? url : new Request(new URL(url, w.location), options);
        requests.push(request);
        assert.equal(new URL(request.url).pathname, '/api/build-handoff');
        if (pending) return new Promise(resolve => { pending.resolve = resolve; });
        if (fail) return new Response(JSON.stringify({error: 'Storage offline'}), {status: 503});
        if (request.method === 'POST') {
            const data = await request.json();
            assert.equal(data.lump_version, 16);
            assert.equal(data.binary_hash, identity.binary_hash);
            assert.equal(request.headers.get('If-Match'), String(revision));
            assert.equal(request.headers.get('X-Build-Handoff-CSRF'), 'session-proof');
            released = data.released; revision++;
        }
        return new Response(JSON.stringify({identity, csrf: 'session-proof', committed: true,
            handoff: {released, revision, updated_at: revision ? '2026-09-22T13:00:00Z' : null}}));
    };
    w.eval(wrapper);
    w.confirmProtectedChange = () => { throw Error('No second security dialog allowed'); };
    w.eval(script);
    const render = () => {
        panel.innerHTML = '';
        w.renderBuildHandoff(panel, identity, identity.token, true);
    };
    const box = () => panel.querySelector('input');
    render(); await tick(); await tick();
    assert(panel.textContent.includes('v16'));
    assert(panel.textContent.includes(identity.compiled_at));
    assert.equal(box().checked, false);
    assert.equal(box().disabled, false);
    box().checked = true; box().dispatchEvent(new w.Event('change'));
    assert.equal(box().checked, false, 'not optimistic');
    await tick(); await tick();
    assert.equal(box().checked, true);
    render(); await tick(); await tick();
    assert.equal(box().checked, true, 'reload reflects persisted receipt');
    box().checked = false; box().dispatchEvent(new w.Event('change'));
    await tick(); await tick();
    assert.equal(box().checked, false);
    assert.equal(requests.filter(r => r.method === 'POST').length, 2);
    fail = true;
    box().checked = true; box().dispatchEvent(new w.Event('change'));
    await tick(); await tick();
    assert.equal(box().checked, false);
    assert.equal(box().indeterminate, true);
    assert.equal(box().disabled, true);
    assert(panel.textContent.includes('Storage offline'));
    fail = false;
    pending = {};
    render();
    panel.innerHTML = 'different document';
    pending.resolve(new Response(JSON.stringify({identity, csrf: 'secret',
        handoff: {released: true, revision: 8}})));
    await tick(); await tick();
    assert.equal(panel.textContent, 'different document', 'navigation race must not affect new document');
    pending = null;
    const count = requests.length;
    w._compiledCandidateEditorMode = true;
    render(); await tick();
    assert.equal(box().disabled, true);
    assert.equal(requests.length, count, 'unsaved candidate never fetches or inherits handoff');
    w._compiledCandidateEditorMode = false;
    panel.innerHTML = '';
    w.renderBuildHandoff(panel, identity, identity.token, false);
    assert.equal(box().disabled, true, 'unverified identity disabled');
    dom.window.close();
    console.log('PASS exact handoff date/version, release/revoke/reload, no prompts, errors, navigation race, candidate isolation');
})().catch(error => { console.error(error); process.exitCode = 1; });