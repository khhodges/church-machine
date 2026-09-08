'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let now = 1000;
let fetches = 0;
let saved = 0;
let fetchedUrl = null;
const listeners = {};
const document = {
    addEventListener: function(type, fn) { (listeners[type] ||= []).push(fn); },
    getElementById: function() { return null; },
    querySelectorAll: function() { return []; },
    createElement: function() {
        return {
            href: '', download: '', dataset: {},
            click: function() { saved++; },
            remove: function() {},
        };
    },
    body: { appendChild: function() {} },
};
const sandbox = {
    window: null, document, console, Blob, URL,
    Date: { now: function() { return now; } },
    localStorage: { getItem: function() { return null; }, setItem: function() {} },
    sessionStorage: { getItem: function() { return null; }, setItem: function() {} },
    setInterval, clearInterval, setTimeout, clearTimeout,
    fetch: async function(url) {
        fetches++;
        fetchedUrl = new URL(url);
        const parsed = fetchedUrl;
        return {
            ok: true,
            headers: { get: function(name) {
                if (name === 'X-Wukong-Provenance-Identity') {
                    return parsed.searchParams.get('artifact_identity');
                }
                if (name === 'X-Wukong-Artifact-SHA256') {
                    return parsed.searchParams.get('sha256');
                }
                return null;
            } },
            blob: async function() { return new Blob(['bit']); },
        };
    },
};
sandbox.window = sandbox;
sandbox.location = { origin: 'https://ide.example' };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'target-state.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'app-build-approval.js'), 'utf8'), sandbox);

const target = sandbox.TargetState;
const view = sandbox.BuildApprovalView;
const identity = 'wukong-bit:v1:' + 'a'.repeat(64);
const digest = 'b'.repeat(64);
const link = {
    dataset: { buildId: identity, sha256: digest },
    download: 'exact.bit',
    closest: function(selector) {
        return selector === '[data-exact-bitstream-download]' ? this : null;
    },
    getAttribute: function() {
        return '/dl/wukong-bit?provenance_identity=' + encodeURIComponent(identity) +
            '&sha256=' + digest;
    },
};
function event() { return { preventDefault: function() {} }; }
function check(ok, message) {
    if (!ok) throw new Error(message);
    console.log('✓ ' + message);
}

(async function() {
    check(await view.downloadExactBitstream(event(), link) === false && fetches === 0,
        'actual handler blocks Simulator mode before fetch');
    target.select({ mode: target.MODES.BITSTREAM, deviceUid: 'board-a', buildId: identity });
    target.observeDevice({ uid: 'board-a', sessionId: 'session-a', connected: true });
    now += 30001;
    check(await view.downloadExactBitstream(event(), link) === false && fetches === 0,
        'actual handler blocks stale target before fetch');
    target.observeDevice({ uid: 'board-b', sessionId: 'session-b', connected: true });
    check(await view.downloadExactBitstream(event(), link) === false && fetches === 0,
        'actual handler blocks mismatched live UID before fetch');
    target.observeDevice({ uid: 'board-a', sessionId: 'session-c', connected: true });
    check(await view.downloadExactBitstream(event(), link) === true &&
        fetches === 1 && saved === 1 &&
        target.resolve().buildId === identity &&
        fetchedUrl.searchParams.get('target_device_uid') === 'board-a' &&
        fetchedUrl.searchParams.get('target_session_id') === 'session-c' &&
        fetchedUrl.searchParams.get('artifact_identity') === identity &&
        fetchedUrl.searchParams.get('sha256') === digest,
        'actual handler fetches and saves exact selected target artifact');
    const clickEvent = { target: link, preventDefault: function() {} };
    check(listeners.click.length === 1 &&
        await listeners.click[0](clickEvent) === true &&
        fetches === 2 && saved === 2 &&
        fetchedUrl.searchParams.get('target_device_uid') === 'board-a' &&
        fetchedUrl.searchParams.get('target_session_id') === 'session-c',
        'rendered download link uses the authorized UID/session handler');
})().catch(function(error) {
    console.error(error);
    process.exitCode = 1;
});