'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function harness(responses) {
    const dialogs = [];
    const calls = [];
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
        fetch: async function (request) {
            calls.push(request);
            return responses.shift();
        }};
    vm.runInNewContext(fs.readFileSync(__dirname + '/change-confirmation.js', 'utf8'),
        {window, document, Request, Response, Headers, URL});
    return {window, dialogs, calls};
}
const challenge = () => new Response(JSON.stringify({
    error: 'change_confirmation_required',
    change_confirmation: {id: 'one-use', title: 'Save', reason: 'Publish exact bytes', changes: ['slot 10']},
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

    h = harness([challenge()]);
    pending = h.window.fetch('/api/lumps/save', {method: 'POST', body: 'exact'});
    dialog = await waitForDialog(h);
    dialog.children[3].onclick(); // Reject
    assert.strictEqual((await pending).status, 409);
    assert.strictEqual(h.calls.length, 1, 'reject never sends approved mutation');

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
    console.log('Protected-change UI tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });