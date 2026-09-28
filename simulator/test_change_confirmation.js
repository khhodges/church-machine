'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function harness(responses) {
    const dialogs = [];
    const calls = [];
    const events = {};
    const warnings = [];
    function element(tag) {
        return {
            tag, style: {}, children: [], handlers: {}, isConnected: true,
            appendChild(child) { this.children.push(child); },
            setAttribute() {},
            addEventListener(name, fn) { this.handlers[name] = fn; },
            showModal() { dialogs.push(this); },
            focus() {},
            remove() { this.isConnected = false; },
        };
    }
    const document = {activeElement: element('editor'), body: element('body'), createElement: element};
    const window = {location: {href: 'http://ide.test/simulator/', origin: 'http://ide.test'},
        addEventListener(name, fn) { events[name] = fn; },
        removeEventListener(name) { delete events[name]; },
        console: {warn(message) { warnings.push(message); }},
        fetch: async function (request) {
            calls.push(request);
            const response = responses.shift();
            if (response instanceof Error) throw response;
            return response;
        }};
    vm.runInNewContext(fs.readFileSync(__dirname + '/change-confirmation.js', 'utf8'),
        {window, document, Request, Response, Headers, URL});
    return {window, dialogs, calls, events, warnings};
}
const challenge = (reviewId) => new Response(JSON.stringify({
    error: 'change_confirmation_required',
    change_confirmation: {id: 'one-use', review_id: reviewId, title: 'Save', reason: 'Publish exact bytes', changes: ['slot 10']},
}), {status: 428, headers: {'Content-Type': 'application/json'}});
async function waitForDialog(h) {
    for (let i = 0; i < 100 && !h.dialogs.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 1));
    }
    assert(h.dialogs.length, 'warning modal opens');
    return h.dialogs[h.dialogs.length - 1];
}

