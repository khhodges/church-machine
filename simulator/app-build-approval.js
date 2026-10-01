/**
 * app-build-approval.js — Build Approval view (Builder ▸ 🔨 Build tab)
 *
 * Renders one Namespace table with an individual load rule per slot, inline
 * ✅/⚠️/❌ check badges, a Freeze Snapshot button, and an Approve & Build
 * button that triggers a remote Vivado synthesis run.
 */

/* eslint-disable no-use-before-define */
const BuildApprovalView = {
    _timer: null,
    _inFlight: false,
    _snapFrozen: false,
    _selectedSnapshot: null,
    _availableSnapshot: null,
    _approvedRevisions: [],
    _bitstreamRevisions: [],
    _selectedBitstream: null,
    _buildRunning: false,
    _buildTimer: null,
    _lastMap: null,
    _release: null,
    AUTO_REFRESH_MS: 30000,
    _approvalRowFields: [
        'slot', 'name', 'token', 'header_word', 'cw', 'cc', 'location',
        'words', 'limit', 'load_policy', 'slot_rule', 'perms', 'source',
        'programmable', 'size_budget', 'checks',
    ],

    onTabClose() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
        this._stopBuildPoll();
    },

    _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    },

    _badge(kind, label, title) {
        const tooltip = title ? this._esc(title) : '';
        const t = title
            ? ` title="${tooltip}" data-tooltip="${tooltip}" tabindex="0" role="img" aria-label="${tooltip}"`
            : '';
        return `<span class="ba-badge ba-badge-${kind}"${t}>${this._esc(label)}</span>`;
    },

    _checkTooltip(check) {
        const label = check && check.label ? String(check.label) : 'Validation check';
        const detail = check && check.detail
            ? String(check.detail)
            : 'No additional detail is available.';
        return `${label} — ${detail}`;
    },

    _namespacePolicy(slot, fallback) {
        const nsRows = typeof window !== 'undefined' && window._nsState &&
            Array.isArray(window._nsState.abstractions)
            ? window._nsState.abstractions : [];
        const row = nsRows.find(candidate => candidate &&
            Number(candidate.slot) === Number(slot));
        if (!row) return fallback;
        const policy = row.load_policy || row.loadPolicy;
        if (['Bootstrap', 'Hardware', 'Empty', 'Resident', 'Preload', 'Lazy']
                .includes(policy)) return policy;
        if (row.resident === true && row.boot_resident === true) return 'Resident';
        return fallback;
    },

    _checkBadge(check) {
        // check: { ok: bool|null, warn: bool, label, detail }
        const tooltip = this._checkTooltip(check);
        if (check.ok === true && !check.warn) return this._badge('ok', '✅', tooltip);
        if (check.ok === null)               return this._badge('unknown', 'N/A', tooltip);
        if (check.warn)                      return this._badge('warn', '⚠️', tooltip);
        return this._badge('bad', '❌', tooltip);
    },

    _permStr(perms) {
        if (!perms) return 'N/A';
        if (Array.isArray(perms)) return perms.join('+') || 'N/A';
        return String(perms);
    },

    _value(value) {
        return value == null || value === '' ? 'N/A' : value;
    },

    _renderSizeBudget(budget) {
        if (!budget) return '<span class="ba-size-unavailable">N/A</span>';
        if (!budget.available) {
            const reason = budget.reason || 'N/A';
            const isHardwareRegister = /ARTIX-7|hardware register/i.test(reason);
            const tooltip = isHardwareRegister
                ? 'ARTIX-7 MMIO reference — fixed hardware register window from the architecture device catalog; no programmable LUMP body or size budget applies.'
                : `Size budget unavailable — ${reason}`;
            const safeTooltip = this._esc(tooltip);
            return `<span class="ba-size-unavailable" title="${safeTooltip}" ` +
                `data-tooltip="${safeTooltip}" tabindex="0" role="note" ` +
                `aria-label="${safeTooltip}">${this._esc(reason)}</span>`;
        }
        const sections = Array.isArray(budget.sections) ? budget.sections : [
            ['Code', budget.code],
            ['API', budget.api],
            ['GT', budget.gt_capabilities],
            ['Free', budget.freespace],
        ].map(([label, value]) => value ? {
            label, words: value.words, measured: value.measured,
        } : null).filter(Boolean);
        const sectionHtml = sections.map(section =>
            `<span>${this._esc(section.label)} ${this._esc(section.words)}w` +
            `${section.measured === false ? ' *' : ''}</span>`).join('');
        const total = budget.total && budget.total.words != null
            ? `<b>Total ${this._esc(budget.total.words)}w / alloc ${
                this._esc(budget.allocation && budget.allocation.words != null
                    ? budget.allocation.words : 'N/A')}w</b>` : '';
        return `<div class="ba-size-budget" title="${this._esc(
            budget.metadata || 'Measured row metadata')}">${sectionHtml}${total}</div>`;
    },

    // ── Build-token auth helpers ───────────────────────────────────────────
    // The REPORT_TOKEN is held in sessionStorage (never leaves the tab).
    // It is sent as Authorization: Bearer on all Build Approval API calls.
    // The build_nonce (issued by /api/build-approval/ns-map after token
    // verification) acts as a CSRF guard on top of the Bearer token.

    _getBuildToken() {
        try { return sessionStorage.getItem('ba_build_token') || ''; } catch (_) { return ''; }
    },

    _setBuildToken(val) {
        try { sessionStorage.setItem('ba_build_token', val.trim()); } catch (_) {}
    },

    _onTokenInput(val) {
        this._setBuildToken(val);
        // A snapshot fetched with an earlier token must not remain actionable.
        this._selectedSnapshot = null;
        this._availableSnapshot = null;
        this._approvedRevisions = [];
        this._bitstreamRevisions = [];
        this._selectedBitstream = null;
        const download = document.getElementById('baDownloadRevisionBtn');
        if (download) download.disabled = true;
        this._snapFrozen = false;
        this._updateApproveBtn();
        const s = document.getElementById('baTokenStatus');
        if (s) s.textContent = val.trim() ? '✅ ready' : '';
        // Trigger a fresh load now that the token may have changed
        if (val.trim()) this.refresh(false);
    },

    _authHeaders() {
        const tok = this._getBuildToken();
        return tok ? { 'Authorization': 'Bearer ' + tok } : {};
    },

    _isRecord(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    },

    openRevisionHistory() {
        if (typeof switchView === 'function') switchView('builder');
        if (typeof switchBuilderViewTab === 'function') switchBuilderViewTab('build');
        const picker = document.getElementById('baBitstreamRevisionSelect');
        if (picker) { picker.scrollIntoView({ block: 'center' }); picker.focus(); }
        return false;
    },

    async downloadExactBitstream(event, link) {
        if (event) event.preventDefault();
        // Legacy current-card links cannot select immutable history implicitly.
        // A download is not a hardware connection, installation, or flash.
        const message = 'Select an exact approved bitstream in revision history, ' +
            'then use Download selected revision. Mutable release downloads are retired; ' +
            'nothing was built, downloaded, or flashed.';
        const status = document.getElementById('baBitstreamRevisionStatus');
        if (status) status.textContent = message;
        if (typeof appendOutput === 'function') appendOutput(message, 'info');
        this.openRevisionHistory();
        return false;
    },

    _approvalContractError(message) {
        const error = new Error(message);
        error.code = 'BUILD_APPROVAL_CONTRACT';
        return error;
    },

    _validateApprovalPayload(data) {
        if (!this._isRecord(data) || !Array.isArray(data.slot_rules)) {
            throw this._approvalContractError(
                'expected an object with a slot_rules array');
        }

        const expected = new Set(this._approvalRowFields);
        data.slot_rules.forEach((row, index) => {
            if (!this._isRecord(row)) {
                throw this._approvalContractError(
                    `row ${index} must be an object`);
            }
            const actual = Object.keys(row);
            const missing = this._approvalRowFields.filter(field => !actual.includes(field));
            const unexpected = actual.filter(field => !expected.has(field));
            if (missing.length || unexpected.length) {
                const details = [];
                if (missing.length) details.push(`missing ${missing.join(', ')}`);
                if (unexpected.length) details.push(`unexpected ${unexpected.join(', ')}`);
                throw this._approvalContractError(
                    `row ${index} violates the documented field contract (${details.join('; ')})`);
            }
            if (!Array.isArray(row.perms) || !Array.isArray(row.checks)) {
                throw this._approvalContractError(
                    `row ${index} must contain perms and checks arrays`);
            }
            if (row.size_budget !== null && !this._isRecord(row.size_budget)) {
                throw this._approvalContractError(
                    `row ${index} must contain an object or null size_budget`);
            }
            if (row.checks.some(check => !this._isRecord(check))) {
                throw this._approvalContractError(
                    `row ${index} contains an invalid check entry`);
            }
        });
        return data;
    },

    _renderApprovalContractError(error) {
        const body = document.getElementById('baMapBody');
        if (body) {
            body.innerHTML =
                '<div class="ba-error"><strong>Build Approval data is malformed.</strong> ' +
                `${this._esc(error.message)}. ` +
                'The Build screen was not updated. Click <strong>Refresh</strong> to try again.</div>';
        }
    },

    // ── Tab lifecycle ──────────────────────────────────────────────────────

    onTabOpen() {
        // Restore saved token into the input field on every open
        const input = document.getElementById('baBuildTokenInput');
        const status = document.getElementById('baTokenStatus');
        const tok = this._getBuildToken();
        if (input) input.value = tok;
        if (status) status.textContent = tok ? '✅ ready' : '';

        this.refresh(false);
        this._loadReleaseContext();
        this._checkBuildStatus();
        if (!this._timer) {
            this._timer = setInterval(() => {
                if (document.hidden) return;
                const p = document.getElementById('buildApprovalPanel');
                if (!p || p.style.display === 'none') return;
                this.refresh(false);
            }, this.AUTO_REFRESH_MS);
        }
        this._loadSnapshot();
        this._loadRevisions();
        this._loadBitstreamRevisions();
    },

    async refresh(manual) {
        if (this._inFlight) return;
        this._inFlight = true;
        const btn = document.getElementById('baRefreshBtn');
        if (btn && manual) btn.disabled = true;
        const body = document.getElementById('baMapBody');
        if (body && !this._lastMap) body.innerHTML = '<div class="ba-loading">Loading NS map…</div>';
        try {
            const res = await fetch('/api/build-approval/ns-map', {
                headers: this._authHeaders(),
                cache: 'no-store',
            });
            if (res.status === 401 || res.status === 403 || res.status === 503) {
                if (body) body.innerHTML =
                    '<div class="ba-error">🔑 Paste your <strong>REPORT_TOKEN</strong> into the ' +
                    '"Build token" field above to load the NS map.</div>';
                this._renderIssueComments(null);
                return;
            }
            const data = await _actionableJsonResponse(res, 'Load the Build Approval NS map', {
                dataChanged: false,
                nextAction: 'Check the build token, then click Refresh.',
            });
            this._validateApprovalPayload(data);
            this._lastMap = data;
            // Boot target display comes from the authoritative Namespace
            // snapshot, never from the compatibility map/config projection.
            try {
                const nsResponse = await fetch('/api/boot-image/ns-state', {
                    cache: 'no-store',
                });
                const nsState = await nsResponse.json();
                if (nsResponse.ok && nsState &&
                        typeof nsState.namespaceFingerprint === 'string') {
                    window._nsState = nsState;
                    if (typeof window._applyNamespaceBootProjection === 'function') {
                        window._applyNamespaceBootProjection(nsState);
                    }
                }
            } catch (_) {
                // The map remains viewable; Lightning Bolt commits still
                // fail explicitly through the Namespace CAS helper.
            }
            // Store the CSRF nonce for the build-start call.
            if (data.build_nonce) this._buildNonce = data.build_nonce;
            this._render(data);
            this._renderIssueComments(data);
            this._updateApproveBtn();
        } catch (e) {
            if (e && e.code === 'BUILD_APPROVAL_CONTRACT') {
                // Never leave a previously valid approval map actionable after
                // a malformed response has arrived.
                this._lastMap = null;
                this._buildNonce = null;
                this._snapFrozen = false;
                this._renderApprovalContractError(e);
                this._updateApproveBtn();
            } else if (body) {
                const message = /\bNo data was changed\b/.test(e.message) ? e.message :
                    _formatActionableNetworkError('Load the Build Approval NS map', e, {
                        dataChanged: false,
                        nextAction: 'Check the IDE connection and build token, then click Refresh.',
                    });
                body.innerHTML = `<div class="ba-error">${this._esc(message)}</div>`;
            }
            this._renderIssueComments(null);
        } finally {
            this._inFlight = false;
            if (btn) btn.disabled = false;
            const lc = document.getElementById('baLastChecked');
            if (lc) lc.textContent = 'Checked ' + new Date().toLocaleTimeString();
        }
    },

    _render(data) {
        const body = document.getElementById('baMapBody');
        if (!body) return;

        let html = '';
        if (data.hardware_budget) {
            html += this._renderBudget('Boot RAM budget (individual slot rules)', data.hardware_budget);
        }
        const fallbackTiers = data.tiers || {};
        const slots = Array.isArray(data.slot_rules)
            ? data.slot_rules
            : ['bootstrap', 'resident', 'lazy', 'unused']
                .flatMap(key => Array.isArray(fallbackTiers[key]) ? fallbackTiers[key] : []);
        if (slots.length) {
            html += '<div class="ba-tier-header">🧭 Namespace slots (individual load policies)</div>';
            html += `<table class="ba-table">
<thead><tr>
  <th>Slot</th><th>Name</th><th>Token</th><th>Header</th>
  <th>cw</th><th>cc</th><th>Location</th><th>Slot rule</th><th>Perms</th><th>Source</th>
  <th>Checks</th><th>Size budget</th>
</tr></thead><tbody>`;
            for (const s of slots) {
                html += this._renderRow(s);
            }
            html += '</tbody></table>';
        }

        body.innerHTML = html || '<div class="ba-empty">No NS map data available.</div>';
    },

    async _loadReleaseContext() {
        const el = document.getElementById('baReleaseContext');
        if (el && !this._release) {
            el.innerHTML = '<div class="ba-loading">Loading pending release comments…</div>';
        }
        try {
            const res = await fetch('/api/bitstream-versions');
            const data = await _actionableJsonResponse(res, 'Load pending release context', {
                dataChanged: false,
                nextAction: 'Check the IDE connection, then reopen Build Approval.',
            });
            this._release = data && data.release ? data.release : null;
        } catch (e) {
            this._release = { error: /\bNo data was changed\b/.test(e.message) ? e.message :
                _formatActionableNetworkError('Load pending release context', e, {
                    dataChanged: false,
                    nextAction: 'Check the IDE connection, then reopen Build Approval.',
                }) };
        }
        this._renderReleaseContext();
    },

    _renderReleaseContext() {
        const el = document.getElementById('baReleaseContext');
        if (!el) return;
        const release = this._release;
        if (!release || release.error) {
            el.innerHTML = `<div class="ba-context-head"><strong>📝 Pending release comments</strong></div>` +
                `<div class="ba-context-note">${this._esc((release && release.error) || 'Release context is unavailable.')}</div>`;
            return;
        }
        if (!release.pending) {
            el.innerHTML = `<div class="ba-context-head"><strong>📝 Pending release comments</strong>${this._badge('ok', 'Current')}</div>` +
                `<div class="ba-context-note">${this._esc(release.reason || 'No pending hardware changes.')}</div>`;
            return;
        }
        const items = Array.isArray(release.items) ? release.items : [];
        const itemHtml = items.length
            ? `<div class="ba-comment-list">${items.slice(0, 8).map(item => {
                const files = Array.isArray(item.files) ? item.files : [];
                const fileNote = files.length
                    ? `<span class="ba-comment-files">${files.length} hardware file${files.length === 1 ? '' : 's'}</span>`
                    : '';
                return `<div class="ba-comment-row"><code>${this._esc(item.commit || 'unknown')}</code>` +
                    `<span>${this._esc(item.message || 'Hardware source change')}</span>${fileNote}</div>`;
            }).join('')}</div>`
            : '<div class="ba-context-note">A release is pending, but no source-change comments are available.</div>';
        el.innerHTML =
            `<div class="ba-context-head"><strong>📝 Pending release comments</strong>${this._badge('warn', 'Review required')}</div>` +
            `<div class="ba-context-note">${this._esc(release.reason || 'Build required.')}</div>` +
            itemHtml;
    },

    _renderIssueComments(data) {
        const el = document.getElementById('baIssueComments');
        if (!el) return;
        if (!data || (!data.tiers && !Array.isArray(data.slot_rules))) {
            el.innerHTML = '<div class="ba-context-head"><strong>⚠️ Approval issues &amp; comments</strong></div>' +
                '<div class="ba-context-note">Paste the build token above to load protected validation comments.</div>';
            return;
        }
        const rows = Array.isArray(data.slot_rules)
            ? data.slot_rules
            : ['bootstrap', 'resident', 'lazy', 'unused']
                .flatMap(tier => (data.tiers && data.tiers[tier]) || []);
        const issues = [];
        for (const slot of rows) {
            for (const check of (slot.checks || [])) {
                if (check.ok === false || check.warn) {
                    issues.push({ slot: Object.assign({}, slot, {
                        load_policy: this._namespacePolicy(
                            slot.slot, slot.load_policy || slot.loadPolicy || '—'),
                    }), check });
                }
            }
        }
        if (!issues.length) {
            el.innerHTML = `<div class="ba-context-head"><strong>⚠️ Approval issues &amp; comments</strong>${this._badge('ok', 'No issues')}</div>` +
                '<div class="ba-context-note">All current validation checks pass without warnings.</div>';
            return;
        }
        const issueHtml = issues.map(({ slot, check }) => {
            const policy = slot.load_policy || slot.loadPolicy || '—';
            const blocking = check.ok === false &&
                ['Bootstrap', 'Hardware', 'Resident'].includes(policy);
            const severity = blocking ? 'bad' : 'warn';
            const label = blocking ? 'Blocks build' : 'Review';
            const location = `${policy} · slot ${slot.slot} · ${slot.name || 'unnamed'}`;
            return `<div class="ba-issue-row ba-issue-${severity}">` +
                `${this._badge(severity, label)} <b>${this._esc(location)}</b> — ${this._esc(check.label || 'validation check')}` +
                `<div class="ba-issue-detail">${this._esc(check.detail || 'No additional comment was provided.')}</div></div>`;
        }).join('');
        el.innerHTML =
            `<div class="ba-context-head"><strong>⚠️ Approval issues &amp; comments</strong>${this._badge('warn', `${issues.length} to review`)}</div>` +
            '<div class="ba-context-note">Blocking items prevent Freeze and Build. Lazy-load and unused-slot items remain visible for review but do not necessarily block a hardware build.</div>' +
            `<div class="ba-issue-list">${issueHtml}</div>`;
    },

    _slotRuleOptions(s) {
        const policy = this._namespacePolicy(s.slot,
            s.load_policy || s.loadPolicy || 'Lazy');
        const options = [
            ['Bootstrap', 'Bootstrap'],
            ['Hardware', 'Hardware'],
            ['Empty', 'Empty'],
            ['Resident', 'Resident'],
            ['Preload', 'Preload'],
            ['Lazy', 'Lazy'],
            ['Starter', 'Starter'],
        ];
        const selected = this._slotRuleSelection(s);
        return options.map(([value, label]) =>
            `<option value="${this._esc(value)}"${selected === value ? ' selected' : ''}>` +
            `${this._esc(label)}</option>`).join('');
    },

    _slotRuleSelection(s) {
        const policy = this._namespacePolicy(s.slot,
            s.load_policy || s.loadPolicy || 'Lazy');
        const selectedRule = s.slot_rule || s.slotRule;
        const nsRows = typeof window !== 'undefined' && window._nsState &&
            Array.isArray(window._nsState.abstractions)
            ? window._nsState.abstractions : [];
        const nsBootRow = nsRows.find(row => row && row.boot === true);
        const bootEntrySlot = nsBootRow && Number.isInteger(Number(nsBootRow.slot))
            ? Number(nsBootRow.slot) : null;
        const normalizedBootEntrySlot = Number(bootEntrySlot);
        const hasAuthoritativeBootEntry = bootEntrySlot !== null &&
            bootEntrySlot !== '' && Number.isInteger(normalizedBootEntrySlot);
        const isBootEntry = hasAuthoritativeBootEntry
            ? Number(s.slot) === normalizedBootEntrySlot
            : selectedRule === 'LightningBolt';
        if (isBootEntry) return 'Starter';
        const loadPolicies = [
            'Bootstrap', 'Hardware', 'Empty', 'Resident', 'Preload', 'Lazy',
        ];
        return loadPolicies.includes(selectedRule) ? selectedRule : (
            loadPolicies.includes(policy) ? policy : 'Lazy'
        );
    },

    async _changeSlotRule(slot, value, select) {
        const previous = select ? select.dataset.previousValue : '';
        if (select) select.disabled = true;
        try {
            // Lightning Bolt is a Namespace marker, not a boot-config slot
            // rule. Commit it through the Namespace CAS endpoint and only
            // refresh this view after the server acknowledges the commit.
            if (value === 'Starter' || value === 'LightningBolt') {
                if (typeof window._commitNamespaceBootMarker !== 'function') {
                    throw new Error(
                        'Namespace marker transaction is unavailable; reload the IDE and retry.');
                }
                await window._commitNamespaceBootMarker(Number(slot));
                await this.refresh(false);
                return;
            }
            const getRes = await fetch('/api/boot-config', { cache: 'no-store' });
            const data = await _actionableJsonResponse(getRes, 'Load the boot configuration', {
                dataChanged: false,
                nextAction: 'Refresh Build Approval, then change the slot rule again.',
            });
            const base = data.config || data.defaults;
            if (!base || !base.step1) throw new Error('Boot configuration is unavailable.');
            const config = JSON.parse(JSON.stringify(base));
            config.step2 = config.step2 && Array.isArray(config.step2.lumps)
                ? config.step2 : { lumps: [] };
            config.slotRules = config.slotRules && typeof config.slotRules === 'object'
                ? config.slotRules : {};

            const row = (this._lastMap && Array.isArray(this._lastMap.slot_rules)
                ? this._lastMap.slot_rules.find(item => Number(item.slot) === Number(slot))
                : null);
            const rows = config.step2.lumps;
            let saved = rows.find(item => item && Number(item.nsSlot) === Number(slot));

            // The visible slot rule is programmer-owned for every row. Only
            // programmable LUMP rows also need a step2 body-loading
            // projection; architecture rows keep their rule in slotRules.
            config.slotRules[String(slot)] = value;
            const shouldPersistStep2 = !row || row.programmable !== false;
            if (shouldPersistStep2) {
                if (!['Empty', 'Resident', 'Preload', 'Lazy'].includes(value)) {
                    if (saved) {
                        config.step2.lumps = rows.filter(item =>
                            !item || Number(item.nsSlot) !== Number(slot));
                    }
                } else {
                    if (!saved) {
                        saved = {
                            nsSlot: Number(slot),
                            abstraction: row && row.name ? row.name : `Slot ${slot}`,
                            lumpToken: row && row.token ? row.token : '',
                        };
                        rows.push(saved);
                    }
                    saved.loadPolicy = value;
                    saved.resident = value === 'Resident';
                    delete saved.prefetch;
                    delete saved.prefetchRequired;
                    delete saved.prefetchOrder;
                    delete saved.downloadUrl;

                    // A Resident row needs the same physical facts as the
                    // Namespace editor. The approval payload carries the
                    // committed location and measured binary allocation.
                    if (value === 'Resident' && row) {
                        const location = Number.parseInt(String(row.location || ''), 0);
                        const measured = row.size_budget && row.size_budget.total &&
                            Number(row.size_budget.total.words);
                        if (Number.isInteger(location) && location >= 0) saved.physAddr = location;
                        if (Number.isInteger(measured) && measured > 0) saved.lumpSize = measured;
                    }
                }
            }

            const postRes = await fetch('/api/boot-config', {
                method: 'POST',
                headers: Object.assign({'Content-Type': 'application/json'},
                    this._authHeaders()),
                body: JSON.stringify(config),
            });
            const postBody = await _actionableJsonResponse(postRes, 'Save the slot rule', {
                dataChanged: false,
                nextAction: 'Review the slot rule and approval checks, then save it again.',
            });
            if (typeof window !== 'undefined' && typeof window._setActiveBootConfig === 'function') {
                window._setActiveBootConfig(
                    postBody.config || config,
                    postBody.bootImageInvalidated === true,
                    postBody.invalidatedBootImageWords);
            }
            await this.refresh(false);
        } catch (e) {
            if (select) {
                select.value = previous || select.dataset.committedValue || select.value;
                select.title = /\bNo data was changed\b/.test(e.message) ? e.message :
                    _formatActionableNetworkError('Save the slot rule', e, {
                        dataChanged: null,
                        nextAction: 'Refresh the NS map to verify the rule before retrying.',
                    });
            }
            const status = document.getElementById('baSnapshotStatus');
            if (status) status.textContent = '❌ ' + (select && select.title ? select.title : e.message);
        } finally {
            if (select) select.disabled = false;
        }
    },

    _renderRow(s) {
        const row = this._normalizeRow(s);
        const checks = row.checks;
        const allOk = checks.length > 0 && checks.every(c => c.ok === true && !c.warn);
        const hasError = checks.some(c => c.ok === false);
        const hasWarn = !hasError && checks.some(c => c.warn);
        const rowClass = hasError ? 'ba-row-bad' : (hasWarn ? 'ba-row-warn' : (allOk ? 'ba-row-ok' : ''));
        const checkHtml = checks.map(c => this._checkBadge(c)).join(' ') ||
            '<span class="ba-badge ba-badge-unknown">N/A</span>';
        const budgetHtml = this._renderSizeBudget(row.size_budget);
        const slot = this._value(row.slot);
        return `<tr class="${rowClass}">
  <td class="ba-slot">${this._esc(slot)}</td>
  <td class="ba-name">${this._esc(this._value(row.name))}</td>
  <td class="ba-token"><code>${this._esc(this._value(row.token))}</code></td>
  <td class="ba-hdr"><code>${this._esc(this._value(row.header_word))}</code></td>
  <td class="ba-num">${this._esc(this._value(row.cw))}</td>
  <td class="ba-num">${this._esc(this._value(row.cc))}</td>
  <td class="ba-loc"><code>${this._esc(this._value(row.location))}</code></td>
   <td class="ba-load"><select class="ba-slot-rule" data-slot="${this._esc(slot)}"
        data-previous-value="${this._esc(this._slotRuleSelection(row))}"
       aria-label="Slot rule for NS slot ${this._esc(slot)}"
       onchange="if(typeof BuildApprovalView!=='undefined')BuildApprovalView._changeSlotRule(Number(this.dataset.slot),this.value,this)">
        ${this._slotRuleOptions(row)}
     </select></td>
  <td class="ba-perms">${this._esc(this._permStr(row.perms))}</td>
  <td class="ba-src">${this._esc(this._value(row.source))}</td>
  <td class="ba-checks">${checkHtml}</td>
  <td class="ba-size">${budgetHtml}</td>
</tr>`;
    },

    _normalizeRow(s) {
        const row = s && typeof s === 'object' ? s : {};
        return {
            slot: row.slot == null ? null : row.slot,
            name: row.name == null ? '?' : row.name,
            token: row.token == null ? null : row.token,
            header_word: row.header_word == null ? null : row.header_word,
            cw: row.cw == null ? null : row.cw,
            cc: row.cc == null ? null : row.cc,
            location: row.location == null ? null : row.location,
            words: row.words == null ? null : row.words,
            limit: row.limit == null ? null : row.limit,
            load_policy: row.load_policy || row.loadPolicy || 'Lazy',
            slot_rule: row.slot_rule || row.slotRule || null,
            perms: Array.isArray(row.perms) ? row.perms : [],
            source: row.source == null ? 'N/A' : row.source,
            programmable: row.programmable === true,
            checks: Array.isArray(row.checks) ? row.checks : [],
            size_budget: row.size_budget || null,
        };
    },

    _renderBudget(label, b) {
        const f = (x) => `${x.words}w / ${x.bytes} B`;
        return `<div class="ba-budget-card"><strong>${this._esc(label)}</strong>
          <span>Code ${f(b.code)}</span><span>API ${f(b.api)}</span>
          <span>GT/capabilities ${f(b.gt_capabilities)}</span>
          <span>Reserved freespace ${f(b.freespace)}</span>
          <b>Total ${f(b.total)} · allocation ${f(b.allocation)}</b>
        </div>`;
    },

    _renderConsole(data) {
        const wrap = document.getElementById('baConsole');
        if (!wrap) return;
        wrap.style.display = '';
        const phase = String(data && data.phase || 'idle').toLowerCase();
        const done = !!(data && data.done);
        const failed = done && data.exit_code !== 0;
        const phases = [
            ['queued', 'Queued'],
            ['launching', 'Connecting'],
            ['running', 'Vivado running'],
            [done && !failed ? 'complete' : 'failed', done && !failed ? 'Complete' : 'Result'],
        ];
        const rank = { idle: 0, queued: 0, launching: 1, running: 2, complete: 3, failed: 3 };
        const current = rank[phase] == null ? 0 : rank[phase];
        const phasesEl = document.getElementById('baConsolePhases');
        if (phasesEl) {
            phasesEl.innerHTML = phases.map((p, i) => {
                let cls = i < current ? 'done' : (i === current ? 'active' : '');
                if (failed && i === 3) cls = 'failed';
                return `<span class="ba-console-phase ${cls}">${i < current && !failed ? '✓ ' : ''}${p[1]}</span>`;
            }).join('');
        }
        const progress = document.getElementById('baConsoleProgress');
        if (progress) progress.style.width = `${failed ? 100 : Math.min(100, [0, 8, 24, 76, 100][current] || 0)}%`;
        const state = document.getElementById('baConsoleState');
        if (state) state.textContent = failed ? `Failed (exit ${data.exit_code})` :
            (done ? 'Complete' : (phase === 'running' ? 'Running' : phase === 'launching' ? 'Connecting' : 'Queued'));

        const message = document.getElementById('baConsoleMessage');
        if (!message) return;
        const diagnosis = data && data.diagnosis;
        if (failed && diagnosis) {
            message.className = 'ba-console-message error';
            message.innerHTML = `<b>What failed:</b> ${this._esc(diagnosis.what_failed)}` +
                (diagnosis.phase ? ` <span>(phase: ${this._esc(diagnosis.phase)})</span>` : '') +
                `<span class="ba-next"><b>Next:</b> ${this._esc(diagnosis.next_action)}</span>`;
        } else if (done) {
            message.className = 'ba-console-message';
            message.innerHTML = '<b>Build complete.</b> Download the generated bitstream from the Connect tab.';
        } else {
            const log = (data && (data.log_tail || data.log)) || [];
            const last = log.length ? log[log.length - 1] : 'Waiting for the remote build…';
            message.className = 'ba-console-message';
            message.innerHTML = `<b>${this._esc(phase === 'running' ? 'Vivado:' : 'Build:')}</b> ${this._esc(last)}`;
        }
    },

    _allChecksPass() {
        // Only hardware-relevant tiers gate Freeze/Approve.
        // Lazy/dynamic slots are fetched at runtime and don't affect the bitstream —
        // stale legacy manifest entries in those tiers show as warnings but must not
        // block synthesis.  This matches _snap_all_pass() in server/app.py exactly.
        if (!this._lastMap) return false;
        const blockingPolicies = new Set(['Bootstrap', 'Hardware', 'Resident']);
        const rows = Array.isArray(this._lastMap.slot_rules)
            ? this._lastMap.slot_rules.filter(s =>
                blockingPolicies.has(s.load_policy || s.loadPolicy))
            : ['bootstrap', 'resident'].flatMap(tier =>
                (this._lastMap.tiers && this._lastMap.tiers[tier]) || []);
        for (const s of rows) {
            for (const c of (s.checks || [])) {
                if (c.ok === false) return false;
            }
        }
        return true;
    },

    _updateApproveBtn() {
        const btn = document.getElementById('baApproveBtn');
        const freezeBtn = document.getElementById('baFreezeBtn');
        if (!btn) return;
        const checksOk = this._allChecksPass();
        if (freezeBtn) freezeBtn.disabled = !checksOk || this._buildRunning;
        // Live draft checks govern a NEW approval, not an already approved
        // immutable input. Building a selected older revision is intentional.
        btn.disabled = !this._selectedSnapshot || this._buildRunning;
        if (!this._selectedSnapshot) {
            btn.title = 'Freeze or explicitly select an approved Namespace revision first';
        } else {
            btn.title = 'Trigger Vivado synthesis on the build droplet';
        }
    },

    _snapshotIdentity(data) {
        if (!data || typeof data !== 'object') return null;
        const id = data.provenance_identity || data.build_intent_id;
        const filename = data.filename;
        // Old map-only snapshots are not approved Namespace revisions.
        if (!id || !filename || !data.namespace_revision_id ||
                !/^build-approval-[\w.-]+\.json$/.test(filename)) return null;
        return {
            provenance_identity: String(id),
            filename: String(filename),
            namespace_revision_id: String(data.namespace_revision_id),
            namespace_fingerprint: data.namespace_fingerprint || null,
            frozen_at: data.frozen_at || null,
        };
    },

    _selectSnapshot(snapshot) {
        if (!snapshot) throw new Error('Approved Namespace revision identity is unavailable.');
        this._selectedSnapshot = snapshot;
        this._snapFrozen = true;
        const status = document.getElementById('baSnapshotStatus');
        if (status) status.textContent =
            'Selected approved Namespace: ' + snapshot.filename +
            (snapshot.namespace_revision_id ? ' · revision ' + snapshot.namespace_revision_id : '') +
            ' · provenance ' + snapshot.provenance_identity;
        this._updateApproveBtn();
    },

    selectAvailableSnapshot() {
        // Loading a latest record is informational; this is the explicit
        // adoption action and pins its exact identity until changed by hand.
        this._selectSnapshot(this._availableSnapshot);
    },

    _revisionChoice(record) {
        if (!record || record.kind !== 'namespace' ||
                !/^[0-9a-f]{64}$/.test(String(record.revision_id || ''))) return null;
        const metadata = record.metadata || {};
        if (metadata.approval_state !== 'approved') return null;
        if (record.hardware_certified === false ||
                (metadata.purpose && metadata.purpose !== 'approved-hardware')) return null;
        const snapshot = metadata.snapshot || {};
        if (!/^[0-9a-f]{64}$/.test(String(snapshot.fingerprint || ''))) return null;
        return this._snapshotIdentity({
            filename: record.snapshot_filename || metadata.snapshot_filename,
            provenance_identity: record.build_intent_id || metadata.build_intent_id,
            namespace_revision_id: record.revision_id,
            namespace_fingerprint: snapshot.fingerprint,
            frozen_at: snapshot.provenance && snapshot.provenance.approval_frozen_at,
        });
    },

    async _loadRevisions() {
        const token = this._getBuildToken();
        try {
            const res = await fetch('/api/artifact-revisions/namespace', {
                headers: this._authHeaders(), cache: 'no-store',
            });
            const data = await _actionableJsonResponse(res, 'Load approved Namespace revisions', {
                dataChanged: false,
                nextAction: 'Check the build token and refresh Build Approval.',
            });
            if (token !== this._getBuildToken()) return;
            if (!Array.isArray(data.revisions)) throw new Error('Approved revision list is malformed.');
            // Never infer a provenance identity from a Namespace hash. Only
            // records carrying the exact build-intent identity issued at
            // approval time may be selected for a bitstream build.
            this._approvedRevisions = data.revisions.map(record =>
                this._revisionChoice(record)).filter(Boolean).sort((a, b) =>
                String(b.frozen_at || '').localeCompare(String(a.frozen_at || '')));
            if (!this._approvedRevisions.length && data.revisions.some(record =>
                record && record.metadata && record.metadata.approval_state === 'approved')) {
                throw new Error('Approved revisions have no exact build intent and approval snapshot identities.');
            }
            const select = document.getElementById('baRevisionSelect');
            if (select) {
                select.innerHTML = '<option value="">Select an approved Namespace revision…</option>' +
                    this._approvedRevisions.map(revision =>
                        `<option value="${this._esc(revision.namespace_revision_id)}">${
                            this._esc(revision.frozen_at || 'Approved')} · ${
                            this._esc(revision.namespace_revision_id.slice(0, 12))} · ${
                            this._esc(revision.provenance_identity.slice(0, 24))}</option>`).join('');
                select.value = this._selectedSnapshot
                    ? this._selectedSnapshot.namespace_revision_id : '';
            }
        } catch (error) {
            const status = document.getElementById('baSnapshotStatus');
            if (status && !this._selectedSnapshot) status.textContent =
                'Could not load approved revisions: ' + error.message;
        }
    },

    selectRevisionId(revisionId) {
        const revision = this._approvedRevisions.find(row =>
            row.namespace_revision_id === revisionId);
        if (!revision) {
            const select = document.getElementById('baRevisionSelect');
            if (select) select.value = this._selectedSnapshot
                ? this._selectedSnapshot.namespace_revision_id : '';
            return;
        }
        this._selectSnapshot(revision);
    },

    _bitstreamChoice(record) {
        if (!record || record.kind !== 'bitstream' ||
                !/^[0-9a-f]{64}$/.test(String(record.revision_id || ''))) return null;
        const digest = record.files && record.files['bitstream.bit'];
        if (!/^[0-9a-f]{64}$/.test(String(digest || ''))) return null;
        const metadata = record.metadata || {};
        const state = String(metadata.approval_state || '');
        if (!['approved', 'unmatched', 'legacy-unverified'].includes(state)) return null;
        return {
            revision_id: record.revision_id,
            sha256: digest,
            approval_state: state,
            namespace_revision_id: metadata.namespace_revision_id || null,
            build_record_id: metadata.build_record_id || null,
            source_commit: metadata.source_commit || null,
            hardware_version: metadata.hardware_version == null
                ? null : metadata.hardware_version,
        };
    },

    async _loadBitstreamRevisions() {
        const token = this._getBuildToken();
        const status = document.getElementById('baBitstreamRevisionStatus');
        try {
            const res = await fetch('/api/artifact-revisions/bitstream', {
                headers: this._authHeaders(), cache: 'no-store',
            });
            const data = await _actionableJsonResponse(res, 'Load immutable bitstream history', {
                dataChanged: false,
                nextAction: 'Check the build token and refresh bitstream history.',
            });
            if (token !== this._getBuildToken()) return;
            if (!Array.isArray(data.revisions)) throw new Error('Bitstream revision list is malformed.');
            this._bitstreamRevisions = data.revisions.map(record =>
                this._bitstreamChoice(record)).filter(Boolean);
            const select = document.getElementById('baBitstreamRevisionSelect');
            if (select) {
                const options = state => this._bitstreamRevisions
                    .filter(revision => (revision.approval_state === 'approved') === state)
                    .map(revision => `<option value="${this._esc(revision.revision_id)}">${
                        this._esc(revision.revision_id.slice(0, 12))} · ${
                        this._esc(revision.namespace_revision_id
                            ? 'Namespace ' + revision.namespace_revision_id.slice(0, 12)
                            : 'no approved Namespace')}</option>`).join('');
                select.innerHTML = '<option value="">Select a saved bitstream…</option>' +
                    '<optgroup label="Approved · exact Namespace and build">' + options(true) + '</optgroup>' +
                    '<optgroup label="Legacy / unverified · not approved">' + options(false) + '</optgroup>';
                select.value = this._selectedBitstream
                    ? this._selectedBitstream.revision_id : '';
            }
            const download = document.getElementById('baDownloadRevisionBtn');
            if (download) download.disabled = !this._selectedBitstream ||
                this._selectedBitstream.approval_state !== 'approved';
            if (status && !this._selectedBitstream) status.textContent =
                this._bitstreamRevisions.length
                    ? 'Select an immutable output to inspect its exact upstream identity.'
                    : 'No immutable bitstream revisions available.';
        } catch (error) {
            if (status) status.textContent = 'Bitstream history unavailable: ' + error.message;
        }
    },

    selectBitstreamRevision(revisionId) {
        const revision = this._bitstreamRevisions.find(row => row.revision_id === revisionId);
        const status = document.getElementById('baBitstreamRevisionStatus');
        const download = document.getElementById('baDownloadRevisionBtn');
        this._selectedBitstream = revision || null;
        if (download) download.disabled = !revision || revision.approval_state !== 'approved';
        if (status) status.textContent = revision
            ? `${revision.approval_state === 'approved' ? 'Approved' : 'Unverified / legacy'} · ` +
                `Namespace: ${revision.namespace_revision_id || 'none (not approved)'} · ` +
                `build record: ${revision.build_record_id || 'unknown'} · ` +
                `source: ${revision.source_commit || 'unknown'} · ` +
                `hardware: ${revision.hardware_version == null
                    ? 'unknown' : revision.hardware_version} · SHA-256: ${revision.sha256}` +
                (revision.approval_state === 'approved' ? ' · eligible for verified download' :
                    ' · cannot download without upstream approval')
            : 'No bitstream revision selected. Nothing was downloaded or activated.';
    },

    async downloadSelectedBitstream() {
        const revision = this._selectedBitstream;
        if (!revision || revision.approval_state !== 'approved' ||
                !this._bitstreamRevisions.some(row =>
            row.revision_id === revision.revision_id && row.sha256 === revision.sha256)) return false;
        const status = document.getElementById('baBitstreamRevisionStatus');
        const button = document.getElementById('baDownloadRevisionBtn');
        if (button) button.disabled = true;
        try {
            const res = await fetch('/api/artifact-revisions/bitstream/' +
                encodeURIComponent(revision.revision_id) + '/download', {
                headers: this._authHeaders(), cache: 'no-store',
            });
            if (!res.ok) throw new Error(_formatActionableHttpError(
                'Download immutable bitstream', res.status, await res.text(), {
                    dataChanged: false, nextAction: 'Refresh the bitstream history and retry.',
                }));
            // Older download responses may omit this header. If present it
            // must agree; the downloaded bytes are SHA-256 checked regardless.
            const serverDigest = res.headers && res.headers.get('X-Artifact-SHA256');
            if (serverDigest && serverDigest !== revision.sha256) {
                throw new Error('The server returned a different bitstream SHA-256 identity.');
            }
            const blob = await res.blob();
            if (!globalThis.crypto || !globalThis.crypto.subtle) {
                throw new Error('SHA-256 verification is unavailable; no file was saved.');
            }
            const digest = Array.from(new Uint8Array(
                await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer())))
                .map(byte => byte.toString(16).padStart(2, '0')).join('');
            if (digest !== revision.sha256) {
                throw new Error('Downloaded bitstream bytes do not match the approved SHA-256.');
            }
            const objectUrl = URL.createObjectURL(blob);
            try {
                const link = document.createElement('a');
                link.href = objectUrl;
                link.download = 'church_wukong_' + revision.revision_id.slice(0, 16) + '.bit';
                document.body.appendChild(link);
                link.click();
                link.remove();
            } finally {
                URL.revokeObjectURL(objectUrl);
            }
            if (status) status.textContent =
                'Downloaded exact ' + revision.approval_state + ' bitstream ' +
                revision.revision_id + '; no device or active build was changed. ' +
                'Flashing is a separate explicit action; this download does not verify installation.';
            return true;
        } catch (error) {
            if (status) status.textContent = 'Bitstream download blocked: ' + error.message;
            return false;
        } finally {
            if (button) button.disabled = !this._selectedBitstream ||
                this._selectedBitstream.approval_state !== 'approved';
        }
    },

    async freezeSnapshot() {
        const btn = document.getElementById('baFreezeBtn');
        if (btn) btn.disabled = true;
        const status = document.getElementById('baSnapshotStatus');
        if (status) status.textContent = 'Freezing…';
        try {
            const res = await fetch('/api/build-approval/freeze-snapshot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...this._authHeaders() },
                body: JSON.stringify({}),
            });
            const data = await _actionableJsonResponse(res, 'Freeze the build snapshot', {
                dataChanged: false,
                nextAction: 'Fix blocking approval checks, then click Freeze again.',
            });
            const snapshot = this._snapshotIdentity(data);
            if (!snapshot) throw new Error('Freeze did not return an exact approved revision identity. Refresh before building.');
            this._selectSnapshot(snapshot);
            await this._loadRevisions();
        } catch (e) {
            if (status) status.textContent = '❌ ' + (/\bNo data was changed\b/.test(e.message) ? e.message :
                _formatActionableNetworkError('Freeze the build snapshot', e, {
                    dataChanged: null,
                    nextAction: 'Refresh Build Approval to verify snapshot state before retrying.',
                }));
            if (btn) btn.disabled = false;
        }
    },

    async _checkBuildStatus() {
        try {
            const res = await fetch('/api/wukong-build/status', {
                headers: this._authHeaders(),
            });
            if (!res.ok) return;
            const data = await res.json();
            // Re-populate the console with the last known build state so
            // returning to the tab after a build shows the correct result.
            this._renderConsole(data);
            // If a build is still running, resume polling.
            if (data && !data.done && data.phase && data.phase !== 'idle') {
                if (!this._buildTimer) this._startBuildPoll();
            }
        } catch (_) { /* ignore — console stays in its static idle state */ }
    },

    async _loadSnapshot() {
        try {
            const res = await fetch('/api/build-approval/snapshot/latest', {
                headers: this._authHeaders(),
            });
            if (!res.ok) return;
            const data = await res.json();
            this._availableSnapshot = this._snapshotIdentity(data);
            const choice = document.getElementById('baSelectSnapshotBtn');
            if (choice) choice.disabled = !this._availableSnapshot;
            if (data.filename) {
                const status = document.getElementById('baSnapshotStatus');
                const provenance = data.provenance_identity || data.build_intent_id || '';
                // This server-issued immutable snapshot identity is the only
                // valid bitstream selection. A CSRF nonce is intentionally
                // kept separate and is never displayed as a build identity.
                if (provenance) {
                    this._provenanceIdentity = provenance;
                    const choices = document.getElementById('programmingProvenanceOptions');
                    if (choices && !Array.from(choices.options).some(o => o.value === provenance)) {
                        const option = document.createElement('option');
                        option.value = provenance;
                        option.label = 'Frozen approval provenance';
                        choices.appendChild(option);
                    }
                }
                if (status && !this._selectedSnapshot) status.textContent =
                    (this._availableSnapshot ? 'Available approved revision: ' :
                        'Legacy snapshot (no approved Namespace revision): ') + data.filename +
                    (data.namespace_revision_id ? ' · revision ' + data.namespace_revision_id : '') +
                    (this._availableSnapshot ? ' · choose “Use approved revision” to build it.' :
                        ' · freeze the current Namespace to build.');
            }
        } catch (_) { /* ignore */ }
    },

    async startBuild() {
        // build_nonce is CSRF protection, never an artifact identity.  The
        // programmer selects a server-published provenance identity.
        const selected = this._selectedSnapshot;
        if (!selected) {
            this._updateApproveBtn();
            return;
        }
        const targetBuild = window.TargetState.resolve().buildId || '';
        if (targetBuild !== selected.provenance_identity) {
            const status = document.getElementById('baSnapshotStatus');
            if (status) status.textContent =
                'Select the same exact provenance identity in the FPGA target before building: ' +
                selected.provenance_identity;
            return;
        }
        const targetAuthorization = window.TargetState.authorize(
            'bitstream', { id: targetBuild });
        if (!targetAuthorization.ok) return;
        const btn = document.getElementById('baApproveBtn');
        if (btn) btn.disabled = true;
        this._buildRunning = true;
        this._renderConsole({ phase: 'queued', done: false, log_tail: ['Build queued…'] });
        const logEl = document.getElementById('baBuildLog');
        const logWrap = document.getElementById('baBuildLogWrap');
        if (logWrap) logWrap.style.display = '';
        if (logEl) logEl.textContent = '⏳ Starting build on remote droplet…\n';
        const statusEl = document.getElementById('baBuildStatus');
        if (statusEl) { statusEl.textContent = 'Build starting…'; statusEl.className = 'ba-build-status ba-build-running'; }
        try {
            const res = await fetch('/api/wukong-build/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...this._authHeaders() },
                body: JSON.stringify(Object.assign({
                    build_nonce: this._buildNonce || '',
                    provenance_identity: selected.provenance_identity,
                    snapshot_filename: selected.filename,
                    namespace_revision_id: selected.namespace_revision_id,
                    namespace_fingerprint: selected.namespace_fingerprint,
                }, targetAuthorization.request)),
            });
            const data = await _actionableJsonResponse(res, 'Start the approved hardware build', {
                dataChanged: false,
                nextAction: 'Check the build token and frozen approval snapshot, then click Build again.',
            });
            this._renderConsole({ phase: 'launching', done: false, log_tail: ['Remote build accepted; connecting…'] });
            if (statusEl) statusEl.textContent = 'Build running… (~22 min)';
            this._startBuildPoll();
        } catch (e) {
            const actionable = /\bNo data was changed\b/.test(e.message) ? e.message :
                _formatActionableNetworkError('Start the approved hardware build', e, {
                    dataChanged: null,
                    nextAction: 'Refresh build status before retrying so a delayed build is not started twice.',
                });
            if (logEl) logEl.textContent += '❌ ' + actionable + '\n';
            this._renderConsole({
                phase: 'failed',
                done: true,
                exit_code: null,
                diagnosis: {
                    phase: 'launch',
                    what_failed: 'The build could not be started.',
                    next_action: actionable,
                },
            });
            if (statusEl) { statusEl.textContent = 'Build failed to start'; statusEl.className = 'ba-build-status ba-build-bad'; }
            this._buildRunning = false;
            this._updateApproveBtn();
        }
    },

    _startBuildPoll() {
        this._stopBuildPoll();
        this._buildTimer = setInterval(() => this._pollBuild(), 2000);
    },

    _stopBuildPoll() {
        if (this._buildTimer) { clearInterval(this._buildTimer); this._buildTimer = null; }
    },

    _lastLogLen: 0,

    async _pollBuild() {
        try {
            const res = await fetch('/api/wukong-build/status', {
                headers: this._authHeaders(),
            });
            if (!res.ok) return;
            const data = await res.json();
            this._renderConsole(data);
            const logEl = document.getElementById('baBuildLog');
            const statusEl = document.getElementById('baBuildStatus');
            if (logEl && data.log) {
                const lines = data.log;
                if (lines.length > this._lastLogLen) {
                    const newLines = lines.slice(this._lastLogLen).join('\n');
                    logEl.textContent += newLines + '\n';
                    this._lastLogLen = lines.length;
                    logEl.scrollTop = logEl.scrollHeight;
                }
            }
            if (data.done) {
                this._stopBuildPoll();
                this._buildRunning = false;
                this._lastLogLen = 0;
                const ok = data.exit_code === 0;
                if (ok && data.provenance_identity) {
                    window.TargetState.observeBitstreamLifecycle({ generatedId: data.provenance_identity });
                }
                if (statusEl) {
                    const d = data.diagnosis;
                    statusEl.textContent = ok ? '✅ Build complete!' :
                        '❌ ' + (d ? d.what_failed : ('Build failed (exit ' + data.exit_code + ')'));
                    statusEl.className = 'ba-build-status ' + (ok ? 'ba-build-ok' : 'ba-build-bad');
                }
                if (!ok && data.diagnosis && logEl) {
                    logEl.textContent += `\nWhat failed: ${data.diagnosis.what_failed}\nNext: ${data.diagnosis.next_action}\n`;
                }
                if (ok && logEl) logEl.textContent += '\n✅ Synthesis complete — select its approved bitstream revision in history, then Download selected revision. Flashing is separate.\n';
                this._updateApproveBtn();
            }
        } catch (_) { /* transient poll error — keep polling */ }
    },
};
window.BuildApprovalView = BuildApprovalView;
if (document && typeof document.addEventListener === 'function') {
    document.addEventListener('DOMContentLoaded', function() {
        if (new URLSearchParams(window.location.search || '').get('hardware-history') === '1') {
            // Let the normal startup view restoration finish first.
            setTimeout(function() { BuildApprovalView.openRevisionHistory(); }, 0);
        }
    });
    document.addEventListener('click', function(event) {
        const link = event.target && event.target.closest
            ? event.target.closest('[data-exact-bitstream-download]') : null;
        if (link) return BuildApprovalView.downloadExactBitstream(event, link);
    });
}
