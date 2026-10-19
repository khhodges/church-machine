'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const tick = () => new Promise(resolve => setImmediate(resolve));
(async () => {
    const dom = new JSDOM('<div id="panel"></div>', {url:'https://ide.example/', runScripts:'outside-only'});
    const w = dom.window, panel = w.document.getElementById('panel');
    const identity = {token:'4a000007', filename:'Example.lump', binary_hash:'a'.repeat(64),
        lump_version:16, compiled_at:'2026-10-19T12:00:00Z'};
    w._savedLumpEditorMode = true;
    w._editorOpenLumpToken = identity.token;
    w._editorSavedBinaryReceipt = {...identity, lump_version:undefined};
    let response = {identity}, pending = null, requests = 0;
    w.fetch = async (url, options) => {
        requests++;
        assert(url.startsWith('/api/saved-artifact-metadata?'));
        assert(!options.method || options.method === 'GET');
        if(pending) return new Promise(resolve=>{pending.resolve=resolve;});
        return {ok:true,json:async()=>response};
    };
    w.eval(fs.readFileSync('simulator/build-handoff.js','utf8'));
    const render = () => {
        panel.innerHTML='';
        w.renderSavedArtifactMetadata(panel,identity,identity.token,true);
    };
    render(); await tick();
    assert.equal(panel.querySelector('input'),null);
    assert(!/released|handoff|checkbox/i.test(panel.textContent));
    assert(panel.textContent.includes(identity.compiled_at));
    assert(panel.textContent.includes('View this saved revision'));
    assert.equal(w._editorSavedBinaryReceipt.lump_version,16);
    response={identity:{...identity,binary_hash:'b'.repeat(64)}};
    render(); await tick();
    assert(panel.textContent.includes('does not match'));
    assert(!panel.textContent.includes(identity.compiled_at));
    pending={}; render(); panel.innerHTML='Another selection';
    pending.resolve({ok:true,json:async()=>({identity})});
    await tick(); assert.equal(panel.textContent,'Another selection');
    pending=null;
    const count=requests;
    w._compiledCandidateEditorMode=true;
    render(); await tick(); assert.equal(requests,count);
    dom.window.close();
    console.log('PASS read-only saved metadata; no release control/state/write; exact identity and navigation ownership retained');
})().catch(error=>{console.error(error);process.exitCode=1;});
