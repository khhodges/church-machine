'use strict';
// Regression checks against the browser entry points (not only the helper
// module): an upload response is gated before showLumpDetail, and compiler
// evidence is carried in the save payload.
const assert = require('assert');
const fs = require('fs');

const lumps = fs.readFileSync(__dirname + '/app-lumps.js', 'utf8');
const compile = fs.readFileSync(__dirname + '/app-compile.js', 'utf8');
const abstractions = fs.readFileSync(__dirname + '/app-abstractions.js', 'utf8');

assert(lumps.includes('admitUploadPhaseTwo'));
assert(lumps.includes("action: 'import-approval'"));
const gatePos = lumps.indexOf('const phase = await window.LumpAdmission.admitUploadPhaseTwo');
const derivativePos = lumps.indexOf('detailToken = phase.token', gatePos);
const detailPos = lumps.indexOf('showLumpDetail(detailToken)', gatePos);
assert(gatePos >= 0 && detailPos > gatePos,
    'upload must admit before it can open the imported artifact');
assert(derivativePos > gatePos && derivativePos < detailPos,
    'upload must open the admitted derivative token, not the quarantine token');
assert(lumps.indexOf('LumpRegistry.evictMemory(result.token)', gatePos) < detailPos,
    'rejected uploads must be evicted before any detail/open transition');
assert(compile.includes("fetch('/api/compile'"));
assert(compile.includes("_serverCompile.trust_origin !== 'trusted-home-ide'"));
assert(compile.includes('savePayload.metadata.compiler_record = _buildApproval.compiler_record'));
assert(abstractions.includes('selectArtifactForPreparation'));
assert(abstractions.includes('Choose the exact artifact revision and destination'));
assert(abstractions.includes('revision: _preparedArtifactSelection.selection.revision'));
// Execute the actual raw-upload phase-two browser branch, not a duplicate
// implementation. Library-only quarantine must never ask for a slot.
const admission = require('./lump_admission.js');
const phaseStart = lumps.indexOf("if (ct === 'lump') {", lumps.indexOf('let detailToken = result.token')) +
    "if (ct === 'lump') {".length;
const phaseEnd = lumps.indexOf('detailToken = phase.token;', phaseStart) + 'detailToken = phase.token;'.length;
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
const runBrowserBranch = new AsyncFunction('window', 'confirm', 'prompt', 'fetch', 'result', 'name', 'errEl',
    'let detailToken;\n' + lumps.slice(phaseStart, phaseEnd));
async function exercise({libraryOnly = false, location = '0x2200', resident = true} = {}) {
    const calls = [], prompts = [], error = {textContent: ''};
    const answers = resident ? ['1', '14', location, ''] : ['1', '14', ''];
    const confirmations = libraryOnly ? [false] : [true, false, resident, false, true];
    const win = {_nsState: libraryOnly ? null : {namespaceFingerprint: 'exact-reviewed-revision'}};
    const fetcher = async (url, options) => {
        calls.push({url, body: JSON.parse(options.body)});
        // A newer global state must not silently rebase this approval.
        win._nsState.namespaceFingerprint = 'newer-unreviewed-revision';
        if (url.endsWith('approval-intent')) return {ok: true, json: async () => ({intent: 'one-use'})};
        return {ok: false, json: async () => ({error: 'NS[14] full allocation overlaps NS[16]'})};
    };
    win.LumpAdmission = {admitUploadPhaseTwo: (upload, choices, intent) =>
        admission.admitUploadPhaseTwo(upload, choices, intent, fetcher)};
    let failure;
    try {
        await runBrowserBranch(win, () => confirmations.shift(), text => {
            prompts.push(text); return answers.shift();
        }, fetcher, {token: '12345678', binary_hash: 'a'.repeat(64),
            required_rights: [], required_capabilities: []}, 'AdmissionFixture', error);
    } catch (err) { failure = err; }
    return {calls, prompts, error, failure};
}
(async () => {
    const rejected = await exercise();
    assert.match(rejected.failure.message, /NS\[14\].*NS\[16\]/);
    assert.strictEqual(rejected.calls.length, 2, 'one intent and one commit; no refresh or retry');
    assert.strictEqual(rejected.calls[1].body.namespaceFingerprint, 'exact-reviewed-revision');
    assert.strictEqual(rejected.calls[1].body.location, 0x2200);
    assert.strictEqual(rejected.calls[1].body.destination_slot, 14);
    // One-use approval and commit bind precisely the same captured geometry
    // and Namespace revision, even when global state changes between them.
    assert.strictEqual(rejected.calls[0].body.approval.admission.location, 0x2200);
    assert.strictEqual(rejected.calls[0].body.approval.admission.namespaceFingerprint,
        'exact-reviewed-revision');
    assert.strictEqual(rejected.calls[0].body.approval.admission.location,
        rejected.calls[1].body.location);
    assert.strictEqual(rejected.calls[0].body.approval.admission.namespaceFingerprint,
        rejected.calls[1].body.namespaceFingerprint);
    const nonresident = await exercise({resident: false});
    assert.strictEqual(nonresident.calls[0].body.approval.admission.location, null);
    assert.strictEqual(nonresident.calls[1].body.location, null);
    assert.strictEqual(nonresident.calls[0].body.approval.admission.namespaceFingerprint,
        nonresident.calls[1].body.namespaceFingerprint);
    const missing = await exercise({location: ''});
    assert.match(missing.failure.message, /explicit non-negative whole word address/);
    assert.strictEqual(missing.calls.length, 0);
    const inert = await exercise({libraryOnly: true});
    assert.ifError(inert.failure);
    assert.strictEqual(inert.calls.length, 0);
    assert.strictEqual(inert.prompts.length, 0);
    assert.match(inert.error.textContent, /quarantine only/);
    let contacted = false;
    const missingContext = await admission.admitUploadPhaseTwo({}, {
        revision: 1, destination_slot: 14, replace: false, resident: true, boot: false,
    }, 'intent', async () => { contacted = true; });
    assert.strictEqual(missingContext.code, 'EXPLICIT_PLACEMENT_REQUIRED');
    assert.strictEqual(contacted, false);
    console.log('PASS Task 3488 real browser admission flow, exact CAS/placement, refusal and library-only tests');
})().catch(error => { console.error(error); process.exitCode = 1; });