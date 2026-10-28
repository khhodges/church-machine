'use strict';
// Exercise the real activity lock AND review renderer, without a live save.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');

async function run(action) {
    const dom = new JSDOM('<button id="outside">Underlying Save</button>', {
        url: 'http://ide.test/simulator/', runScripts: 'outside-only', pretendToBeVisual: true,
    });
    const w = dom.window, requests = [];
    Object.assign(w, {Request, Response, Headers, URL});
    w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    w.fetch = async request => {
        requests.push(request);
        return requests.length === 1
            ? new Response(JSON.stringify({error: 'change_confirmation_required', change_confirmation: {
                id: 'exact-review', title: 'Save test', changes: ['Test bytes only'],
            }}), {status: 428, headers: {'Content-Type': 'application/json'}})
            : new Response('{"ok":true}', {headers: {'Content-Type': 'application/json'}});
    };
    for (const name of ['save-progress-console.js', 'change-confirmation.js'])
        w.eval(fs.readFileSync(__dirname + '/' + name, 'utf8'));
    try {
    const owner = w.SaveProgressConsole.begin('commit');
    const pending = w.fetch('/api/lumps/save', {method: 'POST', body: '{"binary":[42]}'});
    for (let i = 0; i < 100 && !w.document.querySelector('dialog[open]'); i++)
        await new Promise(resolve => setTimeout(resolve, 1));
    const dialog = w.document.querySelector('dialog[open]');
    assert(dialog, 'protected review opens during the locked commit');
    const [reject, confirm] = dialog.querySelectorAll('button');
    let outsideClicks = 0;
    const outside = w.document.getElementById('outside');
    outside.onclick = () => outsideClicks++;
    outside.click();
    assert.equal(outsideClicks, 0, 'underlying save remains locked');
    reject.focus();
    reject.dispatchEvent(new w.KeyboardEvent('keydown', {key: 'Tab', bubbles: true, cancelable: true}));
    assert.equal(w.document.activeElement, confirm, 'Tab reaches the review, not the underlying form');
    const enter = new w.KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true});
    confirm.dispatchEvent(enter);
    assert.equal(enter.defaultPrevented, false, 'native button activation is permitted');
    if (action === 'confirm') confirm.click();
    else if (action === 'reject') reject.click();
    else {
        const escape = new w.KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true});
        confirm.dispatchEvent(escape);
        assert.equal(escape.defaultPrevented, false, 'native dismissal is permitted');
        dialog.dispatchEvent(new w.Event('cancel', {cancelable: true}));
    }
    const result = await pending;
    assert.equal(requests.length, action === 'confirm' ? 2 : 1);
    if (action === 'confirm') {
        assert.equal(result.status, 200);
        assert.equal(requests[1].headers.get('X-Change-Confirmation'), 'exact-review');
        assert.equal(await requests[0].text(), await requests[1].text(), 'approval preserves exact bytes');
    }
    assert.equal(w.document.querySelector('dialog'), null);
    outside.click();
    assert.equal(outsideClicks, 0, 'closing review does not unlock the pending save');
    w.SaveProgressConsole.end(owner, 'unknown');
    outside.click();
    assert.equal(outsideClicks, 1, 'save completion restores activity');
    } finally {
        w.close();
    }
}
(async () => {
    for (const action of ['confirm', 'reject', 'escape']) await run(action);
    console.log('PASS protected save review: confirm/reject/Escape, focus and exact replay under activity lock');
})().catch(error => { console.error(error); process.exitCode = 1; });
