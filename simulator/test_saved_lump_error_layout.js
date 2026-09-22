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

const dom = new JSDOM(`<!doctype html><body>
    <div id="compileFailedBanner" style="display:none"><span id="compileFailedBannerText"></span></div>
    <div id="editor"><div class="editor-layout">
    <div class="editor-panel"><textarea id="asmEditor">CALL SelfTest.Run</textarea></div>
    <section id="savedLumpDisassemblyPanel" class="saved-lump-disassembly-panel" style="display:none">
        <div id="disassemblyPresentationStatus"></div>
        <pre id="savedLumpDisassembly"></pre>
    </section>
    <div class="editor-panel console-panel">
    <div id="codeSidebarTabs"></div>
    <div id="asmErrorPanel" style="display:none"></div>
    <div id="asmWarningPanel"></div>
    <div id="codeConsoleContent"></div>
    <div id="codeHistoryPanel"></div>
    <div id="codeSyntaxPanel"></div>
    <div id="codeJsPanel"></div>
    </div></div></div>
</body>`, { url: 'http://localhost/simulator/' });
const style = dom.window.document.createElement('style');
style.textContent = fs.readFileSync(path.join(__dirname, 'styles-toolbar.css'), 'utf8');
dom.window.document.head.appendChild(style);

const context = vm.createContext({
    window: dom.window,
    document: dom.window.document,
    console,
    _activeAsmErrors: [],
    _escHtml: value => String(value),
    _getSyntaxSuggestion: () => null,
    _highlightAsmErrorLines: () => {},
    _syncSavedLumpIdentityVisibility: () => {},
});
context.window._savedLumpEditorMode = false;

const errorsSource = fs.readFileSync(path.join(__dirname, 'app-cr-detail.js'), 'utf8');
const lumpsSource = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');
assert(
    /ed\.addEventListener\('input',[\s\S]*?_dismissStaleAsmErrorsOnEdit\(\);[\s\S]*?_dismissAsmAdvisoryPopup\(\);/.test(errorsSource),
    'editing source invalidates stale compiler diagnostics without full pane teardown'
);
vm.runInContext([
    extractFunction(lumpsSource, '_setDisassemblyPresentationStatus'),
    extractFunction(lumpsSource, '_showCompilerOutputBesideSource'),
    extractFunction(errorsSource, '_showCompileFailedBanner'),
    extractFunction(errorsSource, '_hideCompileFailedBanner'),
    extractFunction(errorsSource, '_showAsmErrors'),
    extractFunction(errorsSource, '_clearAsmErrors'),
    extractFunction(lumpsSource, '_enterSavedLumpEditorMode'),
].join('\n'), context);
context.window._showCompilerOutputBesideSource = context._showCompilerOutputBesideSource;

vm.runInContext('_enterSavedLumpEditorMode("LOAD CR1, CR6, #0", "CapabilityTest")', context);
const disassembly = dom.window.document.getElementById('savedLumpDisassemblyPanel');
const errors = dom.window.document.getElementById('asmErrorPanel');
assert.equal(disassembly.style.display, 'flex', 'saved disassembly starts visible');
assert.equal(errors.style.display, 'none', 'stale errors are cleared on entry');

vm.runInContext('_showAsmErrors([{line:66,message:"Expected a capability register"}])', context);
assert.equal(disassembly.style.display, 'flex', 'errors do not hide saved disassembly');
assert.equal(dom.window.document.getElementById('savedLumpDisassembly').textContent,
    'LOAD CR1, CR6, #0', 'failed compile preserves exact previously rendered bytes');
assert.equal(errors.style.display, 'flex', 'compiler errors are visible');
assert.equal(dom.window.getComputedStyle(dom.window.document.querySelector('.console-panel')).display,
    'flex', 'diagnostics are not hidden behind saved-LUMP CSS');
assert.match(dom.window.document.getElementById('disassemblyPresentationStatus').textContent,
    /Exact saved binary.*Not the result/);
assert.equal(dom.window.document.getElementById('asmEditor').value, 'CALL SelfTest.Run');
// Repeated failures and a restored/edited draft keep the previous exact
// disassembly, never manufacturing new words from rejected source.
dom.window.document.getElementById('asmEditor').value = 'restored CR11 draft';
vm.runInContext('_showAsmErrors([{line:1,message:"Unknown method"}])', context);
assert.equal(disassembly.style.display, 'flex');
assert.equal(dom.window.document.getElementById('savedLumpDisassembly').textContent, 'LOAD CR1, CR6, #0');
assert.equal(dom.window.document.getElementById('asmEditor').value, 'restored CR11 draft');

let actionCalled = false;
context.testAction = function() { actionCalled = true; };
vm.runInContext('_showAsmErrors([{line:null,message:"Capability \\"New.Service\\" has no declared permissions."}], "Capability validation failed", {label:"Add 1 new dot-name to Namespace", onClick:testAction})', context);
const actionButton = errors.querySelector('.asm-error-action-btn');
assert(actionButton, 'capability errors can render a Namespace action');
assert.equal(actionButton.textContent, 'Add 1 new dot-name to Namespace');
actionButton.click();
assert.equal(actionCalled, true, 'Namespace action invokes its callback');

vm.runInContext('_clearAsmErrors()', context);
assert.equal(errors.style.display, 'none', 'cleared compiler errors are hidden');
assert.equal(disassembly.style.display, 'flex', 'saved disassembly returns after clearing errors');
vm.runInContext('_enterSavedLumpEditorMode("NEW SAVED HEADER AND WORDS", "Other")', context);
assert(!dom.window.document.querySelector('.editor-layout').classList.contains('disassembly-diagnostics-layout'),
    'opening another exact artifact resets failed-attempt layout');
assert.equal(dom.window.document.getElementById('savedLumpDisassembly').textContent, 'NEW SAVED HEADER AND WORDS');
assert.match(dom.window.document.getElementById('disassemblyPresentationStatus').textContent,
    /^Exact saved binary/);

console.log('saved-LUMP compiler error layout tests passed');