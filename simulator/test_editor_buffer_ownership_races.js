'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function extractFunction(source, name) {
    let start = source.indexOf(`function ${name}(`);
    assert(start >= 0, `${name} exists`);
    if (source.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
    const brace = source.indexOf('{', start);
    let depth = 0;
    for (let i = brace; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`could not extract ${name}`);
}

async function fileExampleNavigationRace() {
    const source = fs.readFileSync('simulator/app-compile.js', 'utf8');
    const fn = extractFunction(source, 'loadCLOOMCExample');
    let release;
    const response = new Promise(resolve => { release = resolve; });
    const editor = { value: 'private draft bytes\r\nBFEXT DR1, DR2, pos=3, w=4' };
    let owner = { type: 'buffer', id: null };
    let ownershipClaims = 0;
    let epoch = 0;
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
    context.window._captureEditorWriteGuard = () => {
        const capturedEpoch = ++epoch;
        const capturedCode = editor.value;
        const capturedOwner = Object.assign({}, owner);
        return { accepts: () => capturedEpoch === epoch &&
            editor.value === capturedCode && owner.type === capturedOwner.type &&
            (owner.id || null) === (capturedOwner.id || null) };
    };
    vm.createContext(context);
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

async function delayedInlineSaveRace() {
    const source = fs.readFileSync('simulator/app-lumps.js', 'utf8');
    const openStart = source.indexOf('async function openLumpInEditor(token, options)');
    const openBody = source.slice(openStart);
    const capture = openBody.indexOf('var _openWriteGuard = window._captureEditorWriteGuard');
    const fetchPoint = openBody.indexOf("await fetch('/api/lump/' + token + '/words'");
    const finalGuard = openBody.indexOf('!_openWriteGuard.accepts()', fetchPoint);
    const ownershipExit = openBody.indexOf(
        'if (window._savedLumpEditorMode) exitSavedLumpEditorMode();');
    assert(capture >= 0 && capture < fetchPoint && fetchPoint < finalGuard &&
        finalGuard < ownershipExit,
    'saved-LUMP open verifies captured buffer and owner before ownership teardown');
    assert(source.includes('if (draftToken == null || frozenDocumentUnchanged) {\n' +
        '            window.LumpRegistry.setCurrent(resp.token);'),
    'delayed save completion cannot move source authority after navigation');

    const fn = extractFunction(source, '_saveLumpText');
    let release;
    const saveResponse = new Promise(resolve => { release = resolve; });
    const editor = { value: 'frozen bytes' };
    const status = { textContent: '', style: {} };
    const saveButton = { disabled: false };
    const body = {
        isConnected: true,
        querySelector(selector) {
            if (selector === '.lump-edit-textarea') return editor;
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
        _lumpSaveRequest: () => saveResponse,
        _lumpTokenIdentity: String,
        _lumpEditorOpen: {},
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
    await Promise.resolve();
    await Promise.resolve();
    editor.value = 'new bytes typed during save';
    release({ token: 'saved' });
    await pending;

    assert.equal(editor.value, 'new bytes typed during save');
    assert.equal(deleted, 0, 'newer draft must not be deleted');
    assert.equal(reloads, 0, 'delayed completion must not reload over newer text');
}

(async function() {
    await fileExampleNavigationRace();
    await delayedInlineSaveRace();
    console.log('PASS editor ownership survives async navigation and save races');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});