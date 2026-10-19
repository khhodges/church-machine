'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {JSDOM} = require('jsdom');
const source = fs.readFileSync(__dirname+'/app-lumps.js','utf8');
const dom = new JSDOM('<div id="savedLumpIdentityPanel"></div>');
const artifact = {token:'961bfee3',lump_version:2, trusted:true,approved:true,
    binary_valid:true,validation_errors:[]};
const words = [123];
const ctx = {document:dom.window.document,window:{},
    _verifiedSavedLumpIdentity:()=>({canonicalDotToken:'ide.CapabilityTest.1.961bfee3',
        lookupToken:'961bfee3',goldenT:'a'.repeat(64),binarySeal:'b'.repeat(64)}),
    _sameSavedLumpWord:()=>false,
    _getLumpFieldSizeLayout:actual=>{assert.equal(actual,words);return {source:0};},
    _renderSavedLumpWordUsage:(panel,actual)=>{assert.equal(actual,words);},
};
ctx.window.renderBuildHandoff=(panel,actual)=>assert.equal(actual,artifact);
vm.createContext(ctx);
vm.runInContext(source.slice(source.indexOf('function _renderSavedLumpIdentityPanel('),
    source.indexOf('function _renderSavedLumpWordUsage(')),ctx);
ctx._renderSavedLumpIdentityPanel(artifact,artifact.token,words);
const text = dom.window.document.body.textContent;
for (const label of ['Saved artifact — identity and binary verified','Identity hash',
    'Binary SHA-256','No source is embedded','not unsaved editor text or runtime state']) {
    assert(text.includes(label),label);
}
for (const label of ['Exact lookup token','Runtime Golden Token','Golden T ID']) {
    assert(!text.includes(label),label+' removed from saved-only panel');
}
assert.equal(text.split('961bfee3').length-1,1,'token is shown only within canonical identity');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
for (const selector of ['#activeThreadStatus','#faultFreeCounter','.execution-counter-strip']) {
    assert(html.includes('body:has(#editor.active .saved-lump-editor-layout) '+selector));
}
console.log('PASS saved artifact-only labels, deduplication, exact inputs and scoped session indicators');
