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
    _headerStrip += `</div>`;

    let _tabBar = `<div class="lump-tabs-bar" id="lumpTabBar_${_tk}">` +
        `<button class="lump-tab lump-tab-active" onclick="_switchLumpTab('${_tk}','overview')">Overview</button>`;
    if (!isNamespace) _tabBar += `<button class="lump-tab" onclick="_switchLumpTab('${_tk}','content')">Content</button>`;
    _tabBar += `<button class="lump-tab" onclick="_switchLumpTab('${_tk}','hexdump')">Hex Dump</button></div>`;

    let html = _headerStrip + _tabBar + `<div class="lump-tab-panel lump-tab-panel-active" id="lumpTabOverview_${_tk}"><div class="lump-detail-sections">`;

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
    }

    if (!isNamespace) {
    const methods = lump.methods || [];
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
            const aliasCell = m.aliasOf ? ` <span style="color:#6b7280;font-size:0.78rem;">→ ${e(m.aliasOf)}</span>` : '';
            if (anyMethodPN) {
                const drMap = ((m.pet_names || {}).DR) || {};
                const drStr = Object.entries(drMap)
                    .sort(([a], [b]) => parseInt(a) - parseInt(b))
                    .map(([k, v]) => `DR${k}=${v}`)
                    .join(', ');
                html += `<tr><td>${i}</td><td>${e(m.name)}${aliasCell}</td><td>${parseInt(m.offset) || 0}</td><td>${parseInt(m.length) || 0}</td><td style="color:#a855f7;font-size:0.78rem;">${e(drStr)}</td></tr>`;
            } else {
                html += `<tr><td>${i}</td><td>${e(m.name)}${aliasCell}</td><td>${parseInt(m.offset) || 0}</td><td>${parseInt(m.length) || 0}</td></tr>`;
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

    html += '<div class="lump-detail-actions">';
    html += `<button class="btn lump-delete-btn" data-delete-token="${e(token)}">Delete Lump</button>`;
    html += '</div>';

    html += '</div></div>';

    if (!isNamespace) {
        html += `<div class="lump-tab-panel" id="lumpTabContent_${_tk}">` +
                `<div id="lumpContentBody_${_tk}" class="lump-hex-loading">Loading\u2026</div></div>`;
    }
    html += `<div class="lump-tab-panel" id="lumpTabHexdump_${_tk}">` +
            `<div id="lumpBinBody_${_tk}" class="lump-hex-loading">Loading\u2026</div></div>`;

    contentEl.innerHTML = html;
    const delBtn = contentEl.querySelector('.lump-delete-btn[data-delete-token]');
    if (delBtn) delBtn.addEventListener('click', () => deleteLump(delBtn.dataset.deleteToken));
    _lumpActiveTab[_tk] = 'overview';
    const nsdgWrap = contentEl.querySelector('.ns-dep-graph-wrap[id]');
    if (nsdgWrap) _initNsDepGraphPanZoom(nsdgWrap.id);
    const restoreTab = (_lumpEditorOpen[_tk] && !isNamespace) ? 'content' : _prevTab;
    if (restoreTab !== 'overview') _switchLumpTab(_tk, restoreTab);
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

const _lumpActiveTab      = {};
const _lumpContentLoaded  = {};
const _lumpHexLoaded      = {};
const _lumpEditorOpen     = {};
const _lumpEditorDraftText = {};

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
    const tabMap = { overview: `lumpTabOverview_${tk}`, content: `lumpTabContent_${tk}`, hexdump: `lumpTabHexdump_${tk}` };
    Object.entries(tabMap).forEach(([t, id]) => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('lump-tab-panel-active', t === tab);
    });
    const bar = document.getElementById(`lumpTabBar_${tk}`);
    if (bar) {
        const btns = bar.querySelectorAll('.lump-tab');
        btns.forEach(btn => {
            const labelMap = { overview: 'Overview', content: 'Content', hexdump: 'Hex Dump' };
            btn.classList.toggle('lump-tab-active', btn.textContent.trim() === labelMap[tab]);
        });
    }
    const lump = _lumpsCache.find(l => (l.token || '').replace(/[^a-z0-9]/gi, '') === tk);
    const token = lump ? lump.token : tk;
    if (tab === 'content' && !_lumpContentLoaded[tk] && lump) {
        _lumpContentLoaded[tk] = true;
        _loadLumpContent(token, lump);
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

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn lump-edit-cancel-btn';
    cancelBtn.textContent = 'Cancel';

    const statusEl = document.createElement('span');
    statusEl.className = 'lump-edit-status';

    actionRow.appendChild(saveBtn);
    actionRow.appendChild(cancelBtn);
    actionRow.appendChild(statusEl);
    editorArea.appendChild(actionRow);
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
            _renderLumpCodeContent(bodyEl, lump, words);
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
        bodyEl.textContent = `Failed to load content: ${err.message}`;
    }
}

