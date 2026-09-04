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
    <div id="codeSidebarTabs"></div>
    <section id="savedLumpDisassemblyPanel" style="display:none">
        <h2 id="savedLumpDisassemblyTitle"></h2>
        <pre id="savedLumpDisassembly"></pre>
    </section>
    <div id="asmErrorPanel" style="display:none"></div>
    <div id="asmWarningPanel"></div>
    <div id="codeConsoleContent"></div>
    <div id="codeHistoryPanel"></div>
    <div id="codeSyntaxPanel"></div>
    <div id="codeJsPanel"></div>
</body>`, { url: 'http://localhost/simulator/' });

const context = vm.createContext({
    window: dom.window,
    document: dom.window.document,
    console,
    _activeAsmErrors: [],
    _escHtml: value => String(value),
    _getSyntaxSuggestion: () => null,
    _highlightAsmErrorLines: () => {},
});
context.window._savedLumpEditorMode = false;

const errorsSource = fs.readFileSync(path.join(__dirname, 'app-cr-detail.js'), 'utf8');
const lumpsSource = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');
vm.runInContext([
    extractFunction(errorsSource, '_showCompileFailedBanner'),
    extractFunction(errorsSource, '_hideCompileFailedBanner'),
    extractFunction(errorsSource, '_showAsmErrors'),
    extractFunction(errorsSource, '_clearAsmErrors'),
    extractFunction(lumpsSource, '_enterSavedLumpEditorMode'),
].join('\n'), context);

vm.runInContext('_enterSavedLumpEditorMode("LOAD CR1, CR6, #0", "CapabilityTest")', context);
const disassembly = dom.window.document.getElementById('savedLumpDisassemblyPanel');
const errors = dom.window.document.getElementById('asmErrorPanel');
assert.equal(disassembly.style.display, 'flex', 'saved disassembly starts visible');
assert.equal(errors.style.display, 'none', 'stale errors are cleared on entry');

vm.runInContext('_showAsmErrors([{line:66,message:"Expected a capability register"}])', context);
assert.equal(disassembly.style.display, 'none', 'errors replace saved disassembly');
assert.equal(errors.style.display, 'flex', 'compiler errors are visible');

vm.runInContext('_clearAsmErrors()', context);
assert.equal(errors.style.display, 'none', 'cleared compiler errors are hidden');
assert.equal(disassembly.style.display, 'flex', 'saved disassembly returns after clearing errors');

console.log('saved-LUMP compiler error layout tests passed');