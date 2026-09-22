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

async function sourceFileRace() {
    const shell = fs.readFileSync('simulator/app-shell.js', 'utf8');
    const guardStart = shell.indexOf('window._advanceEditorNavigationEpoch = function(');
    const guardEnd = shell.indexOf('\n\nfunction loadUserTabs', guardStart);
    const editor = {
        value: '\uFEFFprivate\r\nbytes  ',
        readOnly: false,
        classList: { remove() {} },
        addEventListener() {},
        removeEventListener() {},
    };
    let owner = { type: 'personal', id: 'private-tab' };
    let release;
    const response = new Promise(resolve => { release = resolve; });
    let exits = 0;
    const context = {
        window: { exitSavedLumpEditorMode() { exits++; } },
        document: {
            getElementById: id => id === 'asmEditor' ? editor : null,
            querySelectorAll: () => [],
        },
        _currentEditorOwner: () => owner,
        closeOpenFileDialog() {},
        fetch: () => response,
        activeUserTabId: 'private-tab',
        userTabDirty: true,
        saveActiveUserTab() {},
        renderUserTabs() {},
        updateSaveUserTabBtn() {},
        setTimeout,
        console,
        Promise,
    };
    vm.createContext(context);
    vm.runInContext(shell.slice(guardStart, guardEnd) + '\n' +
        extractFunction(shell, 'openSourceFile'), context);
    context.openSourceFile('private-fixture.cloomc');
    editor.value = 'typed while file pending\r\n';
    owner = { type: 'buffer', id: null };
    release({ ok: true, text: () => Promise.resolve('remote bytes') });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(editor.value, 'typed while file pending\r\n');
    assert.equal(exits, 0, 'stale source response must not transfer ownership');
}

