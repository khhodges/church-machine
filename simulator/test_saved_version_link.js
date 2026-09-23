'use strict';
const assert = require('assert');
const fs = require('fs');
const {JSDOM} = require('jsdom');
const tick = () => new Promise(resolve => setImmediate(resolve));

(async () => {
    const dom = new JSDOM('<textarea id="asmEditor">unsaved work</textarea><div id="panel"></div>',
        {url: 'https://ide.example/simulator/', runScripts: 'outside-only'});
    const w = dom.window;
    const identity = {token: '4a000006', filename: 'SelfTest.exact.lump',
        binary_hash: 'a'.repeat(64), lump_version: 98, abstraction: 'SelfTest', eligible: true};
    const requests = [];
    let mismatch = false;
    w._savedLumpEditorMode = true;
    w._escHtml = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
    w._lumpBinaryInspection = () => ({});
    w._lumpBootstrapRepairControls = () => '';
    w.fetch = async (url, options = {}) => {
        assert(!options.method || options.method === 'GET', 'navigation cannot write');
        requests.push(url);
        return {ok: true, json: async () => url.startsWith('/api/build-handoff')
            ? {identity, csrf: 'proof', handoff: {released: false, revision: 0}}
            : {filename: mismatch ? 'newer.lump' : identity.filename,
                binary_hash: identity.binary_hash, words: [0xf8000000, 0]}};
    };
    const source = fs.readFileSync('simulator/app-lumps.js', 'utf8');
    w.eval(source.slice(source.indexOf('function _closeLumpHistoryPreviewModal()'),
        source.indexOf('function _lumpBootstrapRepairControls(')));
    w.eval(source.slice(source.indexOf('window._openSavedLumpVersionDetails ='),
        source.indexOf('async function _restoreLumpFromHistory(')));
    w.eval(fs.readFileSync('simulator/build-handoff.js', 'utf8'));
    const panel = w.document.getElementById('panel');
    w.renderBuildHandoff(panel, identity, identity.token, true);
    await tick(); await tick();
    const link = panel.querySelector('a');
    assert(link && link.href && link.textContent === 'v98', 'native keyboard-accessible link');
    link.click();
    await tick(); await tick();
    const url = new URL(requests[1], w.location);
    assert.equal(url.searchParams.get('exact_filename'), identity.filename);
    assert.equal(url.searchParams.get('binary_hash'), identity.binary_hash);
    assert.equal(requests.length, 2, 'no latest/current fetch or write');
    assert(w.document.getElementById('lumpHistoryPreviewModal').textContent.includes(identity.filename));
    assert(w.document.getElementById('lumpHistoryPreviewModal').textContent.includes('exact saved revision'));
    assert.equal(w.document.getElementById('asmEditor').value, 'unsaved work');
    mismatch = true;
    link.click(); await tick(); await tick();
    assert(w.document.getElementById('lumpHistoryPreviewModal').textContent.includes('does not match'));
    panel.innerHTML = '';
    w.renderBuildHandoff(panel, {}, identity.token, false);
    assert.equal(panel.querySelector('a'), null, 'missing identity cannot navigate');
    assert.equal(w.document.getElementById('asmEditor').value, 'unsaved work');
    dom.window.close();
    console.log('PASS version link exact read-only details, shared-token isolation, missing/mismatched identity, preserved editor');
})().catch(error => { console.error(error); process.exitCode = 1; });