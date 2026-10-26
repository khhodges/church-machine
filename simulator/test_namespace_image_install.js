'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('simulator/app-build-approval.js', 'utf8');
const start = source.indexOf('    async installSelectedImage()');
const method = source.slice(start, source.indexOf('    _revisionChoice(', start));

async function check(mode) {
    const calls = [], confirmations = [];
    const status = {textContent: '', appendChild(link) { this.link = link; }};
    const original = 'a'.repeat(64);
    let view;
    const context = vm.createContext({
        document: {getElementById: () => status, createElement: () => ({})},
        window: {confirm(text) { confirmations.push(text); return mode !== 'cancel'; }},
        fetch: async (url, options) => {
            calls.push({url, options});
            if (url === '/hardware/wukong/status') {
                // An asynchronous selector change must not redirect this click.
                if (mode === 'selection-change')
                    view._selectedSnapshot.namespace_revision_id = 'b'.repeat(64);
                return {ok: true, json: async () => ({physical_target: {
                    live: mode !== 'offline', device_uid: 'board-test', session_id: 'session-test',
                }})};
            }
            assert.equal(url, '/api/namespace-image/install');
            assert.equal(options.headers.Authorization, 'Bearer dummy-test-token');
            assert.deepEqual(JSON.parse(options.body), {
                namespace_revision_id: original, target_device_uid: 'board-test',
                target_session_id: 'session-test',
            });
            return {ok: mode !== 'denied', json: async () => mode === 'denied'
                ? {error: 'Unauthorized'} : {queued: true, namespace_revision_id: original, id: 17}};
        },
    });
    view = vm.runInContext('({' + method + '})', context);
    view._selectedSnapshot = {_unused: true, namespace_revision_id: original};
    view._authHeaders = () => ({Authorization: 'Bearer dummy-test-token'});
    view._updateApproveBtn = () => {};
    await view.installSelectedImage();
    assert.equal(view._installRunning, false);
    if (mode === 'offline' || mode === 'cancel') {
        assert.equal(calls.length, 1, 'no mutation request');
    } else {
        assert.equal(calls.length, 2);
        assert.match(confirmations[0], /discards data and Thread progress/);
        if (mode === 'denied') {
            assert.match(status.textContent, /Unauthorized/);
            assert(!status.link);
        } else {
            assert.match(status.textContent, /installation is not yet confirmed/);
            assert.equal(status.link.href, '/fpga?namespace_revision=' + original);
        }
    }
}
(async () => {
    for (const mode of ['success', 'selection-change', 'cancel', 'offline', 'denied'])
        await check(mode);
    console.log('PASS exact selected image UI: pinned selection, confirmation, cancellation, offline, authorization');
})().catch(error => {console.error(error); process.exitCode = 1;});
