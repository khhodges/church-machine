// test_lump_audit_jump.js — Unit tests for Task #2033: clickable audit-row jumps
//
// Verifies that lumpAuditRenderPanel() (simulator/lump-audit.js) generalizes the
// jump-to-editor affordance beyond the original RCI-only button:
//
//   J1  RCI violation with a known sourceLine renders a "↑ line N" button
//   J2  RNC (renamed here to any generic rule) violation with only a wordIndex
//       (no sourceLine) still renders a clickable "Open in editor" button
//   J3  A violation with neither sourceLine nor wordIndex, but an opts.token,
//       still renders a clickable "Open in editor" button (token fallback)
//   J4  A row with no `violations` array (RFS/RMC/RPN/RSM-style) gets a single
//       row-level "Open in editor" button when opts.token is supplied
//   J5  A row with no `violations` array and no opts.token renders no button
//       (never a dead click)
//   J6  Clicking a line-button calls the global _lumpAuditJump(token, line, wi)
//   J7  'pass' rows never render a jump button, even if a violations array
//       is (incorrectly) present
//
// Run with:  node simulator/test_lump_audit_jump.js
'use strict';

const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;

const { lumpAuditRenderPanel } = require('./lump-audit.js');

let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name); }
}

function freshContainer() {
    const c = document.createElement('div');
    document.body.appendChild(c);
    return c;
}

// ── J1: RCI violation with sourceLine ───────────────────────────────────────
(function () {
    const container = freshContainer();
    const results = [{
        ruleId: 'RCI', severity: 'error', message: 'Bad ref', detail: 'x',
        violations: [{ msg: 'CALL targets unbound CR', sourceLine: 12, wordIndex: 3 }],
    }];
    lumpAuditRenderPanel(container, results, { token: 'deadbeef' });
    const btn = container.querySelector('.lump-audit-jump-btn');
    check('J1 jump button rendered', !!btn);
    check('J1 button text shows line number', btn && btn.textContent.includes('line 12'));
})();

// ── J2: RNC-style violation, wordIndex only, no sourceLine ──────────────────
(function () {
    const container = freshContainer();
    const results = [{
        ruleId: 'RNC', severity: 'warn', message: 'Naming drift', detail: 'x',
        violations: [{ msg: 'Slot name mismatch', sourceLine: null, wordIndex: 7 }],
    }];
    lumpAuditRenderPanel(container, results, { token: 'deadbeef' });
    const btn = container.querySelector('.lump-audit-jump-btn');
    check('J2 jump button rendered for RNC warning (generalization beyond RCI)', !!btn);
    check('J2 button falls back to "Open in editor" text (no precise line)', btn && btn.textContent === 'Open in editor');
})();

// ── J3: violation with neither sourceLine nor wordIndex, token present ──────
(function () {
    const container = freshContainer();
    const results = [{
        ruleId: 'RNC', severity: 'warn', message: 'Naming drift', detail: 'x',
        violations: [{ msg: 'Unresolvable slot', sourceLine: null, wordIndex: null }],
    }];
    lumpAuditRenderPanel(container, results, { token: 'deadbeef' });
    const btn = container.querySelector('.lump-audit-jump-btn');
    check('J3 token-only fallback still renders a button', !!btn);
})();

// ── J4: rule with no violations array, opts.token supplied ──────────────────
(function () {
    const container = freshContainer();
    const results = [{ ruleId: 'RFS', severity: 'warn', message: 'Freespace not zero', detail: 'x' }];
    lumpAuditRenderPanel(container, results, { token: 'deadbeef' });
    const btn = container.querySelector('.lump-audit-jump-btn');
    check('J4 row-level Open-in-editor button rendered for violation-less warn rule', !!btn);
    check('J4 button carries the open-btn modifier class', btn && btn.classList.contains('lump-audit-open-btn'));
})();

// ── J5: rule with no violations array and no token — no dead click ─────────
(function () {
    const container = freshContainer();
    const results = [{ ruleId: 'RFS', severity: 'warn', message: 'Freespace not zero', detail: 'x' }];
    lumpAuditRenderPanel(container, results, {});
    const btn = container.querySelector('.lump-audit-jump-btn');
    check('J5 no button rendered without a token (avoids dead click)', !btn);
})();

