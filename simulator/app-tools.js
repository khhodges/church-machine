const _GC_PHASE_NAMES = ['Mark', 'Scan', 'Sweep', 'Clear'];

function _tgcUpdateBtn() {
    const btn = document.getElementById('tgcRunBtn');
    if (!btn) return;
    if (_gcPhaseStep === 0) {
        btn.innerHTML = '&#9851; Run GC';
    } else {
        const name = _GC_PHASE_NAMES[_gcPhaseStep] || '';
        btn.innerHTML = (_gcPhaseStep + 1) + ': ' + name + ' &#8594;';
    }
}

function renderToolsView() {
    const nsEntryEl    = document.getElementById('tgcNSEntries');
    const freedSlotsEl = document.getElementById('tgcFreedSlots');
    const freedWordsEl = document.getElementById('tgcFreedWords');
    const liveEl       = document.getElementById('tgcLiveCount');
    const lastRunEl    = document.getElementById('toolsGCLastRun');

    if (nsEntryEl) nsEntryEl.textContent = sim && typeof sim.nsCount === 'number' ? sim.nsCount : '—';

    if (_lastGCResult) {
        if (freedSlotsEl) freedSlotsEl.textContent = _lastGCResult.freedSlots;
        if (freedWordsEl) freedWordsEl.textContent = _lastGCResult.freedWords;
        if (liveEl)       liveEl.textContent       = _lastGCResult.liveCount;
        if (lastRunEl)    lastRunEl.textContent     = 'Last run: freed ' + _lastGCResult.freedSlots +
            ' slot' + (_lastGCResult.freedSlots !== 1 ? 's' : '') +
            ', ' + _lastGCResult.liveCount + ' live';
    } else {
        if (freedSlotsEl) freedSlotsEl.textContent = '—';
        if (freedWordsEl) freedWordsEl.textContent = '—';
        if (liveEl)       liveEl.textContent       = '—';
        if (lastRunEl)    lastRunEl.textContent     = 'Not run yet this session';
    }
    _tgcUpdateBtn();
}

