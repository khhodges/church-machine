'use strict';

const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const lumps = fs.readFileSync('simulator/app-lumps.js', 'utf8');
const run = fs.readFileSync('simulator/app-run.js', 'utf8');
const compile = fs.readFileSync('simulator/app-compile.js', 'utf8');

function extractFunction(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert(start >= 0, `${name} exists`);
    let brace = source.indexOf('{', start);
    let depth = 0;
    for (let i = brace; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`Could not extract ${name}`);
}

function node(id) {
    return {
        id,
        style: {},
        classList: {
            removed: [],
            remove(name) { this.removed.push(name); },
        },
    };
}

const elements = {
    codeSidebarTabs: node('codeSidebarTabs'),
    savedLumpDisassemblyPanel: node('savedLumpDisassemblyPanel'),
    savedLumpDisassembly: node('savedLumpDisassembly'),
    codeConsoleContent: node('codeConsoleContent'),
    codeHistoryPanel: node('codeHistoryPanel'),
    codeSyntaxPanel: node('codeSyntaxPanel'),
    codeJsPanel: node('codeJsPanel'),
};
elements.savedLumpDisassembly.textContent = '; exact saved words';
const layout = node('layout');
const context = {
    window: { _savedLumpEditorMode: true },
    document: {
        querySelector: selector => selector === '#editor .editor-layout' ? layout : null,
        getElementById: id => elements[id] || null,
    },
};
vm.createContext(context);
vm.runInContext(extractFunction(lumps, '_showCompilerOutputBesideSource'), context);
context._showCompilerOutputBesideSource();

assert.equal(context.window._savedLumpEditorMode, true,
    'compiler diagnostics suspend presentation without destroying saved ownership');
assert.equal(context.window._savedLumpDisassemblyBeforeCompile,
    '; exact saved words', 'exact saved rendering is retained internally');
assert(layout.classList.removed.includes('saved-lump-editor-layout'));
assert.equal(elements.savedLumpDisassemblyPanel.style.display, 'none');
assert.equal(elements.codeSidebarTabs.style.display, '');
assert.equal(elements.codeConsoleContent.style.display, 'flex');
assert.equal(elements.codeHistoryPanel.style.display, 'none');
assert(run.includes('window._showCompilerOutputBesideSource();'),
    'assembly compilation activates source-left/output-right mode');
assert(compile.includes('window._showCompilerOutputBesideSource();'),
    'CLOOMC compilation activates source-left/output-right mode');

console.log('PASS compiler output appears beside preserved source');