async function crossWriterAndAbaRaces() {
    const shell = fs.readFileSync('simulator/app-shell.js', 'utf8');
    const compile = fs.readFileSync('simulator/app-compile.js', 'utf8');
    const lumps = fs.readFileSync('simulator/app-lumps.js', 'utf8');
    const guardStart = shell.indexOf('window._advanceEditorNavigationEpoch = function(');
    const guardEnd = shell.indexOf('\n\nfunction loadUserTabs', guardStart);
    const editor = {
        value: 'private A bytes',
        readOnly: false,
        classList: { remove() {} },
    };
    const langSelector = { value: 'personal' };
    const pending = new Map();
    const deferred = url => new Promise(resolve => pending.set(url, resolve));
    const context = {
        window: {},
        document: {
            getElementById(id) {
                if (id === 'asmEditor') return editor;
                if (id === 'langSelector') return langSelector;
                return null;
            },
            querySelectorAll: () => [],
            querySelector: () => null,
        },
        fetch: url => deferred(url),
        userTabs: [
            { id: 'A', name: 'A', code: 'private A bytes', lang: 'assembly' },
            { id: 'B', name: 'B', code: 'private B bytes', lang: 'assembly' },
        ],
        activeUserTabId: 'A',
        userTabDirty: false,
        _currentEditorOwner() {
            return context.activeUserTabId
                ? { type: 'personal', id: context.activeUserTabId }
                : (context.window._activeBuiltInKey
                    ? { type: 'example', id: context.window._activeBuiltInKey }
                    : { type: 'buffer' });
        },
        _CLOOMC_FILE_EXAMPLES: { private_fixture: '/private-example.cloomc' },
        _CLOOMC_FILE_LANGUAGES: { private_fixture: 'cloomc' },
        closeOpenFileDialog() {},
        renderUserTabs() {},
        updateSaveUserTabBtn() {},
        updateSavePseudoBtn() {},
        updateLineNumbers() {},
        saveEditorState() {},
        saveActiveUserTab() {},
        clearPseudoEditContext() {},
        _updateEditorCodeName() {},
        _updateEditorPatchBar() {},
        _reconcileMissingRestoredLumpOwner: () => Promise.resolve(),
        _editorCREditActive: false,
        _editorCREditCR: null,
        _editorCREditNS: null,
        onLangChange() {},
        showIntro() {},
        setTimeout,
        console,
        Promise,
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(
        shell.slice(guardStart, guardEnd) + '\n' +
        extractFunction(shell, '_beginBuiltInEditorTransition') + '\n' +
        extractFunction(shell, 'openSourceFile') + '\n' +
        extractFunction(shell, 'selectUserTab') + '\n' +
        extractFunction(compile, 'loadCLOOMCExample') + '\n' +
        extractFunction(lumps, 'openLumpInEditor'),
        context);
    context.window.LumpRegistry = {
        resolve: () => null,
        list: () => [],
    };

    // A later saved-LUMP selection invalidates the earlier file writer through
    // the same epoch before either request completes.
    context.openSourceFile('private-before-lump.cloomc');
    context.openLumpInEditor('private-lump-token');
    pending.get('/private-before-lump.cloomc')({
        ok: true, text: () => Promise.resolve('stale before LUMP'),
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(editor.value, 'private A bytes',
        'actual LUMP navigation invalidates an earlier source-file writer');

    // Actual source-file and CLOOMC loaders race. The later CLOOMC intent wins
    // even when the older source-file response arrives last.
    context.openSourceFile('private-file.cloomc');
    context.loadCLOOMCExample('private_fixture');
    pending.get('/private-example.cloomc')({
        ok: true, text: () => Promise.resolve('private example result'),
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(editor.value, 'private example result');
    pending.get('/private-file.cloomc')({
        ok: true, text: () => Promise.resolve('stale file result'),
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(editor.value, 'private example result',
        'older writer cannot win after a later writer completed');

    // Actual personal-tab transitions produce A -> B -> A with A's exact
    // original owner and bytes. Epoch CAS must still reject the old request.
    context.activeUserTabId = 'A';
    context.window._activeBuiltInKey = null;
    editor.value = 'private A bytes';
    context.openSourceFile('private-aba.cloomc');
    context.selectUserTab('B');
    context.selectUserTab('A');
    assert.equal(editor.value, 'private A bytes');
    pending.get('/private-aba.cloomc')({
        ok: true, text: () => Promise.resolve('stale ABA result'),
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(editor.value, 'private A bytes',
        'A -> B -> A invalidates a request despite identical final owner/text');
}

function exactTabStartupAndCrContext() {
    const shell = fs.readFileSync('simulator/app-shell.js', 'utf8');
    const fixture = '\uFEFFBFEXT DR1, DR2, pos=03, w=04  \r\n';
    const storage = new Map([['church_user_tabs', JSON.stringify([{
        id: 'private-tab', name: 'Private', lang: 'assembly', code: fixture,
    }])]]);
    const context = {
        localStorage: {
            getItem: key => storage.has(key) ? storage.get(key) : null,
            setItem: (key, value) => storage.set(key, String(value)),
        },
        userTabs: [],
        saveUserTabsToStorage() {
            storage.set('church_user_tabs', JSON.stringify(context.userTabs));
        },
    };
    vm.createContext(context);
    vm.runInContext(extractFunction(shell, 'loadUserTabs'), context);
    context.loadUserTabs();
    assert.strictEqual(context.userTabs[0].code, fixture,
        'startup must preserve personal-tab source exactly');

    const cr = fs.readFileSync('simulator/app-cr-detail.js', 'utf8');
    assert(!extractFunction(cr, 'clearEditorCREdit').includes('asmEd.value ='),
        'leaving CR edit context must not clear the source owner buffer');
    const editor = { value: fixture };
    const crStorage = new Map([
        ['cm_asm_src_7', 'cached slot seven'],
        ['cm_sticky_p_7', '{"private":true}'],
    ]);
    const crContext = {
        document: { getElementById: () => editor },
        localStorage: {
            getItem: key => crStorage.has(key) ? crStorage.get(key) : null,
            setItem: (key, value) => crStorage.set(key, String(value)),
            removeItem: key => crStorage.delete(key),
        },
    };
    vm.createContext(crContext);
    vm.runInContext(
        'var _asmEditorNsIdx = null;\n' +
        extractFunction(cr, '_asmStickyKey') + '\n' +
        extractFunction(cr, '_asmSrcSwitchContext') + '\n' +
        extractFunction(cr, '_clearPersistedStickyPatch'),
        crContext);
    crContext._asmSrcSwitchContext(7);
    crContext._clearPersistedStickyPatch(7);
    assert.strictEqual(editor.value, fixture,
        'NS context and patch clearing must not replace the source owner buffer');
    assert.strictEqual(crStorage.get('cm_asm_src_7'), 'cached slot seven',
        'existing per-slot source cache remains recoverable');
    assert.equal(crStorage.has('cm_sticky_p_7'), false,
        'explicit patch-state clearing still clears patch state');
}

function allAsyncWritersUseGuard() {
    const misc = fs.readFileSync('simulator/app-misc.js', 'utf8');
    const abs = fs.readFileSync('simulator/app-absdetail.js', 'utf8');
    const importBody = extractFunction(misc, 'importFromLibrary');
    const generationBody = extractFunction(abs, 'absGenerateMethod');
    assert(importBody.includes('window._captureEditorWriteGuard(') &&
        importBody.indexOf('writeGuard.accepts()') < importBody.indexOf('editor.value = data.source'),
    'library import guards ownership before writing');
    assert(generationBody.includes('window._captureEditorWriteGuard(') &&
        generationBody.indexOf('writeGuard.accepts()') < generationBody.indexOf('asmEd.value = data.source'),
    'generated method guards ownership before writing');
}

(async function() {
    await sourceFileRace();
    await crossWriterAndAbaRaces();
    exactTabStartupAndCrContext();
    allAsyncWritersUseGuard();
    console.log('PASS async editor writers and NS context preserve source ownership');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});