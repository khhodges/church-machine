'use strict';

const fs = require('fs');
const path = require('path');
const {
    _formatActionableHttpError,
    _formatActionableNetworkError,
    _actionableResponseError,
    _actionableJsonResponse,
} = require('./actionable_errors.js');

let passed = 0;
let failed = 0;
function check(name, condition, detail) {
    if (condition) {
        console.log('PASS', name);
        passed++;
    } else {
        console.log('FAIL', name, detail || '');
        failed++;
    }
}

const conflict = _formatActionableHttpError(
    'Audit of this saved LUMP', 409,
    JSON.stringify({ error: 'canonical binary hash does not match the repository record' }),
    {
        dataChanged: false,
        nextAction: 'Reload the saved LUMP and run Audit again.',
    });
check('409 report identifies the failed operation and status',
    conflict.includes('Audit of this saved LUMP failed (HTTP 409)'));
check('409 report preserves the server reason',
    conflict.includes('canonical binary hash does not match'));
check('409 report says whether data changed',
    conflict.includes('No data was changed.'));
check('409 report provides a concrete next action',
    conflict.includes('Next: Reload the saved LUMP and run Audit again.'));

const missingReason = _formatActionableHttpError(
    'Open saved LUMP', 500, '<html>failure</html>',
    { dataChanged: null, nextAction: 'Retry Open, then inspect the server logs.' });
check('missing server reason is stated rather than reduced to status only',
    missingReason.includes('The server did not provide a reason.'));
check('unknown mutation state is explicit',
    missingReason.includes('Data-change status is unknown.'));

const plainText = _formatActionableHttpError(
    'Archive saved LUMP', 502, 'upstream archive service unavailable',
    { dataChanged: null, nextAction: 'Reload the repository before retrying Archive.' });
check('plain-text server reason is preserved',
    plainText.includes('upstream archive service unavailable'));

const network = _formatActionableNetworkError(
    'Load Namespace map', new Error('connection reset'),
    { dataChanged: false, nextAction: 'Check the IDE connection, then click Refresh.' });
check('network error identifies operation, mutation state, and recovery',
    network.includes('Load Namespace map failed.') &&
    network.includes('connection reset') &&
    network.includes('No data was changed.') &&
    network.includes('Next: Check the IDE connection, then click Refresh.'));

(async function() {
    const err = await _actionableResponseError({
        status: 422,
        text: async () => JSON.stringify({ reason: 'slot is reserved' }),
    }, 'Update Namespace slot', {
        dataChanged: false,
        nextAction: 'Choose an editable slot and retry Save.',
    });
    check('response helper reads JSON reason',
        err.message.includes('slot is reserved') &&
        err.message.includes('Choose an editable slot'));

    let nonJsonError = null;
    try {
        await _actionableJsonResponse({
            ok: false,
            status: 502,
            text: async () => 'upstream bridge unavailable',
        }, 'Start the approved hardware build', {
            dataChanged: false,
            nextAction: 'Refresh build status before retrying.',
        });
    } catch (error) {
        nonJsonError = error;
    }
    check('operation helper preserves non-JSON server errors',
        nonJsonError &&
        nonJsonError.message.includes('upstream bridge unavailable') &&
        nonJsonError.message.includes('No data was changed.') &&
        nonJsonError.message.includes('Refresh build status'));

    const operationFiles = [
        'app-lumps.js', 'app-memory.js', 'app-misc.js',
        'app-abstractions.js', 'app-build-approval.js', 'webserial.js',
        'app-run.js', 'app-shell.js', 'app-compile.js',
        'app-lump-editor.js', 'starter-app.js',
    ];
    for (const filename of operationFiles) {
        const source = fs.readFileSync(path.join(__dirname, filename), 'utf8');
        check(filename + ' routes failures through actionable formatting',
            /_actionable(ResponseError|JsonResponse)|_formatActionable(Http|Network)Error/.test(source));
        check(filename + ' has no visible bare HTTP-status construction',
            !/throw new Error\([^)]*(?:HTTP|Server returned)\s*(?:\+|\$\{)/.test(source));
    }

const auditSource = fs.readFileSync(path.join(__dirname, 'lump-audit.js'), 'utf8');
check('saved-LUMP audit reads the rejection body',
    auditSource.includes('const body = await resp.text();'));
check('saved-LUMP audit uses actionable HTTP formatting',
    auditSource.includes("_formatActionableHttpError(") &&
    auditSource.includes('Reload the saved LUMP and run Audit again.'));

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) process.exit(1);
})();