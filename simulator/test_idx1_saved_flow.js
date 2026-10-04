'use strict';

// Disposable memory and DOM-only stubs. Real compiler, format/content-frame,
// snapshot, envelope validation and saved-LUMP load/admission functions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const Simulator = require('./simulator.js');
const Assembler = require('./assembler.js');
const IDE = require('./idx1-ide.js');
const Runtime = require('./idx1-runtime.js');
const CapabilityTokens = require('./capability_tokens.js');
const LumpContentFrame = require('./lump-content-frame.js');
const lumps = fs.readFileSync(__dirname + '/app-lumps.js', 'utf8');
const run = fs.readFileSync(__dirname + '/app-run.js', 'utf8');
function extract(text, name) {
    const start = text.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
    assert(start >= 0, name);
    const rest = text.slice(start);
    const next = rest.slice(rest.indexOf('\n') + 1).search(/^(?:async )?function \w+\(/m);
    return next < 0 ? rest : rest.slice(0, rest.indexOf('\n') + 1 + next);
}
function hash(words) {
    const bytes = Buffer.alloc(words.length * 4);
    words.forEach((word, i) => bytes.writeUInt32BE(word >>> 0, i * 4));
    return crypto.createHash('sha256').update(bytes).digest('hex');
}
async function progressRace() {
    let progress;
    const elements = Object.fromEntries(['saveNSStatus', 'saveNSConfirmBtn', 'saveNSCancelBtn', 'saveNSDialog']
        .map(id => [id, { style: {}, dataset: {}, setAttribute() {}, focus() {} }]));
    const context = {
        window: {}, console, document: { getElementById: id => elements[id] || null },
        setTimeout: callback => { progress = callback; return 1; }, clearTimeout() {},
        closeSaveDialog() {}, _formatLumpSavePlan: () => 'Review the exact prepared snapshot',
    };
    vm.createContext(context);
    elements.saveNSInfo = {};
    context.window._saveNSPreparedSnapshot = { words: [1, 2, 3, 4, 5] };
    const sizeStart = run.indexOf("    const info = document.getElementById('saveNSInfo');");
    vm.runInContext(run.slice(sizeStart, run.indexOf("    _setSaveNSFeedback", sizeStart)), context);
    assert.equal(elements.saveNSInfo.textContent, 'Code size: 5 words (20 bytes)');
    vm.runInContext('let _saveNSRequestInFlight = false;\n' +
        extract(run, '_setSaveNSFeedback') + extract(run, '_confirmSavePlanInDialog') +
        extract(run, 'beginSaveToNamespace'), context);
    context.confirmSaveToNamespace = () => context._confirmSavePlanInDialog({});
    const pending = context.beginSaveToNamespace();
    assert.equal(elements.saveNSConfirmBtn.textContent, 'Approve & Save');
    progress(); // Fast prepare completed before the delayed progress update.
    assert.equal(elements.saveNSConfirmBtn.disabled, false);
    assert.equal(elements.saveNSStatus.textContent, 'Review the exact prepared snapshot');
    elements.saveNSConfirmBtn.onclick();
    await pending;
    context.AbortSignal = { timeout: ms => { assert.equal(ms, 30000); return 'bounded-plan'; } };
    context.fetch = async (url, options) => {
        assert.equal(options.signal, 'bounded-plan');
        const error = new Error('timed out'); error.name = 'TimeoutError'; throw error;
    };
    vm.runInContext(extract(lumps, '_artifactOnlyLumpSaveMetadata') +
        extract(lumps, '_requestLumpSavePlan'), context);
    await assert.rejects(context._requestLumpSavePlan([], {}), /30 seconds.*No LUMP commit/);
}
async function main() {
    if (process.argv.includes('--validate-repository')) {
        const saved = JSON.parse(fs.readFileSync(0, 'utf8'));
        const context = { window: { ChurchIDX1IDE: IDE }, ChurchSimulator: Simulator,
            LumpContentFrame, console, _LUMP_APPROVAL_FIELDS: new Set(),
            fetch: async () => ({ ok: true, json: async () => saved.detail }) };
        vm.createContext(context);
        for (const name of ['_hashBoundLumpApproval', '_lumpBinaryInspection',
            '_lumpApprovalView', '_loadSavedLumpCapabilities'])
            vm.runInContext(extract(lumps, name), context);
        const metadata = await context._loadSavedLumpCapabilities('isolated', saved.words);
        assert(await IDE.validateSaved(saved.words.words, metadata));
        console.log('Actual saved words/detail responses pass browser metadata and compiler-envelope verification');
        return;
    }
    await progressRace();
    const source = '; @abstraction Assembly\ncapabilities { SELF E }\nIADD DR11, DR0, #2\nIADD DR3, DR0, #28\nBFEXT DR2, DR3, DR11, 3\nHALT';
    const compiled = IDE.compile(new Assembler(), source);
    assert.deepEqual(compiled.errors, []);
    const candidate = Object.freeze({ token: 'disposable', abstraction: 'Assembly',
        language: 'assembly', isaProfile: 'IDX1', source, words: compiled.words,
        capabilities: compiled.capabilities, executionLayout: IDE.freezeLayout(compiled.layout), createdAt: 123 });
    const sim = new Simulator();
    sim.bootComplete = true;
    sim.halted = false;
    const elements = { asmEditor: { value: source }, editorConsole: {}, saveNSDialog: { style: {} } };
    const window = {
        ChurchIDX1IDE: IDE, ChurchIDX1Runtime: Runtime,
        IDEActionState: { get: () => ({ candidate }) },
        LumpRegistry: { getCurrent: () => 'unrelated-legacy', resolve: () => null },
    };
    const context = {
        window, sim, ChurchSimulator: Simulator, CapabilityTokens, LumpContentFrame,
        ...require('./actionable_errors'),
        fetch: async () => ({ ok: true, status: 200, json: async () => ({ node: 'test.ide' }) }),
        console, crypto: crypto.webcrypto, TextEncoder, TextDecoder, Uint8Array, DataView,
        bootEntrySlot: 3,
        _lumpManifests: { 3: { _methods: [{ name: 'StaleBootMethod', pet_names: { DR: { 2: 'wrong' } } }] } },
        document: { getElementById: id => elements[id] || null },
        localStorage: { getItem: () => null, setItem() {} },
        alert: message => { throw new Error('Unexpected native dialog: ' + message); },
        appendOutput() {}, _renderFormatLumpCandidate() {}, _renderFormatLumpVersionHistory() {},
        switchView() {}, _idx1AdmissionInFlight: false,
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(__dirname + '/lump-audit.js', 'utf8'), context);
    vm.runInContext(extract(lumps, '_formatLumpApiDefinition') +
        extract(run, '_cloneLumpSaveCapabilities') + extract(run, '_captureLumpSaveSnapshot'), context);
    context.showSaveToNamespace = () => { window._saveNSPreparedSnapshot = context._captureLumpSaveSnapshot(); };
    const start = lumps.indexOf('window.showFormatLump = async function()');
    const end = lumps.indexOf('\n};', start) + 3;
    vm.runInContext(lumps.slice(start, end), context);
    assert.equal((await window.showFormatLump()).ok, true);
    assert.equal(window._pendingLumpData.candidates.api, undefined,
        'IDX1 must not offer a source-less save that cannot be admitted on reload');
    for (const formatted of Object.values(window._pendingLumpData.candidates))
        assert.equal(formatted.hasErrors, false, JSON.stringify(formatted.auditResults));
    const snapshot = window._saveNSPreparedSnapshot;
    assert.equal(snapshot.isaProfile, 'IDX1');
    assert.equal(snapshot.sourceText, source);
    assert.equal(snapshot.token, candidate.token);
    assert.equal(snapshot.registeredAt, 123);
    assert.equal(snapshot.pending.sourceText, source);
    let durableWords = Array.from(snapshot.pending.binary);
    const content = await LumpContentFrame.lumpInspectContentFrame(durableWords);
    assert.equal(content.source, source);
    assert.equal(content.apiDefinition.isa_profile, 'IDX1');
    assert.deepEqual(content.apiDefinition.methods, []);
    assert.equal(content.apiDefinition.language, 'assembly');
    assert.equal(content.apiDefinition.name, 'Assembly');
    const originalWords = durableWords.slice();
    durableWords = await IDE.nameSavedCandidate(durableWords, 'SavedIDX1Test', snapshot.sourceText);
    const renamedContent = await LumpContentFrame.lumpInspectContentFrame(durableWords);
    assert.equal(renamedContent.apiDefinition.name, 'SavedIDX1Test');
    assert.equal(renamedContent.source, source);
    assert.equal(renamedContent.profile, content.profile);
    assert.equal((await LumpContentFrame.lumpInspectContentFrame(originalWords)).apiDefinition.name, 'Assembly');
    assert.deepEqual(durableWords.slice(1, 1 + compiled.words.length), Array.from(compiled.words));
    if (process.argv.includes('--emit-candidate')) {
        // Reusable input for isolated Flask/browser integration tests. This
        // is the actual unsigned browser snapshot, not /api/compile output.
        console.log(JSON.stringify({ binary: durableWords, metadata: {
            ...(await IDE.savedFields(durableWords, snapshot.executionLayout)),
            abstraction: 'SavedIDX1Test', slot_label: 'SavedIDX1Test', language: 'assembly',
            content_type: 'code', capabilities: snapshot.pending.caps,
            compiled_words: snapshot.words, submitted_source: source, original_source: source,
            original_binary: originalWords,
            output_profile: 'full', compiler_owned_self: true, grants: ['E'],
            capability_type: 'inform', new_entry: true, ns_slot: null,
        } }));
        return;
    }
    // Model only the destination-local SELF finalization, not a repository.
    const slot = 43;
    durableWords[durableWords.length - 1] = sim.createGT(1, slot, { E: 1 }, 1);
    const fields = await IDE.savedFields(durableWords, snapshot.executionLayout);
    const metadata = { ...fields, source, abstraction: 'SavedIDX1',
        compiler_record: { isa_profile: 'IDX1', execution_digest: fields.execution_digest,
            binary_hash: hash(durableWords) } };
    assert(await IDE.validateSaved(durableWords, metadata));
    // Real classic-script globals, deliberately not the CommonJS modules used
    // by the DOM-only harness. Top-level class is lexical, not a window field.
    const browser = { crypto: crypto.webcrypto, TextEncoder, TextDecoder,
        Uint8Array, DataView, console, atob, btoa };
    browser.window = browser;
    vm.createContext(browser);
    for (const script of ['idx1.js', 'idx1-execution-envelope.js', 'idx1-memory.js',
        'idx1-runtime.js', 'assembler.js', 'idx1-ide.js'])
        vm.runInContext(fs.readFileSync(__dirname + '/' + script, 'utf8'), browser, { filename: script });
    assert.equal(browser.ChurchAssembler, undefined);
    assert.equal(vm.runInContext('typeof ChurchAssembler', browser), 'function');
    assert(await browser.ChurchIDX1IDE.validateSaved(durableWords, metadata));
    const plan = { ...metadata, final_binary: durableWords };
    const submitted = { ...fields, original_source: source };
    await IDE.applySavedPlan(submitted, plan);
    await browser.ChurchIDX1IDE.applySavedPlan({ ...fields, original_source: source }, plan);
    assert.equal(submitted.execution_digest, fields.execution_digest);
    for (const key of ['isa_profile', 'execution_envelope', 'execution_digest', 'compiler_record']) {
        const missing = { ...metadata };
        delete missing[key];
        await assert.rejects(IDE.validateSaved(durableWords, missing), /IDX1/);
    }
    await assert.rejects(IDE.validateSaved(durableWords, { ...metadata,
        compiler_record: { isa_profile: 'IDX1', execution_digest: '0'.repeat(64) } }), /attestation/);
    await assert.rejects(IDE.validateSaved(durableWords, {}), /metadata is missing/);
    const changed = durableWords.slice();
    changed[2] ^= 1;
    await assert.rejects(IDE.validateSaved(changed, metadata), /exact saved bytes/);
    await assert.rejects(IDE.validateSaved(durableWords, { ...metadata, source: 'HALT' }), /compiler source/);
    const legacy = [sim.packLumpHeader(0, 1, 1, 0), 0, ...new Array(62).fill(0)];
    assert.equal(await IDE.validateSaved(legacy, {}), null);
    for (const typ of [1, 2]) {
        const data = [sim.packLumpHeader(0, 1, 0, typ), 0x50000000, ...new Array(62).fill(0)];
        assert.equal(await IDE.validateSaved(data, {}), null,
            'Reserved opcode bits in non-executable data are not an ISA marker');
    }

    // Saving must retain without silently installing through the legacy path.
    let loadedBySave = false;
    const loader = sim.loadLumpBinary;
    sim.loadLumpBinary = () => { loadedBySave = true; return false; };
    context._lumpSha256Words = async words => hash(words);
    vm.runInContext(extract(run, '_reloadCommittedLumpArtifact'), context);
    await context._reloadCommittedLumpArtifact({ ...fields, final_binary: durableWords,
        token: 'saved', ns_slot: slot, digest: hash(durableWords) }, 'SavedIDX1',
        { ...metadata, original_source: source });
    assert.equal(loadedBySave, false);
    sim.loadLumpBinary = loader;

    context.fetch = async () => ({ ok: true, json: async () => ({
        words: durableWords, binary_hash: hash(durableWords),
    }) });
    context._executionIdentityHashWords = async words => hash(words);
    context._lumpBinaryInspection = data => ({ binary_hash: data.binary_hash });
    context._loadSavedLumpCapabilities = async () => ({ ...metadata,
        binaryHash: hash(durableWords), identityContract: 'dynamic-local',
        capabilities: [{ name: 'SELF', rights: ['E'], compiler_owned_self: true }],
    });
    // Use the actual c-list guard and saved loader, not just helper admission.
    vm.runInContext(extract(lumps, '_validateSavedLumpClist') +
        extract(lumps, '_loadLumpBinaryIntoSim'), context);
    const savedMetadataLoader = context._loadSavedLumpCapabilities;
    const before = hash(Array.from(sim.memory));
    context._loadSavedLumpCapabilities = async () => ({ ...metadata, execution_envelope: undefined });
    await context._loadLumpBinaryIntoSim('saved', 'SavedIDX1', {}, slot);
    assert.equal(hash(Array.from(sim.memory)), before);
    assert.match(elements.editorConsole.textContent, /Incomplete IDX1/);
    context._loadSavedLumpCapabilities = savedMetadataLoader;
    const button = {};
    await context._loadLumpBinaryIntoSim('saved', 'SavedIDX1', button, slot);
    assert.equal(button.textContent, 'Loaded ✓', elements.editorConsole.textContent);
    assert(Runtime.isInstalled(sim, slot));
    assert.equal(context._idx1AdmissionInFlight, false);
    assert(sim.step(), JSON.stringify(sim.faultLog));
    assert.equal(sim.dr[11], 2);
    assert(sim.step(), JSON.stringify(sim.faultLog));
    assert.equal(sim.dr[3], 28);
    assert(sim.step(), JSON.stringify(sim.faultLog));
    assert.equal(sim.dr[2], 7);
    elements.asmEditor.value += '\n; unsaved personal edit';
    assert.equal(snapshot.sourceText, source);
    assert.notEqual(elements.asmEditor.value, snapshot.sourceText);
    console.log('IDX1 immutable Save format, metadata tamper/loss, exact retention and saved protected reload passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });