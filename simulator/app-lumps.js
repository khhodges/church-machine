function showLumpDetail(token) {
    _lumpEditDirty = false;
    _selectedLumpToken = token;
    if (typeof _lumpRecordView === 'function') _lumpRecordView(token);
    if (typeof _updateLumpViewingLabel === 'function') _updateLumpViewingLabel(token);
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

    // ── Lump header strip — chips + inline action buttons ─────────────────────
    const _e = _escHtml;
    const _isCodeLump = !isNamespace && (lump.content_type === 'code' || lump.language === 'assembly' || lump.language === 'cloomc');
    let _headerStrip = `<div class="lump-header-strip">`;
    _headerStrip += _lumpTypeBadge(lump);
    _headerStrip += `<span class="lump-hs-chip"><span class="lump-hs-label">Token</span>0x${_e(lump.token || '')}</span>`;
    if (lump.ns_slot !== null && lump.ns_slot !== undefined)
        _headerStrip += `<span class="lump-hs-chip"><span class="lump-hs-label">NS</span>${parseInt(lump.ns_slot)}</span>`;
    {
        const _verNum = lump.lump_version != null ? parseInt(lump.lump_version) : null;
        if (_verNum != null)
            _headerStrip += `<span class="lump-hs-chip lump-version-badge" id="lumpVersionBadge_${_tk}"><span class="lump-hs-label">Ver</span>v${_verNum}</span>`;
    }
    if (lump.lump_size)
        _headerStrip += `<span class="lump-hs-chip"><span class="lump-hs-label">Size</span>${parseInt(lump.lump_size)}w</span>`;
    if (lump.cw !== undefined && lump.cw !== null)
        _headerStrip += `<span class="lump-hs-chip" id="lumpCwChip_${_tk}"><span class="lump-hs-label">CW</span>${parseInt(lump.cw)}</span>`;
    if (lump.cc !== undefined && lump.cc !== null)
        _headerStrip += `<span class="lump-hs-chip" id="lumpCcChip_${_tk}"><span class="lump-hs-label">CC</span>${parseInt(lump.cc)}</span>`;
    if (!isNamespace)
        _headerStrip += `<span class="lump-malformed-chip" id="lumpMalformedChip_${_tk}" style="display:none" title="Click Edit to repair with canonical source">\u26a0 Binary may be malformed<button class="lump-malformed-chip-dismiss" onclick="this.parentElement.style.display='none'" title="Dismiss">\u00d7</button></span>`;
    // ── Inline actions group (pushed right by margin-left:auto) ───────────────
    _headerStrip += `<div class="lump-hs-actions">`;
    if (!isNamespace) {
        _headerStrip += `<button class="lump-hs-btn lump-edit-btn" data-edit-token="${_e(token)}" title="Edit \u2014 Open the code editor">&#9998; Edit</button>`;
        _headerStrip += `<button class="lump-hs-btn lump-audit-btn" data-audit-token="${_e(token)}" title="Audit \u2014 Run pre-save consistency checks">\u2699 Audit</button>`;
        if (_isCodeLump) {
            _headerStrip += `<button class="lump-hs-btn lump-hs-btn-run" id="lumpWsRunBtn" onclick="_runSelectedLumpInSim(this)" title="Run in Simulator \u2014 Load binary into simulator">&#x25b6; Run</button>`;
        }
    }
    // Shrink button
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
            `id="lumpShrinkBtn_${_tk}" ` +
            `onclick="${_canShrink ? `_resizeLump('${_e(lump.token)}')` : ''}" ` +
            `${_canShrink ? '' : 'disabled '}` +
            `title="${_canShrink ? `Remove unused freespace — shrink from ${_curSize}w to ${_minSize}w (save ${_saved}w)` : `Already at minimum size (${_curSize}w)`}">` +
            `Shrink to ${_minSize}w ▼</button>`;
    }
    _headerStrip += `<button class="btn lump-delete-btn lump-hs-delete-btn" data-delete-token="${_e(token)}" title="Delete this lump">&#128465;</button>`;
    _headerStrip += `</div>`;
    _headerStrip += `</div>`;
    _headerStrip += `<div class="lump-audit-results-wrap" id="lumpAuditResults_${_tk}"></div>`;

    // ── Single merged tab bar: Logic + CLOOMC + binary detail tabs ─────────────
    let _tabBar = `<div class="lump-tabs-bar" id="lumpTabBar_${_tk}">`;
    if (!isNamespace) {
        _tabBar += `<button class="lump-tab" onclick="_switchLumpTab('${_tk}','logic')">Logic</button>`;
        _tabBar += `<button class="lump-tab" onclick="_switchLumpTab('${_tk}','api')">API</button>`;
        _tabBar += `<button class="lump-tab${lump.forked ? ' lump-tab-active' : ''}" id="lumpTabBtnClooms_${_tk}" onclick="_switchLumpTab('${_tk}','clooms')">CLOOMC<span class="lump-tab-fork-dot" id="lumpTabForkDot_${_tk}" style="display:${lump.forked ? 'inline' : 'none'}" title="Uncompiled — fork in progress"></span></button>`;
    }
    _tabBar += `<button class="lump-tab${isNamespace ? ' lump-tab-active' : ''}" onclick="_switchLumpTab('${_tk}','overview')">Overview</button>`;
    if (!isNamespace) {
        _tabBar += `<button class="lump-tab${(lump.source || lump.source_hash) ? '' : ' lump-tab-dim'}" onclick="_switchLumpTab('${_tk}','source')" title="${(lump.source || lump.source_hash) ? 'View original CLOOMC++ source' : 'No compiled source stored \u2014 LUMP predates source persistence'}">Source</button>`;
        _tabBar += `<button class="lump-tab${!lump.forked ? ' lump-tab-active' : ''}" onclick="_switchLumpTab('${_tk}','content')">Content</button>`;
        _tabBar += `<button class="lump-tab" onclick="_switchLumpTab('${_tk}','tokens')">Tokens</button>`;
        _tabBar += `<button class="lump-tab" onclick="_switchLumpTab('${_tk}','versions')">Versions</button>`;
        _tabBar += `<button class="lump-tab" onclick="_switchLumpTab('${_tk}','history')">History</button>`;
    }
    _tabBar += `<button class="lump-tab" onclick="_switchLumpTab('${_tk}','hexdump')">Hex Dump</button></div>`;

    let html = _headerStrip + _tabBar +
        `<div class="lump-tab-panel" id="lumpTabLogic_${_tk}"></div>` +
        `<div class="lump-tab-panel" id="lumpTabApi_${_tk}"></div>` +
        `<div class="lump-tab-panel${lump.forked && !isNamespace ? ' lump-tab-panel-active' : ''}" id="lumpTabClooms_${_tk}"></div>` +
        `<div class="lump-tab-panel${isNamespace ? ' lump-tab-panel-active' : ''}" id="lumpTabOverview_${_tk}"><div class="lump-detail-sections">`;

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
        html += '<table class="lump-detail-table"><thead><tr><th>Register</th><th>Name</th><th></th></tr></thead><tbody>';
        for (const [reg, name] of Object.entries(drNames)) {
            html += `<tr><td>${e(reg)}</td><td>${e(name)}</td><td></td></tr>`;
        }
        for (const [reg, name] of Object.entries(crNames)) {
            const _crSlot = reg.replace(/^CR/i, '');
            html += `<tr><td>${e(reg)}</td>` +
                `<td id="lump-pn-cr-cell-${_tk}-${e(_crSlot)}" class="lump-pn-name-cell">${e(name)}</td>` +
                `<td><button class="lump-pn-edit-btn" onclick="_lumpOverviewCREdit('${e(token)}','${e(_crSlot)}',this)" title="Rename">&#9998;</button></td>` +
                `</tr>`;
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
        // ── Source tab: pseudo code + compile history from userMethodData ─────
        const _srcAbs = (typeof abstractionRegistry !== 'undefined' && abstractionRegistry && lump.abstraction)
            ? (abstractionRegistry.getByName
                ? abstractionRegistry.getByName(lump.abstraction)
                : (abstractionRegistry.abstractions
                    ? Object.values(abstractionRegistry.abstractions).find(a => a.name === lump.abstraction)
                    : null))
            : null;
        const _srcAbsIdx = _srcAbs ? _srcAbs.index : null;
        const _srcMethods = _srcAbs ? (_srcAbs.methods || []) : [];
        const _srcAnnotate = typeof _annotateAbsCodeHtml === 'function' ? _annotateAbsCodeHtml : e;
        const _srcStaticExamples = (typeof getMethodExamples === 'function' && _srcAbs)
            ? getMethodExamples(_srcAbs) : {};
        const _srcFmtTs = ts => {
            if (!ts) return '\u2014';
            const d = new Date(ts);
            const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
            return `${d.getDate()} ${mo} ${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        };
        let _srcHtml = `<div class="lump-tab-panel" id="lumpTabSource_${_tk}"><div class="lump-source-panel">`;
        // Placeholder filled lazily when the tab is clicked (see _switchLumpTab → source)
        _srcHtml += `<div id="lumpStoredSourceBody_${_tk}" class="lump-stored-src-placeholder"></div>`;
        if (_srcAbsIdx !== null && _srcMethods.length > 0) {
            const _umd = (typeof userMethodData !== 'undefined' && userMethodData) ? userMethodData : {};
            _srcMethods.forEach((mName, _mi) => {
                const mKey = `${_srcAbsIdx}:${mName}`;
                const md = _umd[mKey] || {};
                const _staticEx = _srcStaticExamples[mName] || null;
                const _srcText = md.example || _staticEx;
                const _bodyId = `lumpSrcBody_${_tk}_${_mi}`;
                const _open = _mi === 0;
                // Status badge for header
                let _hdrBadge;
                if (md.compileError)                          _hdrBadge = `<span class="lump-source-status-error">\u2022Error</span>`;
                else if (md.compiled && md.compiled.length)   _hdrBadge = `<span class="lump-source-status-compiled">\u2022Compiled</span>`;
                else                                          _hdrBadge = `<span class="lump-source-status-pseudo">\u2022Pseudo</span>`;
                _srcHtml += `<div class="lump-source-method">`;
                // ── Clickable header row ─────────────────────────────────
                _srcHtml += `<div class="lump-source-method-header" onclick="_lumpSrcToggle('${_bodyId}',this)">`;
                _srcHtml += `<span class="lump-source-method-name">${e(mName)}</span>`;
                _srcHtml += `<div class="lump-source-method-actions">`;
                _srcHtml += `${_hdrBadge}`;
                _srcHtml += `<button class="lump-source-edit-btn" title="Open in editor" onclick="event.stopPropagation();_lumpSrcEditMethod(${_srcAbsIdx},'${mName.replace(/'/g,"\\'")}')">\u270f</button>`;
                _srcHtml += `<span class="lump-source-chevron">${_open ? '\u25bc' : '\u25b6'}</span>`;
                _srcHtml += `</div></div>`;
                // ── Collapsible body ─────────────────────────────────────
                _srcHtml += `<div class="lump-source-method-body" id="${_bodyId}"${_open ? '' : ' style="display:none"'}>`;
                if (_srcText) {
                    _srcHtml += `<pre class="abs-method-panel-code">${_highlightCLOOMCSource(_srcText, lump.language)}</pre>`;
                    _srcHtml += `<div class="lump-source-meta">`;
                    if (md.compileError) {
                        _srcHtml += `<span class="lump-source-status-error">\u2022Error</span> \u2014 ${e(md.compileError.split('\n')[0])}`;
                    } else if (md.compiled && md.compiled.length > 0) {
                        _srcHtml += `<span class="lump-source-status-compiled">\u2022Compiled</span> \u2014 ${md.compiled.length} word${md.compiled.length !== 1 ? 's' : ''}, ${e(md.compiledLang || 'unknown')}, ${e(_srcFmtTs(md.compiledAt))}`;
                    } else {
                        _srcHtml += `<span class="lump-source-status-pseudo">\u2022Pseudo</span>`;
                        _srcHtml += md.example ? ` \u2014 source stored, not yet compiled` : ` \u2014 built-in example`;
                    }
                    _srcHtml += `</div>`;
                } else {
                    _srcHtml += `<div class="lump-source-empty">No source yet \u2014 click \u270f to open in the editor.</div>`;
                }
                const hist = md.history || [];
                if (hist.length > 0) {
                    _srcHtml += `<div class="lump-source-history-header">History (${hist.length})</div>`;
                    _srcHtml += `<div class="lump-source-history-list">`;
                    hist.forEach(hv => {
                        const hvState = hv.compileError ? 'error' : (hv.compiled && hv.compiled.length > 0 ? 'compiled' : 'pseudo');
                        const hvLabel = hvState === 'error' ? '\u2022Error' : hvState === 'compiled' ? '\u2022Compiled' : '\u2022Pseudo';
                        const hvWords = hv.compiled ? hv.compiled.length : 0;
                        _srcHtml += `<div class="lump-source-history-entry">`;
                        _srcHtml += `<span class="abs-compile-state-badge abs-compile-state-${hvState}">${hvLabel}</span>`;
                        _srcHtml += `<span class="lump-source-history-ts">${e(_srcFmtTs(hv.savedAt))}</span>`;
                        if (hvWords > 0) _srcHtml += ` <span class="lump-source-history-words">${hvWords}w</span>`;
                        if (hv.src) _srcHtml += `<pre class="abs-method-panel-code lump-source-history-code">${_highlightCLOOMCSource(hv.src, lump.language)}</pre>`;
                        _srcHtml += `</div>`;
                    });
                    _srcHtml += `</div>`;
                }
                _srcHtml += `</div>`; // close body
                _srcHtml += `</div>`; // close method
            });
        } else if (_srcAbsIdx === null) {
            _srcHtml += `<div class="lump-source-empty lump-source-empty-pad">No abstraction registry entry found for \u201c${e(lump.abstraction || '')}\u201d \u2014 open the Abstractions view and add methods to see source here.</div>`;
        } else {
            _srcHtml += `<div class="lump-source-empty lump-source-empty-pad">No methods defined on this abstraction yet.</div>`;
        }
        _srcHtml += `</div></div>`;
        html += _srcHtml;

        html += `<div class="lump-tab-panel${!isNamespace && !lump.forked ? ' lump-tab-panel-active' : ''}" id="lumpTabContent_${_tk}">` +
                `<div id="lumpContentBody_${_tk}" class="lump-hex-loading">Loading\u2026</div></div>`;
        html += `<div class="lump-tab-panel" id="lumpTabTokens_${_tk}">` +
                `<div id="lumpTokensBody_${_tk}" class="lump-hex-loading">Loading\u2026</div></div>`;
        html += `<div class="lump-tab-panel" id="lumpTabVersions_${_tk}">` +
                `<div id="lumpVersionsBody_${_tk}" class="lump-hex-loading">Loading\u2026</div></div>`;
        html += `<div class="lump-tab-panel" id="lumpTabHistory_${_tk}">` +
                `<div id="lumpHistoryBody_${_tk}" class="lump-hex-loading">Loading\u2026</div></div>`;
    }
    html += `<div class="lump-tab-panel" id="lumpTabHexdump_${_tk}">` +
            `<div id="lumpBinBody_${_tk}" class="lump-hex-loading">Loading\u2026</div></div>`;

    contentEl.innerHTML = html;
    // Asynchronously patch CC badge + shrink button + malformed chip from binary.
    if (!isNamespace) _patchCcFromBinary(token, lump, _tk);
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

    // Passive malformed-binary check — shows amber chip in header without requiring Edit click.
    if (!isNamespace) _checkLumpBinaryHealth(token, lump, _tk);

    // Outer workspace tab bar is collapsed into the inner tab bar — always hide it
    _hideLumpWorkspaceTabs();
}

