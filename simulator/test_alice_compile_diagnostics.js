'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const frame = require('./lump-content-frame');
const ChurchAssembler = require('./assembler');
const ChurchSimulator = require('./simulator');
const CLOOMCCompiler = require('./cloomc_compiler');
const CapabilityTokens = require('./capability_tokens');
const audit = require('./lump-audit');

function productionFunction(source, name) {
    const start = source.indexOf('function ' + name + '(');
    assert(start >= 0, 'missing ' + name);
    const body = source.indexOf('{', start);
    let depth = 0;
    for (let i = body; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error('unclosed ' + name);
}

async function main() {
    // Inspect the exact saved Alice file, not a sidecar, editor state, or live
    // simulator. Assemble into a temporary in-memory result; never install it.
    const bytes = fs.readFileSync(path.join(__dirname, '../server/lumps/ide.Alice.1.1eec355e.lump'));
    const words = Array.from({ length: bytes.length / 4 }, (_, i) => bytes.readUInt32BE(i * 4));
    const embedded = await frame.lumpInspectContentFrameSource(words);
    assert.equal(embedded.status, 'source');
    const assembled = new ChurchAssembler().assemble(embedded.source);
    assert.equal(assembled.errors.length, 0);
    assert.equal(assembled.words.length, 9);

    // Run the real editor compile entry point, including capability
    // materialization. An unbound SECRET_DATA row must create a pending GT
    // in memory, rather than throwing "word is not defined". No candidate is
    // installed, saved, or executed.
    const runSource = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
    const editor = { value: embedded.source };
    let candidate = null;
    const priorNames = ChurchSimulator.PENDING_GT_NAMES.slice();
    ChurchSimulator.PENDING_GT_NAMES = [];
    const run = {
        ...require('./actionable_errors'),
        fetch: async () => ({ ok: true, status: 200, json: async () => ({ node: 'test.ide' }) }),
        ChurchAssembler, ChurchSimulator, CapabilityTokens,
        assembler: new ChurchAssembler(), cloomcCompiler: new CLOOMCCompiler(),
        sim: { constructor: ChurchSimulator, nsLabels: {} },
        document: { getElementById(id) {
            return id === 'asmEditor' ? editor :
                id === 'langSelector' ? { value: 'assembly' } : { innerHTML: '' };
        } },
        saveEditorState() {}, showNextSteps() {},
        _clearAsmErrors() {}, _clearAsmWarnings() {}, _showAsmWarnings() {},
        _highlightCodeListing(text) { return text; }, _autoFillCapRights() {},
        _clistTypeLabel() { return 'Abstr'; },
        IDEActionState: { recordCandidate(value) { candidate = value; } }
    };
    run.window = run;
    try {
        vm.createContext(run);
        vm.runInContext(['_materializeRunCapabilities', '_pushAsmLabelSnippets',
            '_formatCListListing', 'assembleAndLoad']
            .map(name => productionFunction(runSource, name)).join('\n'), run);
        const compiled = run.assembleAndLoad({
            source: embedded.source, candidateOnly: true
        });
        assert.equal(compiled.ok, true);
        assert(candidate, 'assembly candidate reached the editor action state');
        assert.equal(candidate.capabilities[0].name, 'SELF');
        assert.equal(candidate.capabilities[0].compiler_owned_self, true);
        assert.equal(candidate.capabilities[1].name, 'SECRET_DATA');
        assert.equal(ChurchSimulator.isPendingGT(candidate.capabilities[1].token), true);
        assert.equal(ChurchSimulator.pendingGTName(candidate.capabilities[1].token), 'SECRET_DATA');
        const same = ChurchSimulator.makePendingGT('SECRET_DATA');
        const different = ChurchSimulator.makePendingGT('Another.Capability');
        assert.equal(same, candidate.capabilities[1].token, 'deduplicate pending pet names');
        assert.notEqual(same, different, 'distinct names receive distinct sentinel indices');

        // Route the actual symbolic Namespace-row click through the selected
        // saved-artifact handoff. Stub only its network-dependent opener,
        // injecting the source inspected from Alice's exact binary above.
        const selectedFilename = 'ide.Alice.1.1eec355e.lump';
        const selectedHash = require('crypto').createHash('sha256')
            .update(bytes).digest('hex');
        const selection = {
            token: '1eec355e', filename: selectedFilename,
            binaryHash: selectedHash
        };
        run.sim.nsLabels[14] = 'ide.Alice';
        run.sim.readNSEntry = () => ({ label: 'ide.Alice', gtType: 1 });
        run.sim.symbolicEntryAt = () => ({
            name: 'ide.Alice', implementationMissing: true, selection
        });
        let opened = 0;
        run.openLumpInEditor = async (token, options) => {
            assert.equal(token, selection.token);
            assert.equal(options.exactSavedArtifact.filename, selectedFilename);
            assert.equal(options.exactSavedArtifact.binary_hash, selectedHash);
            editor.value = embedded.source;
            run._editorOpenLumpToken = token;
            opened++;
        };
        const memorySource = fs.readFileSync(path.join(__dirname, 'app-memory.js'), 'utf8');
        vm.runInContext(productionFunction(memorySource, '_nsOpenDesignSelection') +
            '\n' + productionFunction(memorySource, '_nsLabelOpen'), run);
        await run._nsLabelOpen(14);
        assert.equal(opened, 1);
        assert.equal(editor.value, embedded.source);

        // Edit a local draft. Browser storage and registry are isolated
        // in-memory doubles: never call a real save API.
        const draft = embedded.source + '\n; unsaved local draft\n';
        editor.value = draft;
        const elements = new Map([
            ['asmEditor', editor],
            ['langSelector', { value: 'assembly' }],
            ['saveNSDialog', { style: { display: 'none' } }],
            ['editorConsole', { textContent: '' }]
        ]);
        const saveButton = {
            dataset: {}, textContent: 'Save Lump',
            getAttribute() { return 'Save LUMP'; },
            setAttribute() {}
        };
        elements.set('btnHamSaveLump', saveButton);
        const local = new Map();
        let registryEntry = null;
        let currentToken = null;
        const alerts = [];
        let reviewCount = 0;
        run.document = {
            readyState: 'loading', addEventListener() {},
            getElementById(id) {
                if ((id.startsWith('btnHam') && id !== 'btnHamSaveLump') ||
                        id.startsWith('btnToolbar') ||
                        id === 'fmtProceedBtn' ||
                        id === 'btnSaveNS' ||
                        id === 'btnExportLump' || id === 'btnRunSim') return null;
                if (!elements.has(id)) elements.set(id, {
                    innerHTML: '', textContent: '', style: {}, disabled: false
                });
                return elements.get(id);
            }
        };
        run.localStorage = {
            getItem(key) { return local.get(key) || null; },
            setItem(key, value) { local.set(key, String(value)); }
        };
        run.alert = message => alerts.push(message);
        run.LumpRegistry = {
            registerMemory(token, abstraction, code, caps, meta) {
                registryEntry = { abstraction, sources: { memory: {
                    words: code.slice(), capabilities: caps.slice(),
                    sourceText: meta.sourceText, registeredAt: 1
                } } };
            },
            setCurrent(token) { currentToken = token; },
            getCurrent() { return currentToken; },
            resolve(token) { return token === currentToken ? registryEntry : null; },
            isServerListFetched() { return true; },
            getServerList() { return []; }
        };
        run._computeLumpToken = code => require('crypto').createHash('sha256')
            .update(JSON.stringify(code)).digest('hex').slice(0, 8);
        run.LumpContentFrame = frame;
        run.lumpAudit = audit.lumpAudit;
        run.lumpAuditHasErrors = audit.lumpAuditHasErrors;
        run.lumpAuditHasWarnings = audit.lumpAuditHasWarnings;
        run.showSaveToNamespace = () => {
            reviewCount++;
            elements.get('saveNSDialog').style.display = '';
        };
        run.closeEditorActions = () => {};
        run.requirePermission = () => true;
        run.console = { error() {} };
        vm.runInContext(productionFunction(fs.readFileSync(
            path.join(__dirname, 'app-compile.js'), 'utf8'), '_internalCompileDiagnostic') +
            '\n' + productionFunction(fs.readFileSync(
                path.join(__dirname, 'app-compile.js'), 'utf8'), 'smartCompile'), run);
        const lumpsSource = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');
        const formatterStart = lumpsSource.indexOf('window.showFormatLump = async function()');
        const formatterEnd = lumpsSource.indexOf('\n// ── GT Slot Picker', formatterStart);
        assert(formatterStart > 0 && formatterEnd > formatterStart);
        vm.runInContext(['_fmtEscape', '_fmtLumpByteSize', '_formatLumpApiDefinition',
            '_renderFormatLumpCandidate', '_renderFormatLumpVersionHistory']
            .map(name => productionFunction(lumpsSource, name)).join('\n') +
            '\n' + lumpsSource.slice(formatterStart, formatterEnd), run);
        vm.runInContext(fs.readFileSync(path.join(__dirname, 'app-actions.js'), 'utf8'), run);
        const markup = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
        const click = markup.match(/id="btnHamSaveLump"[^>]*onclick="([^"]+)"/);
        assert(click, 'actual Save LUMP menu click is bound');
        let savePromise;
        const actualSave = run.IDEActions.save;
        run.IDEActions.save = (...args) => (savePromise = actualSave(...args));
        // Compile must finish before the actual Save click.
        const compiledDraft = await run.IDEActions.compile();
        assert.equal(compiledDraft.ok, true);
        assert.equal(registryEntry.sources.memory.sourceText, draft);
        vm.runInContext(click[1], run);
        const saveResult = await savePromise;
        assert.equal(saveResult.ok, true, saveResult.error || alerts.join('\n'));
        assert.equal(reviewCount, 1, 'actual click opened one unified review');
        assert.equal(elements.get('saveNSDialog').style.display, '');
        const reviewed = run._pendingLumpData;
        assert.equal(reviewed.sourceText, draft);
        assert.equal(reviewed.words.length, 9);
        assert.equal(reviewed.candidates.full.binary.length, reviewed.candidates.full.lumpSize);
        assert.equal(reviewed.candidates.full.binary[0] >>> 27, 0x1F);
        assert.equal(reviewed.candidates.full.binary[0] & 0xFF, 2,
            'SELF and SECRET_DATA preserve their original row indices');
        assert.equal((await frame.lumpInspectContentFrameSource(
            reviewed.candidates.full.binary)).source, draft);
        assert.equal(reviewed.candidates.full.hasErrors, false,
            JSON.stringify(reviewed.candidates.full.auditResults.filter(item => item.severity === 'error')));
        assert.equal(alerts.length, 0);
        assert.equal(embedded.source, (await frame.lumpInspectContentFrameSource(words)).source);

        let releaseFrame;
        let firstFrame = true;
        run.LumpContentFrame = {
            ...frame,
            async lumpBuildContentFrame(...args) {
                if (firstFrame) {
                    firstFrame = false;
                    await new Promise(resolve => { releaseFrame = resolve; });
                }
                return frame.lumpBuildContentFrame(...args);
            }
        };
        elements.get('saveNSDialog').style.display = 'none';
        vm.runInContext(click[1], run);
        for (let i = 0; i < 20 && !releaseFrame; i++) await Promise.resolve();
        assert(releaseFrame, 'actual click entered the asynchronous frame builder');
        editor.value = draft + '; edited while review was preparing\n';
        releaseFrame();
        const staleReview = await savePromise;
        assert.equal(staleReview.ok, false);
        assert.match(alerts.at(-1), /editor draft or selected LUMP changed/);
        assert.equal(reviewCount, 1);
        assert.equal(run._pendingLumpData, null, 'stale review cannot reuse old frozen bytes');
        editor.value = draft;

        // A formatter exception must produce a visible actionable result,
        // never an unhandled rejected click or a misleading success response.
        run.LumpContentFrame = {
            ...frame,
            async lumpBuildContentFrame() { throw new Error('content frame unavailable'); }
        };
        vm.runInContext(click[1], run);
        const blocked = await savePromise;
        assert.equal(blocked.ok, false);
        assert.match(alerts.at(-1), /Format LUMP preparation failed.*content frame unavailable/);
        assert.match(alerts.at(-1), /No LUMP was saved/);
        assert.equal(reviewCount, 1);
        assert.equal(run._pendingLumpData, null);

        editor.value = '';
        run.IDEActions.refresh();
        assert.equal(saveButton.disabled, false, 'empty editor cannot swallow the Save click');
        vm.runInContext(click[1], run);
        const missingSource = await savePromise;
        assert.equal(missingSource.ok, false);
        assert.match(alerts.at(-1), /Enter source and build a candidate first/);
        assert.equal(reviewCount, 1);

        // Mallory is a deliberate NO_CAPABILITY example, not an off-by-one
        // compiler or RCI decode defect. Inspect its exact released bytes
        // read-only, then compile and review the same source via the same
        // actual handlers. Never install or submit the reviewed candidate.
        const malloryBytes = fs.readFileSync(path.join(__dirname,
            '../server/lumps/ide.Mallory.1.0ca567b5.lump'));
        const malloryWords = Array.from({ length: malloryBytes.length / 4 },
            (_, i) => malloryBytes.readUInt32BE(i * 4));
        const mallory = await frame.lumpInspectContentFrameSource(malloryWords);
        assert.equal(mallory.status, 'source');
        assert.match(mallory.source, /LOAD\s+CR1,\s*CR6,\s*2/);
        assert.match(mallory.source, /intentionally absent/);
        const literalLoad = new ChurchAssembler().assemble('LOAD CR1, CR6, #11');
        const bareLoad = new ChurchAssembler().assemble('LOAD CR1, CR6, 11');
        assert.equal(literalLoad.errors.length, 0);
        assert.equal(bareLoad.errors.length, 0);
        assert.equal(literalLoad.words[0], bareLoad.words[0]);
        assert.equal(literalLoad.words[0] & 0x7FFF, 11);
        const registerLoad = new ChurchAssembler().assemble('LOAD CR1, CR6, DR11');
        assert.equal(registerLoad.errors.length, 1);
        assert.match(registerLoad.errors[0].message, /data register, not a c-list row/);
        assert.match(registerLoad.errors[0].message, /does not read the value in DR11 at runtime/);
        assert.match(registerLoad.errors[0].message, /no register-indexed LOAD/);
        assert.equal(registerLoad.errors[0].colStart, 15);
        assert.equal(new ChurchAssembler().assemble('IADD DR1, DR2, DR11').errors.length, 0,
            'register operands remain valid where the ISA supports them');
        assert.equal(malloryWords.length, 256);
        assert.equal((malloryWords[0] >>> 10) & 0x1FFF, 5);
        assert.equal(malloryWords[0] & 0xFF, 2);
        assert.equal(malloryWords[2] >>> 0, 0x070B0002);
        const savedMalloryAudit = audit.lumpAudit(malloryWords, {
            cw: 5, cc: 2, lump_size: 256
        });
        assert.equal(savedMalloryAudit.find(item => item.ruleId === 'RCI').severity, 'error');
        run.LumpContentFrame = frame;
        run._editorOpenLumpToken = '0ca567b5';
        editor.value = mallory.source;
        const compiledMallory = await run.IDEActions.compile();
        assert.equal(compiledMallory.ok, true, 'compilation is separate from static audit');
        assert.equal(registryEntry.sources.memory.capabilities.length, 2);
        assert.deepEqual(Array.from(registryEntry.sources.memory.words),
            malloryWords.slice(1, 6), 'compiler emitted the exact original instruction words');
        elements.get('saveNSDialog').style.display = 'none';
        vm.runInContext(click[1], run);
        const malloryReview = await savePromise;
        assert.equal(malloryReview.ok, true, malloryReview.error);
        assert.equal(reviewCount, 2, 'review opens without approving an unsafe binary');
        const malloryPending = run._pendingLumpData;
        assert.equal(malloryPending.candidates.full.binary[0] & 0xFF, 2);
        const rci = malloryPending.candidates.full.auditResults.find(item => item.ruleId === 'RCI');
        assert.equal(rci.severity, 'error');
        assert.equal(malloryPending.candidates.full.auditResults.find(
            item => item.ruleId === 'RPN').severity, 'pass');
        assert.equal(rci.violations.length, 1);
        assert.equal(rci.violations[0].slot, 2);
        assert.equal(rci.violations[0].wordIndex, 1);
        assert.match(rci.detail, /Executing this access would fault NO_CAPABILITY/);
        assert(!rci.detail.includes('Increase cc'));
        assert.equal(elements.get('saveNSConfirmBtn').disabled, true);
        assert.match(elements.get('fmtProceedNote').textContent,
            /may intentionally fault NO_CAPABILITY/);
        assert.equal((await frame.lumpInspectContentFrameSource(
            malloryPending.candidates.full.binary)).source, mallory.source);
        assert.equal(fs.readFileSync(path.join(__dirname,
            '../server/lumps/ide.Mallory.1.0ca567b5.lump')).equals(malloryBytes), true);
    } finally {
        ChurchSimulator.PENDING_GT_NAMES = priorNames;
    }

    const lumps = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');
    const labels = vm.createContext({});
    vm.runInContext(productionFunction(lumps, '_savedLumpMethodLabel') + '\n' +
        productionFunction(lumps, '_savedLumpRejectionReason'), labels);
    const api = frame.lumpDecodeContentFrameApi(words);
    assert.equal(labels._savedLumpMethodLabel(api.methods[0], 0), 'Stash');
    assert.equal(labels._savedLumpMethodLabel(api.methods[1], 1), 'Reveal');
    assert.equal(labels._savedLumpMethodLabel({}, 2), 'Method3');
    assert.equal(labels._savedLumpRejectionReason({
        approved: false, validation_errors: ['Approval record not found']
    }), 'Approval record not found');
    assert.equal(labels._savedLumpRejectionReason({
        binary_valid: false, validation_errors: ['Header failed integrity check']
    }), 'Header failed integrity check');

    const compile = fs.readFileSync(path.join(__dirname, 'app-compile.js'), 'utf8');
    const consolePanel = { textContent: '' };
    let shown;
    const sandbox = {
        console: { error() {} }, window: {},
        document: { getElementById(id) {
            return id === 'langSelector' ? { value: 'assembly' } :
                id === 'asmEditor' ? { value: embedded.source } : consolePanel;
        } },
        requirePermission() { return true; },
        assembleAndLoad() {
            const error = new ReferenceError('word is not defined');
            error.stack = 'ReferenceError: word is not defined\n' +
                ' at annotation (/private/source/snippet.js?key=secret:4:5)\n' +
                ' at prepare (https://host.example/simulator/app-run.js:640:7)';
            throw error;
        },
        _showAsmErrors(errors, title) { shown = { errors, title }; },
        showNextSteps() {}
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(productionFunction(compile, '_internalCompileDiagnostic') +
        '\n' + productionFunction(compile, 'smartCompile'), sandbox);
    const failed = await sandbox.smartCompile({ source: embedded.source });
    assert.equal(failed.kind, 'internal');
    assert.match(failed.error, /Internal IDE error during Assembly candidate preparation: ReferenceError: word is not defined/);
    assert.match(shown.title, /Internal IDE error/);
    assert.equal(shown.errors[0].line, null);
    assert.match(shown.errors[0].detail, /app-run\.js:640:7/);
    assert(!shown.errors[0].detail.includes('secret'));
    assert(!shown.errors[0].detail.includes('private'));
    assert(!shown.errors[0].detail.includes(embedded.source));
    console.log('PASS exact Alice/Mallory read-only source → compile → Save review; intentional RCI stays blocked without altering draft');
}
main().catch(error => { console.error(error); process.exitCode = 1; });