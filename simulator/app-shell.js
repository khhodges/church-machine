// =============================================================================
// app.js — Church Machine IDE Front-End
// =============================================================================
(function() {
    window._r1DebugMode = true;
    document.documentElement.classList.add('r1-debug-mode');
    window._r1DebugViews = new Set();
})();
// S-IDE v1 auto-progress helpers
window._r1SetStep = function(step) {
    try { localStorage.setItem('r1_step' + step + '_done', '1'); } catch(e) {}
    var card = document.getElementById('r1StepCard' + step);
    var badge = document.getElementById('r1StepBadge' + step);
    if (card) card.classList.add('r1-done');
    if (badge) { badge.className = 'r1-step-badge r1-step-badge-done'; badge.textContent = 'Done ✓'; }
};
window._r1CheckSteps = function() {
    for (var i = 1; i <= 3; i++) {
        try { if (localStorage.getItem('r1_step' + i + '_done') === '1') window._r1SetStep(i); } catch(e) {}
    }
};
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
let _faultFreeInstrTotal = 0;  // cumulative fault-free instruction count for current source hash
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
let englishContactTutorial = null;
let activeTutorial = 'sliderule';
let cloomcCompiler = null;
let currentView = 'dashboard';
let previousView = null;
let lastAssembledWords = null;
let lastAssembledCapabilities = null;
let lastAssembledNamedSlots = null;
let lastMethodTableSize = 0;
let _pendingSimLoad = false;

// Called by _loadLumpBinaryIntoSim (app-lumps.js) after a LUMP binary is
// loaded directly into the simulator.  Clears the assembler-path state so
// that _applyPendingSimLoad() (in stepSim) and _autoLoadDefaultProgram() (on
// every reset) do not overwrite the freshly-loaded LUMP binary with whatever
// was previously assembled.
// IMPORTANT: these variables are declared with `let` and are therefore NOT
// accessible via window.X from other files — a setter function is the only
// correct cross-file write path.
function _clearAssembledProgramState() {
    lastAssembledWords    = null;
    lastAssembledCapabilities = null;
    lastAssembledNamedSlots = null;
    lastMethodTableSize   = 0;
    _pendingSimLoad       = false;
}
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
        _updateEditorCodeName('');
        const editor = document.getElementById('asmEditor');
        if (editor) editor.value = '';
        const sel = document.getElementById('langSelector');
        if (sel) showIntro(sel.value);
    }
    renderUserTabs();
    updateSaveUserTabBtn();
    updateSavePseudoBtn();
}

function selectUserTab(id) {
    if (activeUserTabId && userTabDirty) {
        saveActiveUserTab();
    }
    const tab = userTabs.find(t => t.id === id);
    if (!tab) return;
    activeUserTabId = id;
    userTabDirty = false;
    _updateEditorCodeName(tab.name);
    // Leaving catalog edit context when user picks a personal tab
    window._pseudoEditContext = null;
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
    updateSavePseudoBtn();
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

function updateSavePseudoBtn() {
    const btn = document.getElementById('btnSavePseudo');
    if (!btn) return;
    const ed = document.getElementById('asmEditor');
    const hasContent = !!(ed && ed.value.trim());
    btn.disabled = !hasContent;
    if (window._pseudoEditContext) {
        btn.innerHTML = '&#x2191; Compile &amp; Save';
        btn.title = 'Compile editor source and save to Logic Catalog method (Ctrl+Shift+S)';
        btn.setAttribute('data-tooltip', 'Compile & Save \u2014 compile and write back to the Logic Catalog method (Ctrl+Shift+S)');
    } else {
        btn.innerHTML = '&#x2193; Download .cloomc';
        btn.title = 'Download editor contents as .cloomc file';
        btn.setAttribute('data-tooltip', 'Download .cloomc \u2014 download the current editor source as a .cloomc file (Ctrl+Shift+S)');
    }
}

function clearPseudoEditContext() {
    window._pseudoEditContext = null;
    updateSavePseudoBtn();
}

function savePseudoCode() {
    const ed = document.getElementById('asmEditor');
    if (!ed || !ed.value.trim()) return;
    const src = ed.value;

    // If an edit context is live, compile & save to the Logic Catalog
    if (window._pseudoEditContext) {
        _compileSaveToMethod(src, window._pseudoEditContext.absIdx, window._pseudoEditContext.methodName);
        return;
    }

    // No edit context — download as file (original behaviour)
    var filename = 'program.cloomc';
    var nameMatch = src.match(/^\s*abstraction\s+([A-Za-z_][A-Za-z0-9_]*)/m);
    if (nameMatch) {
        filename = nameMatch[1].toLowerCase() + '.cloomc';
    } else {
        if (activeUserTabId) {
            var tab = userTabs.find(function(t) { return t.id === activeUserTabId; });
            if (tab && tab.name) {
                filename = tab.name.replace(/[^A-Za-z0-9_\-]/g, '_').replace(/^_+|_+$/g, '').toLowerCase() + '.cloomc';
                if (filename === '.cloomc') filename = 'program.cloomc';
            }
        }
    }

    var blob = new Blob([src], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    var outEl = document.getElementById('assemblyOutput');
    if (outEl) {
        var msg = document.createElement('div');
        msg.style.cssText = 'color:#8f8;font-style:italic;padding:2px 0;';
        msg.textContent = 'Saved ' + filename;
        outEl.appendChild(msg);
        setTimeout(function() { if (msg.parentNode) msg.parentNode.removeChild(msg); }, 1500);
    }
}

// Maximum versions kept per method in the history stack
var _METHOD_HISTORY_LIMIT = 20;

function _compileSaveToMethod(src, absIdx, methodName) {
    const compiler = (typeof cloomcCompiler !== 'undefined') ? cloomcCompiler : null;
    if (!compiler) {
        var outEl = document.getElementById('assemblyOutput');
        if (outEl) {
            var msg = document.createElement('div');
            msg.style.cssText = 'color:#f88;padding:2px 0;';
            msg.textContent = 'Compile & Save: compiler not ready. Try again after boot.';
            outEl.appendChild(msg);
        }
        return;
    }

    const key = `${absIdx}:${methodName}`;
    const prev = userMethodData[key] ? JSON.parse(JSON.stringify(userMethodData[key])) : null;

    const result = compiler.compile(src, []);
    const now = Date.now();
    const lang = result.language || 'assembly';

    let compiledWords = null;
    let compileError = null;

    if (result.errors && result.errors.length > 0) {
        compileError = result.errors.map(function(e) {
            return 'Line ' + (e.line || '?') + ': ' + e.message;
        }).join('\n');
    } else {
        const targetMethod = (result.methods || []).find(function(m) { return m.name === methodName; });
        if (targetMethod) {
            compiledWords = (targetMethod.code || []).slice();
        } else if (result.methods && result.methods.length > 0) {
            // Single-method source — use whatever came out
            compiledWords = (result.methods[0].code || []).slice();
        } else {
            compiledWords = [];
        }
    }

    if (!userMethodData[key]) userMethodData[key] = {};
    const current = userMethodData[key];

    // Push previous version onto front of history stack
    if (prev && (prev.example || prev.compiled || prev.compileError)) {
        if (!current.history) current.history = [];
        current.history.unshift({
            src: prev.example || '',
            compiled: prev.compiled || null,
            compileError: prev.compileError || null,
            savedAt: prev.compiledAt || now,
            lang: prev.compiledLang || 'unknown'
        });
        if (current.history.length > _METHOD_HISTORY_LIMIT) {
            current.history.length = _METHOD_HISTORY_LIMIT;
        }
    }

    // Update current entry
    current.example = src;
    current.compiled = compiledWords;
    current.compileError = compileError;
    current.compiledAt = now;
    current.compiledLang = lang;

    _absMethodsSave();

    // Refresh the abstraction detail panel
    if (typeof showAbstractionDetail === 'function') showAbstractionDetail(absIdx);

    // Auto-assemble if all methods are compiled
    if (!compileError && typeof _tryAutoAssembleLump === 'function') _tryAutoAssembleLump(absIdx);

    // Show feedback in editor console
    var outEl = document.getElementById('assemblyOutput');
    if (outEl) {
        var msg = document.createElement('div');
        if (compileError) {
            msg.style.cssText = 'color:#f88;font-weight:600;padding:2px 0;';
            msg.textContent = '\u2717 Compile error in ' + methodName + ' \u2014 stored as \u2022Error';
        } else if (!compiledWords || compiledWords.length === 0) {
            msg.style.cssText = 'color:#fa8;font-weight:600;padding:2px 0;';
            msg.textContent = '\u25cb Saved ' + methodName + ' as \u2022Pseudo \u2014 no instructions compiled yet';
        } else {
            msg.style.cssText = 'color:#8f8;font-weight:600;padding:2px 0;';
            msg.textContent = '\u2713 Compiled & saved ' + methodName + ' (' + compiledWords.length + ' words, ' + lang + ')';
        }
        outEl.appendChild(msg);
        setTimeout(function() { if (msg.parentNode) msg.parentNode.removeChild(msg); }, 3000);
    }
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
    if (typeof BOOT_UPLOADS !== 'undefined') {
        for (const upload of BOOT_UPLOADS) {
            const _abs = abstractionRegistry.getAbstraction(upload.index);
            if (_abs && Array.isArray(upload.capabilities) && upload.capabilities.length > 0) {
                _abs.capabilities = upload.capabilities.map(c => ({
                    name: c.name || c.type || '',
                    target: (c.target != null) ? c.target : null,
                    grants: Array.isArray(c.grants) ? c.grants : []
                }));
            }
        }
    }
    systemAbstractions = new SystemAbstractions(abstractionRegistry);
    deviceAbstractions = new DeviceAbstractions(abstractionRegistry);
    sim.initAbstractions(abstractionRegistry, systemAbstractions, deviceAbstractions);
    // Wire abstraction names into the assembler symbol table so the named
    // shorthand syntax works:  LOAD CR11, SlideRule  (two-operand shorthand),
    // and after that instruction any  CALL SlideRule  → CALL CR11  (loaded-CR resolution).
    {
        const _nsSymMap = {};
        for (const [slot, abs] of Object.entries(abstractionRegistry.abstractions)) {
            _nsSymMap[abs.name] = parseInt(slot);
        }
        assembler.setNamespace(_nsSymMap);
    }
    ChurchAssembler.setRegistry(abstractionRegistry);
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
        // Populate method conventions from the AbstractionRegistry so the compiler
        // emits the correct CALL selector for capability methods (e.g. Billing.Balance
        // is selector 4, not 0). Without this, every single-call method compiles to
        // identical bytecode and shows as "alias of <first method>".
        if (typeof abstractionRegistry !== 'undefined' && abstractionRegistry &&
                abstractionRegistry.abstractions) {
            const convs = {};
            for (const idx in abstractionRegistry.abstractions) {
                const abs = abstractionRegistry.abstractions[idx];
                if (abs && abs.name && Array.isArray(abs.methods)) {
                    const key = abs.name.toUpperCase();
                    convs[key] = {};
                    abs.methods.forEach((mName, i) => { convs[key][mName] = { index: i }; });
                }
            }
            cloomcCompiler.methodConventions = convs;
        }
    }

    sim.on('stateChange', () => { updateDashboard(); updateLedStrip(); updateToolbarIdeBadge(); if (currentView === 'gt-view') renderGTView(); });
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
                   try {
                       sim.loadBootImage(buf); _applyBootEntryToSim();
                       // Evict stale sticky patches for all NS slots now owned
                       // by the boot image.  Patches that differ from the new
                       // binary are cleared and reported; matching (redundant)
                       // patches are cleared silently.  Must run before
                       // _reapplyStickyPatches() fires at boot completion.
                       if (typeof window._clearBootImageStickyPatches === 'function') {
                           window._clearBootImageStickyPatches(sim.nsCount || 0);
                       }
                   } catch(e) { console.warn('[bootImage] apply failed:', e); } }
        // Re-apply user-assigned namespace labels that sim.loadBootImage() may
        // have overwritten (the boot image zeros any NS slot it does not populate,
        // including free slots where the user stored custom pet names).
        // loadNamespaceState() skips slots where isNSEntryValid() is true, so
        // boot-image catalog entries take precedence; only truly empty slots
        // (like user-defined slot 50+) are restored from localStorage.
        loadNamespaceState();
        // ALL auto-boot fires HERE (inside the .then) so that:
        //   1. window.bootImage is already set → sim.reset() → _maybeApplyBootImage()
        //      loads the correct binary immediately.
        //   2. _clearBootImageStickyPatches() has already run → _stickyPatches is
        //      empty → _reapplyStickyPatches() inside _autoLoadDefaultProgram() is
        //      a no-op → the stale sticky patch can never overwrite sim.memory.
        // Previously auto-boot fired from requestAnimationFrame (before the fetch
        // resolved) so _reapplyStickyPatches() ran with the stale patch still live.
        if (!sim.bootComplete) {
            const _abChk = document.getElementById('autoBootChk');
            if (_abChk && _abChk.checked) resetSim();
        }
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
        // Persist the updated fault log so this fault survives a page reload,
        // even when triggered via single-step / stepSim rather than a full run.
        if (typeof _saveFaultLog === 'function') _saveFaultLog();
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
    updateSavePseudoBtn();
    renderUserTabs();
    initReplDivider();
    initEditorDivider();
    initConsoleAutoSwitch();
    // Debounced recalculation of error/warning underlines — called whenever the
    // editor dimensions change (browser zoom, future font-size setting, window resize).
    // 150 ms debounce avoids rapid recomputes during continuous zoom steps.
    var _errorRecalcTimer = null;
    function _debouncedErrorRecalc() {
        clearTimeout(_errorRecalcTimer);
        _errorRecalcTimer = setTimeout(function() {
            if (typeof _highlightAsmErrorLines === 'function' &&
                    typeof _activeAsmErrors !== 'undefined' &&
                    _activeAsmErrors.length > 0) {
                _highlightAsmErrorLines(_activeAsmErrors);
            }
            if (typeof _highlightAsmWarningLines === 'function' &&
                    typeof _activeAsmWarnings !== 'undefined' &&
                    _activeAsmWarnings.length > 0) {
                _highlightAsmWarningLines(_activeAsmWarnings);
            }
        }, 150);
    }

    const asmEd = document.getElementById('asmEditor');
    if (asmEd) {
        var _editorAutoSaveTimer = null;
        asmEd.addEventListener('input', function() {
            updateLineNumbers(); markUserTabDirty(); updateSavePseudoBtn();
            clearTimeout(_editorAutoSaveTimer);
            _editorAutoSaveTimer = setTimeout(saveEditorState, 800);
        });
        // ── WIP source auto-save (debounced 3 s) ─────────────────────────────
        // When a WIP abstraction token is stored in localStorage (set by the
        // /start page 'Code Edit →' flow), every edit is patched back to the
        // server sidecar so the source is never lost between sessions.
        var _wipSrcSaveTimer = null;
        asmEd.addEventListener('input', function() {
            clearTimeout(_wipSrcSaveTimer);
            _wipSrcSaveTimer = setTimeout(function() {
                try {
                    var _tok = localStorage.getItem('church_wip_token');
                    if (!_tok) return;
                    fetch('/api/lump/' + _tok + '/wip-source', {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ source: asmEd.value })
                    }).catch(function() {});
                } catch (_e) {}
            }, 3000);
        });
        asmEd.addEventListener('scroll', syncLineScroll);
        if (typeof ResizeObserver !== 'undefined') {
            new ResizeObserver(function() { syncLineScroll(); _debouncedErrorRecalc(); }).observe(asmEd);
        }
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
    window.addEventListener('resize', function() { syncLineScroll(); _debouncedErrorRecalc(); });
    const asmOverlay = document.getElementById('asmErrorOverlay');
    if (asmOverlay && typeof MutationObserver !== 'undefined') {
        new MutationObserver(syncLineScroll).observe(asmOverlay, { childList: true });
    }
    const asmWarnOverlay = document.getElementById('asmWarningOverlay');
    if (asmWarnOverlay && typeof MutationObserver !== 'undefined') {
        new MutationObserver(syncLineScroll).observe(asmWarnOverlay, { childList: true });
    }
    updateLineNumbers();
    loadNamespaceState();
    // Probe server for OPENAI_API_KEY availability (hides Generate button if missing).
    // Default false — button stays hidden until server confirms key is set.
    window._hasOpenAIKey = false;
    window._generateToken = null;
    fetch('/api/generate-method-available').then(function(r) { return r.json(); }).then(function(d) {
        window._hasOpenAIKey = !!d.available;
        window._generateToken = d.token || null;  // session token for POST /api/generate-method
        // If the key is confirmed available and an abstraction is currently shown,
        // re-render the detail panel so the Generate button appears immediately.
        if (window._hasOpenAIKey && typeof selectedAbsIndex === 'number' && selectedAbsIndex >= 0) {
            if (typeof showAbstractionDetail === 'function') showAbstractionDetail(selectedAbsIndex);
        }
    }).catch(function() { window._hasOpenAIKey = false; });
    checkBootId();
    const views = ['repl','editor','start','tutorial','dashboard','namespace','hello-mum','abstractions','lumps','pipeline','trace','reference','docs','builder','sitemap','gc','devices','github','memory','gt-view'];
    const rawHash = window.location.hash.replace('#', '');
    const [hashView, hashQuery] = rawHash.split('?');
    const hashParams = {};
    if (hashQuery) hashQuery.split('&').forEach(p => { const [k,v] = p.split('='); hashParams[k] = v; });
    let startView = views.includes(hashView) ? hashView : null;
    // church_defaultView wins only when there is no explicit URL hash.
    // An explicit hash (e.g. from a landing-page link) always takes priority.
    // _startupDefaultView is set in both cases so the boot-animation guard in
    // switchView() blocks intermediate redirects (dashboard, pipeline) until
    // slowBoot() clears it. Search: _startupDefaultView
    window._startupDefaultView = null;
    try {
        const _def = localStorage.getItem('church_defaultView');
        if (_def && views.includes(_def)) {
            if (!startView) {
                // No URL hash — honour the stored default view.
                window._startupDefaultView = _def;
                startView = _def;
            } else {
                // URL hash present — the link wins, but still arm the guard
                // so boot animation cannot override the hash-chosen view.
                window._startupDefaultView = startView;
            }
        }
    } catch(e) {}
    if (!startView) {
        try { const saved = localStorage.getItem('church_lastView'); if (saved && views.includes(saved)) startView = saved; } catch(e) {}
    }
    if (!startView) startView = 'dashboard';
    switchView(startView);
    if (startView === 'builder' && hashParams.tab) {
        const _hashBuilderTab = hashParams.tab;
        setTimeout(function() {
            if (typeof switchBuilderViewTab === 'function') switchBuilderViewTab(_hashBuilderTab);
        }, 150);
    }
    if (startView === 'namespace' && hashParams.ns !== undefined) {
        const nsSlot = parseInt(hashParams.ns, 10);
        if (!isNaN(nsSlot)) {
            setTimeout(function() {
                if (typeof toggleNSDetail === 'function') toggleNSDetail(nsSlot);
                const row = document.getElementById('ns-row-' + nsSlot);
                if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 120);
        }
    }
    switchMathMode('hp35');
    _initDefaultViewBolt();

    // Global keyboard shortcuts: Ctrl+<letter> → switch top-level view.
    // Skipped when focus is inside any text input / textarea / contenteditable.
    document.addEventListener('keydown', function _ideNavShortcut(e) {
        // Ctrl+Shift+S — Save Pseudo Code (download editor source as .cloomc)
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
            e.preventDefault();
            savePseudoCode();
            return;
        }
        // Ctrl+Shift+L — jump directly to Source Library (Abstractions → Sources tab)
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'l') {
            const tag = document.activeElement ? document.activeElement.tagName : '';
            if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' &&
                !(document.activeElement && document.activeElement.isContentEditable)) {
                e.preventDefault();
                switchView('abstractions');
                switchAbsSubtab('sources');
                return;
            }
        }
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

    // "?" — open keyboard shortcuts help overlay (only when not in a text field)
    document.addEventListener('keydown', function _shortcutsHelpKey(e) {
        if (e.key !== '?' && !(e.key === '/' && (e.ctrlKey || e.metaKey))) return;
        const tag = document.activeElement ? document.activeElement.tagName : '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
            (document.activeElement && document.activeElement.isContentEditable)) return;
        e.preventDefault();
        openShortcutsHelp();
    });

    requestAnimationFrame(() => {
        updateDashboard();
        pipelineViz.render();
        initTooltipAutoFlip();
        hideLoadingOverlay();
        // Auto-boot is now deferred to _probeBootImage().then() so that
        // _clearBootImageStickyPatches() always runs before _reapplyStickyPatches().
        // Do NOT call resetSim() here — the fetch hasn't returned yet and the
        // stale sticky-patch eviction hasn't happened.
    });
}

function openShortcutsHelp() {
    const modal = document.getElementById('shortcutsModal');
    if (!modal) return;
    modal.style.display = 'flex';
    document.addEventListener('keydown', _shortcutsEscHandler, true);
    const closeBtn = modal.querySelector('.shortcuts-close-btn');
    if (closeBtn) closeBtn.focus();
}

function closeShortcutsHelp() {
    const modal = document.getElementById('shortcutsModal');
    if (!modal) return;
    modal.style.display = 'none';
    document.removeEventListener('keydown', _shortcutsEscHandler, true);
}

function _shortcutsEscHandler(e) {
    if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeShortcutsHelp();
    }
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
            {
                const lastWhatsNewVersion = localStorage.getItem('church_whatsnew_version');
                if (lastWhatsNewVersion !== WHATS_NEW_VERSION) {
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

const _hamCtxActions = {
    'develop':   () => { switchView('editor');       closeHamburger(); },
    'test':      () => { openSimulatorFromMenu(); },
    'review':    () => { switchView('abstractions'); closeHamburger(); },
    'hardware':  () => { switchView('memory');       closeHamburger(); },
    'configure': () => { switchView('devices');      closeHamburger(); },
    'install':   () => { switchView('builder');      closeHamburger(); },
};

function showHamCtxMenu(event, actionKey, label) {
    event.preventDefault();
    event.stopPropagation();
    const menu = document.getElementById('hamCtxMenu');
    if (!menu) return;
    const item = document.getElementById('hamCtxMenuItem');
    if (item) {
        item.textContent = label;
        item.onclick = function() {
            hideHamCtxMenu();
            const fn = _hamCtxActions[actionKey];
            if (fn) fn();
        };
    }
    menu.style.display = 'block';
    menu.style.left = event.clientX + 'px';
    menu.style.top  = event.clientY + 'px';
    requestAnimationFrame(() => {
        const r = menu.getBoundingClientRect();
        if (r.right  > window.innerWidth  - 8) menu.style.left = (window.innerWidth  - r.width  - 8) + 'px';
        if (r.bottom > window.innerHeight - 8) menu.style.top  = (window.innerHeight - r.height - 8) + 'px';
    });
}

function hideHamCtxMenu() {
    const menu = document.getElementById('hamCtxMenu');
    if (menu) menu.style.display = 'none';
}

document.addEventListener('mousedown', function(e) {
    if (!e.target.closest('#hamCtxMenu')) hideHamCtxMenu();
});

function openSimulatorFromMenu() {
    switchView('dashboard');
    switchDashTab('cr');
    closeHamburger();
}

function saveAutoBootPref() {
    const chk = document.getElementById('autoBootChk');
    if (!chk) return;
    try { localStorage.setItem('churchMachine_autoBootOnOpen', chk.checked ? '1' : '0'); } catch(e) {}
}

function restoreAutoBootPref() {
    const chk = document.getElementById('autoBootChk');
    if (!chk) return;
    // Default is ON — auto-boot unless the user has explicitly turned it off.
    // A saved value of '0' means the user unchecked it; anything else (including
    // null for first-time visitors) means auto-boot is enabled.
    try { chk.checked = localStorage.getItem('churchMachine_autoBootOnOpen') !== '0'; } catch(e) {}
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

    if (type === 'code' || type === 'inform') {
        const blankTemplate =
            `; New CLOOMC++ Abstraction\n` +
            `; Replace <Name> with your abstraction name and define methods below.\n` +
            `;\n` +
            `; Pet names map capability registers to human-readable names.\n` +
            `; Use Lambda and Macro constructs — no RAW ISA, no hex opcodes.\n` +
            `\n` +
            `Abstraction <Name> {\n` +
            `    ; Capabilities (c-list entries — give each a pet name)\n` +
            `    ; Example: CR0 = str, CR1 = count, CR2 = result\n` +
            `\n` +
            `    Method Init(str, count) {\n` +
            `        ; Initialise the abstraction state\n` +
            `        result ← 0\n` +
            `        RETURN result\n` +
            `    }\n` +
            `}\n`;

        if (contentEl) contentEl.innerHTML = '';
        const srcEl = document.getElementById('lumpWsSourceContent');
        if (srcEl) {
            srcEl.__sourceLoaded = true;
            srcEl.innerHTML = `<div class="lump-source-toolbar">
                <span class="lump-source-lang-badge">CLOOMC++</span>
                <div class="lump-source-ham-wrap">
                    <button class="lump-source-ham-btn" onclick="_toggleLumpMenu(this)" title="Editor actions">&#9776;</button>
                    <div class="lump-source-menu">
                        <button class="lump-source-menu-item" onclick="document.querySelectorAll('.lump-source-menu.open').forEach(m=>m.classList.remove('open'));_lumpSourceDraft()" title="Draft \u2014 Show structural layout without building binary">Draft</button>
                        <button class="lump-source-menu-item" onclick="document.querySelectorAll('.lump-source-menu.open').forEach(m=>m.classList.remove('open'));auditLumpOnly()" title="Audit LUMP \u2014 Compile and run structural checks without saving">Audit</button>
                        <button class="lump-source-menu-item lump-source-menu-item-build" onclick="document.querySelectorAll('.lump-source-menu.open').forEach(m=>m.classList.remove('open'));_lumpSourceBuildLump()" title="Build LUMP \u2014 Compile and download .lump binary">Build LUMP &#8595;</button>
                    </div>
                </div>
                <button class="lump-source-btn" onclick="_lumpSourceCompile()" title="Compile \u2014 Compile source and preview in Binary tab">&#9654; Compile</button>
            </div>
            <textarea class="lump-source-textarea" id="lumpSourceEditor" spellcheck="false" autocorrect="off" autocapitalize="off">${blankTemplate.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</textarea>
            <div class="lump-source-status" id="lumpSourceStatus">Edit the template above, then Compile or Build LUMP.</div>`;
        }
        const bar = document.getElementById('lumpWsTabBar');
        if (bar) bar.style.display = 'flex';
        if (typeof switchLumpWsTab === 'function') switchLumpWsTab('source');
        return;
    }

    if (contentEl) contentEl.innerHTML = `<div class="lumps-placeholder" style="text-align:left;padding:1.5rem 1rem;">
        <div style="font-size:0.95rem;font-weight:600;color:var(--church-gold);margin-bottom:0.6rem;">${labels[type] || type}</div>
        <div style="font-size:0.82rem;line-height:1.65;color:var(--text-secondary);">${notes[type] || ''}</div>
    </div>`;
}

let _viewLocked = false;
function switchView(viewId) {
    if (_viewLocked) return;
    // S-IDE v1: guard — redirect debug-only views to tutorial unless ?debug=1
    if (window._r1DebugViews && window._r1DebugViews.has(viewId) && !window._r1DebugMode) {
        var _el = document.getElementById(viewId);
        if (!_el) { viewId = 'tutorial'; }
        // views exist in DOM but are only shown in debug mode — allow if element present
    }
    // _startupDefaultView GUARD: while the boot animation is running,
    // block any redirect to a non-default view (dashboard from resetSim,
    // pipeline from slowBoot) so the user always lands on their chosen page.
    // Set in init(); cleared by slowBoot() when boot completes.
    // Search: _startupDefaultView
    if (window._startupDefaultView && viewId !== window._startupDefaultView &&
            typeof bootAnimating !== 'undefined' && bootAnimating) return;
    if (viewId === 'abstractions') {
        if (typeof _selectedLumpToken !== 'undefined') _selectedLumpToken = null;
    }
    if (viewId !== currentView && currentView === 'trace') {
        document.querySelectorAll('.trace-row-highlighted').forEach(el => el.classList.remove('trace-row-highlighted'));
        document.querySelectorAll('.trace-gatelog-back').forEach(el => el.remove());
    }
    // ── LUMP-edit dirty-listener teardown when leaving the editor ─────────
    // Prevents stale autosave listeners from persisting across view switches.
    if (viewId !== 'editor' && currentView === 'editor') {
        if (window._editorLumpDirtyListener && window._editorLumpDirtyListenerEl) {
            window._editorLumpDirtyListenerEl.removeEventListener('input', window._editorLumpDirtyListener);
        }
        window._editorLumpDirtyListener = null;
        window._editorLumpDirtyToken    = null;
        // Remove the toolbar Discard button if it was injected for a LUMP edit
        var _exitDiscardBtn = document.getElementById('btnDiscardLumpEdit');
        if (_exitDiscardBtn) _exitDiscardBtn.remove();
    }
    if (viewId !== currentView && currentView === 'devices' && typeof stopDeviceTunnelPolling === 'function') {
        stopDeviceTunnelPolling();
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
    if (viewId === 'namespace') { updateNamespace(); setTimeout(function() { const tbl = document.getElementById('namespaceTable'); if (tbl) tbl.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 80); }
    if (viewId === 'memory')    renderMemoryView();
    if (viewId === 'abstractions') renderAbstractions();
    if (viewId === 'lumps') {
        const _wsBar = document.getElementById('lumpWsTabBar');
        if (_wsBar) _wsBar.style.display = 'flex';
        if (typeof switchLumpWsTab === 'function' && !_selectedLumpToken) switchLumpWsTab('logic');
        renderLumps();
    }
    if (viewId === 'gt-view') renderGTView();
    if (viewId === 'pipeline' && pipelineViz) pipelineViz.render();
    if (viewId === 'start') {
        if (typeof window._r1CheckSteps === 'function') window._r1CheckSteps();
    }
    if (viewId === 'builder' && typeof initBuilder === 'function') initBuilder();
    if (viewId === 'builder') {
        initHardwareBuildPanel();
        var _savedBuilderTab = (function(){ try { return localStorage.getItem('church_builderTab'); } catch(e) { return null; } })();
        if (typeof switchBuilderViewTab === 'function') switchBuilderViewTab(_savedBuilderTab || 'ti60-connect');
        var _bns = document.getElementById('buildNextSteps');
        var _bnc = document.getElementById('buildNextStepsChevron');
        if (_bns) _bns.classList.add('collapsed');
        if (_bnc) _bnc.textContent = '\u25BA';
    }
    if (viewId === 'devices') { loadDeviceList(); _startCallhomeLog(); _startUartLog(); _cmFetchWordCaches(); }
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
        } else if (activeTutorial === 'englishcontact' && englishContactTutorial) {
            englishContactTutorial.render('tutorialView');
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
    _applyToolbarGroups(viewId);
}

const _TOOLBAR_SIM_VIEWS = new Set([
    'dashboard','pipeline','namespace','abstractions','editor','repl',
    'memory','gc','gt-view','trace','hello-mum'
]);
const _TOOLBAR_CONFIG_VIEWS = new Set(['builder','lumps','devices','github']);

function _applyToolbarGroups(viewId) {
    const simEl    = document.getElementById('toolbarGroupSim');
    const configEl = document.getElementById('toolbarGroupConfig');
    const infoEl   = document.getElementById('toolbarGroupInfo');
    if (!simEl || !configEl || !infoEl) return;
    let group = 'info';
    if (_TOOLBAR_SIM_VIEWS.has(viewId))    group = 'sim';
    else if (_TOOLBAR_CONFIG_VIEWS.has(viewId)) group = 'config';
    simEl.classList.toggle('toolbar-group--hidden',    group !== 'sim');
    configEl.classList.toggle('toolbar-group--hidden', group !== 'config');
    infoEl.classList.toggle('toolbar-group--hidden',   group !== 'info');
}

let _lastGCResult   = null;
let _gcPhaseStep    = 0;       // 0=idle/done  1..4=waiting for next click
let _pendingGCPhases = null;   // phases[] from the current in-progress GC run

// ── Default-view lightning bolt drag-and-drop ──────────────────────────────
function _initDefaultViewBolt() {
    const views = ['repl','editor','start','tutorial','dashboard','namespace','hello-mum','abstractions','lumps','pipeline','trace','reference','docs','builder','sitemap','gc','devices','github','memory','gt-view'];
    const bolt = document.getElementById('hamDefaultBolt');
    const clearBtn = document.getElementById('hamDefaultClear');
    if (!bolt) return;

    function _refreshDefaultBadges() {
        let cur = null;
        try { cur = localStorage.getItem('church_defaultView'); } catch(e) {}
        document.querySelectorAll('.ham-item').forEach(function(btn) {
            btn.classList.remove('ham-is-default');
        });
        if (cur) {
            const el = document.getElementById('hamItem-' + cur);
            if (el) el.classList.add('ham-is-default');
        }
        if (clearBtn) clearBtn.style.display = cur ? 'inline' : 'none';
    }

    bolt.addEventListener('dragstart', function(e) {
        e.dataTransfer.setData('text/plain', 'defaultViewBolt');
        e.dataTransfer.effectAllowed = 'copy';
    });

    document.querySelectorAll('.ham-item[id^="hamItem-"]').forEach(function(btn) {
        const viewId = btn.id.replace('hamItem-', '');
        if (!views.includes(viewId)) return;
        btn.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            btn.classList.add('ham-drop-active');
        });
        btn.addEventListener('dragleave', function() {
            btn.classList.remove('ham-drop-active');
        });
        btn.addEventListener('drop', function(e) {
            e.preventDefault();
            btn.classList.remove('ham-drop-active');
            if (e.dataTransfer.getData('text/plain') !== 'defaultViewBolt') return;
            try { localStorage.setItem('church_defaultView', viewId); } catch(e2) {}
            _refreshDefaultBadges();
            const label = btn.textContent.replace('⚡','').trim().split('\n')[0].trim();
            appendOutput('Default page set to: ' + label + ' (' + viewId + ')', 'info');
        });
    });

    window._clearDefaultView = function() {
        try { localStorage.removeItem('church_defaultView'); } catch(e) {}
        _refreshDefaultBadges();
    };

    _refreshDefaultBadges();
}

// Expose init() on window so cross-script callers (app-misc.js DOMContentLoaded)
// can reliably reach it regardless of how the browser resolves global identifiers
// across classic <script> tags.  Function declarations are technically on window
// already, but being explicit guarantees it survives any caching or realm edge-cases.
window.init = init;

// ── Resume Draft hamburger button ─────────────────────────────────────────────
// Runs independently of init() so it fires on every hard load regardless of
// whether the full IDE init sequence has completed.
document.addEventListener('DOMContentLoaded', function() {
    try {
        var draft = localStorage.getItem('church_l5_draft');
        var btn = document.getElementById('hamItem-resume-draft');
        if (btn) btn.style.display = draft ? '' : 'none';
    } catch(e) {}
});

