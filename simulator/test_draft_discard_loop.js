'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const source = fs.readFileSync(__dirname + '/app-lumps.js', 'utf8');
const helper = source.slice(source.indexOf('function _discardReviewedLumpDraft('),
    source.indexOf('\nfunction _isRestoredSavedLumpOwner('));
const start = source.indexOf("_bannerDiscardBtn.addEventListener('click', async function()");
const handler = source.slice(start, source.indexOf('\n            }\n        } else {', start));
function setup() {
    const store = new Map([['draft:A', 'recovery'], ['draft:B', 'other']]);
    const session = new Map([['cm_editor_navigation:lump:A', JSON.stringify({source:'recovery'})]]);
    const storage = map => ({
        getItem: key => map.has(key) ? map.get(key) : null,
        setItem: (key, value) => map.set(key, value),
        removeItem: key => map.delete(key),
    });
    const status = {setAttribute() {}};
    let callback;
    const context = {
        localStorage: storage(store), sessionStorage: storage(session),
        _draftLsKey: token => 'draft:' + token, _lumpTokenIdentity: token => token,
        _lumpEditorDraftText: {A:'recovery', B:'other'},
        _bannerDiscardBtn: {disabled:false, addEventListener: (_, fn) => callback = fn},
        _draftBanner: {querySelector: () => status, remove() {this.removed = true;}},
        token:'A', _savedDraft:'OLD BANNER TEXT', _recoveredSource:'saved',
        asmEd: {value:'saved', classList:{toggle(){}}},
        window: {
            _editorOpenLumpToken:'A', _editorNavigationEpoch:1,
            _editorNavigationBuffers:{'lump:A':{source:'recovery'}},
            _advanceEditorNavigationEpoch() {this._editorNavigationEpoch++;},
            confirmProtectedChange: async () => true,
        },
        saveEditorState() {store.set('reload', context.asmEd.value);},
        _setSavedLumpEditorSource(value) {context.asmEd.value = value;},
    };
    vm.runInNewContext(helper + '\n' + handler, context);
    return {context, store, session, status, click: () => callback()};
}
(async () => {
    let h = setup();
    await h.click();
    assert.equal(h.store.get('draft:A'), undefined, 'stale banner must review current copy, not loop');
    assert.equal(h.store.get('draft:B'), 'other');
    assert.equal(h.store.get('reload'), 'saved');
    assert.equal(h.session.size, 0);
    assert.equal(h.context._lumpEditorDraftText.A, undefined);
    assert.equal(h.context.window._editorNavigationBuffers['lump:A'], undefined);
    assert.equal(h.context._draftBanner.removed, true);
    // A reopened document uses persisted state, not the discarded snapshot.
    assert.equal(h.store.get('reload'), h.context._recoveredSource);

    h = setup();
    h.context.window.confirmProtectedChange = async () => false;
    await h.click();
    assert.equal(h.store.get('draft:A'), 'recovery');
    assert.equal(h.context._draftBanner.removed, undefined);

    h = setup();
    h.context.window.confirmProtectedChange = async () => {
        h.store.set('draft:A','newer'); return true;
    };
    await h.click();
    assert.equal(h.store.get('draft:A'), 'newer');
    assert.match(h.status.textContent, /changed during review/);
    h.context.window.confirmProtectedChange = async details => {
        assert.match(details.changes[0], /newer/); return true;
    };
    await h.click();
    assert.equal(h.store.get('draft:A'), undefined, 'retry must not use stale closure');

    for (const change of ['typing','navigation']) {
        h = setup();
        h.context.window.confirmProtectedChange = async () => {
            if (change === 'typing') h.context.asmEd.value = 'new typing';
            else h.context.window._editorOpenLumpToken = 'B';
            return true;
        };
        await h.click();
        assert.equal(h.store.get('draft:A'), 'recovery');
        assert.match(h.status.textContent, /editor changed/);
    }
    h = setup();
    h.context.asmEd.value = 'new independent editor text';
    await h.click();
    assert.equal(h.store.get('reload'), 'new independent editor text');
    h = setup();
    h.context.localStorage.removeItem = () => {};
    await h.click();
    assert.equal(h.context._draftBanner.removed, undefined);
    assert.match(h.status.textContent, /could not be deleted/);
    h = setup();
    h.store.delete('draft:A');
    h.context.window.confirmProtectedChange = () => {throw Error('unnecessary review');};
    await h.click();
    assert.equal(h.context._draftBanner.removed, true);
    h = setup();
    let finish;
    let reviews = 0;
    h.context.window.confirmProtectedChange = () => {reviews++; return new Promise(r => finish=r);};
    const first = h.click();
    await h.click();
    finish(true);
    await first;
    assert.equal(reviews, 1);
    console.log('PASS: discard stale banner, persistence, cancellation, races, failures and double-click');
})().catch(e => {console.error(e); process.exitCode=1;});