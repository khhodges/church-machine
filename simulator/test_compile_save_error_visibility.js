'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const {JSDOM} = require('jsdom');
global.ChurchAssembler = require('./assembler');
const Compiler = require('./cloomc_compiler');
const source = `abstraction ide.Alice {
capabilities { SELF E }
method stash() {
IADD DR1, DR0, #999
DWRITE DR1, CR5, #9
RETURN }
method reveal() (
DREAD DR1, CR5, #9
RETURN }
WORD 0 }
`;
const dom = new JSDOM('<textarea id="asmEditor"></textarea><select id="langSelector"><option value="javascript">JS</option></select><pre id="editorConsole"></pre>');
const editor = dom.window.document.getElementById('asmEditor');
editor.value = source;
let shown, tab, reviews = 0;
const context = {
    window:dom.window, document:dom.window.document, console,
    switchCodeTab(value) {tab = value;},
    _showAsmErrors(errors) {shown = errors;},
    showFormatLump() {reviews++;},
    smartCompile: async options => {
        const result = new Compiler().compile(options.source, []);
        return {...result, ok:result.errors.length === 0,
            error: result.errors.map(e => `Line ${e.line}: ${e.message}`).join('\n')};
    },
};
dom.window.alert = () => {};
dom.window.TargetState = {authorize: () => ({ok:true})};
vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname + '/app-actions.js', 'utf8'), context);
(async () => {
    const compiled = await dom.window.IDEActions.compile();
    assert.equal(compiled.ok, false);
    assert.equal(tab, 'console');
    assert.match(shown[0].message, /Malformed method/);
    assert(!shown.some(e => /SELF.*canonical dot-name/.test(e.message)));
    const errors = JSON.stringify(shown);
    const saved = await dom.window.IDEActions.save();
    assert.equal(saved.ok, false);
    assert.equal(JSON.stringify(shown), errors, 'Compile and Save show identical source errors');
    const text = dom.window.document.getElementById('editorConsole').textContent;
    assert.match(text, /Malformed method/);
    assert.match(text, /Unexpected closing brace/);
    assert.match(text, /No LUMP was saved/);
    assert.equal(reviews, 0);
    assert.equal(editor.value, source);
    console.log('PASS first Compile and Save show matching diagnostics without false SELF error or lost draft');
})().catch(error => {console.error(error); process.exitCode = 1;});
