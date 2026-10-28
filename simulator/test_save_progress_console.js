'use strict';
// Keep the protected-review/activity-lock integration in the standard suite.
require('./test_save_protected_review.js');
// Focused tests: lock cleanup, ownership, approval handoff, unknown outcome.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('simulator/save-progress-console.js', 'utf8');

function node(id) {
    const n = { id, children: [], style: {}, dataset: {}, hidden: false, isConnected: true,
        classList: { toggle() {} }, listeners: {},
        appendChild(c) { c.parent = this; this.children.push(c); return c; },
        removeChild(c) { this.children.splice(this.children.indexOf(c), 1); },
        get firstChild() { return this.children[0]; },
        setAttribute() {}, addEventListener(t, f) { this.listeners[t] = f; },
        contains(t) { for (let x = t; x; x = x.parent) if (x === this) return true; return false; } };
    return n;
}
function setup() {
    const listeners = {};
    const body = node('body');
    const byId = { saveNSConfirmBtn: node('ok'), saveNSCancelBtn: node('cancel'),
        lumpSaveStaleConflictDialog: Object.assign(node('conflict'), { style: { display: 'none' } }) };
    const html = node('html'); let locked = false;
    html.classList = { toggle(_, on) { locked = on; } };
    const win = {
        document: { body, documentElement: html, createElement: () => node(''), getElementById: id => byId[id] || null },
        addEventListener(t, f) { (listeners[t] = listeners[t] || new Set()).add(f); },
        removeEventListener(t, f) { listeners[t] && listeners[t].delete(f); },
        LumpSaveDiagnostics: { stageStart() { return 1; }, stageComplete() { return 2; }, stageException() {} },
    };
    const ctx = { window: win, Date, setTimeout, clearTimeout, setInterval, clearInterval, Promise, String };
    vm.createContext(ctx); vm.runInContext(src, ctx);
    const fire = (type, target, extra) => {
        let blocked = false;
        const ev = Object.assign({ type, target, preventDefault() { blocked = true; }, stopImmediatePropagation() {} }, extra);
        (listeners[type] || []).forEach(f => f(ev));
        return blocked;
    };
    return { api: win.SaveProgressConsole, win, byId, fire, listeners, locked: () => locked };
}

