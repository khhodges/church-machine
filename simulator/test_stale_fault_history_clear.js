// test_stale_fault_history_clear.js — restored faults must not masquerade as live faults
//
// Run: node simulator/test_stale_fault_history_clear.js

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appRun = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
const appShell = fs.readFileSync(path.join(__dirname, 'app-shell.js'), 'utf8');

let passed = 0;
let failed = 0;
function check(label, condition, detail = '') {
    if (condition) {
        console.log(`PASS ${label}`);
        passed++;
    } else {
        console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
        failed++;
    }
}

const marker = 'let _restoredFaultLogAwaitingGoodStep = false;';
const helperStart = appRun.indexOf(marker);
const helperEnd = appRun.indexOf('\nfunction _restoreFaultLog()', helperStart);
check('helper is present in app-run', helperStart !== -1 && helperEnd !== -1);

if (helperStart !== -1 && helperEnd !== -1) {
    const savedKeys = [];
    let alertsCleared = 0;
    let gateLogUpdates = 0;
    const staleFault = { type: 'RANGE', step: 53 };
    const context = {
        sim: { faultLog: [staleFault], halted: false },
        _lastFault: staleFault,
        _clearAllFaultNotes: () => savedKeys.push('fault-history'),
        faultAlertOff: () => { alertsCleared++; },
        updateGateLog: () => { gateLogUpdates++; },
    };
    vm.createContext(context);
    vm.runInContext(appRun.slice(helperStart, helperEnd), context, {
        filename: 'app-run-stale-fault-helper.js',
    });

    check('does nothing until history is marked restored',
        context._clearRestoredFaultLogAfterGoodStep() === false &&
        context.sim.faultLog.length === 1);

    vm.runInContext('_restoredFaultLogAwaitingGoodStep = true;', context);
    check('first good execution clears restored fault records',
        context._clearRestoredFaultLogAfterGoodStep() === true &&
        context.sim.faultLog.length === 0 &&
        context._lastFault === null);
    check('clearing restored history also removes saved diagnostics',
        savedKeys.length === 1 && alertsCleared === 1 && gateLogUpdates === 1);
    check('second good execution is idempotent',
        context._clearRestoredFaultLogAfterGoodStep() === false &&
        savedKeys.length === 1);

    context.sim.faultLog = [{ type: 'LIVE_FAULT', step: 1 }];
    context.sim.halted = true;
    vm.runInContext('_restoredFaultLogAwaitingGoodStep = true;', context);
    check('never clears history while the current simulator is halted',
        context._clearRestoredFaultLogAfterGoodStep() === false &&
        context.sim.faultLog.length === 1);
}

check('only normal retired instructions trigger restored-history cleanup',
    appShell.includes("const retiredNormally = result && !result.absent && !result.suspended") &&
    appShell.includes('_clearRestoredFaultLogAfterGoodStep();'));

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;