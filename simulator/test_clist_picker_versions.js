'use strict';
// Regression test: the C-List capability picker must select one current LUMP
// per abstraction and keep archived versions behind an explicit disclosure.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let passed = 0;
let failed = 0;
function check(label, condition) {
    if (condition) { console.log('PASS ' + label); passed++; }
    else { console.error('FAIL ' + label); failed++; }
}
function nextTurn() { return new Promise(resolve => setTimeout(resolve, 0)); }

(async function () {
    const dom = new JSDOM(
        '<!doctype html><html><body><textarea id="asmEditor">capabilities {\n}</textarea></body></html>',
        { url: 'http://localhost/simulator/', runScripts: 'outside-only' }
    );
    const { window } = dom;
    window.AsmInstructionPicker = { hide: function () {} };
    window.fetch = async function () {
        return {
            ok: true,
            json: async function () {
                return [
                    { abstraction: 'Echo', token: 'old', ns_slot: 12, compiled_at: '2026-08-01T00:00:00Z', binary_valid: true },
                    { abstraction: 'Echo', token: 'new', ns_slot: 12, compiled_at: '2026-08-10T00:00:00Z', binary_valid: true },
                    { abstraction: 'Echo', token: 'broken', ns_slot: 12, compiled_at: '2026-08-20T00:00:00Z', binary_valid: false },
                    { abstraction: 'Nova', token: 'nova', ns_slot: 13, compiled_at: '2026-08-05T00:00:00Z', binary_valid: true },
                ];
            },
        };
    };
    window.eval(fs.readFileSync(path.join(__dirname, 'clist-viewer.js'), 'utf8'));

    window.CListViewer.show();
    await nextTurn();
    const popup = window.document.querySelector('.clist-viewer-popup');
    popup.querySelector('[data-action="show-picker"]').click();
    await nextTurn();
    await nextTurn();

    const echoRows = Array.from(popup.querySelectorAll('.clist-picker-row'))
        .filter(row => row.dataset.capName === 'Echo' && !row.closest('.clist-picker-earlier'));
    check('CPV-1: only the newest valid Echo LUMP is visible by default', echoRows.length === 1 &&
        echoRows[0].textContent.includes('latest dated tested'));
    const earlier = popup.querySelector('.clist-picker-earlier');
    check('CPV-2: older Echo versions are behind a disclosure', !!earlier &&
        earlier.textContent.includes('Earlier versions (2)'));
    earlier.open = true;
    check('CPV-3: opening the disclosure reveals the earlier versions',
        Array.from(earlier.querySelectorAll('.clist-picker-row')).length === 2);
    check('CPV-4: an abstraction with one LUMP has no duplicate row',
        Array.from(popup.querySelectorAll('.clist-picker-row'))
            .filter(row => row.dataset.capName === 'Nova').length === 1);

    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    if (failed) process.exit(1);
}()).catch(err => {
    console.error(err.stack || err);
    process.exit(1);
});