// Fetch binary words, parse the lump header, and patch the CC badge / shrink button /
// malformed chip in the already-rendered header strip.  Fires after contentEl.innerHTML
// so the DOM elements already exist.  Also populates _lumpBinaryHdrCache[token] for
// later reuse by _renderLumpCodeContent and _loadLumpTokens.
async function _patchCcFromBinary(token, lump, tk) {
    if (!token || !lump) return;
    try {
        let words = [];
        // Reuse cached entry when available (avoids a second round-trip when the
        // Content or Tokens tab was already loaded for this token).
        const _cached = _lumpBinaryHdrCache[token];
        if (_cached && _cached.hdr && _cached.hdr.valid) {
            words = _cached.words || [];
        } else {
            const resp = await fetch(`/api/lump/${token}/words`);
            if (!resp.ok) return;
            const data = await resp.json();
            words = data.words || [];
        }
        if (!words.length) return;
        const hdr = (typeof sim !== 'undefined' && sim && sim.parseLumpHeader)
            ? sim.parseLumpHeader(words[0] >>> 0) : null;
        if (!hdr || !hdr.valid) return;
        _lumpBinaryHdrCache[token] = { hdr, words };

        // ── Patch CC badge ───────────────────────────────────────────────────
        const ccBadge = document.getElementById(`lumpCcChip_${tk}`);
        if (ccBadge) {
            ccBadge.innerHTML = `<span class="lump-hs-label">CC</span>${hdr.cc}`;
        }

        // ── Patch shrink button ──────────────────────────────────────────────
        const shrinkBtn = document.getElementById(`lumpShrinkBtn_${tk}`);
        if (shrinkBtn) {
            const _curSize = parseInt(lump.lump_size) || 0;
            const _cw      = parseInt(lump.cw) || 0;
            const _cc      = hdr.cc;
            const _minCont = 1 + _cw + _cc;
            let _minSize   = 64;
            while (_minSize < _minCont) _minSize *= 2;
            const _canShrink = _curSize > _minSize;
            const _saved     = _curSize - _minSize;
            shrinkBtn.className = `lump-hs-resize-btn${_canShrink ? '' : ' lump-hs-resize-disabled'}`;
            shrinkBtn.disabled  = !_canShrink;
            shrinkBtn.onclick   = _canShrink ? () => _resizeLump(lump.token) : null;
            shrinkBtn.title     = _canShrink
                ? `Remove unused freespace — shrink from ${_curSize}w to ${_minSize}w (save ${_saved}w)`
                : `Already at minimum size (${_curSize}w)`;
            shrinkBtn.textContent = `Shrink to ${_minSize}w ▼`;
        }

        // ── Show malformed chip when binary cc ≠ manifest cc ────────────────
        const manifestCc = (lump.cc !== undefined && lump.cc !== null) ? parseInt(lump.cc) : null;
        if (manifestCc !== null && manifestCc !== hdr.cc) {
            const chip = document.getElementById(`lumpMalformedChip_${tk}`);
            if (chip) chip.style.display = '';
        }
    } catch (_e) { /* silent — best-effort patch */ }
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

// Fetches the lump's words and reveals the amber "Binary may be malformed" chip
// in the card header if parseLumpHeader reports invalid or the array is empty.
// Fires passively on every showLumpDetail so the user sees the warning without
// having to click Edit.
async function _checkLumpBinaryHealth(token, lump, tk) {
    try {
        const resp = await fetch('/api/lump/' + token + '/words', { cache: 'no-store' });
        if (!resp.ok) return;
        const data = await resp.json();
        const words = data.words || [];
        let malformed = words.length === 0;
        if (!malformed) {
            const hdr = (typeof sim !== 'undefined' && sim && sim.parseLumpHeader)
                ? sim.parseLumpHeader(words[0] >>> 0) : null;
            if (hdr && !hdr.valid) {
                malformed = true;
            } else if (hdr) {
                // Overwrite CW / CC chips with values from the authoritative binary header,
                // so the header strip always reflects the binary even when the manifest cache
                // is stale (e.g. after an in-place recompile that changed cc or cw).
                const cwChip = document.getElementById('lumpCwChip_' + tk);
                const ccChip = document.getElementById('lumpCcChip_' + tk);
                if (cwChip) cwChip.innerHTML = '<span class="lump-hs-label">CW</span>' + hdr.cw;
                if (ccChip) ccChip.innerHTML = '<span class="lump-hs-label">CC</span>' + hdr.cc;
            }
        }
        if (malformed) {
            const chip = document.getElementById('lumpMalformedChip_' + tk);
            if (chip) chip.style.display = '';
        }
    } catch (_err) {}
}

// Set to false to disable the automatic audit that runs whenever a lump is selected.
let _lumpAutoAuditEnabled = true;

const _lumpActiveTab      = {};
const _lumpContentLoaded      = {};
const _lumpHexLoaded          = {};
const _lumpTokensLoaded       = {};
const _lumpEditorOpen         = {};
const _lumpEditorDraftText = {};
// Cache of binary-derived lump header info, keyed by token.
// Populated by _patchCcFromBinary and reused by _renderLumpCodeContent / _loadLumpTokens.
const _lumpBinaryHdrCache = {};

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

function _runSelectedLumpInSim(btn) {
    if (!_selectedLumpToken) return;
    const lump = _lumpsCache.find(l => l.token === _selectedLumpToken);
    if (!lump) return;
    // Always force NS slot 3 (Boot.Abstr) for interactive execution.
    // CR14 is the code register and always points to the boot-entry slot (3)
    // after boot.  If we loaded into the lump's own ns_slot (which may be any
    // slot 4-63), CR14.word0 would still encode slot 3 and the first fetch
    // would fail a RANGE check against the old LED-flash lump bounds — the
    // classic "LED flash LUMP stays in place" bug.  Passing null forces
    // loadLumpBinary to target BOOT_ABSTR_NS_SLOT so the new code is reachable
    // via CR14 immediately.
    _loadLumpBinaryIntoSim(_selectedLumpToken, lump.abstraction || _selectedLumpToken, btn, null);
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

let _logicCatalogSearch = '';

function _lumpCatalogHighlight(text, q) {
    if (!text) return '';
    const escaped = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    if (!q) return escaped(text);
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let result = '';
    let last = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
        result += escaped(text.slice(last, m.index));
        result += `<mark class="abs-search-highlight">${escaped(m[0])}</mark>`;
        last = m.index + m[0].length;
    }
    result += escaped(text.slice(last));
    return result;
}

function _lumpLogicCatalogSearchInput() {
    _logicCatalogSearch = document.getElementById('lumpLogicCatalogSearch')?.value || '';
    _populateLumpLogicCatalog();
}

function _populateLumpLogicCatalog() {
    const el = document.getElementById('lumpWsLogicContent');
    if (!el) return;
    if (typeof abstractionRegistry === 'undefined' || !abstractionRegistry) {
        el.innerHTML = '<div class="lump-logic-section"><div class="lump-logic-desc">Abstraction catalog not loaded.</div></div>';
        return;
    }

    const all = Object.values(abstractionRegistry.abstractions)
        .sort((a, b) => a.name.localeCompare(b.name));
    const q = _logicCatalogSearch.toLowerCase().trim();
    const filtered = q
        ? all.filter(a => a.name.toLowerCase().includes(q) || (a.description || '').toLowerCase().includes(q))
        : all;

    let html = `<div class="lump-logic-catalog-header" style="display:flex;align-items:center;gap:0.5rem;padding:8px 10px;">`;
    html += `<input type="text" id="lumpLogicCatalogSearch" class="abs-search-input" style="flex:1;font-size:0.72rem;" placeholder="Search abstractions\u2026" oninput="_lumpLogicCatalogSearchInput()" value="${q.replace(/"/g, '&quot;')}">`;
    html += `<span class="abs-search-count">${filtered.length}\u202f/\u202f${all.length}</span>`;
    html += `</div>`;

    html += `<div class="abs-layer-items">`;
    for (const abs of filtered) {
        const best = (typeof _implStatusBest === 'function') ? _implStatusBest(abs) : 'pseudo';
        const dotColor = (typeof IMPL_STATUS_COLORS !== 'undefined') ? (IMPL_STATUS_COLORS[best] || '#9ca3af') : '#9ca3af';
        const dotTitle = (typeof IMPL_STATUS_LABELS !== 'undefined') ? (IMPL_STATUS_LABELS[best] || best) : best;
        const absProfile = (typeof _getAbstractionProfile === 'function') ? _getAbstractionProfile(abs) : 'IoT';
        const profileBadgeClass = absProfile === 'Full' ? 'profile-badge-full' : absProfile === 'XC7A100T' ? 'profile-badge-xc7a100t' : 'profile-badge-iot';
        const matchLump = (typeof _lumpsCache !== 'undefined' ? _lumpsCache : []).find(l => l.abstraction === abs.name);
        const compiledAt = matchLump?.compiled_at
            ? new Date(matchLump.compiled_at * 1000).toLocaleString(undefined, {month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit'})
            : null;
        const mtbf = matchLump?.mtbf || {};
        const mtbfSt = mtbf.status || 'unknown';
        const isUnknownMtbf = mtbfSt === 'unknown' || mtbfSt === 'untested';
        const mtbfClass = mtbfSt === 'green' ? 'mtbf-green' : mtbfSt === 'amber' ? 'mtbf-amber' : mtbfSt === 'red' ? 'mtbf-red' : 'mtbf-unknown';
        const mtbfLabel = isUnknownMtbf ? '?' : mtbfSt.toUpperCase();
        const _lumpVer = matchLump ? (matchLump.lump_version != null ? matchLump.lump_version : (matchLump.version != null ? matchLump.version : 0)) : 0;
        const _lumpTk = matchLump ? _escHtml(matchLump.token || '') : '';
        const _isGold = _lumpVer > 0;
        const _badgeClass = _isGold ? 'lump-ver-badge lump-ver-badge-gold' : 'lump-ver-badge lump-ver-badge-grey';
        const _clickHandler = _lumpTk
            ? `event.stopPropagation();showLumpDetail('${_lumpTk}');_switchLumpTab('${_lumpTk}','versions')`
            : 'event.stopPropagation()';
        const _badgeCursor = _lumpTk ? '' : ' style="cursor:default"';
        const _badgeTitle = _lumpTk ? 'LUMP version \u2014 click to open Versions tab' : 'LUMP version \u2014 not yet compiled';
        const _verBadgeHtml = `<span class="${_badgeClass}" onclick="${_clickHandler}"${_badgeCursor} title="${_badgeTitle}">v${_lumpVer}</span>`;

        html += `<div class="abs-item" onclick="showAbstractionDetail(${abs.index})" ondblclick="event.stopPropagation();_goToLumpByAbstractionName(abstractionRegistry.getAbstraction(${abs.index}).name)" title="Double-click to jump to this abstraction\u2019s LUMP in the Repository">`;
        html += `<div class="abs-item-row1">`;
        html += `<span class="abs-item-idx">${abs.index}</span>`;
        html += `<span class="abs-item-name">${_lumpCatalogHighlight(abs.name, q)}</span>`;
        html += _verBadgeHtml;
        html += `<span class="abs-profile-badge ${profileBadgeClass}">${absProfile}</span>`;
        if (compiledAt) html += `<span class="abs-item-date" title="Compiled ${compiledAt}">${compiledAt}</span>`;
        if (matchLump) html += `<span class="mtbf-badge lump-mtbf-badge ${mtbfClass}" title="MTBF: ${mtbfSt}">${mtbfLabel}</span>`;
        html += `<span class="abs-item-dot" style="background:${dotColor};box-shadow:0 0 4px ${dotColor}80" title="${dotTitle}"></span>`;
        html += `</div>`;
        html += `<div class="abs-item-desc">${_lumpCatalogHighlight(abs.description, q)}</div>`;
        html += `</div>`;
    }
    html += `</div>`;
    el.innerHTML = html;
    if (q) document.getElementById('lumpLogicCatalogSearch')?.focus();
}

function _populateLumpLogicTab(lump, targetId) {
    const el = document.getElementById(targetId || 'lumpWsLogicContent');
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
        html += `<div class="lump-logic-meta-badge">No catalog entry</div>`;
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

    const profile = (typeof _getAbstractionProfile === 'function') ? _getAbstractionProfile(abs) : (abs.profile || 'IoT');
    const profileClass = profile === 'Full' ? 'profile-badge-full' : profile === 'XC7A100T' ? 'profile-badge-xc7a100t' : 'profile-badge-iot';
    const perms = abs.perms || {};
    const permStr = (perms.B?'B':'')+(perms.R?'R':'')+(perms.W?'W':'')+(perms.X?'X':'')+(perms.L?'L':'')+(perms.S?'S':'')+(perms.E?'E':'') || 'none';
    const _compiledAt = lump.compiled_at
        ? new Date(lump.compiled_at * 1000).toLocaleString(undefined, {month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit'})
        : null;
    const _lMtbf = lump.mtbf || {};
    const _lMtbfSt = _lMtbf.status || 'unknown';
    const _lMtbfUnknown = _lMtbfSt === 'unknown' || _lMtbfSt === 'untested';
    const _lMtbfClass = _lMtbfSt === 'green' ? 'mtbf-green' : _lMtbfSt === 'amber' ? 'mtbf-amber' : _lMtbfSt === 'red' ? 'mtbf-red' : 'mtbf-unknown';
    const _lMtbfLabel = _lMtbfUnknown ? 'UNKNOWN' : _lMtbfSt.toUpperCase();

    let html = '<div class="lump-logic-section">';
    html += `<span class="abs-profile-badge ${profileClass}" style="font-size:0.62rem;">${e(profile)}</span>`;
    if (_compiledAt) html += ` <span class="lump-logic-meta-badge">${e(_compiledAt)}</span>`;
    html += ` <span class="mtbf-badge lump-mtbf-badge ${_lMtbfClass}" title="MTBF: ${_lMtbfSt}">${e(_lMtbfLabel)}</span>`;
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

// ── CLOOMC++ / Assembly source syntax highlighter ─────────────────────────
// Tokenises raw source text and wraps recognised tokens in <span class="lump-hl-*">
// elements.  All characters are HTML-escaped; the result is safe inside <pre>.
//
// language: 'assembly'  → ASM-specific rules (mnemonics, directives, labels).
//           anything else → CLOOMC++ keyword rules.

const _CLOOMC_HL_KEYWORDS = new Set([
    'abstraction','method','capabilities','call','return',
    'let','const','if','else','while','for','new',
    'public','private','protected','import','export',
    'lambda','true','false','null','and','or','not',
    'do','break','continue','in','of','this','self',
    'bind','unbind','delegate','invoke','acquire','release'
]);

const _ASM_HL_MNEMONICS = new Set([
    'mLoad','mSave','ELOADCALL','XLOADLAMBDA','TPERM','LAMBDA',
    'CALL','RETURN','JUMP','BEQ','BNE','BLT','BGE','BGT','BLE',
    'MASK','MOVI','ADDI','ADD','SUB','AND','OR','XOR','NOT','SHL','SHR',
    'NOP','HALT','mLoadI','mSaveI','ELOAD','XLOAD','CALLR','JUMPR',
    'PUSH','POP','MOV','CMP','TEST'
]);

function _highlightCLOOMCSource(rawText, language) {
    if (!rawText) return '';
    const isAsm = (language === 'assembly');
    let html = rawText.split('\n').map(line => _hlCloomcLine(line, isAsm)).join('\n');
    // NS[N] hover annotations — applied after tokenising (NS refs are still plain
    // text at this point, so the regex inside _annotateNsRefInCode will find them).
    if (typeof _annotateNsRefInCode === 'function') html = _annotateNsRefInCode(html);
    return html;
}

function _hlCloomcLine(line, isAsm) {
    let out = '';
    let i = 0;
    const len = line.length;

    while (i < len) {
        const ch = line[i];

        // ── ; comment — rest of line ───────────────────────────────────────
        if (ch === ';') {
            out += `<span class="lump-hl-comment">${_hlEsc(line.slice(i))}</span>`;
            break;
        }

        // ── Double-quoted string literal ───────────────────────────────────
        if (ch === '"') {
            let j = i + 1;
            while (j < len) {
                if (line[j] === '\\') { j += 2; continue; }
                if (line[j] === '"') { j++; break; }
                j++;
            }
            out += `<span class="lump-hl-string">${_hlEsc(line.slice(i, j))}</span>`;
            i = j;
            continue;
        }

        // ── Assembly directive: .identifier ───────────────────────────────
        if (isAsm && ch === '.') {
            let j = i + 1;
            while (j < len && /[a-zA-Z_]/.test(line[j])) j++;
            if (j > i + 1) {
                out += `<span class="lump-hl-directive">${_hlEsc(line.slice(i, j))}</span>`;
                i = j;
                continue;
            }
        }

        // ── Identifier: keyword / mnemonic / register / plain word ────────
        if (/[a-zA-Z_]/.test(ch)) {
            let j = i;
            while (j < len && /[a-zA-Z0-9_]/.test(line[j])) j++;
            const word = line.slice(i, j);
            // Assembly label: word immediately followed by ':'
            if (isAsm && j < len && line[j] === ':') {
                out += `<span class="lump-hl-label">${_hlEsc(word)}:</span>`;
                i = j + 1;
                continue;
            }
            const cls = _hlCloomcWordClass(word, isAsm);
            out += cls ? `<span class="${cls}">${_hlEsc(word)}</span>` : _hlEsc(word);
            i = j;
            continue;
        }

        // ── Hex literal: 0x… ──────────────────────────────────────────────
        if (ch === '0' && i + 1 < len && (line[i + 1] === 'x' || line[i + 1] === 'X')) {
            let j = i + 2;
            while (j < len && /[0-9a-fA-F_]/.test(line[j])) j++;
            out += `<span class="lump-hl-number">${_hlEsc(line.slice(i, j))}</span>`;
            i = j;
            continue;
        }

        // ── Decimal literal ────────────────────────────────────────────────
        if (/[0-9]/.test(ch)) {
            let j = i;
            while (j < len && /[0-9_]/.test(line[j])) j++;
            out += `<span class="lump-hl-number">${_hlEsc(line.slice(i, j))}</span>`;
            i = j;
            continue;
        }

        // ── HTML-special characters ────────────────────────────────────────
        if (ch === '&') { out += '&amp;'; i++; continue; }
        if (ch === '<') { out += '&lt;';  i++; continue; }
        if (ch === '>') { out += '&gt;';  i++; continue; }

        out += ch;
        i++;
    }
    return out;
}

function _hlCloomcWordClass(word, isAsm) {
    if (/^(CR|DR)\d+$/.test(word))              return 'lump-hl-register';
    if (isAsm && _ASM_HL_MNEMONICS.has(word))   return 'lump-hl-mnemonic';
    if (_CLOOMC_HL_KEYWORDS.has(word))          return 'lump-hl-keyword';
    return null;
}

// Minimal HTML escaper for already-sliced source fragments (avoids touching
// spans that the tokeniser has already emitted).
function _hlEsc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

function _lumpIsSealed(lump) {
    // A lump is sealed when it has a compiled binary on the server.
    // Prefer lump_version as the canonical indicator (set by the save path alongside
    // writing the binary). Fall back to compiled_at for legacy/imported lumps that
    // pre-date lump_version tracking. Either field present → binary exists.
    return !!(lump && lump.token && !lump.forked &&
              (lump.lump_version != null || lump.compiled_at != null));
}

async function _populateLumpSourceTab(lump, targetId) {
    const el = document.getElementById(targetId || 'lumpWsSourceContent');
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
        // Async: check if a canonical source exists and append a Reset button if so.
        if (absName) {
            (async () => {
                try {
                    const _cr = await fetch(`/api/lump-source/${encodeURIComponent(absName)}`, { cache: 'no-store' });
                    const _ct2 = _cr.headers.get('content-type') || '';
                    if (_cr.ok && _ct2.includes('application/json')) {
                        const _cj = await _cr.json();
                        if (_cj && !_cj.binary_only && _cj.source) {
                            const _notice = el.querySelector('.lump-source-binary-only-desc');
                            if (_notice) {
                                const _resetBtn = document.createElement('button');
                                _resetBtn.className = 'btn lump-canonical-reset-btn';
                                _resetBtn.textContent = 'Reset to canonical source';
                                _resetBtn.style.marginTop = '0.75rem';
                                _resetBtn.style.display = 'block';
                                _resetBtn.addEventListener('click', () => {
                                    _populateLumpSourceTab(lump, targetId);
                                });
                                _notice.appendChild(_resetBtn);
                            }
                        }
                    }
                } catch (_cfe) {}
            })();
        }
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
            html += `<div class="lump-fork-banner" id="lumpForkBanner" style="display:none"></div>`;
            html += `<textarea class="lump-source-textarea" id="lumpSourceEditor" spellcheck="false" autocorrect="off" autocapitalize="off">${e(src)}</textarea>`;
            html += `<div class="lump-source-status" id="lumpSourceStatus"></div>`;
            el.innerHTML = html;
            const _textarea = el.querySelector('#lumpSourceEditor');
            const _banner   = el.querySelector('#lumpForkBanner');
            if (lump.forked && lump.lump_version != null) {
                // Already forked (tab reopened in-session, or page reloaded with forked sidecar).
                // Show the banner immediately — no keystroke required.
                if (_banner) {
                    const _prevVer = lump.lump_version - 1;
                    _banner.style.display = '';
                    _banner.textContent = `Editing v${lump.lump_version} \u2014 v${_prevVer} compiled binary preserved in Versions tab`;
                }
                const _tk = (lump.token || '').replace(/[^a-z0-9]/gi, '');
                const _dot0 = document.getElementById(`lumpTabForkDot_${_tk}`);
                if (_dot0) _dot0.style.display = '';
                const _badge = document.getElementById(`lumpVersionBadge_${_tk}`);
                if (_badge) _badge.innerHTML = `<span class="lump-hs-label">Ver</span>v${lump.lump_version}`;
            } else if (_lumpIsSealed(lump)) {
                // Sealed and not yet forked — arm the one-shot first-edit listener.
                if (_textarea && _banner) {
                    let _forked = false;
                    const _onFirstEdit = async () => {
                        if (_forked) return;
                        _forked = true;
                        // Defer listener removal until after a successful fork so that
                        // a transient network failure does not permanently disable forking.
                        try {
                            const _resp = await fetch(`/api/lump/${lump.token}/fork-version`, { method: 'POST' });
                            const _fd = await _resp.json();
                            if (!_fd.ok) throw new Error(_fd.error || 'fork failed');
                            // Success — remove listener now that fork is committed.
                            _textarea.removeEventListener('input', _onFirstEdit);
                            const _newVer = _fd.new_version;
                            const _prevVer = _fd.prev_version;
                            _banner.style.display = '';
                            _banner.textContent = `Editing v${_newVer} \u2014 v${_prevVer} compiled binary preserved in Versions tab`;
                            const _tk = (lump.token || '').replace(/[^a-z0-9]/gi, '');
                            const _dot1 = document.getElementById(`lumpTabForkDot_${_tk}`);
                            if (_dot1) _dot1.style.display = '';
                            const _badge = document.getElementById(`lumpVersionBadge_${_tk}`);
                            if (_badge) _badge.innerHTML = `<span class="lump-hs-label">Ver</span>v${_newVer}`;
                            // Update both the local reference and the cache entry so that
                            // (a) _lumpIsSealed returns false, preventing re-fork on tab reopen,
                            // (b) the already-forked branch shows the banner correctly on reopen.
                            lump.forked = true;
                            lump.lump_version = _newVer;
                            const _lumpIdx = _lumpsCache.findIndex(l => l.token === lump.token);
                            if (_lumpIdx !== -1) {
                                _lumpsCache[_lumpIdx].forked = true;
                                _lumpsCache[_lumpIdx].lump_version = _newVer;
                            }
                            delete _lumpVersionsLoaded[_tk];
                        } catch (_err) {
                            // Network/server failure — reset so the next keystroke retries.
                            _forked = false;
                            console.warn('[lump fork] fork-version failed, will retry on next edit:', _err);
                        }
                    };
                    _textarea.addEventListener('input', _onFirstEdit);
                }
            }
        } else {
            _showBinaryOnly('was compiled from RAW ISA or assembly and has no CLOOMC++ pet-name source on file. The Binary tab shows the compiled form.');
        }
    } catch (err) {
        el.innerHTML = `<div class="lump-source-status err">Error loading source: ${e(err.message)}</div>`;
    }
}

// Toggle a Source-tab method body open/closed
function _lumpSrcToggle(bodyId, headerEl) {
    const body = document.getElementById(bodyId);
    if (!body) return;
    const open = body.style.display === 'none';
    body.style.display = open ? '' : 'none';
    const chev = headerEl && headerEl.querySelector('.lump-source-chevron');
    if (chev) chev.textContent = open ? '\u25bc' : '\u25b6';
}

// Open a LUMP method in the assembly editor (without requiring Abstractions tab DOM)
function _lumpSrcEditMethod(absIdx, mName) {
    const key = `${absIdx}:${mName}`;
    const abs = (typeof abstractionRegistry !== 'undefined' && abstractionRegistry)
        ? abstractionRegistry.getAbstraction(absIdx) : null;
    let code;
    if (userMethodData && userMethodData[key] && userMethodData[key].example) {
        code = userMethodData[key].example;
    } else {
        const examples = (abs && typeof getMethodExamples === 'function')
            ? getMethodExamples(abs) : {};
        code = (examples && examples[mName])
            || `; ${abs ? abs.name + '.' : ''}${mName}\n; Write CLOOMC++ assembly here and click Compile & Save.\n`;
    }
    if (typeof switchView === 'function') switchView('editor');
    const sel = document.getElementById('langSelector');
    if (sel) sel.value = 'assembly';
    const asmEd = document.getElementById('asmEditor');
    if (asmEd) {
        asmEd.value = code;
        if (typeof updateLineNumbers === 'function') updateLineNumbers();
    }
    const outEl = document.getElementById('assemblyOutput');
    if (outEl) outEl.innerHTML = '';
    window._pseudoEditContext = { absIdx: absIdx, methodName: mName };
    if (typeof updateSavePseudoBtn === 'function') updateSavePseudoBtn();
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
        const _forkBanner = document.getElementById('lumpForkBanner');
        if (_forkBanner) _forkBanner.style.display = 'none';
        document.querySelectorAll('[id^="lumpTabForkDot_"]').forEach(d => { d.style.display = 'none'; });
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
        if (asmEd && typeof compileAndBuild === 'function') {
            const prev = asmEd.value;
            asmEd.value = src;
            compileAndBuild();
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

const _lumpVersionsLoaded = {};
const _lumpHistoryLoaded  = {};

function _switchLumpTab(tk, tab) {
    _lumpActiveTab[tk] = tab;
    const tabMap = {
        logic: `lumpTabLogic_${tk}`,
        api: `lumpTabApi_${tk}`,
        clooms: `lumpTabClooms_${tk}`,
        overview: `lumpTabOverview_${tk}`,
        source: `lumpTabSource_${tk}`,
        content: `lumpTabContent_${tk}`,
        tokens: `lumpTabTokens_${tk}`,
        versions: `lumpTabVersions_${tk}`,
        history: `lumpTabHistory_${tk}`,
        hexdump: `lumpTabHexdump_${tk}`,
    };
    Object.entries(tabMap).forEach(([t, id]) => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('lump-tab-panel-active', t === tab);
    });
    const bar = document.getElementById(`lumpTabBar_${tk}`);
    if (bar) {
        const btns = bar.querySelectorAll('.lump-tab');
        btns.forEach(btn => {
            const labelMap = { logic: 'Logic', api: 'API', clooms: 'CLOOMC', overview: 'Overview', source: 'Source', content: 'Content', tokens: 'Tokens', versions: 'Versions', history: 'History', hexdump: 'Hex Dump' };
            btn.classList.toggle('lump-tab-active', btn.textContent.trim() === labelMap[tab]);
        });
    }
    const lump = _lumpsCache.find(l => (l.token || '').replace(/[^a-z0-9]/gi, '') === tk);
    const token = lump ? lump.token : tk;
    if (tab === 'logic' && lump) {
        _populateLumpLogicTab(lump, `lumpTabLogic_${tk}`);
    }
    if (tab === 'api' && lump) {
        _populateLumpApiTab(lump, `lumpTabApi_${tk}`);
    }
    if (tab === 'clooms' && lump) {
        _populateLumpSourceTab(lump, `lumpTabClooms_${tk}`);
    }
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
    if (tab === 'versions' && !_lumpVersionsLoaded[tk] && lump) {
        _lumpVersionsLoaded[tk] = true;
        _fetchAndShowLumpVersions(token, lump);
    }
    if (tab === 'history' && !_lumpHistoryLoaded[tk] && lump) {
        _lumpHistoryLoaded[tk] = true;
        _fetchAndShowLumpHistory(token, lump);
    }
    if (tab === 'source' && lump) {
        _fetchAndShowLumpSavedSource(token, lump, tk);
    }
}

function _populateLumpApiTab(lump, panelId) {
    const el = document.getElementById(panelId);
    if (!el || el._apiLoaded) return;
    el._apiLoaded = true;
    const e = _escHtml;
    const nsSlot = (lump.ns_slot !== null && lump.ns_slot !== undefined) ? parseInt(lump.ns_slot) : null;
    const grants  = lump.grants || [];
    const methods = lump.methods || [];
    const caps    = lump.capabilities || [];
    const cc      = parseInt(lump.cc) || 0;
    const cw      = parseInt(lump.cw) || 0;
    const sz      = parseInt(lump.lump_size) || 0;
    const mtbf    = lump.mtbf || {};

    let html = '<div class="lump-detail-sections">';

    // ── 1. Call Contract ────────────────────────────────────────────────────
    html += '<div class="lump-detail-section">';
    html += '<div class="lump-section-title">Call Contract</div>';
    html += '<table class="lump-detail-table"><tbody>';
    if (nsSlot !== null) {
        html += `<tr><td>NS Slot</td><td><strong>${nsSlot}</strong> \u2014 invoke via <code>CALL CRd, CR6, ${nsSlot}</code></td></tr>`;
    } else {
        html += `<tr><td>NS Slot</td><td><span style="color:var(--text-secondary);font-style:italic;">Floating \u2014 loaded by token 0x${e(lump.token || '')}</span></td></tr>`;
    }
    const permStr = grants.length ? grants.join('\u00a0|\u00a0') : '\u2014';
    html += `<tr><td>Caller Grants</td><td><strong>${e(permStr)}</strong></td></tr>`;
    html += `<tr><td>Token</td><td><code>0x${e(lump.token || '')}</code></td></tr>`;
    if (lump.profile)  html += `<tr><td>Profile</td><td>${e(lump.profile)}</td></tr>`;
    if (lump.language) html += `<tr><td>Language</td><td>${e(lump.language)}</td></tr>`;
    html += `<tr><td>Layout</td><td>${cw} code word${cw !== 1 ? 's' : ''} \u00b7 ${cc} c-list slot${cc !== 1 ? 's' : ''} \u00b7 ${sz} word${sz !== 1 ? 's' : ''} total</td></tr>`;
    html += '</tbody></table>';
    html += '</div>';

    // ── 2. Methods ───────────────────────────────────────────────────────────
    html += '<div class="lump-detail-section">';
    html += `<div class="lump-section-title">Methods (${methods.length})</div>`;
    if (methods.length === 0) {
        html += '<div style="color:var(--text-secondary);font-style:italic;font-size:0.83rem;padding:0.25rem 0;">No methods declared in sidecar record.</div>';
    } else {
        html += '<table class="lump-detail-table"><thead><tr><th>#</th><th>Name</th><th>Offset</th><th>Words</th></tr></thead><tbody>';
        methods.forEach((m, i) => {
            const mname = m.name || `method_${i}`;
            html += `<tr>`;
            html += `<td style="color:var(--text-secondary);font-size:0.78rem;">${i}</td>`;
            html += `<td><strong>${e(mname)}</strong>`;
            if (m.description) html += `<br><span style="font-size:0.74rem;color:var(--text-secondary);">${e(m.description)}</span>`;
            html += `</td>`;
            html += `<td><code>+${m.offset !== undefined ? m.offset : i}</code></td>`;
            html += `<td>${m.length !== undefined ? m.length : '\u2014'}</td>`;
            html += `</tr>`;
        });
        html += '</tbody></table>';
    }
    html += '</div>';

    // ── 3. C-List / Capabilities ─────────────────────────────────────────────
    html += '<div class="lump-detail-section">';
    html += `<div class="lump-section-title">Capabilities \u2014 C-List (cc\u202f=\u202f${cc})</div>`;
    if (cc === 0) {
        html += '<div style="color:var(--text-secondary);font-style:italic;font-size:0.83rem;padding:0.25rem 0;">cc\u202f=\u202f0 \u2014 no private c-list; uses ambient boot c-list at runtime.</div>';
    } else {
        html += '<table class="lump-detail-table"><thead><tr><th>Slot</th><th>Name</th><th>GT Word</th><th>Role</th></tr></thead><tbody>';
        for (let si = 0; si < cc; si++) {
            const cap  = caps.find(c => c.slot === si);
            const name = cap ? (cap.name || '\u2014') : '\u2014';
            const gtRaw = cap ? (cap.gt || '') : '';
            const isNull = !gtRaw || gtRaw === '0x00000000';
            const gtDisplay = isNull
                ? (cap && cap.initial === 'NULL_GT' ? '<span style="color:var(--text-secondary);font-style:italic;">NULL \u2014 runtime</span>' : '\u2014')
                : `<code>${e(gtRaw)}</code>`;
            const note  = cap ? (cap.filled_by ? `Filled by ${cap.filled_by}` : (cap.note || '')) : '';
            const wired = cap && cap.wired_at_boot ? '\u00a0<span style="color:#22c55e;font-size:0.7rem;">\u26a1\u202fboot</span>' : '';
            html += `<tr>`;
            html += `<td style="font-family:monospace;color:#818cf8;">[${si}]</td>`;
            html += `<td><strong style="color:#C89B3C;">${e(name)}</strong>${wired}</td>`;
            html += `<td>${gtDisplay}</td>`;
            html += `<td style="font-size:0.75rem;color:var(--text-secondary);">${e(note)}</td>`;
            html += `</tr>`;
        }
        html += '</tbody></table>';
    }
    html += '</div>';

    // ── 4. Reliability ───────────────────────────────────────────────────────
    if (mtbf.total_runs !== undefined || mtbf.status) {
        html += '<div class="lump-detail-section">';
        html += '<div class="lump-section-title">Reliability</div>';
        html += '<table class="lump-detail-table"><tbody>';
        const stColor = mtbf.status === 'stable' ? '#22c55e' : mtbf.status === 'amber' ? '#f59e0b' : mtbf.status === 'red' ? '#ef4444' : 'var(--text-secondary)';
        html += `<tr><td>Status</td><td style="color:${stColor};font-weight:600;">${e(mtbf.status || 'unknown')}</td></tr>`;
        if (mtbf.consecutive_clean !== undefined) html += `<tr><td>Clean runs</td><td>${parseInt(mtbf.consecutive_clean) || 0}</td></tr>`;
        if (mtbf.total_runs       !== undefined) html += `<tr><td>Total runs</td><td>${parseInt(mtbf.total_runs) || 0}</td></tr>`;
        if (mtbf.source_hash) html += `<tr><td>Source hash</td><td><code>${e(mtbf.source_hash)}</code></td></tr>`;
        html += '</tbody></table>';
        html += '</div>';
    }

    // ── 5. Identity ──────────────────────────────────────────────────────────
    html += '<div class="lump-detail-section">';
    html += '<div class="lump-section-title">Identity</div>';
    html += '<table class="lump-detail-table"><tbody>';
    html += `<tr><td>Abstraction</td><td>${e(lump.abstraction || '\u2014')}</td></tr>`;
    if (lump.author)  html += `<tr><td>Author</td><td>${e(lump.author)}</td></tr>`;
    if (lump.version) html += `<tr><td>Version</td><td>${e(lump.version)}</td></tr>`;
    if (lump.compiled_at) {
        const d = new Date(lump.compiled_at * 1000).toLocaleString(undefined, {month:'short', day:'numeric', year:'numeric'});
        html += `<tr><td>Compiled</td><td>${e(d)}</td></tr>`;
    }
    if (lump.release_notes) html += `<tr><td>Notes</td><td>${e(lump.release_notes)}</td></tr>`;
    html += '</tbody></table>';
    html += '</div>';

    html += '</div>';
    el.innerHTML = html;
}

const _lumpSavedSrcLoaded = {};
async function _fetchAndShowLumpSavedSource(token, lump, tk) {
    const _tk = (tk || token || '').replace(/[^a-z0-9]/gi, '');
    if (_lumpSavedSrcLoaded[_tk]) return;
    _lumpSavedSrcLoaded[_tk] = true;
    const el = document.getElementById(`lumpStoredSourceBody_${_tk}`);
    if (!el) return;
    const e = _escHtml;
    try {
        const resp = await fetch(`/api/lumps/${token}/detail`, { cache: 'no-store' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (data.source && data.source.trim().length > 0) {
            const _lang = e(data.language || lump.language || 'cloomc');
            const _compiledAt = data.compiled_at
                ? (() => {
                    const d = new Date(typeof data.compiled_at === 'number'
                        ? data.compiled_at * 1000 : data.compiled_at);
                    const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
                    return `${d.getDate()} ${mo} ${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
                })()
                : null;
            el.innerHTML =
                `<div class="lump-stored-src-section">` +
                `<div class="lump-section-title">Saved Source ` +
                `<span class="lump-stored-src-meta">${_lang}${_compiledAt ? ' \u00b7 compiled ' + _compiledAt : ''}</span>` +
                `</div>` +
                `<pre class="lump-stored-src-pre">${_highlightCLOOMCSource(data.source, data.language || lump.language)}</pre>` +
                `</div>`;
        } else {
            el.innerHTML = `<div class="lump-stored-src-empty">No stored source.</div>`;
        }
    } catch (_) {
        // Fail silently; Source tab still shows per-method breakdown below
    }
}

async function _fetchAndShowLumpVersions(token, lump) {
    const tk = (token || '').replace(/[^a-z0-9]/gi, '');
    const bodyEl = document.getElementById(`lumpVersionsBody_${tk}`);
    if (!bodyEl) return;
    const e = _escHtml;
    const absName = lump.abstraction || '';
    if (!absName) {
        bodyEl.innerHTML = '<div class="lump-detail-section"><em>No abstraction name — cannot load version telemetry.</em></div>';
        return;
    }
    try {
        bodyEl.innerHTML = '<div class="lump-hex-loading">Loading version telemetry\u2026</div>';
        const resp = await fetch(`/api/lump/version-telemetry/${encodeURIComponent(absName)}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const versions = data.versions || [];

        const STABLE_ICONS = { stable: '\u2705', amber: '\u26a0\ufe0f', red: '\u274c' };
        const STABLE_LABELS = { stable: 'Stable', amber: 'Tier-3 reboots', red: 'Unrecovered halts' };
        const STABLE_COLORS = { stable: 'var(--mtbf-green, #22c55e)', amber: '#f59e0b', red: '#ef4444' };

        let html = `<div class="lump-detail-section">`;
        html += `<div class="lump-section-title">Version Telemetry \u2014 ${e(absName)}</div>`;
        html += `<div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:0.5rem;">`;
        html += `Per-version fault rates from FPGA call-home telemetry. Green = all faults recover at tier\u00a01/2. Amber = tier\u00a03 reboots. Red = unrecovered halts.`;
        html += `</div>`;

        if (versions.length === 0) {
            html += `<div style="color:var(--text-secondary);font-style:italic;padding:0.5rem 0;">No version data recorded yet. Fault telemetry appears here once devices report via call-home.</div>`;
        } else {
            const latestVersion = versions.reduce((a, b) => (b.lump_version > a.lump_version ? b : a), versions[0]);
            const latestToken = latestVersion ? latestVersion.lump_token : token;
            const latestVer = latestVersion ? latestVersion.lump_version : 0;
            html += `<table class="lump-detail-table"><thead><tr>`;
            html += `<th>Ver</th><th>Token</th><th>Faults/1k steps</th><th>Recovery</th><th>MTBF (steps)</th><th>Devices</th><th>Status</th><th></th>`;
            html += `</tr></thead><tbody>`;
            for (const v of versions) {
                const isCurrent = (v.lump_token === token);
                const rate1k = v.fault_rate_per_1000 != null ? v.fault_rate_per_1000 : (v.fault_rate > 0 ? v.fault_rate * 1000 : 0);
                const faultPer1k = rate1k > 0 ? `${rate1k.toFixed(4)}/1k` : '0';
                const mtbfStr = v.mtbf != null ? v.mtbf.toLocaleString() : '\u2014';
                const status = v.stable_status || 'stable';
                const statusIcon = STABLE_ICONS[status] || '';
                const statusLabel = STABLE_LABELS[status] || status;
                const statusColor = STABLE_COLORS[status] || '#9ca3af';
                const tier1pct = v.total_faults > 0 ? Math.round(v.tier1_count / v.total_faults * 100) : 0;
                const tier2pct = v.total_faults > 0 ? Math.round(v.tier2_count / v.total_faults * 100) : 0;
                const tier3pct = v.total_faults > 0 ? Math.round(v.tier3_count / v.total_faults * 100) : 0;
                const recoveryStr = v.total_faults > 0
                    ? `T1:${tier1pct}% T2:${tier2pct}% T3:${tier3pct}%`
                    : '\u2014';
                const rowStyle = isCurrent ? ' style="background:var(--bg-selected,rgba(99,102,241,0.08));"' : '';
                html += `<tr${rowStyle}>`;
                const compiledStr = v.compiled_at
                    ? new Date(v.compiled_at * 1000).toLocaleString(undefined, {month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit'})
                    : (v.lump_version === 0 ? 'system' : '\u2014');
                html += `<td><strong>v${v.lump_version}</strong>${isCurrent ? ' <span style="font-size:0.65rem;color:#818cf8;">(this)</span>' : ''}<br><span style="font-size:0.65rem;color:var(--text-secondary)">${e(compiledStr)}</span></td>`;
                html += `<td style="font-family:monospace;font-size:0.75rem;">0x${e(v.lump_token)}</td>`;
                html += `<td>${e(faultPer1k)}</td>`;
                html += `<td style="font-size:0.75rem;">${e(recoveryStr)}</td>`;
                html += `<td>${mtbfStr}</td>`;
                html += `<td>${v.device_count}</td>`;
                html += `<td><span style="color:${statusColor};font-size:0.8rem;" title="${e(statusLabel)}">${statusIcon} ${e(statusLabel)}</span></td>`;
                html += `<td>`;
                if (!isCurrent && v.device_count > 0 && latestVer > v.lump_version) {
                    html += `<button class="btn" style="font-size:0.7rem;padding:2px 8px;" `
                           + `onclick="_promptUpgradeLump('${e(absName)}','${e(v.lump_token)}',${v.lump_version},'${e(latestToken)}',${latestVer})" `
                           + `title="Record upgrade of all devices on v${v.lump_version} to v${latestVer}">Upgrade\u2026</button>`;
                }
                html += `</td>`;
                html += `</tr>`;
            }
            html += `</tbody></table>`;
            html += `<div style="font-size:0.72rem;color:var(--text-secondary);margin-top:0.5rem;">`;
            html += `\u2139\ufe0f Upgrade action records the new LUMP version in the device registry. No forced push — devices upgrade voluntarily via the Navana upload path.`;
            html += `</div>`;
        }
        html += `</div>`;
        bodyEl.innerHTML = html;
        bodyEl.className = '';
    } catch (err) {
        bodyEl.innerHTML = `<div class="lump-detail-section" style="color:#ef4444;">Failed to load version telemetry: ${e(err.message)}</div>`;
    }
}

async function _promptUpgradeLump(absName, fromToken, fromVersion, toToken, toVersion) {
    if (!toToken || toVersion === undefined) {
        alert('Could not determine target LUMP version for ' + absName);
        return;
    }
    if (toVersion <= fromVersion) {
        alert(`Cannot upgrade: target v${toVersion} is not newer than source v${fromVersion}.`);
        return;
    }
    const confirmed = confirm(
        `Bulk-upgrade registry: mark all devices running ${absName} v${fromVersion} as upgraded to v${toVersion}.\n\n` +
        `This updates the device version registry only — devices upgrade voluntarily via the Navana upload path.\n\n` +
        `Continue?`
    );
    if (!confirmed) return;
    try {
        const resp = await fetch('/api/device/bulk-upgrade-lump', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                abstraction_name: absName,
                from_version: fromVersion,
                to_token: toToken,
                to_version: toVersion,
            }),
        });
        const data = await resp.json();
        if (data.ok) {
            const n = data.updated_count || 0;
            alert(`Bulk upgrade recorded: ${n} device(s) on ${absName} v${fromVersion} → v${toVersion}.`);
            const tk = (toToken || '').replace(/[^a-z0-9]/gi, '');
            delete _lumpVersionsLoaded[tk];
            const lump = _lumpsCache.find(l => l.token === toToken || l.abstraction === absName);
            if (lump) _fetchAndShowLumpVersions(toToken, lump);
        } else {
            alert('Bulk upgrade failed: ' + (data.error || 'unknown error'));
        }
    } catch (err) {
        alert('Bulk upgrade request failed: ' + err.message);
    }
}

async function _fetchAndShowLumpHistory(token, lump) {
    const tk = (token || '').replace(/[^a-z0-9]/gi, '');
    const bodyEl = document.getElementById(`lumpHistoryBody_${tk}`);
    if (!bodyEl) return;
    const e = _escHtml;

    const fmtDate = ts => {
        if (!ts) return '\u2014';
        const d = new Date(ts * 1000);
        const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
        return `${d.getDate()} ${mo} ${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    };

    try {
        bodyEl.innerHTML = '<div class="lump-hex-loading">Loading history\u2026</div>';
        const resp = await fetch(`/api/lumps/${token}/history`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const history = data.history || [];

        let html = '<div class="lump-detail-section">';
        html += '<div class="lump-section-title">Binary Version Archive</div>';
        html += '<div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:0.5rem;">Every saved version of this LUMP is kept on disk. Click a row to preview the binary. Use Restore to make that version current.</div>';

        if (history.length === 0) {
            html += '<div style="color:var(--text-secondary);font-style:italic;padding:0.5rem 0;">No archived versions yet. Each time you save a LUMP, the previous binary is automatically archived here.</div>';
        } else {
            html += '<table class="lump-detail-table" id="lumpHistoryTable_' + tk + '"><thead><tr>';
            html += '<th>Version</th><th>Compiled</th><th>CW</th><th>CC</th><th>Size</th><th></th><th></th>';
            html += '</tr></thead><tbody>';
            for (const v of history) {
                const compiledStr = fmtDate(v.compiled_at);
                const cwStr  = v.cw  != null ? v.cw  : '\u2014';
                const ccStr  = v.cc  != null ? v.cc  : '\u2014';
                const szStr  = v.lump_size != null ? `${v.lump_size}w` : '\u2014';
                html += `<tr class="lump-history-row" data-version="${v.version}" style="cursor:pointer;" onclick="_lumpHistorySelectRow(this,'${e(token)}',${v.version},${v.cw || 0},${v.cc || 0},${v.lump_size || 0},'${tk}')">`;
                html += `<td><strong>v${v.version}</strong></td>`;
                html += `<td style="font-size:0.75rem;">${e(compiledStr)}</td>`;
                html += `<td>${e(String(cwStr))}</td>`;
                html += `<td>${e(String(ccStr))}</td>`;
                html += `<td>${e(szStr)}</td>`;
                html += `<td><button class="btn" style="font-size:0.7rem;padding:2px 8px;" onclick="event.stopPropagation();_lumpHistoryPreview('${e(token)}',${v.version},${v.cw || 0},${v.cc || 0},${v.lump_size || 0},'${tk}')" title="Preview hex dump of v${v.version}">Preview</button></td>`;
                html += `<td><button class="btn lump-history-restore-btn" style="font-size:0.7rem;padding:2px 8px;" onclick="event.stopPropagation();_restoreLumpFromHistory('${e(token)}',${v.version})" title="Restore v${v.version} as the current LUMP">Restore</button></td>`;
                html += `</tr>`;
            }
            html += '</tbody></table>';
        }
        html += '</div>';
        html += '<div id="lumpHistoryHexPreview_' + tk + '" style="margin-top:0.5rem;"></div>';
        bodyEl.innerHTML = html;
        bodyEl.className = '';
    } catch (err) {
        bodyEl.innerHTML = `<div class="lump-detail-section" style="color:#ef4444;">Failed to load history: ${e(err.message)}</div>`;
    }
}

function _lumpHistorySelectRow(rowEl, token, version, cw, cc, lumpSize, tk) {
    const table = document.getElementById(`lumpHistoryTable_${tk}`);
    if (table) table.querySelectorAll('tr').forEach(r => r.classList.remove('lump-hex-hdr-row'));
    rowEl.classList.add('lump-hex-hdr-row');
    _lumpHistoryPreview(token, version, cw, cc, lumpSize, tk);
}

async function _lumpHistoryPreview(token, version, cw, cc, lumpSize, tk) {
    const previewEl = document.getElementById(`lumpHistoryHexPreview_${tk}`);
    if (!previewEl) return;
    const e = _escHtml;
    const hexw = w => (w >>> 0).toString(16).padStart(8, '0').toUpperCase().replace(/(.{2})/g, '$1 ').trim();
    const pack4ascii = w => {
        let s = '';
        for (let sh = 24; sh >= 0; sh -= 8) {
            const b = (w >>> sh) & 0xFF;
            s += (b >= 32 && b < 127) ? String.fromCharCode(b) : '.';
        }
        return s;
    };
    previewEl.innerHTML = `<div class="lump-hex-loading">Loading v${version} binary\u2026</div>`;
    try {
        const [archResp, curResp] = await Promise.all([
            fetch(`/api/lumps/${token}/words/${version}`),
            fetch(`/api/lump/${token}/words`)
        ]);
        if (!archResp.ok) throw new Error(`HTTP ${archResp.status}`);
        const data = await archResp.json();
        const words = data.words || [];
        const numWords = words.length;
        if (!numWords) throw new Error('Empty lump');

        let curWords = [];
        let curFetchFailed = false;
        if (curResp.ok) {
            const curData = await curResp.json();
            curWords = curData.words || [];
        } else {
            curFetchFailed = true;
        }

        let diffCount = 0;
        for (let i = 0; i < numWords; i++) {
            const a = words[i] >>> 0;
            const b = i < curWords.length ? (curWords[i] >>> 0) : null;
            if (a !== b) diffCount++;
        }

        const COLS = 8;
        const rowCount = Math.ceil(numWords / COLS);
        let t = `<div class="lump-detail-section"><div class="lump-section-title">Hex Diff \u2014 v${version} vs current</div>`;
        if (curFetchFailed) {
            t += `<div class="lump-hex-diff-summary lump-hex-diff-summary--warn">Could not load current version \u2014 diff unavailable; showing archived words only</div>`;
        } else if (diffCount === 0) {
            t += `<div class="lump-hex-diff-summary lump-hex-diff-summary--none">Identical to current version \u2014 no words changed</div>`;
        } else {
            t += `<div class="lump-hex-diff-summary lump-hex-diff-summary--changed">${diffCount} word${diffCount === 1 ? '' : 's'} changed</div>`;
            t += `<div class="lump-hex-diff-legend"><span class="lump-hex-diff-legend-arch">archived (v${version})</span><span class="lump-hex-diff-legend-sep">\u2192</span><span class="lump-hex-diff-legend-cur">current</span></div>`;
        }
        t += '<table class="lump-hex-table lump-hex-table-wide"><thead><tr><th>Addr</th>';
        for (let c = 0; c < COLS; c++) t += `<th>+${c}</th>`;
        t += '<th>Pack4 ASCII</th></tr></thead><tbody>';
        for (let row = 0; row < rowCount; row++) {
            const baseIdx  = row * COLS;
            const baseAddr = (baseIdx * 4).toString(16).toUpperCase().padStart(6, '0');
            let rowHex = '', rowAscArch = '', rowAscCur = '', rowHasChange = false, rowClass = '';
            if (baseIdx === 0)                            rowClass = 'lump-hex-hdr-row';
            else if (cc > 0 && baseIdx >= lumpSize - cc)  rowClass = 'lump-hex-clist-row';
            else if (baseIdx >= cw + 1)                    rowClass = 'lump-hex-pad-row';
            for (let c = 0; c < COLS; c++) {
                const i = baseIdx + c;
                if (i < numWords) {
                    const archVal = words[i] >>> 0;
                    const curVal  = i < curWords.length ? (curWords[i] >>> 0) : null;
                    const changed = !curFetchFailed && (curVal === null || archVal !== curVal);
                    if (changed) {
                        rowHasChange = true;
                        const curDisplay = curVal === null ? '<span class="lump-hex-diff-absent">(absent)</span>' : hexw(curVal);
                        rowHex += `<td class="lump-hex-diff-changed"><span class="lump-hex-diff-arch">${hexw(archVal)}</span><span class="lump-hex-diff-cur">${curDisplay}</span></td>`;
                    } else {
                        rowHex += `<td>${hexw(archVal)}</td>`;
                    }
                    rowAscArch += pack4ascii(archVal);
                    rowAscCur  += curVal !== null ? pack4ascii(curVal) : '.'.repeat(4);
                } else {
                    rowHex += '<td class="lump-hex-empty"></td>';
                    rowAscArch += '    ';
                    rowAscCur  += '    ';
                }
            }
            const ascCell = rowHasChange && !curFetchFailed
                ? `<td class="lump-hex-ascii lump-hex-ascii--split"><span class="lump-hex-diff-arch">${e(rowAscArch)}</span><span class="lump-hex-diff-cur">${e(rowAscCur)}</span></td>`
                : `<td class="lump-hex-ascii">${e(rowAscArch)}</td>`;
            t += `<tr class="${rowClass}"><td class="lump-hex-addr">0x${baseAddr}</td>${rowHex}${ascCell}</tr>`;
        }
        t += '</tbody></table></div>';
        previewEl.innerHTML = t;
    } catch (err) {
        previewEl.innerHTML = `<div style="color:#ef4444;padding:0.5rem;">Failed to load binary: ${err.message}</div>`;
    }
}

async function _restoreLumpFromHistory(token, version) {
    const lump = _lumpsCache.find(l => l.token === token);
    const displayName = (lump && lump.abstraction) || token;
    if (!confirm(`Restore v${version} of "${displayName}" as the current LUMP?\n\nThe current version will be archived first.`)) return;

    try {
        const wordsResp = await fetch(`/api/lumps/${token}/words/${version}`);
        if (!wordsResp.ok) throw new Error(`Failed to fetch archived binary: HTTP ${wordsResp.status}`);
        const wordsData = await wordsResp.json();
        const words = wordsData.words;
        if (!words || !words.length) throw new Error('Archived binary is empty');

        const metadata = {
            token:           token,
            abstraction:     wordsData.abstraction   ?? (lump?.abstraction   ?? ''),
            ns_slot:         wordsData.ns_slot       ?? (lump?.ns_slot       ?? null),
            cw:              wordsData.cw            ?? (lump?.cw            ?? 0),
            cc:              wordsData.cc            ?? (lump?.cc            ?? 0),
            profile:         wordsData.profile       || lump?.profile || lump?.deployment?.profile || 'IoT',
            language:        wordsData.language      || lump?.language      || 'unknown',
            author:          wordsData.author        || lump?.author        || '',
            version:         wordsData.version_str   || lump?.version       || '',
            release_notes:   wordsData.release_notes || lump?.release_notes || '',
            methods:         wordsData.methods       || lump?.methods       || [],
            capabilities:    wordsData.capabilities  || lump?.capabilities  || [],
            grants:          wordsData.grants        || lump?.grants        || ['E'],
            content_type:    wordsData.content_type  || lump?.content_type  || 'code',
            pet_names_dr:    (wordsData.pet_names || lump?.pet_names || {}).DR || {},
            pet_names_cr:    (wordsData.pet_names || lump?.pet_names || {}).CR || {},
            mtbf_clean_runs: (wordsData.mtbf || {}).consecutive_clean || 0,
            mtbf_total_runs: (wordsData.mtbf || {}).total_runs        || 0,
            mtbf_status:     (wordsData.mtbf || {}).status            || 'unknown',
            source_hash:     wordsData.source_hash   || (lump?.mtbf || {}).source_hash || '',
        };

        const saveResp = await fetch('/api/lumps/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ binary: words, metadata }),
        });
        const saveData = await saveResp.json();
        if (!saveResp.ok || !saveData.ok) throw new Error(saveData.error || `HTTP ${saveResp.status}`);

        if (typeof _showFpgaToast === 'function') {
            _showFpgaToast('Restored', `v${version} of "${displayName}" is now the current LUMP.`, 'ok', 4000);
        }

        const tk = token.replace(/[^a-z0-9]/gi, '');
        delete _lumpHistoryLoaded[tk];
        if (typeof refreshLumps === 'function') refreshLumps();
    } catch (err) {
        alert(`Restore failed: ${err.message}`);
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
        if (typeof _refreshLumpPickerOption === 'function') _refreshLumpPickerOption(token);
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
    editBtn.textContent = startOpen ? 'Close editor' : 'Edit';
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
        const _editorVisible = editorArea.style.display !== 'none';
        if (_editorVisible) {
            // Toggle closed — hide editor, show preview, reset label (draft is preserved).
            _lumpEditorOpen[tk] = false;
            editorArea.style.display = 'none';
            preview.style.display = '';
            editBtn.textContent = 'Edit';
        } else {
            // Toggle open.
            _lumpEditDirty = true;
            _lumpEditorOpen[tk] = true;
            _draftLsSet(tk, ta.value);
            preview.style.display = 'none';
            editorArea.style.display = '';
            restoreSplitRatio();
            ta.focus();
            editBtn.textContent = 'Close editor';
        }
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
        editBtn.textContent = 'Edit';
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
    // Prefer binary-header values — they are the authoritative source and will
    // differ from the manifest when the lump was recompiled but the manifest
    // cache was not yet refreshed (the classic "stale manifest" conflict).
    const _binaryHdr = (words && words.length > 0 && typeof sim !== 'undefined' && sim && sim.parseLumpHeader)
        ? sim.parseLumpHeader(words[0] >>> 0) : null;
    const cw        = (_binaryHdr && _binaryHdr.valid) ? _binaryHdr.cw       : (parseInt(lump.cw)        || 0);
    const cc        = (_binaryHdr && _binaryHdr.valid) ? _binaryHdr.cc       : (parseInt(lump.cc)        || 0);
    const lumpSize  = (_binaryHdr && _binaryHdr.valid) ? _binaryHdr.lumpSize : (parseInt(lump.lump_size) || words.length);
    // Keep cache current for any tab that loads after Content.
    if (_binaryHdr && _binaryHdr.valid) _lumpBinaryHdrCache[token] = { hdr: _binaryHdr, words };
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
        if (!wVal) {
            const _capMeta = lump.capabilities && lump.capabilities[s];
            const _capName = _capMeta ? (_capMeta.name || (typeof _capMeta === 'string' ? _capMeta : '')) : '';
            clistSlotName[s] = _capName || '(empty)';
            continue;
        }
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
                const _capMeta = lump.capabilities && lump.capabilities[_gs];
                const _capName = _capMeta ? (_capMeta.name || (typeof _capMeta === 'string' ? _capMeta : '')) : '';
                if (_capName) {
                    html += `<div class="lump-gt-chip lump-gt-chip-null lump-gt-chip-declared" title="#${_gs} \u2014 ${_capName} (declared in capabilities block; GT assigned at runtime)">` +
                            `<span class="lump-gt-chip-dot lump-gt-dot-null"></span>` +
                            `<span class="lump-gt-chip-name">${e(_capName)}</span>` +
                            `<span class="lump-gt-chip-meta lump-gt-meta-null">#${_gs}\u00B7declared</span>` +
                            `</div>`;
                } else {
                    html += `<div class="lump-gt-chip lump-gt-chip-null lump-gt-chip-empty">` +
                            `<span class="lump-gt-chip-dot lump-gt-dot-null"></span>` +
                            `<span class="lump-gt-chip-name lump-gt-name-null">\u2014 empty \u2014</span>` +
                            `<span class="lump-gt-chip-meta lump-gt-meta-null">#${_gs}</span>` +
                            `</div>`;
                }
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

    bodyEl.innerHTML = html;
    bodyEl.className = '';
}

async function _loadLumpTokens(token, lump) {
    const tk     = (token || '').replace(/[^a-z0-9]/gi, '');
    const bodyEl = document.getElementById(`lumpTokensBody_${tk}`);
    if (!bodyEl) return;

    const e        = _escHtml;
    const nsIdx    = (lump.ns_slot !== null && lump.ns_slot !== undefined) ? parseInt(lump.ns_slot) : null;

    // ── Fetch words first so we can derive cc+lumpSize from the binary header ─
    let words    = [];
    let cc       = parseInt(lump.cc)        || 0;  // manifest fallback until binary confirms
    let lumpSize = parseInt(lump.lump_size) || 0;
    try {
        // Reuse cached words when available (Content tab may have loaded first).
        const _cachedEntry = _lumpBinaryHdrCache[token];
        if (_cachedEntry && _cachedEntry.hdr && _cachedEntry.hdr.valid) {
            words = _cachedEntry.words || [];
        } else {
            const resp = await fetch(`/api/lump/${token}/words`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            words = data.words || [];
        }
        if (words.length > 0 && typeof sim !== 'undefined' && sim && sim.parseLumpHeader) {
            const _bh = sim.parseLumpHeader(words[0] >>> 0);
            if (_bh && _bh.valid) {
                cc = _bh.cc;
                lumpSize = _bh.lumpSize;
                _lumpBinaryHdrCache[token] = { hdr: _bh, words };
            }
        }
    } catch (err) {
        const errHtml = `<div class="lump-clist-section"><div style="color:#f87171;font-size:0.8rem;padding:0.4rem 0;">` +
            `Failed to load token words: ${e(err.message)}</div></div>`;
        bodyEl.innerHTML = errHtml;
        bodyEl.className = '';
        return;
    }

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
    html += `<div class="clist-pola-strip" style="margin-top:0.35rem;">` +
        `<span class="clist-pola-label" style="color:#66b3ff">Names</span>` +
        `<span class="clist-pola-msg">Push lump GT pet names into the running simulator&rsquo;s namespace map.</span>` +
        `<button class="clist-pola-btn clist-names-btn" onclick="_applyLumpNamesToSim('${token}')">\u2B06\u202FApply Names \u2192 Sim</button>` +
        `</div>`;
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
            const _capMeta = lump.capabilities && lump.capabilities[s];
            const _capName = _capMeta ? (_capMeta.name || (typeof _capMeta === 'string' ? _capMeta : '')) : '';
            if (_capName) {
                html += `<div class="lump-gt-chip lump-gt-chip-null lump-gt-chip-declared" title="#${s} \u2014 ${e(_capName)} (declared in capabilities block; GT assigned at runtime)">` +
                        `<span class="lump-gt-chip-dot lump-gt-dot-null"></span>` +
                        `<span class="lump-gt-chip-name">${e(_capName)}</span>` +
                        `<span class="lump-gt-chip-meta lump-gt-meta-null">#${s}\u00B7declared</span>` +
                        `</div>`;
            } else {
                html += `<div class="lump-gt-chip lump-gt-chip-null lump-gt-chip-empty" title="Slot ${s} is empty \u2014 click to assign a capability" onclick="_openGTSlotPicker(${JSON.stringify(token || '')},${s},this)">` +
                        `<span class="lump-gt-chip-dot lump-gt-dot-null"></span>` +
                        `<span class="lump-gt-chip-name lump-gt-name-null">\u2014 empty \u2014</span>` +
                        `<span class="lump-gt-chip-meta lump-gt-meta-null">#${s}</span>` +
                        `<span class="lump-gt-empty-btn" title="Assign capability">+</span>` +
                        `</div>`;
            }
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
            const inputPlaceholder = `NS[${gtSlotId}]`;
            html += `<div class="lump-gt-chip" data-slot="${s}" data-ns-slot="${gtSlotId}">` +
                    `<span class="lump-gt-chip-dot"></span>` +
                    `<input class="lump-gt-name-input${displayName ? '' : ' lump-gt-name-unresolved'}" ` +
                    `value="${e(displayName)}" placeholder="${e(inputPlaceholder)}" ` +
                    `data-token="${e(token)}" data-cr-slot="${s}" data-orig="${e(displayName)}" ` +
                    `onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur()}" ` +
                    `onblur="_lumpGTNameCommit(this)">` +
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
                renderLumps().then(() => {
                    if (typeof _updateLumpViewingLabel === 'function') _updateLumpViewingLabel(_selectedLumpToken || '');
                });
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
            var _lhFree2 = lhdr.lumpSize - 1 - lhdr.cw - lhdr.cc;
            disasmLines = [
                '; ' + lumpName + '  ' + nsTag + addrStr +
                '(' + codeLimit + ' word' + (codeLimit !== 1 ? 's' : '') +
                ', cc=' + lhdr.cc + ', ' + _lhFree2 + ' free)'
            ];
            // Inject capabilities { } block from sidecar metadata when available.
            var _lCaps = lump.capabilities;
            if (Array.isArray(_lCaps) && _lCaps.length > 0) {
                var _capItems = _lCaps.map(function(c) {
                    var _n = c.name || String(c);
                    var _r = (c.grants || c.rights || []).join('');
                    return _r ? (_n + ' ' + _r) : _n;
                }).filter(Boolean).join(', ');
                disasmLines.push('capabilities { ' + _capItems + ' }');
                disasmLines.push('');
            }
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

    // ── Unseal before switching — must happen before switchView so the editor
    //    init code does not see a stale seal and make the textarea read-only.
    localStorage.removeItem('cm_sealed_lump');

    switchView('editor');

    var sel = document.getElementById('langSelector');
    if (sel) sel.value = 'assembly';

    var asmEd = document.getElementById('asmEditor');
    if (asmEd) {
        // Always clear any stale banners from a previous open.
        var _existingMfBanner = document.getElementById('_lumpMalformedBanner');
        if (_existingMfBanner) _existingMfBanner.remove();
        var _existingSrcBanner = document.getElementById('_lumpSourceRestoredBanner');
        if (_existingSrcBanner) _existingSrcBanner.remove();

        // ── Always make the editor fully editable on LUMP-panel open ──────
        asmEd.readOnly = false;
        asmEd.classList.remove('cm-editor-sealed');
        var _tabsRow = document.querySelector('.example-tabs-row');
        if (_tabsRow) _tabsRow.style.display = '';

        // ── Determine the compiled (canonical) disasm text ─────────────────
        var _compiledDisasm;
        if (disasmLines) {
            _compiledDisasm = disasmLines.join('\n');
        } else {
            // Binary parse failed — try canonical source as fallback.
            var _malformedSrc = null;
            var _absNameFb = lump.abstraction || '';
            if (_absNameFb) {
                try {
                    var _sr = await fetch('/api/lump-source/' + encodeURIComponent(_absNameFb), { cache: 'no-store' });
                    if (_sr.ok) {
                        var _sj = await _sr.json();
                        if (_sj && !_sj.binary_only && _sj.source) {
                            _malformedSrc = _sj.source;
                        }
                    }
                } catch (_sfe) {}
            }
            var _mfBannerMsg;
            if (_malformedSrc) {
                _compiledDisasm = _malformedSrc;
                _mfBannerMsg = 'Binary is malformed \u2014 showing canonical source. Compile to rebuild the binary.';
            } else {
                var cwHint = (lump.cw  > 0) ? ('\n; Code region: ' + lump.cw  + ' word' + (lump.cw  !== 1 ? 's' : '')) : '';
                var ccHint = (lump.cc  > 0) ? ('\n; C-List: '      + lump.cc  + ' GT slot' + (lump.cc  !== 1 ? 's' : '')) : '';
                _compiledDisasm = '; ' + lumpName + cwHint + ccHint +
                              '\n; Boot the machine to edit live code\n';
                _mfBannerMsg = 'Binary is malformed \u2014 no canonical source found. Author a .cloomc file to enable source editing.';
            }
            // Show malformed-binary banner above the editor.
            var _mfBanner = document.createElement('div');
            _mfBanner.id = '_lumpMalformedBanner';
            _mfBanner.className = 'lump-malformed-banner';
            _mfBanner.innerHTML = _mfBannerMsg +
                '<button class="lump-malformed-banner-dismiss" onclick="this.parentNode.remove()" title="Dismiss">\u00D7</button>';
            if (asmEd.parentNode) asmEd.parentNode.insertBefore(_mfBanner, asmEd);
        }

        // ── Try to restore original source from sidecar detail endpoint ──────
        // Only override _compiledDisasm when a non-empty source is found;
        // older LUMPs (compiled before this feature) silently fall through.
        var _sourceRestored = false;
        try {
            var _dr = await fetch('/api/lumps/' + token + '/detail', { cache: 'no-store' });
            if (_dr.ok) {
                var _dj = await _dr.json();
                if (_dj && typeof _dj.source === 'string' && _dj.source.trim().length > 0) {
                    _compiledDisasm = _dj.source;
                    _sourceRestored = true;
                }
            }
        } catch (_dfe) {}

        // ── Record original (compiled) text for dirty comparison ──────────
        window._editorOriginalDisasm = _compiledDisasm;

        // ── Check for a saved draft from a previous session ───────────────
        var _savedDraft = _draftLsGet(token);
        var _hasDraft   = _savedDraft !== null && _savedDraft !== _compiledDisasm;

        if (_hasDraft) {
            // Restore draft content into editor
            asmEd.value = _savedDraft;
            // Show draft-restore banner above the editor
            var _existingDraftBanner = document.getElementById('_lumpDraftBanner');
            if (_existingDraftBanner) _existingDraftBanner.remove();
            var _draftBanner = document.createElement('div');
            _draftBanner.id = '_lumpDraftBanner';
            _draftBanner.className = 'lump-draft-restore-banner';
            _draftBanner.innerHTML =
                '<span>Unsaved draft \u2014 your last edits are restored. Compile to save, or </span>' +
                '<button class="btn btn-sm lump-draft-discard-btn" id="_lumpDraftBannerDiscard">Discard</button>';
            if (asmEd.parentNode) asmEd.parentNode.insertBefore(_draftBanner, asmEd);
            var _bannerDiscardBtn = _draftBanner.querySelector('#_lumpDraftBannerDiscard');
            if (_bannerDiscardBtn) {
                _bannerDiscardBtn.addEventListener('click', function() {
                    _draftLsDel(token);
                    asmEd.value = window._editorOriginalDisasm || '';
                    _draftBanner.remove();
                    if (typeof updateLineNumbers === 'function') updateLineNumbers();
                });
            }
        } else {
            // No draft — show the compiled source (or disasm fallback)
            asmEd.value = _compiledDisasm;
            // Show "source restored" banner when original source was fetched
            if (_sourceRestored) {
                var _existingSourceBanner = document.getElementById('_lumpSourceRestoredBanner');
                if (_existingSourceBanner) _existingSourceBanner.remove();
                var _srcBanner = document.createElement('div');
                _srcBanner.id = '_lumpSourceRestoredBanner';
                _srcBanner.className = 'lump-source-restored-banner';
                _srcBanner.innerHTML =
                    '<span>Source restored from saved LUMP</span>' +
                    '<button class="lump-malformed-banner-dismiss" onclick="this.parentNode.remove()" title="Dismiss">\u00D7</button>';
                if (asmEd.parentNode) asmEd.parentNode.insertBefore(_srcBanner, asmEd);
            }
        }

        if (typeof updateLineNumbers === 'function') updateLineNumbers();
        // Title must always follow the code module name without exception.
        if (typeof _updateEditorCodeName === 'function') _updateEditorCodeName(lumpName);

        // ── Wire dirty-tracking: auto-save draft on every keystroke ───────
        // Remove any previous listener registered by an earlier openLumpInEditor call.
        if (window._editorLumpDirtyListener && window._editorLumpDirtyListenerEl) {
            window._editorLumpDirtyListenerEl.removeEventListener('input', window._editorLumpDirtyListener);
        }
        window._editorLumpDirtyListenerEl = asmEd;
        window._editorLumpDirtyToken = token;
        window._editorLumpDirtyListener = function() {
            var _tk = window._editorLumpDirtyToken;
            if (!_tk) return;
            if (asmEd.value !== window._editorOriginalDisasm) {
                _draftLsSet(_tk, asmEd.value);
            } else {
                // Back to original — remove any draft that was saved
                _draftLsDel(_tk);
            }
        };
        asmEd.addEventListener('input', window._editorLumpDirtyListener);
    }

    if (typeof _updateEditorPatchBar   === 'function') _updateEditorPatchBar();
    if (typeof _updateMtbfIndicator    === 'function') _updateMtbfIndicator();
    var outEl = document.getElementById('assemblyOutput');
    if (outEl) outEl.innerHTML = '';

    // ── Inject / refresh Discard toolbar button ───────────────────────────
    var _existingDiscardBtn = document.getElementById('btnDiscardLumpEdit');
    if (_existingDiscardBtn) _existingDiscardBtn.remove();
    var _discardBtn = document.createElement('button');
    _discardBtn.id = 'btnDiscardLumpEdit';
    _discardBtn.className = 'btn btn-sm lump-editor-discard-btn';
    _discardBtn.setAttribute('data-tooltip', 'Discard — Clear draft, restore compiled disasm, return to LUMP panel');
    _discardBtn.textContent = 'Discard';
    _discardBtn.addEventListener('click', function() {
        _draftLsDel(token);
        var _ed = document.getElementById('asmEditor');
        if (_ed) {
            _ed.value = window._editorOriginalDisasm || '';
            if (typeof updateLineNumbers === 'function') updateLineNumbers();
        }
        // Detach dirty listener
        if (window._editorLumpDirtyListener && window._editorLumpDirtyListenerEl) {
            window._editorLumpDirtyListenerEl.removeEventListener('input', window._editorLumpDirtyListener);
        }
        window._editorLumpDirtyToken       = null;
        window._editorLumpDirtyListener    = null;
        window._editorLastSavedToken       = null;
        // Remove banners and the button itself
        var _db = document.getElementById('_lumpDraftBanner');
        if (_db) _db.remove();
        _discardBtn.remove();
        if (typeof switchView === 'function') switchView('lumps');
    });
    // Insert the Discard button into the toolbar, after the inline Compile button
    var _compileInlineBtn = document.getElementById('btnToolbarCompile');
    if (_compileInlineBtn && _compileInlineBtn.parentNode) {
        _compileInlineBtn.parentNode.insertBefore(_discardBtn, _compileInlineBtn.nextSibling);
    }

    // Expose this lump's token so the C-List viewer can show its baked-in
    // c-list without requiring a recompile.  The compile-start path already
    // clears this to null (app-compile.js line ~1158) so mid-edit state is
    // never stale.
    window._editorLastSavedToken = token;
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
    const permsObj = {};
    permsLabels.forEach(p => {
        permsObj[p] = document.getElementById(`gtpick-perm-${p}`)?.checked ? 1 : 0;
    });

    // Build GT word using new dom+perm encoding (v1.1):
    //   [31]=b_flag [30:28]=perm[2:0] [27]=dom [26]=spare=0 [25]=f_flag=0
    //   [24:23]=gt_type [22:16]=gt_seq [15:0]=ns_slot
    //   dom=0 (Turing): perm[2]=X, perm[1]=W, perm[0]=R
    //   dom=1 (Church):  perm[2]=E, perm[1]=S, perm[0]=L
    const hasChurch = permsObj.L || permsObj.S || permsObj.E;
    const dom   = hasChurch ? 1 : 0;
    const perm3 = dom === 0
        ? (((permsObj.X || 0) << 2) | ((permsObj.W || 0) << 1) | (permsObj.R || 0))
        : (((permsObj.E || 0) << 2) | ((permsObj.S || 0) << 1) | (permsObj.L || 0));
    const gt_word = (((perm3 & 0x7) << 28) | ((dom & 1) << 27) |
                     ((gtType & 0x3) << 23) |
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

// ── Load a saved LUMP binary into the simulator ───────────────────────────────
// Fetches the full LUMP binary from /api/lump/<token>/words and loads it
// atomically into the simulator via sim.loadLumpBinary().  The entire binary
// (header + code + c-list + padding) is written verbatim — no header stripping,
// no reconstruction.  The NS slot targeted is taken from the lump's manifest
// ns_slot field (passed as the optional nsSlot argument); when absent it falls
// back to BOOT_ABSTR_NS_SLOT (slot 3) for backwards compatibility.  CR14 is
// updated to match the chosen slot.  The assembler path (loadProgram) is unaffected.
async function _loadLumpBinaryIntoSim(token, name, btn, nsSlot) {
    if (!token) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Loading\u2026'; }
    try {
        const resp = await fetch(`/api/lump/${token}/words`);
        if (!resp.ok) throw new Error(`Server returned ${resp.status}`);
        const data = await resp.json();
        const rawWords = data.words || [];
        if (!rawWords.length) throw new Error('Empty LUMP \u2014 no words returned');

        if (typeof sim === 'undefined' || !sim) throw new Error('Simulator not ready');

        // Guard: when nsSlot is null/undefined we force the lump into
        // BOOT_ABSTR_NS_SLOT (slot 3 — Boot.Abstr, the only slot CR14
        // references after boot).  But sim.bootEntrySlot may still hold a
        // previously-selected slot (e.g. 51 for Ethernet) from a boot-entry
        // badge click.  instantBoot() runs NUC_CLIST which does an mLoad on
        // sim.bootEntrySlot; if that slot has no installed lump the mLoad
        // faults with LUMP_MAGIC before we ever write our binary.
        // Fix: temporarily force both sim.bootEntrySlot and the module-level
        // bootEntrySlot (declared in app-memory.js) to BOOT_ABSTR_NS_SLOT for
        // the instantBoot call.  We restore unconditionally — on success and on
        // any error — so the user's boot-entry UI selection is always preserved.
        const _BOOT_SLOT = (typeof BOOT_ABSTR_NS_SLOT !== 'undefined') ? BOOT_ABSTR_NS_SLOT : 3;
        const _forcingBootSlot = (nsSlot === null || nsSlot === undefined);
        const _savedSimBootEntry = sim.bootEntrySlot;
        // bootEntrySlot is a let-declared cross-file global in app-memory.js.
        // let vars are NOT on window, so we reference it by name directly.
        const _savedModBootEntry = (typeof bootEntrySlot !== 'undefined') ? bootEntrySlot : _BOOT_SLOT;
        if (_forcingBootSlot) {
            sim.bootEntrySlot = _BOOT_SLOT;
            if (typeof bootEntrySlot !== 'undefined') bootEntrySlot = _BOOT_SLOT;
        }

        // Helper to restore the saved boot-entry selection.  Called on both
        // the success path and from the catch block so state is always clean.
        const _restoreBootEntry = () => {
            if (_forcingBootSlot) {
                sim.bootEntrySlot = _savedSimBootEntry;
                if (typeof bootEntrySlot !== 'undefined') bootEntrySlot = _savedModBootEntry;
            }
        };

        if (!sim.bootComplete && typeof instantBoot === 'function') instantBoot();

        const loaded = sim.loadLumpBinary(rawWords, (nsSlot !== null && nsSlot !== undefined) ? nsSlot : undefined);
        if (!loaded) {
            _restoreBootEntry();
            throw new Error('loadLumpBinary rejected the binary — check the console output for details');
        }

        // Update the NS-slot label so the Code-view panel title reflects the
        // loaded LUMP, not the original boot-time label ("LED flash").
        // The resolved slot mirrors what loadLumpBinary does internally.
        // Compute _resolvedSlot while sim.bootEntrySlot is still _BOOT_SLOT
        // (before restore) so it correctly evaluates to slot 3 on the forced path.
        const _resolvedSlot = (nsSlot !== null && nsSlot !== undefined)
            ? Number(nsSlot)
            : (sim.bootEntrySlot || _BOOT_SLOT);
        if (sim.nsLabels) sim.nsLabels[_resolvedSlot] = name || token;

        // Restore the user's prior boot-entry selection now that the lump is
        // safely installed.  The simulator is configured to run from slot 3
        // regardless; restoring preserves the user's UI preference only.
        _restoreBootEntry();

        if (typeof _syncBootEntryFromSim === 'function') _syncBootEntryFromSim();
        // Clear the assembler-path state so that _applyPendingSimLoad() (called on every
        // Step when bootComplete) and _autoLoadDefaultProgram() (called on every reset)
        // do NOT overwrite this LUMP binary with a previously assembled program.
        //
        // CRITICAL: lastAssembledWords, _pendingSimLoad, and lastMethodTableSize are
        // declared with `let` in app-shell.js.  `let` top-level declarations are NOT
        // on window, so `window.X = null` from this file would write a SEPARATE window
        // property that app-shell.js never reads.  The only correct cross-file write path
        // is the setter function _clearAssembledProgramState() defined there.
        if (typeof _clearAssembledProgramState === 'function') _clearAssembledProgramState();
        // Do NOT call _injectClistNow(): the c-list is already loaded verbatim inside the
        // lump binary by loadLumpBinary(), and CR6 has been updated to point to it.
        // Calling _injectClistNow() here would overwrite the loaded c-list and mutate the
        // header's cc field, destroying the LUMP integrity that this function now preserves.
        if (sim.programName !== undefined) sim.programName = name || token;

        const hdr = rawWords.length ? sim.parseLumpHeader(rawWords[0] >>> 0) : null;
        const wordCount = (hdr && hdr.valid) ? hdr.cw : rawWords.length;

        if (btn) { btn.textContent = 'Loaded \u2713'; }
        const con = document.getElementById('editorConsole');
        if (con) {
            con.className = '';
            con.textContent = `Loaded LUMP \u201c${name || token}\u201d \u2014 cw=${wordCount}${hdr && hdr.valid ? ' cc=' + hdr.cc : ''} \u2014 click Step or Run`;
        }
        switchView('dashboard');
    } catch (err) {
        if (btn) { btn.disabled = false; btn.textContent = 'Load into Sim \u25b6'; }
        alert(`Failed to load LUMP into simulator: ${err.message}`);
    }
}

// ── Run Selftest shortcut ─────────────────────────────────────────────────────
// Loads the PostFlashSelftest LUMP (token 82f5ef56) into the simulator, runs
// it to completion, and reports DR0 (0 = all 81 tests passed).

const _SELFTEST_SECTIONS = [
    { letter: 'A', name: 'Register Independence', start:  1, end: 15, desc: 'DR1–DR15 each hold a distinct value — detects register-file aliasing' },
    { letter: 'B', name: 'IADD Arithmetic',       start: 16, end: 23, desc: 'Integer add: zero identity, value sums, commutativity, Z/N flags, max immediate' },
    { letter: 'C', name: 'ISUB Arithmetic',       start: 24, end: 30, desc: 'Integer subtract: zero result, value verify, negative result (N), borrow flag (C)' },
    { letter: 'D', name: 'SHL Shift-Left',        start: 31, end: 36, desc: 'Shift left: identity, doubling, ×256, carry-out (C), sign bit (N), nibble pattern' },
    { letter: 'E', name: 'SHR Logical (LSR)',     start: 37, end: 41, desc: 'Logical right shift: identity, halving, carry flag, large shift, no sign-extension' },
    { letter: 'F', name: 'SHR Arithmetic (ASR)',  start: 42, end: 45, desc: 'Arithmetic right shift: sign-extension preserved, carry flag from bit 0' },
    { letter: 'G', name: 'Branch Conditions',     start: 46, end: 57, desc: 'All 12 conditions: EQ NE CS CC MI PL GE LT GT LE HI LS' },
    { letter: 'H', name: 'Bit-Field Ops',         start: 58, end: 62, desc: 'BFEXT and BFINS: nibble/byte extract, lower/upper insert, round-trip' },
    { letter: 'I', name: 'TPERM Presets',         start: 63, end: 73, desc: 'Permission checks (X, R, E, L, S, RX, RWX, CLEAR) + domain purity enforcement' },
    { letter: 'J', name: 'TPERM EXACT',           start: 74, end: 77, desc: 'TPERM EXACT credential-pinning: bit-identical GTs match; symmetry; multi-load' },
    { letter: 'K', name: 'CHANGE (CR Swap)',      start: 78, end: 79, desc: 'CHANGE swaps two CRs; permission identity reverses correctly after swap' },
    { letter: 'L', name: 'LOAD from C-List',      start: 80, end: 81, desc: 'LOAD from slot 7 and slot 3 into a fresh CR; correct permission on each' },
];

const _SELFTEST_TEST_DESCS = {
     1: 'DR1 holds value 11 after all DR writes — no register aliasing',
     2: 'DR2 holds value 22 after all DR writes',
     3: 'DR3 holds value 33 after all DR writes',
     4: 'DR4 holds value 44 after all DR writes',
     5: 'DR5 holds value 55 after all DR writes',
     6: 'DR6 holds value 66 after all DR writes',
     7: 'DR7 holds value 77 after all DR writes',
     8: 'DR8 holds value 88 after all DR writes',
     9: 'DR9 holds value 99 after all DR writes',
    10: 'DR10 holds value 110 after all DR writes',
    11: 'DR11 holds value 121 after all DR writes',
    12: 'DR12 holds value 132 after all DR writes',
    13: 'DR13 holds value 143 after all DR writes',
    14: 'DR14 holds value 154 after all DR writes',
    15: 'DR15 holds value 165 after all DR writes',
    16: 'IADD 0+0 = 0 (Z=1)',
    17: 'IADD 5+3 = 8 (Z=0, value verify)',
    18: 'IADD 100+155 = 255',
    19: 'IADD identity: n+0 = n (immediate 0)',
    20: 'IADD nonzero result sets Z=0',
    21: 'IADD commutativity: a+b == b+a',
    22: 'IADD with max 14-bit immediate (16383)',
    23: 'IADD nonzero+nonzero gives Z=0',
    24: 'ISUB N−N = 0 (Z=1)',
    25: 'ISUB 10−3 = 7 (value verify)',
    26: 'ISUB 3−10 gives signed negative result (N=1)',
    27: 'ISUB 0−1 causes borrow (C=0, BRANCHCC)',
    28: 'ISUB 5−3 produces no borrow (C=1, BRANCHCS)',
    29: 'ISUB immediate: 200−200 = 0 (Z=1)',
    30: 'ISUB nonzero result: 50−49 = 1 (Z=0)',
    31: 'SHL by 0 leaves value unchanged',
    32: 'SHL by 1 doubles value: 6 → 12',
    33: 'SHL by 8 multiplies by 256: 1 → 256',
    34: 'SHL carry-out: MSB shifted out sets C=1 (0x80000000 << 1 → 0)',
    35: 'SHL sign bit: 1 << 31 = 0x80000000 sets N=1',
    36: 'SHL by 4 on 0xF gives 0xF0 (240)',
    37: 'SHR LSR by 0 leaves value unchanged',
    38: 'SHR LSR by 1 halves an even value: 8 → 4',
    39: 'SHR LSR carry: bit 0 shifted out sets C=1 (1 >> 1 → 0)',
    40: 'SHR LSR by 8: 2048 >> 8 = 8',
    41: 'SHR LSR does not sign-extend (0x80000000 >> 1 sets N=0)',
    42: 'ASR −1 >> 1 = −1 (sign extended; Z=0, N=1)',
    43: 'ASR −2 >> 1 gives C=0 (bit 0 of −2 was 0)',
    44: 'ASR −1 >> 1 gives C=1 (bit 0 of −1 was 1)',
    45: 'ASR preserves N=1 for any negative input (0x80000000 >> 4)',
    46: 'BRANCHEQ taken when Z=1',
    47: 'BRANCHNE taken when Z=0',
    48: 'BRANCHCS taken when C=1 (no borrow: 5−3)',
    49: 'BRANCHCC taken when C=0 (borrow: 0−1)',
    50: 'BRANCHMI taken when N=1 (0−1 = 0xFFFFFFFF)',
    51: 'BRANCHPL taken when N=0 (positive result)',
    52: 'BRANCHGE taken when N=V (10−3=7, N=0, V=0)',
    53: 'BRANCHLT taken when N≠V (3−10=−7, N=1, V=0)',
    54: 'BRANCHGT taken when Z=0 and N=V (10−3=7)',
    55: 'BRANCHLE taken when Z=1 or N≠V (5−5=0, Z=1)',
    56: 'BRANCHHI taken when C=1 and Z=0 (8−3=5)',
    57: 'BRANCHLS taken when C=0 or Z=1 (borrow: 0−1)',
    58: 'BFEXT bits [3:0] from 0x(16383<<2|3) = 0xD = 13',
    59: 'BFEXT 8-bit field at bit 0: 0xAB = 171',
    60: 'BFINS lower nibble: insert 0xF into bits [3:0] of 0',
    61: 'BFINS upper nibble: insert 0xA into bits [7:4] of 0 → 160',
    62: 'BFEXT round-trip: insert 7 into bits [7:5], extract back',
    63: 'X-GT satisfies TPERM X (Z=1)',
    64: 'X-GT does NOT satisfy TPERM R — domain purity: X-GT has no R bit',
    65: 'X-GT does NOT satisfy TPERM E — domain purity: dom=0 ≠ Church dom=1',
    66: 'X-GT does NOT satisfy TPERM L',
    67: 'X-GT does NOT satisfy TPERM S',
    68: 'E-GT satisfies TPERM E (Z=1)',
    69: 'E-GT does NOT satisfy TPERM X — domain purity: dom=1 ≠ Turing dom=0',
    70: 'E-GT does NOT satisfy TPERM R',
    71: 'TPERM CLEAR always succeeds on a valid GT (Z=1)',
    72: 'TPERM RX on X-GT → Z=0 (X-GT has X but not R)',
    73: 'TPERM RWX on X-GT → Z=0 (X-GT has only X; R and W absent)',
    74: 'TPERM EXACT: CR1 vs CR3 both from slot 7 → bit-identical (Z=1)',
    75: 'TPERM EXACT is symmetric: CR3 vs CR1 also matches',
    76: 'Third load from slot 7 into CR5 must be bit-identical to CR1',
    77: 'E-GT loaded twice from slot 3 into CR2 and CR4 must match',
    78: 'After CHANGE CR1↔CR2: CR1 is now E-GT (satisfies TPERM E)',
    79: 'After CHANGE CR1↔CR2: CR2 is now X-GT (satisfies TPERM X)',
    80: 'Fresh LOAD slot 7 into CR9 → satisfies TPERM X',
    81: 'Fresh LOAD slot 3 into CR9 → satisfies TPERM E',
};

function _buildSelftestPanel(dr0, passed) {
    const total = 81;
    const inconclusive = dr0 === null;
    const failNum = (passed || inconclusive) ? 0 : (dr0 >>> 0);

    const badgeClass = inconclusive ? 'selftest-badge-skip'
                     : passed       ? 'selftest-badge-pass'
                                    : 'selftest-badge-fail';
    const badgeText  = inconclusive ? '???' : (passed ? 'PASS' : 'FAIL');
    const dr0Str     = inconclusive ? 'unknown' : String(dr0 >>> 0);
    const countStr   = inconclusive ? `Simulator halted before reading DR0`
                     : passed       ? `All ${total} tests passed`
                                    : `Failed at test #${failNum} of ${total}`;

    let sectionsHtml = '';
    for (const sec of _SELFTEST_SECTIONS) {
        let rowClass, icon;
        if (passed || failNum > sec.end) {
            rowClass = 'selftest-sec-pass';
            icon = '<span class="selftest-sec-icon selftest-sec-icon-pass">&#10003;</span>';
        } else if (!passed && failNum >= sec.start && failNum <= sec.end) {
            rowClass = 'selftest-sec-fail';
            icon = '<span class="selftest-sec-icon selftest-sec-icon-fail">&#10007;</span>';
        } else {
            rowClass = 'selftest-sec-skip';
            icon = '<span class="selftest-sec-icon selftest-sec-icon-skip">&#8212;</span>';
        }

        const rangeStr = sec.start === sec.end
            ? `Test ${sec.start}`
            : `Tests ${sec.start}\u2013${sec.end}`;

        sectionsHtml += `<div class="selftest-sec-row ${rowClass}">
            ${icon}
            <span class="selftest-sec-letter">${sec.letter}</span>
            <span class="selftest-sec-name">${sec.name}</span>
            <span class="selftest-sec-range">${rangeStr}</span>
        </div>`;

        if (!passed && failNum >= sec.start && failNum <= sec.end) {
            const testDesc = _SELFTEST_TEST_DESCS[failNum] || `Test #${failNum}`;
            sectionsHtml += `<div class="selftest-test-detail">
                <span class="selftest-test-num">Test #${failNum}</span>
                <span class="selftest-test-desc">${testDesc}</span>
            </div>`;
        }
    }

    return `<div class="selftest-panel-header">
        <span class="selftest-badge ${badgeClass}">${badgeText}</span>
        <span class="selftest-panel-dr0">DR0 = ${dr0Str}</span>
        <span class="selftest-panel-count">${countStr}</span>
    </div>
    <div class="selftest-sections">${sectionsHtml}</div>`;
}

async function runSelftestLump() {
    const SELFTEST_TOKEN = '82f5ef56';
    const SELFTEST_NAME  = 'PostFlashSelftest';
    const MAX_STEPS = 500000;

    const btn = document.getElementById('dashSelftestBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Loading\u2026'; }
    try {
        const resp = await fetch(`/api/lump/${SELFTEST_TOKEN}/words`);
        if (!resp.ok) throw new Error(`Server returned ${resp.status}`);
        const data = await resp.json();
        const words = data.words || [];
        if (!words.length) throw new Error('Empty LUMP');

        if (typeof sim === 'undefined' || !sim) throw new Error('Simulator not ready');
        if (!sim.bootComplete && typeof instantBoot === 'function') instantBoot();

        sim.loadProgram(words, 0);
        if (typeof _syncBootEntryFromSim === 'function') _syncBootEntryFromSim();
        if (typeof lastAssembledWords !== 'undefined') lastAssembledWords = words.slice();
        if (typeof _defaultProgramLoaded !== 'undefined') window._defaultProgramLoaded = true;
        if (typeof _injectClistNow === 'function') {
            _injectClistNow();
            if (typeof _pendingSimLoad !== 'undefined') window._pendingSimLoad = false;
        } else {
            if (typeof _pendingSimLoad !== 'undefined') window._pendingSimLoad = true;
        }
        if (sim.programName !== undefined) sim.programName = SELFTEST_NAME;

        if (btn) btn.textContent = 'Running\u2026';

        let steps = 0;
        while (!sim.halted && steps < MAX_STEPS) {
            sim.step();
            steps++;
        }

        const dr0 = (sim.DR && sim.DR[0] !== undefined) ? (sim.DR[0] >>> 0) : null;
        const passed = dr0 === 0;

        window._lastSelftestResult = { dr0, passed };

        try {
            const mtbfResp = await fetch(`/api/lump/${SELFTEST_TOKEN}/mtbf`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ passed })
            });
            if (mtbfResp.ok) {
                const mtbfData = await mtbfResp.json();
                if (mtbfData.ok && mtbfData.mtbf) {
                    const cacheEntry = (typeof _lumpsCache !== 'undefined' ? _lumpsCache : [])
                        .find(l => l.token === SELFTEST_TOKEN);
                    if (cacheEntry) {
                        cacheEntry.mtbf = mtbfData.mtbf;
                        if (typeof _selectedLumpToken !== 'undefined' &&
                            _selectedLumpToken === SELFTEST_TOKEN &&
                            typeof showLumpDetail === 'function') {
                            showLumpDetail(SELFTEST_TOKEN);
                        }
                    }
                }
            }
        } catch (_mtbfErr) {
            const warnEl = document.getElementById('dashSelftestResult');
            if (warnEl) {
                warnEl.textContent += ' \u2014 MTBF not saved (network error)';
            }
            console.warn('[runSelftestLump] MTBF record failed:', _mtbfErr);
        }

        if (btn) { btn.disabled = false; btn.textContent = 'Run Selftest'; }
        if (typeof updateDisplay === 'function') updateDisplay();
        switchDashTab('state');
    } catch (err) {
        if (btn) { btn.disabled = false; btn.textContent = 'Run Selftest'; }
        alert(`Selftest failed: ${err.message}`);
    }
}

// ── GT pet-name inline editing (Tokens tab) ──────────────────────────────────

async function _lumpGTNameCommit(inputEl) {
    const token   = inputEl.dataset.token;
    const crSlot  = inputEl.dataset.crSlot;
    const newName = inputEl.value.trim();
    const orig    = inputEl.dataset.orig || '';
    if (newName === orig) return;

    inputEl.dataset.orig = newName;

    if (newName) {
        inputEl.classList.remove('lump-gt-name-unresolved');
    } else {
        inputEl.classList.add('lump-gt-name-unresolved');
    }

    const lump = (typeof _lumpsCache !== 'undefined' && _lumpsCache)
        ? _lumpsCache.find(l => l.token === token) : null;
    if (lump) {
        if (!lump.pet_names) lump.pet_names = {};
        if (!lump.pet_names.CR) lump.pet_names.CR = {};
        if (newName) {
            lump.pet_names.CR[String(crSlot)] = newName;
        } else {
            delete lump.pet_names.CR[String(crSlot)];
        }
    }

    try {
        const resp = await fetch(`/api/lump/${token}/meta`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pet_name_cr_slot: crSlot, pet_name_cr_value: newName })
        });
        if (!resp.ok) {
            const errData = await resp.json().catch(() => ({}));
            throw new Error(errData.error || `HTTP ${resp.status}`);
        }
        inputEl.style.transition = 'color 0.2s';
        inputEl.style.color = '#88dd88';
        setTimeout(() => { inputEl.style.color = ''; }, 700);
    } catch (err) {
        console.warn('[_lumpGTNameCommit] persist failed:', err);
        inputEl.style.transition = 'color 0.2s';
        inputEl.style.color = '#f87171';
        setTimeout(() => { inputEl.style.color = ''; }, 1200);
        inputEl.title = `Save failed: ${err.message}`;
    }
}

function _applyLumpNamesToSim(token) {
    if (typeof sim === 'undefined' || !sim) {
        alert('Simulator is not running. Load a LUMP or boot the simulator first.');
        return;
    }
    if (!sim.nsLabels) sim.nsLabels = {};
    const tk     = (token || '').replace(/[^a-z0-9]/gi, '');
    const bodyEl = document.getElementById(`lumpTokensBody_${tk}`);
    if (!bodyEl) return;
    let count = 0;
    bodyEl.querySelectorAll('.lump-gt-chip[data-ns-slot]').forEach(chip => {
        const nsSlot = parseInt(chip.dataset.nsSlot, 10);
        if (isNaN(nsSlot)) return;
        const inp = chip.querySelector('.lump-gt-name-input');
        const name = inp ? inp.value.trim() : '';
        if (name) {
            sim.nsLabels[nsSlot] = name;
            count++;
        }
    });
    const con = document.getElementById('editorConsole');
    if (con) {
        con.className = '';
        con.textContent = count
            ? `Applied ${count} name${count === 1 ? '' : 's'} to simulator namespace.`
            : 'No named GT slots found — nothing applied.';
    }
    if (typeof updateDisplay === 'function') updateDisplay();
}

// ── Overview tab CR pet-name inline editing ──────────────────────────────────

async function _lumpOverviewCREdit(token, crSlot, btnEl) {
    const tk     = (token || '').replace(/[^a-z0-9]/gi, '');
    const cellId = `lump-pn-cr-cell-${tk}-${crSlot}`;
    const cell   = document.getElementById(cellId);
    if (!cell || cell.querySelector('input')) return;

    const lump    = (typeof _lumpsCache !== 'undefined' && _lumpsCache)
        ? _lumpsCache.find(l => l.token === token) : null;
    const current = lump ? ((lump.pet_names || {}).CR || {})[String(crSlot)] || '' : '';

    const inp = document.createElement('input');
    inp.type  = 'text';
    inp.value = current;
    inp.className = 'lump-pn-cr-input';
    inp.placeholder = 'pet name';

    cell.textContent = '';
    cell.appendChild(inp);
    inp.focus();
    inp.select();

    async function commit() {
        const newName = inp.value.trim();
        cell.textContent = newName || '\u2014';
        if (btnEl) cell.parentElement && cell.parentElement.querySelector('.lump-pn-edit-btn') && (cell.parentElement.querySelector('.lump-pn-edit-btn').disabled = false);

        if (newName === current) return;

        if (lump) {
            if (!lump.pet_names) lump.pet_names = {};
            if (!lump.pet_names.CR) lump.pet_names.CR = {};
            if (newName) {
                lump.pet_names.CR[String(crSlot)] = newName;
            } else {
                delete lump.pet_names.CR[String(crSlot)];
            }
        }

        try {
            const resp = await fetch(`/api/lump/${token}/meta`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pet_name_cr_slot: crSlot, pet_name_cr_value: newName })
            });
            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP ${resp.status}`);
            }
        } catch (err) {
            console.warn('[_lumpOverviewCREdit] persist failed:', err);
            cell.title = `Save failed: ${err.message}`;
            cell.style.color = '#f87171';
            setTimeout(() => { cell.style.color = ''; cell.title = ''; }, 2000);
        }
    }

    inp.addEventListener('blur', commit, { once: true });
    inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
        if (e.key === 'Escape') { inp.value = current; inp.blur(); }
    });
}

