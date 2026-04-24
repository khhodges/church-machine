// =============================================================================
// app.js — Church Machine IDE Front-End
// =============================================================================
//
// This is the browser-side controller for the Church Machine IDE.  It wires
// together the simulator, assembler, tutorials, and all UI panels into a
// single-page application served by server/app.py (Flask).
//
// GLOBAL SINGLETONS  (initialised in DOMContentLoaded)
//   sim            ChurchSimulator    — the CPU / memory / GC / NS table
//   assembler      ChurchAssembler    — text → 32-bit word encoder
//   pipelineViz    PipelineViz        — pipeline animation (pipeline.js)
//   repl           ChurchREPL         — interactive REPL (repl.js)
//   churchTutorial TutorialEngine     — main step-through tutorial
//   slideRuleTutorial / cloomcTutorial / securityTutorial / threadTutorial
//   abstrTutorial / nsTutorial / secureBootTutorial — specialised tutorials
//
// VIEWS  (switchView(id) shows one <div class="view"> at a time)
//   editor         — Church assembly editor + Console/Syntax/History/JS tabs
//   pipeline       — Pipeline visualisation (default on startup)
//   namespace      — NS table browser (all 46+ slots)
//   abstractions   — Abstraction catalog (9 layers)
//   memory         — Word-addressed memory dump
//   registers      — CR0–CR15 + DR0–DR15 table
//   gc             — Garbage collector (4 phase cards, Run GC button)
//   github         — GitHub sync (push / pull cards)
//   tutorial       — Tutorial sidebar + step controls
//
// CODE TABS  (switchCodeTab(id) within the editor view)
//   console        — Assembler output / execution log + LED strip
//   syntax         — Instruction quick-reference (renderSyntaxRef)
//   history        — AI-generated narrative about the loaded code
//   js             — JS source browser (this file + 5 others)
//
// KEY UI FUNCTIONS
//   switchView(id)         — show a top-level view; hide all others
//   switchCodeTab(tab)     — switch among console/syntax/history/js
//   renderCRTable()        — build the CR0–CR15 HTML table
//   renderNSTable()        — build the namespace table HTML
//   renderToolsView()      — populate the GC view (4 phase cards + stats)
//   runGCFromTools()       — phase-step GC and animate each card in turn
//   openCRDetail(cr)       — modal showing full CR GT decode
//   renderJsTab()          — populate the JS source file bar
//   loadJsFile(filename)   — fetch and display a .js source file
//
// ASSEMBLER FLOW
//   1. User types Church assembly in the CodeMirror editor
//   2. onAssemble() calls assembler.assemble(src)
//   3. Words are loaded into sim.memory via sim.loadProgram(words)
//   4. Console tab shows the listing; errors are highlighted in the editor
//
// BOOT FLOW
//   onBoot() calls sim.boot() — runs all _bootStep() phases to completion,
//   then calls renderCRTable() + renderNSTable() to reflect the post-boot state.
//
// GC PHASE STEPPING  (_gcPhaseStep state machine)
//   0 = idle        → first click: calls sim.runGC(), stores result, reveals Phase 1
//   1 = phase 1 done → click: reveals Phase 2
//   2 = phase 2 done → click: reveals Phase 3
//   3 = phase 3 done → click: reveals Phase 4 + resets to idle
//   _tgcReset() clears state.   _tgcUpdateBtn() keeps button label in sync.
//
// TUTORIAL INTEGRATION
//   Tutorials inject breakpoints (B:N) into assembly source.  The step
//   controller halts at each breakpoint and calls tutorial.onBreakpoint(n).
//   switchSidebarTab() manages the five sidebar panels per tutorial step.
//
// EVENT LISTENERS
//   sim.on('stateChange', ...)  — re-render CR/DR tables + memory after each step
//   window.onresize             — reflow pipeline SVG
//   document.onkeydown          — F8 = step, F5 = run, Escape = stop, Ctrl+R = reboot
//
// FILE LAYOUT (other JS files loaded by index.html)
//   simulator.js          — ChurchSimulator (CPU, GC, NS, boot)
//   assembler.js          — ChurchAssembler (text → words)
//   boot_uploads.js       — BOOT_UPLOADS manifest
//   system_abstractions.js — SystemAbstractions (46 NS entries)
//   device_abstractions.js — DeviceAbstractions (MMIO devices)
//   pipeline.js           — Pipeline stage visualisation
//   repl.js               — Interactive REPL
//   history.js            — AI narrative generator
//   tutorial.js + *_tutorial.js — step-through tutorials
//   webserial.js          — WebSerial FPGA upload
//   hw_binary.js          — Hardware binary serialiser
//   cloomc_compiler.js    — CLOOMC → assembly compiler
//
// =============================================================================

