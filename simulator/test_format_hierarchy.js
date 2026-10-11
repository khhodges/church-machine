'use strict';
// Real assembler, policy and formatter; no network writes or live state.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = '; @abstraction ide.Mint\ncapabilities { SELF E }\nHALT\n; ' +
    Array.from({ length: 300 }, (_, i) =>
        require('node:crypto').createHash('sha256').update(String(i)).digest('hex')).join(' ');
const compiled = new (require('./assembler'))().assemble(source);
assert.equal(compiled.errors.length, 0);
const entry = { abstraction: 'ide.Mint', sources: { memory: {
    words: compiled.words, capabilities: compiled.capabilities, sourceText: source,
    registeredAt: 123,
} } };
const editor = { value: source };
const elements = {
    asmEditor: editor, fmtOutputProfiles: {}, fmtHeaderChips: {},
    saveNSDialog: { style: {} },
};
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
    document: { getElementById: id => elements[id] || null },
    localStorage: { getItem: () => null, setItem() {} },
    alert: text => alerts.push(text),
    _formatLumpApiDefinition: () => ({ name: 'ide.Mint', language: 'assembly', methods: [] }),
    _renderFormatLumpVersionHistory() {},
    showSaveToNamespace() {
        reviews++;
        context._saveNSPreparedSnapshot = context._captureLumpSaveSnapshot();
    },
    _setSaveNSFeedback() {},
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
function extract(text, name) {
    const start = text.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
    assert(start >= 0, name);
    const rest = text.slice(start);
    const next = rest.slice(rest.indexOf('\n') + 1).search(/^(?:async )?function \w+\(/m);
    return next < 0 ? rest : rest.slice(0, rest.indexOf('\n') + 1 + next);
}
const run = fs.readFileSync(__dirname + '/app-run.js', 'utf8');
vm.runInContext(`var _formatLumpTrap = null, _formatLumpTrigger = null,
    _saveNSTrap = null, _saveNSTrigger = null, _saveNSPickerRequestId = 0,
    _saveNSNamespaceFingerprint = null, _saveNSPickerReady = false;`, context);
for (const name of ['_cloneLumpSaveCapabilities', '_captureLumpSaveSnapshot', 'closeSaveDialog'])
    vm.runInContext(extract(run, name), context);
for (const name of ['_fmtLumpByteSize', '_renderFormatLumpCandidate',
    '_selectFormatLumpProfile', '_closeFormatLumpDialog'])
    vm.runInContext(extract(js, name), context);
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
    const pending = context._pendingLumpData;
    const binaries = Object.values(pending.candidates).map(c => c.binary);
    assert.equal(new Set(binaries).size, 3, 'profiles must not share buffers');
    assert(pending.candidates.full.lumpSize > pending.candidates.compact.lumpSize,
        'complete source frame must grow allocation independently');
    const originalWords = Array.from(compiled.words);
    for (const profile of ['api', 'compact', 'full', 'api']) {
        const candidate = pending.candidates[profile];
        const binary = candidate.binary;
        const inspected = await context.LumpContentFrame.lumpInspectContentFrame(binary);
        assert.equal(inspected.contentFrameValid, true, inspected.error);
        assert.equal(inspected.profile, profile);
        assert.equal(inspected.source, profile === 'api' ? null : profile === 'compact'
            ? context.LumpContentFrame.lumpFrameStripComments(source, 'assembly') : source);
        assert.equal(binary.length, candidate.lumpSize);
        assert.equal(inspected.header.lumpSize, binary.length);
        assert.deepEqual(Array.from(binary.slice(1, 1 + originalWords.length)), originalWords);
        assert.equal(binary[binary.length - 1], context.ChurchSimulator.SELF_CAPABILITY_PLACEHOLDER);
        assert(1 + candidate.cw + candidate.frame.frameWords.length <= binary.length - candidate.cc);
        assert.equal(candidate.hasErrors, false, JSON.stringify(candidate.auditResults));
        context._selectFormatLumpProfile(profile);
        assert.equal(pending.binary, binary);
        assert.match(elements.fmtHeaderChips.innerHTML, new RegExp(binary.length + ' words'));
        assert(elements.fmtOutputProfiles.innerHTML.includes('aria-checked="true"'));
        const snapshot = context._saveNSPreparedSnapshot;
        assert.equal(snapshot.pending.selectedProfile, profile);
        assert.deepEqual(Array.from(snapshot.pending.binary), Array.from(binary));
        assert.notEqual(snapshot.pending.binary, binary, 'save snapshot owns a byte-exact copy');
        assert.equal(snapshot.sourceText, source);
    }
    context._closeFormatLumpDialog();
    assert.equal(context._pendingLumpData, null);
    assert.equal(context._saveNSPreparedSnapshot, null);
    assert.equal(editor.value, source);
    assert.deepEqual(Array.from(compiled.words), originalWords);
    // Missing source exposes API only, rather than manufacturing source.
    editor.value = '';
    entry.sources.memory.sourceText = '';
    assert.equal((await context.showFormatLump()).ok, true);
    assert.deepEqual(Object.keys(context._pendingLumpData.candidates), ['api']);
    context._selectFormatLumpProfile('full');
    assert.equal(context._pendingLumpData.selectedProfile, 'api');
    context._closeFormatLumpDialog();
    editor.value = source;
    entry.sources.memory.sourceText = source;
    // A preparation exception or mid-encode edit retires all pending state.
    const frameBuilder = context.LumpContentFrame;
    context.LumpContentFrame = { ...frameBuilder, lumpBuildContentFrame: async (...args) => {
        editor.value = source + '\n; new edit';
        return frameBuilder.lumpBuildContentFrame(...args);
    } };
    assert.equal((await context.showFormatLump()).ok, false);
    assert.equal(context._pendingLumpData, null);
    assert.equal(context._saveNSPreparedSnapshot, null);
    assert.equal(editor.value, source + '\n; new edit');
    context.LumpContentFrame = frameBuilder;
    editor.value = source;
    context._renderFormatLumpCandidate = () => { throw new Error('render failed'); };
    const renderFailure = await context.showFormatLump();
    assert.equal(renderFailure.ok, false);
    assert.match(renderFailure.error, /render failed.*No data was changed.*No LUMP was saved/);
    assert.equal(context._pendingLumpData, null);
    assert.equal(context._saveNSPreparedSnapshot, null);
    assert.equal(editor.value, source);
    console.log('PASS real format: hierarchy, independent profiles, growth, switching, exact snapshots, no source, cancellation and failures');
})().catch(error => { console.error(error); process.exitCode = 1; });