function _renderLumpCodeContent(bodyEl, lump, words) {
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

    // Pre-parse c-list slots so we can resolve names during disassembly
    const clistSlotName = {};   // slot index (0-based) → human name
    const clistStart = lumpSize - cc;
    for (let s = 0; s < cc; s++) {
        const wIdx = clistStart + s;
        const wVal = wIdx < words.length ? (words[wIdx] >>> 0) : 0;
        const resolved = wVal ? _clistName(wVal) : '';
        clistSlotName[s] = resolved || `0x${wVal.toString(16).padStart(8, '0')}`;
    }

    // ── Auto-comment engine ──────────────────────────────────────────────
    // Generates a human-readable semantic comment for one instruction.
    // Uses the already-maintained crAlias + clistSlotName context.
    const _autoComment = (w, op, crDst, crSrc, imm, cond, crAlias) => {
        if (w === 0) return 'end of method / padding';

        const condNames = ['EQ','NE','CS','CC','MI','PL','VS','VC','HI','LS','GE','LT','GT','LE','','NV'];
        const condStr   = cond === 14 ? '' : `if ${condNames[cond]} `;

        const crName = n => {
            if (n === 6 && cc > 0) return 'c-list';
            if (n === 14) return 'CR14(code)';
            if (n === 13) return 'CR13(int)';
            if (n === 15) return 'CR15(priv)';
            return `CR${n}`;
        };
        const crAliasSym = n => {
            if (crAlias[n] !== undefined) {
                const nm = clistSlotName[crAlias[n]];
                return nm ? `"${nm}"` : null;
            }
            return null;
        };

        switch (op) {
            case 0: {  // LOAD CRd, CRs[imm]
                if (crSrc === 6 && cc > 0) {
                    const nsName = abstractionRegistry && abstractionRegistry.abstractions[imm] ? abstractionRegistry.abstractions[imm].name : null;
                    const nm = nsName || clistSlotName[imm] || `slot ${imm}`;
                    return `${condStr}CR${crDst} ← c-list[${imm}] (${nm})`;
                }
                const sym = crAliasSym(crSrc);
                return `${condStr}CR${crDst} ← GT via ${crName(crSrc)}[${imm}]${sym ? ` ${sym}` : ''}`;
            }
            case 1: {  // SAVE CRd, CRs[imm]
                const sym = crAliasSym(crDst);
                return `${condStr}store CR${crSrc} → GT space of ${crName(crDst)}[${imm}]${sym ? ` ${sym}` : ''}`;
            }
            case 2: {  // CALL CRd[, sel]
                const sym = crAliasSym(crDst);
                const name = sym ? ` ${sym}` : '';
                const selSrc = crSrc ? `, method #${crSrc}` : '';
                return `${condStr}invoke CR${crDst}${name}${selSrc}`;
            }
            case 3: {  // RETURN [mask]
                const retMask = imm & 0xFFF;
                return retMask
                    ? `scrub regs 0b${retMask.toString(2).padStart(12,'0')} then return`
                    : 'return to caller';
            }
            case 4: {  // CHANGE CRd, CRs[imm]
                if (crSrc === 6 && cc > 0) {
                    const nsName = abstractionRegistry && abstractionRegistry.abstractions[imm] ? abstractionRegistry.abstractions[imm].name : null;
                    const nm = nsName || clistSlotName[imm] || `slot ${imm}`;
                    return `${condStr}hot-swap CR${crDst} ← c-list[${imm}] (${nm})`;
                }
                return `${condStr}update CR${crDst} via ${crName(crSrc)}[${imm}]`;
            }
            case 5: {  // SWITCH CRs, CRb
                return `${condStr}swap CR${crSrc} ↔ CR${imm & 0x7}`;
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
                    const nsName = abstractionRegistry && abstractionRegistry.abstractions[imm] ? abstractionRegistry.abstractions[imm].name : null;
                    const nm = nsName || clistSlotName[imm] || `slot ${imm}`;
                    return `${condStr}fused load + call c-list[${imm}] (${nm}) → CR${crDst}`;
                }
                return `${condStr}fused load + call ${crName(crSrc)}[${imm}] → CR${crDst}`;
            }
            case 9: {  // XLOADLAMBDA CRd, CRs[imm]
                if (crSrc === 6 && cc > 0) {
                    const nsName = abstractionRegistry && abstractionRegistry.abstractions[imm] ? abstractionRegistry.abstractions[imm].name : null;
                    const nm = nsName || clistSlotName[imm] || `slot ${imm}`;
                    return `${condStr}fused load + lambda c-list[${imm}] (${nm}) → CR${crDst}`;
                }
                return `${condStr}fused load + lambda ${crName(crSrc)}[${imm}] → CR${crDst}`;
            }
            case 10: {  // DREAD DRd, CRs[imm]
                const sym = crAliasSym(crSrc);
                return `${condStr}DR${crDst} ← data[${crName(crSrc)}+${imm}]${sym ? ` (${sym})` : ''}`;
            }
            case 11: {  // DWRITE DRd, CRs[imm]
                const sym = crAliasSym(crSrc);
                return `${condStr}data[${crName(crSrc)}+${imm}]${sym ? ` (${sym})` : ''} ← DR${crDst}`;
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
    let html = '<div class="lump-content-code">';
    if (effEnd <= 1) {
        html += '<div class="lumps-placeholder">No code words in this lump.</div>';
    } else {
        // Live CR alias map: tracks which cap-register holds which c-list slot
        const crAlias = {};  // crNum → slot index (int)
        let _curMethodObj = null;
        let instrRelIdx   = 0;

        for (let i = 1; i < effEnd; i++) {
            // Method boundary → reset per-method register aliases and update DR pet names
            if (mb[i] !== undefined) {
                const auto = autoDetected ? ' <span class="lump-meth-auto" title="Auto-detected boundary">[~]</span>' : '';
                html += `<div class="lump-code-method-label">\u25c6 ${e(mb[i])}${auto}</div>`;
                for (const k of Object.keys(crAlias)) delete crAlias[k];
                _curMethodDRMap = methodDRPetNames[mb[i]] || {};
                _curMethodObj   = mbObj[i] || null;
                instrRelIdx     = 0;
                html += _renderDocstring(_curMethodObj);
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
            const _nsOrClistName = idx => {
                const nsEntry = abstractionRegistry && abstractionRegistry.abstractions[idx];
                return (nsEntry ? nsEntry.name : null) || clistSlotName[idx];
            };
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
            const commentText = staticCmt || _autoComment(w, op, crDst, crSrc, imm, cond, crAlias);

            const addr = (i * 4).toString(16).toUpperCase().padStart(4, '0');
            const hex  = (w >>> 0).toString(16).toUpperCase().padStart(8, '0');
            let disText = dis(w);
            if (Object.keys(_curMethodDRMap).length > 0) {
                disText = disText.replace(/\bDR(\d+)\b/g, (match, numStr) => {
                    const pet = _curMethodDRMap[parseInt(numStr)];
                    return pet ? `${pet}(DR${numStr})` : match;
                });
            }
            html += `<div class="lump-code-row">` +
                    `<span class="lump-code-addr">0x${addr}</span>` +
                    `<span class="lump-code-hex">${hex}</span>` +
                    `<span class="lump-code-instr">${e(disText)}${ann ? ' ' + ann : ''}</span>` +
                    `<span class="lump-code-comment">; ${e(commentText)}</span></div>`;

            instrRelIdx++;

            // RETURN or HALT → clear aliases (next code is a new method scope)
            if (w === 0 || op === 3) {
                for (const k of Object.keys(crAlias)) delete crAlias[k];
            }
        }
    }
    html += '</div>';

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

    // C-list viewer
    if (cc > 0) {
        html += `<div class="lump-clist-section"><div class="lump-clist-title">C-List — ${cc} entr${cc === 1 ? 'y' : 'ies'}</div><div class="lump-clist-table">`;
        for (let s = 0; s < cc; s++) {
            const wIdx = clistStart + s;
            const wVal = wIdx < words.length ? (words[wIdx] >>> 0) : 0;
            const hexTok = wVal.toString(16).padStart(8, '0');
            const resolved = wVal ? _clistName(wVal) : '';
            html += `<div class="lump-clist-row">` +
                    `<span class="lump-clist-idx">[${s}]</span>` +
                    `<span class="lump-clist-tok">0x${hexTok}</span>` +
                    `<span class="lump-clist-name">${resolved ? e(resolved) : '<span class="lump-clist-null">—</span>'}</span>` +
                    `</div>`;
        }
        html += '</div></div>';
    }

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

