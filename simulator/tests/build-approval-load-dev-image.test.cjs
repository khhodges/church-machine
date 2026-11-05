// Run: node simulator/tests/build-approval-load-dev-image.test.cjs
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const sim = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(sim, 'index.html'), 'utf8');

// 1. Primary surface: exactly one button outside the Advanced disclosure.
const panel = html.slice(html.indexOf('id="buildApprovalPanel"'), html.indexOf('id="versionsPanel"'));
const noDialog = panel.replace(/<dialog[\s\S]*?<\/dialog>/, '');
const primary = noDialog.slice(0, noDialog.indexOf('<details id="baAdvanced"'));
const buttons = primary.match(/<button\b[^>]*>/g) || [];
assert.equal(buttons.length, 1, 'primary surface has one button');
assert.match(buttons[0], /id="baLoadDevImageBtn"/);
assert.match(primary, /id="baRevisionSelect"/);
assert.match(primary, /id="baMapBody"/);
const advanced = noDialog.slice(noDialog.indexOf('<details id="baAdvanced"'));
assert.ok(!/<details id="baAdvanced"[^>]*\bopen\b/.test(advanced), 'Advanced collapsed by default');
for (const id of ['baApproveBtn', 'baFreezeBtn', 'baInstallImageBtn', 'baDownloadRevisionBtn', 'baBitstreamRevisionSelect', 'baRefreshBtn'])
    assert.ok(advanced.includes(`id="${id}"`), id + ' retained in Advanced');
assert.ok(advanced.includes('openBridgePairing()') && advanced.includes('forgetToken()'));

// 2. SHA pins match sources.
for (const f of ['app-build-approval.js', 'development-image-view.js']) {
    const h = crypto.createHash('sha256').update(fs.readFileSync(path.join(sim, f))).digest('hex').slice(0, 12);
    assert.ok(html.includes(`${f}?v=sha256-${h}`), f + ' pin current');
}

// 3. Handoff: explicit, one-shot, never from URL.
function env(hash) {
    const posted = [], listeners = {};
    const frame = { attrs: {}, style: {}, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] ?? null; },
        contentWindow: { postMessage: (m, o) => posted.push([m, o]) } };
    const view = { classList: { contains: () => true } };
    const win = {
        location: { hash, origin: 'https://ide.test', pathname: '/simulator/', search: '', href: 'https://ide.test/simulator/' + hash },
        history: { replaceState() {} },
        addEventListener: (t, f) => { listeners[t] = f; },
        switchView() {}, alert() {},
        NamespaceSelection: { remember() {}, read: () => null },
    };
    const document = { getElementById: id => id === 'developmentImageFrame' ? frame : id === 'development-image' ? view : null,
        querySelectorAll: () => [] };
    vm.runInNewContext(fs.readFileSync(path.join(sim, 'development-image-view.js'), 'utf8'),
        { window: win, document, URLSearchParams, URL, fetch: () => { throw Error('no network'); } });
    return { win, posted, listeners, frame };
}
let e = env('#development-image?namespace=design%3Aabc');
e.listeners.message({ origin: 'https://ide.test', source: e.frame.contentWindow, data: { type: 'development-image:ready' } });
assert.equal(e.posted.length, 0, 'URL/reload never sends a load request');
assert.equal(e.win.DevelopmentImageView.requestLoad('bitstream:xyz'), false, 'bitstream rejected');
assert.equal(e.win.DevelopmentImageView.requestLoad('design:abc'), true);
assert.equal(e.frame.attrs.src, '/development-image/?namespace=design%3Aabc', 'exact identity in frame');
const [msg, origin] = e.posted.at(-1);
assert.equal(msg.type, 'development-image:load'); assert.equal(msg.namespace, 'design:abc'); assert.equal(origin, 'https://ide.test');
e.listeners.message({ origin: 'https://ide.test', source: e.frame.contentWindow, data: { type: 'development-image:load-accepted', requestId: msg.requestId } });
const before = e.posted.length;
e.listeners.message({ origin: 'https://ide.test', source: e.frame.contentWindow, data: { type: 'development-image:ready' } });
assert.equal(e.posted.length, before, 'accepted request is not replayed on frame reload');
e.listeners.message({ origin: 'https://evil.test', source: e.frame.contentWindow, data: { type: 'development-image:ready' } });
assert.equal(e.win.DevelopmentImageView.pendingLoad(), null);
console.log('PASS Build Approval: one primary action, Advanced retains legacy controls, explicit one-shot handoff');
