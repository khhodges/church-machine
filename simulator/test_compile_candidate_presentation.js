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
    </section>
    <div class="console-panel"><div id="asmErrorPanel" style="display:none"></div></div>
  </div>
</div></body>`);
const stylesheet = dom.window.document.createElement('style');
stylesheet.textContent = fs.readFileSync(path.join(__dirname, 'styles-toolbar.css'), 'utf8');
dom.window.document.head.appendChild(stylesheet);
const source = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');
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
    extractFunction(source, '_showCompilerOutputBesideSource'),
    extractFunction(source, '_showCompiledCandidateBesideSource'),
].join('\n'), context);

// Server candidate: header(cw=3), one exact dispatch word, then two code words.
const header = ((0x1f << 27) | (3 << 10)) >>> 0;
const words = [header, 2, 0x18000000, 0x08000001];
assert.equal(vm.runInContext(
    `_showCompiledCandidateBesideSource(${JSON.stringify(words)}, ` +
    `{abstraction:"RunAbstraction",methodCount:1})`, context), true);
const panel = dom.window.document.getElementById('savedLumpDisassemblyPanel');
const text = dom.window.document.getElementById('savedLumpDisassembly').textContent;
assert.equal(panel.style.display, 'flex', 'successful CLOOMC compile shows candidate');
assert.match(text, /UNSAVED COMPILE CANDIDATE/, 'candidate is distinct from saved binary');
assert.match(text, /\[0000\].*F8000C00/i, 'actual authenticated header is rendered');
assert.match(text, /\[0001\].*00000002.*DISPATCH #1: legacy entry value 2/i,
    'actual authenticated dispatch prefix is rendered');
assert.match(text, /\[0002\].*18000000.*WORD_18000000/i,
    'actual authenticated code word is rendered');
assert(dom.window.document.querySelector('.editor-layout')
    .classList.contains('compiled-candidate-editor-layout'));
assert.equal(dom.window.getComputedStyle(
    dom.window.document.querySelector('.console-panel')).display, 'none',
    'successful compile prioritizes disassembly, not the console');
assert.equal(dom.window.getComputedStyle(
    dom.window.document.querySelector('.editor-layout')).gridTemplateColumns,
    'minmax(0, 1fr) minmax(0, 1fr)', 'success has two equally usable panes');
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
assert(compileSource.includes('was inferred for this read-only candidate view'),
    'inferred RunAbstraction identity is explicitly reported');
assert(!compileSource.includes('_candidateExecutionWords.push(_method.visibility'),
    'browser does not rewrite authenticated dispatch words');

console.log('CLOOMC candidate presentation tests passed');