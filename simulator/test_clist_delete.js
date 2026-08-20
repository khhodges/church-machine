'use strict';
// Regression tests for C-List popup deletion.
//
// Run with: node simulator/test_clist_delete.js

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
    if (condition) {
        console.log('PASS ' + label);
        passed++;
    } else {
        console.error('FAIL ' + label + (detail ? ' — ' + detail : ''));
        failed++;
    }
}

function nextTurn() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

(async function () {
    const dom = new JSDOM(
        '<!doctype html><html><body><textarea id="asmEditor"></textarea></body></html>',
        { url: 'http://localhost/simulator/', runScripts: 'outside-only' }
    );
    const { window } = dom;
    const editor = window.document.getElementById('asmEditor');
    editor.value = [
        'capabilities {',
        '    SelfTest E',
        '    Continue E',
        '    Diagnostics R',
        '}',
        '',
        'LOAD CR1, CR6 [0x0000]',
    ].join('\n');

    let inputEvents = 0;
    editor.addEventListener('input', () => { inputEvents++; });
    window.AsmInstructionPicker = { hide: function () {} };
    window.eval(fs.readFileSync(path.join(__dirname, 'clist-viewer.js'), 'utf8'));

    window.CListViewer.show();
    await nextTurn();

    let popup = window.document.querySelector('.clist-viewer-popup');
    check('CLD-1: source C-List renders', popup && popup.textContent.includes('SelfTest'));
    check('CLD-2: CR0 has no delete button',
        popup.querySelector('[data-action="delete-capability"][data-slot="0"]') === null);

    const deleteCR1 = popup.querySelector('[data-action="delete-capability"][data-slot="1"]');
    check('CLD-3: CR1 has a delete button', !!deleteCR1);
    deleteCR1.click();
    await nextTurn();

    check('CLD-4: deleting CR1 preserves CR0',
        editor.value.includes('SelfTest E'), editor.value);
    check('CLD-5: deleting CR1 removes only its source capability',
        !editor.value.includes('Continue E'), editor.value);
    check('CLD-6: remaining rows are reindexed',
        popup.querySelector('.clist-row[data-slot="1"] .clist-name').textContent === 'Diagnostics',
        popup.innerHTML);
    check('CLD-7: source change emits an input event', inputEvents === 1, String(inputEvents));

    // Add must never create the first capability at CR0.
    editor.value = 'capabilities {\n}\n';
    window.CListViewer.show();
    await nextTurn();
    popup = window.document.querySelector('.clist-viewer-popup');
    popup.querySelector('[data-action="show-picker"]').click();
    await nextTurn();
    const pickerRow = window.document.createElement('div');
    pickerRow.className = 'clist-picker-row';
    pickerRow.dataset.capName = 'ShouldNotBeCR0';
    pickerRow.dataset.capRights = 'E';
    popup.appendChild(pickerRow);
    pickerRow.click();
    check('CLD-8: Add does not create a capability at CR0',
        editor.value === 'capabilities {\n}\n', editor.value);
    check('CLD-9: blocked Add does not emit an input event', inputEvents === 1, String(inputEvents));

    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    if (failed) process.exit(1);
}()).catch(err => {
    console.error(err.stack || err);
    process.exit(1);
});