'use strict';
const assert = require('assert');
const fs = require('fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync('simulator/namespace-inspector.js', 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const row = {
    slot: 15, name: 'ide.Mallory', seq: 7, symbolic: true, implementationMissing: true,
    resident: true, token: '12345678', filename: 'Mallory.executable.lump',
    binary_hash: 'a'.repeat(64), selection: {
        token: '87654321', filename: 'Mallory.design.lump', binaryHash: 'b'.repeat(64),
    },
};
function setup() {
    const dom = new JSDOM('<button id="trigger">Inspect</button>', { runScripts: 'outside-only', url: 'http://localhost/' });
    const w = dom.window;
    w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    w.HTMLDialogElement.prototype.close = function () { this.open = false; };
    const calls = [];
    const inspected = {
        ok: true, namespaceFingerprint: 'reviewed', savedAbstractions: [row], row,
        kind: 'design', issues: [{ code: 'mixed', message: 'Conflicting executable identity',
            severity: 'error', nextAction: 'Compare the two references and choose your intended assignment.' }],
        limitations: ['Review saves only Namespace rows.', 'Image generation is a separate action.'],
        claims: { design: { reference: row.selection, status: 'verified', verified: true },
            executable: { reference: row, status: 'verified', verified: true } },
        actions: ['keep-design', 'select-artifact', 'edit-geometry', 'repair-binding'],
    };
    w.fetch = async (url, options = {}) => {
        calls.push({ url, options });
        let payload;
        if (url.startsWith('/api/namespace/inspect')) payload = inspected;
        else if (url === '/api/boot-image/capacity') payload = { rows: [{ slot: 15, status: 'image evidence only' }] };
        else if (url === '/api/lumps/list') payload = [];
        else if (url === '/api/namespace/resolve-preview') {
            const after = { ...row };
            delete after.resident;
            delete after.token;
            payload = { ok: true, before: row, after,
                changes: [
                    { field: 'resident', beforePresent: true, afterPresent: false, before: true, after: null },
                    { field: 'presentNull', beforePresent: false, afterPresent: true, before: null, after: null },
                ],
                issues: [], savePayload: { namespaceFingerprint: 'reviewed', ns_state: { abstractions: [after] } } };
        } else if (url === '/api/namespace/save-table') {
            payload = { savedAbstractions: JSON.parse(options.body).ns_state.abstractions,
                abstractions: [], namespaceFingerprint: 'committed' };
        } else throw new Error(`Unexpected ${url}`);
        return { ok: true, json: async () => payload };
    };
    w.eval(source);
    return { w, calls, inspected, dom };
}
(async () => {
    {
        const { w, calls } = setup();
        await w.NamespaceInspector.open(15);
        await tick();
        assert(w.document.querySelector('#namespaceInspector').textContent.includes('ide.Mallory'));
        assert(w.document.querySelector('#namespaceInspector').textContent.includes('Mallory.executable.lump'));
        assert(w.document.querySelector('#namespaceInspector').textContent.includes('Mallory.design.lump'));
        const issue = w.document.querySelector('.ns-inspector-issues li');
        assert(issue.textContent.includes('Error: Conflicting executable identity'));
        assert(issue.querySelector('p').textContent.startsWith('Next action: Compare'));
        assert.strictEqual(issue.querySelector('details').open, false);
        assert.strictEqual(issue.querySelector('summary').textContent, 'Technical details');
        assert.strictEqual(w.document.querySelectorAll('.ns-inspector-limitations li').length, 2);
        assert(!w.document.querySelector('.ns-inspector-limitations').textContent.includes('['));
        assert.strictEqual(w.document.querySelector('[data-apply]').closest('[data-scroll]'), null);
        assert.strictEqual(w.document.querySelector('[data-close]').closest('[data-scroll]'), null);
        assert.strictEqual(calls.filter(c => c.options.method === 'POST').length, 0);
        w.NamespaceInspector.close();
        assert.strictEqual(w.document.querySelector('#namespaceInspector'), null);
    }
    {
        const { w, calls } = setup();
        await w.NamespaceInspector.open(15);
        const select = w.document.querySelector('[data-action]');
        select.value = 'keep-design'; select.onchange();
        await w.document.querySelector('[data-preview]').onclick();
        const diffRows = w.document.querySelectorAll('.ns-inspector-diff tbody tr');
        assert.strictEqual(diffRows[0].cells[1].textContent, 'REMOVED');
        assert.strictEqual(diffRows[0].cells[3].textContent, '(absent)');
        assert.strictEqual(diffRows[1].cells[1].textContent, 'ADDED');
        assert.strictEqual(diffRows[1].cells[2].textContent, '(absent)');
        assert.strictEqual(diffRows[1].cells[3].textContent, 'null');
        assert.strictEqual(calls.filter(c => c.url.endsWith('save-table')).length, 0);
        assert.strictEqual(w.document.querySelector('[data-apply]').disabled, false);
        await w.document.querySelector('[data-apply]').onclick();
        const posted = JSON.parse(calls.find(c => c.url.endsWith('save-table')).options.body);
        assert.strictEqual(posted.namespaceFingerprint, 'reviewed');
        assert.strictEqual(posted.ns_state.abstractions[0].slot, 15);
        assert.strictEqual(posted.ns_state.abstractions[0].seq, 7);
        assert.strictEqual(w._nsState.namespaceFingerprint, 'committed');
        assert.match(w.document.querySelector('[data-status]').textContent, /1 remaining diagnostic/);
        assert.match(w.document.querySelector('[data-content]').textContent, /Currently saved:/);
        assert.match(w.document.querySelector('[data-content]').textContent, /does not repair the old committed image/);
        assert.strictEqual(calls.filter(c => c.url.endsWith('save-table')).length, 1);
        assert.strictEqual(calls.filter(c => c.url.startsWith('/api/namespace/inspect')).length, 2);
        assert(!w.document.querySelector('[data-status]').textContent.includes('correction saved'));
    }
    {
        const { w, calls } = setup();
        await w.NamespaceInspector.open(15);
        const select = w.document.querySelector('[data-action]');
        select.value = 'repair-binding'; select.onchange();
        assert.match(w.document.querySelector('[data-intention]').textContent, /Align Namespace binding with verified saved SELF/);
        assert.strictEqual(calls.filter(c => c.options.method === 'POST').length, 0);
        await w.document.querySelector('[data-preview]').onclick();
        assert.strictEqual(JSON.parse(calls.find(c => c.url.endsWith('resolve-preview')).options.body).action, 'repair-binding');
        const original = w.fetch;
        w.fetch = (url, init) => url.startsWith('/api/namespace/inspect')
            ? Promise.reject(new Error('Inspection unavailable')) : original(url, init);
        await w.document.querySelector('[data-apply]').onclick();
        assert.match(w.document.querySelector('[data-status]').textContent, /change saved, but persisted state and remaining diagnostics were not checked/);
        assert.strictEqual(calls.filter(c => c.url.endsWith('save-table')).length, 1);
        assert.strictEqual(w.document.querySelector('[data-apply]').disabled, true);
    }
    {
        const { w, calls, inspected } = setup();
        inspected.row = { ...row };
        delete inspected.row.selection;
        await w.NamespaceInspector.open(15);
        const select = w.document.querySelector('[data-action]');
        select.value = 'keep-design'; select.onchange();
        const reference = w.document.querySelector('[name="selection"]');
        assert.strictEqual(reference.value, '');
        assert.strictEqual(reference.querySelector('option[value="existing"]'), null);
        assert(reference.querySelector('option[value="executable"]'));
        assert(reference.querySelector('option[value="none"]'));
        await w.document.querySelector('[data-preview]').onclick();
        assert.strictEqual(calls.filter(c => c.options.method === 'POST').length, 0);
        assert.match(w.document.querySelector('[data-status]').textContent, /Explicitly choose/);
        reference.value = 'none';
        await w.document.querySelector('[data-preview]').onclick();
        assert.strictEqual(JSON.parse(calls.find(c => c.url.endsWith('resolve-preview')).options.body).options.selection, 'none');
    }
    {
        const { w, calls } = setup();
        w._nsTableDirty = true;
        await w.NamespaceInspector.open(15);
        assert.strictEqual(calls.length, 0);
        assert.match(w.document.querySelector('[data-status]').textContent, /Unsaved/);
    }
    {
        const { w } = setup();
        let resolve;
        w.fetch = () => new Promise(r => { resolve = r; });
        const pending = w.NamespaceInspector.open(15);
        w.NamespaceInspector.close();
        resolve({ ok: true, json: async () => ({}) });
        await pending;
        assert.strictEqual(w.document.querySelector('#namespaceInspector'), null);
    }
    {
        const { w, inspected } = setup();
        inspected.actions = [];
        inspected.limitations = ['Memory-mapped I/O: inspect only'];
        await w.NamespaceInspector.open(15);
        assert.strictEqual(w.document.querySelector('[data-action]'), null);
        assert(w.document.querySelector('#namespaceInspector').textContent.includes('inspect-only'));
    }
    {
        const { w, calls } = setup();
        await w.NamespaceInspector.open(15);
        const select = w.document.querySelector('[data-action]');
        select.value = 'keep-design'; select.onchange();
        const original = w.fetch;
        w.fetch = (url, init) => url.endsWith('resolve-preview')
            ? Promise.resolve({ ok: false, json: async () => ({ error: 'Namespace revision changed' }) })
            : original(url, init);
        await w.document.querySelector('[data-preview]').onclick();
        assert(w.document.querySelector('[data-apply]').disabled);
        assert.match(w.document.querySelector('[data-status]').textContent, /No automatic retry|no automatic retry/);
        assert.strictEqual(calls.filter(c => c.url.endsWith('save-table')).length, 0);
    }
    {
        const { w } = setup();
        let opened;
        w.openLumpInEditor = async (token, options) => { opened = { token, options }; };
        await w.NamespaceInspector.open(15);
        await w.document.querySelector('[data-source="design"]').onclick();
        assert.strictEqual(opened.options.exactSavedArtifact.filename, row.selection.filename);
        assert.strictEqual(opened.options.exactSavedArtifact.binary_hash, row.selection.binaryHash);
    }
    console.log('Namespace inspector read-only, review, apply, draft, stale, permissions and exact-source checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });