'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync('simulator/app-run.js', 'utf8');
const elements = {};
function element() {
    return { textContent: '', setAttribute() {}, remove() { delete elements[this.id]; } };
}
const heading = element();
heading.parentNode = { appendChild(el) { elements[el.id] = el; } };
elements.editorCodeName = heading;
const ctx = {
    userTabs: [{ id: 'draft', name: 'Chosen.Program', sourceRevision: 27 }],
    activeUserTabId: 'draft',
    window: { _editorCodeNameValue: 'Chosen.Program', _editorOpenLumpMeta: null },
    document: { getElementById: id => elements[id], createElement: () => ({...element(),style:{}}) },
    _editorActionIdentity: () => 'WukongCallHome#53',
};
vm.createContext(ctx);
vm.runInContext(source.slice(source.indexOf('function _editorActionIdentity('),
    source.indexOf('const _EDITOR_DOCUMENT_STATE_KEY')), ctx);
ctx.window._editorOpenLumpMeta = { dot_name: 'CapabilityTest', issue_n: 2 };
assert.equal(ctx._editorActionIdentity('CapabilityTest'), 'CapabilityTest#2');
ctx.window._editorOpenLumpMeta = null;
ctx._editorActionIdentity = () => 'WukongCallHome#53';
ctx._refreshEditorActionIdentity('WukongCallHome');
assert.equal(heading.textContent, 'WukongCallHome#53 · Source v27');
assert.equal(elements.editorArtifactIdentity, undefined);
ctx.userTabs[0].name = 'Renamed.Program';
ctx._refreshEditorActionIdentity();
assert.equal(heading.textContent, 'WukongCallHome#53 · Source v27');
ctx.activeUserTabId = null;
ctx._refreshEditorActionIdentity('Source.File');
assert.equal(heading.textContent, 'WukongCallHome#53');
ctx._editorActionIdentity = () => '';
ctx._refreshEditorActionIdentity('Source.File');
assert.equal(elements.editorArtifactIdentity, undefined);
assert.equal(heading.textContent, 'Source.File');
console.log('PASS editor identity is consolidated with its source revision');