// ── J6: clicking dispatches through the global _lumpAuditJump hook ─────────
(function () {
    const container = freshContainer();
    let called = null;
    global._lumpAuditJump = function (token, sourceLine, wordIndex) {
        called = { token, sourceLine, wordIndex };
    };
    const results = [{
        ruleId: 'RCI', severity: 'error', message: 'Bad ref', detail: 'x',
        violations: [{ msg: 'CALL targets unbound CR', sourceLine: 5, wordIndex: 2 }],
    }];
    lumpAuditRenderPanel(container, results, { token: 'cafef00d' });
    const btn = container.querySelector('.lump-audit-jump-btn');
    btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    check('J6 click invokes global _lumpAuditJump', !!called);
    check('J6 correct token forwarded', called && called.token === 'cafef00d');
    check('J6 correct sourceLine forwarded', called && called.sourceLine === 5);
    check('J6 correct wordIndex forwarded', called && called.wordIndex === 2);
    delete global._lumpAuditJump;
})();

// ── J7: pass rows never get a jump button ───────────────────────────────────
(function () {
    const container = freshContainer();
    const results = [{
        ruleId: 'RCI', severity: 'pass', message: 'OK', detail: 'x',
        violations: [{ msg: 'should never render', sourceLine: 1, wordIndex: 0 }],
    }];
    lumpAuditRenderPanel(container, results, { token: 'deadbeef' });
    const btn = container.querySelector('.lump-audit-jump-btn');
    check('J7 pass severity never renders a jump button', !btn);
})();

// Real audit bytes: repeated LOADs into five unresolved rows are binding
// information, not eight warnings or proof of destination execution readiness.
{
    const assert = require('node:assert/strict');
    const {lumpAudit, lumpAuditHasErrors, lumpAuditHasWarnings} = require('./lump-audit.js');
    const Assembler = require('./assembler.js');
    const assembler = new Assembler();
    const code = assembler.assemble([1,2,3,4,5,4,2,1]
        .map(slot => `LOAD CR1, CR6, #${slot}`).join('\n')).words;
    assert.deepEqual(assembler.errors, []);
    const words = Array(64).fill(0);
    words[0] = ((31 << 27) | (code.length << 10) | 6) >>> 0;
    words.splice(1, code.length, ...code);
    const before = words.slice();
    for (const skipRnc of [false, true]) {
        const result = lumpAudit(words, {pet_names:{CR:{1:'ide.SelfTest',2:'ide.LED_DEV',
            3:'ide.UART_DEV',4:'ide.BTN_DEV',5:'ide.TIMER_DEV'}}}, null, {skipRnc});
        const info = result.find(row => row.ruleId === 'RNC');
        assert.equal(info.severity, 'info');
        assert.match(info.message, /^5 referenced capabilities/);
        assert.equal(info.references.length, 8);
        assert.equal(info.violations, undefined);
        assert.equal(lumpAuditHasWarnings([info]), false);
        assert.equal(lumpAuditHasErrors([info]), false);
        const container = freshContainer();
        const outcome = lumpAuditRenderPanel(container, [info],
            {token:'12345678', startOpen:true});
        assert.equal(outcome.hasWarnings, false);
        assert.equal(outcome.hasErrors, false);
        assert.equal(container.querySelectorAll('details').length, 1);
        assert.equal(container.querySelector('details').open, false);
        assert.equal(container.querySelectorAll('details li').length, 8);
        assert.equal(container.querySelectorAll('.lump-audit-jump-btn').length, 0);
        assert.equal((container.textContent.match(/Instruction 1 \(LOAD\)/g) || []).length, 1);
        assert.doesNotMatch(container.textContent, /not written|runtime fills|injected at deployment|review required/);
        assert.match(container.textContent, /HardFault only if execution references it/);
        container.querySelector('details').open = true;
        assert.equal(container.querySelector('details').open, true);
    }
    assert.deepEqual(words, before, 'audit and rendering never change saved bytes');
    const badHeader = words.slice(); badHeader[0] = 0;
    assert.equal(lumpAuditHasErrors(lumpAudit(badHeader)), true);
    const outOfRange = words.slice();
    outOfRange[1] = new Assembler().assemble('LOAD CR1, CR6, #6').words[0];
    const errors = lumpAudit(outOfRange);
    assert.equal(errors.find(row => row.ruleId === 'CAP_RANGE').severity, 'warn');
    const mixed = lumpAuditRenderPanel(freshContainer(), errors, {startOpen:true});
    assert.equal(mixed.hasErrors, false, 'intentional missing-row access remains an authored program');
    assert.equal(mixed.hasWarnings, true);
    const badBranch = words.slice();
    badBranch[1] = new Assembler().assemble('BRANCH #32767').words[0];
    assert.equal(lumpAuditHasErrors(lumpAudit(badBranch)), true,
        'out-of-code branch remains blocking');
    console.log('PASS non-blocking binding status, eight expandable references, and preserved structural errors');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
