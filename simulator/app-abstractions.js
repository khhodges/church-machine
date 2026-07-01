const BOOT_SEQ_CODE = {
    // ── Slot 0: Boot.NS ──────────────────────────────────────────────────────
    // Covers boot phases B:00 (FAULT_RST) and B:01 (LOAD_NS).
    // This is the first slot the hardware sees; it describes the namespace table
    // itself.  CR15 is the only register loaded here.
    0: [
        '; Boot.NS — Namespace Root (Slot 0)',
        '; Loaded into CR15 during B:01.  Zero permissions — the namespace table',
        '; is never read/written through CR15 by user code; the hardware uses it',
        '; internally for mLoad bounds and version checks.',
        '',
        '; ━━━ B:00  FAULT_RST ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '; Power-on reset: capture fault-violation context if CRs are still live,',
        '; then wipe all architectural state.  Runs at every cold or warm reset.',
        'B:00  FAULT_RST',
        '; ─ Step 1: capture fault-violation data BEFORE clearing CRs ─',
        '      if faultLog not empty:',
        '        lastFault ← faultLog.last()',
        '        snap      ← lastFault.crSnapshot        ; CRs at fault moment',
        '        faultViolationData ← {',
        '          namespace   : snap[CR15].GT.slot → nsLabel,',
        '          thread      : snap[CR12].GT.slot → nsLabel,',
        '          abstraction : snap[CR14].GT.slot → nsLabel,',
        '          method      : lastFault.instrHistory.last.opName,',
        '          instruction : { physPC, opName, crDst, crSrc, imm },',
        '          offset      : physPC − snap[CR14].word1  ; offset within lump,',
        '        }',
        '        ; faultViolationData forwarded to CALL_HOME (B:02½) boot packet',
        '; ─ Step 2: wipe all architectural state ─',
        '      for i in 0..15: CRi ← NULL    ; clear all 16 capability registers',
        '      for i in 0..15: DRi ← 0       ; zero all 16 data registers',
        '      ; Boot-mode active: CRs written during boot get M=1 per-register',
        '',
        '; ━━━ B:01  LOAD_NS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '; Load the Namespace descriptor into CR15 so the hardware can locate',
        '; every NS entry (and therefore every lump) in the system.',
        'B:01  LOAD_NS',
        '      GT15  ← createGT(Slot=0, perms=[none], type=Inform)',
        '                                     ; zero-perm Inform GT for NS Slot 0',
        '      entry ← mLoad(GT15, perm=none) ; boot-mode — bypasses perm check',
        '      CR15  ← { word0=GT15, M=1,     ; Golden Token for Slot 0 (M=1: boot-stamped)',
        '               word1=base=0x0000,    ; NS table lives at physical addr 0',
        '               word2=limit,          ; covers full NS table extent',
        '               word3=seals }         ; version + seal field from NS entry',
        '      ; CR15 = Namespace root — used only internally by mLoad',
    ].join('\n'),

    // ── Slot 1: Boot.Thread ──────────────────────────────────────────────────
    // Covers boot phase B:02 (INIT_THRD).
    // CR12 is the thread stack register.  Its NS entry encodes the lump
    // base address and total lump size; from these the hardware derives sp_max
    // (= lumpSize − caps − 1) and the heap floor.
    1: [
        '; Boot.Thread — Thread stack capability (Slot 1)',
        '; Loaded into CR12 during B:02.  Zero permissions — CR12 is read only',
        '; by the hardware internally; programs do not issue mLoad/mSave through it.',
        '',
        '; ━━━ B:02  INIT_THRD ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '; Load the thread-lump descriptor so the hardware knows where the current',
        '; thread lives and what its stack ceiling (sp_max = lumpSize-caps-1) is.',
        'B:02  INIT_THRD',
        '      GT12  ← createGT(Slot=1, perms=[none], type=Inform)',
        '                                     ; zero-perm Inform GT for Slot 1 (thread lump)',
        '      entry ← mLoad(GT12, perm=none) ; boot-mode — bypasses perm check',
        '      CR12  ← { word0=GT12, M=1,     ; thread stack token (M=1: boot-stamped)',
        '               word1=entry.base,     ; physical base address of thread lump',
        '               word2=entry.word1,    ; limit word — encodes total lump size',
        '               word3=entry.seals }   ; version + seal field',
        '      ; CR12 = Thread stack — Priv zone (CR12–CR15), zero perms',
        '      ; Hardware derives sp_max = lumpSize − caps(12) − 1 = 243 from this',
        '',
        ';     CR5 ← heap (CHANGE-consistent synthesis)',
        ';     Immediately after CR12 is set, the boot state machine synthesizes',
        ';     a RW Inform GT for the same Slot 1 lump and writes it to CR5.',
        ';     This mirrors what CHANGE CR12 does at runtime so that user code',
        ';     starts with a valid heap pointer without executing any instruction.',
        '      heapStart ← 1 + 16 + caps(12)       ; word above header + DR zone + c-list',
        '      sp_max    ← lumpSize − caps(12) − 1 ; top of stack (= 243 for default lump)',
        '      GT5  ← createGT(Slot=1, perms=[R,W], type=Inform)',
        '                                     ; RW Inform GT for Slot 1 (heap access)',
        '      CR5  ← { word0=GT5, M=1,       ; heap token (M=1: boot-stamped)',
        '               word1=entry.base,     ; same physical base as CR12 (Slot 1)',
        '               word2=entry.word1,    ; same limit word as CR12',
        '               word3=entry.seals }   ; same seals as CR12',
        '      ; CR5 = Heap — programmer zone (CR1–CR4, CR5, CR7–CR11)',
        '      ; Covers [+heapStart .. +sp_max] within the thread lump',
        '      ; Identical behaviour to CHANGE CR12 — no extra boot step required',
    ].join('\n'),

    // ── Slot 3: Boot entry (default: LED Flash demo) ─────────────────────────
    // Covers boot phases B:03 (INIT_ABSTR), B:04 (LOAD_NUC), B:05 (COMPLETE).
    // The boot entry is user-configurable via ⚡ (bootEntrySlot, default 3).
    // B:03 and B:04 are indivisible — they always execute in the same Step.
    // B:04 and B:05 are also indivisible.
    //
    // This is the most complex phase: it replicates what the CALL microcode does
    // at runtime (push sentinel frame, derive CR14/CR6 from lump header, set PC=0)
    // while M-elevation is still active.
    //
    // ── B:03 / B:04 / B:05 hardware sequence ────────────────────────────────
    // B:03  INIT_ABSTR — temporarily load an E-type token for the boot entry
    //       slot into CR6.  This transient snapshot is saved into the sentinel
    //       stack frame by B:04 before CR6 is overwritten.
    // B:04  LOAD_NUC   — E-perm mLoad validates the boot entry NS entry, reads
    //       the lump header to derive CR14 (code, RX) and CR6 (c-list, L),
    //       pushes the sentinel CALL frame, and sets PC = 0.
    // B:05  COMPLETE   — drops M-elevation; instruction dispatch begins.
    //
    // ── Boot demo abstraction — combined code (CR14) + c-list (CR6) in one lump.
    // c-list[0] = LED[0] Abstract GT (device_class=LED, device_data=0).
    // Flashes the on-board LED to confirm hardware is alive, then RETURNs.
    // User-selectable boot entry: does NOT chain to Navana.
    // ─────────────────────────────────────────────────────────────────────────
    3: [
        '; LED Flash — boot demo (Slot 3)',
        '; Combined code + c-list lump.  Entered via ELOADCALL from Boot.Abstr.',
        '; c-list layout after TPERM walk:',
        ';   CR6[0]  LED[0] Abstract GT  (device_class=0x01, device_data=0)',
        '',
        '; ── Turn LED on ─────────────────────────────────────────────────────',
        '      DR0   ← 0x01       ; cmd = Set (method selector bit 0), ledIdx=0',
        '      CALL CR6, 0xF      ; Abstract GT in CR6 — calls LED driver dispatch',
        ';                        ; DR0 return ≥ 0 on success, < 0 on fault',
        '',
        '; ── Delay loop ──────────────────────────────────────────────────────',
        '      DR1   ← 0x7FFF    ; iteration count (~half-second on Tang Nano 20K)',
        '.loop',
        '      ISUB  DR1, DR1, 1',
        '      BRANCH .loop, DR1 ≠ 0',
        '',
        '; ── Turn LED off ────────────────────────────────────────────────────',
        '      DR0   ← 0x02       ; cmd = Clear, ledIdx=0',
        '      CALL CR6, 0xF',
        '',
        '; ── Return to caller (Boot.Abstr sentinel frame → warm reboot) ──────',
        '      RETURN',
    ].join('\n'),
};

// ── Implementation Status ──────────────────────────────────────────────────
// Keys: "absIdx:methodName" (per method) or "abs:absIdx" (abstraction level)
// Values: one of IMPL_STATUS_LEVELS
let absImplStatus = {};
const IMPL_STATUS_LEVELS = ['pseudo', 'js', 'cloomc', 'installed', 'tested', 'released'];
const IMPL_STATUS_LABELS = {
    pseudo:    'Pseudo Code',
    js:        'Built-in',
    cloomc:    'Compiled CLOOMC',
    installed: 'Installed',
    tested:    'Tested',
    released:  'Released'
};
const IMPL_STATUS_SHORT = {
    pseudo:    'Pseudo',
    js:        'Built-in',
    cloomc:    'CLOOMC',
    installed: 'Installed',
    tested:    'Tested',
    released:  'Released'
};
const IMPL_STATUS_COLORS = {
    pseudo:    '#6b7280',
    js:        '#ef4444',
    cloomc:    '#c084fc',
    installed: '#22c55e',
    tested:    '#38bdf8',
    released:  '#f1f5f9'
};

