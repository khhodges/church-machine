'use strict';

// node simulator/test_build_approval_revision_selection.js
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const source = fs.readFileSync('simulator/app-build-approval.js', 'utf8');
const actionable = require('./actionable_errors.js');
const elements = {
    baMapBody: {innerHTML: ''},
    baIssueComments: {innerHTML: ''},
    baApproveBtn: { disabled: true },
    baFreezeBtn: { disabled: true },
    baSelectSnapshotBtn: { disabled: true },
    baSnapshotStatus: { textContent: '' },
    baRevisionSelect: { innerHTML: '', value: '' },
    baBitstreamRevisionSelect: { innerHTML: '', value: '' },
    baBitstreamRevisionStatus: { textContent: '' },
    baDownloadRevisionBtn: { disabled: true },
};
let savedFiles = 0;
const context = {
    console,
    crypto: crypto.webcrypto,
    Uint8Array,
    URL: { createObjectURL: () => 'blob:bitstream', revokeObjectURL() {} },
    document: {
        getElementById: id => elements[id] || null,
        createElement: () => ({ click() { savedFiles++; }, remove() {} }),
        body: { appendChild() {} },
    },
    window: {},
    sessionStorage: { getItem: () => 'report-token', setItem() {} },
    ...actionable,
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'app-build-approval.js' });
const view = vm.runInContext('BuildApprovalView', context);
view._render({slot_rules: [{slot: 0, name: 'Legacy Boot.NS'}]});
assert(elements.baMapBody.innerHTML.includes('no revision selected'));
assert(!elements.baMapBody.innerHTML.includes('Legacy Boot.NS'));
assert(elements.baMapBody.innerHTML.includes('not verified'));
view._selectedSavedEntry = {id:'inspection-example', name:'Frozen image', inspectionOnly:true,
    source:'Exact frozen image bytes', imageSha256:'a'.repeat(64),
    slots:[{slot:1,name:'Namespace',allocationWords:256}]};
view._renderSelectedSlots();
assert(elements.baMapBody.innerHTML.includes('inspection-example'));
assert(elements.baMapBody.innerHTML.includes('a'.repeat(64)));
assert(elements.baMapBody.innerHTML.includes('256'));
view._lastMap = {slot_rules:[]};
view._updateApproveBtn();
assert(elements.baFreezeBtn.disabled);
assert(elements.baApproveBtn.disabled);
view._selectedSavedEntry = null;
view._lastMap = null;

const first = {
    filename: 'build-approval-202610010001.json',
    namespace_revision_id: 'namespace-first',
    provenance_identity: 'provenance-first',
};
const second = {
    filename: 'build-approval-202610010002.json',
    namespace_revision_id: 'namespace-second',
    provenance_identity: 'provenance-second',
};
const revisionId = 'a'.repeat(64);
const historical = {
    kind: 'namespace', revision_id: revisionId,
    metadata: {
        approval_state: 'approved',
        snapshot_filename: 'build-approval-202609300001.json',
        build_intent_id: 'wukong-build-intent:v2:historical',
        snapshot: {
            fingerprint: 'b'.repeat(64),
            provenance: { approval_frozen_at: '202609300001Z' },
        },
    },
};

(async () => {
    assert.strictEqual(view._revisionChoice({
        ...historical,
        metadata: { ...historical.metadata, purpose: 'approved-simulation' },
    }), null, 'simulation approval cannot become a hardware selection');
    assert.strictEqual(view._revisionChoice({
        ...historical, hardware_certified: false,
    }), null, 'uncertified hardware history cannot become a selection');
    assert.strictEqual(view._snapshotIdentity({
        filename: first.filename, provenance_identity: first.provenance_identity,
    }), null, 'legacy map-only snapshots cannot be selected as approved Namespace revisions');
    assert.strictEqual(view._revisionChoice({
        ...historical, metadata: { snapshot: historical.metadata.snapshot },
    }), null, 'revision history without the issued build intent cannot be selected');
    context.fetch = async url => {
        assert.strictEqual(url, '/api/artifact-revisions/namespace');
        return {
            ok: true, status: 200,
            async json() { return { ok: true, revisions: [historical] }; },
        };
    };
    await view._loadRevisions();
    assert.strictEqual(view._selectedSnapshot, null, 'history fetch must not auto-adopt');
    assert(elements.baRevisionSelect.innerHTML.includes(revisionId.slice(0, 12)));
    view.selectRevisionId(revisionId);
    assert.strictEqual(view._selectedSnapshot.provenance_identity,
        historical.metadata.build_intent_id, 'history selection uses frozen provenance verbatim');
    assert.strictEqual(view._selectedSnapshot.namespace_fingerprint,
        historical.metadata.snapshot.fingerprint);
    const draft = {id: 'design:' + 'c'.repeat(64), revision_id: 'c'.repeat(64),
        name: 'New Layout', saved_at: '2026-11-04', approval: 'Not approved',
        testing: 'Not tested', preparation: 'Needs preparation',
        slots: [{slot: 21, name: '<Saved entry>', kind: 'lump', policy: 'Resident', boot: true}]};
    const grouped = view._savedRevisionOptions([
        {...draft, id: 'old', saved_at: '20261006T143256136794Z'},
        {...draft, id: 'unknown', saved_at: 'not a date'},
        {...draft, id: 'early', saved_at: '2026-11-04T10:00:00Z'},
        {...draft, id: 'late', saved_at: '2026-11-04T15:00:00Z', name: '<Latest>'},
    ]);
    assert.strictEqual((grouped.match(/<optgroup /g) || []).length, 3);
    assert(grouped.indexOf('2026-11-04 (UTC)') < grouped.indexOf('2026-10-06 (UTC)'));
    assert(grouped.indexOf('value="late"') < grouped.indexOf('value="early"'));
    assert(grouped.indexOf('value="old"') < grouped.indexOf('value="unknown"'));
    assert(grouped.includes('14:32:56 UTC'));
    assert(grouped.includes('&lt;Latest&gt;'));
    assert(grouped.includes('Not tested'));
    context.fetch = async () => ({ok: true, status: 200,
        json: async () => ({revisions: [historical], saved_entries: [draft]})});
    await view._loadRevisions();
    assert(elements.baRevisionSelect.innerHTML.includes('New Layout'));
    view.selectRevisionId(draft.id);
    assert.strictEqual(view._selectedSnapshot, null, 'draft selection clears old hardware authority');
    assert.strictEqual(elements.baApproveBtn.disabled, true);
    assert(elements.baSnapshotStatus.textContent.includes('Needs preparation'));
    assert(elements.baMapBody.innerHTML.includes('&lt;Saved entry&gt;'));
    assert(!elements.baMapBody.innerHTML.includes('<select'));
    view._render({slot_rules: [{slot: 99, name: 'Unrelated live draft'}]});
    view._renderIssueComments({slot_rules: []});
    assert(elements.baMapBody.innerHTML.includes('&lt;Saved entry&gt;'));
    assert(!elements.baMapBody.innerHTML.includes('Unrelated live draft'));
    assert(!elements.baIssueComments.innerHTML.includes('All current validation checks pass'));
    context.fetch = async () => ({ok: true, status: 200,
        json: async () => ({revisions: [historical], saved_entries: []})});
    await view._loadRevisions();
    assert.strictEqual(view._selectedSavedEntry.id, draft.id, 'refresh never substitutes a newer draft');
    assert(elements.baRevisionSelect.innerHTML.includes('Saved version changed'));
    view._selectedSnapshot = null;
    view._updateApproveBtn();
    let available = first;
    context.fetch = async url => {
        assert.strictEqual(url, '/api/build-approval/snapshot/latest');
        return { ok: true, async json() { return available; } };
    };
    view._lastMap = { slot_rules: [{ load_policy: 'Resident', checks: [{ ok: false }] }] };
    await view._loadSnapshot();
    assert.strictEqual(elements.baApproveBtn.disabled, true,
        'loading latest must not implicitly select it');
    assert.strictEqual(elements.baSelectSnapshotBtn.disabled, false);
    view.selectAvailableSnapshot();
    assert.strictEqual(view._selectedSnapshot.namespace_revision_id, first.namespace_revision_id);
    assert.strictEqual(elements.baApproveBtn.disabled, false,
        'an approved older revision remains buildable even when the current draft fails checks');
    available = second;
    await view._loadSnapshot();
    assert.strictEqual(view._selectedSnapshot.provenance_identity, first.provenance_identity,
        'a newer approval must never replace the selected upstream revision');
    context.window.TargetState = {
        resolve: () => ({ buildId: second.provenance_identity }),
    };
    await view.startBuild();
    assert(elements.baSnapshotStatus.textContent.includes(first.provenance_identity),
        'a mismatched target build must be rejected before any build request');

    let submitted = null;
    context.window.TargetState = {
        resolve: () => ({ buildId: first.provenance_identity }),
        authorize: (kind, artifact) => {
            assert.strictEqual(kind, 'build');
            assert.strictEqual(artifact.id, first.provenance_identity);
            return { ok: true, request: { artifact_identity: artifact.id } };
        },
    };
    view._renderConsole = () => {};
    view._startBuildPoll = () => {};
    view._buildNonce = 'csrf-nonce';
    context.fetch = async (url, options) => {
        assert.strictEqual(url, '/api/wukong-build/start');
        submitted = JSON.parse(options.body);
        return { ok: true, status: 200, async json() { return { ok: true }; } };
    };
    await view.startBuild();
    assert.strictEqual(submitted.namespace_revision_id, first.namespace_revision_id);
    assert.strictEqual(submitted.snapshot_filename, first.filename);
    assert.strictEqual(submitted.provenance_identity, first.provenance_identity);
    assert.strictEqual(submitted.build_nonce, 'csrf-nonce');
    view._buildRunning = false;
    context.fetch = async (url, options) => {
        if (url === '/api/artifact-revisions/namespace') {
            return { ok: true, status: 200, async json() {
                return { ok: true, revisions: [historical] };
            } };
        }
        assert.strictEqual(url, '/api/build-approval/freeze-snapshot');
        assert.strictEqual(options.method, 'POST');
        return { ok: true, status: 200, async json() { return second; } };
    };
    await view.freezeSnapshot();
    assert.strictEqual(view._selectedSnapshot.namespace_revision_id, second.namespace_revision_id,
        'an explicit freeze switches selection to the exact newly approved revision');

    const bitBytes = Buffer.from('historical immutable bitstream bytes');
    const bitHash = crypto.createHash('sha256').update(bitBytes).digest('hex');
    const bitId = 'c'.repeat(64);
    const legacyId = 'd'.repeat(64);
    context.fetch = async url => {
        assert.strictEqual(url, '/api/artifact-revisions/bitstream');
        return { ok: true, status: 200, async json() {
            return { ok: true, revisions: [
                {
                    kind: 'bitstream', revision_id: bitId,
                    metadata: {
                        approval_state: 'approved',
                        namespace_revision_id: revisionId,
                        source_commit: 'e'.repeat(40),
                        hardware_version: 8,
                    },
                    files: { 'bitstream.bit': bitHash },
                },
                {
                    kind: 'bitstream', revision_id: legacyId,
                    metadata: { approval_state: 'legacy-unverified' },
                    files: { 'bitstream.bit': bitHash },
                },
            ] };
        } };
    };
    await view._loadBitstreamRevisions();
    assert.strictEqual(view._selectedBitstream, null, 'history fetch must not auto-download or select');
    assert.strictEqual(savedFiles, 0);
    assert.strictEqual(elements.baDownloadRevisionBtn.disabled, true);
    assert(elements.baBitstreamRevisionSelect.innerHTML.includes('Approved · exact Namespace'));
    assert(elements.baBitstreamRevisionSelect.innerHTML.includes('Legacy / unverified'));
    assert(elements.baRevisionSelect.innerHTML.includes('value="bitstream:' + bitId + '"'));
    assert(elements.baRevisionSelect.innerHTML.includes('value="bitstream:' + legacyId + '"'));
    assert(elements.baRevisionSelect.innerHTML.includes('color:#8bc8ff'));
    view.selectRevisionId('bitstream:' + legacyId);
    assert.strictEqual(view._selectedBitstream.revision_id, legacyId);
    assert.strictEqual(view._selectedSnapshot, null);
    assert.strictEqual(elements.baApproveBtn.disabled, true);
    assert(elements.baSnapshotStatus.textContent.includes('link was not recorded'));
    assert(elements.baMapBody.innerHTML.includes('No saved Namespace slot data'));
    assert(!elements.baMapBody.innerHTML.includes('&lt;Saved entry&gt;'));
    view._savedNamespaceEntries = [{id: revisionId, revision_id: revisionId, name: 'Frozen Namespace',
        slots: [{slot: 4, name: 'Frozen only'}]}];
    view.selectRevisionId('bitstream:' + bitId);
    assert(elements.baMapBody.innerHTML.includes('Frozen only'));
    view.selectRevisionId('bitstream:' + legacyId);
    view._renderSavedBuildPicker();
    assert.strictEqual(elements.baRevisionSelect.value, 'bitstream:' + legacyId);
    assert.strictEqual(savedFiles, 0, 'combined selection cannot download or operate hardware');
    view.selectBitstreamRevision(legacyId);
    assert(elements.baBitstreamRevisionStatus.textContent.includes('Unverified / legacy'));
    assert.strictEqual(elements.baDownloadRevisionBtn.disabled, true,
        'legacy outputs are identified but not delivered as approved bytes');
    assert.strictEqual(await view.downloadSelectedBitstream(), false);
    assert.strictEqual(savedFiles, 0);
    view.selectBitstreamRevision(bitId);
    assert(elements.baBitstreamRevisionStatus.textContent.includes(revisionId));
    const selectedBuild = view._selectedSnapshot;
    context.fetch = async (url, options) => {
        assert.strictEqual(url, `/api/artifact-revisions/bitstream/${bitId}/download`);
        assert.strictEqual(options.cache, 'no-store');
        assert.strictEqual(options.headers.Authorization, 'Bearer report-token');
        return {
            ok: true,
            headers: { get: name => {
                assert.strictEqual(name, 'X-Artifact-SHA256');
                return bitHash;
            } },
            async blob() { return { async arrayBuffer() { return bitBytes; } }; },
        };
    };
    const validFetch = context.fetch;
    context.fetch = async (...args) => {
        const response = await validFetch(...args);
        response.blob = async () => ({ async arrayBuffer() {
            return Buffer.from('tampered bitstream');
        } });
        return response;
    };
    assert.strictEqual(await view.downloadSelectedBitstream(), false);
    assert.strictEqual(savedFiles, 0, 'changed bytes cannot be saved');
    assert(elements.baBitstreamRevisionStatus.textContent.includes('do not match'));
    context.fetch = validFetch;
    assert.strictEqual(await view.downloadSelectedBitstream(), true);
    assert.strictEqual(savedFiles, 1, 'only an explicit exact download saves bytes');
    context.fetch = async (...args) => {
        const response = await validFetch(...args);
        response.headers = { get: () => null };
        return response;
    };
    assert.strictEqual(await view.downloadSelectedBitstream(), true,
        'the authenticated legacy response remains downloadable when bytes hash exactly');
    assert.strictEqual(savedFiles, 2);
    assert.strictEqual(view._selectedSnapshot, selectedBuild,
        'downloading historical bytes must not activate or change the selected upstream build');
    assert(elements.baBitstreamRevisionStatus.textContent.includes('no device or active build was changed'));
    console.log('PASS exact approved Namespace revision selection');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});