const POPUPS_DISABLED = false;

let sim = null;
let _simRunHistory = [];
let _simRunHash = '';
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
let englishLoopsTutorial = null;
let englishStringTutorial = null;
let activeTutorial = 'sliderule';
let cloomcCompiler = null;
let currentView = 'dashboard';
let previousView = null;
let lastAssembledWords = null;
let lastAssembledCapabilities = null;
let lastMethodTableSize = 0;
let _pendingSimLoad = false;
let _lumpManifests = {};
let _petNameDRMap = {};
let _petNameCRMap = {};
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

function createUserTab(name, lang, initialCode) {
    const code = (initialCode !== undefined) ? initialCode : '';
    const tab = { id: generateTabId(), name: name, lang: lang || 'assembly', code };
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
    // Always show the personal group when a user tab is selected
    const sel = document.getElementById('langSelector');
    if (sel && sel.value !== 'personal') {
        sel.value = 'personal';
        onLangChange(true);
    }
    document.querySelectorAll('.example-tab:not(.user-tab)').forEach(t => t.classList.remove('active'));
    renderUserTabs();
    updateSaveUserTabBtn();
    updateLineNumbers();
    const outputEl = document.getElementById('assemblyOutput');
    if (outputEl) outputEl.innerHTML = '';
}

function saveActiveUserTab() {
    if (!activeUserTabId) return;
    const tab = userTabs.find(t => t.id === activeUserTabId);
    if (!tab) return;
    const editor = document.getElementById('asmEditor');
    if (editor) tab.code = editor.value;
    // Don't overwrite the tab's real language with 'personal'
    const sel = document.getElementById('langSelector');
    if (sel && sel.value !== 'personal') tab.lang = sel.value;
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
    // Visibility is controlled by onLangChange; ensure hidden unless in personal mode
    const sel = document.getElementById('langSelector');
    const isPersonal = sel && sel.value === 'personal';
    container.style.display = isPersonal ? '' : 'none';
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
    // Snapshot the current editor content so the new tab starts with it
    const editor = document.getElementById('asmEditor');
    const initialCode = editor ? editor.value : '';
    hideNewTabDialog();
    const sel = document.getElementById('langSelector');
    if (sel && sel.value !== lang) {
        sel.value = lang;
        onLangChange(true);
    }
    createUserTab(name, lang, initialCode);
}

