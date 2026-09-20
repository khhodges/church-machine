'use strict';

// Browser-free replay of the real authenticated compileAndBuild handoff:
// preliminary browser layout + server Full-source 8192-word artifact + a named
// unresolved dependency. This exercises candidate admission, not just helpers.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const CapabilityTokens = require('./capability_tokens.js');

function extractBlock(source, marker) {
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `missing ${marker}`);
    const brace = source.indexOf('{', start);
    let depth = 0;
    for (let i = brace; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`unterminated ${marker}`);
}

function element(value) {
    return {
        value: value || '', style: {}, className: '', textContent: '',
        scrollTop: 0, appendChild() {}, insertBefore() {}, querySelector() { return null; },
    };
}

const sourceText = 'abstraction FullSelfTest { capabilities { SELF E Next E } method Run { RETURN } }';
const codeWords = [0x11111111, 0x22222222];
const signedWords = new Array(8192).fill(0);
signedWords[0] = (((0x1F << 27) | (7 << 23) |
    (codeWords.length << 10) | 2) >>> 0);
signedWords[1] = codeWords[0];
signedWords[2] = codeWords[1];
signedWords[3] = 0xAB000001;
const signedRecord = {
    schema: 'church-compiler-output/v1',
    attestation: 'test-attestation',
    capability_rows: [
        {
            name: 'SELF', rights: ['E'], relocation_row: 0,
            compiler_owned_self: true, symbolic_self: true,
            pending_symbolic: false,
        },
        {
            name: 'Next', rights: ['E'], relocation_row: 1,
            compiler_owned_self: false, symbolic_self: false,
            pending_symbolic: true,
        },
    ],
};
const compileResult = {
    errors: [], warnings: [], language: 'javascript',
    abstractionName: 'FullSelfTest',
    portableMode: 'legacy',
    methods: [{ name: 'Run', code: codeWords.slice() }],
    capabilities: [
        {
            name: 'SELF', rights: ['E'], grants: ['E'],
            symbolic_self: true, compiler_owned_self: true, placeholder: true,
        },
        { name: 'Next', rights: ['E'], grants: ['E'] },
    ],
};
const elements = new Map([
    ['asmEditor', element(sourceText)],
    ['editorConsole', element()],
]);
const context = {
    console,
    window: {
        _computeLumpToken() { return 'deadbeef'; },
        LumpRegistry: {
            registerMemory() {}, setCurrent() {}, getCurrent() { return null; },
        },
    },
    document: {
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, element());
            return elements.get(id);
        },
        querySelector() { return null; },
    },
    localStorage: { getItem() { return null; } },
    cloomcCompiler: { compile() { return compileResult; } },
    _activeCompileClistSlots() { return {}; },
    _compileWithActiveClist() { return compileResult; },
    _compileCallApiBindings() { return []; },
    _sourceCallApiBindings() { return []; },
    CapabilityTokens: {
        ...CapabilityTokens,
        materialize(caps, words, start) {
            words[start] = 0xFEED5E1F;
            words[start + 1] = 0x12340001;
            return {
                ok: true, errors: [],
                resolvedCaps: caps.map(cap => ({ ...cap })),
            };
        },
    },
    ChurchSimulator: { SELF_CAPABILITY_PLACEHOLDER: 0xFEED5E1F },
    LumpContentFrame: {
        async lumpBuildContentFrame() { return { frameWords: [0xAB000001] }; },
    },
    sim: { running: false, nsLabels: {}, abstractionRegistry: { abstractions: {} } },
    _lumpsCache: [], _petNameDRMap: {}, _petNameCRMap: {},
    _simRunHash: null, _simRunHistory: [], _runStopped: false,
    _autoFillCapRights() {}, _clearAsmErrors() {}, _clearAsmWarnings() {},
    _showAsmWarnings() {}, _showAsmErrors() {}, showNextSteps() {},
    _capRightsHTML(value) { return String(value || ''); },
    switchCodeTab() {}, _invalidateLastSavedToken() {},
    _getConsecutiveCleanRuns() { return 0; },
    _currentEditorHash() { return 'source-hash'; },
    lumpAudit() { return []; },
    _formatLumpApiDefinition() { return {}; },
    fetch: async function(url) {
        const payload = url === '/api/compile'
            ? {
                ok: true, words: signedWords, compiler_record: signedRecord,
                trust_origin: 'trusted-home-ide', warnings: [],
            }
            : { ok: true, words: signedWords, compiler_record: signedRecord };
        return {
            ok: true, status: 200,
            headers: { get() { return 'application/json'; } },
            async json() { return payload; },
        };
    },
};
vm.createContext(context);
const source = fs.readFileSync(path.join(__dirname, 'app-compile.js'), 'utf8');
vm.runInContext([
    extractBlock(source, 'function _isCompilerSelfCapability('),
    extractBlock(source, 'function _validateCompiledCandidateClist('),
    extractBlock(source, 'function _deriveCompiledLumpLayout('),
    extractBlock(source, 'function _materializeLumpCapabilities('),
    extractBlock(source, 'async function _readCompileJsonResponse('),
    extractBlock(source, 'async function compileAndBuild('),
    'this.compileAndBuild = compileAndBuild;',
].join('\n'), context);

(async () => {
    const result = await context.compileAndBuild();
    assert.equal(result.ok, true, result.error);
    assert.equal(context.window._lastCLOOMCLump.words.length, 8192);
    assert.equal(context.window._lastCLOOMCLump.clistStart, 8190);
    assert.equal(context.window._lastCLOOMCLump.words[8191], 0,
        'authenticated pending Next row must remain unresolved');
    assert.deepEqual(context.window._lastCLOOMCLump.words, signedWords,
        'candidate admission must preserve exact signed words');
    console.log('PASS full-source authenticated candidate admission with pending Next');
})().catch(error => {
    console.error(error);
    process.exit(1);
});