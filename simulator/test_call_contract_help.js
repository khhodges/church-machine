'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const api = require('./lump-public-api');
const identity = { abstraction: 'Mint', token: 'abc', filename: 'mint-history.lump', binary_hash: 'a'.repeat(64) };
const contract = {
    purpose: '<b>Historical purpose</b>',
    inputs: { count: { meaning: 'Allocation count', unit: 'words', allowed: '1–64', encoding: 'direct integer' } },
    result: 'DR1 result', effects: 'Allocates', failures: 'Faults', authorization: 'Requires authority', example: 'count=4'
};
const definition = { methods: [{ name: 'Create', selector: 1 }], contracts: { Create: contract } };
const response = (value, ok = true) => ({ ok, status: ok ? 200 : 404, json: async () => value });
const exact = { filename: identity.filename, inspection: { binary_hash: identity.binary_hash, api_definition: definition } };
const tick = () => new Promise(resolve => setImmediate(resolve));

(async () => {
    for (const source of ['CALL Mint.Create', 'CALL CR1, Mint.Create']) {
        assert.deepEqual(api.callContext(source, source.length), { abstraction: 'Mint', method: 'Create' });
    }
    assert.deepEqual(api.callContext('CALL CR6[Allocator], Create', 10), { abstraction: null, method: 'Create' });
    const Compiler = require('./cloomc_compiler');
    const builder = require('./lump_builder');
    const frame = require('./lump-content-frame');
    const author = require('../scripts/create_mint_contract_draft');
    const compilation = new Compiler().compile(author.source(), []);
    assert.deepEqual(compilation.errors, []);
    const image = builder.buildLump(compilation);
    const canonical = builder.buildApiDefinition(compilation, image.words);
    const words = builder.embedSelfDefinition(image.words, canonical, author.source(), 0);
    const decoded = await frame.lumpInspectContentFrame(words);
    assert.equal(decoded.contentFrameValid, true, decoded.error);
    const firstMethod = decoded.apiDefinition.methods.find(m => m.index === 0);
    assert.ok(firstMethod, 'real decoded API declares index 0');
    for (const source of ['CALL CR1, #0', 'CALL CR6[ide.SelfTest], #0', 'CALL CR1, 0']) {
        const context = api.callContext(source, source.length);
        assert.deepEqual(context, { abstraction: null, method: '0' });
        const rendered = api.renderCallContract(decoded.apiDefinition, context.method, identity);
        assert.ok(rendered.includes(decoded.apiDefinition.contracts[firstMethod.name].purpose));
    }
    assert.equal(api.callContext('; CALL Mint.Create', 10), null);
    assert.equal(api.callContext('CALL Mint.Create ; comment', 24), null);
    let url;
    assert.equal(await api.inspectExact(identity, async u => { url = u; return response(exact); }), definition);
    assert.match(url, /exact_filename=mint-history.lump&binary_hash=aaaa/);
    await assert.rejects(api.inspectExact(identity, async () => response({ ...exact, filename: 'new.lump' })), /does not match/);
    await assert.rejects(api.inspectExact(identity, async () => response({}, false)), /HTTP 404/);
    const html = api.renderCallContract(definition, 'Create', identity);
    for (const text of ['Historical purpose', 'Allocation count', 'words', '1–64', 'direct integer', 'DR1 result', 'Allocates', 'Faults', 'Requires authority', 'count=4', identity.filename, identity.binary_hash])
        assert.ok(html.includes(text), text);
    assert.ok(html.includes('&lt;b&gt;') && !html.includes('<b>Historical'));
    assert.match(api.renderCallContract({ methods: definition.methods }, 'Create', identity), /No functional contract was embedded/);
    assert.match(api.renderCallContract(definition, 'Missing', identity), /Method unavailable/);
    assert.match(api.renderCallContract(definition, '1', identity), /Historical purpose/);
    assert.match(api.renderCallContract(null, 'Create', identity), /Saved API unavailable/);

    // Exercise actual popup events without executing or rewriting editor source.
    const dom = new JSDOM('<textarea id="asmEditor"></textarea>', { runScripts: 'outside-only' });
    const w = dom.window;
    w.LumpPublicApi = api;
    w._editorSavedBinaryReceipt = identity;
    // Make the idle delay synchronous; network awaits remain asynchronous.
    w.setTimeout = fn => { fn(); return 1; };
    let resolveFetch;
    w.fetch = () => new Promise(resolve => { resolveFetch = resolve; });
    w.eval(fs.readFileSync('simulator/app-api-popup.js', 'utf8'));
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    const ta = w.document.getElementById('asmEditor');
    const open = () => {
        ta.value = 'CALL Mint.Create';
        ta.selectionStart = ta.value.length;
        ta.dispatchEvent(new w.KeyboardEvent('keyup', { key: 'e' }));
    };
    open();
    ta.value = 'CALL Mint.Other';
    ta.dispatchEvent(new w.Event('input'));
    resolveFetch(response(exact));
    await tick();
    assert.equal(w.document.getElementById('apiPopup').style.display, 'none', 'stale reply cannot reopen help');
    open();
    resolveFetch(response(exact));
    await tick();
    assert.match(w.document.getElementById('apiPopup').textContent, /Historical purpose/);
    assert.equal(ta.value, 'CALL Mint.Create');
    assert.equal(ta.selectionStart, ta.value.length);
    ta.dispatchEvent(new w.Event('input'));
    w._editorSavedBinaryReceipt = null;
    w.fetch = async url => response(url === '/api/lumps/list' ? [identity, { ...identity, filename: 'new.lump' }] : exact);
    open();
    await tick();
    const select = w.document.querySelector('#apiPopup select');
    assert.ok(select, 'named calls without a matching receipt require an explicit revision choice');
    assert.equal(select.value, '');
    assert.doesNotMatch(w.document.getElementById('apiPopup').textContent, /Historical purpose/);
    select.value = '0';
    select.dispatchEvent(new w.Event('change'));
    await tick();
    assert.match(w.document.getElementById('apiPopup').textContent, /Historical purpose/);
    assert.equal(ta.value, 'CALL Mint.Create');
    dom.window.close();
    console.log('CALL contract help: exact identity, fields, missing data, escaping, stale responses and draft preservation passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
