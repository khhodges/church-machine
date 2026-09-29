'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

function extractFunction(source, name) {
    let start = source.indexOf('async function ' + name + '(');
    if (start < 0) start = source.indexOf('function ' + name + '(');
    assert.notEqual(start, -1, 'missing production function ' + name);
    const brace = source.indexOf('{', start);
    let depth = 0;
    for (let i = brace; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error('unbalanced production function ' + name);
}

const source = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');
const memorySource = fs.readFileSync(path.join(__dirname, 'app-memory.js'), 'utf8');
const dom = new JSDOM(`<!doctype html><body><div id="editor">
  <div class="editor-layout">
    <span id="editorCodeName"></span>
    <textarea id="asmEditor">method Run() { return(1) }</textarea>
    <section id="savedLumpDisassemblyPanel" style="display:none">
      <span id="disassemblyPresentationStatus"></span>
      <pre id="savedLumpDisassembly"></pre>
      <details id="savedLumpBuildDetails" open></details>
    </section>
  </div>
</div></body>`);

const header = ((0x1f << 27) | (2 << 10) | 1) >>> 0;
const canonicalWords = [header, 0x18000000, 0x08000001, 0, 0x07800100];
let fetchResult = {
    ok: true,
    json: async () => ({
        filename: 'Ada.Run.4.server-token.lump',
        words: canonicalWords,
        raw_tail_hex: '',
        byte_count: canonicalWords.length * 4,
    }),
};
let fetchedUrl = '';
const context = vm.createContext({
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    LumpContentFrame: require('./lump-content-frame.js'),
    window: dom.window,
    document: dom.window.document,
    console,
    fetch: async url => {
        fetchedUrl = url;
        return fetchResult;
    },
    assembler: { disassemble: word => 'WORD_' + (word >>> 0).toString(16) },
    _renderSavedLumpIdentityPanel() {},
    _syncSavedLumpIdentityVisibility() {},
    _updateEditorCodeName(name) {
        dom.window._editorCodeNameValue = name;
        dom.window.document.getElementById('editorCodeName').textContent = name;
    },
});
dom.window._editorNavigationEpoch = 7;
vm.runInContext([
    extractFunction(source, '_setDisassemblyPresentationStatus'),
    extractFunction(source, '_lumpDispatchAnnotation'),
    extractFunction(source, '_formatLumpHeaderDisassembly'),
    extractFunction(source, '_isExactSavedLumpWordArray'),
    extractFunction(source, '_readSavedLumpExactTail'),
    extractFunction(source, '_savedLumpPresentationStillOwnsSource'),
    extractFunction(source, '_getLumpFieldSizeLayout'),
    extractFunction(source, '_getSavedLumpWordUsageSummary'),
    extractFunction(source, '_formatCanonicalSavedLumpWords'),
    extractFunction(source, '_showCanonicalSavedLumpBesideSource'),
    extractFunction(source, '_fetchAndPresentCommittedLump'),
    extractFunction(source, '_restoreSavedLumpBinaryPresentation'),
    extractFunction(memorySource, '_showBootArtifactInspectionStatus'),
].join('\n'), context);

// Private fixture matching the relevant entry bytes, not a live artifact.
const dispatchWords = [((0x1f << 27) | (5 << 10)) >>> 0,
    2, 0x071b0001, 0x07230002, 0xaf084001, 0x1f000000];
const originalDispatchWords = dispatchWords.slice();
const dispatchOutput = context._formatCanonicalSavedLumpWords(dispatchWords, {});
assert.match(dispatchOutput, /\[0001\].*00000002.*DISPATCH #1: legacy entry value 2/);
assert.match(dispatchOutput, /method metadata absent/);
assert.match(dispatchOutput, /\[0000\].*HEADER\n.*magic=0x1F \(valid\), n_minus_6=0, typ=0\n.*cw=5, cc=0, size=64 words/);
assert(!dispatchOutput.includes('; DISPATCH'), 'dispatch is decoded data, not a comment');
assert(dispatchOutput.indexOf('HEADER') < dispatchOutput.indexOf('DISPATCH #1'));
assert(!dispatchOutput.includes('WORD_2\n'), 'entry data is not decoded as an instruction');
assert.deepEqual(dispatchWords, originalDispatchWords, 'display must not rewrite binary words');
assert.equal(context._lumpDispatchAnnotation([dispatchWords[0], 0x071b0001], 1, 0), '',
    'ordinary instruction without a dispatch prefix remains an instruction');
assert.equal(context._lumpDispatchAnnotation([dispatchWords[0], 0], 1, 0), '',
    'HALT without table evidence is not invented into a private method');
assert.match(context._lumpDispatchAnnotation([dispatchWords[0], 0], 1, 1),
    /private entry/);
assert.match(context._lumpDispatchAnnotation([dispatchWords[0], 0xb7000000 | 0x08000002], 1, 1),
    /BRANCH 2 -> LUMP word 3/);
assert.match(context._lumpDispatchAnnotation([dispatchWords[0], 0xb7000000 | 0x08007fff], 1, 1),
    /BRANCH -1 -> LUMP word 0/);
assert(source.includes('trimmed.slice(_dispatchLines.length)'),
    'reopened saved disassembly excludes annotated entry data from instruction decoding');

(async () => {
    const frozen = {
        source: 'method Run() { return(1) }',
        epoch: 7,
    };
    const shown = await context._fetchAndPresentCommittedLump(
        { token: 'server-token' },
        {
            token: 'server-token',
            abstraction: 'RunAbstraction',
            filename: 'Ada.Run.4.server-token.lump',
        },
        frozen);
    assert.equal(shown, true);
    assert.match(fetchedUrl,
        /exact_filename=Ada\.Run\.4\.server-token\.lump/,
        'post-save fetch is pinned to the exact saved filename');
    const output = dom.window.document.getElementById('savedLumpDisassembly').textContent;
    assert.match(output, /SAVED BINARY — exact canonical server response/);
    canonicalWords.forEach((word, index) => {
        assert(output.includes(
            '[' + String(index).padStart(4, '0') + ']  0x' +
            (word >>> 0).toString(16).padStart(8, '0').toUpperCase()));
    });
    assert.match(output, /non-code data \/ embedded source \/ API frame/,
        'middle artifact words are not mislabeled as padding');
    assert.equal(dom.window.document.getElementById('asmEditor').value,
        frozen.source, 'saved presentation preserves source');
    assert.equal(dom.window.document.getElementById('savedLumpBuildDetails').open,
        false, 'successful saved presentation collapses build audit');

    // A changed navigation epoch prevents a delayed canonical response from
    // taking ownership of or painting over the newly selected document.
    const beforeRace = output;
    dom.window._editorNavigationEpoch = 8;
    assert.equal(await context._fetchAndPresentCommittedLump(
        { token: 'late-token' }, { abstraction: 'Late' }, frozen), false);
    assert.equal(dom.window.document.getElementById('savedLumpDisassembly').textContent,
        beforeRace);

    // Even on the filename-pinned route, contradictory response identity is
    // rejected rather than being relabeled as the save that just completed.
    dom.window._editorNavigationEpoch = 7;
    fetchResult = {
        ok: true,
        json: async () => ({
            words: canonicalWords,
            filename: 'newer-same-token.lump',
            raw_tail_hex: '',
            byte_count: canonicalWords.length * 4,
        }),
    };
    assert.equal(await context._fetchAndPresentCommittedLump(
        { token: 'server-token' },
        {
            token: 'server-token',
            abstraction: 'RunAbstraction',
            filename: 'Ada.Run.4.server-token.lump',
        },
        frozen), false);
    assert.match(
        dom.window.document.getElementById('savedLumpDisassembly').textContent,
        /identity does not match the saved filename/);

    // A committed save with an unavailable canonical response is explicit
    // about the failure and never displays the pre-save candidate as saved.
    fetchResult = { ok: false, status: 404 };
    const unavailable = await context._fetchAndPresentCommittedLump(
        { token: 'server-token' },
        { token: 'server-token', abstraction: 'RunAbstraction' },
        frozen);
    assert.equal(unavailable, false);
    const failure = dom.window.document.getElementById('savedLumpDisassembly').textContent;
    assert.match(failure, /SAVED BINARY UNAVAILABLE/);
    assert.match(failure, /No saved-byte claim/);
    assert.match(failure, /HTTP 404/);
    assert(!failure.includes('UNSAVED COMPILE CANDIDATE'));
    assert.equal(dom.window.document.getElementById('asmEditor').value, frozen.source);

    // Pin both receipt locators. A successful HTTP response with missing or
    // contradictory identity must not be painted as the just-saved bytes.
    const receipt = {
        abstraction: 'RunAbstraction', filename: 'saved.lump', binary_hash: 'a'.repeat(64),
    };
    fetchResult = {
        ok: true,
        json: async () => ({words: canonicalWords, filename: receipt.filename,
            binary_hash: 'b'.repeat(64)}),
    };
    assert.equal(await context._fetchAndPresentCommittedLump(
        {token: 'shared-token'}, receipt, frozen), false);
    assert(fetchedUrl.includes('exact_filename=saved.lump&binary_hash=' + 'a'.repeat(64)));
    assert.match(dom.window.document.getElementById('savedLumpDisassembly').textContent,
        /digest does not match/);
    fetchResult.json = async () => ({words: canonicalWords});
    assert.equal(await context._fetchAndPresentCommittedLump(
        {token: 'shared-token'}, receipt, frozen), false);
    assert.match(dom.window.document.getElementById('savedLumpDisassembly').textContent,
        /identity does not match/);
    fetchResult.json = async () => ({words: canonicalWords,
        filename: receipt.filename, binary_hash: receipt.binary_hash});
    assert.equal(await context._fetchAndPresentCommittedLump(
        {token: 'shared-token'}, receipt, frozen), true);

    // Reload restores only ownership/source synchronously; its new hydration
    // hook must fetch the binary without opening/replacing programmer source.
    const restoredDraft = 'unsaved programmer draft after refresh';
    dom.window.document.getElementById('asmEditor').value = restoredDraft;
    dom.window.document.getElementById('savedLumpDisassembly').textContent =
        'SAVE SUCCEEDED — SAVED BINARY UNAVAILABLE';
    assert.equal(await context._restoreSavedLumpBinaryPresentation(
        'shared-token', receipt, dom.window.document.getElementById('asmEditor')), true);
    assert.equal(dom.window.document.getElementById('asmEditor').value, restoredDraft);
    assert.match(dom.window.document.getElementById('savedLumpDisassembly').textContent,
        /SAVED BINARY — exact canonical server response/);
    assert.doesNotMatch(dom.window.document.getElementById('savedLumpDisassembly').textContent,
        /UNAVAILABLE/);
    assert.equal(dom.window._editorSavedBinaryReceipt.filename, receipt.filename);
    // Restore the pet name from the exact response, not a token or live program.
    dom.window._editorOpenLumpToken = 'shared-token';
    context._updateEditorCodeName('shared-token');
    fetchResult.json = async () => ({words: canonicalWords,
        filename: receipt.filename, binary_hash: receipt.binary_hash,
        abstraction: 'CapabilityTest', lump_version: 94});
    assert.equal(await context._restoreSavedLumpBinaryPresentation(
        'shared-token', receipt, dom.window.document.getElementById('asmEditor')), true);
    assert.equal(dom.window.document.getElementById('editorCodeName').textContent, 'CapabilityTest');
    assert.equal(dom.window._editorCodeNameValue, 'CapabilityTest');
    assert.equal(dom.window._editorOpenLumpMeta.lump_version, 94);
    assert.equal(dom.window.document.getElementById('asmEditor').value, restoredDraft);
    // A rejected exact identity cannot rename the document.
    fetchResult.json = async () => ({words: canonicalWords,
        filename: 'wrong.lump', binary_hash: receipt.binary_hash, abstraction: 'Wrong'});
    assert.equal(await context._restoreSavedLumpBinaryPresentation(
        'shared-token', receipt, dom.window.document.getElementById('asmEditor')), false);
    assert.equal(dom.window._editorCodeNameValue, 'CapabilityTest');
    // Navigation while the request is pending cannot rename the new document.
    fetchResult.json = async () => {
        dom.window._editorNavigationEpoch++;
        context._updateEditorCodeName('Other.Program');
        return {words: canonicalWords, filename: receipt.filename,
            binary_hash: receipt.binary_hash, abstraction: 'Late.Name'};
    };
    assert.equal(await context._restoreSavedLumpBinaryPresentation(
        'shared-token', receipt, dom.window.document.getElementById('asmEditor')), false);
    assert.equal(dom.window._editorCodeNameValue, 'Other.Program');
    fetchResult.json = async () => ({words: canonicalWords,
        filename: receipt.filename, binary_hash: receipt.binary_hash});
    // A stale boot-image fetch is independent of the editor-owned SelfTest
    // receipt: retain the draft and inspect that exact saved response.
    const selfTestReceipt = Object.assign({}, receipt, { abstraction: 'SelfTest' });
    dom.window._editorOpenLumpToken = 'shared-token';
    dom.window._bootImageInspectionWarning = 'Boot image inputs changed after preparation';
    assert.equal(await context._restoreSavedLumpBinaryPresentation(
        'shared-token', selfTestReceipt, dom.window.document.getElementById('asmEditor')), true);
    assert.equal(dom.window.document.getElementById('asmEditor').value, restoredDraft);
    assert.match(dom.window.document.getElementById('savedLumpDisassembly').textContent,
        /SAVED BINARY — exact canonical server response/);
    assert.match(dom.window.document.getElementById('savedLumpDisassembly').textContent,
        /Abstraction: SelfTest/);
    assert.match(dom.window.document.getElementById('disassemblyPresentationStatus').textContent,
        /Viewing: saved SelfTest.*shared-token.*not a live execution trace/);
    const status = dom.window.document.getElementById('disassemblyPresentationStatus');
    assert.match(status.textContent, /Running \/ loaded identity: unknown/);
    assert.doesNotMatch(status.textContent, /stale\/rejected|not the executing image/);
    dom.window._simulatorBootImageStale = true;
    dom.window.ExecutionIdentity = {get: () => ({
        token: '12345678', abstraction: 'Synthetic', liveMemoryKnown: true, runStatus: 'ready'
    })};
    context._showBootArtifactInspectionStatus();
    assert.match(status.textContent, /Synthetic \(12345678\); state: ready/);
    assert.match(status.textContent, /Simulator testing remains available/);
    dom.window.ExecutionIdentity = {get: () => ({liveMemoryKnown: false, token: '12345678'})};
    context._showBootArtifactInspectionStatus();
    assert.match(status.textContent, /Running \/ loaded identity: unknown/);
    assert.match(fetchedUrl, /exact_filename=saved\.lump&binary_hash=/);
    const runSource = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
    assert(extractFunction(runSource, 'loadEditorState')
        .includes('window._restoreSavedLumpBinaryPresentation('),
        'actual refresh hydration invokes binary-only reload');
    assert(extractFunction(runSource, 'saveEditorState').includes('state.savedBinary'),
        'future reloads retain exact receipt rather than only a shared token');

    console.log('Saved LUMP canonical presentation tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});