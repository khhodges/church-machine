'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/app-run.js', 'utf8');
const selector = {value:'javascript'};
const label = {setAttribute() {}};
let updates = 0;
const ctx = {window:{
    _editorOpenLumpToken:'exact',
    _editorSavedBinaryReceipt:{token:'exact', lump_version:45},
}, document:{getElementById:id => id==='langSelector'?selector:label},
    onLangChange:restoring => { assert.equal(restoring,true); updates++; },
    _editorDisplayPetName:name=>name};
vm.createContext(ctx);
vm.runInContext(source.slice(source.indexOf('function _syncSavedSourceLanguage('),
    source.indexOf("const _EDITOR_DOCUMENT_STATE_KEY")),ctx);
vm.runInContext(source.slice(source.indexOf('function _refreshEditorActionIdentity('),
    source.indexOf('// Respect the saved document')),ctx);
ctx._syncSavedSourceLanguage('; Language: Assembly\nLOAD CR1, 1');
assert.equal(selector.value,'assembly');
assert.equal(updates,1);
ctx._syncSavedSourceLanguage('; Language: Assembly\nLOAD CR1, 1');
assert.equal(updates,1);
selector.value='javascript';
ctx._syncSavedSourceLanguage('const value = 1;');
assert.equal(selector.value,'javascript');
ctx._refreshEditorActionIdentity('CapabilityTest');
assert.equal(label.textContent,'CapabilityTest · Source v45');
ctx.window._editorOpenLumpToken='other';
ctx._refreshEditorActionIdentity('Different');
assert.equal(label.textContent,'Different', 'never borrow another artifact revision');
console.log('Saved editor language and revision labels: PASS');
