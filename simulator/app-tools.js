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

    // ── Wukong A7 hardware LED bar ────────────────────────────────────────────
    // LED0 (G21, green): solid ON during boot (booting indicator), follows
    //   bit 0 of ledBits post-boot (CM MMIO / DWRITE LED[0]).
    // LED1 (G20, red): 1 Hz heartbeat blink during boot, fault indicator
    //   post-boot (ON = fault latched, OFF = normal).
    const hw0 = document.getElementById('hw-led0');
    if (hw0) {
        const led0on = complete ? !!(bits & 1) : bits > 0;
        hw0.classList.toggle('on', led0on);
    }
    const hw1 = document.getElementById('hw-led1');
    if (hw1) {
        const booting = !complete && bits > 0;
        hw1.classList.toggle('hw-led-heartbeat', booting);
        hw1.classList.toggle('on', !booting && !!(sim.faultLatch));
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
    _updateExecutionCounter();
    updateCRDisplay();
    updateDRDisplay();
    updateFlagsDisplay();
    updateInfoDisplay();
    updateGateLog();
    if (selectedCR !== null) updateCRDetail();
    if (pipelineViz && !pipelineViz.animating) pipelineViz.render();
    _refreshSignedReturnReadout();
    if (typeof updateLiveLumpBanner === 'function') updateLiveLumpBanner();
    updateMemoryStatsPanel();
    if (typeof renderWatchStrip === 'function') renderWatchStrip();
    if (typeof refreshInvokeBtn === 'function') refreshInvokeBtn();
}

// Render the authoritative simulator retirement count and the operations that
// were intentionally excluded from it.  This is deliberately read-only: none
// of the UI execution paths is allowed to add to the successful count.
function _updateExecutionCounter() {
    const el = document.getElementById('faultFreeCounter');
    if (!el || !sim || !sim.executionStats) return;
    const s = sim.executionStats;
    const fmt = n => Number(n || 0).toLocaleString();
    const total = Number(s.successful || 0);
    el.textContent = `${fmt(total)}\u202F/\u202F1K`;
    el.className = total >= 1000 ? 'fault-free-badge ff-eligible' : (total ? 'fault-free-badge ff-progress' : 'fault-free-badge ff-zero');
    el.title = `Successful user instructions: ${fmt(total)} / 1,000`;
    const excluded = document.getElementById('executionExcludedCounters');
    if (excluded) {
        excluded.textContent = `Boot ${fmt(s.bootPhases)} \u00b7 Fault ${fmt(s.faults)} \u00b7 Suspended ${fmt(s.suspensions)} \u00b7 Lazy ${fmt(s.lazyLoadWaits)} \u00b7 Rejected ${fmt(s.rejected)}`;
    }
}

