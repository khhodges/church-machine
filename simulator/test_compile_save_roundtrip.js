'use strict';

// Browser-free behavioral regression for the editor's compile → hamburger Save
// handoff.  Compile approval is deliberately cancelled; the compiled
// instruction/source pair must remain registered so the real Save Lump entry
// point can build a candidate whose header cw is the code length, not the
// allocated LUMP size.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function extractBlock(source, marker) {
    const start = source.indexOf(marker);
    if (start < 0) throw new Error(`missing ${marker}`);
    const brace = source.indexOf('{', start);
    if (brace < 0) throw new Error(`missing body for ${marker}`);
    let depth = 0;
    for (let i = brace; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) {
            return source.slice(start, i + 1);
        }
    }
    throw new Error(`unterminated ${marker}`);
}

function makeElement(id) {
    return {
        id,
        value: '',
        style: {},
        className: '',
        textContent: '',
        innerHTML: '',
        scrollTop: 0,
        firstChild: null,
        insertBefore() {},
        appendChild() {},
        removeChild() {},
        querySelector() { return null; },
    };
}

const compileSource = fs.readFileSync(
    path.join(__dirname, 'app-compile.js'), 'utf8');
const lumpsSource = fs.readFileSync(
    path.join(__dirname, 'app-lumps.js'), 'utf8');
const editorSource = fs.readFileSync(
    path.join(__dirname, 'app-lump-editor.js'), 'utf8');
const registrySource = fs.readFileSync(
    path.join(__dirname, 'lump-registry.js'), 'utf8');

const sourceText = 'abstraction Task3430RoundTrip { method Ping() { return(3430) } }';
const codeWords = [0x11111111, 0x22222222];
const elements = new Map();
const asmEditor = makeElement('asmEditor');
asmEditor.value = sourceText;
elements.set('asmEditor', asmEditor);
elements.set('editorConsole', makeElement('editorConsole'));
elements.set('langSelector', makeElement('langSelector'));
elements.get('langSelector').value = 'javascript';
elements.set('formatLumpDialog', makeElement('formatLumpDialog'));
elements.get('formatLumpDialog').querySelector = () => null;

const localValues = new Map();
const context = {
    console,
    window: {},
    document: {
        activeElement: null,
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, makeElement(id));
            return elements.get(id);
        },
        addEventListener() {},
        removeEventListener() {},
    },
    localStorage: {
        getItem(key) { return localValues.get(key) || null; },
        setItem(key, value) { localValues.set(key, String(value)); },
        removeItem(key) { localValues.delete(key); },
    },
    cloomcCompiler: {
        compile() {
            return {
                errors: [],
                warnings: [],
                methods: [{ name: 'Ping', code: codeWords.slice() }],
                abstractionName: 'Task3430RoundTrip',
                capabilities: [{
                    name: '__SELF__',
                    rights: ['E'],
                    grants: ['E'],
                    compiler_owned_self: true,
                    placeholder: true,
                }],
                language: 'javascript',
                portableMode: 'legacy',
            };
        },
    },
    sim: {
        running: false,
        bootEntrySlot: -1,
        nsLabels: {},
        abstractionRegistry: { abstractions: {} },
    },
    CapabilityTokens: {
        isContextualSelf(cap) {
            return !!cap && (cap.name === 'SELF' || cap.name === '__SELF__');
        },
        materialize(caps) {
            return {
                ok: true,
                errors: [],
                resolvedCaps: caps.map(cap => Object.assign({}, cap)),
            };
        },
        validateClist() { return { ok: true, errors: [] }; },
    },
    ChurchSimulator: { SELF_CAPABILITY_PLACEHOLDER: 0xFEED5E1F },
    LumpContentFrame: {
        async lumpBuildContentFrame() { return { frameWords: [] }; },
    },
    _lumpsCache: [],
    _petNameDRMap: {},
    _petNameCRMap: {},
    _simRunHash: null,
    _simRunHistory: [],
    _runStopped: false,
    _compileDraftToken: null,
    _autoFillCapRights() {},
    requirePermission() { return true; },
    onLangChange() {},
    _clearAsmErrors() {},
    _clearAsmWarnings() {},
    _showAsmWarnings() {},
    _showAsmErrors() {},
    showNextSteps() {},
    switchCodeTab() {},
    _invalidateLastSavedToken() {},
    _getConsecutiveCleanRuns() { return 0; },
    _currentEditorHash() { return 'editor-hash'; },
    appendOutput() {},
    lumpAudit() { return []; },
    lumpAuditHasErrors() { return false; },
    lumpAuditHasWarnings() { return false; },
    alert() {},
    _makeModalFocusTrap() { return function() {}; },
    _formatLumpApiDefinition() { return {}; },
    _renderFormatLumpCandidate() {},
    _renderFormatLumpVersionHistory() {},
    _closeFormatLumpDialog() {},
    _fmtEscape(value) { return String(value); },
    _formatLumpTrap: null,
    _formatLumpTrigger: null,
};
vm.createContext(context);

