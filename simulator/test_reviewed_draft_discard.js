'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('simulator/app-lumps.js', 'utf8');
function store() {
    const values = new Map();
    return {
        getItem: key => values.has(key) ? values.get(key) : null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key),
    };
}
const localStorage = store(), sessionStorage = store();
const window = { _editorNavigationBuffers: {} };
const drafts = {};
const context = vm.createContext({localStorage, sessionStorage, window,
    _lumpEditorDraftText: drafts, _lumpTokenIdentity: encodeURIComponent,
    _draftLsKey: token => 'draft:' + encodeURIComponent(token),
    _LEGACY_DRAFT_LS_PREFIX: 'legacy:'});
vm.runInContext(src.slice(src.indexOf('function _discardReviewedLumpDraft('),
    src.indexOf('function _isRestoredSavedLumpOwner(')), context);
const token = 'test/draft', reviewed = '\uFEFFold\r\n ', replacement = 'saved\n';
localStorage.setItem('draft:test%2Fdraft', reviewed);
localStorage.setItem('legacy:test/draft', reviewed);
localStorage.setItem('draft:unrelated', reviewed);
localStorage.setItem('church_editor_document_v1', JSON.stringify({
    owner: {type: 'lump', id: token}, code: reviewed, lang: 'assembly'}));
localStorage.setItem('church_editor_code', reviewed);
sessionStorage.setItem('cm_editor_navigation:lump:test%2Fdraft', JSON.stringify({source: reviewed}));
window._editorNavigationBuffers['lump:test%2Fdraft'] = {source: reviewed};
drafts['test%2Fdraft'] = reviewed;
context._discardReviewedLumpDraft(token, reviewed, replacement);
assert.equal(localStorage.getItem('draft:test%2Fdraft'), null);
assert.equal(localStorage.getItem('legacy:test/draft'), null);
assert.equal(localStorage.getItem('draft:unrelated'), reviewed);
assert.equal(JSON.parse(localStorage.getItem('church_editor_document_v1')).code, replacement);
assert.equal(localStorage.getItem('church_editor_code'), replacement);
assert.equal(sessionStorage.getItem('cm_editor_navigation:lump:test%2Fdraft'), null);
assert.equal(drafts['test%2Fdraft'], undefined);
assert.equal(window._editorNavigationBuffers['lump:test%2Fdraft'], undefined);
localStorage.setItem('draft:test%2Fdraft', 'new');
drafts['test%2Fdraft'] = 'new';
context._discardReviewedLumpDraft(token, reviewed, replacement);
assert.equal(localStorage.getItem('draft:test%2Fdraft'), 'new');
assert.equal(drafts['test%2Fdraft'], 'new');
localStorage.setItem('draft:test%2Fdraft', reviewed);
localStorage.removeItem = () => { throw new Error('storage denied'); };
assert.throws(() => context._discardReviewedLumpDraft(token, reviewed, replacement), /storage denied/);
assert.equal(localStorage.getItem('draft:test%2Fdraft'), reviewed);
console.log('PASS reviewed discard: exact bytes, all matching stores, newer/unrelated copies, storage failure');