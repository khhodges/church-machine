'use strict';
// VM-only controller checks. No HTTP, filesystem mutation or live simulator.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const run = fs.readFileSync(__dirname + '/app-run.js', 'utf8');
const memory = fs.readFileSync(__dirname + '/app-memory.js', 'utf8');
const shell = fs.readFileSync(__dirname + '/app-shell.js', 'utf8');
function fn(source, name) {
    const match = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
    assert(match, name);
    const end = source.indexOf('\n}', match.index);
    assert(end > match.index, name);
    return source.slice(match.index, end + 2);
}
const calls = [];
const draft = { words: [42] };
const context = {
    window: {
        TargetState: { authorize: () => ({ ok: true }) },
        bootImage: new ArrayBuffer(16), bootImageAvailable: true,
        _refreshCommittedBootImageCache() { throw new Error('shared image requested'); },
    },
    sim: { bootComplete: true, _bootImageLoaded: true, simulationConfiguration: null },
    document: { getElementById: () => null },
    _idx1AdmissionInFlight: false, walkRunning: false, bootAnimating: false,
    _simRunActive: false, _bootAnimTimer: null, _lastFault: null,
    _pendingSimLoad: true, _pendingSimLoadSnapshot: draft,
    localStorage: { removeItem() {} }, _FAULT_LOG_LS_KEY: 'test',
    pipelineViz: { setNIA() {}, reset() {} },
    faultAlertOff() {}, switchView() {}, _clearLumpPetNames() {}, updateDashboard() {},
    _blockBootForMissingCommittedImage(name) { calls.push(name); return false; },
    _showBootPreparationBlocked(name) { calls.push(name); },
    fetch() { throw new Error('unexpected fetch'); },
    console, Promise,
};
vm.createContext(context);
for (const name of ['_bootHasCommittedImage', '_ensureCommittedImageForBoot',
    '_requireCommittedImageForExecution', 'stepSim', 'runSimGo', 'runSim',
    'walkToggle', 'resetSim', '_applyPendingSimLoad', '_autoLoadDefaultProgram',
    '_startBootLumpPrefetch', 'updateThreadControl']) {
    vm.runInContext(fn(run, name), context);
}
for (const name of ['_probeBootImage', '_refreshCommittedBootImageCache', '_maybeApplyBootImage']) {
    vm.runInContext(fn(memory, name), context);
}
(async () => {
    const threadBadge = { textContent: '' };
    context.document.getElementById = id => id === 'activeThreadStatus' ? threadBadge : null;
    context.sim.activeThreadStatus = () => ({ name: 'Thread.1', position: 1, count: 1, lifecycleStatus: 'running' });
    context.updateThreadControl();
    assert.strictEqual(threadBadge.textContent, 'No simulation activated · stopped',
        'factory runnable thread is not evidence of activated execution');
    context.window.TargetState.resolve = () => ({ mode: 'wukong-runtime-ram', ok: false });
    context.updateThreadControl();
    assert.strictEqual(threadBadge.textContent, 'Hardware target · unresolved',
        'inactive simulator must not report hardware stopped or running');
    context.window.TargetState.resolve = () => ({ mode: 'simulator-ram', ok: true });
    assert.strictEqual(context._bootHasCommittedImage(), false, 'global cache and bootComplete are not approval');
    await context.stepSim();
    await context.runSimGo();
    context.runSim();
    context.walkToggle();
    assert.strictEqual(context.resetSim(), false);
    assert.deepStrictEqual(calls, ['Step', 'Run', 'Run', 'Walk', 'Reset']);
    assert.strictEqual(await context._probeBootImage(), null);
    await assert.rejects(context._refreshCommittedBootImageCache(), /does not activate/);
    context._maybeApplyBootImage();
    assert(!shell.includes('_probeBootImage().then'), 'startup has no disk-image race');
    assert(!shell.includes("sim.on('reset', _maybeApplyBootImage)"));

    context.sim.simulationConfiguration = { configurationHash: 'approved' };
    context.updateThreadControl();
    assert.strictEqual(threadBadge.textContent, 'Thread.1 · 1/1 · running',
        'activated simulation keeps the architectural Thread lifecycle display');
    context.sim.resetPreparedSimulation = () => {
        calls.push('retained-reset');
        context.sim.bootComplete = false;
    };
    assert.strictEqual(context._requireCommittedImageForExecution('Resume'), true);
    await context._applyPendingSimLoad();
    context._autoLoadDefaultProgram();
    await context._startBootLumpPrefetch();
    assert.strictEqual(context._pendingSimLoadSnapshot, draft, 'draft is not consumed or discarded');
    assert.strictEqual(context.resetSim(), true);
    assert.strictEqual(context.sim.bootComplete, false, 'Reset does not execute boot');
    assert.strictEqual(calls.at(-1), 'retained-reset');
    context._simRunActive = true;
    assert.strictEqual(context.resetSim(), false, 'running context cannot be reset by a racing action');
    console.log('simulation controller isolation checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });