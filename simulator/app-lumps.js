function showLumpDetail(token) {
    _lumpEditDirty = false;
    _selectedLumpToken = token;
    const listEl = document.getElementById('lumpsListContent');
    if (listEl) {
        listEl.querySelectorAll('.lump-item').forEach(el => el.classList.remove('active'));
        listEl.querySelectorAll('.lump-item').forEach(el => {
            if (el.querySelector('.lump-token')?.textContent === `0x${token}`) el.classList.add('active');
        });
    }

    const lump = _lumpsCache.find(l => l.token === token);
    if (!lump) return;

    const titleEl = document.getElementById('lumpsDetailTitle');
    const contentEl = document.getElementById('lumpsDetailContent');
    if (!titleEl || !contentEl) return;

    const isNamespace = lump.lump_type === 'namespace' || lump.typ === 10;
    const _lumpTitleLabel = _lumpContentTypeLabel(lump);
    titleEl.textContent = (lump.abstraction || 'Unknown Lump') +
        (isNamespace ? ' — Namespace LUMP' : ` — ${_lumpTitleLabel}`);

    const _tk = token.replace(/[^a-z0-9]/gi, '');
    const _prevTab = _lumpActiveTab[_tk] || 'overview';
    delete _lumpContentLoaded[_tk];
    delete _lumpHexLoaded[_tk];
    delete _lumpTokensLoaded[_tk];

    // ── Lump header strip (shown between title and tabs, always visible) ──────
    const _e = _escHtml;
    let _headerStrip = `<div class="lump-header-strip">`;
    _headerStrip += _lumpTypeBadge(lump);
    _headerStrip += `<span class="lump-hs-chip"><span class="lump-hs-label">Token</span>0x${_e(lump.token || '')}</span>`;
    if (lump.ns_slot !== null && lump.ns_slot !== undefined)
        _headerStrip += `<span class="lump-hs-chip"><span class="lump-hs-label">NS</span>${parseInt(lump.ns_slot)}</span>`;
    if (lump.lump_size)
        _headerStrip += `<span class="lump-hs-chip"><span class="lump-hs-label">Size</span>${parseInt(lump.lump_size)}w</span>`;
    if (lump.cw !== undefined && lump.cw !== null)
        _headerStrip += `<span class="lump-hs-chip"><span class="lump-hs-label">CW</span>${parseInt(lump.cw)}</span>`;
    if (lump.cc !== undefined && lump.cc !== null)
        _headerStrip += `<span class="lump-hs-chip"><span class="lump-hs-label">CC</span>${parseInt(lump.cc)}</span>`;
    // Resize button — always shown; disabled when already at minimum size
    {
        const _curSize  = parseInt(lump.lump_size) || 0;
        const _cw       = parseInt(lump.cw) || 0;
        const _cc       = parseInt(lump.cc) || 0;
        const _minCont  = 1 + _cw + _cc;
        let   _minSize  = 64;
        while (_minSize < _minCont) _minSize *= 2;
        const _canShrink = _curSize > _minSize;
        const _saved = _curSize - _minSize;
        _headerStrip += `<button class="lump-hs-resize-btn${_canShrink ? '' : ' lump-hs-resize-disabled'}" ` +
            `onclick="${_canShrink ? `_resizeLump('${_e(lump.token)}')` : ''}" ` +
            `${_canShrink ? '' : 'disabled '}` +
            `title="${_canShrink ? `Remove unused freespace — shrink from ${_curSize}w to ${_minSize}w (save ${_saved}w)` : `Already at minimum size (${_curSize}w)`}">` +
            `Shrink to ${_minSize}w ▼</button>`;
    }
    _headerStrip += `</div>`;

    let _tabBar = `<div class="lump-tabs-bar" id="lumpTabBar_${_tk}">` +
        `<button class="lump-tab${isNamespace ? ' lump-tab-active' : ''}" onclick="_switchLumpTab('${_tk}','overview')">Overview</button>`;
    if (!isNamespace) {
        _tabBar += `<button class="lump-tab lump-tab-active" onclick="_switchLumpTab('${_tk}','content')">Content</button>`;
        _tabBar += `<button class="lump-tab" onclick="_switchLumpTab('${_tk}','tokens')">Tokens</button>`;
    }
    _tabBar += `<button class="lump-tab" onclick="_switchLumpTab('${_tk}','hexdump')">Hex Dump</button></div>`;

    // ── Action bar (Edit + Audit + Delete) shown below the header strip ──────
    let _actionBar = `<div class="lump-action-bar">`;
    if (!isNamespace) {
        _actionBar += `<button class="btn lump-edit-btn" data-edit-token="${_e(token)}" title="Edit \u2014 Open the code editor (Create page)">&#9998; Edit</button>`;
        _actionBar += `<button class="btn lump-audit-btn" data-audit-token="${_e(token)}" title="Audit \u2014 Run pre-save consistency checks on this LUMP binary">\u2699 Audit</button>`;
    }
    _actionBar += `<button class="btn lump-delete-btn lump-delete-top-btn" data-delete-token="${_e(token)}" title="Delete this lump">Delete</button>`;
    _actionBar += `</div>`;
    _actionBar += `<div class="lump-audit-results-wrap" id="lumpAuditResults_${_tk}"></div>`;

    let html = _headerStrip + _actionBar + _tabBar + `<div class="lump-tab-panel${isNamespace ? ' lump-tab-panel-active' : ''}" id="lumpTabOverview_${_tk}"><div class="lump-detail-sections">`;

    const e = _escHtml;

    if (isNamespace) {
        const nsMeta = lump.namespace_meta || {};
        html += '<div class="lump-detail-section">';
        html += '<div class="lump-section-title">Namespace LUMP</div>';
        html += '<table class="lump-detail-table"><tbody>';
        html += `<tr><td>Token</td><td>0x${e(lump.token)}</td></tr>`;
        if (nsMeta.app_id) html += `<tr><td>App ID</td><td>${e(nsMeta.app_id)}</td></tr>`;
        if (nsMeta.base) html += `<tr><td>Base Address</td><td>${e(nsMeta.base)}</td></tr>`;
        if (nsMeta.n) html += `<tr><td>Size (n)</td><td>${parseInt(nsMeta.n)} (${(1 << parseInt(nsMeta.n))} words)</td></tr>`;
        html += `<tr><td>Locator Count (cc)</td><td>${parseInt(nsMeta.cc || lump.cc) || 0}</td></tr>`;
        if (nsMeta.ns_table_start) html += `<tr><td>NS Table Start</td><td>word ${parseInt(nsMeta.ns_table_start)}</td></tr>`;
        html += `<tr><td>Lump Size</td><td>${parseInt(lump.lump_size) || 0} words (${(parseInt(lump.lump_size) || 0) * 4} bytes)</td></tr>`;
        html += '</tbody></table>';
        html += '</div>';

        const _graphTk = _tk;
        const _nsAllEntries = nsMeta.entries || [];
        const _nsNullCount = _nsAllEntries.filter(ent => !ent.state || ent.state === 'null').length;
        const _nsActiveCount = _nsAllEntries.length - _nsNullCount;
        const graphResult = _buildNsDepGraph(nsMeta, lump, false);
        if (graphResult || (_nsNullCount > 0 && _nsActiveCount === 0)) {
            const wrapId = `nsdg-wrap-${_graphTk}`;
            html += '<div class="lump-detail-section">';
            html += '<div class="lump-section-title">Dependency Graph</div>';
            html += `<div class="ns-dep-graph-toolbar">`;
            if (graphResult) {
                html += `<button class="ns-dep-graph-btn" onclick="_nsdgZoom('${wrapId}', 1.25)" title="Zoom in">+</button>`;
                html += `<button class="ns-dep-graph-btn" onclick="_nsdgZoom('${wrapId}', 0.8)" title="Zoom out">\u2212</button>`;
                html += `<button class="ns-dep-graph-btn" onclick="_nsdgReset('${wrapId}')" title="Reset zoom">\u21ba</button>`;
            }
            const nullCount = graphResult ? graphResult.nullCount : _nsNullCount;
            if (nullCount > 0) {
                html += `<button class="ns-dep-graph-btn ns-dep-graph-null-btn" id="nsdg-null-btn-${_graphTk}" data-null-count="${nullCount}" onclick="_nsdgToggleNull('${_graphTk}')" title="Show/hide empty slots">Show ${nullCount} null slot${nullCount !== 1 ? 's' : ''}</button>`;
            }
            html += `</div>`;
            if (graphResult) {
                html += `<div class="ns-dep-graph-wrap" id="${wrapId}">${graphResult.svg}</div>`;
            } else {
                html += `<div class="ns-dep-graph-wrap" id="${wrapId}" style="min-height:2.5rem;display:flex;align-items:center;padding:0.5rem 0.75rem;color:#4a4a6a;font-size:0.78rem;">All ${nullCount} slot${nullCount !== 1 ? 's are' : ' is'} empty \u2014 click to reveal</div>`;
            }
            html += '</div>';
        }

        const nsEntries = nsMeta.entries || [];
        if (nsEntries.length > 0) {
            html += '<div class="lump-detail-section">';
            html += '<div class="lump-section-title">NS Table Entries</div>';
            html += '<table class="lump-detail-table"><thead><tr><th>Slot</th><th>Label</th><th>State</th><th>Details</th></tr></thead><tbody>';
            for (const ent of nsEntries) {
                html += `<tr><td>${parseInt(ent.slot)}</td><td>${e(ent.label || '')}</td><td>${e(ent.state || 'null')}</td><td>`;
                if (ent.state === 'outform') {
                    html += `hash: ${e(ent.hash || '')}, loc_idx: ${ent.loc_idx || 0}`;
                    if (ent.flags) html += `, flags: 0x${(ent.flags || 0).toString(16)}`;
                } else if (ent.state === 'bundled' || ent.state === 'live') {
                    html += `file: ${e(ent.file || 'n/a')}`;
                } else {
                    html += 'all-zero';
                }
                html += '</td></tr>';
            }
            html += '</tbody></table>';
            html += '</div>';
        }
    } else {
        html += '<div class="lump-detail-section">';
        html += '<table class="lump-detail-table"><tbody>';
        html += `<tr><td>Token</td><td>0x${e(lump.token)}</td></tr>`;
        if (lump.ns_slot !== null && lump.ns_slot !== undefined) html += `<tr><td>NS Slot</td><td>${parseInt(lump.ns_slot) || 0}</td></tr>`;
        html += `<tr><td>Lump Size</td><td>${parseInt(lump.lump_size) || 0} words (${(parseInt(lump.lump_size) || 0) * 4} bytes)</td></tr>`;
        html += `<tr><td>Code Words</td><td>${parseInt(lump.cw) || 0}</td></tr>`;
        html += `<tr><td>C-List Slots</td><td>${parseInt(lump.cc) || 0}</td></tr>`;
        if (lump.language) html += `<tr><td>Language</td><td>${e(lump.language)}</td></tr>`;
        if (lump.profile) html += `<tr><td>Profile</td><td>${e(lump.profile)}</td></tr>`;
        const grants = lump.grants || [];
        if (grants.length > 0) html += `<tr><td>Grants</td><td>[${grants.map(g => e(g)).join(', ')}]</td></tr>`;
        html += '</tbody></table>';
        html += '</div>';

        {
            const _metaTk = e(lump.token);
            const _metaAuthor = lump.author || '';
            const _metaVersion = lump.version || '';
            const _metaId = `lumpMeta_${_tk}`;
            html += '<div class="lump-detail-section">';
            html += '<div class="lump-section-title lump-authorship-title">Authorship';
            html += `<button class="lump-meta-edit-toggle btn" onclick="_toggleLumpMetaEdit('${_metaId}')" title="Edit author and version">&#9998; Edit</button>`;
            html += '</div>';
            html += `<div id="${_metaId}_display">`;
            html += '<table class="lump-detail-table"><tbody>';
            html += `<tr><td>Author</td><td>${_metaAuthor ? e(_metaAuthor) : '<span style="color:var(--text-secondary);font-style:italic;">not set</span>'}</td></tr>`;
            html += `<tr><td>Version</td><td>${_metaVersion ? e(_metaVersion) : '<span style="color:var(--text-secondary);font-style:italic;">not set</span>'}</td></tr>`;
            html += '</tbody></table>';
            html += '</div>';
            html += `<div id="${_metaId}_form" class="lump-meta-edit-form" style="display:none;">`;
            html += '<table class="lump-detail-table lump-meta-edit-table"><tbody>';
            html += `<tr><td>Author</td><td><input type="text" id="${_metaId}_author" class="lump-meta-input" value="${e(_metaAuthor)}" placeholder="e.g. Alice Smith" maxlength="128"></td></tr>`;
            html += `<tr><td>Version</td><td><input type="text" id="${_metaId}_version" class="lump-meta-input" value="${e(_metaVersion)}" placeholder="e.g. 1.0.0" maxlength="64"></td></tr>`;
            html += '</tbody></table>';
            html += `<div class="lump-meta-edit-actions">`;
            html += `<button class="btn lump-edit-save-btn" onclick="_saveLumpMeta('${_metaTk}','${_metaId}')">Save</button>`;
            html += `<button class="btn lump-edit-cancel-btn" onclick="_toggleLumpMetaEdit('${_metaId}')">Cancel</button>`;
            html += `<span id="${_metaId}_status" class="lump-edit-status"></span>`;
            html += '</div>';
            html += '</div>';
            html += '</div>';
        }
    }

    if (!isNamespace) {
    const methods = (lump.methods || []).filter(m => !m.aliasOf);
    if (methods.length > 0) {
        const anyMethodPN = methods.some(m => {
            const dr = ((m.pet_names || {}).DR) || {};
            return Object.keys(dr).length > 0;
        });
        html += '<div class="lump-detail-section">';
        html += '<div class="lump-section-title">Methods</div>';
        if (anyMethodPN) {
            html += '<table class="lump-detail-table"><thead><tr><th>#</th><th>Name</th><th>Offset</th><th>Len</th><th>DR Parameters</th></tr></thead><tbody>';
        } else {
            html += '<table class="lump-detail-table"><thead><tr><th>#</th><th>Name</th><th>Offset</th><th>Len</th></tr></thead><tbody>';
        }
        for (let i = 0; i < methods.length; i++) {
            const m = methods[i];
            if (anyMethodPN) {
                const drMap = ((m.pet_names || {}).DR) || {};
                const drStr = Object.entries(drMap)
                    .sort(([a], [b]) => parseInt(a) - parseInt(b))
                    .map(([k, v]) => `DR${k}=${v}`)
                    .join(', ');
                html += `<tr><td>${i}</td><td>${e(m.name)}</td><td>${parseInt(m.offset) || 0}</td><td>${parseInt(m.length) || 0}</td><td style="color:#a855f7;font-size:0.78rem;">${e(drStr)}</td></tr>`;
            } else {
                html += `<tr><td>${i}</td><td>${e(m.name)}</td><td>${parseInt(m.offset) || 0}</td><td>${parseInt(m.length) || 0}</td></tr>`;
            }
        }
        html += '</tbody></table>';
        html += '</div>';
    }

    const petNames = lump.pet_names || {};
    const drNames = petNames.DR || {};
    const crNames = petNames.CR || {};
    const hasPetNames = Object.keys(drNames).length > 0 || Object.keys(crNames).length > 0;
    if (hasPetNames) {
        html += '<div class="lump-detail-section">';
        html += '<div class="lump-section-title">Pet Names</div>';
        html += '<table class="lump-detail-table"><thead><tr><th>Register</th><th>Name</th></tr></thead><tbody>';
        for (const [reg, name] of Object.entries(drNames)) {
            html += `<tr><td>${e(reg)}</td><td>${e(name)}</td></tr>`;
        }
        for (const [reg, name] of Object.entries(crNames)) {
            html += `<tr><td>${e(reg)}</td><td>${e(name)}</td></tr>`;
        }
        html += '</tbody></table>';
        html += '</div>';
    }

    const mtbf = lump.mtbf || {};
    {
        const mtbfSt = mtbf.status || 'unknown';
        const isUnknown = mtbfSt === 'unknown' || mtbfSt === 'untested';
        const mtbfClass = mtbfSt === 'green' ? 'mtbf-green'
                        : mtbfSt === 'amber'  ? 'mtbf-amber'
                        : isUnknown           ? 'mtbf-unknown'
                        : 'mtbf-red';
        const mtbfLabel = isUnknown ? 'UNKNOWN' : mtbfSt.toUpperCase();
        html += '<div class="lump-detail-section">';
        html += '<div class="lump-section-title">MTBF Reliability</div>';
        html += '<table class="lump-detail-table"><tbody>';
        html += `<tr><td>Status</td><td><span class="mtbf-badge ${mtbfClass}">${e(mtbfLabel)}</span>${isUnknown ? ' <span style="color:#6b7280;font-size:0.72rem;">— needs testing</span>' : ''}</td></tr>`;
        html += `<tr><td>Clean Runs</td><td>${parseInt(mtbf.consecutive_clean) || 0}${isUnknown ? ' <span style="color:#6b7280;font-size:0.72rem;">(run in simulator to qualify)</span>' : ''}</td></tr>`;
        html += `<tr><td>Total Runs</td><td>${parseInt(mtbf.total_runs) || 0}</td></tr>`;
        if (mtbf.source_hash) html += `<tr><td>Source Hash</td><td><code>${e(mtbf.source_hash)}</code></td></tr>`;
        html += '</tbody></table>';
        html += '</div>';
    }

    const deploy = lump.deployment || {};
    if (deploy.built_at || deploy.target_board) {
        html += '<div class="lump-detail-section">';
        html += '<div class="lump-section-title">Deployment</div>';
        html += '<table class="lump-detail-table"><tbody>';
        if (deploy.target_board) html += `<tr><td>Target Board</td><td>${e(deploy.target_board)}</td></tr>`;
        if (deploy.profile) html += `<tr><td>Profile</td><td>${e(deploy.profile)}</td></tr>`;
        if (deploy.built_at) {
            const d = new Date(deploy.built_at);
            html += `<tr><td>Built At</td><td>${e(d.toLocaleString())}</td></tr>`;
        }
        if (deploy.builder) html += `<tr><td>Builder</td><td>${e(deploy.builder)}</td></tr>`;
        html += '</tbody></table>';
        html += '</div>';
    }

    const caps = lump.capabilities || [];
    if (caps.length > 0) {
        html += '<div class="lump-detail-section">';
        html += '<div class="lump-section-title">Capabilities</div>';
        html += '<table class="lump-detail-table"><thead><tr><th>#</th><th>Name</th><th>NS Index</th></tr></thead><tbody>';
        for (let i = 0; i < caps.length; i++) {
            const c = caps[i];
            const nsStr = (c.nsIndex !== undefined && c.nsIndex >= 0) ? `NS[${c.nsIndex}]` : 'unresolved';
            html += `<tr><td>${i}</td><td>${e(c.name)}</td><td>${nsStr}</td></tr>`;
        }
        html += '</tbody></table>';
        html += '</div>';
    }
    }

    html += '</div></div>';

    if (!isNamespace) {
        html += `<div class="lump-tab-panel${!isNamespace ? ' lump-tab-panel-active' : ''}" id="lumpTabContent_${_tk}">` +
                `<div id="lumpContentBody_${_tk}" class="lump-hex-loading">Loading\u2026</div></div>`;
        html += `<div class="lump-tab-panel" id="lumpTabTokens_${_tk}">` +
                `<div id="lumpTokensBody_${_tk}" class="lump-hex-loading">Loading\u2026</div></div>`;
    }
    html += `<div class="lump-tab-panel" id="lumpTabHexdump_${_tk}">` +
            `<div id="lumpBinBody_${_tk}" class="lump-hex-loading">Loading\u2026</div></div>`;

    contentEl.innerHTML = html;
    const delBtn = contentEl.querySelector('.lump-delete-btn[data-delete-token]');
    if (delBtn) delBtn.addEventListener('click', () => deleteLump(delBtn.dataset.deleteToken));
    const editBtn = contentEl.querySelector('.lump-edit-btn[data-edit-token]');
    if (editBtn) editBtn.addEventListener('click', () => openLumpInEditor(editBtn.dataset.editToken));
    const auditBtn = contentEl.querySelector('.lump-audit-btn[data-audit-token]');
    if (auditBtn) {
        auditBtn.addEventListener('click', () => {
            const _auditToken = auditBtn.dataset.auditToken;
            const _auditLump  = _lumpsCache.find(l => l.token === _auditToken);
            const _auditWrap  = document.getElementById(`lumpAuditResults_${_auditToken.replace(/[^a-z0-9]/gi, '')}`);
            if (!_auditWrap) return;
            const _manifest = _auditLump ? { cw: _auditLump.cw, cc: _auditLump.cc, lump_size: _auditLump.lump_size, pet_names: _auditLump.pet_names || null, capabilities: _auditLump.capabilities || [] } : null;
            if (typeof lumpAuditFromServer === 'function') {
                auditBtn.disabled = true;
                lumpAuditFromServer(_auditToken, _manifest, _auditWrap, { collapsible: true, startOpen: true })
                    .finally(() => { auditBtn.disabled = false; });
            }
        });
    }

    // Auto-audit: run silently in the background whenever a non-namespace lump is selected.
    // Passing audits render collapsed; failing ones auto-expand. Controlled by _lumpAutoAuditEnabled.
    if (!isNamespace && _lumpAutoAuditEnabled && typeof lumpAuditFromServer === 'function') {
        const _autoAuditWrap = document.getElementById(`lumpAuditResults_${_tk}`);
        if (_autoAuditWrap) {
            const _autoManifest = { cw: lump.cw, cc: lump.cc, lump_size: lump.lump_size, pet_names: lump.pet_names || null, capabilities: lump.capabilities || [] };
            if (auditBtn) auditBtn.disabled = true;
            lumpAuditFromServer(token, _autoManifest, _autoAuditWrap, { collapsible: true })
                .finally(() => { if (auditBtn) auditBtn.disabled = false; });
        }
    }

    _lumpActiveTab[_tk] = isNamespace ? 'overview' : 'content';
    const nsdgWrap = contentEl.querySelector('.ns-dep-graph-wrap[id]');
    if (nsdgWrap) _initNsDepGraphPanZoom(nsdgWrap.id);
    // For non-namespace lumps the default tab is 'content'; honour any prior/editor tab on top of that
    const _defaultTab = isNamespace ? 'overview' : 'content';
    const restoreTab = (_lumpEditorOpen[_tk] && !isNamespace) ? 'content' : (_prevTab && _prevTab !== 'overview' ? _prevTab : _defaultTab);
    _switchLumpTab(_tk, restoreTab);

    // ── Workspace outer tabs (Logic / Source / Binary) ──────────────────
    if (!isNamespace) {
        const srcEl = document.getElementById('lumpWsSourceContent');
        if (srcEl) srcEl.__sourceLoaded = false;
        _populateLumpLogicTab(lump);
        // Always default to Binary tab when a lump is selected
        _lumpWsActiveTab = 'binary';
        _showLumpWorkspaceTabs();
    } else {
        _hideLumpWorkspaceTabs();
    }
}

async function _fetchAndShowLumpBinary(token, lump) {
    const tk = (token || '').replace(/[^a-z0-9]/gi, '');
    const bodyEl = document.getElementById(`lumpBinBody_${tk}`);
    if (!bodyEl) return;

    const e    = _escHtml;
    const hexw = w => (w >>> 0).toString(16).padStart(8, '0').toUpperCase().replace(/(.{2})/g, '$1 ').trim();
    const pack4ascii = w => {
        let s = '';
        for (let sh = 24; sh >= 0; sh -= 8) {
            const b = (w >>> sh) & 0xFF;
            s += (b >= 32 && b < 127) ? String.fromCharCode(b) : '.';
        }
        return s;
    };

    try {
        const resp = await fetch(`/api/lump/${token}/words`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data  = await resp.json();
        const words = data.words || [];
        const numWords = words.length;

        const cw       = parseInt(lump.cw)        || 0;
        const cc       = parseInt(lump.cc)        || 0;
        const lumpSize = parseInt(lump.lump_size) || numWords;
        if (!numWords) throw new Error('Empty lump');

        const COLS = 8;
        const rowCount = Math.ceil(numWords / COLS);

        let t = '<table class="lump-hex-table lump-hex-table-wide"><thead><tr>'
            + '<th>Addr</th>';
        for (let c = 0; c < COLS; c++) t += `<th>+${c}</th>`;
        t += '<th>Pack4 ASCII</th></tr></thead><tbody>';

        for (let row = 0; row < rowCount; row++) {
            const baseIdx  = row * COLS;
            const baseAddr = (baseIdx * 4).toString(16).toUpperCase().padStart(6, '0');
            let rowHex  = '';
            let rowAsc  = '';
            let rowClass = '';
            if (baseIdx === 0)                   rowClass = 'lump-hex-hdr-row';
            else if (baseIdx >= lumpSize - cc && cc > 0) rowClass = 'lump-hex-clist-row';
            else if (baseIdx >= cw + 1)          rowClass = 'lump-hex-pad-row';

            for (let c = 0; c < COLS; c++) {
                const i = baseIdx + c;
                if (i < numWords) {
                    rowHex += `<td>${hexw(words[i])}</td>`;
                    rowAsc += pack4ascii(words[i]);
                } else {
                    rowHex += '<td class="lump-hex-empty"></td>';
                }
            }
            t += `<tr class="${rowClass}"><td class="lump-hex-addr">0x${baseAddr}</td>${rowHex}`;
            t += `<td class="lump-hex-ascii">${e(rowAsc)}</td></tr>`;
        }

        if (lumpSize !== numWords) {
            t += `<tr class="lump-hex-region-row"><td colspan="${COLS + 2}" style="color:#f59e0b">`
               + `\u26a0 Metadata lump_size=${lumpSize}w but /words returned ${numWords}w`
               + `</td></tr>`;
        }

        t += '</tbody></table>';
        bodyEl.innerHTML = t;
        bodyEl.className = '';

    } catch (err) {
        bodyEl.textContent = `Failed to load hex dump: ${err.message}`;
    }
}

// Set to false to disable the automatic audit that runs whenever a lump is selected.
let _lumpAutoAuditEnabled = true;

const _lumpActiveTab      = {};
const _lumpContentLoaded  = {};
const _lumpHexLoaded      = {};
const _lumpTokensLoaded   = {};
const _lumpEditorOpen     = {};
const _lumpEditorDraftText = {};

// ── Workspace outer tabs (Logic / Source / Binary) ────────────────────────

let _lumpWsActiveTab = 'binary';

function switchLumpWsTab(tab) {
    _lumpWsActiveTab = tab;
    const tabs = ['logic', 'source', 'binary'];
    for (const t of tabs) {
        const btn = document.getElementById(`lumpWsTab-${t}`);
        const panel = document.getElementById(`lumpWsPanel-${t}`);
        if (btn) btn.classList.toggle('lump-ws-tab-active', t === tab);
        if (panel) {
            panel.classList.toggle('lump-ws-panel-active', t === tab);
            panel.style.display = (t === tab) ? 'block' : 'none';
        }
    }
    if (tab === 'logic' && !_selectedLumpToken) {
        _populateLumpLogicCatalog();
    }
    if (tab === 'source' && _selectedLumpToken) {
        const lump = _lumpsCache.find(l => l.token === _selectedLumpToken);
        if (lump && !document.getElementById('lumpWsSourceContent').__sourceLoaded) {
            _populateLumpSourceTab(lump);
        }
    }
}

function _showLumpWorkspaceTabs() {
    const bar = document.getElementById('lumpWsTabBar');
    if (bar) bar.style.display = 'flex';
    switchLumpWsTab(_lumpWsActiveTab);
}

function _hideLumpWorkspaceTabs() {
    const bar = document.getElementById('lumpWsTabBar');
    if (bar) bar.style.display = 'none';
    ['logic','source','binary'].forEach(t => {
        const panel = document.getElementById(`lumpWsPanel-${t}`);
        if (panel) panel.style.display = t === 'binary' ? 'block' : 'none';
    });
}

function _populateLumpLogicCatalog() {
    const el = document.getElementById('lumpWsLogicContent');
    if (!el) return;
    if (typeof abstractionRegistry === 'undefined' || !abstractionRegistry) {
        el.innerHTML = '<div class="lump-logic-section"><div class="lump-logic-desc">Abstraction catalog not loaded.</div></div>';
        return;
    }
    const layerNames = abstractionRegistry.getLayerNames ? abstractionRegistry.getLayerNames() : {};
    let html = '<div class="lump-logic-catalog-header">Logic Catalog &mdash; double-click any entry to jump to its LUMP</div>';
    for (let layer = 0; layer <= 8; layer++) {
        const abstractions = abstractionRegistry.getLayer ? abstractionRegistry.getLayer(layer) : [];
        if (!abstractions || abstractions.length === 0) continue;
        const layerName = layerNames[layer] || `Layer ${layer}`;
        html += `<div class="abs-layer-group">`;
        html += `<div class="abs-layer-header"><span class="abs-layer-title">Layer ${layer} \u2014 ${layerName}</span>`;
        html += `<span class="abs-layer-count">(${abstractions.length})</span></div>`;
        html += `<div class="abs-layer-items">`;
        for (const abs of abstractions) {
            const best = (typeof _implStatusBest === 'function') ? _implStatusBest(abs) : 'pseudo';
            const dotColor = (typeof IMPL_STATUS_COLORS !== 'undefined') ? (IMPL_STATUS_COLORS[best] || '#9ca3af') : '#9ca3af';
            const dotTitle = (typeof IMPL_STATUS_LABELS !== 'undefined') ? (IMPL_STATUS_LABELS[best] || best) : best;
            const absProfile = (typeof _getAbstractionProfile === 'function') ? _getAbstractionProfile(abs) : 'IoT';
            const profileBadgeClass = absProfile === 'Full' ? 'profile-badge-full' : 'profile-badge-iot';
            html += `<div class="abs-item" onclick="showAbstractionDetail(${abs.index})" ondblclick="event.stopPropagation();_goToLumpByAbstractionName(abstractionRegistry.getAbstraction(${abs.index}).name)" title="Double-click to jump to this abstraction\u2019s LUMP in the Repository">`;
            html += `<span class="abs-item-idx">${abs.index}</span>`;
            html += `<span class="abs-item-name">${abs.name}</span>`;
            html += `<span class="abs-profile-badge ${profileBadgeClass}">${absProfile}</span>`;
            html += `<span class="abs-item-dot" style="background:${dotColor};box-shadow:0 0 4px ${dotColor}80" title="${dotTitle}"></span>`;
            html += `<span class="abs-item-desc">${abs.description}</span>`;
            html += `</div>`;
        }
        html += `</div></div>`;
    }
    el.innerHTML = html;
}

function _populateLumpLogicTab(lump) {
    const el = document.getElementById('lumpWsLogicContent');
    if (!el) return;
    const e = _escHtml;
    const absName = lump.abstraction || '';
    const abs = (typeof abstractionRegistry !== 'undefined' && abstractionRegistry)
        ? (() => {
            if (!abstractionRegistry.abstractions) return null;
            return Object.values(abstractionRegistry.abstractions).find(a => a.name === absName) || null;
          })()
        : null;

    if (!abs) {
        const methods = lump.methods || [];
        const caps = lump.capabilities || [];
        let html = '<div class="lump-logic-section">';
        html += `<div class="lump-logic-layer-badge">No logic metadata</div>`;
        html += `<div class="lump-logic-desc">No abstraction catalog entry found for <strong>${e(absName || 'this lump')}</strong>. Showing binary-derived interface below.</div>`;
        html += '</div>';
        const realMethods = methods.filter(m => !m.aliasOf);
        if (realMethods.length > 0) {
            html += '<div class="lump-logic-section">';
            html += `<div class="lump-logic-methods-title">Methods (from binary)</div>`;
            for (const m of realMethods) {
                html += `<div class="lump-logic-method-row"><span class="lump-logic-method-name">${e(m.name)}</span></div>`;
            }
            html += '</div>';
        }
        if (caps.length > 0) {
            html += '<div class="lump-logic-section">';
            html += `<div class="lump-logic-methods-title">Capabilities</div>`;
            html += `<div class="lump-logic-caps-list">`;
            for (const c of caps) {
                html += `<span class="lump-logic-cap-chip">${e(c.name)}</span>`;
            }
            html += `</div></div>`;
        }
        html += _lumpBootSeqCodeHtml(lump);
        el.innerHTML = html;
        return;
    }

    const layerNames = abstractionRegistry.getLayerNames ? abstractionRegistry.getLayerNames() : {};
    const layerName = layerNames[abs.layer] || `Layer ${abs.layer}`;
    const profile = (typeof _getAbstractionProfile === 'function') ? _getAbstractionProfile(abs) : (abs.profile || 'IoT');
    const profileClass = profile === 'Full' ? 'profile-badge-full' : 'profile-badge-iot';
    const perms = abs.perms || {};
    const permStr = (perms.B?'B':'')+(perms.R?'R':'')+(perms.W?'W':'')+(perms.X?'X':'')+(perms.L?'L':'')+(perms.S?'S':'')+(perms.E?'E':'') || 'none';

    let html = '<div class="lump-logic-section">';
    html += `<span class="lump-logic-layer-badge">Layer ${abs.layer} \u2014 ${e(layerName)}</span>`;
    html += ` <span class="abs-profile-badge ${profileClass}" style="font-size:0.62rem;">${e(profile)}</span>`;
    if (abs.description) {
        html += `<div class="lump-logic-desc">${e(abs.description)}</div>`;
    }
    if (permStr !== 'none') {
        html += `<div style="margin-top:6px;font-size:0.72rem;color:#6b7280;">Permissions: <code style="color:#88aaee;">${e(permStr)}</code></div>`;
    }
    html += '</div>';

    const _aliasNames = new Set((lump.methods || []).filter(m => m.aliasOf).map(m => m.name));
    const methods = (abs.methods || []).filter(mName => !_aliasNames.has(mName));
    if (methods.length > 0) {
        html += '<div class="lump-logic-section">';
        html += `<div class="lump-logic-methods-title">Methods &mdash; ${methods.length} public</div>`;
        for (const mName of methods) {
            const mKey = `${abs.index}:${mName}`;
            const status = (typeof _implStatusGet === 'function') ? _implStatusGet(mKey) : 'pseudo';
            const statusColor = (typeof IMPL_STATUS_COLORS !== 'undefined') ? (IMPL_STATUS_COLORS[status] || '#6b7280') : '#6b7280';
            const statusLabel = (typeof IMPL_STATUS_SHORT !== 'undefined') ? (IMPL_STATUS_SHORT[status] || status) : status;
            html += `<div class="lump-logic-method-row">`;
            html += `<span class="lump-logic-method-name">${e(mName)}</span>`;
            html += `<span class="lump-logic-method-status" style="background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor}44;">${e(statusLabel)}</span>`;
            html += `</div>`;
        }
        html += '</div>';
    }

    const absCaps = abs.capabilities || [];
    const lumpCaps = lump.capabilities || [];
    const allCaps = absCaps.length > 0 ? absCaps : lumpCaps.map(c => c.name);
    if (allCaps.length > 0) {
        html += '<div class="lump-logic-section">';
        html += `<div class="lump-logic-methods-title">Capabilities</div>`;
        html += `<div class="lump-logic-caps-list">`;
        for (const c of allCaps) {
            const cn = typeof c === 'string' ? c : (c.name || '');
            html += `<span class="lump-logic-cap-chip">${e(cn)}</span>`;
        }
        html += `</div></div>`;
    }

    if (abs.description_long) {
        html += '<div class="lump-logic-section">';
        html += `<div class="lump-logic-methods-title">Notes</div>`;
        html += `<div class="lump-logic-desc">${e(abs.description_long)}</div>`;
        html += '</div>';
    }

    html += _lumpBootSeqCodeHtml(lump);

    el.innerHTML = html;
}

function _lumpBootSeqCodeHtml(lump) {
    const nsSlot = lump.ns_slot !== null && lump.ns_slot !== undefined ? parseInt(lump.ns_slot) : -1;
    if (nsSlot < 0 || nsSlot > 2) return '';
    if (typeof BOOT_SEQ_CODE === 'undefined' || BOOT_SEQ_CODE[nsSlot] === undefined) return '';
    const code = BOOT_SEQ_CODE[nsSlot];
    const rendered = (typeof _annotateAbsCodeHtml === 'function') ? _annotateAbsCodeHtml(code) : code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return '<div class="lump-logic-section">' +
        '<details class="lump-boot-code-details" open>' +
        '<summary class="lump-logic-methods-title lump-boot-code-summary">Boot Sequence Pseudocode</summary>' +
        '<div class="abs-boot-code-desc" style="margin:4px 0 6px;">Installed implementation \u2014 executed by the STEP controller at power-on reset.</div>' +
        `<pre class="abs-method-panel-code abs-boot-code-pre">${rendered}</pre>` +
        '</details>' +
        '</div>';
}

function _isRawISASource(src) {
    // RAW ISA signals are checked first and take absolute priority.
    // A file like WordString.cloomc uses CLOOMC abstraction structure but annotates
    // every method with [RAW ISA] and inline hex opcodes — it must be treated as raw.

    // [RAW ISA] method annotation (e.g. "public method Foo [RAW ISA] {")
    const hasRawAnnotation = /\[RAW\s+ISA\]/i.test(src);
    // RAW_ISA keyword or bare "RAW ISA" phrase
    const hasRawMarker = /\b(RAW_ISA|RAW\s+ISA)\b/.test(src);
    // Low-level MACRO definitions
    const hasMacroPattern = /^\s*MACRO\s+[A-Z]/m.test(src);
    // Bare hex opcode lines (8 hex digits preceded only by whitespace)
    const hasHexOpcodes = /^\s+[0-9a-fA-F]{8}\b/m.test(src);
    // Bare ISA instruction names that would not appear in functional CLOOMC++
    const hasISAInstructions = /^\s*(mLoad|mSave|ELOADCALL|XLOADLAMBDA|TPERM|LAMBDA)\b/m.test(src);

    // Any RAW ISA signal makes the whole file binary-only, regardless of CLOOMC scaffolding
    return hasRawAnnotation || hasRawMarker || hasMacroPattern || hasHexOpcodes || hasISAInstructions;
}

async function _populateLumpSourceTab(lump) {
    const el = document.getElementById('lumpWsSourceContent');
    if (!el) return;
    el.__sourceLoaded = true;
    const absName = lump.abstraction || '';
    const e = _escHtml;

    el.innerHTML = `<div class="lump-source-status">Loading source\u2026</div>`;

    const _showBinaryOnly = (reason) => {
        const displayName = absName || lump.token || 'This lump';
        const fileHint = absName ? `<code>${e(absName)}.cloomc</code>` : 'a named <code>.cloomc</code> source file';
        el.innerHTML = `<div class="lump-source-binary-only">
            <div class="lump-source-binary-only-icon">&#128190;</div>
            <div class="lump-source-binary-only-title">Binary-only &mdash; no functional source available</div>
            <div class="lump-source-binary-only-desc">
                <strong>${e(displayName)}</strong> ${reason}<br><br>
                To add functional source, author ${fileHint} using
                pet-name mechanics (capability registers as named variables, Lambda/Macro
                constructs as building blocks) and place it in <code>simulator/cloomc/</code>.
            </div>
        </div>`;
    };

    // No abstraction name → no source file can exist; show binary-only notice immediately
    if (!absName) {
        _showBinaryOnly('has no associated abstraction name, so no CLOOMC++ source can be located.');
        return;
    }

    try {
        const resp = await fetch(`/api/lump-source/${encodeURIComponent(absName)}`);
        const ct = resp.headers.get('content-type') || '';
        if (!ct.includes('application/json')) {
            _showBinaryOnly('has no functional CLOOMC++ source on file. The Binary tab shows the compiled form.');
            return;
        }
        const data = await resp.json();

        if (resp.ok && !data.binary_only && data.source) {
            const src = data.source;
            if (_isRawISASource(src)) {
                _showBinaryOnly('was compiled from RAW ISA or low-level assembly and has no CLOOMC++ pet-name source. The Binary tab shows the compiled form.');
                return;
            }
            let html = '<div class="lump-source-toolbar">';
            html += `<span class="lump-source-lang-badge">CLOOMC++</span>`;
            html += `<div class="lump-source-ham-wrap">`;
            html += `<button class="lump-source-ham-btn" onclick="_toggleLumpMenu(this)" title="Editor actions">&#9776;</button>`;
            html += `<div class="lump-source-menu">`;
            html += `<button class="lump-source-menu-item" onclick="document.querySelectorAll('.lump-source-menu.open').forEach(m=>m.classList.remove('open'));_lumpSourceDraft()" title="Draft \u2014 Show structural layout without building binary">Draft</button>`;
            html += `<button class="lump-source-menu-item lump-source-menu-item-build" onclick="document.querySelectorAll('.lump-source-menu.open').forEach(m=>m.classList.remove('open'));_lumpSourceBuildLump()" title="Build LUMP \u2014 Compile and download .lump binary">Build LUMP &#8595;</button>`;
            html += `</div></div>`;
            html += `<button class="lump-source-btn" onclick="_lumpSourceCompile()" title="Compile \u2014 Compile source and update Binary tab">&#9654; Compile</button>`;
            html += '</div>';
            html += `<textarea class="lump-source-textarea" id="lumpSourceEditor" spellcheck="false" autocorrect="off" autocapitalize="off">${e(src)}</textarea>`;
            html += `<div class="lump-source-status" id="lumpSourceStatus"></div>`;
            el.innerHTML = html;
        } else {
            _showBinaryOnly('was compiled from RAW ISA or assembly and has no CLOOMC++ pet-name source on file. The Binary tab shows the compiled form.');
        }
    } catch (err) {
        el.innerHTML = `<div class="lump-source-status err">Error loading source: ${e(err.message)}</div>`;
    }
}

function _lumpSourceProxyEdit(fn) {
    const editor = document.getElementById('lumpSourceEditor');
    if (!editor) return false;
    const asmEd = document.getElementById('asmEditor');
    if (!asmEd) return false;
    const prev = asmEd.value;
    asmEd.value = editor.value;
    try { fn(); } finally { asmEd.value = prev; }
    return true;
}

function _toggleLumpMenu(btn) {
    const menu = btn.parentElement.querySelector('.lump-source-menu');
    if (!menu) return;
    const isOpen = menu.classList.contains('open');
    document.querySelectorAll('.lump-source-menu.open').forEach(m => m.classList.remove('open'));
    if (!isOpen) {
        menu.classList.add('open');
        const closeHandler = (e) => {
            if (!btn.parentElement.contains(e.target)) {
                menu.classList.remove('open');
                document.removeEventListener('click', closeHandler, true);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler, true), 0);
    }
}

function _lumpSourceCompile() {
    const status = document.getElementById('lumpSourceStatus');
    if (status) { status.textContent = 'Compiling\u2026'; status.className = 'lump-source-status'; }
    try {
        const editor = document.getElementById('lumpSourceEditor');
        if (!editor) return;
        const src = editor.value;

        if (typeof cloomcCompiler === 'undefined' || !cloomcCompiler) {
            if (status) { status.textContent = 'Compiler not available.'; status.className = 'lump-source-status err'; }
            return;
        }

        const result = cloomcCompiler.compile(src, []);

        if (result.errors && result.errors.length > 0) {
            const errText = result.errors.map(err => `Line ${err.line || '?'}: ${err.message}`).join('\n');
            if (status) { status.textContent = `Compile failed \u2014 ${result.errors.length} error(s).`; status.className = 'lump-source-status err'; }
            _lumpSourceShowCompiledBinary(null, errText);
            switchLumpWsTab('binary');
            return;
        }

        if (status) { status.textContent = 'Compiled \u2014 Binary tab updated.'; status.className = 'lump-source-status ok'; }
        _lumpSourceShowCompiledBinary(result, null);
        switchLumpWsTab('binary');

    } catch (err) {
        if (status) { status.textContent = `Compile error: ${err.message}`; status.className = 'lump-source-status err'; }
    }
}

function _lumpSourceShowCompiledBinary(result, errText) {
    const contentEl = document.getElementById('lumpsDetailContent');
    if (!contentEl) return;
    const e = _escHtml;
    const hexw = w => (w >>> 0).toString(16).padStart(8, '0').toUpperCase().replace(/(.{2})/g, '$1 ').trim();

    let inner = '';
    if (errText) {
        inner = `<pre class="lscb-error">${e(errText)}</pre>`;
    } else {
        let totalWords = 0;
        let methodsHtml = '';
        for (const m of (result.methods || [])) {
            if (m.aliasOf) {
                methodsHtml += `<div class="lscb-method"><span class="lscb-method-name">${e(m.name)}</span>`
                    + ` <span class="lscb-alias">\u2192 alias of ${e(m.aliasOf)}</span></div>`;
                continue;
            }
            const code = m.code || [];
            totalWords += code.length;
            let wordsHtml = '';
            for (let i = 0; i < code.length; i++) {
                wordsHtml += `<span class="lscb-word" title="word ${i}">${hexw(code[i])}</span>`;
            }
            methodsHtml += `<div class="lscb-method">`
                + `<span class="lscb-method-name">${e(m.name)}</span>`
                + ` <span class="lscb-word-count">${code.length}w</span>`
                + `<div class="lscb-words">${wordsHtml || '<em style="color:#6b7280">no code words</em>'}</div></div>`;
        }
        const absName = result.abstractionName || '(unnamed)';
        const mCount = (result.methods || []).filter(m => !m.aliasOf).length;
        const lang = result.language || 'cloomc';
        const tok = _selectedLumpToken ? `&nbsp;\u2014&nbsp;<a class="lscb-back" href="#" onclick="event.preventDefault();showLumpDetail('${e(_selectedLumpToken)}')">&#8592; Show saved lump</a>` : '';
        inner = `<div class="lscb-header">`
            + `<span class="lscb-abs">${e(absName)}</span>`
            + ` <span class="lscb-stat">${mCount} method${mCount !== 1 ? 's' : ''}</span>`
            + ` <span class="lscb-stat">${totalWords} code word${totalWords !== 1 ? 's' : ''}</span>`
            + ` <span class="lscb-lang">${e(lang)}</span>`
            + tok
            + `</div>`
            + `<div class="lscb-methods">${methodsHtml || '<em style="padding:8px;display:block;color:#6b7280;">No methods compiled.</em>'}</div>`;
    }

    const titleText = errText ? '\u26A0 Compile Errors' : '\u25BA Compiled Binary \u2014 In-Memory (unsaved)';
    const titleClass = errText ? 'lump-source-compile-result-title lscb-title-err' : 'lump-source-compile-result-title';
    contentEl.innerHTML = `<div class="lump-source-compile-result" id="lumpSourceCompileResult">`
        + `<div class="${titleClass}">${titleText}</div>`
        + inner
        + `</div>`;
}

function _lumpSourceDraft() {
    const status = document.getElementById('lumpSourceStatus');
    if (status) { status.textContent = 'Drafting\u2026'; status.className = 'lump-source-status'; }
    try {
        if (typeof compileDraft === 'function') {
            _lumpSourceProxyEdit(() => compileDraft());
        }
        if (status) { status.textContent = 'Draft complete \u2014 see Programs console.'; status.className = 'lump-source-status ok'; }
    } catch (err) {
        if (status) { status.textContent = `Draft error: ${err.message}`; status.className = 'lump-source-status err'; }
    }
}

function _lumpSourceBuildLump() {
    const editor = document.getElementById('lumpSourceEditor');
    const status = document.getElementById('lumpSourceStatus');
    if (!editor) return;
    const src = editor.value;
    if (status) { status.textContent = 'Building\u2026'; status.className = 'lump-source-status'; }
    try {
        const asmEd = document.getElementById('asmEditor');
        if (asmEd && typeof buildAndDownloadLump === 'function') {
            const prev = asmEd.value;
            asmEd.value = src;
            buildAndDownloadLump();
            asmEd.value = prev;
        }
        if (status) { status.textContent = 'Build triggered. Check Programs view.'; status.className = 'lump-source-status ok'; }
    } catch (err) {
        if (status) { status.textContent = `Build error: ${err.message}`; status.className = 'lump-source-status err'; }
    }
}

function _lumpContentTypeLabel(lump) {
    const ct = (lump.content_type || '').toLowerCase();
    const lt = (lump.lump_type   || '').toLowerCase();
    const typ = lump.typ;
    if (lt === 'namespace' || typ === 10) return 'Namespace';
    if (ct === 'text')                    return 'Text';
    if (ct === 'markdown')                return 'Markdown';
    if (ct === 'image')                   return 'Image';
    if (ct === 'grayscale')               return 'Grayscale Image';
    if (ct === 'doc')                     return 'Document';
    if (ct === 'thread' || typ === 2)     return 'Thread';
    if (ct === 'outform' || typ === 3)    return 'Outform';
    if (ct === 'inform')                  return 'Inform';
    if (ct === 'code'    || typ === 0)    return 'Code';
    if (ct === 'data' || ct === 'binary' || typ === 1) return 'Data';
    return 'LUMP';
}

function _lumpTypeBadge(lump) {
    const ct = (lump.content_type || '').toLowerCase();
    const lt = (lump.lump_type   || '').toLowerCase();
    const typ = lump.typ;
    if (lt === 'boot')                                 return '<span class="lump-ct-badge lump-ct-boot">BOOT</span>';
    if (lt === 'namespace' || typ === 10)              return '<span class="lump-ct-badge lump-ct-ns">NS</span>';
    if (ct === 'text')                                 return '<span class="lump-ct-badge lump-ct-text">TXT</span>';
    if (ct === 'markdown')                             return '<span class="lump-ct-badge lump-ct-md">MD</span>';
    if (ct === 'image')                                return '<span class="lump-ct-badge lump-ct-img">IMG</span>';
    if (ct === 'grayscale')                            return '<span class="lump-ct-badge lump-ct-img">GS</span>';
    if (ct === 'doc')                                  return '<span class="lump-ct-badge lump-ct-doc">DOC</span>';
    if (ct === 'thread' || typ === 2)                  return '<span class="lump-ct-badge lump-ct-thread">THR</span>';
    if (typ === 3 || ct === 'outform')                 return '<span class="lump-ct-badge lump-ct-outform">OTF</span>';
    if (ct === 'inform')                               return '<span class="lump-ct-badge lump-ct-inform">INF</span>';
    if (ct === 'code'   || typ === 0)                  return '<span class="lump-ct-badge lump-ct-code">CODE</span>';
    if (ct === 'data' || ct === 'binary' || typ === 1) return '<span class="lump-ct-badge lump-ct-data">DATA</span>';
    return '';
}

function _switchLumpTab(tk, tab) {
    _lumpActiveTab[tk] = tab;
    const tabMap = { overview: `lumpTabOverview_${tk}`, content: `lumpTabContent_${tk}`, tokens: `lumpTabTokens_${tk}`, hexdump: `lumpTabHexdump_${tk}` };
    Object.entries(tabMap).forEach(([t, id]) => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('lump-tab-panel-active', t === tab);
    });
    const bar = document.getElementById(`lumpTabBar_${tk}`);
    if (bar) {
        const btns = bar.querySelectorAll('.lump-tab');
        btns.forEach(btn => {
            const labelMap = { overview: 'Overview', content: 'Content', tokens: 'Tokens', hexdump: 'Hex Dump' };
            btn.classList.toggle('lump-tab-active', btn.textContent.trim() === labelMap[tab]);
        });
    }
    const lump = _lumpsCache.find(l => (l.token || '').replace(/[^a-z0-9]/gi, '') === tk);
    const token = lump ? lump.token : tk;
    if (tab === 'content' && !_lumpContentLoaded[tk] && lump) {
        _lumpContentLoaded[tk] = true;
        _loadLumpContent(token, lump);
    }
    if (tab === 'tokens' && !_lumpTokensLoaded[tk] && lump) {
        _lumpTokensLoaded[tk] = true;
        _loadLumpTokens(token, lump);
    }
    if (tab === 'hexdump' && !_lumpHexLoaded[tk] && lump) {
        _lumpHexLoaded[tk] = true;
        _fetchAndShowLumpBinary(token, lump);
    }
}

function _pack4Decode(words) {
    const bytes = new Uint8Array(words.length * 4);
    let bi = 0;
    for (const w of words) {
        bytes[bi++] = (w >>> 24) & 0xFF;
        bytes[bi++] = (w >>> 16) & 0xFF;
        bytes[bi++] = (w >>>  8) & 0xFF;
        bytes[bi++] =  w         & 0xFF;
    }
    // Strip trailing nulls
    let end = bytes.length;
    while (end > 0 && bytes[end - 1] === 0) end--;
    const td = new TextDecoder('utf-8', { fatal: false });
    return td.decode(bytes.subarray(0, end));
}

async function _saveLumpText(token, text, bodyEl, lump) {
    const saveBtn = bodyEl.querySelector('.lump-edit-save-btn');
    const statusEl = bodyEl.querySelector('.lump-edit-status');
    if (saveBtn) saveBtn.disabled = true;
    if (statusEl) statusEl.textContent = 'Saving\u2026';
    try {
        const resp = await fetch(`/api/lump/${token}/content`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
        });
        const result = await resp.json();
        if (!resp.ok) throw new Error(result.error || `HTTP ${resp.status}`);
        _lumpEditDirty = false;
        const _tk = token.replace(/[^a-z0-9]/gi, '');
        _lumpEditorOpen[_tk] = false;
        delete _lumpEditorDraftText[_tk];
        _draftLsDel(_tk);
        if (statusEl) { statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--accent-green, #4caf50)'; }
        setTimeout(() => _loadLumpContent(token, lump), 800);
    } catch (err) {
        if (statusEl) { statusEl.textContent = `Error: ${err.message}`; statusEl.style.color = 'var(--red, #e53935)'; }
        if (saveBtn) saveBtn.disabled = false;
    }
}

function _toggleLumpMetaEdit(metaId) {
    const displayEl = document.getElementById(metaId + '_display');
    const formEl    = document.getElementById(metaId + '_form');
    if (!displayEl || !formEl) return;
    const isOpen = formEl.style.display !== 'none';
    displayEl.style.display = isOpen ? '' : 'none';
    formEl.style.display    = isOpen ? 'none' : '';
    const statusEl = document.getElementById(metaId + '_status');
    if (statusEl) { statusEl.textContent = ''; statusEl.style.color = ''; }
}

async function _saveLumpMeta(token, metaId) {
    const authorEl  = document.getElementById(metaId + '_author');
    const versionEl = document.getElementById(metaId + '_version');
    const statusEl  = document.getElementById(metaId + '_status');
    const saveBtn   = document.querySelector(`#${metaId}_form .lump-edit-save-btn`);
    if (!authorEl || !versionEl) return;
    const author  = authorEl.value.trim();
    const version = versionEl.value.trim();
    if (saveBtn) saveBtn.disabled = true;
    if (statusEl) { statusEl.textContent = 'Saving\u2026'; statusEl.style.color = ''; }
    try {
        const resp = await fetch(`/api/lump/${token}/meta`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ author, version }),
        });
        const result = await resp.json();
        if (!resp.ok) throw new Error(result.error || `HTTP ${resp.status}`);
        const lump = _lumpsCache.find(l => l.token === token);
        if (lump) { lump.author = author; lump.version = version; }
        if (statusEl) { statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--accent-green, #4caf50)'; }
        if (saveBtn) saveBtn.disabled = false;
        const displayEl = document.getElementById(metaId + '_display');
        if (displayEl) {
            const tds = displayEl.querySelectorAll('td:last-child');
            const e = _escHtml;
            if (tds[0]) tds[0].innerHTML = author ? e(author) : '<span style="color:var(--text-secondary);font-style:italic;">not set</span>';
            if (tds[1]) tds[1].innerHTML = version ? e(version) : '<span style="color:var(--text-secondary);font-style:italic;">not set</span>';
        }
    } catch (err) {
        if (statusEl) { statusEl.textContent = `Error: ${err.message}`; statusEl.style.color = 'var(--red, #e53935)'; }
        if (saveBtn) saveBtn.disabled = false;
    }
}

const _DRAFT_LS_PREFIX = 'cm_lump_draft_';
function _draftLsKey(tk)  { return _DRAFT_LS_PREFIX + tk; }
function _draftLsGet(tk)  { try { return localStorage.getItem(_draftLsKey(tk)); } catch(_) { return null; } }
function _draftLsSet(tk, v) { try { localStorage.setItem(_draftLsKey(tk), v); } catch(_) {} }
function _draftLsDel(tk)  { try { localStorage.removeItem(_draftLsKey(tk)); } catch(_) {} }

function _buildTextEditor(token, text, bodyEl, lump, renderFn) {
    const tk = token.replace(/[^a-z0-9]/gi, '');
    const hasDraft = Object.prototype.hasOwnProperty.call(_lumpEditorDraftText, tk);
    const lsDraft  = _draftLsGet(tk);
    const hasLsDraft = lsDraft !== null && lsDraft !== text;
    const initialText = hasDraft ? _lumpEditorDraftText[tk] : text;
    const startOpen   = !!_lumpEditorOpen[tk];

    const wrapper = document.createElement('div');
    wrapper.className = 'lump-edit-wrapper';

    const toolbar = document.createElement('div');
    toolbar.className = 'lump-edit-toolbar';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn lump-edit-btn';
    editBtn.textContent = 'Edit';
    toolbar.appendChild(editBtn);
    wrapper.appendChild(toolbar);

    const preview = document.createElement('div');
    preview.className = 'lump-edit-preview';
    renderFn(preview, text);
    wrapper.appendChild(preview);

    const editorArea = document.createElement('div');
    editorArea.className = 'lump-edit-area';
    editorArea.style.display = 'none';

    if (hasLsDraft) {
        const restoreBanner = document.createElement('div');
        restoreBanner.className = 'lump-draft-restore-banner';
        restoreBanner.innerHTML =
            '<span>Unsaved draft found from a previous session.</span>' +
            '<button class="btn btn-sm lump-draft-restore-btn">Restore draft</button>' +
            '<button class="btn btn-sm lump-draft-discard-btn">Discard</button>';
        const restoreBtn  = restoreBanner.querySelector('.lump-draft-restore-btn');
        const discardBtn2 = restoreBanner.querySelector('.lump-draft-discard-btn');
        restoreBtn.addEventListener('click', () => {
            ta.value = lsDraft;
            _lumpEditorDraftText[tk] = lsDraft;
            livePreview.innerHTML = '';
            renderFn(livePreview, lsDraft);
            restoreBanner.remove();
        });
        discardBtn2.addEventListener('click', () => {
            _draftLsDel(tk);
            restoreBanner.remove();
        });
        editorArea.appendChild(restoreBanner);
    }

    const splitPane = document.createElement('div');
    splitPane.className = 'lump-edit-split';

    const leftPane = document.createElement('div');
    leftPane.className = 'lump-edit-split-left';

    const ta = document.createElement('textarea');
    ta.className = 'lump-edit-textarea';
    ta.value = initialText;
    ta.spellcheck = false;
    leftPane.appendChild(ta);
    splitPane.appendChild(leftPane);

    const divider = document.createElement('div');
    divider.className = 'lump-edit-split-divider';
    splitPane.appendChild(divider);

    const rightPane = document.createElement('div');
    rightPane.className = 'lump-edit-split-right';
    const livePreview = document.createElement('div');
    livePreview.className = 'lump-edit-live-preview';
    renderFn(livePreview, initialText);
    rightPane.appendChild(livePreview);
    splitPane.appendChild(rightPane);

    const restoreSplitRatio = (function _initDividerDrag() {
        let startX = 0;
        let startLeftPx = 0;
        const DIVIDER_PX = 6;
        const LS_KEY_GLOBAL = 'lump-edit-split-ratio';
        const contentType = (lump && lump.content_type) ? lump.content_type.toLowerCase() : '';
        const LS_KEY = contentType ? `lump-edit-split-ratio:${contentType}` : LS_KEY_GLOBAL;
        const LS_KEY_LUMP = tk ? `lump-edit-split-ratio:${contentType}:${tk}` : LS_KEY;

        function applyColumns(leftPx) {
            const totalPx = splitPane.offsetWidth - DIVIDER_PX;
            const clamped = Math.max(80, Math.min(totalPx - 80, leftPx));
            const rightPx = totalPx - clamped;
            splitPane.style.gridTemplateColumns = `${clamped}px ${DIVIDER_PX}px ${rightPx}px`;
        }

        function onMouseMove(e) {
            const delta = e.clientX - startX;
            applyColumns(startLeftPx + delta);
        }

        function onMouseUp() {
            divider.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            const totalPx = splitPane.offsetWidth - DIVIDER_PX;
            const ratio = leftPane.offsetWidth / totalPx;
            try { localStorage.setItem(LS_KEY_LUMP, String(ratio)); } catch (_) {}
        }

        divider.addEventListener('mousedown', function (e) {
            e.preventDefault();
            startX = e.clientX;
            startLeftPx = leftPane.offsetWidth;
            divider.classList.add('dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        return function restoreRatio() {
            try {
                let saved = localStorage.getItem(LS_KEY_LUMP);
                if (saved === null && LS_KEY_LUMP !== LS_KEY) {
                    saved = localStorage.getItem(LS_KEY);
                }
                if (saved === null && LS_KEY !== LS_KEY_GLOBAL) {
                    saved = localStorage.getItem(LS_KEY_GLOBAL);
                }
                if (saved !== null) {
                    const ratio = parseFloat(saved);
                    if (isFinite(ratio) && ratio > 0 && ratio < 1) {
                        const totalPx = splitPane.offsetWidth - DIVIDER_PX;
                        applyColumns(Math.round(ratio * totalPx));
                    }
                }
            } catch (_) {}
        };
    })();

    editorArea.appendChild(splitPane);

    const actionRow = document.createElement('div');
    actionRow.className = 'lump-edit-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn lump-edit-save-btn';
    saveBtn.textContent = 'Save';

    const auditEdBtn = document.createElement('button');
    auditEdBtn.className = 'btn lump-audit-btn';
    auditEdBtn.textContent = '\u2699 Audit';
    auditEdBtn.title = 'Audit \u2014 simulate the binary that saving the current text would produce and run structural checks on it';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn lump-edit-cancel-btn';
    cancelBtn.textContent = 'Cancel';

    const statusEl = document.createElement('span');
    statusEl.className = 'lump-edit-status';

    actionRow.appendChild(saveBtn);
    actionRow.appendChild(auditEdBtn);
    actionRow.appendChild(cancelBtn);
    actionRow.appendChild(statusEl);

    const auditResultsWrap = document.createElement('div');
    auditResultsWrap.className = 'lump-audit-inline-wrap';
    actionRow.appendChild(auditResultsWrap);

    editorArea.appendChild(actionRow);

    auditEdBtn.addEventListener('click', () => {
        if (typeof lumpAudit !== 'function' || typeof lumpAuditRenderPanel !== 'function') return;

        // Simulate the exact binary the server would produce via PUT /api/lump/{token}/content.
        // Server logic (app.py put_lump_content): UTF-8 encode → pad to 4 bytes → pack big-endian
        // words → compute n/cw/header → pad to lump_size.
        const _enc      = new TextEncoder();
        const _rawBytes = _enc.encode(ta.value);
        const _padLen   = (_rawBytes.length + 3) & ~3;
        const _padBytes = new Uint8Array(_padLen);
        _padBytes.set(_rawBytes);
        const _dwCount  = _padLen >> 2;
        const _needed   = 1 + _dwCount;
        let _n = Math.max(6, Math.ceil(Math.log2(Math.max(_needed, 2))));
        _n = Math.min(_n, 14);
        const _lumpSize = 1 << _n;
        const _cw = Math.min(_dwCount, _lumpSize - 1);
        const _header = ((0x1F << 27) | ((_n - 6) << 23) | (_cw << 10) | (0x01 << 8)) >>> 0;
        const _words = new Array(_lumpSize).fill(0);
        _words[0] = _header;
        const _dv = new DataView(_padBytes.buffer);
        for (let _i = 0; _i < _dwCount && (1 + _i) < _lumpSize; _i++) {
            _words[1 + _i] = _dv.getUint32(_i * 4, false) >>> 0;
        }

        const _auditResults  = lumpAudit(_words, { cw: _cw, cc: 0, lump_size: _lumpSize });
        const _hasErrors     = lumpAuditHasErrors(_auditResults);
        const _hasWarnings   = lumpAuditHasWarnings(_auditResults);

        auditResultsWrap.innerHTML = '';
        lumpAuditRenderPanel(auditResultsWrap, _auditResults, { collapsible: true, startOpen: true });

        saveBtn.disabled = _hasErrors;
        if (_hasErrors) {
            statusEl.textContent = 'Fix audit errors before saving.';
            statusEl.style.color = 'var(--red, #e53935)';
        } else if (_hasWarnings) {
            statusEl.textContent = 'Warnings found \u2014 save with care.';
            statusEl.style.color = '#e0a055';
        } else {
            statusEl.textContent = '';
        }
    });

    // When content changes after a failed audit, keep Save disabled but prompt re-audit.
    ta.addEventListener('input', () => {
        if (saveBtn.disabled) {
            statusEl.textContent = 'Content changed \u2014 re-run Audit before saving.';
            statusEl.style.color = '#e0a055';
        }
    }, { passive: true });
    wrapper.appendChild(editorArea);

    if (startOpen) {
        editBtn.style.display = 'none';
        preview.style.display = 'none';
        editorArea.style.display = '';
        restoreSplitRatio();
        _lumpEditDirty = true;
    }

    let _debounceTimer = null;
    ta.addEventListener('input', () => {
        _lumpEditorDraftText[tk] = ta.value;
        _draftLsSet(tk, ta.value);
        clearTimeout(_debounceTimer);
        _debounceTimer = setTimeout(() => {
            livePreview.innerHTML = '';
            renderFn(livePreview, ta.value);
        }, 300);
    });

    editBtn.addEventListener('click', () => {
        _lumpEditDirty = true;
        _lumpEditorOpen[tk] = true;
        _draftLsSet(tk, ta.value);
        editBtn.style.display = 'none';
        preview.style.display = 'none';
        editorArea.style.display = '';
        restoreSplitRatio();
        ta.focus();
    });

    cancelBtn.addEventListener('click', () => {
        if (ta.value !== text && !confirm('Discard changes?')) return;
        _lumpEditDirty = false;
        _lumpEditorOpen[tk] = false;
        delete _lumpEditorDraftText[tk];
        _draftLsDel(tk);
        clearTimeout(_debounceTimer);
        ta.value = text;
        livePreview.innerHTML = '';
        renderFn(livePreview, text);
        statusEl.textContent = '';
        editorArea.style.display = 'none';
        preview.style.display = '';
        editBtn.style.display = '';
    });

    saveBtn.addEventListener('click', () => {
        clearTimeout(_debounceTimer);
        _saveLumpText(token, ta.value, wrapper, lump);
    });

    return wrapper;
}

async function _loadLumpContent(token, lump) {
    const tk = token.replace(/[^a-z0-9]/gi, '');
    const bodyEl = document.getElementById(`lumpContentBody_${tk}`);
    if (!bodyEl) return;
    try {
        const resp = await fetch(`/api/lump/${token}/words`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data  = await resp.json();
        const words = data.words || [];
        if (!words.length) throw new Error('Empty lump');
        const ct  = (lump.content_type || '').toLowerCase();
        const typ = lump.typ;
        const dataWords = words.slice(1);
        if (ct === 'code' || typ === 0 || lump.cw > 0) {
            _renderLumpCodeContent(bodyEl, lump, words, token);
        } else if (ct === 'text') {
            const text = _pack4Decode(dataWords);
            bodyEl.innerHTML = '';
            bodyEl.className = '';
            const editor = _buildTextEditor(token, text, bodyEl, lump, (el, t) => {
                const pre = document.createElement('pre');
                pre.className = 'lump-content-text';
                pre.textContent = t || '(empty)';
                el.appendChild(pre);
            });
            bodyEl.appendChild(editor);
        } else if (ct === 'markdown') {
            const text = _pack4Decode(dataWords);
            bodyEl.innerHTML = '';
            bodyEl.className = '';
            const editor = _buildTextEditor(token, text, bodyEl, lump, (el, t) => {
                const md = document.createElement('div');
                md.className = 'lump-content-markdown';
                md.innerHTML = renderMarkdown(t || '');
                el.appendChild(md);
            });
            bodyEl.appendChild(editor);
        } else if (ct === 'image' || ct === 'grayscale') {
            _renderLumpImageContent(bodyEl, lump, dataWords, token);
        } else if (ct === 'thread' || typ === 2) {
            _renderLumpThreadContent(bodyEl, lump, words);
        } else if (ct === 'doc' || ct === 'binary') {
            bodyEl.innerHTML = '';
            bodyEl.className = '';
            const info = document.createElement('div');
            info.style.cssText = 'color:var(--text-secondary);font-size:0.75rem;padding:0.4rem 0;';
            info.textContent = `${ct.toUpperCase()} — ${dataWords.length * 4} bytes stored. Switch to Hex Dump tab to inspect raw words.`;
            bodyEl.appendChild(info);
        } else {
            const text = _pack4Decode(dataWords);
            bodyEl.innerHTML = '';
            bodyEl.className = '';
            const pre = document.createElement('pre');
            pre.className = 'lump-content-text';
            pre.textContent = text || '(no decodable content)';
            bodyEl.appendChild(pre);
        }
    } catch (err) {
        bodyEl.className = '';
        bodyEl.innerHTML = '';
        const panel = document.createElement('div');
        panel.className = 'lump-content-error-panel';

        const diagMsg = (() => {
            const m = err.message || '';
            if (m.includes('token') && m.includes('not defined')) return 'The lump is missing a valid token — check that it has been saved correctly.';
            if (m.includes('Empty lump'))   return 'This lump has no content words yet. Compile or upload content to populate it.';
            if (m.includes('HTTP 404'))     return 'The lump could not be found on the server — it may have been deleted or its token is wrong.';
            if (m.includes('HTTP 4') || m.includes('HTTP 5')) return 'The server returned an error when fetching this lump.';
            return 'An unexpected error occurred while rendering this lump.';
        })();

        panel.innerHTML =
            `<div class="lcep-icon">\u26a0\ufe0f</div>` +
            `<div class="lcep-headline">Could not load lump content</div>` +
            `<div class="lcep-desc">${_escHtml(diagMsg)}</div>` +
            `<div class="lcep-detail">${_escHtml(err.message)}</div>` +
            `<div class="lcep-actions">` +
                `<button class="btn lcep-btn" onclick="_switchLumpTab('${tk}','overview')" title="Go to Overview to check or edit metadata">&#9998; Edit Metadata</button>` +
                `<button class="btn lcep-btn" onclick="_switchLumpTab('${tk}','hexdump')" title="View raw hex words">&#9727; Hex Dump</button>` +
                `<button class="btn lcep-btn" onclick="_lumpContentLoaded['${tk}']=false;_switchLumpTab('${tk}','content')" title="Try loading again">&#8635; Retry</button>` +
            `</div>`;
        bodyEl.appendChild(panel);
    }
}

// ── Comment colorizer ─────────────────────────────────────────────────────
// Converts a plain-text auto-comment into HTML with semantic colour spans:
//   .lump-com-pet  → capability/pet names  (red)
//   .lump-com-dr   → DR data registers     (green)
//   .lump-com-cr   → CR cap registers      (yellow)
function _colorizeComment(text) {
    const _h = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const _ccLong = {EQ:'Equal',NE:'Not Equal',CS:'Carry Set',CC:'Carry Clear',MI:'Minus',PL:'Plus',VS:'Overflow Set',VC:'Overflow Clear',HI:'Higher',LS:'Lower or Same',GE:'Greater or Equal',LT:'Less Than',GT:'Greater Than',LE:'Less or Equal',AL:'Always',NV:'Never'};
    let out = '';
    let i   = 0;
    while (i < text.length) {
        // Quoted pet name  "LED0" / "myAbstraction" / …  — strip quotes, color the inner name
        if (text[i] === '"') {
            const end = text.indexOf('"', i + 1);
            if (end !== -1) {
                out += `<span class="lump-com-pet">${_h(text.slice(i + 1, end))}</span>`;
                i = end + 1;
                continue;
            }
        }
        // Unquoted device-class pet name from DREAD/DWRITE: LED0, UART0, Button0, Abs[2], Dev5[0], …
        // (bracket form LED[N] also accepted for legacy text in docs/comments)
        const devM = text.slice(i).match(/^[A-Z][A-Za-z0-9]*\[\d+\]/);
        if (devM) {
            out += `<span class="lump-com-pet">${_h(devM[0])}</span>`;
            i += devM[0].length;
            continue;
        }
        // M-Elevation abstract GT label
        if (text.slice(i).startsWith('M-Elevation')) {
            out += `<span class="lump-com-pet">M-Elevation</span>`;
            i += 11;
            continue;
        }
        // DR register  DR0 … DR15
        const drM = text.slice(i).match(/^DR(\d{1,2})\b/);
        if (drM) {
            out += `<span class="lump-com-dr">${drM[0]}</span>`;
            i += drM[0].length;
            continue;
        }
        // CR register  CR0 … CR15  (optional parenthetical: CR14(code))
        const crM = text.slice(i).match(/^CR(\d{1,2})(?:\([^)]*\))?/);
        if (crM) {
            out += `<span class="lump-com-cr">${_h(crM[0])}</span>`;
            i += crM[0].length;
            continue;
        }
        // Condition code abbreviation  EQ NE CS CC MI PL VS VC HI LS GE LT GT LE AL NV
        const ccM = text.slice(i).match(/^(EQ|NE|CS|CC|MI|PL|VS|VC|HI|LS|GE|LT|GT|LE|AL|NV)\b/);
        if (ccM) {
            const abbr = ccM[1];
            out += `<span class="cond-abbr" title="${abbr}\u00A0\u2014\u00A0${_ccLong[abbr]}">${abbr}</span>`;
            i += abbr.length;
            continue;
        }
        // Plain character — HTML-escape
        const c = text[i];
        if      (c === '<') out += '&lt;';
        else if (c === '>') out += '&gt;';
        else if (c === '&') out += '&amp;';
        else                out += c;
        i++;
    }
    return out;
}

function _renderLumpCodeContent(bodyEl, lump, words, token) {
    const e = _escHtml;
    const methods   = lump.methods  || [];
    const cw        = parseInt(lump.cw)        || 0;
    const cc        = parseInt(lump.cc)        || 0;
    const lumpSize  = parseInt(lump.lump_size) || words.length;
    const abstName  = lump.abstraction || 'Lump';

    // Build per-method DR pet-name lookup (numeric key → label).
    // Keys in pet_names.DR are stored as numeric strings ("0", "1", ...).
    const methodDRPetNames = {};  // method name → { drNum: "label" }
    const topLevelDR = ((lump.pet_names || {}).DR) || {};
    for (const m of methods) {
        const own = ((m.pet_names || {}).DR) || {};
        if (Object.keys(own).length > 0) {
            const numMap = {};
            for (const [k, v] of Object.entries(own)) numMap[parseInt(k)] = v;
            methodDRPetNames[m.name] = numMap;
        } else if (Object.keys(topLevelDR).length > 0) {
            // Fall back to top-level pet_names.DR (prefix stripped: "DR0" → 0)
            const numMap = {};
            for (const [k, v] of Object.entries(topLevelDR)) {
                const n = k.startsWith('DR') ? parseInt(k.slice(2)) : parseInt(k);
                numMap[n] = v;
            }
            methodDRPetNames[m.name] = numMap;
        }
    }
    let _curMethodDRMap = {};  // active during the instruction render loop

    // Build method boundary maps (word index → name / method object).
    // If no manifest methods, auto-detect by scanning for HALT (word=0)
    // or RETURN (opcode 3) followed by a non-zero word within the code region.
    const mb    = {};   // wordIndex → method name
    const mbObj = {};   // wordIndex → method JSON object
    const autoDetected = methods.length === 0;
    if (!autoDetected) {
        let _codeOnlyCursor = 0;  // cumulative offset for source-JSON code-only methods
        for (const m of methods) {
            if (m.aliasOf) continue;  // aliases share the target's binary — no separate card
            const hasOffset = typeof m.offset === 'number';
            const codeArr   = Array.isArray(m.code) ? m.code : null;
            const hasCode   = codeArr !== null || typeof m.code === 'string';
            if (!hasOffset && !hasCode) continue;
            let wi;
            if (hasOffset) {
                // Manifest method: offset is the canonical word index within the code region.
                wi = 1 + m.offset;
            } else {
                // Source-JSON method: no explicit offset — compute cumulatively from code length.
                wi = 1 + _codeOnlyCursor;
                _codeOnlyCursor += codeArr ? codeArr.length : 1;
            }
            mb[wi]    = m.name;
            mbObj[wi] = m;
        }
    } else if (cw > 0) {
        mb[1] = `${abstName}.Method_0`;
        let mIdx = 0;
        const scanEnd = Math.min(cw, words.length - 2);
        for (let i = 1; i <= scanEnd; i++) {
            const w = words[i] >>> 0;
            const opcode = (w >>> 27) & 0x1F;
            const isHalt   = w === 0;
            const isReturn = opcode === 3;
            if (isHalt || isReturn) {
                // Peek ahead: skip over consecutive HALTs/padding to find next code word
                let j = i + 1;
                while (j <= cw && words[j] === 0) j++;
                if (j <= cw && j < words.length) {
                    mIdx++;
                    mb[j] = `${abstName}.Method_${mIdx}`;
                    i = j - 1;  // resume scanning from next method start
                }
            }
        }
    }

    const dis = w => {
        if (typeof assembler !== 'undefined' && assembler) {
            try { return assembler.disassemble(w >>> 0); } catch (_) {}
        }
        return `0x${(w >>> 0).toString(16).padStart(8, '0').toUpperCase()}`;
    };

    // C-list token → known abstraction name lookup
    const _clistName = tok => {
        if (!_lumpsCache || !_lumpsCache.length) return '';
        const h = tok.toString(16).padStart(8, '0');
        const lm = _lumpsCache.find(l => {
            const t = (l.token || '').toLowerCase();
            return t === h || t.replace(/^0+/, '') === h.replace(/^0+/, '');
        });
        return lm ? (lm.abstraction || '') : '';
    };

    // Pre-parse c-list slots — resolve human pet names for use during disassembly.
    // Uses the same priority as MyGoldenTokens rendering:
    //   1. lump manifest pet_names.CR[s]
    //   2. Abstract GT device-class derivation (LED0, UART0, … — canonical no-bracket form)
    //   3. Inform/Outform GT: token lookup → sim.nsLabels[slot_id]
    const clistSlotName = {};   // slot index (0-based) → human name
    const _crPetNamesForCode = (lump.pet_names || {}).CR || {};
    const _abDevClsNames     = ['?','LED','UART','Button','Timer','Display'];
    const clistStart = lumpSize - cc;
    for (let s = 0; s < cc; s++) {
        const wIdx = clistStart + s;
        const wVal = wIdx < words.length ? (words[wIdx] >>> 0) : 0;
        if (!wVal) { clistSlotName[s] = '(empty)'; continue; }
        const _mfstName = _crPetNamesForCode[s] || _crPetNamesForCode[String(s)] || '';
        if (_mfstName) { clistSlotName[s] = _mfstName; continue; }
        const _gtType = (wVal >>> 23) & 0x3;
        if (_gtType === 3) {  // Abstract GT: [31:27]=ab_type [26]=R [25]=W [15:0]=ab_data
            const _abType  = (wVal >>> 27) & 0x1F;
            const _abData  = wVal & 0xFFFF;
            const _devCls  = (_abData >>> 8) & 0xFF;
            const _devDat  = _abData & 0xFF;
            if (_abType === 0)      clistSlotName[s] = `${_abDevClsNames[_devCls] || `Dev${_devCls}`}${_devDat}`;
            else if (_abType === 1) clistSlotName[s] = 'M-Elevation';
            else                   clistSlotName[s] = `Abs[${_abType}]`;
        } else {  // Inform / Outform GT: [15:0]=slot_id
            const _slotId   = wVal & 0xFFFF;
            const _tokName  = _clistName(wVal);
            const _simNsNm  = (typeof sim !== 'undefined' && sim && sim.nsLabels) ? (sim.nsLabels[_slotId] || '') : '';
            clistSlotName[s] = _tokName || _simNsNm || '';
        }
    }

    // ── Auto-comment engine ──────────────────────────────────────────────
    // Generates a human-readable semantic comment for one instruction.
    // Uses the already-maintained crAlias + clistSlotName context.
    const _autoComment = (w, op, crDst, crSrc, imm, cond, crAlias) => {
        if (w === 0) return 'end of method / padding';

        const condNames = ['EQ','NE','CS','CC','MI','PL','VS','VC','HI','LS','GE','LT','GT','LE','','NV'];
        const condStr   = cond === 14 ? '' : `if ${condNames[cond]} `;

        // crName: returns pet name in quotes when CRn carries a known c-list alias,
        // otherwise returns the structural register label. This gives the logical view.
        const crName = n => {
            if (crAlias[n] !== undefined) {
                const nm = clistSlotName[crAlias[n]];
                if (nm) return `"${nm}"`;
            }
            if (n === 6 && cc > 0) return 'c-list';
            if (n === 14) return 'CR14(code)';
            if (n === 13) return 'CR13(int)';
            if (n === 15) return 'CR15(priv)';
            return `CR${n}`;
        };
        // Helper: pet name for a c-list slot, falling back to slot index label
        const _slotLabel = idx => clistSlotName[idx] || `c-list[${idx}]`;

        switch (op) {
            case 0: {  // LOAD CRd, CRs[imm]
                if (crSrc === 6 && cc > 0) {
                    return `${condStr}CR${crDst} ← "${_slotLabel(imm)}"`;
                }
                return `${condStr}CR${crDst} ← GT via ${crName(crSrc)}[${imm}]`;
            }
            case 1: {  // SAVE CRd, CRs[imm]
                return `${condStr}store CR${crSrc} → GT space of ${crName(crDst)}[${imm}]`;
            }
            case 2: {  // CALL CRd[, sel]
                const selSrc = crSrc ? `, method #${crSrc}` : '';
                return `${condStr}invoke ${crName(crDst)}${selSrc}`;
            }
            case 3: {  // RETURN [mask]
                const retMask = imm & 0xFFF;
                return retMask
                    ? `scrub regs 0b${retMask.toString(2).padStart(12,'0')} then return`
                    : 'return to caller';
            }
            case 4: {  // CHANGE CRd, CRs[imm]
                if (crSrc === 6 && cc > 0) {
                    return `${condStr}hot-swap CR${crDst} ← "${_slotLabel(imm)}"`;
                }
                return `${condStr}update CR${crDst} via ${crName(crSrc)}[${imm}]`;
            }
            case 5: {  // SWITCH CRs, CRb
                return `${condStr}SWITCH CR${crSrc} → CR${(imm & 0x7) === 5 ? '13' : (imm & 0x7) === 7 ? '15' : (imm & 0x7)} (PassKey install)`;
            }
            case 6: {  // TPERM CRd, preset[B]
                const presets = ['CLEAR','R','RW','X','RX','RWX','L','S','E','LS'];
                const bFlag   = (imm >>> 4) & 1;
                const preset  = presets[imm & 0xF] || 'RSV';
                return `${condStr}attenuate CR${crDst} to ${preset}${bFlag ? '+B' : ''} permissions`;
            }
            case 7: {  // LAMBDA CRd
                return `${condStr}create lambda closure → CR${crDst}`;
            }
            case 8: {  // ELOADCALL CRd, CRs[imm]
                if (crSrc === 6 && cc > 0) {
                    return `${condStr}fused load + call "${_slotLabel(imm)}" → CR${crDst}`;
                }
                return `${condStr}fused load + call ${crName(crSrc)}[${imm}] → CR${crDst}`;
            }
            case 9: {  // XLOADLAMBDA CRd, CRs[imm]
                if (crSrc === 6 && cc > 0) {
                    return `${condStr}fused load + lambda "${_slotLabel(imm)}" → CR${crDst}`;
                }
                return `${condStr}fused load + lambda ${crName(crSrc)}[${imm}] → CR${crDst}`;
            }
            case 10: {  // DREAD DRd, CRs[imm]
                if (crAlias[crSrc] !== undefined) {
                    const nm = clistSlotName[crAlias[crSrc]];
                    if (nm) return `${condStr}DR${crDst} ← "${nm}"`;
                }
                return `${condStr}DR${crDst} ← data[${crName(crSrc)}+${imm}]`;
            }
            case 11: {  // DWRITE DRd, CRs[imm]
                if (crAlias[crSrc] !== undefined) {
                    const nm = clistSlotName[crAlias[crSrc]];
                    if (nm) return `${condStr}"${nm}" ← DR${crDst}`;
                }
                return `${condStr}data[${crName(crSrc)}+${imm}] ← DR${crDst}`;
            }
            case 12: {  // BFEXT DRd, DRs, pos, w
                const pos   = (imm >>> 5) & 0x1F;
                const width = imm & 0x1F;
                return `${condStr}DR${crDst} = bits[${pos}:${pos+width-1}] of DR${crSrc}`;
            }
            case 13: {  // BFINS DRd, DRs, pos, w
                const pos   = (imm >>> 5) & 0x1F;
                const width = imm & 0x1F;
                return `${condStr}insert ${width}b from DR${crSrc} at pos ${pos} into DR${crDst}`;
            }
            case 14: {  // MCMP DRd, DRs
                return `${condStr}compare DR${crDst} vs DR${crSrc} → flags`;
            }
            case 15: {  // IADD DRd, DRs, DRm | #imm
                const isImm = (imm & 0x4000) !== 0;
                const rhs   = isImm ? `#${imm & 0x3FFF}` : `DR${imm & 0xF}`;
                return `${condStr}DR${crDst} = DR${crSrc} + ${rhs}`;
            }
            case 16: {  // ISUB DRd, DRs, DRm | #imm
                const isImm = (imm & 0x4000) !== 0;
                const rhs   = isImm ? `#${imm & 0x3FFF}` : `DR${imm & 0xF}`;
                return `${condStr}DR${crDst} = DR${crSrc} − ${rhs}`;
            }
            case 17: {  // BRANCH soff
                const soff = (imm & 0x4000) ? (imm | 0xFFFF8000) : imm;
                return `${condStr}branch → PC${soff >= 0 ? '+' : ''}${soff}`;
            }
            case 18: {  // SHL DRd, DRs, shamt
                return `${condStr}DR${crDst} = DR${crSrc} << ${imm & 0x1F}`;
            }
            case 19: {  // SHR DRd, DRs, shamt [ASR]
                const arith = (imm >>> 5) & 1;
                const shamt = imm & 0x1F;
                return `${condStr}DR${crDst} = DR${crSrc} >> ${shamt} (${arith ? 'arithmetic' : 'logical'})`;
            }
            default:
                return 'unknown opcode';
        }
    };

    // ── Method docstring renderer ────────────────────────────────────────
    // Emits a styled block for description / inputs / outputs if present.
    const _renderDocstring = m => {
        if (!m) return '';
        const desc    = m.description || '';
        const inputs  = m.inputs  || [];
        const outputs = m.outputs || [];
        if (!desc && !inputs.length && !outputs.length) return '';
        let d = '<div class="lump-code-docstring">';
        if (desc) d += `<span class="lump-doc-desc">${e(desc)}</span>`;
        if (inputs.length)  d += `<span class="lump-doc-io">in: ${inputs.map(e).join(' | ')}</span>`;
        if (outputs.length) d += `<span class="lump-doc-io">out: ${outputs.map(e).join(' | ')}</span>`;
        d += '</div>';
        return d;
    };

    const effEnd = Math.min(cw + 1, lumpSize - cc > 0 ? lumpSize - cc : cw + 1, words.length);

    // ── Branch-label + arrow pre-scan ────────────────────────────────────
    // Mirror exactly what the Code View table does: find all BRANCH targets,
    // assign L0…Ln labels in address order, compute per-row SVG arrows.
    const _lumpCondAbbr = ['EQ','NE','CS','CC','MI','PL','VS','VC','HI','LS','GE','LT','GT','LE','','NV'];
    const _condLong     = ['Equal','Not Equal','Carry Set','Carry Clear','Minus','Plus','Overflow Set','Overflow Clear','Higher','Lower or Same','Greater or Equal','Less Than','Greater Than','Less or Equal','Always','Never'];
    const _condSpan = (abbr, idx) => `<span class="cond-abbr" title="${abbr}\u00A0\u2014\u00A0${_condLong[idx]}">${abbr}</span>`;
    const _injectCondTooltip = (escapedHtml, condCode) => {
        if (condCode === 14) return escapedHtml;
        const abbr = _lumpCondAbbr[condCode];
        if (!abbr) return escapedHtml;
        return escapedHtml.replace(
            new RegExp(`^([A-Z]+)(${abbr})(\\s|$)`),
            (m, prefix, ca, tail) => `${prefix}${_condSpan(ca, condCode)}${tail}`
        );
    };
    const _lumpCodeWords = [];
    for (let _ci = 1; _ci < effEnd; _ci++) _lumpCodeWords.push(words[_ci] >>> 0);

    const _lumpBrTargetSet = new Set();
    for (let _ci = 0; _ci < _lumpCodeWords.length; _ci++) {
        const _cw2 = _lumpCodeWords[_ci];
        if (((_cw2 >>> 27) & 0x1F) !== 17) continue;
        const _rawImm = _cw2 & 0x7FFF;
        const _soff   = (_rawImm & 0x4000) ? (_rawImm | 0xFFFF8000) : _rawImm;
        const _tgt    = _ci + _soff;
        if (_tgt >= 0 && _tgt < _lumpCodeWords.length) _lumpBrTargetSet.add(_tgt);
    }
    const _lumpBrLabelMap = new Map();
    Array.from(_lumpBrTargetSet).sort((a, b) => a - b).forEach((idx, n) => _lumpBrLabelMap.set(idx, `L${n}`));

    const _lumpBrArrows = (typeof _computeBranchArrows === 'function')
        ? _computeBranchArrows(_lumpCodeWords)
        : { html: new Array(_lumpCodeWords.length).fill(''), hasBranches: false };

    let html = '<div class="lump-content-code">';
    html += '<div class="lump-methods-section">';
    html += '<div class="lump-methods-title">MyMethods</div>';
    if (effEnd <= 1) {
        html += '<div class="lumps-placeholder">No code words in this lump.</div>';
    } else {
        // Live CR alias map: tracks which cap-register holds which c-list slot
        const crAlias = {};  // crNum → slot index (int)
        let _curMethodObj = null;
        let instrRelIdx   = 0;
        let _methodCardOpen = false;
        let _methodCardIdx  = 0;

        let _lumpCi = 0;  // code-region offset (0-based, used for branch label/arrow lookup)
        for (let i = 1; i < effEnd; i++, _lumpCi++) {
            // Method boundary → reset per-method register aliases and update DR pet names
            if (mb[i] !== undefined) {
                if (_methodCardOpen) html += '</div></div>';  // close previous method body + card
                const auto = autoDetected ? ' <span class="lump-meth-auto" title="Auto-detected boundary">[~]</span>' : '';
                const cardId = `lump-mc-${_methodCardIdx++}`;
                html += `<div class="lump-method-card" id="${cardId}">` +
                        `<div class="lump-method-card-header">` +
                        `<span class="lump-method-card-name" onclick="(function(el){var card=el.closest('.lump-method-card');var c=card.getAttribute('data-collapsed')==='1';card.setAttribute('data-collapsed',c?'0':'1');})(this)">\u25c6 ${e(mb[i])}${auto}</span>` +
                        `<button class="lump-method-toggle-btn" onclick="(function(btn){` +
                            `var card=btn.closest('.lump-method-card');` +
                            `var shown=card.getAttribute('data-binary')==='1';` +
                            `card.setAttribute('data-binary',shown?'0':'1');` +
                            `btn.textContent=shown?'Show binary':'Hide binary';` +
                        `})(this)">Show binary</button>` +
                        `</div>` +
                        `<div class="lump-method-body">`;
                _methodCardOpen = true;
                for (const k of Object.keys(crAlias)) delete crAlias[k];
                _curMethodDRMap = methodDRPetNames[mb[i]] || {};
                _curMethodObj   = mbObj[i] || null;
                instrRelIdx     = 0;
                html += _renderDocstring(_curMethodObj);
            } else if (!_methodCardOpen) {
                // Code words before first detected boundary — open an implicit card
                const cardId = `lump-mc-${_methodCardIdx++}`;
                html += `<div class="lump-method-card" id="${cardId}">` +
                        `<div class="lump-method-card-header">` +
                        `<span class="lump-method-card-name" onclick="(function(el){var card=el.closest('.lump-method-card');var c=card.getAttribute('data-collapsed')==='1';card.setAttribute('data-collapsed',c?'0':'1');})(this)">\u25c6 (code)</span>` +
                        `<button class="lump-method-toggle-btn" onclick="(function(btn){` +
                            `var card=btn.closest('.lump-method-card');` +
                            `var shown=card.getAttribute('data-binary')==='1';` +
                            `card.setAttribute('data-binary',shown?'0':'1');` +
                            `btn.textContent=shown?'Show binary':'Hide binary';` +
                        `})(this)">Show binary</button>` +
                        `</div>` +
                        `<div class="lump-method-body">`;
                _methodCardOpen = true;
            }

            const w    = words[i] >>> 0;
            const op   = (w >>> 27) & 0x1F;
            const cond = (w >>> 23) & 0xF;
            const crDst = (w >>> 19) & 0xF;
            const crSrc = (w >>> 15) & 0xF;
            const imm   = w & 0x7FFF;

            // Track LOAD/CHANGE from CR6 (active c-list) into a capability register
            if ((op === 0 || op === 4) && crSrc === 6 && cc > 0) {
                crAlias[crDst] = imm;   // slot index
            }
            // SWITCH can swap aliases
            if (op === 5) {
                const swOther = imm & 0xF;
                const tmp = crAlias[crSrc];
                if (crAlias[swOther] !== undefined) crAlias[crSrc] = crAlias[swOther];
                else delete crAlias[crSrc];
                if (tmp !== undefined) crAlias[swOther] = tmp;
                else delete crAlias[swOther];
            }

            // Build symbolic annotation (capability arrow shown next to mnemonic)
            let ann = '';
            const _nsOrClistName = idx => clistSlotName[idx] || null;
            if ((op === 0 || op === 4) && crSrc === 6 && cc > 0) {
                const nm = _nsOrClistName(imm);
                if (nm) ann = `<span class="lump-sym-ann">\u2190 ${e(nm)}</span>`;
            } else if (op === 2 && crAlias[crDst] !== undefined && cc > 0) {
                const nm = _nsOrClistName(crAlias[crDst]);
                if (nm) ann = `<span class="lump-sym-ann">\u2192 ${e(nm)}</span>`;
            } else if ((op === 8 || op === 9) && crSrc === 6 && cc > 0) {
                const nm = _nsOrClistName(imm);
                if (nm) ann = `<span class="lump-sym-ann">\u21D2 ${e(nm)}</span>`;
            }

            // Resolve instruction comment: static (from JSON) beats dynamic
            const staticCmt = _curMethodObj && Array.isArray(_curMethodObj.comments)
                ? (_curMethodObj.comments[instrRelIdx] || null)
                : null;
            let commentText = staticCmt || _autoComment(w, op, crDst, crSrc, imm, cond, crAlias);

            const addr = (i * 4).toString(16).toUpperCase().padStart(4, '0');
            const hex  = (w >>> 0).toString(16).toUpperCase().padStart(8, '0');
            let disText = dis(w);
            if (Object.keys(_curMethodDRMap).length > 0) {
                disText = disText.replace(/\bDR(\d+)\b/g, (match, numStr) => {
                    const pet = _curMethodDRMap[parseInt(numStr)];
                    return pet ? `${pet}(DR${numStr})` : match;
                });
            }
            let disHtml = null;

            // BRANCH: replace raw PC-offset text with symbolic label (L0, L1, …)
            if (op === 17) {
                const _bsoff   = (imm & 0x4000) ? (imm | 0xFFFF8000) : imm;
                const _btgt    = _lumpCi + _bsoff;
                const _blabel  = _lumpBrLabelMap.get(_btgt);
                if (_blabel !== undefined) {
                    const _bcond = _lumpCondAbbr[cond];
                    disText     = `BRANCH${_bcond}  ${_blabel}`;
                    disHtml     = cond === 14
                        ? `BRANCH\u00A0\u00A0${_blabel}`
                        : `BRANCH${_condSpan(_bcond, cond)}\u00A0\u00A0${_blabel}`;
                    commentText = staticCmt || `branch → ${_blabel}${cond !== 14 ? ` [if ${_bcond}]` : ''}`;
                }
            }

            // Emit branch-target label row before this instruction if it's a target
            if (_lumpBrLabelMap.has(_lumpCi)) {
                html += `<div class="lump-code-label-row">${_lumpBrLabelMap.get(_lumpCi)}:</div>`;
            }

            // Branch arrow SVG (from pre-computed _lumpBrArrows)
            const _brSvgHtml = (_lumpBrArrows.hasBranches && _lumpBrArrows.html[_lumpCi])
                ? `<span class="lump-code-branch-svg">${_lumpBrArrows.html[_lumpCi]}</span>`
                : (_lumpBrArrows.hasBranches ? `<span class="lump-code-branch-svg lump-code-branch-svg-empty" style="width:${(_lumpBrArrows.svgW||14)}px;"></span>` : '');

            html += `<div class="lump-code-row">` +
                    `<span class="lump-code-left-group">` +
                    _brSvgHtml +
                    `<span class="lump-code-instr">${disHtml !== null ? disHtml : _injectCondTooltip(e(disText), cond)}${ann ? ' ' + ann : ''}</span>` +
                    `<span class="lump-code-comment">${_colorizeComment(commentText)}</span>` +
                    `</span>` +
                    `<span class="lump-code-binary-group">` +
                    `<span class="lump-code-addr">\u00A00x${addr}</span>` +
                    `<span class="lump-code-hex">${hex}</span>` +
                    `</span>` +
                    `</div>`;

            instrRelIdx++;

            // RETURN or HALT → clear aliases (next code is a new method scope)
            if (w === 0 || op === 3) {
                for (const k of Object.keys(crAlias)) delete crAlias[k];
            }
        }
        if (_methodCardOpen) html += '</div></div>';  // close last method body + card
    }
    html += '</div></div>';  // close .lump-methods-section and .lump-content-code

    // C-list GTs inline section — same word data already in hand, no extra fetch needed
    if (cc > 0) {
        const _clistStart  = lumpSize - cc;
        const _gtCRPetNames = (lump.pet_names || {}).CR || {};
        const _abDevClass  = ['?','LED','UART','Button','Timer','Display'];
        html += `<div class="lump-clist-section">`;
        html += `<div class="lump-clist-title">MyGoldenTokens <span class="lump-gt-count">(${cc} ${cc === 1 ? 'capability' : 'capabilities'})</span></div>`;
        html += `<div class="lump-gt-chips">`;
        for (let _gs = 0; _gs < cc; _gs++) {
            const _wIdx  = _clistStart + _gs;
            const _wVal  = _wIdx < words.length ? (words[_wIdx] >>> 0) : 0;
            const _gType = (_wVal >>> 23) & 0x3;
            const _gSeq  = (_wVal >>> 16) & 0x7F;
            if (!_wVal) {
                html += `<div class="lump-gt-chip lump-gt-chip-null lump-gt-chip-empty">` +
                        `<span class="lump-gt-chip-dot lump-gt-dot-null"></span>` +
                        `<span class="lump-gt-chip-name lump-gt-name-null">\u2014 empty \u2014</span>` +
                        `<span class="lump-gt-chip-meta lump-gt-meta-null">#${_gs}</span>` +
                        `</div>`;
            } else if (_gType === 3) {
                const _abType  = (_wVal >>> 27) & 0x1F;
                const _rBit    = (_wVal >>> 26) & 1;
                const _wBit    = (_wVal >>> 25) & 1;
                const _abData  = _wVal & 0xFFFF;
                const _dCls    = (_abData >>> 8) & 0xFF;
                const _dDat    = _abData & 0xFF;
                const _pStr    = (_rBit ? 'R' : '-') + (_wBit ? 'W' : '-');
                const _mName   = _gtCRPetNames[_gs] || _gtCRPetNames[String(_gs)] || '';
                const _clsLbl  = _abType === 0 ? (_abDevClass[_dCls] || `Dev${_dCls}`) : `ab${_abType}`;
                const _derived = _abType === 0 ? `${_clsLbl}${_dDat}` : `Abs[${_abType}]`;
                const _dName   = _mName || _derived;
                html += `<div class="lump-gt-chip" data-slot="${_gs}">` +
                        `<span class="lump-gt-chip-dot"></span>` +
                        `<span class="lump-gt-chip-name">${e(_dName)}</span>` +
                        `<span class="lump-gt-chip-meta">${_pStr} \u00B7 Abs \u00B7 ${_clsLbl} \u00B7 v${_gSeq}</span>` +
                        `</div>`;
            } else {
                const _slotId  = _wVal & 0xFFFF;
                const _gPerms  = (_wVal >>> 25) & 0x3F;
                const _gTStr   = ['NULL','Inf','Out','Abs'][_gType];
                const _pStr    = 'RWXLSE'.split('').map((c, i) => (_gPerms >> i) & 1 ? c : '-').join('');
                const _mName   = _gtCRPetNames[_gs] || _gtCRPetNames[String(_gs)] || '';
                const _nameHtml = _mName
                    ? `<span class="lump-gt-chip-name">${e(_mName)}</span>`
                    : `<span class="lump-gt-chip-name lump-gt-name-unresolved">NS[${_slotId}]</span>`;
                html += `<div class="lump-gt-chip" data-slot="${_gs}">` +
                        `<span class="lump-gt-chip-dot"></span>` +
                        _nameHtml +
                        `<span class="lump-gt-chip-meta">${_pStr} \u00B7 ${_gTStr} \u00B7 #${_slotId} \u00B7 v${_gSeq}</span>` +
                        `</div>`;
            }
        }
        html += `</div></div>`;
    }

    // Built-in data words section
    const dw          = parseInt(lump.dw)          || 0;
    const dataOffset  = parseInt(lump.data_offset) || 0;
    const dataNames   = lump.data_word_names       || [];
    if (dw > 0 && dataOffset > 0) {
        html += `<div class="lump-clist-section"><div class="lump-clist-title">Data Words — ${dw} word${dw === 1 ? '' : 's'}</div><div class="lump-clist-table">`;
        for (let d = 0; d < dw; d++) {
            const wIdx = dataOffset + d;
            const wVal = wIdx < words.length ? (words[wIdx] >>> 0) : 0;
            const hexW = wVal.toString(16).toUpperCase().padStart(8, '0');
            const nm   = dataNames[d] || `[${d}]`;
            const flt  = new DataView(new ArrayBuffer(4));
            flt.setUint32(0, wVal, false);
            const fVal = flt.getFloat32(0, false);
            const fStr = Number.isFinite(fVal) ? fVal.toFixed(6) : '—';
            html += `<div class="lump-clist-row">` +
                    `<span class="lump-clist-idx">${e(nm)}</span>` +
                    `<span class="lump-clist-tok">0x${hexW}</span>` +
                    `<span class="lump-clist-name">${e(fStr)}</span>` +
                    `</div>`;
        }
        html += '</div></div>';
    }

    // User-constant pool section (Constants.Add pool)
    const poolW      = lump.pool_w;
    const poolNsBase = parseInt(lump.pool_ns_base) || 50;
    const poolSize   = parseInt(lump.pool_size)    || 14;
    if (poolW && dw > 0 && dataOffset > 0) {
        const poolOffset = dataOffset + dw;
        const bitmapIdx  = poolOffset + poolSize;
        const bitmap     = bitmapIdx < words.length ? (words[bitmapIdx] >>> 0) : 0;
        html += `<div class="lump-clist-section"><div class="lump-clist-title">User Constant Pool — ${poolSize} slots (NS ${poolNsBase}–${poolNsBase + poolSize - 1})</div><div class="lump-clist-table">`;
        for (let p = 0; p < poolSize; p++) {
            const wIdx     = poolOffset + p;
            const wVal     = wIdx < words.length ? (words[wIdx] >>> 0) : 0;
            const hexW     = wVal.toString(16).toUpperCase().padStart(8, '0');
            const occupied = !!(bitmap & (1 << p));
            const stateSpan = occupied
                ? `<span style="color:var(--accent-green,#4caf50)">\u25cf occupied</span>`
                : `<span style="color:var(--text-secondary,#888)">\u25cb free</span>`;
            html += `<div class="lump-clist-row">` +
                    `<span class="lump-clist-idx">pool[${p}]</span>` +
                    `<span class="lump-clist-tok">0x${hexW}</span>` +
                    `<span class="lump-clist-name">${stateSpan}</span>` +
                    `</div>`;
        }
        const occupiedCount = bitmap === 0 ? 0 : bitmap.toString(2).split('').filter(b => b === '1').length;
        const freeCount = poolSize - occupiedCount;
        html += `<div class="lump-clist-row" style="font-size:0.7rem;color:var(--text-secondary,#888);padding:2px 4px">bitmap 0x${bitmap.toString(16).toUpperCase().padStart(4,'0')} \u2022 ${freeCount}/${poolSize} free</div>`;
        html += '</div></div>';
    }

    bodyEl.innerHTML = html;
    bodyEl.className = '';
}

async function _loadLumpTokens(token, lump) {
    const tk     = (token || '').replace(/[^a-z0-9]/gi, '');
    const bodyEl = document.getElementById(`lumpTokensBody_${tk}`);
    if (!bodyEl) return;

    const e         = _escHtml;
    const cc        = parseInt(lump.cc) || 0;
    const lumpSize  = parseInt(lump.lump_size) || 0;
    const nsIdx     = (lump.ns_slot !== null && lump.ns_slot !== undefined) ? parseInt(lump.ns_slot) : null;

    // ── POLA action strip ────────────────────────────────────────────────────
    let html = `<div class="lump-clist-section">`;
    html += `<div class="lump-section-title">POLA — Principle of Least Authority</div>`;
    if (nsIdx !== null) {
        html += `<div class="clist-pola-strip">` +
            `<span class="clist-pola-label">POLA</span>` +
            `<span class="clist-pola-msg">Remove unused capabilities to reduce authority surface.</span>` +
            `<button class="clist-pola-btn" onclick="applyPOLA(${nsIdx})">\u26A1\u202FApply POLA</button>` +
            `</div>`;
    } else {
        html += `<div class="clist-pola-strip">` +
            `<span class="clist-pola-label">POLA</span>` +
            `<span class="clist-pola-msg" style="color:var(--text-secondary,#888)">No NS slot assigned — POLA requires a loaded namespace entry.</span>` +
            `</div>`;
    }
    html += `</div>`;

    // ── MyGoldenTokens (C-list viewer) ───────────────────────────────────────
    if (cc === 0) {
        html += `<div class="lump-clist-section"><div class="lump-clist-table">` +
            `<div style="color:var(--text-secondary,#888);font-size:0.8rem;padding:0.5rem 0;">` +
            `This lump has no capability slots (cc\u202F=\u202F0).</div></div></div>`;
        bodyEl.innerHTML = html;
        bodyEl.className = '';
        return;
    }

    // Fetch words to decode GT values
    let words = [];
    try {
        const resp = await fetch(`/api/lump/${token}/words`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        words = data.words || [];
    } catch (err) {
        html += `<div class="lump-clist-section"><div style="color:#f87171;font-size:0.8rem;padding:0.4rem 0;">` +
            `Failed to load token words: ${e(err.message)}</div></div>`;
        bodyEl.innerHTML = html;
        bodyEl.className = '';
        return;
    }

    const clistStart    = lumpSize - cc;
    const _gtCRPetNames = (lump.pet_names || {}).CR || {};
    const _abDevClass   = ['?','LED','UART','Button','Timer','Display'];
    const _tokenToName  = tok => {
        if (!_lumpsCache || !_lumpsCache.length) return '';
        const h = tok.toString(16).padStart(8, '0');
        const lm = _lumpsCache.find(l => {
            const t = (l.token || '').toLowerCase();
            return t === h || t.replace(/^0+/, '') === h.replace(/^0+/, '');
        });
        return lm ? (lm.abstraction || '') : '';
    };

    html += `<div class="lump-clist-section">`;
    html += `<div class="lump-clist-title">MyGoldenTokens <span class="lump-gt-count">(${cc} ${cc === 1 ? 'capability' : 'capabilities'})</span></div>`;
    html += `<div class="lump-gt-chips">`;

    for (let s = 0; s < cc; s++) {
        const wIdx  = clistStart + s;
        const wVal  = wIdx < words.length ? (words[wIdx] >>> 0) : 0;
        const gtType = (wVal >>> 23) & 0x3;
        const gtSeq  = (wVal >>> 16) & 0x7F;

        if (!wVal) {
            html += `<div class="lump-gt-chip lump-gt-chip-null lump-gt-chip-empty" title="Slot ${s} is empty \u2014 click to assign a capability" onclick="_openGTSlotPicker(${JSON.stringify(token || '')},${s},this)">` +
                    `<span class="lump-gt-chip-dot lump-gt-dot-null"></span>` +
                    `<span class="lump-gt-chip-name lump-gt-name-null">\u2014 empty \u2014</span>` +
                    `<span class="lump-gt-chip-meta lump-gt-meta-null">#${s}</span>` +
                    `<span class="lump-gt-empty-btn" title="Assign capability">+</span>` +
                    `</div>`;
        } else if (gtType === 3) {
            const abType   = (wVal >>> 27) & 0x1F;
            const rBit     = (wVal >>> 26) & 1;
            const wBit     = (wVal >>> 25) & 1;
            const abData   = wVal & 0xFFFF;
            const devClass = (abData >>> 8) & 0xFF;
            const devData  = abData & 0xFF;
            const permStr  = (rBit ? 'R' : '-') + (wBit ? 'W' : '-');
            const manifestName = _gtCRPetNames[s] || _gtCRPetNames[String(s)] || '';
            let derivedName = '';
            if (!manifestName) {
                if (abType === 0) {
                    const cls = _abDevClass[devClass] || `Dev${devClass}`;
                    derivedName = `${cls}${devData}`;
                } else if (abType === 1) {
                    derivedName = 'M-Elevation';
                } else {
                    derivedName = `Abs[${abType}]`;
                }
            }
            const displayName = manifestName || derivedName;
            const clsLabel    = abType === 0 ? (_abDevClass[devClass] || `Dev${devClass}`) : `ab${abType}`;
            html += `<div class="lump-gt-chip" data-slot="${s}">` +
                    `<span class="lump-gt-chip-dot"></span>` +
                    `<span class="lump-gt-chip-name">${e(displayName)}</span>` +
                    `<span class="lump-gt-chip-meta">${permStr} \u00B7 Abs \u00B7 ${clsLabel} \u00B7 v${gtSeq}</span>` +
                    `</div>`;
        } else {
            const gtSlotId  = wVal & 0xFFFF;
            const gtPerms   = (wVal >>> 25) & 0x3F;
            const gtTypeStr = ['NULL','Inf','Out','Abs'][gtType];
            const permStr   = 'RWXLSE'.split('').map((c, i) => (gtPerms >> i) & 1 ? c : '-').join('');
            const manifestName = _gtCRPetNames[s] || _gtCRPetNames[String(s)] || '';
            const tokenName    = _tokenToName(wVal);
            const simNsName    = (typeof sim !== 'undefined' && sim && sim.nsLabels)
                ? (sim.nsLabels[gtSlotId] || '')
                : '';
            const displayName  = manifestName || tokenName || simNsName;
            const nameHtml = displayName
                ? `<span class="lump-gt-chip-name">${e(displayName)}</span>`
                : `<span class="lump-gt-chip-name lump-gt-name-unresolved">NS[${gtSlotId}]</span>`;
            html += `<div class="lump-gt-chip" data-slot="${s}">` +
                    `<span class="lump-gt-chip-dot"></span>` +
                    nameHtml +
                    `<span class="lump-gt-chip-meta">${permStr} \u00B7 ${gtTypeStr} \u00B7 #${gtSlotId} \u00B7 v${gtSeq}</span>` +
                    `</div>`;
        }
    }

    html += `</div></div>`;
    bodyEl.innerHTML = html;
    bodyEl.className = '';
}

function _renderLumpImageContent(bodyEl, lump, dataWords, token) {
    bodyEl.innerHTML = '';
    bodyEl.className = 'lump-content-image';

    if (token) {
        const replaceBar = document.createElement('div');
        replaceBar.className = 'lump-edit-toolbar';
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.style.display = 'none';
        fileInput.id = `lumpReplaceFile_${token.replace(/[^a-z0-9]/gi, '')}`;
        const replaceBtn = document.createElement('button');
        replaceBtn.className = 'btn lump-edit-btn';
        replaceBtn.textContent = 'Replace file';
        const statusEl = document.createElement('span');
        statusEl.className = 'lump-edit-status';
        statusEl.style.marginLeft = '0.5rem';
        replaceBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', async () => {
            const file = fileInput.files[0];
            if (!file) return;
            replaceBtn.disabled = true;
            statusEl.textContent = 'Uploading\u2026';
            statusEl.style.color = '';
            try {
                const arrayBuf = await file.arrayBuffer();
                const bytes = new Uint8Array(arrayBuf);
                let b64 = '';
                const chunk = 8192;
                for (let i = 0; i < bytes.length; i += chunk) {
                    b64 += String.fromCharCode(...bytes.subarray(i, i + chunk));
                }
                b64 = btoa(b64);
                const resp = await fetch(`/api/lump/${token}/content`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data_b64: b64 }),
                });
                const result = await resp.json();
                if (!resp.ok) throw new Error(result.error || `HTTP ${resp.status}`);
                statusEl.textContent = 'Replaced.';
                statusEl.style.color = 'var(--accent-green, #4caf50)';
                setTimeout(() => _loadLumpContent(token, lump), 800);
            } catch (err) {
                statusEl.textContent = `Error: ${err.message}`;
                statusEl.style.color = 'var(--red, #e53935)';
                replaceBtn.disabled = false;
            }
            fileInput.value = '';
        });
        replaceBar.appendChild(fileInput);
        replaceBar.appendChild(replaceBtn);
        replaceBar.appendChild(statusEl);
        bodyEl.appendChild(replaceBar);
    }

    // Reconstruct raw bytes from word array
    const bytes = new Uint8Array(dataWords.length * 4);
    let bi = 0;
    for (const word of dataWords) {
        bytes[bi++] = (word >>> 24) & 0xFF;
        bytes[bi++] = (word >>> 16) & 0xFF;
        bytes[bi++] = (word >>>  8) & 0xFF;
        bytes[bi++] =  word         & 0xFF;
    }

    // Detect PNG (89 50 4E 47) or JPEG (FF D8 FF)
    const isPng  = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
    const isJpeg = bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
    const isGif  = bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46;
    const isEncoded = isPng || isJpeg || isGif;

    const info = document.createElement('div');
    info.style.cssText = 'font-size:0.72rem;color:var(--text-secondary);margin-bottom:0.5rem;';

    if (isEncoded) {
        const mime = isPng ? 'image/png' : isJpeg ? 'image/jpeg' : 'image/gif';
        const blob = new Blob([bytes], { type: mime });
        const url  = URL.createObjectURL(blob);
        const imgEl = document.createElement('img');
        imgEl.style.cssText = 'max-width:100%;border-radius:4px;display:block;';
        imgEl.onload  = () => {
            info.textContent = `${imgEl.naturalWidth} \u00d7 ${imgEl.naturalHeight} px \u00b7 ${mime} \u00b7 ${bytes.length} bytes`;
            URL.revokeObjectURL(url);
        };
        imgEl.onerror = () => {
            info.textContent = `Could not decode image (${bytes.length} bytes)`;
            URL.revokeObjectURL(url);
        };
        imgEl.src = url;
        bodyEl.appendChild(info);
        bodyEl.appendChild(imgEl);
        return;
    }

    const w = parseInt(lump.image_width)  || 0;
    const h = parseInt(lump.image_height) || 0;
    const ct = (lump.content_type || '').toLowerCase();

    // Grayscale path — 1 byte per pixel, metadata-driven
    if (ct === 'grayscale' && w > 0 && h > 0) {
        info.textContent = `${w} \u00d7 ${h} px \u00b7 Grayscale \u00b7 ${bytes.length} bytes`;
        const canvas = document.createElement('canvas');
        canvas.width  = w;
        canvas.height = h;
        canvas.style.cssText = 'max-width:100%;image-rendering:pixelated;border-radius:4px;display:block;';
        const ctx     = canvas.getContext('2d');
        const imgData = ctx.createImageData(w, h);
        for (let i = 0, p = 0; i < bytes.length && p < imgData.data.length; i++, p += 4) {
            imgData.data[p]     = bytes[i];
            imgData.data[p + 1] = bytes[i];
            imgData.data[p + 2] = bytes[i];
            imgData.data[p + 3] = 255;
        }
        ctx.putImageData(imgData, 0, 0);
        bodyEl.appendChild(info);
        bodyEl.appendChild(canvas);
        return;
    }

    // Raw RGBA canvas render — metadata-driven
    if (!w || !h) {
        bodyEl.innerHTML = '<div class="lumps-placeholder">Unknown image format. For raw RGBA or Grayscale, re-import and specify width \u00d7 height.</div>';
        return;
    }
    info.textContent = `${w} \u00d7 ${h} px \u00b7 RGBA \u00b7 ${bytes.length} bytes`;
    const canvas = document.createElement('canvas');
    canvas.width  = w;
    canvas.height = h;
    canvas.style.cssText = 'max-width:100%;image-rendering:pixelated;border-radius:4px;display:block;';
    const ctx    = canvas.getContext('2d');
    const imgData = ctx.createImageData(w, h);
    for (let i = 0; i < imgData.data.length && i < bytes.length; i++) imgData.data[i] = bytes[i];
    ctx.putImageData(imgData, 0, 0);
    bodyEl.appendChild(info);
    bodyEl.appendChild(canvas);
}

function _renderLumpThreadContent(bodyEl, lump, words) {
    const e = _escHtml;
    const hexw = v => (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
    const pc   = words.length > 1  ? words[1]  : 0;
    const drVals = [];
    for (let i = 0; i < 16; i++) drVals.push(words.length > 2 + i ? words[2 + i] : 0);
    const callDepth = words.length > 18 ? words[18] : 0;
    let html = '<div class="lump-content-thread"><table class="lump-detail-table"><tbody>';
    html += `<tr><td>PC</td><td><code>0x${hexw(pc)}</code></td></tr>`;
    html += `<tr><td>Call Depth</td><td>${callDepth}</td></tr>`;
    html += '</tbody></table>';
    html += '<div class="lump-section-title" style="margin-top:0.75rem;">Data Registers</div>';
    html += '<table class="lump-detail-table"><thead><tr><th>Reg</th><th>Value</th></tr></thead><tbody>';
    for (let i = 0; i < 16; i++) {
        const v = drVals[i];
        html += `<tr><td>DR${i}</td><td style="color:${v === 0 ? 'var(--text-secondary)' : 'inherit'}"><code>0x${hexw(v)}</code></td></tr>`;
    }
    html += '</tbody></table></div>';
    bodyEl.innerHTML = html;
    bodyEl.className = '';
}

function showLumpImportModal() {
    const m = document.getElementById('lumpImportModal');
    if (m) {
        m.querySelector('#lumpImportName').value = '';
        m.querySelector('#lumpImportType').value = 'text';
        m.querySelector('#lumpImportFile').value = '';
        m.querySelector('#lumpImportPaste').value = '';
        m.querySelector('#lumpImportImgW').value = '';
        m.querySelector('#lumpImportImgH').value = '';
        _lumpImportToggleUI(m.querySelector('#lumpImportType').value);
        m.style.display = 'flex';
    }
}

function closeLumpImportModal() {
    const m = document.getElementById('lumpImportModal');
    if (m) m.style.display = 'none';
}

function _lumpImportToggleUI(ct) {
    const modal = document.getElementById('lumpImportModal');
    if (!modal) return;
    const isText    = ct === 'text' || ct === 'markdown';
    const isRawImg  = ct === 'image' || ct === 'grayscale';
    const isLump    = ct === 'lump';
    modal.querySelector('#lumpImportPasteRow').style.display = (isText && !isLump) ? '' : 'none';
    modal.querySelector('#lumpImportFileRow' ).style.display = '';
    modal.querySelector('#lumpImportImgRow'  ).style.display = isRawImg ? '' : 'none';
    const fileLabel = modal.querySelector('#lumpImportFileLabel');
    if (fileLabel) fileLabel.textContent = isText ? 'File (optional — overrides paste)' :
                                           isLump ? 'LUMP file (.lump)' : 'File';
}

async function _submitLumpImport() {
    const modal    = document.getElementById('lumpImportModal');
    const name     = modal.querySelector('#lumpImportName').value.trim() || 'Imported';
    const ct       = modal.querySelector('#lumpImportType').value;
    const fileEl   = modal.querySelector('#lumpImportFile');
    const pasteEl  = modal.querySelector('#lumpImportPaste');
    const imgW     = parseInt(modal.querySelector('#lumpImportImgW').value) || 0;
    const imgH     = parseInt(modal.querySelector('#lumpImportImgH').value) || 0;
    const errEl    = modal.querySelector('#lumpImportErr');
    errEl.textContent = '';

    let dataB64 = '';
    const isText = ct === 'text' || ct === 'markdown';
    const hasFile = fileEl.files && fileEl.files.length > 0;

    if (isText && hasFile) {
        // File overrides paste for text types — read as binary to preserve encoding
        const buf = await fileEl.files[0].arrayBuffer();
        let binary = '';
        const bytes = new Uint8Array(buf);
        for (const b of bytes) binary += String.fromCharCode(b);
        dataB64 = btoa(binary);
    } else if (isText) {
        const text = pasteEl.value;
        if (!text.trim()) { errEl.textContent = 'Paste some text or select a file.'; return; }
        dataB64 = btoa(unescape(encodeURIComponent(text)));
    } else {
        if (!hasFile) { errEl.textContent = 'Select a file first.'; return; }
        const buf = await fileEl.files[0].arrayBuffer();
        let binary = '';
        const bytes = new Uint8Array(buf);
        for (const b of bytes) binary += String.fromCharCode(b);
        dataB64 = btoa(binary);
    }

    // For raw .lump file uploads: parse the header on the server, skip size guard
    if (ct === 'lump') {
        if (!hasFile) { errEl.textContent = 'Select a .lump file.'; return; }
        const buf = await fileEl.files[0].arrayBuffer();
        let binary = '';
        const bytes = new Uint8Array(buf);
        for (const b of bytes) binary += String.fromCharCode(b);
        dataB64 = btoa(binary);
    } else {
        // Client-side size guard: max lump is 2^14 words = 65536 bytes of payload
        const MAX_PAYLOAD_BYTES = (1 << 14) * 4 - 4;
        const approxBytes = Math.ceil(dataB64.length * 3 / 4);
        if (approxBytes > MAX_PAYLOAD_BYTES) {
            errEl.textContent = `File too large: ~${(approxBytes / 1024).toFixed(0)} KB exceeds the 64 KB LUMP limit.`;
            return;
        }
    }

    const endpoint = ct === 'lump' ? '/api/lumps/upload-lump' : '/api/lumps/import';
    const body = ct === 'lump'
        ? { name, data_b64: dataB64 }
        : { name, content_type: ct, data_b64: dataB64 };
    if (ct !== 'lump') {
        if (imgW > 0) body.image_width  = imgW;
        if (imgH > 0) body.image_height = imgH;
    }

    const submitBtn = modal.querySelector('#lumpImportSubmit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Importing…';
    try {
        const resp = await fetch(endpoint, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
        const result = await resp.json();
        if (!resp.ok || !result.ok) throw new Error(result.error || `HTTP ${resp.status}`);
        closeLumpImportModal();
        await renderLumps();
        showLumpDetail(result.token);
    } catch (err) {
        errEl.textContent = `Import failed: ${err.message}`;
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Import';
    }
}

async function _resizeLump(token) {
    const btn = document.querySelector('.lump-hs-resize-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Shrinking…'; }
    try {
        const resp = await fetch(`/api/lump/${token}/resize`, { method: 'POST' });
        const data = await resp.json();
        if (!resp.ok) {
            appendOutput(`Resize failed: ${data.error || resp.status}`, 'error');
            if (btn) { btn.disabled = false; btn.textContent = btn._origText || 'Shrink ▼'; }
            return;
        }
        if (data.already_minimal) {
            appendOutput(`Lump 0x${token} is already at minimum size (${data.lump_size}w)`, 'info');
            if (btn) { btn.disabled = false; btn.textContent = btn._origText || 'Shrink ▼'; }
            return;
        }
        // Update the cached lump record and refresh the detail view.
        const idx = _lumpsCache.findIndex(l => l.token === token);
        if (idx !== -1) {
            _lumpsCache[idx].lump_size = data.lump_size;
            delete _lumpContentLoaded[token];
            delete _lumpHexLoaded[token];
            showLumpDetail(token);
        }
        renderLumps();
        appendOutput(`Lump 0x${token} shrunk: ${data.old_size}w → ${data.lump_size}w (saved ${data.saved_words}w)`, 'info');
    } catch (err) {
        appendOutput(`Resize error: ${err.message}`, 'error');
        if (btn) { btn.disabled = false; btn.textContent = btn._origText || 'Shrink ▼'; }
    }
}

function deleteLump(token) {
    if (!confirm(`Delete lump 0x${token}? This cannot be undone.`)) return;
    fetch(`/api/lumps/${token}`, { method: 'DELETE' })
        .then(r => { if (!r.ok && r.status !== 404) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then(resp => {
            if (resp.ok) {
                _selectedLumpToken = null;
                const titleEl = document.getElementById('lumpsDetailTitle');
                const contentEl = document.getElementById('lumpsDetailContent');
                if (titleEl) titleEl.textContent = 'Select a lump';
                if (contentEl) contentEl.innerHTML = '<div class="lumps-placeholder">Lump deleted.</div>';
                renderLumps();
                appendOutput(`Deleted lump 0x${token}`, 'info');
            } else {
                appendOutput(`Delete failed: ${resp.error || 'unknown error'}`, 'error');
            }
        })
        .catch(err => {
            appendOutput(`Delete error: ${err.message}`, 'error');
        });
}

let _nsBuilderSlots = [];

function showNamespaceBuilder() {
    _selectedLumpToken = null;
    _nsBuilderSlots = [{ label: '', state: 'null', hash_prefix: '', loc_idx: 0, flag_required: false, flag_bundle: false, flag_pinned: false, lump_token: '' }];

    const listEl = document.getElementById('lumpsListContent');
    if (listEl) {
        listEl.querySelectorAll('.lump-item').forEach(el => el.classList.remove('active'));
    }

    const titleEl = document.getElementById('lumpsDetailTitle');
    const contentEl = document.getElementById('lumpsDetailContent');
    if (!titleEl || !contentEl) return;

    titleEl.textContent = 'New Namespace LUMP';
    _renderNsBuilderForm(contentEl);
}

function _renderNsBuilderForm(contentEl) {
    const e = _escHtml;
    let sizeOpts = '';
    for (let n = 6; n <= 14; n++) {
        const words = 1 << n;
        const bytes = words * 4;
        const sel = n === 10 ? ' selected' : '';
        sizeOpts += `<option value="${n}"${sel}>n=${n} (${words} words / ${bytes} bytes)</option>`;
    }

    let lumpOpts = '<option value="">-- select lump --</option>';
    for (const lump of _lumpsCache) {
        if (lump.lump_type === 'namespace' || lump.typ === 10) continue;
        const tk = e(lump.token || '');
        const nm = e(lump.abstraction || lump.token || '');
        lumpOpts += `<option value="${tk}">${nm} (0x${tk})</option>`;
    }

    let html = '<div class="ns-builder-form">';
    html += '<div class="ns-form-group"><label>App Name / ID</label><input type="text" id="nsAppId" placeholder="com.example.MyApp"></div>';
    html += '<div class="ns-form-group"><label>Base Address (hex)</label><input type="text" id="nsBaseHex" value="00010000" placeholder="00010000"></div>';
    html += `<div class="ns-form-group"><label>Size Exponent (n)</label><select id="nsN">${sizeOpts}</select></div>`;
    html += '<div class="ns-form-group"><label>Locator Count (cc)</label><input type="number" id="nsCc" value="3" min="0" max="255"></div>';

    html += '<div class="lump-section-title" style="margin-top:1rem">NS Table Slots</div>';
    html += '<div id="nsSlotEditor"></div>';
    html += '<button class="ns-slot-add-btn" onclick="_nsAddSlot()">+ Add Slot</button>';

    html += '<div style="margin-top:1rem"><button class="ns-build-btn" id="nsBuildBtn" onclick="_nsBuild()">Build namespace.zip</button></div>';
    html += '</div>';

    contentEl.innerHTML = html;
    _renderNsSlots(lumpOpts);
}

function _renderNsSlots(lumpOptsOverride) {
    const container = document.getElementById('nsSlotEditor');
    if (!container) return;

    const e = _escHtml;
    let lumpOpts = lumpOptsOverride;
    if (!lumpOpts) {
        lumpOpts = '<option value="">-- select lump --</option>';
        for (const lump of _lumpsCache) {
            if (lump.lump_type === 'namespace' || lump.typ === 10) continue;
            const tk = e(lump.token || '');
            const nm = e(lump.abstraction || lump.token || '');
            lumpOpts += `<option value="${tk}">${nm} (0x${tk})</option>`;
        }
    }

    let html = '<table class="ns-slot-table"><thead><tr><th>#</th><th>Label</th><th>State</th><th>Details</th><th></th></tr></thead><tbody>';
    for (let i = 0; i < _nsBuilderSlots.length; i++) {
        const s = _nsBuilderSlots[i];
        html += `<tr>`;
        html += `<td>${i}</td>`;
        html += `<td><input type="text" value="${e(s.label)}" onchange="_nsSlotField(${i},'label',this.value)" style="width:120px"></td>`;
        html += `<td><select onchange="_nsSlotField(${i},'state',this.value)">`;
        html += `<option value="null"${s.state === 'null' ? ' selected' : ''}>NULL</option>`;
        html += `<option value="outform"${s.state === 'outform' ? ' selected' : ''}>Outform</option>`;
        html += `<option value="bundled"${s.state === 'bundled' ? ' selected' : ''}>Bundled</option>`;
        html += `</select></td>`;
        html += '<td>';
        if (s.state === 'outform') {
            html += `<div class="ns-slot-fields">`;
            html += `<input type="text" value="${e(s.hash_prefix)}" onchange="_nsSlotField(${i},'hash_prefix',this.value)" placeholder="16 hex chars (SHA256 prefix)" style="width:180px;font-family:monospace">`;
            html += `<input type="number" value="${s.loc_idx}" onchange="_nsSlotField(${i},'loc_idx',parseInt(this.value)||0)" min="0" max="255" style="width:60px" title="Locator index">`;
            html += `<label><input type="checkbox" ${s.flag_required ? 'checked' : ''} onchange="_nsSlotField(${i},'flag_required',this.checked)"> Required</label>`;
            html += `<label><input type="checkbox" ${s.flag_bundle ? 'checked' : ''} onchange="_nsSlotField(${i},'flag_bundle',this.checked)"> Bundle</label>`;
            html += `<label><input type="checkbox" ${s.flag_pinned ? 'checked' : ''} onchange="_nsSlotField(${i},'flag_pinned',this.checked)"> Pinned</label>`;
            html += `</div>`;
        } else if (s.state === 'bundled') {
            let opts = lumpOpts.replace(`value="${e(s.lump_token)}"`, `value="${e(s.lump_token)}" selected`);
            html += `<select onchange="_nsSlotField(${i},'lump_token',this.value)" style="width:200px">${opts}</select>`;
        } else {
            html += '<span style="color:var(--text-secondary);font-size:0.68rem">All-zero entry</span>';
        }
        html += '</td>';
        html += `<td style="white-space:nowrap">`;
        if (i > 0) html += `<button class="ns-slot-remove-btn" onclick="_nsMoveSlot(${i},-1)" title="Move up" style="margin-right:2px">↑</button>`;
        if (i < _nsBuilderSlots.length - 1) html += `<button class="ns-slot-remove-btn" onclick="_nsMoveSlot(${i},1)" title="Move down" style="margin-right:2px">↓</button>`;
        html += `<button class="ns-slot-remove-btn" onclick="_nsRemoveSlot(${i})">×</button>`;
        html += `</td>`;
        html += '</tr>';
    }
    html += '</tbody></table>';
    container.innerHTML = html;
}

function _nsSlotField(idx, field, value) {
    if (idx < 0 || idx >= _nsBuilderSlots.length) return;
    _nsBuilderSlots[idx][field] = value;
    if (field === 'state') {
        _renderNsSlots();
    }
}

function _nsAddSlot() {
    _nsBuilderSlots.push({ label: '', state: 'null', hash_prefix: '', loc_idx: 0, flag_required: false, flag_bundle: false, flag_pinned: false, lump_token: '' });
    _renderNsSlots();
}

function _nsMoveSlot(idx, dir) {
    const target = idx + dir;
    if (target < 0 || target >= _nsBuilderSlots.length) return;
    const tmp = _nsBuilderSlots[idx];
    _nsBuilderSlots[idx] = _nsBuilderSlots[target];
    _nsBuilderSlots[target] = tmp;
    _renderNsSlots();
}

function _nsRemoveSlot(idx) {
    _nsBuilderSlots.splice(idx, 1);
    _renderNsSlots();
}

function _nsBuild() {
    const appId = (document.getElementById('nsAppId')?.value || '').trim();
    if (!appId) { alert('App Name / ID is required'); return; }

    const baseHex = (document.getElementById('nsBaseHex')?.value || '0').trim();
    const n = parseInt(document.getElementById('nsN')?.value || '10');
    const cc = parseInt(document.getElementById('nsCc')?.value || '3');

    if (n < 6 || n > 14) { alert('Size exponent must be 6–14'); return; }

    for (let i = 0; i < _nsBuilderSlots.length; i++) {
        const s = _nsBuilderSlots[i];
        if (s.state === 'outform') {
            const hp = (s.hash_prefix || '').trim();
            if (!/^[0-9a-fA-F]{16}$/.test(hp)) {
                alert(`Slot ${i}: Outform hash prefix must be exactly 16 hex characters`);
                return;
            }
        }
        if (s.state === 'bundled') {
            if (!s.lump_token) {
                alert(`Slot ${i}: Please select a lump for the Bundled entry`);
                return;
            }
            if (!_lumpsCache.find(l => l.token === s.lump_token)) {
                alert(`Slot ${i}: Selected lump not found in catalog`);
                return;
            }
        }
    }

    const entries = _nsBuilderSlots.map((s, i) => ({
        slot: i,
        label: s.label,
        state: s.state,
        hash_prefix: s.hash_prefix || '',
        loc_idx: s.loc_idx || 0,
        flag_required: !!s.flag_required,
        flag_bundle: !!s.flag_bundle,
        flag_pinned: !!s.flag_pinned,
        lump_token: s.lump_token || '',
    }));

    const btn = document.getElementById('nsBuildBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Building...'; }

    fetch('/api/namespace/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            app_id: appId,
            base_hex: baseHex,
            n: n,
            cc: cc,
            ns_table_start: 0,
            entries: entries,
        })
    })
    .then(r => {
        if (!r.ok) {
            return r.json().then(j => { throw new Error(j.error || `HTTP ${r.status}`); });
        }
        return r.blob();
    })
    .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${appId.replace(/[^a-zA-Z0-9._-]/g, '_')}.namespace.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        appendOutput(`Built namespace ${appId} — downloading zip`, 'info');
        if (btn) { btn.disabled = false; btn.textContent = 'Build namespace.zip'; }
        renderLumps();
    })
    .catch(err => {
        appendOutput(`Namespace build error: ${err.message}`, 'error');
        alert(`Build failed: ${err.message}`);
        if (btn) { btn.disabled = false; btn.textContent = 'Build namespace.zip'; }
    });
}

function _goToAbstractionByName(name) {
    if (!name || !abstractionRegistry) return;
    const abs = abstractionRegistry.getByName(name);
    if (!abs) return;
    switchView('abstractions');
    showAbstractionDetail(abs.index);
}

async function _goToLumpByAbstractionName(name) {
    if (!name) return;
    // Warm cache: check immediately without a network round-trip.
    if (_lumpsCache.length > 0) {
        const existing = _lumpsCache.find(l => l.abstraction === name);
        if (!existing) {
            _showFpgaToast('No LUMP found', 'No compiled LUMP found for \u201c' + name + '\u201d', 'warn', 2000);
            return;
        }
        _pendingLumpAbstractionName = name;
        switchView('lumps');
        return;
    }
    // Cold cache: fetch to find out whether a matching LUMP exists before
    // navigating — spec says "nothing happens" if no LUMP exists.
    try {
        const r = await fetch('/api/lumps/list');
        if (!r.ok) return;
        const lumps = await r.json();
        _lumpsCache = lumps;
        const existing = lumps.find(l => l.abstraction === name);
        if (!existing) {
            _showFpgaToast('No LUMP found', 'No compiled LUMP found for \u201c' + name + '\u201d', 'warn', 2000);
            return;
        }
        _pendingLumpAbstractionName = name;
        switchView('lumps');
    } catch (e) {
        // Network error: do nothing rather than navigating blindly.
    }
}

// ── Open a saved lump in the Create (editor) page ──────────────────────────
// Fetches words from /api/lump/<token>/words (same source as Binary /
// Content / Audit tabs) so the editor disassembly is always consistent with
// every other view.  sim.memory is used only for structural location info
// (baseLoc / nsIdx / crIdx) needed by the patch bar and c-list picker.
async function openLumpInEditor(token) {
    var lump = _lumpsCache.find(function(l) { return l.token === token; });
    if (!lump) return;
    var lumpName = lump.abstraction || ('Lump 0x' + token);

    // ── Locate the lump in simulator memory (structural info only) ─────────
    // baseLoc / nsIdx / crIdx are used for editor context (patch bar, c-list
    // picker) but NOT for the disassembly — words come from the server below.
    var baseLoc = null;
    var resolvedNsIdx = null;
    var resolvedCRIdx = null;

    if (typeof sim !== 'undefined' && sim && sim.memory && sim.readNSEntry) {
        // 1. Via the stored ns_slot
        var nsSlot = (lump.ns_slot !== null && lump.ns_slot !== undefined)
            ? parseInt(lump.ns_slot) : null;
        if (nsSlot !== null) {
            var nsEnt = sim.readNSEntry(nsSlot);
            if (nsEnt) {
                var loc0 = nsEnt.word0_location >>> 0;
                var hw0  = loc0 < sim.memory.length ? (sim.memory[loc0] >>> 0) : 0;
                var hdr0 = sim.parseLumpHeader ? sim.parseLumpHeader(hw0) : null;
                if (hdr0 && hdr0.valid) { baseLoc = loc0; resolvedNsIdx = nsSlot; }
            }
        }
        // 2. Fallback: the token encodes the lump's base address
        if (baseLoc === null) {
            var tAddr = parseInt(token, 16) >>> 0;
            if (tAddr > 0 && tAddr < sim.memory.length) {
                var hw1 = sim.memory[tAddr] >>> 0;
                var hdr1 = sim.parseLumpHeader ? sim.parseLumpHeader(hw1) : null;
                if (hdr1 && hdr1.valid) {
                    baseLoc = tAddr;
                    // Scan NS table to find which entry owns this address
                    for (var ni = 0; ni < (sim.nsCount || 0); ni++) {
                        var ne = sim.readNSEntry(ni);
                        if (ne && (ne.word0_location >>> 0) === tAddr) {
                            resolvedNsIdx = ni; break;
                        }
                    }
                }
            }
        }
        // 3. Find which CR currently holds this NS entry
        if (resolvedNsIdx !== null && typeof sim.getFormattedCR === 'function') {
            for (var ci = 0; ci < 16; ci++) {
                try {
                    var cr = sim.getFormattedCR(ci);
                    if (cr && cr.gtIndex === resolvedNsIdx) { resolvedCRIdx = ci; break; }
                } catch (_e) {}
            }
        }
    }

    // ── Fetch authoritative words from server ──────────────────────────────
    // Reads from the same source as Binary / Content / Audit tabs so the
    // editor disassembly is always consistent with every other view.
    var serverWords = null;
    try {
        var _wr = await fetch('/api/lump/' + token + '/words', { cache: 'no-store' });
        if (_wr.ok) {
            var _wj = await _wr.json();
            if (_wj && Array.isArray(_wj.words)) serverWords = _wj.words;
        }
    } catch (_fe) {}

    // ── Disassemble from server words (authoritative) ──────────────────────
    var disasmLines = null;
    if (serverWords && serverWords.length > 0) {
        var lhdrW = serverWords[0] >>> 0;
        var lhdr  = (typeof sim !== 'undefined' && sim && sim.parseLumpHeader)
                        ? sim.parseLumpHeader(lhdrW) : null;
        if (lhdr && lhdr.valid) {
            var codeLimit = lhdr.cw;
            var rawWords  = serverWords.slice(1, 1 + codeLimit).map(function(w) { return w >>> 0; });
            var trimLen = rawWords.length;
            while (trimLen > 0 && rawWords[trimLen - 1] === 0) trimLen--;
            var trimmed = rawWords.slice(0, trimLen);
            var nsTag   = resolvedNsIdx !== null ? ('NS[' + resolvedNsIdx + ']  ') : '';
            var addrStr = baseLoc !== null
                ? ('@ 0x' + baseLoc.toString(16).toUpperCase().padStart(4, '0') + '  ')
                : '';
            disasmLines = [
                '; ' + lumpName + '  ' + nsTag + addrStr +
                '(' + codeLimit + ' word' + (codeLimit !== 1 ? 's' : '') + ')'
            ];
            if (trimmed.length === 0) {
                disasmLines.push('; (empty lump)');
            } else if (typeof ChurchAssembler !== 'undefined') {
                disasmLines.push.apply(disasmLines, ChurchAssembler.decompileWords(trimmed));
            }
        }
    }

    // ── Set up editor context ──────────────────────────────────────────────
    _editorCREditActive = true;
    _editorCREditCR     = resolvedCRIdx;
    _editorCREditNS     = resolvedNsIdx;
    if (resolvedCRIdx !== null && typeof selectedCR !== 'undefined') {
        selectedCR = resolvedCRIdx;
    }

    switchView('editor');

    var sel = document.getElementById('langSelector');
    if (sel) sel.value = 'assembly';

    var asmEd = document.getElementById('asmEditor');
    if (asmEd) {
        if (disasmLines) {
            asmEd.value = disasmLines.join('\n');
        } else {
            var cwHint = (lump.cw  > 0) ? ('\n; Code region: ' + lump.cw  + ' word' + (lump.cw  !== 1 ? 's' : '')) : '';
            var ccHint = (lump.cc  > 0) ? ('\n; C-List: '      + lump.cc  + ' GT slot' + (lump.cc  !== 1 ? 's' : '')) : '';
            asmEd.value = '; ' + lumpName + cwHint + ccHint +
                          '\n; Boot the machine to edit live code\n';
        }
        if (typeof updateLineNumbers === 'function') updateLineNumbers();
    }

    if (typeof _updateEditorPatchBar   === 'function') _updateEditorPatchBar();
    if (typeof _updateMtbfIndicator    === 'function') _updateMtbfIndicator();
    var outEl = document.getElementById('assemblyOutput');
    if (outEl) outEl.innerHTML = '';
}

// ── GT Slot Picker ────────────────────────────────────────────────────────────
// Opened when the user clicks an empty c-list chip in the LUMP content view.
// Lets the user pick an existing NS entry (Inform or Outform GT) or be guided
// to create a new LUMP/ABSTRACT from the compiler.
// ─────────────────────────────────────────────────────────────────────────────

function _openGTSlotPicker(lumpToken, slotIndex, chipEl) {
    if (!lumpToken) {
        alert('Cannot assign GT: this LUMP has no persistent token (save it first).');
        return;
    }

    // Remove any existing picker modal
    const prev = document.getElementById('gt-slot-picker-modal');
    if (prev) prev.remove();

    // Gather NS entries from sim
    const entries = [];
    if (typeof sim !== 'undefined' && sim && typeof sim.readNSEntry === 'function') {
        const count = sim.nsCount || 0;
        for (let i = 0; i < count; i++) {
            const ent = sim.readNSEntry(i);
            if (!ent) continue;
            if (!ent.word0_location) continue;           // no physical lump — not a real slot
            const gtTypeNum = ent.gtType || 0;
            if (gtTypeNum === 0) continue;               // NULL type — nothing to bind
            const label = (sim.nsLabels && sim.nsLabels[i]) || ent.label || '';
            entries.push({
                slot: i,
                label,
                gtType: gtTypeNum,
                gtTypeStr: ['NULL', 'Inf', 'Out', 'Abs'][gtTypeNum] || '?',
                word2: ent.word2_seals >>> 0,
            });
        }
    }

    const _e = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const typeColors = { NULL: '#555', Inf: '#7dd3a8', Out: '#7eb8ff', Abs: '#c8a84b' };

    const entriesHtml = entries.length
        ? entries.map(en =>
            `<div class="gtpick-row" data-slot="${en.slot}" data-type="${en.gtTypeNum}" data-word2="${en.word2}" onclick="_gtPickSelect(${en.slot},${en.word2},'${_e(en.label)}','${en.gtTypeStr}')">` +
            `<span class="gtpick-slot">#${en.slot}</span>` +
            `<span class="gtpick-badge" style="color:${typeColors[en.gtTypeStr]||'#888'}">${_e(en.gtTypeStr)}</span>` +
            `<span class="gtpick-label">${_e(en.label || `(NS slot ${en.slot})`)}</span>` +
            `</div>`
          ).join('')
        : '<div style="color:#666;padding:0.5rem;font-size:0.75rem;font-style:italic">No NS entries found — boot the machine first.</div>';

    const permsLabels = ['R','W','X','L','S','E'];
    const permsHtml = permsLabels.map((p, i) =>
        `<label class="gtpick-perm-lbl" title="${{R:'Read',W:'Write',X:'Execute',L:'Load',S:'Store',E:'Enter'}[p]}">` +
        `<input type="checkbox" id="gtpick-perm-${p}" value="${i}" checked> ${p}</label>`
    ).join('');

    const modal = document.createElement('div');
    modal.id = 'gt-slot-picker-modal';
    modal.className = 'gtpick-backdrop';
    modal.innerHTML = `
<div class="gtpick-panel" onclick="event.stopPropagation()">
  <div class="gtpick-header">
    <span class="gtpick-title">Assign capability to slot #${slotIndex}</span>
    <button class="gtpick-close" onclick="document.getElementById('gt-slot-picker-modal').remove()" title="Cancel">✕</button>
  </div>

  <div class="gtpick-selected-bar" id="gtpick-selected-bar" style="display:none">
    <span class="gtpick-sel-label" id="gtpick-sel-label"></span>
    <span class="gtpick-sel-slot"  id="gtpick-sel-slot"></span>
  </div>

  <input class="gtpick-search" id="gtpick-search" type="text" placeholder="Search by name or slot number…" oninput="_gtPickFilter()" autocomplete="off">

  <div class="gtpick-list" id="gtpick-list">${entriesHtml}</div>

  <div class="gtpick-opts">
    <div class="gtpick-opt-row">
      <span class="gtpick-opt-label">Type</span>
      <select id="gtpick-type" class="gtpick-select">
        <option value="1" selected>Inform (data / read-only cap)</option>
        <option value="2">Outform (code / callable cap)</option>
      </select>
    </div>
    <div class="gtpick-opt-row">
      <span class="gtpick-opt-label">Permissions</span>
      <span class="gtpick-perms">${permsHtml}</span>
    </div>
  </div>

  <div class="gtpick-footer">
    <button class="gtpick-btn gtpick-btn-assign" id="gtpick-assign-btn" disabled onclick="_gtPickCommit('${_e(lumpToken)}',${slotIndex})">Assign GT</button>
    <button class="gtpick-btn gtpick-btn-cancel" onclick="document.getElementById('gt-slot-picker-modal').remove()">Cancel</button>
    <span class="gtpick-new-hint">New LUMP? <a href="#" onclick="document.getElementById('gt-slot-picker-modal').remove();_switchTab('compile');return false;">Open compiler →</a></span>
  </div>
</div>`;

    modal.addEventListener('click', () => modal.remove());
    document.body.appendChild(modal);

    // Track selected NS slot
    window._gtPickState = { nsSlot: null, gtSeq: 0 };
    document.getElementById('gtpick-search').focus();
}

function _gtPickSelect(nsSlot, word2, label, typeStr) {
    window._gtPickState = { nsSlot, gtSeq: (word2 >>> 25) & 0x7F };
    const bar    = document.getElementById('gtpick-selected-bar');
    const labEl  = document.getElementById('gtpick-sel-label');
    const slotEl = document.getElementById('gtpick-sel-slot');
    if (bar && labEl && slotEl) {
        labEl.textContent  = label || `NS slot ${nsSlot}`;
        slotEl.textContent = ` · NS #${nsSlot} · ${typeStr}`;
        bar.style.display  = 'flex';
    }
    document.querySelectorAll('.gtpick-row').forEach(r => r.classList.toggle('gtpick-row-sel', parseInt(r.dataset.slot) === nsSlot));
    const btn = document.getElementById('gtpick-assign-btn');
    if (btn) btn.disabled = false;
}

function _gtPickFilter() {
    const q = (document.getElementById('gtpick-search')?.value || '').toLowerCase();
    document.querySelectorAll('.gtpick-row').forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = (!q || text.includes(q)) ? '' : 'none';
    });
}

async function _gtPickCommit(lumpToken, slotIndex) {
    const state = window._gtPickState || {};
    if (state.nsSlot === null || state.nsSlot === undefined) return;

    const typeEl  = document.getElementById('gtpick-type');
    const gtType  = typeEl ? parseInt(typeEl.value) : 1;
    const permsLabels = ['R','W','X','L','S','E'];
    let perms = 0;
    permsLabels.forEach((p, i) => {
        if (document.getElementById(`gtpick-perm-${p}`)?.checked) perms |= (1 << i);
    });

    // Build GT word: bits[30:25]=perms  bits[24:23]=type  bits[22:16]=gt_seq  bits[15:0]=ns_slot
    const gt_word = (((perms & 0x3F) << 25) | ((gtType & 0x3) << 23) |
                     ((state.gtSeq & 0x7F) << 16) | (state.nsSlot & 0xFFFF)) >>> 0;

    const btn = document.getElementById('gtpick-assign-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    try {
        const resp = await fetch(`/api/lump/${lumpToken}/clist/${slotIndex}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gt_word }),
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) throw new Error(data.error || 'Server error');

        document.getElementById('gt-slot-picker-modal')?.remove();

        // Reload the content tab to reflect the newly assigned GT
        const selLump = _lumpsCache && _lumpsCache.find(l => (l.token || '').toLowerCase() === lumpToken.toLowerCase());
        if (selLump) {
            const tk = (selLump.token || '').replace(/[^a-z0-9]/gi, '');
            _lumpContentLoaded[tk] = false;   // force fresh fetch
            _switchLumpTab(tk, 'content');
        }
    } catch (err) {
        if (btn) { btn.disabled = false; btn.textContent = 'Assign GT'; }
        alert(`Failed to assign GT: ${err.message}`);
    }
}

