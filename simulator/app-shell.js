// =============================================================================
// app.js — Church Machine IDE Front-End
// =============================================================================
(function() {
    window._r1DebugMode = true;
    document.documentElement.classList.add('r1-debug-mode');
    window._r1DebugViews = new Set();
    var _qLearn = new URLSearchParams(window.location.search).get('learn');
    if (_qLearn === '1') {
        window._r1LearnMode = true;
        document.documentElement.classList.add('r1-learn-mode');
    }
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
//   document.onkeydown          — F8 = step, F5 = run, Escape = stop
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
let currentView = 'home';
let previousView = null;
let lastAssembledWords = null;
let lastAssembledCapabilities = null;
let lastAssembledNamedSlots = null;
let lastMethodTableSize = 0;
let _pendingSimLoad = false;

// ── Execution identity ─────────────────────────────────────────────────────
// This is deliberately browser-side provenance, not a replacement for LUMP
// identity or Namespace authority.  It answers the programmer's more immediate
// question: "what bytes/source does the thing I am looking at belong to?"
let _executionIdentity = {
    status: 'unverified',
    abstraction: null,
    token: null,
    sourceHashUsed: null,
    editorSourceHash: null,
    binaryHash: null,
    fetchedBinaryHash: null,
    binaryStatus: 'unverified',
    sourceStatus: 'unverified',
    nsSlot: null,
    nsSequence: null,
    runStatus: 'idle',
    runKind: null,
    liveMemoryKnown: false,
    reason: 'No verified program is loaded',
};
let _executionIdentityLastAnnouncement = null;

function _executionIdentityHashSource(source) {
    // A synchronous, deterministic source fingerprint keeps typing responsive.
    // It is only used to compare the current editor with this browser session's
    // run; saved LUMP source provenance remains the server-supplied SHA-256.
    const text = String(source == null ? '' : source);
    let h1 = 0x811c9dc5;
    let h2 = 0x9e3779b9;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        h1 ^= c; h1 = Math.imul(h1, 0x01000193);
        h2 ^= (c + i) & 0xffff; h2 = Math.imul(h2, 0x85ebca6b);
    }
    return 'fnv1a:' + (h1 >>> 0).toString(16).padStart(8, '0') +
        (h2 >>> 0).toString(16).padStart(8, '0');
}

function _executionIdentityNormalizeHash(value) {
    if (value == null) return null;
    const text = String(value).trim().replace(/^sha256:/i, '').replace(/^0x/i, '').toLowerCase();
    return text || null;
}

function _executionIdentityEsc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function _executionIdentityShort(value, length) {
    const text = String(value == null ? '' : value);
    const max = length || 18;
    return text.length > max ? text.slice(0, Math.max(4, max - 1)) + '…' : text;
}

function _executionIdentityRecompute() {
    const s = _executionIdentity;
    if (!s.liveMemoryKnown) {
        s.status = 'unverified';
        s.reason = s.clearReason || 'Simulator memory has no known execution identity';
    } else if (s.binaryStatus === 'mismatched') {
        s.status = 'mismatched';
        s.reason = 'Fetched binary differs from its compile-time hash';
    } else if (s.sourceStatus === 'stale') {
        s.status = 'stale';
        s.reason = 'Editor source differs from the source used for this run';
    } else if (!s.sourceComparable) {
        s.status = 'unverified';
        s.reason = 'Source bytes are unavailable, so editor freshness cannot be verified';
    } else if (s.binaryStatus !== 'verified') {
        s.status = 'unverified';
        s.reason = 'No compile-time binary hash is available';
    } else {
        s.status = 'current';
        s.reason = 'Editor, binary, and live memory agree with this run';
    }
}

function _executionIdentityRenderOne(id) {
    const host = document.getElementById(id);
    if (!host) return;
    const s = _executionIdentity;
    const labels = {
        current: 'CURRENT',
        stale: 'STALE EDITOR',
        mismatched: 'MISMATCHED BINARY',
        unverified: 'UNVERIFIED',
    };
    const statusLabel = labels[s.status] || 'UNVERIFIED';
    const abstraction = s.abstraction || 'No program loaded';
    const token = s.token || '—';
    const binary = s.binaryStatus === 'verified' ? 'verified' :
        s.binaryStatus === 'mismatched' ? 'mismatch' : 'unverified';
    const source = s.sourceStatus === 'stale' ? 'editor differs' :
        s.sourceStatus === 'current' ? 'editor matches' :
        s.sourceStatus === 'recorded' ? 'hash only' : 'not available';
    const slot = s.nsSlot == null ? '—' :
        String(s.nsSlot) + (s.nsSequence == null ? '' : ` / seq ${s.nsSequence}`);
    host.className = `execution-identity-strip execution-identity-${s.status}`;
    host.setAttribute('aria-label', `Execution identity: ${statusLabel}. ${s.reason}`);
    host.title = s.reason;
    host.innerHTML =
        `<span class="execution-identity-state" title="${_executionIdentityEsc(s.reason)}">${statusLabel}</span>` +
        `<span class="execution-identity-program" title="Executing abstraction: ${_executionIdentityEsc(abstraction)}">` +
            `<b>Program</b> ${_executionIdentityEsc(_executionIdentityShort(abstraction, 28))}</span>` +
        `<span title="LUMP token: ${_executionIdentityEsc(token)}"><b>Token</b> ${_executionIdentityEsc(_executionIdentityShort(token, 18))}</span>` +
        `<span title="Source used for run: ${_executionIdentityEsc(s.sourceHashUsed || 'not recorded')}"><b>Source</b> ${_executionIdentityEsc(source)}</span>` +
        `<span title="Binary verification: ${_executionIdentityEsc(s.fetchedBinaryHash || s.binaryHash || 'no baseline')}"><b>Binary</b> ${binary}</span>` +
        `<span title="Namespace slot and retained sequence"><b>NS</b> ${_executionIdentityEsc(slot)}</span>` +
        `<span class="execution-identity-run" title="Run status"><b>Run</b> ${_executionIdentityEsc(s.runStatus || 'idle')}</span>`;
}

function _executionIdentityRender() {
    _executionIdentityRecompute();
    _executionIdentityRenderOne('executionIdentityEditor');
    _executionIdentityRenderOne('executionIdentityTrace');
    _executionIdentityRenderOne('executionIdentityHwTrace');
    const announcement = [
        _executionIdentity.status,
        _executionIdentity.token,
        _executionIdentity.nsSlot,
        _executionIdentity.runKind,
    ].join('|');
    if (announcement !== _executionIdentityLastAnnouncement) {
        _executionIdentityLastAnnouncement = announcement;
        const announcer = document.getElementById('executionIdentityAnnouncement');
        if (announcer) {
            announcer.textContent = `Execution identity ${_executionIdentity.status}: ${_executionIdentity.reason}`;
        }
    }
}

function _executionIdentityGet() {
    return JSON.parse(JSON.stringify(_executionIdentity));
}

function _executionIdentityClear(reason) {
    _executionIdentity = {
        status: 'unverified',
        abstraction: null, token: null, sourceHashUsed: null, editorSourceHash: null, sourceComparable: false,
        binaryHash: null, fetchedBinaryHash: null, binaryStatus: 'unverified',
        sourceStatus: 'unverified', nsSlot: null, nsSequence: null,
        runStatus: 'idle', runKind: null, liveMemoryKnown: false,
        clearReason: reason || null,
        reason: reason || 'No verified program is loaded',
    };
    _executionIdentityRender();
}

function _executionIdentityBegin(meta) {
    const m = meta || {};
    const _hasSessionSource = m.source != null && !m.sourceHash;
    _executionIdentity = {
        status: 'unverified',
        abstraction: m.abstraction || m.name || null,
        token: m.token || null,
        sourceHashUsed: m.sourceHash || (m.source != null ? _executionIdentityHashSource(m.source) : null),
        editorSourceHash: m.source != null ? _executionIdentityHashSource(m.source) : null,
        sourceComparable: _hasSessionSource,
        binaryHash: _executionIdentityNormalizeHash(m.binaryHash),
        fetchedBinaryHash: _executionIdentityNormalizeHash(m.fetchedBinaryHash),
        binaryStatus: m.binaryHash && m.fetchedBinaryHash
            ? (_executionIdentityNormalizeHash(m.binaryHash) === _executionIdentityNormalizeHash(m.fetchedBinaryHash) ? 'verified' : 'mismatched')
            : 'unverified',
        sourceStatus: m.sourceHash ? 'recorded' : (m.source != null ? 'current' : 'unverified'),
        nsSlot: m.nsSlot == null ? null : Number(m.nsSlot),
        nsSequence: m.nsSequence == null ? null : Number(m.nsSequence),
        runStatus: m.runStatus || 'loaded',
        runKind: m.runKind || null,
        liveMemoryKnown: !!m.liveMemoryKnown,
        reason: 'Program identity is being established',
    };
    _executionIdentityRender();
}

function _executionIdentityMarkLive(meta) {
    const m = meta || {};
    if (m.abstraction || m.name) _executionIdentity.abstraction = m.abstraction || m.name;
    if (m.token) _executionIdentity.token = m.token;
    if (!_executionIdentity.token && window.LumpRegistry &&
            typeof window.LumpRegistry.getCurrent === 'function') {
        _executionIdentity.token = window.LumpRegistry.getCurrent() || null;
    }
    if (m.nsSlot != null) _executionIdentity.nsSlot = Number(m.nsSlot);
    if (m.nsSequence != null) _executionIdentity.nsSequence = Number(m.nsSequence);
    _executionIdentity.liveMemoryKnown = true;
    _executionIdentity.runStatus = m.runStatus || 'ready';
    _executionIdentityRender();
}

function _executionIdentityUpdateEditor(source) {
    if (_executionIdentity.sourceComparable && _executionIdentity.sourceHashUsed) {
        _executionIdentity.editorSourceHash = _executionIdentityHashSource(source);
        _executionIdentity.sourceStatus =
            _executionIdentity.editorSourceHash === _executionIdentity.sourceHashUsed ? 'current' : 'stale';
    }
    _executionIdentityRender();
}

function _executionIdentitySetBinaryVerification(expected, actual) {
    const e = _executionIdentityNormalizeHash(expected);
    const a = _executionIdentityNormalizeHash(actual);
    _executionIdentity.binaryHash = e;
    _executionIdentity.fetchedBinaryHash = a;
    _executionIdentity.binaryStatus = e && a ? (e === a ? 'verified' : 'mismatched') : 'unverified';
    _executionIdentityRender();
}

async function _executionIdentityHashWords(words) {
    if (!window.crypto || !window.crypto.subtle) return null;
    const list = Array.isArray(words) ? words : Array.from(words || []);
    const bytes = new Uint8Array(list.length * 4);
    const view = new DataView(bytes.buffer);
    list.forEach((word, i) => view.setUint32(i * 4, Number(word) >>> 0, false));
    const digest = await window.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function _executionIdentityVerifyWords(words, expected, token) {
    return _executionIdentityHashWords(words).then(actual => {
        if (token && _executionIdentity.token !== token) return null;
        _executionIdentitySetBinaryVerification(expected, actual);
        return actual;
    }).catch(() => {
        if (!token || _executionIdentity.token === token) {
            _executionIdentity.binaryStatus = 'unverified';
            _executionIdentityRender();
        }
        return null;
    });
}

window.ExecutionIdentity = {
    get: _executionIdentityGet,
    clear: _executionIdentityClear,
    begin: _executionIdentityBegin,
    markLive: _executionIdentityMarkLive,
    updateEditor: _executionIdentityUpdateEditor,
    setBinaryVerification: _executionIdentitySetBinaryVerification,
    hashSource: _executionIdentityHashSource,
    hashWords: _executionIdentityHashWords,
    verifyWords: _executionIdentityVerifyWords,
    render: _executionIdentityRender,
};

document.addEventListener('input', function(e) {
    if (e.target && e.target.id === 'asmEditor') {
        _executionIdentityUpdateEditor(e.target.value);
    }
});

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
        // Migrate any stale BFEXT/BFINS `pos=N, w=N` syntax captured before the
        // disassembler fix, so re-opened tabs never show unparseable code.
        if (typeof window._migrateBfextBfinsSyntax === 'function') {
            let _migratedAny = false;
            for (const t of userTabs) {
                if (t && typeof t.code === 'string') {
                    const migrated = window._migrateBfextBfinsSyntax(t.code);
                    if (migrated !== t.code) { t.code = migrated; _migratedAny = true; }
                }
            }
            if (_migratedAny) saveUserTabsToStorage();
        }
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
    if (window.ExecutionIdentity) window.ExecutionIdentity.clear('Program switched; assemble it to establish a new identity');
    if (typeof window.exitSavedLumpEditorMode === 'function') {
        window.exitSavedLumpEditorMode();
    }
    activeUserTabId = id;
    userTabDirty = false;
    _updateEditorCodeName(tab.name);
    // Leaving catalog edit context when user picks a personal tab
    window._pseudoEditContext = null;
    if (typeof _invalidateLastSavedToken === 'function') _invalidateLastSavedToken(); else window._editorLastSavedToken = null;
    if (typeof _refreshEditorJumpLinks === 'function') _refreshEditorJumpLinks();
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
    if (typeof _invalidateLastSavedToken === 'function') _invalidateLastSavedToken(); else window._editorLastSavedToken = null;
    updateSavePseudoBtn();
    if (typeof _refreshEditorJumpLinks === 'function') _refreshEditorJumpLinks();
}

// ── Symmetric Open-in links: Editor \u2194 LUMP / Abstraction ─────────────────
// Resolves the currently-open editor content (either a saved LUMP, opened via
// openLumpInEditor(), or a catalog method, opened via absOpenMethodInEditor())
// to its counterpart LUMP token / Abstraction index, cross-referencing via the
// shared abstraction name when only one side of the context is known.  Hides
// the corresponding toolbar button whenever no match can be resolved.
async function _refreshEditorJumpLinks() {
    var token  = window._editorLastSavedToken || null;
    var pec    = window._pseudoEditContext;
    var absIdx = (pec && pec.absIdx != null) ? pec.absIdx : null;

    // Warm the lump cache lazily — only needed for cross-referencing.
    // warmServerList() shares one in-flight fetch across all concurrent callers.
    if ((!token || absIdx == null) && window.LumpRegistry
            && !window.LumpRegistry.isServerListFetched()) {
        await window.LumpRegistry.warmServerList();
    }

    var lump = (token && typeof _lumpsCache !== 'undefined' && _lumpsCache)
        ? _lumpsCache.find(function(l) { return l.token === token; }) : null;
    if (absIdx == null && lump && lump.abstraction &&
        typeof abstractionRegistry !== 'undefined' && abstractionRegistry) {
        var derivedAbs = abstractionRegistry.getByName(lump.abstraction);
        if (derivedAbs) absIdx = derivedAbs.index;
    }
    var abs = (absIdx != null && typeof abstractionRegistry !== 'undefined' && abstractionRegistry)
        ? abstractionRegistry.getAbstraction(absIdx) : null;
    if (!token && abs && typeof _lumpsCache !== 'undefined' && _lumpsCache) {
        var derivedLump = _lumpsCache.find(function(l) { return l.abstraction === abs.name; });
        if (derivedLump) token = derivedLump.token;
    }

    window._editorJumpTargets = {
        token: token || null,
        absIdx: abs ? abs.index : null,
        methodName: (pec && pec.methodName) ? pec.methodName : null
    };

    var lumpBtn = document.getElementById('editorJumpToLumpBtn');
    var absBtn  = document.getElementById('editorJumpToAbsBtn');
    if (lumpBtn) lumpBtn.style.display = window._editorJumpTargets.token   ? '' : 'none';
    if (absBtn)  absBtn.style.display  = window._editorJumpTargets.absIdx != null ? '' : 'none';
}

function _editorJumpToLump() {
    var t = window._editorJumpTargets && window._editorJumpTargets.token;
    if (!t) return;
    if (typeof switchView === 'function') switchView('lumps');
    if (typeof window.showLumpDetail === 'function') window.showLumpDetail(t);
    else if (typeof showLumpDetail === 'function') showLumpDetail(t);
}

function _editorJumpToAbstraction() {
    var a = window._editorJumpTargets && window._editorJumpTargets.absIdx;
    if (a == null) return;
    var m = window._editorJumpTargets && window._editorJumpTargets.methodName;
    if (typeof switchView === 'function') switchView('abstractions');
    if (typeof showAbstractionDetail === 'function') showAbstractionDetail(a, m || null);
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

// ── Open File ────────────────────────────────────────────────────────────────
// Fetches the server file list, shows a searchable picker, and loads the
// chosen file into the editor with its path tracked for Ctrl+Shift+F saves.

var _openFileCache = null;  // cached [{path, name, dir}] from last fetch

var _openFileTrigger = null;
var _openFileTrap = null;
function showOpenFileDialog() {
    var dlg = document.getElementById('openFileDialog');
    if (!dlg) return;
    _openFileTrigger = document.activeElement;
    dlg.style.display = 'flex';
    if (!_openFileTrap) _openFileTrap = _makeModalFocusTrap('openFileDialog', closeOpenFileDialog);
    document.addEventListener('keydown', _openFileTrap, true);
    var search = document.getElementById('openFileSearch');
    if (search) { search.value = ''; search.focus(); }
    _renderOpenFileList('');

    if (!_openFileCache) {
        fetch('/api/source-files')
            .then(function(r) { return r.json(); })
            .then(function(j) {
                _openFileCache = j.files || [];
                _renderOpenFileList(document.getElementById('openFileSearch')
                                        ? document.getElementById('openFileSearch').value
                                        : '');
            })
            .catch(function() {
                var list = document.getElementById('openFileList');
                if (list) list.innerHTML = '<div class="of-empty">Could not load file list.</div>';
            });
    }
}

function closeOpenFileDialog() {
    var dlg = document.getElementById('openFileDialog');
    if (dlg) dlg.style.display = 'none';
    if (_openFileTrap) document.removeEventListener('keydown', _openFileTrap, true);
    if (_openFileTrigger && _openFileTrigger.isConnected) _openFileTrigger.focus();
    _openFileTrigger = null;
}

function _renderOpenFileList(query) {
    var list = document.getElementById('openFileList');
    if (!list) return;
    if (!_openFileCache) {
        list.innerHTML = '<div class="of-empty">Loading\u2026</div>';
        return;
    }
    var q = (query || '').trim().toLowerCase();
    var files = _openFileCache.filter(function(f) {
        return !q || f.name.toLowerCase().includes(q) || f.dir.toLowerCase().includes(q);
    });
    if (!files.length) {
        list.innerHTML = '<div class="of-empty">No files match.</div>';
        return;
    }
    // Group by dir
    var groups = {};
    var order  = [];
    files.forEach(function(f) {
        var g = f.dir || 'simulator';
        if (!groups[g]) { groups[g] = []; order.push(g); }
        groups[g].push(f);
    });
    var html = '';
    order.forEach(function(g) {
        html += '<div class="of-group-title">' + _escHtml(g || 'simulator') + '/</div>';
        groups[g].forEach(function(f) {
            var active = (window._editorSourceFilePath === f.path) ? ' of-item-active' : '';
            html += '<button class="of-item' + active + '" onclick="openSourceFile(\'' +
                    f.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\')">' + _escHtml(f.name) + '<span class="of-item-ext">.cloomc</span></button>';
        });
    });
    list.innerHTML = html;
}

function _escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function openSourceFile(path) {
    closeOpenFileDialog();
    if (typeof window.exitSavedLumpEditorMode === 'function') {
        window.exitSavedLumpEditorMode();
    }
    fetch('/' + path)
        .then(function(r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.text();
        })
        .then(function(code) {
            var ed = document.getElementById('asmEditor');
            if (!ed) return;
            ed.readOnly = false;
            if (ed.classList) ed.classList.remove('cm-editor-sealed');
            // Save active user tab if dirty before clobbering
            if (typeof activeUserTabId !== 'undefined' && activeUserTabId &&
                typeof userTabDirty !== 'undefined' && userTabDirty &&
                typeof saveActiveUserTab === 'function') {
                saveActiveUserTab();
            }
            ed.value = code;
            window._editorSourceFilePath = path;
            // Show filename in the editor header
            var stem = path.split('/').pop().replace(/\.cloomc$/i, '');
            if (typeof _updateEditorCodeName === 'function') _updateEditorCodeName(stem);
            if (typeof saveEditorState === 'function') saveEditorState();
            if (typeof updateLineNumbers === 'function') updateLineNumbers();
            if (typeof updateSavePseudoBtn === 'function') updateSavePseudoBtn();
            // Show brief confirmation
            var outEl = document.getElementById('assemblyOutput');
            if (outEl) {
                var msg = document.createElement('div');
                msg.style.cssText = 'color:#8f8;font-style:italic;padding:2px 0;';
                msg.textContent = '\u2713 Opened \u2192 ' + path;
                outEl.appendChild(msg);
                setTimeout(function() { if (msg.parentNode) msg.parentNode.removeChild(msg); }, 2500);
            }
        })
        .catch(function(err) {
            var outEl = document.getElementById('assemblyOutput');
            if (outEl) {
                var msg = document.createElement('div');
                msg.style.cssText = 'color:#f88;padding:2px 0;';
                msg.textContent = 'Open failed: ' + err;
                outEl.appendChild(msg);
            }
        });
}

// ── Save Source File ─────────────────────────────────────────────────────────
// Writes the editor content to a .cloomc file on the server.
//
//   saveSourceFile()    — saves to _editorSourceFilePath if known, else opens
//                         the "Save File As" dialog to pick a path.
//   saveSourceFileAs()  — always opens the dialog (pre-filled with current path
//                         or a name derived from the content / active tab).
//   _saveSourceFileToPath(path, cb)  — low-level: POST to /api/source-file/save.

function _saveSourceFileToPath(path, callback) {
    const ed = document.getElementById('asmEditor');
    if (!ed || !ed.value.trim()) {
        if (callback) callback('Editor is empty');
        return;
    }
    fetch('/api/source-file/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: path, content: ed.value })
    })
    .then(function(r) { return r.json(); })
    .then(function(j) {
        if (j.ok) {
            window._editorSourceFilePath = j.path;
            _openFileCache = null;  // bust picker cache so new file appears on next open
            var outEl = document.getElementById('assemblyOutput');
            if (outEl) {
                var msg = document.createElement('div');
                msg.style.cssText = 'color:#8f8;font-style:italic;padding:2px 0;';
                msg.textContent = '\u2713 Saved \u2192 ' + j.path;
                outEl.appendChild(msg);
                setTimeout(function() { if (msg.parentNode) msg.parentNode.removeChild(msg); }, 2500);
            }
            if (callback) callback(null, j.path);
        } else {
            if (callback) callback(j.error || 'Save failed');
        }
    })
    .catch(function(err) { if (callback) callback(String(err)); });
}

function saveSourceFile() {
    if (window._editorSourceFilePath) {
        _saveSourceFileToPath(window._editorSourceFilePath);
    } else {
        saveSourceFileAs();
    }
}

var _saveFileTrigger = null;
var _saveFileTrap = null;
function saveSourceFileAs() {
    var dlg = document.getElementById('saveFileDialog');
    if (!dlg) return;
    _saveFileTrigger = document.activeElement;
    var errEl = document.getElementById('saveFileError');
    if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
    var pathInput = document.getElementById('saveFilePathInput');
    if (pathInput) {
        if (window._editorSourceFilePath) {
            pathInput.value = window._editorSourceFilePath;
        } else {
            var ed = document.getElementById('asmEditor');
            var defaultName = 'program';
            if (ed) {
                var m = ed.value.match(/^\s*abstraction\s+([A-Za-z_][A-Za-z0-9_]*)/m);
                if (m) {
                    defaultName = m[1].toLowerCase();
                } else if (activeUserTabId) {
                    var tab = userTabs.find(function(t) { return t.id === activeUserTabId; });
                    if (tab && tab.name) {
                        defaultName = tab.name.replace(/[^A-Za-z0-9_\-]/g, '_')
                                              .replace(/^_+|_+$/g, '').toLowerCase() || 'program';
                    }
                }
            }
            pathInput.value = 'simulator/examples/' + defaultName + '.cloomc';
        }
        setTimeout(function() { pathInput.focus(); pathInput.select(); }, 50);
    }
    if (!_saveFileTrap) _saveFileTrap = _makeModalFocusTrap('saveFileDialog', closeSaveFileDialog);
    document.addEventListener('keydown', _saveFileTrap, true);
    dlg.style.display = 'flex';
}

function closeSaveFileDialog() {
    var dlg = document.getElementById('saveFileDialog');
    if (dlg) dlg.style.display = 'none';
    if (_saveFileTrap) document.removeEventListener('keydown', _saveFileTrap, true);
    if (_saveFileTrigger && _saveFileTrigger.isConnected) _saveFileTrigger.focus();
    _saveFileTrigger = null;
}

function confirmSaveFileDialog() {
    var pathInput = document.getElementById('saveFilePathInput');
    if (!pathInput) return;
    var path = pathInput.value.trim();
    if (!path) return;
    var errEl = document.getElementById('saveFileError');
    if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
    _saveSourceFileToPath(path, function(err, savedPath) {
        if (err) {
            if (errEl) { errEl.textContent = err; errEl.style.display = ''; }
        } else {
            closeSaveFileDialog();
        }
    });
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
    if (langSel) langSel.value = 'assembly';
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
    const lang = 'assembly';
    const sourceName = _newAbstractionSourceName(name);
    const initialCode = _newAbstractionProforma(sourceName, lang);
    hideNewTabDialog();
    const sel = document.getElementById('langSelector');
    if (sel && sel.value !== lang) {
        sel.value = lang;
        onLangChange(true);
    }
    // A new abstraction is not an edit of whichever server file was open.
    window._editorSourceFilePath = null;
    createUserTab(name, lang, initialCode);
}

// File → New starts working immediately: it replaces the visible editor with a
// fresh proforma instead of opening the optional named-tab dialog first.
function newAbstraction() {
    const name = 'New.Abstraction';
    const lang = 'assembly';
    const initialCode = _newAbstractionProforma(name);
    window._editorSourceFilePath = null;
    createUserTab(name, lang, initialCode);
}

// The New command always starts with the editable abstraction proforma.
// Abstraction source is intentionally kept in the Assembly editor mode so
// users can add the low-level method bodies directly.
function _newAbstractionSourceName(name) {
    const clean = String(name || '').trim()
        .replace(/[\s_]+/g, '.')
        .replace(/[^A-Za-z0-9.$]+/g, '')
        .replace(/\.+/g, '.')
        .replace(/^\.+|\.+$/g, '');
    return clean || 'New.Abstraction';
}

function _newAbstractionProforma(name) {
    return `Source for ${name}  (dot.name)

; Provides: the functions of ...
abstraction ${name} {
    capabilities {
        ; (capability grants added here)
    }
    method Status {
        ; Return the status
        ; Depends on: self
        ; TODO: write your code here
        RETURN
    }
    method Close_Fist {
        ; Close all fingers
        ; Depends on: self
        ; TODO: write your code here
        RETURN
    }
    method Open_Hand {
        ; Extend all fingers
        ; Depends on: self
        ; TODO: write your code here
        RETURN
    }
    method Grip {
        ; Close as a fist
        ; Depends on: self
        ; TODO: write your code here
        RETURN
    }
    method Point {
        ; Point with forefinger
        ; Depends on: self
        ; TODO: write your code here
        RETURN
    }
    method Count {
        ; Display fingers as a number
        ; Depends on: self
        ; TODO: write your code here
        RETURN
    }
    method Pinch {
        ; Close the thumb and finger to touch each other
        ; Depends on: self
        ; TODO: write your code here
        RETURN
    }
}`;
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
    // otherwise. No re-reset is needed.
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

    sim.on('stateChange', () => { updateDashboard(); updateLedStrip(); updateToolbarIdeBadge(); if (typeof updateThreadControl === 'function') updateThreadControl(); if (currentView === 'gt-view') renderGTView(); });
    sim.on('threadChange', () => { if (typeof updateThreadControl === 'function') updateThreadControl(); });
    sim.on('step', _traceRecordStep);
    // The optional live simulator-follow view is a UI projection only.  Keep it
    // on its own listener so hardware trace events and simulator execution can
    // never be mistaken for one another.
    sim.on('step', (result) => {
        if (typeof window._wukongRecordSimulatorStep === 'function') {
            window._wukongRecordSimulatorStep(result);
        }
    });
    // A restored fault log describes a prior browser session.  Retiring one
    // normal instruction in this session proves the old halt is no longer
    // current, so remove it before the UI renders the new live state.
    sim.on('step', (result) => {
        const retiredNormally = result && !result.absent && !result.suspended &&
            !result.lazySuspended && !result.rejected && !result.timerIRQ;
        if (retiredNormally && typeof _clearRestoredFaultLogAfterGoodStep === 'function') {
            _clearRestoredFaultLogAfterGoodStep();
        }
    });
    sim.on('reset', clearTrace);
    // Register the Last Fault panel listener here — sim is null during
    // app-run.js evaluation, so the listener must be wired after init().
    if (typeof _onSimFaultSnapshot === 'function') {
        sim.on('faultSnapshot', _onSimFaultSnapshot);
    }
    // Task #217: every reset rebuilds memory[] from scratch via
    // _initNamespaceTable. If a programmer-generated boot image is
    // available, overlay it now so the simulator runs from the
    // self-supporting binary rather than the hardcoded init alone.
    sim.on('reset', _maybeApplyBootImage);
    // Probe once at startup — covers the case where the user navigated
    // here after a previous session generated an image.
    _probeBootImage().then(buf => {
        // A user can request a run while this asynchronous fetch is still in
        // flight.  In that case the fallback 64-word SelfTest descriptor has
        // already completed boot and CALL has installed CR14/CR11 from it.
        // Loading the real image below replaces memory, but intentionally does
        // not rewrite an already-running thread's capability registers.
        //
        // Remember this state so an accepted late image can reset through the
        // normal reset hook after it has been cached.  That hook loads the image
        // synchronously before the next B:05/B:07 sequence establishes CR14.
        const _wasBootedBeforeImage = !!sim.bootComplete;
        if (buf) {
                   // Task #2867: acceptance state must reflect the loader's
                   // verdict, not merely that a fetch succeeded.  loadBootImage()
                   // returns false for a stale/rejected binary; in that case the
                   // image must NOT be marked available (a rejected image cannot
                   // masquerade as booted memory).
                   let _accepted = false;
                   try {
                       _accepted = sim.loadBootImage(buf) === true;
                       if (_accepted) {
                           _applyBootEntryToSim();
                           // Evict stale sticky patches for all NS slots now owned
                           // by the boot image.  Patches that differ from the new
                           // binary are cleared and reported; matching (redundant)
                           // patches are cleared silently.  Must run before
                           // _reapplyStickyPatches() fires at boot completion.
                           if (typeof window._clearBootImageStickyPatches === 'function') {
                               window._clearBootImageStickyPatches(sim.nsCount || 0);
                           }
                       } else {
                           console.warn('[bootImage] loadBootImage() rejected the fetched image (stale/invalid); not marking available.');
                       }
                   } catch(e) { console.warn('[bootImage] apply failed:', e); _accepted = false; }
                   if (_accepted) {
                       // Cache before resetting: _maybeApplyBootImage(), the
                       // reset listener, uses this exact buffer to overlay the
                       // real descriptor synchronously.
                       window.bootImage = buf;
                       window.bootImageAvailable = true;

                       if (_wasBootedBeforeImage) {
                           // Never continue execution with CR14/CR11 derived
                           // from the fallback 64-word placeholder after the
                           // real SelfTest LUMP has arrived.  A bare reset is
                           // deliberate: the normal auto-boot policy below
                           // decides whether to continue immediately.
                           if (window.ExecutionIdentity) {
                               window.ExecutionIdentity.clear('Boot image replacement reset the previous execution identity');
                           }
                           sim.reset();
                       }
                   } else {
                       window.bootImage = null;
                       window.bootImageAvailable = false;
                   }
        }
        // Refresh the namespace table immediately after the boot image loads so
        // the live unified view populates even if the user navigated there before
        // the async fetch resolved, or before auto-boot fired.
        if (currentView === 'namespace' && typeof updateNamespace === 'function') updateNamespace();
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
        // ── Live-lint: capabilities block size gate ───────────────────────────
        // Counts entries in every capabilities { } block and emits a warning
        // when any block exceeds 32 (the hardware c-list limit imposed by the
        // 5-bit ELOADCALL row field).  Fires on text change, debounced 500 ms,
        // so the programmer sees the constraint at edit time rather than only
        // after pressing Assemble/Run.
        var _capLintTimer = null;
        function _lintCapBlockSize(source) {
            var warnings = [];
            var lines = source.split('\n');
            var inCapBlock = false;
            var capCount   = 0;
            var capBlockLine = 1;

            function _capItem(s) {
                var t = s.replace(/;.*$/, '').trim();
                if (!t) return null;
                return t.split(/\s+/)[0] || null;
            }

            function _emitIfOver() {
                if (capCount > 32) {
                    var excess = capCount - 32;
                    warnings.push({
                        line: capBlockLine,
                        message: 'capabilities block declares ' + capCount
                            + ' entries but the hardware c-list is limited to 32'
                            + ' (ELOADCALL uses a 5-bit row field, slots 0\u201331).'
                            + ' Remove ' + excess + ' entr'
                            + (excess === 1 ? 'y' : 'ies')
                            + ' or split the abstraction into smaller ones.'
                    });
                }
            }

            for (var i = 0; i < lines.length; i++) {
                var raw = lines[i];
                var line = raw.replace(/;.*$/, '').trim();
                if (!line) continue;

                if (!inCapBlock && /^capabilities\s*\{/i.test(line)) {
                    capBlockLine = i + 1;
                    capCount = 0;
                    var singleMatch = line.match(/^capabilities\s*\{([^}]*)\}/i);
                    if (singleMatch) {
                        var sItems = singleMatch[1].split(',');
                        for (var j = 0; j < sItems.length; j++) {
                            if (_capItem(sItems[j])) capCount++;
                        }
                        _emitIfOver();
                    } else {
                        inCapBlock = true;
                        var tail = line.replace(/^capabilities\s*\{/i, '').trim();
                        if (tail) {
                            var tItems = tail.split(',');
                            for (var k = 0; k < tItems.length; k++) {
                                if (_capItem(tItems[k])) capCount++;
                            }
                        }
                    }
                    continue;
                }

                if (inCapBlock) {
                    if (line.indexOf('}') >= 0) {
                        inCapBlock = false;
                        _emitIfOver();
                    } else {
                        var bItems = line.split(',');
                        for (var m = 0; m < bItems.length; m++) {
                            if (_capItem(bItems[m])) capCount++;
                        }
                    }
                }
            }
            return warnings;
        }

        asmEd.addEventListener('input', function() {
            clearTimeout(_capLintTimer);
            _capLintTimer = setTimeout(function() {
                try {
                    var src = asmEd.value || '';
                    var capWarnings = _lintCapBlockSize(src);
                    if (typeof _showAsmWarnings === 'function' && typeof _clearAsmWarnings === 'function') {
                        if (capWarnings.length > 0) {
                            _showAsmWarnings(capWarnings);
                        } else {
                            _clearAsmWarnings();
                        }
                    }
                } catch (_e) {}
            }, 500);
        });
        // ─────────────────────────────────────────────────────────────────────
        asmEd.addEventListener('scroll', syncLineScroll);
        if (typeof ResizeObserver !== 'undefined') {
            new ResizeObserver(function() {
                requestAnimationFrame(function() { syncLineScroll(); _debouncedErrorRecalc(); });
            }).observe(asmEd);
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
            // Escape — close find bar if open, with focus returning to editor
            if (e.key === 'Escape') {
                var _fb = document.getElementById('editorFindBar');
                if (_fb && _fb.style.display !== 'none') {
                    e.stopPropagation();
                    if (typeof _editorFindClose === 'function') _editorFindClose();
                }
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
    // One-way deletion of the obsolete browser snapshot. This never restores
    // Namespace words, labels, LUMP memory, or nsCount.
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
    const views = ['home','repl','editor','start','tutorial','dashboard','namespace','hello-mum','abstractions','lumps','pipeline','trace','reference','docs','builder','sitemap','gc','devices','github','memory','gt-view','namespace-dna'];
    const rawHash = window.location.hash.replace('#', '');
    const [hashView, hashQuery] = rawHash.split('?');
    const hashParams = {};
    if (hashQuery) hashQuery.split('&').forEach(p => {
        const [k, v] = p.split('=');
        try { hashParams[k] = decodeURIComponent(v || ''); }
        catch (_) { hashParams[k] = v || ''; }
    });
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
    if (!startView) startView = 'home';
    // Always arm the guard so slowBoot()'s switchView('dashboard') cannot
    // override whatever view was chosen here (including the 'home' default).
    if (!window._startupDefaultView) window._startupDefaultView = startView;
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
                const row = document.getElementById('ns-row-' + nsSlot);
                if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 120);
        }
    }
    if ((startView === 'devices' || startView === 'reference' || startView === 'tutorial' ||
            startView === 'docs') && (hashParams.tab || hashParams.lesson || hashParams.doc || hashParams.figure)) {
        setTimeout(function() {
            if (startView === 'devices' && hashParams.tab && typeof switchDevicesTab === 'function') {
                switchDevicesTab(hashParams.tab);
            }
            if (startView === 'reference' && hashParams.tab && typeof switchRefTab === 'function') {
                switchRefTab(hashParams.tab);
            }
            if (startView === 'tutorial' && hashParams.lesson && typeof selectTutorial === 'function') {
                selectTutorial(hashParams.lesson);
            }
            if (startView === 'docs' && hashParams.doc && typeof openDocAnchor === 'function') {
                openDocAnchor(hashParams.doc);
            }
            if (startView === 'docs' && hashParams.figure && typeof openFigureAnchor === 'function') {
                openFigureAnchor(hashParams.figure);
            }
        }, 150);
    }
    switchMathMode('hp35');
    _initDefaultViewBolt();
    _initLandingCardDrag();
    _initLandingMenuRecency();

    // "?" — open keyboard shortcuts help overlay (only when not in a text field)
    document.addEventListener('keydown', function _shortcutsHelpKey(e) {
        if (e.key !== '?') return;
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

// ── Landing-page card drag-and-drop ordering ───────────────────────────────
// Each landing section has its own order. Keeping the order keyed by card
// group means Learning Tools and Documentation can be arranged independently.
function _initLandingCardDrag() {
    const rows = document.querySelectorAll(
        '.home-card-row[data-card-group], .home-core-grid[data-card-group]'
    );
    if (!rows.length) return;
    const storageKey = 'church_landing_card_order';
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch (_) {}

    rows.forEach(function(row) {
        const group = row.getAttribute('data-card-group');
        const cards = Array.from(row.querySelectorAll('[data-card-id]'));
        const order = Array.isArray(saved[group]) ? saved[group] : [];
        order.slice().reverse().forEach(function(id) {
            const card = cards.find(function(item) { return item.dataset.cardId === id; });
            if (card) row.insertBefore(card, row.firstElementChild);
        });

        let dragged = null;
        cards.forEach(function(card) {
            card.setAttribute('aria-grabbed', 'false');
            card.setAttribute('title', 'Drag to reorder this card');
            const hint = document.createElement('span');
            hint.className = 'home-card-drag-hint';
            hint.setAttribute('aria-hidden', 'true');
            hint.textContent = '⠿';
            card.appendChild(hint);

            card.addEventListener('dragstart', function(event) {
                dragged = card;
                card.classList.add('home-card--dragging');
                card.setAttribute('aria-grabbed', 'true');
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', card.dataset.cardId);
            });
            card.addEventListener('dragover', function(event) {
                event.preventDefault();
                if (!dragged || dragged === card) return;
                event.dataTransfer.dropEffect = 'move';
                card.classList.add('home-card--drag-target');
                const rect = card.getBoundingClientRect();
                const insertBefore = event.clientX < rect.left + rect.width / 2;
                row.insertBefore(dragged, insertBefore ? card : card.nextSibling);
            });
            card.addEventListener('dragleave', function() {
                card.classList.remove('home-card--drag-target');
            });
            card.addEventListener('drop', function(event) {
                event.preventDefault();
                event.stopPropagation();
                card.classList.remove('home-card--drag-target');
                _saveLandingCardOrder(row, storageKey);
            });
            card.addEventListener('dragend', function() {
                card.classList.remove('home-card--dragging');
                card.setAttribute('aria-grabbed', 'false');
                row.querySelectorAll('.home-card--drag-target').forEach(function(item) {
                    item.classList.remove('home-card--drag-target');
                });
                _saveLandingCardOrder(row, storageKey);
                dragged = null;
            });
        });
    });
}

function _saveLandingCardOrder(row, storageKey) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch (_) {}
    saved[row.getAttribute('data-card-group')] = Array.from(
        row.querySelectorAll('[data-card-id]')
    ).map(function(card) { return card.dataset.cardId; });
    try { localStorage.setItem(storageKey, JSON.stringify(saved)); } catch (_) {}
}

// Keep the public landing page's first five tiles aligned with the exact
// destinations selected from the hamburger menu.
function _initLandingMenuRecency() {
    const dropdown = document.getElementById('hamDropdown');
    if (!dropdown || dropdown.dataset.recentTracking === 'true') return;
    dropdown.dataset.recentTracking = 'true';
    const storageKey = 'church_recent_menu_destinations';
    dropdown.addEventListener('click', function(event) {
        const item = event.target.closest('.ham-item');
        if (!item || !dropdown.contains(item)) return;
        const destination = _landingDestinationFromMenuItem(item);
        if (!destination) return;
        let recent = [];
        try {
            const parsed = JSON.parse(localStorage.getItem(storageKey) || '[]');
            if (Array.isArray(parsed)) recent = parsed;
        } catch (_) {}
        recent = [destination].concat(recent.filter(function(entry) {
            return !entry || entry.id !== destination.id;
        })).slice(0, 5);
        try { localStorage.setItem(storageKey, JSON.stringify(recent)); } catch (_) {}
    }, true);
}

function _landingDestinationFromMenuItem(item) {
    const action = item.getAttribute('onclick') || '';
    const href = item.getAttribute('href');
    let target = href || '';
    if (!target) {
        const directRoute = action.match(/window\.location\s*=\s*['"]([^'"]+)['"]/);
        if (directRoute) {
            target = directRoute[1];
        } else {
            const viewMatch = action.match(/switchView\('([^']+)'\)/);
            let view = viewMatch ? viewMatch[1] : (action.includes('openSimulatorFromMenu') ? 'dashboard' : '');
            const params = [];
            const parameterActions = [
                ['switchBuilderViewTab', 'tab'],
                ['switchDevicesTab', 'tab'],
                ['switchRefTab', 'tab'],
                ['selectTutorial', 'lesson'],
                ['openDocAnchor', 'doc'],
                ['openFigureAnchor', 'figure'],
            ];
            parameterActions.forEach(function(pair) {
                const match = action.match(new RegExp(pair[0] + "\\('([^']+)'\\)"));
                if (match) params.push(pair[1] + '=' + encodeURIComponent(match[1]));
            });
            if (!view && params.some(function(param) { return param.indexOf('figure=') === 0; })) view = 'docs';
            if (!view) return null; // Hardware actions are commands, not routes.
            target = '/simulator/#' + view + (params.length ? '?' + params.join('&') : '');
        }
    }
    if (!target) return null;
    const label = Array.from(item.childNodes).filter(function(node) {
        return node.nodeType === Node.TEXT_NODE;
    }).map(function(node) {
        return node.textContent;
    }).join(' ').replace(/\s+/g, ' ').trim() || item.textContent.replace(/\s+/g, ' ').trim();
    const section = item.closest('.ham-section');
    const category = section ? (section.querySelector('.ham-category') || {}).textContent || '' : '';
    const id = item.id || (target + '|' + label).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return {
        id: id,
        label: label,
        href: target,
        category: category.trim(),
        newTab: item.getAttribute('target') === '_blank',
    };
}

// ── Shared modal focus-trap helpers ───────────────────────────────────────────
// Returns all visible, keyboard-reachable controls inside a modal container.
function _modalFocusableControls(modal) {
    if (!modal) return [];
    return Array.from(modal.querySelectorAll(
        'a[href], area[href], button:not([disabled]), input:not([disabled]), ' +
        'select:not([disabled]), textarea:not([disabled]), ' +
        '[contenteditable="true"], [tabindex]:not([tabindex="-1"])'
    )).filter(function(el) {
        var st = window.getComputedStyle(el);
        return st.display !== 'none' && st.visibility !== 'hidden' && el.getClientRects().length > 0;
    });
}
// Returns a keydown handler that cycles Tab focus inside the named modal and
// calls closeFn on Escape.  Register with addEventListener(…, true) (capture)
// and deregister with removeEventListener on close.
// The handler is a no-op when the modal is not visible, so stacked modals that
// share the same event target do not interfere with each other.
function _makeModalFocusTrap(modalId, closeFn) {
    return function _focusTrapHandler(ev) {
        var modal = document.getElementById(modalId);
        // Skip if the modal is not currently displayed (e.g. hidden behind another modal)
        if (!modal || window.getComputedStyle(modal).display === 'none') return;
        if (ev.key === 'Escape') {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            closeFn();
            return;
        }
        if (ev.key !== 'Tab') return;
        var controls = _modalFocusableControls(modal);
        if (!controls.length) return;
        var cur = controls.indexOf(document.activeElement);
        var next = ev.shiftKey
            ? (cur <= 0 ? controls.length - 1 : cur - 1)
            : (cur >= controls.length - 1 ? 0 : cur + 1);
        ev.preventDefault();
        controls[next].focus();
    };
}

var _shortcutsHelpTrigger = null;
var _shortcutsFocusTrap = null;
function openShortcutsHelp() {
    const modal = document.getElementById('shortcutsModal');
    if (!modal) return;
    _shortcutsHelpTrigger = document.activeElement;
    modal.style.display = 'flex';
    if (!_shortcutsFocusTrap) _shortcutsFocusTrap = _makeModalFocusTrap('shortcutsModal', closeShortcutsHelp);
    document.addEventListener('keydown', _shortcutsFocusTrap, true);
    const closeBtn = modal.querySelector('.shortcuts-close-btn');
    if (closeBtn) closeBtn.focus();
}

function closeShortcutsHelp() {
    const modal = document.getElementById('shortcutsModal');
    if (!modal) return;
    modal.style.display = 'none';
    if (_shortcutsFocusTrap) document.removeEventListener('keydown', _shortcutsFocusTrap, true);
    if (_shortcutsHelpTrigger && _shortcutsHelpTrigger.isConnected) _shortcutsHelpTrigger.focus();
    _shortcutsHelpTrigger = null;
}

function _shortcutsEscHandler() { /* superseded by _shortcutsFocusTrap */ }

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
                const landingEl = document.getElementById('landing-version');
                if (landingEl) {
                    landingEl.textContent = 'v' + data.version;
                    landingEl.setAttribute('aria-label', 'IDE version v' + data.version);
                }
            }
            {
                const lastWhatsNewVersion = localStorage.getItem('church_whatsnew_version');
                if (lastWhatsNewVersion !== WHATS_NEW_VERSION) {
                    localStorage.setItem('church_whatsnew_version', WHATS_NEW_VERSION);
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
    _collapseAllHamSections();
}

/* ── Ham section touch / keyboard helpers ─────────────────────────── */

function _collapseAllHamSections() {
    document.querySelectorAll('.ham-section.ham-section-expanded').forEach(function(s) {
        s.classList.remove('ham-section-expanded');
        const head = s.querySelector('.ham-section-head');
        if (head) head.setAttribute('aria-expanded', 'false');
    });
}

function _expandHamSection(section) {
    _collapseAllHamSections();
    section.classList.add('ham-section-expanded');
    const head = section.querySelector('.ham-section-head');
    if (head) head.setAttribute('aria-expanded', 'true');
}

function _hamSectionItems(section) {
    const group = section.querySelector('.ham-group');
    if (!group) return [];
    return Array.from(group.querySelectorAll('.ham-item, a.ham-link')).filter(function(el) {
        return !el.disabled && el.offsetParent !== null;
    });
}

function initHamSectionInteraction() {
    document.querySelectorAll('.ham-section').forEach(function(section) {
        const head = section.querySelector('.ham-section-head');
        if (!head) return;

        // Make heading keyboard-reachable
        if (!head.getAttribute('tabindex')) head.setAttribute('tabindex', '0');
        head.setAttribute('role', 'button');
        head.setAttribute('aria-expanded', 'false');
        head.setAttribute('aria-haspopup', 'true');

        // ── Touch ────────────────────────────────────────────────────────
        head.addEventListener('touchend', function(e) {
            e.preventDefault(); // suppress subsequent mouse events
            const isOpen = section.classList.contains('ham-section-expanded');
            if (isOpen) {
                _collapseAllHamSections();
            } else {
                _expandHamSection(section);
                // Focus first item so touch users can tap without a second gesture
                const items = _hamSectionItems(section);
                if (items.length) items[0].focus();
            }
        });

        // ── Keyboard on the heading ───────────────────────────────────────
        head.addEventListener('keydown', function(e) {
            switch (e.key) {
                case 'Enter':
                case ' ':
                case 'ArrowRight':
                case 'ArrowDown': {
                    e.preventDefault();
                    _expandHamSection(section);
                    const items = _hamSectionItems(section);
                    if (items.length) items[0].focus();
                    break;
                }
                case 'Escape': {
                    e.preventDefault();
                    _collapseAllHamSections();
                    break;
                }
            }
        });

        // ── Keyboard within the submenu ───────────────────────────────────
        const group = section.querySelector('.ham-group');
        if (!group) return;
        group.addEventListener('keydown', function(e) {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' &&
                e.key !== 'Escape' && e.key !== 'ArrowLeft') return;
            const items = _hamSectionItems(section);
            const idx   = items.indexOf(document.activeElement);
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                const next = items[idx + 1] || items[0];
                if (next) next.focus();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (idx === 0) {
                    head.focus();
                } else {
                    const prev = items[idx - 1];
                    if (prev) prev.focus();
                }
            } else if (e.key === 'Escape' || e.key === 'ArrowLeft') {
                e.preventDefault();
                _collapseAllHamSections();
                head.focus();
            }
        });
    });
}

document.addEventListener('DOMContentLoaded', initHamSectionInteraction);

function switchDocsTab(tabId) {
    var docsMap = {
        'isa':      'instruction-set.md',
        'hardware': 'HARDWARE.md',
        'cloomc':   'cloomc-foundation.md',
        'api':      'api-reference.md'
    };
    document.querySelectorAll('.docs-tab-btn').forEach(function(btn) {
        btn.classList.remove('docs-tab-active');
    });
    var activeBtn = document.getElementById('docsTab-' + tabId);
    if (activeBtn) activeBtn.classList.add('docs-tab-active');
    var filename = docsMap[tabId];
    if (filename && typeof openDocAnchor === 'function') openDocAnchor(filename);
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

var _lumpTypeSelectorTrigger = null;
var _lumpTypeSelectorTrap = null;
function showLumpTypeSelector() {
    const m = document.getElementById('lumpTypeSelectorModal');
    if (!m) return;
    _lumpTypeSelectorTrigger = document.activeElement;
    m.style.display = 'flex';
    if (!_lumpTypeSelectorTrap) _lumpTypeSelectorTrap = _makeModalFocusTrap('lumpTypeSelectorModal', closeLumpTypeSelector);
    document.addEventListener('keydown', _lumpTypeSelectorTrap, true);
    const first = _modalFocusableControls(m)[0];
    if (first) first.focus();
}

function closeLumpTypeSelector() {
    const m = document.getElementById('lumpTypeSelectorModal');
    if (!m) return;
    m.style.display = 'none';
    if (_lumpTypeSelectorTrap) document.removeEventListener('keydown', _lumpTypeSelectorTrap, true);
    if (_lumpTypeSelectorTrigger && _lumpTypeSelectorTrigger.isConnected) _lumpTypeSelectorTrigger.focus();
    _lumpTypeSelectorTrigger = null;
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
    // A saved LUMP owns the right-hand editor pane only while it is open.
    // Any navigation away restores the ordinary console/reference interface.
    if ((viewId !== 'editor' || !window._committingSavedLumpOpen) &&
            typeof window.exitSavedLumpEditorMode === 'function') {
        window.exitSavedLumpEditorMode();
    }
    if (viewId !== currentView && currentView === 'devices' && typeof stopDeviceTunnelPolling === 'function') {
        stopDeviceTunnelPolling();
    }
    if (viewId !== currentView) previousView = currentView;
    currentView = viewId;
    if (typeof _updateFaultToolbarBadge === 'function') _updateFaultToolbarBadge();
    window.location.hash = viewId;
    try { localStorage.setItem('church_lastView', viewId); } catch(e) {}
    const backBtn = document.getElementById('backBtn');
    if (backBtn) backBtn.style.display = previousView ? 'inline-flex' : 'none';
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const el = document.getElementById(viewId);
    if (el) el.classList.add('active');

    document.querySelectorAll('.ham-item').forEach(btn => btn.classList.remove('ham-active'));
    document.querySelectorAll('.ham-item[data-view="' + viewId + '"], #hamItem-' + viewId)
        .forEach(btn => btn.classList.add('ham-active'));

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
    if (viewId === 'editor' && typeof _refreshEditorJumpLinks === 'function') _refreshEditorJumpLinks();
    // Restore the hardware fault panel when returning to the editor view.
    if (viewId === 'editor' && typeof _wukongLastFaultData !== 'undefined' &&
            _wukongLastFaultData && typeof _wukongShowFaultPanel === 'function') {
        // Use setTimeout so the editor DOM is fully rendered before inserting the panel.
        setTimeout(function() { _wukongShowFaultPanel(_wukongLastFaultData); }, 0);
    }
    if (viewId === 'gt-view') renderGTView();
    if (viewId === 'namespace-dna' && typeof renderNamespaceDNA === 'function') renderNamespaceDNA();
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
    const views = ['home','repl','editor','start','tutorial','dashboard','namespace','hello-mum','abstractions','lumps','pipeline','trace','reference','docs','builder','sitemap','gc','devices','github','memory','gt-view','namespace-dna'];
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