function updateMemoryStatsPanel() {
    const el = document.getElementById('memStatsContent');
    if (!el) return;

    const sa = (sim && sim.systemAbstractions) ? sim.systemAbstractions : null;
    const stats = sa ? sa.getMemoryStats() : null;

    if (!stats) {
        el.innerHTML = '<div style="color:var(--text-secondary,#9ca3af);padding:1rem;font-family:monospace;font-size:0.82rem;">Memory layer statistics not yet available — boot the simulator first.</div>';
        return;
    }

    const memTotal = (sim && sim.NS_TABLE_BASE) ? sim.NS_TABLE_BASE : 0;
    const watermark = stats.physicalWatermark;
    const watermarkPct = memTotal > 0 ? Math.min(100, Math.round(watermark / memTotal * 100)) : 0;
    const watermarkColor = watermarkPct > 80 ? '#f87171' : watermarkPct > 60 ? '#fbbf24' : '#4ade80';

    const turingUsed = stats.turingWordsUsed;
    const turingTotal = stats.turingQuotaTotal;
    const turingPct = turingTotal > 0 ? Math.min(100, Math.round(turingUsed / turingTotal * 100)) : 0;

    const churchSlots = stats.churchSlotsUsed;
    const churchTotal = stats.churchSlotsTotal || (sim && sim.nsCount) || 0;
    const churchPct   = churchTotal > 0 ? Math.min(100, Math.round(churchSlots / churchTotal * 100)) : 0;

    const systemPgt = stats.systemPgt;
    const systemPgtHex = systemPgt ? ('0x' + (systemPgt >>> 0).toString(16).toUpperCase().padStart(8, '0')) : 'not issued';
    const systemSeq = stats.systemSeq;
    const billingAccounts = stats.billingAccounts;

    function bar(pct, color) {
        return `<div style="background:#1a1a2e;border-radius:3px;height:8px;width:100%;max-width:220px;overflow:hidden;display:inline-block;vertical-align:middle;margin-left:8px;">` +
            `<div style="background:${color};width:${pct}%;height:100%;border-radius:3px;transition:width 0.2s;"></div></div>`;
    }

    function row(label, value, extraHtml) {
        return `<tr><td style="padding:5px 10px 5px 0;color:#9ca3af;font-size:0.8rem;white-space:nowrap;min-width:160px;">${label}</td>` +
            `<td style="padding:5px 0;font-family:monospace;font-size:0.82rem;color:#e5e7eb;">${value}${extraHtml || ''}</td></tr>`;
    }

    const html = `
<details open style="margin:0;">
<summary style="cursor:pointer;padding:8px 0 4px;color:#daa520;font-size:0.88rem;font-weight:600;letter-spacing:0.04em;list-style:none;">
&#9660; PhysicalPool &mdash; Layer 0
</summary>
<table style="border-collapse:collapse;width:100%;margin:4px 0 12px 8px;">
${row('Watermark', `0x${watermark.toString(16).toUpperCase().padStart(5,'0')} / 0x${memTotal.toString(16).toUpperCase().padStart(5,'0')} (${watermarkPct}%)`, bar(watermarkPct, watermarkColor))}
${row('NS_TABLE_BASE', `0x${memTotal.toString(16).toUpperCase().padStart(5,'0')}`)}
</table>
</details>

<details open style="margin:0;">
<summary style="cursor:pointer;padding:8px 0 4px;color:#7dd3fc;font-size:0.88rem;font-weight:600;letter-spacing:0.04em;list-style:none;">
&#9660; TuringMemory &mdash; Layer 1a
</summary>
<table style="border-collapse:collapse;width:100%;margin:4px 0 12px 8px;">
${row('Code words used', `${turingUsed.toLocaleString()} / ${turingTotal === 0x7FFFFFFF ? '∞' : turingTotal.toLocaleString()}`, turingTotal < 0x7FFFFFFF ? bar(turingPct, turingPct > 80 ? '#f87171' : '#7dd3fc') : '')}
</table>
</details>

<details open style="margin:0;">
<summary style="cursor:pointer;padding:8px 0 4px;color:#a78bfa;font-size:0.88rem;font-weight:600;letter-spacing:0.04em;list-style:none;">
&#9660; ChurchMemory &mdash; Layer 1b
</summary>
<table style="border-collapse:collapse;width:100%;margin:4px 0 12px 8px;">
${row('Abstract handles', `${churchSlots} / ${churchTotal > 0 ? churchTotal : '\u2014'} (${churchPct}%)`, churchTotal > 0 ? bar(churchPct, churchPct > 80 ? '#f87171' : '#a78bfa') : '')}
</table>
</details>

<details open style="margin:0;">
<summary style="cursor:pointer;padding:8px 0 4px;color:#fbbf24;font-size:0.88rem;font-weight:600;letter-spacing:0.04em;list-style:none;">
&#9660; Billing &mdash; Layer 2
</summary>
<table style="border-collapse:collapse;width:100%;margin:4px 0 12px 8px;">
${row('Active accounts', `${billingAccounts}`)}
${row('System P-GT', systemPgtHex)}
${row('System seq', `${systemSeq}`)}
</table>
</details>`;

    el.innerHTML = html;
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
    if (!sim) return;
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

        // lf.tier === 1/2/3: recovery succeeded at that tier
        // lf.tier === null:  recovery logic ran but all tiers were exhausted (halted)
        // lf.tier === undefined: legacy record pre-Task-#1077 — tier unknown, no pill
        const lfTierKnown = lf.tier === 1 || lf.tier === 2 || lf.tier === 3 || lf.tier === null;
        const lfTierPillText  = lf.tier === 1 ? 'Tier 1'
            : lf.tier === 2 ? 'Tier 2'
            : lf.tier === 3 ? 'Tier 3'
            : 'Halted';
        const lfTierPillColor = lf.tier === 1 ? '#4caf50'
            : lf.tier === 2 ? '#ff9800'
            : lf.tier === 3 ? '#e91e63'
            : '#e05555';
        const lfTierPillTitle = lf.tier === 1 ? 'Tier 1 — .catch recovered'
            : lf.tier === 2 ? 'Tier 2 — Scheduler.IRQ recovered'
            : lf.tier === 3 ? 'Tier 3 — double-fault / PP250 recovery'
            : 'Unhandled — machine halted';

        html += `<div class="fault-gate-banner" style="border-left-color:${lfColor};background:${lfColor}18">`;
        html += `<div class="fault-gate-banner-header">`;
        html += `<span class="fault-type-badge fault-gate-banner-badge" style="background:${lfColor}22;border-color:${lfColor};color:${lfColor}">${lf.type}</span>`;
        if (lfTierKnown) {
            html += `<span class="fault-recovery-pill" style="background:${lfTierPillColor}22;border-color:${lfTierPillColor};color:${lfTierPillColor}" title="${lfTierPillTitle}">${lfTierPillText}</span>`;
        }
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
                const _feNs = Object.prototype.hasOwnProperty.call(_fe, '_nsSnapshot')
                    ? _fe._nsSnapshot
                    : ((typeof _nsOwnerOf === 'function') ? _nsOwnerOf(_fePC) : null);
                html += `<div class="fault-history-row${_isLatest ? ' fault-history-row-latest' : ''}" onclick="showFaultModal(sim.faultLog[${_fhi}])" title="Open fault details (entry ${_fhi + 1})">`;
                html += `<span class="fault-history-badge" style="background:${_feColor}22;border-color:${_feColor};color:${_feColor}">${_fe.type}</span>`;
                html += `<span class="fault-history-pc"><code>${_fePCHex}</code></span>`;
                if (_feNs && _feNs.label) {
                    html += `<span class="fault-history-lump">${_feNs.label}</span>`;
                }
                html += `<span class="fault-history-step">step&nbsp;${_feStep}</span>`;
                if (_isLatest) html += `<span class="fault-history-latest-mark">&#x25C4; latest</span>`;
                html += `</div>`;
            }
            html += `</div>`;
        }

        html += `</div>`;
    }

    // ── Fault Recovery Timeline ────────────────────────────────────────────────
    // Shows the three-tier escalation history and IRQ sweep count.
    // Visible whenever any fault has structured recovery fields, or whenever
    // the scheduler has performed at least one IRQ sweep.
    // sweepCount is hoisted so the empty-state guard below can also suppress
    // the "No gates recorded" placeholder when there is live scheduler data.
    const _frtSa = (sim && sim.systemAbstractions) ? sim.systemAbstractions : null;
    const _frtSchedState = _frtSa ? _frtSa._schedulerState : null;
    const _frtSweepCount = _frtSchedState ? (_frtSchedState._irqSweepCount || 0) : 0;
    const _frtTieredFaults = faultLog.filter(f => f.tier != null || f.faultCode != null || f.faultingMnemonic != null);
    {
        const sweepCount = _frtSweepCount;
        const tieredFaults = _frtTieredFaults;

        if (tieredFaults.length > 0 || sweepCount > 0) {
            const openAttr = faultLog.length > 0 ? ' open' : '';
            html += `<details class="frt-details"${openAttr}>`;
            html += `<summary class="frt-summary">&#x26A1; Fault Recovery Timeline`;
            if (sweepCount > 0) {
                html += ` <span class="frt-sweep-badge" title="Total Scheduler.IRQ sweep invocations since boot">IRQ sweeps: ${sweepCount}</span>`;
            }
            if (tieredFaults.length > 0) {
                html += ` <span class="frt-count-badge">${tieredFaults.length} escalation${tieredFaults.length !== 1 ? 's' : ''}</span>`;
            }
            html += `</summary>`;

            if (tieredFaults.length === 0) {
                html += `<div class="frt-empty">No structured fault escalations yet. Fault escalations appear here when the three-tier recovery system is triggered.</div>`;
            } else {
                html += `<div class="frt-list">`;
                for (let _fi = 0; _fi < tieredFaults.length; _fi++) {
                    const _fe = tieredFaults[_fi];
                    const _isLatest = (_fi === tieredFaults.length - 1);
                    const _tierNum = _fe.tier;
                    const _tierLabel = _tierNum === 1 ? 'Tier\u00a01 (.catch)'
                        : _tierNum === 2 ? 'Tier\u00a02 (IRQ)'
                        : _tierNum === 3 ? 'Tier\u00a03 (PP250)'
                        : 'Unhandled';
                    const _tierClass = _tierNum === 1 ? 'frt-tier-1'
                        : _tierNum === 2 ? 'frt-tier-2'
                        : _tierNum === 3 ? 'frt-tier-3'
                        : 'frt-tier-x';
                    const _step = _fe.step !== undefined ? _fe.step : '?';
                    const _faultType = _fe.type || '?';
                    const _feColor = (typeof _FAULT_COLORS !== 'undefined' && _FAULT_COLORS[_fe.type]) || '#e05555';
                    const _fePCVal = (_fe.physicalPC !== undefined && _fe.physicalPC !== null) ? _fe.physicalPC : _fe.pc;
                    const _fePCHex = '0x' + (_fePCVal >>> 0).toString(16).toUpperCase().padStart(4, '0');

                    html += `<div class="frt-row${_isLatest ? ' frt-row-latest' : ''}" onclick="showFaultModal(sim.faultLog[${sim.faultLog.indexOf(_fe)}])" title="Open fault details">`;
                    html += `<span class="frt-step">step&nbsp;${_step}</span>`;
                    html += `<span class="frt-type-badge" style="background:${_feColor}22;border-color:${_feColor};color:${_feColor}">${_faultType}</span>`;
                    html += `<span class="frt-pc"><code>${_fePCHex}</code></span>`;
                    if (_fe.faultingMnemonic) {
                        html += `<span class="frt-mnemonic"><code>${_fe.faultingMnemonic}</code></span>`;
                    }
                    if (_fe.pipelineStage) {
                        html += `<span class="frt-pipeline">${_fe.pipelineStage}</span>`;
                    }
                    if (_tierNum != null) {
                        html += `<span class="frt-tier-badge ${_tierClass}">${_tierLabel}</span>`;
                    }
                    if (_fe.catchInvoked) {
                        html += `<span class="frt-flag frt-flag-catch">.catch</span>`;
                    }
                    if (_fe.irqInvoked) {
                        html += `<span class="frt-flag frt-flag-irq">IRQ</span>`;
                    }
                    if (_fe.tier3Recovery) {
                        html += `<span class="frt-flag frt-flag-tier3">PP250</span>`;
                    }
                    if (_fe.involvedGT != null) {
                        const _gtHex = '0x' + (_fe.involvedGT >>> 0).toString(16).toUpperCase().padStart(8, '0');
                        html += `<span class="frt-gt" title="Involved Golden Token">GT:${_gtHex}</span>`;
                    }
                    if (_isLatest) html += `<span class="fault-history-latest-mark">&#x25C4;&nbsp;latest</span>`;
                    html += `</div>`;
                }
                html += `</div>`;
            }
            html += `</details>`;
        }
    }

    // Empty-state guidance — only when there is no fault banner, no audit entries,
    // and the scheduler has not yet performed any IRQ sweeps.
    if (faultLog.length === 0 && log.length === 0 && _frtSweepCount === 0) {
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
        const isMemLayer = a.gate.startsWith('Billing.') || a.gate.startsWith('TuringMemory.') || a.gate.startsWith('ChurchMemory.');
        let badgeClass;
        if (isNavana)       badgeClass = 'gate-navana';
        else if (isMemLayer) badgeClass = 'gate-memlayer';
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
        if (a.detail) {
            html += `<span class="gate-detail">${a.detail.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>`;
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
            if (/^(CALL|RETURN|ELOADCALL|XLOADLAMBDA)$/i.test(ctx.opName || '')) {
                const eventKind = /RETURN/i.test(ctx.opName) ? 'RETURN' : 'CALL';
                const safeCtx = JSON.stringify(ctx)
                    .replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
                html += `<button class="gate-loc-step gate-loc-step-link" onclick="event.stopPropagation();_openCallReturnDrilldown({kind:'${eventKind}',nia:${ctx.physicalPC != null ? ctx.physicalPC : ctx.pc},instrWord:${ctx.instrWord != null ? ctx.instrWord : 'null'}},${safeCtx})" title="Open the exact ${eventKind} instruction">Open exact ${eventKind}</button>`;
            }
            html += `</div>`;
        }
        html += `</div>`;
    }
    container.innerHTML = html;
}

