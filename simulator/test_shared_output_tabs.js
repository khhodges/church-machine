// Disassembly lives in ONE shared tabbed output panel beside source together
// with Console Output, Syntax, History and JS. No competing vertical panes.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const html = read('index.html');

// Structure: disassembly section is inside the console panel, after the tabs.
const consoleStart = html.indexOf('id="editorConsolePanel"');
const tabsAt = html.indexOf('id="codeSidebarTabs"');
const disAt = html.indexOf('id="savedLumpDisassemblyPanel"');
const consoleContentAt = html.indexOf('id="codeConsoleContent"');
assert(consoleStart > 0 && tabsAt > consoleStart && disAt > tabsAt && disAt < consoleContentAt,
    'disassembly pane is a tab pane inside the shared output panel');
assert(html.indexOf('id="editorDivider"') < consoleStart, 'source/output vertical divider kept');
assert(!html.includes('id="editorHorizontalDivider"'), 'horizontal splitter retired');
assert.equal((html.match(/id="savedLumpDisassemblyPanel"/g) || []).length, 1, 'no duplicate pane');
const tabIds = [...html.slice(tabsAt, html.indexOf('</div>', tabsAt)).matchAll(/id="(codeTab\w+)"/g)].map(m => m[1]);
assert.deepEqual(tabIds, ['codeTabDisassembly', 'codeTabConsole', 'codeTabSyntax', 'codeTabHistory', 'codeTabJs']);

// CSS: no split grid remains.
const toolbar = read('styles-toolbar.css');
const lumpsCss = read('styles-lumps.css');
assert(!/saved-lump-editor-layout\s*>\s*\.(console-panel|saved-lump-disassembly-panel)/.test(toolbar + lumpsCss),
    'no layout rules place disassembly and console in separate grid rows');
assert(!toolbar.includes('--editor-diagnostics-top'), 'split ratio rows retired');

// Cache tags match file content.
for (const f of ['app-run.js', 'app-lumps.js', 'app-cr-detail.js', 'styles-toolbar.css', 'styles-lumps.css']) {
    const h = crypto.createHash('sha256').update(read(f)).digest('hex').slice(0, 12);
    assert(html.includes(`${f}?v=sha256-${h}`), `${f} cache tag is current`);
}

// Switching behavior with the real switchCodeTab.
function extract(src, name) {
    const start = src.indexOf('function ' + name + '(');
    let depth = 0;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
        if (src[i] === '{') depth++;
        if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error('missing ' + name);
}
const body = html.slice(consoleStart - 60, html.indexOf('<div id="namespace"'));
const dom = new JSDOM(`<!doctype html><body><div id="editor"><div class="editor-layout"><textarea id="asmEditor">src</textarea><div ${body}</div></div></body>`);
const doc = dom.window.document;
const ctx = vm.createContext({ window: dom.window, document: doc, console,
    renderJsTab() {}, renderSyntaxRef() {} });
vm.runInContext(extract(read('app-run.js'), 'switchCodeTab'), ctx);
const vis = id => doc.getElementById(id).style.display;
const tab = id => doc.getElementById(id);

ctx.switchCodeTab('disassembly');
assert.equal(vis('savedLumpDisassemblyPanel'), 'none', 'empty disassembly cannot be selected');
assert.equal(vis('codeConsoleContent'), 'flex');
assert.equal(tab('codeTabDisassembly').style.display, 'none', 'tab hidden without words');

doc.getElementById('savedLumpDisassembly').textContent = '[0000] 0xF8000C00';
ctx.switchCodeTab('disassembly');
assert.equal(vis('savedLumpDisassemblyPanel'), 'flex');
assert.equal(vis('codeConsoleContent'), 'none', 'only one output pane visible');
assert(tab('codeTabDisassembly').classList.contains('active'));
assert(!tab('codeTabConsole').classList.contains('active'));

for (const [t, pane] of [['console', 'codeConsoleContent'], ['syntax', 'codeSyntaxPanel'],
        ['history', 'codeHistoryPanel'], ['js', 'codeJsPanel']]) {
    ctx.switchCodeTab(t);
    assert.equal(vis('savedLumpDisassemblyPanel'), 'none', t + ' hides disassembly');
    assert.notEqual(vis(pane), 'none', t + ' pane shown');
    assert.equal(tab('codeTabDisassembly').style.display, '', 'tab stays available');
}

// Opening/success/error routines select the right tab.
const lumps = read('app-lumps.js');
assert(/function _enterSavedLumpEditorMode[\s\S]*?switchCodeTab\('disassembly'\)[\s\S]*?\n}/.test(lumps),
    'opening a saved LUMP shows Disassembly');
for (const fn of ['_showCompiledCandidateBesideSource', '_showCanonicalSavedLumpBesideSource']) {
    assert(extract(lumps, fn).includes("switchCodeTab('disassembly')"), fn + ' shows Disassembly');
}
const failure = extract(lumps, '_showCompilerOutputBesideSource');
assert(failure.includes("switchCodeTab('console')") && !failure.includes("savedPanel.style.display = 'flex'"),
    'compile start/failure shows Console diagnostics without a second pane');
assert(!extract(read('app-cr-detail.js'), '_clearAsmErrors').includes("'savedLumpDisassemblyPanel'"),
    'clearing errors does not force disassembly open beside the console');

console.log('Shared output tabs tests passed');
