'use strict';
// Real assembler, policy and formatter; no network writes or live state.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = 'capabilities { SELF E }\nHALT';
const compiled = new (require('./assembler'))().assemble(source);
assert.equal(compiled.errors.length, 0);
const entry = { abstraction: 'Fixture', sources: { memory: {
    words: compiled.words, capabilities: compiled.capabilities, sourceText: source,
} } };
const alerts = [];
let reviews = 0;
const context = {
    ...require('./actionable_errors'),
    CapabilityTokens: require('./capability_tokens'),
    ChurchSimulator: require('./simulator'),
    LumpContentFrame: require('./lump-content-frame'),
    ...require('./lump-audit'),
    console, TextEncoder, TextDecoder, Uint8Array, DataView,
    crypto: require('node:crypto').webcrypto,
    document: { getElementById: id => id === 'asmEditor' ? { value: source } : null },
    localStorage: { getItem: () => null },
    alert: text => alerts.push(text),
    _formatLumpApiDefinition: () => ({ name: 'Fixture', language: 'assembly', methods: [] }),
    _renderFormatLumpCandidate() {}, _renderFormatLumpVersionHistory() {},
    showSaveToNamespace() { reviews++; },
    LumpRegistry: {
        getCurrent: () => 'fixture',
        resolve: () => entry,
    },
};
context.window = context;
vm.createContext(context);
const js = fs.readFileSync(__dirname + '/app-lumps.js', 'utf8');
const start = js.indexOf('window.showFormatLump = async function()');
vm.runInContext(js.slice(start, js.indexOf('\n};', start) + 3), context);
const response = (status, body) => ({ status, ok: status < 400, text: async () => body });
(async () => {
    const failures = [
        [() => response(404, '<html>Not found</html>'), /HTTP 404/],
        [() => response(200, '<html>Wrong service</html>'), /HTTP 200.*expected JSON/],
        [() => response(200, '{bad'), /HTTP 200.*expected JSON/],
        [() => response(422, JSON.stringify({ error: 'invalid_config', message: 'operator reason' })), /HTTP 422.*invalid_config: operator reason/],
        [() => { throw new Error('connection reset'); }, /connection reset/],
        [() => response(200, 'null'), /operator.*assigned IDE node/],
        [() => response(200, '[]'), /missing or malformed/],
        [() => response(200, '{"node":17}'), /missing or malformed/],
        [() => response(200, '{"node":"test.ide","aliases":[]}'), /missing or malformed/],
    ];
    for (const [fetchResult, expected] of failures) {
        context._pendingLumpData = { binary: [123] };
        context._saveNSPreparedSnapshot = { words: [123] };
        context.fetch = async (url, options) => {
            assert.equal(url, '/api/ide-hierarchy');
            assert.equal(options.cache, 'no-store');
            assert.equal(options.method, undefined);
            return fetchResult();
        };
        const result = await context.showFormatLump();
        assert.equal(result.ok, false);
        assert.match(result.error, expected);
        assert.match(result.error, /hierarchy lookup/);
        assert.match(result.error, /No LUMP was saved/);
        assert.match(result.error, /Next:/);
        assert.equal(context._pendingLumpData, null);
        assert.equal(context._saveNSPreparedSnapshot, null);
        assert.equal(reviews, 0);
    }
    context.fetch = async () => response(200, '{"node":"test.ide"}');
    const valid = await context.showFormatLump();
    assert.equal(valid.ok, true, valid.error);
    assert.equal(reviews, 1);
    assert(context._pendingLumpData.candidates.full.binary.length > 0);
    context._renderFormatLumpCandidate = () => { throw new Error('render failed'); };
    const renderFailure = await context.showFormatLump();
    assert.equal(renderFailure.ok, false);
    assert.match(renderFailure.error, /render failed.*No data was changed.*No LUMP was saved/);
    assert.equal(context._pendingLumpData, null);
    assert.equal(context._saveNSPreparedSnapshot, null);
    console.log('PASS formatter hierarchy failures clear stale candidates; valid compiled candidate reaches review');
})().catch(error => { console.error(error); process.exitCode = 1; });