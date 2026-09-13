'use strict';

// Focused Task #3446 step-5 coverage.  The deploy action must expose only the
// supported Wukong bridge/server Runtime Upload path.  Diagnostic UART probing
// remains a separate action, but the old direct-upload implementation must not
// be reachable from the deploy handler.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
const start = source.indexOf('async function uploadToTang()');
const end = source.indexOf('\nasync function testUART()', start);
if (start < 0 || end < 0) throw new Error('hardware upload action boundaries not found');
const uploadSource = source.slice(start, end);

function check(condition, message) {
    if (!condition) throw new Error(message);
    console.log('✓ ' + message);
}

check(!uploadSource.includes('TangSerial'), 'deploy action does not call direct WebSerial');
check(!uploadSource.includes('runTuringSimGate'), 'deploy action has no unreachable non-Wukong simulation gate');
check(!uploadSource.includes('exportHardwareImage'), 'deploy action does not export the legacy UART image');
check(!source.includes('function runTuringSimGate'),
    'unreachable pre-flash gate implementation is removed');
check(uploadSource.includes('_wukongLoadToHardware'),
    'deploy action routes supported hardware through Wukong upload');
check(uploadSource.includes('authorizeDestination'),
    'deploy action requires the programming-target service');
check(uploadSource.includes('No hardware request was made'),
    'unsupported and unresolved targets explain that no hardware request was made');
check(source.includes("authorizeDestination('runtime')"),
    'Wukong loader retains destination authorization');
check(source.includes('forHardware: true') &&
    source.includes('artifact_sha256') &&
    source.includes('artifact_identity'),
    'Wukong loader retains hardware artifact and ACK integrity gates');

function makeEnv(board, target) {
    const consoleElement = { textContent: '' };
    let loadCalls = 0;
    const sandbox = {
        console,
        window: {
            TargetState: {
                MODES: { RUNTIME: 'wukong-runtime-ram' },
                resolve: function() { return target; },
                authorizeDestination: function() { return { ok: true }; },
            },
        },
        document: {
            getElementById: function(id) {
                return id === 'editorConsole' ? consoleElement : null;
            },
        },
        requirePermission: function() { return true; },
        switchView: function() {},
        switchCodeTab: function() {},
        getSelectedBoard: function() { return board; },
        getBoardLabel: function() { return board === 'wukong-xc7a100t'
            ? 'QMTECH Wukong (Artix-7)' : 'Sipeed Tang Nano 20K'; },
        _wukongLoadToHardware: async function() { loadCalls++; },
    };
    vm.createContext(sandbox);
    vm.runInContext(uploadSource + '\nthis.__uploadToTang = uploadToTang;', sandbox);
    return {
        consoleElement,
        get loadCalls() { return loadCalls; },
        invoke: function() { return sandbox.__uploadToTang(); },
    };
}

(async function() {
    const supported = makeEnv('wukong-xc7a100t', {
        mode: 'wukong-runtime-ram',
        reason: 'Selected Wukong is live',
    });
    await supported.invoke();
    check(supported.loadCalls === 1,
        'live Wukong Runtime Upload invokes the bridge/server loader');
    check(/Wukong Runtime Upload/.test(supported.consoleElement.textContent),
        'supported transport is named in the deploy status');

    const unresolved = makeEnv('wukong-xc7a100t', {
        mode: 'simulator-ram',
        reason: 'Simulator RAM selected',
    });
    await unresolved.invoke();
    check(unresolved.loadCalls === 0,
        'non-runtime target blocks upload before any loader call');
    check(/select Wukong RAM/.test(unresolved.consoleElement.textContent) &&
        /No hardware request was made/.test(unresolved.consoleElement.textContent),
    'missing runtime prerequisite is actionable and fail-closed');

    const absent = makeEnv('wukong-xc7a100t', null);
    await absent.invoke();
    check(absent.loadCalls === 0 &&
        /no runtime target selected/.test(absent.consoleElement.textContent) &&
        /No hardware request was made/.test(absent.consoleElement.textContent),
    'absent target resolution blocks upload before any request');

    const stale = makeEnv('wukong-xc7a100t', {
        mode: 'wukong-runtime-ram',
        ok: false,
        reason: 'Unresolved: selected Wukong session is stale',
    });
    await stale.invoke();
    check(stale.loadCalls === 0 &&
        /resolve the live Wukong prerequisite/.test(stale.consoleElement.textContent) &&
        /session is stale/.test(stale.consoleElement.textContent),
    'stale live session is reported before any upload request');

    const unsupported = makeEnv('tang-nano-20k-iot', {
        mode: 'wukong-runtime-ram',
        reason: 'Selected Wukong is live',
    });
    await unsupported.invoke();
    check(unsupported.loadCalls === 0,
        'unsupported board does not invoke the Wukong loader');
    check(/Direct WebSerial/.test(unsupported.consoleElement.textContent) &&
        /not supported/.test(unsupported.consoleElement.textContent),
    'unsupported transport is stated truthfully');

    console.log('hardware-upload-surface: all assertions passed');
})().catch(function(error) {
    console.error(error);
    process.exitCode = 1;
});