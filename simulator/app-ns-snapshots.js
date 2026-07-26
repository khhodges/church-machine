// =============================================================================
// app-ns-snapshots.js — NS Config Snapshots: Save & Restore
// =============================================================================
// Provides save/restore of named Namespace configuration snapshots.
// Snapshots are stored server-side in the ns_snapshots SQLite table and
// survive page reloads and server restarts.
//
// Public surface (called by index.html / app-memory.js):
//   nsSnapshotOpenDialog()          — open the "Save snapshot" name dialog
//   _renderNsSnapshotPanel(force)   — render (or refresh) the snapshot list panel
//   _nsSnapshotTogglePanel()        — toggle panel open/closed
//   _nsSnapshotRestore(id)          — restore a saved snapshot by server id
//   _nsSnapshotDelete(id)           — delete a snapshot by server id
// =============================================================================

(function () {

var _ACTIVE_SNAP_KEY = 'church_ns_active_snapshot';
var _STICKY_PREFIX   = 'cm_sticky_p_';
var _NS_STATE_KEY    = 'church_namespace';

function _getActiveSnapId() {
    try { return parseInt(localStorage.getItem(_ACTIVE_SNAP_KEY), 10) || null; } catch (_) { return null; }
}
function _setActiveSnapId(id) {
    try {
        if (id == null) localStorage.removeItem(_ACTIVE_SNAP_KEY);
        else            localStorage.setItem(_ACTIVE_SNAP_KEY, String(id));
    } catch (_) {}
}

function _escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _formatAge(ts) {
    if (!ts) return '';
    var diff = Date.now() / 1000 - ts;
    if (diff < 60)     return 'just now';
    if (diff < 3600)   return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400)  return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return new Date(ts * 1000).toLocaleDateString();
}

function _toast(msg, color) {
    color = color || '#4ec9b0';
    var el = document.createElement('div');
    el.style.cssText = [
        'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);',
        'background:#12121f;border:1px solid ' + color + ';color:' + color + ';',
        'padding:8px 20px;border-radius:6px;font-size:0.84rem;z-index:99999;',
        'box-shadow:0 4px 16px rgba(0,0,0,0.5);transition:opacity 0.4s;pointer-events:none;'
    ].join('');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.style.opacity = '0'; }, 2400);
    setTimeout(function () { el.remove(); }, 2900);
}

// ── Read sticky patches from localStorage (cm_sticky_p_* keys) ───────────────
function _readStickyPatchesFromStorage() {
    var patches = {};
    try {
        for (var i = localStorage.length - 1; i >= 0; i--) {
            var k = localStorage.key(i);
            if (k && k.startsWith(_STICKY_PREFIX)) {
                try {
                    var p = JSON.parse(localStorage.getItem(k));
                    if (p && typeof p.nsIdx === 'number' && Array.isArray(p.words)) {
                        patches[p.nsIdx] = p;
                    }
                } catch (_) {}
            }
        }
    } catch (_) {}
    return patches;
}

// ── Build snapshot payload from current sim state ─────────────────────────────
// The slot format matches saveNamespaceState() so we can write directly to
// church_namespace localStorage on restore (without reformatting).
function _buildPayload() {
    if (!window.sim) return null;
    var slots = [];
    var count = sim.nsCount || 0;
    for (var i = 0; i < count; i++) {
        var e = sim.readNSEntry ? sim.readNSEntry(i) : null;
        var customLabel = (sim.nsLabels && sim.nsLabels[i]) || null;
        if (!e && !customLabel) { slots.push(null); continue; }
        if (!e) {
            slots.push({ nsWords: [], label: customLabel, dataWords: [] });
            continue;
        }
        var base = sim._nsSlotBase ? sim._nsSlotBase(i) : null;
        var nsWords = (base !== null && sim.memory)
            ? [(sim.memory[base] >>> 0), (sim.memory[base + 1] >>> 0), (sim.memory[base + 2] >>> 0)]
            : [];
        var dataWords = [];
        if (sim.getEntryMemory) {
            var mem = sim.getEntryMemory(i);
            if (mem) dataWords = [(mem.gt >>> 0)].concat((mem.words || []).map(function (w) { return w >>> 0; }));
        }
        slots.push({
            nsWords:   nsWords,
            label:     e.label || customLabel || '',
            dataWords: dataWords,
        });
    }

    var bootSlot  = sim.bootEntrySlot != null ? sim.bootEntrySlot : 6;
    var bootLabel = (sim.nsLabels && sim.nsLabels[bootSlot]) || '';
    var slotLabels = {};
    if (sim.nsLabels) {
        for (var k in sim.nsLabels) {
            if (Object.prototype.hasOwnProperty.call(sim.nsLabels, k)) slotLabels[k] = sim.nsLabels[k];
        }
    }

    // Read sticky patches directly from localStorage (the authoritative store).
    var stickyPatches = _readStickyPatchesFromStorage();

    return {
        slots:          slots,            // saveNamespaceState-compatible format
        bootEntrySlot:  bootSlot,
        bootEntryLabel: bootLabel,
        slotLabels:     slotLabels,
        stickyPatches:  stickyPatches,    // keyed by nsIdx, each has .words/.nsIdx/.crIdx/.src
    };
}

