'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(`${__dirname}/app-absdetail.js`, 'utf8');
const helpers = source.slice(source.indexOf('function _absApiEscape('),
    source.indexOf('function showAbstractionDetail('));
const hash = 'a'.repeat(64);
const identity = { filename: 'LED_v7.lump', token: '12345678',
    binary_hash: hash, abstraction: 'LED' };
const inspection = { binary_hash: hash, api_definition: { methods: [
    { name: 'Set', index: 9, description: 'Saved description', inputs: [],
        outputs: ['DR1: success'], comments: ['<unsafe>'] },
    { name: 'Clear', offset: 20 }
] } };
const context = vm.createContext({ window: {} });
vm.runInContext(helpers, context);
const html = context._absSavedApiHtml(inspection, identity);
assert.match(html, /LED_v7.lump/);
assert.match(html, /Method Index<\/td><td>9/);
assert.match(html, /DR1: success/);
assert.doesNotMatch(html, /DR0|DWRITE|Method Index<\/td><td>20/);
assert.match(html, /Unavailable in saved API/);
assert.match(html, /None declared/);
assert.match(html, /&lt;unsafe&gt;/);
assert.doesNotMatch(html, /<unsafe>/);
assert.match(context._absSavedApiHtml({}, identity), /Saved API unavailable/);
assert.match(context._absSavedApiHtml({ api_definition: { methods: [] } }, identity), /declares no methods/);
assert.match(source, /Catalog row, not a verified selector/);
assert.match(source, /Historical Method Index \(unverified\)/);
const lumpSource = fs.readFileSync(`${__dirname}/app-lumps.js`, 'utf8');
assert.match(lumpSource, /_absSavedApiHtml\(await _absSavedApiFromResponse\(data\), \{/);
assert.match(lumpSource, /sourcePreview \+ methodApiPreview/);
// Exercise the production formatter, not just hand-written outputs fixtures.
const formatterContext = vm.createContext({
    bootEntrySlot: 12,
    _lumpManifests: { 12: { _methods: [{ name: 'Set', pet_names: { DR: { 2: 'value' } } }] } }
});
vm.runInContext(lumpSource.slice(lumpSource.indexOf('function _formatLumpApiDefinition('),
    lumpSource.indexOf('\nfunction ', lumpSource.indexOf('function _formatLumpApiDefinition(') + 1)), formatterContext);
const compiledApi = formatterContext._formatLumpApiDefinition('LED', []);
const checkCompiledDisplay = rendered => {
    assert.match(rendered, /Saved API return convention:.*DR1/);
    assert.match(rendered, /Output \/ return<\/td><td>.*DR1/);
    assert.match(rendered, /Method Index<\/td><td>0/);
    assert.match(rendered, /DR2/);
    assert.doesNotMatch(rendered, /DR0/);
};
checkCompiledDisplay(context._absSavedApiHtml({ api_definition: compiledApi }, identity));
const bothFormats = context._absSavedApiHtml({ api_definition: {
    methods: [{ name: 'Both', outputs: ['DR2: extra'], returns: { register: 'DR1' } }]
} }, identity);
assert.match(bothFormats, /DR2: extra/);
assert.match(bothFormats, /Returns<\/td><td>.*DR1/);

(async () => {
    const archiveWords = [1, 2, 3];
    context.LumpContentFrame = { lumpInspectContentFrame: async words => {
        assert.equal(words, archiveWords);
        return { headerValid: true, contentFrameValid: true, apiDefinition: inspection.api_definition };
    } };
    const decodedArchive = await context._absSavedApiFromResponse({ words: archiveWords, binary_hash: hash });
    assert.equal(decodedArchive.api_definition, inspection.api_definition);
    assert.equal((await context._absSavedApiFromResponse({ words: archiveWords, raw_tail_hex: 'ff' })).api_definition, null);
    context.LumpContentFrame.lumpInspectContentFrame = async () => ({ headerValid: true, contentFrameValid: false });
    assert.equal((await context._absSavedApiFromResponse({ words: archiveWords })).api_definition, null);
    // Explicit absence of embedded API cannot be replaced by other metadata.
    assert.equal((await context._absSavedApiFromResponse({
        api_definition: null, methods: inspection.api_definition.methods
    })).api_definition, null);
    context.LumpContentFrame.lumpInspectContentFrame = async () => ({
        headerValid: true, contentFrameValid: true, apiDefinition: compiledApi
    });
    const compiledArchive = await context._absSavedApiFromResponse({ words: archiveWords, binary_hash: hash });
    checkCompiledDisplay(context._absSavedApiHtml(compiledArchive, identity));
    let url;
    context.fetch = async requested => {
        url = requested;
        return { ok: true, json: async () => ({ filename: identity.filename, inspection }) };
    };
    const target = {};
    await context._absInspectSavedApi(identity, target);
    assert.match(url, /exact_filename=LED_v7.lump&binary_hash=aaaa/);
    assert.match(target.innerHTML, /DR1: success/);
    // An archived explicit revision must bypass current-catalog discovery.
    const archive = {};
    await context._absLoadSavedApi('LED', archive, identity);
    assert.match(archive.innerHTML, /LED_v7.lump/);
    context.fetch = async () => ({ ok: true, json: async () => ({
        filename: 'LED_current.lump', inspection
    }) });
    await context._absInspectSavedApi(identity, {});
    const mismatch = {};
    await context._absInspectSavedApi(identity, mismatch);
    assert.match(mismatch.textContent, /identity does not match/);
    context.fetch = async () => ({ ok: true, json: async () => ({
        filename: identity.filename, binary_hash: 'b'.repeat(64), api_definition: inspection.api_definition
    }) });
    const hashMismatch = {};
    await context._absInspectSavedApi(identity, hashMismatch);
    assert.match(hashMismatch.textContent, /identity does not match/);
    context.fetch = async () => ({ ok: false, status: 404 });
    const missing = {};
    await context._absInspectSavedApi(identity, missing);
    assert.match(missing.textContent, /HTTP 404.*No data changed/);
    // A late old response must not overwrite a newer selected revision.
    let resolveOld;
    context.fetch = () => new Promise(resolve => { resolveOld = resolve; });
    const shared = {};
    const old = context._absInspectSavedApi(identity, shared);
    context.fetch = async () => ({ ok: false, status: 409 });
    await context._absInspectSavedApi(identity, shared);
    resolveOld({ ok: true, json: async () => ({ filename: identity.filename, inspection }) });
    await old;
    assert.match(shared.textContent, /HTTP 409/);
    assert.equal(shared.innerHTML, undefined);
    console.log('PASS saved Abstractions API: exact identity, archive, missing API, registers, indices, escaping and races');
})().catch(error => { console.error(error); process.exitCode = 1; });