function init() {
    sim = new ChurchSimulator();
    sim.bootEntrySlot = bootEntrySlot;  // apply user-selected boot entry before first reset
    assembler = new ChurchAssembler(typeof METHOD_REGISTER_CONVENTIONS !== 'undefined' ? METHOD_REGISTER_CONVENTIONS : {});
    pipelineViz = new PipelineVisualizer('pipelineContainer');
    pipelineViz.setNIAProvider(() => {
        if (!sim.bootComplete) return _bootNIARows(sim.bootStep);
        return _buildNIARows(sim.physicalPC, sim._nextPhysicalAddr());
    });
    pipelineViz.setCallHomeStatusProvider(() => sim.callHomeStatus || null);
    if (typeof _flushPendingPipelineBuffer === 'function') _flushPendingPipelineBuffer();
    repl = new ChurchREPL(sim, pipelineViz);
    _ensureTutorialObjects();

    abstractionRegistry = new AbstractionRegistry();
    systemAbstractions = new SystemAbstractions(abstractionRegistry);
    deviceAbstractions = new DeviceAbstractions(abstractionRegistry);
    sim.initAbstractions(abstractionRegistry, systemAbstractions, deviceAbstractions);
    // Wire abstraction names into the assembler symbol table so the named
    // shorthand syntax works:  LOAD CR11, SlideRule  (Level 1), and after
    // that instruction any  CALL SlideRule  → CALL CR11  (Level 2).
    {
        const _nsSymMap = {};
        for (const [slot, abs] of Object.entries(abstractionRegistry.abstractions)) {
            _nsSymMap[abs.name] = parseInt(slot);
        }
        assembler.setNamespace(_nsSymMap);
    }
    // window.bootConfig was prefetched by the DOMContentLoaded handler before
    // init() ran (Task #214 Step 1), so this single reset already uses the
    // programmer-chosen lump sizes when present, and historical defaults
    // otherwise. No re-reset is needed — that previously caused a race with
    // loadNamespaceState() that could wipe restored state.
    sim.reset();
    _initLazyLoadManifest();
    _absMethodsLoad();
    _implStatusLoad();

    if (typeof CLOOMCCompiler !== 'undefined') {
        cloomcCompiler = new CLOOMCCompiler();
    }

    sim.on('stateChange', () => { updateDashboard(); updateLedStrip(); });
    sim.on('step', _traceRecordStep);
    sim.on('reset', clearTrace);
    // Task #217: every reset rebuilds memory[] from scratch via
    // _initNamespaceTable. If a programmer-generated boot image is
    // available, overlay it now so the simulator runs from the
    // self-supporting binary rather than the hardcoded init alone.
    sim.on('reset', _maybeApplyBootImage);
    // Probe once at startup — covers the case where the user navigated
    // here after a previous session generated an image.
    _probeBootImage().then(buf => {
        if (buf) { window.bootImage = buf; window.bootImageAvailable = true;
                   try { sim.loadBootImage(buf); _syncBootEntryFromSim(); } catch(e) { console.warn('[bootImage] apply failed:', e); } }
    });
    sim.on('programLoaded', () => {
        if (currentView === 'namespace') updateNamespace();
        if (currentView === 'abstractions') renderAbstractions();
        clearTrace();
    });
    sim.on('fault', (f) => {
        appendOutput(`FAULT [${f.type}]: ${f.message}`, 'error');
        _lastFault = f;
        faultAlertOn();
        try {
            showFaultModal(f);
        } catch(err) {
            console.error('[fault] showFaultModal threw:', err);
            setTimeout(() => {
                try { showFaultModal(f); } catch(e2) {
                    console.error('[fault] showFaultModal retry failed:', e2);
                }
            }, 0);
        }
    });
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
    const views = ['repl','editor','tutorial','dashboard','namespace','abstractions','lumps','pipeline','trace','reference','docs','builder','sitemap'];
    const hash = window.location.hash.replace('#', '');
    let startView = views.includes(hash) ? hash : null;
    if (!startView) {
        try { const saved = localStorage.getItem('church_lastView'); if (saved && views.includes(saved)) startView = saved; } catch(e) {}
    }
    if (!startView) startView = 'docs';
    switchView(startView);
    switchMathMode('hp35');

    // Global keyboard shortcuts: Ctrl+<letter> → switch top-level view.
    // Skipped when focus is inside any text input / textarea / contenteditable.
    document.addEventListener('keydown', function _ideNavShortcut(e) {
        if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
        const tag = document.activeElement ? document.activeElement.tagName : '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
            (document.activeElement && document.activeElement.isContentEditable)) return;
        // Map letter → view name
        const NAV = {
            a: 'abstractions',   // Abstractions
            b: 'builder',        // Builder / Hardware
            d: 'dashboard',      // Dashboard / Simulator
            f: 'reference',      // reFerences docs (r is reserved for Reboot)
            g: 'gc',             // Garbage Collector
            l: 'lumps',          // Lumps repository
            m: 'repl',           // Math (REPL / SlideRule)
            n: 'namespace',      // Namespace viewer
            p: 'pipeline',       // Pipeline visualiser
            t: 'trace',          // Trace log
            u: 'tutorial',       // tUtorial
            v: 'devices',        // deVices
            y: 'docs',           // docs (no better letter free)
        };
        const key = e.key.toLowerCase();
        // Ctrl+R — Reboot: reset and re-run the boot sequence.
        // preventDefault stops the browser page-refresh so the shortcut works
        // correctly even when the simulator is embedded in an iframe.
        if (key === 'r') {
            e.preventDefault();
            resetSim();
            return;
        }
        if (NAV[key]) {
            e.preventDefault();
            switchView(NAV[key]);
        }
    });

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
            const isNewVersion = stored && stored !== data.bootId;
            if (isNewVersion) {
                localStorage.removeItem('church_welcome_dismissed');
                localStorage.removeItem('churchMachine_mathGuideDismissed');
                localStorage.removeItem('churchMachine_toolGuide_interactive');
                localStorage.removeItem('churchMachine_toolGuide_hp35');
                localStorage.removeItem('churchMachine_toolGuide_abacus');
                localStorage.removeItem('churchMachine_toolGuide_sliderule');
            }
            localStorage.setItem('churchMachine_bootId', data.bootId);
            if (data.version) {
                const el = document.getElementById('version-tag');
                if (el) el.textContent = 'v' + data.version;
            }
            if (isNewVersion) {
                const lastWhatsNewVersion = localStorage.getItem('church_whatsnew_version');
                if (lastWhatsNewVersion !== data.bootId) {
                    setTimeout(() => showWhatsNew(), 1500);
                }
            }
        })
        .catch(() => {});
}

function goBack() {
    if (previousView) switchView(previousView);
}

