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
assert.equal(label.textContent,'CapabilityTest · Saved LUMP v45');
ctx.window._editorOpenLumpToken='other';
ctx._refreshEditorActionIdentity('Different');
assert.equal(label.textContent,'Different', 'never borrow another artifact revision');
// Exercise the actual Namespace -> exact editor metadata handoff. Previously
// both stages dropped the saved revision even though they retained its hash.
const memorySource=fs.readFileSync(__dirname+'/app-memory.js','utf8');
const lumpSource=fs.readFileSync(__dirname+'/app-lumps.js','utf8');
let opened;
ctx.openLumpInEditor=(token,options)=>{opened={token,options};};
vm.runInContext(memorySource.slice(memorySource.indexOf('function _nsOpenDesignSelection('),
    memorySource.indexOf('function _showNSThreadModal(')),ctx);
ctx._nsOpenDesignSelection({name:'ide.CapabilityTest',selection:{
    token:'961bfee3',filename:'ide.CapabilityTest.1.ea7c9154.lump',
    binaryHash:'a'.repeat(64),revision:2,
}},10);
assert.equal(opened.options.exactSavedArtifact.lump_version,2);
ctx._exactSelection=opened.options.exactSavedArtifact;
ctx.token=opened.token;
const metadataStart=lumpSource.indexOf('    var lump = _exactSelection ?');
const metadataEnd=lumpSource.indexOf('\n\n',metadataStart);
vm.runInContext(lumpSource.slice(metadataStart,metadataEnd),ctx);
assert.equal(ctx.lump.lump_version,2);
ctx.window._editorOpenLumpToken=opened.token;
ctx.window._editorOpenLumpMeta=ctx.lump;
ctx._refreshEditorActionIdentity('ide.CapabilityTest');
assert.equal(label.textContent,'ide.CapabilityTest · Saved LUMP v2');
console.log('Saved editor language and revision labels: PASS');