function _implStatusGet(key) {
    if (absImplStatus[key]) return absImplStatus[key];
    // For a per-method key "absIdx:methodName", fall back to the abstraction-level key "abs:absIdx"
    const colon = key.indexOf(':');
    if (colon > 0) {
        const prefix = key.slice(0, colon);
        if (/^\d+$/.test(prefix)) {
            const absKey = `abs:${prefix}`;
            if (absImplStatus[absKey]) return absImplStatus[absKey];
        }
    }
    return 'pseudo';
}

function _implStatusSet(key, value) {
    absImplStatus[key] = value;
    _implStatusSave();
}

function _implStatusSave() {
    try { localStorage.setItem('cm_implStatus', JSON.stringify(absImplStatus)); } catch(e) {}
}

function _implStatusLoad() {
    try {
        const raw = localStorage.getItem('cm_implStatus');
        if (raw) absImplStatus = JSON.parse(raw);
    } catch(e) {}
    _implStatusSeed();
}

function _implStatusSeed() {
    if (localStorage.getItem('cm_implStatus')) return;
    // Boot.NS (0), Boot.Thread (1), Boot.Abstr (3) — already installed in NS table
    absImplStatus['abs:0'] = 'installed';
    absImplStatus['abs:1'] = 'installed';
    absImplStatus['abs:3'] = 'installed';
    // GC (44) has a live JavaScript handler in simulator.js
    for (const m of ['Scan', 'Identify', 'Clear', 'Flip']) {
        absImplStatus[`44:${m}`] = 'js';
    }
    _implStatusSave();
}

function _getAbstractionProfile(abs) {
    if (abs.profile) return abs.profile;
    const bootEntry = (typeof BOOT_UPLOADS !== 'undefined') ? BOOT_UPLOADS.find(u => u.index === abs.index) : null;
    if (bootEntry) {
        return (typeof detectBootUploadProfile === 'function') ? detectBootUploadProfile(bootEntry) : 'IoT';
    }
    return 'IoT';
}

function _implStatusBest(abs) {
    const methods = abs.methods && abs.methods.length > 0 ? abs.methods : [];
    if (methods.length === 0) {
        // No methods: the abstraction-level key is the only signal
        return _implStatusGet(`abs:${abs.index}`);
    }
    // With methods: compute best across all method slots (each slot falls back to abs-level if unset)
    let best = -1;
    for (const m of methods) {
        const lvl = IMPL_STATUS_LEVELS.indexOf(_implStatusGet(`${abs.index}:${m}`));
        if (lvl > best) best = lvl;
    }
    return IMPL_STATUS_LEVELS[Math.max(0, best)] || 'pseudo';
}

function absSetMethodStatus(absIdx, mName, value) {
    _implStatusSet(`${absIdx}:${mName}`, value);
    showAbstractionDetail(absIdx);
}

let _statusDropdownCleanup = null;

function absToggleStatusDropdown(absIdx, mi, evt) {
    evt.stopPropagation();
    _absCloseStatusDropdown();
    const _abs = abstractionRegistry ? abstractionRegistry.getAbstraction(absIdx) : null;
    const mName = _abs ? _abs.methods[mi] : null;
    if (!mName) return;
    const mStatus = _implStatusGet(`${absIdx}:${mName}`);
    const dd = document.createElement('div');
    dd.className = 'abs-status-dropdown';
    const rect = evt.currentTarget ? evt.currentTarget.getBoundingClientRect() : null;
    const x = rect ? rect.left : evt.clientX;
    const y = rect ? rect.bottom + 4 : evt.clientY + 4;
    dd.style.left = `${Math.min(x, window.innerWidth - 175)}px`;
    dd.style.top = `${Math.min(y, window.innerHeight - 200)}px`;
    for (const s of IMPL_STATUS_LEVELS) {
        const opt = document.createElement('div');
        opt.className = 'abs-status-dropdown-option' + (s === mStatus ? ' current' : '');
        const dot = document.createElement('span');
        dot.className = 'abs-status-dropdown-dot';
        dot.style.background = IMPL_STATUS_COLORS[s];
        if (s !== 'pseudo') dot.style.boxShadow = `0 0 4px ${IMPL_STATUS_COLORS[s]}`;
        const label = document.createElement('span');
        label.textContent = IMPL_STATUS_LABELS[s];
        opt.appendChild(dot);
        opt.appendChild(label);
        opt.addEventListener('click', (e) => {
            e.stopPropagation();
            _absCloseStatusDropdown();
            absSetMethodStatus(absIdx, mName, s);
        });
        dd.appendChild(opt);
    }
    document.body.appendChild(dd);
    _statusDropdownCleanup = (e) => { if (!dd.contains(e.target)) _absCloseStatusDropdown(); };
    setTimeout(() => document.addEventListener('click', _statusDropdownCleanup), 0);
}

function _absCloseStatusDropdown() {
    const existing = document.querySelector('.abs-status-dropdown');
    if (existing) existing.remove();
    if (_statusDropdownCleanup) {
        document.removeEventListener('click', _statusDropdownCleanup);
        _statusDropdownCleanup = null;
    }
}

// ──────────────────────────────────────────────────────────────────────────

function _absMethodsSave() {
    try {
        localStorage.setItem('cm_userMethodData', JSON.stringify(userMethodData));
        localStorage.setItem('cm_userMethodLists', JSON.stringify(userMethodLists));
    } catch(e) {}
}

function _initLazyLoadManifest() {
    if (!sim) return;
    // Step 2 (Task #215): consult the saved boot config to decide which
    // catalog lumps are baked in (resident → priority='hot', body installed
    // eagerly) vs lazy (priority='warm', cw=0 sentinel — current default).
    const step2Lumps = (window.bootConfig && window.bootConfig.step2
                        && window.bootConfig.step2.lumps) || [];
    const residentMap = {};   // nsSlot → {resident, physAddr}
    for (const e of step2Lumps) residentMap[e.nsSlot] = e;

    const manifest = {};
    const residentSlots = [];
    if (typeof BOOT_UPLOADS !== 'undefined') {
        for (const upload of BOOT_UPLOADS) {
            // Only include slots that are explicitly declared in Step-2 config.
            // Slots ≥ 8 must not appear in the namespace until the user deploys
            // them via the Builder — BOOT_UPLOADS is the library of available
            // lumps, not an automatic list of what is installed at boot.
            if (upload.methods && upload.methods.length > 0 && upload.index >= 8
                    && !Object.prototype.hasOwnProperty.call(residentMap, upload.index)) {
                continue;   // not in Step-2 config → skip, deploy via Builder only
            }
            if (upload.methods && upload.methods.length > 0 && upload.index >= 16) {
                const cfg = residentMap[upload.index];
                const isResident = !!(cfg && cfg.resident);
                const isHot = (upload.index === 19) || isResident;
                let codeWords = 0;
                for (const m of upload.methods) {
                    if (m.code && m.code.length > 0) codeWords += m.code.length;
                }
                const capsCount = (upload.capabilities || []).length;
                const minWords = 1 + codeWords + capsCount;
                let lumpSize = 64;
                while (lumpSize < minWords) lumpSize *= 2;
                manifest[upload.index] = {
                    source: 'local',
                    path: `${upload.abstraction}.lump`,
                    label: upload.abstraction,
                    size: lumpSize,
                    priority: isHot ? 'hot' : 'warm',
                    loaded: false,
                    loadCount: 0,
                    bootUpload: upload
                };
                if (isResident) residentSlots.push({slot: upload.index, cfg});
            }
        }
    }
    sim.initLazyManifest(manifest);

    // simulator._initNamespaceTable() already wrote each resident slot's NS
    // entry at the programmer-chosen physAddr (it reads window.bootConfig
    // directly). Here we just install the actual code body now so it's
    // present at reset, instead of waiting for first-CALL lazy load.
    for (const {slot} of residentSlots) {
        try {
            sim.eagerInstallResident(slot);
        } catch (e) {
            console.warn(`[bootConfig] resident install failed for slot ${slot}:`, e);
        }
    }
}

function _absMethodsLoad() {
    try {
        const d = localStorage.getItem('cm_userMethodData');
        if (d) userMethodData = JSON.parse(d);
        const l = localStorage.getItem('cm_userMethodLists');
        if (l) {
            userMethodLists = JSON.parse(l);
            for (const idxStr of Object.keys(userMethodLists)) {
                const abs = abstractionRegistry && abstractionRegistry.getAbstraction(parseInt(idxStr, 10));
                if (abs) abs.methods = userMethodLists[idxStr].slice();
            }
        }
    } catch(e) {}
}

function _implLegendHtml() {
    const items = IMPL_STATUS_LEVELS.map(s =>
        `<span class="impl-legend-item">` +
        `<span class="impl-legend-swatch" style="background:${IMPL_STATUS_COLORS[s]}"></span>` +
        `${IMPL_STATUS_LABELS[s]}` +
        `</span>`
    ).join('');
    return `<div class="impl-legend">${items}</div>`;
}

let _absSearchQuery = '';

function _absFilterInput() {
    _absSearchQuery = document.getElementById('absSearchInput')?.value || '';
    renderAbstractions();
}