// ── Save dialog ───────────────────────────────────────────────────────────────
window.nsSnapshotOpenDialog = function () {
    var existing = document.getElementById('_nsSnapDialogOverlay');
    if (existing) existing.remove();

    var ov = document.createElement('div');
    ov.id = '_nsSnapDialogOverlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:10010;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;';
    ov.innerHTML =
        '<div style="background:#12121f;border:1px solid #2a2a4a;border-radius:8px;padding:22px 26px;min-width:320px;max-width:480px;width:100%;color:#d0d0e8;font-size:0.85rem;">' +
            '<div style="font-size:1rem;font-weight:600;color:#daa520;margin-bottom:10px;">&#128190; Save NS Snapshot</div>' +
            '<p style="color:#888;font-size:0.82rem;margin:0 0 12px;">Name this configuration so you can restore it later.</p>' +
            '<input id="_nsSnapNameIn" type="text" maxlength="120" placeholder="e.g. LED Demo, Math Prototype\u2026"' +
            '  style="width:100%;box-sizing:border-box;background:#0d0d1a;color:#d0d0e8;border:1px solid #2a2a4a;border-radius:4px;padding:7px 10px;font-size:0.88rem;margin-bottom:12px;" />' +
            '<div id="_nsSnapDialogErr" style="color:#f87171;font-size:0.78rem;min-height:1.1em;margin-bottom:10px;"></div>' +
            '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
                '<button onclick="document.getElementById(\'_nsSnapDialogOverlay\').remove()"' +
                '  style="background:transparent;color:#888;border:1px solid #2a2a4a;border-radius:4px;padding:5px 16px;font-size:0.82rem;cursor:pointer;">Cancel</button>' +
                '<button id="_nsSnapSaveBtn" onclick="window._nsSnapshotDoSave()"' +
                '  style="background:#1a3a1f;color:#daa520;border:1px solid rgba(218,165,32,0.5);border-radius:4px;padding:5px 16px;font-size:0.82rem;font-weight:600;cursor:pointer;">Save</button>' +
            '</div>' +
        '</div>';
    ov.addEventListener('click', function (ev) { if (ev.target === ov) ov.remove(); });
    document.body.appendChild(ov);

    var inp = document.getElementById('_nsSnapNameIn');
    if (inp) {
        inp.focus();
        inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') window._nsSnapshotDoSave(); });
    }
};

window._nsSnapshotDoSave = function () {
    var inp   = document.getElementById('_nsSnapNameIn');
    var errEl = document.getElementById('_nsSnapDialogErr');
    var btn   = document.getElementById('_nsSnapSaveBtn');
    var name  = inp ? inp.value.trim() : '';
    if (!name) { if (errEl) errEl.textContent = 'Please enter a name.'; return; }
    if (btn)   { btn.disabled = true; btn.textContent = 'Saving\u2026'; }
    var payload = _buildPayload();
    if (!payload) {
        if (errEl) errEl.textContent = 'Simulator not ready.';
        if (btn)   { btn.disabled = false; btn.textContent = 'Save'; }
        return;
    }
    payload.name = name;
    fetch('/api/ns-snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
        if (!data.ok) {
            if (errEl) errEl.textContent = data.error || 'Save failed.';
            if (btn)   { btn.disabled = false; btn.textContent = 'Save'; }
            return;
        }
        _setActiveSnapId(data.id);
        var ov = document.getElementById('_nsSnapDialogOverlay');
        if (ov) ov.remove();
        _toast('\u2713 Snapshot \u201c' + name + '\u201d saved', '#daa520');
        window._renderNsSnapshotPanel(true);
    })
    .catch(function (err) {
        if (errEl) errEl.textContent = 'Network error: ' + err;
        if (btn)   { btn.disabled = false; btn.textContent = 'Save'; }
    });
};

// ── Restore ───────────────────────────────────────────────────────────────────
window._nsSnapshotRestore = function (id) {
    fetch('/api/ns-snapshots/' + id)
        .then(function (r) {
            if (!r.ok) return Promise.reject('HTTP ' + r.status);
            return r.json();
        })
        .then(function (data) {
            if (!data || !data.payload) { _toast('\u26a0 Empty snapshot payload', '#f87171'); return; }
            _applyPayload(id, data.name || '', data.payload);
        })
        .catch(function (err) { _toast('\u26a0 Restore failed: ' + err, '#f87171'); });
};

