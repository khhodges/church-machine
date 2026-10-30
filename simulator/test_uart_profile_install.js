'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('simulator/app-build-approval.js', 'utf8');
const start = source.indexOf('    async prepareSelectedUartImage(');
const method = source.slice(start, source.indexOf('    async installSelectedImage()', start));
const revision = 'a'.repeat(64), digest = 'c'.repeat(64);

async function check(mode) {
    const calls = [], confirmations = [];
    const status = {textContent: '', appendChild() {}};
    let view;
    const context = vm.createContext({
        document: {getElementById: () => status, createElement: () => ({})},
        window: {confirm: text => { confirmations.push(text); return mode !== 'cancel'; }},
        fetch: async (url, options) => {
            calls.push(url);
            if (url === '/hardware/wukong/status') return {ok: true, json: async () => ({
                physical_target: {live: mode !== 'offline', device_uid: 'board', session_id: 'session'},
            })};
            const body = JSON.parse(options.body);
            assert.equal(body.namespace_revision_id, revision);
            assert.equal(body.profile, 'amoeba-retry-25mhz-uart-v1');
            assert.equal(options.headers.Authorization, 'Bearer fake');
            if (url.endsWith('uart-prepare')) {
                view._selectedSnapshot.namespace_revision_id = 'b'.repeat(64);
                return {ok: mode !== 'rejected', json: async () => ({
                    ok: mode !== 'rejected', error: 'Not certified',
                    namespace_revision_id: mode === 'mismatch' ? 'b'.repeat(64) : revision,
                    profile: body.profile, artifact_sha256: digest,
                    required_bitstream_sha256: 'd'.repeat(64), size: 65536,
                })};
            }
            assert.equal(url, '/api/namespace-image/uart-install');
            assert.equal(body.artifact_sha256, digest);
            assert.equal(body.confirm_runtime_memory_replacement, true);
            assert.equal(body.target_device_uid, 'board');
            assert.equal(body.target_session_id, 'session');
            return {ok: true, json: async () => ({ok: true, queued: true, id: 4,
                namespace_revision_id: revision, artifact_sha256: digest})};
        },
    });
    view = vm.runInContext(`({${method}})`, context);
    view._selectedSnapshot = {namespace_revision_id: revision};
    view._authHeaders = () => ({Authorization: 'Bearer fake'});
    view._updateApproveBtn = () => {};
    await view.prepareSelectedUartImage(mode !== 'prepare');
    assert.equal(view._installRunning, false);
    if (mode === 'prepare') {
        assert.deepEqual(calls, ['/api/namespace-image/uart-prepare']);
        assert.equal(confirmations.length, 0);
        assert.match(status.textContent, /No board commands/);
    } else if (mode === 'send') {
        assert.equal(calls.length, 3);
        assert.match(status.textContent, /installed bytes are not verified/);
        assert.match(confirmations[0], /discards Thread progress/);
    } else {
        assert(!calls.includes('/api/namespace-image/uart-install'));
    }
}
(async () => {
    for (const mode of ['prepare', 'send', 'cancel', 'offline', 'rejected', 'mismatch']) await check(mode);
    console.log('PASS: UART offline check, explicit install, cancellation, stale selection and failures');
})().catch(error => { console.error(error); process.exit(1); });