(async function () {
    let h = harness([challenge(), new Response('{"ok":true}')]);
    let pending = h.window.fetch('/api/lumps/save', {method: 'POST', body: '{"bytes":[1,2]}'});
    let dialog = await waitForDialog(h);
    dialog.children[4].onclick(); // Confirm
    assert.strictEqual((await pending).status, 200);
    assert.strictEqual(h.calls.length, 2);
    assert.strictEqual(h.calls[1].headers.get('X-Change-Confirmation'), 'one-use');
    assert.strictEqual(await h.calls[0].text(), await h.calls[1].text());

    h = harness([challenge(), new Response('{"ok":true}'),
        challenge(), new Response('{"ok":true}')]);
    const first = h.window.fetch('/api/boot-config', {method: 'POST', body: '{"value":1}'});
    const second = h.window.fetch('/api/boot-config', {method: 'POST', body: '{"value":2}'});
    dialog = await waitForDialog(h);
    assert.strictEqual(h.calls.length, 1, 'second review cannot bind state before first commit');
    dialog.children[4].onclick();
    assert.strictEqual((await first).status, 200);
    for (let i = 0; i < 100 && h.dialogs.length < 2; i++) {
        await new Promise(resolve => setTimeout(resolve, 1));
    }
    assert.strictEqual(h.dialogs.length, 2);
    assert.strictEqual(h.calls.length, 3, 'second review is prepared only after first commit');
    h.dialogs[1].children[4].onclick();
    assert.strictEqual((await second).status, 200);
    assert.strictEqual(await h.calls[2].text(), await h.calls[3].text());

    h = harness([challenge('rejected'), new Response('{"ok":true}')]);
    pending = h.window.fetch('/api/lumps/save', {method: 'POST', body: 'exact'});
    dialog = await waitForDialog(h);
    dialog.children[3].onclick(); // Reject
    assert.strictEqual((await pending).status, 409);
    assert.strictEqual(h.calls.length, 2, 'reject only sends an audit, never an approved mutation');
    assert.strictEqual(new URL(h.calls[1].url).pathname, '/api/change-reviews/reject');
    assert.strictEqual(h.calls[1].keepalive, true);
    assert.strictEqual(h.calls[1].credentials, 'same-origin');
    assert.deepStrictEqual(JSON.parse(await h.calls[1].text()),
        {review_id: 'rejected', outcome: 'rejected'});
    assert.strictEqual(h.events.pagehide, undefined, 'settled review clears unload listener');

    // Namespace saves treat review rejection/dismissal as a neutral terminal
    // cancellation. Exercise the real wrapper, response parser and UI catch.
    const {_actionableJsonResponse} = require('./actionable_errors.js');
    const memory = fs.readFileSync(__dirname + '/app-memory.js', 'utf8');
    const uiSource = memory.slice(memory.indexOf('function _nsTableSaveClick('),
        memory.indexOf('// _findSrcLump(slotIdx, slotLabel)'));
    const catchStart = memory.indexOf("        if (err.code === 'change_rejected') {",
        memory.indexOf("const data = await _actionableJsonResponse(resp, 'Save the Namespace'"));
    const cancellationCatch = memory.slice(catchStart, memory.indexOf('        try {', catchStart));
    for (const endpoint of ['/api/boot-image/save-ns', '/api/boot-config', '/api/boot-image/generate']) {
        for (const action of ['reject', 'escape', 'close']) {
            h = harness([challenge('namespace-review'), new Response('{"ok":true}')]);
            pending = h.window.fetch(endpoint, {method: 'POST', body: '{}'});
            dialog = await waitForDialog(h);
            if (action === 'reject') dialog.children[3].onclick();
            else if (action === 'escape') dialog.handlers.cancel({preventDefault() {}});
            else dialog.handlers.close();
            const audit = h.calls[1];
            assert.strictEqual(new URL(audit.url).pathname, '/api/change-reviews/reject');
            assert.deepStrictEqual(JSON.parse(await audit.text()),
                {review_id: 'namespace-review', outcome: action === 'reject' ? 'rejected' : 'dismissed'});
            let cancellation;
            try {
                await _actionableJsonResponse(await pending, 'Save the Namespace', {
                    allowReviewCancellation: true, nextAction: 'Click Save again.',
                });
                assert.fail('cancel must stop the save success path');
            } catch (error) { cancellation = error; }
            assert.strictEqual(cancellation.code, 'change_rejected');
            assert.strictEqual(h.calls.length, 2, 'cancel only sends an audit, never retries');
            const button = {style: {}};
            let saves = 0;
            const context = {window: {_nsTableDirty: true, _nsTableSaveError: null,
                _nsTableSave: () => saves++}, document: {getElementById: () => button},
                err: cancellation};
            vm.createContext(context);
            vm.runInContext(uiSource + '\n(function(){' + cancellationCatch + '})();', context);
            assert(button.textContent.includes('Save cancelled — no changes applied.'));
            assert(!/failed|HTTP|again|retry|⚠|✗/i.test(button.textContent + button.title));
            assert.strictEqual(context.window._nsTableDirty, true, 'staged edits retained');
            vm.runInContext('_nsTableSaveClick();', context);
            assert.strictEqual(saves, 0, 'dismissing notice cannot save');
        }
    }
    await assert.rejects(_actionableJsonResponse(new Response(JSON.stringify({
        error: 'change_confirmation_invalid', committed: false,
    }), {status: 409}), 'Save the Namespace', {allowReviewCancellation: true}),
    error => error.code !== 'change_rejected' && /failed \(HTTP 409\)/.test(error.message));
    assert(memory.includes("response, 'Save the Namespace build configuration', {\n                allowReviewCancellation: true"));
    assert(memory.includes("await window._ensureNamespaceBuildConfig(true)"));
    assert(memory.includes("resp, 'Save the Namespace', {\n            allowReviewCancellation: true"));
    const prefetchSource = memory.slice(
        memory.indexOf('    window._nsPrefetchSaveClick = async function(btn) {'),
        memory.indexOf('    for (let i = 0; i < _nsSnapshot.displayCount;',
            memory.indexOf('    window._nsPrefetchSaveClick = async function(btn) {')));
    for (const rejected of [true, false]) {
        const error = new Error(rejected ? 'Save cancelled — no changes applied.' :
            'Save failed (HTTP 409). Reason: change_confirmation_invalid');
        if (rejected) error.code = 'change_rejected';
        const context = {window: {_nsPrefetchSave: async () => {throw error;}}};
        vm.runInNewContext(prefetchSource, context);
        const button = {style: {}};
        await context.window._nsPrefetchSaveClick(button);
        assert.strictEqual(button.disabled, false);
        assert.strictEqual(button.style.color, rejected ? '#b9c6d8' : '#f87171');
        assert.strictEqual(/HTTP|⚠/.test(button.textContent), !rejected);
    }

    h = harness([]);
    const editor = {value: 'before'};
    pending = h.window.confirmSourceReplacement(editor, 'after', 'Replace source');
    dialog = await waitForDialog(h);
    editor.value = 'new typing';
    dialog.children[4].onclick();
    assert.strictEqual(await pending, false, 'stale approval cannot replace typing');
    assert.strictEqual(editor.value, 'new typing');

    h = harness([]);
    pending = h.window.confirmSourceReplacement({value: 'before'}, 'after', 'Replace source');
    dialog = await waitForDialog(h);
    dialog.handlers.cancel({preventDefault() {}});
    assert.strictEqual(await pending, false, 'Escape rejects');

    // A failed audit notification must not turn cancellation into mutation.
    for (const failedAudit of [new Error('network credentials must not be logged'),
        new Response('unavailable', {status: 503})]) {
        h = harness([challenge('delivery-failure'), failedAudit]);
        pending = h.window.fetch('/api/boot-config', {method: 'POST', body: 'private-source'});
        dialog = await waitForDialog(h);
        dialog.children[3].onclick();
        assert.strictEqual((await pending).status, 409);
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.strictEqual(h.calls.length, 2, 'failed audit never retries mutation');
        assert.strictEqual(h.warnings.length, 1);
        assert(!/private-source|delivery-failure|credentials/.test(h.warnings[0]));
    }

    h = harness([challenge('unload-review'), new Response('{"ok":true}')]);
    pending = h.window.fetch('/api/boot-image/generate', {method: 'POST', body: '{}'});
    dialog = await waitForDialog(h);
    h.events.pagehide();
    assert.strictEqual((await pending).status, 409);
    assert.deepStrictEqual(JSON.parse(await h.calls[1].text()),
        {review_id: 'unload-review', outcome: 'dismissed'});
    assert.strictEqual(h.calls.length, 2, 'unload never retries mutation');
    assert.strictEqual(h.events.pagehide, undefined, 'unload listener removed on settle');
    dialog.children[3].onclick();
    assert.strictEqual(h.calls.length, 2, 'settling twice never sends two audits');

    const controller = new AbortController();
    h = harness([challenge('abort-review'), new Response('{"ok":true}')]);
    pending = h.window.fetch('/api/boot-image/generate',
        {method: 'POST', body: '{}', signal: controller.signal});
    dialog = await waitForDialog(h);
    controller.abort();
    dialog.children[4].onclick();
    assert.strictEqual((await pending).status, 409);
    assert.strictEqual(h.calls.length, 2, 'abort after review never retries mutation');
    assert.deepStrictEqual(JSON.parse(await h.calls[1].text()),
        {review_id: 'abort-review', outcome: 'dismissed'});
    console.log('Protected-change UI tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
