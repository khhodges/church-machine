// Private, frozen Namespace simulation review. No saved-table or hardware writes.
(function () {
    'use strict';
    let review = null;
    let approved = false;
    let busy = false;
    let revision = 0;
    let history = [];
    let historySelection = '';
    let message = 'No simulation activated. Save the Namespace Table, then prepare, approve and activate a private simulation configuration.';
    const freeze = value => {
        if (value && typeof value === 'object') {
            Object.values(value).forEach(freeze);
            Object.freeze(value);
        }
        return value;
    };
    const escape = value => String(value).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fingerprint = () => window._nsState && window._nsState.namespaceFingerprint;
    const idle = () => {
        if ((typeof _simRunActive !== 'undefined' && _simRunActive) ||
                (typeof sim !== 'undefined' && sim && (sim.running || sim.walkActive))) {
            throw new Error('Stop Run or Walk before changing the simulation configuration.');
        }
    };
    function invalidate() {
        if (approved && review && review.approvedRevisionId) {
            message = 'Namespace draft changed. The reviewed approved simulation remains available for explicit activation.';
            render();
            return;
        }
        revision++;
        review = null;
        approved = false;
        message = 'Namespace changed. Save the table and prepare again. The loaded simulation is unchanged.';
        render();
    }
    function checkReview() {
        if (review && !approved && (window._nsTableDirty ||
                review.sourceNamespaceFingerprint !== fingerprint())) {
            revision++;
            review = null;
            approved = false;
            message = 'Namespace changed. Save the table and prepare again.';
        }
    }
    function markup() {
        checkReview();
        const disabled = busy ? ' disabled' : '';
        const active = typeof sim !== 'undefined' && sim && sim.simulationConfiguration;
        return '<strong>Private simulation configuration</strong> ' +
            '<button type="button" class="btn btn-sm" onclick="SimulationPreparation.prepare()"' + disabled + '>Prepare for Simulation</button> ' +
            '<button type="button" class="btn btn-sm" onclick="SimulationPreparation.approve()"' + (busy || !review || approved ? ' disabled' : '') + '>Approve Configuration</button> ' +
            '<button type="button" class="btn btn-sm" onclick="SimulationPreparation.activate()"' + (busy || !review || !approved ? ' disabled' : '') + '>Activate Simulation</button>' +
            '<div><button type="button" class="btn btn-sm" onclick="SimulationPreparation.refreshHistory()"' + disabled + '>Refresh approved simulation history</button> ' +
            '<select aria-label="Approved simulation revision" onchange="SimulationPreparation.selectHistory(this.value)"' + disabled + '>' +
            '<option value="">Choose an approved simulation…</option>' +
            history.map(item => {
                const entry = (item.preparedRows || []).find(row => row.slot === item.bootEntrySlot);
                const petName = entry && entry.name || 'Unnamed configuration';
                return '<option value="' + escape(item.revisionId) + '"' +
                    (item.revisionId === historySelection ? ' selected' : '') + '>' +
                    escape(petName + ' · approved simulation ' + item.revisionId.slice(0, 12)) + '</option>';
            }).join('') + '</select> ' +
            '<button type="button" class="btn btn-sm" onclick="SimulationPreparation.reopen()"' +
            (busy || !historySelection ? ' disabled' : '') + '>Review selected simulation</button></div>' +
            '<p role="status" style="white-space:pre-wrap">' + escape(message) + '</p>' +
            (review ? '<details open><summary>Proposed private layout changes — saved rows remain unchanged</summary><pre style="max-height:240px;overflow:auto;white-space:pre-wrap">' +
                escape(JSON.stringify(review.layoutChanges, null, 2)) + '</pre></details>' +
                '<details><summary>Exact prepared rows and artifact bindings</summary><pre style="max-height:240px;overflow:auto;white-space:pre-wrap">' +
                escape(JSON.stringify({ preparedRows: review.preparedRows, artifactBindings: review.artifactBindings }, null, 2)) +
                '</pre></details><p>Configuration: <code>' + escape(review.configurationHash) + '</code>' +
                (review.approvedRevisionId ? '<br>Approved simulation revision: <code>' +
                    escape(review.approvedRevisionId) + '</code>' : '') + '</p>' : '') +
            (active ? '<p>Loaded simulation / execution evidence configuration: <code>' + escape(active.configurationHash) +
                '</code><br>Frozen Namespace: <code>' + escape(active.sourceNamespaceFingerprint) + '</code></p>' : '') +
            '<small>Simulation only—not hardware certification. Review and approval do not activate or execute. Activation does not start Run.</small>';
    }
    function render() {
        for (const id of ['simulationPreparationPanel', 'simulationPreparationAbstractionsPanel']) {
            const panel = document.getElementById(id);
            if (panel) panel.innerHTML = markup();
        }
    }
    async function request(action, payload) {
        const response = await fetch('/api/simulation/' + action, {
            ...(action === 'history' ? { method: 'GET', cache: 'no-store' } : {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }),
        });
        const data = await response.json();
        if (!response.ok || data.ok === false) {
            throw new Error([data.error || data.message || `Simulation ${action} failed (${response.status}).`,
                data.nextAction].filter(Boolean).join(' '));
        }
        return data;
    }
    async function refreshHistory() {
        if (busy) return false;
        busy = true;
        render();
        try {
            const data = await request('history');
            if (!Array.isArray(data.revisions) || data.revisions.some(item =>
                !item || typeof item.revisionId !== 'string' || item.approved !== true ||
                item.hardwareCertified !== false)) {
                throw new Error('History did not return approved simulation revisions.');
            }
            history = freeze(JSON.parse(JSON.stringify(data.revisions)));
            if (!history.some(item => item.revisionId === historySelection)) historySelection = '';
            message = history.length ? 'Select an approved simulation to review. Nothing has been activated.' :
                'No retained approved simulations are available.';
            return true;
        } catch (error) {
            history = [];
            historySelection = '';
            message = 'Simulation history unavailable: ' + String(error.message || error);
            return false;
        } finally {
            busy = false;
            render();
        }
    }
    async function perform(action) {
        if (busy) return false;
        checkReview();
        busy = true;
        const ticket = revision;
        const sourceBound = action === 'prepare' || action === 'approve';
        try {
            idle();
            if (sourceBound && (window._nsTableDirty || !fingerprint())) throw new Error('Save the Namespace Table before preparing.');
            if (action !== 'prepare' && action !== 'reopen' && !review) throw new Error('Prepare and review the configuration first.');
            if (action === 'activate' && !approved) throw new Error('Approve the reviewed configuration before activation.');
            if (action === 'reopen' && !history.some(item => item.revisionId === historySelection)) {
                throw new Error('Choose an approved simulation from history first.');
            }
            const source = fingerprint();
            const selected = review;
            const selectedRevision = historySelection;
            if (action === 'prepare') { review = null; approved = false; }
            message = `${action === 'prepare' ? 'Preparing' : action === 'approve' ? 'Approving' :
                action === 'reopen' ? 'Reopening' : 'Activating'} private simulation configuration…`;
            render();
            const data = await request(action, action === 'prepare'
                ? { namespaceFingerprint: source }
                : action === 'reopen' ? { revisionId: selectedRevision }
                    : { preparationId: selected.preparationId, configurationHash: selected.configurationHash });
            if (sourceBound && (ticket !== revision || source !== fingerprint() || window._nsTableDirty)) {
                throw new Error('Namespace changed while the request was pending. Prepare again.');
            }
            idle();
            if (action === 'prepare' || action === 'reopen') {
                if (!data.preparationId || !data.configurationHash || !data.imageHash ||
                        (action === 'prepare' && data.sourceNamespaceFingerprint !== source) ||
                        !Array.isArray(data.preparedRows) || !Array.isArray(data.layoutChanges) ||
                        !data.artifactBindings || data.hardwareCertified !== false) {
                    throw new Error('Preparation response is missing frozen configuration provenance.');
                }
                if (action === 'reopen' && (data.approved !== true || data.activated !== false ||
                        data.approvedRevisionId !== selectedRevision)) {
                    throw new Error('Reopened response does not match the selected approved simulation.');
                }
                review = freeze(JSON.parse(JSON.stringify(data)));
                approved = action === 'reopen';
                message = approved ? 'Retained approved simulation reopened for review only. Explicitly activate to load it; current Namespace edits remain unchanged.' :
                    'Review the proposed private layout changes, then approve. Saved Namespace rows have not changed.';
            } else {
                if (data.preparationId !== selected.preparationId || data.configurationHash !== selected.configurationHash) {
                    throw new Error('Response does not match the reviewed configuration.');
                }
                if (action === 'approve') {
                    if (data.approved !== true || typeof data.approvedRevisionId !== 'string' || !data.approvedRevisionId) {
                        throw new Error('Durable configuration approval was not confirmed.');
                    }
                    review = freeze({ ...selected, approvedRevisionId: data.approvedRevisionId });
                    approved = true;
                    message = 'Configuration approved. Explicitly activate to load it; no simulation has started.';
                } else {
                    if (data.activated !== true || !Array.isArray(data.words) || !data.words.length ||
                            !data.words.every(word => Number.isInteger(word) && word >= 0 && word <= 0xffffffff)) {
                        throw new Error('Activation did not return a valid private image.');
                    }
                    const image = new Uint32Array(data.words).buffer;
                    if (data.imageHash !== selected.imageHash) {
                        throw new Error('Activated image hash does not match the approved configuration.');
                    }
                    const digest = await crypto.subtle.digest('SHA-256', image);
                    const actualHash = Array.from(new Uint8Array(digest), byte =>
                        byte.toString(16).padStart(2, '0')).join('');
                    if (actualHash !== selected.imageHash) {
                        throw new Error('Activated image bytes do not match the approved configuration.');
                    }
                    if (selected !== review || !approved) {
                        throw new Error('Reviewed activation selection changed while bytes were being verified.');
                    }
                    idle();
                    sim.activateSimulationConfiguration(image, { ...selected, imageHash: data.imageHash });
                    // Keep programmer drafts/pending candidates intact. The
                    // execution gate prevents their insertion into this image.
                    approved = false;
                    review = null;
                    message = 'Private simulation activated. Use Run, Step or Walk to execute this frozen configuration.';
                    const output = document.getElementById('editorConsole');
                    if (output) output.textContent += '\nSimulation configuration: ' + selected.configurationHash;
                    if (typeof updateDashboard === 'function') updateDashboard();
                }
            }
            return true;
        } catch (error) {
            message = 'Simulation configuration blocked: ' + String(error.message || error);
            if (action !== 'prepare') { approved = false; review = null; }
            return false;
        } finally {
            busy = false;
            render();
        }
    }
    window.SimulationPreparation = {
        prepare: () => perform('prepare'),
        approve: () => perform('approve'),
        activate: () => perform('activate'),
        refreshHistory,
        selectHistory: value => {
            if (busy) return;
            historySelection = history.some(item => item.revisionId === value) ? value : '';
            render();
        },
        reopen: () => perform('reopen'),
        invalidate, markup, render,
    };
    // Legacy callers must never invoke the old saved-image normalization flow.
    window.prepareSavedArtifactForRun = window.SimulationPreparation.prepare;
})();