'use strict';
// Isolated browser-controller tests: no network or serial device is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('server/fpga_status.html', 'utf8');
for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    new vm.Script(match[1]); // Parse every inline script, not only the extracted helpers.
}
const nodes = new Map();
const document = { getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, { textContent: '' });
    return nodes.get(id);
}};
let selected = { mode: 'wukong-fpga-bitstream', deviceUid: 'board-a' };
let now = 10000;
const posts = [];
const notes = [];
const window = { parent: { TargetState: { resolve: () => selected } } };
const context = vm.createContext({
    window, document, localStorage: { getItem: () => JSON.stringify(selected) },
    Date: { now: () => now }, console, JSON, Object,
    ctlBusy: false, controlTarget: null, controlTargetSeenAt: 0,
    note: text => notes.push(text),
    setCtlBusy: value => { context.ctlBusy = value; },
    controlHeaders: () => ({Authorization: 'Bearer test-only'}),
    controlFailure: () => 'test rejection', stopRebootWatch() {},
    cancelCmdWatchForStop() {},
    startCmdWatch() { context.ctlBusy = false; },
    setInterval: () => 1, rebootTick() {},
    fetch: (url, opts) => {
        posts.push({url, opts});
        return Promise.resolve({ok: true, text: () => Promise.resolve('{"ok":true,"id":7}')});
    }
});
for (const name of ['controlTargetBinding', 'bindControlRequest', 'observeControlTarget']) {
    const start = html.indexOf('  function ' + name + '(');
    vm.runInContext(html.slice(start, html.indexOf('\n  }', start) + 4), context);
}
const start = html.indexOf("  document.getElementById('btnReboot').onclick =");
const end = html.indexOf("  document.getElementById('btnBp').onclick", start);
vm.runInContext(html.slice(start, end), context);
const sendStart = html.indexOf('  function sendCmd(');
vm.runInContext(html.slice(sendStart, html.indexOf('\n  }', sendStart) + 4), context);
const click = () => nodes.get('btnReboot').onclick();
const observe = target => context.observeControlTarget({physical_target: target});
const target = {device_uid: 'board-a', session_id: 'session-1', live: true};
async function main() {
    click();
    assert.equal(posts.length, 0);
    observe({...target, device_uid: ''});
    click();
    assert.match(notes.at(-1), /no device UID/);
    observe({...target, live: false});
    click();
    observe({...target, session_id: ''});
    click();
    observe({...target, device_uid: 'board-b'});
    click();
    assert.match(notes.at(-1), /does not match/);
    observe(target);
    selected = {mode: 'simulator-ram', deviceUid: 'board-a'};
    click();
    selected = {mode: 'wukong-runtime-ram'};
    click();
    assert.equal(posts.length, 0, 'all rejected attempts must leave hardware untouched');
    selected.deviceUid = 'board-a';
    now += 3000;
    click();
    assert.equal(posts.length, 0, 'stale status is blocked');
    observe(target);
    click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(posts.length, 1);
    assert.equal(posts[0].opts.headers.Authorization, 'Bearer test-only');
    assert.deepEqual(JSON.parse(posts[0].opts.body), {
        cmd: 'f', target_device_uid: 'board-a', target_session_id: 'session-1'
    });
    observe({...target, session_id: 'session-2'});
    const bound = context.bindControlRequest({cmd: 'h', target_device_uid: 'forged'}, 'STOP');
    assert.equal(bound.target_session_id, 'session-2');
    assert.equal(bound.target_device_uid, 'board-a');
    for (const cmd of ['s', 'r', 'h', 'b']) {
        const before = posts.length;
        context.sendCmd({cmd, ...(cmd === 'b' ? {nia: 16} : {})}, 'TEST');
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(posts.length, before + 1);
        const payload = JSON.parse(posts.at(-1).opts.body);
        assert.equal(payload.cmd, cmd);
        assert.equal(payload.target_device_uid, 'board-a');
        assert.equal(payload.target_session_id, 'session-2');
        if (cmd === 'b') assert.equal(payload.nia, 16);
    }
    window.parent = window; // standalone page uses the same explicit saved selection
    assert.equal(context.controlTargetBinding().request.target_device_uid, 'board-a');
    context.localStorage.getItem = () => { throw Error('blocked'); };
    assert.match(context.controlTargetBinding().error, /Cannot read/);
    assert.match(html, /body = bindControlRequest\(body, label\)/);
    assert.match(html, /result\.textContent = text/);
    assert.match(html, /id="controlResult"[^>]*aria-live="polite"/);
    console.log('PASS FPGA target admission, real Reboot handler, session binding and visible results (isolated)');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
