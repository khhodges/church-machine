'use strict';

// Behavioral regression coverage for the two browser state-machine fixes.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const shell = fs.readFileSync(__dirname + '/app-shell.js', 'utf8');
const run = fs.readFileSync(__dirname + '/app-run.js', 'utf8');
function extract(source, name, next) {
    const start = source.indexOf('function ' + name);
    const end = source.indexOf('function ' + next, start);
    assert(start >= 0 && end > start, 'could not extract ' + name);
    return source.slice(start, end);
}

const storage = new Map();
const editor = { value: 'draft', parentNode: { parentNode: { insertBefore() {} } } };
const banner = { remove() {}, querySelectorAll() { return []; } };
const elements = {
    asmEditor: editor,
    langSelector: { value: 'cloomc' },
    _authoritativeDraftBanner: banner
};
const sandbox = {
    window: {},
    document: {
        getElementById(id) { return elements[id] || null; },
        querySelectorAll() { return []; }
    },
    localStorage: {
        getItem(k) { return storage.has(k) ? storage.get(k) : null; },
        setItem(k, v) { storage.set(k, String(v)); },
        removeItem(k) { storage.delete(k); }
    },
    encodeURIComponent,
    decodeURIComponent,
    Promise,
    fetch() { return new Promise(resolve => { sandbox.resolveFetch = resolve; }); },
    activeUserTabId: null,
    userTabDirty: false,
    renderUserTabs() {},
    updateSaveUserTabBtn() {},
    clearPseudoEditContext() {},
    exitSavedLumpEditorMode() {},
    saveActiveUserTab() {},
    updateLineNumbers() {}
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext("const _EDITOR_OWNER_DRAFT_PREFIX = 'church_editor_owner_draft_v1:';", sandbox);
vm.runInContext(extract(shell, '_beginBuiltInEditorTransition', 'showOpenFileDialog'), sandbox);
vm.runInContext(extract(run, '_currentEditorOwner', 'saveEditorState'), sandbox);
vm.runInContext(extract(run, '_editorOwnerDraftKey', '_clearAuthoritativeDraftBanner'), sandbox);
vm.runInContext(extract(run, '_readEditorOwnerDraft', '_writeEditorOwnerDraft'), sandbox);
vm.runInContext(extract(run, '_writeEditorOwnerDraft', '_clearEditorOwnerDraft'), sandbox);
vm.runInContext(extract(run, '_clearEditorOwnerDraft', '_clearAuthoritativeDraftBanner'), sandbox);
vm.runInContext(extract(run, 'saveEditorState', '_readEditorDocumentState'), sandbox);
vm.runInContext(extract(run, '_clearAuthoritativeDraftBanner', '_clearEditorOwnerMarkers'), sandbox);
vm.runInContext(extract(run, '_reconcileAuthoritativeEditor', 'showCreateNamespace'), sandbox);

// A built-in handoff invalidates every previous Save File destination.
sandbox._editorSourceFilePath = 'server/old.cloomc';
sandbox._editorOpenLumpToken = '0xold';
sandbox.activeUserTabId = 'personal-1';
sandbox._beginBuiltInEditorTransition();
assert.strictEqual(sandbox._editorSourceFilePath, null);
assert.strictEqual(sandbox._editorOpenLumpToken, null);
assert.strictEqual(sandbox.activeUserTabId, null);

// A pending authority response must not win after an owner switch.
sandbox._editorSourceFilePath = 'server/current.cloomc';
sandbox._reconcileAuthoritativeEditor(
    { type: 'source', id: 'server/current.cloomc' }, 'draft', editor);
sandbox._editorSourceFilePath = 'server/other.cloomc';
sandbox.resolveFetch({ ok: true, text: () => Promise.resolve('authoritative') });
setImmediate(() => {
    assert.strictEqual(editor.value, 'draft');
    assert.strictEqual(storage.has('church_editor_owner_draft_v1:' +
        encodeURIComponent(JSON.stringify({ type: 'source', id: 'server/current.cloomc' }))), false);
    // A response for the still-current owner persists its divergent draft
    // under that owner, so a crash/reload can offer Restore Draft.
    sandbox._editorSourceFilePath = 'server/current.cloomc';
    sandbox._reconcileAuthoritativeEditor(
        { type: 'source', id: 'server/current.cloomc' }, 'draft', editor);
    sandbox.resolveFetch({ ok: true, text: () => Promise.resolve('authoritative') });
    setImmediate(() => {
        const key = 'church_editor_owner_draft_v1:' +
            encodeURIComponent(JSON.stringify({ type: 'source', id: 'server/current.cloomc' }));
        assert.strictEqual(JSON.parse(storage.get(key)), 'draft');
        assert.strictEqual(sandbox._readEditorOwnerDraft(
            { type: 'source', id: 'server/current.cloomc' }), 'draft');
        console.log('Owner transition/reconciliation behavior: PASS');
    });
});