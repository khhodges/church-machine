'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function section(file, start, end) {
    const source = fs.readFileSync(__dirname + '/' + file, 'utf8');
    const offset = source.indexOf(start);
    assert(offset >= 0);
    const finish = source.indexOf(end, offset + start.length);
    assert(finish > offset);
    return source.slice(offset, finish);
}

function harness(approved) {
    const editor = {value: 'private draft'};
    const effects = [];
    const context = {
        window: {confirmSourceReplacement: async () => approved,
            _captureEditorWriteGuard: () => ({accepts: () => true})},
        document: {getElementById: id => id === 'asmEditor' ? editor : null},
        userTabs: [{id: 'other', name: 'Other', code: 'other bytes'}],
        activeUserTabId: 'active', userTabDirty: true,
        _commitUserTabSelection: tab => { effects.push('select'); editor.value = tab.code; },
        saveUserTabsToStorage: () => effects.push('storage'),
        renderUserTabs: () => effects.push('render'),
        generateTabId: () => 'created',
        _openFileCache: null,
        closeOpenFileDialog: () => effects.push('close'),
        _catalogArg: JSON.parse,
        _catalogActiveIdentity: 'original',
        alert: error => { throw new Error(error); },
    };
    vm.createContext(context);
    vm.runInContext(section('app-shell.js', 'async function createUserTab(', 'async function deleteUserTab(') +
        section('app-shell.js', 'async function selectUserTab(', 'function _commitUserTabSelection(') +
        section('app-shell.js', 'async function openCatalogPersonal(', 'async function deleteCatalogPersonal('),
        context);
    return {context, editor, effects};
}

(async () => {
    let h = harness(false);
    assert.equal(await h.context.createUserTab('New', 'assembly', 'replacement'), null);
    assert.equal(h.context.userTabs.length, 1);
    assert.equal(await h.context.selectUserTab('other'), false);
    await h.context.openCatalogPersonal(JSON.stringify({id: 'other', path: 'personal/Other'}));
    assert.equal(h.context._catalogActiveIdentity, 'original');
    assert.equal(h.editor.value, 'private draft');
    assert.deepEqual(h.effects, [], 'reject preserves storage, navigation and editor');

    h = harness(true);
    assert.equal(await h.context.selectUserTab('other'), true);
    assert.equal(h.editor.value, 'other bytes');
    assert.deepEqual(h.effects, ['select']);

    h = harness(true);
    h.context.window.confirmSourceReplacement = async () => {
        h.context.userTabs[0].code = 'changed elsewhere';
        return true;
    };
    assert.equal(await h.context.selectUserTab('other'), false);
    assert.deepEqual(h.effects, [], 'tab bytes must still match approved replacement');

    h = harness(false);
    h.context.fetch = async () => ({ok: true, json: async () => ({source: 'library source'})});
    vm.runInContext(section('app-misc.js', 'async function importFromLibrary(', 'let docsLoaded'), h.context);
    await h.context.importFromLibrary('test-only');
    assert.equal(h.editor.value, 'private draft');
    assert.deepEqual(h.effects, []);

    h = harness(false);
    h.context.setDeviceLabel = async () => false;
    h.context.document.getElementById = () => { throw new Error('optimistic label update'); };
    vm.runInContext(section('app-misc.js', 'async function setDeviceLabelAndSync(', '\nfunction ',), h.context);
    await h.context.setDeviceLabelAndSync('test-only', 'rejected');
    console.log('Source replacement rejection and async UI tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });