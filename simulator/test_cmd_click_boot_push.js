// test_cmd_click_boot_push.js — simulator boot selection stays software-only
//
// Verifies the production setBootEntrySlot behavior after physical Wukong
// controls moved exclusively to Builder > Testing:
//
//   CP-1  Plain click changes only the simulator entry
//   CP-2  Cmd+click still changes only the simulator entry
//   CP-3  Ctrl+click still changes only the simulator entry
//   CP-4  No modifier path creates upload badges or calls hardware endpoints
//
// Run with:  node simulator/test_cmd_click_boot_push.js
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { JSDOM } = require('jsdom');

// ── Source extraction ─────────────────────────────────────────────────────────

function extractBlock(srcPath, startMarker, endMarker, includeEnd) {
    const src = fs.readFileSync(path.resolve(__dirname, srcPath), 'utf8');
    const start = src.indexOf(startMarker);
    if (start === -1) throw new Error(startMarker + ' not found in ' + srcPath);
    const end = src.indexOf(endMarker, start);
    if (end === -1) throw new Error(endMarker + ' not found after start marker in ' + srcPath);
    return src.slice(start, includeEnd ? end + endMarker.length : end);
}

const ABS_SRC = extractBlock(
    'app-abstractions.js',
    'function setBootEntrySlot(',
    'window._pushBootEntryToHardware = _pushBootEntryToHardware;',
    true);

// Include the shared board-command helpers (_wukongCmdBusy, _wukongPostCmd,
// _wukongWatchDelivery, _wukongCmdLog) that _wukongLoadToHardware's step-4
// RUN verification depends on.
const LOAD_SRC = extractBlock(
    'app-run.js',
    '// ── Board-command helpers',
    '\nfunction _preSeedConventionsFromLumps',
    false);

// ── Fixture ───────────────────────────────────────────────────────────────────

function makeEnv(opts) {
    opts = opts || {};
    const dom = new JSDOM(
        '<!DOCTYPE html><body>' +
        '<span id="boltAnchor">\u26a1</span>' +
        '<div id="editorConsole"></div>' +
        '</body>',
        { runScripts: 'outside-only' });
    const window   = dom.window;
    const document = window.document;

    const fetchCalls = [];
    let lastCmdId = 0;
    const fetchImpl = async function(url, init) {
        fetchCalls.push({
            url : url,
            body: init && init.body ? JSON.parse(init.body) : null,
        });
        if (url === '/api/boot-image/generate') {
            return opts.generateFails
                ? { ok: false, status: 500, json: async () => ({ error: 'boom' }) }
                : { ok: true, json: async () => ({ ok: true }) };
        }
        if (url === '/api/boot-image/send-to-hardware') {
            return { ok: true, json: async () => ({ ok: true, size: 4096 }) };
        }
        if (url === '/hardware/wukong/upload-ack') {
            return { ok: true, json: async () => ({ ok: true }) };
        }
        if (url === '/hardware/wukong/command') {
            lastCmdId += 1;
            return { ok: true, json: async () => ({ ok: true, id: lastCmdId }) };
        }
        if (url === '/hardware/wukong/status') {
            // Model the bridge confirming the serial write for the last command.
            const id = lastCmdId;
            return { ok: true, json: async () => ({
                bridge_connected: true,
                command_delivery: { id: id, consumed_ts: 1, write_ts: 2, write_ok: true },
            }) };
        }
        throw new Error('unexpected fetch: ' + url);
    };

    const storage = {};
    const sandbox = {
        window: window,
        document: document,
        console: { log: function() {} },
        setTimeout: setTimeout,
        Date: Date,
        Promise: Promise,
        JSON: JSON,
        Math: Math,
        Number: Number,
        String: String,
        Array: Array,
        localStorage: {
            setItem: function(k, v) { storage[k] = v; },
            getItem: function(k) { return storage[k]; },
        },
        fetch: fetchImpl,
        fetchCalls: fetchCalls,

        // ── simulator + registry stubs ──
        bootEntrySlot: 6,
        currentView: 'editor',
        renderAbstractions: function() {},
        updateNamespace: function() {},
        abstractionRegistry: { abstractions: {} },
        THREAD_CAPS_OFFSET: 244,
        sim: {
            bootEntrySlot: 6,
            memory: new Array(4096).fill(0),
            output: '',
            createGT: function() { return 0x4A000000; },
            _nsSlotBase: function() { return 100; },
            readNSEntry: function() { return { word0_location: 0x200, word1_limit: 16 }; },
            nsLabels: {},
            emit: function() {},
        },

        // ── hardware stubs ──
        _wukongIsConnected: function() { return !!opts.connected; },
        _wukongHWRunning: false,
        _wukongUpdateBtn: function() {},
        _syncSelfTestNextGtToBootEntry: function() {},
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(LOAD_SRC, sandbox);
    vm.runInContext(ABS_SRC, sandbox);
    return sandbox;
}

function makeEvent(env, mods) {
    const anchor = env.document.getElementById('boltAnchor');
    return Object.assign({ target: anchor, metaKey: false, ctrlKey: false }, mods || {});
}

// Wait until the async push settles (a final ok/err/warn badge exists) or timeout.
async function waitForFinalBadge(env, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 5000);
    while (Date.now() < deadline) {
        const done = env.document.querySelector(
            '.boot-push-badge-ok, .boot-push-badge-err, .boot-push-badge-warn');
        if (done) return done;
        await new Promise(res => setTimeout(res, 25));
    }
    return null;
}

// ── Test harness ──────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
function assert(cond, label) {
    if (cond) { passed++; console.log('  \u2713 ' + label); }
    else      { failed++; console.error('  \u2717 FAIL: ' + label); }
}

(async function main() {

    console.log('CP-1  Plain click → no hardware calls');
    {
        const env = makeEnv({ connected: true });
        vm.runInContext('setBootEntrySlot(3, __ev)',
            Object.assign(env, { __ev: makeEvent(env) }));
        await new Promise(res => setTimeout(res, 100));
        assert(env.fetchCalls.length === 0, 'no fetches after plain click');
        assert(env.sim.bootEntrySlot === 3, 'simulator boot entry updated to 3');
        assert(!env.document.querySelector('.boot-push-badge'), 'no badge shown');
    }

    console.log('CP-2  Cmd+click + connected remains software-only');
    {
        const env = makeEnv({ connected: true });
        vm.runInContext('setBootEntrySlot(5, __ev)',
            Object.assign(env, { __ev: makeEvent(env, { metaKey: true }) }));
        await new Promise(res => setTimeout(res, 100));
        assert(env.fetchCalls.length === 0, 'Cmd+click makes no hardware requests');
        assert(env.sim.bootEntrySlot === 5, 'simulator boot entry updated to 5');
        assert(!env.document.querySelector('.boot-push-badge'), 'Cmd+click shows no hardware badge');
    }

    console.log('CP-3  Ctrl+click remains software-only');
    {
        const env = makeEnv({ connected: true });
        vm.runInContext('setBootEntrySlot(4, __ev)',
            Object.assign(env, { __ev: makeEvent(env, { ctrlKey: true }) }));
        await new Promise(res => setTimeout(res, 100));
        assert(env.fetchCalls.length === 0, 'Ctrl+click makes no hardware requests');
        assert(env.sim.bootEntrySlot === 4, 'simulator boot entry updated to 4');
        assert(!env.document.querySelector('.boot-push-badge'), 'Ctrl+click shows no hardware badge');
    }

    console.log('CP-4  Modifier behavior is independent of board connectivity');
    {
        const env = makeEnv({ connected: false });
        vm.runInContext('setBootEntrySlot(2, __ev)',
            Object.assign(env, { __ev: makeEvent(env, { metaKey: true }) }));
        await new Promise(res => setTimeout(res, 100));
        assert(env.fetchCalls.length === 0, 'no hardware fetches without a board');
        assert(!env.document.querySelector('.boot-push-badge'), 'no board-status badge on simulator');
        assert(env.sim.bootEntrySlot === 2, 'simulator entry still updated');
    }

    console.log('');
    console.log(passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
})().catch(function(e) {
    console.error('UNCAUGHT: ' + (e && e.stack || e));
    process.exit(1);
});
