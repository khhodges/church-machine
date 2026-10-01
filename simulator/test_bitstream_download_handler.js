'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

let now = 1000;
let fetches = 0;
let saved = 0;
let fetchedUrl = null;
let returnedBytes = 'bit';
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
    window: null, document, console, Blob, URL, crypto: crypto.webcrypto,
    Date: { now: function() { return now; } },
    localStorage: { getItem: function() { return null; }, setItem: function() {} },
    sessionStorage: { getItem: function() { return null; }, setItem: function() {} },
    setInterval, clearInterval, setTimeout, clearTimeout,
    fetch: async function(url) {
        fetches++;
        fetchedUrl = new URL(url, 'https://ide.example');
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
            blob: async function() { return new Blob([returnedBytes]); },
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
    const navigated = [];
    sandbox.switchView = value => navigated.push(value);
    sandbox.switchBuilderViewTab = value => navigated.push(value);
    check(view.openRevisionHistory() === false &&
        navigated.join('/') === 'builder/build' && fetches === 0,
        'history navigation selects the approval panel without download or flashing');
    const index = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    const wizard = fs.readFileSync(path.join(__dirname, 'app-startup-wizard.js'), 'utf8');
    check(!/\/dl\/wukong-(?:zip|bit|mcs|v17|bscan|verilog)/.test(index) &&
        index.includes('Approved .mcs export unavailable') &&
        !wizard.includes('zipBtn.href = d.release.zip_download'),
        'advertised wizard/card links use approved history, not retired mutable exports');
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
    check(await view.downloadExactBitstream(event(), link) === false &&
        fetches === 0 && saved === 0,
        'even connected hardware cannot authorize a mutable legacy download');
    const clickEvent = { target: link, preventDefault: function() {} };
    check(listeners.click.length === 1 &&
        await listeners.click[0](clickEvent) === false &&
        fetches === 0 && saved === 0,
        'legacy rendered links require explicit approved revision selection');
    const revision = { approval_state: 'approved', revision_id: 'c'.repeat(64),
        sha256: crypto.createHash('sha256').update('bit').digest('hex') };
    view._bitstreamRevisions = [revision];
    view._selectedBitstream = revision;
    const before = JSON.stringify(target.resolve());
    check(await view.downloadSelectedBitstream() === true &&
        saved === 1 && fetchedUrl.pathname ===
            '/api/artifact-revisions/bitstream/' + revision.revision_id + '/download',
        'exact retained revision is independently downloadable');
    check(JSON.stringify(target.resolve()) === before,
        'download never changes target or marks hardware flashed');
    returnedBytes = 'corrupt or substituted bitstream';
    check(await view.downloadSelectedBitstream() === false && saved === 1,
        'different returned bytes fail SHA256 admission without saving');
})().catch(function(error) {
    console.error(error);
    process.exitCode = 1;
});