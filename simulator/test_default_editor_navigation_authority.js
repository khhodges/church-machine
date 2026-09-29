'use strict';

// A delayed startup/default resolution must not overwrite a newer explicit
// Namespace → Open LUMP navigation.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync('simulator/app-run.js', 'utf8');
const shellSource = fs.readFileSync('simulator/app-shell.js', 'utf8');
const compileSource = fs.readFileSync('simulator/app-compile.js', 'utf8');

function extractFunction(name, fileSource = source) {
    const match = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(fileSource);
    assert(match, `${name} exists`);
    // Source examples embed assembly template literals with bare braces.
    // Only accept a column-zero closing brace if the JavaScript parser sees
    // the whole isolated function as complete, without evaluating it.
    const closing = /^}/gm;
    closing.lastIndex = match.index;
    let end;
    while ((end = closing.exec(fileSource))) {
        const candidate = fileSource.slice(match.index, end.index + 1);
        try {
            new vm.Script(candidate);
            return candidate;
        } catch (error) {
            if (!(error instanceof SyntaxError)) throw error;
        }
    }
    throw new Error(`Could not extract ${name}`);
}

async function explicitTransitionDuringStartup(transitionName, transition) {
    let releaseStartupCatalog;
    const startupCatalog = new Promise(resolve => { releaseStartupCatalog = resolve; });
    const editor = {
        value: 'private startup buffer',
        readOnly: false,
        classList: { remove() {} },
    };
    const selector = { value: 'personal' };
    const openedDefaults = [];
    const pendingDocumentFetch = new Promise(() => {});
    const race = {
        _savedLumpOpenRequestId: 0,
        _editorNavigationEpoch: 0,
        _startupDefaultView: 'editor',
        _editorStateHydrated: true,
        _editorRestoredDocumentPresent: false,
        _editorStartupBufferDirty: false,
        _activeBuiltInKey: null,
        _editorSourceFilePath: null,
        _editorOpenLumpToken: null,
        _pseudoEditContext: null,
        currentView: 'editor',
        sim: {},
        activeUserTabId: null,
        userTabDirty: false,
        userTabs: [{
            id: 'private-tab',
            name: 'Private tab',
            code: 'private personal bytes',
            lang: 'assembly',
        }],
        LumpRegistry: {
            isServerListFetched: () => false,
            warmServerList: () => startupCatalog,
            getServerList: () => [{
                token: 'default-token',
                abstraction: 'CapabilityTest',
                ns_slot: 10,
                boot_resident: true,
            }],
        },
        document: {
            getElementById(id) {
                if (id === 'asmEditor') return editor;
                if (id === 'langSelector') return selector;
                return null;
            },
            querySelectorAll: () => [],
            querySelector: () => null,
            createElement: () => ({ style: {}, appendChild() {} }),
        },
        fetch(url) {
            if (url === '/private-source.cloomc' ||
                    url === '/private-example.cloomc') {
                return pendingDocumentFetch;
            }
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve(url.includes('boot-config')
                    ? { lumpCatalog: [{
                        token: 'default-token',
                        abstraction: 'CapabilityTest',
                        nsSlot: 10,
                        loadPolicy: 'Resident',
                    }] }
                    : { abstractions: [{ slot: 10, boot: true }] }),
            });
        },
        openLumpInEditor(token, options) {
            if (options && options.startupDefault === true) {
                openedDefaults.push(token);
            }
            return Promise.resolve();
        },
        closeOpenFileDialog() {},
        saveActiveUserTab() {},
        confirmSourceReplacement: () => Promise.resolve(true),
        renderUserTabs() {},
        updateSaveUserTabBtn() {},
        updateSavePseudoBtn() {},
        updateLineNumbers() {},
        saveEditorState() {},
        clearPseudoEditContext() {},
        _updateEditorCodeName() {},
        _updateEditorPatchBar() {},
        _invalidateLastSavedToken() {},
        _refreshEditorJumpLinks() {},
        onLangChange() {},
        showIntro() {},
        _editorCREditActive: false,
        _editorCREditCR: null,
        _editorCREditNS: null,
        _CLOOMC_FILE_EXAMPLES: {
            private_fixture: '/private-example.cloomc',
        },
        _CLOOMC_FILE_LANGUAGES: { private_fixture: 'cloomc' },
        Promise,
        console,
        setTimeout,
    };
    race.window = race;
    vm.createContext(race);
    const guardStart = shellSource.indexOf(
        'window._advanceEditorNavigationEpoch = function(');
    const guardEnd = shellSource.indexOf('\n\nfunction loadUserTabs', guardStart);
    vm.runInContext(
        guardStart >= 0 ? shellSource.slice(guardStart, guardEnd) : '',
        race
    );
    vm.runInContext(
        extractFunction('_currentEditorOwner') + '\n' +
        extractFunction('_configuredBootLumpToken') + '\n' +
        extractFunction('_openConfiguredBootLumpInDefaultEditor') + '\n' +
        extractFunction('_beginBuiltInEditorTransition', shellSource) + '\n' +
        extractFunction('_commitUserTabSelection', shellSource) + '\n' +
        extractFunction('selectUserTab', shellSource) + '\n' +
        extractFunction('openSourceFile', shellSource) + '\n' +
        extractFunction('loadExample') + '\n' +
        extractFunction('loadCLOOMCExample', compileSource),
        race
    );
    vm.runInContext('const _TURING_DR_TEST_SOURCE = "";', race);

    const defaultOpen = race._openConfiguredBootLumpInDefaultEditor();
    transition(race);
    // Let an approved personal-tab confirmation commit; do not await a source
    // fetch deliberately left pending to exercise navigation-intent ownership.
    await Promise.resolve();
    releaseStartupCatalog();
    assert.equal(await defaultOpen, false,
        `${transitionName} invalidates the pending startup default`);
    assert.deepEqual(openedDefaults, [],
        `${transitionName} prevents the startup LUMP open`);
}

