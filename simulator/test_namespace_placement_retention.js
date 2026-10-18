'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

(async () => {
    const dom = new JSDOM('<select id="namespaceDesignProfile"></select>', {
        url:'http://localhost', runScripts:'outside-only',
    });
    const w = dom.window;
    w.updateNamespace = () => {};
    w.fetch = async () => ({ok:true, json:async () => [
        {abstraction:'CapabilityTest', filename:'newer.lump', binary_hash:'f'.repeat(64),
            token:'ffffffff', lump_version:46},
    ]});
    w.eval(fs.readFileSync('simulator/namespace-design-v1.js', 'utf8'));
    const api = w.NamespaceDesignV1;
    const original = require('../tests/fixtures/phase1_namespace_target.json');
    api.state.profile = 'phase1';
    api.state.document = JSON.parse(JSON.stringify(original));
    const target={kind:'source',path:'simulator/examples/my_unfinished.cloomc'};
    api.state.document.rows.find(r=>r.slot===10).authoring=target;
    api.state.projection = {rows:[], warnings:[]};
    await api.edit(10);
    const picker = w.document.getElementById('nsDraftLump');
    assert.equal(picker.value, 'retained');
    assert.match(picker.selectedOptions[0].textContent, /45.*CapabilityTest\.1\.1feaf30b/);
    // Catalog offers a newer revision; Apply without choosing it keeps all
    // exact selection fields, not the first/default/latest catalog record.
    w.document.getElementById('nsDraftApply').click();
    assert.deepEqual(JSON.parse(JSON.stringify(api.state.document.rows.find(r => r.slot === 10).selection)),
        original.rows.find(r => r.slot === 10).selection);
    assert.deepEqual(JSON.parse(JSON.stringify(api.state.document.rows.find(r => r.slot === 10).authoring)),target);
    api.authoring(10);
    w.document.getElementById('nsAuthoringPath').value='simulator/examples/reviewed.cloomc';
    w.document.getElementById('nsAuthoringApply').click();
    assert.equal(api.state.document.rows.find(r=>r.slot===10).authoring.path,'simulator/examples/reviewed.cloomc');
    assert.deepEqual(JSON.parse(JSON.stringify(api.state.document.rows.find(r=>r.slot===10).selection)),
        original.rows.find(r=>r.slot===10).selection,'authoring changes must not rebind the artifact');
    api.authoring(10);
    w.document.getElementById('nsAuthoringPath').value='../private.cloomc';
    w.document.getElementById('nsAuthoringApply').click();
    assert.match(w.document.getElementById('nsAuthoringError').textContent,/local/);
    w.document.getElementById('nsDraftClose').click();
    const before = JSON.stringify(api.state.document);
    await api.edit(16);
    w.document.getElementById('nsDraftName').value = 'ide.Cancelled';
    w.document.getElementById('nsDraftClose').click();
    assert.equal(JSON.stringify(api.state.document), before);
    await api.edit(16);
    api.setProfile('ascending');
    assert.equal(w.document.getElementById('namespaceDesignDialog'), null);
    api.setProfile('phase1');
    assert.equal(JSON.stringify(api.state.document), before);
    dom.window.close();
    console.log('PASS exact revision retained with newer catalog row; placement cancellation and profile ownership');
})().catch(error => { console.error(error); process.exitCode = 1; });
