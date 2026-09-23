'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const {_actionableJsonResponse} = require('./actionable_errors.js');
const {_lumpSaveRequest, _lumpSaveDefaultOperationKey} = require('./lump_save_handler.js');
const run = fs.readFileSync(__dirname + '/app-run.js', 'utf8');
const helpers = run.slice(run.indexOf('function _persistNamespaceSlotLabel('),
    run.indexOf('// The repository', run.indexOf('function _persistNamespaceSlotLabel(')));
const save = run.slice(run.indexOf('function confirmSaveToNamespace()'),
    run.indexOf('function saveNamespaceState()', run.indexOf('function confirmSaveToNamespace()')));
assert(save.includes('slot_label:   label'), 'intended label travels in reviewed save');
assert(!save.includes('_persistNamespaceSlotLabel('), 'no postcommit label request');
assert(save.includes('_acceptCommittedNamespaceSlotLabel(resp, idx)'));

function harness() {
    const dialogs = [], calls = [];
    const make = () => ({
        style: {}, children: [], handlers: {}, appendChild(c) { this.children.push(c); },
        setAttribute() {}, addEventListener(n, f) { this.handlers[n] = f; },
        showModal() { dialogs.push(this); }, remove() {}, focus() {},
    });
    const window = {
        bootConfig: {slotLabels: {'7': 'Before'}},
        location: {href: 'http://test/simulator/', origin: 'http://test'},
        fetch: async request => {
            calls.push(request);
            if (request.headers.get('X-Change-Confirmation')) {
                const payload = JSON.parse(await request.clone().text());
                assert.strictEqual(payload.metadata.slot_label, 'WukongCallHome');
                return Response.json({ok: true, committed: true, token: '4a000007',
                    ns_slot: 7, slot_label: 'WukongCallHome'});
            }
            return Response.json({error: 'change_confirmation_required',
                change_confirmation: {id: 'reviewed', title: 'Save', changes: [
                    'NS[7] slot label: Before → WukongCallHome']}}, {status: 428});
        },
    };
    const context = vm.createContext({window, document: {createElement: make,
        body: make(), activeElement: make()}, Request, Response, Headers, URL, console,
        _actionableJsonResponse});
    vm.runInContext(fs.readFileSync(__dirname + '/change-confirmation.js', 'utf8'), context);
    context.fetch = window.fetch;
    vm.runInContext(helpers, context);
    return {context, window, calls, dialogs};
}
async function dialog(h) {
    for (let i = 0; i < 100 && !h.dialogs.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 1));
    }
    assert(h.dialogs.length);
    return h.dialogs[0];
}
(async () => {
    let h = harness();
    const payload = {metadata: {ns_slot: 7, slot_label: 'WukongCallHome'}, binary: [1]};
    let pending = _lumpSaveRequest(h.window.fetch, '/api/lumps/save', payload,
        result => h.context._acceptCommittedNamespaceSlotLabel(result, result.ns_slot));
    (await dialog(h)).children[4].onclick();
    await pending;
    assert.strictEqual(h.dialogs.length, 1);
    assert.strictEqual(h.calls.length, 2, 'one review request and one approved save only');
    assert(h.calls.every(r => new URL(r.url).pathname === '/api/lumps/save'));
    assert.strictEqual(h.window.bootConfig.slotLabels['7'], 'WukongCallHome');

    for (const dismiss of ['reject', 'close', 'escape']) {
        h = harness();
        pending = h.context._persistNamespaceSlotLabel(7, 'WukongCallHome');
        const result = pending.catch(e => e);
        assert.strictEqual(h.window.bootConfig.slotLabels['7'], 'Before');
        const modal = await dialog(h);
        if (dismiss === 'reject') modal.children[3].onclick();
        else modal.handlers[dismiss === 'escape' ? 'cancel' : 'close']({preventDefault() {}});
        const error = await result;
        assert.strictEqual(error.code, 'change_rejected');
        assert.strictEqual(error.message, 'Save cancelled — no changes applied.');
        assert.strictEqual(h.window.bootConfig.slotLabels['7'], 'Before');
        assert.strictEqual(h.calls.length, 1);
    }
    await assert.rejects(_actionableJsonResponse(Response.json({
        error: 'change_confirmation_invalid', message: 'Saved state changed.',
        committed: false,
    }, {status: 409}), 'Save label', {dataChanged: null, allowReviewCancellation: true}),
    error => error.message.includes('No data was changed.') &&
        error.message.includes('Saved state changed.') && !error.code &&
        !error.message.includes('status is unknown'));
    assert.notStrictEqual(_lumpSaveDefaultOperationKey(payload),
        _lumpSaveDefaultOperationKey({...payload, metadata: {...payload.metadata, slot_label: 'Other'}}));
    console.log('PASS single reviewed save with label; neutral standalone cancellation; exact failures');
})().catch(error => { console.error(error); process.exitCode = 1; });