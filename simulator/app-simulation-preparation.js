// Private, frozen Namespace simulation review. No saved-table or hardware writes.
(function () {
    'use strict';
    let review = null;
    let approved = false;
    let busy = false;
    let revision = 0;
    let message = 'Save the Namespace Table first, then prepare a private simulation configuration.';
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
        revision++;
        review = null;
        approved = false;
        message = 'Namespace changed. Save the table and prepare again. The loaded simulation is unchanged.';
        render();
    }
    function checkReview() {
        if (review && (window._nsTableDirty ||
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
            '<p role="status" style="white-space:pre-wrap">' + escape(message) + '</p>' +
            (review ? '<details open><summary>Proposed private layout changes — saved rows remain unchanged</summary><pre style="max-height:240px;overflow:auto;white-space:pre-wrap">' +
                escape(JSON.stringify(review.layoutChanges, null, 2)) + '</pre></details>' +
                '<details><summary>Exact prepared rows and artifact bindings</summary><pre style="max-height:240px;overflow:auto;white-space:pre-wrap">' +
                escape(JSON.stringify({ preparedRows: review.preparedRows, artifactBindings: review.artifactBindings }, null, 2)) +
                '</pre></details><p>Configuration: <code>' + escape(review.configurationHash) + '</code></p>' : '') +
            (active ? '<p>Loaded simulation / execution evidence configuration: <code>' + escape(active.configurationHash) +
                '</code><br>Frozen Namespace: <code>' + escape(active.sourceNamespaceFingerprint) + '</code></p>' : '') +
            '<small>Simulation only. Approval does not activate or execute. Activation does not start Run.</small>';
    }
    function render() {
        const panel = document.getElementById('simulationPreparationPanel');
        if (panel) panel.innerHTML = markup();
    }
    async function request(action, payload) {
        const response = await fetch('/api/simulation/' + action, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!response.ok || data.ok === false) {
            throw new Error([data.error || data.message || `Simulation ${action} failed (${response.status}).`,
                data.nextAction].filter(Boolean).join(' '));
        }
        return data;
    }
    async function perform(action) {
        if (busy) return false;
        checkReview();
        busy = true;
        const ticket = revision;
        try {
            idle();
            if (window._nsTableDirty || !fingerprint()) throw new Error('Save the Namespace Table before preparing.');
            if (action !== 'prepare' && !review) throw new Error('Prepare and review the configuration first.');
            if (action === 'activate' && !approved) throw new Error('Approve the reviewed configuration before activation.');
            const source = fingerprint();
            const selected = review;
            if (action === 'prepare') { review = null; approved = false; }
            message = `${action === 'prepare' ? 'Preparing' : action === 'approve' ? 'Approving' : 'Activating'} private simulation configuration…`;
            render();
            const data = await request(action, action === 'prepare'
                ? { namespaceFingerprint: source }
                : { preparationId: selected.preparationId, configurationHash: selected.configurationHash });
            if (ticket !== revision || source !== fingerprint() || window._nsTableDirty) {
                throw new Error('Namespace changed while the request was pending. Prepare again.');
            }
            idle();
            if (action === 'prepare') {
                if (!data.preparationId || !data.configurationHash || data.sourceNamespaceFingerprint !== source ||
                        !Array.isArray(data.preparedRows) || !Array.isArray(data.layoutChanges) ||
                        !data.artifactBindings || data.hardwareCertified !== false) {
                    throw new Error('Preparation response is missing frozen configuration provenance.');
                }
                review = freeze(JSON.parse(JSON.stringify(data)));
                approved = false;
                message = 'Review the proposed private layout changes, then approve. Saved Namespace rows have not changed.';
            } else {
                if (data.preparationId !== selected.preparationId || data.configurationHash !== selected.configurationHash) {
                    throw new Error('Response does not match the reviewed configuration.');
                }
                if (action === 'approve') {
                    if (data.approved !== true) throw new Error('Configuration approval was not confirmed.');
                    approved = true;
                    message = 'Configuration approved. Explicitly activate to load it; no simulation has started.';
                } else {
                    if (data.activated !== true || !Array.isArray(data.words) || !data.words.length ||
                            !data.words.every(word => Number.isInteger(word) && word >= 0 && word <= 0xffffffff)) {
                        throw new Error('Activation did not return a valid private image.');
                    }
                    const image = new Uint32Array(data.words).buffer;
                    if (sim.loadBootImage(image) !== true) throw new Error(sim.lastBootImageError || 'Private image was rejected.');
                    window.bootImage = image;
                    window.bootImageAvailable = true;
                    // Loading memory alone does not reset PC, registers or boot
                    // state. Reset against the new private cache, then explicitly
                    // reload (also supports shells without a reset overlay hook).
                    sim.reset();
                    if (sim.loadBootImage(image) !== true) throw new Error(sim.lastBootImageError || 'Private reset image was rejected.');
                    if (typeof _clearPendingSimLoad === 'function') _clearPendingSimLoad();
                    sim.bindSimulationConfiguration(image, { ...selected, imageHash: data.imageHash });
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
        invalidate, markup, render,
    };
    // Legacy callers must never invoke the old saved-image normalization flow.
    window.prepareSavedArtifactForRun = window.SimulationPreparation.prepare;
})();