function toggleHamburger() {
    const dd = document.getElementById('hamDropdown');
    if (!dd) return;
    dd.classList.toggle('ham-open');
}

function closeHamburger() {
    const dd = document.getElementById('hamDropdown');
    if (dd) dd.classList.remove('ham-open');
}

function openSimulatorFromMenu() {
    switchView('dashboard');
    switchDashTab('cr');
    closeHamburger();
    const chk = document.getElementById('autoBootChk');
    if (chk && chk.checked) resetSim();
}

function saveAutoBootPref() {
    const chk = document.getElementById('autoBootChk');
    if (!chk) return;
    try { localStorage.setItem('churchMachine_autoBootOnOpen', chk.checked ? '1' : '0'); } catch(e) {}
}

function restoreAutoBootPref() {
    const chk = document.getElementById('autoBootChk');
    if (!chk) return;
    try { chk.checked = localStorage.getItem('churchMachine_autoBootOnOpen') === '1'; } catch(e) {}
}

document.addEventListener('click', function(e) {
    const wrap = document.getElementById('hamWrap');
    if (wrap && !wrap.contains(e.target)) closeHamburger();
    const eaWrap = document.getElementById('editorActionsWrap');
    if (eaWrap && !eaWrap.contains(e.target)) closeEditorActions();
    const laWrap = document.getElementById('lumpsActionsWrap');
    if (laWrap && !laWrap.contains(e.target)) closeLumpsActions();
});

function toggleEditorActions() {
    const dd = document.getElementById('editorActionsDropdown');
    if (!dd) return;
    const open = dd.style.display !== 'none';
    dd.style.display = open ? 'none' : 'flex';
}

function closeEditorActions() {
    const dd = document.getElementById('editorActionsDropdown');
    if (dd) dd.style.display = 'none';
}

function toggleLumpsActions() {
    const dd  = document.getElementById('lumpsActionsDropdown');
    const btn = document.getElementById('lumpsActionsBtn');
    if (!dd) return;
    const open = dd.style.display !== 'none';
    if (open) {
        dd.style.display = 'none';
    } else {
        if (btn) {
            const r = btn.getBoundingClientRect();
            dd.style.position = 'fixed';
            dd.style.top      = (r.bottom + 4) + 'px';
            dd.style.right    = (window.innerWidth - r.right) + 'px';
            dd.style.left     = 'auto';
        }
        dd.style.display = 'flex';
    }
}

function closeLumpsActions() {
    const dd = document.getElementById('lumpsActionsDropdown');
    if (dd) dd.style.display = 'none';
}

function showLumpTypeSelector() {
    const m = document.getElementById('lumpTypeSelectorModal');
    if (m) m.style.display = 'flex';
}

function closeLumpTypeSelector() {
    const m = document.getElementById('lumpTypeSelectorModal');
    if (m) m.style.display = 'none';
}

function selectLumpType(type) {
    closeLumpTypeSelector();

    const titleEl = document.getElementById('lumpsDetailTitle');
    const contentEl = document.getElementById('lumpsDetailContent');
    const listEl = document.getElementById('lumpsListContent');

    if (type === 'namespace') {
        showNamespaceBuilder();
        return;
    }

    _selectedLumpToken = null;
    if (listEl) listEl.querySelectorAll('.lump-item').forEach(el => el.classList.remove('active'));

    const labels = {
        inform:   'Inform Lump (NS gtType=1, typ=00)',
        outform:  'Outform Lump (NS gtType=2, typ=11)',
        code:     'Code Lump (typ=00)',
        data:     'Data Lump (typ=01)',
        thread:   'Thread Lump (typ=10)',
        text:     'Text Lump (.type=text)',
        markdown: 'Markdown Lump (.type=markdown)',
        image:    'Image Lump (.type=image)',
    };
    const notes = {
        inform:   'Inform lumps are the standard callable abstraction type in the Church Machine capability model. The NS entry\'s <strong>gtType=Inform(1)</strong> permits CALL, LOAD, and TPERM(E) access. The lump header uses <strong>typ=00</strong> (code). All Boot.Abstr lumps and the pre-built abstractions (LED flash, Constants, SlideRule, etc.) are Inform type. Authoring: use <strong>Build LUMP ↓</strong> in the Editor.',
        outform:  'Outform lumps are the output-type abstraction in the Church Machine capability model. The NS entry\'s <strong>gtType=Outform(2)</strong> restricts the capability to output-producing access. The lump header uses <strong>typ=11</strong> (Outform). Used for hardware output capabilities and data-producing abstractions. Authoring via the IDE is coming in a future release.',
        code:     'Code lumps contain abstraction methods and are compiled from CLOOMC++ or Assembly source in the Editor. Use <strong>Build LUMP ↓</strong> in the Editor toolbar to compile and download a deployable .lump binary.',
        data:     'Data lumps store raw word arrays — constants, lookup tables, or binary blobs. Each 32-bit word maps directly to hardware memory. Data lump authoring via the IDE is coming in a future release.',
        thread:   'Thread lumps encapsulate a concurrent thread instance with its own capability c-list (typ=10). Thread authoring via the IDE is coming in a future release.',
        text:     'Text lumps store plain text encoded with Pack4 — 4 ASCII characters packed into each 32-bit word. Stored as a Data lump (typ=01) with <code>.type=text</code> in the sidecar. Text authoring via the IDE is coming in a future release.',
        markdown: 'Markdown lumps store documentation or rich text encoded with Pack4 — 4 chars per word. Stored as a Data lump (typ=01) with <code>.type=markdown</code> in the sidecar. Markdown authoring via the IDE is coming in a future release.',
        image:    'Image lumps store pixel data or encoded image bytes as a word array (typ=01, <code>.type=image</code>). Image import via the IDE is coming in a future release.',
    };

    if (titleEl) titleEl.textContent = `New ${labels[type] || type}`;
    if (contentEl) contentEl.innerHTML = `<div class="lumps-placeholder" style="text-align:left;padding:1.5rem 1rem;">
        <div style="font-size:0.95rem;font-weight:600;color:var(--church-gold);margin-bottom:0.6rem;">${labels[type] || type}</div>
        <div style="font-size:0.82rem;line-height:1.65;color:var(--text-secondary);">${notes[type] || ''}</div>
    </div>`;
}

