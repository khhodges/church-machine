'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');

function extractFunction(name) {
    let start = source.indexOf('function ' + name + '(');
    if (start < 0) start = source.indexOf('async function ' + name + '(');
    assert.notEqual(start, -1, 'missing production function ' + name);
    if (source.slice(start - 6, start) === 'async ') start -= 6;
    const brace = source.indexOf('{', start);
    let depth = 0;
    for (let i = brace; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error('unbalanced production function ' + name);
}

const selectorSource = [
    extractFunction('_isExactSavedLumpWordArray'),
    extractFunction('_lumpDispatchAnnotation'),
    extractFunction('_formatLumpHeaderDisassembly'),
    extractFunction('_reconstructSavedLumpInstructionSource'),
    extractFunction('_selectSavedLumpCodeDisplay'),
].join('\n');
const context = vm.createContext({
    assembler: { disassemble: word => 'OP_' + (word >>> 0).toString(16) },
});
vm.runInContext(selectorSource, context);

const words = [
    ((0x1f << 27) | (1 << 10)) >>> 0,
    0x18000000,
];

const embedded = context._selectSavedLumpCodeDisplay(
    { source: 'exact embedded', unverified_source: 'legacy' },
    null, words, { abstraction: 'V0', token: '00000000' });
assert.equal(embedded.kind, 'embedded');
assert.equal(embedded.text, 'exact embedded');

const legacyV0 = context._selectSavedLumpCodeDisplay({
    source: '',
    unverified_source: 'v0 exact-file sidecar source',
    unverified_source_provenance: 'legacy sidecar for exact filename',
}, null, words, { abstraction: 'V0', token: '00000000' });
assert.equal(legacyV0.kind, 'unverified-source');
assert.equal(legacyV0.readOnly, true);
assert.match(legacyV0.warning, /not embedded artifact source/);
assert.match(legacyV0.warning, /not proven to match this binary/);

const reconstructed = context._selectSavedLumpCodeDisplay(
    { source: '' }, null, words, { abstraction: 'V0', token: '00000000' });
assert.equal(reconstructed.kind, 'reconstructed-source');
assert.equal(reconstructed.readOnly, false);
assert.match(reconstructed.text, /OP_18000000/);
assert(!reconstructed.text.includes('HEADER'));
assert(!reconstructed.text.includes('word'));
assert(!reconstructed.text.includes('No source'));
assert.match(reconstructed.warning, /not the original source/);
assert.match(reconstructed.warning, /not guaranteed/);

const dispatchWords = [
    ((0x1f << 27) | (3 << 10)) >>> 0,
    ((23 << 27) | 1) >>> 0,
    0x18000000,
    0x08000001,
];
const reconstructedDispatch = context._selectSavedLumpCodeDisplay(
    {}, null, dispatchWords, { methodCount: 1 });
assert.equal(reconstructedDispatch.kind, 'reconstructed-source');
assert(!reconstructedDispatch.text.includes('OP_b8000001'),
    'method dispatch metadata must not enter editable source');
assert(reconstructedDispatch.text.includes('OP_18000000'));
assert(reconstructedDispatch.text.includes('OP_8000001'));

const unavailable = context._selectSavedLumpCodeDisplay(
    {}, null, [], { abstraction: 'V0' });
assert.equal(unavailable.kind, 'unavailable');
assert.equal(unavailable.text, '');
assert.match(unavailable.warning, /could not be fetched/);

const history = extractFunction('_lumpHistoryPreview');
assert(history.includes('_selectSavedLumpCodeDisplay('));
assert(history.includes("selectedCode.kind === 'unverified-source'"));
assert(history.includes("selectedCode.kind === 'reconstructed-source'"));
assert(history.includes('editablePreviewSource'));
assert(!history.includes('!integrityRejected'),
    'binary integrity must not gate historical source drafts');
assert(history.includes('_openLumpHistorySourceInEditor(\n                        editablePreviewSource'));

const sourceTab = extractFunction('_populateLumpSourceTab');
assert(sourceTab.includes('_selectSavedLumpCodeDisplay('));
assert(sourceTab.includes('exact_filename=${encodeURIComponent(expectedFilename)}'));
assert(sourceTab.includes('data.filename !== expectedFilename'));
assert(sourceTab.includes('aria-readonly="true"'));

const openEditor = extractFunction('openLumpInEditor');
assert(openEditor.includes("asmEd.readOnly = !_editableSourceAvailable"));
assert(openEditor.includes("_sourceResolution.origin === 'unverified-fallback'"));
assert(openEditor.includes("_sourceResolution.origin === 'reconstructed-source'"));
assert(openEditor.includes("_binaryTrustFailure && typeof _sourceResolution.source === 'string'"));
assert(openEditor.includes('_enterSavedLumpEditorMode(\n            _compiledDisasm'),
    'right pane must retain exact compiled disassembly independently');
assert(openEditor.includes('_recoveredSource = _draftSourceRecord.source;'),
    'integrity rejection preserves exact recoverable source for editing');
assert(!openEditor.includes('_primaryCandidates'),
    'historical selection must not redirect to a newer artifact');

console.log('PASS shared saved-LUMP code display: embedded, editable v0 fallback, source-only reconstruction, unavailable, history, Source tab');

// Execute the historical source-selection and draft handoff, without a server,
// compiler, artifact writes, or simulator execution.
(async function() {
    const selection = history.slice(
        history.indexOf('const selectedCode ='),
        history.indexOf("let sourcePreview ="));
    for (const field of ['source', 'unverified_source']) {
        const exactSource = '  historical source\r\n\tRETURN\r\n';
        const historyContext = vm.createContext({
            data: { [field]: exactSource, binary_valid: false, approved: false, trusted: false },
            inspection: null, words: [], exactIdentity: null, token: '00112233', rawTailHex: '',
            _selectSavedLumpCodeDisplay: context._selectSavedLumpCodeDisplay,
        });
        vm.runInContext(selection + '\nthis.editable = editablePreviewSource;', historyContext);
        assert.equal(historyContext.editable, exactSource,
            'historical source-only response stays actionable despite rejected binary');

        const editor = { value: 'unsaved previous draft\r\n' };
        let opened;
        const draftContext = vm.createContext({
            document: { getElementById: id => id === 'asmEditor' ? editor : { value: 'assembly' } },
            activeUserTabId: null, userTabs: [], window: {},
            createUserTab: async (name, lang, code, revision) => {
                opened = { name, lang, code, revision };
                editor.value = code;
                return opened;
            },
            generateTabId: () => 'previous',
            saveUserTabsToStorage() {}, renderUserTabs() {},
            _closeLumpHistoryPreviewModal() {}, switchView() {},
        });
        vm.runInContext(extractFunction('_openLumpHistorySourceInEditor'), draftContext);
        await draftContext._openLumpHistorySourceInEditor(historyContext.editable, 'Archived', 7);
        assert.equal(opened.code, exactSource);
        assert.equal(opened.revision, 7);
        assert.equal(draftContext.userTabs[0].code, 'unsaved previous draft\r\n');
    }
    console.log('PASS historical rejected/source-only drafts preserve exact source and previous edits');
})().catch(error => { console.error(error); process.exitCode = 1; });