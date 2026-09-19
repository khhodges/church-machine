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
        '    SELF E',
        '    WukongCallHome.hw E',
        '    Continue E',
        '    Diagnostics R',
        '}',
        '',
        'CALL WukongCallHome.hw',
        'CALL Continue',
        'LOAD CR2, Diagnostics',
        'LOAD CR1, CR6 [0x0000]',
    ].join('\n');

    let inputEvents = 0;
    editor.addEventListener('input', () => { inputEvents++; });
    const liveMemory = [];
    liveMemory[100 + 45] = 0x10000001;
    window.sim = {
        bootComplete: true,
        cr: {
            6: { word0: 0x10000001, word1: 100 },
            14: { word0: 0x4A000006 },
        },
        memory: liveMemory,
        nsLabels: { 1: 'Boot.Thread', 6: 'SelfTest' },
        _clistCountForCR: function () { return 46; },
        threadStatusRows: function () {
            return [{ slot: 1, name: 'Thread.1' }];
        },
    };
    window.AsmInstructionPicker = { hide: function () {} };
    window.eval(fs.readFileSync(path.join(__dirname, 'clist-viewer.js'), 'utf8'));
    const livePetNames = window.CListViewer.getSlotPetNames();
    check('CLD-0: live Thread.1 pet name maps to its active C-list row',
        livePetNames[45] === 'Thread.1', JSON.stringify(livePetNames));
    const savedWords = new Uint32Array(64);
    savedWords[0] = 46;
    savedWords[63] = 0x10000001;
    window._editorLastSavedToken = null;
    window._lumpWordsCache = { 'thread-fixture': savedWords };
    window.localStorage.setItem('church_editor_document_v1', JSON.stringify({
        owner: { type: 'lump', id: 'thread-fixture' },
    }));
    window.sim.bootComplete = false;
    const preRunPetNames = window.CListViewer.getSlotPetNames();
    check('CLD-0b: restored pre-Run draft maps Thread.1 to saved C-list row 45',
        preRunPetNames[45] === 'Thread.1', JSON.stringify(preRunPetNames));
    window.sim.bootComplete = true;

    window.CListViewer.show();
    await nextTurn();

    let popup = window.document.querySelector('.clist-viewer-popup');
    await nextTurn();
    popup.querySelector('[data-action="pola-cleanup"]').click();
    await nextTurn();
    check('CLD-1: source C-List renders', popup && popup.textContent.includes('SelfTest'));
    check('CLD-2: row 0 is always displayed as SELF',
        popup.querySelector('.clist-row[data-slot="0"] .clist-self-name').textContent === 'SELF' &&
        popup.querySelector('.clist-row[data-slot="0"] .clist-self-target').textContent === '(SelfTest)' &&
        popup.querySelector('.clist-row[data-slot="0"] .clist-slot').textContent === '0' &&
        !popup.querySelector('.clist-row[data-slot="0"] .clist-name').textContent.includes('WukongCallHome.hw'),
        popup.querySelector('.clist-row[data-slot="0"] .clist-name').textContent);
    check('CLD-3: row 0 has no delete button',
        popup.querySelector('[data-action="delete-capability"][data-slot="0"]') === null);
    const beforeSelfClick = editor.value;
    popup.querySelector('.clist-row[data-slot="0"] .clist-self-name').click();
    check('CLD-3b: clicking SELF does not modify the editor',
        editor.value === beforeSelfClick && inputEvents === 0, editor.value);

    const deleteCR1 = popup.querySelector('[data-action="delete-capability"][data-slot="1"]');
    check('CLD-4: CR1 has a delete button', !!deleteCR1);
    deleteCR1.click();
    await nextTurn();

    check('CLD-5: deleting row 1 preserves SELF in row 0',
        popup.querySelector('.clist-row[data-slot="0"] .clist-self-name').textContent === 'SELF',
        popup.innerHTML);
    check('CLD-6: deleting CR1 removes only the source capability at CR1',
        editor.value.includes('SELF E') &&
        !editor.value.includes('WukongCallHome.hw E') &&
        editor.value.includes('Continue E') &&
        editor.value.includes('Diagnostics R'), editor.value);
    check('CLD-7: remaining rows are reindexed',
        popup.querySelector('.clist-row[data-slot="1"] .clist-name').textContent === 'Continue',
        popup.innerHTML);
    check('CLD-8: source change emits an input event', inputEvents === 1, String(inputEvents));

    // Add must never create the first capability at CR0.
    editor.value = 'capabilities {\n}\n';
    window.CListViewer.show();
    await nextTurn();
    popup = window.document.querySelector('.clist-viewer-popup');
    await nextTurn();
    const pickerRow = window.document.createElement('div');
    pickerRow.className = 'clist-picker-row';
    pickerRow.dataset.capName = 'ShouldNotBeCR0';
    pickerRow.dataset.capRights = 'E';
    popup.appendChild(pickerRow);
    pickerRow.click();
    check('CLD-9: Add does not create a capability at CR0',
        editor.value === 'capabilities {\n}\n', editor.value);
    check('CLD-10: blocked Add does not emit an input event', inputEvents === 1, String(inputEvents));

    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    if (failed) process.exit(1);
}()).catch(err => {
    console.error(err.stack || err);
    process.exit(1);
});