function renderAbstractions() {
    if (!abstractionRegistry) return;
    const listEl = document.getElementById('absLayerList');
    if (!listEl) return;

    const all = Object.values(abstractionRegistry.abstractions)
        .sort((a, b) => a.name.localeCompare(b.name));
    const q = _absSearchQuery.toLowerCase().trim();
    const filtered = q
        ? all.filter(a => a.name.toLowerCase().includes(q) || (a.description || '').toLowerCase().includes(q))
        : all;

    let html = _implLegendHtml();

    html += `<div class="abs-search-bar">`;
    html += `<input type="text" id="absSearchInput" class="abs-search-input" placeholder="Search by name or description\u2026" oninput="_absFilterInput()" value="${_absSearchQuery.replace(/"/g, '&quot;')}">`;
    html += `<span class="abs-search-count">${filtered.length}\u202f/\u202f${all.length}</span>`;
    html += `</div>`;

    html += `<div class="abs-layer-items">`;
    for (const abs of filtered) {
        const matchLump = (typeof _lumpsCache !== 'undefined' ? _lumpsCache : []).find(l => l.abstraction === abs.name);
        const compiledAt = matchLump?.compiled_at
            ? new Date(matchLump.compiled_at * 1000).toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric'})
            : null;
        const mtbf = matchLump?.mtbf || {};
        const mtbfSt = mtbf.status || 'unknown';
        const isUnknownMtbf = mtbfSt === 'unknown' || mtbfSt === 'untested';
        const mtbfClass = mtbfSt === 'green' ? 'mtbf-green' : mtbfSt === 'amber' ? 'mtbf-amber' : mtbfSt === 'red' ? 'mtbf-red' : 'mtbf-unknown';
        const mtbfLabel = isUnknownMtbf ? '?' : mtbfSt.toUpperCase();

        const isActive = selectedAbsIndex === abs.index;
        const best = _implStatusBest(abs);
        const dotColor = IMPL_STATUS_COLORS[best] || '#9ca3af';
        const dotTitle = IMPL_STATUS_LABELS[best] || best;
        const isBootEntry = abs.index === bootEntrySlot;
        const absProfile = _getAbstractionProfile(abs);
        const profileBadgeClass = absProfile === 'Full' ? 'profile-badge-full' : absProfile === 'XC7A100T' ? 'profile-badge-xc7a100t' : 'profile-badge-iot';
        const profileTitle = absProfile === 'Full' ? 'Ti60 F225 only' : absProfile === 'XC7A100T' ? 'QMTECH Wukong XC7A100T only' : 'runs on both boards';

        html += `<div class="abs-item${isActive ? ' active' : ''}" onclick="showAbstractionDetail(${abs.index})" ondblclick="event.stopPropagation();_goToLumpByAbstractionName(abstractionRegistry.getAbstraction(${abs.index}).name)" title="Double-click to jump to this abstraction\u2019s LUMP in the Repository">`;
        html += `<div class="abs-item-row1">`;
        html += `<span class="abs-item-idx abs-boot-entry-btn${isBootEntry ? ' boot-entry-active' : ''}" onclick="event.stopPropagation();setBootEntrySlot(${abs.index})" title="${isBootEntry ? 'Current boot entry' : 'Set as boot entry'}">${isBootEntry ? '\u26a1' : abs.index}</span>`;
        html += `<span class="abs-item-name">${abs.name}</span>`;
        html += `<span class="abs-profile-badge ${profileBadgeClass}" title="${absProfile} profile \u2014 ${profileTitle}">${absProfile}</span>`;
        if (compiledAt) html += `<span class="abs-item-date" title="Compiled ${compiledAt}">${compiledAt}</span>`;
        if (matchLump) html += `<span class="mtbf-badge lump-mtbf-badge ${mtbfClass}" title="MTBF: ${mtbfSt}">${mtbfLabel}</span>`;
        html += `<span class="abs-item-dot" style="background:${dotColor};box-shadow:0 0 4px ${dotColor}80" title="${dotTitle}"></span>`;
        html += `</div>`;
        html += `<div class="abs-item-desc">${abs.description}</div>`;
        if (abs.methods && abs.methods.length > 0) {
            html += `<div class="abs-item-methods">`;
            for (let mi = 0; mi < abs.methods.length; mi++) {
                const _m = abs.methods[mi];
                const _isMain = _m.toLowerCase() === 'main';
                const _absNameEsc = abs.name.replace(/'/g, "\\'");
                const _mEsc = _m.replace(/'/g, "\\'");
                html += `<span class="abs-item-method-pill${_isMain ? ' abs-item-method-main' : ''}"`;
                html += ` title="Selector #${mi + 1} \u2014 click to copy: CALL ${abs.name}.${_m}"`;
                html += ` onclick="event.stopPropagation();_absCopyCall('${_absNameEsc}','${_mEsc}',this)">`;
                html += `<span class="abs-item-method-sel">#${mi + 1}</span>${_m}`;
                html += `</span>`;
            }
            html += `</div>`;
        }
        html += `</div>`;
    }
    html += `</div>`;

    listEl.innerHTML = html;

    // Re-apply text highlights after every rebuild so a query that was active
    // before the rebuild (e.g. a namespace update) is immediately visible.
    // Elements are freshly created so there are no stale data-orig-html attrs.
    if (q && typeof _absHighlightText === 'function') {
        listEl.querySelectorAll('.abs-item').forEach(card => {
            _absHighlightText(card.querySelector('.abs-item-name'), q);
            _absHighlightText(card.querySelector('.abs-item-desc'), q);
        });
    }
}

function setBootEntrySlot(idx) {
    idx = Math.max(0, Math.min(255, Math.trunc(Number(idx)) || 0));
    bootEntrySlot = idx;
    localStorage.setItem('bootEntrySlot', String(idx));
    if (sim) {
        sim.bootEntrySlot = idx;
        // Task #651: Write E-GT to thread caps zone CR0 slot (thread[+244]) so the
        // 3-instruction Boot.Abstr CHANGE → TPERM → CALL path picks up the new entry.
        if (typeof sim.createGT === 'function') {
            const capsOffset = (typeof THREAD_CAPS_OFFSET !== 'undefined') ? THREAD_CAPS_OFFSET : 244;
            const threadBase = sim.memory[sim.NS_TABLE_BASE + 1 * sim.NS_ENTRY_WORDS] >>> 0;
            sim.memory[threadBase + capsOffset] = sim.createGT(0, idx, {E:1}, 1) >>> 0;
        }
        // Preflight: warn if the chosen slot has no installed lump
        const entry = sim.readNSEntry(idx);
        const isEmpty = !entry || (entry.word0_location === 0 && entry.word1_limit === 0);
        if (isEmpty) {
            const label = (sim.nsLabels && sim.nsLabels[idx])
                || abstractionRegistry?.abstractions?.[idx]?.name
                || `Slot ${idx}`;
            sim.output += `[BOOT] WARNING: boot entry set to Slot ${idx} (${label}) — no lump installed. Boot will fault at B:04.\n`;
            if (typeof sim.emit === 'function') sim.emit('stateChange', sim.getState());
        }
    }
    renderAbstractions();
    if (currentView === 'namespace') updateNamespace();
    if (typeof window.lumpEditorRenderResidentPanel === 'function') window.lumpEditorRenderResidentPanel();
}

function _syncBootEntryFromSim() {
    if (!sim) return;
    const fromSim = sim.bootEntrySlot;
    if (fromSim !== bootEntrySlot) {
        bootEntrySlot = fromSim;
        localStorage.setItem('bootEntrySlot', String(fromSim));
        renderAbstractions();
        if (currentView === 'namespace') updateNamespace();
        if (typeof window.lumpEditorRenderResidentPanel === 'function') window.lumpEditorRenderResidentPanel();
    }
}

function _applyBootEntryToSim() {
    if (!sim) return;
    if (sim.bootEntrySlot !== bootEntrySlot) {
        sim.bootEntrySlot = bootEntrySlot;
    }
}

let _lumpsCache = [];
let _selectedLumpToken = null;
let _pendingLumpAbstractionName = null;
let _nsdgTooltipData = {};
let _lumpEditDirty = false;
let _lumpSortOrder = localStorage.getItem('lumpSortOrder') || 'name';

function _lumpRecordView(token) {
    if (!token) return;
    let map = {};
    try { map = JSON.parse(localStorage.getItem('lumpLastViewed') || '{}'); } catch(e) {}
    map[token] = Date.now();
    try { localStorage.setItem('lumpLastViewed', JSON.stringify(map)); } catch(e) {}
}

function _lumpGetLastViewed(token) {
    try {
        const map = JSON.parse(localStorage.getItem('lumpLastViewed') || '{}');
        return map[token] || 0;
    } catch(e) { return 0; }
}

window.addEventListener('beforeunload', function (e) {
    if (_lumpEditDirty) {
        e.preventDefault();
        e.returnValue = '';
    }
});

async function renderLumps() {
    const listEl = document.getElementById('lumpsListContent');
    if (!listEl) return;
    listEl.innerHTML = '<div class="lumps-loading">Loading lumps...</div>';

    try {
        const r = await fetch('/api/lumps/list');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const lumps = await r.json();
        _lumpsCache = lumps;
        if (_pendingLumpAbstractionName) {
            // Prefer user-saved (versioned, floating) over boot-resident when names clash.
            const _allMatched = lumps.filter(l => l.abstraction === _pendingLumpAbstractionName);
            const _matched = _allMatched.find(l => l.version && (l.ns_slot === null || l.ns_slot === undefined))
                          || _allMatched[0];
            if (_matched) _selectedLumpToken = _matched.token;
            _pendingLumpAbstractionName = null;
        }

        // Auto-select the live lump (CR14 NS slot) every time the panel renders.
        const _liveState = (typeof _getLiveLumpState === 'function') ? _getLiveLumpState() : null;
        if (_liveState && _liveState.nsIdx !== null && _liveState.nsIdx !== undefined) {
            const _liveMatch = lumps.find(l =>
                l.ns_slot !== null && l.ns_slot !== undefined &&
                parseInt(l.ns_slot) === _liveState.nsIdx);
            if (_liveMatch) _selectedLumpToken = _liveMatch.token;
        }

        // Restore last-viewed lump from localStorage (e.g. after a page reload)
        // only when nothing else (pending name or live lump) has already set a token.
        if (!_selectedLumpToken) {
            const _saved = localStorage.getItem('lastSelectedLumpToken');
            if (_saved && lumps.find(l => l.token === _saved)) {
                _selectedLumpToken = _saved;
            }
        }

        // Pending NS→Source navigation (_openLumpSource) — takes final priority so the
        // live auto-select above cannot override the user's explicit slot click.
        // _pendingLumpTab is only honoured when the token resolves successfully;
        // a stale/missing token clears both to avoid applying a tab to the wrong lump.
        if (window._pendingLumpToken) {
            const _ptMatch = lumps.find(l => l.token === window._pendingLumpToken);
            if (_ptMatch) {
                _selectedLumpToken = _ptMatch.token;
            } else {
                window._pendingLumpTab = null;
            }
            window._pendingLumpToken = null;
        }

        let html = '';
        if (!lumps || lumps.length === 0) {
            html = '<div class="lumps-placeholder">No lumps saved yet. Use Build LUMP in the editor to compile and save an abstraction.</div>';
        } else {
            const _sortedLumps = _lumpsSorted(lumps);
            html += `<select id="lumpPickerSelect" class="lump-picker-select" onchange="lumpPickerChanged(this.value)">`;
            html += `<option value="">— pick a lump —</option>`;
            for (const lump of _sortedLumps) {
                const token = lump.token || '????????';
                const name  = lump.abstraction || 'Unknown';
                const lt    = (lump.lump_type    || '').toLowerCase();
                const ct    = (lump.content_type || '').toLowerCase();
                const typ   = lump.typ;
                const isFloat = (lump.ns_slot === null || lump.ns_slot === undefined);
                const badge = lt === 'boot'                                ? '[BOOT]'
                            : lt === 'namespace'  || typ === 10            ? '[NS]'
                            : ct === 'outform'    || typ === 3             ? '[OTF]'
                            : ct === 'thread'     || typ === 2             ? '[THR]'
                            : ct === 'inform'                              ? '[INF]'
                            : isFloat && lt !== 'boot'                     ? '[SAVED]'
                            : '';
                const nsSlot  = !isFloat ? `NS ${lump.ns_slot}` : '';
                const ver     = lump.version ? `v${lump.version}` : '';
                const size    = lump.lump_size ? `${lump.lump_size}w` : '';
                const dateStr = _lumpDateStr(lump);
                const label   = [name, ver, badge, nsSlot, size, dateStr].filter(Boolean).join('  ');
                const sel     = _selectedLumpToken === token ? ' selected' : '';
                html += `<option value="${_escHtml(token)}"${sel}>${_escHtml(label)}</option>`;
            }
            html += `</select>`;
        }

        listEl.innerHTML = html;
        const _ss = document.getElementById('lumpSortSelect');
        if (_ss) _ss.value = _lumpSortOrder;

        if (_selectedLumpToken) {
            // Always re-render the detail panel so compress/POLA/save changes
            // (lump_size, cc, etc.) are reflected without a manual click.
            showLumpDetail(_selectedLumpToken);
        }
        // If a pending tab was requested (e.g. from _openLumpSource), apply it now
        // after showLumpDetail has built the tab panels.
        if (window._pendingLumpTab) {
            const _ptk = (_selectedLumpToken || '').replace(/[^a-z0-9]/gi, '');
            if (typeof _switchLumpTab === 'function') _switchLumpTab(_ptk, window._pendingLumpTab);
            window._pendingLumpTab = null;
        }
        updateLiveLumpBanner();

        // x/y health counter — x = lumps with a valid binary, y = total
        const _rcTotal   = lumps.length;
        const _rcHealthy = lumps.filter(l => l.binary_valid !== false).length;
        _updateLumpRepoCount(_rcHealthy, _rcTotal);
    } catch (err) {
        listEl.innerHTML = `<div class="lumps-placeholder">Error loading lumps: ${_escHtml(err.message)}</div>`;
    }
}

// Returns a compact "YYYY-MM-DD HH:MM" local-time string for lump.compiled_at,
// or '' if the lump has no compiled_at timestamp.
function _lumpDateStr(lump) {
    if (!lump || !lump.compiled_at) return '';
    const d  = new Date(lump.compiled_at * 1000);
    const yr = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const dy = String(d.getDate()).padStart(2, '0');
    const hr = String(d.getHours()).padStart(2, '0');
    const mn = String(d.getMinutes()).padStart(2, '0');
    return `${yr}-${mo}-${dy} ${hr}:${mn}`;
}

// Updates the x/y health counter in the "LUMP Repository" panel header.
// x = lumps whose binary_valid field is not false, y = total.
// Shows a warning colour when x < y.
function _updateLumpRepoCount(x, y) {
    const el = document.getElementById('lumpRepoCount');
    if (!el) return;
    if (!y) { el.textContent = ''; el.title = ''; el.className = 'lump-repo-count'; return; }
    el.textContent = `${x}/${y}`;
    el.title = x === y
        ? `All ${y} LUMP${y === 1 ? '' : 's'} have a valid binary`
        : `${y - x} of ${y} LUMP${y === 1 ? '' : 's'} ${y - x === 1 ? 'has' : 'have'} a missing or invalid binary`;
    el.className = 'lump-repo-count' + (x < y ? ' lump-repo-count-warn' : '');
}

// Called by the lump picker <select> when the user chooses a different lump.
window.lumpPickerChanged = function(token) {
    if (!token) { _updateLumpViewingLabel(''); return; }
    _selectedLumpToken = token;
    _lumpRecordView(token);
    try { localStorage.setItem('lastSelectedLumpToken', token); } catch(e) {}
    showLumpDetail(token);
};

// Updates the "Viewing: <name> [TYPE]" label below the picker.
function _updateLumpViewingLabel(token) {
    const el = document.getElementById('lumpViewingLabel');
    if (!el) return;
    if (!token || !_lumpsCache) { el.style.display = 'none'; el.textContent = ''; return; }
    const lump = _lumpsCache.find(l => l.token === token);
    if (!lump) { el.style.display = 'none'; return; }
    const lt      = (lump.lump_type    || '').toLowerCase();
    const ct      = (lump.content_type || '').toLowerCase();
    const typ     = lump.typ;
    const isFloat = (lump.ns_slot === null || lump.ns_slot === undefined);
    const badge   = lt === 'boot'                     ? '[BOOT]'
                  : lt === 'namespace' || typ === 10  ? '[NS]'
                  : ct === 'outform'   || typ === 3   ? '[OTF]'
                  : ct === 'thread'    || typ === 2   ? '[THR]'
                  : ct === 'inform'                   ? '[INF]'
                  : isFloat && lt !== 'boot'          ? '[SAVED]'
                  : '';
    const name = lump.abstraction || 'Unknown';
    el.textContent = 'Viewing: ' + name + (badge ? ' ' + badge : '');
    el.style.display = 'block';
}

// Refreshes the text of a single picker <option> after an in-place metadata
// edit (e.g. version or pet-name change), without triggering a full re-render.
// Also re-syncs the Viewing label if this token is currently selected.
function _refreshLumpPickerOption(token) {
    if (!token || !_lumpsCache) return;
    const lump = _lumpsCache.find(l => l.token === token);
    if (!lump) return;
    const sel = document.getElementById('lumpPickerSelect');
    if (!sel) return;
    const opt = sel.querySelector(`option[value="${token}"]`);
    if (!opt) return;
    const lt      = (lump.lump_type    || '').toLowerCase();
    const ct      = (lump.content_type || '').toLowerCase();
    const typ     = lump.typ;
    const isFloat = (lump.ns_slot === null || lump.ns_slot === undefined);
    const badge   = lt === 'boot'                     ? '[BOOT]'
                  : lt === 'namespace' || typ === 10  ? '[NS]'
                  : ct === 'outform'   || typ === 3   ? '[OTF]'
                  : ct === 'thread'    || typ === 2   ? '[THR]'
                  : ct === 'inform'                   ? '[INF]'
                  : isFloat && lt !== 'boot'          ? '[SAVED]'
                  : '';
    const nsSlot = !isFloat ? `NS ${lump.ns_slot}` : '';
    const ver    = lump.version ? `v${lump.version}` : '';
    const size   = lump.lump_size ? `${lump.lump_size}w` : '';
    const name   = lump.abstraction || 'Unknown';
    opt.textContent = [name, ver, badge, nsSlot, size].filter(Boolean).join('  ');
    if (_selectedLumpToken === token) _updateLumpViewingLabel(token);
}

// Returns a sorted copy of the lumps array according to _lumpSortOrder.
function _lumpsSorted(lumps) {
    const arr = lumps.slice();
    if (_lumpSortOrder === 'recent') {
        arr.sort((a, b) => _lumpGetLastViewed(b.token) - _lumpGetLastViewed(a.token));
    } else if (_lumpSortOrder === 'compiled') {
        arr.sort((a, b) => (b.compiled_at || 0) - (a.compiled_at || 0));
    } else if (_lumpSortOrder === 'mtbf') {
        const _rank = st => st === 'green' ? 0 : st === 'amber' ? 1 : st === 'red' ? 3 : 2;
        arr.sort((a, b) => {
            const ma = a.mtbf || {}, mb = b.mtbf || {};
            const ra = _rank(ma.status), rb = _rank(mb.status);
            if (ra !== rb) return ra - rb;
            return (parseInt(mb.consecutive_clean) || 0) - (parseInt(ma.consecutive_clean) || 0);
        });
    } else {
        arr.sort((a, b) =>
            (a.abstraction || a.token || '').localeCompare(b.abstraction || b.token || ''));
    }
    return arr;
}

// Called by the sort <select> when the user changes sort order.
window._lumpSortChanged = function(val) {
    _lumpSortOrder = val;
    try { localStorage.setItem('lumpSortOrder', val); } catch(e) {}
    const sel = document.getElementById('lumpPickerSelect');
    if (!sel || !_lumpsCache || !_lumpsCache.length) return;
    const sorted = _lumpsSorted(_lumpsCache);
    const e = _escHtml;
    let opts = `<option value="">— pick a lump —</option>`;
    for (const lump of sorted) {
        const token   = lump.token || '????????';
        const name    = lump.abstraction || 'Unknown';
        const lt      = (lump.lump_type    || '').toLowerCase();
        const ct      = (lump.content_type || '').toLowerCase();
        const typ     = lump.typ;
        const isFloat = (lump.ns_slot === null || lump.ns_slot === undefined);
        const badge   = lt === 'boot'                     ? '[BOOT]'
                      : lt === 'namespace' || typ === 10  ? '[NS]'
                      : ct === 'outform'   || typ === 3   ? '[OTF]'
                      : ct === 'thread'    || typ === 2   ? '[THR]'
                      : ct === 'inform'                   ? '[INF]'
                      : isFloat && lt !== 'boot'          ? '[SAVED]'
                      : '';
        const nsSlot  = !isFloat ? `NS ${lump.ns_slot}` : '';
        const ver     = lump.version   ? `v${lump.version}`    : '';
        const size    = lump.lump_size ? `${lump.lump_size}w`  : '';
        const dateStr = _lumpDateStr(lump);
        const label   = [name, ver, badge, nsSlot, size, dateStr].filter(Boolean).join('  ');
        const chosen  = _selectedLumpToken === token ? ' selected' : '';
        opts += `<option value="${e(token)}"${chosen}>${e(label)}</option>`;
    }
    sel.innerHTML = opts;
};

// ── Live Lump Banner ─────────────────────────────────────────────────────────
// Renders a status banner at the top of the LUMP Repository reflecting the
// lump currently loaded in CR14.  Called from renderLumps() and from
// updateDashboard() (no-op when the banner element is not in the DOM).

let _liveLumpLastNsIdx = null;
let _liveLumpInputCache = { name: '', version: '' };

function updateLiveLumpBanner() {
    const el = document.getElementById('liveLumpBanner');
    if (!el) return;
    const lumpsView = document.getElementById('lumps');
    if (lumpsView && lumpsView.style.display === 'none') return;
    const state = (typeof _getLiveLumpState === 'function') ? _getLiveLumpState() : null;
    if (!state) {
        _liveLumpLastNsIdx = null;
        _liveLumpInputCache = { name: '', version: '' };
        el.innerHTML = '<div class="live-lump-banner live-lump-banner-empty">\u2014 simulator not running \u2014</div>';
        return;
    }
    const e = _escHtml;
    const nsChanged = (state.nsIdx !== _liveLumpLastNsIdx);
    _liveLumpLastNsIdx = state.nsIdx;
    if (nsChanged) {
        _liveLumpInputCache = { name: '', version: '' };
        // Pre-populate version from the most recently saved lump for this NS slot.
        if (typeof _lumpsCache !== 'undefined' && Array.isArray(_lumpsCache)) {
            const saved = _lumpsCache.find(l =>
                l.ns_slot !== null && l.ns_slot !== undefined &&
                parseInt(l.ns_slot) === state.nsIdx);
            if (saved && saved.version) _liveLumpInputCache.version = saved.version;
        }
    } else {
        const nameEl    = document.getElementById('liveLumpName');
        const versionEl = document.getElementById('liveLumpVersion');
        if (nameEl)    _liveLumpInputCache.name    = nameEl.value;
        if (versionEl) _liveLumpInputCache.version = versionEl.value;
    }
    const nameVal    = _liveLumpInputCache.name    || e(state.absName);
    const versionVal = _liveLumpInputCache.version;
    const sealBadge = state.sealOk
        ? '<span class="live-lump-seal live-lump-seal-ok">\u2713 SEAL OK</span>'
        : '<span class="live-lump-seal live-lump-seal-fail">\u2717 SEAL FAIL</span>';
    const warnings = Array.isArray(state.warnings) ? state.warnings : [];
    const warningsTooltip = warnings.map(w => e(w)).join('&#10;');
    _warnPopoverData = warnings;
    const warnBadge = warnings.length >= 2
        ? '<button class="live-lump-warn-badge" onclick="_warnBadgeClick(this,event)">' + warnings.length + ' warnings</button>'
        : '';
    const warningsRow = warnings.length > 0
        ? '<div class="live-lump-warnings" data-tooltip="' + warningsTooltip + '"><span class="live-lump-warnings-text">\u26A0 ' + e(warnings.join(' \u00B7 ')) + '</span>' + warnBadge + '</div>'
        : '';
    const fmtSize = state.lumpSize !== null && state.lumpSize !== undefined ? e(String(state.lumpSize)) + 'w' : '?';
    const fmtCw   = state.cw   !== null && state.cw   !== undefined ? e(String(state.cw))   : '?';
    const fmtCc   = state.cc   !== null && state.cc   !== undefined ? e(String(state.cc))   : '?';
    el.innerHTML =
        '<div class="live-lump-banner">' +
        // ── Left column: identity + stats ──────────────────────────────
        '<div class="live-lump-banner-left">' +
        '<div class="live-lump-banner-title">Live Lump \u2014 CR14\u00A0/\u00A0NS' + e(String(state.nsIdx)) + '</div>' +
        '<div class="live-lump-abstr-name">' + e(state.absName) + '</div>' +
        '<div class="live-lump-banner-stats">' +
        '<span class="live-lump-field"><span class="live-lump-field-label">Base</span><span class="live-lump-field-val live-lump-mono">0x' + e(state.baseLoc.toString(16).toUpperCase().padStart(4, '0')) + '</span></span>' +
        '<span class="live-lump-field"><span class="live-lump-field-label">Size</span><span class="live-lump-field-val">' + fmtSize + '</span></span>' +
        '<span class="live-lump-field"><span class="live-lump-field-label">cw</span><span class="live-lump-field-val">' + fmtCw + '</span></span>' +
        '<span class="live-lump-field"><span class="live-lump-field-label">cc</span><span class="live-lump-field-val">' + fmtCc + '</span></span>' +
        '</div>' +
        '</div>' +
        // ── Right column: seal badge + warnings ────────────────────────
        '<div class="live-lump-banner-right">' +
        sealBadge +
        warningsRow +
        '</div>' +
        // ── Save row — spans both columns ──────────────────────────────
        '<div class="live-lump-banner-save-row">' +
        '<input class="live-lump-input" type="text" id="liveLumpName" placeholder="Name" value="' + nameVal + '">' +
        '<input class="live-lump-input live-lump-version-input" type="text" id="liveLumpVersion" placeholder="Version" value="' + e(versionVal) + '">' +
        '<button class="live-lump-save-btn" onclick="_liveLumpSave(' + state.nsIdx + ')">\u2193\u202FSave Lump</button>' +
        '</div>' +
        '</div>';
}

let _warnPopoverData = [];

function _warnPopoverGet() {
    let pop = document.getElementById('_warnPopover');
    if (!pop) {
        pop = document.createElement('div');
        pop.id = '_warnPopover';
        pop.className = 'warn-popover';
        pop.hidden = true;
        pop._btn = null;
        document.body.appendChild(pop);
        document.addEventListener('click', function(e) {
            if (!pop.hidden && !pop.contains(e.target)) {
                _warnPopoverClose();
            }
        });
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && !pop.hidden) {
                _warnPopoverClose();
            }
        });
    }
    return pop;
}

