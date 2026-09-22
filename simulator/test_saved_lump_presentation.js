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
const dom = new JSDOM(`<!doctype html><body><div id="editor">
  <div class="editor-layout">
    <textarea id="asmEditor">method Run() { return(1) }</textarea>
    <section id="savedLumpDisassemblyPanel" style="display:none">
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
        words: canonicalWords,
        raw_tail_hex: '',
        byte_count: canonicalWords.length * 4,
    }),
};
let fetchedUrl = '';
const context = vm.createContext({
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
});
dom.window._editorNavigationEpoch = 7;
vm.runInContext([
    extractFunction(source, '_lumpDispatchAnnotation'),
    extractFunction(source, '_formatLumpHeaderDisassembly'),
    extractFunction(source, '_isExactSavedLumpWordArray'),
    extractFunction(source, '_readSavedLumpExactTail'),
    extractFunction(source, '_savedLumpPresentationStillOwnsSource'),
    extractFunction(source, '_formatCanonicalSavedLumpWords'),
    extractFunction(source, '_showCanonicalSavedLumpBesideSource'),
    extractFunction(source, '_fetchAndPresentCommittedLump'),
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
        /archive_filename=Ada\.Run\.4\.server-token\.lump/,
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
    fetchResult = { ok: false, status: 503 };
    const unavailable = await context._fetchAndPresentCommittedLump(
        { token: 'server-token' },
        { token: 'server-token', abstraction: 'RunAbstraction' },
        frozen);
    assert.equal(unavailable, false);
    const failure = dom.window.document.getElementById('savedLumpDisassembly').textContent;
    assert.match(failure, /SAVED BINARY UNAVAILABLE/);
    assert.match(failure, /No saved-byte claim/);
    assert(!failure.includes('UNSAVED COMPILE CANDIDATE'));
    assert.equal(dom.window.document.getElementById('asmEditor').value, frozen.source);

    console.log('Saved LUMP canonical presentation tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});