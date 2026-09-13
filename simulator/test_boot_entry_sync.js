'use strict';
// Task #3447 UI regression checks. Run: node simulator/test_boot_entry_sync.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const childProcess = require('child_process');
const ChurchSimulator = require('./simulator.js');

const abstractions = fs.readFileSync(path.join(__dirname, 'app-abstractions.js'), 'utf8');
const runner = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
const memoryUi = fs.readFileSync(path.join(__dirname, 'app-memory.js'), 'utf8');
let passed = 0;
function check(name, fn) {
    try { fn(); console.log('PASS ' + name); passed++; }
    catch (error) { console.error('FAIL ' + name + ': ' + error.message); process.exitCode = 1; }
}
function extract(source, name) {
    const start = source.indexOf('function ' + name + '(');
    assert.notStrictEqual(start, -1, name + ' not found');
    let depth = 0, begun = false;
    for (let i = start; i < source.length; i++) {
        if (source[i] === '{') { depth++; begun = true; }
        if (source[i] === '}' && begun && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error('unterminated ' + name);
}

check('three boot instructions are the only UI progress steps', () => {
    const block = runner.slice(runner.indexOf('const _BOOT_STEPS ='), runner.indexOf('function _bootNIARows'));
    assert.match(block, /LOAD CR15/);
    assert.match(block, /CHANGE CR12/);
    assert.match(block, /CALL CR0/);
    assert.strictEqual((block.match(/addrStr:/g) || []).length, 3);
    assert.doesNotMatch(block, /FAULT_RST|INIT_THRD|NUC_CODE/);
});

check('boot progress renders only the current core attempt', () => {
    const stepsSrc = runner.slice(runner.indexOf('const _BOOT_STEPS ='),
        runner.indexOf('function stepSim()'));
    const context = {
        sim: {
            getState() {
                return {
                    bootProgress: [
                        { attemptId: 11, bootRomAddress: 0, status: 'completed', word: 1, destinationRegister: 15 },
                        { attemptId: 11, bootRomAddress: 1, status: 'completed', word: 2, destinationRegister: 12 },
                        { attemptId: 11, bootRomAddress: 2, status: 'failed', word: 3, destinationRegister: 0, gateReason: 'stale home' },
                        // A record from an earlier attempt must not set a checkmark.
                        { attemptId: 10, bootRomAddress: 2, status: 'completed', word: 99, destinationRegister: 0 },
                    ],
                };
            },
        },
        Number, Object,
    };
    vm.runInNewContext(stepsSrc + '\nrows = _bootNIARows(0);', context);
    assert.strictEqual(context.rows.attemptId, 11);
    assert.deepStrictEqual(Array.from(context.rows.all, row => row.status),
        ['completed', 'completed', 'failed']);
    assert.strictEqual(context.rows.curr.disasm, 'CALL CR0');
    assert.strictEqual(context.rows.curr.gateReason, 'stale home');
});

check('boot progress never infers a completed hardware row from position', () => {
    const stepsSrc = runner.slice(runner.indexOf('const _BOOT_STEPS ='),
        runner.indexOf('function stepSim()'));
    const context = {
        sim: { getState: () => ({ bootProgress: [
            { attemptId: 12, status: 'completed', word: 0x11111111 },
            { attemptId: 12, status: 'completed', word: 0x22222222 },
        ] }) },
        Number, Object,
    };
    vm.runInNewContext(stepsSrc + '\nrows = _bootNIARows(2);', context);
    assert.deepStrictEqual(Array.from(context.rows.all, row => row.status),
        ['unexecuted', 'unexecuted', 'unexecuted']);
    assert.strictEqual(context.rows.curr.disasm, 'LOAD CR15');
});

check('UI has no direct live boot-slot redirect outside persistence rollback', () => {
    const ui = [runner,
        fs.readFileSync(path.join(__dirname, 'app-memory.js'), 'utf8'),
        fs.readFileSync(path.join(__dirname, 'app-shell.js'), 'utf8'),
        fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8')].join('\n');
    assert.doesNotMatch(ui, /sim\.bootEntrySlot\s*=/);
    assert.match(abstractions, /sim\.bootEntrySlot\s*=\s*rollback\.bootEntrySlot/);
    assert.strictEqual((abstractions.match(/sim\.bootEntrySlot\s*=/g) || []).length, 1);
    assert.doesNotMatch(extract(runner, '_applyPendingSimLoad'), /prepareBootEntry/);
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8'),
        /setBootEntrySlot\(_targetSlot\)/);
    const lumpEditor = fs.readFileSync(path.join(__dirname, 'app-lump-editor.js'), 'utf8');
    assert.doesNotMatch(lumpEditor, /localBootSlot|localStorage\.setItem\('bootEntrySlot'/);
    assert.match(lumpEditor, /if \(setBootEntrySlot\(nsSlot\) === true\)/);
});

check('failed Prepare leaves local selection and storage unchanged', () => {
    const setSrc = extract(abstractions, 'setBootEntrySlot');
    const writes = [];
    const context = {
        bootEntrySlot: 6,
        sim: { prepareBootEntry: slot => ({ ok: false, slot, reason: 'stale Namespace sequence' }) },
        window: { TargetState: { authorize: () => ({ ok: true }) } },
        localStorage: { setItem: (...args) => writes.push(args) },
        _setBootEntryPreparation: () => {},
        _bootEntryMessage: result => result.reason,
        renderAbstractions: () => {},
        Number, Math, String,
    };
    vm.runInNewContext(setSrc + '\nresult = setBootEntrySlot(7);', context);
    assert.strictEqual(context.result, false);
    assert.strictEqual(context.bootEntrySlot, 6);
    assert.deepStrictEqual(writes, []);
});

check('successful Prepare commits only after core transaction succeeds', () => {
    const setSrc = extract(abstractions, 'setBootEntrySlot');
    let committed = null;
    const context = {
        bootEntrySlot: 6,
        sim: { prepareBootEntry: slot => ({ ok: true, slot, sequence: 23, homeAddress: 0 }) },
        window: {
            TargetState: { authorize: () => ({ ok: true }) },
        },
        _commitPreparedBootEntry: (slot, result) => { committed = { slot, result }; },
        localStorage: { setItem: () => { throw new Error('setBootEntrySlot must delegate persistence to commit'); } },
        _setBootEntryPreparation: () => {},
        renderAbstractions: () => {},
        Number, Math, String,
    };
    vm.runInNewContext(setSrc + '\nresult = setBootEntrySlot(7);', context);
    assert.strictEqual(context.result, true);
    assert.deepStrictEqual(committed, { slot: 7, result: { ok: true, slot: 7, sequence: 23, homeAddress: 0 } });
    assert.strictEqual(context.bootEntrySlot, 6);
});

check('actual core prepare contract leaves live CR0 untouched for UI Prepare', () => {
    const setSrc = extract(abstractions, 'setBootEntrySlot');
    const sim = new ChurchSimulator();
    const liveCR0Before = JSON.stringify(sim.cr[0]);
    let committed = null;
    const context = {
        bootEntrySlot: 5,
        sim,
        window: { TargetState: { authorize: () => ({ ok: true }) } },
        localStorage: { setItem: () => {} },
        _commitPreparedBootEntry: (slot, result) => { committed = { slot, result }; },
        _setBootEntryPreparation: () => {},
        _bootEntryMessage: result => result && result.reason,
        renderAbstractions: () => {},
        Number, Math, String,
    };
    vm.runInNewContext(setSrc + '\nresult = setBootEntrySlot(6);', context);
    assert.strictEqual(context.result, true);
    assert.strictEqual(committed.slot, 6);
    assert.strictEqual(committed.result.threadSlot, 1);
    assert.ok(Number.isInteger(committed.result.homeAddress));
    assert.strictEqual(JSON.stringify(sim.cr[0]), liveCR0Before);
    assert.strictEqual(sim.inspectBootEntryBinding().ok, true);
});

check('storage failure rolls back core header, home, and browser selection', () => {
    const setSrc = extract(abstractions, 'setBootEntrySlot');
    const commitSrc = extract(abstractions, '_commitPreparedBootEntry');
    const sim = {
        bootEntrySlot: 6,
        memory: new Uint32Array(300),
        getThreadInstanceLayout: () => ({ valid: true, base: 250, capsStart: 10 }),
        prepareBootEntry(slot) {
            this.bootEntrySlot = slot;
            this.memory[4] = 0xDEAD;
            this.memory[260] = 0xBEEF;
            return { ok: true, slot, homeAddress: 260 };
        },
    };
    sim.memory[4] = 0x1111;
    sim.memory[260] = 0x2222;
    const context = {
        bootEntrySlot: 6, sim,
        window: { TargetState: { authorize: () => ({ ok: true }) } },
        localStorage: { setItem: () => { throw new Error('quota exceeded'); } },
        _syncSelfTestNextGtToBootEntry: () => {},
        _setBootEntryPreparation: () => {},
        _bootEntryMessage: error => error && error.message ? error.message : String(error),
        renderAbstractions: () => {},
        Number, Math, String,
    };
    vm.runInNewContext(commitSrc + '\n' + setSrc + '\nresult = setBootEntrySlot(7);', context);
    assert.strictEqual(context.result, false);
    assert.strictEqual(context.bootEntrySlot, 6);
    assert.strictEqual(sim.bootEntrySlot, 6);
    assert.strictEqual(sim.memory[4], 0x1111);
    assert.strictEqual(sim.memory[260], 0x2222);
});

check('render failure rolls back browser persistence and core preparation', () => {
    const setSrc = extract(abstractions, 'setBootEntrySlot');
    const commitSrc = extract(abstractions, '_commitPreparedBootEntry');
    const syncNextSrc = extract(abstractions, '_syncSelfTestNextGtToBootEntry');
    let stored = '6';
    const sim = new ChurchSimulator();
    const headerBefore = sim.memory[4] >>> 0;
    const homeBefore = sim.memory[260] >>> 0;
    sim.demoClistGTs[1] = 0;
    const context = {
        bootEntrySlot: 6, _bootEntrySelectionRevision: 0,
        _bootEntryPreparation: { slot: 6, status: 'prepared' },
        sim, window: { TargetState: { authorize: () => ({ ok: true }) } },
        localStorage: {
            getItem: () => stored,
            setItem: (_key, value) => { stored = value; },
            removeItem: () => { stored = null; },
        },
        _setBootEntryPreparation: () => {},
        _bootEntryMessage: error => error && error.message,
        renderAbstractions: () => { throw new Error('render interrupted'); },
        Number, Math, String,
    };
    vm.runInNewContext(syncNextSrc + '\n' + commitSrc + '\n' + setSrc +
        '\nresult = setBootEntrySlot(6);', context);
    assert.strictEqual(context.result, false);
    assert.strictEqual(stored, '6');
    assert.strictEqual(context.bootEntrySlot, 6);
    assert.strictEqual(sim.bootEntrySlot, 6);
    assert.strictEqual(sim.memory[4], headerBefore);
    assert.strictEqual(sim.memory[260], homeBefore);
    assert.strictEqual(sim.demoClistGTs[1], 0);
});

check('binding inspection remains read-only and fault UI preserves unknown provenance', () => {
    const inspectSrc = extract(abstractions, '_syncBootEntryFromSim');
    assert.doesNotMatch(inspectSrc, /localStorage\.setItem|bootEntrySlot\s*=/);
    const modalSrc = extract(runner, 'showFaultModal');
    assert.doesNotMatch(modalSrc, /f\._nsSnapshot\s*=/);
    assert.match(modalSrc, /no immutable instruction provenance/);
    assert.match(modalSrc, /bootEvidence/);
    assert.match(modalSrc, /Known ROM instruction/);
    assert.match(modalSrc, /observed fault word/);
    assert.match(modalSrc, /null\/zero GT/);
    assert.match(runner, /'bootEvidence'/);
    const bootDecoder = fs.readFileSync(path.join(__dirname, 'app-absdetail.js'), 'utf8');
    assert.match(bootDecoder, /Simulator\/spec-known Boot-ROM sequence \(not observed hardware\)/);
});

check('fault evidence survives a local-storage reload with separate ROM and observed words', () => {
    const persistSrc = runner.slice(runner.indexOf('const _FAULT_LOG_FIELDS ='),
        runner.indexOf('function _clearRestoredFaultLogAfterGoodStep'));
    let serialized = null;
    const context = {
        sim: { faultLog: [{
            type: 'BOOT_BINDING', message: 'stale CR0 home', faultRawWord: 0xDEADBEEF,
            observed_instr_word: 0xA5A5A5A5,
            bootEvidence: {
                attemptId: 4, bootRomAddress: 2, instructionWord: 0x10700000,
                provenanceGT: 0, slot: 0, sequence: 0,
            },
        }] },
        localStorage: {
            setItem: (_key, value) => { serialized = value; },
            removeItem: () => {},
        },
        _FAULT_LOG_LS_KEY: 'test-fault-log',
        Number, Object, JSON,
    };
    vm.runInNewContext(persistSrc + '\n_saveFaultLog();', context);
    const restored = JSON.parse(serialized)[0];
    assert.strictEqual(restored.faultRawWord, 0xDEADBEEF);
    assert.strictEqual(restored.observed_instr_word, 0xA5A5A5A5);
    assert.deepStrictEqual(restored.bootEvidence, {
        attemptId: 4, bootRomAddress: 2, instructionWord: 0x10700000,
        provenanceGT: 0, slot: 0, sequence: 0,
    });
});

check('saved Prepare refreshes only the next-reset image cache', () => {
    const child = `
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync('simulator/app-abstractions.js', 'utf8');
const start = source.indexOf('async function savePreparedBootEntry(');
if (start < 0) throw new Error('savePreparedBootEntry missing');
let depth = 0, begun = false, end = -1;
for (let i = start; i < source.length; i++) {
  if (source[i] === '{') { depth++; begun = true; }
  if (source[i] === '}' && begun && --depth === 0) { end = i + 1; break; }
}
const save = source.slice(start, end);
let posted = null, cacheRefreshes = 0, noted = null, status = null, statusMessage = null;
const context = {
  bootEntrySlot: 6, _bootEntrySelectionRevision: 0, _bootEntryPreparation: { binding: null },
  window: {
    _setActiveBootConfig: () => {},
    _refreshCommittedBootImageCache: async () => { cacheRefreshes++; context.window.bootImage = new ArrayBuffer(8); },
    BootEntryUI: { noteImagePreparation: value => { noted = value; } },
  },
  fetch: async (url, options) => {
    if (!options || !options.method) return { ok: true, json: async () => ({ config: {
      targetBoard: 'sim', step1: { totalNamespaceWords: 1024 }, step2: { lumps: [] }, step3: { emptySlotCount: 0 }
    } }) };
    posted = JSON.parse(options.body);
    return { ok: true, json: async () => ({ ok: true, prepared: true, config: posted,
      preparation: { status: 'prepared', configuredSlot: 6 } }) };
  },
  _setBootEntryPreparation: (_slot, next, message) => { status = next; statusMessage = message; },
  _bootBindingFingerprint: () => null,
  _bootEntryMessage: e => e && (e.message || e.reason || e.error),
  renderAbstractions: () => {},
  Number, Error, JSON,
};
vm.runInNewContext(save + '; promise = savePreparedBootEntry();', context);
(async () => {
  const saved = await context.promise;
  assert.strictEqual(saved, true, 'save failed with UI status: ' + status + ' ' + statusMessage);
  assert.strictEqual(posted.bootEntrySlot, 6);
   assert.strictEqual(posted.prepareBootEntry, true);
  assert.strictEqual(cacheRefreshes, 1);
  assert.ok(context.window.bootImage instanceof ArrayBuffer);
  assert.strictEqual(noted.status, 'prepared');
  assert.notStrictEqual(status, 'cache-error');
})().catch(error => { console.error(error.stack || error); process.exit(1); });
`;
    childProcess.execFileSync(process.execPath, ['-e', child], {
        cwd: path.resolve(__dirname, '..'), stdio: 'pipe',
    });
});

check('an older async save cannot overwrite a newer prepared selection status', () => {
    const child = `
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync('simulator/app-abstractions.js', 'utf8');
const start = source.indexOf('async function savePreparedBootEntry(');
let depth = 0, begun = false, end = -1;
for (let i = start; i < source.length; i++) {
  if (source[i] === '{') { depth++; begun = true; }
  if (source[i] === '}' && begun && --depth === 0) { end = i + 1; break; }
}
const save = source.slice(start, end);
let resolvePost, noted = null, status = null;
const context = {
  bootEntrySlot: 6, _bootEntrySelectionRevision: 0, _bootEntryPreparation: { binding: null },
  window: {
    _setActiveBootConfig: () => {},
    _refreshCommittedBootImageCache: async () => {},
    BootEntryUI: { noteImagePreparation: value => { noted = value; } },
  },
  fetch: async (_url, options) => {
    if (!options || !options.method) return { ok: true, json: async () => ({ config: {
      targetBoard: 'sim', step1: { totalNamespaceWords: 1024 }, step2: {}, step3: {}
    } }) };
    return new Promise(resolve => { resolvePost = () => resolve({
      ok: true, json: async () => ({ ok: true, prepared: true, config: {},
        preparation: { status: 'prepared', configuredSlot: 6 } }),
    }); });
  },
  _setBootEntryPreparation: (_slot, next) => { status = next; },
  _bootBindingFingerprint: () => null,
  _bootEntryMessage: e => e && (e.message || e.reason || e.error),
  renderAbstractions: () => {}, Number, Error, JSON,
};
vm.runInNewContext(save + '; promise = savePreparedBootEntry();', context);
(async () => {
  while (!resolvePost) await new Promise(resolve => setImmediate(resolve));
  context.bootEntrySlot = 7;
  context._bootEntrySelectionRevision = 1;
  resolvePost();
  assert.strictEqual(await context.promise, true);
  assert.strictEqual(status, 'stale-image');
  assert.strictEqual(noted, null);
})().catch(error => { console.error(error.stack || error); process.exit(1); });
`;
    childProcess.execFileSync(process.execPath, ['-e', child], {
        cwd: path.resolve(__dirname, '..'), stdio: 'pipe',
    });
});

check('Namespace Save submits prepared config with NS bytes atomically and refreshes cache', () => {
    const saveNs = memoryUi.slice(memoryUi.indexOf('window._nsTableSave = async function'),
        memoryUi.indexOf('// ── NS label click'));
    assert.match(saveNs, /nsSavePreparedSelection/);
    assert.match(saveNs, /boot_config:\s*bootConfigCandidate/);
    assert.match(saveNs, /_refreshCommittedBootImageCache\(\)/);
    assert.match(saveNs, /data\.config/);
    assert.match(saveNs, /!nsSavePreparedSelection/);
});

check('instant, animated, and manual Step boot entrypoints block factory fallback', () => {
    const bootGuards = runner.slice(runner.indexOf('function _recordUnreportedBootFailure'),
        runner.indexOf('function slowBoot()'));
    const slowSrc = extract(runner, 'slowBoot');
    const stepSrc = extract(runner, 'stepSim');
    const invoke = source => {
        const sim = new ChurchSimulator();
        const consoleEl = { textContent: '', scrollTop: 0 };
        const context = {
            sim,
            window: {
                bootImage: null, bootImageAvailable: false,
                TargetState: { authorize: () => ({ ok: true }) },
                BootEntryUI: { noteImagePreparation: () => {} },
            },
            document: { getElementById: () => consoleEl },
            console: { error: () => {} },
            bootAnimating: false, _bootAnimTimer: null, _bootAuditAccum: [],
            pipelineViz: null, _pendingSimLoad: null,
            updateDashboard: () => {}, switchView: () => {}, openCRDetail: () => {},
            _syncPullToRefreshGuard: () => {},
            Number, String, Math, setTimeout, clearTimeout,
        };
        vm.runInNewContext(bootGuards + '\n' + source, context);
        return { sim, consoleEl, context };
    };
    const instant = invoke('result = instantBoot();');
    assert.strictEqual(instant.context.result, false);
    assert.strictEqual(instant.sim.bootComplete, false);
    assert.strictEqual(instant.sim.faultLog.at(-1).type, 'BOOT_IMAGE');
    assert.match(instant.consoleEl.textContent, /factory image is never substituted/);

    const animated = invoke(slowSrc + '\nslowBoot();');
    assert.strictEqual(animated.sim.bootComplete, false);
    assert.strictEqual(animated.sim.faultLog.at(-1).type, 'BOOT_IMAGE');

    const stepped = invoke(stepSrc + '\nstepSim();');
    assert.strictEqual(stepped.sim.bootComplete, false);
    assert.strictEqual(stepped.sim.faultLog.at(-1).type, 'BOOT_IMAGE');
});

check('cached synthetic NS7 image drives all positive boot entrypoints in exactly three steps', () => {
    // Start with the real simulator's canonical in-memory namespace, then
    // construct a deterministic resident NS7 body from its real SelfTest body.
    // This avoids test-only filesystem/server configuration while still using
    // core validation, `prepareBootEntry`, reset, and binary reload end-to-end.
    const seed = new ChurchSimulator();
    const selfTest = seed.readNSEntry(6);
    const ns7 = seed.readNSEntry(7);
    seed.memory.copyWithin(ns7.word0_location, selfTest.word0_location,
        selfTest.word0_location + 64);
    for (const slot of [6, 7]) {
        const entry = seed.readNSEntry(slot);
        const base = entry.word0_location;
        const header = seed.parseLumpHeader(seed.memory[base]);
        const selfGT = seed.createGT(seed.parseNSWord1(entry.word1_limit).gtSeq,
            slot, { E: 1 }, 1);
        seed.memory[base] = (seed.memory[base] & ~0xFF) | 1;
        seed.memory[base + header.lumpSize - 1] = selfGT;
        seed.memory[seed._nsSlotBase(slot) + 3] = selfGT;
    }
    assert.strictEqual(seed.prepareBootEntry(7).ok, true);
    const committedNs7Image = seed.memory.slice().buffer;
    const bootGuards = runner.slice(runner.indexOf('function _recordUnreportedBootFailure'),
        runner.indexOf('function slowBoot()'));
    const slowSrc = extract(runner, 'slowBoot');
    const stepSrc = extract(runner, 'stepSim');

    const invoke = (entrySource, entryCall) => {
        const consoleEl = { textContent: '', scrollTop: 0 };
        const sim = new ChurchSimulator();
        assert.strictEqual(sim.loadBootImage(committedNs7Image), true);
        // This is the same reset/reload sequence used by the explicit Boot
        // path; it proves the cached image, rather than constructor memory,
        // remains authoritative after reset.
        sim.reset();
        assert.strictEqual(sim.loadBootImage(committedNs7Image), true);
        const context = {
            window: {
                bootImage: committedNs7Image,
                bootImageAvailable: true,
                TargetState: { authorize: () => ({ ok: true }) },
                BootEntryUI: { noteImagePreparation: () => {} },
                _startupDefaultView: null,
            },
            sim,
            console: { error: () => {}, log: () => {} },
            document: { getElementById: () => consoleEl },
            Uint32Array, ArrayBuffer, DataView, Math, Number, JSON, Set, Map,
            Object, String, Boolean, parseInt, Promise,
            bootAnimating: false, _bootAnimTimer: null, _bootAuditAccum: [],
            bootEntrySlot: 10, // a later, unsaved UI request must not replace NS7
            pipelineViz: null, _pendingSimLoad: null,
            updateDashboard: () => {}, switchView: () => {}, openCRDetail: () => {},
            runSimGo: () => {}, _setEntryBreakpoint: () => {},
            _syncPullToRefreshGuard: () => {},
            _autoLoadDefaultProgram: () => {},
            _startBootLumpPrefetch: () => Promise.resolve(),
            setTimeout: fn => { fn(); return 1; }, clearTimeout: () => {},
        };
        vm.runInNewContext(`
            bootCalls = 0;
            originalBootStep = sim._bootStep.bind(sim);
            sim._bootStep = function() { bootCalls++; return originalBootStep(); };
        ` + bootGuards + '\n' + entrySource + '\n' + entryCall, context);
        assert.strictEqual(context.sim.bootComplete, true);
        assert.strictEqual(context.sim.halted, false);
        assert.strictEqual(context.bootCalls, 3);
        assert.strictEqual(context.sim.inspectBootEntryBinding().targetSlot, 7);
        assert.strictEqual(context.bootEntrySlot, 10);
    };

    invoke('', 'result = instantBoot();');
    invoke(slowSrc, 'slowBoot();');
    invoke(stepSrc, 'stepSim(); stepSim(); stepSim();');
});

console.log(`\n${passed} Task #3447 UI checks passed`);