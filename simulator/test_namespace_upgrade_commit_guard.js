'use strict';
const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
(async () => {
    let calls = 0, current = true;
    const win = {
        location: {origin: 'https://ide.test', href: 'https://ide.test/'},
        fetch: async () => {
            calls++;
            return new Response(JSON.stringify({
                error: 'change_confirmation_required',
                change_confirmation: {id: 'reviewed'},
            }), {status: 428});
        },
    };
    const context = {window: win, Request, Response, Headers, URL, Promise,
        document: {}, console};
    vm.runInNewContext(fs.readFileSync(__dirname + '/change-confirmation.js', 'utf8'), context);
    win.confirmProtectedChange = async () => { current = false; return true; };
    await assert.rejects(win.fetch('/api/namespace/save-table', {
        method: 'POST', body: '{}',
        beforeConfirmedMutation() { if (!current) throw new Error('Draft changed'); },
    }), /Draft changed/);
    assert.strictEqual(calls, 1, 'no commit after draft changes in protected review');
    console.log('Namespace upgrade commit guard PASS');
})().catch(error => {console.error(error); process.exitCode = 1;});