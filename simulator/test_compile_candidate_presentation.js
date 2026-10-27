'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

function extractFunction(source, name) {
    const start = source.indexOf('function ' + name + '(');
    assert.notEqual(start, -1, 'missing production function ' + name);
    const brace = source.indexOf('{', start);
    let depth = 0;
    for (let i = brace; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error('unbalanced production function ' + name);
}

const dom = new JSDOM(`<!doctype html><body><div id="editor">
  <div class="editor-layout">
    <textarea id="asmEditor">method Run() { return(1) }</textarea>
    <section id="savedLumpDisassemblyPanel" style="display:none">
      <div id="disassemblyPresentationStatus"></div>
      <pre id="savedLumpDisassembly"></pre>
      <details id="compiledLumpMetadata"><pre id="compiledLumpMetadataText"></pre></details>
    </section>
    <div class="console-panel"><div id="asmErrorPanel" style="display:none"></div></div>
  </div>
</div></body>`);
const stylesheet = dom.window.document.createElement('style');
stylesheet.textContent = fs.readFileSync(path.join(__dirname, 'styles-toolbar.css'), 'utf8');
dom.window.document.head.appendChild(stylesheet);
const source = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');
dom.window.LumpApiCodec = require('./lump-api-codec');
dom.window.SymbolicLumpGuard = require('./symbolic-lump-guard');
const context = vm.createContext({
    window: dom.window,
    document: dom.window.document,
    console,
    assembler: { disassemble: word => 'WORD_' + (word >>> 0).toString(16) },
});
vm.runInContext([
    extractFunction(source, '_setDisassemblyPresentationStatus'),
    extractFunction(source, '_lumpDispatchAnnotation'),
    extractFunction(source, '_formatLumpHeaderDisassembly'),
    extractFunction(source, '_isExactSavedLumpWordArray'),
    extractFunction(source, '_formatCanonicalSavedLumpWords'),
    extractFunction(source, '_showCompilerOutputBesideSource'),
    extractFunction(source, '_showCompiledCandidateBesideSource'),
].join('\n'), context);

// Server candidate: header(cw=3), one exact dispatch word, then two code words.
const header = ((0x1f << 27) | (3 << 10)) >>> 0;
const words = [header, 2, 0x18000000, 0x08000001];
// New candidate bytes must not borrow the previous saved identity.
const oldIdentity = dom.window.document.createElement('div');
oldIdentity.id = 'savedLumpIdentityPanel';
oldIdentity.textContent = 'Saved B revision 1 — old hash — 128 words';
dom.window.document.getElementById('editor').prepend(oldIdentity);
dom.window._savedLumpEditorMode = true;
assert.equal(vm.runInContext(
    `_showCompiledCandidateBesideSource(${JSON.stringify(words)}, ` +
    `{abstraction:"RunAbstraction",methodCount:1})`, context), true);
assert.equal(oldIdentity.textContent, 'Saved B revision 1 — old hash — 128 words');
assert.equal(oldIdentity.style.display, 'none',
    'old saved identity is hidden beside the new candidate');
const panel = dom.window.document.getElementById('savedLumpDisassemblyPanel');
const text = dom.window.document.getElementById('savedLumpDisassembly').textContent;
assert.equal(panel.style.display, 'flex', 'successful CLOOMC compile shows candidate');
assert.match(dom.window._compiledCandidateAuditText, /UNSAVED COMPILE CANDIDATE/, 'candidate is distinct from saved binary');
assert.doesNotMatch(text, /Reference verification|Embedded definition|UNSAVED/);
assert.match(text, /\[0000\].*F8000C00/i, 'actual authenticated header is rendered');
assert.match(text, /\[0001\].*00000002.*DISPATCH #1: legacy entry value 2/i,
    'actual authenticated dispatch prefix is rendered');
assert.match(text, /\[0002\].*18000000.*WORD_18000000/i,
    'actual authenticated code word is rendered');
assert(dom.window.document.querySelector('.editor-layout')
    .classList.contains('compiled-candidate-editor-layout'));
assert.equal(dom.window.getComputedStyle(
    dom.window.document.querySelector('.console-panel')).display, 'flex',
    'successful compile retains diagnostics beneath the disassembly');
assert.doesNotMatch(dom.window.getComputedStyle(
    dom.window.document.querySelector('.editor-layout')).gridTemplateRows || '',
    /10px/, 'success never creates a vertical disassembly/console split');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
assert.match(html, /<details id="savedLumpBuildDetails"[^>]*>/,
    'build and audit output is available in an explicit disclosure');
assert.doesNotMatch(html, /<details id="savedLumpBuildDetails"[^>]*\sopen(?:\s|>)/,
    'audit disclosure is collapsed by default');

// Starting or failing the next compile retains the last successful binary,
// explicitly marked as previous, while exposing diagnostics independently.
vm.runInContext('_showCompilerOutputBesideSource()', context);
assert.equal(panel.style.display, 'flex', 'failed/new compile retains exact previous candidate');
assert.equal(dom.window.document.getElementById('savedLumpDisassembly').textContent, text);
assert.match(dom.window.document.getElementById('disassemblyPresentationStatus').textContent,
    /Previous successful compile.*UNSAVED candidate.*Not the result/);
assert.equal(dom.window.getComputedStyle(
    dom.window.document.querySelector('.console-panel')).display, 'flex',
    'failed or pending compilation can show diagnostics');
assert.equal(dom.window.document.getElementById('asmEditor').value,
    'method Run() { return(1) }', 'presentation never rewrites the draft');
// A later successful attempt replaces the previous bytes and leaves the
// failure layout. No source replacement approval is needed for read-only output.
assert.equal(context._showCompiledCandidateBesideSource(words,
    { abstraction: 'RunAbstraction', methodCount: 1 }), true);
assert(!dom.window.document.querySelector('.editor-layout')
    .classList.contains('disassembly-diagnostics-layout'));
assert.match(dom.window.document.getElementById('disassemblyPresentationStatus').textContent,
    /^Successful compile.*UNSAVED authenticated candidate/);

const compileSource = fs.readFileSync(path.join(__dirname, 'app-compile.js'), 'utf8');
assert(compileSource.includes('const _registeredCodeWords = lumpWordsArray.slice(1, 1 + cw)'),
    'published candidate uses authenticated server code region');
assert(!compileSource.includes('was inferred for this read-only candidate view'),
    'candidate reports no longer normalize inferred identities');
assert(!compileSource.includes('_candidateExecutionWords.push(_method.visibility'),
    'browser does not rewrite authenticated dispatch words');

console.log('CLOOMC candidate presentation tests passed');
// Exercise the real server compiler: name edits change embedded binary data,
// not necessarily code or numeric placeholders. Never use display metadata as
// a replacement for names decoded from these exact bytes.
const { spawnSync } = require('child_process');
context.TextDecoder = TextDecoder;
function compileNamedCandidate(name) {
    const draft = `abstraction test.DeclaredCandidate {\ncapabilities {\n SELF E\n test.${name} E\n}\nmethod Run {\n LOAD CR0, test.${name}\n RETURN\n}\n}`;
    const processResult = spawnSync(process.execPath,
        [path.join(__dirname, '..', 'server', 'compile_worker.js')], {
            input: JSON.stringify({source: draft, language: 'auto', tier: 2}),
            encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
        });
    assert.equal(processResult.status, 0, processResult.stderr);
    const result = JSON.parse(processResult.stdout);
    assert.equal(result.ok, true, result.error);
    return result.words;
}
const firstNamed = compileNamedCandidate('FirstTarget');
const secondNamed = compileNamedCandidate('SecondTarget');
const codeEnd = 1 + ((firstNamed[0] >>> 10) & 8191);
assert.deepEqual(firstNamed.slice(1, codeEnd), secondNamed.slice(1, codeEnd));
assert.deepEqual(firstNamed.slice(-2), secondNamed.slice(-2));
assert.notDeepEqual(firstNamed, secondNamed);
context._showCompiledCandidateBesideSource(firstNamed,
    {abstraction: 'RunAbstraction', methodCount: 1, inferredName: true});
assert.match(dom.window.document.getElementById('compiledLumpMetadataText').textContent,
    /"name": "test.FirstTarget"/);
context._showCompiledCandidateBesideSource(secondNamed,
    {abstraction: 'RunAbstraction', methodCount: 1, inferredName: true});
const namedText = dom.window.document.getElementById('compiledLumpMetadataText').textContent;
assert.match(namedText, /"name": "test.SecondTarget"/);
assert.doesNotMatch(namedText, /FirstTarget/);
assert.doesNotMatch(namedText, /label was inferred/);
assert.match(namedText, /zero placeholders/);
const clistText = namedText.slice(namedText.indexOf('; C-list (exact authenticated words)'));
assert.match(clistText, /C-list\[0\] "SELF"\s+—\s+0x00000000/);
assert.match(clistText, /C-list\[1\] "test.SecondTarget"\s+—\s+0x00000000/);
assert.doesNotMatch(clistText, /inspect the embedded names above/);
const boundWords = secondNamed.slice();
boundWords[boundWords.length - 1] = 0x4a00000a;
context._showCompiledCandidateBesideSource(boundWords, {});
assert.match(dom.window.document.getElementById('compiledLumpMetadataText').textContent,
    /C-list\[1\] "test.SecondTarget"\s+—\s+0x4A00000A \(encoded word; binding not verified here\)/);
const malformed = secondNamed.slice();
malformed[codeEnd] = 0xABFFFFFF;
context._showCompiledCandidateBesideSource(malformed, {});
assert.match(dom.window.document.getElementById('compiledLumpMetadataText').textContent,
    /Cannot decode embedded definition/);
assert.match(dom.window.document.getElementById('compiledLumpMetadataText').textContent,
    /C-list\[1\] \(PetName unavailable in candidate bytes\)/);
assert.doesNotMatch(dom.window.document.getElementById('compiledLumpMetadataText').textContent,
    /SecondTarget/, 'never reuse names from a previous candidate');
assert.equal(dom.window.document.getElementById('asmEditor').value,
    'method Run() { return(1) }', 'inspection preserves the programmer draft');
console.log('Embedded candidate name inspection tests passed');
const beforeReport = JSON.stringify(secondNamed);
context._showCompiledCandidateBesideSource(secondNamed, {
    referenceReport: 'Reference verification:\n  Row 1 <img src=x>: SYMBOLIC — valid declared PetName; its target need not exist yet.',
});
assert.match(dom.window._compiledCandidateAuditText,
    /Row 1 <img src=x>: SYMBOLIC/);
assert.equal(dom.window.document.getElementById('savedLumpDisassembly').querySelector('img'), null);
assert.equal(JSON.stringify(secondNamed), beforeReport, 'report rendering never changes words');

// Exact real-compiler relocation evidence, including conditional CALL and an
// intentional HARDFAULT with the same raw word as an unconditional placeholder.
const callDraft = `abstraction test.Caller {
capabilities {
 SELF E
 test.Target E
}
method Run {
 CALL test.Target.Run
 CALLEQ test.Target.Other
 HARDFAULT INTENTIONAL
 RETURN
}
}`;
const callCompile = spawnSync(process.execPath, ['server/compile_worker.js'], {
    input: JSON.stringify({source: callDraft, language: 'assembly', tier: 2}),
    encoding: 'utf8',
});
assert.equal(callCompile.status, 0, callCompile.stderr);
const callResult = JSON.parse(callCompile.stdout);
assert.equal(callResult.ok, true, JSON.stringify(callResult));
const callWords = callResult.words;
const guard = dom.window.SymbolicLumpGuard;
const contract = guard.embedded(callWords);
assert.equal(contract.calls.length, 2);
const frozenCalls = JSON.stringify(callWords);
const renderCalls = words => {
    context._showCompiledCandidateBesideSource(words, {methodCount: 1});
    return dom.window.document.getElementById('savedLumpDisassembly').textContent;
};
dom.window.document.getElementById('asmEditor').value = 'CALL mutable.Wrong';
const callDisplay = renderCalls(callWords);
assert.match(callDisplay, /CALL test.Target.Run — pending binding/);
assert.match(callDisplay, /CALLEQ test.Target.Other — pending binding/);
assert.doesNotMatch(callDisplay, /mutable.Wrong/);
const faultOffset = contract.calls[1].word_offset + 1;
assert.equal(callWords[faultOffset], 0xf7000000);
assert.match(callDisplay, new RegExp('\\[' + String(faultOffset).padStart(4, '0') +
    '\\]  0xF7000000  WORD_f7000000'));
assert.equal(JSON.stringify(callWords), frozenCalls);
const mismatch = callWords.slice();
mismatch[contract.calls[0].word_offset] ^= 0x00800000;
assert.doesNotMatch(renderCalls(mismatch), /pending binding/);
assert.match(dom.window.document.getElementById('compiledLumpMetadataText').textContent,
    /Symbolic CALL attribution unavailable/);
const absent = callWords.slice();
absent[1 + ((absent[0] >>> 10) & 8191)] = 0;
assert.doesNotMatch(renderCalls(absent), /pending binding|test.Target/);
assert.match(renderCalls(absent), /WORD_f7000000/);
assert.match(renderCalls(callWords), /pending binding/, 'fresh evidence restores attribution');
assert.equal(dom.window.document.getElementById('asmEditor').value, 'CALL mutable.Wrong');
const savedCalls = context._formatCanonicalSavedLumpWords(callWords, {methodCount:1});
assert.match(savedCalls, /C-list\[0\] "SELF"/);
assert.match(savedCalls, /C-list\[1\] "test.Target"/);
assert.doesNotMatch(savedCalls, /PetName unavailable|mutable.Wrong/);
const savedSecond = context._formatCanonicalSavedLumpWords(secondNamed, {});
assert.match(savedSecond, /C-list\[1\] "test.SecondTarget"/);
assert.doesNotMatch(savedSecond, /FirstTarget/);
assert.doesNotMatch(context._formatCanonicalSavedLumpWords(malformed, {}), /SecondTarget/);
const codec = dom.window.LumpApiCodec;
delete dom.window.LumpApiCodec;
const missingCodec = context._formatCanonicalSavedLumpWords(callWords, {});
assert.match(missingCodec, /Compact API decoder unavailable/);
assert.doesNotMatch(missingCodec, /C-list\[1\] "test.Target"/);
dom.window.LumpApiCodec = codec;
assert.match(savedCalls, /CALL test.Target.Run — pending binding/);
assert.match(savedCalls, /CALLEQ test.Target.Other — pending binding/);
assert.match(savedCalls, new RegExp('\\[' + String(faultOffset).padStart(4, '0') +
    '\\]  0xF7000000  WORD_f7000000'), 'intentional HARDFAULT stays raw in saved view');
assert.doesNotMatch(context._formatCanonicalSavedLumpWords(mismatch, {}), /pending binding/);
assert.doesNotMatch(context._formatCanonicalSavedLumpWords(absent, {}), /pending binding/);
assert.equal(JSON.stringify(callWords), frozenCalls, 'saved display never patches portable bytes');
console.log('PASS exact candidate CALL attribution, missing/mismatched evidence and HARDFAULT isolation');