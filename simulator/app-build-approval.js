/**
 * app-build-approval.js — Build Approval view (Builder ▸ 🔨 Build tab)
 *
 * Renders a four-tier NS map (Bootstrap / Resident / Lazy-load / Unused) with
 * inline ✅/⚠️/❌ check badges per slot, a Freeze Snapshot button, and an
 * Approve & Build button that triggers a remote Vivado synthesis run.
 */

/* eslint-disable no-use-before-define */
const BuildApprovalView = {
    _timer: null,
    _inFlight: false,
    _snapFrozen: false,
    _buildRunning: false,
    _buildTimer: null,
    _lastMap: null,
    AUTO_REFRESH_MS: 30000,

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
        const t = title ? ` title="${this._esc(title)}"` : '';
        return `<span class="ba-badge ba-badge-${kind}"${t}>${this._esc(label)}</span>`;
    },

    _checkBadge(check) {
        // check: { ok: bool|null, warn: bool, label, detail }
        if (check.ok === true && !check.warn) return this._badge('ok', '✅', check.detail || check.label);
        if (check.ok === null)               return this._badge('unknown', '—', check.detail || check.label);
        if (check.warn)                      return this._badge('warn', '⚠️', check.detail || check.label);
        return this._badge('bad', '❌', check.detail || check.label);
    },

    _permStr(perms) {
        if (!perms) return '—';
        if (Array.isArray(perms)) return perms.join('+') || '—';
        return String(perms);
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
        const s = document.getElementById('baTokenStatus');
        if (s) s.textContent = val.trim() ? '✅ ready' : '';
        // Trigger a fresh load now that the token may have changed
        if (val.trim()) this.refresh(false);
    },

    _authHeaders() {
        const tok = this._getBuildToken();
        return tok ? { 'Authorization': 'Bearer ' + tok } : {};
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
        if (!this._timer) {
            this._timer = setInterval(() => {
                if (document.hidden) return;
                const p = document.getElementById('buildApprovalPanel');
                if (!p || p.style.display === 'none') return;
                this.refresh(false);
            }, this.AUTO_REFRESH_MS);
        }
        this._loadSnapshot();
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
            });
            if (res.status === 401 || res.status === 403 || res.status === 503) {
                if (body) body.innerHTML =
                    '<div class="ba-error">🔑 Paste your <strong>REPORT_TOKEN</strong> into the ' +
                    '"Build token" field above to load the NS map.</div>';
                return;
            }
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            this._lastMap = data;
            // Store the CSRF nonce for the build-start call.
            if (data.build_nonce) this._buildNonce = data.build_nonce;
            this._render(data);
            this._updateApproveBtn();
        } catch (e) {
            if (body) body.innerHTML = `<div class="ba-error">Failed to load NS map: ${this._esc(e.message)}</div>`;
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

        const tiers = [
            { key: 'bootstrap', label: '🏗️ Bootstrap (slots 0–1 — baked into BRAM)' },
            { key: 'resident',  label: '📦 Resident (slots 2–7 — boot ROM)' },
            { key: 'lazy',      label: '🌐 Lazy-load (slots 8+ — server-fetched)' },
            { key: 'unused',    label: '⬛ Unused / gap slots' },
        ];

        let html = '';
        if (data.hardware_budget) {
            html += this._renderBudget('Hardware budget (resident binaries)', data.hardware_budget);
        }
        for (const tier of tiers) {
            const slots = data.tiers && data.tiers[tier.key];
            if (!slots || !slots.length) continue;
            html += `<div class="ba-tier-header">${this._esc(tier.label)}</div>`;
            html += `<table class="ba-table">
<thead><tr>
  <th>Slot</th><th>Name</th><th>Token</th><th>Header</th>
  <th>cw</th><th>cc</th><th>Location</th><th>Perms</th><th>Source</th>
  <th>Checks</th><th>Size budget</th>
</tr></thead><tbody>`;
            for (const s of slots) {
                html += this._renderRow(s);
            }
            html += '</tbody></table>';
        }

        body.innerHTML = html || '<div class="ba-empty">No NS map data available.</div>';
    },

    _renderRow(s) {
        const checks = s.checks || [];
        const allOk = checks.length > 0 && checks.every(c => c.ok === true && !c.warn);
        const hasError = checks.some(c => c.ok === false);
        const hasWarn = !hasError && checks.some(c => c.warn);
        const rowClass = hasError ? 'ba-row-bad' : (hasWarn ? 'ba-row-warn' : (allOk ? 'ba-row-ok' : ''));
        const checkHtml = checks.map(c => this._checkBadge(c)).join(' ') || '<span class="ba-badge ba-badge-unknown">—</span>';

        const budget = s.size_budget;
        const budgetHtml = budget && budget.available
            ? `<div class="ba-size-budget" title="Measured binary content; freespace is reserved, not used content">
                <span>Code ${budget.code.words}w</span>
                <span>API ${budget.api.words}w${budget.api.measured ? '' : ' *'}</span>
                <span>GT ${budget.gt_capabilities.words}w</span>
                <span>Free ${budget.freespace.words}w</span>
                <b>Total ${budget.total.words}w / alloc ${budget.allocation.words}w</b>
               </div>`
            : `<span class="ba-size-unavailable">${this._esc(budget && budget.reason || 'size unavailable')}</span>`;
        return `<tr class="${rowClass}">
  <td class="ba-slot">${this._esc(s.slot)}</td>
  <td class="ba-name">${this._esc(s.name || '—')}</td>
  <td class="ba-token"><code>${this._esc(s.token || '—')}</code></td>
  <td class="ba-hdr"><code>${this._esc(s.header_word || '—')}</code></td>
  <td class="ba-num">${this._esc(s.cw != null ? s.cw : '—')}</td>
  <td class="ba-num">${this._esc(s.cc != null ? s.cc : '—')}</td>
  <td class="ba-loc"><code>${this._esc(s.location || '—')}</code></td>
  <td class="ba-perms">${this._esc(this._permStr(s.perms))}</td>
  <td class="ba-src">${this._esc(s.source || '—')}</td>
  <td class="ba-checks">${checkHtml}</td>
  <td class="ba-size">${budgetHtml}</td>
</tr>`;
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
        const tiers = this._lastMap.tiers || {};
        const HW_TIERS = ['bootstrap', 'resident'];
        for (const tierName of HW_TIERS) {
            for (const s of (tiers[tierName] || [])) {
                for (const c of (s.checks || [])) {
                    if (c.ok === false) return false;
                }
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
        btn.disabled = !checksOk || !this._snapFrozen || this._buildRunning;
        if (!checksOk) {
            btn.title = 'Fix ❌ checks in Bootstrap/Resident tiers before approving (lazy-tier warnings are non-blocking)';
        } else if (!this._snapFrozen) {
            btn.title = 'Freeze a snapshot first';
        } else {
            btn.title = 'Trigger Vivado synthesis on the build droplet';
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
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data.error || 'HTTP ' + res.status);
            this._snapFrozen = true;
            if (status) status.textContent = '✅ Snapshot frozen: ' + (data.filename || '');
            this._updateApproveBtn();
        } catch (e) {
            if (status) status.textContent = '❌ Freeze failed: ' + e.message;
            if (btn) btn.disabled = false;
        }
    },

    async _loadSnapshot() {
        try {
            const res = await fetch('/api/build-approval/snapshot/latest', {
                headers: this._authHeaders(),
            });
            if (!res.ok) return;
            const data = await res.json();
            if (data.filename) {
                const status = document.getElementById('baSnapshotStatus');
                if (status && !this._snapFrozen) {
                    status.textContent = 'Latest snapshot: ' + data.filename + ' (' + (data.frozen_at || '') + ')';
                }
            }
        } catch (_) { /* ignore */ }
    },

    async startBuild() {
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
                body: JSON.stringify({ build_nonce: this._buildNonce || '' }),
            });
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data.error || 'HTTP ' + res.status);
            this._renderConsole({ phase: 'launching', done: false, log_tail: ['Remote build accepted; connecting…'] });
            if (statusEl) statusEl.textContent = 'Build running… (~22 min)';
            this._startBuildPoll();
        } catch (e) {
            if (logEl) logEl.textContent += '❌ Failed to start: ' + e.message + '\n';
            this._renderConsole({
                phase: 'failed',
                done: true,
                exit_code: null,
                diagnosis: {
                    phase: 'launch',
                    what_failed: 'The build could not be started.',
                    next_action: e.message || 'Check the build token, approval snapshot, and remote build configuration.',
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
                if (statusEl) {
                    const d = data.diagnosis;
                    statusEl.textContent = ok ? '✅ Build complete!' :
                        '❌ ' + (d ? d.what_failed : ('Build failed (exit ' + data.exit_code + ')'));
                    statusEl.className = 'ba-build-status ' + (ok ? 'ba-build-ok' : 'ba-build-bad');
                }
                if (!ok && data.diagnosis && logEl) {
                    logEl.textContent += `\nWhat failed: ${data.diagnosis.what_failed}\nNext: ${data.diagnosis.next_action}\n`;
                }
                if (ok && logEl) logEl.textContent += '\n✅ Synthesis complete — download the .bit from the Connect tab.\n';
                this._updateApproveBtn();
            }
        } catch (_) { /* transient poll error — keep polling */ }
    },
};
window.BuildApprovalView = BuildApprovalView;
