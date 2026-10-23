'use strict';
const fs = require('fs'), vm = require('vm'), assert = require('assert/strict');
const source = fs.readFileSync(__dirname + '/app-lumps.js', 'utf8');
const full = '; full SelfTest\n' + 'INSTRUCTION\n'.repeat(800);
const short = full.slice(0, 1024);
const values = new Map([
    ['draft:A', short],
    ['cm_editor_navigation:lump:A', JSON.stringify({source: full + '; session edit'})],
    ['church_editor_document_v1', JSON.stringify({owner: {type:'lump',id:'B'}, code:'unrelated'})],
    ['unrelated-secret', 'DO NOT READ'],
    ['church_editor_owner_draft_v1:' + encodeURIComponent(JSON.stringify({type:'lump',id:'A'})),
        JSON.stringify(full + '; important recovered change')],
]);
const read = {getItem(key) {assert.notEqual(key,'unrelated-secret'); return values.get(key) ?? null;}};
const context = {
    window: {_editorOpenLumpToken:'A', _editorOriginalDisasm:full,
        _editorNavigationBuffers:{'lump:A':{source:full+'; memory edit'}}},
    document: {getElementById: () => ({value: full})},
    localStorage:read, sessionStorage:read,
    _lumpTokenIdentity: value => String(value),
    _draftLsKey: token => 'draft:' + token, _LEGACY_DRAFT_LS_PREFIX:'legacy:',
    _lumpEditorDraftText:{A:full+'; inline edit'},
};
const before = JSON.stringify([...values]);
vm.runInNewContext(source.slice(source.indexOf('window._savedLumpDraftEvidence ='),
    source.indexOf('function _draftLsGet(')), context);
const report = context.window._savedLumpDraftEvidence();
assert.equal(report.errors.length,0);
assert.equal(report.copies.find(c=>c.origin==='persisted-lump-draft').characters,1024);
assert(report.copies.find(c=>c.origin==='owner-recovery').source.endsWith('; important recovered change'));
assert(report.copies.find(c=>c.origin==='navigation-memory').extendsPersistedDraft);
assert(!report.copies.some(c=>c.source==='unrelated'));
assert.equal(JSON.stringify([...values]),before);
assert.equal(context.window._editorOriginalDisasm,full);
console.log('PASS selected-LUMP draft evidence retains full copies, distinguishes 1024-character prefix, reads only scoped keys, writes nothing');
