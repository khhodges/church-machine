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
    userTabs: [{ id: 'draft', name: 'Chosen.Program' }],
    activeUserTabId: 'draft',
    window: { _editorCodeNameValue: 'Chosen.Program' },
    document: { getElementById: id => elements[id], createElement: () => ({...element(),style:{}}) },
    _editorActionIdentity: () => 'WukongCallHome#53',
};
vm.createContext(ctx);
vm.runInContext(source.slice(source.indexOf('function _refreshEditorActionIdentity('),
    source.indexOf('const _EDITOR_DOCUMENT_STATE_KEY')), ctx);
ctx._refreshEditorActionIdentity('WukongCallHome');
assert.equal(heading.textContent, 'Chosen.Program');
assert.equal(elements.editorArtifactIdentity.textContent, 'LUMP identity: WukongCallHome#53');
ctx.userTabs[0].name = 'Renamed.Program';
ctx._refreshEditorActionIdentity();
assert.equal(heading.textContent, 'Renamed.Program');
ctx.activeUserTabId = null;
ctx._refreshEditorActionIdentity('Source.File');
assert.equal(heading.textContent, 'Source.File');
ctx._editorActionIdentity = () => '';
ctx._refreshEditorActionIdentity('Source.File');
assert.equal(elements.editorArtifactIdentity, undefined);
assert.equal(heading.textContent, 'Source.File');
console.log('PASS chosen name survives artifact identity, refresh, rename and source navigation');