// Use the production registry and canonical token helper rather than a test
// double.  The save-plan callback is the only intentionally cancelled piece.
vm.runInContext(registrySource, context);
vm.runInContext(
    extractBlock(editorSource, 'function packHdr(') + '\n' +
    extractBlock(editorSource, 'window._computeLumpToken = function') + ';',
    context);
context.window._confirmLumpSavePlan = async function() {
    context.confirmationCount = (context.confirmationCount || 0) + 1;
    return null;
};
const saveDiagnosticEvents = [];
context.window.LumpSaveDiagnostics = {
    begin() { saveDiagnosticEvents.push('begin'); },
    record() { saveDiagnosticEvents.push('record'); },
    stageException() { saveDiagnosticEvents.push('exception'); },
};

vm.runInContext(
    extractBlock(compileSource, 'function _isCompilerSelfCapability(') + '\n' +
    extractBlock(compileSource, 'function _materializeLumpCapabilities(') + '\n' +
    extractBlock(compileSource, 'async function compileAndBuild(') + '\n' +
    extractBlock(compileSource, 'function smartCompile(') +
    '\nthis.compileAndBuild = compileAndBuild;\nthis.smartCompile = smartCompile;',
    context);

(async () => {
    await context.compileAndBuild();

    assert.strictEqual(context.confirmationCount, 1,
        'compile did not reach the cancellable save-plan approval');
    const token = context.window.LumpRegistry.getCurrent();
    const entry = context.window.LumpRegistry.resolve(token);
    const memory = entry && entry.sources && entry.sources.memory;
    assert(memory, 'cancelled compile did not retain its registry source');
    assert.deepStrictEqual(Array.from(memory.words), codeWords,
        'registry retained the allocated candidate instead of code words');
    assert.deepStrictEqual(memory.sourceText, sourceText,
        'registry lost the exact compiler source pairing');
    assert.strictEqual(
        context.window._lastCLOOMCLump.words.length,
        64,
        'compiler candidate should retain its allocated binary separately');

    // Simulate a saved artifact being evicted from memory.  The real
    // hamburger Save handler must recompile, then continue into Format Lump;
    // it must not start a second save-plan approval or commit automatically.
    context.window.LumpRegistry.evictMemory(token);
    assert.strictEqual(
        context.window.LumpRegistry.resolve(token),
        null,
        'saved LUMP eviction did not remove the stale in-memory source');

    // Exercise the actual hamburger Save Lump handler and its real formatter.
    vm.runInContext(
        extractBlock(lumpsSource, 'window.showFormatLump = async function') + ';' +
        extractBlock(lumpsSource, 'window.editorSaveLump = function') + '\n' +
        'this.showFormatLump = window.showFormatLump;',
        context);
    await context.window.editorSaveLump();
    assert.deepStrictEqual(saveDiagnosticEvents.slice(0, 2), ['begin', 'record'],
        'hamburger Save click was not diagnosed before compile branching');
    assert.strictEqual(context.confirmationCount, 1,
        'Save-request compilation unexpectedly started an automatic save plan');

    const pending = context.window._pendingLumpData;
    assert(pending && pending.candidates && pending.candidates.full,
        'hamburger Save Lump did not build a candidate after cancellation');
    assert.deepStrictEqual(Array.from(pending.words), codeWords,
        'save snapshot changed the exact compiler code words');
    const header = pending.candidates.full.binary[0] >>> 0;
    const headerCw = (header >>> 10) & 0x1FFF;
    assert.strictEqual(headerCw, codeWords.length,
        'hamburger Save Lump header cw used allocation size instead of code size');
    assert.deepStrictEqual(
        Array.from(pending.candidates.full.binary.slice(1, 1 + codeWords.length)),
        codeWords,
        'hamburger Save Lump changed the exact code words in its candidate');

    console.log('compile cancel → hamburger Save cw regression: PASS');
})().catch(error => {
    console.error(error);
    process.exit(1);
});