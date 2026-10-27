'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function extractFunction(source, name) {
    const match = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(source);
    assert(match, `${name} exists`);
    const closing = /^}/gm;
    closing.lastIndex = match.index;
    let end;
    while ((end = closing.exec(source))) {
        const candidate = source.slice(match.index, end.index + 1);
        try {
            new vm.Script(candidate);
            return candidate;
        } catch (error) {
            if (!(error instanceof SyntaxError)) throw error;
        }
    }
    throw new Error(`could not extract ${name}`);
}

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

function installGuards(context) {
    const shell = fs.readFileSync('simulator/app-shell.js', 'utf8');
    const start = shell.indexOf('window._advanceEditorNavigationEpoch = function(');
    const end = shell.indexOf('\nfunction loadUserTabs', start);
    assert(start >= 0 && end > start);
    vm.runInContext(shell.slice(start, end), context);
}

// No network or persistent browser storage is available in this VM. Only the
// named synthetic words requests below are accepted.
function lumpFixture() {
    const source = fs.readFileSync('simulator/app-lumps.js', 'utf8');
    const storage = new Map();
    const requests = new Map();
    const editor = { value: '\uFEFFAbstraction A\r\nBFEXT DR1, DR2, pos=3, w=4  \r\n' };
    const presentation = { token: 'aaaaaaaa', tab: 'History', text: 'A bytes' };
    const registered = [];
    const effects = [];
    const context = {
        console,
        _editorNavigationEpoch: 0,
        _editorOpenLumpToken: 'aaaaaaaa',
        _editorLumpDirtyToken: 'aaaaaaaa',
        _savedLumpEditorMode: true,
        _lumpEditorDraftText: {},
        document: { getElementById: id => id === 'asmEditor' ? editor : null },
        localStorage: {
            getItem: key => storage.has(key) ? storage.get(key) : null,
            setItem: (key, value) => storage.set(key, String(value)),
            removeItem: key => storage.delete(key),
        },
        sessionStorage: { removeItem() {} },
        fetch(url, options) {
            assert(/^\/api\/lump\/[ab]{8}\/words$/.test(url), `unexpected request ${url}`);
            assert.equal(options.cache, 'no-store');
            const request = deferred();
            requests.set(url, request);
            return request.promise;
        },
        LumpRegistry: {
            resolve: token => ({ sources: { server: { token, abstraction: token } } }),
            list: () => [],
            registerFromServer: rows => registered.push(...rows),
            evictMemory() {},
            setCurrent(token) { context.current = token; },
            setPending(token) { context.pending = token; },
        },
        current: 'aaaaaaaa',
        _preserveEditorNavigationBuffer() { effects.push('preserve'); throw new Error('fixture boundary'); },
        _showFpgaToast() { effects.push('toast'); },
        exitSavedLumpEditorMode() { effects.push('exit'); },
        _restoreSavedLumpEditorOwnership(token) {
            effects.push('restore');
            context._editorOpenLumpToken = token;
        },
        _fetchAndPresentCommittedLump(resp) {
            effects.push('present');
            presentation.token = resp.token;
        },
    };
    context.window = context;
    vm.createContext(context);
    installGuards(context);
    vm.runInContext(extractFunction(
        fs.readFileSync('simulator/app-run.js', 'utf8'), '_currentEditorOwner'), context);
    vm.runInContext("const _DRAFT_LS_PREFIX = 'cm_lump_draft_v2_';\n" +
        "const _LEGACY_DRAFT_LS_PREFIX = 'cm_lump_draft_';\n" +
        ['_lumpTokenIdentity', '_sameLumpToken', '_draftLsKey', '_draftLsGet',
            '_draftLsSet', '_draftLsDel', 'openLumpInEditor',
            '_commitSavedLumpClientState'].map(name => extractFunction(source, name)).join('\n'),
    context);
    function snapshotDraft() {
        const token = context._editorOpenLumpToken;
        context._draftLsSet(token, editor.value);
        context._lumpEditorDraftText[context._lumpTokenIdentity(token)] = editor.value;
        context.localStorage.setItem('church_editor_document_v1', JSON.stringify({
            owner: context._currentEditorOwner(), code: editor.value,
        }));
    }
    function change(kind) {
        if (kind === 'switch') {
            context._advanceEditorNavigationEpoch('select abstraction B');
            context._editorOpenLumpToken = 'bbbbbbbb';
            context._editorLumpDirtyToken = 'bbbbbbbb';
            context.current = 'bbbbbbbb';
        }
        // The edit-only case deliberately keeps its epoch: byte comparison
        // must protect drafts even without an input-event notification.
        editor.value = '\uFEFFnewer ' + kind + '\r\nBFINS DR7, DR8, pos=1, w=2  \r\n';
        Object.assign(presentation, { token: context.current, tab: 'Source', text: editor.value });
        snapshotDraft();
    }
    function state() {
        return JSON.stringify({
            text: editor.value, owner: context._currentEditorOwner(),
            dirtyToken: context._editorLumpDirtyToken,
            mode: context._savedLumpEditorMode, current: context.current,
            presentation, storage: [...storage], drafts: context._lumpEditorDraftText,
        });
    }
    return { context, editor, requests, effects, registered, change, state, snapshotDraft };
}