const { api, win, byId, fire, listeners, locked } = setup();
const editor = node('editor');
// Ownership: second begin cannot clobber.
const t1 = api.begin('commit');
assert.ok(t1); assert.equal(api.begin('review'), null);
assert.equal(api.end('bogus', 'success'), false);
assert.ok(locked());
assert.equal(fire('click', editor), true, 'unrelated click blocked');
assert.equal(fire('keydown', editor, { key: 'a' }), true);
assert.equal(fire('click', byId.saveNSConfirmBtn), true, 'approval not active yet');
// Approval handoff: only active controls allowed; Escape still blocked.
api.allow(t1, [byId.saveNSConfirmBtn, byId.saveNSCancelBtn]);
assert.equal(fire('click', byId.saveNSConfirmBtn), false);
assert.equal(fire('click', byId.saveNSCancelBtn), false);
assert.equal(fire('click', editor), true);
assert.equal(fire('keydown', byId.saveNSCancelBtn, { key: 'Escape' }), true);
// Stale conflict modal reachable when visible.
const conflictBtn = byId.lumpSaveStaleConflictDialog.appendChild(node('keep'));
assert.equal(fire('click', conflictBtn), true);
byId.lumpSaveStaleConflictDialog.style.display = 'flex';
assert.equal(fire('click', conflictBtn), false);
api.allow(t1, []);
assert.equal(fire('click', byId.saveNSConfirmBtn), true, 'approval controls revoked after decision');
// Diagnostics forward safe events; commit uncomfirmed stays unknown.
win.LumpSaveDiagnostics.stageStart({}, 'commit');
win.LumpSaveDiagnostics.stageComplete({}, 'commit', 'unknown');
assert.equal(api.committed(), false);
assert.equal(api.end(t1, 'unknown', 'Commit outcome is UNKNOWN.'), true);
assert.equal(locked(), false);
assert.equal(fire('click', editor), false, 'interaction restored');
assert.equal((listeners.beforeunload || new Set()).size, 0);
const panel = win.document.body.children[0];
assert.equal(panel.dataset.state, 'unknown');
assert.equal(panel.hidden, false, 'log preserved on unknown/failure');
assert.ok(panel._log.children.length >= 3);
// Committed event recognised; new session after cleanup works.
const t2 = api.begin('commit');
assert.ok(t2 && t2 !== t1);
win.LumpSaveDiagnostics.stageComplete({}, 'commit', 'committed');
assert.equal(api.committed(), true);
api.end(t2, 'cancelled');
assert.equal(locked(), false);
assert.equal(api.current(), null);
// Keyboard hole: shortcuts blocked even on permitted targets; Tab trapped.
{
    const k = setup();
    const ok = k.byId.saveNSConfirmBtn, cancel = k.byId.saveNSCancelBtn;
    [ok, cancel].forEach(b => { b.focus = () => { k.win.document.activeElement = b; }; });
    const t = k.api.begin('commit');
    k.api.allow(t, [ok, cancel]);
    for (const extra of [{ key: 'F5' }, { key: 'F8' }, { key: 's', ctrlKey: true },
            { key: 'Enter', ctrlKey: true }, { key: 'Escape' }]) {
        assert.equal(k.fire('keydown', ok, extra), true, 'shortcut blocked: ' + extra.key);
    }
    assert.equal(k.fire('keydown', ok, { key: 'Enter' }), false, 'Enter activates approval');
    assert.equal(k.fire('keydown', cancel, { key: ' ' }), false);
    assert.equal(k.fire('keydown', editor, { key: 'Enter' }), true);
    k.win.document.activeElement = ok;
    assert.equal(k.fire('keydown', ok, { key: 'Tab' }), true);
    assert.equal(k.win.document.activeElement, cancel, 'Tab moves to next allowed control');
    k.fire('keydown', cancel, { key: 'Tab' });
    assert.notEqual(k.win.document.activeElement, editor, 'focus stays inside trap');
    k.api.end(t, 'cancelled');
    assert.equal(k.fire('keydown', ok, { key: 'F5' }), false, 'shortcuts restored after end');
}
// Programmatic concurrent save refuses before mutating active state.
(async () => {
    const actSrc = fs.readFileSync('simulator/app-actions.js', 'utf8');
    const fn = actSrc.slice(actSrc.indexOf('    async function save(options)'),
        actSrc.indexOf('    async function exportCandidate(options)'));
    const k = setup();
    const owner = k.api.begin('commit');
    let built = false;
    const ctx = { activeOperation: null, console, window: k.win,
        document: { getElementById: () => null }, eligibility: () => ({ ok: true }),
        buildThen: async () => { built = true; return { token: 'x' }; },
        reportSaveFailure: r => r, refresh() {} };
    vm.createContext(ctx); vm.runInContext(fn, ctx);
    const r = await ctx.save();
    assert.equal(r.busy, true); assert.equal(built, false);
    assert.equal(ctx.activeOperation, null);
    assert.equal(k.api.current(), owner, 'pending owner untouched');
    k.api.end(owner, 'cancelled');
    const runSrc = fs.readFileSync('simulator/app-run.js', 'utf8');
    const b = runSrc.indexOf('async function beginSaveToNamespace()');
    const body = runSrc.slice(b, runSrc.indexOf('_saveNSRequestInFlight = true;', b));
    assert.ok(/if \(spc && !spcToken\) return \{ ok: false, busy: true \};/.test(body),
        'beginSaveToNamespace refuses before setting in-flight state');
    console.log('Save progress console: keyboard trap and concurrent refusal passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
console.log('Save progress console: ownership, lock cleanup, approval handoff passed');
// Placement: console docks away from approval controls.
{
    const k = setup();
    const ok = k.byId.saveNSConfirmBtn, cancel = k.byId.saveNSCancelBtn;
    const btnRect = { left: 1000, right: 1260, top: 640, bottom: 700, width: 260, height: 60 };
    [ok, cancel].forEach(b => { b.focus = () => {}; b.getBoundingClientRect = () => btnRect; });
    const t = k.api.begin('commit');
    const panel = k.win.document.body.children[0];
    panel.getBoundingClientRect = () => /^bottom/.test(panel.dataset.dock)
        ? { left: 844, right: 1264, top: 400, bottom: 704, width: 420, height: 304 }
        : { left: 360, right: 920, top: 8, bottom: 158, width: 560, height: 150 };
    assert.equal(k.api._place(), 'bottom', 'no controls: bottom');
    k.api.allow(t, [ok, cancel]);
    assert.equal(panel.dataset.dock, 'top', 'approval at 1280x720: docked top, clear of controls');
    const topRect = { left: 400, right: 600, top: 20, bottom: 50, width: 200, height: 30 };
    ok.getBoundingClientRect = cancel.getBoundingClientRect = () => topRect;
    assert.equal(k.api._place(), 'bottom', 'controls at top: falls back to bottom');
    k.api.allow(t, []);
    assert.equal(k.api._place(), 'bottom');
    ok.getBoundingClientRect = cancel.getBoundingClientRect = () => btnRect;
    k.byId.saveNSDialog = Object.assign(node('saveNSDialog'), {
        querySelectorAll: () => [ok, cancel],
    });
    k.api.end(t, 'error');
    assert.equal(panel.dataset.dock, 'top', 'terminal recovery controls remain unobstructed');
    assert.equal(k.api._locked(), false);
    console.log('Save progress console: non-overlapping placement passed');
}