function _warnBadgeClick(btn, event) {
    event.stopPropagation();
    const pop = _warnPopoverGet();
    if (pop._btn === btn && !pop.hidden) {
        _warnPopoverClose();
        return;
    }
    pop._btn = btn;
    const esc = _escHtml;
    const items = _warnPopoverData.map(function(w) {
        return '<li>' + esc(w) + '</li>';
    }).join('');
    pop.innerHTML = '<div class="warn-popover-title">Warnings</div><ul class="warn-popover-list">' + items + '</ul>';
    pop.hidden = false;
    const r = btn.getBoundingClientRect();
    pop.style.top = (r.bottom + window.scrollY + 4) + 'px';
    pop.style.left = (r.left + window.scrollX) + 'px';
    requestAnimationFrame(function() {
        const pr = pop.getBoundingClientRect();
        if (pr.right > window.innerWidth - 8) {
            pop.style.left = Math.max(8, window.innerWidth - pr.width - 8) + 'px';
        }
    });
}

function _warnPopoverClose() {
    const pop = document.getElementById('_warnPopover');
    if (pop) {
        pop.hidden = true;
        pop._btn = null;
    }
}

function _liveLumpSave(nsIdx) {
    const name    = ((document.getElementById('liveLumpName')    || {}).value || '').trim();
    const version = ((document.getElementById('liveLumpVersion') || {}).value || '').trim();
    _pendingLumpMeta = { name: name || undefined, version: version || undefined };
    _liveLumpInputCache = { name: '', version: '' };
    if (typeof lumpSaveLump === 'function') lumpSaveLump(nsIdx);
}

