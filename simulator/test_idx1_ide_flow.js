'use strict';

// Actual IDE compiler, immutable candidate/queue, C-list linker and install
// functions, with disposable simulator memory and DOM-only presentation stubs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const Simulator = require('./simulator.js');
const Assembler = require('./assembler.js');
const IDE = require('./idx1-ide.js');
const Runtime = require('./idx1-runtime.js');
const CapabilityTokens = require('./capability_tokens.js');
function extract(text, name) {
    const re = new RegExp(`^(?:async )?function ${name}\\(`, 'm'), start = text.search(re);
    assert(start >= 0, name);
    const rest = text.slice(start);
    const next = rest.slice(rest.indexOf('\n') + 1).search(/^(?:async )?function \w+\(/m);
    return next < 0 ? rest : rest.slice(0, rest.indexOf('\n') + 1 + next);
}
async function main() {
    const sim = new Simulator();
    sim.bootComplete = true;
    sim.halted = false;
    const scratchSlot = 40, scratchBase = 0x2400;
    sim.nsCount = Math.max(sim.nsCount, scratchSlot + 2);
    sim.withNamespaceWrite('disposable scratch fixture', () => {
        sim.writeNSEntry(scratchSlot, scratchBase, 15, 0, 0, 1, 1, 0, 0);
        sim.writeNSEntry(scratchSlot + 1, scratchBase + 32, 15, 0, 0, 1, 1, 0, 0);
    });
    sim.nsLabels[scratchSlot] = 'SCRATCH';
    sim.nsLabels[scratchSlot + 1] = 'PADBUF';
    sim.memory[scratchBase] = 0x12345678;
    const source = [
        'capabilities { SELF E, PADBUF R, SCRATCH RW }',
        'BRANCH steal',
        'steal:',
        'IADD DR11, DR0, #2',
        'LOAD CR1, CR6, DR11',
        'DREAD DR1, CR1, #0',
        'RETURN',
    ].join('\n');
    const elements = {
        asmEditor: { value: source },
        langSelector: { value: 'assembly' },
        editorConsole: { textContent: '', innerHTML: '' },
    };
    const document = {
        readyState: 'complete',
        getElementById: name => elements[name] || null,
        addEventListener() {},
    };
    const window = {
        ChurchIDX1IDE: IDE, ChurchIDX1Runtime: Runtime,
        TargetState: { authorize: () => ({ ok: true }) },
        _computeLumpToken: words => crypto.createHash('sha256').update(JSON.stringify(words)).digest('hex').slice(0, 8),
        LumpRegistry: {
            getCurrent: () => null, resolve: () => null,
            registerMemory() { throw new Error('IDX1 must not enter code-only registry'); },
        },
    };
    const context = vm.createContext({
        window, document, console, sim, ChurchSimulator: Simulator, ChurchAssembler: Assembler,
        assembler: new Assembler(), CapabilityTokens, cloomcCompiler: null,
        _pendingSimLoad: false, _pendingSimLoadSnapshot: null, _idx1AdmissionInFlight: false,
        lastAssembledNamedSlots: null, lastMethodTableSize: 0, pipelineViz: null,
        saveEditorState() {}, switchCodeTab() {}, showNextSteps() {},
        _formatCListListing: () => '', _highlightCodeListing: text => text,
        _pushAsmLabelSnippets() {}, appendOutput() {},
        requirePermission: () => true,
        _lumpsCache: [], bootAnimating: false, walkRunning: false, _simRunActive: false,
    });
    vm.runInContext(fs.readFileSync('simulator/app-actions.js', 'utf8'), context);
    const shell = fs.readFileSync('simulator/app-shell.js', 'utf8');
    for (const name of ['_setPendingSimLoad', '_clearPendingSimLoad'])
        vm.runInContext(extract(shell, name), context);
    const run = fs.readFileSync('simulator/app-run.js', 'utf8');
    for (const name of ['_materializeRunCapabilities', '_blockCapabilityRun', 'assembleAndLoad',
        '_injectClistNow', '_applyPendingSimLoad'])
        vm.runInContext(extract(run, name), context);
    vm.runInContext(extract(fs.readFileSync('simulator/app-compile.js', 'utf8'),
        'smartCompile'), context);
    const result = await window.IDEActions.compile();
    assert(result.ok, result.error);
    const candidate = window.IDEActionState.get().candidate;
    assert.equal(candidate.isaProfile, 'IDX1');
    assert(Object.isFrozen(candidate.executionLayout.extents[0]));
    assert.equal(candidate.capabilities.length, 3);
    assert(candidate.executionLayout.instructionStarts.includes(3));
    assert.equal(window.IDEActionState.eligibility('save').ok, false);
    assert.match(window.IDEActionState.eligibility('save').reason, /simulator-only/);
    assert.equal(window.IDEActionState.eligibility('export').ok, false);
    assert(window.IDEActions.installCandidate().ok);
    assert.equal(context._pendingSimLoadSnapshot.isaProfile, 'IDX1');
    assert.notEqual(await context._applyPendingSimLoad(), false, JSON.stringify(sim.faultLog) + sim.output.slice(-1500));
    assert.equal(sim.halted, false, JSON.stringify(sim.faultLog));
    assert.equal(window._installedIDX1Envelope.profile, 'IDX1');
    for (let i = 0; i < 4; i++) assert(sim.step(), JSON.stringify(sim.faultLog));
    assert.equal(sim.dr[11], 2);
    assert.equal(sim.dr[1] >>> 0, 0x12345678);
    assert.equal(sim.pc, 5);
    // This is a top-level Run candidate, not a CALL. Preserve the existing
    // canonical root-sentinel RETURN fault; do not invent a caller frame.
    assert.equal(sim.step(), null);
    assert.equal(sim.faultLog.at(-1).type, 'STACK_UNDERFLOW');
    assert.equal(elements.asmEditor.value, source);
    assert.equal(window.IDEActionState.get().installed.isaProfile, 'IDX1');
    assert(IDE.requiresProfile('CALL CR6[DR2 + 4], DR4 - 1'));
    assert(IDE.compile(new Assembler(), 'CALL CR6[DR2], DR3').errors.some(e => /not yet supported/.test(e.message)));
    console.log('IDX1 normal IDE compile/candidate/load/admission/runtime/Save-block flow passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });