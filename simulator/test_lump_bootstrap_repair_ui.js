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

    const approvedBoxes = plan.corrections.map(correction => ({
        checked: true,
        value: correction.id,
    }));
    const successButton = {disabled: false, textContent: ''};
    const successStatus = {textContent: ''};
    const successPanel = {
        dataset: {requiredCount: '2'},
        querySelector(selector) {
            if (selector === '.lump-bootstrap-repair-confirm') return successButton;
            if (selector === '.lump-bootstrap-repair-status') return successStatus;
            return null;
        },
        querySelectorAll(selector) {
            return selector === '.lump-bootstrap-repair-checkbox:checked'
                ? approvedBoxes
                : [];
        },
    };
    const responses = [
        plan,
        {intent: 'approved-intent'},
        {
            token: '4a000002',
            abstraction: 'CapabilityTest',
            lump_version: 27,
            namespace_slot: 2,
        },
    ];
    let committedToken = null;
    let openedToken = null;
    let renderCount = 0;
    const successContext = {
        document: {
            getElementById(id) {
                return id === 'success-panel' ? successPanel : null;
            },
        },
        fetch: async () => ({ok: true}),
        _actionableJsonResponse: async () => responses.shift(),
        _escHtml: context._escHtml,
        confirm: () => true,
        _showFpgaToast: () => {},
        _commitSavedLumpClientState: result => {
            committedToken = result.token;
        },
        _lumpTimelineLoaded: {},
        _lumpTokenIdentity: value => value,
        _closeLumpHistoryPreviewModal: () => {},
        renderLumps: async () => {
            renderCount += 1;
        },
        openLumpInEditor: async token => {
            openedToken = token;
        },
    };
    vm.createContext(successContext);
    vm.runInContext(source.slice(start, end), successContext);
    await successContext._confirmLumpBootstrapRepairs(
        'success-panel', '4a00000a', 26, 'archive.lump');

    assert.equal(committedToken, '4a000002',
        'the corrected destination becomes the selected saved LUMP');
    assert.equal(renderCount, 1, 'the LUMP browser refreshes');
    assert.equal(openedToken, '4a000002',
        'the corrected destination source opens in the editor');
    console.log('PASS fresh corrections require reapproval and a successful repair opens the new live source');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});