function _applyPayload(id, snapName, payload) {
    if (!window.sim) { _toast('\u26a0 Simulator not ready', '#f87171'); return; }

    var slots      = payload.slots || [];
    var bootSlot   = payload.bootEntrySlot != null ? payload.bootEntrySlot : sim.bootEntrySlot;
    var slotLabels = payload.slotLabels || {};
    var stickySnap = payload.stickyPatches || {};
    var bootLabel  = payload.bootEntryLabel || ('slot ' + bootSlot);

    // ── 1. Clear ALL current NS entries (zero the 3 NS words) ─────────────────
    // This removes stale slots that are present now but absent in the snapshot,
    // making isNSEntryValid() return false for every slot so loadNamespaceState()
    // will unconditionally fill them from the snapshot data.
    var clearUpTo = Math.max(sim.nsCount || 0, slots.length);
    for (var ci = 0; ci < clearUpTo; ci++) {
        var cBase = (sim._nsSlotBase) ? sim._nsSlotBase(ci) : null;
        if (cBase !== null && sim.memory) {
            sim.memory[cBase + 0] = 0;
            sim.memory[cBase + 1] = 0;
            sim.memory[cBase + 2] = 0;
        }
        if (sim.nsLabels) delete sim.nsLabels[ci];
    }
    sim.nsCount = 0;

    // ── 2. Write snapshot to church_namespace localStorage ────────────────────
    // Exact same format as saveNamespaceState() so loadNamespaceState() consumes
    // it correctly.  After clearing above, every slot is invalid → loadNamespace
    // State fills each entry without skipping any.
    try {
        localStorage.setItem(_NS_STATE_KEY, JSON.stringify(slots));
    } catch (_) {}

    // ── 3. Replay through the canonical loadNamespaceState path ───────────────
    if (typeof loadNamespaceState === 'function') {
        loadNamespaceState();
    }

    // ── 4. Apply slotLabels from snapshot (authoritative label set) ────────────
    for (var sk in slotLabels) {
        if (Object.prototype.hasOwnProperty.call(slotLabels, sk)) {
            var sn = parseInt(sk, 10);
            if (!isNaN(sn)) sim.nsLabels[sn] = slotLabels[sk];
        }
    }

    // ── 5. Apply boot entry slot via canonical sync ────────────────────────────
    // _syncBootEntryFromSim() propagates sim.bootEntrySlot → global bootEntrySlot
    // variable + localStorage so updateNamespace() renders the ⚡ marker correctly
    // and the choice persists across reloads.
    if (bootSlot != null) {
        sim.bootEntrySlot = bootSlot;
        if (typeof _syncBootEntryFromSim === 'function') _syncBootEntryFromSim();
    }

    // ── 6. Restore sticky patches via localStorage + reload hook ──────────────
    // Clear all existing cm_sticky_p_* keys, write snapshot's patches, then
    // reload the in-memory _stickyPatches store (app-cr-detail.js) and re-apply.
    try {
        var keysToRemove = [];
        for (var li = localStorage.length - 1; li >= 0; li--) {
            var lk = localStorage.key(li);
            if (lk && lk.startsWith(_STICKY_PREFIX)) keysToRemove.push(lk);
        }
        for (var ki = 0; ki < keysToRemove.length; ki++) localStorage.removeItem(keysToRemove[ki]);
        for (var sk2 in stickySnap) {
            if (Object.prototype.hasOwnProperty.call(stickySnap, sk2)) {
                var sp = stickySnap[sk2];
                if (sp && typeof sp.nsIdx === 'number') {
                    localStorage.setItem(_STICKY_PREFIX + sp.nsIdx, JSON.stringify(sp));
                }
            }
        }
    } catch (_) {}
    if (typeof window._loadStickyPatchesFromStorage === 'function') {
        window._loadStickyPatchesFromStorage();
    }
    if (typeof window._reapplyStickyPatches === 'function') {
        window._reapplyStickyPatches();
    }

    _setActiveSnapId(id);

    // ── 7. Persist final state & refresh UI ───────────────────────────────────
    // saveNamespaceState() re-serialises the now-restored sim state back to
    // localStorage so any subsequent reload picks up the correct configuration.
    if (typeof saveNamespaceState === 'function') saveNamespaceState();
    if (typeof updateNamespace    === 'function') updateNamespace();
    if (typeof updateDashboard    === 'function') updateDashboard();
    if (sim.emit) sim.emit('stateChange', sim.getState ? sim.getState() : {});

    var restored = slots.filter(function (s) { return s !== null; }).length;
    var restoreMsg = '\u2713 Restored \u201c' + snapName + '\u201d \u2014 ' +
        restored + ' slot' + (restored !== 1 ? 's' : '') + ', boot entry: ' + bootLabel;
    _toast(restoreMsg, '#daa520');
    window._renderNsSnapshotPanel(true);
}

