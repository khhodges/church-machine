'use strict';
// Regression: SELF is the compiler-owned contextual name for C-List row zero.
// A user alias on a SelfTest/non-zero row must not overwrite that mapping.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

function nextTurn() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

(async function () {
    const dom = new JSDOM(
        '<!doctype html><html><body>' +
        '<button class="btn-clist-viewer"></button>' +
        '<textarea id="asmEditor">capabilities {\n    SELF E,\n    SelfTest E\n}</textarea>' +
        '</body></html>',
        { url: 'http://localhost/simulator/', runScripts: 'outside-only' }
    );
    const { window } = dom;
    window.AsmInstructionPicker = { hide: function () {} };
    window.sim = { bootComplete: false };
    window.fetch = async function () {
        return { ok: true, json: async function () { return []; } };
    };

    // Reproduce browser memory left by the original sequence before loading
    // the viewer: SelfYest was corrected to SELF as the row-1 pet name.
    window.localStorage.setItem('church_clist_pet_names',
        JSON.stringify({ 1: 'SELF', 2: 'UsefulAlias' }));
    window.eval(fs.readFileSync(path.join(__dirname, 'clist-viewer.js'), 'utf8'));

    assert.deepStrictEqual(
        JSON.parse(JSON.stringify(window.CListViewer.getNullSlotPetNames())),
        { 2: 'UsefulAlias' },
        'legacy non-zero SELF aliases must be removed from compiler-visible memory'
    );
    assert.strictEqual(
        JSON.parse(window.localStorage.getItem('church_clist_pet_names'))['1'],
        'SELF',
        'filtering must not destructively rewrite the user localStorage value'
    );

    window.CListViewer.show(null, true);
    await nextTurn();
    await nextTurn();
    const popup = window.document.querySelector('.clist-viewer-popup');
    const selfRow = popup.querySelector('.clist-row[data-slot="0"]');
    const selfTestRow = popup.querySelector('.clist-row[data-slot="1"]');
    assert(selfRow.querySelector('.clist-self-name'), 'SELF must remain row zero');
    assert(!selfRow.querySelector('[data-action="edit-pet-name"]'),
        'SELF row must not expose a pet-name editor');
    assert.match(selfTestRow.querySelector('.clist-pet-name-error').textContent,
        /stored SELF alias ignored/i,
        'persisted reserved aliases must remain visible as an inline warning');

    selfTestRow.querySelector('[data-action="edit-pet-name"]').click();
    const input = selfTestRow.querySelector('.clist-pet-name-input');
    input.value = 'SELF';
    input.dispatchEvent(new window.KeyboardEvent('keydown',
        { key: 'Enter', bubbles: true, cancelable: true }));

    assert.strictEqual(input.getAttribute('aria-invalid'), 'true');
    assert.match(selfTestRow.querySelector('.clist-pet-name-error').textContent,
        /reserved.*row 0/i);
    assert.strictEqual(window.CListViewer.getNullSlotPetNames()['1'], undefined,
        'rejected SELF alias must not enter compiler-visible slot memory');
    assert.match(window.document.getElementById('asmEditor').value, /SelfTest E/,
        'rejecting the alias must not alter the user draft');

    input.value = 'SelfTestLocal';
    input.dispatchEvent(new window.KeyboardEvent('keydown',
        { key: 'Enter', bubbles: true, cancelable: true }));
    await nextTurn();
    assert.strictEqual(window.CListViewer.getNullSlotPetNames()['1'], 'SelfTestLocal',
        'ordinary non-reserved aliases must still save');

    const compileSource = fs.readFileSync(path.join(__dirname, 'app-compile.js'), 'utf8');
    const compileStart = compileSource.indexOf('function _activeCompileClistSlots()');
    const compileEnd = compileSource.indexOf('\nfunction _compileWithActiveClist', compileStart);
    assert(compileStart >= 0 && compileEnd > compileStart,
        'active C-list compiler snapshot helper must be extractable');
    const compileContext = {
        window: {
            CListViewer: {
                getSlotPetNames: function () {
                    return { 0: 'SELF', 1: '__SELF__', 2: 'SelfTestLocal' };
                }
            }
        }
    };
    vm.runInNewContext(compileSource.slice(compileStart, compileEnd), compileContext);
    const snapshot = compileContext._activeCompileClistSlots();
    assert.strictEqual(snapshot.SELF, 0, 'compiler snapshot must retain contextual row-zero SELF');
    assert.strictEqual(snapshot.__SELF__, undefined,
        'compiler snapshot must reject a non-zero internal SELF alias');
    assert.strictEqual(snapshot.SelfTestLocal, 2,
        'compiler snapshot must retain ordinary aliases');

    console.log('PASS C-List SELF-row pet-name regression');
}()).catch(error => {
    console.error(error.stack || error);
    process.exit(1);
});