function _tgcSetCardState(num, state, badge, lines) {
    const card     = document.getElementById('tgcCard' + num);
    const badgeEl  = document.getElementById('tgcBadge' + num);
    const reportEl = document.getElementById('tgcReport' + num);
    if (!card) return;
    card.dataset.state = state;
    if (badgeEl) badgeEl.textContent = badge;
    if (reportEl && lines) {
        reportEl.innerHTML = lines
            .map(l => '<div class="tgc-line">' + l.replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</div>')
            .join('');
    }
}

function _tgcReset() {
    for (let i = 1; i <= 4; i++) {
        _tgcSetCardState(i, 'idle', '', null);
        const r = document.getElementById('tgcReport' + i);
        if (r) r.innerHTML = '';
    }
    _gcPhaseStep   = 0;
    _pendingGCPhases = null;
}

function runGCFromTools() {
    const btn = document.getElementById('tgcRunBtn');

    // ── Step 0: start a fresh GC run ─────────────────────────────────────
    if (_gcPhaseStep === 0) {
        if (!sim || !sim.bootComplete) {
            _tgcReset();
            for (let i = 1; i <= 4; i++) _tgcSetCardState(i, 'error', 'Not booted', null);
            const el = document.getElementById('toolsGCLastRun');
            if (el) el.textContent = 'Boot the machine first (top-right Boot button)';
            return;
        }
        _tgcReset();
        sim.mElevation = true;
        const result = sim.runGC();
        sim.mElevation = false;
        _lastGCResult    = result;
        _pendingGCPhases = result.phases || [];
        // fall through to reveal phase 1 immediately
    }

    // ── Steps 1-4: reveal the next phase ─────────────────────────────────
    const phases = _pendingGCPhases;
    if (!phases || _gcPhaseStep >= phases.length) return;

    const idx = _gcPhaseStep;    // 0-based index into phases[]
    const num = idx + 1;         // 1-based card number

    if (btn) btn.disabled = true;
    _tgcSetCardState(num, 'running', '…', null);

    setTimeout(() => {
        _tgcSetCardState(num, 'done', '\u2713', phases[idx].lines);
        _gcPhaseStep++;

        if (_gcPhaseStep >= phases.length) {
            // All phases revealed — show final stats, reset for next run
            renderToolsView();
            _gcPhaseStep    = 0;
            _pendingGCPhases = null;
        }

        _tgcUpdateBtn();
        if (btn) btn.disabled = false;
    }, 420);
}

function selectTutorial(which) {
    activeTutorial = which;
    document.querySelectorAll('.tutorial-selector .btn-tut-select').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('tutSelect-' + which);
    if (btn) btn.classList.add('active');
    _ensureTutorialObjects();
    if (which === 'sliderule' && slideRuleTutorial) {
        slideRuleTutorial.render('tutorialView');
    } else if (which === 'cloomc' && cloomcTutorial) {
        cloomcTutorial.render('tutorialView');
    } else if (which === 'security' && securityTutorial) {
        securityTutorial.render('tutorialView');
    } else if (which === 'thread' && threadTutorial) {
        threadTutorial.render('tutorialView');
    } else if (which === 'abstraction' && abstrTutorial) {
        abstrTutorial.render('tutorialView');
    } else if (which === 'namespace' && nsTutorial) {
        nsTutorial.render('tutorialView');
    } else if (which === 'secureboot' && secureBootTutorial) {
        secureBootTutorial.render('tutorialView');
    } else if (which === 'englishloops' && englishLoopsTutorial) {
        englishLoopsTutorial.render('tutorialView');
    } else if (which === 'englishstring' && englishStringTutorial) {
        englishStringTutorial.render('tutorialView');
    } else if (which === 'englishcontact' && englishContactTutorial) {
        englishContactTutorial.render('tutorialView');
    } else if (churchTutorial) {
        churchTutorial.render('tutorialView');
    }
}

function switchDashTab(tabId) {
    document.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.dash-panel').forEach(p => p.classList.remove('active'));

    const tab = document.getElementById('dashTab-' + tabId);
    const panel = document.getElementById('dashPanel-' + tabId);
    if (tab) tab.classList.add('active');
    if (panel) panel.classList.add('active');

    updateDashboard();
}

function _ensureTutorialObjects() {
    if (!churchTutorial && typeof BernoulliTutorial !== 'undefined') {
        churchTutorial = new BernoulliTutorial(repl, pipelineViz);
        window.churchTutorial = churchTutorial;
    }
    if (!slideRuleTutorial && typeof SlideRuleTutorial !== 'undefined') {
        slideRuleTutorial = new SlideRuleTutorial();
        window.slideRuleTutorial = slideRuleTutorial;
    }
    if (!cloomcTutorial && typeof CLOOMCTutorial !== 'undefined') {
        cloomcTutorial = new CLOOMCTutorial();
        window.cloomcTutorial = cloomcTutorial;
    }
    if (!securityTutorial && typeof SecurityTutorial !== 'undefined')
        securityTutorial = new SecurityTutorial();
    if (!threadTutorial && typeof ThreadTutorial !== 'undefined')
        threadTutorial = new ThreadTutorial();
    if (!abstrTutorial && typeof AbstractionTutorial !== 'undefined')
        abstrTutorial = new AbstractionTutorial();
    if (!nsTutorial && typeof NamespaceTutorial !== 'undefined')
        nsTutorial = new NamespaceTutorial();
    if (!secureBootTutorial && typeof SecureBootTutorial !== 'undefined') {
        secureBootTutorial = new SecureBootTutorial();
        window.secureBootTutorial = secureBootTutorial;
    }
    if (!englishLoopsTutorial) {
        if (typeof EnglishLoopsTutorial !== 'undefined') {
            englishLoopsTutorial = new EnglishLoopsTutorial();
            window.englishLoopsTutorial = englishLoopsTutorial;
        } else if (typeof window !== 'undefined' && window.EnglishLoopsTutorial) {
            englishLoopsTutorial = new window.EnglishLoopsTutorial();
            window.englishLoopsTutorial = englishLoopsTutorial;
        }
    }
    if (!englishStringTutorial) {
        if (typeof EnglishStringTutorial !== 'undefined') {
            englishStringTutorial = new EnglishStringTutorial();
            window.englishStringTutorial = englishStringTutorial;
        } else if (typeof window !== 'undefined' && window.EnglishStringTutorial) {
            englishStringTutorial = new window.EnglishStringTutorial();
            window.englishStringTutorial = englishStringTutorial;
        }
    }
    if (!englishContactTutorial) {
        if (typeof EnglishContactTutorial !== 'undefined') {
            englishContactTutorial = new EnglishContactTutorial();
            window.englishContactTutorial = englishContactTutorial;
        } else if (typeof window !== 'undefined' && window.EnglishContactTutorial) {
            englishContactTutorial = new window.EnglishContactTutorial();
            window.englishContactTutorial = englishContactTutorial;
        }
    }
}

function hideLoadingOverlay() {
    const el = document.getElementById('appLoading');
    if (!el) return;
    el.classList.add('hidden');
    setTimeout(() => { el.style.display = 'none'; }, 300);
}

const BOOT_STEP_NAMES = ['FAULT_RST','LOAD_NS','INIT_THRD','INIT_ABSTR\u2b64LOAD_NUC\u2b64COMPLETE'];

function updateLedStrip() {
    if (!sim) return;
    const bits = typeof sim.ledBits === 'number' ? sim.ledBits : 0;
    const mode = sim.ledMode || 'boot';
    const complete = !!sim.bootComplete;

    for (let i = 0; i < 6; i++) {
        const el = document.getElementById('led' + i);
        if (!el) continue;
        const lit = !!((bits >> i) & 1);
        el.classList.toggle('on', lit && !complete);
        el.classList.toggle('boot-complete', lit && complete);
    }

    const modeEl = document.getElementById('ledModeTag');
    const bitsEl = document.getElementById('ledBitsDisplay');

    if (modeEl) {
        if (mode === 'boot') {
            if (bits === 0) {
                modeEl.textContent = 'pre-boot';
                modeEl.style.color = '#666';
            } else if (complete) {
                modeEl.textContent = 'boot ok';
                modeEl.style.color = '#22cc66';
            } else {
                const step = bits.toString(2).replace(/0/g, '').length;
                modeEl.textContent = 'B:0' + (step - 1) + ' ' + (BOOT_STEP_NAMES[step - 1] || '');
                modeEl.style.color = '#e08820';
            }
        } else {
            modeEl.textContent = 'LED program';
            modeEl.style.color = '#8888ff';
        }
    }
    if (bitsEl) {
        bitsEl.textContent = '0b' + bits.toString(2).padStart(6, '0') + ' = ' + bits;
    }

    for (let i = 0; i < 4; i++) {
        const hwEl = document.getElementById('hw-led' + i);
        if (!hwEl) continue;
        const lit = !!((bits >> i) & 1);
        hwEl.classList.toggle('on', lit);
    }

    const readoutEl   = document.getElementById('ledDR0Readout');
    const badgeEl     = document.getElementById('ledDR0Badge');
    const descEl      = document.getElementById('ledDR0Desc');
    const indexChipEl = document.getElementById('ledIndexDisplay');
    if (readoutEl && badgeEl && descEl && indexChipEl) {
        const sr = sim.lastSignedReturn;
        if (!sr || sr.absIndex !== 12) {
            readoutEl.style.display = 'none';
        } else {
            readoutEl.style.display = 'flex';
            const idx = sr.ledIndex;
            const dr1 = sr.dr1;
            indexChipEl.textContent = idx !== null && idx !== undefined ? `LED ${idx}` : 'LED ?';
            badgeEl.textContent = String(dr1);
            badgeEl.className = 'dr0-badge ' + (dr1 > 0 ? 'dr0-badge-green' : dr1 < 0 ? 'dr0-badge-red' : 'dr0-badge-grey');
            if (dr1 > 0)      descEl.textContent = dr1 === 1 ? '(on / success)' : '(success)';
            else if (dr1 === 0) descEl.textContent = '(off)';
            else               descEl.textContent = dr1 === -1 ? '(invalid offset)' : '(fault)';
        }
    }
}

function copyLedAssembly() {
    const bits = (sim && typeof sim.ledBits === 'number') ? sim.ledBits : 0;
    const asm = `; LED.Set — turn on each lit LED (no DR args; LED identity = C-list offset)\n${Array.from({length:6},(_,i)=>((bits>>i)&1)?`CALL   0, CR6, #${8+i}  ; LED.Set on LED ${i} (C-list offset ${8+i})`:null).filter(Boolean).join('\n') || `; (no LEDs lit — all 0)`}`;
    navigator.clipboard.writeText(asm).then(() => {
        const btn = document.querySelector('.led-copy-btn');
        if (btn) { btn.textContent = '✓ Copied'; setTimeout(() => { btn.textContent = '↗ Copy assembly'; }, 1600); }
    }).catch(() => {
        const ta = document.getElementById('editorCode');
        if (ta) { ta.value = asm; ta.focus(); }
    });
}

function updateDashboard() {
    updateCRDisplay();
    updateDRDisplay();
    updateFlagsDisplay();
    updateInfoDisplay();
    updateGateLog();
    if (selectedCR !== null) updateCRDetail();
    if (pipelineViz && !pipelineViz.animating) pipelineViz.render();
    _refreshSignedReturnReadout();
}

function updateToolbarIdeBadge() {
    const el = document.getElementById('toolbarIdeBadge');
    if (!el) return;
    const status = (sim && sim.callHomeStatus) || null;
    if (status === null) {
        el.innerHTML = '';
        return;
    }
    const isOnline = status === 'online';
    el.innerHTML = `<span class="info-ide-badge toolbar-ide-badge ${isOnline ? 'info-ide-online' : 'info-ide-offline'}" style="cursor:pointer;" onclick="switchView('dashboard');switchDashTab('state');" title="IDE connection — click for details">IDE: ${status}</span>`;
}

function updateGateLog() {
    const container = document.getElementById('gateLogContent');
    if (!container) return;
    const log = sim.auditLog || [];

    // ── Fault banner ──────────────────────────────────────────────────────────
    // Built unconditionally so it appears even when auditLog is empty.
    let html = '';
    const faultLog = sim.faultLog || [];
    if (faultLog.length > 0) {
        const lf = faultLog[faultLog.length - 1];
        const lfColor = (typeof _FAULT_COLORS !== 'undefined' && _FAULT_COLORS[lf.type]) || '#e05555';
        const lfDesc  = (typeof _FAULT_DESCRIPTIONS !== 'undefined' && _FAULT_DESCRIPTIONS[lf.type])
            || (typeof _OUTFORM_DESCRIPTIONS !== 'undefined' && (
                   _OUTFORM_DESCRIPTIONS[lf.type]
                || (typeof _LUMP_TO_OUTFORM !== 'undefined' && _OUTFORM_DESCRIPTIONS[_LUMP_TO_OUTFORM[lf.type]])
               ))
            || '';

        // Resolve PC / disassembly
        const lfPC    = (lf.physicalPC !== undefined && lf.physicalPC !== null) ? lf.physicalPC : lf.pc;
        const lfPCHex = '0x' + (lfPC >>> 0).toString(16).toUpperCase().padStart(4, '0');
        const lfWord  = (sim.memory && lfPC < sim.memory.length) ? sim.memory[lfPC] : 0;
        const lfRawDisasm = (assembler) ? assembler.disassemble(lfWord) : '???';

        // Apply pet names lightly (CR/DR substitution only)
        const _bPetCR = Object.assign({}, _petNameCRMap || {});
        const _bPetDR = Object.assign({}, _petNameDRMap || {});
        if (assembler && assembler.getAliases) {
            const _al = assembler.getAliases();
            for (const [nm, num] of Object.entries(_al.cr || {})) _bPetCR[num] = nm;
            for (const [nm, num] of Object.entries(_al.dr || {})) _bPetDR[num] = nm;
        }
        const lfDisasm = lfRawDisasm
            .replace(/\bCR(\d+)\b/g, (m, n) => { const a = _bPetCR[+n]; return a ? `<span class="itrace-pet" title="CR${n}">${a}</span>` : m; })
            .replace(/\bDR(\d+)\b/g, (m, n) => { const a = _bPetDR[+n]; return a ? `<span class="itrace-pet" title="DR${n}">${a}</span>` : m; });

        // Resolve namespace / lump ownership.  Prefer the snapshot stored on the
        // fault object so that the correct lump name is shown even after a page
        // reload, when the live namespace table may be empty.
        const _ns = Object.prototype.hasOwnProperty.call(lf, '_nsSnapshot')
            ? lf._nsSnapshot
            : ((typeof _nsOwnerOf === 'function') ? _nsOwnerOf(lfPC) : null);

        // CLOOMC source line
        let lfSrcLine = '';
        if (assembler && assembler.getLastLineNums) {
            if (_ns && _ns.offset >= 1) {
                const instrIdx = _ns.offset - 1;
                const lns = assembler.getLastLineNums();
                const ln  = lns[instrIdx];
                if (typeof ln === 'number' && ln > 0) {
                    const _asmEdEl = document.getElementById('asmEditor') || document.getElementById('asmEd');
                    if (_asmEdEl && _asmEdEl.value) {
                        const srcText = (_asmEdEl.value.split('\n')[ln - 1] || '').trim();
                        if (srcText) lfSrcLine = srcText;
                    }
                }
            }
        }

        html += `<div class="fault-gate-banner" style="border-left-color:${lfColor};background:${lfColor}18">`;
        html += `<div class="fault-gate-banner-header">`;
        html += `<span class="fault-type-badge fault-gate-banner-badge" style="background:${lfColor}22;border-color:${lfColor};color:${lfColor}">${lf.type}</span>`;
        html += `<span class="fault-gate-banner-title">Machine Fault</span>`;
        html += `<button class="gate-loc-step-link fault-gate-banner-open" onclick="showFaultModal(sim.faultLog[sim.faultLog.length-1])" title="Open fault details">&#x1F50D; Details</button>`;
        html += `</div>`;
        if (lfDesc) {
            html += `<div class="fault-gate-banner-desc">${lfDesc}</div>`;
        }
        html += `<div class="fault-gate-banner-meta">`;
        html += `<span class="fault-gate-banner-pc">PC&nbsp;<code>${lfPCHex}</code></span>`;
        if (_ns && _ns.label) {
            html += `<span class="fault-gate-banner-sep">&middot;</span>`;
            html += `<span class="fault-gate-banner-lump">${_ns.label}&nbsp;<span class="fault-gate-banner-offset">+${_ns.offset}</span></span>`;
        }
        html += `<span class="fault-gate-banner-sep">&middot;</span>`;
        html += `<span class="fault-gate-banner-instr">${lfDisasm}</span>`;
        if (lfSrcLine) {
            html += `<span class="fault-gate-banner-sep">&middot;</span>`;
            html += `<span class="fault-gate-banner-src"><code>${lfSrcLine.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</code></span>`;
        }
        html += `</div>`;
        const _lfNote = lf.userNote || (typeof _loadFaultNote === 'function' ? _loadFaultNote(lf) : '');
        if (_lfNote) {
            if (!lf.userNote) lf.userNote = _lfNote;
            html += `<div class="fault-gate-banner-note">&#x1F4DD;&nbsp;${_lfNote.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>`;
        }

        // ── Compact fault history (shown when more than one fault exists) ──
        if (faultLog.length > 1) {
            const maxHistory = 5;
            const startIdx = Math.max(0, faultLog.length - maxHistory);
            const truncatedCount = startIdx;
            html += `<div class="fault-history-list">`;
            html += `<div class="fault-history-list-label">Fault history</div>`;
            if (truncatedCount > 0) {
                html += `<div class="fault-history-truncated">&#x22EE;&nbsp;${truncatedCount} older fault${truncatedCount > 1 ? 's' : ''} not shown</div>`;
            }
            for (let _fhi = startIdx; _fhi < faultLog.length; _fhi++) {
                const _fe = faultLog[_fhi];
                const _isLatest = _fhi === faultLog.length - 1;
                const _feColor = (typeof _FAULT_COLORS !== 'undefined' && _FAULT_COLORS[_fe.type]) || '#e05555';
                const _fePC = (_fe.physicalPC !== undefined && _fe.physicalPC !== null) ? _fe.physicalPC : _fe.pc;
                const _fePCHex = '0x' + (_fePC >>> 0).toString(16).toUpperCase().padStart(4, '0');
                const _feStep = _fe.step !== undefined ? _fe.step : '?';
                html += `<div class="fault-history-row${_isLatest ? ' fault-history-row-latest' : ''}" onclick="showFaultModal(sim.faultLog[${_fhi}])" title="Open fault details (entry ${_fhi + 1})">`;
                html += `<span class="fault-history-badge" style="background:${_feColor}22;border-color:${_feColor};color:${_feColor}">${_fe.type}</span>`;
                html += `<span class="fault-history-pc"><code>${_fePCHex}</code></span>`;
                html += `<span class="fault-history-step">step&nbsp;${_feStep}</span>`;
                if (_isLatest) html += `<span class="fault-history-latest-mark">&#x25C4; latest</span>`;
                html += `</div>`;
            }
            html += `</div>`;
        }

        html += `</div>`;
    }

    // Empty-state guidance — only when there is no fault banner and no audit entries.
    if (faultLog.length === 0 && log.length === 0) {
        container.innerHTML = `<div class="gate-log-empty">
            <p>No gates recorded yet.</p>
            <ol class="audit-guide-steps">
                <li>Click <b>Boot</b> (top-right)</li>
                <li>Switch to the <b>Gate Log</b> tab (you are here)</li>
                <li>Click <b>Step</b> (top-right) — each click shows the mLoad / mSave gates for that instruction</li>
            </ol>
        </div>`;
        return;
    }

    for (const a of log) {
        const pass = a.result === 'pass';
        const isMSave = a.gate === 'mSave';
        const isNavana = a.gate.startsWith('Navana.');
        const isLumpHdr = a.gate === 'Lump.Header';
        const isNSType = a.gate === 'NS.Type';
        let badgeClass;
        if (isNavana)       badgeClass = 'gate-navana';
        else if (isMSave)   badgeClass = 'gate-msave';
        else if (isLumpHdr) badgeClass = 'gate-lump';
        else if (isNSType)  badgeClass = 'gate-nstype';
        else                badgeClass = 'gate-mload';
        const _hasClickPC = a.stepCtx && typeof a.stepCtx === 'object' && a.stepCtx.pc !== undefined;
        const _physPC = _hasClickPC && a.stepCtx.physicalPC !== undefined ? a.stepCtx.physicalPC : 'undefined';
        html += `<div class="audit-gate ${pass ? 'gate-pass' : 'gate-fail'}${_hasClickPC ? ' audit-gate-clickable' : ''}"${_hasClickPC ? ` onclick="openCRDetailAtPC(${a.stepCtx.pc},${_physPC})" title="Click to view instruction in code view"` : ''}>`;
        html += `<div class="gate-header">`;
        html += `<span class="gate-type-badge ${badgeClass}">${a.gate}</span>`;
        html += `<span class="gate-label">NS[${a.nsIndex}] &ldquo;${a.label}&rdquo;</span>`;
        if (a.requiredPerm) html += `<span class="gate-perm-req">requires&nbsp;<b>${a.requiredPerm}</b></span>`;
        html += `<span class="gate-result ${pass ? 'result-pass' : 'result-fail'}">${pass ? '\u2713 PASS' : '\u2717 FAULT'}</span>`;
        html += `</div>`;
        html += `<div class="gate-checks">`;
        for (const [k, v] of Object.entries(a.checks || {})) {
            let label;
            if (k === 'magic') {
                label = v.pass
                    ? 'MAGIC'
                    : `MAGIC&nbsp;(0x${v.rawMagic.toString(16).toUpperCase().padStart(2,'0')}&nbsp;&#x2192;&nbsp;0x1F)`;
            } else if (k === 'cc') {
                label = 'CC';
            } else if (k === 'typ') {
                label = 'TYPE';
            } else if (k === 'type' && v.required !== undefined) {
                label = v.pass
                    ? `TYPE&nbsp;(${v.actual})`
                    : `TYPE&nbsp;(${v.actual}&nbsp;&#x2192;&nbsp;${v.required})`;
            } else if (k === 'perm' && v.perm) {
                label = `PERM&nbsp;(${v.perm})`;
            } else if (k === 'range') {
                if (v.address !== undefined) {
                    label = v.pass
                        ? `SCOPE&nbsp;(addr&nbsp;${v.address}&nbsp;&isin;&nbsp;[${v.base}..${v.limit}])`
                        : `SCOPE&nbsp;(addr&nbsp;${v.address}&nbsp;&notin;&nbsp;[${v.base}..${v.limit}]&nbsp;&#x26A0;)`;
                } else {
                    label = v.pass
                        ? `SCOPE&nbsp;(${v.offset}&nbsp;&le;&nbsp;${v.limit})`
                        : `SCOPE&nbsp;(${v.offset}&nbsp;&gt;&nbsp;${v.limit}&nbsp;&#x26A0;)`;
                }
            } else {
                label = k.toUpperCase();
            }
            const extraClass = k === 'range' ? ' check-range' : '';
            html += `<span class="gate-check ${v.pass ? 'check-pass' : 'check-fail'}${extraClass}">${v.pass ? '\u2713' : '\u2717'}&nbsp;${label}</span>`;
        }
        // When the gate failed on perm and is a DREAD/DWRITE mLoad, the range check was never
        // reached.  Show a greyed-out badge so the user knows the scope was not verified.
        const isDReadWrite = a.gate === 'mLoad' && a.requiredPerm && (a.requiredPerm === 'R' || a.requiredPerm === 'W');
        if (!pass && isDReadWrite && !(a.checks && a.checks.range)) {
            html += `<span class="gate-check check-skipped" title="Perm check failed before scope could be verified">&mdash;&nbsp;SCOPE&nbsp;(not&nbsp;checked)</span>`;
        }
        if (!isLumpHdr && !isNSType) {
            html += `<span class="gate-flag">B=${a.b}</span><span class="gate-flag">F=${a.f}</span>`;
        }
        html += `</div>`;
        // Instruction context footer — shown for every gate entry that has step context
        // (i.e. any runtime step(), not a boot-phase _bootStep()).
        if (a.stepCtx) {
            const ctx = a.stepCtx;
            let rawDisasm;
            if (ctx.instrWord != null) {
                const disasm = (assembler || new ChurchAssembler()).disassemble(ctx.instrWord);
                rawDisasm = disasm.startsWith('???')
                    ? `${ctx.opName} CR${ctx.crDst}, CR${ctx.crSrc}, #${ctx.imm}`
                    : disasm;
            } else {
                rawDisasm = `${ctx.opName} CR${ctx.crDst}, CR${ctx.crSrc}, #${ctx.imm}`;
            }
            // Apply pet names (CR/DR aliases)
            const _gPetCR = Object.assign({}, _petNameCRMap || {});
            const _gPetDR = Object.assign({}, _petNameDRMap || {});
            if (assembler && assembler.getAliases) {
                const _al = assembler.getAliases();
                for (const [nm, num] of Object.entries(_al.cr || {})) _gPetCR[num] = nm;
                for (const [nm, num] of Object.entries(_al.dr || {})) _gPetDR[num] = nm;
            }
            const instrStr = rawDisasm
                .replace(/\bCR(\d+)\b/g, (m, n) => { const a = _gPetCR[+n]; return a ? `<span class="itrace-pet" title="CR${n}">${a}</span>` : m; })
                .replace(/\bDR(\d+)\b/g, (m, n) => { const a = _gPetDR[+n]; return a ? `<span class="itrace-pet" title="DR${n}">${a}</span>` : m; });
            html += `<div class="gate-location${pass ? '' : ' gate-location-fault'}">`;
            html += `<button class="gate-loc-step gate-loc-step-link" onclick="event.stopPropagation();jumpToTraceStep(${ctx.step})" title="Jump to this step in the Trace view">Step&nbsp;#${ctx.step}</button>`;
            html += `<span class="gate-loc-sep">&middot;</span>`;
            html += `<span class="gate-loc-pc">PC&nbsp;=&nbsp;${ctx.pc}</span>`;
            html += `<span class="gate-loc-sep">&middot;</span>`;
            html += `<span class="gate-loc-instr">${instrStr}</span>`;
            html += `</div>`;
        }
        html += `</div>`;
    }
    container.innerHTML = html;
}

