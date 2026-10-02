(function () {
    'use strict';
    let epoch = 0, dialog = null, snapshot = null, proposal = null, busy = false, saving = false;
    let artifacts = [];
    let trigger = null;
    const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g,
        c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const json = value => JSON.stringify(value, null, 2);
    const labels = {
        'keep-design': 'Keep as design-only',
        'select-artifact': 'Select an exact executable artifact',
        'clear-selection': 'Remove orphan design-selection metadata',
        'set-policy': 'Change loading policy',
        'edit-geometry': 'Edit declared geometry',
    };
    function dirty() {
        return !!(window._nsTableDirty || window._nsTableSaveInFlight ||
            window._nsTableDraftRows ||
            ['_nsTableRowEdits', '_nsDraftAssignments', '_nsDeletedSlots',
                '_nsExplicitArtifactBindings', '_prepareRunArtifactPins'].some(key =>
                Object.keys(window[key] || {}).length));
    }
    function status(message) {
        if (dialog) dialog.querySelector('[data-status]').textContent = message;
    }
    async function responseJSON(response) {
        let data;
        try { data = await response.json(); } catch (_) { throw new Error('Server returned an unreadable response. No retry was attempted.'); }
        if (!response.ok || data.ok === false) {
            const message = data.message || data.error || `HTTP ${response.status}`;
            throw new Error(typeof message === 'string' ? message : json(message));
        }
        return data;
    }
    function current(id) { return id === epoch && dialog && dialog.open; }
    function close() {
        if (saving) return;
        ++epoch;
        if (dialog) { dialog.close(); dialog.remove(); dialog = null; }
        snapshot = proposal = null;
        busy = false;
        if (trigger && trigger.isConnected) trigger.focus();
    }
    function actions(data) {
        if (Array.isArray(data.actions)) return data.actions.map(a =>
            typeof a === 'string' ? { id: a, enabled: true } :
                { ...a, id: a.id || a.action || a.name });
        return Object.entries(data.actions || {}).map(([id, value]) =>
            typeof value === 'object' ? { id, ...value } : { id, enabled: !!value });
    }
    function exact(claim) {
        if (!claim) return null;
        const value = claim.reference || claim.artifact || claim;
        const hash = value.binaryHash || value.binary_hash;
        return value.filename && /^[a-f0-9]{64}$/i.test(hash || '') &&
            /^[a-f0-9]{8}$/i.test(value.token || '')
            ? { filename: value.filename, token: value.token, binary_hash: hash } : null;
    }
    function claimCard(name, value, key) {
        const reference = value && (value.reference || value.artifact || value);
        return `<section><h3>${name}</h3><p>${esc(reference && reference.filename || 'No exact filename assigned')}</p>` +
            (value && value.status ? `<p><strong>${esc(value.status)}</strong> — ${esc(value.message || '')}</p>` : '') +
            `<details><summary>Exact reference and evidence</summary><pre>${esc(json(value || null))}</pre></details>` +
            (exact(value) ? `<button type="button" data-source="${key}">Open exact source — ${name.toLowerCase()}</button>` : '') + '</section>';
    }
    function diff(changes) {
        if (!Array.isArray(changes)) return `<pre>${esc(json(changes))}</pre>`;
        return '<div class="ns-inspector-diff"><table><thead><tr><th>Field</th><th>Change</th><th>Before</th><th>After</th></tr></thead><tbody>' +
            changes.map(change => {
                const operation = change.afterPresent === false ? 'REMOVED'
                    : change.beforePresent === false ? 'ADDED'
                    : String(change.operation || 'CHANGED').toUpperCase();
                // Presence flags are authoritative. A present null is not a deletion.
                const before = change.beforePresent === false ? '(absent)' : json(change.before);
                const after = change.afterPresent === false ? '(absent)' : json(change.after);
                return `<tr><th scope="row">${esc(change.field)}</th><td><strong>${esc(operation)}</strong></td><td><pre>${esc(before)}</pre></td><td><pre>${esc(after)}</pre></td></tr>`;
            }).join('') + '</tbody></table></div>';
    }
    function advice(issue) {
        const code = issue.code || '';
        if (code === 'saved-allocation-overlap') return {
            problem: 'This entry shares reserved memory with another entry.',
            fix: 'Choose a non-overlapping word address, then review the placement change. No address is chosen automatically. This edits the saved plan, not an existing image.',
            actions: [['edit-geometry', 'Review placement']],
        };
        if (['mixed-design-executable', 'incomplete-design-flags', 'different-artifact-claims', 'design-location'].includes(code)) return {
            problem: code === 'different-artifact-claims' ? 'This entry refers to two different saved programs.' :
                'This entry contains conflicting design-only and executable settings.',
            fix: 'Choose what you intend: keep a design-only reference, or choose the exact program to include. Review which reference is retained before saving.',
            actions: [['keep-design', 'Keep design-only…'], ['select-artifact', 'Choose program…']],
        };
        if (['policy-alias-conflict', 'unknown-policy', 'policy-flag-conflict', 'residency-alias-conflict', 'boot-policy-conflict'].includes(code)) return {
            problem: 'The loading settings disagree or are not supported.',
            fix: 'Choose one loading policy and review the changes. The boot entry still requires a separate boot-marker change if you intend to exclude it.',
            actions: [['set-policy', 'Review loading settings']],
        };
        if (code === 'orphan-design-selection') return {
            problem: 'An executable entry still contains an old design-only reference.',
            fix: 'Compare the references in Technical details. If the executable choice is correct, review removing the old design-only reference.',
            actions: [['clear-selection', 'Review reference cleanup']],
        };
        if (/artifact-binding|digest-alias|^(design|executable)-/.test(code)) return {
            problem: issue.message || 'The selected saved program cannot be verified.',
            fix: 'Find or save the intended program, then choose its exact saved revision. Missing or damaged bytes cannot be repaired by changing a label.',
            actions: [['select-artifact', 'Choose saved program…']],
        };
        return { problem: issue.message || String(issue), fix: issue.nextAction ||
            'Inspect Technical details to identify the required correction. No automatic change is available.', actions: [] };
    }
    function diagnostics(issues, interactive = false, imageSelected = interactive ? snapshot.imageSelected : undefined) {
        if (!Array.isArray(issues)) return '<p>Problems have not been checked.</p>';
        const dormant = issues.filter(issue => imageSelected === false && (issue.code || '').startsWith('simulation-'));
        const incomplete = issues.filter(issue => issue.code === 'saved-geometry-incomplete' ||
            issue.severity === 'info' || /unverified$/.test(issue.code || '')).filter(issue => !dormant.includes(issue));
        const problems = issues.filter(issue => !incomplete.includes(issue) && !dormant.includes(issue));
        const permitted = interactive ? actions(snapshot).filter(a => a.enabled !== false && a.allowed !== false).map(a => a.id) : [];
        return (problems.length ? '<ul class="ns-inspector-issues">' + problems.map(issue => {
            const help = advice(issue);
            const buttons = help.actions.filter(([action]) => permitted.includes(action));
            return `<li><p><strong>What is wrong:</strong> ${esc(help.problem)}</p>` +
                `<p><strong>How to fix it:</strong> ${esc(help.fix)}</p>` +
                buttons.map(([action, label]) => `<button type="button" data-fix-action="${action}">${esc(label)}</button>`).join(' ') +
                `<details><summary>Technical details</summary><pre>${esc(json(issue))}</pre></details></li>`;
        }).join('') + '</ul>' : '<p>No problems found in the checks completed. This does not approve execution or an image.</p>') +
            (incomplete.length ? `<details class="ns-inspector-incomplete"><summary>Checks not completed (${incomplete.length})</summary>` +
                '<p>These are limits of this inspection, not confirmed defects.</p>' +
                incomplete.map(issue => `<p>${esc(issue.message)} ${esc(issue.nextAction || '')}</p>`).join('') + '</details>' : '') +
            (dormant.length ? '<details data-dormant><summary>Not included in the current image</summary>' +
                '<p>This entry is not selected. These future execution checks do not block the current image.</p>' +
                dormant.map(issue => `<p>${esc(advice(issue).problem)} ${esc(advice(issue).fix)}</p>`).join('') + '</details>' : '');
    }
    function diagnosticCount(issues, imageSelected) {
        if (!Array.isArray(issues)) return 'Remaining problems not checked';
        const count = issues.filter(issue => issue.code !== 'saved-geometry-incomplete' &&
            issue.severity !== 'info' && !/unverified$/.test(issue.code || '') &&
            !(imageSelected === false && (issue.code || '').startsWith('simulation-'))).length;
        return `${count} remaining problem${count === 1 ? '' : 's'}`;
    }
    function mode(row) {
        if (row.symbolic || row.implementationMissing) return 'design-only assignment' +
            (row.resident || row.filename ? ' with conflicting executable metadata' : '');
        return row.filename ? `executable assignment; loading policy ${row.load_policy || row.loadPolicy || 'unspecified'}` :
            'non-artifact assignment';
    }
    const boundary = 'Saving this table does not repair the old committed image, approve execution, or activate a private simulation.';
    function limitations(value) {
        const notes = Array.isArray(value) ? value : value ? [value] : [];
        return notes.length ? '<h3>What this review can change</h3><ul class="ns-inspector-limitations">' +
            notes.map(note => `<li>${esc(typeof note === 'string' ? note : note.message || 'See the field permissions for this limitation.')}</li>`).join('') + '</ul>' : '';
    }
    function invalidate() {
        proposal = null;
        dialog.querySelector('[data-apply]').disabled = true;
        dialog.querySelector('[data-review]').innerHTML = '';
    }
    function lockControls(locked) {
        for (const el of dialog.querySelectorAll('[data-action], [data-fix-action], [data-fields] input, [data-fields] select, [data-preview]'))
            el.disabled = locked;
    }
    function fields() {
        invalidate();
        const action = dialog.querySelector('[data-action]').value;
        dialog.querySelector('[data-correction]').hidden = !action;
        let html = '';
        if (action === 'keep-design') {
            const hasSelection = snapshot.row.selection && typeof snapshot.row.selection === 'object' &&
                !Array.isArray(snapshot.row.selection);
            html = '<label>Design reference to retain<select name="selection">' +
                (hasSelection ? '<option value="existing">Existing design selection (unchanged)</option>' :
                    '<option value="">Choose reference explicitly…</option>') +
                '<option value="executable">Current executable reference</option><option value="none">No artifact selection</option></select></label>';
        }
        if (action === 'select-artifact') html = '<p>Select exact saved bytes, not a latest-name alias. This does not install or execute them.</p><label>Saved LUMP revision<select data-artifact><option value="">Choose an exact saved artifact…</option>' +
            artifacts.map((a, i) => `<option value="${i}">${esc(a.abstraction || a.name || snapshot.row.name)} — ${esc(a.filename)}${a.lump_version != null ? ' · revision ' + esc(a.lump_version) : ''}</option>`).join('') +
            '</select></label><p data-library-status>Catalog entries are choices only. The server verifies the exact selected bytes before review.</p><label>Exact filename<input name="filename" required></label><label>Artifact token<input name="token" required></label><label>Binary SHA-256<input name="binaryHash" required></label>';
        if (action === 'set-policy' || action === 'select-artifact')
            html += '<label>Loading policy<select name="policy"><option value="Lazy">Lazy — not selected as a resident image body</option><option value="Resident">Resident — include in preparation</option><option value="Preload">Preload</option><option value="Empty">Empty</option></select></label>';
        if (action === 'edit-geometry') html = '<p>Changed physical allocations are checked at review and again at Save against the current Namespace. Unchanged legacy problems may remain. No automatic relocation or image rebuild is performed.</p><label>Location (word address; decimal or 0x hexadecimal)<input name="location" required></label><label>Access limit (not allocation size)<input name="limit" required></label>';
        dialog.querySelector('[data-fields]').innerHTML = html;
        dialog.querySelector('[data-intention]').textContent = action
            ? `Your proposed choice: ${labels[action] || action}. Not saved until you review and apply.`
            : 'No correction chosen. The saved assignment is unchanged.';
        if (action === 'select-artifact') dialog.querySelector('[data-artifact]').onchange = function () {
            invalidate();
            const a = artifacts[Number(this.value)];
            if (this.value === '' || !a) return;
            for (const key of ['filename', 'token', 'binaryHash'])
                dialog.querySelector(`[name="${key}"]`).value = key === 'binaryHash'
                    ? a.binary_hash || a.binaryHash || '' : a[key] || '';
        };
        if (action === 'edit-geometry') for (const key of ['location', 'limit'])
            dialog.querySelector(`[name="${key}"]`).value = snapshot.row[key] || '0x00000000';
        dialog.querySelector('[data-preview]').disabled = !action;
    }
    async function preview() {
        if (busy) return;
        invalidate();
        if (dirty()) { status('Unsaved Namespace drafts exist. Save or discard them explicitly before reviewing this correction.'); return; }
        const id = epoch;
        const options = {};
        dialog.querySelectorAll('[data-fields] [name]').forEach(el => { options[el.name] = el.value.trim(); });
        if (dialog.querySelector('[data-action]').value === 'keep-design' && !options.selection) {
            status('No existing design selection is saved. Explicitly choose the current executable reference or no artifact selection before review.');
            return;
        }
        busy = true;
        lockControls(true);
        status('Validating proposed correction; saved data is unchanged…');
        try {
            const result = await responseJSON(await fetch('/api/namespace/resolve-preview', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: json({ namespaceFingerprint: snapshot.namespaceFingerprint,
                    slot: snapshot.row.slot, action: dialog.querySelector('[data-action]').value, options }),
            }));
            if (!current(id)) return;
            if (!result.savePayload || result.savePayload.namespaceFingerprint !== snapshot.namespaceFingerprint)
                throw new Error('Review response does not match the inspected Namespace revision. Close and reopen the inspector.');
            proposal = result;
            dialog.querySelector('[data-review]').innerHTML =
                '<h3>Review exact field changes</h3><p>Removed fields are deletions, not empty replacements. Slot, Pet Name and generation remain unchanged.</p>' +
                diff(result.changes) +
                `<details><summary>Full before / after fields</summary><div class="ns-inspector-columns"><section><h4>Before</h4><pre>${esc(json(result.before))}</pre></section><section><h4>After</h4><pre>${esc(json(result.after))}</pre></section></div></details>` +
                `<p><strong>Proposed state:</strong> ${esc(mode(result.after))}</p>` +
                `<h4>${esc(diagnosticCount(result.issues, result.imageSelected))} after this proposed change</h4>${diagnostics(result.issues, false, result.imageSelected)}` +
                `<p>${boundary}</p>`;
            dialog.querySelector('[data-apply]').disabled = false;
            status(`Review ready: ${diagnosticCount(result.issues, result.imageSelected)}. Apply saves only the reviewed Namespace rows; saving is not a claim that the entry is fixed.`);
        } catch (error) { if (current(id)) status(`${error.message} Close and reopen to review current state; no automatic retry.`); }
        finally { if (current(id)) { busy = false; lockControls(false); } }
    }
    async function apply() {
        if (busy || !proposal) return;
        if (dirty()) { invalidate(); status('A Namespace draft changed. Save or discard it explicitly, then reopen this review.'); return; }
        const id = epoch, reviewed = proposal;
        busy = true;
        saving = true;
        lockControls(true);
        dialog.querySelector('[data-apply]').disabled = true;
        status('Waiting for protected change review…');
        try {
            // The shared fetch wrapper obtains the server-bound protected review.
            // Never call a raw/native fetch or retry a stale revision here.
            const result = await responseJSON(await fetch('/api/namespace/save-table', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: json(reviewed.savePayload),
            }));
            if (!current(id)) return;
            if (!Array.isArray(result.savedAbstractions) || !result.namespaceFingerprint)
                throw new Error('Save receipt is incomplete. Reload to establish whether it committed before any further change.');
            if (!dirty()) {
                window._nsState = result;
                if (typeof updateNamespace === 'function') updateNamespace();
            }
            invalidate();
            // A save receipt is not evidence that all problems were resolved.
            // Reinspect persisted state once, read-only; never retry the mutation.
            dialog.querySelector('[data-content]').innerHTML = `<p>${boundary}</p>`;
            status('Namespace table change saved. Checking persisted state and remaining diagnostics…');
            try {
                const persisted = await responseJSON(await fetch(`/api/namespace/inspect?slot=${snapshot.row.slot}`, { cache: 'no-store' }));
                if (!current(id)) return;
                if (!persisted.row || persisted.row.slot !== snapshot.row.slot || !persisted.namespaceFingerprint)
                    throw new Error('Incomplete persisted inspection response.');
                dialog.querySelector('[data-content]').innerHTML =
                    `<h3>Persisted NS[${persisted.row.slot}] ${esc(persisted.row.name)}</h3>` +
                    `<p><strong>Currently saved:</strong> ${esc(mode(persisted.row))}</p>` +
                    `<h4>${esc(diagnosticCount(persisted.issues, persisted.imageSelected))}</h4>${diagnostics(persisted.issues, false, persisted.imageSelected)}` +
                    `<details><summary>Exact persisted fields</summary><pre>${esc(json(persisted.row))}</pre></details><p>${boundary}</p>`;
                const concurrent = persisted.namespaceFingerprint !== result.namespaceFingerprint
                    ? ' The Namespace changed again after this save; the inspection shows its current state.' : '';
                status(`Namespace table change saved; ${diagnosticCount(persisted.issues, persisted.imageSelected)}.${concurrent} Close and reopen to review any further correction.`);
            } catch (error) {
                if (current(id)) status(`Namespace table change saved, but persisted state and remaining diagnostics were not checked: ${error.message} Close and reopen to inspect. No automatic retry.`);
            }
        } catch (error) {
            if (current(id)) {
                // Keep the before/after review and typed proposal for correction,
                // but never reuse its approval or retry a stale baseline.
                proposal = null;
                dialog.querySelector('[data-apply]').disabled = true;
                status(`${error.message} Your proposal is retained above. No automatic retry or relocation. Edit and review again; if the Namespace changed, reopen to review its current revision.`);
            }
        } finally { if (current(id)) { busy = saving = false; lockControls(false); } }
    }
    async function open(slot) {
        if (!Number.isInteger(slot) || saving) return;
        close();
        trigger = document.activeElement;
        const id = ++epoch;
        dialog = document.createElement('dialog');
        dialog.id = 'namespaceInspector';
        dialog.className = 'ns-inspector';
        dialog.setAttribute('aria-labelledby', 'nsInspectorTitle');
        dialog.innerHTML = '<header><h2 id="nsInspectorTitle">Inspect and resolve Namespace entry</h2><button type="button" data-close aria-label="Close inspector">Close</button></header>' +
            '<div data-scroll><p data-status role="status" aria-live="polite">Reading committed Namespace…</p><div data-content></div></div>' +
            '<footer><button type="button" data-apply disabled>Apply reviewed Namespace correction</button></footer>';
        document.body.appendChild(dialog);
        dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
        dialog.querySelector('[data-close]').onclick = close;
        dialog.showModal();
        if (dirty()) { status('Unsaved Namespace drafts exist. Save or discard them explicitly before opening an authoritative correction review.'); return; }
        try {
            const data = await responseJSON(await fetch(`/api/namespace/inspect?slot=${slot}`, { cache: 'no-store' }));
            if (!current(id)) return;
            if (!data.row || data.row.slot !== slot || !Array.isArray(data.savedAbstractions) || !data.namespaceFingerprint)
                throw new Error('Incomplete Namespace inspection response.');
            snapshot = data;
            artifacts = [];
            for (const claim of Object.values(data.claims || {})) {
                const a = exact(claim);
                if (a && !artifacts.some(old => old.filename === a.filename))
                    artifacts.push({ ...a, abstraction: data.row.name });
            }
            const allowed = actions(data).filter(a => a.enabled !== false && a.allowed !== false);
            dialog.querySelector('[data-content]').innerHTML =
                `<h3>NS[${slot}] ${esc(data.row.name)}</h3>` +
                diagnostics(data.issues, true) +
                `<details data-technical><summary>Technical details and saved references</summary>` +
                `<p><strong>Currently saved:</strong> ${esc(mode(data.row))}</p>` +
                `<div class="ns-inspector-columns">${claimCard('Design selection', data.claims && data.claims.design, 'design')}${claimCard('Executable reference', data.claims && data.claims.executable, 'executable')}</div>` +
                `<details><summary>Exact saved fields and field permissions</summary><pre>${esc(json(data.row))}</pre><pre>${esc(json(data.actions))}</pre></details>` +
                limitations(data.limitations) +
                `<details><summary>Stored image evidence — not assignment authority</summary><pre data-image>Loading read-only evidence…</pre></details></details>` +
                (allowed.length ? `<details data-other><summary>Other changes</summary><label>Intended correction<select data-action><option value="">Choose explicitly…</option>${allowed.map(a => `<option value="${esc(a.id)}">${esc(a.label || labels[a.id] || a.id)}</option>`).join('')}</select></label></details>` +
                '<section data-correction hidden><p data-intention></p><div data-fields></div><button type="button" data-preview disabled>Review proposed changes</button></section>' :
                '<p>This entry is inspect-only. No correction is permitted here.</p>') +
                '<div data-review></div>';
            for (const button of dialog.querySelectorAll('[data-source]')) button.onclick = async () => {
                const binding = exact(data.claims[button.dataset.source]);
                if (!binding || typeof openLumpInEditor !== 'function') { status('Exact source navigation is unavailable.'); return; }
                try {
                    await openLumpInEditor(binding.token, { exactSavedArtifact: { ...binding, abstraction: data.row.name } });
                    close();
                } catch (error) { status(`Source was not opened: ${error.message}`); }
            };
            if (allowed.length) {
                dialog.querySelector('[data-action]').onchange = fields;
                for (const button of dialog.querySelectorAll('[data-fix-action]')) button.onclick = () => {
                    if (busy) return;
                    dialog.querySelector('[data-action]').value = button.dataset.fixAction;
                    fields();
                    dialog.querySelector('[data-correction]').scrollIntoView?.({ block: 'nearest' });
                    dialog.querySelector('[data-preview]').focus();
                };
                dialog.querySelector('[data-preview]').onclick = preview;
                dialog.querySelector('[data-fields]').addEventListener('input', invalidate);
                dialog.querySelector('[data-fields]').addEventListener('change', invalidate);
            }
            dialog.querySelector('[data-apply]').onclick = apply;
            status('Read-only check. Review a fix below; nothing changes until you apply it.');
            fetch('/api/lumps/list', { cache: 'no-store' }).then(responseJSON).then(list => {
                if (!current(id)) return;
                const rows = Array.isArray(list) ? list : list.lumps;
                if (!Array.isArray(rows)) throw new Error('Saved artifact list is incomplete.');
                for (const a of rows) if (a.filename && !artifacts.some(old => old.filename === a.filename))
                    artifacts.push(a);
                const picker = dialog.querySelector('[data-artifact]');
                if (picker) {
                    const selected = picker.value;
                    picker.innerHTML = '<option value="">Choose an exact saved artifact…</option>' +
                        artifacts.map((a, i) => `<option value="${i}">${esc(a.abstraction || a.name || snapshot.row.name)} — ${esc(a.filename)}</option>`).join('');
                    picker.value = selected;
                }
            }).catch(error => { if (current(id) && !saving && dialog.querySelector('[data-action]')) status(`Inspection is available, but saved artifact choices could not be loaded: ${error.message}`); });
            fetch('/api/boot-image/capacity', { cache: 'no-store' }).then(responseJSON).then(report => {
                if (!current(id)) return;
                const image = dialog.querySelector('[data-image]');
                if (!image) return;
                const evidence = (report.rows || []).filter(row => row.slot === slot);
                image.textContent =
                    json({ namespaceFingerprint: report.namespaceFingerprint, rows: evidence, warnings: report.warnings || [] });
            }).catch(error => {
                const image = current(id) && dialog.querySelector('[data-image]');
                if (image) image.textContent = `Image evidence unavailable: ${error.message}`;
            });
        } catch (error) { if (current(id)) status(`Cannot inspect entry: ${error.message}`); }
    }
    window.NamespaceInspector = { open, close };
})();