async function delayedLumpLoadRace(kind) {
    const fixture = lumpFixture();
    const { context, requests, effects } = fixture;
    const pending = context.openLumpInEditor('aaaaaaaa');
    assert.equal(requests.size, 1, 'open must actually reach the mocked words request');
    fixture.change(kind);
    const before = fixture.state();
    requests.get('/api/lump/aaaaaaaa/words').resolve({
        ok: true, json: async () => ({ words: [0xf8000000], source: 'obsolete A source' }),
    });
    await pending;
    assert.equal(fixture.state(), before, `${kind}: stale load preserves exact draft and presentation`);
    assert.deepEqual(effects, [], 'stale load must stop before preservation, teardown or presentation');
}

async function delayedSaveAcknowledgement(kind) {
    const fixture = lumpFixture();
    const { context, editor, effects, registered } = fixture;
    const frozen = {
        token: 'aaaaaaaa', source: editor.value, epoch: context._editorNavigationEpoch,
    };
    const response = deferred();
    const pending = response.promise.then(resp =>
        context._commitSavedLumpClientState(resp, {}, frozen));
    if (kind !== 'unchanged') fixture.change(kind);
    else fixture.snapshotDraft();
    const before = fixture.state();
    response.resolve({ token: 'cccccccc', abstraction: 'Fixture.A', binary_hash: 'private-hash' });
    await pending;
    assert.equal(registered.length, 1, 'acknowledged artifact remains discoverable');
    assert.equal(context.pending, 'cccccccc');
    if (kind === 'unchanged') {
        assert.equal(editor.value, frozen.source, 'successful save never rewrites source');
        assert.equal(context._editorOpenLumpToken, 'cccccccc');
        assert.equal(context.current, 'cccccccc');
        assert.equal(context._draftLsGet('aaaaaaaa'), null);
        assert.deepEqual(effects, ['restore', 'present'],
            'positive control: unchanged document can advance ownership and presentation');
    } else {
        assert.equal(fixture.state(), before, `${kind}: late save preserves newer document`);
        assert.deepEqual(effects, [], 'late save cannot rebind ownership or present older bytes');
    }
}

async function fileExampleNavigationRace() {
    const source = fs.readFileSync('simulator/app-compile.js', 'utf8');
    const fn = extractFunction(source, 'loadCLOOMCExample');
    let release;
    const response = new Promise(resolve => { release = resolve; });
    const editor = { value: 'private draft bytes\r\nBFEXT DR1, DR2, pos=3, w=4' };
    let owner = { type: 'buffer', id: null };
    let ownershipClaims = 0;
    const context = {
        window: {
            _CLOOMC_FILE_EXAMPLES: { private_fixture: '/private-fixture.cloomc' },
            _CLOOMC_FILE_LANGUAGES: { private_fixture: 'cloomc' },
        },
        _CLOOMC_FILE_EXAMPLES: { private_fixture: '/private-fixture.cloomc' },
        _CLOOMC_FILE_LANGUAGES: { private_fixture: 'cloomc' },
        document: { getElementById: id => id === 'asmEditor' ? editor : null },
        fetch: () => response,
        _currentEditorOwner: () => owner,
        _beginBuiltInEditorTransition: () => { ownershipClaims++; },
        _editorCREditActive: false,
        _editorCREditCR: null,
        _editorCREditNS: null,
        _updateEditorPatchBar() {},
        activeUserTabId: null,
        userTabDirty: false,
        clearPseudoEditContext() {},
        renderUserTabs() {},
        updateSaveUserTabBtn() {},
        console,
        Promise,
    };
    vm.createContext(context);
    installGuards(context);
    vm.runInContext(fn, context);
    context.loadCLOOMCExample('private_fixture');

    editor.value = 'typed while navigation pending\r\nBFINS DR7, DR8, pos=1, w=2';
    owner = { type: 'personal', id: 'private-tab' };
    release({ ok: true, text: () => Promise.resolve('server example') });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(editor.value,
        'typed while navigation pending\r\nBFINS DR7, DR8, pos=1, w=2');
    assert.equal(ownershipClaims, 0,
        'stale fetch completion must not claim editor ownership');
}

async function delayedInlineSaveRace(kind) {
    const source = fs.readFileSync('simulator/app-lumps.js', 'utf8');
    const fn = extractFunction(source, '_saveLumpText');
    let release;
    const saveResponse = new Promise(resolve => { release = resolve; });
    const saveStarted = deferred();
    const editor = { value: 'frozen bytes' };
    let visibleEditor = editor;
    const status = { textContent: '', style: {} };
    const saveButton = { disabled: false };
    const body = {
        isConnected: true,
        querySelector(selector) {
            if (selector === '.lump-edit-textarea') return visibleEditor;
            if (selector === '.lump-edit-status') return status;
            if (selector === '.lump-edit-save-btn') return saveButton;
            return null;
        },
    };
    let deleted = 0;
    let reloads = 0;
    const context = {
        TextEncoder,
        _packDataLumpWords: () => [1],
        _lumpApprovalView: () => ({}),
        _confirmLumpSavePlan: () => Promise.resolve({
            status: 'approved',
            intent: { intent: 'private' },
            plan: { plan_id: 'private' },
            final_binary: [1],
        }),
        _lumpSaveRequest: () => {
            saveStarted.resolve();
            return saveResponse;
        },
        _lumpTokenIdentity: String,
        _lumpEditorOpen: { private: true },
        _lumpEditorDraftText: { private: 'frozen bytes' },
        _draftLsDel: () => { deleted++; },
        _loadLumpContent: () => { reloads++; },
        _lumpEditDirty: true,
        setTimeout: fn => fn(),
        fetch() {},
        console,
    };
    vm.createContext(context);
    vm.runInContext(fn, context);
    const pending = context._saveLumpText('private', 'frozen bytes', body, {});
    await saveStarted.promise;
    const newerText = '\uFEFFnew bytes typed during save\r\n  ';
    if (kind === 'switch') visibleEditor = { value: newerText };
    else editor.value = newerText;
    context._lumpEditorDraftText.private = newerText;
    status.textContent = 'Newer document status';
    release({ token: 'saved' });
    await pending;

    assert.equal(visibleEditor.value, newerText);
    assert.equal(status.textContent, 'Newer document status');
    assert.equal(context._lumpEditorDraftText.private, newerText);
    assert.equal(context._lumpEditorOpen.private, true);
    assert.equal(context._lumpEditDirty, true);
    assert.equal(deleted, 0, 'newer draft must not be deleted');
    assert.equal(reloads, 0, 'delayed completion must not reload over newer text');
}

(async function() {
    for (const kind of ['switch', 'edit']) {
        await delayedLumpLoadRace(kind);
        await delayedSaveAcknowledgement(kind);
        await delayedInlineSaveRace(kind);
    }
    await delayedSaveAcknowledgement('unchanged');
    await fileExampleNavigationRace();
    console.log('PASS editor ownership survives async navigation and save races');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});