function _buildNsDepGraph(nsMeta, lump, showNull) {
    const e = _escHtml;
    const allEntries = nsMeta.entries || [];
    const nullEntries = allEntries.filter(ent => !ent.state || ent.state === 'null');
    const active = showNull
        ? allEntries
        : allEntries.filter(ent => ent.state && ent.state !== 'null');
    if (active.length === 0 && nullEntries.length === 0) return '';
    if (active.length === 0 && !showNull) return '';

    const SVG_W = 660;
    const ROW_H = 52;
    const PAD_T = 28, PAD_B = 20;
    const NS_W = 118, NS_H = 52;
    const SLOT_W = 156, SLOT_H = 34;
    const TGT_W = 156, TGT_H = 34;

    const nRows = active.length;
    const svgH = Math.max(NS_H + PAD_T + PAD_B + 10, nRows * ROW_H + PAD_T + PAD_B);

    const nsX = 8, slotX = 188, tgtX = 418;
    const nsCX = nsX + NS_W / 2;
    const nsCY = svgH / 2;

    let svg = `<svg class="ns-dep-graph-svg" viewBox="0 0 ${SVG_W} ${svgH}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Namespace dependency graph">`;
    svg += `<defs>
      <marker id="nsdg-arr-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="#4a7aab"/></marker>
      <marker id="nsdg-arr-green" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="#4ade80"/></marker>
      <marker id="nsdg-arr-purple" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="#a78bfa"/></marker>
    </defs>`;
    svg += `<g class="nsdg-inner">`;

    const nsLabel = (lump.abstraction || 'Namespace').substring(0, 14);
    const nsToken = (lump.token || '').substring(0, 12);
    svg += `<rect x="${nsX}" y="${nsCY - NS_H / 2}" width="${NS_W}" height="${NS_H}" rx="6" fill="#1a1a0a" stroke="#fbbf24" stroke-width="2"/>`;
    svg += `<text x="${nsCX}" y="${nsCY - 10}" text-anchor="middle" font-size="9" font-weight="bold" fill="#fbbf24" font-family="monospace">NS LUMP</text>`;
    svg += `<text x="${nsCX}" y="${nsCY + 4}" text-anchor="middle" font-size="9" fill="#eaeaea" font-family="monospace">${e(nsLabel)}</text>`;
    svg += `<text x="${nsCX}" y="${nsCY + 17}" text-anchor="middle" font-size="7.5" fill="#7a7a5a" font-family="monospace">0x${e(nsToken)}</text>`;

    _nsdgTooltipData = {};
    const _tipPfx = (lump.token || String(Date.now())).replace(/[^a-z0-9]/gi, '').substring(0, 16);

    for (let i = 0; i < active.length; i++) {
        const ent = active[i];
        const rowCY = PAD_T + i * ROW_H + ROW_H / 2;

        const isNullSlot = !ent.state || ent.state === 'null';
        const ex1 = nsX + NS_W, ey1 = nsCY;
        const ex2 = slotX, ey2 = rowCY;
        const cBx = ex1 + (ex2 - ex1) * 0.45;
        const connStroke = isNullSlot ? '#2a3040' : '#4a7aab';
        const connOpacity = isNullSlot ? '0.4' : '1';
        svg += `<path d="M${ex1},${ey1} C${cBx},${ey1} ${cBx},${ey2} ${ex2},${ey2}" fill="none" stroke="${connStroke}" stroke-width="1" stroke-opacity="${connOpacity}" ${isNullSlot ? '' : 'marker-end="url(#nsdg-arr-blue)"'}/>`;

        const stateCol = isNullSlot ? '#3a3a4a'
                       : ent.state === 'bundled' ? '#60a5fa'
                       : ent.state === 'live'    ? '#4ade80'
                       :                           '#a78bfa';
        const slotTextCol = isNullSlot ? '#3a3a5a' : stateCol;
        const slotBodyCol = isNullSlot ? '#0a0a12' : '#081828';
        const slotLabel = (ent.label || `slot ${ent.slot}`).substring(0, 20);

        const slotTipKey = `${_tipPfx}_s${i}`;
        let slotTipHtml = `<div class="nsdg-tip-title">[${parseInt(ent.slot)}] ${e((ent.state || 'null').toUpperCase())}</div>`;
        slotTipHtml += `<div class="nsdg-tip-row"><span class="nsdg-tip-lbl">Label</span><span class="nsdg-tip-val">${e(ent.label || `slot ${ent.slot}`)}</span></div>`;
        if (ent.flags !== undefined && ent.flags !== null) {
            const _fb = ent.flags >>> 0;
            const _fl = [];
            if (_fb & 1) _fl.push('required');
            if (_fb & 2) _fl.push('bundle');
            if (_fb & 4) _fl.push('pinned');
            const _fs = _fl.length ? _fl.join(' | ') : `0x${_fb.toString(16).padStart(2, '0')}`;
            slotTipHtml += `<div class="nsdg-tip-row"><span class="nsdg-tip-lbl">Flags</span><span class="nsdg-tip-val">${_fs}</span></div>`;
        }
        slotTipHtml += `<div class="nsdg-tip-row"><span class="nsdg-tip-lbl">loc_idx</span><span class="nsdg-tip-val">${ent.loc_idx !== undefined ? parseInt(ent.loc_idx) : '—'}</span></div>`;
        if (ent.hash) {
            slotTipHtml += `<div class="nsdg-tip-row"><span class="nsdg-tip-lbl">Hash</span><span class="nsdg-tip-val nsdg-tip-mono">0x${e(ent.hash.substring(0, 20))}</span></div>`;
        }
        _nsdgTooltipData[slotTipKey] = { html: slotTipHtml };

        svg += `<g>`;
        svg += `<rect x="${slotX}" y="${rowCY - SLOT_H / 2}" width="${SLOT_W}" height="${SLOT_H}" rx="4" fill="${slotBodyCol}" stroke="${stateCol}" stroke-width="${isNullSlot ? '0.6' : '1.2'}" stroke-dasharray="${isNullSlot ? '3 2' : 'none'}"/>`;
        svg += `<text x="${slotX + 6}" y="${rowCY - 5}" font-size="7" font-weight="bold" fill="${slotTextCol}" font-family="monospace" opacity="${isNullSlot ? '0.5' : '1'}">[${parseInt(ent.slot)}] ${e((ent.state || 'null').toUpperCase())}</text>`;
        svg += `<text x="${slotX + 6}" y="${rowCY + 8}" font-size="9" fill="${isNullSlot ? '#3a3a5a' : '#dde8f0'}" font-family="monospace" opacity="${isNullSlot ? '0.5' : '1'}">${e(slotLabel)}</text>`;
        svg += `</g>`;

        const isOutform = ent.state === 'outform';
        const isBundled = ent.state === 'bundled' || ent.state === 'live';
        if (isOutform || isBundled) {
            const tgtTok = (ent.lump_token || ent.token || '').replace(/[^a-z0-9]/gi, '');
            const tgtLump = tgtTok ? (_lumpsCache || []).find(l => l.token === tgtTok) : null;
            const tgtCol = isOutform ? '#a78bfa' : '#4ade80';
            const tgtStroke = isOutform ? '#6a5a9a' : (tgtLump ? '#2a7a4a' : '#1a4a2a');
            const arrMkr = isOutform ? 'nsdg-arr-purple' : 'nsdg-arr-green';

            svg += `<line x1="${slotX + SLOT_W}" y1="${rowCY}" x2="${tgtX - 2}" y2="${rowCY}" stroke="${tgtCol}" stroke-width="1" stroke-opacity="0.6" marker-end="url(#${arrMkr})"/>`;

            let tgtLine1, tgtLine2;
            if (isOutform) {
                tgtLine1 = 'OUTFORM';
                tgtLine2 = (ent.hash || '').substring(0, 16) || `loc:${ent.loc_idx || 0}`;
            } else if (tgtLump) {
                tgtLine1 = (tgtLump.abstraction || 'Lump').substring(0, 18);
                tgtLine2 = '0x' + tgtTok.substring(0, 12);
            } else if (ent.file) {
                tgtLine1 = ent.file.split('/').pop().replace(/\.lump$/, '').substring(0, 18);
                tgtLine2 = tgtTok ? '0x' + tgtTok.substring(0, 12) : '';
            } else {
                tgtLine1 = tgtTok ? '0x' + tgtTok.substring(0, 12) : 'unknown';
                tgtLine2 = '';
            }

            const tgtTipKey = `${_tipPfx}_t${i}`;
            let tgtTipHtml;
            if (isOutform) {
                tgtTipHtml = `<div class="nsdg-tip-title">OUTFORM</div>`;
                if (ent.hash) tgtTipHtml += `<div class="nsdg-tip-row"><span class="nsdg-tip-lbl">Hash</span><span class="nsdg-tip-val nsdg-tip-mono">0x${e(ent.hash)}</span></div>`;
                tgtTipHtml += `<div class="nsdg-tip-row"><span class="nsdg-tip-lbl">loc_idx</span><span class="nsdg-tip-val">${ent.loc_idx !== undefined ? parseInt(ent.loc_idx) : '—'}</span></div>`;
            } else if (tgtLump) {
                tgtTipHtml = `<div class="nsdg-tip-title">${e(tgtLump.abstraction || tgtTok)}</div>`;
                tgtTipHtml += `<div class="nsdg-tip-row"><span class="nsdg-tip-lbl">Token</span><span class="nsdg-tip-val nsdg-tip-mono">0x${e(tgtTok)}</span></div>`;
                if (tgtLump.cw !== undefined) tgtTipHtml += `<div class="nsdg-tip-row"><span class="nsdg-tip-lbl">CW</span><span class="nsdg-tip-val">${parseInt(tgtLump.cw)}</span></div>`;
                if (tgtLump.cc !== undefined) tgtTipHtml += `<div class="nsdg-tip-row"><span class="nsdg-tip-lbl">CC</span><span class="nsdg-tip-val">${parseInt(tgtLump.cc)}</span></div>`;
                const sz = parseInt(tgtLump.lump_size) || 0;
                tgtTipHtml += `<div class="nsdg-tip-row"><span class="nsdg-tip-lbl">Size</span><span class="nsdg-tip-val">${sz}w / ${sz * 4}B</span></div>`;
                tgtTipHtml += `<div class="nsdg-tip-nav">Click to inspect &#8594;</div>`;
            } else {
                tgtTipHtml = `<div class="nsdg-tip-title">${e(tgtLine1)}</div>`;
                if (tgtTok) tgtTipHtml += `<div class="nsdg-tip-row"><span class="nsdg-tip-lbl">Token</span><span class="nsdg-tip-val nsdg-tip-mono">0x${e(tgtTok)}</span></div>`;
                if (ent.file) tgtTipHtml += `<div class="nsdg-tip-row"><span class="nsdg-tip-lbl">File</span><span class="nsdg-tip-val">${e(ent.file.split('/').pop())}</span></div>`;
            }
            _nsdgTooltipData[tgtTipKey] = { html: tgtTipHtml };

            const clickable = !!tgtLump;
            const clickAttr = clickable ? ` style="cursor:pointer" onclick="showLumpDetail('${tgtTok}')"` : '';
            const titleEl = clickable ? `<title>Navigate to ${e(tgtLump.abstraction || tgtTok)}</title>` : '';
            svg += `<g${clickAttr}>${titleEl}`;
            svg += `<rect x="${tgtX}" y="${rowCY - TGT_H / 2}" width="${TGT_W}" height="${TGT_H}" rx="4" fill="#080810" stroke="${tgtStroke}" stroke-width="${clickable ? '1.8' : '1'}"/>`;
            if (clickable) svg += `<rect x="${tgtX}" y="${rowCY - TGT_H / 2}" width="${TGT_W}" height="${TGT_H}" rx="4" fill="${tgtCol}" fill-opacity="0.04"/>`;
            svg += `<text x="${tgtX + 7}" y="${rowCY - 5}" font-size="9" font-weight="${clickable ? 'bold' : 'normal'}" fill="${tgtCol}" font-family="monospace">${e(tgtLine1)}</text>`;
            if (tgtLine2) svg += `<text x="${tgtX + 7}" y="${rowCY + 8}" font-size="7.5" fill="#5a7a6a" font-family="monospace">${e(tgtLine2)}</text>`;
            if (clickable) svg += `<text x="${tgtX + TGT_W - 6}" y="${rowCY - 5}" font-size="9" fill="${tgtCol}" font-family="monospace" text-anchor="end">&#8594;</text>`;
            svg += `</g>`;
        }
    }

    const legY = svgH - 6;
    svg += `<text x="8" y="${legY}" font-size="7" fill="#4a6a6a" font-family="monospace">bundled/live &#9632;  outform &#9670;  click a lump node to navigate</text>`;
    svg += `</g></svg>`;
    return { svg, nullCount: nullEntries.length };
}