let _viewLocked = false;
function switchView(viewId) {
    if (_viewLocked) return;
    if (viewId !== currentView && currentView === 'trace') {
        document.querySelectorAll('.trace-row-highlighted').forEach(el => el.classList.remove('trace-row-highlighted'));
        document.querySelectorAll('.trace-gatelog-back').forEach(el => el.remove());
    }
    if (viewId !== currentView) previousView = currentView;
    currentView = viewId;
    window.location.hash = viewId;
    try { localStorage.setItem('church_lastView', viewId); } catch(e) {}
    const backBtn = document.getElementById('backBtn');
    if (backBtn) backBtn.style.display = previousView ? 'inline-flex' : 'none';
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const el = document.getElementById(viewId);
    if (el) el.classList.add('active');

    document.querySelectorAll('.ham-item').forEach(btn => btn.classList.remove('ham-active'));
    const activeHamItem = document.getElementById('hamItem-' + viewId);
    if (activeHamItem) activeHamItem.classList.add('ham-active');

    if (viewId === 'dashboard') { restoreAutoBootPref(); updateDashboard(); }
    if (viewId === 'github') loadGitHubCommunity();
    if (viewId === 'namespace') updateNamespace();
    if (viewId === 'memory')    renderMemoryView();
    if (viewId === 'abstractions') renderAbstractions();
    if (viewId === 'lumps') renderLumps();
    if (viewId === 'pipeline') pipelineViz.render();
    if (viewId === 'builder' && typeof initBuilder === 'function') initBuilder();
    if (viewId === 'builder') initHardwareBuildPanel();
    if (viewId === 'devices') loadDeviceList();
    if (viewId === 'editor') {
        if (!_editorCREditActive) {
            if (activeUserTabId && userTabDirty) saveActiveUserTab();
            activeUserTabId = null;
            userTabDirty = false;
            document.querySelectorAll('.example-tab').forEach(t => t.classList.remove('active'));
            renderUserTabs();
            updateSaveUserTabBtn();
            const outputEl = document.getElementById('assemblyOutput');
            if (outputEl) outputEl.innerHTML = '';
            const sel = document.getElementById('langSelector');
            if (sel) showIntro(sel.value);
        }
        _updateEditorPatchBar();
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
        } else if (activeTutorial === 'englishloops' && englishLoopsTutorial) {
            englishLoopsTutorial.render('tutorialView');
        } else if (activeTutorial === 'englishstring' && englishStringTutorial) {
            englishStringTutorial.render('tutorialView');
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
    if (viewId === 'trace') renderTraceView();
    if (viewId === 'reference') renderReference();
    if (viewId === 'docs') loadDocsView();
    if (viewId === 'gc') renderToolsView();
}

let _lastGCResult   = null;
let _gcPhaseStep    = 0;       // 0=idle/done  1..4=waiting for next click
let _pendingGCPhases = null;   // phases[] from the current in-progress GC run

