'use strict';

// Isolated UI scheduler test: no machine image or user workload is executed.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require('path').join(__dirname, 'app-run.js'), 'utf8');
const html = fs.readFileSync(require('path').join(__dirname, 'index.html'), 'utf8');
function extract(name) {
    const start = source.indexOf(`function ${name}(`);
    assert(start >= 0);
    return source.slice(start, source.indexOf('\n}', start) + 2);
}
function harness(stored, storageDenied = false) {
    const queue = [];
    const storage = new Map(stored === undefined ? [] : [['church.sim.continuousRun', stored]]);
    const elements = { editorConsole: { textContent: '' }, continuousRunChk: { checked: false } };
    const outcomes = new Map();
    const calls = [];
    const sim = {
        bootComplete: true, halted: false, auditLog: [], faultLog: [], physicalPC: 0,
        stepCount: 0, output: '', nsLabels: [],
        activeThreadStatus: () => ({ slot: 1 }),
        run(n, bp) {
            calls.push(n);
            if (bp.has(42)) return { steps: 0, stopReason: 'breakpoint', breakpointAddr: 42 };
            this.stepCount += n;
            this.output += 'x'.repeat(n * 20);
            return { steps: n, stopReason: 'maxSteps' };
        },
    };
    const context = {
        window: { TargetState: { authorize: () => ({ ok: true }) },
            localStorage: {
                getItem: k => { if (storageDenied) throw new Error('denied'); return storage.get(k) ?? null; },
                setItem: (k, v) => { if (storageDenied) throw new Error('denied'); storage.set(k, v); },
            } },
        document: { getElementById: id => elements[id] || null },
        console: { log() {}, error() {} }, setTimeout: f => queue.push(f),
        sim, pipelineViz: null, runBatchSize: 500, simBreakpoints: new Set(),
        simUniversalBreakpoints: new Set(), _faultFreeInstrTotal: 0,
        _simRunHash: null, _threadRunOutcomes: outcomes,
        _bootLoadCR15BreakpointBeforeNextInstruction: () => false,
    };
    for (const name of ['_autoLoadDefaultProgram', '_showStopBtn', 'switchView', 'openCRDetail',
        'updateDashboard', 'updateThreadControl', '_consumeOneShotBreakpoint', '_saveFaultLog',
        '_updateMtbfIndicator', '_updateFaultFreeCounter', 'showNextSteps', 'showRuntimeErrorModal',
        'triggerLazyLoad', '_registerLazyResolvePending', '_reportBootLoadCR15BreakpointPause']) {
        context[name] = () => {};
    }
    vm.createContext(context);
    const settingsStart = source.indexOf("const _CONTINUOUS_RUN_KEY");
    vm.runInContext(source.slice(settingsStart, source.indexOf('let breakOnBootLoadCR15', settingsStart))
        + '\n' + extract('runSim') + '\n' + extract('stopSim'), context);
    return {
        context, sim, elements, storage, calls, queue,
        start: () => context.runSim(true),
        tick: () => { assert(queue.length, 'cooperative next batch exists'); queue.shift()(); },
        reason: () => outcomes.get(1)?.stopReason,
    };
}

const bounded = harness();
bounded.start();
bounded.tick(); bounded.tick();
assert.equal(bounded.reason(), 'faultFreeLimit');
assert.equal(bounded.sim.stepCount, 1000);
const capped = harness();
capped.context._faultFreeInstrTotal = 1000;
capped.start();
while (capped.queue.length) capped.tick();
assert.equal(capped.reason(), 'maxSteps');
assert.equal(capped.sim.stepCount, 10000);

const continuous = harness('true');
continuous.start();
assert.equal(continuous.sim.stepCount, 0, 'first batch yields');
continuous.context.setContinuousRun(false);
assert.equal(continuous.storage.get('church.sim.continuousRun'), 'false');
assert.equal(continuous.elements.continuousRunChk.checked, false);
for (let i = 0; i < 25; i++) continuous.tick();
assert.equal(continuous.sim.stepCount, 12500, 'snapshot bypasses both limits');
assert(continuous.elements.editorConsole.textContent.includes('Running continuously'));
assert(continuous.sim.output.length < 65600, 'continuous output retention bounded');
assert(continuous.calls.every(n => n === 500), 'finite cooperative batches');
continuous.context.stopSim();
continuous.tick();
assert.equal(continuous.reason(), 'userStopped');
assert.equal(continuous.queue.length, 0);
continuous.context._faultFreeInstrTotal = 0;
continuous.start(); continuous.tick(); continuous.tick();
assert.equal(continuous.reason(), 'faultFreeLimit', 'changed mode applies next start');

for (const reason of ['breakpoint', 'halted', 'error', 'lazyLoad', 'suspended', 'bootExit']) {
    const h = harness('true');
    h.sim.run = () => {
        if (reason === 'error') throw new Error('synthetic exception');
        if (reason === 'halted') { h.sim.halted = true; h.sim.faultLog.push({ type: 'TEST' }); }
        if (reason === 'lazyLoad') h.sim.awaitingLump = { token: 'test', nsIndex: 1 };
        if (reason === 'suspended') h.sim._lazySuspended = true;
        if (reason === 'bootExit') h.sim.bootComplete = false;
        return { steps: 0, stopReason: reason, breakpointAddr: 42 };
    };
    h.start(); h.tick();
    assert.equal(h.queue.length, 0, `${reason} does not restart`);
    assert.equal(h.context._simRunActive, false);
    if (!['lazyLoad', 'suspended'].includes(reason)) assert.equal(h.reason(), reason);
}
const bp = harness('true');
bp.start(); bp.tick();
bp.context.simBreakpoints.add(42);
bp.tick();
assert.equal(bp.reason(), 'breakpoint', 'live breakpoint set is retained');

const reload = harness('true');
assert.equal(vm.runInContext('continuousRun', reload.context), true);
const denied = harness(undefined, true);
assert.equal(vm.runInContext('continuousRun', denied.context), false);
assert.doesNotThrow(() => denied.context.setContinuousRun(true));
const boot = harness('true');
boot.context._bootLoadCR15BreakpointBeforeNextInstruction = () => true;
boot.start();
assert.equal(boot.queue.length, 0, 'continuous mode respects boot breakpoint');
assert.equal(boot.sim.stepCount, 0);
assert(html.includes('id="continuousRunChk" onchange="setContinuousRun(this.checked)"'));
assert(!html.match(/id="continuousRunChk"[^>]*\schecked(?:\s|>|=)/));
assert(source.includes('continuousCheckbox.checked = continuousRun'));
assert(html.includes('Run mode changes apply to the next Run.'));
assert(extract('runSimGo').includes("_requireCommittedImageForExecution('Run')"),
    'live execution gate preserved');
console.log('Continuous run synthetic scheduler and UI/persistence tests passed');