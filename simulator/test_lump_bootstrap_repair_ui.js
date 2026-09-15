'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('simulator/app-lumps.js', 'utf8');
const start = source.indexOf('async function _confirmLumpBootstrapRepairs(');
const end = source.indexOf('\nfunction ', start + 1);
assert.ok(start >= 0 && end > start, 'bootstrap repair confirmation helper is available');

const oldCheckbox = {
    checked: true,
    value: 'issue-canonical-bootstrap-identity',
};
const button = {disabled: false, textContent: ''};
const status = {textContent: ''};
const list = {innerHTML: ''};
const panel = {
    dataset: {requiredCount: '1'},
    querySelector(selector) {
        if (selector === '.lump-bootstrap-repair-confirm') return button;
        if (selector === '.lump-bootstrap-repair-status') return status;
        if (selector === '.lump-bootstrap-repair-list') return list;
        return null;
    },
    querySelectorAll(selector) {
        if (selector === '.lump-bootstrap-repair-checkbox:checked') {
            return [oldCheckbox];
        }
        return [];
    },
};

let fetchCount = 0;
let confirmCount = 0;
const plan = {
    corrections: [
        {
            id: 'repair-sealed-row-zero-gt',
            title: 'Correct the sealed c-list row-zero GT',
            detail: 'Use the server-derived destination GT.',
        },
        {
            id: 'issue-canonical-bootstrap-identity',
            title: 'Issue the repaired bytes as the canonical live LUMP',
            detail: 'Create a new destination-bound live revision.',
        },
    ],
};
const context = {
    document: {
        getElementById(id) {
            return id === 'repair-panel' ? panel : null;
        },
    },
    fetch: async () => {
        fetchCount += 1;
        return {ok: true};
    },
    _actionableJsonResponse: async () => plan,
    _escHtml: value => String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('"', '&quot;'),
    confirm: () => {
        confirmCount += 1;
        return true;
    },
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);

(async () => {
    await context._confirmLumpBootstrapRepairs(
        'repair-panel', '4a00000a', 26, 'archive.lump');

    assert.equal(fetchCount, 1, 'only the fresh plan is requested');
    assert.equal(confirmCount, 0, 'new corrections are not silently approved');
    assert.equal(panel.dataset.requiredCount, '2');
    assert.equal(button.disabled, true);
    assert.equal(button.textContent, 'Confirm 0 approved corrections');
    assert.ok(list.innerHTML.includes('repair-sealed-row-zero-gt'));
    assert.ok(list.innerHTML.includes('issue-canonical-bootstrap-identity'));
    assert.match(status.textContent, /additional required corrections/);
    assert.match(status.textContent, /No data was changed/);
    console.log('PASS fresh server corrections replace stale choices and require explicit reapproval');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});