// ── Delete ────────────────────────────────────────────────────────────────────
window._nsSnapshotDelete = function (id) {
    if (!confirm('Delete this snapshot?')) return;
    fetch('/api/ns-snapshots/' + id, { method: 'DELETE' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.ok) {
                if (_getActiveSnapId() === id) _setActiveSnapId(null);
                _toast('Snapshot deleted', '#888');
                window._renderNsSnapshotPanel(true);
            }
        })
        .catch(function () {});
};

// ── Toggle panel ──────────────────────────────────────────────────────────────
window._nsSnapshotTogglePanel = function () {
    var panel   = document.getElementById('nsSnapshotPanel');
    if (!panel) return;
    var body    = panel.querySelector('.ns-snap-body');
    var chevron = panel.querySelector('.ns-snap-chevron');
    if (!body) return;
    var opening = (body.style.display === 'none');
    body.style.display = opening ? 'block' : 'none';
    if (chevron) chevron.textContent = opening ? '\u25BC' : '\u25B6';
    if (opening) window._renderNsSnapshotPanel(false);
};

// ── Render panel ──────────────────────────────────────────────────────────────
window._renderNsSnapshotPanel = function (forceRefresh) {
    var panel = document.getElementById('nsSnapshotPanel');
    if (!panel) return;
    var body = panel.querySelector('.ns-snap-body');
    if (!body || body.style.display === 'none') return;
    if (!forceRefresh && body.dataset.loaded === '1') return;
    body.innerHTML = '<div style="color:#555577;font-size:0.8rem;padding:6px 0;">Loading\u2026</div>';
    body.dataset.loaded = '0';
    fetch('/api/ns-snapshots')
        .then(function (r) { return r.ok ? r.json() : Promise.reject('HTTP ' + r.status); })
        .then(function (list) {
            body.dataset.loaded = '1';
            _renderList(body, list);
        })
        .catch(function (err) {
            body.innerHTML = '<div style="color:#f87171;font-size:0.78rem;padding:6px 0;">Failed to load: ' + err + '</div>';
        });
};

function _renderList(container, list) {
    var activeId = _getActiveSnapId();
    if (!list || list.length === 0) {
        container.innerHTML =
            '<div style="color:#555577;font-size:0.8rem;padding:6px 0;">No snapshots yet. ' +
            'Click <strong style="color:#daa520;">&#128190; Save Snapshot</strong> above to save the current NS configuration.</div>';
        return;
    }
    var html = '';
    for (var i = 0; i < list.length; i++) {
        var s = list[i];
        var isActive  = (s.id === activeId);
        var slotLabel = s.bootEntryLabel || (s.bootEntrySlot != null ? 'slot ' + s.bootEntrySlot : '\u2014');
        var border    = isActive ? 'border:1px solid rgba(218,165,32,0.65);' : 'border:1px solid rgba(255,255,255,0.07);';
        var badge     = isActive
            ? '<span style="font-size:0.67rem;color:#daa520;background:rgba(218,165,32,0.12);border:1px solid rgba(218,165,32,0.4);border-radius:3px;padding:1px 6px;margin-left:6px;vertical-align:middle;">active</span>'
            : '';
        html +=
            '<div style="' + border + 'background:rgba(255,255,255,0.025);border-radius:5px;padding:8px 10px;margin-bottom:7px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                '<div style="flex:1;min-width:0;">' +
                    '<div style="font-weight:600;color:#d0d0e8;font-size:0.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
                        _escHtml(s.name) + badge +
                    '</div>' +
                    '<div style="font-size:0.73rem;color:#666;margin-top:2px;">' +
                        _formatAge(s.created_at) + ' &middot; ' +
                        s.slotCount + ' slot' + (s.slotCount !== 1 ? 's' : '') +
                        ' &middot; &#x26A1; ' + _escHtml(slotLabel) +
                    '</div>' +
                '</div>' +
                '<button onclick="_nsSnapshotRestore(' + s.id + ')"' +
                '  style="background:#1a3a2a;color:#4ec9b0;border:1px solid rgba(78,201,176,0.4);border-radius:4px;padding:3px 12px;font-size:0.78rem;cursor:pointer;white-space:nowrap;flex-shrink:0;"' +
                '  title="Restore this configuration">Restore</button>' +
                '<button onclick="_nsSnapshotDelete(' + s.id + ')"' +
                '  style="background:#2e1a1a;color:#f87171;border:1px solid rgba(248,113,113,0.3);border-radius:4px;padding:3px 9px;font-size:0.78rem;cursor:pointer;white-space:nowrap;flex-shrink:0;"' +
                '  title="Delete this snapshot">\u2715</button>' +
            '</div>';
    }
    container.innerHTML = html;
}

})();
