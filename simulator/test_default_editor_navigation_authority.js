'use strict';

// A delayed startup/default resolution must not overwrite a newer explicit
// Namespace → Open LUMP navigation.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync('simulator/app-run.js', 'utf8');

function extractFunction(name) {
    const start = source.indexOf(`function ${name}(`);
    assert(start >= 0, `${name} exists`);
    const brace = source.indexOf('{', start);
    let depth = 0;
    for (let i = brace; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}' && --depth === 0) {
            return source.slice(start, i + 1);
        }
    }
    throw new Error(`Could not extract ${name}`);
}

let releaseCatalog;
const catalogDelay = new Promise(resolve => { releaseCatalog = resolve; });
const opened = [];
const windowObject = {
    _savedLumpOpenRequestId: 0,
    _startupDefaultView: 'editor',
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
    extractFunction('_configuredBootLumpToken') + '\n' +
    extractFunction('_openConfiguredBootLumpInDefaultEditor'),
    context
);

(async function() {
    const defaultOpen = context._openConfiguredBootLumpInDefaultEditor();

    // Namespace navigation claims ownership while default catalog loading is
    // still pending.
    await context.openLumpInEditor('namespace-token');
    releaseCatalog();

    assert.equal(await defaultOpen, false);
    assert.deepEqual(opened, ['namespace-token']);
    console.log('PASS explicit Namespace navigation outranks delayed default editor open');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});