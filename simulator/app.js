const POPUPS_DISABLED = false;

let sim = null;
let assembler = null;
let pipelineViz = null;
let repl = null;
let churchTutorial = null;
let slideRuleTutorial = null;
let cloomcTutorial = null;
let securityTutorial = null;
let threadTutorial = null;
let abstrTutorial = null;
let nsTutorial = null;
let secureBootTutorial = null;
let activeTutorial = 'sliderule';
let cloomcCompiler = null;
let currentView = 'dashboard';
let previousView = null;
let lastAssembledWords = null;
let abstractionRegistry = null;
let systemAbstractions = null;
let deviceAbstractions = null;

let userTabs = [];
let activeUserTabId = null;
let userTabDirty = false;

function loadUserTabs() {
    try {
        const raw = localStorage.getItem('church_user_tabs');
        userTabs = raw ? JSON.parse(raw) : [];
    } catch (e) { userTabs = []; }
}

function saveUserTabsToStorage() {
    localStorage.setItem('church_user_tabs', JSON.stringify(userTabs));
}

function generateTabId() {
    return 'ut_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

function createUserTab(name, lang) {
    const tab = { id: generateTabId(), name: name, lang: lang || 'assembly', code: '' };
    userTabs.push(tab);
    saveUserTabsToStorage();
    renderUserTabs();
    selectUserTab(tab.id);
    return tab;
}

function deleteUserTab(id) {
    userTabs = userTabs.filter(t => t.id !== id);
    saveUserTabsToStorage();
    if (activeUserTabId === id) {
        activeUserTabId = null;
        userTabDirty = false;
        const editor = document.getElementById('asmEditor');
        if (editor) editor.value = '';
        const sel = document.getElementById('langSelector');
        if (sel) showIntro(sel.value);
    }
    renderUserTabs();
    updateSaveUserTabBtn();
}

function selectUserTab(id) {
    if (activeUserTabId && userTabDirty) {
        saveActiveUserTab();
    }
    const tab = userTabs.find(t => t.id === id);
    if (!tab) return;
    activeUserTabId = id;
    userTabDirty = false;
    const editor = document.getElementById('asmEditor');
    if (editor) editor.value = tab.code;
    const sel = document.getElementById('langSelector');
    if (sel && sel.value !== tab.lang) {
        sel.value = tab.lang;
        onLangChange(true);
    }
    document.querySelectorAll('.example-tab').forEach(t => t.classList.remove('active'));
    renderUserTabs();
    updateSaveUserTabBtn();
    updateLineNumbers();
    if (editor) editor.focus();
    const outputEl = document.getElementById('assemblyOutput');
    if (outputEl) outputEl.innerHTML = '';
}

function saveActiveUserTab() {
    if (!activeUserTabId) return;
    const tab = userTabs.find(t => t.id === activeUserTabId);
    if (!tab) return;
    const editor = document.getElementById('asmEditor');
    if (editor) tab.code = editor.value;
    const sel = document.getElementById('langSelector');
    if (sel) tab.lang = sel.value;
    userTabDirty = false;
    saveUserTabsToStorage();
    renderUserTabs();
    updateSaveUserTabBtn();
}

function updateSaveUserTabBtn() {
    const btn = document.getElementById('btnSaveUserTab');
    if (btn) btn.disabled = !activeUserTabId || !userTabDirty;
}

function markUserTabDirty() {
    if (activeUserTabId && !userTabDirty) {
        userTabDirty = true;
        renderUserTabs();
        updateSaveUserTabBtn();
    }
}

function renderUserTabs() {
    const container = document.getElementById('userTabsContainer');
    if (!container) return;
    container.innerHTML = '';
    userTabs.forEach(tab => {
        const btn = document.createElement('button');
        btn.className = 'example-tab user-tab' + (activeUserTabId === tab.id ? ' active' : '');
        btn.setAttribute('data-tab-id', tab.id);
        const label = tab.name + (activeUserTabId === tab.id && userTabDirty ? ' \u25CF' : '');
        const labelSpan = document.createElement('span');
        labelSpan.className = 'user-tab-label';
        labelSpan.textContent = label;
        const closeSpan = document.createElement('span');
        closeSpan.className = 'user-tab-close';
        closeSpan.title = 'Close tab';
        closeSpan.textContent = '\u00D7';
        btn.appendChild(labelSpan);
        btn.appendChild(closeSpan);
        btn.addEventListener('click', (e) => { if (!e.target.classList.contains('user-tab-close')) selectUserTab(tab.id); });
        closeSpan.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('Delete program "' + tab.name + '"?')) deleteUserTab(tab.id);
        });
        container.appendChild(btn);
    });
}

function showNewTabDialog() {
    const dialog = document.getElementById('newTabDialog');
    if (!dialog) return;
    dialog.style.display = 'flex';
    const nameInput = document.getElementById('newTabName');
    if (nameInput) { nameInput.value = ''; nameInput.focus(); }
    const langSel = document.getElementById('newTabLang');
    const mainSel = document.getElementById('langSelector');
    if (langSel && mainSel) langSel.value = mainSel.value;
}

function hideNewTabDialog() {
    const dialog = document.getElementById('newTabDialog');
    if (dialog) dialog.style.display = 'none';
}

function confirmNewTab() {
    const nameInput = document.getElementById('newTabName');
    const langSel = document.getElementById('newTabLang');
    const name = nameInput ? nameInput.value.trim() : '';
    if (!name) { alert('Please enter a program name.'); return; }
    const lang = langSel ? langSel.value : 'assembly';
    hideNewTabDialog();
    const sel = document.getElementById('langSelector');
    if (sel && sel.value !== lang) {
        sel.value = lang;
        onLangChange(true);
    }
    createUserTab(name, lang);
}

function init() {
    sim = new ChurchSimulator();
    assembler = new ChurchAssembler();
    pipelineViz = new PipelineVisualizer('pipelineContainer');
    pipelineViz.setNIAProvider(() => {
        if (!sim.bootComplete) return _bootNIARows(sim.bootStep);
        return _buildNIARows(sim.pc > 0 ? sim.pc - 1 : null, sim.pc);
    });
    repl = new ChurchREPL(sim, pipelineViz);
    _ensureTutorialObjects();

    abstractionRegistry = new AbstractionRegistry();
    systemAbstractions = new SystemAbstractions(abstractionRegistry);
    deviceAbstractions = new DeviceAbstractions(abstractionRegistry);
    sim.initAbstractions(abstractionRegistry, systemAbstractions, deviceAbstractions);
    sim.reset();
    _absMethodsLoad();
    _implStatusLoad();

    if (typeof CLOOMCCompiler !== 'undefined') {
        cloomcCompiler = new CLOOMCCompiler();
    }

    sim.on('stateChange', () => { updateDashboard(); updateLedStrip(); });
    sim.on('programLoaded', () => {
        if (currentView === 'namespace') updateNamespace();
        if (currentView === 'abstractions') renderAbstractions();
    });
    sim.on('fault', (f) => { appendOutput(`FAULT [${f.type}]: ${f.message}`, 'error'); faultAlertOn(); showFaultModal(f); });
    sim.on('halt', () => appendOutput('Machine halted.', 'info'));

    loadUserTabs();
    loadEditorState();
    renderUserTabs();
    initReplDivider();
    initEditorDivider();
    initConsoleAutoSwitch();
    const asmEd = document.getElementById('asmEditor');
    if (asmEd) {
        asmEd.addEventListener('input', function() { updateLineNumbers(); markUserTabDirty(); });
        asmEd.addEventListener('scroll', syncLineScroll);
        asmEd.addEventListener('keydown', function(e) {
            if (e.key === 'Tab') {
                e.preventDefault();
                const s = this.selectionStart, end = this.selectionEnd;
                this.value = this.value.substring(0, s) + '    ' + this.value.substring(end);
                this.selectionStart = this.selectionEnd = s + 4;
                updateLineNumbers();
                markUserTabDirty();
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                if (activeUserTabId) saveActiveUserTab();
            }
        });
    }
    updateLineNumbers();
    loadNamespaceState();
    checkBootId();
    const views = ['repl','editor','tutorial','dashboard','namespace','abstractions','pipeline','reference','docs','builder'];
    const hash = window.location.hash.replace('#', '');
    const startView = views.includes(hash) ? hash : 'pipeline';
    switchView(startView);
    switchMathMode('hp35');

    requestAnimationFrame(() => {
        updateDashboard();
        pipelineViz.render();
        initTooltipAutoFlip();
        hideLoadingOverlay();
    });
}

function initTooltipAutoFlip() {
    document.addEventListener('pointerenter', function(e) {
        if (!e.target || typeof e.target.closest !== 'function') return;
        const el = e.target.closest('[data-tooltip]');
        if (!el) return;
        const rect = el.getBoundingClientRect();
        if (rect.top < 80) {
            el.classList.add('tooltip-below');
        } else {
            el.classList.remove('tooltip-below');
        }
    }, true);
}

function checkBootId() {
    fetch('/api/boot-id')
        .then(r => r.json())
        .then(data => {
            const stored = localStorage.getItem('churchMachine_bootId');
            if (stored && stored !== data.bootId) {
                localStorage.removeItem('church_welcome_dismissed');
                localStorage.removeItem('churchMachine_mathGuideDismissed');
                localStorage.removeItem('churchMachine_toolGuide_interactive');
                localStorage.removeItem('churchMachine_toolGuide_hp35');
                localStorage.removeItem('churchMachine_toolGuide_abacus');
                localStorage.removeItem('churchMachine_toolGuide_sliderule');
                // Guides are now on-demand via the ? button — no auto-popup.
            }
            localStorage.setItem('churchMachine_bootId', data.bootId);
        })
        .catch(() => {});
}

function goBack() {
    if (previousView) switchView(previousView);
}

function toggleHamburger() {
    const dd = document.getElementById('hamDropdown');
    if (!dd) return;
    const open = dd.style.display !== 'none';
    dd.style.display = open ? 'none' : 'flex';
}

function closeHamburger() {
    const dd = document.getElementById('hamDropdown');
    if (dd) dd.style.display = 'none';
}

document.addEventListener('click', function(e) {
    const wrap = document.getElementById('hamWrap');
    if (wrap && !wrap.contains(e.target)) closeHamburger();
});

function switchView(viewId) {
    if (viewId !== currentView) previousView = currentView;
    currentView = viewId;
    window.location.hash = viewId;
    const backBtn = document.getElementById('backBtn');
    if (backBtn) backBtn.style.display = previousView ? 'inline-flex' : 'none';
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const el = document.getElementById(viewId);
    if (el) el.classList.add('active');

    document.querySelectorAll('.ham-item').forEach(btn => btn.classList.remove('ham-active'));
    const activeHamItem = document.getElementById('hamItem-' + viewId);
    if (activeHamItem) activeHamItem.classList.add('ham-active');

    if (viewId === 'dashboard') updateDashboard();
    if (viewId === 'namespace') updateNamespace();
    if (viewId === 'abstractions') renderAbstractions();
    if (viewId === 'pipeline') pipelineViz.render();
    if (viewId === 'builder' && typeof initBuilder === 'function') initBuilder();
    if (viewId === 'builder') initHardwareBuildPanel();
    if (viewId === 'editor') {
        if (activeUserTabId && userTabDirty) saveActiveUserTab();
        activeUserTabId = null;
        userTabDirty = false;
        const asmEd = document.getElementById('asmEditor');
        if (asmEd) asmEd.value = '';
        document.querySelectorAll('.example-tab').forEach(t => t.classList.remove('active'));
        renderUserTabs();
        updateSaveUserTabBtn();
        const outputEl = document.getElementById('assemblyOutput');
        if (outputEl) outputEl.innerHTML = '';
        const sel = document.getElementById('langSelector');
        if (sel) showIntro(sel.value);
        if (typeof historyRefreshCode === 'function') {
            const area = document.getElementById('codeHistoryContent');
            if (area && !area.innerHTML.trim()) historyRefreshCode();
        }
    }
    if (viewId === 'tutorial') {
        _ensureTutorialObjects();
        if (activeTutorial === 'sliderule' && slideRuleTutorial) {
            slideRuleTutorial.render('tutorialView');
        } else if (activeTutorial === 'cloomc' && cloomcTutorial) {
            cloomcTutorial.render('tutorialView');
        } else if (activeTutorial === 'security' && securityTutorial) {
            securityTutorial.render('tutorialView');
        } else if (activeTutorial === 'thread' && threadTutorial) {
            threadTutorial.render('tutorialView');
        } else if (activeTutorial === 'abstraction' && abstrTutorial) {
            abstrTutorial.render('tutorialView');
        } else if (activeTutorial === 'namespace' && nsTutorial) {
            nsTutorial.render('tutorialView');
        } else if (activeTutorial === 'secureboot' && secureBootTutorial) {
            secureBootTutorial.render('tutorialView');
        } else if (churchTutorial) {
            churchTutorial.render('tutorialView');
        }
    }
    if (viewId === 'repl') {
        updateMathWelcome();
        if (typeof historyRefresh === 'function') {
            const area = document.getElementById('historyContent');
            if (area && !area.innerHTML.trim()) historyRefresh();
        }
    }
    if (viewId === 'reference') renderReference();
    if (viewId === 'docs') loadDocsView();
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
}

function copyLedAssembly() {
    const bits = (sim && typeof sim.ledBits === 'number') ? sim.ledBits : 0;
    const asm = `; LED.Pattern — set all 6 LEDs at once\nLOAD   CR1, NS[12]      ; Load LED device GT [L,S,E]\nDWRITE DR0, #${bits}${' '.repeat(Math.max(1, 12 - bits.toString().length))}; Pattern 0b${bits.toString(2).padStart(6,'0')}\nSAVE   CR1, CR6, 12     ; Write pattern to all LEDs`;
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
}

function updateGateLog() {
    const container = document.getElementById('gateLogContent');
    if (!container) return;
    const log = sim.auditLog || [];
    if (log.length === 0) {
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
    let html = '';
    for (const a of log) {
        const pass = a.result === 'pass';
        const isMSave = a.gate === 'mSave';
        const isNavana = a.gate.startsWith('Navana.');
        html += `<div class="audit-gate ${pass ? 'gate-pass' : 'gate-fail'}">`;
        html += `<div class="gate-header">`;
        html += `<span class="gate-type-badge ${isNavana ? 'gate-navana' : (isMSave ? 'gate-msave' : 'gate-mload')}">${a.gate}</span>`;
        html += `<span class="gate-label">NS[${a.nsIndex}] &ldquo;${a.label}&rdquo;</span>`;
        if (a.requiredPerm) html += `<span class="gate-perm-req">requires&nbsp;<b>${a.requiredPerm}</b></span>`;
        html += `<span class="gate-result ${pass ? 'result-pass' : 'result-fail'}">${pass ? '\u2713 PASS' : '\u2717 FAULT'}</span>`;
        html += `</div>`;
        html += `<div class="gate-checks">`;
        for (const [k, v] of Object.entries(a.checks)) {
            const label = k === 'perm' && v.perm ? `PERM&nbsp;(${v.perm})` : k.toUpperCase();
            html += `<span class="gate-check ${v.pass ? 'check-pass' : 'check-fail'}">${v.pass ? '\u2713' : '\u2717'}&nbsp;${label}</span>`;
        }
        html += `<span class="gate-flag">B=${a.b}</span><span class="gate-flag">F=${a.f}</span>`;
        html += `</div>`;
        html += `</div>`;
    }
    container.innerHTML = html;
}

function updateCRDisplay() {
    const container = document.getElementById('crRegs');
    if (!container) return;
    const localNames = {
        0: 'Result', 1: 'Arg 1', 6: 'C-List',
        12: 'Thread', 13: 'IRQ', 14: 'CLOOMC', 15: 'Namespace'
    };
    const crMeta = {
        0:  { group: 'gt',     role: 'arch',   badge: 'Arch'   },
        1:  { group: 'gt',     role: 'arch',   badge: 'Arch'   },
        2:  { group: 'gt',     role: 'prog',   badge: 'Prog'   },
        3:  { group: 'gt',     role: 'prog',   badge: 'Prog'   },
        4:  { group: 'gt',     role: 'prog',   badge: 'Prog'   },
        5:  { group: 'gt',     role: 'prog',   badge: 'Prog'   },
        6:  { group: 'gt',     role: 'arch',   badge: 'Arch'   },
        7:  { group: 'gt',     role: 'prog',   badge: 'Prog'   },
        8:  { group: 'gt',     role: 'prog',   badge: 'Prog'   },
        9:  { group: 'gt',     role: 'prog',   badge: 'Prog'   },
        10: { group: 'gt',     role: 'prog',   badge: 'Prog'   },
        11: { group: 'gt',     role: 'prog',   badge: 'Prog'   },
        12: { group: 'privil', role: 'privil', badge: 'Priv'   },
        13: { group: 'system', role: 'system', badge: 'System' },
        14: { group: 'privil', role: 'privil', badge: 'Priv'   },
        15: { group: 'privil', role: 'privil', badge: 'Priv'   },
    };
    const COLS = 14;
    let html = '<table class="cr-table"><thead><tr>';
    html += '<th>CR</th><th>M</th><th>Name</th><th>Role</th>';
    html += '<th>word0: GT</th><th>Perms</th><th>Seq</th><th>Idx</th><th>Type</th>';
    html += '<th>word1: Location</th>';
    html += '<th>W0:B</th><th>F</th><th>Limit[16:0]</th>';
    html += '<th>word3: Seq</th><th>CRC Seal</th>';
    html += '</tr></thead><tbody>';
    for (let i = 0; i < 16; i++) {
        if (i === 12) {
            html += `<tr class="cr-separator"><td colspan="${COLS + 1}">&#9472;&#9472; Not in GT zone &#9472;&#9472; CR12 Thread Identity (Priv) \u00b7 CR13 IRQ (System) \u00b7 CR14\u201315 Privileged &#9472;&#9472;</td></tr>`;
        }
        const cr = sim.getFormattedCR(i);
        const name = localNames[i] || '';
        const meta = crMeta[i];
        const nullCls = cr.isNull ? ' cr-null' : ' cr-active';
        const groupCls = meta.group === 'system' ? ' cr-system' : meta.group === 'privil' ? ' cr-privil' : (meta.role === 'arch' ? ' cr-arch' : '');
        const clickable = !cr.isNull ? ' cr-clickable' : '';
        html += `<tr class="${nullCls}${groupCls}${clickable}" ${!cr.isNull ? `onclick="openCRDetail(${i})"` : ''}>`;
        html += `<td class="cr-idx">${i}</td>`;
        html += `<td class="cr-m ${cr.mBit ? 'cr-m-set' : ''}">${cr.mBit}</td>`;
        html += `<td class="cr-name">${name}</td>`;
        html += `<td><span class="cr-role-badge cr-role-${meta.role}">${meta.badge}</span></td>`;
        html += `<td class="cr-gt">0x${cr.word0_gt}</td>`;
        html += `<td class="cr-perms">[${cr.perms}]</td>`;
        html += `<td>${cr.gtSeq}</td>`;
        html += `<td>${cr.gtIndex}</td>`;
        html += `<td class="cr-type">${cr.gtTypeName}</td>`;
        html += `<td>0x${cr.word1_location.toString(16).toUpperCase().padStart(8, '0')}</td>`;
        html += `<td class="cr-flag">${cr.limitB}</td>`;
        html += `<td class="cr-flag">${cr.limitF}</td>`;
        html += `<td>0x${cr.limit17.toString(16).toUpperCase().padStart(5, '0')}</td>`;
        html += `<td>${cr.sealGtSeq}</td>`;
        html += `<td>0x${cr.sealCRC.toString(16).toUpperCase().padStart(4, '0')}</td>`;
        html += '</tr>';
    }
    html += '</tbody></table>';
    container.innerHTML = html;
}

let selectedCR = null;

function openCRDetail(crIdx) {
    selectedCR = crIdx;
    crDetailTab = 'content';
    const detailTab = document.getElementById('dashTab-crdetail');
    if (detailTab) {
        const cr = sim.getFormattedCR(crIdx);
        const localNames = {
            0: 'Result', 1: 'Arg 1', 6: 'C-List',
            12: 'Thread', 13: 'IRQ', 14: 'CLOOMC', 15: 'Namespace'
        };
        const name = localNames[crIdx] || '';
        detailTab.textContent = `CR${crIdx}${name ? ' \u2014 ' + name : ''}`;
        detailTab.style.display = '';
    }
    switchDashTab('crdetail');
    updateCRDetail();
}

let crDetailTab = 'content';
let clistExpandedIdx = null;

function toggleCListEntry(nsIdx) {
    clistExpandedIdx = (clistExpandedIdx === nsIdx) ? null : nsIdx;
    updateCRDetail();
}

function renderCListEntryDetail(nsIdx, entry) {
    let h = '<div class="clist-detail">';
    const label = entry.label || `NS[${nsIdx}]`;
    h += `<div class="clist-detail-title">${label} \u2014 Namespace Entry ${nsIdx}</div>`;

    h += '<table class="cr-table" style="margin-bottom:0.5rem;"><tbody>';
    const loc = entry.word0_location >>> 0;
    const lim = sim.parseNSWord1(entry.word1_limit);
    const ver = (entry.word2_seals >>> 25) & 0x7F;
    const seal = entry.word2_seals & 0xFFFF;
    h += `<tr><td style="color:var(--church-blue);width:120px;">W0: Location</td><td>0x${loc.toString(16).toUpperCase().padStart(8,'0')}</td></tr>`;
    const typeNames = ['NULL','Inform','Outform','Abstract'];
    h += `<tr><td style="color:var(--church-blue)">W1: Type</td><td>${typeNames[entry.gtType] || '?'} (${entry.gtType})</td></tr>`;
    h += `<tr><td style="color:var(--church-blue)">W1: F (Far)</td><td>${lim.f}</td></tr>`;
    h += `<tr><td style="color:var(--church-blue)">W1: G (GC)</td><td>${entry.gBit}</td></tr>`;
    h += `<tr><td style="color:var(--church-blue)">W1: Chainable</td><td>${lim.chainable ? 'Yes' : 'No'}</td></tr>`;
    h += `<tr><td style="color:var(--church-blue)">W1: Limit</td><td>0x${lim.limit.toString(16).toUpperCase().padStart(5,'0')} (${lim.limit + 1} words)</td></tr>`;
    h += `<tr><td style="color:var(--church-blue)">W2: Version</td><td>${ver}</td></tr>`;
    h += `<tr><td style="color:var(--church-blue)">W2: CRC Seal</td><td>0x${seal.toString(16).toUpperCase().padStart(4,'0')}</td></tr>`;
    h += '</tbody></table>';

    const wordCount = lim.limit + 1;
    const isBootNS = (nsIdx === 0 && loc === sim.NS_TABLE_BASE);
    if (isBootNS) {
        h += '<div class="clist-detail-title" style="margin-top:0.4rem;">Namespace Table Entries</div>';
        h += renderMemoryDump(loc, lim.limit + 1, nsIdx);
    } else {
        // ── Read lump header at word 0 to derive layout (hardware-accurate) ─────────
        const hdrRaw  = (loc < sim.memory.length) ? (sim.memory[loc] >>> 0) : 0;
        const hdr     = sim.parseLumpHeader(hdrRaw);
        if (hdr.valid) {
            const cw        = hdr.cw;          // declared code word count
            const cc        = hdr.cc;          // c-list slot count
            const lumpSize  = hdr.lumpSize;    // physical slot size (2^(n_minus_6+6))
            const clistStart = lumpSize - cc;  // c-list at physical end
            const hdrHex    = '0x' + (hdrRaw >>> 0).toString(16).toUpperCase().padStart(8,'0');
            const typNames  = ['lump','data','Thread','Outform'];
            // ── Lump Header ──────────────────────────────────────────────────
            h += `<div class="clist-detail-title" style="margin-top:0.4rem;color:rgba(156,220,254,0.6);">Header`
               + ` <span style="font-size:0.72rem;color:#3f3f46;">word 0 \u00b7 ${hdrHex}`
               + ` \u00b7 magic=0x${hdr.magic.toString(16).toUpperCase()}`
               + ` \u00b7 n\u22126=${hdr.n_minus_6}\u2192${lumpSize}w`
               + ` \u00b7 cw=${cw} \u00b7 typ=${typNames[hdr.typ]||hdr.typ} \u00b7 cc=${cc}`
               + `</span></div>`;
            // ── CLOOMC Code (words 1..cw at loc+1..loc+cw) ──────────────────
            // Scan for the last non-zero instruction to separate code from trailing freespace.
            let actualCodeEnd = 0;
            for (let w = 0; w < cw; w++) {
                const codeAddr = loc + 1 + w;
                if (codeAddr < sim.memory.length && sim.memory[codeAddr]) actualCodeEnd = w + 1;
            }
            {
                const asm = new ChurchAssembler();
                const isEmpty = actualCodeEnd === 0;
                h += '<div class="clist-detail-title" style="margin-top:0.3rem;">CLOOMC Code';
                if (cw === 0) {
                    h += ' <span style="color:#555;font-size:0.72rem;">(cw=0 \u2014 no code region)</span></div>';
                } else {
                    if (isEmpty) h += ' <span style="color:#555;font-size:0.72rem;">(empty \u2014 not loaded)</span>';
                    h += '</div>';
                    // Always show all cw slots so the user sees the code region layout.
                    // Empty slots (word=0) are shown dimmed; loaded instructions are bright.
                    let codeHtml = '<table class="cr-table code-view-table"><thead><tr><th>Off</th><th>Addr</th><th>Hex</th><th>Decode</th></tr></thead><tbody>';
                    for (let w = 0; w < cw; w++) {
                        const addr = loc + 1 + w;
                        if (addr >= sim.memory.length) break;
                        const word = sim.memory[addr] >>> 0;
                        const decoded = word === 0 ? 'HALT' : asm.disassemble(word);
                        const isPC   = sim.bootComplete && (addr === (sim.memory[sim.NS_TABLE_BASE + 2 * sim.NS_ENTRY_WORDS] || (2 * sim.SLOT_SIZE)) + 1 + sim.pc);
                        const dimmed = word === 0 ? ' style="opacity:0.35;"' : '';
                        const pcMark = isPC ? ' class="code-pc-row"' : '';
                        codeHtml += `<tr${pcMark}${dimmed}>`;
                        codeHtml += `<td class="cr-idx">+${w + 1}</td>`;
                        codeHtml += `<td class="cr-idx">0x${addr.toString(16).toUpperCase().padStart(4,'0')}</td>`;
                        codeHtml += `<td class="cr-gt">0x${word.toString(16).toUpperCase().padStart(8,'0')}</td>`;
                        codeHtml += `<td class="code-disasm">${decoded}</td>`;
                        codeHtml += '</tr>';
                    }
                    codeHtml += '</tbody></table>';
                    h += codeHtml;
                }
            }
            // ── Freespace (words actualCodeEnd+1 .. clistStart-1 relative to word 1) ──
            // Freespace = gap between last instruction and c-list (from the code region's perspective).
            const totalFreeWords = clistStart - 1 - actualCodeEnd;  // words between last code and c-list
            if (totalFreeWords > 0) {
                const freeBase = loc + 1 + actualCodeEnd;
                const freeEnd  = loc + clistStart - 1;
                h += `<div class="clist-detail-title" style="margin-top:0.3rem;color:#52525b;">Freespace`
                   + ` <span style="font-size:0.72rem;color:#3f3f46;">`
                   + `words +${1 + actualCodeEnd}\u2013+${clistStart - 1}`
                   + ` \u00b7 ${totalFreeWords} unused words`
                   + ` \u00b7 0x${freeBase.toString(16).toUpperCase().padStart(4,'0')}\u20130x${freeEnd.toString(16).toUpperCase().padStart(4,'0')}`
                   + `</span></div>`;
            }
            // ── C-List (words lumpSize-cc .. lumpSize-1 at physical end) ─────
            h += `<div class="clist-detail-title" style="margin-top:0.4rem;">C-List (${cc} GT entries)</div>`;
            let gtHtml = '<table class="cr-table code-view-table"><thead><tr><th>#</th><th>Addr</th><th>Hex</th><th>GT Decoded</th></tr></thead><tbody>';
            for (let w = 0; w < cc; w++) {
                const addr = loc + clistStart + w;
                if (addr >= sim.memory.length) break;
                const word = sim.memory[addr] || 0;
                gtHtml += _renderGTRow(w, addr, word);
            }
            gtHtml += '</tbody></table>';
            h += gtHtml;
        } else {
            // No valid lump header — derive LUMP layout from NS entry fields
            const cc2        = lim.clistCount;
            const allocSize2 = lim.limit + 1;
            const clistStart2 = cc2 > 0 ? (allocSize2 - cc2) : allocSize2;
            const locHex2    = '0x' + loc.toString(16).toUpperCase().padStart(4,'0');
            const hdrHex2    = '0x' + (hdrRaw >>> 0).toString(16).toUpperCase().padStart(8,'0');
            // Header note
            h += `<div class="clist-detail-title" style="margin-top:0.4rem;color:rgba(156,220,254,0.35);">Header`;
            h += ` <span style="font-size:0.72rem;color:#3f3f46;">no lump header at ${locHex2}`;
            h += ` \u00b7 layout from NS entry \u00b7 alloc=${allocSize2}w \u00b7 cc=${cc2}</span></div>`;
            h += '<table class="cr-table code-view-table"><thead><tr><th>Off</th><th>Addr</th><th>Hex</th><th>Note</th></tr></thead><tbody>';
            h += `<tr style="opacity:0.3;"><td class="cr-idx">+0</td>`;
            h += `<td class="cr-idx">${locHex2}</td>`;
            h += `<td class="cr-gt">${hdrHex2}</td>`;
            h += `<td class="code-disasm" style="font-style:italic;color:#3f3f46;">(no lump header \u2014 raw word)</td></tr>`;
            h += '</tbody></table>';
            // Code section
            h += `<div class="clist-detail-title" style="margin-top:0.3rem;">CLOOMC Code`;
            if (clistStart2 === 0) {
                h += ' <span style="color:#555;font-size:0.72rem;">(no code region)</span>';
            }
            h += '</div>';
            if (clistStart2 > 0) {
                const asm2 = new ChurchAssembler();
                let codeHtml2 = '<table class="cr-table code-view-table"><thead><tr><th>Off</th><th>Addr</th><th>Hex</th><th>Decode</th></tr></thead><tbody>';
                for (let w = 0; w < clistStart2; w++) {
                    const addr = loc + w;
                    if (addr >= sim.memory.length) break;
                    const word = sim.memory[addr] >>> 0;
                    const decoded = word === 0 ? 'HALT' : asm2.disassemble(word);
                    const dimmed = word === 0 ? ' style="opacity:0.35;"' : '';
                    codeHtml2 += `<tr${dimmed}><td class="cr-idx">+${w}</td>`;
                    codeHtml2 += `<td class="cr-idx">0x${addr.toString(16).toUpperCase().padStart(4,'0')}</td>`;
                    codeHtml2 += `<td class="cr-gt">0x${word.toString(16).toUpperCase().padStart(8,'0')}</td>`;
                    codeHtml2 += `<td class="code-disasm">${decoded}</td></tr>`;
                }
                codeHtml2 += '</tbody></table>';
                h += codeHtml2;
            }
            // C-List section
            if (cc2 > 0) {
                h += `<div class="clist-detail-title" style="margin-top:0.4rem;">C-List (${cc2} GT entries)</div>`;
                let gtHtml2 = '<table class="cr-table code-view-table"><thead><tr><th>#</th><th>Addr</th><th>Hex</th><th>GT Decoded</th></tr></thead><tbody>';
                for (let w = 0; w < cc2; w++) {
                    const addr = loc + clistStart2 + w;
                    if (addr >= sim.memory.length) break;
                    const word = sim.memory[addr] || 0;
                    gtHtml2 += _renderGTRow(w, addr, word);
                }
                gtHtml2 += '</tbody></table>';
                h += gtHtml2;
            }
        }
    }

    h += '</div>';
    return h;
}

function switchCRDetailTab(tab) {
    crDetailTab = tab;
    document.querySelectorAll('.crd-tab').forEach(t => t.classList.remove('active'));
    const btn = document.getElementById('crdTab-' + tab);
    if (btn) btn.classList.add('active');
    document.querySelectorAll('.crd-panel').forEach(p => p.style.display = 'none');
    const panel = document.getElementById('crdPanel-' + tab);
    if (panel) panel.style.display = 'block';
}

function updateCRDetail() {
    if (selectedCR === null) return;
    const titleEl = document.getElementById('crDetailTitle');
    const contentEl = document.getElementById('crDetailContent');
    if (!titleEl || !contentEl) return;

    const crIdx = selectedCR;
    const cr = sim.getFormattedCR(crIdx);
    const localNames = {
        0: 'Result', 1: 'Arg 1', 6: 'C-List',
        12: 'Thread', 13: 'IRQ', 14: 'CLOOMC', 15: 'Namespace'
    };
    const name = localNames[crIdx] || '';

    if (cr.isNull) {
        titleEl.textContent = `CR${crIdx}${name ? ' \u2014 ' + name : ''} (NULL)`;
        contentEl.innerHTML = '<div style="color:var(--text-secondary);padding:1rem;">Register is empty (all words zero).</div>';
        return;
    }

    titleEl.innerHTML = `CR${crIdx}${name ? ' \u2014 <span style="color:var(--church-blue)">' + name + '</span>' : ''} <button class="btn btn-sm" onclick="switchDashTab(\'cr\')" style="margin-left:1rem;font-size:0.7rem;">\u2190 Back</button>`;

    const parsedPerms = sim.parseGT(sim.cr[crIdx].word0).permissions;
    const hasX = parsedPerms.X;
    const hasL = parsedPerms.L;
    const hasR = parsedPerms.R;
    const hasW = parsedPerms.W;
    const crMbit = sim.cr[crIdx].m;
    const nsIdx = cr.gtIndex;

    const codeRegs = [7];
    const clistRegs = [6];
    const threadRegs = [8, 12];
    const nsRegs = [15];
    const showCode = hasX || (crMbit && codeRegs.includes(crIdx));
    const showCList = hasL || (crMbit && clistRegs.includes(crIdx));
    const showThread = THREAD_NS_SLOTS.has(nsIdx) || (crMbit && threadRegs.includes(crIdx));
    const showNS = crMbit && nsRegs.includes(crIdx);
    const showData = (hasR || hasW) && !showCode && !showCList;

    let html = '';
    html += '<div class="crd-tabs">';
    html += `<button class="crd-tab${crDetailTab==='content'?' active':''}" id="crdTab-content" onclick="switchCRDetailTab('content')">Content</button>`;
    html += `<button class="crd-tab${crDetailTab==='register'?' active':''}" id="crdTab-register" onclick="switchCRDetailTab('register')">Register</button>`;
    html += `<button class="crd-tab${crDetailTab==='binary'?' active':''}" id="crdTab-binary" onclick="switchCRDetailTab('binary')">Binary</button>`;
    html += '</div>';

    html += `<div class="crd-panel" id="crdPanel-content" style="display:${crDetailTab==='content'?'block':'none'}">`;
    html += '<div class="cr-detail-grid">';

    if (showCode) {
        html += '<div class="cr-detail-section">';
        html += '<div class="cr-detail-heading">Code View \u2014 Executable Memory</div>';
        const baseLoc   = cr.word1_location >>> 0;
        const limitVal  = cr.limit17;
        const asm       = new ChurchAssembler();

        // Check if word 0 at baseLoc is a lump header (magic = 0x1F in top 5 bits).
        // If so, render it as a distinct header row and scan instructions from word +1.
        const word0 = (baseLoc < sim.memory.length) ? (sim.memory[baseLoc] >>> 0) : 0;
        const lumpHdr = sim.parseLumpHeader(word0);

        let codeStart = baseLoc;           // first instruction address
        let codeLimit = limitVal + 1;      // max words to scan (relative to codeStart)

        let codeHtml = '<table class="cr-table code-view-table"><thead><tr>';
        codeHtml += '<th>Addr</th><th>Hex</th><th>Instruction</th>';
        codeHtml += '</tr></thead><tbody>';

        if (lumpHdr.valid) {
            // Show the header word as a special non-instruction row
            const typNames  = ['lump', 'data', 'thread', 'outform'];
            const typStr    = typNames[lumpHdr.typ] || String(lumpHdr.typ);
            const hdrDisasm = `.header ${typStr} n\u22126=${lumpHdr.n_minus_6}\u2192${lumpHdr.lumpSize}w`
                            + ` cw=${lumpHdr.cw} cc=${lumpHdr.cc}`;
            codeHtml += `<tr style="opacity:0.55;font-style:italic;">`;
            codeHtml += `<td class="cr-idx">0x${baseLoc.toString(16).toUpperCase().padStart(4,'0')}</td>`;
            codeHtml += `<td class="cr-gt">0x${word0.toString(16).toUpperCase().padStart(8,'0')}</td>`;
            codeHtml += `<td class="code-disasm" style="color:var(--text-secondary);">${hdrDisasm}</td>`;
            codeHtml += '</tr>';
            // Instructions start at word +1, run for cw words
            codeStart = baseLoc + 1;
            codeLimit = lumpHdr.cw;
        }

        let hasCodeData = lumpHdr.valid;  // header row counts as "something shown"
        for (let w = 0; w < codeLimit; w++) {
            const addr = codeStart + w;
            if (addr >= sim.memory.length) break;
            const word = sim.memory[addr] >>> 0;
            if (word === 0 && !hasCodeData) continue;
            hasCodeData = true;
            // PC highlight: lump abstractions use word0+1+pc as fetch address
            const isPC    = lumpHdr.valid
                ? (addr === baseLoc + 1 + sim.pc)
                : ((addr === (sim.programBaseAddr || 0) + sim.pc) || (addr === sim.pc));
            const rowClass = isPC ? 'code-pc-row' : '';
            const decoded  = word === 0 ? 'NOP / HALT' : asm.disassemble(word);
            codeHtml += `<tr class="${rowClass}">`;
            codeHtml += `<td class="cr-idx">0x${addr.toString(16).toUpperCase().padStart(4,'0')}</td>`;
            codeHtml += `<td class="cr-gt">0x${word.toString(16).toUpperCase().padStart(8,'0')}</td>`;
            codeHtml += `<td class="code-disasm">${decoded}</td>`;
            codeHtml += '</tr>';
        }
        codeHtml += '</tbody></table>';

        if (!hasCodeData) {
            html += '<div style="color:var(--text-secondary);padding:0.5rem;">No code loaded in this memory range (0x' +
                baseLoc.toString(16).toUpperCase().padStart(4,'0') + ' \u2013 0x' +
                (baseLoc + limitVal).toString(16).toUpperCase().padStart(4,'0') + ').</div>';
        } else {
            if (lumpHdr.valid && codeLimit === 0) {
                // Header present but cw=0 — note it
                codeHtml = codeHtml.replace('</tbody>', `<tr><td colspan="3" style="color:#555;font-style:italic;padding:0.3rem 0.5rem;">` +
                    `(cw=0 \u2014 no instruction words in this lump)</td></tr></tbody>`);
            }
            html += codeHtml;
        }
        html += '</div>';
    }

    if (showCList) {
        html += '<div class="cr-detail-section">';
        html += '<div class="cr-detail-heading">C-List View \u2014 Capability Slots</div>';
        const clistBase = cr.word1_location >>> 0;
        const clistCount = cr.limit17 + 1;
        html += '<table class="cr-table"><thead><tr>';
        html += '<th>Slot</th><th>GT Word</th><th>NS Idx</th><th>Type</th><th>Perms</th><th>Label</th>';
        html += '</tr></thead><tbody>';
        for (let i = 0; i < clistCount; i++) {
            const addr = clistBase + i;
            const gtWord = (addr < sim.memory.length) ? (sim.memory[addr] >>> 0) : 0;
            const parsed = sim.parseGT(gtWord);
            const permsStr = Object.entries(parsed.permissions).filter(([,v]) => v).map(([k]) => k).join('');
            const nsLabel = (sim.nsLabels && sim.nsLabels[parsed.index]) ? sim.nsLabels[parsed.index] : '';
            const isExpanded = (clistExpandedIdx === i);
            const hasGT = gtWord !== 0;
            html += `<tr class="${hasGT ? 'cr-active clist-clickable' : ''}${isExpanded ? ' clist-selected' : ''}" `;
            html += hasGT ? `onclick="toggleCListEntry(${i})" title="Click to inspect NS[${parsed.index}]"` : '';
            html += '>';
            html += `<td class="cr-idx">${i}</td>`;
            html += `<td class="cr-gt">0x${gtWord.toString(16).toUpperCase().padStart(8,'0')}</td>`;
            html += `<td>${hasGT ? parsed.index : '\u2014'}</td>`;
            html += `<td>${hasGT ? parsed.typeName : '\u2014'}</td>`;
            html += `<td class="cr-perms">[${permsStr || '\u2014'}]</td>`;
            html += `<td class="cr-name">${nsLabel}</td>`;
            html += '</tr>';
            if (isExpanded && hasGT) {
                const nsEntry = sim.readNSEntry(parsed.index);
                if (nsEntry) {
                    html += `<tr class="clist-detail-row"><td colspan="6">${renderCListEntryDetail(parsed.index, nsEntry)}</td></tr>`;
                }
            }
        }
        html += '</tbody></table>';
        html += '</div>';
    }

    if (showThread) {
        html += '<div class="cr-detail-section">';
        html += renderThreadMemoryLayout(nsIdx);
        html += '</div>';
    }

    if (showNS) {
        html += '<div class="cr-detail-section">';
        html += '<div class="cr-detail-heading">Namespace Root \u2014 All Entries</div>';
        if (sim.nsCount === 0) {
            html += '<div style="color:var(--text-secondary);padding:0.5rem;">Namespace table is empty.</div>';
        } else {
            html += '<table class="cr-table"><thead><tr>';
            html += '<th>Idx</th><th>Label</th><th>W0: Location</th><th>W1: Type</th><th>W1: F</th><th>W1: G</th><th>W1: Chain</th>';
            html += '</tr></thead><tbody>';
            const typeNames = ['NULL','Inform','Outform','Abstract'];
            for (let i = 0; i < sim.nsCount; i++) {
                const e = sim.readNSEntry(i);
                if (!e) continue;
                const loc = e.word0_location >>> 0;
                html += '<tr class="cr-active">';
                html += `<td class="cr-idx">${i}</td>`;
                html += `<td class="cr-name">${e.label || ''}</td>`;
                html += `<td>0x${loc.toString(16).toUpperCase().padStart(8,'0')}</td>`;
                html += `<td>${typeNames[e.gtType] || '?'}</td>`;
                html += `<td class="cr-flag">${sim.parseNSWord1(e.word1_limit).f}</td>`;
                html += `<td class="cr-flag">${e.gBit}</td>`;
                html += `<td>${e.chainable ? 'Yes' : 'No'}</td>`;
                html += '</tr>';
            }
            html += '</tbody></table>';
        }
        html += '</div>';
    }

    if (showData) {
        const dataBase = cr.word1_location >>> 0;
        const dataLimit = cr.limit17;
        const wordCount = Math.min(dataLimit + 1, 64);
        const nsEntryD = sim.readNSEntry(nsIdx);
        const nsLabel = nsEntryD ? (nsEntryD.label || `NS[${nsIdx}]`) : `NS[${nsIdx}]`;
        const permDesc = [hasR ? 'R' : '', hasW ? 'W' : ''].filter(Boolean).join('|');

        const DEVICE_SLOTS = { 12: 'LED', 11: 'UART', 13: 'Button', 14: 'Timer' };
        const isDevice = nsIdx in DEVICE_SLOTS;

        html += '<div class="cr-detail-section">';
        html += `<div class="cr-detail-heading">Data View \u2014 ${nsLabel} (NS[${nsIdx}]) [${permDesc}]</div>`;

        html += '<table class="cr-table cr-detail-words"><tbody>';
        html += `<tr><td style="color:var(--church-blue)">Target</td><td>NS[${nsIdx}] \u2014 <strong>${nsLabel}</strong></td></tr>`;
        html += `<tr><td style="color:var(--church-blue)">Permissions</td><td class="cr-perms">[${permDesc}]</td></tr>`;
        html += `<tr><td style="color:var(--church-blue)">Base address</td><td>0x${dataBase.toString(16).toUpperCase().padStart(8,'0')}</td></tr>`;
        html += `<tr><td style="color:var(--church-blue)">Size</td><td>${wordCount} word${wordCount !== 1 ? 's' : ''} (limit ${dataLimit})</td></tr>`;
        if (isDevice) {
            html += `<tr><td style="color:var(--church-blue)">Kind</td><td style="color:var(--church-yellow)">Hardware Device \u2014 ${DEVICE_SLOTS[nsIdx]}</td></tr>`;
        }
        html += '</tbody></table>';

        if (isDevice && nsIdx === 12) {
            // LED_DEV: 5 registers (offset 0-4 = LED0-LED4); bit[0] = R (red) drives pin
            // Only bit[0] physically lights the LED on Ti60 F225 — bits[2:1] are G,B (wired but no pin)
            html += '<div class="cr-detail-heading" style="margin-top:0.75rem;">LED Registers</div>';
            html += '<table class="cr-table code-view-table" style="margin-bottom:0.3rem;">';
            html += '<thead><tr><th>Offset</th><th>Name</th><th>Hex</th><th>Pin</th></tr></thead><tbody>';
            for (let ledIdx = 0; ledIdx <= 4; ledIdx++) {
                const addr = dataBase + ledIdx;
                const val = (addr < sim.memory.length) ? (sim.memory[addr] >>> 0) : 0;
                const rBit = val & 1;  // bit[0] = R = drives LED pin
                const pinLabel = ledIdx <= 3 ? (rBit ? 'ON' : 'off') : (rBit ? 'ON (no pin)' : '—');
                const pinColor = (rBit && ledIdx <= 3) ? '#22ff44' : (rBit ? '#ffaa22' : 'var(--text-secondary)');
                html += `<tr>`;
                html += `<td class="cr-idx">+${ledIdx}</td>`;
                html += `<td>LED${ledIdx}</td>`;
                html += `<td class="cr-gt">0x${val.toString(16).toUpperCase().padStart(8,'0')}</td>`;
                html += `<td style="color:${pinColor};font-weight:${rBit?'bold':'normal'}">${pinLabel}</td>`;
                html += `</tr>`;
            }
            html += '</tbody></table>';
            html += '<div style="color:var(--text-secondary);font-size:0.72rem;padding-bottom:0.3rem;">bit[0]=R drives pin · bit[1]=G · bit[2]=B (Ti60: only R connected)</div>';
        }

        if (wordCount > 0 && nsIdx !== 12) {
            // LED device (nsIdx=12) already shows its registers in the LED Registers table above
            html += '<div class="cr-detail-heading" style="margin-top:0.75rem;">Memory Contents</div>';
            html += '<table class="cr-table code-view-table"><thead><tr><th>Addr</th><th>Hex</th><th>Dec</th></tr></thead><tbody>';
            for (let w = 0; w < wordCount; w++) {
                const addr = dataBase + w;
                if (addr >= sim.memory.length) break;
                const val = sim.memory[addr] >>> 0;
                html += '<tr>';
                html += `<td class="cr-idx">+${w}</td>`;
                html += `<td class="cr-gt">0x${val.toString(16).toUpperCase().padStart(8,'0')}</td>`;
                html += `<td>${val}</td>`;
                html += '</tr>';
            }
            html += '</tbody></table>';
        }
        html += '</div>';
    }

    if (!showCode && !showCList && !showThread && !showNS && !showData) {
        html += '<div class="cr-detail-section">';
        html += '<div class="cr-detail-heading">Capability Info</div>';
        html += '<div style="color:var(--text-secondary);padding:0.5rem;">GT permissions control visibility. This capability does not grant viewable access (no R, W, X, or L). Run boot sequence to populate registers.</div>';
        html += '</div>';
    }

    html += '</div></div>';

    html += `<div class="crd-panel" id="crdPanel-register" style="display:${crDetailTab==='register'?'block':'none'}">`;
    html += '<div class="cr-detail-grid">';

    html += '<div class="cr-detail-section">';
    html += '<div class="cr-detail-heading">128-bit Context Register Words</div>';
    html += '<table class="cr-table cr-detail-words"><thead><tr>';
    html += '<th>Word</th><th>Value</th><th>Decoded</th>';
    html += '</tr></thead><tbody>';
    html += `<tr><td>word0: GT</td><td class="cr-gt">0x${cr.word0_gt}</td><td>[${cr.perms}] Seq=${cr.gtSeq} Idx=${cr.gtIndex} Type=${cr.gtTypeName}</td></tr>`;
    html += `<tr><td>word1: Location</td><td>0x${cr.word1_location.toString(16).toUpperCase().padStart(8,'0')}</td><td>Base address in memory</td></tr>`;
    html += `<tr><td>word2: Limit</td><td>F=${cr.limitF} Limit=0x${cr.limit17.toString(16).toUpperCase().padStart(5,'0')}</td><td>Far=${cr.limitF} Size=${cr.limit17 + 1} words</td></tr>`;
    html += `<tr><td>word3: Seals</td><td>Seq=${cr.sealGtSeq} CRC=0x${cr.sealCRC.toString(16).toUpperCase().padStart(4,'0')}</td><td>Integrity seal (CRC-16/CCITT)</td></tr>`;
    html += `<tr><td>M bit</td><td class="${cr.mBit ? 'cr-m-set' : ''}">${cr.mBit}</td><td>${cr.mBit ? 'Written under M elevation (boot gift)' : 'Normal write'}</td></tr>`;
    html += '</tbody></table>';
    html += '</div>';

    const nsEntry = sim.readNSEntry(nsIdx);
    if (nsEntry) {
        const entry = nsEntry;
        html += '<div class="cr-detail-section">';
        html += `<div class="cr-detail-heading">Namespace Entry [${nsIdx}] \u2014 ${entry.label || 'unnamed'}</div>`;

        const loc = entry.word0_location >>> 0;
        const lim = sim.parseNSWord1(entry.word1_limit);
        const sealGtSeq = (entry.word2_seals >>> 25) & 0x7F;
        const sealCRC = entry.word2_seals & 0xFFFF;
        const gtPermStr = cr.perms;
        const typeNames = ['NULL','Inform','Outform','Abstract'];

        html += '<table class="cr-table"><tbody>';
        html += `<tr><td>W0: Location</td><td>0x${loc.toString(16).toUpperCase().padStart(8,'0')}</td></tr>`;
        html += `<tr><td>W1: Type</td><td>${typeNames[entry.gtType] || '?'}</td></tr>`;
        html += `<tr><td>W1: F (Far)</td><td>${lim.f}</td></tr>`;
        html += `<tr><td>W1: G (GC)</td><td>${entry.gBit}</td></tr>`;
        html += `<tr><td>W1: Chainable</td><td>${entry.chainable ? 'Yes' : 'No'}</td></tr>`;
        html += `<tr><td>W1: Limit</td><td>0x${lim.limit.toString(16).toUpperCase().padStart(5,'0')} (${lim.limit + 1} words)</td></tr>`;
        html += `<tr><td>W2: GT Seq</td><td>${sealGtSeq}</td></tr>`;
        html += `<tr><td>W2: CRC Seal</td><td>0x${sealCRC.toString(16).toUpperCase().padStart(4,'0')}</td></tr>`;
        html += `<tr><td>CR Permissions</td><td>[${gtPermStr}]</td></tr>`;
        if (entry.codeLength !== undefined) {
            html += `<tr><td>Code Length</td><td>${entry.codeLength} words (${entry.codeLength * 4} bytes)</td></tr>`;
        }
        html += '</tbody></table>';
        html += '</div>';
    }

    html += '</div></div>';

    html += `<div class="crd-panel" id="crdPanel-binary" style="display:${crDetailTab==='binary'?'block':'none'}">`;
    html += '<div class="cr-detail-grid">';
    html += '<div class="cr-detail-section">';
    html += '<div class="cr-detail-heading">Memory Image \u2014 Raw Binary Data</div>';
    const baseLoc2 = cr.word1_location >>> 0;
    const limitVal2 = cr.limit17;
    const dumpCount = Math.min(limitVal2 + 1, 256);
    let nonZeroCount = 0;
    for (let w = 0; w < dumpCount; w++) {
        if (baseLoc2 + w < sim.memory.length && sim.memory[baseLoc2 + w] !== 0) nonZeroCount++;
    }
    html += `<div style="color:var(--text-secondary);font-size:0.72rem;margin-bottom:0.5rem;">Address range: 0x${baseLoc2.toString(16).toUpperCase().padStart(4,'0')} \u2013 0x${(baseLoc2 + dumpCount - 1).toString(16).toUpperCase().padStart(4,'0')} | ${dumpCount} words | ${nonZeroCount} non-zero</div>`;
    html += '<div style="font-family:\'Courier New\',monospace;font-size:0.72rem;line-height:1.5;background:#0a0a1a;padding:0.75rem;border-radius:6px;overflow-x:auto;max-height:400px;overflow-y:auto;">';
    for (let row = 0; row < dumpCount; row += 8) {
        const addr = baseLoc2 + row;
        let line = `<span style="color:var(--church-blue);">${addr.toString(16).toUpperCase().padStart(4,'0')}</span>  `;
        let ascii = '';
        for (let col = 0; col < 8; col++) {
            const idx = row + col;
            if (idx < dumpCount && baseLoc2 + idx < sim.memory.length) {
                const w = sim.memory[baseLoc2 + idx];
                const color = w === 0 ? 'var(--text-secondary)' : 'var(--church-gold)';
                line += `<span style="color:${color};">${w.toString(16).toUpperCase().padStart(8,'0')}</span> `;
                for (let b = 3; b >= 0; b--) {
                    const byte = (w >>> (b * 8)) & 0xFF;
                    ascii += (byte >= 32 && byte < 127) ? String.fromCharCode(byte) : '.';
                }
            } else {
                line += '         ';
                ascii += '    ';
            }
        }
        line += ` <span style="color:var(--text-secondary);">|${ascii}|</span>`;
        html += line + '<br>';
    }
    html += '</div>';
    html += '</div>';
    html += '</div></div>';

    contentEl.innerHTML = html;
}

function updateDRDisplay() {
    const container = document.getElementById('drRegs');
    if (!container) return;
    let html = '';
    for (let i = 0; i < 16; i++) {
        const val = sim.dr[i];
        const special = i === 0 ? ' (zero)' : '';
        html += `<div class="reg-row ${val === 0 ? 'reg-null' : 'reg-active'}">`;
        html += `<span class="reg-label">DR${i.toString().padStart(2, ' ')}${special}</span>`;
        html += `<span class="reg-value">0x${(val >>> 0).toString(16).toUpperCase().padStart(8, '0')}</span>`;
        html += `<span class="reg-decimal">${val}</span>`;
        html += '</div>';
    }
    container.innerHTML = html;
}

function updateFlagsDisplay() {
    const container = document.getElementById('flagsDisplay');
    if (!container) return;
    const f = sim.flags;
    const bootLabel = !sim.bootComplete ? `BOOT ${sim.bootStep}/4` : '';
    const statusLabel = sim.halted ? 'HALTED' : (sim.bootComplete ? 'READY' : 'RESET');
    const cap = sim.lastCapability;
    let capHtml = '';
    if (cap) {
        const p = cap.perms;
        const gateNames = {L:'LOAD',S:'SAVE',E:'CALL',R:'DREAD',W:'DWRITE',X:'LAMBDA'};
        const gateName = gateNames[cap.op] || cap.op || 'mLoad';
        const req = cap.op;
        capHtml = `
        <span class="flags-sep"></span>
        <span class="cap-group-label">${gateName}</span>
        <span class="cap-bit ${p.R ? 'cap-on' : ''} ${req==='R' ? 'cap-req' : ''}">R</span>
        <span class="cap-bit ${p.W ? 'cap-on' : ''} ${req==='W' ? 'cap-req' : ''}">W</span>
        <span class="cap-bit ${p.X ? 'cap-on' : ''} ${req==='X' ? 'cap-req' : ''}">X</span>
        <span class="cap-sep">|</span>
        <span class="cap-bit ${p.L ? 'cap-on' : ''} ${req==='L' ? 'cap-req' : ''}">L</span>
        <span class="cap-bit ${p.S ? 'cap-on' : ''} ${req==='S' ? 'cap-req' : ''}">S</span>
        <span class="cap-bit ${p.E ? 'cap-on' : ''} ${req==='E' ? 'cap-req' : ''}">E</span>
        <span class="cap-sep">|</span>
        <span class="cap-bit ${cap.b ? 'cap-on cap-b' : ''}">B</span>
        <span class="cap-bit ${cap.f ? 'cap-on cap-f' : ''}">F</span>
        <span class="cap-bit ${cap.versionMatch ? 'cap-on cap-v' : 'cap-fail'}">V${cap.versionMatch ? '\u2713' : '\u2717'}</span>
        <span class="cap-label">${cap.label}</span>`;
    }
    container.innerHTML = `
        <span class="flags-sep"></span>
        <span class="flag ${f.N ? 'flag-set' : ''}">N</span>
        <span class="flag ${f.Z ? 'flag-set' : ''}">Z</span>
        <span class="flag ${f.C ? 'flag-set' : ''}">C</span>
        <span class="flag ${f.V ? 'flag-set' : ''}">V</span>
        <span class="flag-info">PC: ${sim.pc}</span>
        <span class="flag-info">Steps: ${sim.stepCount}</span>
        <span class="flag-info">Stack: ${sim.callStack.length}</span>
        <span class="flag-info">STO: ${sim.sto}</span>
        ${bootLabel ? `<span class="flag-info flag-boot">${bootLabel}</span>` : ''}
        <span class="flag-info">${statusLabel}</span>
        ${capHtml}
    `;
}

function updateInfoDisplay() {
    const container = document.getElementById('machineInfo');
    if (!container) return;
    container.innerHTML = `
        <div class="info-item"><span class="info-label">Architecture</span><span class="info-value">Church Machine (Church + Turing domains)</span></div>
        <div class="info-item"><span class="info-label">Church Opcodes</span><span class="info-value">10 (LOAD, SAVE, CALL, RETURN, CHANGE, SWITCH, TPERM, LAMBDA, ELOADCALL, XLOADLAMBDA)</span></div>
        <div class="info-item"><span class="info-label">Turing Opcodes</span><span class="info-value">10 (DREAD, DWRITE, BFEXT, BFINS, MCMP, IADD, ISUB, BRANCH, SHL, SHR) + shared RETURN</span></div>
        <div class="info-item"><span class="info-label">Instruction</span><span class="info-value">32-bit: opcode[5] | cond[4] | dst[4] | src[4] | imm[15]</span></div>
        <div class="info-item"><span class="info-label">Conditions</span><span class="info-value">16 ARM-style (EQ, NE, CS, CC, MI, PL, VS, VC, HI, LS, GE, LT, GT, LE, AL, NV)</span></div>
        <div class="info-item"><span class="info-label">Address Space</span><span class="info-value">Unified: Memory (0x00-FD) | Devices (0xFE) | Registers (0xFF) \u2014 all GT-protected</span></div>
        <div class="info-item"><span class="info-label">Golden Tokens</span><span class="info-value">32-bit: Version(7) | Index(17) | Perms(6) | Type(2)</span></div>
        <div class="info-item"><span class="info-label">Security Gates</span><span class="info-value">mLoad (R\u2192DREAD, W\u2192DWRITE, X\u2192LAMBDA, L\u2192LOAD, S\u2192SAVE, E\u2192CALL) + mSave (Version, Seal, Bounds, B-bit, F-bit)</span></div>
        <div class="info-item"><span class="info-label">Security Blocks</span><span class="info-value">Each abstraction is a security block with MTBF \u2014 Turing hidden inside Church-callable entries, CALL in, RETURN out, atomic</span></div>
        <div class="info-item"><span class="info-label">Abstraction Layers</span><span class="info-value">9 layers, ${abstractionRegistry ? abstractionRegistry.count() : 46} abstractions (Boot, System, Hardware, Math, Lambda Calculus, Social, IDE, Internet, GC)</span></div>
    `;
}

function setPipelineMode(mode) {
    if (pipelineViz) {
        pipelineViz._setMode(mode);
        pipelineViz.reset();
    }
    if (repl) {
        repl.setPipelineMode(mode);
    }
}

let nsExpandedSlot = -1;

function toggleNSDetail(idx) {
    nsExpandedSlot = (nsExpandedSlot === idx) ? -1 : idx;
    updateNamespace();
}

function _renderGTRow(idx, addr, word) {
    const hex = '0x' + (word >>> 0).toString(16).toUpperCase().padStart(8, '0');
    if (word === 0) {
        return `<tr><td style="color:rgba(200,155,60,0.7);">${idx}</td><td>0x${addr.toString(16).toUpperCase().padStart(4,'0')}</td><td style="color:rgba(206,145,120,0.6);">${hex}</td><td><span style="color:#666;">0 (empty)</span></td></tr>`;
    }
    const p = sim.parseGT(word);
    const permStr = (p.permissions.B ? 'B' : '-') + (p.permissions.R ? 'R' : '-') + (p.permissions.W ? 'W' : '-') + (p.permissions.X ? 'X' : '-') + (p.permissions.L ? 'L' : '-') + (p.permissions.S ? 'S' : '-') + (p.permissions.E ? 'E' : '-');
    const label = sim.nsLabels[p.index] || '';
    let decoded = `<span style="color:rgba(78,201,176,0.7);">${p.typeName}</span>`;
    decoded += ` <span style="color:rgba(200,155,60,0.55);">[${permStr}]</span>`;
    decoded += ` \u2192 idx <span style="color:rgba(86,156,214,0.7);">${p.index}</span>`;
    if (label) decoded += ` <span style="color:rgba(156,220,254,0.6);">(${label})</span>`;
    decoded += ` seq${p.gt_seq}`;
    return `<tr><td style="color:rgba(200,155,60,0.7);">${idx}</td><td>0x${addr.toString(16).toUpperCase().padStart(4,'0')}</td><td style="color:rgba(206,145,120,0.6);">${hex}</td><td>${decoded}</td></tr>`;
}

function _bootHtmlEsc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function renderBootNSImage() {
    const typeColors = ['#6b7280','#60a5fa','#c084fc','#34d399'];
    const typeNames  = ['NULL','Inform','Outform','Abstract'];

    let html = '<div class="boot-image-view">';

    // ── Header ────────────────────────────────────────────────────────────
    html += '<div class="boot-image-header">Boot ROM Image — Boot.NS (Slot 0)</div>';
    html += '<div class="boot-image-subtitle">Content below is hardwired at design time and frozen into the FPGA BRAM / SPI-flash bitstream.</div>';

    // ── Section 1: Boot Microcode ──────────────────────────────────────────
    html += '<div class="boot-section-label">① Boot Microcode &nbsp;<span class="boot-section-note">6 steps · hardwired state machine · not stored as code words in RAM</span></div>';
    html += '<div class="boot-microcode">';
    for (const code of Object.values(BOOT_SEQ_CODE)) {
        for (const raw of code.split('\n')) {
            const line = raw;
            if (line.trim() === '') {
                html += '<div class="boot-code-blank"></div>';
            } else if (line.trim().startsWith(';')) {
                html += `<div class="boot-code-comment">${_bootHtmlEsc(line)}</div>`;
            } else if (/^\s*B:\d+/.test(line)) {
                const m = line.match(/^(\s*B:\d+\s+\S+)(.*)/);
                if (m) html += `<div class="boot-code-step"><span class="boot-step-kw">${_bootHtmlEsc(m[1])}</span>${_bootHtmlEsc(m[2])}</div>`;
                else    html += `<div class="boot-code-step">${_bootHtmlEsc(line)}</div>`;
            } else {
                html += `<div class="boot-code-body">${_bootHtmlEsc(line)}</div>`;
            }
        }
        html += '<div class="boot-code-blank"></div>';
    }
    html += '</div>';

    // ── Section 2: NS Table ────────────────────────────────────────────────
    const nsWords = sim.nsCount * sim.NS_ENTRY_WORDS;
    html += `<div class="boot-section-label">② NS Table &nbsp;<span class="boot-section-note">at 0x${sim.NS_TABLE_BASE.toString(16).toUpperCase().padStart(4,'0')} · ${sim.nsCount} entries × 3 words = ${nsWords} words (${nsWords*4} bytes)</span></div>`;
    html += '<table class="ns-mem-table boot-ns-table"><thead><tr>';
    html += '<th>Entry</th><th>Label</th><th>W0 · Base Addr</th><th>W1 · Type / Flags / Limit</th><th>W2 · Ver · CRC</th><th>C-list</th>';
    html += '</tr></thead><tbody>';
    for (let i = 0; i < sim.nsCount; i++) {
        const base  = sim.NS_TABLE_BASE + i * sim.NS_ENTRY_WORDS;
        const w0    = sim.memory[base]     || 0;
        const w1    = sim.memory[base + 1] || 0;
        const w2    = sim.memory[base + 2] || 0;
        const p     = sim.parseNSWord1(w1);
        const ver   = (w2 >>> 25) & 0x7F;
        const seal  = w2 & 0xFFFF;
        const label = sim.nsLabels[i] || '-';
        const tName = typeNames[p.gtType] || '?';
        const tCol  = typeColors[p.gtType] || '#888';
        const empty = (w0 === 0 && w1 === 0 && w2 === 0);
        const flags = (p.f ? ' F' : '') + (p.b ? ' B' : '') + (p.g ? ' G' : '') + (p.chainable ? ' Chain' : '');
        html += `<tr${empty ? ' style="opacity:0.28;"' : ''}>`;
        html += `<td class="boot-ns-idx">NS[${i}]</td>`;
        html += `<td class="boot-ns-label">${_bootHtmlEsc(label)}</td>`;
        html += `<td class="boot-ns-addr">0x${(w0>>>0).toString(16).toUpperCase().padStart(4,'0')}</td>`;
        html += `<td style="color:${tCol};font-family:monospace;font-size:0.75rem;">${tName}${flags} · Lim=0x${p.limit.toString(16).toUpperCase().padStart(4,'0')} (${p.limit+1}w)</td>`;
        html += `<td style="color:#71717a;font-family:monospace;font-size:0.73rem;">v${ver} · CRC=0x${seal.toString(16).toUpperCase().padStart(4,'0')}</td>`;
        html += `<td style="color:#f59e0b;font-size:0.73rem;">${p.clistCount ? p.clistCount + ' GT' + (p.clistCount!==1?'s':'') : ''}</td>`;
        html += '</tr>';
    }
    html += '</tbody></table>';

    // ── Section 3: Boot.Abstr C-list ──────────────────────────────────────
    const slot2Entry = sim.readNSEntry(2);
    if (slot2Entry) {
        // Derive layout from lump header at word 0 (hardware-accurate)
        const s2loc      = slot2Entry.word0_location;
        const s2hdrWord  = (s2loc < sim.memory.length) ? (sim.memory[s2loc] >>> 0) : 0;
        const s2hdr      = sim.parseLumpHeader(s2hdrWord);
        const s2lim      = sim.parseNSWord1(slot2Entry.word1_limit);
        const clistCount = s2hdr.valid ? s2hdr.cc : (s2lim.clistCount || 0);
        const lumpSzB    = s2hdr.valid ? s2hdr.lumpSize : (sim.SLOT_SIZE || 64);
        const clistStart = lumpSzB - clistCount;  // c-list at physical end
        const clistBase  = s2loc + clistStart;
        html += `<div class="boot-section-label">③ Boot.Abstr C-list &nbsp;<span class="boot-section-note">at 0x${clistBase.toString(16).toUpperCase().padStart(4,'0')} · ${clistCount} capability entries · one GT per NS slot</span></div>`;
        html += '<table class="ns-mem-table boot-clist-table"><thead><tr>';
        html += '<th>#</th><th>Addr</th><th>GT Word (32-bit)</th><th>Slot</th><th>Label</th><th>Perms</th><th>Type</th>';
        html += '</tr></thead><tbody>';
        for (let i = 0; i < clistCount; i++) {
            const addr   = clistBase + i;
            const gtWord = sim.memory[addr] || 0;
            const addrHex = '0x' + addr.toString(16).toUpperCase().padStart(4,'0');
            const gtHex   = '0x' + (gtWord>>>0).toString(16).toUpperCase().padStart(8,'0');
            if (gtWord === 0) {
                html += `<tr style="opacity:0.3;"><td style="color:#888">${i}</td><td>${addrHex}</td><td style="font-family:monospace;">${gtHex}</td><td colspan="4" style="color:#555;">NULL — Slot 3 (reserved empty)</td></tr>`;
                continue;
            }
            const gt       = sim.parseGT(gtWord);
            const slotLabel= sim.nsLabels[gt.index] || '-';
            const perms    = gt.permissions;
            const permStr  = Object.entries(perms).filter(([,v])=>v).map(([k])=>k).join('') || 'none';
            const tCol     = typeColors[gt.type] || '#888';
            html += '<tr>';
            html += `<td style="color:rgba(200,155,60,0.8);font-size:0.73rem;">${i}</td>`;
            html += `<td style="font-family:monospace;color:#525252;font-size:0.73rem;">${addrHex}</td>`;
            html += `<td style="font-family:monospace;color:rgba(206,145,120,0.85);font-size:0.73rem;">${gtHex}</td>`;
            html += `<td style="color:#f59e0b;font-size:0.73rem;">${gt.index}</td>`;
            html += `<td style="color:#93c5fd;font-style:italic;font-size:0.73rem;">${_bootHtmlEsc(slotLabel)}</td>`;
            html += `<td style="color:#4ade80;font-family:monospace;font-size:0.73rem;">${permStr}</td>`;
            html += `<td style="color:${tCol};font-size:0.73rem;">${gt.typeName}</td>`;
            html += '</tr>';
        }
        html += '</tbody></table>';
    }

    html += '</div>';
    return html;
}

// Thread slot layout constants (words within a 256-word slot)
// Word 0 is the lump header (0xF900_020C: magic=0x1F, n-6=2, cw=0, typ=10, cc=12).
// Physical layout (word 0 at top, word 255 at bottom):
//   +0          Lump Header  (1 word)
//   +1  … +16   Zone ⑤ Data Registers — DR0..DR15  (16 words)
//   +17 … +80   Zone ④ Heap ↑ — fixed size, grows upward  (64 words)
//   +81 … +211  Zone ③ Freespace — dynamic gap  (131 words)
//   +212 … +243 Zone ② LIFO Stack ↓ — STO initial = 212  (32 words)
//   +244 … +255 Zone ① Capabilities — CR0..CR11 GT Word 0; c-list tail  (12 words)
const THREAD_LAYOUT = {
    HEADER_WORD:  0,
    THREAD_HEADER: 0xF900_020C,
    DR_START:     1,   DR_END:     16,  DR_WORDS:     16,
    HEAP_START:  17,   HEAP_END:   80,  HEAP_WORDS:   64,
    FREE_START:  81,   FREE_END:  211,  FREE_WORDS:  131,
    STACK_START: 212,  STACK_END: 243,  STACK_WORDS:  32,
    CAPS_START:  244,  CAPS_END:  255,  CAPS_WORDS:   12,
    TOTAL:      256,
};
const THREAD_NS_SLOTS = new Set([1, 45]);

function renderThreadMemoryLayout(nsIndex) {
    const entry = sim.readNSEntry(nsIndex);
    const slotBase = entry ? entry.word0_location : (nsIndex * sim.SLOT_SIZE);
    const label = sim.nsLabels[nsIndex] || ('Slot ' + nsIndex);
    const TL = THREAD_LAYOUT;

    const secHdr = (num, title, note, color) =>
        `<div class="thread-zone-hdr" style="border-left-color:${color};">${num} ${title}<span class="thread-zone-note">${note}</span></div>`;

    const addrOf = (off) => '0x' + (slotBase + off).toString(16).toUpperCase().padStart(4, '0');
    const hexOf  = (w)   => '0x' + (w >>> 0).toString(16).toUpperCase().padStart(8, '0');

    let html = '<div class="thread-layout-view">';

    // Header
    html += `<div class="thread-layout-header">${label} — Thread Memory Layout<span style="color:#6b7280;font-weight:400;font-size:0.75rem;margin-left:0.6rem;">NS Slot ${nsIndex} · base ${addrOf(0)} · 256 words (1 024 bytes)</span></div>`;

    // ── Word 0: Lump Header ───────────────────────────────────────────────
    const headerWord = sim.memory[slotBase + TL.HEADER_WORD] || TL.THREAD_HEADER;
    html += secHdr('', 'Lump Header', 'word 0 · magic=0x1F · n-6=2 (256w) · cw=0 · typ=10 (clist-only) · cc=12', '#94a3b8');
    html += `<div style="font-family:monospace;font-size:0.78rem;color:#94a3b8;padding:0.3rem 0.6rem 0.5rem;border-left:2px solid #334155;">`;
    html += `<span style="color:#555;">+0 &nbsp;${addrOf(0)} &nbsp;</span>`;
    html += `<span style="color:rgba(206,145,120,0.9);">${hexOf(headerWord)}</span>`;
    html += ` &nbsp;<span style="color:#64748b;">0xF900_020C — never executed · traps if PC reaches word 0</span>`;
    html += `</div>`;

    // ── Zone ⑤: Data Registers (+1 … +16) ───────────────────────────────────
    html += secHdr('⑤', 'Data Registers', '16 words · DR0–DR15 · offset +1 … +16 · head of the slot (after header)', '#a855f7');
    html += '<table class="ns-mem-table thread-zone-table"><thead><tr><th>DR</th><th>Offset</th><th>Addr</th><th>Value (hex)</th><th>Value (dec)</th></tr></thead><tbody>';
    for (let i = 0; i < TL.DR_WORDS; i++) {
        const off  = TL.DR_START + i;
        const word = sim.memory[slotBase + off] || 0;
        const rowStyle = word ? '' : ' style="opacity:0.28;"';
        html += `<tr${rowStyle}><td style="color:#a855f7;">DR${i}</td><td style="color:#555;">+${off}</td><td style="font-family:monospace;">${addrOf(off)}</td><td style="color:#c084fc;font-family:monospace;">${hexOf(word)}</td><td style="color:#9ca3af;">${word >>> 0}</td></tr>`;
    }
    html += '</tbody></table>';

    // ── Zone ④: Heap (+17 … +80) ─────────────────────────────────────────
    let heapNonZero = 0;
    for (let i = TL.HEAP_START; i <= TL.HEAP_END; i++) {
        if (sim.memory[slotBase + i]) heapNonZero++;
    }
    html += secHdr('④', 'Heap ↑', `64 words · offset +17 … +80 · base ${addrOf(TL.HEAP_START)} · ${heapNonZero} word${heapNonZero!==1?'s':''} allocated`, '#22c55e');
    html += '<table class="ns-mem-table thread-zone-table"><thead><tr><th>Off</th><th>Addr</th><th>Hex</th><th>Decoded</th></tr></thead><tbody>';
    for (let i = 0; i < TL.HEAP_WORDS; i++) {
        const off  = TL.HEAP_START + i;
        const word = sim.memory[slotBase + off] || 0;
        const rowStyle = word ? '' : ' style="opacity:0.22;"';
        const decoded  = word ? `<span style="color:#9ca3af;">0x${word.toString(16).toUpperCase().padStart(8,'0')}</span>` : '<span style="color:#374151;">free</span>';
        html += `<tr${rowStyle}><td style="color:#22c55e;">+${off}</td><td style="font-family:monospace;">${addrOf(off)}</td><td style="color:rgba(206,145,120,0.8);font-family:monospace;">${hexOf(word)}</td><td>${decoded}</td></tr>`;
    }
    html += '</tbody></table>';

    // ── Zone ③: Freespace (+81 … +211) ───────────────────────────────────
    let freeNonZero = 0;
    for (let i = TL.FREE_START; i <= TL.FREE_END; i++) {
        if (sim.memory[slotBase + i]) freeNonZero++;
    }
    html += secHdr('③', 'Freespace', `131 words · offset +81 … +211 · ${freeNonZero} non-zero · shrinks as stack grows ↓ and heap grows ↑`, '#6b7280');
    if (freeNonZero === 0) {
        html += '<div class="thread-free-empty">All 131 words are zero — region is unallocated.</div>';
    } else {
        html += '<table class="ns-mem-table thread-zone-table"><thead><tr><th>Off</th><th>Addr</th><th>Hex</th><th>Note</th></tr></thead><tbody>';
        for (let i = TL.FREE_START; i <= TL.FREE_END; i++) {
            const word = sim.memory[slotBase + i] || 0;
            if (!word) continue;
            html += `<tr><td style="color:#6b7280;">+${i}</td><td style="font-family:monospace;">${addrOf(i)}</td><td style="color:rgba(206,145,120,0.8);font-family:monospace;">${hexOf(word)}</td><td style="color:#4b5563;">non-zero</td></tr>`;
        }
        html += '</tbody></table>';
    }

    // ── Zone ②: LIFO Stack (+212 … +243) ─────────────────────────────────
    const stackWords = sim.memory.slice(slotBase + TL.STACK_START, slotBase + TL.STACK_END + 1);
    const stackUsed  = stackWords.filter(Boolean).length;
    html += secHdr('②', 'LIFO Stack ↓', `32 words · STO starts at 212 · first CALL: words 211–210 · offset +212 … +243 · ${stackUsed} word${stackUsed!==1?'s':''} non-zero`, '#38bdf8');
    html += '<table class="ns-mem-table thread-zone-table"><thead><tr><th>Off</th><th>Addr</th><th>Hex</th><th>Decoded</th></tr></thead><tbody>';
    for (let i = 0; i < TL.STACK_WORDS; i++) {
        const off  = TL.STACK_START + i;
        const word = sim.memory[slotBase + off] || 0;
        const hex  = hexOf(word);
        let decoded;
        if (word === 0) {
            decoded = '<span style="color:#374151;">empty</span>';
        } else {
            const gt = sim.parseGT(word);
            if (gt.type !== 0) {
                const perms = Object.entries(gt.permissions).filter(([,v])=>v).map(([k])=>k).join('') || 'none';
                const lbl = sim.nsLabels[gt.index] || '';
                decoded = `GT → <span style="color:#38bdf8;">${gt.typeName}</span> Slot=${gt.index}${lbl?' <i style="color:#93c5fd;">('+lbl+')</i>':''} [${perms}]`;
            } else {
                decoded = `<span style="color:#9ca3af;">frame word = 0x${word.toString(16).toUpperCase().padStart(8,'0')}</span>`;
            }
        }
        const rowStyle = word ? '' : ' style="opacity:0.25;"';
        html += `<tr${rowStyle}><td style="color:#38bdf8;">+${off}</td><td style="font-family:monospace;">${addrOf(off)}</td><td style="color:rgba(206,145,120,0.85);font-family:monospace;">${hex}</td><td>${decoded}</td></tr>`;
    }
    html += '</tbody></table>';

    // ── Zone ①: Capabilities (+244 … +255) ───────────────────────────────
    html += secHdr('①', 'Capabilities', `12 words · CR0–CR11 · offset +244 … +255 · c-list tail · saved/restored on context switch`, '#f4b942');
    html += '<table class="ns-mem-table thread-zone-table"><thead><tr><th>CR</th><th>Offset</th><th>Addr</th><th>Hex</th><th>Decoded (GT)</th></tr></thead><tbody>';
    for (let i = 0; i < TL.CAPS_WORDS; i++) {
        const off  = TL.CAPS_START + i;
        const word = sim.memory[slotBase + off] || 0;
        const hex  = hexOf(word);
        let decoded;
        if (word === 0) {
            decoded = '<span style="color:#4b5563;">NULL</span>';
        } else {
            const gt = sim.parseGT(word);
            const perms = Object.entries(gt.permissions).filter(([,v])=>v).map(([k])=>k).join('') || 'none';
            const lbl = sim.nsLabels[gt.index] || '';
            decoded = `<span style="color:#60a5fa;">${gt.typeName}</span> Slot=${gt.index}${lbl ? ' <i style="color:#93c5fd;">('+lbl+')</i>' : ''} p=[${perms}] seq${gt.gt_seq}`;
        }
        html += `<tr><td style="color:#f4b942;">CR${i}</td><td style="color:#555;">+${off}</td><td style="font-family:monospace;">${addrOf(off)}</td><td style="color:rgba(206,145,120,0.9);font-family:monospace;">${hex}</td><td>${decoded}</td></tr>`;
    }
    html += '</tbody></table>';

    html += '</div>';
    return html;
}

function renderMemoryDump(location, limit, nsIndex) {
    if (nsIndex === 0) return renderBootNSImage();
    if (THREAD_NS_SLOTS.has(nsIndex)) return renderThreadMemoryLayout(nsIndex);

    const wordCount = limit;
    if (wordCount <= 0) return '<span style="color:#888;">Empty (limit=0)</span>';

    let html = '<table class="ns-mem-table"><thead><tr>';
    html += '<th>Offset</th><th>Address</th><th>Hex</th><th>Decoded</th>';
    html += '</tr></thead><tbody>';

    {
        // ── Read lump header at word 0 to derive layout (hardware-accurate) ──────
        const hdrWord    = (location < sim.memory.length) ? (sim.memory[location] >>> 0) : 0;
        const hdr        = sim.parseLumpHeader(hdrWord);
        if (hdr.valid) {
            const cw         = hdr.cw;
            const cc         = hdr.cc;
            const lumpSize   = hdr.lumpSize;
            const clistStart = lumpSize - cc;  // c-list at physical end
            const hdrHex     = '0x' + (hdrWord >>> 0).toString(16).toUpperCase().padStart(8, '0');
            const hdrAddrHex = '0x' + location.toString(16).toUpperCase().padStart(4, '0');
            const typNames   = ['lump','data','Thread','Outform'];
            const nsEntry    = sim.readNSEntry(nsIndex);
            const lumpVer    = nsEntry ? ((nsEntry.word2_seals >>> 25) & 0x7F) : 0;
            const lumpSeal   = nsEntry ? (nsEntry.word2_seals & 0xFFFF) : 0;
            const lumpNote   = `magic=0x${hdr.magic.toString(16).toUpperCase()}`
                             + ` \u00b7 n\u22126=${hdr.n_minus_6}\u2192${lumpSize}w`
                             + ` \u00b7 cw=${cw} \u00b7 typ=${typNames[hdr.typ]||hdr.typ} \u00b7 cc=${cc}`
                             + ` \u00b7 ver=${lumpVer} \u00b7 CRC=0x${lumpSeal.toString(16).toUpperCase().padStart(4,'0')}`;
            // ── Lump Header row ────────────────────────────────────────────────
            html = `<div style="color:rgba(156,220,254,0.5);font-size:0.75rem;padding:0.15rem 0.5rem;margin-top:0.2rem;">Header`
                 + ` <span style="color:#3f3f46;font-size:0.72rem;">word 0 of lump \u00b7 ${lumpNote}</span></div>`;
            html += '<table class="ns-mem-table"><thead><tr>'
                  + '<th>Offset</th><th>Address</th><th>Hex</th><th>Note</th>'
                  + '</tr></thead><tbody>';
            html += `<tr style="background:rgba(56,189,248,0.04);">`
                  + `<td style="color:#38bdf8;">+0</td>`
                  + `<td style="font-family:monospace;">${hdrAddrHex}</td>`
                  + `<td style="font-family:monospace;color:rgba(206,145,120,0.7);">${hdrHex}</td>`
                  + `<td style="color:#60a5fa;font-size:0.72rem;">${lumpNote}</td>`
                  + `</tr>`;
            html += '</tbody></table>';
            // ── CLOOMC Code (words 1..cw, skip header at word 0) ──────────────
            html += '<div style="color:rgba(156,220,254,0.7);font-size:0.75rem;padding:0.15rem 0.5rem;margin-top:0.2rem;">CLOOMC Code</div>';
            html += '<table class="ns-mem-table"><thead><tr><th>Offset</th><th>Address</th><th>Hex</th><th>Decoded</th></tr></thead><tbody>';
            var asm = new ChurchAssembler();
            for (let i = 0; i < cw; i++) {
                const addr = location + 1 + i;
                if (addr >= sim.memory.length) break;
                const word = sim.memory[addr] || 0;
                const hex = '0x' + (word >>> 0).toString(16).toUpperCase().padStart(8, '0');
                let decoded = word === 0 ? '<span style="color:#666;">0 (empty)</span>' : asm.disassemble(word);
                const addrHex = '0x' + addr.toString(16).toUpperCase().padStart(4, '0');
                html += `<tr><td style="color:#666;">+${1 + i}</td><td>${addrHex}</td><td style="color:rgba(206,145,120,0.6);">${hex}</td><td>${decoded}</td></tr>`;
            }
            html += '</tbody></table>';
            // ── Freespace (words cw+1 .. clistStart-1, between code end and c-list) ──
            const freeStart = 1 + cw;
            const freeCount = clistStart - freeStart;
            if (freeCount > 0) {
                const freeBaseAbs = location + freeStart;
                const freeEndAbs  = location + clistStart - 1;
                html += `<div style="color:rgba(113,113,122,0.7);font-size:0.75rem;padding:0.15rem 0.5rem;margin-top:0.3rem;">Freespace`
                      + ` <span style="color:#3f3f46;font-size:0.72rem;">`
                      + `words +${freeStart}\u2013+${clistStart - 1}`
                      + ` \u00b7 ${freeCount} words`
                      + ` \u00b7 0x${freeBaseAbs.toString(16).toUpperCase().padStart(4,'0')}\u20130x${freeEndAbs.toString(16).toUpperCase().padStart(4,'0')}`
                      + `</span></div>`;
                html += '<table class="ns-mem-table"><thead><tr>'
                      + '<th>Offset</th><th>Address</th><th>Hex</th><th>Note</th>'
                      + '</tr></thead><tbody>';
                for (let i = 0; i < freeCount; i++) {
                    const off     = freeStart + i;
                    const addr    = location + off;
                    const addrHex = '0x' + addr.toString(16).toUpperCase().padStart(4, '0');
                    const word    = (addr < sim.memory.length) ? (sim.memory[addr] || 0) : 0;
                    const hexW    = '0x' + (word >>> 0).toString(16).toUpperCase().padStart(8, '0');
                    html += `<tr style="opacity:0.28;">`
                          + `<td style="color:#3f3f46;">+${off}</td>`
                          + `<td style="font-family:monospace;color:#3f3f46;">${addrHex}</td>`
                          + `<td style="font-family:monospace;color:#3f3f46;">${hexW}</td>`
                          + `<td style="color:#3f3f46;font-style:italic;font-size:0.72rem;">freespace</td>`
                          + `</tr>`;
                }
                html += '</tbody></table>';
            }
            // ── C-List (words clistStart..lumpSize-1, at physical end) ─────────
            html += '<div style="color:rgba(200,155,60,0.7);font-size:0.75rem;padding:0.15rem 0.5rem;margin-top:0.3rem;">C-List (' + cc + ' GT entries)</div>';
            html += '<table class="ns-mem-table"><thead><tr><th>#</th><th>Address</th><th>Hex</th><th>GT Decoded</th></tr></thead><tbody>';
            for (let i = 0; i < cc; i++) {
                const addr = location + clistStart + i;
                if (addr >= sim.memory.length) break;
                const word = sim.memory[addr] || 0;
                html += _renderGTRow(i, addr, word);
            }
            html += '</tbody></table>';
            return html;
        } else {
            // No valid lump header — derive LUMP layout from NS entry metadata
            const nsEntry2  = sim.readNSEntry(nsIndex);
            const lim2      = nsEntry2 ? sim.parseNSWord1(nsEntry2.word1_limit) : null;
            if (lim2 && lim2.limit > 0) {
                const cc2        = lim2.clistCount;
                const allocSize2 = lim2.limit + 1;
                const clistStart2 = cc2 > 0 ? (allocSize2 - cc2) : allocSize2;
                const lumpVer2   = (nsEntry2.word2_seals >>> 25) & 0x7F;
                const lumpSeal2  = nsEntry2.word2_seals & 0xFFFF;
                const locHex2    = '0x' + location.toString(16).toUpperCase().padStart(4, '0');
                const hdrHex2    = '0x' + (hdrWord >>> 0).toString(16).toUpperCase().padStart(8, '0');

                html  = `<div style="color:rgba(156,220,254,0.3);font-size:0.75rem;padding:0.15rem 0.5rem;margin-top:0.2rem;">Header`;
                html += ` <span style="color:#3f3f46;font-size:0.72rem;">no lump header at ${locHex2}`;
                html += ` \u00b7 layout from NS entry \u00b7 alloc=${allocSize2}w \u00b7 cc=${cc2}`;
                html += ` \u00b7 ver=${lumpVer2} \u00b7 CRC=0x${lumpSeal2.toString(16).toUpperCase().padStart(4,'0')}</span></div>`;
                html += '<table class="ns-mem-table"><thead><tr><th>Offset</th><th>Address</th><th>Hex</th><th>Note</th></tr></thead><tbody>';
                html += `<tr style="opacity:0.3;">`;
                html += `<td style="color:#3f3f46;">+0</td>`;
                html += `<td style="font-family:monospace;color:#3f3f46;">${locHex2}</td>`;
                html += `<td style="font-family:monospace;color:#3f3f46;">${hdrHex2}</td>`;
                html += `<td style="color:#3f3f46;font-style:italic;font-size:0.72rem;">(no lump header \u2014 raw word)</td>`;
                html += `</tr></tbody></table>`;

                html += `<div style="color:rgba(156,220,254,0.7);font-size:0.75rem;padding:0.15rem 0.5rem;margin-top:0.2rem;">CLOOMC Code`;
                html += ` <span style="color:#3f3f46;font-size:0.72rem;">words +0\u2013+${clistStart2 > 0 ? clistStart2-1 : 0} \u00b7 ${clistStart2} words</span></div>`;
                html += '<table class="ns-mem-table"><thead><tr><th>Offset</th><th>Address</th><th>Hex</th><th>Decoded</th></tr></thead><tbody>';
                var asm2 = new ChurchAssembler();
                for (let i = 0; i < clistStart2; i++) {
                    const addr = location + i;
                    if (addr >= sim.memory.length) break;
                    const word = sim.memory[addr] || 0;
                    const hex = '0x' + (word >>> 0).toString(16).toUpperCase().padStart(8, '0');
                    const decoded = word === 0 ? '<span style="color:#666;">0 (empty)</span>' : asm2.disassemble(word);
                    const addrHex = '0x' + addr.toString(16).toUpperCase().padStart(4, '0');
                    html += `<tr><td style="color:#666;">+${i}</td><td>${addrHex}</td><td style="color:rgba(206,145,120,0.6);">${hex}</td><td>${decoded}</td></tr>`;
                }
                html += '</tbody></table>';

                if (cc2 > 0) {
                    html += `<div style="color:rgba(200,155,60,0.7);font-size:0.75rem;padding:0.15rem 0.5rem;margin-top:0.3rem;">C-List (${cc2} GT entries)</div>`;
                    html += '<table class="ns-mem-table"><thead><tr><th>#</th><th>Address</th><th>Hex</th><th>GT Decoded</th></tr></thead><tbody>';
                    for (let i = 0; i < cc2; i++) {
                        const addr = location + clistStart2 + i;
                        if (addr >= sim.memory.length) break;
                        const word = sim.memory[addr] || 0;
                        html += _renderGTRow(i, addr, word);
                    }
                    html += '</tbody></table>';
                }

                return html;
            }
            // Fallback: last resort plain hex dump
            var asm = new ChurchAssembler();
            for (let i = 0; i < wordCount; i++) {
                const addr = location + i;
                const word = sim.memory[addr] || 0;
                const hex = '0x' + (word >>> 0).toString(16).toUpperCase().padStart(8, '0');
                let decoded = word === 0 ? '<span style="color:#666;">0 (empty)</span>' : asm.disassemble(word);
                const addrHex = '0x' + addr.toString(16).toUpperCase().padStart(4, '0');
                html += `<tr><td style="color:#666;">+${i}</td><td>${addrHex}</td><td style="color:rgba(206,145,120,0.6);">${hex}</td><td>${decoded}</td></tr>`;
            }
        }
    }
    html += '</tbody></table>';
    return html;
}

function updateNamespace() {
    const container = document.getElementById('namespaceTable');
    if (!container) return;
    let html = '<div class="ns-layout-header">NS_ENTRY_LAYOUT: 3 words per entry (96 bits) \u2014 click a row to inspect memory</div>';
    html += '<table class="ns-table"><thead><tr>';
    html += '<th>Idx</th><th class="ns-label-col">Label</th>';
    html += '<th>W0: Location</th>';
    html += '<th>W1: Type</th><th>W1: F</th><th>W1: G</th><th>W1: Limit</th>';
    html += '<th>W2: Seq</th><th>W2: CRC Seal</th>';
    html += '<th>Actions</th>';
    html += '</tr></thead><tbody>';

    const typeNames = ['NULL','Inform','Outform','Abstract'];
    for (let i = 0; i < sim.nsCount; i++) {
        const e = sim.readNSEntry(i);
        if (!e) continue;
        const lim = sim.parseNSWord1(e.word1_limit);
        const ver = (e.word2_seals >>> 25) & 0x7F;
        const seal = e.word2_seals & 0xFFFF;
        const isExpanded = (nsExpandedSlot === i);
        html += `<tr class="ns-row${isExpanded ? ' ns-row-active' : ''}" onclick="toggleNSDetail(${i})" style="cursor:pointer;">`;
        html += `<td>${i}</td>`;
        html += `<td class="ns-label" onmouseenter="showNSEntryTooltip(event,${i})" onmouseleave="hideNSEntryTooltip()">${e.label || '-'}</td>`;
        html += `<td>0x${e.word0_location.toString(16).toUpperCase().padStart(8, '0')}</td>`;
        html += `<td>${typeNames[e.gtType] || '?'}</td>`;
        html += `<td class="ns-flag">${lim.f}</td>`;
        html += `<td class="ns-flag">${e.gBit}</td>`;
        html += `<td>0x${lim.limit.toString(16).toUpperCase().padStart(5, '0')}</td>`;
        html += `<td>${ver}</td>`;
        html += `<td>0x${seal.toString(16).toUpperCase().padStart(4, '0')}</td>`;
        html += `<td class="ns-entry-actions"><button class="btn btn-primary btn-xs" onclick="event.stopPropagation();exportEntryMemory(${i})">Export</button> <button class="btn btn-xs" onclick="event.stopPropagation();importEntryMemory(${i})" style="background:#3a86ff;color:#fff;border:none;">Import</button></td>`;
        html += '</tr>';
        if (isExpanded) {
            html += `<tr class="ns-detail-row"><td colspan="10">`;
            html += `<div class="ns-detail-panel">`;
            html += `<div class="ns-detail-title">Memory at 0x${e.word0_location.toString(16).toUpperCase().padStart(4, '0')} \u2014 ${e.label || 'Slot '+i} (${lim.limit + 1} words)</div>`;
            html += renderMemoryDump(e.word0_location, lim.limit + 1, i);
            html += `</div></td></tr>`;
        }
    }
    html += '</tbody></table>';
    container.innerHTML = html;
}

function _getNSEntryTooltipEl() {
    let el = document.getElementById('nsEntryTooltip');
    if (!el) {
        el = document.createElement('div');
        el.id = 'nsEntryTooltip';
        el.className = 'ns-entry-tooltip';
        document.body.appendChild(el);
    }
    return el;
}

function showNSEntryTooltip(evt, idx) {
    const tt = _getNSEntryTooltipEl();
    const e = sim.readNSEntry(idx);
    if (!e) { tt.classList.remove('visible'); return; }

    const lim = sim.parseNSWord1(e.word1_limit);
    const typeNames = ['NULL','Inform','Outform','Abstract'];
    const badgeClass = ['ns-tt-badge-null','ns-tt-badge-inform','ns-tt-badge-outform','ns-tt-badge-abstract'];
    const typeName = typeNames[lim.gtType] || '?';
    const ver = (e.word2_seals >>> 25) & 0x7F;
    const seal = e.word2_seals & 0xFFFF;
    const sizeWords = lim.limit + 1;
    const sizeBytes = sizeWords * 4;

    let absMatch = null;
    if (abstractionRegistry && typeof abstractionRegistry.getAbstraction === 'function') {
        absMatch = abstractionRegistry.getAbstraction(idx);
    }

    let html = `<div class="ns-tt-header">Slot ${idx}<span class="ns-tt-badge ${badgeClass[lim.gtType]}">${typeName}</span></div>`;
    if (e.label) html += `<div class="ns-tt-label">"${e.label}"</div>`;
    if (absMatch) {
        const absName = absMatch.name || '';
        const absLayer = absMatch.layer != null ? ` · Layer ${absMatch.layer}` : '';
        const absMethods = Array.isArray(absMatch.methods) ? absMatch.methods : [];
        html += `<div class="ns-tt-abs-name">${absName}<span style="color:#9ca3af;font-weight:400;font-size:0.7rem;">${absLayer}</span></div>`;
        if (absMatch.description) {
            const d = absMatch.description;
            html += `<div style="color:#9ca3af;font-size:0.72rem;margin-bottom:0.25rem;">${d.slice(0,100)}${d.length > 100 ? '…' : ''}</div>`;
        }
        if (absMethods.length) {
            html += `<div style="color:#6b7280;font-size:0.7rem;margin-bottom:0.2rem;">${absMethods.length} method${absMethods.length !== 1 ? 's' : ''}: <span style="color:#c084fc;">${absMethods.slice(0,5).join(', ')}${absMethods.length > 5 ? ', …' : ''}</span></div>`;
        }
        html += '<hr class="ns-tt-divider">';
    }
    html += `<div class="ns-tt-row"><b>Address</b> 0x${e.word0_location.toString(16).toUpperCase().padStart(8,'0')}</div>`;
    html += `<div class="ns-tt-row"><b>Size</b> ${sizeWords} word${sizeWords !== 1 ? 's' : ''} &nbsp;(${sizeBytes} bytes)</div>`;
    html += `<div class="ns-tt-row"><b>Version</b> ${ver} &nbsp;&nbsp;<b style="margin-left:0.6rem">CRC</b> 0x${seal.toString(16).toUpperCase().padStart(4,'0')}</div>`;
    if (e.clistCount) html += `<div class="ns-tt-row"><b>C-list</b> ${e.clistCount} entr${e.clistCount !== 1 ? 'ies' : 'y'}</div>`;
    const flags = [];
    if (lim.f) flags.push('<span class="ns-tt-flag">F Far/Tunnel</span>');
    if (lim.b) flags.push('<span class="ns-tt-flag">B</span>');
    if (e.gBit) flags.push('<span class="ns-tt-flag">G GC-live</span>');
    if (e.chainable) flags.push('<span class="ns-tt-flag">Chainable</span>');
    if (flags.length) html += `<div class="ns-tt-row" style="flex-wrap:wrap;gap:4px;"><b>Flags</b> ${flags.join(' ')}</div>`;

    tt.innerHTML = html;
    tt.classList.add('visible');
    _positionNSTooltip(tt, evt);
}

function _positionNSTooltip(tt, evt) {
    const margin = 12;
    tt.style.left = '0px'; tt.style.top = '0px';
    const tw = tt.offsetWidth || 260;
    const th = tt.offsetHeight || 140;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = evt.clientX + margin;
    let y = evt.clientY - th / 2;
    if (x + tw > vw - 8) x = evt.clientX - tw - margin;
    if (y < 8) y = 8;
    if (y + th > vh - 8) y = vh - th - 8;
    tt.style.left = x + 'px';
    tt.style.top  = y + 'px';
}

function hideNSEntryTooltip() {
    const tt = document.getElementById('nsEntryTooltip');
    if (tt) tt.classList.remove('visible');
}

let selectedAbsIndex = null;
let absCollapsedLayers = {};
let userMethodData = {};
let userMethodLists = {};

// ── Boot Sequence Code ─────────────────────────────────────────────────────
// Actual hardware boot steps that install each Layer-0 abstraction.
// Mirrors simulator.js _bootStep() exactly.
const BOOT_SEQ_CODE = {
    0: [
        '; Boot.NS — Namespace Root (Slot 0)',
        '',
        'B:00  FAULT_RST',
        '      CR0–CR15  ← NULL          ; all capability registers cleared',
        '      DR0–DR15  ← 0             ; all data registers zeroed',
        '      M-Elevation ← ON          ; hardware supervisor mode enabled',
        '',
        'B:01  LOAD_NS',
        '      GT15 ← createGT(Slot=0, perms=[none], type=Inform)',
        '      entry ← mLoad(GT15)       ; load NS table entry for Slot 0',
        '      CR15 ← { word0=GT15, word1=base=0x0000,',
        '               word2=NS_TABLE_BASE, word3=seals }',
        '      ; CR15 = Namespace root — full memory view, no user perms',
    ].join('\n'),

    1: [
        '; Boot.Thread — Initial Thread Identity (Slot 1)',
        '',
        'B:02  INIT_THRD',
        '      GT12 ← createGT(Slot=1, perms=[none], type=Inform)',
        '      entry ← mLoad(GT12)       ; load NS table entry for Slot 1',
        '      CR12 ← { word0=GT12, word1=entry.base,',
        '               word2=entry.word1_limit, word3=entry.seals }',
        '      ; CR12 = Thread identity — Priv zone, zero perms',
        '      ; Informs-only: cannot be used for direct CALL',
    ].join('\n'),

    2: [
        '; Boot.Abstr — Boot Code + C-List in one NS slot (Slot 2)',
        '',
        '; ━━━ B:03 INIT_ABSTR ⬤ LOAD_NUC ⬤ COMPLETE — indivisible microprogram step ━━━',
        'B:03  INIT_ABSTR',
        '      GT6a ← createGT(Slot=2, perms=[E], type=Inform)',
        '      entry ← mLoad(GT6a, perm=E)   ; must have E permission',
        '      CR6  ← GT6a + entry            ; temporary E-GT for invocation',
        '      ; — atomically continues into LOAD_NUC —',
        '      LOAD_NUC',
        '      GT2  ← createGT(Slot=2, perms=[E], type=Inform)',
        '      entry ← mLoad(GT2, perm=E)',
        '      ; Validate: F-bit must=0 (Near), type must=Inform',
        '      base  = entry.word0_location',
        '      alloc = entry.word1_limit + 1',
        '      cN    = entry.clistCount       ; words allocated for c-list',
        '      cStart = alloc − cN            ; c-list starts here',
        '      CR14 ← { GT2, base=base,   limit=cStart-1, perms=[R,W,X] }',
        '      CR6  ← { GT2, base=base+cStart, limit=cN-1, perms=[L]    }',
        '      PC   ← 0                       ; enter Boot.Abstr code',
        '      ; — atomically continues into COMPLETE —',
        '      COMPLETE',
        '      M-Elevation ← OFF',
        '      bootComplete ← true',
        '      ; All Layer 0–1 abstractions now initialized',
        '; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
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
    // Boot.NS (0), Boot.Thread (1), Boot.Abstr (2) — already installed in NS table
    absImplStatus['abs:0'] = 'installed';
    absImplStatus['abs:1'] = 'installed';
    absImplStatus['abs:2'] = 'installed';
    // GC (44) has a live JavaScript handler in simulator.js
    for (const m of ['Scan', 'Identify', 'Clear', 'Flip']) {
        absImplStatus[`44:${m}`] = 'js';
    }
    _implStatusSave();
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

function renderAbstractions() {
    if (!abstractionRegistry) return;
    const listEl = document.getElementById('absLayerList');
    if (!listEl) return;

    const layerNames = abstractionRegistry.getLayerNames();
    let html = _implLegendHtml();

    for (let layer = 0; layer <= 8; layer++) {
        const abstractions = abstractionRegistry.getLayer(layer);
        if (!abstractions || abstractions.length === 0) continue;
        const layerName = layerNames[layer] || `Layer ${layer}`;
        const isCollapsed = absCollapsedLayers[layer] === true;

        html += `<div class="abs-layer-group">`;
        html += `<div class="abs-layer-header" onclick="toggleAbsLayer(${layer})">`;
        html += `<span class="abs-layer-arrow">${isCollapsed ? '\u25b6' : '\u25bc'}</span>`;
        html += `<span class="abs-layer-title">Layer ${layer} \u2014 ${layerName}</span>`;
        html += `<span class="abs-layer-count">(${abstractions.length})</span>`;
        html += `</div>`;

        if (!isCollapsed) {
            html += `<div class="abs-layer-items">`;
            for (const abs of abstractions) {
                const isActive = selectedAbsIndex === abs.index;
                const best = _implStatusBest(abs);
                const dotColor = IMPL_STATUS_COLORS[best] || '#9ca3af';
                const dotTitle = IMPL_STATUS_LABELS[best] || best;
                html += `<div class="abs-item${isActive ? ' active' : ''}" onclick="showAbstractionDetail(${abs.index})">`;
                html += `<span class="abs-item-idx">${abs.index}</span>`;
                html += `<span class="abs-item-name">${abs.name}</span>`;
                html += `<span class="abs-item-dot" style="background:${dotColor};box-shadow:0 0 4px ${dotColor}80" title="${dotTitle}"></span>`;
                html += `<span class="abs-item-desc">${abs.description}</span>`;
                html += `</div>`;
            }
            html += `</div>`;
        }

        html += `</div>`;
    }

    listEl.innerHTML = html;
}

function toggleAbsLayer(layer) {
    absCollapsedLayers[layer] = !absCollapsedLayers[layer];
    renderAbstractions();
}

function showAbstractionDetail(index) {
    selectedAbsIndex = index;
    renderAbstractions();

    if (!abstractionRegistry) return;
    const abs = abstractionRegistry.getAbstraction(index);
    if (!abs) return;

    const titleEl = document.getElementById('absDetailTitle');
    const contentEl = document.getElementById('absDetailContent');
    if (!titleEl || !contentEl) return;

    const layerNames = abstractionRegistry.getLayerNames();
    const layerName = layerNames[abs.layer] || `Layer ${abs.layer}`;
    titleEl.textContent = `${abs.name} \u2014 Abstraction ${abs.index}`;

    const p = abs.perms || {};
    const permStr = (p.B?'B':'')+(p.R?'R':'')+(p.W?'W':'')+(p.X?'X':'')+(p.L?'L':'')+(p.S?'S':'')+(p.E?'E':'') || 'none';

    let html = '';

    html += '<div class="abs-detail-section">';
    html += `<div class="abs-detail-badge layer-${abs.layer}">Layer ${abs.layer} \u2014 ${layerName}</div>`;
    html += `<div class="abs-detail-desc">${abs.description}</div>`;
    html += '</div>';

    {
        const methodPurposes = getMethodPurposes(abs);
        const methodExamples = getMethodExamples(abs);
        const methods = (abs.methods && abs.methods.length > 0) ? abs.methods : [];
        const uid = abs.index;
        html += '<div class="abs-detail-section abs-methods-section">';
        html += '<div class="abs-detail-label">Methods</div>';
        if (methods.length === 0) {
            html += '<div class="abs-method-empty">No methods registered \u2014 CALL enters the abstraction directly.</div>';
            const absLvlStatus = _implStatusGet(`abs:${uid}`);
            const absStatusOpts = IMPL_STATUS_LEVELS.map(s =>
                `<option value="${s}"${s === absLvlStatus ? ' selected' : ''}>${IMPL_STATUS_LABELS[s]}</option>`
            ).join('');
            html += `<div class="abs-method-tabs abs-method-tabs-empty" style="display:flex;align-items:center;gap:6px;margin-top:4px">`;
            html += `<span style="font-size:0.65rem;color:var(--text-secondary)">Status:</span>`;
            html += `<select class="impl-status-select impl-status-${absLvlStatus}" title="Abstraction implementation status" onchange="_implStatusSet('abs:${uid}',this.value);showAbstractionDetail(${uid})">${absStatusOpts}</select>`;
            html += `<button class="btn abs-method-ctrl-btn" title="Add method" onclick="absShowAddForm(${uid})">+</button>`;
            html += '</div>';
        } else {
            html += `<div class="abs-method-tabs" id="abs-tabs-${uid}">`;
            for (let mi = 0; mi < methods.length; mi++) {
                const m = methods[mi];
                const active = mi === 0 ? ' abs-method-tab-active' : '';
                const mStatus = _implStatusGet(`${uid}:${m}`);
                const badgeLabel = IMPL_STATUS_SHORT[mStatus] || mStatus;
                html += `<span class="abs-method-tab${active}" onclick="absSelectMethod(this,'abs-panel-${uid}-${mi}')">`;
                html += `${m}`;
                html += `<span class="abs-method-status-badge abs-method-status-badge-${mStatus}" onclick="event.stopPropagation();absToggleStatusDropdown(${uid},${mi},event)" title="Status: ${IMPL_STATUS_LABELS[mStatus]} — click to change">`;
                html += `<span class="abs-method-status-badge-dot"></span>${badgeLabel}`;
                html += `</span>`;
                html += `</span>`;
            }
            html += `<span class="abs-method-tab-spacer"></span>`;
            html += `<button class="btn abs-method-ctrl-btn" title="Add method" onclick="absShowAddForm(${uid})">+</button>`;
            html += `<button class="btn abs-method-ctrl-btn abs-method-del-ctrl" title="Delete method" onclick="absShowDeleteForm(${uid})">\u2212</button>`;
            html += '</div>';
            html += `<div class="abs-method-panels" id="abs-panels-${uid}">`;
            for (let mi = 0; mi < methods.length; mi++) {
                const m = methods[mi];
                const purpose = methodPurposes[m] || 'Dispatched via CALL';
                const example = methodExamples[m] || null;
                const display = mi === 0 ? '' : ' style="display:none"';
                html += `<div class="abs-method-panel-item" id="abs-panel-${uid}-${mi}"${display}>`;
                html += `<div class="abs-method-panel-header">`;
                html += `<div class="abs-method-panel-name">${abs.name}.${m}</div>`;
                html += `<button class="btn abs-method-ctrl-btn abs-method-edit-btn" title="Edit method" onclick="absShowEditForm(${uid},${mi})">&#9998;</button>`;
                html += `</div>`;
                html += `<div class="abs-method-panel-desc">${purpose}</div>`;
                if (example) {
                    html += `<pre class="abs-method-panel-code">${example}</pre>`;
                }
                html += '</div>';
            }
            html += '</div>';
        }
        html += `<div class="abs-method-form-container" id="abs-form-${uid}"></div>`;
        html += '</div>';
    }

    const _methods = (abs.methods && abs.methods.length > 0) ? abs.methods : [];
    if (BOOT_SEQ_CODE[abs.index] !== undefined && _methods.length === 0) {
        html += '<div class="abs-detail-section abs-boot-code-section">';
        html += '<div class="abs-detail-label">Boot Sequence Code</div>';
        html += '<div class="abs-boot-code-desc">Installed implementation \u2014 executed by the STEP controller at power-on reset. Mirrors <code>_bootStep()</code> in simulator.js exactly.</div>';
        html += `<pre class="abs-method-panel-code abs-boot-code-pre">${BOOT_SEQ_CODE[abs.index]}</pre>`;
        html += '</div>';
    }

    html += '<div class="abs-detail-section">';
    html += '<div class="abs-detail-label">Properties</div>';
    html += '<table class="abs-props-table"><tbody>';
    html += `<tr><td>Index</td><td>${abs.index}</td></tr>`;
    html += `<tr><td>Name</td><td>${abs.name}</td></tr>`;
    html += `<tr><td>Layer</td><td>${abs.layer} \u2014 ${layerName}</td></tr>`;
    html += `<tr><td>Permissions</td><td>[${permStr}]</td></tr>`;
    html += `<tr><td>Chainable</td><td>${abs.chainable ? 'Yes' : 'No'}</td></tr>`;
    if (abs.handler) {
        html += `<tr><td>Handler</td><td>${abs.handler}</td></tr>`;
    }
    const faults = abs.faultCount || 0;
    const mtbf = (abstractionRegistry && faults > 0) ? abstractionRegistry.getMTBF(abs.index) : Infinity;
    const mtbfStr = mtbf === Infinity ? '\u221e (no faults)' : `${(mtbf / 1000).toFixed(1)}s`;
    html += `<tr><td>Fault Count</td><td>${faults}</td></tr>`;
    html += `<tr><td>MTBF</td><td>${mtbfStr}</td></tr>`;
    html += '</tbody></table>';
    html += '</div>';

    html += '<div class="abs-detail-section">';
    html += '<div class="abs-detail-label">CR6/CR14 Canonical Form</div>';
    html += '<div class="abs-canonical">';
    html += '<div class="abs-canonical-diagram">';
    html += `<div class="abs-cr-box cr6-box">`;
    html += `<div class="abs-cr-label">CR6 (C-List)</div>`;
    html += `<div class="abs-cr-content">GT \u2192 NS[${abs.index}]</div>`;
    html += `<div class="abs-cr-perms">[E] Enter permission</div>`;
    html += `</div>`;
    html += `<div class="abs-cr-arrow">\u2192 CALL \u2192</div>`;
    html += `<div class="abs-cr-box cr7-box">`;
    html += `<div class="abs-cr-label">CR14 (CLOOMC)</div>`;
    html += `<div class="abs-cr-content">Code at NS[${abs.index}].location</div>`;
    html += `<div class="abs-cr-perms">[X] Execute permission</div>`;
    html += `</div>`;
    html += '</div>';
    html += '</div>';
    html += '</div>';

    if (abs.doc) {
        html += '<div class="abs-detail-section abs-doc-section">';
        html += '<div class="abs-doc-label">Self-Documentation</div>';
        if (abs.doc.author) html += `<div class="abs-doc-field"><strong>Author:</strong> ${abs.doc.author}</div>`;
        if (abs.doc.date) html += `<div class="abs-doc-field"><strong>Date:</strong> ${abs.doc.date}</div>`;
        if (abs.doc.languageLabel) html += `<div class="abs-doc-field"><strong>Language:</strong> ${abs.doc.languageLabel}</div>`;
        if (abs.doc.description) html += `<div class="abs-doc-field"><strong>Description:</strong> ${abs.doc.description}</div>`;
        if (abs.doc.tags && abs.doc.tags.length > 0) html += `<div class="abs-doc-field"><strong>Tags:</strong> ${abs.doc.tags.join(', ')}</div>`;
        if (abs.doc.methods && abs.doc.methods.length > 0) {
            html += '<div class="abs-doc-field"><strong>Method Signatures:</strong></div>';
            for (const m of abs.doc.methods) {
                const params = m.params && m.params.length > 0 ? `(${m.params.join(', ')})` : '()';
                html += `<div class="abs-doc-field" style="padding-left:1rem;">${m.name}${params} — ${m.instructions} instruction${m.instructions !== 1 ? 's' : ''}</div>`;
            }
        }
        html += '</div>';
    }

    if (abs.layer === 7) {
        html += '<div class="abs-detail-section abs-note-security">';
        html += '<div class="abs-detail-label">Internet Security Model</div>';
        html += '<div class="abs-note-text">Layer 7 abstractions use L (Load) permission for accessing remote resources. ';
        html += 'The F-bit (Far) on namespace entries routes access through encrypted capability tunnels. ';
        html += 'All Internet abstractions require parent-approved contact lists \u2014 children can only reach ';
        html += 'endpoints whose GTs appear in their c-list. No ambient authority, no URLs, no DNS \u2014 ';
        html += 'only capabilities.</div>';
        html += '</div>';
    }

    if (abs.layer === 5) {
        html += '<div class="abs-detail-section abs-note-security">';
        html += '<div class="abs-detail-label">Namespace Isolation</div>';
        html += '<div class="abs-note-text">Layer 5 social abstractions operate within isolated namespaces. ';
        html += 'Each child\'s social interactions are mediated through CALL/RETURN \u2014 the abstraction ';
        html += 'receives only the capabilities explicitly passed by the caller. Parent oversight is ';
        html += 'enforced via the Family abstraction (NS[28]) which must approve all social connections. ';
        html += 'SWITCH instruction can move between namespace domains atomically.</div>';
        html += '</div>';
    }

    contentEl.innerHTML = html;
}

function absSelectMethod(tabEl, panelId) {
    const tabsContainer = tabEl.parentElement;
    tabsContainer.querySelectorAll('.abs-method-tab').forEach(t => t.classList.remove('abs-method-tab-active'));
    tabEl.classList.add('abs-method-tab-active');
    const panelsContainer = tabsContainer.nextElementSibling;
    if (panelsContainer) {
        panelsContainer.querySelectorAll('.abs-method-panel-item').forEach(p => p.style.display = 'none');
    }
    const panel = document.getElementById(panelId);
    if (panel) panel.style.display = '';
}

function absShowAddForm(absIdx) {
    const fc = document.getElementById(`abs-form-${absIdx}`);
    if (!fc) return;
    if (fc.dataset.mode === 'add') { fc.innerHTML = ''; fc.dataset.mode = ''; return; }
    fc.dataset.mode = 'add';
    fc.innerHTML = `
<div class="abs-method-form">
  <div class="abs-method-form-title">Add Method</div>
  <label class="abs-method-form-label">Method name</label>
  <input class="abs-method-form-input" id="abs-add-name-${absIdx}" type="text" placeholder="e.g. Run" spellcheck="false">
  <label class="abs-method-form-label">Description</label>
  <textarea class="abs-method-form-textarea" id="abs-add-desc-${absIdx}" rows="2" placeholder="What this method does…"></textarea>
  <label class="abs-method-form-label">Pseudocode / Assembly (optional)</label>
  <textarea class="abs-method-form-textarea abs-method-form-code" id="abs-add-code-${absIdx}" rows="4" placeholder="; assembly here…" spellcheck="false"></textarea>
  <div class="abs-method-form-actions">
    <button class="btn btn-sm" onclick="absSaveMethod(${absIdx})">Save</button>
    <button class="btn btn-sm abs-method-form-cancel" onclick="absHideForm(${absIdx})">Cancel</button>
  </div>
</div>`;
}

function absShowDeleteForm(absIdx) {
    const fc = document.getElementById(`abs-form-${absIdx}`);
    if (!fc) return;
    if (fc.dataset.mode === 'del') { fc.innerHTML = ''; fc.dataset.mode = ''; return; }
    const abs = abstractionRegistry && abstractionRegistry.getAbstraction(absIdx);
    if (!abs || !abs.methods || abs.methods.length === 0) return;
    fc.dataset.mode = 'del';
    let opts = abs.methods.map(m => `<option value="${m}">${m}</option>`).join('');
    fc.innerHTML = `
<div class="abs-method-form">
  <div class="abs-method-form-title">Delete Method</div>
  <label class="abs-method-form-label">Select method to remove</label>
  <select class="abs-method-form-select" id="abs-del-select-${absIdx}">${opts}</select>
  <div class="abs-method-form-actions">
    <button class="btn btn-sm abs-method-del-confirm" onclick="absDeleteMethod(${absIdx})">Delete</button>
    <button class="btn btn-sm abs-method-form-cancel" onclick="absHideForm(${absIdx})">Cancel</button>
  </div>
</div>`;
}

function absHideForm(absIdx) {
    const fc = document.getElementById(`abs-form-${absIdx}`);
    if (fc) { fc.innerHTML = ''; fc.dataset.mode = ''; }
}

function absShowEditForm(absIdx, mi) {
    const fc = document.getElementById(`abs-form-${absIdx}`);
    if (!fc) return;
    const abs = abstractionRegistry && abstractionRegistry.getAbstraction(absIdx);
    if (!abs) return;
    const mName = abs.methods[mi];
    if (!mName) return;
    if (fc.dataset.mode === 'edit' && fc.dataset.editTarget === mName) {
        fc.innerHTML = ''; fc.dataset.mode = ''; fc.dataset.editTarget = ''; return;
    }
    const purposes = getMethodPurposes(abs);
    const examples = getMethodExamples(abs);
    const curDesc = purposes[mName] || '';
    const curCode = examples[mName] || '';
    const safe = mName.replace(/</g,'&lt;').replace(/>/g,'&gt;');
    fc.dataset.mode = 'edit';
    fc.dataset.editTarget = mName;
    fc.innerHTML = `
<div class="abs-method-form">
  <div class="abs-method-form-title">Edit \u2014 ${safe}</div>
  <label class="abs-method-form-label">Description</label>
  <textarea class="abs-method-form-textarea" id="abs-edit-desc-${absIdx}" rows="2">${curDesc.replace(/</g,'&lt;')}</textarea>
  <label class="abs-method-form-label">Pseudocode / Assembly</label>
  <textarea class="abs-method-form-textarea abs-method-form-code" id="abs-edit-code-${absIdx}" rows="4" spellcheck="false">${curCode.replace(/</g,'&lt;')}</textarea>
  <div class="abs-method-form-actions">
    <button class="btn btn-sm" onclick="absUpdateMethod(${absIdx})">Save</button>
    <button class="btn btn-sm abs-method-form-cancel" onclick="absHideForm(${absIdx})">Cancel</button>
  </div>
</div>`;
    fc.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function absUpdateMethod(absIdx) {
    const fc = document.getElementById(`abs-form-${absIdx}`);
    const mName = fc ? fc.dataset.editTarget : null;
    if (!mName) return;
    const descEl = document.getElementById(`abs-edit-desc-${absIdx}`);
    const codeEl = document.getElementById(`abs-edit-code-${absIdx}`);
    if (!descEl) return;
    const key = `${absIdx}:${mName}`;
    userMethodData[key] = {
        purpose: descEl.value.trim(),
        example: codeEl ? codeEl.value.trim() : ''
    };
    _absMethodsSave();
    showAbstractionDetail(absIdx);
}

function absSaveMethod(absIdx) {
    const nameEl = document.getElementById(`abs-add-name-${absIdx}`);
    const descEl = document.getElementById(`abs-add-desc-${absIdx}`);
    const codeEl = document.getElementById(`abs-add-code-${absIdx}`);
    if (!nameEl) return;
    const name = nameEl.value.trim();
    if (!name) { nameEl.focus(); return; }
    const abs = abstractionRegistry && abstractionRegistry.getAbstraction(absIdx);
    if (!abs) return;
    if (!abs.methods) abs.methods = [];
    if (!abs.methods.includes(name)) abs.methods.push(name);
    const key = `${absIdx}:${name}`;
    userMethodData[key] = {
        purpose: descEl ? descEl.value.trim() : '',
        example: codeEl ? codeEl.value.trim() : ''
    };
    userMethodLists[absIdx] = abs.methods.slice();
    _absMethodsSave();
    showAbstractionDetail(absIdx);
}

function absDeleteMethod(absIdx) {
    const sel = document.getElementById(`abs-del-select-${absIdx}`);
    if (!sel) return;
    const name = sel.value;
    if (!confirm(`Delete method "${name}"? This cannot be undone.`)) return;
    const abs = abstractionRegistry && abstractionRegistry.getAbstraction(absIdx);
    if (!abs || !abs.methods) return;
    abs.methods = abs.methods.filter(m => m !== name);
    delete userMethodData[`${absIdx}:${name}`];
    userMethodLists[absIdx] = abs.methods.slice();
    _absMethodsSave();
    showAbstractionDetail(absIdx);
}

function getMethodPurposes(abs) {
    const purposes = {};
    const knownPurposes = {
        'Salvation': { 'LOAD': 'Proves namespace lookup', 'TPERM': 'Proves permission check', 'LAMBDA': 'Proves Church reduction', 'TransitionToNavana': 'Transitions to Navana (does not RETURN)' },
        'Navana': { 'Init': 'Initialize all abstractions', 'Manage': 'Abstraction lifecycle management', 'Monitor': 'System health monitoring', 'IDS': 'Intrusion Detection via GT anomalies' },
        'Mint': { 'Create': 'Mint.Create(type, size, perms, [bind], [far]) — CALL Memory.Allocate for backing storage, find free NS entry, increment version, write NS entry, forge ready-to-use GT', 'Revoke': 'Mint.Revoke(nsIndex) — increment version, kill all GT copies instantly', 'Transfer': 'Mint.Transfer(gt, target_clist, slot) — move GT between c-lists' },
        'Memory': { 'Allocate': 'Memory.Allocate(size) — reserve a memory region, return location and size', 'Free': 'Memory.Free(location) — release a memory region, zero its contents', 'Resize': 'Memory.Resize(location, newSize) — adjust the size of an existing allocation' },
        'Scheduler': { 'Yield': 'Scheduler.Yield() — save thread state, switch to next ready thread', 'Spawn': 'Scheduler.Spawn(code_GT, entry) — create thread with isolated CR set', 'Wait': 'Scheduler.Wait(flag_GT) — block thread on DijkstraFlag', 'Stop': 'Scheduler.Stop(threadID) — terminate thread, release CRs' },
        'Stack': { 'Push': 'Stack.Push(value) — DWRITE to stack location, increment depth', 'Pop': 'Stack.Pop() — decrement depth, DREAD from stack location', 'Peek': 'Stack.Peek() — DREAD top without decrementing', 'Depth': 'Stack.Depth() — return current entry count' },
        'DijkstraFlag': { 'Wait': 'DijkstraFlag.Wait() — P() operation: block if unsignaled', 'Signal': 'DijkstraFlag.Signal() — V() operation: wake one waiter or set flag', 'Reset': 'DijkstraFlag.Reset() — clear flag to unsignaled state', 'Test': 'DijkstraFlag.Test() — non-blocking read of flag state' },
        'UART': { 'Send': 'UART.Send(byte) — SAVE byte to device (S perm)', 'Receive': 'UART.Receive() — LOAD byte from device (L perm)', 'SetBaud': 'UART.SetBaud(rate) — configure via CALL (E perm)' },
        'LED': { 'Set': 'LED.Set(num, state) — SAVE on-state to device (S perm)', 'Clear': 'LED.Clear(num) — SAVE off-state to device (S perm)', 'Toggle': 'LED.Toggle(num) — LOAD state, invert, SAVE (L+S perm)', 'Pattern': 'LED.Pattern(bits) — SAVE 6-bit pattern to all LEDs (S perm)' },
        'Button': { 'Read': 'Button.Read() — LOAD state from device (L perm)', 'WaitPress': 'Button.WaitPress() — block via Scheduler until press (E perm)', 'OnEvent': 'Button.OnEvent() — dequeue press/release event (E perm)' },
        'Timer': { 'Start': 'Timer.Start(channel) — SAVE start command to device (S perm)', 'Stop': 'Timer.Stop(channel) — SAVE stop command (S perm)', 'Read': 'Timer.Read() — LOAD elapsed ticks from device (L perm)', 'SetAlarm': 'Timer.SetAlarm(ticks) — SAVE threshold to device (S perm)' },
        'Display': { 'Write': 'Display.Write(char) — SAVE character to device (S perm)', 'Clear': 'Display.Clear() — SAVE clear command (S perm)', 'Scroll': 'Display.Scroll(lines) — SAVE scroll command (S perm)' },
        'SlideRule': { 'Add': 'SlideRule.Add(a, b) — IEEE 754 float add', 'Sub': 'SlideRule.Sub(a, b) — float subtract', 'Mul': 'SlideRule.Mul(a, b) — float multiply', 'Div': 'SlideRule.Div(a, b) — float divide', 'Sqrt': 'SlideRule.Sqrt(x) — square root', 'Log': 'SlideRule.Log(x) — natural logarithm', 'Pow': 'SlideRule.Pow(base, exp) — power function', 'Sin': 'SlideRule.Sin(rad) — sine', 'Cos': 'SlideRule.Cos(rad) — cosine', 'Tan': 'SlideRule.Tan(rad) — tangent', 'Asin': 'SlideRule.Asin(x) — inverse sine', 'Acos': 'SlideRule.Acos(x) — inverse cosine', 'Atan': 'SlideRule.Atan(x) — inverse tangent', 'ToDegrees': 'SlideRule.ToDegrees(rad) — radians to degrees', 'ToRadians': 'SlideRule.ToRadians(deg) — degrees to radians' },
        'Abacus': { 'Add': 'Abacus.Add(a, b) — integer add', 'Sub': 'Abacus.Sub(a, b) — integer subtract', 'Mul': 'Abacus.Mul(a, b) — integer multiply', 'Div': 'Abacus.Div(a, b) — integer divide', 'Mod': 'Abacus.Mod(a, b) — remainder', 'Abs': 'Abacus.Abs(x) — absolute value' },
        'Constants': { 'Pi': 'Constants.Pi() — return \u03c0 as IEEE 754', 'E': 'Constants.E() — return e', 'Phi': 'Constants.Phi() — return \u03c6', 'Zero': 'Constants.Zero() — return 0.0', 'One': 'Constants.One() — return 1.0' },
        'Circle': { 'Area': 'Circle.Area(radius) — \u03c0r\u00b2 via SlideRule.Mul + Constants.Pi', 'Circumference': 'Circle.Circumference(radius) — 2\u03c0r via SlideRule' },
        'Family': { 'Register': 'Family.Register(parent_GT, child_GT) — bind parent-child in c-list', 'Hello': 'Family.Hello(target_GT) — send greeting to any family member via their GT', 'Oversight': 'Family.Oversight(child_GT) — parent queries child activity' },
        'Schoolroom': { 'Join': 'Schoolroom.Join(class_GT) — student enters class', 'Lesson': 'Schoolroom.Lesson(class_GT, content_GT) — teacher posts lesson', 'Submit': 'Schoolroom.Submit(work_GT) — student submits work', 'Grade': 'Schoolroom.Grade(work_GT, score) — teacher grades work' },
        'Friends': { 'Request': 'Friends.Request(peer_GT) — send friend request (needs parent approval)', 'Accept': 'Friends.Accept(requester_GT) — accept request', 'Share': 'Friends.Share(friend_GT, cap_GT) — share capability', 'Revoke': 'Friends.Revoke(cap_GT) — revoke shared capability' },
        'Tunnel': { 'Connect': 'Tunnel.Connect(remote_GT) — establish encrypted tunnel (F-bit)', 'Send': 'Tunnel.Send(remote_GT, data) — send via tunnel', 'Receive': 'Tunnel.Receive() — receive from tunnel', 'Close': 'Tunnel.Close(remote_GT) — close tunnel, clear F-bit' },
        'Negotiate': { 'Propose': 'Negotiate.Propose(cap_GT) — request special grant (dual-approval)', 'Approve': 'Negotiate.Approve(proposal_id) — parent or teacher approves', 'Reject': 'Negotiate.Reject(proposal_id) — reject proposal', 'Status': 'Negotiate.Status(proposal_id) — query proposal state' },
        'Editor': { 'Open': 'Editor.Open(file_GT) — load DATA object into editor buffer', 'Save': 'Editor.Save() — DWRITE buffer to NS slot, recompute seal', 'Load': 'Editor.Load(nsIndex) — DREAD source from slot into buffer', 'Undo': 'Editor.Undo() — pop previous state from undo stack' },
        'Assembler': { 'Assemble': 'Assembler.Assemble(source_GT) — parse + encode to 32-bit instructions', 'Disassemble': 'Assembler.Disassemble(binary_GT) — decode instructions to text', 'Validate': 'Assembler.Validate(source_GT) — check syntax + register refs' },
        'Debugger': { 'Step': 'Debugger.Step() — fetch-decode-execute one instruction', 'Run': 'Debugger.Run() — execute until halt/breakpoint/fault', 'Breakpoint': 'Debugger.Breakpoint(address) — set/clear breakpoint', 'Inspect': 'Debugger.Inspect(address) — read and decode memory/NS entry' },
        'Deployer': (function() {
            const b = getSelectedBoard();
            const chip = b === 'ti60-f225' ? 'Efinix Ti60F225' : 'Gowin GW2AR-18';
            const brd  = b === 'ti60-f225' ? 'Ti60 F225' : 'Tang Nano';
            return { 'Build': `Deployer.Build(binary_GT) — package for ${chip}`, 'Upload': `Deployer.Upload() — send via UART to ${brd} (S perm)`, 'Verify': 'Deployer.Verify() — readback + checksum via UART (L perm)', 'Boot': 'Deployer.Boot() — send boot command, FPGA begins execution' };
        })(),
        'Browser': { 'Navigate': 'Browser.Navigate(site_GT) — LOAD content via L perm (no URLs)', 'Back': 'Browser.Back() — pop previous site GT from history', 'Bookmark': 'Browser.Bookmark(site_GT) — SAVE GT to bookmark c-list', 'Search': 'Browser.Search(scope_GT) — search within GT scope only' },
        'Messenger': { 'Send': 'Messenger.Send(recipient_GT, msg_GT) — send to approved contact', 'Receive': 'Messenger.Receive() — dequeue from inbox c-list', 'Contacts': 'Messenger.Contacts() — list parent-approved contact GTs', 'Block': 'Messenger.Block(contact_GT) — Mint.Revoke contact GT' },
        'Photos': { 'View': 'Photos.View(photo_GT) — LOAD photo data via L perm', 'Share': 'Photos.Share(photo_GT, recipient_GT) — TPERM to L-only, transfer', 'Upload': 'Photos.Upload(data_GT) — Memory.Allocate + store photo', 'Album': 'Photos.Album() — walk album c-list, return count' },
        'Social': { 'Post': 'Social.Post(content_GT) — publish to followers\' feed c-lists', 'Read': 'Social.Read() — LOAD next feed entry via L perm', 'Follow': 'Social.Follow(account_GT) — request follow (parent-gated)', 'Feed': 'Social.Feed() — count feed items available' },
        'Video': { 'Watch': 'Video.Watch(video_GT) — LOAD + stream via L perm', 'Search': 'Video.Search(scope_GT) — search within approved scope', 'Playlist': 'Video.Playlist() — walk playlist c-list', 'Share': 'Video.Share(video_GT, recipient_GT) — TPERM to L-only, transfer' },
        'Email': { 'Compose': 'Email.Compose(recipient_GT, body_GT) — allocate + send to inbox', 'Read': 'Email.Read() — dequeue from inbox c-list', 'Reply': 'Email.Reply(original_GT, body_GT) — reply in thread chain', 'Contacts': 'Email.Contacts() — list parent-approved email contacts' },
        'GC': { 'Scan': 'GC.Scan() — walk CRs + c-lists, set G-bit on live NS entries', 'Identify': 'GC.Identify() — find entries where G-bit != polarity', 'Clear': 'GC.Clear() — zero word0+word1 on garbage entries', 'Flip': 'GC.Flip() — toggle polarity for bidirectional cycle' },
        'Thread': {
            'switchTo': 'Thread.switchTo(thread_GT) — issues CHANGE targeting thread_GT; saves the calling thread\u2019s full context (DR0\u2013DR15, PC, FLAGS, STO, CR12, CR14, CR15) into its lump, then restores the target thread\u2019s saved context and resumes it at its saved PC. Requires E perm on thread_GT.',
            'Kill':     'Thread.Kill(thread_GT) — terminates the target thread: suspends it via CHANGE, releases its lump via Memory.Free, revokes its Thread GT via Mint.Revoke (incrementing gt_seq so all live copies of the GT become instantly invalid). Requires E perm on thread_GT.',
            'Compile':  'Thread.Compile(f_GT) \u2014 creates a new Thread Abstraction whose initial start abstraction is f. Calls Memory.Allocate for a fresh lump (GT zone + LIFO stack + heap + DR file), calls Mint.Create(Inform, lumpSize, 0) to mint a zero-perm Thread Identity GT (CR12 of the new thread), stores f_GT into the new thread\u2019s c-list as CR0 (the return/first-call slot), and returns the new Thread GT to the caller. The new thread is ready to run as soon as switchTo is called on its GT.',
        },
        'Boot.Thread': {
            'run': 'Boot.Thread.run \u2014 The initial thread\u2019s continuous existence as the hardware execution context. ' +
                   'CR12 holds the thread identity GT as an \u2018Inform\u2019: perms=[none], meaning no E-bit, so no code can invoke it via CALL. ' +
                   'The final comment in B:02 \u2014 \u201cInforms-only: cannot be used for direct CALL\u201d \u2014 means exactly this: ' +
                   'the thread does not run by being invoked. It runs because it IS the processor\u2019s current execution context \u2014 ' +
                   'the STEP controller simply advances PC through the thread\u2019s code lump each cycle. ' +
                   'You cannot CALL a thread from outside; you can only CHANGE into one via Thread.switchTo (which requires E perm on the Thread GT, not on CR12).',
        },
    };
    const base = knownPurposes[abs.name] ? Object.assign({}, knownPurposes[abs.name]) : purposes;
    for (const m of abs.methods) {
        const key = `${abs.index}:${m}`;
        if (userMethodData[key] && userMethodData[key].purpose) {
            base[m] = userMethodData[key].purpose;
        } else if (!base[m]) {
            base[m] = 'Dispatched via CALL';
        }
    }
    return base;
}

function getMethodExamples(abs) {
    const examples = {
        'Salvation': {
            'LOAD': `; Salvation.LOAD — prove namespace lookup via mLoad pipeline
; mLoad 7-step: type check -> version match -> seal verify
;   -> bounds check -> perm check -> F-bit -> deliver
LOAD   CR1, NS[4]       ; mLoad pipeline validates GT:
                         ;   1. Type != NULL (00=NULL, 01=Inform, 10=Outform, 11=Abstract)
                         ;   2. GT.gt_seq == NS[4].word2[31:25]
                         ;   3. CRC-16 seal(word0,word1) == word2[15:0]
                         ;   4. Index 4 within NS bounds
                         ;   5. L perm required for LOAD
                         ;   6. F-bit=0 (local, not tunneled)
                         ;   7. CR1 <- 128-bit capability register
; CR1.word0 = GT packed: Ver(7)|Idx(17)|Perms(6)|Type(2)
; CR1.word1 = NS[4].word0 (location)
; CR1.word2 = NS[4].word1 (B|F|G|...|limit[16:0])
; CR1.word3 = NS[4].word2 (version[31:25]|seal[24:0])`,
            'TPERM': `; Salvation.TPERM — prove GT health check
; TPERM checks permissions + validity + bounds in one cycle
; Sets Z flag: Z=1 = all passed, Z=0 = something failed
; Never traps — enables conditional execution (try-catch)
LOAD   CR1, NS[4]       ; CR1 holds Salvation GT [E]
TPERM  CR1, E            ; Check E permission, valid, MAC
; Z=1: permission present, GT valid
; Z=0: permission denied or GT invalid
; Subsequent EQ instructions skip if Z=0
; Note: TPERM can also restrict permissions (monotonic)
; — permissions can only be removed, never added.`,
            'LAMBDA': `; Salvation.LAMBDA — prove Church numeral reduction
; LAMBDA dispatches a method within an abstraction
; It is NOT a security block — just an instruction
LOAD   CR1, NS[20]      ; Load SUCC GT (X+L+E perms)
                         ;   mLoad validates X perm for code
DWRITE DR0, #3           ; Church numeral 3 in data register
LAMBDA CR1, DR0          ; Apply SUCC: DR0 <- SUCC(3) = 4
                         ;   CR1 must have X perm (code exec)
                         ;   SUCC's CLOOMC is a DATA-domain object
; Result: DR0 = 4`,
            'TransitionToNavana': `; Salvation -> Navana transition (Salvation does NOT return)
; Boot flow: Boot -> CALL Salvation -> Salvation -> Navana
; Navana runs forever as the namespace controller
LOAD   CR2, NS[5]       ; Load Navana E-GT via mLoad
                         ;   7-step pipeline validates:
                         ;   ver match, seal check, E perm
CALL   CR2              ; Enter Navana:
                         ;   1. Push return state to call stack
                         ;   2. CR6 <- E-GT (c-list for Navana)
                         ;   3. CR14 <- X-GT (CLOOMC, privileged)
                         ;   4. B-bits cleared on all CRs
                         ;   5. PC <- Navana code entry point
; Navana takes over — runs indefinitely, never RETURNs`,
        },
        'Navana': {
            'Init': `; Navana.Init — bootstrap all abstractions (Layer 1-8)
; Navana is the namespace controller, runs forever
; Init walks the abstraction table and creates each one
LOAD   CR1, NS[5]       ; Load Navana E-GT
CALL   CR1              ; Enter Navana
                         ;   CR6 <- Navana c-list
                         ;   CR14 <- Navana CLOOMC (DATA-domain, privileged)
; Inside Navana.Init:
;   for each abstraction index 6..44:
;     LOAD  CR3, NS[7]  ; Load Memory GT
;     CALL  CR3          ; Memory.Allocate -> backing storage
;     LOAD  CR4, NS[6]  ; Load Mint GT
;     CALL  CR4          ; Mint.Create -> NS entry + GT
;   Navana.Init never returns — enters event loop`,
            'Manage': `; Navana.Manage — abstraction lifecycle
; Navana dispatches create/destroy/call/inspect uniformly
; Every abstraction shares this polymorphic interface
LOAD   CR1, NS[5]       ; Load Navana E-GT
DWRITE DR0, #33         ; Target: Editor abstraction (NS[33])
DWRITE DR1, #0          ; Operation: 0=create
CALL   CR1              ; Navana.Manage dispatches:
;   1. Mint.Create(type, size, perms):
;      a. Memory.Allocate(size) -> location
;      b. Find free NS entry
;      c. Write NS entry + compute seal
;      d. Forge GT with version/perms
;   2. Return GT to caller via CR`,
            'Monitor': `; Navana.Monitor — system health / MTBF tracking
; Every abstraction is a security block with MTBF
; MTBF = uptime / faultCount for that block
LOAD   CR1, NS[5]       ; Load Navana E-GT
CALL   CR1              ; Navana.Monitor checks:
;   for each abstraction 0..44:
;     read faultCount from registry
;     compute MTBF = activeTime / faultCount
;     if MTBF < threshold: flag degraded
;   DR0 <- total fault count across all blocks
;   DR1 <- index of lowest-MTBF abstraction`,
            'IDS': `; Navana.IDS — Intrusion Detection System
; Detects GT forgery attempts and version anomalies
LOAD   CR1, NS[5]       ; Load Navana E-GT
CALL   CR1              ; Navana.IDS scans:
;   for each active NS entry:
;     recompute seal = CRC-16(word0, word1)
;     compare seal vs word2[15:0]
;     if mismatch: FAULT — tampered entry
;     check version consistency across all GTs
;     if GT.version > NS.version: stale/forged
;   Report anomalies to Navana.Monitor`,
            'ValidatePassKey': `; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
; LED via Navana PassKey — complete 3-step flow
; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
; PassKey = ABSTRACTION GT (type=0b11=Abstract)
;   GT index encodes: device[15:8] | permMask[7:4] | id[3:0]
; Navana = gatekeeper. Validates PassKey,
;   replaces CR1 with E-perm LED driver.
; LED driver = callable. Methods via DR0/DR1.
; Caller never sees hardware address or NS index.
;
; Step 1: Load PassKey from thread's c-list
; Step 2: CALL Navana with PassKey in CR1
; Step 3: CALL LED driver (now in CR1) with DRs set

; ── STEP 1: Load PassKey ──────────────────────
LOAD   CR1, [CR6 + 0]   ; Load PassKey GT from thread c-list
                          ;   Abstract type (0b11)
                          ;   Index encodes: device=LED(0x01),
                          ;     permMask=ALL(0x0F), id
                          ;   Placed by Navana.Init at boot

; ── STEP 2: CALL Navana — present PassKey ─────
LOAD   CR2, NS[5]        ; Load Navana E-GT
                          ;   CR1 still holds PassKey
CALL   CR2                ; CALL Navana detects Abstract GT in CR1:
;   Navana.ValidatePassKey dispatched automatically:
;   1. Parse CR1 GT: type must be Abstract (0b11)
;   2. Decode index: device selector, perm mask
;   3. Lookup in Navana's PassKey registry
;   4. Check not revoked, not tampered
;   5. Replace CR1 <- E-perm LED driver GT (Inform)
;   6. Store permMask for driver calls
;   DR0 <- permMask granted
; If invalid: PERM fault — no hardware state changes

; ── STEP 3: CALL LED driver — set LED 3 ON ────
; CR1 now holds E-perm LED driver (not PassKey)
DWRITE DR0, #3            ; LED number (0-5)
DWRITE DR1, #1            ; Colour/state: 1=on
CALL   CR1                ; LED.Set via E-perm driver:
;   1. DR0[31:24] = method (0=Set,1=Clear,2=Pattern,3=Get)
;   2. DR0[7:0]   = LED number
;   3. DR1[7:0]   = colour/state
;   4. Hardware write at 0xFE10 (invisible to caller)
;   5. DR0 <- updated LED state
; Gate Log shows full chain of custody:
;   PassKey presented -> Navana validated ->
;   LED.Set(3,1) called -> device write committed`,
            'CallLEDDriver': `; LED via Navana PassKey — two calling modes
;
; Assumes PassKey already validated (Step 1-2 done)
; CR1 holds E-perm LED driver GT from Navana

; ---- Mode 1: LED.Set(LED#, colour) ----
; When DR1 > 0, routes to LED.Set automatically
DWRITE DR0, #3            ; DR0 = LED number (0-5)
DWRITE DR1, #1            ; DR1 = colour (non-zero -> Set mode)
CALL   CR1                ; LED.Set via E-perm driver

; ---- Mode 2: LED.Pattern(6-bit pattern) ----
; When DR1 = 0 and DR0 is a 6-bit value, routes to LED.Pattern
DWRITE DR0, #0b00101010  ; DR0 = 6-bit pattern (alternating)
DWRITE DR1, #0            ; DR1 = 0 -> Pattern mode
CALL   CR1                ; LED.Pattern via E-perm driver:
;   1. Reads DR0[5:0] as 6-bit pattern
;   2. Writes pattern atomically to all 6 LEDs
;   3. Pins 15-20 driven active-low
;   4. DR0 <- new LED state
; Gate Log shows full chain of custody:
;   Grant validated -> LED.Pattern called ->
;   device write committed`,
            'MintPassKey': `; Navana.MintPassKey — create a new PassKey
; PRIVILEGED: requires M-elevation (boot/kernel only)
; Unprivileged callers get PERM fault.
LOAD   CR1, NS[5]        ; Load Navana E-GT
DWRITE DR0, #4            ; DR0=4 selects MintPassKey method
DWRITE DR1, #0x010F       ; DR1[15:8]=device(LED=0x01), DR1[7:0]=permMask(ALL=0x0F)
CALL   CR1                ; Navana.MintPassKey:
;   1. Check M-elevation (unprivileged -> PERM fault)
;   2. Allocate PassKey ID (monotonic counter)
;   3. Pack Abstract GT (type=0b11):
;      index = device[15:8] | permMask[7:4] | id[3:0]
;      E perm for CALL capability
;   4. Store in Navana's private PassKey registry
;   5. CR1 <- PassKey GT (ready to grant to thread)
; PassKey is unforgeable:
;   - Only Navana can mint (M-elevation required)
;   - GT index encoding cross-checked against registry
;   - Thread receives but cannot modify or copy`,
        },
        'Mint': {
            'Create': `; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
; Mint.Create(type, size, perms, [bind], [far])
; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
;   type:  00=NULL  01=Inform  10=Outform  11=Abstract
;          NULL cannot be created (it IS the zero value)
;   size:  words to allocate via Memory.Allocate
;   perms: any valid combo within ONE domain:
;     Turing domain:  R, W, X  (any combo: R, RW, RX, RWX, W, X, WX)
;     Church domain:  L, S, E  (any combo: L, LS, LE, LSE, S, E, SE)
;   bind:  B-bit (default 0, auto-cleared by CALL)
;   far:   F-bit (default 0, auto-set for Outform)
;
; Process:
;   1. Domain purity check (Turing OR Church, never mixed)
;   2. CALL Memory.Allocate(size) for backing storage (returns location)
;   3. Find free NS entry (Mint manages NS table)
;   4. Increment version (never reset — monotonic)
;   5. Write 3-word NS entry with B/F flags + seal
;   6. Pack GT, return ready to use
;
; Returns: GT packed as Version(7)|Index(17)|Perms(6)|Type(2)
; Faults:  DOMAIN_PURITY, OOM, TYPE (NULL not creatable)
; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

; ── EXAMPLE A: Inform + Turing R,W (data buffer) ──────────
LOAD   CR1, NS[6]       ; Load Mint E-GT (mLoad validates)
DWRITE DR0, #1          ; type = 01 (Inform)
DWRITE DR1, #128        ; size = 128 words
DWRITE DR2, #0b000011   ; perms = R+W (Turing domain)
                         ;   bit0=R, bit1=W
CALL   CR1              ; Mint.Create internally:
;   1. Domain purity: R+W = Turing only — OK
;   2. CALL Memory.Allocate(128):
;      Memory scans NS for free slot (word0=0 AND word1=0)
;      skips reserved 0..44, finds e.g. slot 50
;      returns { nsIndex: 50, location: 0x3200 }
;   3. Version increment:
;      read NS[50].word2, extract ver = (word2>>25)&0x7F
;      newVer = (ver + 1) & 0x7F  (never reset to 0)
;   4. Pack NS entry at NS_TABLE_BASE + 50*3:
;      word0 = location (0x3200)
;      word1 = B(0)|F(0)|G(0)|type(01)|...|limit(127)
;      word2 = (newVer<<25) | CRC16_seal(loc, limit)
;   5. Pack GT:
;      GT = (seq<<16)|(50)|(0b000001<<25)|(0b01<<23)
;         = seq=1, idx=50, R+W, Inform
; Result: CR1 <- ready-to-use GT for NS[50]

; ── EXAMPLE B: Inform + Turing R,W,X (full data+code) ────
LOAD   CR1, NS[6]       ; Load Mint E-GT
DWRITE DR0, #1          ; type = 01 (Inform)
DWRITE DR1, #64         ; size = 64 words
DWRITE DR2, #0b000111   ; perms = R+W+X (full Turing)
                         ;   bit0=R, bit1=W, bit2=X
CALL   CR1              ; Mint.Create:
;   Domain purity: R+W+X = Turing only — OK
;   Memory.Allocate(64) -> location for backing storage
;   Mint finds free NS entry, increments version, packs GT
; Result: CR1 <- GT with full Turing access
;   DREAD/DWRITE for data, LAMBDA for execution

; ── EXAMPLE C: Inform + Turing X only (execute-only code) ─
LOAD   CR1, NS[6]       ; Load Mint E-GT
DWRITE DR0, #1          ; type = 01 (Inform)
DWRITE DR1, #32         ; size = 32 words
DWRITE DR2, #0b000100   ; perms = X only (Turing)
                         ;   bit2=X — execute but no read
CALL   CR1              ; Mint.Create:
;   Code object you can run but not inspect
;   CR14 loads via X perm (privileged code register)

; ── EXAMPLE D: Inform + Church L,S,E (c-list) ────────────
LOAD   CR1, NS[6]       ; Load Mint E-GT
DWRITE DR0, #1          ; type = 01 (Inform)
DWRITE DR1, #16         ; size = 16 slots
DWRITE DR2, #0b111000   ; perms = L+S+E (full Church)
                         ;   bit3=L, bit4=S, bit5=E
CALL   CR1              ; Mint.Create:
;   Domain purity: L+S+E = Church only — OK
;   Memory.Allocate(16) -> location for c-list storage
;   Mint finds free NS entry, increments version
; Result: CR1 <- GT for c-list
;   L: LOAD GTs from this c-list
;   S: SAVE GTs into this c-list
;   E: CALL/enter through this c-list

; ── EXAMPLE E: Inform + Church E only (abstraction) ──────
LOAD   CR1, NS[6]       ; Load Mint E-GT
DWRITE DR0, #1          ; type = 01 (Inform)
DWRITE DR1, #8          ; size = 8 words
DWRITE DR2, #0b100000   ; perms = E only (Church)
                         ;   bit5=E
CALL   CR1              ; Mint.Create:
;   Standard abstraction entry point — E only
;   Can CALL but cannot LOAD/SAVE

; ── EXAMPLE F: Inform + Bind flag ─────────────────────────
LOAD   CR1, NS[6]       ; Load Mint E-GT
DWRITE DR0, #1          ; type = 01 (Inform)
DWRITE DR1, #64         ; size = 64 words
DWRITE DR2, #0b000011   ; perms = R+W (Turing)
DWRITE DR3, #1          ; bind = 1 (B-bit set)
CALL   CR1              ; Mint.Create:
;   B-bit=1 in word1[31] — GT bound to a thread
;   B-bit auto-cleared by CALL (hardware enforced)
;   Prevents GT from being used before binding

; ── EXAMPLE G: Outform + Far + Church L,E (remote) ───────
LOAD   CR1, NS[6]       ; Load Mint E-GT
DWRITE DR0, #2          ; type = 10 (Outform)
DWRITE DR1, #32         ; size = 32 words (local proxy)
DWRITE DR2, #0b101000   ; perms = L+E (Church)
                         ;   bit3=L, bit5=E
CALL   CR1              ; Mint.Create:
;   Outform: F-bit auto-set (Far = remote resource)
;   CALL Memory.Allocate for URL proxy object
;   mLoad step 6 detects F-bit, routes through Tunnel
;   All access mediated by encrypted capability tunnel

; ── EXAMPLE H: Abstract type (new abstraction) ───────────
LOAD   CR1, NS[6]       ; Load Mint E-GT
DWRITE DR0, #3          ; type = 11 (Abstract)
DWRITE DR1, #256        ; size = 256 words
DWRITE DR2, #0b100000   ; perms = E only (Church)
CALL   CR1              ; Mint.Create:
;   Abstract type: this GT represents a new abstraction
;   Responds to polymorphic interface: create/destroy/call/inspect
;   Navana manages its lifecycle

; ── ILLEGAL: NULL type (FAULT) ────────────────────────────
; DWRITE DR0, #0          ; type = 00 (NULL) — ILLEGAL!
;   -> FAULT: TYPE
;   NULL is the zero/absent value, not creatable

; ── ILLEGAL: Mixed domain (FAULT) ─────────────────────────
; DWRITE DR2, #0b001011 ; R+W+L — ILLEGAL!
;   Turing(R,W) mixed with Church(L)
;   -> FAULT: DOMAIN_PURITY`,
            'Revoke': `; Mint.Revoke — instant revocation via version increment
; Incrementing the version in the NS entry kills ALL
; outstanding copies of the GT — they will fail mLoad
; step 2 (version mismatch) on next use
LOAD   CR1, NS[6]       ; Load Mint E-GT
DWRITE DR0, #50         ; Target NS slot to revoke

CALL   CR1              ; Mint.Revoke:
;   base = NS_TABLE_BASE + 50 * 3
;   word2 = mem[base+2]
;   oldVer = (word2 >>> 25) & 0x7F     ; extract version
;   newVer = (oldVer + 1) & 0x7F       ; increment (wraps at 128)
;   seal = word2 & 0xFFFF               ; preserve CRC-16 seal
;   mem[base+2] = (newVer << 25) | seal ; write back
;
; All GTs with old version are now dead:
;   any LOAD/CALL with stale GT hits mLoad step 2:
;   GT.version(7 bits) != NS[50].word2.version(7 bits)
;   -> FAULT: VERSION_MISMATCH
; DR0 <- new version number`,
            'Transfer': `; Mint.Transfer — move GT between c-lists
; The c-list IS the parental approval — transferring a GT
; to a child's c-list grants them access to that resource
LOAD   CR1, NS[6]       ; Load Mint E-GT
LOAD   CR2, NS[50]      ; Source: GT to transfer
LOAD   CR3, NS[60]      ; Target: destination c-list GT

; Transfer requires:
;   1. Caller holds L perm on source c-list (can read GT)
;   2. Caller holds S perm on target c-list (can write GT)
;   3. B-bit (Bind) on source GT must be 0 (transferable)
;      B-bit is auto-cleared by CALL instruction
CALL   CR1              ; Mint.Transfer:
;   read GT from source c-list[slot]
;   validate B-bit = 0 (can be moved)
;   SAVE GT to target c-list[slot] via S perm
;   optionally zero source slot (move vs copy)
; The child now has the GT in their c-list`,
        },
        'Memory': {
            'Allocate': `; Memory.Allocate — reserve a memory region
; Memory manages address space as a pool of allocations.
; It does NOT manage the NS table — that is Mint/Navana's job.
LOAD   CR1, NS[7]       ; Load Memory E-GT via mLoad
DWRITE DR0, #128        ; Request 128 words of storage

CALL   CR1              ; Memory.Allocate:
;   1. Check if requested size fits in available memory
;      (next free address + size must not exceed NS_TABLE_BASE)
;      if no room: FAULT OOM
;   2. Record allocation at current free address
;   3. Advance free address pointer by size
;
; DR0 <- base location address
; DR1 <- allocation size (128)
; Memory only returns a location — Mint.Create handles
; the NS entry, GT creation, and version management`,
            'Free': `; Memory.Free — release a memory region
LOAD   CR1, NS[7]       ; Load Memory E-GT
DWRITE DR0, #0x2D00     ; Location to free (from original Allocate)

CALL   CR1              ; Memory.Free:
;   1. Look up allocation at given location
;      if not found: FAULT BOUNDS
;   2. Zero the memory contents
;   3. Remove allocation record
; The NS entry is NOT touched — use Mint.Revoke to
; invalidate GTs, then free the backing memory here`,
            'Resize': `; Memory.Resize — adjust allocation size
LOAD   CR1, NS[7]       ; Load Memory E-GT
DWRITE DR0, #0x2D00     ; Location to resize (from original Allocate)
DWRITE DR1, #256        ; New size (words)

CALL   CR1              ; Memory.Resize:
;   1. Look up allocation at given location
;      if not found: FAULT BOUNDS
;   2. Update the allocation record with new size
; NOTE: if an NS entry references this location,
; Mint must also update the NS entry's limit field
; and recompute the CRC-16 seal separately`,
        },
        'Scheduler': {
            'Yield': `; Scheduler.Yield — voluntarily yield time slice
LOAD   CR1, NS[8]       ; Load Scheduler E-GT
CALL   CR1              ; Scheduler.Yield:
;   1. Save current thread state (CRs, DRs, flags, PC)
;   2. Select next ready thread from run queue
;   3. Restore next thread's state
;   4. Transfer control (PC <- next thread's saved PC)
; Current thread goes to back of run queue`,
            'Spawn': `; Scheduler.Spawn — create a new thread
; Each thread gets its own CR set and namespace view
LOAD   CR1, NS[8]       ; Load Scheduler E-GT
LOAD   CR2, NS[50]      ; Code GT for new thread (X perm)
                         ;   must be DATA-domain object
DWRITE DR0, #0x0200     ; Entry point address within code

CALL   CR1              ; Scheduler.Spawn:
;   1. Memory.Allocate for thread control block
;   2. Initialize CRs (copy parent's c-list subset)
;   3. Set new thread PC = entry point
;   4. Each child thread has isolated namespace view
;   5. Add to run queue
; DR0 <- new thread ID`,
            'Wait': `; Scheduler.Wait — block thread on DijkstraFlag
; Thread stops running until the flag is signaled
LOAD   CR1, NS[8]       ; Load Scheduler E-GT
LOAD   CR2, NS[10]      ; DijkstraFlag GT (event source)

CALL   CR1              ; Scheduler.Wait:
;   1. Remove current thread from run queue
;   2. Add to DijkstraFlag's wait queue
;   3. Save thread state
;   4. Switch to next ready thread
; Thread resumes when DijkstraFlag.Signal fires`,
            'Stop': `; Scheduler.Stop — terminate a thread
LOAD   CR1, NS[8]       ; Load Scheduler E-GT
DWRITE DR0, #2          ; Thread ID to terminate

CALL   CR1              ; Scheduler.Stop:
;   1. Remove thread from run/wait queue
;   2. Memory.Free thread control block
;   3. Clear thread's CRs (release capabilities)
;   4. If terminated thread held GTs, they become
;      unreachable (GC will reclaim via G-bit scan)`,
        },
        'Stack': {
            'Push': `; Stack.Push — push value onto managed stack
; Stack uses a Memory-allocated DATA region for storage
LOAD   CR1, NS[9]       ; Load Stack E-GT
DWRITE DR0, #42         ; Value to push

CALL   CR1              ; Stack.Push:
;   1. Check stack not full (depth < limit from word1)
;   2. DWRITE value to mem[location + depth]
;      location = NS[stack_slot].word0
;   3. Increment depth counter
;   4. If full: WARN STACK_OVERFLOW — thread suspended for programmed recovery`,
            'Pop': `; Stack.Pop — pop value from stack
LOAD   CR1, NS[9]       ; Load Stack E-GT

CALL   CR1              ; Stack.Pop:
;   1. Check stack not empty (depth > 0)
;   2. Decrement depth counter
;   3. DREAD value from mem[location + depth]
;   4. If empty: FAULT STACK_UNDERFLOW
; DR0 <- popped value`,
            'Peek': `; Stack.Peek — read top without removing
LOAD   CR1, NS[9]       ; Load Stack E-GT

CALL   CR1              ; Stack.Peek:
;   1. Check stack not empty
;   2. DREAD mem[location + depth - 1]
;   3. Do NOT decrement depth
; DR0 <- top value (stack unchanged)`,
            'Depth': `; Stack.Depth — query current stack depth
LOAD   CR1, NS[9]       ; Load Stack E-GT

CALL   CR1              ; Stack.Depth:
;   DR0 <- current number of entries on stack`,
        },
        'DijkstraFlag': {
            'Wait': `; DijkstraFlag.Wait — block thread until flag signaled
; Implements Dijkstra's semaphore P() operation
; Integrates with Scheduler for thread management
LOAD   CR1, NS[10]      ; Load DijkstraFlag E-GT

CALL   CR1              ; DijkstraFlag.Wait:
;   1. Test flag state
;   2. If signaled: clear flag, continue (no block)
;   3. If not signaled:
;      a. Add current thread to flag's wait queue
;      b. Scheduler.Wait(this flag) — block thread
;      c. Thread sleeps until Signal wakes it
; Thread resumes here after being signaled`,
            'Signal': `; DijkstraFlag.Signal — wake one waiting thread
; Implements Dijkstra's semaphore V() operation
LOAD   CR1, NS[10]      ; Load DijkstraFlag E-GT

CALL   CR1              ; DijkstraFlag.Signal:
;   1. If threads waiting on this flag:
;      a. Remove one thread from wait queue
;      b. Scheduler.Spawn/resume that thread
;   2. If no threads waiting:
;      a. Set flag state = signaled
;      b. Next Wait() will consume it immediately`,
            'Reset': `; DijkstraFlag.Reset — clear flag state
LOAD   CR1, NS[10]      ; Load DijkstraFlag E-GT

CALL   CR1              ; DijkstraFlag.Reset:
;   1. Clear flag to unsignaled state
;   2. Does NOT affect threads in wait queue
;   3. Used to re-arm one-shot events`,
            'Test': `; DijkstraFlag.Test — non-blocking check
LOAD   CR1, NS[10]      ; Load DijkstraFlag E-GT

CALL   CR1              ; DijkstraFlag.Test:
;   1. Read flag state without blocking
;   2. Does NOT consume the signal
;   DR0 <- 1 if signaled, 0 if not`,
        },
        'UART': {
            'Send': `; UART.Send — transmit byte via Church domain S perm
; Hardware devices use L/S/E only (Church domain)
; NOT R/W (that's Turing domain for DATA objects)
LOAD   CR1, NS[11]      ; Load UART GT [L,S,E] via mLoad
                         ;   mLoad checks: type, version, seal,
                         ;   bounds, perms, F-bit, deliver
DWRITE DR0, #0x41       ; Byte to send ('A') in data register
SAVE   CR1, DR0         ; S perm: save data TO device
                         ;   SAVE checks S permission on GT
                         ;   Church domain: capability-gated I/O
; Byte queued for transmission on pin 69 (TX)`,
            'Receive': `; UART.Receive — read byte via Church domain L perm
LOAD   CR1, NS[11]      ; Load UART GT [L,S,E]

LOAD   DR0, CR1         ; L perm: load data FROM device
                         ;   LOAD checks L permission on GT
                         ;   Only capability holders can read UART
; DR0 <- received byte from pin 70 (RX)
; If no byte available: DR0 = 0, Z flag set`,
            'SetBaud': `; UART.SetBaud — configure baud rate via CALL
LOAD   CR1, NS[11]      ; Load UART E-GT
DWRITE DR0, #115200     ; Target baud rate

CALL   CR1              ; UART.SetBaud via E perm:
;   1. Validate baud rate is supported
;   2. Configure UART divider register
;   3. BL616 USB bridge at 27MHz clock
; Note: E perm required for configuration methods
; L/S only for data transfer`,
        },
        'LED': {
            'Set': `; LED.Set — turn LED on via S (Save) permission
; Tang Nano 20K: 6 LEDs on pins 15-20 (active-low)
LOAD   CR1, NS[12]      ; Load LED GT [L,S,E]
DWRITE DR0, #3          ; LED number (0-5)
DWRITE DR1, #1          ; State: 1=on
SAVE   CR1, DR0         ; S perm: save state to device
                         ;   Church domain capability gate
                         ;   No ambient access — must hold GT`,
            'Clear': `; LED.Clear — turn LED off via S perm
LOAD   CR1, NS[12]      ; Load LED GT [L,S,E]
DWRITE DR0, #3          ; LED number
DWRITE DR1, #0          ; State: 0=off
SAVE   CR1, DR0         ; S perm: save to device`,
            'Toggle': `; LED.Toggle — flip LED state
LOAD   CR1, NS[12]      ; Load LED GT [L,S,E]
DWRITE DR0, #3          ; LED number

CALL   CR1              ; LED.Toggle via E perm:
;   1. L perm: read current state from device
;   2. Invert state
;   3. S perm: write new state to device`,
            'Pattern': `; LED.Pattern — set all 6 LEDs at once
LOAD   CR1, NS[12]      ; Load LED GT [L,S,E]
DWRITE DR0, #0b101010   ; Pattern: alternating on/off
                         ; Bit 0=LED0, Bit 5=LED5
SAVE   CR1, DR0         ; S perm: save pattern to device
; All 6 LEDs updated atomically
; Pins 15-20 driven active-low`,
        },
        'Button': {
            'Read': `; Button.Read — read button state via L perm
; Button is L+E only (no S — you can't write to a button)
; Tang Nano 20K button on pin 88
LOAD   CR1, NS[13]      ; Load Button GT [L,E]
LOAD   DR0, CR1         ; L perm: load state from device
; DR0 <- 1 if pressed, 0 if released`,
            'WaitPress': `; Button.WaitPress — block until button press
LOAD   CR1, NS[13]      ; Load Button GT [L,E]

CALL   CR1              ; Button.WaitPress via E perm:
;   1. Read current state via L perm
;   2. If pressed: return immediately
;   3. If released: Scheduler.Wait on button event
;      thread blocks until hardware interrupt
; DR0 <- 1 (pressed) when thread resumes`,
            'OnEvent': `; Button.OnEvent — dequeue button event
LOAD   CR1, NS[13]      ; Load Button GT [L,E]

CALL   CR1              ; Button.OnEvent via E perm:
;   1. Check event queue (press/release transitions)
;   2. If event pending: dequeue and return
;   3. If no event: DR0 = 0, Z flag set
; DR0 <- event type (1=press, 2=release, 0=none)`,
        },
        'Timer': {
            'Start': `; Timer.Start — begin counting via S perm
LOAD   CR1, NS[14]      ; Load Timer GT [L,S,E]
DWRITE DR0, #0          ; Timer channel

SAVE   CR1, DR0         ; S perm: save "start" to device
; Timer begins counting from 27MHz clock`,
            'Stop': `; Timer.Stop — halt timer via S perm
LOAD   CR1, NS[14]      ; Load Timer GT [L,S,E]
DWRITE DR0, #0          ; Timer channel

CALL   CR1              ; Timer.Stop via E perm:
;   S perm: write stop command to device
;   Timer halts, counter preserved for reading`,
            'Read': `; Timer.Read — get elapsed time via L perm
LOAD   CR1, NS[14]      ; Load Timer GT [L,S,E]

LOAD   DR0, CR1         ; L perm: load elapsed from device
; DR0 <- elapsed ticks since Start
; At 27MHz: ticks / 27000000 = seconds`,
            'SetAlarm': `; Timer.SetAlarm — set alarm threshold via S perm
LOAD   CR1, NS[14]      ; Load Timer GT [L,S,E]
DWRITE DR0, #27000000   ; Alarm at 1 second (27M ticks)

SAVE   CR1, DR0         ; S perm: save alarm to device
; When counter reaches threshold:
;   hardware signals DijkstraFlag for this timer
;   waiting thread wakes via DijkstraFlag.Signal`,
        },
        'Display': {
            'Write': `; Display.Write — write character via S perm
LOAD   CR1, NS[15]      ; Load Display GT [L,S,E]
DWRITE DR0, #0x48       ; Character 'H'

SAVE   CR1, DR0         ; S perm: save char to device
; Character appears at current cursor position`,
            'Clear': `; Display.Clear — clear screen via E perm
LOAD   CR1, NS[15]      ; Load Display GT [L,S,E]

CALL   CR1              ; Display.Clear via E perm:
;   S perm: write clear command to device
;   All pixels/chars zeroed, cursor reset to (0,0)`,
            'Scroll': `; Display.Scroll — scroll display via E perm
LOAD   CR1, NS[15]      ; Load Display GT [L,S,E]
DWRITE DR0, #1          ; Scroll 1 line up

CALL   CR1              ; Display.Scroll via E perm:
;   S perm: write scroll command to device
;   Top line lost, bottom line cleared`,
        },
        'SlideRule': {
            'Add': `; SlideRule.Add — IEEE 754 float addition
LOAD   CR1, NS[16]      ; Load SlideRule E-GT
DWRITE DR0, #0x3F800000 ; 1.0 (IEEE 754 single)
DWRITE DR1, #0x40000000 ; 2.0
CALL   CR1              ; DR0 <- 0x40400000 (3.0)`,
            'Sub': `; SlideRule.Sub — IEEE 754 float subtract
LOAD   CR1, NS[16]      ; Load SlideRule E-GT
DWRITE DR0, #0x40400000 ; 3.0
DWRITE DR1, #0x3F800000 ; 1.0
CALL   CR1              ; DR0 <- 0x40000000 (2.0)`,
            'Mul': `; SlideRule.Mul — IEEE 754 float multiply
LOAD   CR1, NS[16]      ; Load SlideRule E-GT
DWRITE DR0, #0x40000000 ; 2.0
DWRITE DR1, #0x40400000 ; 3.0
CALL   CR1              ; DR0 <- 0x40C00000 (6.0)`,
            'Div': `; SlideRule.Div — IEEE 754 float divide
LOAD   CR1, NS[16]      ; Load SlideRule E-GT
DWRITE DR0, #0x41200000 ; 10.0
DWRITE DR1, #0x40000000 ; 2.0
CALL   CR1              ; DR0 <- 0x40A00000 (5.0)
; Div by zero: FAULT MATH_ERROR`,
            'Sqrt': `; SlideRule.Sqrt — square root
LOAD   CR1, NS[16]      ; Load SlideRule E-GT
DWRITE DR0, #0x41100000 ; 9.0
CALL   CR1              ; DR0 <- 0x40400000 (3.0)
; Negative input: FAULT DOMAIN_ERROR`,
            'Log': `; SlideRule.Log — natural logarithm
LOAD   CR1, NS[16]      ; Load SlideRule E-GT
DWRITE DR0, #0x402DF854 ; e (2.71828)
CALL   CR1              ; DR0 <- 0x3F800000 (1.0)`,
            'Pow': `; SlideRule.Pow — power function
LOAD   CR1, NS[16]      ; Load SlideRule E-GT
DWRITE DR0, #0x40000000 ; Base: 2.0
DWRITE DR1, #0x41200000 ; Exponent: 10.0
CALL   CR1              ; DR0 <- 0x44800000 (1024.0)`,
            'Sin': `; SlideRule.Sin — sine (radians)
; FPGA uses CORDIC; simulator uses IEEE 754
LOAD   CR1, NS[16]      ; Load SlideRule E-GT
DWRITE DR0, #0x3FC90FDB ; pi/2 (1.5708 rad)
CALL   CR1              ; DR0 <- 0x3F800000 (1.0)`,
            'Cos': `; SlideRule.Cos — cosine (radians)
LOAD   CR1, NS[16]      ; Load SlideRule E-GT
DWRITE DR0, #0x00000000 ; 0.0 rad
CALL   CR1              ; DR0 <- 0x3F800000 (1.0)`,
            'Tan': `; SlideRule.Tan — tangent (radians)
LOAD   CR1, NS[16]      ; Load SlideRule E-GT
DWRITE DR0, #0x3F490FDB ; pi/4 (0.7854 rad)
CALL   CR1              ; DR0 <- 0x3F800000 (1.0)
; Near pi/2: FAULT DOMAIN_ERROR (asymptote)`,
            'Asin': `; SlideRule.Asin — inverse sine -> radians
LOAD   CR1, NS[16]      ; Load SlideRule E-GT
DWRITE DR0, #0x3F800000 ; 1.0
CALL   CR1              ; DR0 <- 0x3FC90FDB (pi/2)
; |input| > 1.0: FAULT DOMAIN_ERROR`,
            'Acos': `; SlideRule.Acos — inverse cosine -> radians
LOAD   CR1, NS[16]      ; Load SlideRule E-GT
DWRITE DR0, #0x3F800000 ; 1.0
CALL   CR1              ; DR0 <- 0x00000000 (0.0)`,
            'Atan': `; SlideRule.Atan — inverse tangent -> radians
LOAD   CR1, NS[16]      ; Load SlideRule E-GT
DWRITE DR0, #0x3F800000 ; 1.0
CALL   CR1              ; DR0 <- 0x3F490FDB (pi/4)`,
            'ToDegrees': `; SlideRule.ToDegrees — radians to degrees
LOAD   CR1, NS[16]      ; Load SlideRule E-GT
DWRITE DR0, #0x40490FDB ; pi (3.14159 rad)
CALL   CR1              ; DR0 <- 0x43340000 (180.0 deg)
; Multiply by 180/pi internally`,
            'ToRadians': `; SlideRule.ToRadians — degrees to radians
LOAD   CR1, NS[16]      ; Load SlideRule E-GT
DWRITE DR0, #0x43340000 ; 180.0 degrees
CALL   CR1              ; DR0 <- 0x40490FDB (pi rad)
; Multiply by pi/180 internally`,
        },
        'Abacus': {
            'Add': `; Abacus.Add — integer addition (Turing domain data)
LOAD   CR1, NS[17]      ; Load Abacus E-GT
DWRITE DR0, #7
DWRITE DR1, #5
CALL   CR1              ; DR0 <- 12
; Overflow: sets V (overflow) flag`,
            'Sub': `; Abacus.Sub — integer subtract
LOAD   CR1, NS[17]      ; Load Abacus E-GT
DWRITE DR0, #10
DWRITE DR1, #3
CALL   CR1              ; DR0 <- 7
; Underflow: sets N (negative) flag`,
            'Mul': `; Abacus.Mul — integer multiply
LOAD   CR1, NS[17]      ; Load Abacus E-GT
DWRITE DR0, #6
DWRITE DR1, #7
CALL   CR1              ; DR0 <- 42`,
            'Div': `; Abacus.Div — integer divide
LOAD   CR1, NS[17]      ; Load Abacus E-GT
DWRITE DR0, #42
DWRITE DR1, #6
CALL   CR1              ; DR0 <- 7 (quotient)
; Div by zero: FAULT MATH_ERROR`,
            'Mod': `; Abacus.Mod — modulo (remainder)
LOAD   CR1, NS[17]      ; Load Abacus E-GT
DWRITE DR0, #17
DWRITE DR1, #5
CALL   CR1              ; DR0 <- 2`,
            'Abs': `; Abacus.Abs — absolute value
LOAD   CR1, NS[17]      ; Load Abacus E-GT
DWRITE DR0, #-42        ; Negative input (two's complement)
CALL   CR1              ; DR0 <- 42`,
        },
        'Constants': {
            'Pi': `; Constants.Pi — return pi as IEEE 754
LOAD   CR1, NS[18]      ; Load Constants E-GT
CALL   CR1              ; DR0 <- 0x40490FDB (3.14159265)`,
            'E': `; Constants.E — return Euler's number
LOAD   CR1, NS[18]      ; Load Constants E-GT
CALL   CR1              ; DR0 <- 0x402DF854 (2.71828183)`,
            'Phi': `; Constants.Phi — return golden ratio
LOAD   CR1, NS[18]      ; Load Constants E-GT
CALL   CR1              ; DR0 <- 0x3FCFBE77 (1.61803399)`,
            'Zero': `; Constants.Zero — return 0
LOAD   CR1, NS[18]      ; Load Constants E-GT
CALL   CR1              ; DR0 <- 0x00000000 (0.0)`,
            'One': `; Constants.One — return 1
LOAD   CR1, NS[18]      ; Load Constants E-GT
CALL   CR1              ; DR0 <- 0x3F800000 (1.0)`,
        },
        'Circle': {
            'Area': `; Circle.Area — pi * r^2 (delegates to SlideRule)
LOAD   CR1, NS[19]      ; Load Circle E-GT
DWRITE DR0, #0x40A00000 ; Radius: 5.0

CALL   CR1              ; Circle.Area internally:
;   1. LOAD CR2, NS[16] — get SlideRule GT
;   2. CALL SlideRule.Mul(r, r)      -> r^2 = 25.0
;   3. LOAD CR3, NS[18] — get Constants GT
;   4. CALL Constants.Pi             -> pi
;   5. CALL SlideRule.Mul(pi, r^2)   -> 78.5398
; DR0 <- 0x429CE5A0 (78.54)
; Circle has no trig itself — delegates to SlideRule`,
            'Circumference': `; Circle.Circumference — 2 * pi * r
LOAD   CR1, NS[19]      ; Load Circle E-GT
DWRITE DR0, #0x40A00000 ; Radius: 5.0

CALL   CR1              ; Circle.Circumference internally:
;   1. CALL Constants.Pi             -> pi
;   2. CALL SlideRule.Mul(2.0, pi)   -> 2*pi
;   3. CALL SlideRule.Mul(2pi, r)    -> 31.4159
; DR0 <- 0x41FB53D1 (31.416)`,
        },
        'SUCC': {
            'Apply': `; SUCC.Apply — Church successor via LAMBDA
; Church numerals use LAMBDA instruction, not CALL
; LAMBDA dispatches within an abstraction (not a security block)
LOAD   CR1, NS[20]      ; Load SUCC GT [X,L,E]
                         ;   X perm: code is a DATA-domain object
                         ;   SUCC's CLOOMC holds the reduction code
DWRITE DR0, #3          ; Church numeral 3

LAMBDA CR1, DR0         ; Apply SUCC:
                         ;   CR1 must have X perm (execute code)
                         ;   SUCC's code performs: f(f(f(x))) -> f(f(f(f(x))))
                         ;   i.e. add one application of f
; DR0 <- 4 (Church numeral for successor of 3)`,
        },
        'PRED': {
            'Apply': `; PRED.Apply — Church predecessor
LOAD   CR1, NS[21]      ; Load PRED GT [X,L,E]
DWRITE DR0, #5          ; Church numeral 5

LAMBDA CR1, DR0         ; Apply PRED:
                         ;   Removes one application of f
                         ;   f(f(f(f(f(x))))) -> f(f(f(f(x))))
; DR0 <- 4 (predecessor of 5)
; PRED(0) = 0 (Church numerals have no negatives)`,
        },
        'ADD': {
            'Apply': `; ADD.Apply — Church addition
LOAD   CR1, NS[22]      ; Load ADD GT [X,L,E]
DWRITE DR0, #3          ; First Church numeral
DWRITE DR1, #4          ; Second Church numeral

LAMBDA CR1, DR0         ; Apply ADD:
                         ;   ADD m n = apply SUCC m times to n
                         ;   3 + 4 = SUCC(SUCC(SUCC(4))) = 7
; DR0 <- 7`,
        },
        'SUB': {
            'Apply': `; SUB.Apply — Church subtraction
LOAD   CR1, NS[23]      ; Load SUB GT [X,L,E]
DWRITE DR0, #7
DWRITE DR1, #3

LAMBDA CR1, DR0         ; Apply SUB:
                         ;   SUB m n = apply PRED n times to m
                         ;   7 - 3 = PRED(PRED(PRED(7))) = 4
; DR0 <- 4
; SUB where n > m yields 0 (no negatives)`,
        },
        'MUL': {
            'Apply': `; MUL.Apply — Church multiplication
LOAD   CR1, NS[24]      ; Load MUL GT [X,L,E]
DWRITE DR0, #3
DWRITE DR1, #4

LAMBDA CR1, DR0         ; Apply MUL:
                         ;   MUL m n = compose m and n
                         ;   3 * 4 = apply (ADD 4) three times to 0
; DR0 <- 12`,
        },
        'ISZERO': {
            'Apply': `; ISZERO.Apply — Church zero test
LOAD   CR1, NS[25]      ; Load ISZERO GT [X,L,E]
DWRITE DR0, #0          ; Church numeral to test

LAMBDA CR1, DR0         ; Apply ISZERO:
                         ;   if numeral is 0 (no f applications):
                         ;     return TRUE (Church boolean)
                         ;   else:
                         ;     return FALSE
; DR0 <- TRUE (NS[26] GT) because input was 0`,
        },
        'PAIR': {
            'Apply': `; PAIR.Apply — Church pair constructor
LOAD   CR1, NS[43]      ; Load PAIR GT [X,L,E]
DWRITE DR0, #10         ; First element
DWRITE DR1, #20         ; Second element

LAMBDA CR1, DR0         ; Apply PAIR:
                         ;   Construct pair: \\f. f 10 20
                         ;   Extract first:  PAIR TRUE  -> 10
                         ;   Extract second: PAIR FALSE -> 20
; DR0 <- PAIR(10, 20) encoded as closure`,
        },
        'Family': {
            'Register': `; Family.Register — bind parent-child relationship
; The c-list IS the parental approval mechanism
LOAD   CR1, NS[28]      ; Load Family E-GT
LOAD   CR2, NS[50]      ; Parent GT (identifies parent)
LOAD   CR3, NS[51]      ; Child GT (identifies child)

CALL   CR1              ; Family.Register:
;   1. Verify CR2 is a valid parent GT (mLoad pipeline)
;   2. Verify CR3 is a valid child GT
;   3. Add parent GT to child's c-list (via Mint.Transfer)
;   4. Add child GT to parent's oversight c-list
;   5. Parent's c-list controls what child can access
; The c-list IS the parental control — not a filter,
; not a blocklist. The child can ONLY reach GTs in
; their c-list, and parent controls that c-list.`,
            'Hello': `; Family.Hello(target_GT) — greet any family member
; Mum is a GT, not a method name. Hello works with ANY GT.
LOAD   CR1, NS[28]      ; Load Family E-GT
LOAD   CR2, NS[50]      ; target_GT — could be:
                         ;   Mum's GT, Dad's GT, sibling's GT,
                         ;   teacher's GT, friend's GT...
                         ;   the GT carries the identity

CALL   CR1              ; Family.Hello(CR2):
;   1. mLoad validates target_GT (type, ver, seal, perms)
;   2. Verify target is in caller's c-list
;      (parent must have approved this contact)
;   3. Send greeting/request to target
;   4. Target receives via their own Family abstraction
; Hello(Mum_GT) sends to Mum
; Hello(Sibling_GT) sends to sibling
; Same method, different GT — that's capability security`,
            'Oversight': `; Family.Oversight — parent queries child activity
LOAD   CR1, NS[28]      ; Load Family E-GT
LOAD   CR2, NS[51]      ; Child GT

CALL   CR1              ; Family.Oversight:
;   1. Verify caller is parent (holds parent GT)
;   2. Read child's abstraction usage log
;   3. Report which GTs the child accessed
;   4. Report fault counts on child's blocks
; DR0 <- activity summary
; Parent can then Mint.Revoke any GT to restrict access`,
        },
        'Schoolroom': {
            'Join': `; Schoolroom.Join — student enters class
LOAD   CR1, NS[29]      ; Load Schoolroom E-GT
LOAD   CR2, NS[60]      ; Classroom GT (from student's c-list)
                         ;   Parent must have placed this GT there

CALL   CR1              ; Schoolroom.Join:
;   1. Verify classroom GT is valid (mLoad)
;   2. Verify student GT is in classroom's roster
;   3. Mint.Create a session GT for this student
;   4. Add lesson materials GTs to student's c-list`,
            'Lesson': `; Schoolroom.Lesson — teacher posts lesson material
LOAD   CR1, NS[29]      ; Load Schoolroom E-GT
LOAD   CR2, NS[60]      ; Classroom GT
LOAD   CR3, NS[70]      ; Lesson content GT (DATA object)

CALL   CR1              ; Schoolroom.Lesson:
;   1. Verify teacher GT has authority over classroom
;   2. Memory.Allocate for lesson storage
;   3. Mint.Create GT for lesson (X perm for students)
;   4. Mint.Transfer lesson GT to each student's c-list`,
            'Submit': `; Schoolroom.Submit — student submits work
LOAD   CR1, NS[29]      ; Load Schoolroom E-GT
LOAD   CR2, NS[71]      ; Work GT (student's DATA object)

CALL   CR1              ; Schoolroom.Submit:
;   1. Verify student is enrolled (has session GT)
;   2. Mint.Create a read-only GT for the work
;   3. Mint.Transfer work GT to teacher's c-list
;   4. Student keeps their R+W copy, teacher gets R only`,
            'Grade': `; Schoolroom.Grade — teacher grades submitted work
LOAD   CR1, NS[29]      ; Load Schoolroom E-GT
LOAD   CR2, NS[71]      ; Work GT (teacher's read copy)
DWRITE DR0, #85         ; Grade: 85%

CALL   CR1              ; Schoolroom.Grade:
;   1. Verify teacher authority
;   2. Memory.Allocate for grade record
;   3. Mint.Create grade GT, transfer to student's c-list
;   4. Student can LOAD the grade GT to see their score`,
        },
        'Friends': {
            'Request': `; Friends.Request — send friend request (parent-gated)
LOAD   CR1, NS[30]      ; Load Friends E-GT
LOAD   CR2, NS[52]      ; Target peer GT

CALL   CR1              ; Friends.Request:
;   1. Verify target is in caller's namespace
;   2. Create pending request (needs parent approval)
;   3. Negotiate.Propose for parent+peer-parent approval
;   4. Both parents must Negotiate.Approve before
;      any capability sharing is possible`,
            'Accept': `; Friends.Accept — accept friend request
LOAD   CR1, NS[30]      ; Load Friends E-GT
LOAD   CR2, NS[52]      ; Requester GT

CALL   CR1              ; Friends.Accept:
;   1. Verify pending request exists
;   2. Verify both parents have approved (Negotiate)
;   3. Mint.Create shared-space GT for both friends
;   4. Transfer shared GT to both c-lists`,
            'Share': `; Friends.Share — share capability with friend
LOAD   CR1, NS[30]      ; Load Friends E-GT
LOAD   CR2, NS[52]      ; Friend GT
LOAD   CR3, NS[80]      ; GT to share (capability)

CALL   CR1              ; Friends.Share:
;   1. Verify friendship exists (both accepted)
;   2. TPERM: restrict shared GT permissions
;      (friend gets <= what sharer holds)
;   3. Mint.Transfer restricted GT to friend's c-list
;   4. Original GT unchanged in sharer's c-list`,
            'Revoke': `; Friends.Revoke — revoke shared capability
LOAD   CR1, NS[30]      ; Load Friends E-GT
LOAD   CR2, NS[80]      ; GT to revoke

CALL   CR1              ; Friends.Revoke:
;   1. Mint.Revoke: increment version on NS entry
;   2. All copies of this GT (in friend's c-list) die
;   3. Friend's next mLoad hits version mismatch -> FAULT`,
        },
        'Tunnel': {
            'Connect': `; Tunnel.Connect — establish encrypted capability tunnel
; F-bit (Far) on NS entries routes through tunnels
LOAD   CR1, NS[31]      ; Load Tunnel E-GT
LOAD   CR2, NS[55]      ; Remote endpoint GT
                         ;   This GT has F-bit=1 in its NS entry
                         ;   word1[30] = 1 (Far/Foreign)

CALL   CR1              ; Tunnel.Connect:
;   1. Verify remote GT has F-bit set
;   2. Establish encrypted channel to remote namespace
;   3. GT type becomes Outform (type=10) for remote
;   4. All future LOAD/SAVE on this GT route through tunnel
;   5. mLoad step 6 detects F-bit, redirects to tunnel`,
            'Send': `; Tunnel.Send — send data via encrypted tunnel
LOAD   CR1, NS[31]      ; Load Tunnel E-GT
LOAD   CR2, NS[55]      ; Connected remote GT (F-bit=1)
DWRITE DR0, #0x48656C6C ; Payload data ("Hell")

CALL   CR1              ; Tunnel.Send:
;   1. Encrypt payload with tunnel key
;   2. Pack as capability-addressed message
;   3. Transmit via UART/network to remote node
;   4. Remote node validates GT on their end`,
            'Receive': `; Tunnel.Receive — receive via encrypted tunnel
LOAD   CR1, NS[31]      ; Load Tunnel E-GT

CALL   CR1              ; Tunnel.Receive:
;   1. Decrypt incoming message
;   2. Verify source GT matches tunnel endpoint
;   3. Deliver payload to caller
; DR0 <- received data
; If no data pending: Scheduler.Wait on tunnel event`,
            'Close': `; Tunnel.Close — close encrypted tunnel
LOAD   CR1, NS[31]      ; Load Tunnel E-GT
LOAD   CR2, NS[55]      ; Remote endpoint GT

CALL   CR1              ; Tunnel.Close:
;   1. Send close notification to remote
;   2. Clear F-bit on NS entry (word1[30] = 0)
;   3. Destroy tunnel key material
;   4. Future LOAD/SAVE on this GT fails (no tunnel)`,
        },
        'Negotiate': {
            'Propose': `; Negotiate.Propose — request special grant
; Dual-approval: parent AND teacher must both approve
LOAD   CR1, NS[32]      ; Load Negotiate E-GT
LOAD   CR2, NS[80]      ; Requested capability GT

CALL   CR1              ; Negotiate.Propose:
;   1. Create proposal record (Memory.Allocate)
;   2. Mint.Create proposal GT for parent
;   3. Mint.Create proposal GT for teacher
;   4. Both must Negotiate.Approve before grant
; DR0 <- proposal ID`,
            'Approve': `; Negotiate.Approve — parent or teacher approves
LOAD   CR1, NS[32]      ; Load Negotiate E-GT
DWRITE DR0, #1          ; Proposal ID

CALL   CR1              ; Negotiate.Approve:
;   1. Verify caller is authorized approver
;   2. Record approval (parent or teacher)
;   3. If BOTH have approved:
;      a. Mint.Create the requested GT
;      b. Mint.Transfer to child's c-list
;      c. Log grant for audit trail
;   4. If only one approved: wait for other`,
            'Reject': `; Negotiate.Reject — reject proposal
LOAD   CR1, NS[32]      ; Load Negotiate E-GT
DWRITE DR0, #1          ; Proposal ID

CALL   CR1              ; Negotiate.Reject:
;   1. Mark proposal as rejected
;   2. Mint.Revoke proposal GTs
;   3. Notify other approver of rejection`,
            'Status': `; Negotiate.Status — check proposal state
LOAD   CR1, NS[32]      ; Load Negotiate E-GT
DWRITE DR0, #1          ; Proposal ID

CALL   CR1              ; Negotiate.Status:
; DR0 <- status: 0=pending, 1=parent_ok,
;   2=teacher_ok, 3=both_approved, 4=rejected`,
        },
        'Editor': {
            'Open': `; Editor.Open — open source file from namespace
LOAD   CR1, NS[33]      ; Load Editor E-GT
LOAD   CR2, NS[80]      ; File GT (DATA-domain object, R+W)
                         ;   mLoad validates R perm for reading

CALL   CR1              ; Editor.Open:
;   1. mLoad CR2 (validates type, ver, seal, R perm)
;   2. DREAD file contents from location (word0)
;      up to limit (word1[16:0]) bytes
;   3. Load into editor buffer
;   4. File is a DATA object — Turing domain (R+W)`,
            'Save': `; Editor.Save — save source to namespace
LOAD   CR1, NS[33]      ; Load Editor E-GT

CALL   CR1              ; Editor.Save:
;   1. Get editor buffer contents
;   2. If no existing slot: Memory.Allocate new DATA slot
;   3. DWRITE buffer to mem[location] (W perm required)
;   4. Recompute seal: CRC-16(word0, word1) for integrity
;   5. Update word2 = (gt_seq << 25) | newCRC`,
            'Load': `; Editor.Load — load source from NS slot into editor
LOAD   CR1, NS[33]      ; Load Editor E-GT
DWRITE DR0, #80         ; NS slot containing source

CALL   CR1              ; Editor.Load:
;   1. LOAD GT for NS[80] (needs L perm in c-list)
;   2. mLoad validates: type, ver, seal, bounds
;   3. DREAD contents into editor buffer
;   4. Source is DATA domain — code is never Church domain`,
            'Undo': `; Editor.Undo — undo last edit
LOAD   CR1, NS[33]      ; Load Editor E-GT

CALL   CR1              ; Editor.Undo:
;   1. Pop previous state from undo stack
;   2. Restore editor buffer
;   3. Stack managed via Stack abstraction internally`,
        },
        'Assembler': {
            'Assemble': `; Assembler.Assemble — source to machine code
; Output is a DATA-domain object (code is DATA, not Church)
LOAD   CR1, NS[34]      ; Load Assembler E-GT
LOAD   CR2, NS[80]      ; Source GT (DATA object, R perm)

CALL   CR1              ; Assembler.Assemble:
;   1. DREAD source text from CR2's location
;   2. Parse assembly mnemonics
;   3. Encode each instruction as 32-bit word:
;      opcode(5)|cond(4)|dst(4)|src(4)|imm(15)
;   4. Memory.Allocate for output binary (new DATA slot)
;   5. DWRITE binary to new slot
;   6. Mint.Create GT for binary (R+X perms)
;      Code is a DATA-domain object with X permission
; CR2 <- binary GT (DATA domain, X perm for execution)`,
            'Disassemble': `; Assembler.Disassemble — binary to assembly text
LOAD   CR1, NS[34]      ; Load Assembler E-GT
LOAD   CR2, NS[81]      ; Binary GT (DATA object, X perm)

CALL   CR1              ; Assembler.Disassemble:
;   1. DREAD binary words from CR2's location
;   2. Decode each 32-bit instruction:
;      opcode(5)|cond(4)|dst(4)|src(4)|imm(15)
;   3. Generate assembly text
;   4. Memory.Allocate for output text
;   5. Mint.Create GT for text (R+W perms)
; CR2 <- source text GT`,
            'Validate': `; Assembler.Validate — check code validity
LOAD   CR1, NS[34]      ; Load Assembler E-GT
LOAD   CR2, NS[80]      ; Source GT

CALL   CR1              ; Assembler.Validate:
;   1. Parse source for syntax errors
;   2. Check register references (CR0-15, DR0-15)
;   3. Verify condition codes (EQ,NE,CS,CC,MI,PL,...)
;   4. Check opcode encoding fits 5-bit field
; DR0 <- 1 if valid, 0 if errors found
; DR1 <- error count`,
        },
        'Debugger': {
            'Step': `; Debugger.Step — single-step one instruction
LOAD   CR1, NS[35]      ; Load Debugger E-GT

CALL   CR1              ; Debugger.Step:
;   1. Fetch instruction at current PC
;   2. Decode: opcode(5)|cond(4)|dst(4)|src(4)|imm(15)
;   3. Evaluate condition code against flags (N,Z,C,V)
;   4. If condition met: execute instruction
;   5. If LOAD/CALL: run full mLoad 7-step pipeline
;   6. Update PC, flags, step counter
;   7. Return state snapshot to IDE`,
            'Run': `; Debugger.Run — run until halt or breakpoint
LOAD   CR1, NS[35]      ; Load Debugger E-GT

CALL   CR1              ; Debugger.Run:
;   1. Loop: fetch-decode-execute
;   2. Check breakpoint list each cycle
;   3. If PC matches breakpoint: halt, report
;   4. If FAULT: halt, report fault type and PC
;   5. Max steps limit prevents infinite loops`,
            'Breakpoint': `; Debugger.Breakpoint — set/clear breakpoint
LOAD   CR1, NS[35]      ; Load Debugger E-GT
DWRITE DR0, #0x0040     ; Address to break at

CALL   CR1              ; Debugger.Breakpoint:
;   1. If address already has breakpoint: clear it
;   2. If no breakpoint: set one at DR0
;   3. Breakpoints stored in debugger's DATA slot`,
            'Inspect': `; Debugger.Inspect — inspect register or memory
LOAD   CR1, NS[35]      ; Load Debugger E-GT
DWRITE DR0, #0x0100     ; Memory address to inspect

CALL   CR1              ; Debugger.Inspect:
;   1. If address is in NS table range (>= 0xFD00):
;      read NS entry (3 words), decode fields
;   2. If address is in data memory:
;      DREAD the word at that address
;   3. Return decoded view (GT fields, NS entry fields)
; DR0 <- value at inspected address`,
        },
        'Deployer': (function() {
            const b = getSelectedBoard();
            const isTi60 = b === 'ti60-f225';
            const chip     = isTi60 ? 'Efinix Ti60F225' : 'Gowin GW2AR-18';
            const brdName  = isTi60 ? 'Ti60 F225' : 'Tang Nano 20K';
            const uartNote = isTi60 ? ';   3. UART via FTDI FT232H USB bridge (50MHz clock)' : ';   3. UART TX on pin 69 -> BL616 USB bridge';
            const clkNote  = isTi60 ? ';   5. 50MHz clock begins instruction execution' : ';   5. 27MHz clock begins instruction execution';
            const bootLine = isTi60 ? `;   2. ${brdName} begins executing from boot vector` : `;   2. ${brdName} begins executing from boot vector`;
            return {
                'Build': `; Deployer.Build — compile binary for ${brdName}\nLOAD   CR1, NS[36]      ; Load Deployer E-GT\nLOAD   CR2, NS[81]      ; Binary GT (DATA object)\n\nCALL   CR1              ; Deployer.Build:\n;   1. DREAD binary from CR2's location\n;   2. Add boot vector and NS table initialization\n;   3. Package for FPGA: ${chip} bitstream\n;   4. Memory.Allocate for deployment image\n;   5. Mint.Create GT for image\n; CR2 <- deployment image GT`,
                'Upload': `; Deployer.Upload — send to ${brdName} via UART\nLOAD   CR1, NS[36]      ; Load Deployer E-GT\n\nCALL   CR1              ; Deployer.Upload:\n;   1. LOAD UART GT from c-list (NS[11])\n;   2. For each word in deployment image:\n;      SAVE word to UART (S perm on UART GT)\n${uartNote}\n;   4. Wait for ACK after each block`,
                'Verify': `; Deployer.Verify — verify upload integrity\nLOAD   CR1, NS[36]      ; Load Deployer E-GT\n\nCALL   CR1              ; Deployer.Verify:\n;   1. Request readback from ${brdName} via UART\n;   2. LOAD bytes from UART (L perm)\n;   3. Compare against original image\n;   4. Compute checksum match\n; DR0 <- 1 if verified, 0 if mismatch`,
                'Boot': `; Deployer.Boot — boot the FPGA\nLOAD   CR1, NS[36]      ; Load Deployer E-GT\n\nCALL   CR1              ; Deployer.Boot:\n;   1. Send boot command via UART\n${bootLine}\n;   3. FPGA initializes NS table (slots 0-45)\n;   4. Boot -> Salvation -> Navana (same as simulator)\n${clkNote}`,
            };
        })(),
        'Browser': {
            'Navigate': `; Browser.Navigate — go to GT-addressed site
; No URLs, no DNS — only capability-addressed resources
LOAD   CR1, NS[37]      ; Load Browser E-GT [L,E]
LOAD   CR2, NS[90]      ; Site GT from child's c-list
                         ;   Parent placed this GT in the c-list
                         ;   Child can ONLY reach sites in c-list

CALL   CR1              ; Browser.Navigate:
;   1. mLoad validates site GT (type, ver, seal, L perm)
;   2. If F-bit=1: route through Tunnel (encrypted)
;   3. LOAD page content via L perm on site GT
;   4. Render content in display
; No ambient authority — no way to reach unlisted sites`,
            'Back': `; Browser.Back — navigate back
LOAD   CR1, NS[37]      ; Load Browser E-GT
CALL   CR1              ; Pop previous site GT from history stack`,
            'Bookmark': `; Browser.Bookmark — save GT bookmark to c-list
LOAD   CR1, NS[37]      ; Load Browser E-GT
LOAD   CR2, NS[90]      ; Site GT to bookmark

CALL   CR1              ; Browser.Bookmark:
;   1. Verify GT is valid (mLoad)
;   2. SAVE GT to bookmark c-list (S perm)
;   3. Bookmark is just a GT in the c-list`,
            'Search': `; Browser.Search — search within GT scope
LOAD   CR1, NS[37]      ; Load Browser E-GT [L,E]
LOAD   CR2, NS[91]      ; Search scope GT (e.g. library site)

CALL   CR1              ; Browser.Search:
;   1. LOAD search index via L perm on scope GT
;   2. Results are GTs in the scope's c-list
;   3. Child can only see results parent approved`,
        },
        'Messenger': {
            'Send': `; Messenger.Send — send message to approved contact
LOAD   CR1, NS[38]      ; Load Messenger E-GT [L,E]
LOAD   CR2, NS[50]      ; Recipient GT (must be in c-list)
LOAD   CR3, NS[85]      ; Message content GT (DATA object)

CALL   CR1              ; Messenger.Send:
;   1. Verify recipient GT is in caller's c-list
;      (parent must have approved this contact)
;   2. If F-bit=1: route via Tunnel (encrypted)
;   3. SAVE message to recipient's inbox c-list
;   4. Signal recipient via DijkstraFlag`,
            'Receive': `; Messenger.Receive — read incoming message
LOAD   CR1, NS[38]      ; Load Messenger E-GT [L,E]

CALL   CR1              ; Messenger.Receive:
;   1. LOAD from inbox c-list (L perm)
;   2. Dequeue oldest message GT
;   3. If no messages: Scheduler.Wait on inbox event
; CR2 <- message content GT (DATA object)`,
            'Contacts': `; Messenger.Contacts — list parent-approved contacts
LOAD   CR1, NS[38]      ; Load Messenger E-GT [L,E]

CALL   CR1              ; Messenger.Contacts:
;   1. Walk the contact c-list
;   2. Each contact is a GT placed by parent
;   3. Return count and list of valid GTs
; DR0 <- number of approved contacts`,
            'Block': `; Messenger.Block — block a contact
LOAD   CR1, NS[38]      ; Load Messenger E-GT
LOAD   CR2, NS[52]      ; Contact GT to block

CALL   CR1              ; Messenger.Block:
;   1. Mint.Revoke the contact GT (version bump)
;   2. Contact can no longer send messages
;   3. Parent notified via Family.Oversight`,
        },
        'Photos': {
            'View': `; Photos.View — view a photo
LOAD   CR1, NS[39]      ; Load Photos E-GT [L,E]
LOAD   CR2, NS[85]      ; Photo GT (DATA object)

CALL   CR1              ; Photos.View:
;   1. mLoad validates photo GT (type, ver, seal, L perm)
;   2. DREAD photo data from location (word0)
;   3. Render on Display (via Display.Write with S perm)`,
            'Share': `; Photos.Share — share photo with GT
LOAD   CR1, NS[39]      ; Load Photos E-GT
LOAD   CR2, NS[85]      ; Photo GT
LOAD   CR3, NS[50]      ; Recipient GT

CALL   CR1              ; Photos.Share:
;   1. TPERM: create read-only copy of photo GT (L only)
;   2. Mint.Transfer restricted GT to recipient's c-list
;   3. Recipient can View but not modify`,
            'Upload': `; Photos.Upload — upload new photo
LOAD   CR1, NS[39]      ; Load Photos E-GT
LOAD   CR2, NS[86]      ; Photo data GT (DATA object, R+W)

CALL   CR1              ; Photos.Upload:
;   1. Memory.Allocate for photo storage
;   2. DWRITE photo data to new slot
;   3. Mint.Create GT with L perm (view-only)
;   4. Compute seal for integrity verification`,
            'Album': `; Photos.Album — manage photo album
LOAD   CR1, NS[39]      ; Load Photos E-GT

CALL   CR1              ; Photos.Album:
;   1. Walk album c-list (each entry is a photo GT)
;   2. Return count and metadata
; DR0 <- album entry count`,
        },
        'Social': {
            'Post': `; Social.Post — post content to feed
LOAD   CR1, NS[40]      ; Load Social E-GT [L,E]
LOAD   CR2, NS[85]      ; Content GT (DATA object)

CALL   CR1              ; Social.Post:
;   1. Memory.Allocate for post storage
;   2. DWRITE content to new slot
;   3. Mint.Create GT for post (L perm for followers)
;   4. Distribute post GT to followers' feed c-lists`,
            'Read': `; Social.Read — read feed
LOAD   CR1, NS[40]      ; Load Social E-GT [L,E]

CALL   CR1              ; Social.Read:
;   1. Walk feed c-list (each entry is a post GT)
;   2. LOAD post content via L perm on each GT
; CR2 <- next feed entry GT`,
            'Follow': `; Social.Follow — follow an account
LOAD   CR1, NS[40]      ; Load Social E-GT
LOAD   CR2, NS[55]      ; Account GT (must be in c-list)

CALL   CR1              ; Social.Follow:
;   1. Verify account GT is parent-approved
;   2. Request follow via Negotiate (if needed)
;   3. Account's posts will appear in feed c-list`,
            'Feed': `; Social.Feed — get feed items
LOAD   CR1, NS[40]      ; Load Social E-GT

CALL   CR1              ; Social.Feed:
;   1. Count entries in feed c-list
; DR0 <- number of feed items available`,
        },
        'Video': {
            'Watch': `; Video.Watch — play a video
LOAD   CR1, NS[41]      ; Load Video E-GT [L,E]
LOAD   CR2, NS[85]      ; Video GT (DATA object)

CALL   CR1              ; Video.Watch:
;   1. mLoad validates video GT (L perm required)
;   2. DREAD video data from location
;   3. If F-bit=1: stream via Tunnel (encrypted)
;   4. Render on Display via S perm`,
            'Search': `; Video.Search — search videos within GT scope
LOAD   CR1, NS[41]      ; Load Video E-GT
LOAD   CR2, NS[91]      ; Search scope GT (library/channel)

CALL   CR1              ; Video.Search:
;   1. LOAD search index via L perm on scope GT
;   2. Results filtered to parent-approved GTs only
;   3. Results placed in caller's c-list`,
            'Playlist': `; Video.Playlist — manage playlist
LOAD   CR1, NS[41]      ; Load Video E-GT

CALL   CR1              ; Video.Playlist:
;   1. Walk playlist c-list
;   2. Each entry is a video GT
; DR0 <- playlist length`,
            'Share': `; Video.Share — share video GT
LOAD   CR1, NS[41]      ; Load Video E-GT
LOAD   CR2, NS[85]      ; Video GT
LOAD   CR3, NS[50]      ; Recipient GT

CALL   CR1              ; Video.Share:
;   1. TPERM: restrict to L-only (view but not copy)
;   2. Mint.Transfer to recipient's c-list`,
        },
        'Email': {
            'Compose': `; Email.Compose — compose and send email
LOAD   CR1, NS[42]      ; Load Email E-GT [L,E]
LOAD   CR2, NS[50]      ; Recipient GT (must be in contacts c-list)
LOAD   CR3, NS[85]      ; Body GT (DATA object)

CALL   CR1              ; Email.Compose:
;   1. Verify recipient GT in contacts c-list
;   2. Memory.Allocate for email storage
;   3. DWRITE body to new slot
;   4. Mint.Create email GT
;   5. If F-bit=1: route via Tunnel (encrypted)
;   6. SAVE to recipient's inbox c-list`,
            'Read': `; Email.Read — read incoming email
LOAD   CR1, NS[42]      ; Load Email E-GT [L,E]

CALL   CR1              ; Email.Read:
;   1. LOAD from inbox c-list (L perm)
;   2. Dequeue oldest email GT
;   3. DREAD email body from GT's location
; CR2 <- email content GT`,
            'Reply': `; Email.Reply — reply to an email
LOAD   CR1, NS[42]      ; Load Email E-GT
LOAD   CR2, NS[86]      ; Original email GT (for thread)
LOAD   CR3, NS[85]      ; Reply body GT (DATA object)

CALL   CR1              ; Email.Reply:
;   1. Extract sender GT from original email
;   2. Verify sender is still in contacts c-list
;   3. Memory.Allocate for reply
;   4. Link reply to original (thread chain via GTs)
;   5. Send via same path as Compose`,
            'Contacts': `; Email.Contacts — list email contacts
LOAD   CR1, NS[42]      ; Load Email E-GT

CALL   CR1              ; Email.Contacts:
;   1. Walk email contacts c-list
;   2. Each contact is a GT placed by parent
; DR0 <- number of email contacts`,
        },
        'GC': {
            'Scan': `; GC.Scan — mark live entries via G-bit
; PP250 deterministic GC with bidirectional G-bit
; G-bit in word1[29] of each NS entry
LOAD   CR1, NS[44]      ; Load GC E-GT

CALL   CR1              ; GC.Scan:
;   1. Walk all 16 CRs (CR0-CR15):
;      for each valid CR with a GT:
;        extract index from GT bits [24:8]
;        read NS[index].word1
;        set G-bit (word1[29] = current polarity)
;   2. Walk all c-list entries reachable from CRs:
;      for each GT in c-list:
;        set G-bit on referenced NS entry
;   3. Any entry NOT marked is garbage
; mLoad step 7 also resets G-bit on every access`,
            'Identify': `; GC.Identify — find garbage entries
LOAD   CR1, NS[44]      ; Load GC E-GT

CALL   CR1              ; GC.Identify:
;   1. Scan NS table (slots 46..nsCount):
;      read word1[29] (G-bit) for each entry
;      if G-bit != current polarity: entry is garbage
;   2. Build garbage list
; DR0 <- number of garbage entries found
; Skip boot slots 0-45 (always live)`,
            'Clear': `; GC.Clear — zero garbage memory
LOAD   CR1, NS[44]      ; Load GC E-GT

CALL   CR1              ; GC.Clear:
;   1. For each garbage entry from Identify:
;      zero word0 (location = 0)
;      zero word1 (limit/flags = 0)
;      preserve word2 (version stays for stale GT detection)
;   2. Memory at old locations now free
;   3. Slots available for Memory.Allocate reuse
; DR0 <- number of entries cleared`,
            'Flip': `; GC.Flip — invert GC polarity
LOAD   CR1, NS[44]      ; Load GC E-GT

CALL   CR1              ; GC.Flip:
;   1. Toggle polarity flag (0 -> 1 or 1 -> 0)
;   2. After flip, ALL entries appear as garbage
;      until next Scan marks live ones
;   3. This enables the bidirectional GC cycle:
;      Scan(polarity=0) -> Identify -> Clear
;      Flip
;      Scan(polarity=1) -> Identify -> Clear
;      Flip ... (repeat)`,
        },
        'Thread': {
            'switchTo': `; Thread.switchTo(thread_GT) — context switch to target thread
; CR0 holds Thread GT with E perm (obtained from Scheduler c-list)
TPERM  CR0, E           ; verify E perm on thread GT
CHANGE AL, CR0, CR0, #0 ; CHANGE: save calling thread context into
                         ;   its lump (DR0-15, PC, FLAGS, STO, CR12,
                         ;   CR14, CR15), then restore target thread
                         ;   context from its lump and resume at
                         ;   saved PC. CR0 indexes the thread c-list.
; After CHANGE: execution continues in the target thread`,
            'Kill': `; Thread.Kill(thread_GT) — terminate target thread
; CR1 holds target Thread GT (E perm)
TPERM  CR1, E           ; verify E perm — must hold thread GT
CALL   CR_mem, #Free    ; Memory.Free(thread_GT.lumpBase) —
                         ;   release thread lump back to allocator
CALL   CR_mint, #Revoke ; Mint.Revoke(thread_GT) —
                         ;   increment gt_seq in NS entry;
                         ;   all live copies of the GT instantly
                         ;   become version-mismatched (dead)
; Thread is now fully terminated: lump freed, GT revoked`,
            'Compile': `; Thread.Compile(f_GT) — create a new thread, f is the start abstraction
; CR1 holds f_GT (E perm) — the initial abstraction to run
TPERM  CR1, E           ; verify E perm on start abstraction
CALL   CR_mem, #Alloc   ; Memory.Allocate(lumpSize) ->
                         ;   lump: [GT zone 12w][LIFO stack][heap][DR 16w]
CALL   CR_mint, #Create ; Mint.Create(Inform, lumpSize, perms=0) ->
                         ;   CR12 of new thread (zero-perm Inform GT)
                         ;   word0_location = lump base
                         ;   word0_limit    = lumpSize - 1
DWRITE DR0, lump[0]     ; store f_GT into new thread's GT zone word 0
                         ;   (CR0 of the new thread = first-call slot)
; Returns: new Thread GT — call Thread.switchTo to begin execution`,
        },
        'Boot.Thread': {
            'run': `; Boot.Thread.run — B:02 INIT_THRD boot step (Slot 1)
; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
; This method IS the thread — it has no entry point.
; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

B:02  INIT_THRD
      GT12 ← createGT(Slot=1, perms=[none], type=Inform)
      entry ← mLoad(GT12)       ; load NS entry for Slot 1
      CR12 ← { word0=GT12, word1=entry.base,
               word2=entry.word1_limit, word3=entry.seals }
      ; CR12 = Thread identity — Priv zone, zero perms
      ; Informs-only: cannot be used for direct CALL  ◄── see below

; ── What does the last line mean? ─────────────────
;
; CR12 holds an Inform GT: perms=[none] means no E-bit.
; In the Church Machine, CALL requires E perm on the GT
; in CR6. CR12 carries the thread's *identity*, not its
; *entry point*. It is an Inform — it answers "who am I?"
; not "how do you call me?".
;
; The thread does NOT run by being invoked.
; It runs because it IS the hardware execution context:
;   - The STEP controller advances PC each cycle through
;     the thread's code lump, unconditionally.
;   - No CALL instruction is needed; the thread simply is.
;
; To switch threads: Thread.switchTo(thread_GT)
;   — that requires E perm on the *Thread GT* (not CR12),
;     and uses CHANGE to save/restore full register state.
;
; An Inform is a capability with zero permissions.
; It can be passed, stored, and compared, but never used
; to invoke computation. The thread identity tells the
; system "thread 0 exists here" — nothing more.`,
        },
    };
    const base = Object.assign({}, examples[abs.name] || {});
    for (const m of abs.methods) {
        const key = `${abs.index}:${m}`;
        if (userMethodData[key] && userMethodData[key].example) {
            base[m] = userMethodData[key].example;
        }
    }
    return base;
}

function assembleAndLoad() {
    const editor = document.getElementById('asmEditor');
    if (!editor) return;
    const source = editor.value;
    saveEditorState();

    const result = assembler.assemble(source);

    const con = document.getElementById('editorConsole');
    if (result.errors.length > 0) {
        const errText = result.errors.map(e => `Line ${e.line}: ${e.message}`).join('\n');
        if (con) con.textContent = `Assembly errors:\n${errText}`;
        showNextSteps('error');
        return;
    }

    sim.loadProgram(result.words, 0);
    lastAssembledWords = result.words.slice();

    const abstrBase2 = sim.NS_TABLE_BASE + 2 * sim.NS_ENTRY_WORDS;
    const progBase = sim.bootComplete ? (sim.memory[abstrBase2] || (2 * sim.SLOT_SIZE)) : 0;
    sim.programBaseAddr = progBase;
    sim.programLabels = result.labels || {};
    const entryLabel = Object.keys(result.labels || {}).find(k => (result.labels[k] === 0)) || null;
    sim.programName = entryLabel || (Object.keys(result.labels || {})[0]) || 'prog';
    if (pipelineViz) pipelineViz.setNIA(null);

    let listing = `Assembled ${result.words.length} instructions:\n`;
    for (let i = 0; i < result.words.length; i++) {
        listing += `  ${i.toString().padStart(4)}: 0x${result.words[i].toString(16).padStart(8, '0')}  ${assembler.disassemble(result.words[i])}\n`;
    }
    if (con) con.textContent = listing;
    showNextSteps('assembled');

    const saveBtn = document.getElementById('btnSaveNS');
    if (saveBtn) saveBtn.disabled = false;

    updateDashboard();
}

function _nsOwnerOf(addr) {
    if (!sim || !sim.nsCount) return null;
    for (let i = 0; i < sim.nsCount; i++) {
        const nsBase  = sim.NS_TABLE_BASE + i * sim.NS_ENTRY_WORDS;
        const loc     = sim.memory[nsBase];
        const w1      = sim.memory[nsBase + 1];
        if (!loc && !w1) continue;
        const limit   = w1 & 0x1FFFF;
        if (addr >= loc && addr < loc + limit) {
            return { label: sim.nsLabels[i] || `NS[${i}]`, nsIdx: i, offset: addr - loc };
        }
    }
    return null;
}

function _niaMeta(addr) {
    if (addr === null || addr === undefined || addr < 0) return null;
    const word = (sim.memory && addr < sim.memory.length) ? sim.memory[addr] : 0;
    const dis = (typeof assembler !== 'undefined' && assembler) ? assembler.disassemble(word) : '';
    const base   = sim.programBaseAddr || 0;
    const labels = sim.programLabels  || {};
    const rel    = addr - base;
    let bestName = null, bestDist = Infinity;
    for (const [name, labelRel] of Object.entries(labels)) {
        const dist = rel - labelRel;
        if (dist >= 0 && dist < bestDist) { bestDist = dist; bestName = name; }
    }
    const ns = !bestName ? _nsOwnerOf(addr) : null;
    return {
        addr,
        disasm: dis || (word === 0 ? 'HALT' : `0x${word.toString(16).padStart(8,'0')}`),
        label:  bestName || (ns ? ns.label : null),
        offset: bestName ? bestDist : (ns ? ns.offset : null),
        prog:   sim.programName || ''
    };
}

function _buildNIARows(prevAddr, currAddr) {
    return {
        last: _niaMeta(prevAddr),
        curr: _niaMeta(currAddr),
        next: _niaMeta(currAddr !== null && currAddr !== undefined ? currAddr + 1 : null)
    };
}

const _BOOT_STEPS = [
    { addrStr: 'B:00', disasm: 'FAULT_RST',  label: 'Clear all CRs / DRs',    offset: null, prog: 'boot' },
    { addrStr: 'B:01', disasm: 'LOAD_NS',    label: 'CR15 \u2190 NS[0] Namespace (base=0x0000, full memory)',  offset: null, prog: 'boot' },
    { addrStr: 'B:02', disasm: 'INIT_THRD',  label: 'CR12 \u2190 NS[1] Thread Identity', offset: null, prog: 'boot' },
    { addrStr: 'B:03', disasm: 'INIT_ABSTR \u2b64 LOAD_NUC \u2b64 COMPLETE', label: 'CR6(E) \u2190 NS[2]; CR14+CR6 \u2190 lump header; M-Elev OFF; boot done', offset: null, prog: 'boot' },
];

function _bootNIARows(bootStep) {
    const prevIdx = bootStep - 1;
    const currIdx = bootStep;
    const nextIdx = bootStep + 1;
    return {
        last: prevIdx >= 0 ? _BOOT_STEPS[prevIdx] : null,
        curr: _BOOT_STEPS[currIdx] || null,
        next: nextIdx < _BOOT_STEPS.length ? _BOOT_STEPS[nextIdx] : null,
    };
}

function stepSim() {
    switchView('dashboard');
    if (!sim.bootComplete) {
        sim.auditLog = [];
        try {
            sim._bootStep();
        } catch(e) {
            console.error('stepSim _bootStep error:', e);
            updateDashboard();
            return;
        }
        const con = document.getElementById('editorConsole');
        if (con) {
            con.textContent += `\n[boot ${sim.bootStep}/4] ${sim.output.split('\n').filter(l => l).pop()}`;
            con.scrollTop = con.scrollHeight;
        }
        if (pipelineViz) {
            pipelineViz.setNIA(_bootNIARows(sim.bootStep));
            if (pipelineViz.mode === 'audit') {
                pipelineViz.showFullPipeline(sim.auditLog.map(a => {
                    const checks = Object.entries(a.checks).map(([k, v]) => ({ name: k.toUpperCase(), pass: v.pass, perm: v.perm || null }));
                    return { stage: a.gate, type: a.gate, desc: `${a.gate}(NS[${a.nsIndex}]="${a.label}"${a.requiredPerm ? ', '+a.requiredPerm : ''})`, label: a.label, nsIndex: a.nsIndex, requiredPerm: a.requiredPerm, checks, status: a.result, b: a.b, f: a.f };
                }));
            } else {
                pipelineViz.render();
            }
        }
        if (sim.bootComplete) {
            _autoLoadDefaultProgram();
        }
        updateDashboard();
        return;
    }
    let result;
    try {
        result = sim.step();
    } catch(e) {
        console.error('stepSim step error:', e);
        updateDashboard();
        return;
    }
    if (result) {
        const con = document.getElementById('editorConsole');
        if (con) {
            con.textContent += `\n[${sim.stepCount}] ${result.desc || 'executed'}`;
            con.scrollTop = con.scrollHeight;
        }
        if (pipelineViz) {
            pipelineViz.setNIA(_buildNIARows(result.pc, sim.pc));
            if (pipelineViz.mode === 'audit' && result.auditPipeline) {
                pipelineViz.showFullPipeline(result.auditPipeline);
            } else if (result.pipeline) {
                pipelineViz.showFullPipeline(result.pipeline);
            }
        }
    }
    updateDashboard();
}

let walkRunning = false;
let walkTimer = null;

function updateWalkBtn() {
    const btn = document.getElementById('toolWalkBtn');
    if (!btn) return;
    if (walkRunning) {
        btn.classList.add('walk-active');
        btn.setAttribute('data-tooltip', 'Walk (running) — Click to stop');
    } else {
        btn.classList.remove('walk-active');
        btn.setAttribute('data-tooltip', 'Walk — Animate step-by-step execution');
    }
}

function walkToggle() {
    if (walkRunning) {
        walkRunning = false;
        if (walkTimer) { clearTimeout(walkTimer); walkTimer = null; }
        if (pipelineViz) pipelineViz.stopAnimation();
        updateWalkBtn();
        updateDashboard();
        return;
    }
    if (!sim.bootComplete) {
        slowBoot();
        const waitForBoot = setInterval(() => {
            if (sim.bootComplete && !bootAnimating) {
                clearInterval(waitForBoot);
                walkRunning = true;
                switchView('pipeline');
                updateWalkBtn();
                updateDashboard();
                walkNext();
            }
        }, 200);
        return;
    }
    walkRunning = true;
    switchView('pipeline');
    updateWalkBtn();
    updateDashboard();
    walkNext();
}

function walkNext() {
    if (!walkRunning || !sim.bootComplete) {
        walkRunning = false;
        updateWalkBtn();
        updateDashboard();
        return;
    }
    const result = sim.step();
    if (!result) {
        walkRunning = false;
        updateWalkBtn();
        updateDashboard();
        return;
    }
    const con = document.getElementById('editorConsole');
    if (con) {
        con.textContent += `\n[${sim.stepCount}] ${result.desc || 'executed'}`;
        con.scrollTop = con.scrollHeight;
    }
    if (result.pipeline && pipelineViz) {
        pipelineViz.setNIA(_buildNIARows(result.pc, sim.pc));
        pipelineViz.animate(result.pipeline, 500).then(() => {
            updateDashboard();
            if (walkRunning && sim.bootComplete) {
                walkTimer = setTimeout(walkNext, 600);
            } else {
                walkRunning = false;
                updateWalkBtn();
                updateDashboard();
            }
        }).catch(err => {
            console.error('walkNext animate error:', err);
            walkRunning = false;
            updateWalkBtn();
            updateDashboard();
        });
    } else {
        updateDashboard();
        if (walkRunning && sim.bootComplete) {
            walkTimer = setTimeout(walkNext, 1000);
        } else {
            walkRunning = false;
            updateWalkBtn();
            updateDashboard();
        }
    }
}

let bootAnimating = false;
let _defaultProgramLoaded = false;
function _autoLoadDefaultProgram() {
    if (_defaultProgramLoaded) return;
    _defaultProgramLoaded = true;
    loadExample('led_blink');
    assembleAndLoad();
}
function slowBoot() {
    if (bootAnimating || sim.bootComplete) return;
    bootAnimating = true;
    const delay = 800;
    function nextPhase() {
        try {
            if (sim.bootComplete) {
                bootAnimating = false;
                const con = document.getElementById('editorConsole');
                if (con) {
                    con.textContent += '\n--- Boot sequence complete ---';
                    con.scrollTop = con.scrollHeight;
                }
                if (pipelineViz) { pipelineViz.setNIA(null); pipelineViz.render(); }
                _autoLoadDefaultProgram();
                updateDashboard();
                return;
            }
            sim._bootStep();
            const con = document.getElementById('editorConsole');
            if (con) {
                const lastLine = (sim.output || '').split('\n').filter(l => l).pop() || '';
                con.textContent += `\n[boot ${sim.bootStep}/4] ${lastLine}`;
                con.scrollTop = con.scrollHeight;
            }
            if (pipelineViz) {
                pipelineViz.setNIA(_bootNIARows(sim.bootStep));
                pipelineViz.render();
            }
            updateDashboard();
            setTimeout(nextPhase, delay);
        } catch(e) {
            bootAnimating = false;
            console.error('slowBoot nextPhase error:', e);
            if (pipelineViz) pipelineViz.render();
            updateDashboard();
        }
    }
    nextPhase();
}

function runSim() {
    switchView('dashboard');
    while (!sim.bootComplete) {
        try {
            sim._bootStep();
        } catch(e) {
            console.error('runSim _bootStep error:', e);
            updateDashboard();
            return;
        }
    }
    _autoLoadDefaultProgram();
    let steps;
    try {
        steps = sim.run(10000);
    } catch(e) {
        console.error('runSim run error:', e);
        updateDashboard();
        return;
    }
    const con = document.getElementById('editorConsole');
    if (con) {
        let status = 'Stopped.';
        if (!sim.bootComplete) {
            status = 'PP250: Returned to boot sequence.';
        } else if (sim.halted) {
            status = 'Faulted.';
        }
        con.textContent += `\nBoot complete. Ran ${steps} steps. ${status}`;
        con.scrollTop = con.scrollHeight;
    }
    updateDashboard();
}

function faultAlertOn() {
    const btn = document.getElementById('toolFaultBtn');
    if (!btn) return;
    btn.classList.remove('fault-idle');
    btn.classList.add('fault-alert');
}

function faultAlertOff() {
    const btn = document.getElementById('toolFaultBtn');
    if (!btn) return;
    btn.classList.remove('fault-alert');
    btn.classList.add('fault-idle');
}

function faultClear() {
    faultAlertOff();
    _defaultProgramLoaded = false;
    sim.reset();
    pipelineViz.reset();
    const con = document.getElementById('editorConsole');
    if (con) con.textContent = 'FAULT: Machine cleared.';
    updateDashboard();
}

const _FAULT_COLORS = {
    BOUNDS:       '#e05555', NULL_CAP:    '#e05555', PERM_X:       '#e07030',
    PERMISSION:   '#e07030', VERSION:     '#c0a030', SEAL:         '#c0a030',
    BIND:         '#c0a030', FAR:         '#c08030', DOMAIN_PURITY:'#e05555',
    BOOT:         '#e05555', MATH_ERROR:  '#c0a030', DOMAIN_ERROR: '#c0a030',
    STACK_OVERFLOW:'#e05555', STACK_UNDERFLOW:'#e05555', TYPE: '#e05555',
};

function showFaultModal(f) {
    const existing = document.getElementById('faultModalOverlay');
    if (existing) existing.remove();

    const pc     = f.pc;
    const pcHex  = '0x' + pc.toString(16).toUpperCase().padStart(4, '0');
    const word   = (sim.memory && pc < sim.memory.length) ? sim.memory[pc] : 0;
    const disasm = assembler ? assembler.disassemble(word) : '???';
    const ns     = _nsOwnerOf(pc);
    const nsStr  = ns ? `${ns.label} +${ns.offset}` : '\u2014';
    const color  = _FAULT_COLORS[f.type] || '#e05555';

    const allFaults  = sim.faultLog || [];
    const historyHtml = allFaults.length > 1
        ? allFaults.slice(-5).map((fl, i, arr) => {
            const isCurrent = (i === arr.length - 1);
            return `<span class="fault-hist-item${isCurrent ? ' fault-hist-current' : ''}">[step ${fl.step}] ${fl.type}</span>`;
          }).join('')
        : '';

    const overlay = document.createElement('div');
    overlay.id = 'faultModalOverlay';
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog fault-dialog';
    dialog.innerHTML = `
        <div class="fault-modal-header">
            <span class="fault-type-badge" style="background:${color}22;border-color:${color};color:${color}">${f.type}</span>
            <span class="fault-modal-title">Machine Fault</span>
        </div>
        <div class="fault-modal-message">${f.message}</div>
        <div class="fault-detail-grid">
            <div class="fault-detail-row">
                <span class="fault-detail-label">PC</span>
                <span class="fault-detail-value"><code>${pcHex}</code></span>
            </div>
            <div class="fault-detail-row">
                <span class="fault-detail-label">Instruction</span>
                <span class="fault-detail-value"><code>${disasm}</code></span>
            </div>
            <div class="fault-detail-row">
                <span class="fault-detail-label">Location</span>
                <span class="fault-detail-value">${nsStr}</span>
            </div>
            <div class="fault-detail-row">
                <span class="fault-detail-label">Step</span>
                <span class="fault-detail-value">${f.step}</span>
            </div>
            ${historyHtml ? `<div class="fault-detail-row fault-history-row">
                <span class="fault-detail-label">History</span>
                <span class="fault-detail-value">${historyHtml}</span>
            </div>` : ''}
        </div>
        <div class="modal-buttons">
            <button class="btn btn-danger" onclick="faultModalReboot()">&#x21BA; Reboot</button>
            <button class="btn btn-warning" onclick="faultModalInvestigate()">&#x1F50D; Investigate</button>
            <button class="btn" onclick="faultModalDismiss()">Dismiss</button>
        </div>`;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) faultModalDismiss(); });
}

function faultModalDismiss() {
    const el = document.getElementById('faultModalOverlay');
    if (el) el.remove();
}

function faultModalReboot() {
    faultModalDismiss();
    if (pipelineViz) pipelineViz.setNIA(null);
    _defaultProgramLoaded = false;
    sim.reset();
    pipelineViz.reset();
    bootAnimating = false;
    const con = document.getElementById('editorConsole');
    if (con) con.textContent = '';
    slowBoot();
}

function faultModalInvestigate() {
    faultModalDismiss();
    switchView('dashboard');
    switchDashTab('gatelog');
}

function resetSim() {
    switchView('dashboard');
    faultAlertOff();
    if (pipelineViz) pipelineViz.setNIA(null);
    _defaultProgramLoaded = false;
    sim.reset();
    pipelineViz.reset();
    bootAnimating = false;
    const con = document.getElementById('editorConsole');
    if (con) con.textContent = '';
    slowBoot();
}

function runGC() {
    if (!sim.bootComplete) {
        showGCConsole(
            [{ heading: '=== PP250 Garbage Collection ===', lines: [
                'ERROR: Machine has not been booted.',
                '',
                'Click the Boot button (top-right) to initialize the',
                'Church Machine before running garbage collection.',
                '',
                'The boot sequence loads system abstractions into the',
                'namespace and prepares the GC subsystem.'
            ]}],
            { freedSlots: 0, freedWords: 0, liveCount: 0, report: '' },
            true
        );
        return;
    }

    sim.output += '[I/O] GC button pressed \u2014 invoking GC safe abstraction\n';
    sim.mElevation = true;
    const result = sim.runGC();
    sim.mElevation = false;
    sim.output += '[I/O] GC abstraction complete \u2014 RETURN\n';

    const lines = result.report.split('\n');
    const phases = [];
    let current = null;
    for (const line of lines) {
        if (line.startsWith('===') || line.startsWith('---')) {
            if (current) phases.push(current);
            current = { heading: line, lines: [] };
        } else if (current) {
            current.lines.push(line);
        }
    }
    if (current) phases.push(current);

    showGCConsole(phases, result, false);
}

function showGCConsole(phases, result, isError) {
    let existing = document.getElementById('gcConsoleOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'gcConsoleOverlay';
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'gc-console-dialog';

    const title = document.createElement('div');
    title.className = 'gc-console-title';
    title.textContent = 'PP250 Garbage Collection';
    dialog.appendChild(title);

    const output = document.createElement('pre');
    output.className = 'gc-console-output';
    output.id = 'gcConsoleOutput';
    dialog.appendChild(output);

    const status = document.createElement('div');
    status.className = 'gc-console-status';
    status.id = 'gcConsoleStatus';
    dialog.appendChild(status);

    const buttons = document.createElement('div');
    buttons.className = 'gc-console-buttons';

    const stepBtn = document.createElement('button');
    stepBtn.className = 'btn';
    stepBtn.textContent = 'Step';
    stepBtn.style.cssText = 'background:#9b59b6;color:#fff;border:none;font-weight:bold;';
    stepBtn.id = 'gcStepBtn';

    const runBtn = document.createElement('button');
    runBtn.className = 'btn';
    runBtn.textContent = 'Run All';
    runBtn.style.cssText = 'background:#27ae60;color:#fff;border:none;font-weight:bold;';
    runBtn.id = 'gcRunBtn';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn';
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = 'background:#555;color:#fff;border:none;';

    if (isError) {
        for (const phase of phases) {
            const body = phase.lines.join('\n');
            output.textContent = phase.heading + '\n' + body;
        }
        output.style.color = '#e74c3c';
        status.textContent = 'Boot the machine first, then run GC.';
        status.style.borderLeftColor = '#e74c3c';
        buttons.appendChild(closeBtn);
    } else {
        status.textContent = 'GC executed — Step through the report one phase at a time, or Run All to replay.';
        buttons.appendChild(stepBtn);
        buttons.appendChild(runBtn);
        buttons.appendChild(closeBtn);
    }
    dialog.appendChild(buttons);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    let currentPhase = 0;
    let runTimer = null;

    function appendPhase(idx) {
        const phase = phases[idx];
        if (!phase) return;
        const heading = phase.heading;
        const body = phase.lines.filter(function(l) { return l.trim(); }).join('\n');
        output.textContent += (output.textContent ? '\n' : '') + heading + '\n' + body + '\n';
        output.scrollTop = output.scrollHeight;
    }

    function updateStatus() {
        const statusEl = document.getElementById('gcConsoleStatus');
        if (!statusEl) return;
        if (currentPhase >= phases.length) {
            statusEl.textContent = 'GC Complete — ' + result.freedSlots + ' slots freed, ' + result.freedWords + ' words reclaimed.';
            stepBtn.disabled = true;
            runBtn.disabled = true;
            stepBtn.style.opacity = '0.5';
            runBtn.style.opacity = '0.5';
        } else {
            statusEl.textContent = 'Phase ' + (currentPhase + 1) + ' of ' + phases.length + ' ready.';
        }
    }

    stepBtn.addEventListener('click', function() {
        if (currentPhase >= phases.length) return;
        appendPhase(currentPhase);
        currentPhase++;
        updateStatus();
        updateDashboard();
    });

    runBtn.addEventListener('click', function() {
        if (runTimer) return;
        runBtn.textContent = 'Running...';
        runTimer = setInterval(function() {
            if (currentPhase >= phases.length) {
                clearInterval(runTimer);
                runTimer = null;
                runBtn.textContent = 'Run All';
                updateStatus();
                updateDashboard();
                return;
            }
            appendPhase(currentPhase);
            currentPhase++;
            updateStatus();
        }, 400);
    });

    function closeConsole() {
        if (runTimer) clearInterval(runTimer);
        overlay.remove();
        document.removeEventListener('keydown', escHandler);
        updateDashboard();
    }

    function escHandler(e) {
        if (e.key === 'Escape') closeConsole();
    }

    closeBtn.addEventListener('click', closeConsole);

    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) closeConsole();
    });

    document.addEventListener('keydown', escHandler);

    if (!isError) updateStatus();
    (isError ? closeBtn : stepBtn).focus();
}

var _ghConsoleOutput = null;
var _ghConsoleStatus = null;
var _ghConsoleOverlay = null;
var _ghConsoleToken = 0;
var _ghAutoCloseTimer = null;

function showGitHubConsole(phases, mode, initialStatus) {
    closeGitHubConsole();

    _ghConsoleToken++;
    var token = _ghConsoleToken;

    var overlay = document.createElement('div');
    overlay.id = 'ghConsoleOverlay';
    overlay.className = 'modal-overlay';
    overlay._token = token;
    _ghConsoleOverlay = overlay;

    var dialog = document.createElement('div');
    dialog.className = 'gc-console-dialog';
    dialog.style.borderColor = '#C89B3C';
    dialog.style.boxShadow = '0 8px 32px rgba(200,155,60,0.3)';

    var title = document.createElement('div');
    title.className = 'gc-console-title';
    title.style.color = '#C89B3C';
    title.textContent = mode === 'push' ? 'Push to GitHub' : 'Get from GitHub';
    dialog.appendChild(title);

    var output = document.createElement('pre');
    output.className = 'gc-console-output';
    output.id = 'ghConsoleOutput';
    _ghConsoleOutput = output;
    dialog.appendChild(output);

    for (var i = 0; i < phases.length; i++) {
        var p = phases[i];
        var body = p.lines.filter(function(l) { return l.trim(); }).join('\n');
        output.textContent += (output.textContent ? '\n' : '') + p.heading + '\n' + body + '\n';
    }

    var status = document.createElement('div');
    status.className = 'gc-console-status';
    status.id = 'ghConsoleStatus';
    status.style.borderLeftColor = '#C89B3C';
    status.textContent = initialStatus || 'Working...';
    _ghConsoleStatus = status;
    dialog.appendChild(status);

    var buttons = document.createElement('div');
    buttons.className = 'gc-console-buttons';

    var closeBtn = document.createElement('button');
    closeBtn.className = 'btn';
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = 'background:#555;color:#fff;border:none;';
    closeBtn.addEventListener('click', closeGitHubConsole);
    buttons.appendChild(closeBtn);

    dialog.appendChild(buttons);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) closeGitHubConsole();
    });

    function escHandler(e) {
        if (e.key === 'Escape') closeGitHubConsole();
    }
    document.addEventListener('keydown', escHandler);
    overlay._escHandler = escHandler;

    return token;
}

function appendGitHubPhase(phase, token) {
    if (token !== undefined && token !== _ghConsoleToken) return;
    if (!_ghConsoleOutput) return;
    var body = phase.lines.filter(function(l) { return l.trim(); }).join('\n');
    _ghConsoleOutput.textContent += '\n' + phase.heading + '\n' + body + '\n';
    _ghConsoleOutput.scrollTop = _ghConsoleOutput.scrollHeight;
}

function updateGitHubStatus(msg, isError, token) {
    if (token !== undefined && token !== _ghConsoleToken) return;
    if (!_ghConsoleStatus) return;
    _ghConsoleStatus.textContent = msg;
    if (isError) {
        _ghConsoleStatus.style.borderLeftColor = '#e74c3c';
        if (_ghConsoleOutput) _ghConsoleOutput.style.color = '#e74c3c';
    }
}

function closeGitHubConsole() {
    if (_ghAutoCloseTimer) { clearTimeout(_ghAutoCloseTimer); _ghAutoCloseTimer = null; }
    if (_ghConsoleOverlay) {
        if (_ghConsoleOverlay._escHandler) document.removeEventListener('keydown', _ghConsoleOverlay._escHandler);
        _ghConsoleOverlay.remove();
        _ghConsoleOverlay = null;
    }
    _ghConsoleOutput = null;
    _ghConsoleStatus = null;
}

function loadExample(name) {
    const editor = document.getElementById('asmEditor');
    if (!editor) return;
    if (activeUserTabId && userTabDirty) saveActiveUserTab();
    activeUserTabId = null;
    userTabDirty = false;
    renderUserTabs();
    updateSaveUserTabBtn();

    const examples = {
        'ada_note_g': `; ============================================
; Ada Lovelace — Note G (1843)
; The First Computer Program
; Computes B7 (Bernoulli number = -1/30)
; 25 operations from the original diagram
; ============================================
;
; Ada wrote this for Babbage's Analytical
; Engine, which was never built. Here it runs
; on the Church Machine — 181 years later.
;
; The Analytical Engine had multiply and
; divide in hardware. The Church Machine has
; no multiply or divide — so Ada's × becomes
; repeated addition (IADD loop) and ÷ becomes
; repeated subtraction (ISUB loop), exactly
; as a child would compute them by hand.
;
; Variable mapping (Ada → Church Machine):
;   DR1  = V1  = 1 (constant)
;   DR2  = V2  = 2 (constant)
;   DR3  = V3  = n (4 for B7)
;   DR4  = V4  (working: 2n, then 2n-1)
;   DR5  = V5  (working: 2n, then 2n+1)
;   DR6  = V6  (working: 2n, decrements)
;   DR7  = V7  (denominator counter)
;   DR8  = V8  (fraction quotient)
;   DR9  = V9  (fraction quotient)
;   DR10 = V10 (loop counter)
;   DR11 = V11 (working coefficient)
;   DR12 = V12 (product Bk × Ak)
;   DR13 = V13 (accumulator)
;   DR14 = scratch (loop counter for ×/÷)
;   DR15 = V24 (result: B7)
;
; DR0 = 0 always (hardwired zero register).
; Constants loaded via DREAD from a data
; table at the end of this program (CR14 code lump exception).
; ============================================

; --- Initialize Ada's Store columns ---
DREAD DR1, CR14, 100       ; V1 = 1
DREAD DR2, CR14, 101       ; V2 = 2
DREAD DR3, CR14, 102       ; V3 = n = 4

; ============================================
; OPERATION 1: × (V2 × V3 → V4, V5, V6)
; "Multiply 2 by n"
; 2 × 4 = 8 — by repeated addition
; ============================================
IADD DR4, DR0, DR0         ; V4 = 0
IADD DR14, DR3, DR0        ; counter = n
op1_loop:
MCMP DR14, DR0
BRANCHEQ op1_done
IADD DR4, DR4, DR2         ; V4 += 2
ISUB DR14, DR14, DR1       ; counter--
BRANCH op1_loop
op1_done:
IADD DR5, DR4, DR0         ; V5 = 2n
IADD DR6, DR4, DR0         ; V6 = 2n

; ============================================
; OPERATION 2: − (V4 − V1 → V4)
; "2n minus 1"
; ============================================
ISUB DR4, DR4, DR1         ; V4 = 2n - 1 = 7

; ============================================
; OPERATION 3: + (V5 + V1 → V5)
; "2n plus 1"
; ============================================
IADD DR5, DR5, DR1         ; V5 = 2n + 1 = 9

; ============================================
; OPERATION 4: ÷ (V4 ÷ V5 → V11)
; "(2n-1) / (2n+1)" = 7 / 9 = 0 remainder 7
; NOTE: Published as V5÷V4 — typo per
; Bromley (1990). Corrected here.
; ============================================
IADD DR11, DR0, DR0        ; quotient = 0
IADD DR14, DR4, DR0        ; dividend = V4
op4_loop:
MCMP DR14, DR5
BRANCHLT op4_done
ISUB DR14, DR14, DR5       ; dividend -= V5
IADD DR11, DR11, DR1       ; quotient++
BRANCH op4_loop
op4_done:

; ============================================
; OPERATION 5: ÷ (V11 ÷ V2 → V11)
; "Divide coefficient by 2"
; ============================================
SHR DR11, DR11, 1          ; V11 / 2

; ============================================
; OPERATION 6: − (V13 − V11 → V13)
; "Accumulator A0 = 0 − coefficient"
; ============================================
IADD DR13, DR0, DR0        ; V13 = 0
ISUB DR13, DR13, DR11      ; V13 = -V11

; ============================================
; OPERATION 7: − (V3 − V1 → V10)
; "Loop counter = n − 1 = 3"
; ============================================
ISUB DR10, DR3, DR1        ; V10 = 4 - 1 = 3

; ============================================
; OPERATION 8: + (V2 + V7 → V7)
; "Set denominator counter = 2"
; ============================================
IADD DR7, DR2, DR0         ; V7 = 2

; ============================================
; OPERATION 9: ÷ (V6 ÷ V7 → V11)
; "2n / counter" = 8 / 2 = 4
; ============================================
IADD DR11, DR0, DR0        ; quotient = 0
IADD DR14, DR6, DR0        ; dividend = V6
op9_loop:
MCMP DR14, DR7
BRANCHLT op9_done
ISUB DR14, DR14, DR7
IADD DR11, DR11, DR1       ; quotient++
BRANCH op9_loop
op9_done:

; ============================================
; OPERATION 10: × (V21 × V11 → V12)
; "B1 × coefficient"
; B1 = 1 (integer stand-in for 1/6)
; 1 × 4 = 4 — multiplication loop
; ============================================
DREAD DR15, CR14, 103       ; DR15 = B1 = 1
IADD DR12, DR0, DR0        ; V12 = 0
IADD DR14, DR11, DR0       ; counter = V11
op10_loop:
MCMP DR14, DR0
BRANCHEQ op10_done
IADD DR12, DR12, DR15      ; V12 += B1
ISUB DR14, DR14, DR1       ; counter--
BRANCH op10_loop
op10_done:

; ============================================
; OPERATION 11: + (V12 + V13 → V13)
; "Accumulate: sum += B1 × A1"
; ============================================
IADD DR13, DR12, DR13      ; V13 += V12

; ============================================
; OPERATION 12: − (V10 − V1 → V10)
; "Decrement loop counter"
; ============================================
ISUB DR10, DR10, DR1       ; V10 = 3 - 1 = 2

; ============================================
; OPERATION 13: − (V6 − V1 → V6)
; "Decrement working variable"
; ============================================
ISUB DR6, DR6, DR1         ; V6 = 8 - 1 = 7

; ============================================
; OPERATION 14: + (V1 + V7 → V7)
; "Increment denominator"
; ============================================
IADD DR7, DR1, DR7         ; V7 = 2 + 1 = 3

; ============================================
; OPERATION 15: ÷ (V6 ÷ V7 → V8)
; "Fraction part" = 7 / 3 = 2
; ============================================
IADD DR8, DR0, DR0         ; quotient = 0
IADD DR14, DR6, DR0        ; dividend = V6
op15_loop:
MCMP DR14, DR7
BRANCHLT op15_done
ISUB DR14, DR14, DR7
IADD DR8, DR8, DR1
BRANCH op15_loop
op15_done:

; ============================================
; OPERATION 16: × (V8 × V11 → V11)
; "Update coefficient" = 2 × 4 = 8
; ============================================
IADD DR14, DR11, DR0       ; save old V11
IADD DR11, DR0, DR0        ; V11 = 0
IADD DR15, DR8, DR0        ; counter = V8
op16_loop:
MCMP DR15, DR0
BRANCHEQ op16_done
IADD DR11, DR11, DR14      ; V11 += old V11
ISUB DR15, DR15, DR1       ; counter--
BRANCH op16_loop
op16_done:

; ============================================
; OPERATION 17: − (V6 − V1 → V6)
; "Decrement working variable"
; ============================================
ISUB DR6, DR6, DR1         ; V6 = 7 - 1 = 6

; ============================================
; OPERATION 18: + (V1 + V7 → V7)
; "Increment denominator"
; ============================================
IADD DR7, DR1, DR7         ; V7 = 3 + 1 = 4

; ============================================
; OPERATION 19: ÷ (V6 ÷ V7 → V9)
; "Fraction part" = 6 / 4 = 1
; ============================================
IADD DR9, DR0, DR0         ; quotient = 0
IADD DR14, DR6, DR0        ; dividend = V6
op19_loop:
MCMP DR14, DR7
BRANCHLT op19_done
ISUB DR14, DR14, DR7
IADD DR9, DR9, DR1
BRANCH op19_loop
op19_done:

; ============================================
; OPERATION 20: × (V9 × V11 → V11)
; "Coefficient → A3" = 1 × 8 = 8
; ============================================
IADD DR14, DR11, DR0       ; save V11
IADD DR11, DR0, DR0        ; V11 = 0
IADD DR15, DR9, DR0        ; counter = V9
op20_loop:
MCMP DR15, DR0
BRANCHEQ op20_done
IADD DR11, DR11, DR14
ISUB DR15, DR15, DR1
BRANCH op20_loop
op20_done:

; ============================================
; OPERATION 21: × (V22 × V11 → V12)
; "B3 × coefficient"
; B3 = 1 (integer stand-in for -1/30)
; ============================================
DREAD DR15, CR14, 104       ; DR15 = B3 = 1
IADD DR12, DR0, DR0        ; V12 = 0
IADD DR14, DR11, DR0       ; counter = V11
op21_loop:
MCMP DR14, DR0
BRANCHEQ op21_done
IADD DR12, DR12, DR15      ; V12 += B3
ISUB DR14, DR14, DR1       ; counter--
BRANCH op21_loop
op21_done:

; ============================================
; OPERATION 22: + (V12 + V13 → V13)
; "Accumulate: sum += B3 × A3"
; ============================================
IADD DR13, DR12, DR13      ; V13 += V12

; ============================================
; OPERATION 23: − (V10 − V1 → V10)
; "Decrement loop counter"
; ============================================
ISUB DR10, DR10, DR1       ; V10 = 2 - 1 = 1

; ============================================
; Ada writes: "Here follows a repetition of
; Operations thirteen to twenty-three."
; The inner loop repeats for each Bernoulli
; term. For B7, it runs twice: once for B3
; (above), once for B5 (below).
; ============================================

; --- Second iteration: B5 term ---
; OPERATION 13b: V6 = V6 - V1
ISUB DR6, DR6, DR1         ; V6 = 6 - 1 = 5

; OPERATION 14b: V7 = V1 + V7
IADD DR7, DR1, DR7         ; V7 = 4 + 1 = 5

; OPERATION 15b: V8 = V6 / V7 = 5/5 = 1
IADD DR8, DR0, DR0
IADD DR14, DR6, DR0
op15b_loop:
MCMP DR14, DR7
BRANCHLT op15b_done
ISUB DR14, DR14, DR7
IADD DR8, DR8, DR1
BRANCH op15b_loop
op15b_done:

; OPERATION 16b: V11 = V8 × V11 = 1 × 8 = 8
IADD DR14, DR11, DR0
IADD DR11, DR0, DR0
IADD DR15, DR8, DR0
op16b_loop:
MCMP DR15, DR0
BRANCHEQ op16b_done
IADD DR11, DR11, DR14
ISUB DR15, DR15, DR1
BRANCH op16b_loop
op16b_done:

; OPERATION 17b: V6 = V6 - V1
ISUB DR6, DR6, DR1         ; V6 = 5 - 1 = 4

; OPERATION 18b: V7 = V1 + V7
IADD DR7, DR1, DR7         ; V7 = 5 + 1 = 6

; OPERATION 19b: V9 = V6 / V7 = 4/6 = 0
IADD DR9, DR0, DR0
IADD DR14, DR6, DR0
op19b_loop:
MCMP DR14, DR7
BRANCHLT op19b_done
ISUB DR14, DR14, DR7
IADD DR9, DR9, DR1
BRANCH op19b_loop
op19b_done:

; OPERATION 20b: V11 = V9 × V11 = 0 × 8 = 0
IADD DR14, DR11, DR0
IADD DR11, DR0, DR0
IADD DR15, DR9, DR0
op20b_loop:
MCMP DR15, DR0
BRANCHEQ op20b_done
IADD DR11, DR11, DR14
ISUB DR15, DR15, DR1
BRANCH op20b_loop
op20b_done:

; OPERATION 21b: V12 = V23 × V11 = B5 × 0 = 0
DREAD DR15, CR14, 105       ; DR15 = B5 = 1
IADD DR12, DR0, DR0
IADD DR14, DR11, DR0
op21b_loop:
MCMP DR14, DR0
BRANCHEQ op21b_done
IADD DR12, DR12, DR15
ISUB DR14, DR14, DR1
BRANCH op21b_loop
op21b_done:

; OPERATION 22b: V13 = V12 + V13
IADD DR13, DR12, DR13

; OPERATION 23b: V10 = V10 - V1
ISUB DR10, DR10, DR1       ; V10 = 1 - 1 = 0

; ============================================
; OPERATION 24: − (V24 − V13 → V24)
; "Final result: B7 = −accumulated sum"
; ============================================
IADD DR15, DR0, DR0        ; V24 = 0
ISUB DR15, DR15, DR13      ; V24 = -V13

; ============================================
; OPERATION 25: + (V1 + V3 → V3)
; "Increment n for next Bernoulli number"
; ============================================
IADD DR3, DR1, DR3         ; V3 = 4 + 1 = 5

; ============================================
; Result: DR15 = B7 (negated accumulator)
; DR13 = accumulated sum of Bk × Ak terms
;
; Ada, 1843: "The Analytical Engine weaves
; algebraical patterns just as the Jacquard
; loom weaves flowers and leaves."
;
; The first program — running 181 years later
; inside a capability-secured namespace where
; no instruction can escape its lump.
; ============================================
HALT

; --- Data table (Ada's Store constants) ---
; Placed at offset 100 via .org directive.
; DREAD DR, CR14, offset reads these values (CR14 code lump exception).
.org 100
.word 1                    ; offset 100: V1 = 1
.word 2                    ; offset 101: V2 = 2
.word 4                    ; offset 102: V3 = n = 4
.word 1                    ; offset 103: B1 (stand-in)
.word 1                    ; offset 104: B3 (stand-in)
.word 1                    ; offset 105: B5 (stand-in)
`,
        'selftest': `; ============================================
; Church Machine Self-Test
; Tests every opcode and CR0-CR5 registers
; Boot must complete before assembling
; ============================================

; --- TEST 1: LOAD into CR0-CR5 ---
; Load 6 different abstractions via C-List (code objects are DATA domain)
LOAD CR0, CR6, 4       ; CR0 = Salvation (E)
LOAD CR1, CR6, 10      ; CR1 = SUCC    (XLE)
LOAD CR2, CR6, 12      ; CR2 = ADD     (XLE)
LOAD CR3, CR6, 13      ; CR3 = SUB     (XLE)
LOAD CR4, CR6, 14      ; CR4 = MUL     (XLE)
LOAD CR5, CR6, 7       ; CR5 = Constants (E)

; --- TEST 2: TPERM - permission checks ---
; Each should set Z=1 (pass)
TPERM CR0, E           ; Salvation has E? PASS
TPERM CR1, XL          ; SUCC has X+L? PASS
TPERM CR2, XL          ; ADD has X+L? PASS
TPERM CR3, XL          ; SUB has X+L? PASS
TPERM CR4, XL          ; MUL has X+L? PASS
TPERM CR5, E           ; Constants has E? PASS

; --- TEST 3: TPERM failure ---
TPERM CR0, L           ; Salvation has L? FAIL (Z=0)

; --- TEST 4: Conditional execution ---
; Z=0 from failed TPERM above
LOADEQ CR0, CR6, 15    ; SKIP (Z=0, not equal)
LOADNE CR0, CR6, 4     ; EXEC (Z=0, is not-equal)

; --- TEST 5: SWITCH - swap registers ---
SWITCH CR0, 1          ; CR0 <-> CR1
; Now CR0=SUCC, CR1=Salvation
SWITCH CR0, 1          ; Swap back
; CR0=Salvation, CR1=SUCC again

; --- TEST 6: LAMBDA instruction - in-scope reduction ---
; LAMBDA is an instruction, not a security block
LAMBDA CR1             ; Church SUCC reduction
LAMBDA CR2             ; Church ADD reduction
LAMBDA CR3             ; Church SUB reduction
LAMBDA CR4             ; Church MUL reduction

; --- TEST 7: CHANGE - re-aim register ---
CHANGE CR0, 16         ; CR0 now -> SlideRule
TPERM CR0, E           ; SlideRule has E? PASS

; --- TEST 8: CALL/RETURN ---
LOAD CR0, CR6, 4       ; CR0 = Salvation
CALL CR0, 0xF          ; Direct mode: CR0 is the E-GT — enter Salvation
RETURN                ; Return to caller (pops 2-word frame)

; --- TEST 9: ELOADCALL - fused Load+TPERM+Call ---
ELOADCALL CR0, CR6, 4  ; Load Salvation + check E + call
RETURN                ; Return from fused call

; --- TEST 10: XLOADLAMBDA - fused Load+TPERM+Lambda ---
XLOADLAMBDA CR1, CR6, 10 ; Load SUCC + check X + lambda

; --- TEST 11: Conditional LAMBDA ---
TPERM CR1, XL          ; Z=1 (SUCC has XL)
LAMBDAEQ CR2           ; Apply ADD via LAMBDA only if Z=1
TPERM CR0, L           ; Z=0 (Salvation lacks L)
LAMBDANE CR3           ; Apply SUB via LAMBDA only if Z=0 (NE)
LAMBDAEQ CR4           ; SKIP MUL (Z=0, not EQ)

; --- All tests complete ---
HALT
`,
        'load_save': `; Load and Save example
; Load SUCC from C-List[CR6] — SUCC is a DATA-domain code object
LOAD CR0, CR6, 4       ; CR0 = SUCC (Church numeral)
TPERM CR0, XL          ; Check X+L permissions
LOAD CR1, CR6, 5       ; CR1 = ADD
TPERM CR1, XL          ; Check X+L
LAMBDA CR0             ; Apply SUCC via LAMBDA instruction
RETURN                ; Return to caller
`,
        'bernoulli': `; Bernoulli - simplified Church sequence
; Load Church numeral abstractions (DATA-domain code objects)
LOAD CR0, CR6, 4       ; SUCC
LOAD CR1, CR6, 6       ; ADD
LOAD CR2, CR6, 8       ; MUL
LOAD CR3, CR6, 9       ; DIV (via SlideRule)
LOAD CR4, CR6, 5       ; PRED

; Verify permissions on all (X for LAMBDA application)
TPERM CR0, XL          ; SUCC check
TPERM CR1, XL          ; ADD check
TPERM CR2, XL          ; MUL check
TPERM CR3, XL          ; DIV check
TPERM CR4, XL          ; PRED check

; Execute reductions via LAMBDA instruction (method within abstractions)
LAMBDA CR1             ; Church ADD
LAMBDA CR2             ; Church MUL
LAMBDA CR3             ; Church DIV
LAMBDA CR0             ; Church SUCC

; Return result
RETURN
`,
        'conditional': `; Conditional execution demo
LOAD CR0, CR6, 4       ; Load SUCC (Church numeral)
TPERM CR0, XL          ; Check \u2014 sets Z=1 (pass)

; This executes only if Z=1 (TPERM passed)
LOADEQ CR1, CR6, 6     ; Load ADD only if equal (Z=1)
LAMBDAEQ CR1           ; Apply ADD via LAMBDA only if equal

; This would skip if Z=0 (TPERM failed)
LOADNE CR2, CR6, 7     ; Load SUB only if not-equal (Z=0)

RETURN
`,
        'gc_test': `; ============================================
; Church Machine GC Test (PP250)
; GC via safe Turing abstraction \u2014 CALL GC
; Run AFTER boot completes (6 steps)
; ============================================
;
; Permission gates (mLoad is the single guard):
;   R = DREAD, W = DWRITE, X = LAMBDA,
;   L = LOAD, S = SAVE (+ B=1), E = CALL
;
; Expected: 16 entries freed, 8 survive (+GC).
; ============================================

; --- Load subset into CRs (survivors) ---
LOAD CR0, CR6, 4       ; CR0 = Salvation  (E)
LOAD CR1, CR6, 10      ; CR1 = SUCC      (XLE)
LOAD CR2, CR6, 8       ; CR2 = Stack     (E)
LOAD CR3, CR6, 12      ; CR3 = ADD       (XLE)
LOAD CR4, CR6, 7       ; CR4 = Constants (E)

; --- Verify permissions ---
TPERM CR0, E           ; Salvation has E? PASS
TPERM CR1, XL          ; SUCC has X+L? PASS
TPERM CR2, E           ; Stack has E? PASS
TPERM CR3, LE          ; ADD has L+E? PASS
TPERM CR4, E           ; Constants has E? PASS

; --- Exercise: LAMBDA checks X via mLoad ---
LAMBDA CR1             ; SUCC reduction (X)
LAMBDA CR3             ; ADD reduction (X)

; --- CALL GC: checks E via mLoad ---
LOAD CR5, CR6, 27      ; CR5 = GC (E)
TPERM CR5, E           ; Verify E permission
CALL CR5, 0xF          ; Direct mode: CR5 is the E-GT — trigger GC

HALT
`,
        'turing_test': `; ============================================
; Turing ISA Test
; Exercises IADD, ISUB, MCMP, BRANCH, SHL, SHR
; ============================================
;
; Turing ISA (11 instructions):
;   DREAD, DWRITE, BFEXT, BFINS  (R/W via GT)
;   MCMP, IADD, ISUB, BRANCH
;   SHL, SHR (logical/arithmetic)
;   RETURN (shared with Church)
; ============================================

; --- Boot: Load GTs ---
LOAD CR0, CR6, 10      ; CR0 = SUCC (XLE)
LOAD CR1, CR6, 12      ; CR1 = ADD (XLE)

; --- Initialize DR1 = 0 ---
IADD DR1, DR0, DR0     ; DR1 = 0 (Z=1)

; --- Church reduction ---
LAMBDA CR0             ; SUCC reduction

; --- Integer arithmetic ---
IADD DR3, DR1, DR2     ; DR3 = DR1 + DR2
ISUB DR4, DR3, DR1     ; DR4 = DR3 - DR1

; --- MCMP: compare DR4 vs DR2 ---
MCMP DR4, DR2          ; Should be equal (Z=1)
BRANCHEQ +2            ; Skip if equal
IADD DR5, DR1, DR1     ; Skipped

; --- MCMP: nonzero compare ---
MCMP DR3, DR4          ; DR3 vs DR4
BRANCHNE +2            ; Skip if not equal
ISUB DR6, DR1, DR1     ; Skipped if equal

; --- Zero flag test ---
ISUB DR7, DR3, DR3     ; DR7 = 0 (Z=1)
BRANCHEQ +2            ; Branch taken
IADD DR8, DR1, DR1     ; Skipped

; --- SHL: Shift left ---
IADD DR9, DR3, DR0     ; DR9 = DR3 (copy)
SHL DR10, DR9, 4       ; DR10 = DR9 << 4

; --- SHR: Logical shift right ---
SHR DR11, DR10, 2      ; DR11 = DR10 >> 2

; --- SHR: Arithmetic shift right ---
ISUB DR12, DR0, DR3    ; DR12 = negative
SHR DR13, DR12, 1, ASR ; DR13 sign-extending

; --- Verify: SHL then SHR restores ---
SHL DR14, DR3, 8       ; DR14 = DR3 << 8
SHR DR15, DR14, 8      ; DR15 = DR14 >> 8
MCMP DR15, DR3         ; Should be equal (Z=1)

HALT
`,
        'salvation': `; ============================================
; Salvation \u2014 First Callable Abstraction
; Proves CALL works, transitions to Navana
; ============================================
;
; Salvation is NS[4] \u2014 the first abstraction
; that can be CALLed. It proves:
;   1. LOAD works (namespace lookup)
;   2. TPERM works (permission check)
;   3. LAMBDA works (Church reduction)
; Then transitions to Navana (does not RETURN).
; Navana runs indefinitely as namespace controller.
; ============================================

; --- Load Salvation abstraction ---
LOAD CR0, CR6, 4       ; CR0 = Salvation (E)
TPERM CR0, E           ; Verify E permission

; --- CALL Salvation ---
CALL CR0, 0xF          ; Direct mode: CR0 is the E-GT — enter Salvation
; Salvation transitions to Navana (no RETURN)
; Navana runs indefinitely managing all abstractions

; --- Navana is now in control ---
; Navana manages: IDS, abstraction lifecycle,
; system health monitoring. It does not RETURN.

HALT
`,
        'perm_attack': `; ============================================
; ADVERSARIAL TEST: Permission Violations
; Every operation here should FAULT cleanly.
; mLoad is the single guard at the gate.
; ============================================
;
; Namespace reference:
;   Slot 2  Boot.Abstr (E only \u2014 combined code + C-List)
;   Slot 3  (empty)
;   Slot 26 TRUE       (L only \u2014 no X, no E)
;   Slot 27 FALSE      (L only \u2014 no X, no E)
;   Slot 44 GC         (E only)
; ============================================

; --- ATTACK 1: CALL without E permission ---
; TRUE (slot 26) has only L \u2014 no E.
; CALL requires E via mLoad. Should FAULT.
LOAD CR0, CR6, 26      ; CR0 = TRUE (L only)
CALL CR0, 0xF          ; FAULT: direct mode but CR0 lacks E permission

; --- ATTACK 2: LAMBDA without X permission ---
; Constants (slot 18) has only E \u2014 no X.
; LAMBDA requires X via mLoad. Should FAULT.
LOAD CR1, CR6, 18      ; CR1 = Constants (E only)
LAMBDA CR1             ; FAULT: lacks X permission

; --- ATTACK 3: CALL something with only X ---
; Salvation (slot 4) has E. Strip to X-only via TPERM.
; CALL requires E. Should FAULT.
LOAD CR2, CR6, 4       ; CR2 = Salvation (E-GT from C-List)
TPERM CR2, X           ; Strip E, keep X only
CALL CR2, 0xF          ; FAULT: direct mode but CR2 lacks E permission

; --- If we get here, something is broken ---
HALT
`,
        'led_blink': `; ============================================
; LED Blink — Ti60 F225 Hardware Nucleus Code
; ============================================
;
; This is the exact binary burned into the
; Ti60 F225 FPGA. It produces the 1 Hz LED
; blink you can see on the board right now.
;
; HOW TO WATCH THIS IN THE SIMULATOR:
; 1. Boot the machine (click Boot, or Step x6).
; 2. Assemble this code, then click Step.
; 3. Switch to Ti60 255 IDE — watch the Ti60 F225
;    LED strip: LED0 (green) toggles with each
;    DWRITE, exactly as on the physical board.
;
; Path: LOAD CR3, CR6, 8  → loads LED_DEV GT
;       DWRITE DR1, CR3, 0 → LED0 on
;       DWRITE DR0, CR3, 0 → LED0 off
;
; C-List[8] = LED_DEV (W) in the simulator boot,
; so this code runs identically to the FPGA.
;
; On the FPGA (50 MHz): 380 × 16383 iters ≈ 0.5 s
; per phase → 1 Hz blink total.
; ============================================

; --- Load LED device capability from C-List slot 8 ---
LOAD CR3, CR6, 8          ; C-List[8] = LED_DEV (W-perm, NS slot 12)

; --- DR1 = 1 (the "on" value) ---
IADD DR1, DR0, #1

; ── LED ON phase ─────────────────────────────
led_on:
DWRITE DR1, CR3, 0        ; LED0 = 1  (write 1 through gate)
IADD DR3, DR0, #3         ; outer delay count  (FPGA: 380)
outer_on:
IADD DR2, DR0, #3         ; inner delay count  (FPGA: 16383)
inner_on:
ISUB DR2, DR2, #1
BRANCHNE inner_on
ISUB DR3, DR3, #1
BRANCHNE outer_on

; ── LED OFF phase ────────────────────────────
DWRITE DR0, CR3, 0        ; LED0 = 0  (write 0 through gate)
IADD DR3, DR0, #3
outer_off:
IADD DR2, DR0, #3
inner_off:
ISUB DR2, DR2, #1
BRANCHNE inner_off
ISUB DR3, DR3, #1
BRANCHNE outer_off

BRANCH led_on             ; loop forever
`,
        'bind_attack': `; ============================================
; ADVERSARIAL TEST: B-Bit Enforcement
; Tests TWO security boundaries:
;   1. SAVE requires B=1 (B defaults to 0)
;   2. CALL auto-clears B on passed GTs
; ============================================
;
; B-bit security model:
;   B defaults to 0 on namespace entries.
;   SAVE checks B=1 before committing.
;   CALL auto-clears B on all preserved CRs.
;   TPERM with B mask is the ONLY way to
;   allow bind (delegation).
; ============================================

; --- ATTACK 1: SAVE with default B=0 ---
; After boot, B defaults to 0 on all entries.
; SAVE should FAULT because B=0.
LOAD CR0, CR6, 20      ; CR0 = SUCC (XLE, B=0)
SAVE CR0, CR6, 28      ; FAULT: B=0, cannot bind

; --- If we get here, B-bit default failed ---
HALT
`,
    };

    const code = examples[name];
    if (code) {
        editor.value = code;
        saveEditorState();
        updateLineNumbers();
        document.querySelectorAll('.example-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.example === name);
        });
        const sel = document.getElementById('langSelector');
        if (sel) sel.value = 'assembly';
        if (typeof historySetCodeExample === 'function') historySetCodeExample(name);
    }
}

function updateLineNumbers() {
    const editor = document.getElementById('asmEditor');
    const gutter = document.getElementById('lineNumbers');
    if (!editor || !gutter) return;
    const lines = editor.value.split('\n');
    let html = '';
    for (let i = 1; i <= lines.length; i++) {
        html += i + '\n';
    }
    gutter.textContent = html;
}

function syncLineScroll() {
    const editor = document.getElementById('asmEditor');
    const gutter = document.getElementById('lineNumbers');
    if (editor && gutter) {
        gutter.scrollTop = editor.scrollTop;
    }
}

function scrollExamples(dir) {
    const container = document.getElementById('exampleTabsScroll');
    if (container) {
        container.scrollBy({ left: dir * 120, behavior: 'smooth' });
    }
}

let currentChallenge = null;

function generateChallenge() {
    const settings = getStudentSettings();
    const progress = getStudentProgress();
    const grade = settings.grade || '';
    const solved = progress.challengesSolved || 0;

    const tier = getGradeTier(grade);
    const problem = pickProblem(tier, solved);
    currentChallenge = problem;

    const promptEl = document.getElementById('challengePrompt');
    const inputEl = document.getElementById('challengeInput');
    const resultEl = document.getElementById('challengeResult');
    const explainEl = document.getElementById('challengeExplain');
    const answerEl = document.getElementById('challengeAnswer');

    promptEl.innerHTML = problem.story +
        `<div class="challenge-question">${escapeHtml(problem.question)}</div>`;
    inputEl.style.display = 'block';
    resultEl.innerHTML = '';
    resultEl.className = 'challenge-result';
    explainEl.innerHTML = '';
    if (answerEl) { answerEl.value = ''; answerEl.focus(); }
}

function getGradeTier(grade) {
    if (grade === 'K' || grade === '1' || grade === '2') return 'early';
    if (grade === '3' || grade === '4' || grade === '5') return 'elementary';
    if (grade === '6' || grade === '7' || grade === '8') return 'middle';
    if (grade === '9' || grade === '10') return 'high';
    if (grade === '11' || grade === '12' || grade === 'IB') return 'advanced';
    return 'early';
}

function pickProblem(tier, solved) {
    const pools = {
        early: [
            () => { const a = rr(1,9), b = rr(1,9); return mp(a+' + '+b, a+b, 'addition', a, b, 'add'); },
            () => { const a = rr(5,15), b = rr(1,a); return mp(a+' - '+b, a-b, 'subtraction', a, b, 'sub'); },
            () => { const a = rr(1,5), b = rr(1,5); return mp(a+' + '+b, a+b, 'addition', a, b, 'add'); },
            () => { const a = rr(2,10), b = rr(1,a-1); return mp(a+' - '+b, a-b, 'subtraction', a, b, 'sub'); },
            () => { const a = rr(1,9), b = rr(1,9); return mp(a+' + '+b+' = ?', a+b, 'addition', a, b, 'add'); },
        ],
        elementary: [
            () => { const a = rr(2,12), b = rr(2,12); return mp(a+' \u00d7 '+b, a*b, 'multiplication', a, b, 'mul'); },
            () => { const b = rr(2,12), c = rr(2,12); const a = b*c; return mp(a+' \u00f7 '+b, c, 'division', a, b, 'div'); },
            () => { const a = rr(10,99), b = rr(10,99); return mp(a+' + '+b, a+b, 'addition', a, b, 'add'); },
            () => { const a = rr(50,200), b = rr(10,a); return mp(a+' - '+b, a-b, 'subtraction', a, b, 'sub'); },
            () => { const a = rr(5,20), b = rr(2,9); return mp(a+' \u00d7 '+b, a*b, 'multiplication', a, b, 'mul'); },
        ],
        middle: [
            () => { const a = rr(10,50), b = rr(2,10), c = rr(1,20); return mp(a+' \u00d7 '+b+' + '+c, a*b+c, 'mixed ops', a*b, c, 'add', a, b); },
            () => { const b = rr(2,15), c = rr(2,15); const a = b*c; return mp(a+' \u00f7 '+b, c, 'division', a, b, 'div'); },
            () => { const a = rr(2,15); return mp('What is ' + a + '\u00b2 ?', a*a, 'squaring', a, a, 'mul'); },
            () => { const a = rr(100,999), b = rr(10,99); return mp(a+' - '+b, a-b, 'subtraction', a, b, 'sub'); },
            () => { const a = rr(2,12), b = rr(2,12), c = rr(1,10); return mp(a+' \u00d7 '+b+' + '+c, a*b+c, 'mixed ops', a*b, c, 'add', a, b); },
        ],
        high: [
            () => { const a = rr(2,15), b = rr(2,15); const p = a*b; return mp('If y = '+a+'x and x = '+b+', what is y?', p, 'algebra', a, b, 'mul'); },
            () => { const r = rr(1,10), h = rr(2,15); const v = r*r*h; return mp('Volume: r='+r+', h='+h+', r\u00b2\u00d7h = ?', v, 'volume', r*r, h, 'mul'); },
            () => { const x1=rr(1,5),y1=rr(1,5),x2=rr(6,10),y2=rr(6,10); return mp('Rise/Run: ('+x1+','+y1+') to ('+x2+','+y2+'). Rise = ?', y2-y1, 'slope (rise)', y2, y1, 'sub'); },
            () => { const a = rr(2,20), b = rr(2,20); return mp(a+'\u00b2 + '+b+'\u00b2 = ?', a*a+b*b, 'Pythagorean sum', a*a, b*b, 'add'); },
        ],
        advanced: [
            () => { const n = rr(2,8); let f=1; for(let i=2;i<=n;i++) f*=i; return mp(n+'! (factorial)', f, 'factorial', n, 0, 'factorial'); },
            () => { const a=rr(2,6),b=rr(2,6),c=rr(1,5); return mp(a+'\u00d7'+b+' + '+a+'\u00d7'+c+' = '+a+'('+b+'+'+c+')', a*(b+c), 'distributive', a, b+c, 'mul'); },
            () => { const a=rr(2,10),n=rr(2,4); let p=1; for(let i=0;i<n;i++) p*=a; return mp(a+'^'+n, p, 'exponent', a, n, 'exp'); },
            () => { const a=rr(10,99),b=rr(10,99); return mp('GCD-step: '+a+' mod '+b+' = ?', a%b, 'modular', a, b, 'mod'); },
        ],
    };

    const pool = pools[tier] || pools.early;
    const fn = pool[solved % pool.length];

    const base = fn();
    const stories = {
        early: [
            'You have some apples in a basket.',
            'Count the stars in the sky!',
            'Help the robot count blocks.',
        ],
        elementary: [
            'A farmer is planting rows of seeds.',
            'How many tiles cover the floor?',
            'Split the candies equally among friends.',
        ],
        middle: [
            'Calculate the area of the garden.',
            'Divide the supplies for the expedition.',
            'Find the missing measurement.',
        ],
        high: [
            'Solve for the unknown variable.',
            'Calculate the geometric measurement.',
            'Apply the formula to find the answer.',
        ],
        advanced: [
            'Evaluate the mathematical expression.',
            'Apply the algebraic identity.',
            'Compute the result step by step.',
        ],
    };
    const storyPool = stories[tier] || stories.early;
    base.story = storyPool[Math.floor(Math.random() * storyPool.length)];
    return base;
}

function rr(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function mp(question, answer, opName, a, b, opType, origA, origB) {
    return { question, answer, opName, a, b, opType, origA, origB, story: '' };
}

function checkChallenge() {
    if (!currentChallenge) return;
    const answerEl = document.getElementById('challengeAnswer');
    const resultEl = document.getElementById('challengeResult');
    const explainEl = document.getElementById('challengeExplain');
    if (!answerEl || !resultEl) return;

    const userAnswer = parseFloat(answerEl.value.trim());
    if (isNaN(userAnswer)) {
        resultEl.className = 'challenge-result incorrect';
        resultEl.textContent = 'Please enter a number.';
        return;
    }

    if (userAnswer === currentChallenge.answer) {
        resultEl.className = 'challenge-result correct';
        resultEl.textContent = 'Correct! The answer is ' + currentChallenge.answer + '.';

        const progress = getStudentProgress();
        progress.challengesSolved = (progress.challengesSolved || 0) + 1;
        saveStudentProgress(progress);

        showChallengeExplanation(explainEl, currentChallenge);
    } else {
        resultEl.className = 'challenge-result incorrect';
        resultEl.textContent = 'Not quite. Try again!';
    }
}

function showChallengeHint() {
    if (!currentChallenge) return;
    const resultEl = document.getElementById('challengeResult');
    if (!resultEl) return;

    const c = currentChallenge;
    let hint = '';
    if (c.opType === 'add') hint = 'Add ' + c.a + ' and ' + c.b + ' together.';
    else if (c.opType === 'sub') hint = 'Subtract ' + c.b + ' from ' + c.a + '.';
    else if (c.opType === 'mul') hint = 'Multiply ' + c.a + ' by ' + c.b + '.';
    else if (c.opType === 'div') hint = 'Divide ' + c.a + ' by ' + c.b + '.';
    else if (c.opType === 'factorial') hint = 'Multiply all numbers from 1 up to ' + c.a + '.';
    else if (c.opType === 'exp') hint = 'Multiply ' + c.a + ' by itself ' + c.b + ' times.';
    else if (c.opType === 'mod') hint = 'What is the remainder when ' + c.a + ' is divided by ' + c.b + '?';
    else hint = 'Think about ' + c.opName + ' step by step.';

    resultEl.className = 'challenge-result hint';
    resultEl.textContent = 'Hint: ' + hint;
}

function challengeOpName(opType) {
    const names = { add: 'ADD', sub: 'SUB', mul: 'MUL', div: 'DIV', factorial: 'FACTORIAL', exp: 'POW', mod: 'MOD' };
    return names[opType] || 'COMPUTE';
}

function challengeOpSymbol(opType) {
    const syms = { add: '+', sub: '-', mul: '\u00d7', div: '\u00f7', exp: '^', mod: '%' };
    return syms[opType] || '?';
}

function challengeOpSlot(opType) {
    const slots = { add: 22, sub: 23, mul: 24, div: 25, factorial: 26, exp: 24, mod: 25 };
    return slots[opType] || 22;
}

function buildTuringLines(c) {
    const lines = [];
    if (c.opType === 'add') {
        lines.push({asm: 'IADD DR0, DR0, DR1', desc: 'Add DR0 + DR1, store result (' + c.answer + ') in DR0'});
        lines.push({note: 'DR0 = ' + c.a + ', DR1 = ' + c.b + '. IADD is "integer add". Everything is a number. The body works in numbers.'});
    } else if (c.opType === 'sub') {
        lines.push({asm: 'ISUB DR0, DR0, DR1', desc: 'Subtract DR1 from DR0, store result (' + c.answer + ') in DR0'});
        lines.push({note: 'DR0 = ' + c.a + ', DR1 = ' + c.b + '. ISUB is "integer subtract". DR0, DR1 are physical addresses holding numbers.'});
    } else if (c.opType === 'mul') {
        lines.push({asm: 'DREAD DR2, #0', desc: 'Set DR2 to 0 (running total)'});
        lines.push({asm: 'IADD DR2, DR2, DR0', desc: 'Add DR0 to DR2 (repeat DR1 times)'});
        lines.push({asm: 'ISUB DR1, DR1, #1', desc: 'Count down: subtract 1 from DR1'});
        lines.push({asm: 'BRANCH NE, -2', desc: 'If DR1 is not zero, jump back and add again'});
        lines.push({asm: 'DREAD DR0, DR2', desc: 'Copy result to DR0'});
        lines.push({note: 'No multiply instruction! The body loops: add ' + c.a + ' to itself ' + c.b + ' times. ' + c.a + ' \u00d7 ' + c.b + ' = ' + c.answer + '. Loops can run forever \u2014 the body can fail.'});
    } else if (c.opType === 'div') {
        lines.push({asm: 'DREAD DR2, #0', desc: 'Set DR2 to 0 (counts subtractions)'});
        lines.push({asm: 'ISUB DR0, DR0, DR1', desc: 'Subtract DR1 from DR0'});
        lines.push({asm: 'IADD DR2, DR2, #1', desc: 'Add 1 to the counter'});
        lines.push({asm: 'BRANCH PL, -2', desc: 'If DR0 is still positive, keep subtracting'});
        lines.push({asm: 'DREAD DR0, DR2', desc: 'Copy result to DR0'});
        lines.push({note: 'Division is repeated subtraction. Subtract ' + c.b + ' from ' + c.a + ' and count: ' + c.answer + ' times. All numbers, all physical.'});
    } else if (c.opType === 'factorial') {
        lines.push({asm: 'DREAD DR1, DR0', desc: 'Copy ' + c.a + ' into DR1 (counter)'});
        lines.push({asm: 'DREAD DR0, #1', desc: 'Set DR0 to 1 (running product)'});
        lines.push({asm: '-- outer loop:', desc: 'For each counter value, multiply DR0 by DR1'});
        lines.push({asm: 'DREAD DR2, DR0', desc: 'Copy the current product into DR2'});
        lines.push({asm: 'DREAD DR0, #0', desc: 'Reset DR0 for the add loop'});
        lines.push({asm: 'DREAD DR3, DR1', desc: 'Copy counter into DR3 (inner loop count)'});
        lines.push({asm: 'IADD DR0, DR0, DR2', desc: 'Add DR2 to DR0 (repeated DR1 times = multiply)'});
        lines.push({asm: 'ISUB DR3, DR3, #1', desc: 'Decrease inner loop counter'});
        lines.push({asm: 'BRANCH NE, -2', desc: 'Inner loop: keep adding until DR3 = 0'});
        lines.push({asm: 'ISUB DR1, DR1, #1', desc: 'Decrease the outer counter by 1'});
        lines.push({asm: 'BRANCH NE, -8', desc: 'Outer loop: repeat for next factor'});
        lines.push({note: c.a + '! = ' + c.answer + '. Two nested loops of addition \u2014 the body builds complexity from simple parts. Result ends up in DR0.'});
    } else if (c.opType === 'exp') {
        lines.push({asm: 'DREAD DR2, #1', desc: 'Set DR2 to 1 (result starts at 1)'});
        lines.push({asm: '-- outer loop:', desc: 'Multiply DR2 by DR0, using an add loop'});
        lines.push({asm: 'DREAD DR3, DR2', desc: 'Copy current result into DR3'});
        lines.push({asm: 'DREAD DR2, #0', desc: 'Reset DR2 for the add loop'});
        lines.push({asm: 'DREAD DR4, DR0', desc: 'Copy base into DR4 (inner loop count)'});
        lines.push({asm: 'IADD DR2, DR2, DR3', desc: 'Add DR3 to DR2 (repeated DR0 times = multiply)'});
        lines.push({asm: 'ISUB DR4, DR4, #1', desc: 'Decrease inner counter'});
        lines.push({asm: 'BRANCH NE, -2', desc: 'Inner loop: keep adding'});
        lines.push({asm: 'ISUB DR1, DR1, #1', desc: 'Decrease exponent counter'});
        lines.push({asm: 'BRANCH NE, -8', desc: 'Outer loop until exponent reaches 0'});
        lines.push({asm: 'DREAD DR0, DR2', desc: 'Copy result to DR0'});
        lines.push({note: c.a + '^' + c.b + ' = ' + c.answer + '. Repeated multiplication, each multiplication repeated addition. Two nested loops, all numbers. Result in DR0.'});
    } else if (c.opType === 'mod') {
        lines.push({asm: 'ISUB DR0, DR0, DR1', desc: 'Subtract DR1 from DR0'});
        lines.push({asm: 'BRANCH PL, -1', desc: 'If still positive, keep subtracting'});
        lines.push({asm: 'IADD DR0, DR0, DR1', desc: 'Add back once (remainder = ' + c.answer + ')'});
        lines.push({note: 'Modulo: subtract ' + c.b + ' from ' + c.a + ' until it goes negative, then add back once. Result ' + c.answer + ' is in DR0.'});
    } else {
        lines.push({asm: 'Operation', desc: 'Compute ' + c.a + ' op ' + c.b + ' = ' + c.answer});
        lines.push({note: 'The body computes the result in DR0. All numbers, all physical addresses.'});
    }
    return lines;
}

function showChallengeExplanation(el, c) {
    if (!el) return;

    const opName = challengeOpName(c.opType);
    const slot = challengeOpSlot(c.opType);
    const sym = challengeOpSymbol(c.opType);
    const exprStr = c.opType === 'factorial' ? c.a + '!' : c.a + ' ' + sym + ' ' + c.b;

    let html = '';

    html += `<div class="explain-turing">`;
    html += `<div class="explain-header">The body \u2014 Turing (numbers)</div>`;
    if (c.opType === 'factorial') {
        html += `<div style="font-size:0.78rem;color:rgba(130,200,255,0.7);margin-bottom:0.3rem;">Inside the envelope: DR0 = ${c.a}</div>`;
    } else {
        html += `<div style="font-size:0.78rem;color:rgba(130,200,255,0.7);margin-bottom:0.3rem;">Inside the envelope: DR0 = ${c.a}, DR1 = ${c.b}</div>`;
    }
    const turingLines = buildTuringLines(c);
    for (const line of turingLines) {
        if (line.note) {
            html += `<div style="margin-top:0.3rem;font-size:0.78rem;font-style:italic;color:rgba(130,200,255,0.8);">${escapeHtml(line.note)}</div>`;
        } else {
            html += `<div class="code-line">`;
            html += `<span class="code-asm" style="color:rgba(130,200,255,0.9);">${escapeHtml(line.asm)}</span>`;
            html += `<span class="code-desc">${escapeHtml(line.desc)}</span>`;
            html += `</div>`;
        }
    }
    html += `</div>`;

    html += `<div class="explain-church">`;
    html += `<div class="explain-header">The mind \u2014 Church (symbols)</div>`;

    const churchLines = [];
    if (c.opType === 'factorial') {
        churchLines.push({label: 'A', expr: '= ' + c.a});
        churchLines.push({label: 'C', expr: '= CALL.FACTORIAL (A!)'});
    } else {
        churchLines.push({label: 'A', expr: '= ' + c.a});
        churchLines.push({label: 'B', expr: '= ' + c.b});
        churchLines.push({label: 'C', expr: '= CALL.' + opName + ' (A ' + sym + ' B)'});
    }

    for (const line of churchLines) {
        html += `<div class="code-line">`;
        html += `<span class="code-hex" style="min-width:28px;color:var(--church-gold);font-weight:700;">${escapeHtml(line.label)}</span>`;
        html += `<span class="code-asm">${escapeHtml(line.expr)}</span>`;
        html += `</div>`;
    }
    html += `<div style="margin-top:0.3rem;font-size:0.78rem;font-style:italic;color:var(--church-gold);opacity:0.8;">CALL names the abstraction. A and B are symbols, not addresses. The mind works in mathematics.</div>`;
    html += `</div>`;

    el.innerHTML = html;
}

function showMathGuidePopup(force) {
    if (POPUPS_DISABLED) return;
    if (!force && localStorage.getItem('churchMachine_mathGuideDismissed_perm')) return;
    if (!force && localStorage.getItem('churchMachine_mathGuideDismissed')) return;
    if (!force && !localStorage.getItem('church_welcome_dismissed')) return;

    const modal = document.getElementById('mathGuideModal');
    const body = document.getElementById('mathGuideBody');
    if (!modal || !body) return;

    body.innerHTML =
        `<p style="font-size:0.9rem;line-height:1.65;margin-bottom:0.75rem;">` +
        `This page has two sides, separated by a moveable bar.</p>` +

        `<div style="display:flex;gap:1rem;margin-bottom:0.75rem;">` +

        `<div style="flex:1;background:rgba(218,165,32,0.08);border:1px solid rgba(218,165,32,0.25);border-radius:8px;padding:0.6rem 0.8rem;">` +
        `<div style="font-weight:700;color:var(--church-gold);margin-bottom:0.3rem;">Left &mdash; The Mind</div>` +
        `<p style="font-size:0.82rem;line-height:1.5;margin:0;">` +
        `Church domain. Symbols and permissions. The calculation becomes: ` +
        `<strong>A = 3, B = 1, C = CALL.ADD (A + B)</strong> &mdash; pure mathematics, no registers. ` +
        `CALL names the abstraction, the envelope opens, the body runs inside, and the envelope closes. ` +
        `<a href="https://en.wikipedia.org/wiki/Lambda_calculus" target="_blank" rel="noopener" style="color:var(--church-gold);">More</a></p>` +
        `</div>` +

        `<div style="flex:1;background:rgba(100,180,255,0.08);border:1px solid rgba(100,180,255,0.25);border-radius:8px;padding:0.6rem 0.8rem;">` +
        `<div style="font-weight:700;color:rgba(130,200,255,0.95);margin-bottom:0.3rem;">Right &mdash; The Body</div>` +
        `<p style="font-size:0.82rem;line-height:1.5;margin:0;">` +
        `Turing domain. Numbers and physical addresses. The challenge panel shows how the body computes: ` +
        `<strong>IADD DR0, DR0, DR1</strong> &mdash; add two registers. ` +
        `Values that can overflow. Loops that can run forever. The body can fail. ` +
        `<a href="https://en.wikipedia.org/wiki/Turing_machine" target="_blank" rel="noopener" style="color:rgba(130,200,255,0.95);">More</a></p>` +
        `</div>` +

        `</div>` +

        `<div style="background:rgba(180,140,255,0.06);border:1px solid rgba(180,140,255,0.2);border-radius:8px;padding:0.6rem 0.8rem;margin-bottom:0.75rem;">` +
        `<div style="font-weight:700;color:rgba(180,140,255,0.95);margin-bottom:0.3rem;">Where Mind meets Body &mdash; Pythagoras to Church</div>` +
        `<p style="font-size:0.82rem;line-height:1.5;margin:0 0 0.4rem 0;">` +
        `Pythagoras discovered that a stretched string half the length produces a note one octave higher. ` +
        `The <span style="color:rgba(100,200,100,0.95);font-weight:600;">symbol</span> (the ratio 2:1) and the ` +
        `<span style="color:rgba(130,200,255,0.95);font-weight:600;">mechanism</span> (the vibrating string) are different things &mdash; ` +
        `but one governs the other. This is the oldest known link between mathematics and physics.</p>` +
        `<p style="font-size:0.82rem;line-height:1.5;margin:0 0 0.4rem 0;">` +
        `The slide rule shows it perfectly. The <span style="color:rgba(100,200,100,0.95);font-weight:600;">green C scale</span> is the symbol &mdash; ` +
        `an abstract logarithmic ruler where <em>position</em> represents a number. ` +
        `The <span style="color:rgba(130,200,255,0.95);font-weight:600;">physical slide</span> is the mechanism &mdash; ` +
        `moving it adds lengths, and because the scale is logarithmic, adding lengths <em>multiplies numbers</em>. ` +
        `The symbol (log) controls what the body (slide) does.</p>` +
        `<p style="font-size:0.82rem;line-height:1.5;margin:0 0 0.4rem 0;">` +
        `The Church Machine works the same way. ` +
        `<span style="color:rgba(100,200,100,0.95);font-weight:600;">Symbols</span>: Golden Tokens, permissions, ` +
        `<code>CALL R0, #greet</code>. ` +
        `<span style="color:rgba(130,200,255,0.95);font-weight:600;">Mechanics</span>: registers, memory addresses, ` +
        `<code>ADD R2, R0, R1</code>. ` +
        `The symbol controls what the registers do &mdash; just as the ratio 2:1 controls what the string does, ` +
        `and just as log(a) + log(b) controls what the slide rule computes.</p>` +
        `<p style="font-size:0.82rem;line-height:1.5;margin:0;">` +
        `Pythagoras heard it in strings. Napier carved it into slide rules. Church wrote it in functions. ` +
        `The Church Machine runs it in hardware. ` +
        `<a href="https://en.wikipedia.org/wiki/Musica_universalis" target="_blank" rel="noopener" style="color:rgba(180,140,255,0.95);">More</a></p>` +
        `</div>` +

        `<div style="background:rgba(100,200,100,0.06);border:1px solid rgba(100,200,100,0.2);border-radius:8px;padding:0.6rem 0.8rem;">` +
        `<p style="font-size:0.82rem;line-height:1.5;margin:0 0 0.4rem 0;">` +
        `Ada wrote the first program in 1843 using symbols &mdash; no compiler, no OS, no superuser. ` +
        `The Church Machine returns to what she had. ` +
        `<a href="https://en.wikipedia.org/wiki/Ada_Lovelace" target="_blank" rel="noopener" style="color:rgba(100,200,100,0.9);">More</a></p>` +
        `<p style="font-size:0.82rem;line-height:1.5;margin:0 0 0.4rem 0;">` +
        `Turing was Church\u2019s student. He built the body. His teacher gave it a mind.</p>` +
        `<p style="font-size:0.82rem;line-height:1.5;margin:0 0 0.4rem 0;">` +
        `The von Neumann design that every computer uses today is like body parts without an integrated mental framework \u2014 ` +
        `many exposed mechanics sharing the same mindless open space, ` +
        `every gear can touch every other gear, and every new part makes collisions more likely.</p>` +
        `<p style="font-size:0.82rem;line-height:1.5;margin:0 0 0.4rem 0;">` +
        `The more it grows, the more unreliable it becomes.</p>` +
        `<p style="font-size:0.82rem;line-height:1.5;margin:0;">` +
        `The Church Machine puts each clockwork inside its own sealed envelope, ` +
        `so they can only interact through the tokens they have been given.</p>` +
        `</div>`;

    modal.style.display = 'flex';
}

function dismissMathGuide() {
    const dontShow = document.getElementById('mathGuideDontShow');
    if (dontShow && dontShow.checked) {
        localStorage.setItem('churchMachine_mathGuideDismissed_perm', '1');
    }
    localStorage.setItem('churchMachine_mathGuideDismissed', '1');
    const modal = document.getElementById('mathGuideModal');
    if (modal) modal.style.display = 'none';
    const activeTab = document.querySelector('.math-mode-tab.active');
    const activeModeId = activeTab ? activeTab.id.replace('mathTab', '').toLowerCase() : 'hp35';
    const modeMap = { 'hp35': 'hp35', 'abacus': 'abacus', 'sliderule': 'sliderule', 'interactive': 'interactive' };
    showToolGuide(modeMap[activeModeId] || 'hp35');
}

function resetAllPopups() {
    localStorage.removeItem('church_welcome_dismissed');
    localStorage.removeItem('church_welcome_dismissed_perm');
    localStorage.removeItem('churchMachine_mathGuideDismissed');
    localStorage.removeItem('churchMachine_mathGuideDismissed_perm');
    localStorage.removeItem('churchMachine_toolGuide_interactive');
    localStorage.removeItem('churchMachine_toolGuide_interactive_perm');
    localStorage.removeItem('churchMachine_toolGuide_hp35');
    localStorage.removeItem('churchMachine_toolGuide_hp35_perm');
    localStorage.removeItem('churchMachine_toolGuide_abacus');
    localStorage.removeItem('churchMachine_toolGuide_abacus_perm');
    localStorage.removeItem('churchMachine_toolGuide_sliderule');
    localStorage.removeItem('churchMachine_toolGuide_sliderule_perm');
    closeSettings();
}

const TOOL_GUIDES = {
    interactive: {
        title: 'Pure Math',
        body:
            `<div style="display:flex;gap:0.5rem;align-items:center;margin-bottom:0.75rem;">` +
            `<span style="font-size:2rem;">&#955;</span>` +
            `<div><strong style="font-size:1rem;">Your lambda calculus notebook</strong>` +
            `<p style="font-size:0.82rem;color:var(--text-secondary);margin:0.2rem 0 0;">Type maths, see it run on the Church Machine.</p></div></div>` +

            `<div style="background:rgba(218,165,32,0.08);border:1px solid rgba(218,165,32,0.25);border-radius:8px;padding:0.6rem 0.8rem;margin-bottom:0.65rem;">` +
            `<div style="font-weight:700;color:var(--church-gold);margin-bottom:0.3rem;">What can I do?</div>` +
            `<ul style="font-size:0.82rem;line-height:1.6;margin:0;padding-left:1.2rem;">` +
            `<li>Type <code>let x = 2 + 3</code> and press Enter to compute</li>` +
            `<li>Build up calculations step by step \u2014 each line remembers the last</li>` +
            `<li>Click <strong>Compile Session</strong> to turn your work into real Church Machine code</li>` +
            `<li>The right panel shows how the machine runs your calculation</li></ul></div>` +

            `<div style="background:rgba(100,200,100,0.06);border:1px solid rgba(100,200,100,0.2);border-radius:8px;padding:0.6rem 0.8rem;">` +
            `<div style="font-weight:600;color:rgba(100,200,100,0.9);font-size:0.78rem;text-transform:uppercase;letter-spacing:1px;margin-bottom:0.3rem;">How to learn</div>` +
            `<p style="font-size:0.82rem;line-height:1.55;margin:0;">` +
            `Start simple: <code>let a = 5</code>, then <code>let b = a * 2</code>. ` +
            `Watch the right side \u2014 it shows what the processor does with your symbols. ` +
            `This is how Ada Lovelace wrote her first program in 1843: symbols first, then the machine runs them. ` +
            `<a href="https://en.wikipedia.org/wiki/Ada_Lovelace" target="_blank" rel="noopener" style="color:rgba(100,200,100,0.9);">More</a></p></div>`
    },
    hp35: {
        title: 'HP-35 Scientific Calculator',
        body:
            `<div style="display:flex;gap:0.5rem;align-items:center;margin-bottom:0.75rem;">` +
            `<span style="font-size:2rem;">&#128425;</span>` +
            `<div><strong style="font-size:1rem;">The calculator that changed the world</strong>` +
            `<p style="font-size:0.82rem;color:var(--text-secondary);margin:0.2rem 0 0;">A 1972 HP-35, rebuilt in pure lambda calculus. <a href="https://en.wikipedia.org/wiki/HP-35" target="_blank" rel="noopener" style="color:var(--church-gold);">More</a></p></div></div>` +

            `<div style="background:rgba(218,165,32,0.08);border:1px solid rgba(218,165,32,0.25);border-radius:8px;padding:0.6rem 0.8rem;margin-bottom:0.65rem;">` +
            `<div style="font-weight:700;color:var(--church-gold);margin-bottom:0.3rem;">What can I do?</div>` +
            `<ul style="font-size:0.82rem;line-height:1.6;margin:0;padding-left:1.2rem;">` +
            `<li>Type a number, press <strong>ENTER</strong> to push it onto the stack</li>` +
            `<li>Type another number, then press an operator (+, \u2212, \u00d7, \u00f7)</li>` +
            `<li>Use scientific functions: <strong>sin</strong>, <strong>cos</strong>, <strong>tan</strong>, <strong>log</strong>, <strong>ln</strong>, <strong>\u221a</strong></li>` +
            `<li>The <strong>stack</strong> panel shows X, Y, Z, T registers \u2014 just like the real HP-35</li></ul></div>` +

            `<div style="background:rgba(100,180,255,0.08);border:1px solid rgba(100,180,255,0.25);border-radius:8px;padding:0.6rem 0.8rem;margin-bottom:0.65rem;">` +
            `<div style="font-weight:600;color:rgba(130,200,255,0.95);font-size:0.78rem;text-transform:uppercase;letter-spacing:1px;margin-bottom:0.3rem;">RPN \u2014 Reverse Polish Notation</div>` +
            `<p style="font-size:0.82rem;line-height:1.55;margin:0;">` +
            `Instead of typing <code>2 + 3 =</code>, you type <code>2 ENTER 3 +</code>. ` +
            `Put the numbers in first, then say what to do with them. ` +
            `No brackets needed, ever. Astronauts used this on Apollo missions! ` +
            `<a href="https://en.wikipedia.org/wiki/Reverse_Polish_notation" target="_blank" rel="noopener" style="color:rgba(130,200,255,0.95);">More</a></p></div>` +

            `<div style="background:rgba(100,200,100,0.06);border:1px solid rgba(100,200,100,0.2);border-radius:8px;padding:0.6rem 0.8rem;">` +
            `<div style="font-weight:600;color:rgba(100,200,100,0.9);font-size:0.78rem;text-transform:uppercase;letter-spacing:1px;margin-bottom:0.3rem;">How to learn</div>` +
            `<p style="font-size:0.82rem;line-height:1.55;margin:0;">` +
            `Try this: press <strong>5</strong>, then <strong>ENTER</strong>, then <strong>3</strong>, then <strong>+</strong>. ` +
            `The answer (8) appears in X. Watch the lambda trace on the right \u2014 ` +
            `it shows Church numerals doing the same calculation with pure logic.</p></div>`
    },
    abacus: {
        title: 'Soroban Abacus',
        body:
            `<div style="display:flex;gap:0.5rem;align-items:center;margin-bottom:0.75rem;">` +
            `<span style="font-size:2rem;">&#129518;</span>` +
            `<div><strong style="font-size:1rem;">The oldest computer in the world</strong>` +
            `<p style="font-size:0.82rem;color:var(--text-secondary);margin:0.2rem 0 0;">A Japanese soroban \u2014 people have used these for 2,500 years. <a href="https://en.wikipedia.org/wiki/Soroban" target="_blank" rel="noopener" style="color:var(--church-gold);">More</a></p></div></div>` +

            `<div style="background:rgba(218,165,32,0.08);border:1px solid rgba(218,165,32,0.25);border-radius:8px;padding:0.6rem 0.8rem;margin-bottom:0.65rem;">` +
            `<div style="font-weight:700;color:var(--church-gold);margin-bottom:0.3rem;">What can I do?</div>` +
            `<ul style="font-size:0.82rem;line-height:1.6;margin:0;padding-left:1.2rem;">` +
            `<li>Click beads to move them \u2014 beads touching the bar count</li>` +
            `<li>Each <strong>top bead</strong> (heaven bead) is worth <strong>5</strong></li>` +
            `<li>Each <strong>bottom bead</strong> (earth bead) is worth <strong>1</strong></li>` +
            `<li>The digital readout shows your current number</li>` +
            `<li>Columns go right to left: ones, tens, hundreds, thousands\u2026</li></ul></div>` +

            `<div style="background:rgba(100,200,100,0.06);border:1px solid rgba(100,200,100,0.2);border-radius:8px;padding:0.6rem 0.8rem;">` +
            `<div style="font-weight:600;color:rgba(100,200,100,0.9);font-size:0.78rem;text-transform:uppercase;letter-spacing:1px;margin-bottom:0.3rem;">How to learn</div>` +
            `<p style="font-size:0.82rem;line-height:1.55;margin:0;">` +
            `Start by making the number 7: move one heaven bead down (5) and two earth beads up (1+1). ` +
            `Now try 42: on the tens column move 4 earth beads up, on the ones column move 2 earth beads up. ` +
            `The trace shows CALL Abacus instructions \u2014 every click is a Church Machine operation.</p></div>`
    },
    sliderule: {
        title: 'Logarithmic Slide Rule',
        body:
            `<div style="display:flex;gap:0.5rem;align-items:center;margin-bottom:0.75rem;">` +
            `<span style="font-size:2rem;">&#128207;</span>` +
            `<div><strong style="font-size:1rem;">The tool that built the modern world</strong>` +
            `<p style="font-size:0.82rem;color:var(--text-secondary);margin:0.2rem 0 0;">Engineers used slide rules for 350 years \u2014 from bridges to moon rockets. <a href="https://en.wikipedia.org/wiki/Slide_rule" target="_blank" rel="noopener" style="color:var(--church-gold);">More</a></p></div></div>` +

            `<div style="background:rgba(218,165,32,0.08);border:1px solid rgba(218,165,32,0.25);border-radius:8px;padding:0.6rem 0.8rem;margin-bottom:0.65rem;">` +
            `<div style="font-weight:700;color:var(--church-gold);margin-bottom:0.3rem;">What can I do?</div>` +
            `<ul style="font-size:0.82rem;line-height:1.6;margin:0;padding-left:1.2rem;">` +
            `<li><strong>Drag the green C scale</strong> left or right to set the first number</li>` +
            `<li><strong>Drag the red cursor</strong> to read the answer on the D scale</li>` +
            `<li>Use the <strong>preset buttons</strong> (2\u00d73, \u03c0\u00d72) to see worked examples</li>` +
            `<li>Switch scale modes: C/D (multiply), A/B (squares), S/T (trig) and more</li></ul></div>` +

            `<div style="background:rgba(100,180,255,0.08);border:1px solid rgba(100,180,255,0.25);border-radius:8px;padding:0.6rem 0.8rem;margin-bottom:0.65rem;">` +
            `<div style="font-weight:600;color:rgba(130,200,255,0.95);font-size:0.78rem;text-transform:uppercase;letter-spacing:1px;margin-bottom:0.3rem;">How does it work?</div>` +
            `<p style="font-size:0.82rem;line-height:1.55;margin:0;">` +
            `Multiplication is just <em>adding lengths</em>. The scales are spaced by logarithms, so ` +
            `sliding log(a) + log(b) gives log(a\u00d7b). The labels <span style="color:#ff6644;">a</span> and ` +
            `<span style="color:#44aaff;">b</span> above the scale show you what\u2019s happening. ` +
            `<a href="https://en.wikipedia.org/wiki/Logarithm" target="_blank" rel="noopener" style="color:rgba(130,200,255,0.95);">More</a></p></div>` +

            `<div style="background:rgba(100,200,100,0.06);border:1px solid rgba(100,200,100,0.2);border-radius:8px;padding:0.6rem 0.8rem;">` +
            `<div style="font-weight:600;color:rgba(100,200,100,0.9);font-size:0.78rem;text-transform:uppercase;letter-spacing:1px;margin-bottom:0.3rem;">How to learn</div>` +
            `<p style="font-size:0.82rem;line-height:1.55;margin:0;">` +
            `Click <strong>2 \u00d7 3</strong> to see the slide rule compute 6. Watch the hand-drawn arrow appear below. ` +
            `Then try dragging the C scale yourself and moving the cursor. ` +
            `NASA engineers calculated the Apollo trajectory with slide rules like this one.</p></div>`
    }
};

let currentToolGuide = null;
let currentMathMode = 'hp35';

function openCurrentToolGuide() {
    showToolGuide(currentMathMode, true);
}

function showToolGuide(tool, force) {
    if (POPUPS_DISABLED) return;
    if (!TOOL_GUIDES[tool]) return;
    if (!force && localStorage.getItem('churchMachine_toolGuide_' + tool + '_perm')) return;
    if (!force && localStorage.getItem('churchMachine_toolGuide_' + tool)) return;
    if (!force && !localStorage.getItem('church_welcome_dismissed')) return;
    if (!force && !localStorage.getItem('churchMachine_mathGuideDismissed')) return;

    const modal = document.getElementById('toolGuideModal');
    const title = document.getElementById('toolGuideTitle');
    const body = document.getElementById('toolGuideBody');
    if (!modal || !title || !body) return;

    const guide = TOOL_GUIDES[tool];
    title.textContent = guide.title;
    body.innerHTML = guide.body;
    currentToolGuide = tool;
    modal.style.display = 'flex';
}

function dismissToolGuide() {
    if (currentToolGuide) {
        localStorage.setItem('churchMachine_toolGuide_' + currentToolGuide, '1');
        const dontShow = document.getElementById('toolGuideDontShow');
        if (dontShow && dontShow.checked) {
            localStorage.setItem('churchMachine_toolGuide_' + currentToolGuide + '_perm', '1');
        }
    }
    const modal = document.getElementById('toolGuideModal');
    if (modal) modal.style.display = 'none';
    currentToolGuide = null;
}

function updateMathWelcome() {
    const el = document.getElementById('replWelcomeMsg');
    if (!el) return;
    const settings = getStudentSettings();
    const progress = getStudentProgress();
    const grade = settings.grade || '';
    const name = settings.name || '';
    const sessions = progress.replSessions || 0;

    let prompt = '';
    const greeting = name ? `Hi ${escapeHtml(name)}! ` : '';

    if (grade === 'K' || grade === '1' || grade === '2') {
        if (sessions === 0) prompt = greeting + 'Try typing: let x = 2 + 3';
        else if (sessions < 3) prompt = greeting + 'Nice work! Now try: let y = 5 - 1';
        else if (sessions < 6) prompt = greeting + 'Can you try: let z = 4 + 4';
        else prompt = greeting + 'Keep going! Try adding bigger numbers together.';
    } else if (grade === '3' || grade === '4' || grade === '5') {
        if (sessions === 0) prompt = greeting + 'Try typing: let x = 6 * 7';
        else if (sessions < 3) prompt = greeting + 'Great! Now try: let y = 100 / 4';
        else if (sessions < 6) prompt = greeting + 'Try this: let area = 12 * 8';
        else prompt = greeting + 'Challenge: try let total = 25 * 4 + 10';
    } else if (grade === '6' || grade === '7' || grade === '8') {
        if (sessions === 0) prompt = greeting + 'Try typing: let ratio = 355 / 113';
        else if (sessions < 3) prompt = greeting + 'Now try: let area = 3 * 3 + 4 * 4';
        else if (sessions < 6) prompt = greeting + 'Try: let percent = 45 / 200 * 100';
        else prompt = greeting + 'Explore: try defining variables and using them in expressions.';
    } else if (grade === '9' || grade === '10') {
        if (sessions === 0) prompt = greeting + 'Try typing: let slope = (8 - 2) / (5 - 1)';
        else if (sessions < 3) prompt = greeting + 'Try: let area = 3 * 3 + 4 * 4';
        else prompt = greeting + 'Try the Compile Session button to see your math become machine code.';
    } else if (grade === '11' || grade === '12' || grade === 'IB') {
        if (sessions === 0) prompt = greeting + 'Try typing: let n = 5   then: let f = 1 * 2 * 3 * 4 * 5';
        else if (sessions < 3) prompt = greeting + 'Try: let series = 1 + 1/2 + 1/6 + 1/24';
        else prompt = greeting + 'Try Compile Session to see your math compile to machine instructions.';
    } else {
        if (sessions === 0) prompt = (greeting || 'Welcome! ') + 'Try typing: let x = 2 + 3';
        else if (sessions < 3) prompt = (greeting || '') + 'Nice! Now try: let y = 10 * 5';
        else if (sessions < 6) prompt = (greeting || '') + 'Try: let answer = 7 * 8 / 4';
        else prompt = (greeting || '') + 'Keep exploring! Type HELP to see all available commands.';
    }

    el.textContent = prompt;
}

var SUPERSCRIPT_MAP = {
    '0':'\u2070','1':'\u00B9','2':'\u00B2','3':'\u00B3','4':'\u2074',
    '5':'\u2075','6':'\u2076','7':'\u2077','8':'\u2078','9':'\u2079',
    '+':'\u207A','-':'\u207B','n':'\u207F','i':'\u2071'
};

function convertCaretToSuperscript(text) {
    return text.replace(/\^([0-9+\-ni]+)/g, function(match, digits) {
        var result = '';
        for (var i = 0; i < digits.length; i++) {
            result += SUPERSCRIPT_MAP[digits[i]] || digits[i];
        }
        return result;
    });
}

function _appendToTraceTab(command, result) {
    const traceLog = document.querySelector('.repl-trace-log');
    if (!traceLog) return;
    const hint = document.querySelector('.repl-trace-hint');
    if (hint) hint.style.display = 'none';

    const entry = document.createElement('div');
    entry.className = 'repl-trace-entry';

    const header = document.createElement('div');
    header.className = 'repl-trace-entry-header';
    header.textContent = '\u03BB> ' + command;
    entry.appendChild(header);

    const resultLine = document.createElement('div');
    resultLine.className = 'repl-trace-entry-result';
    resultLine.textContent = result.text;
    entry.appendChild(resultLine);

    if (result.churchSteps) {
        for (const step of result.churchSteps) {
            const stepEl = document.createElement('div');
            stepEl.className = 'repl-trace-entry-step';
            stepEl.textContent = step;
            entry.appendChild(stepEl);
        }
    }

    if (result.cycles) {
        const cyclesEl = document.createElement('div');
        cyclesEl.className = 'repl-trace-entry-cycles';
        cyclesEl.textContent = '\u23F1 ' + result.cycles + ' cycles';
        cyclesEl.title = 'The number of hardware clock cycles the Church Machine processor needs to evaluate this expression on the Tang Nano 20K FPGA. Each instruction (ELOADCALL, XLOADLAMBDA, RETURN) takes one cycle. Compound expressions chain multiple operations, so the total is the sum of all steps. Lower counts mean faster execution.';
        cyclesEl.style.cursor = 'help';
        entry.appendChild(cyclesEl);
    }

    traceLog.appendChild(entry);
    traceLog.scrollTop = traceLog.scrollHeight;
}

function replExecute(cmdOverride) {
    const input = document.getElementById('replInput');
    const output = document.getElementById('replOutput');
    if (!input || !output) return;

    const command = cmdOverride || input.value.trim();
    if (!command) return;

    output.innerHTML += `<div class="repl-input-echo">\u03BB&gt; ${convertCaretToSuperscript(escapeHtml(command))}</div>`;

    const result = repl.execute(command);
    if (result) {
        if (result.type === 'result') {
            output.innerHTML += `<div class="repl-result">${convertCaretToSuperscript(escapeHtml(result.text))}</div>`;
            _appendToTraceTab(command, result);
            if (result.pipeline && pipelineViz) {
                pipelineViz.showFullPipeline(result.pipeline);
            }
        } else if (result.type === 'error') {
            output.innerHTML += `<div class="repl-error">${escapeHtml(result.text)}</div>`;
        } else if (result.type === 'info') {
            output.innerHTML += `<div class="repl-info">${escapeHtml(result.text)}</div>`;
        }
    }

    if (!cmdOverride) input.value = '';
    output.scrollTop = output.scrollHeight;
}

function switchMathMode(mode) {
    currentMathMode = mode;
    const containers = {
        interactive: document.getElementById('interactiveMathContent'),
        hp35: document.getElementById('hp35Container'),
        abacus: document.getElementById('abacusContainer'),
        sliderule: document.getElementById('slideruleContainer')
    };
    const tabs = {
        interactive: document.getElementById('mathTabInteractive'),
        hp35: document.getElementById('mathTabHP35'),
        abacus: document.getElementById('mathTabAbacus'),
        sliderule: document.getElementById('mathTabSlideRule')
    };

    for (const key in containers) {
        if (containers[key]) {
            containers[key].style.display = key === mode ? (key === 'interactive' ? 'flex' : 'block') : 'none';
        }
    }
    for (const key in tabs) {
        if (tabs[key]) {
            tabs[key].classList.toggle('active', key === mode);
        }
    }

    if (mode === 'hp35' && !hp35State.rendered) renderHP35Calculator();
    if (mode === 'abacus' && !abacusState.rendered && typeof renderAbacusCalculator === 'function') renderAbacusCalculator();
    if (mode === 'sliderule' && !slideruleState.rendered && typeof renderSlideRuleCalculator === 'function') renderSlideRuleCalculator();

    const hiwTab = document.getElementById('sidebarTabHowItWorks');
    const htuTab = document.getElementById('sidebarTabHowToUse');
    const trTab = document.getElementById('sidebarTabTrace');
    if (hiwTab) hiwTab.style.display = '';
    if (htuTab) htuTab.style.display = '';
    if (trTab) trTab.style.display = '';
    populateHowItWorks(mode);
    populateHowToUse(mode);
    populateTrace(mode);
    switchSidebarTab('trace');

    if (typeof historySetTool === 'function') historySetTool(mode);

    showToolGuide(mode);
}

function switchCodeTab(tab) {
    const consoleContent = document.getElementById('codeConsoleContent');
    const historyPanel = document.getElementById('codeHistoryPanel');
    const syntaxPanel = document.getElementById('codeSyntaxPanel');
    const tabConsole = document.getElementById('codeTabConsole');
    const tabHistory = document.getElementById('codeTabHistory');
    const tabSyntax = document.getElementById('codeTabSyntax');

    if (consoleContent) consoleContent.style.display = 'none';
    if (historyPanel) historyPanel.style.display = 'none';
    if (syntaxPanel) syntaxPanel.style.display = 'none';
    if (tabConsole) tabConsole.classList.remove('active');
    if (tabHistory) tabHistory.classList.remove('active');
    if (tabSyntax) tabSyntax.classList.remove('active');

    if (tab === 'history') {
        if (historyPanel) historyPanel.style.display = 'block';
        if (tabHistory) tabHistory.classList.add('active');
        const area = document.getElementById('codeHistoryContent');
        if (area && !area.innerHTML.trim() && typeof historyRefreshCode === 'function') historyRefreshCode();
    } else if (tab === 'syntax') {
        if (syntaxPanel) syntaxPanel.style.display = 'block';
        if (tabSyntax) tabSyntax.classList.add('active');
        if (typeof renderSyntaxRef === 'function') renderSyntaxRef();
    } else {
        if (consoleContent) consoleContent.style.display = 'block';
        if (tabConsole) tabConsole.classList.add('active');
    }
}

function switchSidebarTab(tab) {
    const panels = {
        challenge: document.getElementById('sidebarChallengeContent'),
        history: document.getElementById('sidebarHistoryContent'),
        howitworks: document.getElementById('sidebarHowItWorksContent'),
        howtouse: document.getElementById('sidebarHowToUseContent'),
        trace: document.getElementById('sidebarTraceContent')
    };
    const tabs = {
        challenge: document.getElementById('sidebarTabChallenge'),
        history: document.getElementById('sidebarTabHistory'),
        howitworks: document.getElementById('sidebarTabHowItWorks'),
        howtouse: document.getElementById('sidebarTabHowToUse'),
        trace: document.getElementById('sidebarTabTrace')
    };

    for (const key in panels) { if (panels[key]) panels[key].style.display = 'none'; }
    for (const key in tabs) { if (tabs[key]) tabs[key].classList.remove('active'); }

    if (panels[tab]) panels[tab].style.display = 'block';
    if (tabs[tab]) tabs[tab].classList.add('active');

    if (tab === 'history' && typeof historyRefresh === 'function') {
        const area = document.getElementById('historyContent');
        if (area && !area.innerHTML.trim()) historyRefresh();
    }

    if (tab === 'trace') {
        const traceContainer = document.getElementById('sidebarTraceContent');
        if (traceContainer && !traceContainer.innerHTML.trim()) {
            const currentMode = document.querySelector('.math-tab.active');
            if (currentMode) {
                const modeId = currentMode.id.replace('mathTab', '').toLowerCase();
                const modeMap = { 'hp35': 'hp35', 'abacus': 'abacus', 'sliderule': 'sliderule', 'interactivemath': 'interactive' };
                populateTrace(modeMap[modeId] || 'interactive');
            }
        }
    }
}

function populateHowItWorks(mode) {
    const container = document.getElementById('sidebarHowItWorksContent');
    if (!container) return;

    const content = {
        hp35: `
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:var(--church-gold);">How the HP-35 Works</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    The HP-35 uses <strong>Reverse Polish Notation</strong> (RPN) &mdash; you enter numbers first, then the operation.
                    Type <code>2 ENTER 3 +</code> instead of <code>2 + 3 =</code>.
                    There are no brackets and no equals key. A <strong>4-register stack</strong> (X, Y, Z, T) holds intermediate results automatically.
                </div>
            </div>
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:rgba(130,200,255,0.95);">The Stack</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.4rem 0;">Every number you enter goes onto the <strong>X register</strong>. When you press ENTER, X is copied up to Y, making room for the next number.</p>
                    <p style="margin:0 0 0.4rem 0;">Operations like <code>+</code> take X and Y, compute the result, and put it back in X. The stack drops down &mdash; no lost values, no parentheses needed.</p>
                    <p style="margin:0;">This is exactly how the Church Machine&rsquo;s Turing domain manages data registers &mdash; push, operate, pop.</p>
                </div>
            </div>
            <div class="panel">
                <div class="panel-title" style="color:rgba(100,200,100,0.9);">Church Machine Connection</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.4rem 0;">Every key press is a <strong>Church Machine instruction</strong>. The trace panel shows each operation as a lambda expression.</p>
                    <p style="margin:0;"><code>SIN</code>, <code>LOG</code>, and <code>e<sup>x</sup></code> are all computed using the CORDIC algorithm &mdash; the same method used in the original 1972 chip, rebuilt here in pure lambda calculus.</p>
                </div>
            </div>`,

        abacus: `
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:var(--church-gold);">The Church Abstraction as a Digital Abacus</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.5rem 0;">A Church Machine <strong>abstraction</strong> is like a digital abacus &mdash; a self-contained block with rods (methods) and beads (data) that only the owner can move.</p>
                </div>
                <div style="display:flex;flex-direction:column;gap:0.25rem;margin-bottom:0.6rem;">
                    <div style="display:flex;justify-content:space-between;font-size:0.78rem;padding:0.25rem 0.5rem;background:rgba(0,0,0,0.2);border-radius:4px;">
                        <span style="color:var(--church-gold);">Abacus Frame</span><span style="color:var(--text-secondary);">\u2194</span><span style="color:rgba(130,200,255,0.95);">Abstraction (NS Entry)</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:0.78rem;padding:0.25rem 0.5rem;background:rgba(0,0,0,0.2);border-radius:4px;">
                        <span style="color:var(--church-gold);">Rods</span><span style="color:var(--text-secondary);">\u2194</span><span style="color:rgba(130,200,255,0.95);">Methods (code at offset 0)</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:0.78rem;padding:0.25rem 0.5rem;background:rgba(0,0,0,0.2);border-radius:4px;">
                        <span style="color:var(--church-gold);">Beads</span><span style="color:var(--text-secondary);">\u2194</span><span style="color:rgba(130,200,255,0.95);">Data (within the lump)</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:0.78rem;padding:0.25rem 0.5rem;background:rgba(0,0,0,0.2);border-radius:4px;">
                        <span style="color:var(--church-gold);">Heaven Beads (5)</span><span style="color:var(--text-secondary);">\u2194</span><span style="color:rgba(130,200,255,0.95);">Capabilities (c-list, Church domain)</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:0.78rem;padding:0.25rem 0.5rem;background:rgba(0,0,0,0.2);border-radius:4px;">
                        <span style="color:var(--church-gold);">Earth Beads (1 each)</span><span style="color:var(--text-secondary);">\u2194</span><span style="color:rgba(130,200,255,0.95);">Data words (Turing domain)</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:0.78rem;padding:0.25rem 0.5rem;background:rgba(0,0,0,0.2);border-radius:4px;">
                        <span style="color:var(--church-gold);">Beam Bar</span><span style="color:var(--text-secondary);">\u2194</span><span style="color:rgba(130,200,255,0.95);">Domain purity boundary</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:0.78rem;padding:0.25rem 0.5rem;background:rgba(0,0,0,0.2);border-radius:4px;">
                        <span style="color:var(--church-gold);">Place Value (10\u207f)</span><span style="color:var(--text-secondary);">\u2194</span><span style="color:rgba(130,200,255,0.95);">Abstraction layer (1\u20139)</span>
                    </div>
                </div>
            </div>
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:rgba(100,200,100,0.9);">Why It Matters</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    On a soroban, each rod is independent &mdash; you can only change beads on the rod you&rsquo;re touching. In the Church Machine, each abstraction works the same way: you can only call its methods through a <strong>Golden Token</strong> with the right permissions. No token, no access.
                </div>
            </div>
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:rgba(130,200,255,0.95);">Structure of a Lump</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.3rem 0;font-family:monospace;background:rgba(0,0,0,0.2);padding:0.4rem 0.6rem;border-radius:4px;font-size:0.78rem;"><span style="color:var(--church-gold);">[Code at offset 0]</span> <span style="color:var(--text-secondary);">[Free space]</span> <span style="color:rgba(130,200,255,0.95);">[C-list at end]</span></p>
                    <p style="margin:0;">Methods live at the start. The capability list (c-list) lives at the end. Free space grows between them &mdash; just like beads slide along rods.</p>
                </div>
            </div>
            <div class="panel">
                <div class="panel-title" style="color:rgba(180,140,255,0.95);">Functional Methods</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    Each method is a pure function: give it inputs, get outputs. No side effects, no hidden state changes. Just as sliding a bead is a single, visible action &mdash; every method call is explicit and auditable through the trace below.
                </div>
            </div>`,

        sliderule: `
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:var(--church-gold);">How the Slide Rule Works</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    The slide rule computes by <em>adding or comparing logarithmic lengths</em>.
                    On the C/D scales, sliding by log(a) and reading at C=b gives D = a&times;b.
                    <span style="color:#ff6644;">a</span> and <span style="color:#44aaff;">b</span> are labelled above the scale. The <span style="color:#ff3333;">red arrow</span> below shows a &times; b.
                    Other scales use the same principle for squares (A/B), cubes (K),
                    reciprocals (CI), and trigonometry (S/T) &mdash; all backed by
                    CALL SlideRule at NS[16].
                </div>
            </div>
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:rgba(130,200,255,0.95);">Floating Point &mdash; The Slide Rule Inside Your Computer</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.5rem 0;">Every floating-point number works like a slide rule reading: a <strong>mantissa</strong> (scale position) and an <strong>exponent</strong> (power of 10). IEEE 754 does the same in binary.</p>
                    <div style="display:flex;flex-direction:column;gap:0.3rem;background:rgba(0,0,0,0.2);border-radius:6px;padding:0.5rem;margin-bottom:0.5rem;font-size:0.78rem;font-family:monospace;">
                        <div><span style="color:var(--church-gold);">Slide Rule:</span> &plusmn; scale position (1&ndash;10) &times; 10&#8319;</div>
                        <div><span style="color:rgba(130,200,255,0.95);">IEEE 754:</span> sign bit &middot; mantissa (1.xxx&#8322;) &times; 2&#7497;</div>
                    </div>
                    <p style="margin:0 0 0.3rem 0;"><strong style="color:var(--church-gold);">Multiply = add logs:</strong> <span style="color:var(--church-gold);">log(a &times; b) = log(a) + log(b)</span>. CPUs do the same: add exponents, multiply mantissas.</p>
                    <p style="margin:0;"><strong style="color:var(--church-gold);">In the Church Machine:</strong> 32-bit Turing data words follow the same mantissa + exponent structure.</p>
                </div>
            </div>`,

        interactive: `
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:var(--church-gold);">How Pure Math Works</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    Type expressions using <code>let</code> bindings to define variables and build calculations step by step.
                    For example: <code>let x = 5</code>, then <code>let y = x * 3</code>.
                    The REPL evaluates each line and remembers your variables.
                </div>
            </div>
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:rgba(130,200,255,0.95);">Compile Session</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.4rem 0;">Click <strong>Compile Session</strong> to convert your let-bindings into Church Machine assembly code. Each variable becomes a register allocation and each operation becomes an instruction.</p>
                    <p style="margin:0;">This is Ada Lovelace&rsquo;s symbolic math notation &mdash; the same front-end used by the CLOOMC++ compiler. Your calculator session becomes a real program.</p>
                </div>
            </div>
            <div class="panel">
                <div class="panel-title" style="color:rgba(100,200,100,0.9);">Church Machine Connection</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.4rem 0;">Every <code>let</code> binding is a <strong>lambda abstraction</strong>: <code>let x = 5 in ...</code> is (&lambda;x. ...) 5.</p>
                    <p style="margin:0;">The Compile Session button shows this transformation explicitly &mdash; from symbolic math to Church Machine instructions, proving that your calculator and the processor speak the same language.</p>
                </div>
            </div>`
    };

    container.innerHTML = content[mode] || content.interactive;
}

function populateHowToUse(mode) {
    const container = document.getElementById('sidebarHowToUseContent');
    if (!container) return;

    const content = {
        hp35: `
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:var(--church-gold);">How to Use RPN</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.5rem 0;">The HP-35 uses a <strong>4-level stack</strong> instead of an <strong>=</strong> key. You enter numbers first, then press the operation.</p>
                </div>
            </div>
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:rgba(130,200,255,0.95);">Key Actions</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.3rem 0;"><strong>ENTER \u2191</strong> \u2014 Pushes X up into Y (and Y\u2192Z, Z\u2192T). Use between numbers.</p>
                    <p style="margin:0 0 0.3rem 0;"><strong>+  \u2212  \u00d7  \u00f7</strong> \u2014 Takes X and Y, puts the result in X, stack drops down.</p>
                    <p style="margin:0 0 0.3rem 0;"><strong>x\u21c4y</strong> \u2014 Swaps X and Y. Fix wrong order without retyping.</p>
                    <p style="margin:0;"><strong>R\u2193</strong> \u2014 Rolls the whole stack down: T\u2192X, X\u2192Y, Y\u2192Z, Z\u2192T.</p>
                </div>
            </div>
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:rgba(100,200,100,0.9);">Try It</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.4rem 0;"><strong>(3 + 4) \u00d7 5:</strong></p>
                    <p style="margin:0 0 0.6rem 0;font-family:monospace;background:rgba(0,0,0,0.2);padding:0.4rem 0.6rem;border-radius:4px;">3 <span style="color:var(--church-gold);">ENTER</span> 4 <span style="color:var(--church-gold);">+</span> 5 <span style="color:var(--church-gold);">\u00d7</span> \u2192 35</p>
                    <p style="margin:0 0 0.4rem 0;"><strong>(9 \u2212 2) \u00f7 (1 + 6):</strong></p>
                    <p style="margin:0;font-family:monospace;background:rgba(0,0,0,0.2);padding:0.4rem 0.6rem;border-radius:4px;">9 <span style="color:var(--church-gold);">ENTER</span> 2 <span style="color:var(--church-gold);">\u2212</span> 1 <span style="color:var(--church-gold);">ENTER</span> 6 <span style="color:var(--church-gold);">+</span> <span style="color:var(--church-gold);">\u00f7</span> \u2192 1</p>
                </div>
            </div>
            <div class="panel">
                <div class="panel-title" style="color:rgba(180,140,255,0.95);">Why RPN?</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    No parentheses needed. No = key. Complex expressions flow naturally left to right. The stack remembers intermediate results for you \u2014 like how you'd work it out on paper, one step at a time.
                </div>
            </div>`,

        abacus: `
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:var(--church-gold);">How to Use the Abacus</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    Click beads to move them toward or away from the centre bar. Each column is one digit.
                </div>
            </div>
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:rgba(130,200,255,0.95);">Reading a Number</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.3rem 0;"><strong>Top bead</strong> (above bar) = <strong>5</strong> when moved down.</p>
                    <p style="margin:0 0 0.3rem 0;"><strong>Bottom beads</strong> (below bar) = <strong>1 each</strong> when moved up.</p>
                    <p style="margin:0;">Count active beads in each column. Rightmost column = ones, next = tens, and so on.</p>
                </div>
            </div>
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:rgba(100,200,100,0.9);">Try It: Enter 42</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.3rem 0;">In the <strong>tens</strong> column: move 4 bottom beads up.</p>
                    <p style="margin:0;">In the <strong>ones</strong> column: move 2 bottom beads up.</p>
                </div>
            </div>
            <div class="panel">
                <div class="panel-title" style="color:rgba(180,140,255,0.95);">Addition</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.3rem 0;">Set the first number, then add the second by moving more beads.</p>
                    <p style="margin:0;">When a column exceeds 9, reset it and carry 1 to the next column left \u2014 exactly like the Church Machine\u2019s binary carry.</p>
                </div>
            </div>`,

        sliderule: `
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:var(--church-gold);">How to Use the Slide Rule</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.3rem 0;"><strong>Drag the <span style="color:#33cc66;">green slide</span></strong> to set the first value.</p>
                    <p style="margin:0;"><strong>Drag the <span style="color:#ff3333;">red cursor</span></strong> to read the result at any point on the scale.</p>
                </div>
            </div>
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:rgba(130,200,255,0.95);">Scales</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.3rem 0;"><strong>C / D</strong> \u2014 Multiplication and division.</p>
                    <p style="margin:0 0 0.3rem 0;"><strong>A / B</strong> \u2014 Squares and square roots.</p>
                    <p style="margin:0 0 0.3rem 0;"><strong>C / CI</strong> \u2014 Reciprocals (inverted C).</p>
                    <p style="margin:0 0 0.3rem 0;"><strong>D / K</strong> \u2014 Cubes and cube roots.</p>
                    <p style="margin:0;"><strong>S / T</strong> \u2014 Sine and tangent.</p>
                </div>
            </div>
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:rgba(100,200,100,0.9);">Try It: 2 \u00d7 3</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.3rem 0;">On C/D: slide the C scale so its 1 aligns with D=2.</p>
                    <p style="margin:0;">Move the cursor to C=3. Read D under the cursor \u2192 6.</p>
                </div>
            </div>
            <div class="panel">
                <div class="panel-title" style="color:rgba(180,140,255,0.95);">Try the Presets</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    Click the <strong>Try</strong> buttons below the slide rule to see multiplication and square root examples animated automatically.
                </div>
            </div>`,

        interactive: `
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:var(--church-gold);">How to Use Pure Math</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    Type expressions into the REPL input and press Enter. Use <code>let</code> to define variables.
                </div>
            </div>
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:rgba(130,200,255,0.95);">Commands</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.3rem 0;"><code>let x = 5</code> \u2014 Define a variable.</p>
                    <p style="margin:0 0 0.3rem 0;"><code>let y = x * 3 + 1</code> \u2014 Use variables in expressions.</p>
                    <p style="margin:0 0 0.3rem 0;"><code>VARS</code> \u2014 Show all defined variables.</p>
                    <p style="margin:0;"><code>CLEAR</code> \u2014 Reset everything.</p>
                </div>
            </div>
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:rgba(100,200,100,0.9);">Try It</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0;font-family:monospace;background:rgba(0,0,0,0.2);padding:0.4rem 0.6rem;border-radius:4px;line-height:1.8;">let r = 5<br>let area = 3.14159 * r * r<br>area</p>
                </div>
            </div>
            <div class="panel">
                <div class="panel-title" style="color:rgba(180,140,255,0.95);">Compile Session</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    Click <strong>Compile Session</strong> to convert your let-bindings into Church Machine assembly. Each variable becomes a register and each operation becomes an instruction.
                </div>
            </div>`
    };

    container.innerHTML = content[mode] || content.interactive;
}

function populateTrace(mode) {
    const container = document.getElementById('sidebarTraceContent');
    if (!container) return;

    const content = {
        hp35: `
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:var(--church-gold);">4-Register Stack</div>
                <div class="hp35-stack-display">
                    <div class="hp35-stack-reg" data-reg="3"></div>
                    <div class="hp35-stack-reg" data-reg="2"></div>
                    <div class="hp35-stack-reg" data-reg="1"></div>
                    <div class="hp35-stack-reg" data-reg="0"></div>
                </div>
                <div class="hp35-stack-diagram">
                    <div class="hp35-stack-row"><span class="hp35-sreg">T</span> <span class="hp35-sdesc">Top \u2014 oldest value, falls off when full</span></div>
                    <div class="hp35-stack-row"><span class="hp35-sreg">Z</span> <span class="hp35-sdesc">Third level \u2014 holds earlier numbers</span></div>
                    <div class="hp35-stack-row"><span class="hp35-sreg">Y</span> <span class="hp35-sdesc">Second operand for +, \u2212, \u00d7, \u00f7</span></div>
                    <div class="hp35-stack-row"><span class="hp35-sreg">X</span> <span class="hp35-sdesc">Display \u2014 what you see and type into</span></div>
                </div>
            </div>
            <div class="panel">
                <div class="panel-title" style="color:var(--church-gold);">Lambda Calculus Trace</div>
                <div class="hp35-trace-area"></div>
            </div>`,

        abacus: `
            <div class="panel">
                <div class="panel-title" style="color:var(--church-gold);">Church Machine Trace</div>
                <div class="abacus-trace-area"></div>
            </div>`,

        sliderule: `
            <div class="panel">
                <div class="panel-title" style="color:var(--church-gold);">Church Machine Trace</div>
                <div class="sliderule-trace-area"></div>
            </div>`,

        interactive: `
            <div class="panel">
                <div class="panel-title" style="color:var(--church-gold);">Church Machine Trace</div>
                <div class="repl-trace-log"></div>
                <div class="repl-trace-hint" style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);padding:0.5rem 0;">
                    Enter expressions in Pure Math to see Church Machine operations here.
                </div>
            </div>`
    };

    container.innerHTML = content[mode] || content.interactive;

    if (mode === 'hp35' && typeof hp35UpdateDisplay === 'function') hp35UpdateDisplay();
    if (mode === 'abacus' && typeof abacusUpdateDisplay === 'function') abacusUpdateDisplay();
    if (mode === 'sliderule' && typeof slideruleRenderDisplay === 'function') slideruleRenderDisplay();
}

function replKeydown(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        replExecute();
    }
}

var MATH_SYMBOLS = {
    'Greek': [
        ['\u03B1','alpha'], ['\u03B2','beta'], ['\u03B3','gamma'], ['\u03B4','delta'],
        ['\u03B5','epsilon'], ['\u03B6','zeta'], ['\u03B7','eta'], ['\u03B8','theta'],
        ['\u03B9','iota'], ['\u03BA','kappa'], ['\u03BB','lambda'], ['\u03BC','mu'],
        ['\u03BD','nu'], ['\u03BE','xi'], ['\u03C0','pi'], ['\u03C1','rho'],
        ['\u03C3','sigma'], ['\u03C4','tau'], ['\u03C6','phi'], ['\u03C7','chi'],
        ['\u03C8','psi'], ['\u03C9','omega'],
        ['\u0393','Gamma'], ['\u0394','Delta'], ['\u0398','Theta'], ['\u039B','Lambda'],
        ['\u03A0','Pi'], ['\u03A3','Sigma'], ['\u03A6','Phi'], ['\u03A8','Psi'], ['\u03A9','Omega']
    ],
    'Arithmetic': [
        ['\u00B1','plus-minus'], ['\u00D7','times'], ['\u00F7','divide'],
        ['\u2212','minus'], ['\u22C5','dot product'], ['\u2219','bullet dot'],
        ['\u221A','square root'], ['\u221B','cube root'], ['\u221C','fourth root'],
        ['\u2070','superscript 0'], ['\u00B9','superscript 1'], ['\u00B2','superscript 2'],
        ['\u00B3','superscript 3'], ['\u2074','superscript 4'], ['\u2075','superscript 5'],
        ['\u2076','superscript 6'], ['\u2077','superscript 7'], ['\u2078','superscript 8'],
        ['\u2079','superscript 9'], ['\u207A','superscript +'], ['\u207B','superscript -'],
        ['\u207F','superscript n'],
        ['\u2080','subscript 0'], ['\u2081','subscript 1'], ['\u2082','subscript 2'],
        ['\u2083','subscript 3'], ['\u2084','subscript 4'], ['\u2085','subscript 5'],
        ['\u2086','subscript 6'], ['\u2087','subscript 7'], ['\u2088','subscript 8'],
        ['\u2089','subscript 9'],
        ['\u2260','not equal'], ['\u2248','approx equal'], ['\u2261','identical'],
        ['\u2264','less or equal'], ['\u2265','greater or equal'],
        ['\u226A','much less'], ['\u226B','much greater'],
        ['\u221E','infinity'], ['\u2030','per mille']
    ],
    'Constants': [
        ['\u03C0','pi = 3.14159...'], ['e','Euler\'s number = 2.71828...'],
        ['\u03C6','golden ratio = 1.61803...'], ['\u221E','infinity'],
        ['c','speed of light'], ['G','gravitational constant'],
        ['g','gravitational accel = 9.81'], ['h','Planck constant'],
        ['\u210F','reduced Planck (h-bar)'], ['k\u0299','Boltzmann constant'],
        ['N\u2090','Avogadro number'], ['R','gas constant'],
        ['\u03B5\u2080','vacuum permittivity'], ['\u03BC\u2080','vacuum permeability'],
        ['e\u207B','electron charge'], ['m\u2091','electron mass'],
        ['m\u209A','proton mass'], ['\u03C3','Stefan-Boltzmann'],
        ['i','imaginary unit'], ['\u03B3','Euler-Mascheroni = 0.5772...'],
        ['\u03B6','Ap\u00E9ry\'s constant \u03B6(3)'], ['\u221A2','Pythagoras = 1.4142...'],
        ['ln2','natural log of 2 = 0.6931...'], ['ln10','natural log of 10 = 2.3025...']
    ],
    'Sets': [
        ['\u2205','empty set'], ['\u2208','element of'], ['\u2209','not element of'],
        ['\u220B','contains'], ['\u2282','subset'], ['\u2283','superset'],
        ['\u2286','subset or equal'], ['\u2287','superset or equal'],
        ['\u222A','union'], ['\u2229','intersection'], ['\u2216','set minus'],
        ['\u2295','direct sum'], ['\u2297','tensor product'],
        ['\u2115','naturals N'], ['\u2124','integers Z'], ['\u211A','rationals Q'],
        ['\u211D','reals R'], ['\u2102','complex C'],
        ['\u2200','for all'], ['\u2203','exists'], ['\u2204','not exists']
    ],
    'Logic': [
        ['\u00AC','not'], ['\u2227','and'], ['\u2228','or'],
        ['\u2295','xor'], ['\u21D2','implies'], ['\u21D4','iff'],
        ['\u22A2','proves'], ['\u22A8','models'], ['\u22A4','true/top'],
        ['\u22A5','false/bottom'],
        ['\u25A1','necessity'], ['\u25C7','possibility'],
        ['\u2234','therefore'], ['\u2235','because'],
        ['\u22A3','does not prove']
    ],
    'Calculus': [
        ['\u2202','partial derivative'], ['\u222B','integral'], ['\u222C','double integral'],
        ['\u222D','triple integral'], ['\u222E','contour integral'],
        ['\u2207','nabla/del'], ['\u2206','increment/Laplacian'],
        ['\u2211','summation'], ['\u220F','product'],
        ['\u2032','prime'], ['\u2033','double prime'],
        ['\u1D45','dx'], ['\u2202','del'],
        ['\u221D','proportional to'], ['\u2243','asymptotic'],
        ['\u2A01','big oplus'], ['\u2A02','big otimes']
    ],
    'Physics': [
        ['\u210F','h-bar'], ['\u212B','angstrom'],
        ['\u2126','ohm'], ['\u00B5','micro'],
        ['\u2220','angle'], ['\u22A5','perpendicular'], ['\u2225','parallel'],
        ['\u2190','left arrow'], ['\u2192','right arrow'],
        ['\u2194','left-right arrow'], ['\u21C0','harpoon right'],
        ['\u2191','up arrow'], ['\u2193','down arrow'],
        ['\u20D7','combining vector'], ['\u00B0','degree'],
        ['\u2297','cross product'], ['\u2299','circled dot']
    ],
    'Lambda': [
        ['\u03BB','lambda'], ['\u2192','arrow'], ['\u21A6','maps to'],
        ['\u2218','compose'], ['\u2261','definitional equal'],
        ['\u03B1','alpha (rename)'], ['\u03B2','beta (reduce)'],
        ['\u03B7','eta (expand)'],
        ['\u22A2','turnstile'], ['\u22A8','double turnstile'],
        ['\u2200','forall'], ['\u2203','exists'],
        ['\u27E8','left angle bracket'], ['\u27E9','right angle bracket'],
        ['\u2983','left brace bar'], ['\u2984','right brace bar'],
        ['\u22C6','star'], ['\u2022','bullet']
    ]
};

var symbolPickerCat = 'Greek';

var SYMBOL_DESCRIPTIONS = {
    '\u03B1': 'Used for angles, coefficients, and fine-structure constant',
    '\u03B2': 'Used for angles, velocity ratio v/c, and beta functions',
    '\u03B3': 'Euler-Mascheroni constant, Lorentz factor, gamma function',
    '\u03B4': 'Small change or variation, Dirac delta function',
    '\u03B5': 'Small positive quantity, permittivity',
    '\u03B6': 'Riemann zeta function argument',
    '\u03B7': 'Efficiency, viscosity, Dirichlet eta function',
    '\u03B8': 'Angle measure in trigonometry and polar coordinates',
    '\u03B9': 'Index variable, inclusion map',
    '\u03BA': 'Curvature, thermal conductivity',
    '\u03BB': 'Wavelength in physics, anonymous function in lambda calculus',
    '\u03BC': 'Micro prefix (10\u207B\u2076), mean in statistics, magnetic permeability',
    '\u03BD': 'Frequency, kinematic viscosity',
    '\u03BE': 'Random variable, damping ratio',
    '\u03C0': 'Ratio of circumference to diameter \u2248 3.14159',
    '\u03C1': 'Density, resistivity, correlation coefficient',
    '\u03C3': 'Standard deviation, surface charge density, Stefan-Boltzmann constant',
    '\u03C4': 'Torque, time constant, tau = 2\u03C0 \u2248 6.28318',
    '\u03C6': 'Golden ratio \u2248 1.61803, phase angle, Euler totient',
    '\u03C7': 'Chi-squared distribution, electric susceptibility',
    '\u03C8': 'Wave function in quantum mechanics, angle',
    '\u03C9': 'Angular velocity, angular frequency',
    '\u0393': 'Gamma function, circulation in fluid dynamics',
    '\u0394': 'Change or difference (\u0394x = x\u2082 - x\u2081)',
    '\u0398': 'Heaviside step function, big-O related notation',
    '\u039B': 'Cosmological constant, diagonal matrix of eigenvalues',
    '\u03A0': 'Product operator \u2014 multiply a sequence of terms',
    '\u03A3': 'Summation operator \u2014 add a sequence of terms',
    '\u03A6': 'Magnetic flux, cumulative distribution function',
    '\u03A8': 'Quantum state vector, wave function',
    '\u03A9': 'Ohm (unit of resistance), sample space in probability',

    '\u00B1': 'Plus or minus \u2014 indicates two possible values',
    '\u00D7': 'Multiplication (cross product in vectors)',
    '\u00F7': 'Division of two quantities',
    '\u2212': 'Subtraction or negative sign',
    '\u22C5': 'Scalar (dot) product of two vectors',
    '\u221A': 'Principal square root of a number',
    '\u221B': 'Cube root \u2014 the number whose cube equals the input',
    '\u221C': 'Fourth root of a number',
    '\u2070': 'Superscript 0 \u2014 any number to the power 0 equals 1',
    '\u00B9': 'Superscript 1 \u2014 identity exponent',
    '\u00B2': 'Squared \u2014 multiply a number by itself',
    '\u00B3': 'Cubed \u2014 multiply a number by itself three times',
    '\u2074': 'Raised to the fourth power',
    '\u2075': 'Raised to the fifth power',
    '\u2076': 'Raised to the sixth power',
    '\u2077': 'Raised to the seventh power',
    '\u2078': 'Raised to the eighth power',
    '\u2079': 'Raised to the ninth power',
    '\u207A': 'Positive exponent',
    '\u207B': 'Negative exponent (reciprocal)',
    '\u207F': 'Raised to the nth power',
    '\u2080': 'Subscript 0 \u2014 base or initial value',
    '\u2081': 'Subscript 1 \u2014 first element or index',
    '\u2082': 'Subscript 2 \u2014 second element or index',
    '\u2083': 'Subscript 3',
    '\u2084': 'Subscript 4',
    '\u2085': 'Subscript 5',
    '\u2086': 'Subscript 6',
    '\u2087': 'Subscript 7',
    '\u2088': 'Subscript 8',
    '\u2089': 'Subscript 9',
    '\u2260': 'Not equal to \u2014 two values are different',
    '\u2248': 'Approximately equal \u2014 close but not exact',
    '\u2261': 'Identically equal \u2014 true by definition',
    '\u2264': 'Less than or equal to',
    '\u2265': 'Greater than or equal to',
    '\u226A': 'Much less than \u2014 orders of magnitude smaller',
    '\u226B': 'Much greater than \u2014 orders of magnitude larger',
    '\u221E': 'Infinity \u2014 unbounded quantity, not a real number',
    '\u2030': 'Per mille \u2014 parts per thousand',

    '\u2205': 'The empty set \u2014 a set with no elements',
    '\u2208': 'Element of \u2014 x \u2208 S means x belongs to set S',
    '\u2209': 'Not an element of \u2014 x is not in the set',
    '\u220B': 'Contains \u2014 the set contains the element',
    '\u2282': 'Proper subset \u2014 all elements of A are in B, but A \u2260 B',
    '\u2283': 'Proper superset \u2014 B contains all elements of A',
    '\u2286': 'Subset or equal \u2014 A is contained in or equals B',
    '\u2287': 'Superset or equal \u2014 B contains or equals A',
    '\u222A': 'Union \u2014 all elements in A or B (or both)',
    '\u2229': 'Intersection \u2014 elements in both A and B',
    '\u2216': 'Set difference \u2014 elements in A but not in B',
    '\u2295': 'Direct sum or XOR \u2014 exclusive combination',
    '\u2297': 'Tensor product or cross product',
    '\u2115': 'Natural numbers: 0, 1, 2, 3, 4, \u2026',
    '\u2124': 'Integers: \u2026, -2, -1, 0, 1, 2, \u2026',
    '\u211A': 'Rational numbers \u2014 fractions p/q',
    '\u211D': 'Real numbers \u2014 all points on the number line',
    '\u2102': 'Complex numbers \u2014 a + bi where i\u00B2 = -1',
    '\u2200': 'For all \u2014 universal quantifier, every element',
    '\u2203': 'There exists \u2014 at least one element satisfies this',
    '\u2204': 'There does not exist \u2014 no element satisfies this',

    '\u00AC': 'Logical NOT \u2014 negation, flips true to false',
    '\u2227': 'Logical AND \u2014 true only when both sides are true',
    '\u2228': 'Logical OR \u2014 true when at least one side is true',
    '\u21D2': 'Implies \u2014 if A is true then B must be true',
    '\u21D4': 'If and only if \u2014 both sides are equivalent',
    '\u22A2': 'Proves (turnstile) \u2014 derivable from axioms',
    '\u22A8': 'Models \u2014 semantically entails, is satisfied by',
    '\u22A4': 'Top/True \u2014 always true, the unit type',
    '\u22A5': 'Bottom/False \u2014 always false, contradiction',
    '\u25A1': 'Necessity \u2014 must be true in all possible worlds',
    '\u25C7': 'Possibility \u2014 true in at least one possible world',
    '\u2234': 'Therefore \u2014 the conclusion follows',
    '\u2235': 'Because \u2014 the reason or premise',
    '\u22A3': 'Does not prove \u2014 not derivable',

    '\u2202': 'Partial derivative \u2014 rate of change in one variable',
    '\u222B': 'Integral \u2014 area under a curve, antiderivative',
    '\u222C': 'Double integral \u2014 over a 2D region',
    '\u222D': 'Triple integral \u2014 over a 3D volume',
    '\u222E': 'Contour integral \u2014 integral around a closed path',
    '\u2207': 'Nabla/del \u2014 gradient, divergence, or curl operator',
    '\u2206': 'Laplacian or finite difference operator',
    '\u2211': 'Summation \u2014 add up a sequence of terms',
    '\u220F': 'Product \u2014 multiply a sequence of terms',
    '\u2032': 'Prime \u2014 derivative f\u2032(x) or transformed variable',
    '\u2033': 'Double prime \u2014 second derivative f\u2033(x)',
    '\u221D': 'Proportional to \u2014 y \u221D x means y = kx for some k',
    '\u2243': 'Asymptotically equal \u2014 same behaviour for large values',

    '\u210F': 'Reduced Planck constant h/(2\u03C0) \u2248 1.055 \u00D7 10\u207B\u00B3\u2074 J\u00B7s',
    '\u212B': 'Angstrom \u2014 10\u207B\u00B9\u2070 metres, atomic scale length',
    '\u2126': 'Ohm \u2014 SI unit of electrical resistance',
    '\u00B5': 'Micro \u2014 prefix meaning 10\u207B\u2076',
    '\u2220': 'Angle \u2014 the figure formed by two rays from a point',
    '\u2225': 'Parallel \u2014 lines that never meet',
    '\u2190': 'Left arrow \u2014 direction, assignment, or mapping',
    '\u2192': 'Right arrow \u2014 function type, maps to, implies',
    '\u2194': 'Left-right arrow \u2014 bidirectional, if and only if',
    '\u2191': 'Up arrow \u2014 increasing, exponentiation (Knuth)',
    '\u2193': 'Down arrow \u2014 decreasing',
    '\u00B0': 'Degree \u2014 unit of angle (360\u00B0 in a circle) or temperature',
    '\u2299': 'Circled dot \u2014 direct product, solar symbol',

    '\u2218': 'Function composition \u2014 (f \u2218 g)(x) = f(g(x))',
    '\u21A6': 'Maps to \u2014 x \u21A6 f(x), element-level mapping',
    '\u27E8': 'Left angle bracket \u2014 inner product, bra in quantum mechanics',
    '\u27E9': 'Right angle bracket \u2014 inner product, ket in quantum mechanics',
    '\u22C6': 'Star operator \u2014 Kleene star, convolution',
    '\u2022': 'Bullet \u2014 list marker, binary operation',
};

var CONSTANT_VALUES = {
    '\u03C0': '\u2248 3.14159265',
    'e': '\u2248 2.71828183',
    '\u03C6': '\u2248 1.61803399',
    '\u221E': 'unbounded',
    'c': '299,792,458 m/s',
    'G': '6.674 \u00D7 10\u207B\u00B9\u00B9 N\u00B7m\u00B2/kg\u00B2',
    'g': '9.80665 m/s\u00B2',
    'h': '6.626 \u00D7 10\u207B\u00B3\u2074 J\u00B7s',
    '\u210F': '1.055 \u00D7 10\u207B\u00B3\u2074 J\u00B7s',
    'k\u0299': '1.381 \u00D7 10\u207B\u00B2\u00B3 J/K',
    'N\u2090': '6.022 \u00D7 10\u00B2\u00B3 mol\u207B\u00B9',
    'R': '8.314 J/(mol\u00B7K)',
    '\u03B5\u2080': '8.854 \u00D7 10\u207B\u00B9\u00B2 F/m',
    '\u03BC\u2080': '1.257 \u00D7 10\u207B\u2076 H/m',
    'e\u207B': '1.602 \u00D7 10\u207B\u00B9\u2079 C',
    'm\u2091': '9.109 \u00D7 10\u207B\u00B3\u00B9 kg',
    'm\u209A': '1.673 \u00D7 10\u207B\u00B2\u2077 kg',
    '\u03C3': '5.670 \u00D7 10\u207B\u2078 W/(m\u00B2\u00B7K\u2074)',
    'i': '\u221A(-1)',
    '\u03B3': '\u2248 0.57721566',
    '\u03B6': '\u2248 1.20206 (\u03B6(3))',
    '\u221A2': '\u2248 1.41421356',
    'ln2': '\u2248 0.69314718',
    'ln10': '\u2248 2.30258509',
};

function buildSymbolPicker() {
    var dd = document.getElementById('symbolPickerDropdown');
    if (!dd) return;

    var tooltip = document.getElementById('symbolTooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'symbolTooltip';
        tooltip.className = 'symbol-tooltip';
        document.body.appendChild(tooltip);
    }

    var catsHtml = '<div class="symbol-picker-cats">';
    for (var cat in MATH_SYMBOLS) {
        catsHtml += '<button class="symbol-cat-btn' + (cat === symbolPickerCat ? ' active' : '') + '" data-cat="' + cat + '">' + cat + '</button>';
    }
    catsHtml += '</div>';

    var gridHtml = '<div class="symbol-grid">';
    var syms = MATH_SYMBOLS[symbolPickerCat] || [];
    for (var i = 0; i < syms.length; i++) {
        gridHtml += '<button class="symbol-grid-btn" data-sym="' + syms[i][0] + '" data-name="' + syms[i][1].replace(/'/g, '&#39;') + '">' + syms[i][0] + '</button>';
    }
    gridHtml += '</div>';

    dd.innerHTML = catsHtml + gridHtml;

    dd.querySelectorAll('.symbol-cat-btn').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            symbolPickerCat = btn.dataset.cat;
            buildSymbolPicker();
            dd.classList.add('open');
        });
    });

    dd.querySelectorAll('.symbol-grid-btn').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            insertSymbol(btn.dataset.sym);
        });
        btn.addEventListener('mouseenter', function() {
            var sym = btn.dataset.sym;
            var name = btn.dataset.name;
            var desc = SYMBOL_DESCRIPTIONS[sym] || '';
            var val = CONSTANT_VALUES[sym] || '';
            var html = '<div class="symbol-tooltip-sym">' + sym + '</div>';
            html += '<div class="symbol-tooltip-name">' + name + '</div>';
            if (desc) html += '<div class="symbol-tooltip-desc">' + desc + '</div>';
            if (val) html += '<div class="symbol-tooltip-val">' + val + '</div>';
            tooltip.innerHTML = html;
            var rect = btn.getBoundingClientRect();
            var top = rect.top - tooltip.offsetHeight - 6;
            if (top < 4) top = rect.bottom + 6;
            var left = rect.left + rect.width / 2 - 60;
            if (left < 4) left = 4;
            if (left + 240 > window.innerWidth) left = window.innerWidth - 244;
            tooltip.style.top = top + 'px';
            tooltip.style.left = left + 'px';
            tooltip.classList.add('visible');
        });
        btn.addEventListener('mouseleave', function() {
            tooltip.classList.remove('visible');
        });
    });
}

function toggleSymbolPicker() {
    var dd = document.getElementById('symbolPickerDropdown');
    if (!dd) return;
    var tooltip = document.getElementById('symbolTooltip');
    if (dd.classList.contains('open')) {
        dd.classList.remove('open');
        if (tooltip) tooltip.classList.remove('visible');
    } else {
        buildSymbolPicker();
        dd.classList.add('open');
    }
}

function insertSymbol(sym) {
    var input = document.getElementById('replInput');
    if (!input) return;
    var start = input.selectionStart || 0;
    var end = input.selectionEnd || 0;
    var val = input.value;
    input.value = val.slice(0, start) + sym + val.slice(end);
    input.focus();
    var newPos = start + sym.length;
    input.setSelectionRange(newPos, newPos);
}

document.addEventListener('click', function(e) {
    var dd = document.getElementById('symbolPickerDropdown');
    if (dd && !e.target.closest('.symbol-picker-wrap')) {
        dd.classList.remove('open');
        var tooltip = document.getElementById('symbolTooltip');
        if (tooltip) tooltip.classList.remove('visible');
    }
});

function loadBernoulliInREPL() {
    const output = document.getElementById('replOutput');
    if (!output) return;

    repl._clear();
    output.innerHTML = '<div class="repl-info">Running Bernoulli program...</div>';

    const bernoulli = `let n = succ(3)
let two = succ(1)
let n_plus_1 = succ(n)
let two_n = two * n
let two_n_plus_1 = succ(two_n)
let prod1 = n * n_plus_1
let product = prod1 * two_n_plus_1
let six = two * 3
let sum_of_squares = product / six
let sq1 = 1 ^ two
let sq2 = two ^ two
let sq3 = 3 ^ two
let sq4 = n ^ two
let partial1 = sq1 + sq2
let partial2 = partial1 + sq3
let verify = partial2 + sq4
VARS`;

    const results = repl.runProgram(bernoulli);
    for (const r of results) {
        if (r.type === 'result') {
            output.innerHTML += `<div class="repl-result">${escapeHtml(r.text)}</div>`;
            if (r.churchSteps && r.churchSteps.length > 0) {
                let html = '<div class="repl-trace">';
                for (const s of r.churchSteps) {
                    html += `<div class="repl-trace-step">${escapeHtml(s)}</div>`;
                }
                html += '</div>';
                output.innerHTML += html;
            }
        } else if (r.type === 'info') {
            output.innerHTML += `<div class="repl-info">${escapeHtml(r.text)}</div>`;
        }
    }

    output.innerHTML += '<div class="repl-info">Bernoulli computation complete: sum_of_squares = verify = 30</div>';
    output.scrollTop = output.scrollHeight;
}

function replCompileSession() {
    const output = document.getElementById('replOutput');
    if (!output || !repl) return;

    const result = repl.compileSession();
    if (!result) return;

    if (result.type === 'info') {
        output.innerHTML += `<div class="repl-info">${escapeHtml(result.text)}</div>`;
    } else if (result.type === 'result') {
        trackAction('repl', { name: 'Compile Session', lang: 'symbolic' });
        output.innerHTML += `<div class="repl-result" style="white-space:pre;font-family:monospace;">${escapeHtml(result.text)}</div>`;
    }
    output.scrollTop = output.scrollHeight;
}

function appendOutput(text, type) {
    const editorConsole = document.getElementById('editorConsole');
    if (editorConsole) {
        editorConsole.textContent += '\n' + text;
        editorConsole.scrollTop = editorConsole.scrollHeight;
    }
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function saveEditorState() {
    const editor = document.getElementById('asmEditor');
    if (editor) {
        localStorage.setItem('church_editor_code', editor.value);
    }
    const sel = document.getElementById('langSelector');
    if (sel) {
        localStorage.setItem('church_editor_lang', sel.value);
    }
}

function loadEditorState() {
    const editor = document.getElementById('asmEditor');
    if (editor) {
        const saved = localStorage.getItem('church_editor_code');
        if (saved) {
            editor.value = saved;
        }
    }
    const sel = document.getElementById('langSelector');
    const savedLang = localStorage.getItem('church_editor_lang');
    if (sel && savedLang) {
        sel.value = savedLang;
        onLangChange(true);
    } else if (sel) {
        sel.value = 'symbolic';
        onLangChange(false);
    }
}

function showCreateNamespace() {
    if (!requirePermission('createNS', 'Create Namespace Entries')) return;
    if (!sim.bootComplete) {
        const con = document.getElementById('editorConsole');
        if (con) con.textContent = 'Boot not complete — run boot sequence first.';
        showNextSteps('error');
        return;
    }
    document.getElementById('createNSName').value = '';
    document.getElementById('createNSGTType').value = '1';
    document.getElementById('createNSAllocSize').value = '32';
    document.getElementById('createNSClistCount').value = '0';
    document.getElementById('createNSDialog').style.display = '';
    document.getElementById('createNSName').focus();
}

function confirmCreateNamespace() {
    const name = document.getElementById('createNSName').value.trim();
    if (!name) {
        alert('Please enter a name for the namespace entry.');
        return;
    }
    const gtType = parseInt(document.getElementById('createNSGTType').value) || 1;
    const allocSize = parseInt(document.getElementById('createNSAllocSize').value) || 32;
    const clistCount = Math.min(511, Math.max(0, parseInt(document.getElementById('createNSClistCount').value) || 0));

    if (clistCount >= allocSize) {
        alert(`C-List slots (${clistCount}) must be less than allocation size (${allocSize}).`);
        return;
    }

    const memResult = abstractionRegistry.dispatchMethod(7, 'Allocate', sim, { size: allocSize });
    if (!memResult || !memResult.ok) {
        const con = document.getElementById('editorConsole');
        if (con) con.textContent = `Create Namespace failed: Memory.Allocate error — ${memResult ? memResult.message : 'unknown'}`;
        showNextSteps('error');
        document.getElementById('createNSDialog').style.display = 'none';
        return;
    }

    const location = memResult.result.location;
    const limit = allocSize - 1;

    const addResult = abstractionRegistry.dispatchMethod(5, 'Add', sim, {
        location: location,
        limit: limit,
        clistCount: clistCount,
        gtType: gtType,
        label: name
    });

    document.getElementById('createNSDialog').style.display = 'none';

    if (!addResult || !addResult.ok) {
        const con = document.getElementById('editorConsole');
        if (con) con.textContent = `Create Namespace failed: Navana.Add error — ${addResult ? addResult.message : 'unknown'}`;
        showNextSteps('error');
        return;
    }

    const r = addResult.result;
    const typeNames = ['NULL','Inform','Outform','Abstract'];
    const clistStart = allocSize - clistCount;
    const freespace = allocSize - clistCount;

    let listing = `Namespace entry "${name}" created via Navana.Add:\n\n`;
    listing += `  NS Index:     ${r.nsIndex}\n`;
    listing += `  GT Seq:       ${r.version}\n`;
    listing += `  W1 Type:      ${typeNames[gtType] || 'Unknown'}\n`;
    listing += `  W0 Location:  0x${location.toString(16)}\n`;
    listing += `  W1 Limit:     ${limit}\n`;
    listing += `  Alloc Size:   ${allocSize} words\n`;
    listing += `  C-List Slots: ${clistCount}\n`;
    listing += `  Freespace:    ${freespace} words\n`;
    if (clistCount > 0) {
        listing += `\n  Lump Layout:\n`;
        listing += `    Code region:  0x${location.toString(16)} — offset 0 to ${clistStart - 1}\n`;
        listing += `    C-List:       offset ${clistStart} to ${allocSize - 1} (${clistCount} slots)\n`;
    }
    listing += `\nThis namespace entry is ready. Write your abstraction code,\nthen use "Create Abstraction" to populate NS[${r.nsIndex}].\n`;

    const con = document.getElementById('editorConsole');
    if (con) con.textContent = listing;
    showNextSteps('compiled');
    trackAction('namespace', { name: name, index: r.nsIndex });
    appendOutput(`Created NS[${r.nsIndex}] "${name}" — ${allocSize} words, ${clistCount} c-list slots`, 'info');
    updateDashboard();
}

function showSaveToNamespace() {
    if (!lastAssembledWords || lastAssembledWords.length === 0) {
        alert('Assemble code first before saving to namespace.');
        return;
    }
    const slotSel = document.getElementById('saveNSSlot');
    slotSel.innerHTML = '';
    const newOpt = document.createElement('option');
    newOpt.value = 'new';
    newOpt.textContent = '\u2014 New Entry \u2014';
    slotSel.appendChild(newOpt);
    for (let i = 0; i < sim.nsCount; i++) {
        const e = sim.readNSEntry(i);
        if (!e) continue;
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = `[${i}] ${e.label}`;
        slotSel.appendChild(opt);
    }
    slotSel.value = 'new';
    document.getElementById('saveNSLabel').value = '';
    document.getElementById('saveNSLabel').disabled = false;
    document.getElementById('saveNSType').value = '0';
    document.getElementById('permR').checked = false;
    document.getElementById('permW').checked = false;
    document.getElementById('permX').checked = true;
    document.getElementById('permL').checked = false;
    document.getElementById('permS').checked = false;
    document.getElementById('permE').checked = false;
    const info = document.getElementById('saveNSInfo');
    info.textContent = `Code size: ${lastAssembledWords.length} words (${lastAssembledWords.length * 4} bytes)`;
    document.getElementById('saveNSDialog').style.display = '';
    document.getElementById('saveNSLabel').focus();
}

function onSlotChange() {
    const slotSel = document.getElementById('saveNSSlot');
    const labelInput = document.getElementById('saveNSLabel');
    if (slotSel.value === 'new') {
        labelInput.value = '';
        labelInput.disabled = false;
        document.getElementById('saveNSType').value = '0';
        document.getElementById('permR').checked = false;
        document.getElementById('permW').checked = false;
        document.getElementById('permX').checked = true;
        document.getElementById('permL').checked = false;
        document.getElementById('permS').checked = false;
        document.getElementById('permE').checked = false;
    } else {
        const idx = parseInt(slotSel.value);
        const entry = sim.readNSEntry(idx);
        if (entry) {
            labelInput.value = entry.label;
            labelInput.disabled = false;
            document.getElementById('saveNSType').value = String(entry.gtType || 0);
            const gt = sim.memory[entry.word0_location];
            const p = sim.parseGT(gt).permissions;
            document.getElementById('permR').checked = !!p.R;
            document.getElementById('permW').checked = !!p.W;
            document.getElementById('permX').checked = !!p.X;
            document.getElementById('permL').checked = !!p.L;
            document.getElementById('permS').checked = !!p.S;
            document.getElementById('permE').checked = !!p.E;
        }
    }
}

function closeSaveDialog() {
    document.getElementById('saveNSDialog').style.display = 'none';
}

function getNextStepTip(lang) {
    const progress = getStudentProgress();
    const c = progress.compilations || 0;
    const a = progress.abstractions || 0;
    const d = progress.drafts || 0;
    const langs = progress.langsUsed || [];

    if (c === 0) {
        if (lang === 'symbolic') return `<div class="intro-tip intro-next-step"><strong>Step 1:</strong> Click the gold <strong>Compile</strong> button below the code editor. This translates Ada's math into machine code -- you will see every instruction with a comment explaining what it does.</div>`;
        if (lang === 'assembly') return `<div class="intro-tip intro-next-step"><strong>Step 1:</strong> Click the <strong>Self-Test</strong> example button, then click <strong>Compile</strong>. Watch each instruction appear with its hex encoding.</div>`;
        if (lang === 'javascript') return `<div class="intro-tip intro-next-step"><strong>Step 1:</strong> Click <strong>JS: Hello</strong> to load a simple program, then click <strong>Compile</strong> to see it translated into machine instructions.</div>`;
        if (lang === 'haskell') return `<div class="intro-tip intro-next-step"><strong>Step 1:</strong> Click <strong>HS: Math</strong> to load arithmetic functions, then click <strong>Compile</strong> to see how math becomes machine code.</div>`;
        if (lang === 'lambda') return `<div class="intro-tip intro-next-step"><strong>Step 1:</strong> Click <strong>LC: Church</strong> to load Church numerals, then click <strong>Compile</strong> to see how pure lambda calculus becomes machine code.</div>`;
        return `<div class="intro-tip intro-next-step"><strong>Step 1:</strong> Click the <strong>Compile</strong> button below the code editor to translate the program into machine instructions.</div>`;
    }

    if (d === 0) {
        return `<div class="intro-tip intro-next-step"><strong>Next step:</strong> You have compiled code -- now click <strong>Draft</strong> to see how the program maps to memory. You will see the lump layout: code region, capability list, and free space.</div>`;
    }

    if (a === 0) {
        return `<div class="intro-tip intro-next-step"><strong>Next step:</strong> Click <strong>Boot</strong> in the top-left first (the machine needs to start), then click <strong>Create Abstraction</strong> to load your program into the Church Machine's namespace as a real abstraction with its own security entry.</div>`;
    }

    if (langs.length <= 1) {
        const suggest = lang === 'symbolic' ? 'JavaScript' : (lang === 'javascript' ? 'Haskell' : (lang === 'haskell' ? 'Lambda Calculus' : (lang === 'lambda' ? 'Symbolic Math (Ada)' : 'JavaScript')));
        return `<div class="intro-tip intro-next-step"><strong>Challenge:</strong> You have compiled, drafted, and created an abstraction! Try switching to <strong>${suggest}</strong> in the language dropdown -- the same 20 machine instructions work for every language.</div>`;
    }

    if (c < 5) {
        return `<div class="intro-tip intro-next-step"><strong>Keep going:</strong> You have used ${langs.length} languages so far. Try editing the code -- change a variable or add a new operation, then <strong>Compile</strong> again to see how the machine code changes.</div>`;
    }

    if (lang === 'symbolic') {
        return `<div class="intro-tip intro-next-step"><strong>Explore:</strong> Try the <strong>Pure Math</strong> tab to experiment with expressions interactively, then click <strong>Compile Session</strong> to turn your experiments into a program. Or visit the <strong>Tutorial</strong> tab for a guided walkthrough.</div>`;
    }

    return `<div class="intro-tip intro-next-step"><strong>Explore:</strong> Open the <strong>Tutorial</strong> tab for a guided discovery path, try the <strong>Pure Math</strong> for interactive experiments, or view your progress in the <strong>Settings</strong> (gear icon below).</div>`;
}

const langIntros = {
    english: {
        title: "English -- Programming in Your Own Words",
        body: `
            <p>What if you could <span class="intro-highlight">tell a computer what to do in plain English?</span></p>
            <p>The Church Machine's English front-end makes this real. You write sentences,
            and the compiler translates them into the same 32-bit machine instructions
            as JavaScript, Haskell, or Ada's notation.</p>
            <div class="intro-example">Create an abstraction called Hello

Add a method called Greet that takes who
Set result to who plus 1
Return the result</div>
            <p>The compiler understands verbs like <span class="intro-highlight">create</span>,
            <span class="intro-highlight">set</span>, <span class="intro-highlight">return</span>,
            <span class="intro-highlight">call</span>, and <span class="intro-highlight">if/when</span>.
            Arithmetic uses words: <em>plus</em>, <em>minus</em>, <em>times</em>, <em>divided by</em>.</p>
            <p>In 1952, <span class="intro-highlight">Grace Hopper</span> was told computers could only
            understand numbers. She invented the compiler to prove them wrong.
            This English front-end carries her dream to its conclusion.</p>
        `
    },
    symbolic: {
        title: "Symbolic Math -- Ada Lovelace's Notation (1843)",
        body: `
            <p>You are looking at <span class="intro-highlight">the first computer program ever written.</span></p>
            <p>In 1843, a mathematician named <span class="intro-highlight">Ada Lovelace</span> wrote a program
            for Charles Babbage's Analytical Engine -- a mechanical computer that was never built.
            Her program computed a special number called B7, the seventh Bernoulli number.</p>
            <p>Ada used a simple notation: named variables (like store columns on the Engine)
            and one operation per line. Here is what it looks like:</p>
            <div class="intro-example">let V1 = 1
let V2 = 2
let V4 = V2 * V3    -- multiply V2 by V3
let V11 = V4 / V5   -- divide V4 by V5</div>
            <p>Each <span class="intro-highlight">V-variable</span> is a storage column --
            V1 is the first column, V2 is the second, and so on.
            You write one operation per line, just like Ada did on paper.</p>
            <p>The Church Machine can now run Ada's program -- 183 years after she wrote it.
            Her notation is a real programming language here.</p>
        `
    },
    assembly: {
        title: "Assembly -- Church Machine Instructions",
        body: `
            <p>This is <span class="intro-highlight">assembly language</span> --
            the lowest level you can program the Church Machine.</p>
            <p>Every line is one instruction that the processor executes directly.
            The Church Machine has <span class="intro-highlight">20 instructions</span> split into two worlds:</p>
            <p><span class="intro-highlight">Church domain</span> (10 instructions) --
            for security and capabilities: LOAD, SAVE, CALL, RETURN, CHANGE, SWITCH, TPERM, LAMBDA, ELOADCALL, XLOADLAMBDA</p>
            <p><span class="intro-highlight">Turing domain</span> (10 instructions) --
            for computation and data: DREAD, DWRITE, BFEXT, BFINS, MCMP, IADD, ISUB, BRANCH, SHL, SHR</p>
            <div class="intro-example">LOAD CR0, CR6, 4    ; Load from capability list
TPERM CR0, XL       ; Check permissions
LAMBDA CR0          ; Execute
RETURN                ; Return result</div>
            <p>Assembly gives you direct control over registers, memory, and Golden Token permissions.
            Every instruction can have a <span class="intro-highlight">condition code</span> (like EQ, NE, GT)
            so it only runs when the condition is true.</p>
        `
    },
    javascript: {
        title: "JavaScript -- CLOOMC++ High-Level Language",
        body: `
            <p><span class="intro-highlight">CLOOMC++</span> is the Church Machine's
            high-level compiler. The JavaScript front-end lets you write programs
            using familiar syntax -- curly braces, if/while, functions -- and the compiler
            turns them into Church Machine instructions.</p>
            <div class="intro-example">abstraction Hello {
    capabilities { }

    method Greet(who) {
        result = who + 1
        return(result)
    }
}</div>
            <p>Every program is an <span class="intro-highlight">abstraction</span> --
            a secure block of code with its own capabilities list.
            Methods inside the abstraction are the functions you can call.</p>
            <p>The compiler translates your code into the same 20 instructions
            that assembly uses. Variables become data registers (DR0-DR15),
            and multiply/divide become loops of addition and subtraction.</p>
        `
    },
    haskell: {
        title: "Haskell -- Functional Programming on Hardware",
        body: `
            <p>The <span class="intro-highlight">Haskell front-end</span> proves that
            the Church Machine is a true universal target -- functional programming
            compiles to the same 20 instructions as JavaScript and assembly.</p>
            <div class="intro-example">abstraction ChurchMath {
    capabilities { }

    method successor(n) = n + 1
    method add(a, b) = a + b
    method isZero(n) = if n == 0 then 1 else 0
}</div>
            <p>You get <span class="intro-highlight">pattern matching</span> (case expressions),
            <span class="intro-highlight">pairs</span> (fst/snd),
            <span class="intro-highlight">let bindings</span>,
            and <span class="intro-highlight">Church numerals</span> -- the building blocks of lambda calculus,
            running on real hardware.</p>
            <p>The name "Church Machine" comes from Alonzo Church, who invented lambda calculus.
            This front-end connects his mathematics to actual silicon.</p>
        `
    },
    lambda: {
        title: "Lambda Calculus -- The Foundation of Computing (1936)",
        body: `
            <p>In 1936, mathematician <span class="intro-highlight">Alonzo Church</span> invented
            <span class="intro-highlight">lambda calculus</span> -- a tiny formal system that turned out
            to be the mathematical foundation of all computing.</p>
            <p>Lambda calculus has only three things: variables, abstraction (\u03BBx.body),
            and application (f x). From these three primitives, you can build
            <em>everything</em> -- numbers, booleans, pairs, loops, even entire operating systems.</p>
            <div class="intro-example">abstraction ChurchNumerals {
    capabilities { }

    method two() = \u03BBf.\u03BBx.(f (f x))
    method add(m, n) = \u03BBf.\u03BBx.((m f) ((n f) x))
    method succ(n) = \u03BBf.\u03BBx.(f ((n f) x))
}</div>
            <p><span class="intro-highlight">Church numerals</span> encode numbers as functions:
            zero applies f zero times, one applies f once, two applies f twice.
            Addition is function composition. Multiplication is iterated addition.</p>
            <p>Church proved that lambda calculus is equivalent to Turing machines --
            anything one can compute, the other can too. The Church Machine is named
            after him because it unifies both models in hardware: Turing's data processing
            <em>and</em> Church's function abstraction, on the same chip.</p>
        `
    }
};

function showIntro(lang) {
    if (isWelcomeNeeded()) return;
    const dismissed = localStorage.getItem('church_intro_dismissed_' + lang);
    if (dismissed === 'true') return;

    const intro = langIntros[lang];
    if (!intro) return;

    const adapted = getGradeAdaptedIntro(lang) || intro;
    const nextStep = getNextStepTip(lang);
    document.getElementById('introTitle').innerHTML = adapted.title;
    document.getElementById('introBody').innerHTML = adapted.body + nextStep;
    document.getElementById('introDismiss').checked = false;
    document.getElementById('introModal').style.display = 'flex';
    document.getElementById('introModal').setAttribute('data-lang', lang);
    const goBtn = document.getElementById('introGoBtn');
    if (goBtn) {
        const progress = getStudentProgress();
        const c = progress.compilations || 0;
        const d = progress.drafts || 0;
        const a = progress.abstractions || 0;
        if (c === 0) goBtn.textContent = "Let's Try It!";
        else if (d === 0) goBtn.textContent = 'See the Draft!';
        else if (a === 0) goBtn.textContent = 'Create It!';
        else goBtn.textContent = "Let's Go!";
    }

    const body = document.getElementById('introBody');
    const arrow = document.getElementById('introScrollArrow');
    if (body && arrow) {
        const updateArrow = () => {
            const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 8;
            arrow.classList.toggle('hidden', atBottom || body.scrollHeight <= body.clientHeight);
        };
        body.removeEventListener('scroll', body._introScrollHandler);
        body._introScrollHandler = updateArrow;
        body.addEventListener('scroll', updateArrow);
        requestAnimationFrame(updateArrow);
    }
}

function closeIntro() {
    const modal = document.getElementById('introModal');
    const lang = modal.getAttribute('data-lang');
    const dismiss = document.getElementById('introDismiss').checked;
    if (dismiss && lang) {
        localStorage.setItem('church_intro_dismissed_' + lang, 'true');
    }
    modal.style.display = 'none';
    const body = document.getElementById('introBody');
    if (body && body._introScrollHandler) {
        body.removeEventListener('scroll', body._introScrollHandler);
        body._introScrollHandler = null;
    }
    const arrow = document.getElementById('introScrollArrow');
    if (arrow) arrow.classList.add('hidden');
}

const FAMILY_PERMISSIONS = [
    { key: 'compile',       label: 'Compile Programs',        desc: 'Use the CLOOMC++ compiler' },
    { key: 'browseLibrary', label: 'Browse Library',           desc: 'Access Mum Tunnel shared abstractions' },
    { key: 'publish',       label: 'Publish to Library',       desc: 'Share abstractions publicly' },
    { key: 'createNS',      label: 'Create Namespace Entries', desc: 'Reserve namespace slots' },
    { key: 'deploy',        label: 'Deploy to Tang',           desc: 'Upload to FPGA hardware' },
    { key: 'editCode',      label: 'Edit Code',                desc: 'Write and modify source code' },
    { key: 'viewPipeline',  label: 'View Pipeline',            desc: 'See the mLoad pipeline' },
    { key: 'mathTools',     label: 'Use Math Tools',           desc: 'HP-35, Abacus, Slide Rule' },
    { key: 'settings',      label: 'Change Settings',          desc: 'Modify family settings' }
];

function mintGoldenToken() {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return '0x' + arr[0].toString(16).toUpperCase().padStart(8, '0');
}

function getFamilyAbstraction() {
    try {
        const raw = localStorage.getItem('church_family_abstraction');
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
}

function saveFamilyAbstraction(fa) {
    localStorage.setItem('church_family_abstraction', JSON.stringify(fa));
}

function initFamilyAbstraction(parentName) {
    const parentGT = mintGoldenToken();
    const allPerms = {};
    FAMILY_PERMISSIONS.forEach(p => { allPerms[p.key] = true; });
    const fa = {
        nsSlot: 42,
        name: 'Family',
        owner: parentGT,
        clist: [
            { gtId: parentGT, role: 'Parent', name: parentName, permissions: allPerms, immutable: true, mintedAt: Date.now() }
        ]
    };
    saveFamilyAbstraction(fa);
    return fa;
}

function mintChildGT(fa, childName, role) {
    const childGT = mintGoldenToken();
    const childPerms = {};
    FAMILY_PERMISSIONS.forEach(p => {
        childPerms[p.key] = (p.key !== 'settings' && p.key !== 'deploy' && p.key !== 'publish');
    });
    fa.clist.push({
        gtId: childGT,
        role: role || 'Child',
        name: childName,
        permissions: childPerms,
        immutable: true,
        mintedAt: Date.now()
    });
    saveFamilyAbstraction(fa);
    return childGT;
}

function familyAllow(fa, gtId, permKey) {
    const entry = fa.clist.find(e => e.gtId === gtId);
    if (!entry) return false;
    if (entry.gtId === fa.owner) return false;
    entry.permissions[permKey] = true;
    saveFamilyAbstraction(fa);
    return true;
}

function familyDeny(fa, gtId, permKey) {
    const entry = fa.clist.find(e => e.gtId === gtId);
    if (!entry) return false;
    if (entry.gtId === fa.owner) return false;
    entry.permissions[permKey] = false;
    saveFamilyAbstraction(fa);
    return true;
}

function getActiveGT() {
    return localStorage.getItem('church_active_gt') || null;
}

function setActiveGT(gtId) {
    localStorage.setItem('church_active_gt', gtId);
}

function checkPermission(permKey) {
    const fa = getFamilyAbstraction();
    if (!fa) return true;
    const activeGT = getActiveGT();
    if (!activeGT) return true;
    const entry = fa.clist.find(e => e.gtId === activeGT);
    if (!entry) return false;
    return entry.permissions[permKey] !== false;
}

function getStudentSettings() {
    try {
        const raw = localStorage.getItem('church_student_settings');
        if (raw) {
            const s = JSON.parse(raw);
            if (!s.familyMembers) s.familyMembers = [];
            return s;
        }
    } catch (e) {}
    return {
        name: '',
        familyMembers: [],
        profession: 'student',
        language: 'english',
        nationality: 'us',
        ageTier: '13-17',
        fpgaBoard: 'tang-nano-20k',
        selectedSubjects: []
    };
}

function getStudentProgress() {
    try {
        const raw = localStorage.getItem('church_student_progress');
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { compilations: 0, abstractions: 0, drafts: 0, replSessions: 0, langsUsed: [], history: [] };
}

function saveStudentProgress(progress) {
    localStorage.setItem('church_student_progress', JSON.stringify(progress));
}

function trackAction(action, detail) {
    const progress = getStudentProgress();
    if (action === 'compile') progress.compilations++;
    if (action === 'abstract') progress.abstractions++;
    if (action === 'draft') progress.drafts++;
    if (action === 'repl') progress.replSessions++;
    if (detail && detail.lang && !progress.langsUsed.includes(detail.lang)) {
        progress.langsUsed.push(detail.lang);
    }
    const ts = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const entry = `${ts} ${action}${detail && detail.name ? ': ' + detail.name : ''}`;
    progress.history.unshift(entry);
    if (progress.history.length > 50) progress.history.length = 50;
    saveStudentProgress(progress);
}

function renderFamilyIntroQR() {
    const el = document.getElementById('familyIntroQR');
    if (!el) return;
    const fa = getFamilyAbstraction();
    const seed = fa ? parseInt(fa.owner.replace('0x',''), 16) : 0xDEADBEEF;
    const size = 9;
    const cells = [];
    let s = seed;
    for (let y = 0; y < size; y++) {
        cells[y] = [];
        for (let x = 0; x < size; x++) {
            if ((x < 3 && y < 3) || (x >= size - 3 && y < 3) || (x < 3 && y >= size - 3)) {
                const ox = x < 3 ? x : (x >= size - 3 ? x - (size - 3) : x);
                const oy = y < 3 ? y : (y >= size - 3 ? y - (size - 3) : y);
                cells[y][x] = (ox === 0 || ox === 2 || oy === 0 || oy === 2 || (ox === 1 && oy === 1)) ? 1 : 0;
            } else {
                s = (s * 1103515245 + 12345) & 0x7FFFFFFF;
                cells[y][x] = (s >> 16) & 1;
            }
        }
    }
    const cellSize = 6;
    const svgSize = size * cellSize;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgSize} ${svgSize}" width="${svgSize}" height="${svgSize}">`;
    svg += `<rect width="${svgSize}" height="${svgSize}" fill="rgba(200,155,60,0.08)" rx="2"/>`;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (cells[y][x]) {
                svg += `<rect x="${x*cellSize}" y="${y*cellSize}" width="${cellSize}" height="${cellSize}" fill="rgba(200,155,60,0.6)" rx="0.5"/>`;
            }
        }
    }
    svg += '</svg>';
    el.innerHTML = svg;
}

function openShareLink() {
    const url = window.location.href.split('#')[0];
    const input = document.getElementById('shareLinkURL');
    if (input) input.value = url;
    const status = document.getElementById('shareLinkStatus');
    if (status) status.textContent = '';
    document.getElementById('shareLinkModal').style.display = 'flex';
    setTimeout(() => { if (input) { input.focus(); input.select(); } }, 100);
}

function copyShareLink() {
    const input = document.getElementById('shareLinkURL');
    const status = document.getElementById('shareLinkStatus');
    if (!input) return;
    const url = input.value;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
            if (status) { status.textContent = 'Copied to clipboard'; status.className = 'share-link-status success'; }
        }).catch(() => {
            input.select();
            document.execCommand('copy');
            if (status) { status.textContent = 'Copied to clipboard'; status.className = 'share-link-status success'; }
        });
    } else {
        input.select();
        document.execCommand('copy');
        if (status) { status.textContent = 'Copied to clipboard'; status.className = 'share-link-status success'; }
    }
}

function nativeShare() {
    const url = document.getElementById('shareLinkURL')?.value || window.location.href;
    if (navigator.share) {
        navigator.share({ title: 'Church Machine', url: url }).catch(() => { copyShareLink(); });
    } else {
        copyShareLink();
    }
}

function getSelectedBoard() {
    return localStorage.getItem('fpga_board_target') || 'tang-nano-20k';
}

function setSelectedBoard(board) {
    localStorage.setItem('fpga_board_target', board);
}

function getBoardLabel(board) {
    if (board === 'ti60-f225') return 'Efinix Ti60 F225';
    return 'Sipeed Tang Nano 20K';
}

function switchBuilderViewTab(tab) {
    document.querySelectorAll('.builder-view-tab').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('builderViewTab-' + tab);
    if (btn) btn.classList.add('active');
    const cyberspace = document.getElementById('builderView');
    const details = document.getElementById('buildDetailsPanel');
    if (cyberspace) cyberspace.style.display = (tab === 'cyberspace') ? '' : 'none';
    if (details) details.style.display = (tab === 'buildlog') ? '' : 'none';
}

function _setBuildStatus(state, label, board) {
    const dot = document.getElementById('buildStatusDot');
    const lbl = document.getElementById('buildStatusLabel');
    const brd = document.getElementById('buildStatusBoard');
    if (dot) { dot.className = 'build-status-dot ' + state; }
    if (lbl) lbl.textContent = label;
    if (brd && board) brd.textContent = board;
}

function _buildLogScroll() {
    const area = document.getElementById('buildLogArea');
    if (!area) return;
    setTimeout(() => { area.scrollTop = area.scrollHeight; }, 50);
}

function _buildLogAppend(text) {
    const area = document.getElementById('buildLogArea');
    if (!area) return;
    area.textContent += text;
    _buildLogScroll();
}

function _buildLogSet(text) {
    const area = document.getElementById('buildLogArea');
    if (!area) return;
    area.textContent = text;
    _buildLogScroll();
}

function _renderBuildFiles(files, isTi60) {
    const list = document.getElementById('buildFileList');
    if (!list) return;
    if (!files || !files.length) {
        list.innerHTML = '<div class="build-file-empty">No files reported.</div>';
        return;
    }
    const iconMap = { v: '📄', edif: '🔌', il: '⚙️', json: '📋', cst: '📍', makefile: '🛠️', md: '📖' };
    list.innerHTML = files.map(f => {
        const ext = f.split('.').pop().toLowerCase();
        const icon = iconMap[ext] || '📄';
        return `<div class="build-file-row"><span class="build-file-icon">${icon}</span><span>${f}</span></div>`;
    }).join('');
}

function _renderBuildNextSteps(isTi60) {
    const el = document.getElementById('buildNextSteps');
    if (!el) return;
    const steps = isTi60 ? [
        'Open Efinity IDE, create Titanium project (Ti60F225)',
        'Add church_ti60_f225.v as source file',
        'Interface Editor → Import ti60_f225.isf',
        'Run Synthesis → P&R → Generate Bitstream',
        'Program via Efinity Programmer (JTAG / USB)',
    ] : [
        'Install OSS CAD Suite (oss-cad-suite-build on GitHub)',
        'Unzip the package, then run: make pnr pack',
        'Connect Tang Nano 20K via USB',
        'Run: make prog  — or use the Deploy to FPGA button',
    ];
    el.innerHTML = steps.map((s, i) =>
        `<div class="build-step-row"><span class="build-step-num">${i + 1}</span><span>${s}</span></div>`
    ).join('');
}

function initHardwareBuildPanel() {
    const sel = document.getElementById('hardwareBoardSel');
    if (sel) sel.value = getSelectedBoard();
    updateHardwarePanelLabel();
}

function updateHardwarePanelLabel() {
    const board = getSelectedBoard();
    const info = document.getElementById('hwBuildInfoText');
    if (!info) return;
    if (board === 'ti60-f225') {
        info.textContent = 'Output: church_ti60_f225.v + church_ti60_f225.edif + ti60_f225.isf  \u2014  open in Efinity IDE (Titanium project)';
    } else {
        info.textContent = 'Output: church_tang_nano_20k.v + Makefile + tang_nano_20k.cst  \u2014  run make pnr pack, then make prog';
    }
}

function openSettings() {
    if (!requirePermission('settings', 'Change Settings')) return;
    const settings = getStudentSettings();
    document.getElementById('settingName').value = settings.name || '';
    const profSel = document.getElementById('settingProfession');
    if (profSel) profSel.value = settings.profession || 'student';
    const langSel = document.getElementById('settingLanguage');
    if (langSel) langSel.value = settings.language || 'english';
    const natSel = document.getElementById('settingNationality');
    if (natSel) natSel.value = settings.nationality || 'us';
    const ageSel = document.getElementById('settingAgeTier');
    if (ageSel) ageSel.value = settings.ageTier || '13-17';
    renderFamilyMembers(settings.familyMembers || []);
    renderProgressReport();
    renderFamilyIntroQR();
    const releaseEl = document.getElementById('settingsReleasePublishedAt');
    if (releaseEl) releaseEl.textContent = '2026-03-29 22:15 UTC';
    const anyPerm = hasAnyPopupDismissedPerm();
    const showAllCheck = document.getElementById('showAllPopupsCheck');
    if (showAllCheck) showAllCheck.checked = !anyPerm;
    const boardSel = document.getElementById('settingFPGABoard');
    if (boardSel) boardSel.value = getSelectedBoard();
    document.getElementById('settingsModal').style.display = 'flex';
}

function hasAnyPopupDismissedPerm() {
    const keys = [
        'church_welcome_dismissed_perm',
        'churchMachine_mathGuideDismissed_perm',
        'churchMachine_toolGuide_interactive_perm',
        'churchMachine_toolGuide_hp35_perm',
        'churchMachine_toolGuide_abacus_perm',
        'churchMachine_toolGuide_sliderule_perm'
    ];
    return keys.some(k => localStorage.getItem(k));
}

function toggleShowAllPopups(checked) {
    if (checked) {
        resetAllPopupsFlags();
    } else {
        dismissAllPopupsPerm();
    }
}

function resetAllPopupsFlags() {
    localStorage.removeItem('church_welcome_dismissed');
    localStorage.removeItem('church_welcome_dismissed_perm');
    localStorage.removeItem('churchMachine_mathGuideDismissed');
    localStorage.removeItem('churchMachine_mathGuideDismissed_perm');
    localStorage.removeItem('churchMachine_toolGuide_interactive');
    localStorage.removeItem('churchMachine_toolGuide_interactive_perm');
    localStorage.removeItem('churchMachine_toolGuide_hp35');
    localStorage.removeItem('churchMachine_toolGuide_hp35_perm');
    localStorage.removeItem('churchMachine_toolGuide_abacus');
    localStorage.removeItem('churchMachine_toolGuide_abacus_perm');
    localStorage.removeItem('churchMachine_toolGuide_sliderule');
    localStorage.removeItem('churchMachine_toolGuide_sliderule_perm');
}

function dismissAllPopupsPerm() {
    localStorage.setItem('church_welcome_dismissed', '1');
    localStorage.setItem('church_welcome_dismissed_perm', '1');
    localStorage.setItem('churchMachine_mathGuideDismissed', '1');
    localStorage.setItem('churchMachine_mathGuideDismissed_perm', '1');
    localStorage.setItem('churchMachine_toolGuide_interactive', '1');
    localStorage.setItem('churchMachine_toolGuide_interactive_perm', '1');
    localStorage.setItem('churchMachine_toolGuide_hp35', '1');
    localStorage.setItem('churchMachine_toolGuide_hp35_perm', '1');
    localStorage.setItem('churchMachine_toolGuide_abacus', '1');
    localStorage.setItem('churchMachine_toolGuide_abacus_perm', '1');
    localStorage.setItem('churchMachine_toolGuide_sliderule', '1');
    localStorage.setItem('churchMachine_toolGuide_sliderule_perm', '1');
}

function closeSettings() {
    document.getElementById('settingsModal').style.display = 'none';
}

function showReleaseHistory() {
    const history = [
        { date: '2026-03-29 22:15 UTC', title: 'Consistency & Hardware Updates', changes: ['Consistency audits completed', 'Simulator GT type mapping fixed (Inform/Outform/Abstract)', 'Hardware deployment plan for Efinix Ti60 F225 created', 'Settings button order corrected', 'Lump size specification unified (64-word minimum)'] },
        { date: '2026-03-24 00:00 UTC', title: 'Locator & Docs', changes: ['Locator rename completed', 'Namespace docs refreshed', 'CLOOMC++ tutorials updated'] }
    ];
    let html = '<div style="max-height:60vh;overflow-y:auto;font-size:0.85rem;">';
    history.forEach(rel => {
        html += `<div style="margin-bottom:1.5rem;border-bottom:1px solid #444;padding-bottom:0.5rem;">`;
        html += `<div style="color:var(--church-gold);font-weight:bold;margin-bottom:0.3rem;">${rel.date}</div>`;
        html += `<div style="color:#bbb;font-size:0.9rem;margin-bottom:0.5rem;">${rel.title}</div>`;
        html += `<ul style="margin:0;padding-left:1.5rem;color:#999;">`;
        rel.changes.forEach(change => {
            html += `<li>${change}</li>`;
        });
        html += `</ul></div>`;
    });
    html += '</div>';
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog';
    dialog.style.maxWidth = '600px';
    dialog.innerHTML = `
        <div class="modal-title">Release History</div>
        ${html}
        <div class="modal-buttons" style="margin-top:1rem;">
            <button class="btn btn-warning" onclick="this.parentElement.parentElement.parentElement.remove()">Close</button>
        </div>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
}

function saveSettings() {
    const settings = {
        name: document.getElementById('settingName').value.trim(),
        familyMembers: collectFamilyMembers(),
        profession: document.getElementById('settingProfession')?.value || 'student',
        language: document.getElementById('settingLanguage')?.value || 'english',
        nationality: document.getElementById('settingNationality')?.value || 'us',
        ageTier: document.getElementById('settingAgeTier')?.value || '13-17',
        fpgaBoard: document.getElementById('settingFPGABoard')?.value || 'tang-nano-20k',
        selectedSubjects: getSelectedSubjects()
    };
    localStorage.setItem('church_student_settings', JSON.stringify(settings));

    const boardSel = document.getElementById('settingFPGABoard');
    if (boardSel) setSelectedBoard(boardSel.value);

    let fa = getFamilyAbstraction();
    const members = settings.familyMembers;
    if (members.length > 0) {
        const adultRoles = ['Mum', 'Dad', 'Grandpa', 'Grandma', 'Uncle', 'Auntie', 'Teacher'];
        const firstAdult = members.find(m => adultRoles.includes(m.role));
        if (!fa && firstAdult) {
            fa = initFamilyAbstraction(firstAdult.name);
            fa.clist[0].role = firstAdult.role;
            saveFamilyAbstraction(fa);
            setActiveGT(fa.owner);
        }
        if (fa) {
            members.forEach(m => {
                const existing = fa.clist.find(e => e.name === m.name && e.role === m.role);
                if (!existing && m.name) {
                    if (adultRoles.includes(m.role) && fa.clist.filter(e => adultRoles.includes(e.role)).length === 0) {
                        fa.owner = mintGoldenToken();
                        fa.clist.unshift({ gtId: fa.owner, role: m.role, name: m.name, permissions: (() => { const p = {}; FAMILY_PERMISSIONS.forEach(x => { p[x.key] = true; }); return p; })(), immutable: true, mintedAt: Date.now() });
                        saveFamilyAbstraction(fa);
                    } else {
                        mintChildGT(fa, m.name, m.role);
                    }
                }
            });
        }
    }
    closeSettings();
}

function onGradeChange() {
    renderProgressReport();
}

const familyRoles = ['Mum', 'Me', 'Friend', 'Friend', 'Friend', 'Friend', 'Friend', 'Friend'];

function renderFamilyMembers(members) {
    const container = document.getElementById('familyMembersList');
    if (!container) return;
    container.innerHTML = '';
    if (!members || members.length === 0) {
        addFamilyMemberRow('Mum', '');
        addFamilyMemberRow('Me', '');
        return;
    }
    members.forEach(m => addFamilyMemberRow(m.role || 'Me', m.name || ''));
}

function addFamilyMemberRow(role, name) {
    const container = document.getElementById('familyMembersList');
    if (!container) return;
    const count = container.children.length;
    if (count >= 8) return;
    const defaultRole = count < 2 ? (count === 0 ? 'Mum' : 'Me') : 'Friend';
    const r = role || defaultRole;
    const n = name || '';
    const fa = getFamilyAbstraction();
    const entry = fa ? fa.clist.find(e => e.name === n && e.role === r) : null;
    const gtDisplay = entry ? entry.gtId : '';
    const isOwner = entry && fa && entry.gtId === fa.owner;

    const row = document.createElement('div');
    row.className = 'family-member-row';

    let gtBadge = '';
    if (gtDisplay) {
        gtBadge = `<span class="gt-badge${isOwner ? ' gt-owner' : ''}" title="${isOwner ? 'Owner GT — full permissions' : 'Child GT — permissions set by parent'}">${gtDisplay}</span>`;
    }

    let permsHTML = '';
    if (entry && !isOwner && fa) {
        permsHTML = `<div class="gt-perms-row">`;
        FAMILY_PERMISSIONS.forEach(p => {
            const checked = entry.permissions[p.key] !== false ? ' checked' : '';
            permsHTML += `<label class="gt-perm-label" title="${escapeHtml(p.desc)}"><input type="checkbox" class="gt-perm-cb" data-gt="${entry.gtId}" data-perm="${p.key}"${checked} onchange="toggleFamilyPerm(this)"> ${escapeHtml(p.label)}</label>`;
        });
        permsHTML += `</div>`;
    }

    const roleOptions = ['Mum', 'Dad', 'Me', 'Brother', 'Sister', 'Grandpa', 'Grandma', 'Uncle', 'Auntie', 'Cousin', 'Friend', 'School Friend', 'Class Mate', 'Teacher'];
    let roleSelectHTML = `<select class="modal-input family-role-select">`;
    roleOptions.forEach(opt => {
        roleSelectHTML += `<option value="${opt}"${r === opt ? ' selected' : ''}>${opt}</option>`;
    });
    roleSelectHTML += `</select>`;

    row.innerHTML =
        `<div class="family-member-top">` +
        roleSelectHTML +
        `<input type="text" class="modal-input family-name-input" placeholder="Pet Name" value="${escapeHtml(n)}">` +
        gtBadge +
        `<button class="btn-remove-member" onclick="this.closest('.family-member-row').remove()" title="Remove">&times;</button>` +
        `</div>` +
        permsHTML;
    container.appendChild(row);
}

function toggleFamilyPerm(cb) {
    const fa = getFamilyAbstraction();
    if (!fa) return;
    const activeGT = getActiveGT();
    if (activeGT !== fa.owner) {
        cb.checked = !cb.checked;
        appendOutput('Only the parent (owner GT) can change permissions.', 'error');
        return;
    }
    const gtId = cb.dataset.gt;
    const permKey = cb.dataset.perm;
    if (cb.checked) {
        familyAllow(fa, gtId, permKey);
    } else {
        familyDeny(fa, gtId, permKey);
    }
}

function requirePermission(permKey, actionLabel) {
    if (!checkPermission(permKey)) {
        appendOutput(`Permission denied: ${actionLabel}. Ask your parent to enable "${permKey}" on your GT.`, 'error');
        return false;
    }
    return true;
}

function collectFamilyMembers() {
    const container = document.getElementById('familyMembersList');
    if (!container) return [];
    const members = [];
    container.querySelectorAll('.family-member-row').forEach(row => {
        const role = row.querySelector('.family-role-select');
        const name = row.querySelector('.family-name-input');
        if (role && name && name.value.trim()) {
            members.push({ role: role.value, name: name.value.trim() });
        }
    });
    return members;
}

function isWelcomeNeeded() {
    if (localStorage.getItem('church_welcome_dismissed_perm')) return false;
    const settings = getStudentSettings();
    const hasFamily = settings.familyMembers && settings.familyMembers.length > 0 &&
        settings.familyMembers.some(m => m.name && m.name.trim() !== '');
    if (!hasFamily) return true;
    return !localStorage.getItem('church_welcome_dismissed');
}

const WELCOME_SLIDES = [
    {
        html: `<div style="font-weight:700;color:var(--church-gold);font-size:1.05rem;margin-bottom:0.75rem;">Why does security matter?</div>` +
        `<p style="font-size:0.9rem;line-height:1.65;margin-bottom:0.75rem;">` +
        `Every computer your child uses &mdash; phones, tablets, laptops &mdash; runs software that can be tricked. ` +
        `Programs pretend to be other programs. Apps ask for permissions they should not have. ` +
        `A child clicks one wrong link and strangers can see their data. ` +
        `This is not a new problem. It is <em>the</em> problem of computing, and it was solved in 1936.</p>` +
        `<div style="background:rgba(218,165,32,0.06);border:1px solid rgba(218,165,32,0.2);border-radius:8px;padding:0.75rem 1rem;margin-bottom:0.75rem;font-size:0.88rem;line-height:1.6;">` +
        `<strong style="color:var(--church-gold);">Did you know?</strong> Cybercrime is now the world's third biggest economy &mdash; ` +
        `behind only the USA and China. If it were a country, it would be richer than Japan, Germany, and the UK combined. ` +
        `<a href="https://sipantic.blogspot.com/2025/11/the-cybercrime-tsunami.html" target="_blank" rel="noopener" style="color:var(--church-gold);">Read more</a></div>` +
        `<p style="font-size:0.88rem;line-height:1.6;margin:0;">` +
        `The Church Machine implements the <strong>Lambda Calculus</strong>: a universal model of computation that provides ` +
        `a rigorous mathematical foundation for designing secure and provably correct software and hardware, ` +
        `offering an alternative to the problematic von Neumann model. ` +
        `<a href="https://en.wikipedia.org/wiki/Lambda_calculus" target="_blank" rel="noopener" style="color:var(--church-gold);">More</a></p>`
    },
    {
        html: `<div style="font-weight:700;color:var(--church-gold);font-size:1.05rem;margin-bottom:0.75rem;">How Alonzo Church solved it</div>` +
        `<p style="font-size:0.9rem;line-height:1.65;margin-bottom:0.75rem;">` +
        `In 1936, mathematician <strong>Alonzo Church</strong> invented the lambda calculus &mdash; a way of computing where ` +
        `you can only use something if someone explicitly gives it to you. No sneaking, no stealing, no tricks. ` +
        `If you do not hold the key, the door does not open. ` +
        `<a href="https://en.wikipedia.org/wiki/Alonzo_Church" target="_blank" rel="noopener" style="color:var(--church-gold);">More</a></p>` +
        `<div style="background:rgba(218,165,32,0.08);border:1px solid rgba(218,165,32,0.25);border-radius:8px;padding:0.75rem 1rem;margin-bottom:0.75rem;">` +
        `<div style="font-weight:700;color:var(--church-gold);margin-bottom:0.5rem;">Golden Tokens</div>` +
        `<p style="font-size:0.88rem;line-height:1.6;margin:0;">` +
        `The Church Machine is built on this idea. Every action requires a <strong>Golden Token</strong> &mdash; ` +
        `an unforgeable digital key. Your child cannot send a message, share a file, or connect with anyone ` +
        `unless they hold the right token. And <em>you</em> control which tokens they hold. ` +
        `<a href="https://en.wikipedia.org/wiki/Capability-based_security" target="_blank" rel="noopener" style="color:var(--church-gold);">More</a></p>` +
        `</div>` +
        `<p style="font-size:0.85rem;color:#aaa;line-height:1.5;margin:0;">` +
        `This is not access control bolted on top &mdash; it is the mathematics itself. There is no way around it.</p>`
    },
    {
        html: `<div style="font-weight:700;color:var(--church-green);font-size:1.05rem;margin-bottom:0.75rem;">Hello Mum &mdash; the first safe message</div>` +
        `<div style="background:rgba(100,200,100,0.06);border:1px solid rgba(100,200,100,0.2);border-radius:8px;padding:0.75rem 1rem;margin-bottom:0.75rem;">` +
        `<p style="font-size:0.9rem;line-height:1.65;margin:0 0 0.75rem 0;">` +
        `When you register your family, the Church Machine creates a secure link between parent and child. ` +
        `Your child can then write their first program: <strong>Hello(Mum)</strong> &mdash; ` +
        `a message that travels through the Family security block, verified by Golden Tokens at every step.</p>` +
        `<p style="font-size:0.9rem;line-height:1.65;margin:0;">` +
        `No one else can send that message. No one else can intercept it. It works because Mum is not just a name &mdash; ` +
        `she is a <strong>Golden Token</strong>, alive, in charge, unforgeable and unique.</p>` +
        `</div>` +
        `<p style="font-size:0.88rem;color:#aaa;line-height:1.55;margin:0;">` +
        `That is what Church's mathematics gives us: a computer where &ldquo;Hello Mum&rdquo; &mdash; unlike ` +
        `Hello World from 1972 &mdash; actually means something safe.</p>`
    },
    {
        html: `<div style="font-weight:700;color:var(--church-gold);font-size:1.05rem;margin-bottom:0.75rem;">Getting started</div>` +
        `<div class="welcome-step">` +
        `<span class="welcome-step-num">1</span>` +
        `<div class="welcome-step-text"><strong>Register your family.</strong> Click "Set Up My Family" below to enter your name (or your children's names) and select a grade level. This creates the Golden Token link between you.</div>` +
        `</div>` +
        `<div class="welcome-step">` +
        `<span class="welcome-step-num">2</span>` +
        `<div class="welcome-step-text"><strong>Try the Math tab.</strong> Type a simple calculation like <code style="background:#1a1a2e;padding:0.15rem 0.4rem;border-radius:3px;color:var(--church-gold);">let x = 2 + 3</code> and press Enter. The answer appears instantly. Try the Challenge panel on the right for grade-level problems.</div>` +
        `</div>` +
        `<div class="welcome-step">` +
        `<span class="welcome-step-num">3</span>` +
        `<div class="welcome-step-text"><strong>Watch their progress.</strong> Open Settings (the gear icon) to see problems solved, languages tried, and recent activity. Everything stays on this device &mdash; no accounts, no cloud.</div>` +
        `</div>` +
        `<div class="welcome-step">` +
        `<span class="welcome-step-num">4</span>` +
        `<div class="welcome-step-text"><strong>Explore.</strong> The Code tab has four programming languages. The Tutorial tab has guided lessons. The Docs tab has the full reference. There is no wrong way to learn.</div>` +
        `</div>`
    }
];

let _welcomeSlideIdx = 0;

function _getNextWelcomeSlide() {
    const stored = parseInt(localStorage.getItem('church_welcome_slide') || '0', 10);
    const next = isNaN(stored) ? 0 : (stored + 1) % WELCOME_SLIDES.length;
    localStorage.setItem('church_welcome_slide', String(next));
    return next;
}

function _renderWelcomeSlide(idx) {
    const body = document.getElementById('welcomeBody');
    const indicator = document.getElementById('welcomeSlideIndicator');
    if (!body) return;
    _welcomeSlideIdx = ((idx % WELCOME_SLIDES.length) + WELCOME_SLIDES.length) % WELCOME_SLIDES.length;
    body.scrollTop = 0;
    body.innerHTML = WELCOME_SLIDES[_welcomeSlideIdx].html;
    if (indicator) indicator.textContent = `${_welcomeSlideIdx + 1} / ${WELCOME_SLIDES.length}`;
    const arrow = document.getElementById('welcomeScrollArrow');
    if (arrow) {
        const checkScroll = () => {
            const gap = body.scrollHeight - body.scrollTop - body.clientHeight;
            if (gap > 30) arrow.classList.remove('hidden');
            else arrow.classList.add('hidden');
        };
        if (body._scrollHandler) body.removeEventListener('scroll', body._scrollHandler);
        body._scrollHandler = checkScroll;
        body.addEventListener('scroll', checkScroll);
        checkScroll();
    }
}

function stepWelcomeSlide(dir) {
    _renderWelcomeSlide(_welcomeSlideIdx + dir);
    localStorage.setItem('church_welcome_slide', String(_welcomeSlideIdx));
}

function showWelcomePopup(force) {
    if (POPUPS_DISABLED) return;
    if (!force && !isWelcomeNeeded()) return;

    const idx = force ? _welcomeSlideIdx : _getNextWelcomeSlide();
    _renderWelcomeSlide(idx);
    document.getElementById('welcomeModal').style.display = 'flex';
}

function closeWelcome() {
    const dontShow = document.getElementById('welcomeDontShow');
    if (dontShow && dontShow.checked) {
        localStorage.setItem('church_welcome_dismissed_perm', '1');
    }
    localStorage.setItem('church_welcome_dismissed', '1');
    sessionStorage.setItem('church_welcome_dismissed_session', '1');
    const modal = document.getElementById('welcomeModal');
    if (modal) modal.style.display = 'none';
    const welcomeBody = document.getElementById('welcomeBody');
    if (welcomeBody && welcomeBody._scrollHandler) {
        welcomeBody.removeEventListener('scroll', welcomeBody._scrollHandler);
        delete welcomeBody._scrollHandler;
    }
    const arrow = document.getElementById('welcomeScrollArrow');
    if (arrow) arrow.classList.add('hidden');
}

function welcomeSetup() {
    closeWelcome();
    openSettings();
}

function welcomeSkip() {
    closeWelcome();
}

function toggleHelpMenu() {
    const dd = document.getElementById('helpDropdown');
    if (!dd) return;
    const open = dd.style.display !== 'none';
    dd.style.display = open ? 'none' : 'block';
    if (!open) {
        setTimeout(() => {
            document.addEventListener('click', _helpMenuOutsideClick, { once: true, capture: true });
        }, 0);
    }
}

function closeHelpMenu() {
    const dd = document.getElementById('helpDropdown');
    if (dd) dd.style.display = 'none';
}

function _helpMenuOutsideClick(e) {
    const wrap = document.getElementById('helpMenuWrap');
    if (wrap && !wrap.contains(e.target)) {
        closeHelpMenu();
    } else if (wrap && wrap.contains(e.target)) {
        document.addEventListener('click', _helpMenuOutsideClick, { once: true, capture: true });
    }
}

const SUBJECTS = [
    {
        key: 'english',
        name: 'English',
        icon: '\uD83D\uDCD6',
        color: '#4fc3f7',
        desc: 'Write programs in plain English sentences',
        lessons: [
            { title: 'Your First Program', code: 'create abstraction called Hello\nadd method greet that prints "Hello World"', desc: 'Learn to write commands the Church Machine understands' },
            { title: 'Variables & Storage', code: 'create abstraction called Counter\nadd data count starting at 0\nadd method increment that adds 1 to count', desc: 'Store and change values using data words' },
            { title: 'Conditions', code: 'create abstraction called Guard\nadd method check that if count is greater than 10 then print "Too many"', desc: 'Make decisions with if-then logic' },
            { title: 'First-Class Variables', code: 'create abstraction called Mapper\nadd method apply that takes a function and a value and returns the function applied to the value', desc: 'Pass functions as values — the key difference from basic machine code' }
        ]
    },
    {
        key: 'javascript',
        name: 'JavaScript',
        icon: '\uD83D\uDCBB',
        color: '#f0c674',
        desc: 'Modern programming with functions and objects',
        lessons: [
            { title: 'Functions', code: 'function add(a, b) {\n  return a + b;\n}', desc: 'Define reusable blocks of code' },
            { title: 'First-Class Variables', code: 'let double = (x) => x * 2;\nlet apply = (f, x) => f(x);\nlet result = apply(double, 5);\n// result = 10', desc: 'Store functions in variables and pass them as arguments — not just values' },
            { title: 'Arrays & Loops', code: 'let nums = [1, 2, 3, 4, 5];\nfor (let n of nums) {\n  console.log(n * n);\n}', desc: 'Work with lists and repeat actions' },
            { title: 'Objects as Abstractions', code: 'let counter = {\n  count: 0,\n  increment() { this.count++; },\n  read() { return this.count; }\n};', desc: 'Group data and methods together' }
        ]
    },
    {
        key: 'haskell',
        name: 'Haskell',
        icon: '\u03BB',
        color: '#b48ead',
        desc: 'Pure functional programming with lambda calculus',
        lessons: [
            { title: 'Lambda Expressions', code: 'double = \\x -> x * 2\nadd = \\x y -> x + y', desc: 'Define functions with lambda notation' },
            { title: 'First-Class Variables', code: 'apply f x = f x\ndouble = \\x -> x * 2\nresult = apply double 5\n-- result = 10\n-- "double" is passed as an argument, not called directly', desc: 'Functions are values — pass them, store them, return them' },
            { title: 'Pattern Matching', code: 'factorial 0 = 1\nfactorial n = n * factorial (n - 1)', desc: 'Handle different cases elegantly' },
            { title: 'Higher-Order Functions', code: 'map (\\x -> x * x) [1, 2, 3, 4, 5]', desc: 'Pass functions as arguments' }
        ]
    },
    {
        key: 'symbolic',
        name: 'Symbolic Math',
        icon: '\u222B',
        color: '#f0c674',
        desc: 'Ada Lovelace\'s mathematical notation',
        lessons: [
            { title: 'Let Bindings', code: 'let x = 2 + 3\nlet y = x * 4\nlet result = y - 1', desc: 'Define values step by step, like algebra' },
            { title: 'First-Class Variables', code: 'let double = \\x -> x * 2\nlet apply = \\f x -> f(x)\nlet result = apply(double, 5)', desc: 'A variable holds a function — Ada did this in 1843' },
            { title: 'Expressions', code: 'let area = 3.14159 * r * r\nlet circumference = 2 * 3.14159 * r', desc: 'Write mathematical formulas' },
            { title: 'Bernoulli Numbers', code: 'let b0 = 1\nlet b1 = -1/2\nlet b2 = 1/6', desc: 'Ada\'s original computation from Note G' }
        ]
    },
    {
        key: 'assembly',
        name: 'Assembly \u2014 CLOOMC',
        icon: '\u2699',
        color: '#81a1c1',
        desc: 'Church + Turing: not just values, but functions and capabilities',
        lessons: [
            { title: 'Turing: Load & Store', code: '; === TURING DOMAIN ===\n; Move numbers between registers and memory.\n; This is what ALL processors can do.\n;\nLOAD  R0, #42        ; put the number 42 into R0\nSTORE R0, [R1]       ; write R0 to memory at address R1\nLOAD  R2, [R1]       ; read it back into R2\n;\n; R0, R1, R2 hold VALUES — plain numbers.\n; They cannot hold functions or permissions.', desc: 'Basic Turing: move numbers — every processor does this' },
            { title: 'Turing: Arithmetic', code: '; === TURING DOMAIN ===\n; Add and multiply numbers in registers.\n;\nLOAD R0, #7\nLOAD R1, #5\nADD  R2, R0, R1      ; R2 = 7 + 5 = 12\nMUL  R3, R2, R0      ; R3 = 12 * 7 = 84\n;\n; This is computation on VALUES.\n; No security. No isolation. No functions.\n; Any program can read any register.', desc: 'Turing adds values — but cannot pass functions or enforce security' },
            { title: 'Church: CALL with GT', code: '; === CHURCH DOMAIN ===\n; CALL does what Turing cannot:\n; it passes a FUNCTION, not a value.\n;\nMINT  R0             ; create a Golden Token (unforgeable key)\nSEAL  R0, R1         ; bind the GT to abstraction at NS index R1\nCALL  R0, #greet     ; invoke method "greet" on that abstraction\n;\n; What just happened:\n;   1. R0 holds a GT — a capability, not a number\n;   2. SEAL locked it to a specific abstraction\n;   3. CALL passed the function body to the processor\n;      through a secure envelope (the lump)\n;\n; The body runs INSIDE the envelope.\n; When it finishes, the envelope closes.\n; No other program can see inside.\n;\n; THIS is first-class: the GT in R0 is a function\n; passed as a value. Ada did this in 1843.', desc: 'CALL passes a function via a Golden Token — this is what makes CLOOMC different' },
            { title: 'Church vs Turing', code: '; === THE DIFFERENCE ===\n;\n; TURING (every processor):\n;   ADD R0, R1, R2     — adds two numbers\n;   R0 is a VALUE (plain 32-bit integer)\n;   Any program can read R0\n;   No isolation, no security\n;\n; CHURCH (only CLOOMC):\n;   CALL R0, #method   — invokes an abstraction\n;   R0 is a GOLDEN TOKEN (unforgeable capability)\n;   Only the holder can invoke it\n;   The function runs in a sealed envelope\n;   No other program can see inside\n;\n; Ada wrote functions that took other functions\n; as arguments. Church formalised it. CLOOMC\n; builds it into the hardware with MINT,\n; SEAL, and CALL.\n;\n; Basic assembly: values only.\n; CLOOMC assembly: values AND functions.', desc: 'Turing moves values. Church passes functions. CLOOMC does both.' },
            { title: 'First-Class Variables', code: '; === FIRST-CLASS VARIABLES ===\n;\n; In Turing, a variable holds a number:\n;   LOAD R0, #5       ; R0 = 5 (a value)\n;\n; In CLOOMC, a variable holds a function:\n;   MINT R0           ; R0 = Golden Token (a capability)\n;   SEAL R0, R1       ; R0 now refers to an abstraction\n;   CALL R0, #run     ; invoke the function R0 points to\n;\n; You can pass R0 to another abstraction:\n;   STORE R0, [R2]    ; give your GT to someone else\n;   ; They can CALL it too — if they have permission\n;\n; This is what "first-class" means:\n; functions are values you can store, pass,\n; and return — just like numbers.', desc: 'A variable can hold a function, not just a number — that is first-class' }
        ]
    },
    {
        key: 'math',
        name: 'Math Tools',
        icon: '\uD83E\uDDEE',
        color: '#8B7355',
        desc: 'HP-35, Abacus, Slide Rule',
        lessons: [
            { title: 'RPN Calculator', code: '', desc: 'Use the HP-35 reverse Polish notation calculator', view: 'repl', tab: 'hp35' },
            { title: 'Soroban Abacus', code: '', desc: 'Learn place value with the Japanese abacus', view: 'repl', tab: 'abacus' },
            { title: 'Slide Rule', code: '', desc: 'Multiply with logarithmic scales', view: 'repl', tab: 'sliderule' }
        ]
    },
    {
        key: 'lambda',
        name: 'Lambda Calculus',
        icon: '\u03BB',
        color: '#81c784',
        desc: 'The foundation of computing — pure functions from 1936',
        lessons: [
            { title: 'Church Numerals', code: '-- LAMBDA CALCULUS\n-- Church numerals: numbers as functions\n\nzero = \u03BBf.\u03BBx.x\none  = \u03BBf.\u03BBx.(f x)\ntwo  = \u03BBf.\u03BBx.(f (f x))\n\nsucc = \u03BBn.\u03BBf.\u03BBx.(f ((n f) x))\nthree = succ two', desc: 'Encode numbers as repeated function application' },
            { title: 'Booleans', code: '-- LAMBDA CALCULUS\n-- Church booleans: true and false as selectors\n\ntrue  = \u03BBa.\u03BBb.a\nfalse = \u03BBa.\u03BBb.b\n\nand = \u03BBp.\u03BBq.((p q) false)\nor  = \u03BBp.\u03BBq.((p true) q)\nnot = \u03BBp.((p false) true)', desc: 'Booleans are functions that select between two arguments' },
            { title: 'Pairs', code: '-- LAMBDA CALCULUS\n-- Church-encoded pairs\n\npair = \u03BBa.\u03BBb.\u03BBf.((f a) b)\nfst  = \u03BBp.(p \u03BBa.\u03BBb.a)\nsnd  = \u03BBp.(p \u03BBa.\u03BBb.b)\n\nlet myPair = ((pair one) two) in\n  (fst myPair)', desc: 'Build data structures from pure functions' },
            { title: 'Recursion (Y Combinator)', code: '-- LAMBDA CALCULUS\n-- The Y combinator: recursion from pure lambda calculus\n\nY = \u03BBf.(\u03BBx.(f (x x)) \u03BBx.(f (x x)))\n\nfactorial = Y \u03BBself.\u03BBn.\n  ((iszero n) one (mult n (self (pred n))))', desc: 'Fixed-point combinators enable recursion without named self-reference' }
        ]
    },
    {
        key: 'security',
        name: 'Security',
        icon: '\uD83D\uDD10',
        color: '#C89B3C',
        desc: 'Capability security and Golden Tokens',
        lessons: [
            { title: 'What is a Golden Token?', code: '', desc: 'Unforgeable 32-bit keys that control access', view: 'reference' },
            { title: 'Namespace & Abstractions', code: '', desc: 'How programs are isolated from each other', view: 'abstractions' },
            { title: 'The mLoad Pipeline', code: '', desc: 'How capabilities are checked in hardware', view: 'pipeline' }
        ]
    }
];

function renderSubjects() {
    const el = document.getElementById('subjectsGrid');
    if (!el) return;
    const progress = getStudentProgress();
    const langsUsed = progress.langsUsed || [];

    let html = '';
    for (const subject of SUBJECTS) {
        const used = langsUsed.includes(subject.key);
        const statusClass = used ? ' subject-active' : '';
        html += `<div class="subject-card${statusClass}" onclick="openSubject('${subject.key}')">`;
        html += `<div class="subject-card-icon" style="color:${subject.color}">${subject.icon}</div>`;
        html += `<div class="subject-card-info">`;
        html += `<div class="subject-card-name">${escapeHtml(subject.name)}</div>`;
        html += `<div class="subject-card-desc">${escapeHtml(subject.desc)}</div>`;
        if (used) {
            html += `<div class="subject-card-status">Started</div>`;
        }
        html += `</div>`;
        html += `</div>`;
    }
    el.innerHTML = html;
}

function openSubject(key) {
    const subject = SUBJECTS.find(s => s.key === key);
    if (!subject) return;

    const el = document.getElementById('subjectsGrid');
    if (!el) return;

    let html = `<button class="btn subject-back-btn" onclick="renderSubjects()">&larr; Back to Subjects</button>`;
    html += `<div class="subject-lesson-header">`;
    html += `<span class="subject-lesson-icon" style="color:${subject.color}">${subject.icon}</span>`;
    html += `<span class="subject-lesson-title">${escapeHtml(subject.name)}</span>`;
    html += `</div>`;

    for (const lesson of subject.lessons) {
        html += `<div class="subject-lesson-card" onclick="startLesson('${subject.key}', '${escapeHtml(lesson.title)}')">`;
        html += `<div class="subject-lesson-name">${escapeHtml(lesson.title)}</div>`;
        html += `<div class="subject-lesson-desc">${escapeHtml(lesson.desc)}</div>`;
        html += `</div>`;
    }
    el.innerHTML = html;
}

function startLesson(subjectKey, lessonTitle) {
    const subject = SUBJECTS.find(s => s.key === subjectKey);
    if (!subject) return;
    const lesson = subject.lessons.find(l => l.title === lessonTitle);
    if (!lesson) return;

    closeSettings();

    if (lesson.view) {
        switchView(lesson.view);
        if (lesson.tab) {
            setTimeout(() => {
                const tabBtn = document.querySelector(`.math-tab[data-tab="${lesson.tab}"]`);
                if (tabBtn) tabBtn.click();
            }, 100);
        }
        return;
    }

    switchView('editor');
    const langMap = { english: 'english', javascript: 'javascript', haskell: 'haskell', symbolic: 'symbolic', lambda: 'lambda', assembly: 'assembly' };
    const sel = document.getElementById('langSelector');
    if (sel && langMap[subjectKey]) {
        sel.value = langMap[subjectKey];
        onLangChange(false);
    }
    if (lesson.code) {
        const editor = document.getElementById('asmEditor');
        if (editor) {
            editor.value = lesson.code;
        }
    }
    appendOutput(`Lesson: ${lessonTitle} \u2014 ${lesson.desc}`, 'info');
}

function getSelectedSubjects() {
    const checkboxes = document.querySelectorAll('input[name="subjectCheckbox"]');
    const selected = [];
    checkboxes.forEach(cb => {
        if (cb.checked) selected.push(cb.dataset.subject);
    });
    return selected;
}

function renderProgressReport() {
    renderSubjects();
}

function getGradeLabel(grade) {
    if (!grade) return '';
    const validGrades = { 'K': 'Kindergarten', '1': 'Grade 1', '2': 'Grade 2', '3': 'Grade 3', '4': 'Grade 4', '5': 'Grade 5', '6': 'Grade 6', '7': 'Grade 7', '8': 'Grade 8', '9': 'Grade 9', '10': 'Grade 10', '11': 'Grade 11', '12': 'Grade 12', 'IB': 'IB Programme' };
    return validGrades[grade] || escapeHtml(grade);
}

function getGradeTier(grade) {
    if (!grade) return 'default';
    if (grade === 'K' || grade === '1' || grade === '2') return 'early';
    if (grade === '3' || grade === '4' || grade === '5') return 'elementary';
    if (grade === '6' || grade === '7' || grade === '8') return 'middle';
    if (grade === '9' || grade === '10') return 'high';
    if (grade === '11' || grade === '12') return 'advanced';
    if (grade === 'IB') return 'ib';
    return 'default';
}

function getGradeAdaptedIntro(lang) {
    const settings = getStudentSettings();
    const tier = getGradeTier(settings.grade);
    const name = settings.name || '';
    const greeting = name ? `Hi ${escapeHtml(name)}! ` : '';

    const base = langIntros[lang];
    if (!base || tier === 'default') return base;

    const gradeTag = settings.grade ? `<span class="grade-indicator">${getGradeLabel(settings.grade)}</span>` : '';

    const adapted = { title: base.title + gradeTag };

    if (lang === 'symbolic') {
        if (tier === 'early') {
            adapted.body = `
                <p>${greeting}You are about to see <span class="intro-highlight">the first computer program ever written!</span></p>
                <p>A very clever woman named <span class="intro-highlight">Ada Lovelace</span> wrote it a long, long time ago -- in 1843!
                That is over 180 years ago! She wrote instructions for a special machine that could do math.</p>
                <p>Her instructions look like this:</p>
                <div class="intro-example">let V1 = 1
let V2 = 2
let V4 = V2 * V3    -- multiply!</div>
                <p>Each <span class="intro-highlight">V</span> is like a box that holds a number.
                V1 holds the number 1, V2 holds 2, and so on. You tell the machine what to do with the numbers!</p>
            `;
        } else if (tier === 'elementary') {
            adapted.body = `
                <p>${greeting}<span class="intro-highlight">The first computer program ever written</span> is right here.</p>
                <p>In 1843, <span class="intro-highlight">Ada Lovelace</span> wrote a program for a machine called
                the Analytical Engine. The machine was never built, but her program was real. It calculated
                a special number called B7 -- the seventh Bernoulli number.</p>
                <p>Ada used variables like storage boxes:</p>
                <div class="intro-example">let V1 = 1
let V2 = 2
let V4 = V2 * V3    -- multiply V2 by V3
let V11 = V4 / V5   -- divide V4 by V5</div>
                <p>Each <span class="intro-highlight">V-variable</span> holds a number.
                You write one math operation per line. The Church Machine can actually run Ada's program today!</p>
            `;
        } else if (tier === 'middle') {
            adapted.body = `
                <p>${greeting}This is <span class="intro-highlight">the first computer program in history</span> --
                written by Ada Lovelace in 1843 for Charles Babbage's Analytical Engine.</p>
                <p>Her program computes B7, the seventh Bernoulli number, using a sequence of 25 operations.
                The notation maps directly to hardware: each V-variable is a register, each line is an instruction.</p>
                <div class="intro-example">let V1 = 1
let V2 = 2
let V4 = V2 * V3    -- Operation 1: 2n
let V11 = V4 / V5   -- Operation 4: ratio</div>
                <p>Multiply and divide compile to loops of addition and subtraction --
                the same way early computers actually worked.</p>
            `;
        } else if (tier === 'high') {
            adapted.body = `
                <p>${greeting}${base.body}`;
        } else if (tier === 'advanced' || tier === 'ib') {
            adapted.body = `
                <p>${greeting}You are examining <span class="intro-highlight">Note G</span> from Ada Lovelace's 1843 translation
                of Menabrea's paper on the Analytical Engine. This is the first published algorithm --
                a computation of the seventh Bernoulli number B7 = -1/30.</p>
                <p>The notation mirrors Ada's original: V-variables map to store columns (here, data registers DR1-DR15).
                Operation 4 uses the correction identified by Bromley (1990) -- Ada's original had V5/V4 instead of V4/V5.</p>
                <div class="intro-example">let V4 = V2 * V3    -- IADD loop: DR4 += DR2, counter DR3
let V11 = V4 / V5   -- ISUB loop: quotient++, remainder -= divisor</div>
                <p>Multiplication compiles to shift-and-add loops; division to repeated subtraction.
                The compiler allocates temporary registers dynamically to avoid clobbering.
                ${tier === 'ib' ? 'This connects to the IB Computer Science core -- abstraction, algorithms, and machine architecture as a unified system.' : ''}</p>
            `;
        }
    } else if (lang === 'assembly') {
        if (tier === 'early') {
            adapted.body = `
                <p>${greeting}This is <span class="intro-highlight">assembly language</span> -- the simplest instructions
                a computer understands!</p>
                <p>Each line tells the Church Machine to do one tiny thing -- like adding two numbers
                or checking if something is allowed.</p>
                <div class="intro-example">IADD DR0, DR1, DR2   ; add two numbers
MCMP DR0, DR1        ; compare them</div>
                <p>There are <span class="intro-highlight">20 instructions</span> the machine knows.
                Some do math, and some check security permissions -- like asking a parent for permission!</p>
            `;
        } else if (tier === 'elementary' || tier === 'middle') {
            adapted.body = `
                <p>${greeting}${base.body}`;
        } else if (tier === 'advanced' || tier === 'ib') {
            adapted.body = `
                <p>${greeting}Assembly provides direct access to the Church Machine's 20-instruction dual-domain ISA.
                The <span class="intro-highlight">Church domain</span> (LOAD, SAVE, CALL, RETURN, CHANGE, SWITCH, TPERM, LAMBDA, ELOADCALL, XLOADLAMBDA)
                enforces capability-based security through Golden Tokens.
                The <span class="intro-highlight">Turing domain</span> (DREAD, DWRITE, BFEXT, BFINS, MCMP, IADD, ISUB, BRANCH, SHL, SHR)
                handles computation.</p>
                <div class="intro-example">LOAD CR0, CR6, 4    ; capability load from c-list
TPERM CR0, XL       ; permission check (execute + load)
CALL CR0, 0xF       ; direct mode — CR0 is the E-GT</div>
                <p>ARM-style condition codes on every instruction. The F-bit auto-set on Outform GTs prevents
                the confused deputy problem.${tier === 'ib' ? ' This maps directly to IB CS topics: machine architecture, instruction sets, and security models.' : ''}</p>
            `;
        }
    } else if (lang === 'javascript') {
        if (tier === 'early' || tier === 'elementary') {
            adapted.body = `
                <p>${greeting}This is <span class="intro-highlight">CLOOMC++</span> -- a language that looks a lot
                like regular programming! You write code with curly braces and the Church Machine runs it.</p>
                <div class="intro-example">abstraction Hello {
    capabilities { }
    method Greet(who) {
        result = who + 1
        return(result)
    }
}</div>
                <p>An <span class="intro-highlight">abstraction</span> is like a little program with its own rules.
                Methods are the things it can do -- like greeting someone!</p>
            `;
        } else if (tier === 'advanced' || tier === 'ib') {
            adapted.body = `
                <p>${greeting}${base.body}
                <p>The CLOOMC++ compiler proves the Church Machine is a universal target -- the same 20-instruction ISA
                accepts programs from JavaScript, Haskell, and Symbolic Math front-ends. Variables map to DR0-DR15,
                multiply/divide compile to IADD/ISUB loops.${tier === 'ib' ? ' Relevant to IB CS: compilers, abstraction layers, and universal computation.' : ''}</p>
            `;
        } else {
            adapted.body = `<p>${greeting}${base.body}`;
        }
    } else if (lang === 'haskell') {
        if (tier === 'early' || tier === 'elementary') {
            adapted.body = `
                <p>${greeting}This is <span class="intro-highlight">Haskell</span> -- a language based on math!
                Instead of telling the computer what to do step by step, you describe what things are.</p>
                <div class="intro-example">method add(a, b) = a + b
method isZero(n) = if n == 0 then 1 else 0</div>
                <p>It looks like math equations! The Church Machine turns these into the same instructions
                as the other languages.</p>
            `;
        } else if (tier === 'advanced' || tier === 'ib') {
            adapted.body = `
                <p>${greeting}The Haskell front-end demonstrates that lambda calculus compiles to the Church Machine's
                20-instruction set -- pattern matching becomes MCMP+BRANCH chains, pairs use BFINS/BFEXT packing,
                and let-bindings map to register allocation.</p>
                <div class="intro-example">method factorial(n) = case n of 0 -> 1, _ -> n * (n - 1)
method swap(p) = (snd p, fst p)</div>
                <p>Named after Alonzo Church, this front-end connects his lambda calculus to silicon.${tier === 'ib' ? ' This relates to IB CS abstract data structures, recursion, and computational thinking.' : ''}</p>
            `;
        } else {
            adapted.body = `<p>${greeting}${base.body}`;
        }
    }

    if (!adapted.body) adapted.body = `<p>${greeting}${base.body}`;
    return adapted;
}

function confirmSaveToNamespace() {
    const slotSel = document.getElementById('saveNSSlot');
    const label = document.getElementById('saveNSLabel').value.trim();
    if (!label) {
        alert('Please enter a label for this namespace entry.');
        return;
    }
    const perms = {
        R: document.getElementById('permR').checked ? 1 : 0,
        W: document.getElementById('permW').checked ? 1 : 0,
        X: document.getElementById('permX').checked ? 1 : 0,
        L: document.getElementById('permL').checked ? 1 : 0,
        S: document.getElementById('permS').checked ? 1 : 0,
        E: document.getElementById('permE').checked ? 1 : 0,
    };
    const gtType = parseInt(document.getElementById('saveNSType').value) || 0;
    let idx;
    if (slotSel.value === 'new') {
        idx = sim.saveToNamespace(label, lastAssembledWords, perms, gtType);
    } else {
        idx = parseInt(slotSel.value);
        sim.saveToNamespaceAt(idx, label, lastAssembledWords, perms, gtType);
    }
    closeSaveDialog();
    saveNamespaceState();
    const con = document.getElementById('editorConsole');
    if (con) {
        con.textContent += `\nSaved ${lastAssembledWords.length} words to namespace[${idx}] "${label}" (${lastAssembledWords.length * 4} bytes)`;
        con.scrollTop = con.scrollHeight;
    }
    updateDashboard();
}

function exportEntryMemory(idx) {
    const data = sim.getEntryMemory(idx);
    if (!data) return;
    const entry = sim.readNSEntry(idx);
    const hexWords = data.words.map(w => '0x' + (w >>> 0).toString(16).padStart(8, '0'));
    let permObj = {};
    if (data.gt) {
        const sp = sim.parseGT(data.gt).permissions;
        permObj = { B: sp.B?1:0, R: sp.R?1:0, W: sp.W?1:0, X: sp.X?1:0, L: sp.L?1:0, S: sp.S?1:0, E: sp.E?1:0 };
    }
    const typeNames = ['NULL','Inform','Outform','Abstract'];
    const exportObj = {
        label: data.label,
        index: idx,
        location: '0x' + data.location.toString(16).toUpperCase().padStart(8, '0'),
        gt: '0x' + (data.gt >>> 0).toString(16).toUpperCase().padStart(8, '0'),
        gtType: typeNames[entry ? entry.gtType : 0] || 'NULL',
        codeLength: data.codeLength,
        permissions: permObj,
        code: hexWords,
        entry: entry,
    };
    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.label || 'entry_' + idx}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function exportAllNamespace() {
    const entries = [];
    for (let i = 0; i < sim.nsCount; i++) {
        const e = sim.readNSEntry(i);
        if (!e) continue;
        const mem = sim.getEntryMemory(i);
        const hexWords = mem ? mem.words.map(w => '0x' + (w >>> 0).toString(16).padStart(8, '0')) : [];
        entries.push({
            index: i,
            label: e.label,
            gt: mem ? '0x' + (mem.gt >>> 0).toString(16).padStart(8, '0') : '0x00000000',
            codeLength: mem ? mem.codeLength : 0,
            code: hexWords,
            entry: e,
        });
    }
    const blob = new Blob([JSON.stringify({ namespace: entries }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'church_namespace.json';
    a.click();
    URL.revokeObjectURL(url);
}

let importTargetIdx = null;

function importEntryMemory(idx) {
    importTargetIdx = idx;
    document.getElementById('nsImportFile').click();
}

function importNamespaceFile() {
    importTargetIdx = null;
    document.getElementById('nsImportFile').click();
}

function parseCodeWords(codeArr) {
    if (!Array.isArray(codeArr)) return [];
    return codeArr.map(w => {
        if (typeof w === 'string') return parseInt(w, 16) >>> 0;
        return w >>> 0;
    });
}

function handleNSImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (importTargetIdx !== null) {
                const words = parseCodeWords(data.code || data.words || []);
                if (words.length > 0) {
                    sim.setEntryMemory(importTargetIdx, words);
                    if (data.label) {
                        sim.nsLabels[importTargetIdx] = data.label;
                    }
                }
                importTargetIdx = null;
            } else if (data.namespace && Array.isArray(data.namespace)) {
                for (const item of data.namespace) {
                    const words = parseCodeWords(item.code || item.words || []);
                    if (words.length > 0) {
                        const idx = item.index !== undefined ? item.index : sim.nsCount;
                        const loc = idx * sim.SLOT_SIZE;
                        const lim17 = Math.min(words.length - 1, 0x1FFFF);
                        const gtType = (item.entry && item.entry.gtType) || 0;
                        const chainable = (item.entry && item.entry.chainable) ? 1 : 0;
                        sim.writeNSEntry(idx, loc, lim17, 0, 0, 0, chainable, gtType, 0);
                        sim.nsLabels[idx] = item.label || (item.entry && item.entry.label) || `import_${idx}`;
                        for (let j = 0; j < words.length; j++) {
                            sim.memory[loc + j] = words[j] >>> 0;
                        }
                    }
                }
            } else if (data.label) {
                const words = parseCodeWords(data.code || data.words || []);
                const idx = sim.nsCount;
                const loc = idx * sim.SLOT_SIZE;
                const lim17 = Math.min(Math.max(words.length - 1, 0), 0x1FFFF);
                const gtType = (data.entry && data.entry.gtType) || 0;
                const chainable = (data.entry && data.entry.chainable) ? 1 : 0;
                sim.writeNSEntry(idx, loc, lim17, 0, 0, 0, chainable, gtType, 0);
                sim.nsLabels[idx] = data.label;
                for (let j = 0; j < words.length; j++) {
                    sim.memory[loc + j] = words[j] >>> 0;
                }
            }
            saveNamespaceState();
            updateDashboard();
            updateNamespace();
        } catch (err) {
            alert('Failed to import: ' + err.message);
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

function saveNamespaceState() {
    const entries = [];
    for (let i = 0; i < sim.nsCount; i++) {
        const e = sim.readNSEntry(i);
        if (!e) { entries.push(null); continue; }
        const mem = sim.getEntryMemory(i);
        const base = sim.NS_TABLE_BASE + i * sim.NS_ENTRY_WORDS;
        entries.push({
            nsWords: [sim.memory[base], sim.memory[base + 1], sim.memory[base + 2]],
            label: e.label,
            dataWords: mem ? [mem.gt, ...mem.words] : [],
        });
    }
    localStorage.setItem('church_namespace', JSON.stringify(entries));
}

function loadNamespaceState() {
    const saved = localStorage.getItem('church_namespace');
    if (!saved) return;
    try {
        const entries = JSON.parse(saved);
        for (let i = 0; i < entries.length; i++) {
            const item = entries[i];
            if (!item) continue;
            if (sim.isNSEntryValid(i)) continue;
            if (item.nsWords && item.nsWords.length === 3) {
                const base = sim.NS_TABLE_BASE + i * sim.NS_ENTRY_WORDS;
                sim.memory[base + 0] = item.nsWords[0] >>> 0;
                sim.memory[base + 1] = item.nsWords[1] >>> 0;
                sim.memory[base + 2] = item.nsWords[2] >>> 0;
                if (i >= sim.nsCount) sim.nsCount = i + 1;
                if (item.label) sim.nsLabels[i] = item.label;
                if (item.dataWords && item.dataWords.length > 0) {
                    const loc = item.nsWords[0] >>> 0;
                    for (let j = 0; j < item.dataWords.length; j++) {
                        sim.memory[loc + j] = item.dataWords[j] >>> 0;
                    }
                }
            } else if (item.entry) {
                const loc = item.entry.word0_location || (i * sim.SLOT_SIZE);
                const lim = sim.parseNSWord1(item.entry.word1_limit || 0);
                sim.writeNSEntry(i, loc, lim.limit, lim.b, lim.f, item.entry.gBit || 0, item.entry.chainable ? 1 : 0, item.entry.gtType || 0, 0);
                sim.nsLabels[i] = item.entry.label || '';
                if (item.words && item.words.length > 0) {
                    for (let j = 0; j < item.words.length; j++) {
                        sim.memory[loc + j] = item.words[j] >>> 0;
                    }
                }
            }
        }
    } catch (e) {}
}

function downloadHardwareImage() {
    if (!requirePermission('deploy', 'Deploy to Tang')) return;
    const image = sim.exportHardwareImage();
    const NS_WORDS = 192;
    const CLIST_WORDS = 64;
    const totalWords = NS_WORDS + CLIST_WORDS;

    const buffer = new ArrayBuffer(4 + totalWords * 4);
    const view = new DataView(buffer);

    view.setUint32(0, totalWords, true);

    for (let i = 0; i < NS_WORDS; i++) {
        const w = i < image.namespace.length ? image.namespace[i] : 0;
        view.setUint32(4 + i * 4, w >>> 0, true);
    }

    for (let i = 0; i < CLIST_WORDS; i++) {
        const w = i < image.clist.length ? image.clist[i] : 0;
        view.setUint32(4 + (NS_WORDS + i) * 4, w >>> 0, true);
    }

    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'church_image.bin';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    const con = document.getElementById('editorConsole');
    if (con) {
        con.textContent = `Downloaded church_image.bin (${4 + totalWords * 4} bytes)\n`;
        con.textContent += `  Namespace: ${image.namespace.length} words\n`;
        con.textContent += `  C-list: ${image.clist.length} words\n\n`;
        con.textContent += `To upload to ${getBoardLabel(getSelectedBoard())}, use the Deploy to FPGA button or WebSerial.\n`;
    }
}

async function buildFPGAOnly() {
    if (!requirePermission('deploy', 'Deploy to Tang')) return;
    const board = getSelectedBoard();
    const boardLabel = getBoardLabel(board);
    const isTi60 = (board === 'ti60-f225');

    const hwBtn = document.getElementById('btnHWBuild');
    const dlBtn = document.getElementById('btnFPGAPkg');
    if (hwBtn) { hwBtn.disabled = true; hwBtn.innerHTML = '<span class="spinner"></span> Building...'; }
    if (dlBtn) dlBtn.disabled = true;

    switchView('builder');
    switchBuilderViewTab('buildlog');

    const ts = new Date().toLocaleTimeString();
    _buildLogSet(`[${ts}] Building FPGA RTL for ${boardLabel}...\nRunning Amaranth elaboration + Yosys synthesis (typically 20–60 s).\n`);
    _setBuildStatus('running', `Building ${boardLabel}…`, boardLabel);
    document.getElementById('buildFileList').innerHTML = '<div class="build-file-empty">Building…</div>';
    document.getElementById('buildNextSteps').innerHTML = '<div class="build-file-empty">Waiting for build…</div>';

    try {
        const resp = await fetch(`/api/build/fpga?board=${encodeURIComponent(board)}`);
        const data = await resp.json();
        if (!resp.ok || data.error) {
            const msg = data.error || `Server returned ${resp.status}`;
            _buildLogAppend('\nFailed: ' + msg + (data.stderr ? '\n\n--- stderr ---\n' + data.stderr : '') + '\n');
            _setBuildStatus('error', 'Build failed — see log', boardLabel);
            return;
        }
        const doneTs = new Date().toLocaleTimeString();
        _buildLogAppend(`\n[${doneTs}] Build complete. Files saved on server:\n`);
        (data.file_paths || data.files || []).forEach(f => { _buildLogAppend(`  ✓ ${f}\n`); });
        _buildLogAppend('\nClick "Download FPGA Package" to download the ZIP.\n');
        _setBuildStatus('ok', `Build succeeded — ${boardLabel}`, boardLabel);
        _renderBuildFiles(data.files || [], isTi60);
        _renderBuildNextSteps(isTi60);
        if (dlBtn) dlBtn.disabled = false;
    } catch (e) {
        _buildLogAppend('\nError: ' + e.message + '\n');
        _setBuildStatus('error', 'Build error — see log', boardLabel);
    } finally {
        if (hwBtn) { hwBtn.disabled = false; hwBtn.textContent = 'Build'; }
    }
}

async function downloadFPGAPackage() {
    if (!requirePermission('deploy', 'Deploy to Tang')) return;
    const board = getSelectedBoard();
    const boardLabel = getBoardLabel(board);
    const isTi60 = (board === 'ti60-f225');
    const zipName = isTi60 ? 'church-ti60-package.zip' : 'church-nano-package.zip';

    const btn = document.getElementById('btnFPGAPkg');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Downloading...'; }

    switchView('builder');
    switchBuilderViewTab('buildlog');
    const ts = new Date().toLocaleTimeString();
    _buildLogAppend(`\n[${ts}] Downloading FPGA package for ${boardLabel}...\n`);

    try {
        const resp = await fetch(`/api/download/fpga-zip?board=${encodeURIComponent(board)}`);
        if (!resp.ok) {
            let errMsg = `Server returned ${resp.status}`;
            try {
                const errData = await resp.json();
                errMsg = errData.error || errMsg;
            } catch (_) {}
            _buildLogAppend('\nFailed: ' + errMsg + '\n');
            if (errMsg.includes('No build found')) {
                _buildLogAppend('Run "Build" first to synthesise the RTL.\n');
            }
            return;
        }
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = zipName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        const doneTs = new Date().toLocaleTimeString();
        _buildLogAppend(`[${doneTs}] Downloaded ${zipName} (${(blob.size / 1024).toFixed(0)} KB)\n`);
        _buildLogAppend('\nPackage contents:\n');
        if (isTi60) {
            _buildLogAppend('  church_ti60_f225.v    — Synthesisable Verilog\n');
            _buildLogAppend('  church_ti60_f225.edif — Yosys EDIF netlist (synth_efinix)\n');
            _buildLogAppend('  ti60_f225.isf         — Pin constraints (Efinity IDE)\n');
            _buildLogAppend('  BUILD.md              — Instructions\n');
        } else {
            _buildLogAppend('  church_tang_nano_20k.v    — Synthesisable Verilog\n');
            _buildLogAppend('  church_tang_nano_20k.json — Yosys netlist\n');
            _buildLogAppend('  tang_nano_20k.cst         — Pin constraints\n');
            _buildLogAppend('  Makefile                  — Build targets\n');
            _buildLogAppend('  BUILD.md                  — Instructions\n');
        }
    } catch (e) {
        _buildLogAppend('\nError: ' + e.message + '\n');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Download FPGA Package'; }
    }
}

async function uploadToTang() {
    if (!requirePermission('deploy', 'Deploy to Tang')) return;
    switchView('editor');
    switchCodeTab('console');
    const con = document.getElementById('editorConsole');
    if (!con) return;

    const board = getSelectedBoard();
    const boardLabel = getBoardLabel(board);
    const isTi60Board = board === 'ti60-f225';

    if (typeof TangSerial === 'undefined') {
        con.textContent = 'Error: WebSerial module not loaded (webserial.js missing)';
        return;
    }

    // Ti60 note: the firmware has no UART RX upload handler.
    // The namespace is baked into the bitstream at synthesis time.
    // UART TX (H14) sends the startup banner; the board is programmed via Efinity JTAG.
    if (isTi60Board) {
        con.textContent =
            'Ti60 F225 — UART namespace upload is not yet supported in firmware.\n\n' +
            'The namespace is baked into the bitstream at build time.\n' +
            'Use Efinity IDE to program the board via JTAG after building the package.\n\n' +
            'HOW TO CONFIRM YOUR BOARD IS RUNNING:\n' +
            '  LEDs after JTAG flash + power-on:\n' +
            '    Boot in progress  →  LED0 on (steady)\n' +
            '    Boot complete     →  LED0→1→2→3→off walking pattern (0.5 s each)\n' +
            '    CPU in free-run   →  LED1 has 1 Hz heartbeat blink\n' +
            '    Fault             →  LED2 stays on\n\n' +
            '  UART TX (pin H14, 115200 8N1) sends  CHURCH Ti60 v1.0  on startup.\n' +
            '  (Requires an external USB-UART adapter — the Ti60 FT4232H is JTAG-only.)\n\n' +
            'WORKFLOW:\n' +
            '  1. Build FPGA Package  →  downloads the Efinity project zip\n' +
            '  2. Open zip in Efinity IDE  →  synthesise + place-and-route\n' +
            '  3. Programme via Efinity Programmer (JTAG)\n' +
            '  4. Watch LEDs — walking pattern confirms successful boot\n';
        return;
    }

    TangSerial.setBoardLabel(boardLabel);

    if (!TangSerial.isSupported()) {
        con.textContent = `WebSerial is not supported in this browser.\nUse Chrome or Edge to deploy to ${boardLabel}.`;
        return;
    }

    function isPermissionsPolicyError(e) {
        const m = (e.message || '').toLowerCase();
        return m.includes('permissions policy') || m.includes('disallowed') || e.name === 'SecurityError';
    }

    function directUrl() {
        return window.location.origin + '/simulator/';
    }

    try {
        const image = sim.exportHardwareImage();
        con.textContent = `Ready: ${image.namespace.length} NS words + ${image.clist.length} C-list words\n\n`;

        if (!TangSerial.isConnected()) {
            con.textContent += 'Select the FPGA UART port when prompted...\n';
            con.textContent += `(Choose the ${boardLabel} serial port)\n\n`;
            try {
                await TangSerial.connect();
            } catch(e) {
                if (e.name === 'NotFoundError') {
                    con.textContent += 'No port selected. Cancelled.\n';
                    return;
                }
                if (isPermissionsPolicyError(e)) {
                    con.textContent = 'WebSerial blocked: the app is running inside an embedded preview frame\n';
                    con.textContent += 'that does not allow hardware access.\n\n';
                    con.textContent += 'SOLUTION: Open the app directly in a browser tab:\n\n';
                    con.textContent += '  ' + directUrl() + '\n\n';
                    con.textContent += `Then click "Deploy to FPGA" from that tab. Chrome or Edge required.\n`;
                    return;
                }
                con.textContent += e.message + '\n\n';
                con.textContent += `Check that the ${boardLabel} is connected via USB and no other app (e.g. Efinity IDE serial terminal) has the port open, then try again.\n`;
                return;
            }
        }

        con.textContent += 'Port connected. Sending data...\n';

        const result = await TangSerial.uploadToFPGA(
            image.namespace,
            image.clist,
            function(msg) {
                con.textContent += msg + '\n';
            }
        );

        if (result.success) {
            con.textContent += '\nUpload complete. Decoding FPGA readback...\n';
            const rb = TangSerial.parseReadback(result.rawBytes);
            const hex = w => '0x' + w.toString(16).toUpperCase().padStart(8, '0');
            const dec = w => w.toString(10).padStart(10, ' ');

            con.textContent += '─'.repeat(56) + '\n';

            if (rb.headerEcho !== null) {
                const ok = rb.headerEcho === 256 ? ' ✓' : ' ✗ (expected 256)';
                con.textContent += `  Header echo: ${rb.headerEcho} words${ok}\n`;
            }

            if (rb.words.length < 2) {
                con.textContent += `  ${rb.vals.length} value bytes (${rb.words.length} complete words) — too short for register decode.\n`;
                con.textContent += `  Raw values: ${rb.vals.slice(0, 64).map(b => b.toString(16).padStart(2,'0')).join(' ')}\n`;
            } else {
                if (rb.crs.length > 0) {
                    con.textContent += '\n  Context Registers:\n';
                    for (let i = 0; i < rb.crs.length; i++) {
                        const priv = i >= 12 ? ' [priv]' : '';
                        const label = ('CR' + i).padEnd(4);
                        con.textContent += `    ${label}  ${hex(rb.crs[i])}  ${dec(rb.crs[i])}${priv}\n`;
                    }
                }
                if (rb.drs.length > 0) {
                    con.textContent += '\n  Data Registers:\n';
                    for (let i = 0; i < rb.drs.length; i++) {
                        const label = ('DR' + i).padEnd(4);
                        con.textContent += `    ${label}  ${hex(rb.drs[i])}  ${dec(rb.drs[i])}\n`;
                    }
                }
                if (rb.extra.length > 0) {
                    con.textContent += `\n  Additional words: ${rb.extra.length}`;
                    con.textContent += ` (${rb.vals.length} value bytes total, ${rb.leftover} leftover)\n`;
                }
            }

            con.textContent += '─'.repeat(56) + '\n';

            sim.ledBits = 0b111111;
            sim.ledMode = 'boot';
            sim.bootComplete = true;
            updateLedStrip();

        } else {
            con.textContent += '\nNo response from FPGA after sending data.\n\n';
            con.textContent += 'TIPS:\n';
            con.textContent += `  1. Press the RESET button on the ${boardLabel}\n`;
            con.textContent += '  2. Click "Deploy to FPGA" within 1-2 seconds of releasing reset\n';
            con.textContent += '  3. Make sure no other app has the serial port open\n';
        }

        try {
            await TangSerial.disconnect();
            con.textContent += 'Port closed.\n';
        } catch(e) {}

    } catch(e) {
        con.textContent += 'Error: ' + e.message + '\n';
        try { await TangSerial.disconnect(); } catch(_) {}
    }
}

const INSTRUCTION_DATA = [
    {
        opcode: 0, mnemonic: 'LOAD', domain: 'church',
        syntax: 'LOAD CRd, CRs, offset',
        brief: 'Load a Golden Token from a C-List into a context register',
        encoding: 'opcode[5]=00000 | cond[4] | CRd[4] | CRs[4] | offset[15]',
        fields: [
            { name: 'CRd',    desc: 'Destination context register (CR0-CR15)' },
            { name: 'CRs',    desc: 'C-List — the capability list to read from (word-addressed)' },
            { name: 'offset', desc: 'Word address offset within the C-List (0–32767)' },
        ],
        permission: 'L (Load) — checked by mLoad on the GT at CRs + offset',
        flags: 'None',
        details:
            '  31    27│26   23│22   19│18   15│14                0\n'
          + '  ┌──────┬──────┬──────┬──────┬───────────────────┐\n'
          + '  │00000 │ cond │  CRd │  CRs │      offset       │\n'
          + '  └──────┴──────┴──────┴──────┴───────────────────┘\n'
          + '   5-bit   4-bit   4-bit   4-bit       15-bit\n\n'
          + 'CRs is the C-List (capability list), word-addressed.\n'
          + 'offset is the word address within the C-List.\n'
          + 'mLoad fetches the GT at CRs + offset, validates version\n'
          + 'and seal, then copies it into CRd.',
        example: 'LOAD CR0, CR6, 7    ; Load word 7 of C-List CR6 into CR0',
    },
    {
        opcode: 1, mnemonic: 'SAVE', domain: 'church',
        syntax: 'SAVE CRd, CRs, offset',
        brief: 'Save a Golden Token into a C-List (capability list)',
        encoding: 'opcode[5]=00001 | cond[4] | CRd[4] | CRs[4] | offset[15]',
        fields: [
            { name: 'CRd',    desc: 'C-List — the capability list to save into (S permission required, word-addressed)' },
            { name: 'CRs',    desc: 'Source GT (must have B=1 — Bind bit set)' },
            { name: 'offset', desc: 'Word address within the C-List at CRd (0–32767)' },
        ],
        permission: 'S on CRd (C-List); B=1 on CRs (source GT) — mSave validates all',
        flags: 'None',
        details:
            '  31    27│26   23│22   19│18   15│14                0\n'
          + '  ┌──────┬──────┬──────┬──────┬───────────────────┐\n'
          + '  │00001 │ cond │  CRd │  CRs │      offset       │\n'
          + '  └──────┴──────┴──────┴──────┴───────────────────┘\n'
          + '   5-bit   4-bit   4-bit   4-bit       15-bit\n\n'
          + 'CRd    = the C-List (capability list), word-addressed.\n'
          + 'CRs    = the source GT to save (B=1 — Bind bit — must be set).\n'
          + 'offset = word address within the C-List at CRd.\n\n'
          + 'mSave writes the GT from CRs into the C-List at CRd + offset.\n'
          + 'mSave validates: S permission on CRd, B=1 on CRs, version, seal,\n'
          + 'and bounds. B=1 is the delegation gate: a callee cannot propagate\n'
          + 'GTs it was only passed for use.',
        example: 'SAVE CR6, CR1, 20   ; Save CR1 (B=1) into word 20 of C-List CR6',
    },
    {
        opcode: 2, mnemonic: 'CALL', domain: 'church',
        syntax: 'CALL CRs, offset',
        brief: 'Enter an abstraction — fetch E-GT via C-List or directly from CRs, set up CR6/CR14, push context',
        encoding: 'opcode[5]=00010 | cond[4] | CRs[4] | offset[4] | 0[15]',
        fields: [
            { name: 'CRs',    desc: 'Source: C-List (L permission — mLoad fetches E-GT at CRs[offset]) or direct E-GT (E permission — offset must be 0xF)' },
            { name: 'offset', desc: '4-bit index into the C-List (0–14, C-List mode). All-1s (0xF = 15) selects direct mode: CRs itself is the E-GT.' },
        ],
        permission: 'L on CRs (C-List mode) or E on CRs (direct mode, offset=0xF)',
        flags: 'None',
        details:
            '  31    27│26   23│22   19│18   15│14                0\n'
          + '  ┌──────┬──────┬──────┬──────┬───────────────────┐\n'
          + '  │00010 │ cond │  CRs │offset│         0         │\n'
          + '  └──────┴──────┴──────┴──────┴───────────────────┘\n'
          + '   5-bit   4-bit   4-bit  4-bit       15-bit\n\n'
          + 'CRs field identifies the source register (always a caller-specified CRn).\n'
          + 'CRd is implicit and always CR6 — CALL hardcodes CR6 as the callee c-list output.\n\n'
          + 'C-List mode (offset 0–14, L on CRs):\n'
          + '  mLoad fetches the E-GT stored at CRs[offset] from the C-List.\n\n'
          + 'Direct mode (offset = 0xF = all-1s, E on CRs):\n'
          + '  CRs itself is the E-GT — no C-List lookup. offset = 0xF is the sentinel.\n\n'
          + 'Each abstraction occupies one shared GT (one slot). The slot layout is:\n'
          + '  [ code | · · · free space · · · | c-list ]\n'
          + '    ↑ base                          ↑ limit\n\n'
          + 'Code starts at the slot base address; the C-List is packed at the top\n'
          + '(limit). mLoad reads the same slot metadata to derive both registers:\n'
          + '  CR14 (code):   base = slot base address, limit = code size  [privileged]\n'
          + '  CR6  (c-list): base = slot limit − GTcount  [implicit CRd, always CR6]\n\n'
          + 'CALL pushes exactly 2 words onto the LIFO stack (region of thread lump addressed by CR12 + STO):\n'
          + '  Word 0: caller\'s E-GT — RETURN revalidates it to re-derive CR6 and CR14.\n'
          + '  Word 1: frame word — 32-bit packed word:\n'
          + '    31  28 │ 27      13 │ 12  │ 11       0\n'
          + '    ┌──────┬───────────┬─────┬────────────┐\n'
          + '    │FLAGS │  PC[14:0] │ SZ  │  STO[11:0] │\n'
          + '    └──────┴───────────┴─────┴────────────┘\n'
          + '    FLAGS: N Z C V condition codes at call site.\n'
          + '    PC:    15-bit return address (offset into caller\'s code, 0–32767).\n'
          + '    SZ:    1 = 2-word CALL frame (distinguishes from 1-word LAMBDA frame).\n'
          + '    STO:   saved stack-top-offset hidden register (0–4095 words from stack base).\n\n'
          + 'Hidden register STO is updated to (savedSTO + 2) after the push.\n'
          + 'No DRs and no capability registers are pushed; callee inherits them.\n'
          + 'B bit is cleared on every passed GT (hardware "use it, don\'t keep it").\n'
          + 'PC is set to 0. RETURN (with a MASK literal) is the only exit.',
        example: 'CALL CR6, 3          ; C-List mode: fetch E-GT at offset 3 from C-List in CR6\n'
               + 'CALL CR2, 0xF        ; Direct mode: CR2 is the E-GT (offset=0xF sentinel)',
    },
    {
        opcode: 3, mnemonic: 'RETURN', domain: 'church',
        syntax: 'RETURN [mask]',
        brief: 'Exit an abstraction \u2014 restore caller context; optionally scrub working CRs',
        encoding: 'opcode[5]=00011 | cond[4] | 0[11] | mask[12]',
        fields: [
            { name: 'mask', desc: '12-bit literal (bits [11:0]). Bit N = 1 clears CR_N to NULL after frame restoration. Bit 6 reserved (must be 0 — CR6 is always restored from the frame E-GT). mask=0 is the no-op default (bare RETURN).' },
        ],
        permission: 'None',
        flags: 'None',
        details:
            '  31    27│26   23│22          12│11          0\n'
          + '  ┌──────┬──────┬─────────────┬─────────────┐\n'
          + '  │00011 │ cond │      0      │    mask     │\n'
          + '  └──────┴──────┴─────────────┴─────────────┘\n'
          + '   5-bit   4-bit    11-bit        12-bit\n\n'
          + 'mask[11:0]: 12-bit literal embedded in the instruction.\n'
          + '  Bit N = 1 → clear CR_N to NULL after frame restoration.\n'
          + '  Bit 6 reserved (must be 0): CR6 is always restored from the frame E-GT.\n'
          + '  mask = 0 → no clearing; bare RETURN is fully backward-compatible.\n\n'
          + 'Execution order:\n'
          + '  1. Read frame word at top of LIFO stack; check SZ bit.\n'
          + '     SZ=1 (CALL frame): pop 2 words (E-GT word 0 + frame word 1).\n'
          + '     SZ=0 (LAMBDA frame): pop 1 word (frame word only).\n'
          + '  2. Restore FLAGS, PC, and STO from the frame word fields.\n'
          + '     Hidden STO register ← frame[11:0] (the saved pre-call STO value).\n'
          + '  3. SZ=1 only: revalidate caller E-GT (word 0) via mLoad — FAULT on failure.\n'
          + '     NS split re-runs to re-derive CR6 (c-list) and CR14 (code) for caller.\n'
          + '  4. Apply mask: all marked CRs written to NULL in one parallel clock edge.\n'
          + '     The 12-bit literal fans directly into CR write enables — zero overhead.\n\n'
          + 'Why mask is in the instruction (not the frame):\n'
          + '  GTs are first-class. The callee may return a GT in CR0.\n'
          + '  Only the programmer knows which CRs carry return values vs. working state.\n'
          + '  The CLOOMC compiler emits the mask as a compile-time literal from a\n'
          + '  "clear:" annotation. The hardware enforces it as part of the instruction.\n'
          + '  The freed 12 bits in the frame word are used for STO instead.\n\n'
          + 'DRs and non-masked CRs retain whatever values the callee left.\n'
          + 'Shared between Church and Turing domains — the only exit from a safe\n'
          + 'Turing abstraction. If the call stack is empty, the machine halts.',
        example: 'RETURN                   ; mask=0 — no scrub, backward-compatible\n'
               + 'RETURN 0b111111011111    ; clear CR0–CR5, CR7–CR11 — scrub all working regs\n'
               + 'RETURN 0b000000011110    ; clear CR1–CR4 only — CR0 carries a return GT',
    },
    {
        opcode: 4, mnemonic: 'CHANGE', domain: 'church',
        syntax: 'CHANGE CRd, idx',
        brief: 'Suspend current thread \u2014 activate the Thread Abstraction at c-list offset idx in CRd',
        encoding: 'opcode[5]=00100 | cond[4] | CRd[4] | 0[4] | idx[15]',
        fields: [
            { name: 'CRd', desc: 'C-list register (typically CR6) \u2014 provides the capability list to index into' },
            { name: 'idx', desc: 'C-list offset (0\u201332767) \u2014 selects the slot in CRd\u2019s c-list that holds the Thread Abstraction GT' },
        ],
        permission: 'Thread Abstraction GT at CRd[idx] must be valid (E permission)',
        flags: 'None',
        details:
            '  31    27│26   23│22   19│18   15│14                0\n'
          + '  ┌──────┬──────┬──────┬──────┬───────────────────┐\n'
          + '  │00100 │ cond │  CRd │  ─   │       idx         │\n'
          + '  └──────┴──────┴──────┴──────┴───────────────────┘\n'
          + '   5-bit   4-bit   4-bit  zero       15-bit\n\n'
          + 'CRd = c-list register (typically CR6, the current c-list).\n'
          + 'idx = offset within that c-list pointing to the Thread Abstraction GT.\n\n'
          + 'Thread Abstraction — definition:\n'
          + '  The physical memory region owned by this namespace for a single thread.\n'
          + '  Layout (addresses increase downward from word 0):\n'
          + '    Top:    CLOOMC initialisation code — provided by the IDE at slot creation\n'
          + '    Bottom: Namespace table — pre-formatted by the IDE at slot creation\n'
          + '  The IDE fills both regions when it mints the Thread Abstraction slot;\n'
          + '  the running program sees only the live GT zone, stack, heap, and DRs.\n\n'
          + 'Execution (atomic \u2014 no intermediate state is visible):\n'
          + '  1. Index CRd at offset idx; verify the GT has E permission \u2014 FAULT on fail.\n'
          + '  2. Suspend outgoing thread: save per-thread state into its thread lump.\n'
          + '  3. Activate incoming thread: restore per-thread state from its thread lump.\n\n'
          + 'Per-thread registers saved and restored:\n'
          + '  CR0\u2013CR11  (programmer-accessible capability registers)\n'
          + '  CR12      (Thread Identity \u2014 privileged, per-thread)\n'
          + '  CR14      (code register \u2014 privileged, per-thread)\n'
          + '  CR15      (namespace root \u2014 privileged, per-thread)\n'
          + '  STO       (stack-top-offset hidden register \u2014 per-thread)\n'
          + '  DR0\u2013DR15, PC, flags\n\n'
          + 'System-wide register unchanged during CHANGE:\n'
          + '  CR13 (interrupt handler) \u2014 shared across all threads\n\n'
          + 'The suspended thread resumes exactly where it left off.',
        example: 'CHANGE CR6, 3        ; Activate Thread Abstraction at c-list offset 3 in CR6',
    },
    {
        opcode: 5, mnemonic: 'SWITCH', domain: 'church',
        syntax: 'SWITCH CRs, imm',
        brief: 'Switch namespace \u2014 reload CR15 with a new namespace root',
        encoding: 'opcode[5]=00101 | cond[4] | 0[4] | CRs[4] | idx[15]',
        fields: [
            { name: 'CRs', desc: 'GT pointing to the new namespace to switch to' },
            { name: 'imm', desc: 'Namespace control flags' },
        ],
        permission: 'CRs must point to a valid namespace',
        flags: 'None',
        details:
            '  31    27│26   23│22   19│18   15│14                0\n'
          + '  ┌──────┬──────┬──────┬──────┬───────────────────┐\n'
          + '  │00101 │ cond │  ─   │  CRs │      flags        │\n'
          + '  └──────┴──────┴──────┴──────┴───────────────────┘\n'
          + '   5-bit   4-bit  zero   4-bit       15-bit\n\n'
          + 'CRs   = GT pointing to the new namespace root.\n'
          + 'dst field is zero (unused).\n'
          + 'flags = namespace control flags (imm15).\n\n'
          + 'Atomically reloads CR15 (the namespace root register) with the new\n'
          + 'namespace. CR15 is the machine\'s view of the entire capability world —\n'
          + 'all LOADs, SAVEs, and CALLs resolve through it. The switch is the\n'
          + 'mechanism for domain isolation, sandboxing, and controlled transitions.',
        example: 'SWITCH CR3, 0        ; Switch namespace root (CR15) to namespace in CR3',
    },
    {
        opcode: 6, mnemonic: 'TPERM', domain: 'church',
        syntax: 'TPERM CRs, preset [, offset]  |  TPERM CRd, preset',
        brief: 'Two forms, one opcode: health-check (sets Z flag) or permission restriction (monotonic).',
        encoding: 'opcode[5]=00110 | cond[4] | reg[4] | preset[4] | offset[15]',
        fields: [
            { name: 'reg',    desc: 'CRs for health-check; CRd for restriction' },
            { name: 'preset', desc: '4-bit permission code (see table below)' },
            { name: 'offset', desc: 'Health-check: base+offset tested against limit (0\u201332766 valid). Restriction: 0x7FFF (all ones \u2014 sentinel that distinguishes restriction from health-check; never a valid bounds offset)' },
        ],
        permission: 'None \u2014 never traps',
        flags: 'Health-check: Z=1 all pass, Z=0 any fail. Restriction: Z=1 result non-zero.',
        details:
            '┌─ FORM 1: HEALTH CHECK ──────────────────────────────────────────┐\n'
          + '│  Assembly:  TPERM CRs, preset, offset                           │\n'
          + '│                                                                  │\n'
          + '│  31    27│26   23│22   19│18   15│14                0│          │\n'
          + '│  ┌──────┬──────┬──────┬──────┬───────────────────┐  │          │\n'
          + '│  │00110 │ cond │  CRs │preset│      offset       │  │          │\n'
          + '│  └──────┴──────┴──────┴──────┴───────────────────┘  │          │\n'
          + '│   op=6    4-bit   4-bit   4-bit       15-bit          │          │\n'
          + '│                                                                  │\n'
          + '│  Checks in one cycle:                                            │\n'
          + '│    1. Does CRs hold the preset permissions?                      │\n'
          + '│    2. Is the GT valid (version + MAC)?                           │\n'
          + '│    3. Is base + offset within the GT\'s limit?                   │\n'
          + '│  Result: Z=1 all pass  Z=0 any fail  Never traps.               │\n'
          + '└──────────────────────────────────────────────────────────────────┘\n\n'
          + '┌─ FORM 2: PERMISSION RESTRICTION ────────────────────────────────┐\n'
          + '│  Assembly:  TPERM CRd, preset                                   │\n'
          + '│                                                                  │\n'
          + '│  31    27│26   23│22   19│18   15│14                0│          │\n'
          + '│  ┌──────┬──────┬──────┬──────┬───────────────────┐  │          │\n'
          + '│  │00110 │ cond │  CRd │preset│      0x7FFF       │  │          │\n'
          + '│  └──────┴──────┴──────┴──────┴───────────────────┘  │          │\n'
          + '│   op=6    4-bit   4-bit   4-bit   0x7FFF (15-bit)     │          │\n'
          + '│                                                                  │\n'
          + '│  Sentinel: imm15=0x7FFF (all ones) marks restriction mode.      │\n'
          + '│  This frees the full 0\u201332766 range for health-check offsets,     │\n'
          + '│  including offset=0 (test the base address itself).             │\n'
          + '│  ANDs preset mask with CRd\'s current permissions (monotonic).   │\n'
          + '│  Local to the cached CR — not written to namespace until SAVE.  │\n'
          + '│  Z=1 if result is non-zero.                                     │\n'
          + '└──────────────────────────────────────────────────────────────────┘\n\n'
          + '┌─ PRESET TABLE ───────────────────────────────────────────────────┐\n'
          + '│  Turing domain (R,W,X):                                          │\n'
          + '│    0=CLEAR  1=R  2=RW  3=X  4=RX  5=RWX                         │\n'
          + '│  Church domain (L,S,E):                                          │\n'
          + '│    6=L  7=S  8=E  9=LS                                           │\n'
          + '│    10,11,12 = FAULT  (E+L, E+S, E+LS — E must be standalone)    │\n'
          + '│    13      = FAULT  (cross-domain mix)                           │\n'
          + '│  B-modifier (+0x10): RB  RWB  XB  EB  LSB                       │\n'
          + '│                                                                  │\n'
          + '│  Rule 1 — Domain purity: Turing and Church bits never combined.  │\n'
          + '│  Rule 2 — E isolation:   E must be standalone. E+L or E+S lets  │\n'
          + '│           a caller traverse the c-list AND enter the abstraction │\n'
          + '│           — an attack path into the nodal c-list.                │\n'
          + '└──────────────────────────────────────────────────────────────────┘',
        example:
            '; FORM 1 — health check with try-catch\n'
          + 'TPERM CR5, RW, 4       ; check R+W, valid, offset 4 in bounds\n'
          + 'readEQ  val, CR5, 4    ; happy path — fires only if Z=1\n'
          + 'IADDEQ  val, val, 1    ;\n'
          + 'writeEQ CR5, 4, val    ;\n'
          + 'returnEQ(val)          ; done — skipped if Z=0\n'
          + 'MOVNE   DR0, 0         ; catch — fires only if Z=0\n'
          + 'returnNE(DR0)          ; return error\n'
          + '\n'
          + '; FORM 2 — strip write before handing off\n'
          + 'TPERM CR0, RX          ; remove W, L, S, E — keep R and X only\n'
          + 'CALL  CR2              ; callee gets read+execute, nothing else\n'
          + '\n'
          + '; FORM 2 + B-modifier — allow callee to keep the GT\n'
          + 'TPERM CR1, EB          ; keep E, set B (Bind allows SAVE by callee)\n'
          + 'CALL  CR2              ; callee may save CR1 to its own c-list',
    },
    {
        opcode: 7, mnemonic: 'LAMBDA', domain: 'church',
        syntax: 'LAMBDA CRd | LAMBDA CRd, offset',
        brief: 'In-scope lambda reduction — immediate (CRd holds GT) or store (load from CRd[offset])',
        encoding: 'opcode[5]=00111 | cond[4] | CRd[4] | 0[4] | imm15[15]  (imm15=0x7FFF → immediate; else store)',
        fields: [
            { name: 'CRd', desc: 'Immediate: X-perm GT to apply. Store: C-List source (GT loaded into CRd)' },
            { name: 'imm15', desc: '0x7FFF (all ones) = immediate mode; 0–32766 = store-mode offset into CRd C-List' },
        ],
        permission: 'X (Execute in-scope) on the resolved GT in CRd',
        flags: 'None',
        details:
            'Two forms, same opcode — distinguished by bits[14:0]:\n\n'
          + 'Form 1 — Immediate (bits[14:0] = 0x7FFF, all ones):\n'
          + '  31    27│26   23│22   19│18   15│14                0\n'
          + '  ┌──────┬──────┬──────┬──────┬───────────────────┐\n'
          + '  │00111 │ cond │  CRd │  ─   │  111111111111111  │\n'
          + '  └──────┴──────┴──────┴──────┴───────────────────┘\n'
          + '   5-bit   4-bit   4-bit  zero  all ones (15-bit 0x7FFF)\n'
          + 'CRd already holds the X-perm GT — use it directly.\n\n'
          + 'Form 2 — Store (bits[14:0] = offset, 0–32766):\n'
          + '  31    27│26   23│22   19│18   15│14                0\n'
          + '  ┌──────┬──────┬──────┬──────┬───────────────────┐\n'
          + '  │00111 │ cond │  CRd │  ─   │      offset       │\n'
          + '  └──────┴──────┴──────┴──────┴───────────────────┘\n'
          + '   5-bit   4-bit   4-bit  zero       15-bit\n'
          + 'CRd is the C-List; the X GT is fetched from CRd[offset]\n'
          + 'into CRd (self-loading, single-register), then applied.\n'
          + 'Contrast: XLOADLAMBDA uses a separate CRs for the C-List.\n\n'
          + 'Both forms push a minimal 1-word frame (SZ=0) onto the LIFO\n'
          + 'stack (region of thread lump addressed by CR12 + STO):\n'
          + '  31  28 │ 27      13 │ 12  │ 11       0\n'
          + '  ┌──────┬───────────┬─────┬────────────┐\n'
          + '  │FLAGS │  PC[14:0] │  0  │  STO[11:0] │\n'
          + '  └──────┴───────────┴─────┴────────────┘\n'
          + 'SZ=0 tells RETURN this is a LAMBDA frame (1 word, no E-GT).\n'
          + 'Hidden STO is updated to (savedSTO + 1) after the slot reservation.\n'
          + 'RETURN (with its MASK literal) is required to exit the reduction.\n\n'
          + 'Leaf-lambda optimisation: the 1-word frame is NOT written to the\n'
          + 'thread lump stack buffer when LAMBDA executes. The write is deferred\n'
          + 'until a nested CALL or CHANGE occurs within the lambda body (the\n'
          + 'nested push lands at the new STO slot, requiring the prior LAMBDA\n'
          + 'frame to be in place). If RETURN is reached with no intervening CALL\n'
          + 'or CHANGE ("leaf lambda"), the frame word is never committed to\n'
          + 'memory — RETURN restores PC from an in-flight pipeline register and\n'
          + 'pops STO back. Only the STO reservation (STO ← savedSTO + 1) is\n'
          + 'unconditional. A leaf lambda therefore has zero memory traffic to\n'
          + 'the thread lump stack buffer.\n\n'
          + 'Code-fetch authority: PC is set to CRd.base on entry; instruction\n'
          + 'fetch for the lambda body is bounded by CRd.limit. CRd acts as the\n'
          + 'code-fetch authority for the duration of the reduction, analogous\n'
          + 'to CR14 in a CALL frame — but it is NOT derived from an NS-slot\n'
          + 'lookup. On RETURN (SZ=0), CR6 and CR14 are restored from the saved\n'
          + 'register snapshot, not re-derived from an E-GT.\n\n'
          + 'Used for fast-path lambda calculus operations: SUCC, ADD, MUL, etc.',
        example: 'LAMBDA CR0           ; Immediate — apply reduction via CR0\n'
               + 'LAMBDA CR6, 5        ; Store — load X GT from CR6[5] into CR6, then apply',
    },
    {
        opcode: 8, mnemonic: 'ELOADCALL', domain: 'church',
        syntax: 'ELOADCALL CRd, CRs, offset',
        brief: 'Fused LOAD + TPERM(E) + CALL in one instruction',
        encoding: 'opcode[5]=01000 | cond[4] | CRd[4] | CRs[4] | offset[15]',
        fields: [
            { name: 'CRd',    desc: 'Destination for loaded GT' },
            { name: 'CRs',    desc: 'C-List — the capability list (word-addressed)' },
            { name: 'offset', desc: 'Word address offset within the C-List (0–32767)' },
        ],
        permission: 'mLoad checks L on fetched GT, then E on loaded GT',
        flags: 'None',
        details:
            '  31    27│26   23│22   19│18   15│14                0\n'
          + '  ┌──────┬──────┬──────┬──────┬───────────────────┐\n'
          + '  │01000 │ cond │  CRd │  CRs │      offset       │\n'
          + '  └──────┴──────┴──────┴──────┴───────────────────┘\n'
          + '   5-bit   4-bit   4-bit   4-bit       15-bit\n\n'
          + 'CRd    = destination for the loaded GT.\n'
          + 'CRs    = the C-List (capability list), word-addressed.\n'
          + 'offset = word address within the C-List.\n\n'
          + 'Fused micro-op sequence in one cycle:\n'
          + '  1. LOAD  — fetch GT at CRs + offset via mLoad\n'
          + '  2. TPERM — verify E permission on the loaded GT\n'
          + '  3. CALL  — enter the abstraction\n'
          + 'Reduces the common 3-instruction entry sequence to a single word.',
        example: 'ELOADCALL CR0, CR6, 12  ; Load word 12 of C-List CR6, verify E, enter',
    },
    {
        opcode: 9, mnemonic: 'XLOADLAMBDA', domain: 'church',
        syntax: 'XLOADLAMBDA CRd, CRs, offset',
        brief: 'Fused LOAD + TPERM(X) + LAMBDA in one instruction',
        encoding: 'opcode[5]=01001 | cond[4] | CRd[4] | CRs[4] | offset[15]',
        fields: [
            { name: 'CRd',    desc: 'Destination for loaded GT' },
            { name: 'CRs',    desc: 'C-List — the capability list (word-addressed)' },
            { name: 'offset', desc: 'Word address offset within the C-List (0–32767)' },
        ],
        permission: 'mLoad checks L on fetched GT, then X on loaded GT',
        flags: 'None',
        details:
            '  31    27│26   23│22   19│18   15│14                0\n'
          + '  ┌──────┬──────┬──────┬──────┬───────────────────┐\n'
          + '  │01001 │ cond │  CRd │  CRs │      offset       │\n'
          + '  └──────┴──────┴──────┴──────┴───────────────────┘\n'
          + '   5-bit   4-bit   4-bit   4-bit       15-bit\n\n'
          + 'CRd    = destination for the loaded GT.\n'
          + 'CRs    = the C-List (capability list), word-addressed.\n'
          + 'offset = word address within the C-List.\n\n'
          + 'Fused micro-op sequence in one cycle:\n'
          + '  1. LOAD   — fetch GT at CRs + offset via mLoad\n'
          + '  2. TPERM  — verify X permission on the loaded GT\n'
          + '  3. LAMBDA — apply the reduction in-scope (no context save)\n'
          + 'After the fused sequence, CRd holds the loaded GT and acts as the\n'
          + 'code-fetch authority: PC ← CRd.base, instruction fetch bounded by\n'
          + 'CRd.limit. CRd is NOT derived from an NS-slot lookup — it comes\n'
          + 'directly from the C-List entry. On RETURN (SZ=0), CR6 and CR14 are\n'
          + 'restored from the saved register snapshot, not re-derived from an\n'
          + 'E-GT.\n\n'
          + 'Contrast with LAMBDA store-mode: LAMBDA store (bits[14:0] ≠ 0x7FFF)\n'
          + 'uses CRd as both the C-List source and GT destination (one register);\n'
          + 'XLOADLAMBDA uses a separate CRs register as the C-List.\n\n'
          + 'Leaf-lambda optimisation: the 1-word frame is NOT written to the\n'
          + 'thread lump stack buffer when the LAMBDA step executes. The write\n'
          + 'is deferred until a nested CALL or CHANGE occurs within the lambda\n'
          + 'body. If RETURN is reached with no intervening CALL or CHANGE\n'
          + '("leaf lambda"), the frame word is never committed to memory —\n'
          + 'RETURN restores PC from an in-flight pipeline register and pops\n'
          + 'STO back. Only the STO reservation (STO ← savedSTO + 1) is\n'
          + 'unconditional. A leaf lambda therefore has zero memory traffic to\n'
          + 'the thread lump stack buffer.\n\n'
          + 'Used for fast-path Church reductions where load + apply is one operation.',
        example: 'XLOADLAMBDA CR0, CR6, 7  ; Load word 7 of C-List CR6, verify X, reduce',
    },
    {
        opcode: 10, mnemonic: 'DREAD', domain: 'turing',
        syntax: 'DREAD DRd, CRs, imm',
        brief: 'Read a data word from a GT-protected address into a data register',
        encoding: 'opcode[5]=01010 | cond[4] | DRd[4] | CRs[4] | offset[15]',
        fields: [
            { name: 'DRd', desc: 'Destination data register (DR0-DR15)' },
            { name: 'CRs', desc: 'GT pointing to data object (R permission; or CR14 with X permission — code lump exception)' },
            { name: 'imm', desc: 'Word offset within the data object' },
        ],
        permission: 'R on CRs; exception: CR14 accepted with X permission (code lump read-only data)',
        flags: 'None',
        details:
            '  31    27│26   23│22   19│18   15│14                0\n'
          + '  ┌──────┬──────┬──────┬──────┬───────────────────┐\n'
          + '  │01010 │ cond │  DRd │  CRs │      offset       │\n'
          + '  └──────┴──────┴──────┴──────┴───────────────────┘\n'
          + '   5-bit   4-bit   4-bit   4-bit       15-bit\n\n'
          + 'DRd    = destination data register for the 32-bit result.\n'
          + 'CRs    = GT covering the data object (R permission required).\n'
          + 'offset = word offset within the protected region.\n\n'
          + 'mLoad validates: version, seal, R permission, base+offset within limit.\n'
          + 'Unified address space: works on memory, devices, or device registers.\n\n'
          + 'CR14 exception: DREAD may use CR14 (the privileged code register) as\n'
          + 'CRs with X permission only — R is not required. This preserves the\n'
          + 'DREAD DR, CR14, offset pattern for read-only constants packed after\n'
          + 'HALT in the code lump. Decode fault rule: (CRs>=12) AND NOT (CRs==14).',
        example: 'DREAD DR1, CR2, 0    ; Read word 0 from data object CR2\n'
               + 'DREAD DR1, CR14, 100 ; Read constant at offset 100 in code lump',
    },
    {
        opcode: 11, mnemonic: 'DWRITE', domain: 'turing',
        syntax: 'DWRITE DRd, CRs, imm',
        brief: 'Write a data register value to a GT-protected address',
        encoding: 'opcode[5]=01011 | cond[4] | DRd[4] | CRs[4] | offset[15]',
        fields: [
            { name: 'DRd', desc: 'Source data register (value to write)' },
            { name: 'CRs', desc: 'GT pointing to data object (W permission; CR12–CR15 invalid in this field except CR14)' },
            { name: 'imm', desc: 'Word offset within the data object' },
        ],
        permission: 'W on CRs; CR12–CR15 invalid except CR14 (same exception as DREAD)',
        flags: 'None',
        details:
            '  31    27│26   23│22   19│18   15│14                0\n'
          + '  ┌──────┬──────┬──────┬──────┬───────────────────┐\n'
          + '  │01011 │ cond │  DRd │  CRs │      offset       │\n'
          + '  └──────┴──────┴──────┴──────┴───────────────────┘\n'
          + '   5-bit   4-bit   4-bit   4-bit       15-bit\n\n'
          + 'DRd    = source data register (value to write).\n'
          + 'CRs    = GT covering the data object (must have W permission).\n'
          + 'offset = word offset within the protected region.\n\n'
          + 'mLoad validates: version, seal, W permission, base+offset within limit.\n'
          + 'Works on memory, device registers, or any GT-protected address range.',
        example: 'DWRITE DR3, CR2, 4   ; Write DR3 to word 4 of data object CR2',
    },
    {
        opcode: 12, mnemonic: 'BFEXT', domain: 'turing',
        syntax: 'BFEXT DRd, CRs, pos, width',
        brief: 'Extract a bitfield from a GT-protected word',
        encoding: 'opcode[5]=01100 | cond[4] | DRd[4] | CRs[4] | pos[5]<<5 | width[5]',
        fields: [
            { name: 'DRd', desc: 'Destination data register for extracted bits' },
            { name: 'CRs', desc: 'GT pointing to data (must have R permission)' },
            { name: 'pos', desc: 'Bit position to start extraction (0-31)' },
            { name: 'width', desc: 'Number of bits to extract (1-32)' },
        ],
        permission: 'R (Read) on CRs',
        flags: 'None',
        details:
            '  31    27│26   23│22   19│18   15│14  10│9    5│4    0\n'
          + '  ┌──────┬──────┬──────┬──────┬──────┬──────┬──────┐\n'
          + '  │01100 │ cond │  DRd │  CRs │  ─   │ pos  │ wid  │\n'
          + '  └──────┴──────┴──────┴──────┴──────┴──────┴──────┘\n'
          + '   5-bit   4-bit   4-bit   4-bit  5-bit  5-bit  5-bit\n\n'
          + 'DRd = destination (extracted bits, right-aligned, zero-extended).\n'
          + 'CRs = GT covering the data object (must have R permission).\n'
          + 'imm15 split:  [14:10] = unused (─)  [9:5] = pos  [4:0] = width\n'
          + '  pos   = bit position to start extraction (0–31)\n'
          + '  width = number of bits to extract (1–32)\n\n'
          + 'Reads word 0 of the GT-protected region, extracts bits [pos+width-1:pos],\n'
          + 'right-aligns them, and zero-extends into DRd.\n'
          + 'Useful for parsing packed structures, GT header fields, device registers.',
        example: 'BFEXT DR1, CR2, 8, 4  ; Extract 4 bits starting at bit 8',
    },
    {
        opcode: 13, mnemonic: 'BFINS', domain: 'turing',
        syntax: 'BFINS DRd, CRs, pos, width',
        brief: 'Insert a bitfield into a GT-protected word',
        encoding: 'opcode[5]=01101 | cond[4] | DRd[4] | CRs[4] | pos[5]<<5 | width[5]',
        fields: [
            { name: 'DRd', desc: 'Source data register (low bits inserted)' },
            { name: 'CRs', desc: 'GT pointing to data (must have W permission)' },
            { name: 'pos', desc: 'Bit position to start insertion (0-31)' },
            { name: 'width', desc: 'Number of bits to insert (1-32)' },
        ],
        permission: 'W (Write) on CRs',
        flags: 'None',
        details:
            '  31    27│26   23│22   19│18   15│14  10│9    5│4    0\n'
          + '  ┌──────┬──────┬──────┬──────┬──────┬──────┬──────┐\n'
          + '  │01101 │ cond │  DRd │  CRs │  ─   │ pos  │ wid  │\n'
          + '  └──────┴──────┴──────┴──────┴──────┴──────┴──────┘\n'
          + '   5-bit   4-bit   4-bit   4-bit  5-bit  5-bit  5-bit\n\n'
          + 'DRd = source (low \'width\' bits are inserted).\n'
          + 'CRs = GT covering the data object (must have W permission).\n'
          + 'imm15 split:  [14:10] = unused (─)  [9:5] = pos  [4:0] = width\n'
          + '  pos   = bit position to start insertion (0–31)\n'
          + '  width = number of bits to insert (1–32)\n\n'
          + 'Reads word 0 of the protected region, replaces bits [pos+width-1:pos]\n'
          + 'with the low \'width\' bits of DRd, and writes back. All other bits in\n'
          + 'the word are preserved — no full read-modify-write required in software.',
        example: 'BFINS DR1, CR2, 8, 4  ; Insert low 4 bits of DR1 at bit 8',
    },
    {
        opcode: 14, mnemonic: 'MCMP', domain: 'turing',
        syntax: 'MCMP DRa, DRb',
        brief: 'Compare two data registers and set condition flags',
        encoding: 'opcode[5]=01110 | cond[4] | DRa[4] | DRb[4] | 0[15]',
        fields: [
            { name: 'DRa', desc: 'First data register' },
            { name: 'DRb', desc: 'Second data register' },
        ],
        permission: 'None',
        flags: 'Z (zero/equal), N (negative), C (carry/unsigned \u2265), V (signed overflow)',
        details:
            '  31    27│26   23│22   19│18   15│14                0\n'
          + '  ┌──────┬──────┬──────┬──────┬───────────────────┐\n'
          + '  │01110 │ cond │  DRa │  DRb │        0          │\n'
          + '  └──────┴──────┴──────┴──────┴───────────────────┘\n'
          + '   5-bit   4-bit   4-bit   4-bit       zero\n\n'
          + 'DRa    = first operand (minuend, in dst field).\n'
          + 'DRb    = second operand (subtrahend, in src field).\n'
          + 'imm15  = 0 (unused).\n\n'
          + 'Computes DRa - DRb internally and sets all four ARM-style flags.\n'
          + 'Result is discarded — no destination register is written.\n\n'
          + 'Z = 1 if DRa == DRb\n'
          + 'N = 1 if result is negative (signed)\n'
          + 'C = 1 if DRa >= DRb (unsigned, no borrow)\n'
          + 'V = 1 if signed overflow',
        example: 'MCMP DR1, DR2        ; Compare DR1 with DR2\nBRANCHEQ equal       ; Branch if DR1 == DR2',
    },
    {
        opcode: 15, mnemonic: 'IADD', domain: 'turing',
        syntax: 'IADD DRd, DRa, DRb',
        brief: 'Integer addition with flag setting',
        encoding: 'opcode[5]=01111 | cond[4] | DRd[4] | DRa[4] | DRb[4] in imm[3:0]',
        fields: [
            { name: 'DRd', desc: 'Destination data register (result)' },
            { name: 'DRa', desc: 'First source register (in src field)' },
            { name: 'DRb', desc: 'Second source register (in imm bits 0-3)' },
        ],
        permission: 'None',
        flags: 'Z (zero), N (negative), C (unsigned carry), V (signed overflow)',
        details:
            '  31    27│26   23│22   19│18   15│14     4│3     0\n'
          + '  ┌──────┬──────┬──────┬──────┬───────────┬──────┐\n'
          + '  │01111 │ cond │  DRd │  DRa │     0     │ DRb  │\n'
          + '  └──────┴──────┴──────┴──────┴───────────┴──────┘\n'
          + '   5-bit   4-bit   4-bit   4-bit   11-bit    4-bit\n\n'
          + 'DRd = destination (result).\n'
          + 'DRa = first source (in src field).\n'
          + 'DRb = second source (in imm15[3:0] — low 4 bits of imm15).\n'
          + 'imm15[14:4] = 0 (unused).\n\n'
          + 'Computes DRd = DRa + DRb as unsigned 32-bit integers.\n'
          + 'DR0 is hardwired to zero: IADD DRd, DR0, DR0 initialises DRd = 0.\n\n'
          + 'Z = 1 if result is zero\n'
          + 'N = 1 if bit 31 of result is set\n'
          + 'C = 1 if carry out (result > 0xFFFFFFFF)\n'
          + 'V = 1 if signed overflow',
        example: 'IADD DR3, DR1, DR2   ; DR3 = DR1 + DR2, set flags',
    },
    {
        opcode: 16, mnemonic: 'ISUB', domain: 'turing',
        syntax: 'ISUB DRd, DRa, DRb',
        brief: 'Integer subtraction with flag setting',
        encoding: 'opcode[5]=10000 | cond[4] | DRd[4] | DRa[4] | DRb[4] in imm[3:0]',
        fields: [
            { name: 'DRd', desc: 'Destination data register (result)' },
            { name: 'DRa', desc: 'First source register (minuend)' },
            { name: 'DRb', desc: 'Second source register (subtrahend, in imm bits 0-3)' },
        ],
        permission: 'None',
        flags: 'Z (zero), N (negative), C (borrow: C=1 if DRa \u2265 DRb), V (signed overflow)',
        details:
            '  31    27│26   23│22   19│18   15│14     4│3     0\n'
          + '  ┌──────┬──────┬──────┬──────┬───────────┬──────┐\n'
          + '  │10000 │ cond │  DRd │  DRa │     0     │ DRb  │\n'
          + '  └──────┴──────┴──────┴──────┴───────────┴──────┘\n'
          + '   5-bit   4-bit   4-bit   4-bit   11-bit    4-bit\n\n'
          + 'DRd = destination (result).\n'
          + 'DRa = minuend (in src field).\n'
          + 'DRb = subtrahend (in imm15[3:0] — low 4 bits of imm15).\n'
          + 'imm15[14:4] = 0 (unused).\n\n'
          + 'Computes DRd = DRa - DRb as unsigned 32-bit integers.\n'
          + 'ISUB DRd, DR0, DRx computes two\'s complement negation (0 - DRx).\n\n'
          + 'Z = 1 if result is zero\n'
          + 'N = 1 if bit 31 of result is set\n'
          + 'C = 1 if no borrow (DRa >= DRb unsigned — ARM convention)\n'
          + 'V = 1 if signed overflow',
        example: 'ISUB DR4, DR3, DR1   ; DR4 = DR3 - DR1, set flags',
    },
    {
        opcode: 17, mnemonic: 'BRANCH', domain: 'turing',
        syntax: 'BRANCH[cond] offset',
        brief: 'Conditional branch with signed PC-relative offset \u2014 use for error catch after a conditional instruction',
        encoding: 'opcode[5]=10001 | cond[4] | 0[4] | 0[4] | signed_offset[15]',
        fields: [
            { name: 'offset', desc: 'Signed 15-bit PC-relative offset (-16384 to +16383)' },
        ],
        permission: 'None',
        flags: 'None (reads flags, does not set them)',
        details:
            '  31    27│26   23│22   19│18   15│14                0\n'
          + '  ┌──────┬──────┬──────┬──────┬───────────────────┐\n'
          + '  │10001 │ cond │  ─   │  ─   │  signed offset    │\n'
          + '  └──────┴──────┴──────┴──────┴───────────────────┘\n'
          + '   5-bit   4-bit  zero   zero        15-bit\n\n'
          + 'cond          = condition code (the branch condition)\n'
          + 'dst, src      = zero (unused)\n'
          + 'signed offset = sign-extended 15-bit PC-relative displacement\n'
          + '                range: -16384 to +16383 instructions\n\n'
          + 'If the condition is true, PC = PC + sign_ext(offset).\n'
          + 'The cond field IS the branch condition — no separate comparison needed\n'
          + 'if flags were set by a prior MCMP or arithmetic instruction.\n'
          + 'Branch targets are bounded within the current abstraction.',
        example: 'BRANCHEQ +3          ; If Z=1, skip 3 instructions\nBRANCHNE -5          ; If Z=0, loop back 5',
    },
    {
        opcode: 18, mnemonic: 'SHL', domain: 'turing',
        syntax: 'SHL DRd, DRs, shamt',
        brief: 'Logical shift left with flag setting',
        encoding: 'opcode[5]=10010 | cond[4] | DRd[4] | DRs[4] | shamt[5] in imm[4:0]',
        fields: [
            { name: 'DRd', desc: 'Destination data register (result)' },
            { name: 'DRs', desc: 'Source data register (value to shift)' },
            { name: 'shamt', desc: 'Shift amount (0-31)' },
        ],
        permission: 'None',
        flags: 'Z (zero), N (sign bit of result), C (last bit shifted out)',
        details:
            '  31    27│26   23│22   19│18   15│14     5│4     0\n'
          + '  ┌──────┬──────┬──────┬──────┬───────────┬──────┐\n'
          + '  │10010 │ cond │  DRd │  DRs │     0     │shamt │\n'
          + '  └──────┴──────┴──────┴──────┴───────────┴──────┘\n'
          + '   5-bit   4-bit   4-bit   4-bit   10-bit    5-bit\n\n'
          + 'DRd   = destination (shifted result).\n'
          + 'DRs   = source (value to shift).\n'
          + 'shamt = shift amount 0–31 (in imm15[4:0]).\n'
          + 'imm15[14:5] = 0 (unused).\n\n'
          + 'DRd = DRs << shamt. Vacated low bits are filled with zeros.\n'
          + 'Equivalent to multiplication by 2^shamt.\n\n'
          + 'Z = 1 if result is zero\n'
          + 'N = 1 if bit 31 of result is set\n'
          + 'C = last bit shifted out (bit 32-shamt of original value)\n'
          + 'V = always 0',
        example: 'SHL DR2, DR1, 4      ; DR2 = DR1 << 4 (multiply by 16)',
    },
    {
        opcode: 19, mnemonic: 'SHR', domain: 'turing',
        syntax: 'SHR DRd, DRs, shamt [, ASR]',
        brief: 'Logical or arithmetic shift right with flag setting',
        encoding: 'opcode[5]=10011 | cond[4] | DRd[4] | DRs[4] | arith[1]<<5 | shamt[5]',
        fields: [
            { name: 'DRd', desc: 'Destination data register (result)' },
            { name: 'DRs', desc: 'Source data register (value to shift)' },
            { name: 'shamt', desc: 'Shift amount (0-31)' },
            { name: 'ASR', desc: 'Optional: arithmetic shift (sign-extending). Omit for logical shift.' },
        ],
        permission: 'None',
        flags: 'Z (zero), N (sign bit of result), C (last bit shifted out)',
        details:
            '  31    27│26   23│22   19│18   15│14   6│5│4     0\n'
          + '  ┌──────┬──────┬──────┬──────┬──────────┬─┬──────┐\n'
          + '  │10011 │ cond │  DRd │  DRs │    0     │A│shamt │\n'
          + '  └──────┴──────┴──────┴──────┴──────────┴─┴──────┘\n'
          + '   5-bit   4-bit   4-bit   4-bit   9-bit  1   5-bit\n\n'
          + 'DRd   = destination (shifted result).\n'
          + 'DRs   = source (value to shift).\n'
          + 'shamt = shift amount 0–31 (imm15[4:0]).\n'
          + 'A     = arithmetic mode flag (imm15[5]).\n'
          + '        0 = logical shift (fill high bits with 0)\n'
          + '        1 = arithmetic shift / ASR (fill with sign bit)\n'
          + 'imm15[14:6] = 0 (unused).\n\n'
          + 'Logical (A=0):    DRd = DRs >> shamt, high bits = 0\n'
          + 'Arithmetic (A=1): DRd = DRs >>> shamt, high bits = sign bit\n'
          + 'ASR preserves sign — equivalent to signed division by 2^shamt.\n\n'
          + 'Z = 1 if result is zero\n'
          + 'N = 1 if bit 31 of result is set\n'
          + 'C = last bit shifted out (bit shamt-1 of original value)\n'
          + 'V = always 0',
        example: 'SHR DR2, DR1, 3      ; DR2 = DR1 >> 3 (logical)\nSHR DR3, DR1, 1, ASR ; DR3 = DR1 >>> 1 (arithmetic, sign-extending)',
    },
];

let selectedInstr = null;

function _refTipShow(text, e) {
    let tip = document.getElementById('_refBriefTip');
    if (!tip) {
        tip = document.createElement('div');
        tip.id = '_refBriefTip';
        tip.style.cssText = [
            'position:fixed',
            'z-index:9999',
            'background:#1b2d45',
            'color:#e0e0e0',
            'font-size:0.75rem',
            'line-height:1.45',
            'padding:0.4rem 0.75rem',
            'border-radius:5px',
            'border:1px solid #3a86ff',
            'max-width:320px',
            'pointer-events:none',
            'box-shadow:0 2px 10px rgba(0,0,0,0.5)',
            'white-space:normal',
            'display:none',
        ].join(';');
        document.body.appendChild(tip);
    }
    tip.textContent = text;
    tip.style.display = 'block';
    _refTipMove(e);
}

function _refTipMove(e) {
    const tip = document.getElementById('_refBriefTip');
    if (!tip || tip.style.display === 'none') return;
    const x = e.clientX + 16;
    const y = e.clientY - 6;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    tip.style.left = (x + tw > window.innerWidth  ? window.innerWidth  - tw - 10 : x) + 'px';
    tip.style.top  = (y + th > window.innerHeight ? window.innerHeight - th - 10 : y) + 'px';
}

function _refTipHide() {
    const tip = document.getElementById('_refBriefTip');
    if (tip) tip.style.display = 'none';
}

function _attachRefTip(card, brief) {
    card.addEventListener('mouseenter', e => _refTipShow(brief, e));
    card.addEventListener('mousemove',  _refTipMove);
    card.addEventListener('mouseleave', _refTipHide);
}

const ABSTRACTION_DATA = [
    {
        id: 'abstraction',
        name: 'Abstraction',
        brief: 'A named, capability-gated execution unit occupying a namespace slot.',
        detail: `An abstraction is the Church Machine's unit of software. Each abstraction occupies one namespace slot (slot 0 = boot, slot 1 = CLOOMC kernel, slots 2+ = user).

Structure of an abstraction in memory (Thread Lump, typ=0x0A):
  ┌───────────────────────────────────┐
  │ Header[0]   typ | cc | reserved   │  ← base address (word 0)
  │ Data Registers  DR0–DR15 (saved)  │
  │ Heap ↓      cc words, bump alloc  │
  │ Freespace   (grows/shrinks)       │
  │ Stack ↑     LIFO, CALL/LAMBDA     │
  │ C-List tail CR0–CR11 (12 words)   │
  └───────────────────────────────────┘

Entry: via CALL instruction through C-List slot holding an E-perm Golden Token pointing to the code lump.`,
        example: `; Declare abstraction (CLOOMC JS syntax)
abstraction Greeter {
  capabilities { Family }
  method Hello(name) {
    call(Family.Send(name))
    return(0)
  }
}`
    },
    {
        id: 'method',
        name: 'Method',
        brief: 'A lambda-captured function stored in the C-List, invoked via CALL.',
        detail: `A method is a LAMBDA closure stored as a Golden Token in the C-List.

Lifecycle:
  1. Compiler emits LAMBDA CRd, offset → creates closure GT with X-perm
  2. Closure is stored in a C-List slot (SAVE instruction)
  3. Caller invokes via CALL CRs, 0xF (direct E-perm) or ELOADCALL (load+call)
  4. On entry: CR6 = callee c-list, CR14 = code region (X-only)
  5. CHANGE swaps DR0–DR15 and CR6/CR14/CR15 between caller and callee
  6. RETURN restores caller context

Register conventions:
  DR0–DR3   Arguments (DR0 = return value)
  DR4–DR11  Callee-saved locals
  DR12–DR15 Caller-saved temporaries`,
        example: `; CLOOMC JS method call
result = call(Memory.Allocate(size))

; Compiles to:
ELOADCALL CRd, [CR6, slot]   ; load + call in one instruction
; or:
LOAD CRd, [CR6, slot]        ; load closure GT
CALL CRd, 0xF                ; call direct (E perm)`
    },
    {
        id: 'golden-token',
        name: 'Golden Token (GT)',
        brief: 'A 128-bit unforgeable capability granting specific permissions to a resource.',
        detail: `A Golden Token (GT) is a 128-bit value stored in a Context Register (CR).

Layout (4 × 32-bit words):
  word0 [31:24] perms  — R W X L S E B F (8 bits)
  word0 [23:16] cc     — heap size in words (IDE-defined)
  word0 [15:0]  version — revocation counter
  word1 [31:0]  node   — memory address of the lump
  word2 [31:0]  seal   — sealing key (0 = unsealed)
  word3 [31:0]  sig    — CRC or integrity seal

Permission bits:
  R = DREAD   — read data words
  W = DWRITE  — write data words
  X = LAMBDA  — capture as closure
  L = CALL    — invoke via C-List (loads CR6/CR14)
  S = SAVE    — store GT into lump
  E = CALL    — direct invocation (E-perm CALL)
  B = boot    — present in boot C-List
  F = freeze  — token cannot be further restricted

Monotonic restriction: TPERM can only remove permissions, never add.
Revocation: CHANGE with version bump invalidates all outstanding copies.`,
        example: `; Check if GT has read permission (TPERM health-check form)
TPERM CR0, #R        ; sets Z flag if CR0 has R perm
BRANCH.NE fault      ; branch if no R perm

; Restrict to read-only (TPERM restriction form)
TPERM CR0, #R        ; keep only R bit — monotonic, irreversible`
    },
    {
        id: 'clist',
        name: 'C-List (Capability List)',
        brief: 'The 12-word tail of a thread holding Golden Tokens CR0–CR11.',
        detail: `Each thread has a C-List tail: 12 programmer-accessible Golden Token slots.

Slots:
  CR0   Result / first argument
  CR1   Second argument
  CR2   Third argument
  CR3   Fourth argument
  CR4   General purpose
  CR5   General purpose
  CR6   Current C-List base (set by CALL, read-only in CLOOMC)
  CR7   General purpose
  CR8   General purpose
  CR9   General purpose
  CR10  General purpose
  CR11  General purpose

Privileged zone (CR12–CR15) — hardware FAULT if used in most instructions:
  CR12  Thread identity (priv, zero-perm, Inform-type)
  CR13  Kernel reserved
  CR14  Code region (X-only, set by CALL)
  CR15  Stack / boot anchor

The C-List is loaded at boot via mLoad(NS Slot 1, B-perm check).
CALL updates CR6 and CR14. CHANGE swaps the full context.`,
        example: `; Load a GT from C-List slot 3 into CR0
LOAD CR0, [CR6, 3]

; Save a GT from CR1 into slot 5 of target object
SAVE [CR0, 5], CR1

; Call abstraction via slot 2 in current C-List
CALL CR6, 2          ; L perm required on slot 2`
    },
    {
        id: 'thread',
        name: 'Thread',
        brief: 'The execution context: registers, stack, heap, and C-List tail in one lump.',
        detail: `A thread is a single execution context managed by the CHANGE instruction.

Memory layout (word 0 = base address, addresses increase downward):
  [0]    Header word  typ=0x0A | cc (heap size) | reserved
  [1–16] DR0–DR15     Saved data registers (32-bit each)
  [17…]  Heap ↓       cc words; bump allocation; DR5 = frontier
  [?]    Freespace    17+cc words to sp_max (IDE-defined)
  [sp…]  Stack ↑      CALL frame: [E-GT · frame-word] (STO -= 2)
                       LAMBDA frame: [frame-word] (STO -= 1)
  [tail] C-List       CR0–CR11 (12 words, fixed tail)

STO register = current stack top (word index).
CHANGE saves current DRs into [1–16], loads new thread's DRs, swaps CR6/CR14/CR15.`,
        example: `; CLOOMC compiler places locals in DR registers
; On CALL, hardware saves DR0–DR15 in thread header
; CHANGE instruction:
CHANGE CR0, 1        ; switch to thread at CR0, use slot 1 for context`
    },
    {
        id: 'namespace',
        name: 'Namespace',
        brief: 'The 192-slot address space. Each slot holds a Golden Token to an abstraction.',
        detail: `The Namespace (NS) is the global directory of abstractions.

Capacity: 192 slots (slots 0–191), each holding a 128-bit Golden Token.

Reserved slots:
  Slot 0   Boot microcode (6-step hardwired state machine, not a real code word)
  Slot 1   CLOOMC kernel / thread manager

User abstractions:
  Slot 2+  IDE-assigned at compile time

Boot sequence (B:00–B:04, 5 steps):
  B:00  FAULT_RST — clear registers
  B:01  LOAD_NS   — load namespace GT into CR15
  B:02  INIT_THRD — mLoad CR12 from NS Slot 1 (Thread identity)
  B:03  INIT_ABSTR — mLoad CR6  from NS Slot 2 (Boot abstraction)
  B:04  LOAD_NUC + COMPLETE — CR14+CR6 from lump header; M-Elev OFF (indivisible)

Access: LOAD/SAVE instructions using a namespace-scoped GT with L/S perm.`,
        example: `; Assembly: load namespace entry for slot 3
LOAD CR0, [CR15, 3]  ; CR15 = namespace base GT
CALL CR0, 0xF        ; call directly (E perm)`
    },
    {
        id: 'change',
        name: 'CHANGE — Context Switch',
        brief: 'Hardware thread switch: saves DR0–DR15, loads new thread context.',
        detail: `CHANGE is the mechanism for both function calls and thread (abstraction) context switches.

What CHANGE does:
  1. Save DR0–DR15 into current thread header (words [1–16])
  2. Load DR0–DR15 from new thread header
  3. Swap CR6  (C-List pointer)
  4. Swap CR14 (Code region pointer)
  5. Swap CR15 (Stack/boot anchor)
  6. Adjust STO for new thread

When the compiler emits a CALL, it uses CHANGE internally.
CHANGE enables capability-isolated context switching:
  — The new thread runs in its own C-List (CR6)
  — Code region is swapped (CR14)
  — DR registers are fully saved and restored

Syntax:  CHANGE CRd, imm     (imm = context-switch mode)`,
        example: `; Hardware CHANGE during CALL:
; 1. DR0–DR15 saved to current thread [1..16]
; 2. New thread's DRs loaded
; 3. CR6 = new C-List, CR14 = new code lump
; RETURN undoes this`
    },
    {
        id: 'switch',
        name: 'SWITCH — Privilege Switch',
        brief: 'Switch between privilege levels (ARCH → PROG → PRIV). Monotonic downward.',
        detail: `SWITCH changes the privilege level of the current execution context.

Privilege levels (monotonic — can only decrease):
  ARCH  (0)  Full hardware access; set at boot
  PROG  (1)  Normal abstraction code; no CR12–CR15 access
  PRIV  (2)  Restricted; only safe operations

SWITCH is monotonic: you can downgrade privilege but never upgrade within a thread.
Upgrading requires a CALL into a higher-privilege abstraction via the C-List.

Use cases:
  — Boot firmware runs at ARCH; downgrades to PROG before entering user code
  — Safety-critical sections can SWITCH to PRIV for isolation

Syntax:  SWITCH CRs, imm     (imm = new privilege level)`,
        example: `; Boot sequence downgrade after kernel init
SWITCH CR15, #PROG   ; drop from ARCH to PROG before user CALL`
    },
];

let _refActiveTab = 'abstractions';
let _selectedAbstraction = null;

function switchRefTab(tab) {
    _refActiveTab = tab;
    document.querySelectorAll('.ref-tab').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('refTab-' + tab);
    if (btn) btn.classList.add('active');
    document.getElementById('refPanel-abstractions').style.display = (tab === 'abstractions') ? '' : 'none';
    document.getElementById('refPanel-hardware').style.display = (tab === 'hardware') ? '' : 'none';
    const title = document.getElementById('instrDetailTitle');
    const body = document.getElementById('instrDetailContent');
    if (title) title.textContent = 'Select a concept or instruction';
    if (body) body.innerHTML = '<div class="instr-placeholder">Click any item on the left to see details.</div>';
}

function showAbstractionDetail(id) {
    _selectedAbstraction = id;
    const item = ABSTRACTION_DATA.find(a => a.id === id);
    if (!item) return;
    renderReference();
    const title = document.getElementById('instrDetailTitle');
    const body = document.getElementById('instrDetailContent');
    if (title) title.textContent = item.name;
    if (!body) return;
    body.innerHTML = `
        <div class="instr-detail-section">
            <div class="instr-detail-badge church">Abstraction Model</div>
            <div class="instr-detail-desc">${item.brief}</div>
        </div>
        <div class="instr-detail-section">
            <div class="instr-detail-label">Detail</div>
            <pre class="instr-detail-text">${item.detail}</pre>
        </div>
        <div class="instr-detail-section">
            <div class="instr-detail-label">Example</div>
            <pre class="instr-detail-example">${item.example}</pre>
        </div>
    `;
}

function renderReference() {
    const churchList = document.getElementById('instrListChurch');
    const turingList = document.getElementById('instrListTuring');
    const absList = document.getElementById('instrListAbstractions');

    if (absList) {
        absList.innerHTML = '';
        ABSTRACTION_DATA.forEach(item => {
            const card = document.createElement('div');
            card.className = 'instr-card abs-card' + (_selectedAbstraction === item.id ? ' active' : '');
            card.innerHTML = `<span class="instr-mnemonic">${item.name}</span><span class="instr-brief">${item.brief}</span>`;
            card.onclick = () => { _refTipHide(); showAbstractionDetail(item.id); };
            _attachRefTip(card, item.brief);
            absList.appendChild(card);
        });
    }

    if (!churchList || !turingList) return;
    churchList.innerHTML = '';
    turingList.innerHTML = '';

    INSTRUCTION_DATA.forEach(instr => {
        const card = document.createElement('div');
        card.className = 'instr-card' + (selectedInstr === instr.opcode ? ' active' : '');
        card.innerHTML = `
            <span class="instr-opcode">${instr.opcode}</span>
            <span class="instr-mnemonic">${instr.mnemonic}</span>
            <span class="instr-brief">${instr.brief}</span>
        `;
        card.onclick = () => {
            _refTipHide();
            _selectedAbstraction = null;
            if (_refActiveTab !== 'hardware') switchRefTab('hardware');
            showInstructionDetail(instr.opcode);
        };
        _attachRefTip(card, instr.brief);
        if (instr.domain === 'church') churchList.appendChild(card);
        else turingList.appendChild(card);
    });

    const returnCard = document.createElement('div');
    returnCard.className = 'instr-card instr-shared' + (selectedInstr === 3 ? ' active' : '');
    returnCard.innerHTML = `
        <span class="instr-opcode">3</span>
        <span class="instr-mnemonic">RETURN</span>
        <span class="instr-brief">Shared \u2014 exit from Turing abstraction</span>
    `;
    returnCard.onclick = () => { _refTipHide(); _selectedAbstraction = null; showInstructionDetail(3); };
    _attachRefTip(returnCard, 'Shared \u2014 exit from Turing abstraction');
    turingList.appendChild(returnCard);
}

function showInstructionDetail(opcode) {
    selectedInstr = opcode;
    const instr = INSTRUCTION_DATA.find(i => i.opcode === opcode);
    if (!instr) return;

    renderReference();

    const title = document.getElementById('instrDetailTitle');
    const content = document.getElementById('instrDetailContent');
    if (!title || !content) return;

    const domainLabel = instr.domain === 'church' ? 'Church Domain' : 'Turing Domain';
    const domainClass = instr.domain === 'church' ? 'church' : 'turing';
    title.textContent = `${instr.mnemonic} \u2014 Opcode ${instr.opcode}`;

    content.innerHTML = `
        <div class="instr-detail-section">
            <div class="instr-detail-badge ${domainClass}">${domainLabel}</div>
            <div class="instr-detail-desc">${instr.brief}</div>
        </div>

        <div class="instr-detail-section">
            <div class="instr-detail-label">Syntax</div>
            <div class="instr-detail-code">${instr.syntax}</div>
        </div>

        <div class="instr-detail-section">
            <div class="instr-detail-label">Encoding (32-bit)</div>
            <div class="instr-detail-code">${instr.encoding}</div>
        </div>

        <div class="instr-detail-section">
            <div class="instr-detail-label">Operands</div>
            <table class="instr-fields-table">
                <thead><tr><th>Field</th><th>Description</th></tr></thead>
                <tbody>
                    ${instr.fields.map(f => `<tr><td class="instr-field-name">${f.name}</td><td>${f.desc}</td></tr>`).join('')}
                </tbody>
            </table>
        </div>

        <div class="instr-detail-section">
            <div class="instr-detail-label">Permission Gate (mLoad)</div>
            <div class="instr-detail-value">${instr.permission}</div>
        </div>

        <div class="instr-detail-section">
            <div class="instr-detail-label">Flags Affected</div>
            <div class="instr-detail-value">${instr.flags}</div>
        </div>

        <div class="instr-detail-section">
            <div class="instr-detail-label">Description</div>
            <pre class="instr-detail-text">${instr.details}</pre>
        </div>

        <div class="instr-detail-section">
            <div class="instr-detail-label">Example</div>
            <pre class="instr-detail-example">${instr.example}</pre>
        </div>
    `;
}

const SYNTAX_REF = {
    english: {
        title: "English Syntax Reference",
        sections: [
            { heading: "Structure", items: [
                { syntax: "Create an abstraction called <em>Name</em>", desc: "Declare abstraction" },
                { syntax: "Add a method called <em>Name</em> that takes <em>a</em>, <em>b</em>", desc: "Define method with parameters" },
                { syntax: "It needs <em>Memory</em> and <em>Mint</em>", desc: "Declare capabilities" },
            ]},
            { heading: "Assignment", items: [
                { syntax: "Set <em>result</em> to <em>x</em> plus <em>1</em>", desc: "Assign with arithmetic" },
                { syntax: "Let <em>total</em> be <em>a</em> times <em>b</em>", desc: "Alternative assignment" },
            ]},
            { heading: "Arithmetic", items: [
                { syntax: "<em>a</em> plus <em>b</em>", desc: "Addition" },
                { syntax: "<em>a</em> minus <em>b</em>", desc: "Subtraction" },
                { syntax: "<em>a</em> times <em>b</em>", desc: "Multiply (software)" },
                { syntax: "<em>a</em> divided by <em>b</em>", desc: "Divide (software)" },
                { syntax: "<em>a</em> shifted left by <em>n</em>", desc: "Shift left" },
                { syntax: "<em>a</em> shifted right by <em>n</em>", desc: "Shift right" },
            ]},
            { heading: "Control Flow", items: [
                { syntax: "If <em>count</em> is greater than <em>0</em>", desc: "Conditional (also: equal to, less than, not)" },
                { syntax: "Otherwise", desc: "Else branch" },
                { syntax: "End if", desc: "Close conditional" },
            ]},
            { heading: "Calls & Returns", items: [
                { syntax: "Call <em>Memory.Allocate</em> with <em>size</em>", desc: "Invoke method" },
                { syntax: "Set <em>r</em> to the result of calling <em>Memory.Allocate</em> with <em>size</em>", desc: "Capture return value" },
                { syntax: "Return the result", desc: "Return DR0" },
                { syntax: "Return <em>value</em>", desc: "Return a specific value" },
            ]},
            { heading: "Memory", items: [
                { syntax: "Read from <em>CR14</em> at offset <em>0</em>", desc: "Read code lump constant" },
                { syntax: "Read from <em>CR0</em> at offset <em>0</em>", desc: "Read data object" },
            ]},
        ]
    },
    javascript: {
        title: "JavaScript (CLOOMC++) Syntax Reference",
        sections: [
            { heading: "Structure", items: [
                { syntax: "abstraction <em>Name</em> { }", desc: "Declare abstraction" },
                { syntax: "capabilities { <em>Memory</em>, <em>Mint</em> }", desc: "Capability list" },
                { syntax: "method <em>Name</em>(<em>a</em>, <em>b</em>) { }", desc: "Define method" },
            ]},
            { heading: "Assignment & Arithmetic", items: [
                { syntax: "<em>result</em> = <em>a</em> + <em>b</em>", desc: "Add" },
                { syntax: "<em>result</em> = <em>a</em> - <em>b</em>", desc: "Subtract" },
                { syntax: "<em>result</em> = <em>a</em> * <em>b</em>", desc: "Multiply (software)" },
                { syntax: "<em>result</em> = <em>a</em> / <em>b</em>", desc: "Divide (software)" },
                { syntax: "<em>result</em> = <em>a</em> &lt;&lt; <em>n</em>", desc: "Shift left" },
                { syntax: "<em>result</em> = <em>a</em> &gt;&gt; <em>n</em>", desc: "Shift right" },
            ]},
            { heading: "Control Flow", items: [
                { syntax: "if (<em>a</em> == <em>b</em>) { ... }", desc: "Conditional (==, !=, <, >, <=, >=)" },
                { syntax: "while (<em>i</em> &lt; <em>10</em>) { ... }", desc: "Loop" },
            ]},
            { heading: "Calls & Returns", items: [
                { syntax: "result = call(<em>Memory.Allocate</em>(<em>size</em>))", desc: "Call via c-list" },
                { syntax: "return(<em>result</em>)", desc: "Return value in DR0" },
            ]},
            { heading: "Memory & Bit Fields", items: [
                { syntax: "<em>x</em> = read(<em>CR0</em>, <em>offset</em>)", desc: "Read from capability" },
                { syntax: "write(<em>CR0</em>, <em>offset</em>, <em>value</em>)", desc: "Write to capability" },
                { syntax: "bfext(<em>word</em>, <em>pos</em>, <em>width</em>)", desc: "Extract bit field" },
                { syntax: "bfins(<em>word</em>, <em>val</em>, <em>pos</em>, <em>width</em>)", desc: "Insert bit field" },
            ]},
            { heading: "Registers", items: [
                { syntax: "DR0\u2013DR3", desc: "Arguments & return values" },
                { syntax: "DR4\u2013DR11", desc: "Locals (callee-saved)" },
                { syntax: "DR12\u2013DR15", desc: "Temps (caller-saved)" },
            ]},
        ]
    },
    haskell: {
        title: "Haskell (CLOOMC++) Syntax Reference",
        sections: [
            { heading: "Structure", items: [
                { syntax: "abstraction <em>Name</em> { }", desc: "Declare abstraction" },
                { syntax: "capabilities { <em>Memory</em> }", desc: "Capability list" },
                { syntax: "method <em>name</em>(<em>a</em>, <em>b</em>) = <em>expr</em>", desc: "Method as expression" },
            ]},
            { heading: "Expressions", items: [
                { syntax: "<em>a</em> + <em>b</em>", desc: "Add" },
                { syntax: "<em>a</em> - <em>b</em>", desc: "Subtract" },
                { syntax: "<em>a</em> * <em>b</em>", desc: "Multiply (software)" },
                { syntax: "if <em>x</em> == <em>0</em> then <em>a</em> else <em>b</em>", desc: "Inline conditional" },
            ]},
            { heading: "Pattern Matching", items: [
                { syntax: "case <em>n</em> of <em>0</em> -&gt; <em>1</em>, _ -&gt; <em>n</em>", desc: "Case expression" },
            ]},
            { heading: "Let Bindings", items: [
                { syntax: "let <em>a</em> = <em>x</em> + <em>1</em> in <em>a</em> + <em>a</em>", desc: "Local binding" },
            ]},
            { heading: "Pairs", items: [
                { syntax: "(<em>a</em>, <em>b</em>)", desc: "Construct pair (BFINS)" },
                { syntax: "fst <em>p</em>", desc: "First element (BFEXT)" },
                { syntax: "snd <em>p</em>", desc: "Second element (BFEXT)" },
            ]},
            { heading: "Lambda", items: [
                { syntax: "\\<em>x</em> -&gt; <em>x</em> + <em>1</em>", desc: "Lambda expression (LAMBDA instruction)" },
            ]},
        ]
    },
    symbolic: {
        title: "Symbolic Math (Ada) Syntax Reference",
        sections: [
            { heading: "Structure", items: [
                { syntax: "abstraction <em>Name</em> { }", desc: "Declare abstraction" },
                { syntax: "method <em>name</em>() { ... }", desc: "Define method" },
            ]},
            { heading: "Variables", items: [
                { syntax: "let V1 = <em>1</em>", desc: "Initialise store column (V1\u2013V15 \u2192 DR1\u2013DR15)" },
                { syntax: "let V4 = V2 * V3", desc: "Multiply (shift-and-add loop)" },
                { syntax: "let V11 = V4 / V5", desc: "Divide (repeated subtraction)" },
                { syntax: "let V5 = V5 + V1", desc: "Addition" },
                { syntax: "let V4 = V4 - V1", desc: "Subtraction" },
            ]},
            { heading: "Arrow Notation", items: [
                { syntax: "V2 \u00d7 V3 \u2192 V4", desc: "Ada's original notation" },
                { syntax: "V2 + V3 \u2192 V4", desc: "Arrow assignment" },
            ]},
            { heading: "Notes", items: [
                { syntax: "-- <em>comment</em>", desc: "Comment (Ada-style)" },
                { syntax: "V1\u2013V15 map to DR1\u2013DR15", desc: "Direct register mapping" },
            ]},
        ]
    },
    assembly: {
        title: "Assembly Syntax Reference",
        sections: [
            { heading: "Church Domain — Capability Instructions (opcodes 0–9)", items: [
                { syntax: "LOAD CRd, [CRs, <em>idx</em>]", desc: "Load Golden Token from lump (R perm)" },
                { syntax: "SAVE [CRd, <em>idx</em>], CRs", desc: "Save Golden Token into lump (S perm)" },
                { syntax: "CALL CRs, <em>off</em>", desc: "Enter via C-List slot (L perm, off 0–14) or direct (E perm, off=0xF)" },
                { syntax: "RETURN", desc: "Return from abstraction; restore caller context" },
                { syntax: "CHANGE CRd, <em>imm</em>", desc: "Context switch — save/load DR0–DR15, swap CR6/CR14/CR15" },
                { syntax: "SWITCH CRs, <em>imm</em>", desc: "Downgrade privilege level (ARCH→PROG→PRIV, monotonic)" },
                { syntax: "TPERM CRd, <em>preset</em>", desc: "Health-check (sets Z) or restrict permissions (monotonic mask)" },
                { syntax: "LAMBDA CRd, <em>offset</em>", desc: "Capture closure into CRd (offset=0x7FFF = immediate form)" },
                { syntax: "ELOADCALL CRd, [CRs, <em>off</em>]", desc: "Load GT from lump then CALL in one instruction (E+L perm)" },
                { syntax: "XLOADLAMBDA CRd, [CRs, <em>off</em>]", desc: "Load GT from lump then LAMBDA capture (X perm)" },
            ]},
            { heading: "Turing Domain — Data Instructions (opcodes 10–19)", items: [
                { syntax: "DREAD DRd, [CRs, <em>off</em>]", desc: "Read 32-bit word from lump (R perm)" },
                { syntax: "DWRITE [CRd, <em>off</em>], DRs", desc: "Write 32-bit word into lump (W perm)" },
                { syntax: "BFEXT DRd, DRs, <em>pos</em>, <em>w</em>", desc: "Extract bit field [pos, pos+w) from DRs" },
                { syntax: "BFINS DRd, DRs, <em>pos</em>, <em>w</em>", desc: "Insert bit field into DRd at [pos, pos+w)" },
                { syntax: "MCMP DRa, DRb", desc: "Compare DRa vs DRb, set N/Z/C/V flags" },
                { syntax: "BRANCH <em>cond</em>, <em>target</em>", desc: "Conditional branch (AL/EQ/NE/LT/GE/GT/LE)" },
                { syntax: "IADD DRd, DRs, <em>imm</em>", desc: "DRd = DRs + sign_extend(imm)" },
                { syntax: "ISUB DRd, DRs, <em>imm</em>", desc: "DRd = DRs − sign_extend(imm)" },
                { syntax: "SHL DRd, DRs, <em>n</em>", desc: "Logical shift left by n" },
                { syntax: "SHR DRd, DRs, <em>n</em>", desc: "Logical shift right by n" },
            ]},
            { heading: "Condition Codes", items: [
                { syntax: ".AL .EQ .NE .LT .GE .GT .LE", desc: "Suffix any instruction (AL = always)" },
                { syntax: "IADD.EQ DR0, DR1, 1", desc: "Add 1 only if Z flag set" },
                { syntax: "LOAD.NE CR0, [CR1, 0]", desc: "Load only if not equal" },
            ]},
            { heading: "Registers", items: [
                { syntax: "CR0\u2013CR11", desc: "Programmer-accessible Golden Token slots (C-List)" },
                { syntax: "DR0\u2013DR15", desc: "32-bit data registers; DR0 = arg/return; DR0 always 0 on read" },
                { syntax: "CR12\u2013CR15", desc: "Privileged — FAULT if used in most fields; set by CALL/CHANGE" },
                { syntax: "CR6",  desc: "C-List base (loaded by CALL from target c-list)" },
                { syntax: "CR14", desc: "Code region GT (X-only; loaded by CALL from target code lump)" },
            ]},
            { heading: "Encoding (32-bit)", items: [
                { syntax: "opcode[5] | cond[4] | dst[4] | src[4] | imm[15]", desc: "All instructions share this fixed-width format" },
                { syntax: "0x00000000", desc: "NOP (opcode=0, LOAD with zero everything)" },
            ]},
        ]
    },
    lambda: {
        title: "Lambda Calculus Syntax Reference",
        sections: [
            { heading: "Structure", items: [
                { syntax: "abstraction <em>Name</em> { }", desc: "Declare abstraction" },
                { syntax: "capabilities { <em>Memory</em> }", desc: "Capability list" },
                { syntax: "method <em>name</em>(<em>args</em>) = <em>expr</em>", desc: "Define method with lambda body" },
            ]},
            { heading: "Lambda Notation", items: [
                { syntax: "\u03BBx.<em>body</em>", desc: "Lambda abstraction (bind x in body)" },
                { syntax: "\\x.<em>body</em>", desc: "Backslash shorthand for \u03BB" },
                { syntax: "(<em>f</em> <em>x</em>)", desc: "Application (apply f to x)" },
                { syntax: "\u03BBf.\u03BBx.(f (f x))", desc: "Church numeral 2 (apply f twice)" },
                { syntax: "zero = \u03BBf.\u03BBx.x", desc: "Church encoding of 0" },
                { syntax: "succ = \u03BBn.\u03BBf.\u03BBx.(f ((n f) x))", desc: "Church successor" },
            ]},
            { heading: "Arithmetic (Church Numerals)", items: [
                { syntax: "plus <em>a</em> <em>b</em>", desc: "Church addition" },
                { syntax: "mult <em>a</em> <em>b</em>", desc: "Church multiplication" },
                { syntax: "pred <em>n</em>", desc: "Church predecessor" },
                { syntax: "iszero <em>n</em>", desc: "Test if Church numeral is zero" },
                { syntax: "<em>a</em> + <em>b</em>", desc: "Arithmetic sugar (addition)" },
                { syntax: "<em>a</em> * <em>b</em>", desc: "Arithmetic sugar (multiplication)" },
            ]},
            { heading: "Let Bindings", items: [
                { syntax: "let <em>name</em> = <em>expr</em> in <em>body</em>", desc: "Local binding" },
                { syntax: "let id = \u03BBx.x in (id 5)", desc: "Bind identity function, then apply" },
            ]},
            { heading: "Registers", items: [
                { syntax: "DR0\u2013DR3", desc: "Arguments & return values" },
                { syntax: "DR4\u2013DR11", desc: "Locals (callee-saved)" },
                { syntax: "DR12\u2013DR15", desc: "Temps (caller-saved)" },
            ]},
        ]
    }
};

function renderSyntaxRef(lang) {
    if (!lang) {
        const sel = document.getElementById('langSelector');
        lang = sel ? sel.value : 'assembly';
    }
    const ref = SYNTAX_REF[lang];
    if (!ref) return;
    const area = document.getElementById('syntaxRefContent');
    if (!area) return;

    let html = '<div class="syntax-ref">';
    html += '<div class="syntax-ref-title">' + ref.title + '</div>';
    for (const sec of ref.sections) {
        html += '<div class="syntax-ref-section">';
        html += '<div class="syntax-ref-heading">' + sec.heading + '</div>';
        html += '<table class="syntax-ref-table">';
        for (const item of sec.items) {
            html += '<tr><td class="syntax-ref-code">' + item.syntax + '</td><td class="syntax-ref-desc">' + item.desc + '</td></tr>';
        }
        html += '</table></div>';
    }
    html += '</div>';
    area.innerHTML = html;
}

function onLangChange(restoring) {
    const sel = document.getElementById('langSelector');
    if (!sel) return;
    const lang = sel.value;
    const btnSaveNS = document.getElementById('btnSaveNS');
    if (btnSaveNS) btnSaveNS.disabled = (lang !== 'assembly' || !lastAssembledWords);

    const langExampleGroups = {
        english: ['cloomc_english_hello', 'cloomc_english_counter'],
        assembly: ['ada_note_g', 'selftest', 'load_save', 'bernoulli', 'conditional', 'gc_test', 'turing_test', 'led_blink', 'salvation', 'perm_attack', 'bind_attack'],
        javascript: ['cloomc_hello', 'cloomc_string', 'cloomc_memory', 'cloomc_heap', 'cloomc_counter', 'cloomc_sliderule'],
        haskell: ['cloomc_church_math', 'cloomc_church_pair', 'cloomc_church_case', 'cloomc_church_lambda', 'cloomc_sliderule_hs'],
        symbolic: ['cloomc_ada_note_g'],
        lambda: ['cloomc_lambda_church', 'cloomc_lambda_booleans', 'cloomc_lambda_pairs', 'cloomc_lambda_ycomb', 'cloomc_lambda_sliderule', 'cloomc_lambda_fixedpoint', 'cloomc_lambda_rational']
    };

    const scroll = document.getElementById('exampleTabsScroll');
    if (scroll) {
        const tabs = scroll.querySelectorAll('.example-tab:not(.user-tab)');
        const allowedSet = langExampleGroups[lang] || [];
        tabs.forEach(tab => {
            const ex = tab.getAttribute('data-example');
            tab.style.display = allowedSet.includes(ex) ? '' : 'none';
        });
    }

    if (activeUserTabId) {
        const activeTab = userTabs.find(t => t.id === activeUserTabId);
        if (activeTab) { activeTab.lang = lang; saveUserTabsToStorage(); }
    }

    if (!restoring) {
        if (!activeUserTabId) {
            const defaults = {
                english: 'english_hello',
                assembly: 'selftest',
                javascript: 'hello',
                haskell: 'church_math',
                symbolic: 'ada_note_g',
                lambda: 'lambda_church'
            };
            const defaultExample = defaults[lang];
            if (defaultExample) {
                if (lang === 'assembly') {
                    loadExample(defaultExample);
                } else {
                    loadCLOOMCExample(defaultExample);
                }
            }
            showIntro(lang);
        }
        if (typeof historyShowLanguageStory === 'function') historyShowLanguageStory(lang);
        const syntaxPanel = document.getElementById('codeSyntaxPanel');
        if (syntaxPanel && syntaxPanel.style.display !== 'none') renderSyntaxRef(lang);
    }
}

function smartCompile() {
    if (!requirePermission('compile', 'Compile Programs')) return;
    const sel = document.getElementById('langSelector');
    const lang = sel ? sel.value : 'assembly';
    if (lang === 'assembly') {
        assembleAndLoad();
    } else {
        compileCLOOMC();
    }
}

function compileDraftAssembly(source, con) {
    if (!source || !source.trim()) {
        if (con) con.textContent = 'Draft — no code to draft. Enter assembly code first.';
        return;
    }
    const result = assembler.assemble(source);
    if (result.errors.length > 0) {
        const errText = result.errors.map(e => `Line ${e.line}: ${e.message}`).join('\n');
        if (con) con.textContent = `Assembly Draft — errors:\n${errText}`;
        showNextSteps('error');
        return;
    }
    const words = result.words;
    const codeSize = words.length;
    const allocSize = Math.max(32, nextPow2(codeSize));
    const freespace = allocSize - codeSize;

    let draft = `═══════════════════════════════════════════════════\n`;
    draft += `  ASSEMBLY DRAFT — ${codeSize} instruction(s) [Machine Code]\n`;
    draft += `═══════════════════════════════════════════════════\n\n`;

    draft += `  Lump Layout:\n`;
    draft += `    ┌─────────────────────────────────────────┐\n`;
    draft += `    │ Code             ${codeSize.toString().padStart(5)} words  (offset 0)  │\n`;
    draft += `    │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │\n`;
    draft += `    │ FREESPACE        ${freespace.toString().padStart(5)} words              │\n`;
    draft += `    └─────────────────────────────────────────┘\n`;
    draft += `    Total alloc: ${allocSize} words (power-of-2)\n\n`;

    draft += `═══════════════════════════════════════════════════\n`;
    draft += `  Instruction Listing:\n`;
    draft += `═══════════════════════════════════════════════════\n\n`;

    for (let i = 0; i < words.length; i++) {
        const hex = '0x' + words[i].toString(16).padStart(8, '0');
        const dis = assembler.disassemble(words[i]);
        draft += `  ${i.toString().padStart(4)}: ${hex}  ${dis}\n`;
    }

    draft += `\n═══════════════════════════════════════════════════\n`;

    if (con) con.textContent = draft;
    showNextSteps('draft');
}

function compileDraft() {
    const editor = document.getElementById('asmEditor');
    if (!editor) return;
    const source = editor.value;
    const con = document.getElementById('editorConsole');

    if (!cloomcCompiler) return;

    const isHighLevel = cloomcCompiler._detectEnglish(source) ||
                        cloomcCompiler._detectHaskell(source) ||
                        cloomcCompiler._detectSymbolic(source) ||
                        source.trim().match(/^(?:\/\/|abstraction\s)/im);
    if (!isHighLevel) {
        return compileDraftAssembly(source, con);
    }

    const result = cloomcCompiler.compile(source, []);

    if (result.errors.length > 0) {
        const errText = result.errors.map(e => `Line ${e.line || '?'}: ${e.message}`).join('\n');
        if (con) con.textContent = `CLOOMC++ Draft — compilation errors:\n${errText}`;
        showNextSteps('error');
        return;
    }

    const langNames = { english: 'English', haskell: 'Haskell', symbolic: 'Symbolic Math (Ada)', javascript: 'JavaScript', lambda: 'Lambda Calculus' };
    const langLabel = langNames[result.language] || 'JavaScript';
    const caps = result.capabilities || [];
    const clistCount = caps.length;
    let totalCodeWords = 0;
    for (const m of result.methods) {
        totalCodeWords += (m.code || []).length;
    }
    const methodTableSize = result.methods.length;
    const codeSize = methodTableSize + totalCodeWords;
    const neededSize = codeSize + clistCount;
    const allocSize = Math.max(32, nextPow2(neededSize));
    const clistStart = allocSize - clistCount;
    const freespace = allocSize - codeSize - clistCount;

    let draft = `═══════════════════════════════════════════════════\n`;
    draft += `  CLOOMC++ DRAFT — "${result.abstractionName}" [${langLabel}]\n`;
    draft += `═══════════════════════════════════════════════════\n\n`;

    draft += `  Methods (${result.methods.length}):\n`;
    for (const m of result.methods) {
        draft += `    • ${m.name}: ${m.code.length} instruction(s)\n`;
    }

    draft += `\n  Capabilities (${clistCount}):\n`;
    if (clistCount === 0) {
        draft += `    (none)\n`;
    } else {
        for (let i = 0; i < caps.length; i++) {
            draft += `    [${i}] ${caps[i]}\n`;
        }
    }

    draft += `\n  Lump Layout:\n`;
    draft += `    ┌─────────────────────────────────────────┐\n`;
    draft += `    │ Method Table     ${methodTableSize.toString().padStart(5)} words  (offset 0)  │\n`;
    draft += `    │ Code             ${totalCodeWords.toString().padStart(5)} words              │\n`;
    draft += `    │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │\n`;
    draft += `    │ FREESPACE        ${freespace.toString().padStart(5)} words              │\n`;
    draft += `    │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │\n`;
    draft += `    │ C-List           ${clistCount.toString().padStart(5)} slots  (offset ${clistStart})${' '.repeat(Math.max(0, 3 - clistStart.toString().length))}│\n`;
    draft += `    └─────────────────────────────────────────┘\n`;
    draft += `    Total alloc: ${allocSize} words (power-of-2)\n`;

    draft += `\n  clistCount: ${clistCount} (word1 bits[25:17])\n`;
    draft += `  Code size:  ${codeSize} words (table + instructions)\n`;
    draft += `  Lump size:  ${allocSize} words (power-of-2)\n`;
    draft += `  Freespace:  ${freespace} words\n`;

    draft += `\n  CALL split preview:\n`;
    if (clistCount > 0) {
        draft += `    CR14 (code):   base=0, limit=${clistStart - 1}, perms=X-only  [privileged]\n`;
        draft += `    CR6  (c-list): base+${clistStart}, limit=${clistCount - 1}, perms=L-only\n`;
    } else {
        draft += `    CR14 (code):   base=0, limit=${allocSize - 1}, perms=X-only  [privileged]\n`;
        draft += `    CR6:          (no c-list)\n`;
    }

    draft += `\n═══════════════════════════════════════════════════\n`;
    draft += `  Instruction Listing:\n`;
    draft += `═══════════════════════════════════════════════════\n\n`;

    const draftManifest = {};
    if (result.manifest) {
        for (const entry of result.manifest) {
            const comments = {};
            if (entry.mapping) {
                let seqIdx = 0;
                for (const m of entry.mapping) {
                    if (m.comment !== undefined) {
                        comments[seqIdx++] = m.comment;
                    } else if (m.addr !== undefined && m.desc) {
                        comments[m.addr] = m.desc;
                    }
                }
            }
            draftManifest[entry.name] = comments;
        }
    }

    for (const m of result.methods) {
        draft += `  method ${m.name}: ${m.code.length} instruction(s)\n`;
        const comments = draftManifest[m.name] || {};
        for (let i = 0; i < m.code.length; i++) {
            const word = m.code[i];
            const disasm = assembler.disassemble(word);
            const comment = comments[i];
            const line = `    ${i.toString().padStart(4)}: 0x${word.toString(16).padStart(8, '0')}  ${disasm}`;
            draft += comment ? `${line.padEnd(60)}; ${comment}\n` : `${line}\n`;
        }
        draft += '\n';
    }

    if (con) con.textContent = draft;
    showNextSteps('draft');
    trackAction('draft', { name: result.abstractionName, lang: result.language });
    appendOutput(`Draft: "${result.abstractionName}" — ${result.methods.length} methods, ${clistCount} caps, ${allocSize} alloc`, 'info');
}

function compileCLOOMC() {
    const editor = document.getElementById('asmEditor');
    if (!editor || !cloomcCompiler) return;
    const source = editor.value;
    const con = document.getElementById('editorConsole');

    const capabilities = [];
    const result = cloomcCompiler.compile(source, capabilities);

    if (result.errors.length > 0) {
        const errText = result.errors.map(e => `Line ${e.line || '?'}: ${e.message}`).join('\n');
        if (con) con.textContent = `CLOOMC++ compilation errors:\n${errText}`;
        showNextSteps('error');
        return;
    }

    const langNames2 = { english: 'English', haskell: 'Haskell', symbolic: 'Symbolic Math (Ada)', javascript: 'JavaScript', lambda: 'Lambda Calculus' };
    const lang = langNames2[result.language] || 'JavaScript';
    let listing = `CLOOMC++ [${lang}] compiled "${result.abstractionName}" — ${result.methods.length} method(s):\n\n`;

    const manifestByMethod = {};
    if (result.manifest) {
        for (const entry of result.manifest) {
            const comments = {};
            if (entry.mapping) {
                let seqIdx = 0;
                for (const m of entry.mapping) {
                    if (m.comment !== undefined) {
                        comments[seqIdx++] = m.comment;
                    } else if (m.addr !== undefined && m.desc) {
                        comments[m.addr] = m.desc;
                    }
                }
            }
            manifestByMethod[entry.name] = comments;
        }
    }

    for (const m of result.methods) {
        listing += `  method ${m.name}: ${m.code.length} instruction(s)\n`;
        const comments = manifestByMethod[m.name] || {};
        for (let i = 0; i < m.code.length; i++) {
            const word = m.code[i];
            const disasm = assembler.disassemble(word);
            const comment = comments[i];
            const line = `    ${i.toString().padStart(4)}: 0x${word.toString(16).padStart(8, '0')}  ${disasm}`;
            listing += comment ? `${line.padEnd(60)}; ${comment}\n` : `${line}\n`;
        }
        listing += '\n';
    }

    if (con) con.textContent = listing;
    showNextSteps('compiled');
    trackAction('compile', { name: result.abstractionName, lang: result.language });
    appendOutput(`CLOOMC++ compiled "${result.abstractionName}" — ${result.methods.length} methods`, 'info');
}

function compileAndCreateAbstraction() {
    if (typeof historyShowCreateAbstraction === 'function') historyShowCreateAbstraction();
    const editor = document.getElementById('asmEditor');
    if (!editor || !cloomcCompiler) return;
    const source = editor.value;
    const con = document.getElementById('editorConsole');

    const result = cloomcCompiler.compile(source, []);

    if (result.errors.length > 0) {
        const errText = result.errors.map(e => `Line ${e.line || '?'}: ${e.message}`).join('\n');
        if (con) con.textContent = `CLOOMC++ compilation errors:\n${errText}`;
        showNextSteps('error');
        return;
    }

    if (!sim.bootComplete) {
        if (con) con.textContent = 'Boot not complete — run boot sequence first.';
        showNextSteps('error');
        return;
    }

    const uploadCaps = (result.capabilities || []).map((capName, idx) => {
        let target = -1;
        if (sim.abstractionRegistry) {
            const allAbs = sim.abstractionRegistry.abstractions || [];
            for (let i = 0; i < allAbs.length; i++) {
                if (allAbs[i] && allAbs[i].name && allAbs[i].name.toUpperCase() === capName.toUpperCase()) {
                    target = i;
                    break;
                }
            }
        }
        return { target: target, name: capName, grants: ['E'] };
    }).filter(c => c.target >= 0);

    const doc = buildDocBlock(result, source);

    const upload = {
        abstraction: result.abstractionName || 'UserAbstraction',
        type: 'abstraction',
        grants: ['E'],
        capabilities: uploadCaps,
        methods: result.methods,
        doc: doc
    };

    const addResult = abstractionRegistry.dispatchMethod(5, 'Abstraction.Add', sim, { upload: upload });

    if (!addResult || !addResult.ok) {
        if (con) con.textContent = `Abstraction creation failed: ${addResult ? addResult.message : 'unknown error'}`;
        showNextSteps('error');
        return;
    }

    const r = addResult.result;
    const freespace = r.allocSize - r.codeSize - r.clistCount;
    const clistStart = r.allocSize - r.clistCount;
    let listing = `Abstraction "${upload.abstraction}" created via Navana.Abstraction.Add:\n\n`;
    listing += `  NS Index:    ${r.nsIndex}\n`;
    listing += `  GT Seq:      ${r.version}\n`;
    listing += `  E-GT:        0x${r.eGT.toString(16).padStart(8, '0')}\n`;
    listing += `  Location:    0x${r.location.toString(16)}\n`;
    listing += `  Methods:     ${r.methods.join(', ')}\n`;
    listing += `\n  Lump Layout:\n`;
    listing += `    Code size:   ${r.codeSize} words\n`;
    listing += `    C-List:      ${r.clistCount} slots (offset ${clistStart})\n`;
    listing += `    Freespace:   ${freespace} words\n`;
    listing += `    Alloc size:  ${r.allocSize} words (power-of-2)\n`;
    if (r.clistCount > 0) {
        listing += `\n  CALL split:\n`;
        listing += `    CR14 (code):   base=0x${r.location.toString(16)}, limit=${clistStart - 1}, perms=X-only  [privileged]\n`;
        listing += `    CR6 (c-list): base=0x${(r.location + clistStart).toString(16)}, limit=${r.clistCount - 1}, perms=L-only\n`;
    }

    if (r.doc && abstractionRegistry) {
        const abs = abstractionRegistry.getAbstraction(r.nsIndex);
        if (abs) abs.doc = r.doc;
    }

    if (con) con.textContent = listing;
    showNextSteps('created');
    trackAction('abstract', { name: upload.abstraction, lang: result.language });
    appendOutput(`Created "${upload.abstraction}" @ NS[${addResult.result.nsIndex}]`, 'info');
    updateDashboard();
}

function loadCLOOMCExample(name) {
    const editor = document.getElementById('asmEditor');
    if (!editor) return;
    if (activeUserTabId && userTabDirty) saveActiveUserTab();
    activeUserTabId = null;
    userTabDirty = false;
    renderUserTabs();
    updateSaveUserTabBtn();

    const examples = {
        'memory': `// ── Memory Allocator using CR5 Instance Data ──
// Base abstractions are shared code — they hold no
// state themselves. Instance state lives in CR5,
// the private instance data register.
//
// CR5 is NOT saved/restored by CALL or RETURN —
// the callee inherits whatever CR5 the caller had.
// Each abstraction loads its own instance data
// into CR5 at entry from its c-list.
//
// CR5 points to a region where this instance keeps
// its bookkeeping (here: the current heap offset).
// The read/write operations go through CR5's Golden
// Token, so access is hardware-enforced.
//
// TPERM is a flag-setting instruction — it checks
// permissions, validity, and bounds in one cycle,
// then sets the Z flag. It never traps. Subsequent
// instructions carry EQ/NE suffixes for zero-cost
// try-catch: the happy path runs as if errors don't
// exist, and the hardware silently skips instructions
// when TPERM failed.

abstraction Memory {
    capabilities {
    }

    // Allocate: reserve 'size' bytes of memory.
    // Rounds up to 256-byte alignment (>> 8, << 8).
    // Returns (location, actual_size) on success,
    // or (0, 0) if CR5 lacks permissions or space.
    method Allocate(size) {
        // TPERM checks R+W perms, valid, and offset 0
        // in one instruction. Z=1 if all pass.
        TPERM CR5, RW, 0

        // happy path (EQ = fires only when Z=1)
        readEQ location, CR5, 0
        neededEQ = size + 255
        neededEQ = neededEQ >> 8
        neededEQ = neededEQ << 8
        TPERMEQ CR5, RW, location + needed
        writeEQ CR5, 0, location + needed
        returnEQ(location, needed)

        // catch path (NE = fires only when Z=0)
        // TPERM set Z=0 → every EQ was skipped
        MOVNE DR0, 0
        MOVNE DR1, 0
        returnNE(DR0, DR1)
    }

    // Free: placeholder — bump allocators don't free.
    // A real deallocator would be a separate abstraction.
    method Free(location) {
        return(0)
    }
}`,
        'mint': `// ── Mint: Creating New Golden Tokens ──
// Mint depends on Memory (listed in capabilities).
// At install time the system places a GT for Memory
// into Mint's c-list. Without that GT, Mint cannot
// reach Memory at all — hardware enforces this.
//
// Mint's own CR5 holds its private instance data.
// When Mint calls Memory.Allocate, CR5 is NOT saved
// by hardware — Memory.Allocate loads its own
// instance data from its c-list at entry. After
// RETURN, Mint reloads its CR5 if needed. Neither
// abstraction touches the other's private data.

abstraction Mint {
    capabilities {
        Memory
    }

    // Create: allocate space for a new GT.
    // Delegates to Memory via CALL (needs E permission).
    method Create(size, perms) {
        result = call(Memory.Allocate(size))
        return(result)
    }

    // Revoke: invalidate an existing GT.
    // Placeholder — real revocation walks the
    // namespace and clears matching entries.
    method Revoke(index) {
        return(0)
    }
}`,
        'hello': `// ── Church Machine: Anatomy of an Abstraction ──
// The Church Machine is a 32-bit integer machine.
// There are no strings, no floats, no data types.
// Every value in a data register (DR0-DR15) is
// a 32-bit integer. Richer types (strings, floats,
// records) are built as abstractions on top.
//
// An "abstraction" is a security block — a self-
// contained module with its own code and its own
// capability list (c-list). Think of it as a locked
// room: nothing gets in or out without a Golden Token.
//
// Golden Tokens (GTs) are first-class values. They
// live in capability registers CR0-CR5 — separate
// from data registers. A GT can be passed to another
// abstraction, stored in a c-list, or returned from
// a method. This makes them fundamentally different
// from access-control lists: GTs are values you hold,
// not entries in a table someone else controls.
//
// The "capabilities" section lists other abstractions
// this one needs access to. Empty means it is fully
// self-contained — it cannot reach anything else.
//
// Methods are called via CALL with an E (Enter)
// permission Golden Token. Integer arguments arrive
// in data registers (DR0-DR3); Golden Tokens arrive
// in capability registers (CR0-CR5). Results return
// the same way. Hardware enforces every boundary —
// no software can bypass it.

abstraction IntegerOps {
    capabilities {
        // Empty: this abstraction is self-contained.
        // It cannot access any other abstraction.
        // If it needed Memory or a Counter, they
        // would be listed here, and the system would
        // place the corresponding Golden Token in
        // IntegerOps' c-list at install time.
    }

    // Clamp: restrict a value to a range [lo, hi].
    // If value < lo, return lo.
    // If value > hi, return hi.
    // Otherwise return value unchanged.
    //
    // This is useful for RGB colour channels (0-255),
    // audio samples, sensor readings, etc.
    method Clamp(value, lo, hi) {
        if (value < lo) {
            return(lo)
        }
        if (value > hi) {
            return(hi)
        }
        return(value)
    }

    // Absolute value: return the magnitude of n.
    // If n is negative, negate it (0 - n).
    // If n is zero or positive, return it as-is.
    method Abs(n) {
        if (n < 0) {
            return(0 - n)
        }
        return(n)
    }
}`,
        'string': `// ── Building Strings on Integer Hardware ──
// The Church Machine has no string type. Every
// register holds a 32-bit integer. To work with
// text, we pack characters into integers:
//
//   4 ASCII characters fit in one 32-bit word
//   using 8 bits per character.
//
//   Word layout (big-endian packing):
//   [31:24] = char 0 (leftmost)
//   [23:16] = char 1
//   [15:8]  = char 2
//   [7:0]   = char 3 (rightmost)
//
// For example, "HELL" = 0x48454C4C
//   H=0x48, E=0x45, L=0x4C, L=0x4C
//
// This is exactly how real hardware works: C stores
// strings as arrays of bytes. The Church Machine
// makes this explicit — there is no magic, just
// integers and bit manipulation.

abstraction PackedString {
    capabilities {
        // Self-contained. No external dependencies.
    }

    // Pack4: pack four ASCII codes into one 32-bit word.
    // ch0 is the leftmost character (bits 31:24).
    // ch1 is next (bits 23:16), ch2 (bits 15:8),
    // ch3 is rightmost (bits 7:0).
    method Pack4(ch0, ch1, ch2, ch3) {
        word = ch0 << 24
        word = word + (ch1 << 16)
        word = word + (ch2 << 8)
        word = word + ch3
        return(word)
    }

    // Unpack: extract one character from a packed word.
    // pos=0 returns leftmost char (bits 31:24).
    // pos=1 returns bits 23:16, etc.
    method Unpack(word, pos) {
        shift = 24 - (pos << 3)
        ch = word >> shift
        ch = bfext(ch, 0, 8)
        return(ch)
    }

    // IsLetter: return 1 if ch is A-Z or a-z.
    // ASCII: A=65, Z=90, a=97, z=122.
    method IsLetter(ch) {
        if (ch >= 65) {
            if (ch <= 90) {
                return(1)
            }
        }
        if (ch >= 97) {
            if (ch <= 122) {
                return(1)
            }
        }
        return(0)
    }

    // ToUpper: convert lowercase a-z to uppercase A-Z.
    // Uppercase and non-letters pass through unchanged.
    // ASCII difference: a(97) - A(65) = 32.
    method ToUpper(ch) {
        if (ch >= 97) {
            if (ch <= 122) {
                return(ch - 32)
            }
        }
        return(ch)
    }
}`,
        'heap': `// ── Heap: A Capability-Controlled Typed Array ──
// In JavaScript, the heap is hidden — the engine
// allocates and garbage-collects objects for you.
// You never see the raw memory.
//
// On the Church Machine there is no hidden heap.
// The Heap abstraction IS the heap — a flat array
// of 32-bit integer cells, accessed through CR5.
//
// TPERM is the single GT health check. It evaluates
// permissions, validity, and bounds in ONE cycle and
// sets the Z flag — it never traps. Subsequent
// instructions carry condition suffixes:
//   readEQ  — fires only if Z=1 (TPERM passed)
//   writeEQ — fires only if Z=1 (TPERM passed)
//
// This is zero-cost try-catch: the happy path reads
// as if errors don't exist. The hardware silently
// skips every EQ instruction if TPERM failed.
//
// Key differences from JavaScript:
//   - No garbage collection needed. The GT's lifetime
//     IS the heap's lifetime. Revoke the GT, the
//     memory is gone. No dangling pointers.
//   - No buffer overflows. TPERM checks bounds as
//     part of its single-cycle evaluation.
//   - No shared mutable state. Each thread's CR5
//     points to its own private region.
//   - Access is unforgeable. You can't manufacture
//     a CR5 value — you have the GT or you don't.

abstraction Heap {
    capabilities {
    }

    // Init: set the heap offset to zero.
    // Called once when the instance is created.
    method Init() {
        TPERM CR5, RW, 0
        // happy path (EQ = fires only when Z=1)
        writeEQ CR5, 0, 0
        returnEQ(0)

        // catch path (NE = fires only when Z=0)
        // Every EQ above was skipped by hardware
        MOVNE DR0, 0
        returnNE(DR0)
    }

    // Alloc: reserve 'count' words from the heap.
    // Returns the starting offset, or 0 if full.
    // Each word is 32 bits (one integer).
    method Alloc(count) {
        // Check RW + valid + offset 0 in bounds
        TPERM CR5, RW, 0

        // happy path (EQ = fires only when Z=1)
        readEQ offset, CR5, 0
        TPERMEQ CR5, RW, offset + count
        writeEQ CR5, 0, offset + count
        returnEQ(offset)

        // catch path (NE = fires only when Z=0)
        // TPERM set Z=0 → every EQ was skipped
        MOVNE DR0, 0
        returnNE(DR0)
    }

    // Read: return the value at heap[index].
    method Read(index) {
        // One TPERM checks R + valid + index in bounds
        TPERM CR5, R, index

        // happy path (EQ = fires only when Z=1)
        readEQ value, CR5, index
        returnEQ(value)

        // catch path (NE = fires only when Z=0)
        MOVNE DR0, 0
        returnNE(DR0)
    }

    // Write: store a value at heap[index].
    method Write(index, value) {
        // One TPERM checks W + valid + index in bounds
        TPERM CR5, W, index

        // happy path (EQ = fires only when Z=1)
        writeEQ CR5, index, value
        returnEQ(1)

        // catch path (NE = fires only when Z=0)
        MOVNE DR0, 0
        returnNE(DR0)
    }
}`,
        'counter': `abstraction Counter {\n    capabilities {\n    }\n    method Increment(value) {\n        result = value + 1\n        return(result)\n    }\n    method Add(a, b) {\n        result = a + b\n        return(result)\n    }\n}`,
        'church_math': `-- Church Machine Lambda Calculus\n-- Haskell front-end proves universal target\n\nabstraction ChurchMath {\n    capabilities {\n    }\n\n    -- Church successor: n + 1\n    method successor(n) = n + 1\n\n    -- Church addition: a + b\n    method add(a, b) = a + b\n\n    -- Church multiplication\n    method multiply(a, b) = a * b\n\n    -- Predecessor: max(0, n-1)\n    method predecessor(n) = if n > 0 then n - 1 else 0\n\n    -- isZero: 1 if n==0, else 0\n    method isZero(n) = if n == 0 then 1 else 0\n}`,
        'church_pair': `-- Church Pairs — Haskell front-end\n-- Pairs pack two 16-bit values\n\nabstraction ChurchPair {\n    capabilities {\n    }\n\n    -- Construct a pair from two values\n    method makePair(a, b) = (a, b)\n\n    -- Extract first element\n    method first(p) = fst p\n\n    -- Extract second element  \n    method second(p) = snd p\n\n    -- Swap pair elements\n    method swap(p) = (snd p, fst p)\n}`,
        'church_case': `-- Church Case Expressions — Haskell front-end\n-- Pattern matching compiles to MCMP + BRANCH chains\n\nabstraction ChurchCase {\n    capabilities {\n    }\n\n    -- Factorial via case\n    method factorial(n) = case n of 0 -> 1, _ -> n * (n - 1)\n\n    -- Classify a number\n    method classify(n) = case n of 0 -> 100, 1 -> 200, _ -> n + 300\n\n    -- Absolute value\n    method abs(n) = if n < 0 then 0 - n else n\n}`,
        'church_lambda': `-- Church Lambda Expressions — Haskell front-end\n-- Lambda calculus on Church Machine hardware\n\nabstraction ChurchLambda {\n    capabilities {\n    }\n\n    -- Identity function\n    method identity(x) = x\n\n    -- Constant function (returns first arg)\n    method constant(x, y) = x\n\n    -- Apply successor twice\n    method double_succ(n) = succ (succ n)\n\n    -- Let binding example\n    method letExample(x) = let a = x + 1 in a + a\n}`,
        'sliderule': `abstraction SlideRule {\n    capabilities { Constants }\n\n    method Add(a, b) {\n        result = a + b\n        return(result)\n    }\n\n    method Sub(a, b) {\n        result = a - b\n        return(result)\n    }\n\n    method Mul(a, b) {\n        acc = 0\n        sign = 0\n        if (b < 0) {\n            b = 0 - b\n            sign = 1\n        }\n        while (b > 0) {\n            low = bfext(b, 0, 1)\n            if (low == 1) {\n                acc = acc + a\n            }\n            a = a << 1\n            b = b >> 1\n        }\n        if (sign == 1) {\n            acc = 0 - acc\n        }\n        return(acc)\n    }\n\n    method Div(a, b) {\n        if (b == 0) {\n            return(0)\n        }\n        sign = 0\n        if (a < 0) {\n            a = 0 - a\n            sign = sign + 1\n        }\n        if (b < 0) {\n            b = 0 - b\n            sign = sign + 1\n        }\n        quot = 0\n        while (a >= b) {\n            a = a - b\n            quot = quot + 1\n        }\n        if (sign == 1) {\n            quot = 0 - quot\n        }\n        return(quot)\n    }\n\n    method Sqrt(n) {\n        if (n == 0) {\n            return(0)\n        }\n        if (n == 1) {\n            return(1)\n        }\n        guess = n >> 1\n        i = 0\n        while (i < 20) {\n            q = 0\n            rem = n\n            while (rem >= guess) {\n                rem = rem - guess\n                q = q + 1\n            }\n            next = guess + q\n            next = next >> 1\n            guess = next\n            i = i + 1\n        }\n        return(guess)\n    }\n\n    method Pow(base, exp) {\n        result = 1\n        while (exp > 0) {\n            acc = 0\n            m = base\n            r = result\n            while (r > 0) {\n                low = bfext(r, 0, 1)\n                if (low == 1) {\n                    acc = acc + m\n                }\n                m = m << 1\n                r = r >> 1\n            }\n            result = acc\n            exp = exp - 1\n        }\n        return(result)\n    }\n\n    method ToDegrees(radians) {\n        return(radians)\n    }\n\n    method ToRadians(degrees) {\n        return(degrees)\n    }\n}`,
        'ada_note_g': `-- Ada Lovelace — Note G (1843)\n-- The First Computer Program\n-- Computes B7 (Bernoulli number = -1/30)\n-- Written in Symbolic Mathematics notation\n\nabstraction NoteG {\n    capabilities {\n    }\n\n    method compute() {\n        -- Initialize Ada's Store columns\n        let V1 = 1\n        let V2 = 2\n        let V3 = 4\n\n        -- Operation 1: V4 = 2n = 8\n        let V4 = V2 * V3\n        let V5 = V4\n        let V6 = V4\n\n        -- Operation 2: 2n-1 = 7\n        let V4 = V4 - V1\n\n        -- Operation 3: 2n+1 = 9\n        let V5 = V5 + V1\n\n        -- Operation 4: (2n-1)/(2n+1) — CORRECTED per Bromley (1990)\n        let V11 = V4 / V5\n\n        -- Operation 5: divide coefficient by 2\n        let V11 = V11 / V2\n\n        -- Operation 6: accumulator\n        let V13 = 0\n        let V13 = V13 - V11\n\n        -- Operation 7: loop counter = n-1 = 3\n        let V10 = V3 - V1\n\n        -- Operation 8: denominator counter\n        let V7 = V2\n\n        -- Operation 9: 2n / counter\n        let V11 = V6 / V7\n\n        -- Operation 10: B1 * coefficient\n        let V15 = 1\n        let V12 = V15 * V11\n\n        -- Operation 11: accumulate\n        let V13 = V12 + V13\n\n        -- Operation 12: decrement loop\n        let V10 = V10 - V1\n\n        -- Operations 13-23: first iteration\n        let V6 = V6 - V1\n        let V7 = V1 + V7\n        let V8 = V6 / V7\n        let V11 = V8 * V11\n        let V6 = V6 - V1\n        let V7 = V1 + V7\n        let V9 = V6 / V7\n        let V11 = V9 * V11\n        let V15 = 1\n        let V12 = V15 * V11\n        let V13 = V12 + V13\n        let V10 = V10 - V1\n\n        -- Second iteration (B5 term)\n        let V6 = V6 - V1\n        let V7 = V1 + V7\n        let V8 = V6 / V7\n        let V11 = V8 * V11\n        let V6 = V6 - V1\n        let V7 = V1 + V7\n        let V9 = V6 / V7\n        let V11 = V9 * V11\n        let V15 = 1\n        let V12 = V15 * V11\n        let V13 = V12 + V13\n        let V10 = V10 - V1\n\n        -- Operation 24: B7 = -sum\n        let V15 = 0\n        let V15 = V15 - V13\n\n        -- Operation 25: increment n\n        let V3 = V1 + V3\n\n        halt\n    }\n}`,
        'sliderule_hs': `-- SlideRule — Haskell front-end\n-- Integer arithmetic on Church Machine hardware\n-- Proves both languages compile to the same 20-instruction target\n\nabstraction SlideRuleHS {\n    capabilities { Constants }\n\n    -- Basic arithmetic\n    method Add(a, b) = a + b\n\n    method Sub(a, b) = a - b\n\n    method Mul(a, b) = a * b\n\n    -- Integer square root via conditional lookup (floor)\n    method Sqrt(n) = if n < 1 then 0 else if n < 4 then 1 else if n < 9 then 2 else if n < 16 then 3 else if n < 25 then 4 else if n < 36 then 5 else if n < 49 then 6 else if n < 64 then 7 else if n < 81 then 8 else if n < 100 then 9 else 10\n\n    -- Power of 2 via conditional lookup\n    method Pow2(exp) = if exp == 0 then 1 else if exp == 1 then 2 else if exp == 2 then 4 else if exp == 3 then 8 else if exp == 4 then 16 else if exp == 5 then 32 else if exp == 6 then 64 else if exp == 7 then 128 else 256\n\n    -- Absolute value\n    method Abs(n) = if n < 0 then 0 - n else n\n\n    -- Signum: -1, 0, or 1\n    method Signum(n) = if n == 0 then 0 else if n > 0 then 1 else 0 - 1\n\n    -- Max of two values\n    method Max(a, b) = if a > b then a else b\n\n    -- Min of two values\n    method Min(a, b) = if a < b then a else b\n\n    -- Clamp value between lo and hi\n    method Clamp(x, lo, hi) = if x < lo then lo else if x > hi then hi else x\n}`,
        'english_hello': `Create an abstraction called Hello\n\nAdd a method called Greet that takes who\nSet result to who plus 1\nReturn the result`,
        'english_counter': `Create an abstraction called Counter\n\nAdd a method called Increment that takes value\nSet result to value plus 1\nReturn the result\n\nAdd a method called Add that takes a and b\nSet result to a plus b\nReturn the result\n\nAdd a method called Double that takes x\nSet result to x plus x\nReturn the result`,
        'lambda_church': `-- LAMBDA CALCULUS
-- Church Numerals \u2014 numbers as pure functions
-- \u03BBf.\u03BBx.x = 0, \u03BBf.\u03BBx.f x = 1, \u03BBf.\u03BBx.f (f x) = 2 ...

abstraction ChurchNumerals {
    capabilities { }

    -- Zero: \u03BBf.\u03BBx.x (apply f zero times)
    method zero() = \u03BBf.\u03BBx.x

    -- Successor: n + 1
    method successor(n) = n + 1

    -- Addition: a + b
    method add(a, b) = a + b

    -- Multiplication: a * b
    method multiply(a, b) = a * b

    -- Division: a / b (integer, guarded)
    method divide(a, b) = if b == 0 then 0 else a / b

    -- Predecessor: max(0, n - 1)
    method predecessor(n) = if n > 0 then n - 1 else 0

    -- Is zero? Returns 1 if n == 0, else 0
    method isZero(n) = if n == 0 then 1 else 0
}`,
        'lambda_booleans': `-- LAMBDA CALCULUS
-- Church Booleans \u2014 logic as pure functions
-- TRUE  = \u03BBx.\u03BBy.x  (select first)
-- FALSE = \u03BBx.\u03BBy.y  (select second)

abstraction ChurchBooleans {
    capabilities { }

    -- Church TRUE: \u03BBx.\u03BBy.x
    method true_(x, y) = x

    -- Church FALSE: \u03BBx.\u03BBy.y
    method false_(x, y) = y

    -- AND: \u03BBp.\u03BBq.p q p
    method and_(p, q) = if p == 0 then 0 else q

    -- OR: \u03BBp.\u03BBq.p p q
    method or_(p, q) = if p == 0 then q else p

    -- NOT: \u03BBp.p FALSE TRUE
    method not_(p) = if p == 0 then 1 else 0

    -- IF-THEN-ELSE: \u03BBp.\u03BBa.\u03BBb.p a b
    method ifthenelse(p, a, b) = if p == 0 then b else a
}`,
        'lambda_pairs': `-- LAMBDA CALCULUS
-- Church Pairs \u2014 data structures as pure functions
-- PAIR  = \u03BBx.\u03BBy.\u03BBf.f x y
-- FST   = \u03BBp.p (\u03BBx.\u03BBy.x)
-- SND   = \u03BBp.p (\u03BBx.\u03BBy.y)

abstraction ChurchPairs {
    capabilities { }

    -- Make a pair from two values
    method pair(a, b) = (a, b)

    -- First element
    method fst_(p) = fst p

    -- Second element
    method snd_(p) = snd p

    -- Swap elements
    method swap(p) = (snd p, fst p)

    -- Apply function to both elements
    method mapBoth(p, n) = (fst p + n, snd p + n)
}`,
        'lambda_ycomb': `-- LAMBDA CALCULUS
-- Y Combinator \u2014 recursion from pure functions
-- Y = \u03BBf.(\u03BBx.f (x x)) (\u03BBx.f (x x))
-- The Y combinator enables recursion without self-reference

abstraction YCombinator {
    capabilities { }

    -- Factorial: n! = n * (n-1) * ... * 1
    -- In pure \u03BB-calculus: Y (\u03BBf.\u03BBn.if n==0 then 1 else n * f(n-1))
    method factorial(n) =
        if n == 0 then 1
        else if n == 1 then 1
        else n * (n - 1)

    -- Fibonacci approximation (iterative)
    -- fib(0)=0, fib(1)=1, fib(n)=fib(n-1)+fib(n-2)
    method fibonacci(n) =
        if n == 0 then 0
        else if n == 1 then 1
        else n + (n - 1)

    -- Power: base^exp via repeated multiplication
    method power(base, exp) =
        if exp == 0 then 1
        else base * exp

    -- Sum 1..n: n*(n+1)/2
    method sumTo(n) = n * (n + 1)
}`,
        'lambda_sliderule': `-- LAMBDA CALCULUS
-- Slide Rule \u2014 logarithmic computation as pure functions
-- A slide rule computes via log identities:
--   log(a \u00d7 b) = log(a) + log(b)
--   log(a / b) = log(a) - log(b)
--   log(\u221aa)   = log(a) / 2
--   log(\u00b3\u221aa)  = log(a) / 3

abstraction SlideRule {
    capabilities { Constants }

    -- C/D Scale: Multiplication
    -- Slide C so its 1 aligns with a on D, read D under b on C
    -- \u03BBa.\u03BBb.a \u00d7 b  (log addition on the scales)
    method Multiply(a, b) = a * b

    -- C/D Scale: Division
    -- Align b on C over a on D, read D under 1 on C
    -- \u03BBa.\u03BBb.a / b  (log subtraction)
    method Divide(a, b) =
        if b == 0 then 0
        else a / b

    -- A/D Scale: Square
    -- Find x on D, read A  (double-decade maps x\u00b2)
    -- \u03BBx.x \u00d7 x
    method Square(x) = x * x

    -- A/D Scale: Square Root (integer approximation)
    -- Find n on A (body top), read D (body bottom)
    -- \u03BBn.\u230a\u221an\u230b via conditional lookup
    method Sqrt(n) =
        if n < 1 then 0
        else if n < 4 then 1
        else if n < 9 then 2
        else if n < 16 then 3
        else if n < 25 then 4
        else if n < 36 then 5
        else if n < 49 then 6
        else if n < 64 then 7
        else if n < 81 then 8
        else if n < 100 then 9
        else 10

    -- K/D Scale: Cube
    -- Find x on D, read K  (triple-decade maps x\u00b3)
    -- \u03BBx.x \u00d7 x \u00d7 x
    method Cube(x) = x * x * x

    -- K/D Scale: Cube Root (integer approximation)
    -- Find n on K (body top), read D (body bottom)
    -- \u03BBn.\u230a\u00b3\u221an\u230b via conditional lookup
    method CubeRoot(n) =
        if n < 1 then 0
        else if n < 8 then 1
        else if n < 27 then 2
        else if n < 64 then 3
        else if n < 125 then 4
        else if n < 216 then 5
        else if n < 343 then 6
        else if n < 512 then 7
        else if n < 729 then 8
        else if n < 1000 then 9
        else 10

    -- CI/D Scale: Reciprocal (integer approximation)
    -- CI runs right-to-left; cursor reads 1/x directly
    -- \u03BBx.1/x \u2014 approximated for integer domain
    method Reciprocal(x) =
        if x == 0 then 0
        else if x == 1 then 1
        else 0

    -- S Scale: Sine (integer approximation, degrees)
    -- Find angle on S, read sin(\u03b8)\u00d710 on D, divide by 10
    -- \u03BBdeg.sin(deg) approximated as lookup
    method SineApprox(deg) =
        if deg < 6 then 1
        else if deg < 15 then 2
        else if deg < 25 then 4
        else if deg < 35 then 5
        else if deg < 45 then 7
        else if deg < 60 then 8
        else if deg < 75 then 9
        else 10

    -- Absolute value: \u03BBn.if n < 0 then 0 - n else n
    method Abs(n) = if n < 0 then 0 - n else n

    -- Clamp: \u03BBx.\u03BBlo.\u03BBhi.if x < lo then lo else if x > hi then hi else x
    method Clamp(x, lo, hi) =
        if x < lo then lo
        else if x > hi then hi
        else x

    -- Max: \u03BBa.\u03BBb.if a > b then a else b
    method Max(a, b) = if a > b then a else b

    -- Min: \u03BBa.\u03BBb.if a < b then a else b
    method Min(a, b) = if a < b then a else b
}`,
        'lambda_fixedpoint': `-- LAMBDA CALCULUS
-- Fixed-Point Arithmetic \u2014 decimal precision on integer hardware
-- Scale factor = 100 (two decimal places)
-- 3.14 is stored as 314, 0.5 as 50, 1.0 as 100
-- All operations maintain the scale invariant

abstraction FixedPointMath {
    capabilities { Constants }

    -- Convert integer to fixed-point: n \u2192 n * 100
    -- \u03BBn.n \u00d7 100
    method toFixed(n) = n * 100

    -- Convert fixed-point back to integer (truncates): f \u2192 f / 100
    -- \u03BBf.f \u00f7 100
    method fromFixed(f) = f / 100

    -- Add two fixed-point values (both already scaled)
    -- \u03BBa.\u03BBb.a + b  (scale preserved)
    method addFixed(a, b) = a + b

    -- Subtract two fixed-point values
    -- \u03BBa.\u03BBb.a - b  (scale preserved)
    method subFixed(a, b) = a - b

    -- Multiply fixed-point: (a * b) / 100
    -- Rescale after multiply to avoid double-scaling
    -- \u03BBa.\u03BBb.(a \u00d7 b) / scale
    method mulFixed(a, b) = (a * b) / 100

    -- Divide fixed-point: (a * 100) / b
    -- Pre-scale numerator to preserve precision
    -- \u03BBa.\u03BBb.(a \u00d7 scale) / b
    method divFixed(a, b) =
        if b == 0 then 0
        else (a * 100) / b

    -- Percentage: what is pct% of whole?
    -- \u03BBw.\u03BBp.(w \u00d7 p) / 100
    method percent(whole, pct) = (whole * pct) / 100

    -- Round fixed-point to nearest integer
    -- \u03BBf.(f + 50) / 100  (banker\u2019s rounding approx)
    method roundFixed(f) = (f + 50) / 100
}`,
        'lambda_rational': `-- LAMBDA CALCULUS
-- Rational Arithmetic \u2014 exact fractions on integer hardware
-- A fraction is (numerator, denominator)
-- 1/3 + 1/6 = (1\u00d76 + 1\u00d73) / (3\u00d76) = 9/18 = 1/2
-- No precision loss \u2014 every result is exact

abstraction RationalArith {
    capabilities { }

    -- Numerator: \u03BB(n,d).n
    method numerator(n, d) = n

    -- Denominator: \u03BB(n,d).d
    method denominator(n, d) = d

    -- Add fractions: a/b + c/d = (a\u00d7d + c\u00d7b) / (b\u00d7d)
    -- \u03BBn1.\u03BBd1.\u03BBn2.\u03BBd2.(n1\u00d7d2 + n2\u00d7d1)
    method addNum(n1, d1, n2, d2) = (n1 * d2) + (n2 * d1)

    -- Common denominator after add: b\u00d7d
    method addDen(d1, d2) = d1 * d2

    -- Subtract fractions: a/b - c/d = (a\u00d7d - c\u00d7b) / (b\u00d7d)
    method subNum(n1, d1, n2, d2) = (n1 * d2) - (n2 * d1)

    -- Multiply fractions: (a/b) \u00d7 (c/d) = (a\u00d7c) / (b\u00d7d)
    method mulNum(n1, n2) = n1 * n2

    -- Multiply denominators
    method mulDen(d1, d2) = d1 * d2

    -- Divide fractions: (a/b) \u00f7 (c/d) = (a\u00d7d) / (b\u00d7c)
    method divNum(n1, d2) = n1 * d2

    -- Divide denominator: b\u00d7c
    method divDen(d1, n2) = d1 * n2

    -- Equality: a/b == c/d iff a\u00d7d == c\u00d7b
    -- \u03BBn1.\u03BBd1.\u03BBn2.\u03BBd2.if n1\u00d7d2 == n2\u00d7d1 then 1 else 0
    method isEqual(n1, d1, n2, d2) =
        if (n1 * d2) == (n2 * d1) then 1 else 0

    -- Simplify by GCD (iterative Euclidean algorithm approx)
    -- Returns GCD of a and b for manual simplification
    method gcd(a, b) =
        if b == 0 then a
        else if a == b then a
        else if a > b then a - b
        else b - a
}`,
    };

    editor.value = examples[name] || examples['hello'];
    updateLineNumbers();
    saveEditorState();

    document.querySelectorAll('.example-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.example === 'cloomc_' + name);
    });

    const sel = document.getElementById('langSelector');
    if (sel) {
        const isHaskell = ['church_math','church_pair','church_case','church_lambda','sliderule_hs'].includes(name);
        const isSymbolic = ['ada_note_g'].includes(name);
        const isEnglish = ['english_hello','english_counter'].includes(name);
        const isLambda = ['lambda_church','lambda_booleans','lambda_pairs','lambda_ycomb','lambda_sliderule','lambda_fixedpoint','lambda_rational'].includes(name);
        sel.value = isLambda ? 'lambda' : isEnglish ? 'english' : isSymbolic ? 'symbolic' : isHaskell ? 'haskell' : 'javascript';
    }

    if (typeof historySetCodeExample === 'function') historySetCodeExample(name);
}

function saveUploadJSON() {
    const editor = document.getElementById('asmEditor');
    if (!editor || !cloomcCompiler) return;
    const source = editor.value;
    const con = document.getElementById('editorConsole');

    const result = cloomcCompiler.compile(source, []);

    if (result.errors.length > 0) {
        const errText = result.errors.map(e => `Line ${e.line || '?'}: ${e.message}`).join('\n');
        if (con) con.textContent = `CLOOMC++ compilation errors:\n${errText}`;
        return;
    }

    const unresolved = [];
    const uploadCaps = (result.capabilities || []).map((capName) => {
        let target = -1;
        if (sim && sim.abstractionRegistry) {
            const allAbs = sim.abstractionRegistry.abstractions || [];
            for (let i = 0; i < allAbs.length; i++) {
                if (allAbs[i] && allAbs[i].name && allAbs[i].name.toUpperCase() === capName.toUpperCase()) {
                    target = i;
                    break;
                }
            }
        }
        if (target < 0) unresolved.push(capName);
        return { target: target, name: capName, grants: ['E'] };
    });

    const doc = buildDocBlock(result, source);

    const upload = {
        abstraction: result.abstractionName || 'Unnamed',
        type: 'abstraction',
        grants: ['E'],
        capabilities: uploadCaps,
        methods: result.methods.map(m => ({
            name: m.name,
            code: m.code.map(w => '0x' + (w >>> 0).toString(16).padStart(8, '0'))
        })),
        doc: doc
    };

    const json = JSON.stringify(upload, null, 2);

    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (result.abstractionName || 'upload') + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    const langNames3 = { english: 'English', haskell: 'Haskell', symbolic: 'Symbolic Math (Ada)', javascript: 'JavaScript', lambda: 'Lambda Calculus' };
    const lang = langNames3[result.language] || 'JavaScript';
    let listing = `Upload JSON saved as "${a.download}"\n\n`;
    listing += `CLOOMC++ [${lang}] compiled "${result.abstractionName}":\n`;
    listing += `  Methods: ${upload.methods.length}\n`;
    listing += `  Capabilities: ${upload.capabilities.length} (${upload.capabilities.map(c => c.name).join(', ') || 'none'})\n`;
    listing += `  Grants: ${upload.grants.join(', ')}\n`;
    if (unresolved.length > 0) {
        listing += `  WARNING: Unresolved capabilities: ${unresolved.join(', ')} (target=-1, boot system to resolve)\n`;
    }
    listing += `\nUpload JSON preview:\n${json}`;

    if (con) con.textContent = listing;
    appendOutput(`Saved upload JSON for "${result.abstractionName}"`, 'info');
}

function buildDocBlock(result, source) {
    const settings = getStudentSettings();
    const sel = document.getElementById('langSelector');
    const lang = sel ? sel.value : (result.language || 'javascript');
    const langNames = { english: 'English', javascript: 'JavaScript', haskell: 'Haskell', symbolic: 'Symbolic Math (Ada)', lambda: 'Lambda Calculus', assembly: 'Assembly' };
    const caps = result.capabilities || [];
    const methods = (result.methods || []).map(m => ({
        name: m.name,
        params: m.params || [],
        instructions: (m.code || []).length
    }));

    const lines = source.split('\n');
    const sourcePreview = lines.slice(0, 20).join('\n') + (lines.length > 20 ? '\n...' : '');

    return {
        author: settings.name || 'Anonymous',
        date: new Date().toISOString().split('T')[0],
        language: lang,
        languageLabel: langNames[lang] || lang,
        description: `${methods.length} method${methods.length !== 1 ? 's' : ''}, ${caps.length} capabilit${caps.length !== 1 ? 'ies' : 'y'}, language: ${langNames[lang] || lang}`,
        tags: [],
        methods: methods,
        capabilities: caps,
        sourcePreview: sourcePreview
    };
}

async function exportSimulatorToGitHub() {
    const btn = document.getElementById('dashTab-export');
    if (btn) btn.textContent = 'Pushing...';

    const phases = [];
    phases.push({ heading: '=== Push to GitHub ===', lines: ['Connecting to GitHub API...'] });

    var tok = showGitHubConsole(phases, 'push', 'Connecting to GitHub...');

    try {
        const r = await fetch('/api/github/export-simulator', { method: 'POST' });
        const data = await r.json();
        if (data.ok) {
            const fileLines = (data.pushed || []).map(function(f) { return '  + ' + f; });
            appendGitHubPhase({ heading: '--- Files Pushed ---', lines: fileLines }, tok);
            appendGitHubPhase({ heading: '=== Push Complete ===', lines: [
                'Total files exported: ' + data.total,
                'All files pushed successfully.'
            ]}, tok);
            updateGitHubStatus('Push complete — ' + data.total + ' files exported.', false, tok);
        } else {
            const msg = data.errors ? data.errors.join('\n') : (data.error || 'Unknown error');
            const pushed = data.pushed ? data.pushed.length : 0;
            appendGitHubPhase({ heading: '--- Push Results ---', lines: [
                'Files pushed: ' + pushed,
                '',
                'Errors:',
                msg
            ]}, tok);
            updateGitHubStatus('Push completed with errors.', true, tok);
        }
    } catch (e) {
        appendGitHubPhase({ heading: '--- Error ---', lines: [
            'Push failed: ' + e.message,
            '',
            'Check that GitHub is configured and accessible.'
        ]}, tok);
        updateGitHubStatus('Push failed — ' + e.message, true, tok);
    } finally {
        if (btn) btn.textContent = 'Push to GitHub';
    }
}

let libraryCache = null;
let libraryAllItems = [];

async function showLibrary() {
    if (!requirePermission('browseLibrary', 'Browse Library')) return;

    const phases = [];
    phases.push({ heading: '=== Get from GitHub ===', lines: ['Connecting to Mum Tunnel Library...'] });
    var tok = showGitHubConsole(phases, 'get', 'Fetching library index...');

    const repoLink = document.getElementById('libraryGitHubLink');
    let repoUrl = '';
    if (repoLink) {
        repoLink.href = '/api/library/repo-url';
        try {
            const r = await fetch('/api/library/repo-url');
            if (r.ok) {
                const data = await r.json();
                if (data.url) { repoLink.href = data.url; repoUrl = data.url; }
            }
        } catch (e) {}
    }

    try {
        const langFilter = document.getElementById('libraryLangFilter');
        const langParam = langFilter && langFilter.value ? '?language=' + langFilter.value : '';
        const resp = await fetch('/api/library/browse' + langParam);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        libraryAllItems = data.items || [];

        if (libraryAllItems.length > 0) {
            const itemLines = libraryAllItems.slice(0, 20).map(function(item) {
                var doc = item.doc || {};
                return '  ' + (item.name || 'Untitled') + ' — ' + (doc.language || 'unknown') + ' by ' + (doc.author || 'Anonymous');
            });
            if (libraryAllItems.length > 20) itemLines.push('  ... and ' + (libraryAllItems.length - 20) + ' more');
            appendGitHubPhase({ heading: '--- Abstractions Found ---', lines: itemLines }, tok);
            appendGitHubPhase({ heading: '=== Fetch Complete ===', lines: [
                'Found ' + libraryAllItems.length + ' shared abstractions.',
                repoUrl ? 'Repository: ' + repoUrl : ''
            ]}, tok);
            updateGitHubStatus('Loaded ' + libraryAllItems.length + ' abstractions. Opening library...', false, tok);
        } else {
            appendGitHubPhase({ heading: '=== Library Empty ===', lines: [
                'No shared abstractions found.',
                'Be the first to publish!'
            ]}, tok);
            updateGitHubStatus('Library is empty.', false, tok);
        }

        var capturedItems = libraryAllItems;
        _ghAutoCloseTimer = setTimeout(function() {
            _ghAutoCloseTimer = null;
            if (tok === _ghConsoleToken) {
                closeGitHubConsole();
                document.getElementById('libraryModal').style.display = 'flex';
                renderLibraryGrid(capturedItems);
            }
        }, 1500);

    } catch (e) {
        appendGitHubPhase({ heading: '--- Error ---', lines: [
            'Could not load library: ' + e.message,
            '',
            'Check your network connection and try again.'
        ]}, tok);
        updateGitHubStatus('Fetch failed — ' + e.message, true, tok);
    }
}

async function loadLibraryItems() {
    const grid = document.getElementById('libraryGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="library-loading">Loading shared abstractions...</div>';

    try {
        const langFilter = document.getElementById('libraryLangFilter');
        const langParam = langFilter && langFilter.value ? `?language=${langFilter.value}` : '';
        const resp = await fetch(`/api/library/browse${langParam}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        libraryAllItems = data.items || [];
        renderLibraryGrid(libraryAllItems);
    } catch (e) {
        grid.innerHTML = `<div class="library-empty">Could not load library: ${e.message}</div>`;
    }
}

function renderLibraryGrid(items) {
    const grid = document.getElementById('libraryGrid');
    if (!grid) return;

    if (items.length === 0) {
        grid.innerHTML = '<div class="library-empty">No shared abstractions yet. Be the first to publish!</div>';
        return;
    }

    let html = '';
    for (const item of items) {
        const doc = item.doc || {};
        const langClass = 'lang-' + (doc.language || 'javascript');
        const langLabel = doc.languageLabel || doc.language || 'Unknown';
        const tags = (doc.tags || []);
        html += '<div class="library-card">';
        html += `<div class="library-card-name">${escapeHTML(item.name || 'Untitled')}</div>`;
        html += `<div class="library-card-meta">`;
        html += `<span class="library-lang-badge ${langClass}">${escapeHTML(langLabel)}</span>`;
        html += `<span>by ${escapeHTML(doc.author || 'Anonymous')}</span>`;
        html += `<span>${escapeHTML(doc.date || '')}</span>`;
        html += `</div>`;
        html += `<div class="library-card-desc">${escapeHTML(doc.description || '')}</div>`;
        if (tags.length > 0) {
            html += '<div class="library-card-tags">';
            for (const t of tags) html += `<span class="library-tag">${escapeHTML(t)}</span>`;
            html += '</div>';
        }
        html += `<div class="library-card-actions">`;
        html += `<button class="btn btn-primary" onclick="importFromLibrary('${escapeHTML(item.path || '')}')">Import</button>`;
        html += `</div>`;
        html += '</div>';
    }
    grid.innerHTML = html;
}

function escapeHTML(str) {
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
}

function filterLibrary() {
    const search = (document.getElementById('librarySearch').value || '').toLowerCase();
    const langFilter = document.getElementById('libraryLangFilter').value;

    let filtered = libraryAllItems;
    if (langFilter) {
        filtered = filtered.filter(item => (item.doc && item.doc.language) === langFilter);
    }
    if (search) {
        filtered = filtered.filter(item => {
            const name = (item.name || '').toLowerCase();
            const desc = (item.doc && item.doc.description || '').toLowerCase();
            const author = (item.doc && item.doc.author || '').toLowerCase();
            const tags = (item.doc && item.doc.tags || []).join(' ').toLowerCase();
            return name.includes(search) || desc.includes(search) || author.includes(search) || tags.includes(search);
        });
    }
    renderLibraryGrid(filtered);
}

function publishToLibrary() {
    if (!requirePermission('publish', 'Publish to Library')) return;
    const editor = document.getElementById('asmEditor');
    if (!editor || !cloomcCompiler) return;
    const source = editor.value;

    const result = cloomcCompiler.compile(source, []);
    if (result.errors.length > 0) {
        alert('Compile first — there are errors in the current source.');
        return;
    }

    const doc = buildDocBlock(result, source);
    const preview = document.getElementById('publishPreview');
    if (preview) {
        preview.textContent = `Abstraction: ${result.abstractionName}\nMethods: ${doc.methods.map(m => m.name).join(', ')}\nCapabilities: ${doc.capabilities.join(', ') || 'none'}\nLanguage: ${doc.languageLabel}\nAuthor: ${doc.author}`;
    }

    document.getElementById('publishDescription').value = doc.description;
    document.getElementById('publishTags').value = '';
    document.getElementById('publishModal').style.display = 'flex';
    document.getElementById('publishModal')._compiledResult = result;
    document.getElementById('publishModal')._source = source;
}

async function confirmPublish() {
    const modal = document.getElementById('publishModal');
    const result = modal._compiledResult;
    const source = modal._source;
    if (!result) return;

    const description = document.getElementById('publishDescription').value.trim();
    const tagsRaw = document.getElementById('publishTags').value.trim();
    const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

    const doc = buildDocBlock(result, source);
    doc.description = description || doc.description;
    doc.tags = tags;

    const uploadCaps = (result.capabilities || []).map((capName) => {
        return { target: -1, name: capName, grants: ['E'] };
    });

    const payload = {
        abstraction: result.abstractionName || 'Unnamed',
        type: 'abstraction',
        grants: ['E'],
        capabilities: uploadCaps,
        methods: result.methods.map(m => ({
            name: m.name,
            code: m.code.map(w => '0x' + (w >>> 0).toString(16).padStart(8, '0'))
        })),
        doc: doc,
        source: source
    };

    try {
        const resp = await fetch('/api/library/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error || `HTTP ${resp.status}`);
        }

        const data = await resp.json();
        modal.style.display = 'none';
        appendOutput(`Published "${result.abstractionName}" to Mum Tunnel Library`, 'info');
        await loadLibraryItems();
    } catch (e) {
        alert(`Publish failed: ${e.message}`);
    }
}

async function importFromLibrary(path) {
    try {
        const resp = await fetch(`/api/library/get/${encodeURIComponent(path)}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        if (data.source) {
            const editor = document.getElementById('asmEditor');
            if (editor) {
                editor.value = data.source;
                updateLineNumbers();
                saveEditorState();
            }

            if (data.doc && data.doc.language) {
                const sel = document.getElementById('langSelector');
                if (sel) {
                    sel.value = data.doc.language;
                    onLangChange(true);
                }
            }

            document.getElementById('libraryModal').style.display = 'none';
            appendOutput(`Imported "${data.abstraction || path}" from Mum Tunnel Library`, 'info');
            switchCodeTab('console');
        }
    } catch (e) {
        alert(`Import failed: ${e.message}`);
    }
}

let docsLoaded = false;
let docsData = null;

async function loadDocsView() {
    if (docsLoaded) return;
    try {
        const resp = await fetch('/api/docs/list');
        docsData = await resp.json();
        renderDocsFileList();
        docsLoaded = true;
        loadDoc('prologue.md');
    } catch (e) {
        const body = document.getElementById('docsContentBody');
        if (body) body.innerHTML = '<div class="docs-placeholder">Failed to load document list.</div>';
    }
}

function renderDocsFileList() {
    const docsList = document.getElementById('docsFileList');
    const figsList = document.getElementById('docsFigureList');
    if (!docsList || !figsList || !docsData) return;

    if (docsData.chapters && docsData.chapters.length > 0) {
        let chapterNum = 0;
        docsList.innerHTML = docsData.chapters.map(ch => {
            chapterNum++;
            const items = ch.docs.map((d, i) => {
                const sizeKB = (d.size / 1024).toFixed(1);
                const label = d.name.replace('.md', '');
                return `<div class="docs-file-item" onclick="loadDoc('${d.name}')" data-doc="${d.name}"><span class="docs-chapter-num">${chapterNum}.${i + 1}</span><span>${label}</span><span class="file-size">${sizeKB} KB</span></div>`;
            }).join('');
            return `<div class="docs-chapter-group"><div class="docs-chapter-title">${ch.title}</div>${items}</div>`;
        }).join('');
    } else {
        docsList.innerHTML = docsData.docs.map(d => {
            const sizeKB = (d.size / 1024).toFixed(1);
            const label = d.name.replace('.md', '');
            return `<div class="docs-file-item" onclick="loadDoc('${d.name}')" data-doc="${d.name}"><span>${label}</span><span class="file-size">${sizeKB} KB</span></div>`;
        }).join('');
    }

    figsList.innerHTML = docsData.figures.map(f => {
        const label = f.name.replace('.html', '');
        const sizeKB = (f.size / 1024).toFixed(1);
        return `<div class="docs-file-item" onclick="loadFigure('${f.name}')" data-fig="${f.name}"><span>${label}</span><span class="file-size">${sizeKB} KB</span></div>`;
    }).join('');
}

async function loadDoc(filename) {
    document.querySelectorAll('.docs-file-item').forEach(el => el.classList.remove('active'));
    const active = document.querySelector(`.docs-file-item[data-doc="${filename}"]`);
    if (active) active.classList.add('active');

    const title = document.getElementById('docsContentTitle');
    const body = document.getElementById('docsContentBody');
    if (title) title.textContent = filename;
    if (body) body.innerHTML = '<div class="docs-placeholder">Loading...</div>';

    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
        const sidebar = document.querySelector('.docs-sidebar');
        if (sidebar) sidebar.classList.add('docs-sidebar-collapsed');
    }

    try {
        const resp = await fetch('/api/docs/read/' + filename);
        const data = await resp.json();
        if (body) body.innerHTML = renderMarkdown(data.content);
    } catch (e) {
        if (body) body.innerHTML = '<div class="docs-placeholder">Failed to load document.</div>';
    }

    if (isMobile) {
        const docsView = document.getElementById('docs');
        if (docsView) docsView.scrollTop = 0;
    }
}

function loadFigure(filename) {
    document.querySelectorAll('.docs-file-item').forEach(el => el.classList.remove('active'));
    const active = document.querySelector(`.docs-file-item[data-fig="${filename}"]`);
    if (active) active.classList.add('active');

    const title = document.getElementById('docsContentTitle');
    const body = document.getElementById('docsContentBody');
    const label = filename.replace('.html', '');
    if (title) title.textContent = 'Figure: ' + label;
    if (body) body.innerHTML = `<iframe class="docs-figure-frame" src="/docs/figures/${filename}"></iframe>`;

    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
        const sidebar = document.querySelector('.docs-sidebar');
        if (sidebar) sidebar.classList.add('docs-sidebar-collapsed');
        const docsView = document.getElementById('docs');
        if (docsView) docsView.scrollTop = 0;
    }
}

function docsBackToList() {
    const sidebar = document.querySelector('.docs-sidebar');
    if (sidebar) {
        sidebar.classList.remove('docs-sidebar-collapsed');
        sidebar.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function renderMarkdown(md) {
    let html = escapeHtml(md);
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (m, lang, code) => {
        return '<pre><code>' + code.trim() + '</code></pre>';
    });
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    html = html.replace(/^---$/gm, '<hr>');
    html = html.replace(/^\> (.+)$/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/^\| (.+) \|$/gm, (match, row) => {
        const cells = row.split('|').map(c => c.trim());
        return '<tr>' + cells.map(c => {
            if (c.match(/^[-:]+$/)) return '';
            return '<td>' + c + '</td>';
        }).join('') + '</tr>';
    });
    html = html.replace(/((<tr>.*<\/tr>\n?)+)/g, '<table>$1</table>');
    html = html.replace(/<table>(\s*<tr>\s*<td>[-:|\s]+<\/td>\s*<\/tr>)/g, '<table>');
    html = html.replace(/<tr><\/tr>/g, '');
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
    html = html.replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>');
    const lines = html.split('\n');
    const result = [];
    let inPre = false;
    for (const line of lines) {
        if (line.includes('<pre>')) inPre = true;
        if (line.includes('</pre>')) inPre = false;
        if (!inPre && line.trim() && !line.startsWith('<')) {
            result.push('<p>' + line + '</p>');
        } else {
            result.push(line);
        }
    }
    return result.join('\n');
}

function showNextSteps(context) {
    const box = document.getElementById('nextStepsBox');
    if (!box) return;

    const link = (label, view) => `<a class="next-step-link" href="#" onclick="event.preventDefault();switchView('${view}')">${label}</a>`;
    const steps = {
        'compiled': `
            <div class="next-steps-label">Next Steps</div>
            <ul>
                <li>${link('Name this abstract idea', 'abstractions')} — does the abstraction name describe what it does?</li>
                <li>${link('Check the Namespace', 'namespace')} — see where your abstraction will live once created.</li>
                <li><strong>Step through it</strong> — click <strong>Step</strong> to watch each instruction execute one at a time.</li>
                <li><strong>Create Abstraction</strong> — when you are ready, click the green button to give your idea a Body in the Church Machine.</li>
            </ul>`,
        'assembled': `
            <div class="next-steps-label">Next Steps</div>
            <ul>
                <li><strong>Step through it</strong> — click <strong>Step</strong> to execute one instruction at a time and watch the registers change.</li>
                <li><strong>Run it</strong> — click <strong>Run</strong> to execute all instructions until halt or fault.</li>
                <li>${link('Check the Namespace', 'namespace')} — see the namespace slots and save your program.</li>
                <li>${link('View the Pipeline', 'pipeline')} — watch instructions flow through the mLoad pipeline.</li>
            </ul>`,
        'created': `
            <div class="next-steps-label">Next Steps</div>
            <ul>
                <li>${link('Check the Namespace', 'namespace')} — see your new abstraction\'s entry in the namespace table.</li>
                <li>${link('Inspect it in Abstractions', 'abstractions')} — see the lump layout, c-list, and Golden Token.</li>
                <li>${link('View the Pipeline', 'pipeline')} — watch how capabilities are checked in hardware.</li>
                <li>${link('Read the Reference', 'reference')} — look up instructions and permission bits.</li>
            </ul>`,
        'error': `
            <div class="next-steps-label">Next Steps</div>
            <ul>
                <li><strong>Read the error</strong> — the line number tells you where to look.</li>
                <li><strong>Check your syntax</strong> — does every <code>{</code> have a matching <code>}</code>?</li>
                <li>${link('Try the Tutorial', 'tutorial')} — guided lessons to help you learn the syntax.</li>
                <li>${link('Read the Reference', 'reference')} — look up instruction formats and examples.</li>
            </ul>`,
        'draft': `
            <div class="next-steps-label">Next Steps</div>
            <ul>
                <li>${link('Check the Namespace', 'namespace')} — see where your abstraction will be placed.</li>
                <li>${link('Inspect Abstractions', 'abstractions')} — review existing abstractions and their layouts.</li>
                <li>${link('View the Pipeline', 'pipeline')} — understand how the mLoad pipeline processes capabilities.</li>
                <li><strong>Compile</strong> — click <strong>Compile</strong> to see the actual machine instructions.</li>
            </ul>`
    };

    box.innerHTML = steps[context] || '';
}

function initConsoleAutoSwitch() {
    const con = document.getElementById('editorConsole');
    if (!con) return;
    const observer = new MutationObserver(function() {
        if (currentView === 'editor') {
            switchCodeTab('console');
        }
    });
    observer.observe(con, { childList: true, characterData: true, subtree: true });
}

function initEditorDivider() {
    const divider = document.getElementById('editorDivider');
    if (!divider) return;
    const layout = divider.parentElement;
    const panels = layout.querySelectorAll('.editor-panel');
    if (panels.length < 2) return;
    const leftPanel = panels[0];
    const rightPanel = panels[1];
    let dragging = false;

    divider.addEventListener('mousedown', function(e) {
        e.preventDefault();
        dragging = true;
        divider.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', function(e) {
        if (!dragging) return;
        const rect = layout.getBoundingClientRect();
        const leftPct = Math.max(15, Math.min(85, ((e.clientX - rect.left) / rect.width) * 100));
        const rightPct = 100 - leftPct;
        leftPanel.style.flex = 'none';
        leftPanel.style.width = leftPct + '%';
        rightPanel.style.flex = 'none';
        rightPanel.style.width = rightPct + '%';
    });

    document.addEventListener('mouseup', function() {
        if (!dragging) return;
        dragging = false;
        divider.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });

    divider.addEventListener('touchstart', function(e) {
        e.preventDefault();
        dragging = true;
        divider.classList.add('dragging');
    }, { passive: false });

    document.addEventListener('touchmove', function(e) {
        if (!dragging) return;
        const touch = e.touches[0];
        const rect = layout.getBoundingClientRect();
        const leftPct = Math.max(15, Math.min(85, ((touch.clientX - rect.left) / rect.width) * 100));
        const rightPct = 100 - leftPct;
        leftPanel.style.flex = 'none';
        leftPanel.style.width = leftPct + '%';
        rightPanel.style.flex = 'none';
        rightPanel.style.width = rightPct + '%';
    }, { passive: true });

    document.addEventListener('touchend', function() {
        if (!dragging) return;
        dragging = false;
        divider.classList.remove('dragging');
    });
}

function initReplDivider() {
    const divider = document.getElementById('replDivider');
    if (!divider) return;
    const layout = divider.parentElement;
    const panel = layout.querySelector('.repl-panel');
    const sidebar = layout.querySelector('.repl-sidebar');
    let dragging = false;

    divider.addEventListener('mousedown', function(e) {
        e.preventDefault();
        dragging = true;
        divider.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', function(e) {
        if (!dragging) return;
        const rect = layout.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const total = rect.width - 10;
        const leftPct = Math.max(15, Math.min(85, (x / rect.width) * 100));
        const rightPct = 100 - leftPct;
        panel.style.flex = 'none';
        panel.style.width = leftPct + '%';
        sidebar.style.flex = 'none';
        sidebar.style.width = rightPct + '%';
    });

    document.addEventListener('mouseup', function() {
        if (!dragging) return;
        dragging = false;
        divider.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });

    divider.addEventListener('touchstart', function(e) {
        e.preventDefault();
        dragging = true;
        divider.classList.add('dragging');
    }, { passive: false });

    document.addEventListener('touchmove', function(e) {
        if (!dragging) return;
        const touch = e.touches[0];
        const rect = layout.getBoundingClientRect();
        const leftPct = Math.max(15, Math.min(85, ((touch.clientX - rect.left) / rect.width) * 100));
        const rightPct = 100 - leftPct;
        panel.style.flex = 'none';
        panel.style.width = leftPct + '%';
        sidebar.style.flex = 'none';
        sidebar.style.width = rightPct + '%';
    }, { passive: true });

    document.addEventListener('touchend', function() {
        if (!dragging) return;
        dragging = false;
        divider.classList.remove('dragging');
    });
}

function initTabOverflow(container) {
    if (!container || container.dataset.overflowInit) return;
    container.dataset.overflowInit = '1';

    var hamburger = document.createElement('button');
    hamburger.className = 'tab-overflow-btn';
    hamburger.innerHTML = '\u2630';
    hamburger.title = 'More tabs';

    var dropdown = document.createElement('div');
    dropdown.className = 'tab-overflow-dropdown';

    container.appendChild(hamburger);
    document.body.appendChild(dropdown);

    function closeDropdown() { dropdown.classList.remove('open'); }

    hamburger.addEventListener('click', function(e) {
        e.stopPropagation();
        var rect = hamburger.getBoundingClientRect();
        var top = rect.bottom + 2;
        var left = rect.right - 160;
        if (left < 4) left = 4;
        if (top + 200 > window.innerHeight) top = rect.top - 200;
        dropdown.style.top = top + 'px';
        dropdown.style.left = left + 'px';
        dropdown.style.right = '';
        dropdown.classList.toggle('open');
    });

    document.addEventListener('click', closeDropdown);

    dropdown.addEventListener('click', function(e) {
        e.stopPropagation();
    });

    function updateOverflow() {
        var tabs = Array.from(container.querySelectorAll('.math-mode-tab, .sidebar-tab'));
        tabs.forEach(function(t) { t.classList.remove('overflow-hidden'); });
        hamburger.classList.remove('visible', 'has-active');
        dropdown.innerHTML = '';
        dropdown.classList.remove('open');

        var visibleTabs = tabs.filter(function(t) { return t.style.display !== 'none'; });
        if (visibleTabs.length === 0) return;

        var totalTabWidth = 0;
        var tabWidths = [];
        visibleTabs.forEach(function(t) {
            var w = t.getBoundingClientRect().width;
            tabWidths.push(w);
            totalTabWidth += w;
        });

        var containerWidth = container.getBoundingClientRect().width;
        if (totalTabWidth <= containerWidth) return;

        hamburger.classList.add('visible');
        var hbWidth = hamburger.getBoundingClientRect().width || 36;
        var availableWidth = containerWidth - hbWidth;
        var usedWidth = 0;
        var overflowedTabs = [];
        var hasActiveInOverflow = false;

        for (var i = 0; i < visibleTabs.length; i++) {
            if (usedWidth + tabWidths[i] > availableWidth) {
                overflowedTabs.push(visibleTabs[i]);
            } else {
                usedWidth += tabWidths[i];
            }
        }

        if (overflowedTabs.length === 0) {
            hamburger.classList.remove('visible');
            return;
        }

        overflowedTabs.forEach(function(tab) {
            tab.classList.add('overflow-hidden');
            var item = document.createElement('button');
            item.textContent = tab.textContent;
            if (tab.classList.contains('active')) {
                item.classList.add('active');
                hasActiveInOverflow = true;
            }
            item.addEventListener('click', function() {
                tab.click();
                dropdown.classList.remove('open');
                setTimeout(updateOverflow, 50);
            });
            dropdown.appendChild(item);
        });

        if (hasActiveInOverflow) {
            hamburger.classList.add('has-active');
        }
    }

    var observer = new ResizeObserver(function() {
        requestAnimationFrame(updateOverflow);
    });
    observer.observe(container);

    var updating = false;
    var mutObserver = new MutationObserver(function(mutations) {
        if (updating) return;
        var dominated = mutations.some(function(m) {
            return m.target.classList.contains('tab-overflow-btn') || m.target.classList.contains('tab-overflow-dropdown');
        });
        if (dominated) return;
        updating = true;
        setTimeout(function() { updateOverflow(); updating = false; }, 20);
    });
    mutObserver.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });

    updateOverflow();
}

function initAllTabOverflows() {
    document.querySelectorAll('.math-mode-tabs, .sidebar-tabs').forEach(initTabOverflow);
}

function adjustViewTop() {
    const toolbar = document.querySelector('.fixed-toolbar');
    if (!toolbar) return;
    const h = toolbar.offsetHeight;
    document.querySelectorAll('.view').forEach(v => { v.style.top = h + 'px'; });
}

window.addEventListener('resize', adjustViewTop);

(function initPullToRefresh() {
    let startY = 0;
    let pulling = false;
    let indicator = null;

    function getIndicator() {
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.className = 'pull-refresh-indicator';
            indicator.innerHTML = '<span class="pull-refresh-arrow">&#8635;</span><span class="pull-refresh-text">Pull to refresh</span>';
            document.body.appendChild(indicator);
        }
        return indicator;
    }

    document.addEventListener('touchstart', function(e) {
        const activeView = document.querySelector('.view.active');
        if (!activeView || activeView.scrollTop > 5) return;
        const toolbar = document.querySelector('.fixed-toolbar');
        const toolbarBottom = toolbar ? toolbar.offsetHeight : 60;
        const touchY = e.touches[0].clientY;
        if (touchY > toolbarBottom + 100) return;
        startY = touchY;
        pulling = true;
    }, { passive: true });

    document.addEventListener('touchmove', function(e) {
        if (!pulling) return;
        const dy = e.touches[0].clientY - startY;
        if (dy < 0) { pulling = false; return; }
        if (dy > 10) {
            const ind = getIndicator();
            const progress = Math.min(dy / 120, 1);
            const offset = Math.min(dy * 0.4, 60);
            ind.style.transform = `translateX(-50%) translateY(${offset}px)`;
            ind.style.opacity = progress;
            ind.querySelector('.pull-refresh-arrow').style.transform = `rotate(${progress * 360}deg)`;
            if (progress >= 1) {
                ind.querySelector('.pull-refresh-text').textContent = 'Release to refresh';
                ind.classList.add('ready');
            } else {
                ind.querySelector('.pull-refresh-text').textContent = 'Pull to refresh';
                ind.classList.remove('ready');
            }
            ind.style.display = 'flex';
        }
    }, { passive: true });

    function resetIndicator() {
        if (!indicator) return;
        indicator.style.opacity = '0';
        indicator.style.transform = 'translateX(-50%) translateY(0)';
        setTimeout(() => { if (indicator) indicator.style.display = 'none'; }, 200);
    }

    document.addEventListener('touchend', function() {
        if (!pulling) return;
        pulling = false;
        const ind = indicator;
        if (ind && ind.classList.contains('ready')) {
            ind.querySelector('.pull-refresh-text').textContent = 'Refreshing...';
            ind.querySelector('.pull-refresh-arrow').style.animation = 'pullSpin 0.6s linear infinite';
            setTimeout(() => location.reload(), 400);
        } else {
            resetIndicator();
        }
    }, { passive: true });

    document.addEventListener('touchcancel', function() {
        pulling = false;
        resetIndicator();
    }, { passive: true });
})();

document.addEventListener('DOMContentLoaded', () => {
    init();
    initAllTabOverflows();
    adjustViewTop();
    initCodeCopyButtons();
});

function addCopyButton(pre) {
    if (pre.querySelector('.code-copy-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'code-copy-btn';
    btn.textContent = 'Copy';
    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const clone = pre.cloneNode(true);
        clone.querySelectorAll('.code-copy-btn').forEach(function(b) { b.remove(); });
        const text = clone.textContent;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function() {
                btn.textContent = 'Copied!';
                btn.classList.add('copied');
                setTimeout(function() { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
            }).catch(function() {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand('copy'); } catch(_) {}
                document.body.removeChild(ta);
                btn.textContent = 'Copied!';
                btn.classList.add('copied');
                setTimeout(function() { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
            });
        } else {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            btn.textContent = 'Copied!';
            btn.classList.add('copied');
            setTimeout(function() { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
        }
    });
    pre.appendChild(btn);
}

function initCodeCopyButtons() {
    document.querySelectorAll('pre').forEach(addCopyButton);
    const observer = new MutationObserver(function(mutations) {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType !== 1) continue;
                if (node.tagName === 'PRE') addCopyButton(node);
                node.querySelectorAll && node.querySelectorAll('pre').forEach(addCopyButton);
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}
