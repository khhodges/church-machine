'use strict';

// Regression coverage for the two-step Save LUMP snapshot boundary.  The
// save dialog must keep the editor/compiler pair selected when it opened even
// if focus or the current registry entry changes before confirmation.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');

function extractFunction(name) {
    let start = source.indexOf(`function ${name}(`);
    if (start >= 6 && source.slice(start - 6, start) === 'async ') start -= 6;
    if (start < 0) throw new Error(`missing ${name}`);
    let depth = 0;
    let end = -1;
    for (let i = start; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) {
            end = i + 1;
            break;
        }
    }
    if (end < 0) throw new Error(`unterminated ${name}`);
    return source.slice(start, end);
}

const context = {
    console,
    window: {
        _pendingLumpData: {
            binary: [0x1F000000, 0x12345678],
            caps: [{ name: 'New.CapTest', rights: ['E'], grants: ['E'] }],
            sourceText: 'method Main { RETURN }',
            selectedProfile: 'full',
            registeredAt: 101,
        },
        LumpRegistry: {
            getCurrent: () => 'old-token',
            resolve: () => ({
                sources: {
                    memory: {
                        words: [1, 2, 3],
                        capabilities: [{ name: 'New.CapTest', rights: ['E'], grants: ['E'] }],
                        registeredAt: 101,
                    },
                    server: { language: 'assembly' },
                },
            }),
        },
    },
    document: {
        getElementById: () => ({ value: 'stale live editor text' }),
    },
};

vm.createContext(context);
vm.runInContext(
    extractFunction('_cloneLumpSaveCapabilities') + '\n' +
    extractFunction('_captureLumpSaveSnapshot') +
    '\nthis.capture = _captureLumpSaveSnapshot;',
    context
);

const snapshot = context.capture();

if (snapshot.token !== 'old-token') throw new Error('snapshot lost current token');
if (snapshot.sourceText !== 'method Main { RETURN }') {
    throw new Error('pending source was replaced by the live editor buffer');
}
if (snapshot.words.join(',') !== '1,2,3') throw new Error('compiled words were not captured');
if (snapshot.registeredAt !== 101) throw new Error('registeredAt was not captured');
if (!snapshot.pending || snapshot.pending.binary[1] !== 0x12345678) {
    throw new Error('pending binary was not retained');
}

// Simulate focus/navigation after the dialog opened. The retained object must
// remain independent from registry and editor changes.
context.window.LumpRegistry.getCurrent = () => 'new-token';
context.window.LumpRegistry.resolve = () => ({
    sources: { memory: { words: [9], capabilities: [], registeredAt: 202 } },
});
context.window._pendingLumpData.sourceText = 'mutated later';
if (snapshot.token !== 'old-token' ||
    snapshot.sourceText !== 'method Main { RETURN }' ||
    snapshot.words.join(',') !== '1,2,3') {
    throw new Error('save snapshot changed after focus/navigation state changed');
}

// A pending Format dialog from an older compiled token must not supply source
// to a new direct Save-to-NS request. The active editor remains recoverable,
// but the stale binary/source handoff is discarded.
context.window._pendingLumpData = {
    token: 'old-token',
    registeredAt: 101,
    binary: [0x1F000000, 0xAAAAAAAA],
    sourceText: 'old source',
    selectedProfile: 'full',
};
const freshSnapshot = context.capture();
if (freshSnapshot.pending !== null ||
    freshSnapshot.sourceText !== 'stale live editor text') {
    throw new Error('stale pending Format snapshot crossed a registry-token change');
}

// API-only output has no submitted source frame, but the durable save payload
// must retain the independent compiler pair for diagnostics.
if (!source.includes('original_source: _saveSnapshot') ||
    !source.includes('original_compiled_words: _svWords.slice()') ||
    !source.includes('original_binary: _svBinary.slice()')) {
    throw new Error('API-only save path does not retain original compiler source/binary');
}
const compileSource = fs.readFileSync(path.join(__dirname, 'app-compile.js'), 'utf8');
const memorySource = fs.readFileSync(path.join(__dirname, 'app-memory.js'), 'utf8');
if (!compileSource.includes('original_source: source') ||
    !compileSource.includes('original_compiled_words: lumpWordsArray.slice()') ||
    memorySource.indexOf('metadata.original_source') >
        memorySource.indexOf('window._confirmLumpSavePlan(')) {
    throw new Error('compile or direct-memory entry point loses provenance before planning');
}

const preserved = [];
const diagnosticContext = {
    window: {
        _requestLumpSavePlan: async (binary, metadata) => {
            metadata.operation_id = 'diagnostic-op';
            preserved.push({ binary, metadata });
            return { plan_id: 'diagnostic-plan' };
        },
    },
    sessionStorage: { setItem: () => {} },
};
vm.createContext(diagnosticContext);
vm.runInContext(
    extractFunction('_preserveStaleLumpSaveDiagnostic') +
    '\nthis.preserve = _preserveStaleLumpSaveDiagnostic;',
    diagnosticContext
);
diagnosticContext.preserve({
    token: 'compiled-token',
    registeredAt: 55,
    sourceText: 'compiler source',
    editorSourceText: 'edited but not compiled',
    words: [11, 22],
    pending: { binary: [0xF8000400, 0], abstractionName: 'API.Only' },
}, 'API.Only').then(diagnostic => {
    if (preserved.length !== 1 ||
        preserved[0].metadata.original_source !== 'compiler source' ||
        preserved[0].metadata.divergent_editor_buffer !== 'edited but not compiled' ||
        preserved[0].metadata.original_compiled_words.join(',') !== '11,22' ||
        preserved[0].metadata.original_binary.join(',') !== `${0xF8000400},0` ||
        diagnostic.operation_id === undefined) {
        throw new Error('stale editor preservation did not retain both diagnostic sources');
    }
    const confirmBody = extractFunction('confirmSaveToNamespace');
    if (confirmBody.includes('smartCompile()')) {
        throw new Error('stale editor drift still auto-compiles and discards diagnostics');
    }
    const exactLoadContext = {
        fetch: () => { throw new Error('mutable token words endpoint was used'); },
        _lumpSha256Words: async words => words.join(',') === '9,10' ? 'a'.repeat(64) : '',
        sim: {
            nsLabels: {},
            loadLumpBinary: (words, slot) => words.join(',') === '9,10' && slot === 17,
        },
    };
    vm.createContext(exactLoadContext);
    vm.runInContext(
        extractFunction('_reloadCommittedLumpArtifact') +
        '\nthis.reload = _reloadCommittedLumpArtifact;',
        exactLoadContext
    );
    return exactLoadContext.reload({
        token: 'immutable-token',
        ns_slot: 17,
        digest: 'a'.repeat(64),
        final_binary: [9, 10],
    }, 'Exact.Load').then(words => {
        if (words.join(',') !== '9,10' || exactLoadContext.sim.nsLabels[17] !== 'Exact.Load') {
            throw new Error('committed final_binary was not loaded exactly into authoritative slot');
        }
        console.log('LUMP save snapshot regression: PASS');
    });
}).catch(error => {
    console.error(error);
    process.exit(1);
});