const _nsdgState = {};

function _initNsDepGraphPanZoom(wrapId) {
    const wrap = document.getElementById(wrapId);
    if (!wrap) return;
    const svg = wrap.querySelector('svg.ns-dep-graph-svg');
    if (!svg) return;
    const inner = svg.querySelector('g.nsdg-inner');
    if (!inner) return;

    const st = { scale: 1, tx: 0, ty: 0, dragging: false,
                 startX: 0, startY: 0, startClientX: 0, startClientY: 0,
                 startScrollTop: 0, startTx: 0, startTy: 0, pinchDist: 0 };
    _nsdgState[wrapId] = st;

    function applyTransform() {
        inner.setAttribute('transform', `translate(${st.tx},${st.ty}) scale(${st.scale})`);
    }

    function clampTranslate() {
        if (st.scale <= 1) { st.tx = 0; st.ty = 0; return; }
        const svgW = parseFloat(svg.getAttribute('viewBox').split(' ')[2]) || 660;
        const svgH = parseFloat(svg.getAttribute('viewBox').split(' ')[3]) || 300;
        const maxTx = svgW * (st.scale - 1) * 0.8;
        const maxTy = svgH * (st.scale - 1) * 0.8;
        st.tx = Math.max(-maxTx, Math.min(maxTx, st.tx));
        st.ty = Math.max(-maxTy, Math.min(maxTy, st.ty));
    }

    svg.addEventListener('wheel', ev => {
        if (!ev.ctrlKey && !ev.metaKey) return;
        ev.preventDefault();
        const factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
        const rect = svg.getBoundingClientRect();
        const vb = svg.getAttribute('viewBox').split(' ').map(Number);
        const svgW = vb[2], svgH = vb[3];
        const mx = ((ev.clientX - rect.left) / rect.width) * svgW;
        const my = ((ev.clientY - rect.top) / rect.height) * svgH;
        const newScale = Math.max(0.25, Math.min(8, st.scale * factor));
        st.tx = mx + newScale / st.scale * (st.tx - mx);
        st.ty = my + newScale / st.scale * (st.ty - my);
        st.scale = newScale;
        clampTranslate();
        applyTransform();
    }, { passive: false });

    svg.addEventListener('mousedown', ev => {
        if (ev.button !== 0) return;
        st.dragging = true;
        st.startClientX = ev.clientX;
        st.startClientY = ev.clientY;
        st.startScrollTop = wrap.scrollTop;
        if (st.scale > 1) {
            const rect = svg.getBoundingClientRect();
            const vb = svg.getAttribute('viewBox').split(' ').map(Number);
            st.startX = ev.clientX * (vb[2] / rect.width);
            st.startY = ev.clientY * (vb[3] / rect.height);
            st.startTx = st.tx;
            st.startTy = st.ty;
        }
        svg.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', ev => {
        if (!st.dragging) return;
        if (st.scale <= 1) {
            wrap.scrollTop = st.startScrollTop - (ev.clientY - st.startClientY);
        } else {
            const rect = svg.getBoundingClientRect();
            const vb = svg.getAttribute('viewBox').split(' ').map(Number);
            st.tx = st.startTx + (ev.clientX * (vb[2] / rect.width) - st.startX);
            st.ty = st.startTy + (ev.clientY * (vb[3] / rect.height) - st.startY);
            clampTranslate();
            applyTransform();
        }
    });

    window.addEventListener('mouseup', () => {
        if (st.dragging) { st.dragging = false; svg.style.cursor = 'grab'; }
    });

    svg.addEventListener('touchstart', ev => {
        if (ev.touches.length === 2) {
            const dx = ev.touches[0].clientX - ev.touches[1].clientX;
            const dy = ev.touches[0].clientY - ev.touches[1].clientY;
            st.pinchDist = Math.hypot(dx, dy);
        } else if (ev.touches.length === 1) {
            st.dragging = true;
            st.startClientY = ev.touches[0].clientY;
            st.startScrollTop = wrap.scrollTop;
            if (st.scale > 1) {
                const rect = svg.getBoundingClientRect();
                const vb = svg.getAttribute('viewBox').split(' ').map(Number);
                st.startX = ev.touches[0].clientX * (vb[2] / rect.width);
                st.startY = ev.touches[0].clientY * (vb[3] / rect.height);
                st.startTx = st.tx; st.startTy = st.ty;
            }
        }
    }, { passive: true });

    svg.addEventListener('touchmove', ev => {
        ev.preventDefault();
        if (ev.touches.length === 2) {
            const dx = ev.touches[0].clientX - ev.touches[1].clientX;
            const dy = ev.touches[0].clientY - ev.touches[1].clientY;
            const dist = Math.hypot(dx, dy);
            if (st.pinchDist > 0) {
                const factor = dist / st.pinchDist;
                st.scale = Math.max(0.25, Math.min(8, st.scale * factor));
                clampTranslate();
                applyTransform();
            }
            st.pinchDist = dist;
        } else if (ev.touches.length === 1 && st.dragging) {
            if (st.scale <= 1) {
                wrap.scrollTop = st.startScrollTop - (ev.touches[0].clientY - st.startClientY);
            } else {
                const rect = svg.getBoundingClientRect();
                const vb = svg.getAttribute('viewBox').split(' ').map(Number);
                st.tx = st.startTx + (ev.touches[0].clientX * (vb[2] / rect.width) - st.startX);
                st.ty = st.startTy + (ev.touches[0].clientY * (vb[3] / rect.height) - st.startY);
                clampTranslate();
                applyTransform();
            }
        }
    }, { passive: false });

    svg.addEventListener('touchend', () => { st.dragging = false; st.pinchDist = 0; });
    svg.style.cursor = 'grab';
}

