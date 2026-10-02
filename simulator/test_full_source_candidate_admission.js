'use strict';

// Browser-free replay of the real authenticated compileAndBuild handoff:
// preliminary browser layout + server Full-source 8192-word artifact + a named
// unresolved dependency. This exercises candidate admission, not just helpers.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const CapabilityTokens = require('./capability_tokens.js');
const LumpContentFrame = require('./lump-content-frame.js');

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
const api = {
    name: 'FullSelfTest',
    capabilities: [
        { name: 'SELF', rights: ['E'], compiler_owned_self: true },
        { name: 'Next', rights: ['E'], N: 'example.Next#1',
            T: 'abcdef01', binary_hash: 'a'.repeat(64), identity_hash: 'b'.repeat(64) },
    ],
};
const apiBytes = Buffer.from(JSON.stringify(api));
signedWords[3] = (0xAB000000 | apiBytes.length) >>> 0;
LumpContentFrame.lumpFramePackBE([...apiBytes]).forEach((word, i) => {
    signedWords[4 + i] = word;
});
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
        { name: 'StaleBrowserName', rights: ['R'], grants: ['R'], nsIndex: 6 },
    ],
};
const elements = new Map([
    ['asmEditor', element(sourceText)],
    ['editorConsole', element()],
]);
let referenceEvidence = [];
let referenceFailure = null;
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
        materialize() { throw new Error('Compilation attempted destination materialization'); },
    },
    ChurchSimulator: { SELF_CAPABILITY_PLACEHOLDER: 0xFEED5E1F },
    LumpContentFrame: {
        ...LumpContentFrame,
        async lumpBuildContentFrame() { return { frameWords: [0xAB000001] }; },
    },
    sim: new Proxy({}, { get() { throw new Error('Compilation read live simulator state'); } }),
    bootEntrySlot: 6,
    _lumpsCache: [], _petNameDRMap: {}, _petNameCRMap: {},
    _simRunHash: null, _simRunHistory: [], _runStopped: false,
    _autoFillCapRights() { throw new Error('Compilation read catalog rights'); },
    _clearAsmErrors() {}, _clearAsmWarnings() {},
    _showAsmWarnings() {}, _showAsmErrors() {}, showNextSteps() {},
    _capRightsHTML(value) { return String(value || ''); },
    switchCodeTab() {}, _invalidateLastSavedToken() {},
    _getConsecutiveCleanRuns() { return 0; },
    _currentEditorHash() { return 'source-hash'; },
    lumpAudit() { return []; },
    _formatLumpApiDefinition() { return {}; },
    fetch: async function(url) {
        const payload = url === '/api/compile'
            ? referenceFailure || {
                ok: true, words: signedWords, compiler_record: signedRecord,
                trust_origin: 'trusted-home-ide', warnings: [],
                verified_references: referenceEvidence,
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
    extractBlock(source, 'function _formatCandidateReferenceReport('),
    extractBlock(source, 'function _isCompilerSelfCapability('),
    extractBlock(source, 'function _readCompiledCandidateCapabilities('),
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
    const candidate = context.window._lastCLOOMCLump;
    assert.equal(candidate.resolvedCaps[1].name, 'Next');
    assert.equal(candidate.resolvedCaps[1].rights.join(''), 'E');
    assert.equal(candidate.resolvedCaps[1].nsIndex, null);
    assert.equal(candidate.resolvedCaps[1].T, 'abcdef01');
    assert.equal(candidate.resolvedCaps[1].binary_hash, 'a'.repeat(64));
    assert.equal(context.window._lastCLOOMCResult.capabilities[1].name, 'Next');
    assert.equal(context.window._lastCLOOMCResult.capabilities[1].T, 'abcdef01');
    const expected = JSON.stringify(candidate);
    assert.match(elements.get('editorConsole').innerHTML, /UNVERIFIED/);
    referenceEvidence = [{...api.capabilities[1], row: 1}];
    assert.equal((await context.compileAndBuild()).ok, true);
    assert.match(elements.get('editorConsole').innerHTML, /VERIFIED — example.Next#1/);
    assert.deepEqual(context.window._lastCLOOMCLump.words, signedWords);
    referenceEvidence = [{...referenceEvidence[0], binary_hash: 'c'.repeat(64)}];
    assert.equal((await context.compileAndBuild()).ok, true);
    assert.match(elements.get('editorConsole').innerHTML, /UNVERIFIED/);
    referenceEvidence = [];
    const previous = context.window._lastCLOOMCLump;
    referenceFailure = {ok: false, reference_verification: {
        status: 'unsupported', reason: 'Archived bootstrap runtime-GT identity is unsupported',
    }};
    assert.equal((await context.compileAndBuild()).ok, false);
    assert.match(elements.get('editorConsole').textContent, /Reference verification: UNSUPPORTED/);
    assert.strictEqual(context.window._lastCLOOMCLump, previous);
    referenceFailure = null;
    const futureReference = [{name: 'FutureIdea', rights: ['E']}];
    const beforeFutureReport = JSON.stringify(futureReference);
    const futureReport = context._formatCandidateReferenceReport(futureReference, []);
    assert.match(futureReport, /SYMBOLIC — valid declared PetName; its target need not exist yet/);
    assert.doesNotMatch(futureReport, /UNPINNED|UNVERIFIED|INVALID/);
    assert.equal(JSON.stringify(futureReference), beforeFutureReport);
    assert.match(context._formatCandidateReferenceReport([], []), /No external references declared/);
    assert.match(context._formatCandidateReferenceReport([api.capabilities[0]], []), /SELF —/);
    const duplicate = {...api.capabilities[1], row: 0};
    assert.match(context._formatCandidateReferenceReport(
        [api.capabilities[1]], [duplicate, duplicate]), /UNVERIFIED/);
    for (const namespace of [{}, { nsLabels: {6: 'Wrong', 99: 'Next'} }]) {
        context.sim = namespace;
        assert.equal((await context.compileAndBuild()).ok, true);
        assert.equal(JSON.stringify(context.window._lastCLOOMCLump), expected);
    }
    // A missing definition must fail without borrowing browser declarations or
    // replacing the last candidate. No saved files or real simulator involved.
    const last = context.window._lastCLOOMCLump;
    signedWords[3] = 0;
    const rejected = await context.compileAndBuild();
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /embedded C-list definition/);
    assert.strictEqual(context.window._lastCLOOMCLump, last);
    signedWords[3] = (0xAB000000 | apiBytes.length) >>> 0;
    console.log('PASS full-source authenticated candidate admission with pending Next');
})().catch(error => {
    console.error(error);
    process.exit(1);
});