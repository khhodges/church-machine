'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const source = fs.readFileSync(__dirname + '/bridge-connection.js', 'utf8');
function setup(saved) {
    const dom = new JSDOM('<button id="ideBridgeToggle"></button>', {
        url: 'https://ide.example/simulator/', runScripts: 'outside-only'
    });
    const w = dom.window;
    let calls = [];
    let handler = async () => new Response('{"ok":true}');
    w.fetch = (...args) => { calls.push(args); return handler(...args); };
    if (saved !== undefined) w.localStorage.setItem('church.ide.bridge.enabled', saved);
    w.eval(source);
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    return {w, calls, setHandler: fn => {handler = fn;}, close: () => dom.window.close()};
}
(async () => {
    const t = setup();
    const {w, calls} = t;
    assert.equal(w.IDEBridge.isEnabled(), true);
    await w.fetch('/hardware/wukong/status');
    assert.equal(calls.length, 1);
    w.IDEBridge.toggle();
    assert.equal(w.document.querySelector('button').textContent, 'Bridge: Off');
    assert.equal(w.document.querySelector('button').getAttribute('aria-checked'), 'false');
    assert.equal(w.localStorage.getItem('church.ide.bridge.enabled'), 'false');
    for (const path of ['status', 'events?after=0', 'command', 'load']) {
        await assert.rejects(w.fetch('/hardware/wukong/' + path, {method:'POST'}), /Bridge is Off/);
    }
    assert.equal(calls.length, 1, 'Off sends no hardware requests');
    await w.fetch('/api/boot-image/ns-state');
    assert.equal(calls.length, 2, 'software IDE still works');
    w.IDEBridge.toggle();
    let finish;
    t.setHandler(() => new Promise(resolve => {finish = resolve;}));
    const old = w.fetch('/hardware/wukong/events');
    const signal = calls.at(-1)[1].signal;
    w.IDEBridge.setEnabled(false);
    assert.equal(signal.aborted, true);
    w.IDEBridge.setEnabled(true);
    finish(new Response('{}'));
    await assert.rejects(old, /Bridge is Off/, 'old response cannot cross Off/On');
    t.setHandler(async () => new Response('{}'));
    const body = await w.fetch('/hardware/wukong/status');
    w.IDEBridge.setEnabled(false);
    await assert.rejects(body.json(), /Bridge is Off/, 'late response body is ignored');
    t.close();
    const restored = setup('false');
    assert.equal(restored.w.IDEBridge.isEnabled(), false);
    await assert.rejects(restored.w.fetch('/hardware/wukong/status'), /Bridge is Off/);
    restored.close();
    console.log('PASS: bridge switch, persistence, request blocking, simulator independence, abort and stale responses');
})().catch(error => {console.error(error); process.exitCode = 1;});