function _nsdgZoom(wrapId, factor) {
    const st = _nsdgState[wrapId];
    const wrap = document.getElementById(wrapId);
    if (!st || !wrap) return;
    const svg = wrap.querySelector('svg.ns-dep-graph-svg');
    const inner = svg && svg.querySelector('g.nsdg-inner');
    if (!inner) return;
    const vb = svg.getAttribute('viewBox').split(' ').map(Number);
    const cx = vb[2] / 2, cy = vb[3] / 2;
    const newScale = Math.max(0.25, Math.min(8, st.scale * factor));
    st.tx = cx + newScale / st.scale * (st.tx - cx);
    st.ty = cy + newScale / st.scale * (st.ty - cy);
    st.scale = newScale;
    const maxT = Math.max(vb[2], vb[3]) * (st.scale - 1) * 0.8;
    if (st.scale <= 1) { st.tx = 0; st.ty = 0; } else {
        st.tx = Math.max(-maxT, Math.min(maxT, st.tx));
        st.ty = Math.max(-maxT, Math.min(maxT, st.ty));
    }
    inner.setAttribute('transform', `translate(${st.tx},${st.ty}) scale(${st.scale})`);
}

function _nsdgReset(wrapId) {
    const st = _nsdgState[wrapId];
    const wrap = document.getElementById(wrapId);
    if (!st || !wrap) return;
    const svg = wrap.querySelector('svg.ns-dep-graph-svg');
    const inner = svg && svg.querySelector('g.nsdg-inner');
    if (!inner) return;
    st.scale = 1; st.tx = 0; st.ty = 0;
    inner.setAttribute('transform', '');
}