let releaseCatalog;
const catalogDelay = new Promise(resolve => { releaseCatalog = resolve; });
const opened = [];
const windowObject = {
    _savedLumpOpenRequestId: 0,
    _startupDefaultView: 'editor',
    _editorStateHydrated: true,
    _editorRestoredDocumentPresent: false,
    LumpRegistry: {
        isServerListFetched: () => false,
        warmServerList: () => catalogDelay,
        getServerList: () => [{
            token: 'default-token',
            abstraction: 'CapabilityTest',
            ns_slot: 10,
            boot_resident: true,
        }],
    },
};

const context = {
    window: windowObject,
    document: {
        getElementById: id => id === 'asmEditor' ? { value: '' } : null,
    },
    currentView: 'editor',
    sim: {},
    activeUserTabId: null,
    openLumpInEditor: (token, options) => {
        if (!(options && options.startupDefault === true)) {
            windowObject._explicitEditorNavigationClaimed = true;
        }
        windowObject._savedLumpOpenRequestId++;
        opened.push(token);
        return Promise.resolve();
    },
    fetch: url => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(url.includes('boot-config')
            ? { lumpCatalog: [{
                token: 'default-token',
                abstraction: 'CapabilityTest',
                nsSlot: 10,
                loadPolicy: 'Resident',
            }] }
            : { abstractions: [{ slot: 10, boot: true }] }),
    }),
    Promise,
    console,
};

vm.createContext(context);
vm.runInContext(
    extractFunction('_currentEditorOwner') + '\n' +
    extractFunction('_configuredBootLumpToken') + '\n' +
    extractFunction('_openConfiguredBootLumpInDefaultEditor'),
    context
);

(async function() {
    // The scheduler may fire before DOMContentLoaded restores storage. It must
    // wait, and a hydrated generic/private snapshot remains protected even
    // though it has no source-file, personal-tab, or LUMP identity.
    windowObject._editorStateHydrated = false;
    assert.equal(await context._openConfiguredBootLumpInDefaultEditor(), false);
    windowObject._editorStateHydrated = true;
    windowObject._editorRestoredDocumentPresent = true;
    assert.equal(await context._openConfiguredBootLumpInDefaultEditor(), false);
    assert.deepEqual(opened, []);
    windowObject._editorOpenLumpToken = 'selected-selftest';
    assert.equal(await context._openConfiguredBootLumpInDefaultEditor(), false,
        'restored SelfTest selection is never replaced by startup boot entry');
    windowObject._editorOpenLumpToken = null;
    windowObject._editorRestoredDocumentPresent = false;

    const defaultOpen = context._openConfiguredBootLumpInDefaultEditor();

    // Namespace navigation claims ownership while default catalog loading is
    // still pending.
    await context.openLumpInEditor('namespace-token');
    releaseCatalog();

    assert.equal(await defaultOpen, false);
    assert.deepEqual(opened, ['namespace-token']);
    await explicitTransitionDuringStartup('personal-tab selection',
        race => race.selectUserTab('private-tab'));
    await explicitTransitionDuringStartup('source-file selection',
        race => race.openSourceFile('private-source.cloomc'));
    await explicitTransitionDuringStartup('built-in selection',
        race => race.loadExample('ada_note_g'));
    await explicitTransitionDuringStartup('CLOOMC example selection',
        race => race.loadCLOOMCExample('private_fixture'));
    console.log('PASS explicit editor transitions outrank delayed default editor open');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});