function _nsdgToggleNull(tk) {
    const btn = document.getElementById(`nsdg-null-btn-${tk}`);
    const wrapId = `nsdg-wrap-${tk}`;
    const wrap = document.getElementById(wrapId);
    if (!wrap || !btn) return;

    const lump = _lumpsCache.find(l => l.token === tk || l.token.replace(/[^a-z0-9]/gi, '') === tk);
    if (!lump) return;
    const nsMeta = lump.namespace_meta || {};

    const showing = btn.dataset.showingNull === '1';
    const result = _buildNsDepGraph(nsMeta, lump, !showing);

    delete _nsdgState[wrapId];
    if (result) {
        wrap.innerHTML = result.svg;
        _initNsDepGraphPanZoom(wrapId);
    } else {
        const allEntries = nsMeta.entries || [];
        const nullCount = allEntries.filter(e => !e.state || e.state === 'null').length;
        wrap.innerHTML = '';
        wrap.style.cssText = 'min-height:2.5rem;display:flex;align-items:center;padding:0.5rem 0.75rem;color:#4a4a6a;font-size:0.78rem;';
        wrap.textContent = `All ${nullCount} slot${nullCount !== 1 ? 's are' : ' is'} empty \u2014 click to reveal`;
    }

    btn.dataset.showingNull = showing ? '0' : '1';
    const nc = parseInt(btn.dataset.nullCount) || 0;
    btn.textContent = showing
        ? `Show ${nc} null slot${nc !== 1 ? 's' : ''}`
        : `Hide null slots`;
}

function _buildDnaGraph(lump, allLumps) {
    const entries = lump.clist_entries || [];
    if (!entries.length) return null;
    const e = _escHtml;

    const rows = entries.map((ent, i) => {
        if (ent.null) return { slot: i, null: true };
        const nsIdx = ent.ns_index;
        const target = (allLumps || []).find(l => parseInt(l.ns_slot) === nsIdx);
        const rawLabel = target
            ? (target.label || target.abstraction || target.token)
            : `NS[${nsIdx}]`;
        return {
            slot: i, null: false,
            ns_index: nsIdx,
            perms: ent.perms || '---',
            gt_type: ent.gt_type || '',
            gt_word: ent.gt_word || '',
            target_label: rawLabel,
            target_token: target ? target.token : null,
        };
    });
    const active = rows.filter(r => !r.null);
    const nullCount = rows.length - active.length;
    if (!active.length) return null;

    const SVG_W = 660;
    const ROW_H = 52;
    const PAD_T = 28, PAD_B = 20;
    const ROOT_W = 118, ROOT_H = 52;
    const SLOT_W = 150, SLOT_H = 34;
    const TGT_W  = 168, TGT_H  = 34;

    const rootLabel = lump.label || lump.abstraction || lump.token || 'LUMP';
    const rootToken = lump.token || '';
    const nRows = active.length;
    const svgH = Math.max(ROOT_H + PAD_T + PAD_B + 10, nRows * ROW_H + PAD_T + PAD_B);

    const rootX = 6, slotX = 182, tgtX = 390;
    const rootCX = rootX + ROOT_W / 2;
    const rootCY = svgH / 2;
    const rootRightX = rootX + ROOT_W;

    const trunc = (s, n) => s && s.length > n ? s.slice(0, n - 1) + '\u2026' : (s || '');

    let svg = `<svg class="ns-dep-graph-svg" viewBox="0 0 ${SVG_W} ${svgH}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="DNA reachability graph">`;
    svg += `<defs>
      <marker id="dna-arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
        <path d="M0,0 L0,6 L6,3 z" fill="#4a90e2"/>
      </marker>
    </defs>`;
    svg += `<g class="nsdg-inner">`;

    svg += `<rect x="${rootX}" y="${rootCY - ROOT_H/2}" width="${ROOT_W}" height="${ROOT_H}" rx="6" fill="#060e06" stroke="#22c55e" stroke-width="2"/>`;
    svg += `<text x="${rootCX}" y="${rootCY - 10}" text-anchor="middle" font-size="9" font-weight="bold" fill="#22c55e" font-family="monospace">LUMP</text>`;
    svg += `<text x="${rootCX}" y="${rootCY + 4}" text-anchor="middle" font-size="9" fill="#eaeaea" font-family="monospace">${e(trunc(rootLabel, 14))}</text>`;
    svg += `<text x="${rootCX}" y="${rootCY + 17}" text-anchor="middle" font-size="7.5" fill="#7a7a5a" font-family="monospace">0x${e(rootToken)}</text>`;

    active.forEach((row, ri) => {
        const rowCY = PAD_T + ri * ROW_H + ROW_H / 2;
        const cBx = (rootRightX + slotX) / 2;

        svg += `<path d="M${rootRightX},${rootCY} C${cBx},${rootCY} ${cBx},${rowCY} ${slotX},${rowCY}" fill="none" stroke="#4a90e2" stroke-width="1" stroke-opacity="0.5" marker-end="url(#dna-arr)"/>`;

        const isChurch = row.perms && (row.perms.includes('E') || row.perms.includes('L') || row.perms.includes('S'));
        const isTuring = row.perms && (row.perms.includes('R') || row.perms.includes('W') || row.perms.includes('X'));
        const permCol  = isChurch ? '#22c55e' : isTuring ? '#f59e0b' : '#6b7280';
        const slotFill = isChurch ? 'rgba(34,197,94,0.08)' : isTuring ? 'rgba(245,158,11,0.06)' : '#0e0e1a';

        svg += `<rect x="${slotX}" y="${rowCY - SLOT_H/2}" width="${SLOT_W}" height="${SLOT_H}" rx="4" fill="${slotFill}" stroke="#4a90e2" stroke-width="1.2"/>`;
        svg += `<text x="${slotX+6}" y="${rowCY - 5}" font-size="7" font-weight="bold" fill="#6b7280" font-family="monospace">slot ${row.slot} \u2192 NS[${row.ns_index}]</text>`;
        svg += `<text x="${slotX+6}" y="${rowCY + 9}" font-size="9" fill="${permCol}" font-family="monospace">${e(row.perms)}</text>`;
        svg += `<text x="${slotX + SLOT_W - 4}" y="${rowCY + 9}" font-size="7" fill="#4a5a7a" font-family="monospace" text-anchor="end">${e(row.gt_type)}</text>`;

        svg += `<line x1="${slotX + SLOT_W}" y1="${rowCY}" x2="${tgtX - 2}" y2="${rowCY}" stroke="#4a90e2" stroke-width="1" stroke-opacity="0.6" marker-end="url(#dna-arr)"/>`;

        const hasTgt = !!row.target_token;
        const tgtStroke = hasTgt ? '#4a90e2' : '#2a2a4a';
        const tgtTextCol = hasTgt ? '#dde8f0' : '#4a4a6a';
        svg += `<rect x="${tgtX}" y="${rowCY - TGT_H/2}" width="${TGT_W}" height="${TGT_H}" rx="4" fill="#08080f" stroke="${tgtStroke}" stroke-width="${hasTgt ? '1.4' : '0.7'}"/>`;
        svg += `<text x="${tgtX + 5}" y="${rowCY - 5}" font-size="7" fill="#4a5a7a" font-family="monospace">NS slot ${row.ns_index}</text>`;
        svg += `<text x="${tgtX + 5}" y="${rowCY + 9}" font-size="9" fill="${tgtTextCol}" font-family="monospace">${e(trunc(row.target_label, 19))}</text>`;
    });

    svg += `</g></svg>`;
    const wrapId = `dna-wrap-${rootToken}`;
    return { svg, wrapId, nullCount };
}

