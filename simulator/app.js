let sim = null;
let assembler = null;
let pipelineViz = null;
let repl = null;
let churchTutorial = null;
let slideRuleTutorial = null;
let activeTutorial = 'bernoulli';
let cloomcCompiler = null;
let currentView = 'dashboard';
let lastAssembledWords = null;
let abstractionRegistry = null;
let systemAbstractions = null;
let deviceAbstractions = null;

function init() {
    sim = new ChurchSimulator();
    assembler = new ChurchAssembler();
    pipelineViz = new PipelineVisualizer('pipelineContainer');
    repl = new ChurchREPL(sim, pipelineViz);
    churchTutorial = new BernoulliTutorial(repl, pipelineViz);
    slideRuleTutorial = new SlideRuleTutorial();

    abstractionRegistry = new AbstractionRegistry();
    systemAbstractions = new SystemAbstractions(abstractionRegistry);
    deviceAbstractions = new DeviceAbstractions(abstractionRegistry);
    sim.initAbstractions(abstractionRegistry, systemAbstractions, deviceAbstractions);

    if (typeof CLOOMCCompiler !== 'undefined') {
        cloomcCompiler = new CLOOMCCompiler();
    }

    window.churchTutorial = churchTutorial;
    window.slideRuleTutorial = slideRuleTutorial;

    sim.on('stateChange', () => updateDashboard());
    sim.on('fault', (f) => appendOutput(`FAULT [${f.type}]: ${f.message}`, 'error'));
    sim.on('halt', () => appendOutput('Machine halted.', 'info'));

    loadEditorState();
    initReplDivider();
    initEditorDivider();
    initConsoleAutoSwitch();
    const asmEd = document.getElementById('asmEditor');
    if (asmEd) {
        asmEd.addEventListener('input', updateLineNumbers);
        asmEd.addEventListener('scroll', syncLineScroll);
        asmEd.addEventListener('keydown', function(e) {
            if (e.key === 'Tab') {
                e.preventDefault();
                const s = this.selectionStart, end = this.selectionEnd;
                this.value = this.value.substring(0, s) + '    ' + this.value.substring(end);
                this.selectionStart = this.selectionEnd = s + 4;
                updateLineNumbers();
            }
        });
    }
    updateLineNumbers();
    loadNamespaceState();
    checkBootId();
    const views = ['repl','editor','tutorial','dashboard','namespace','abstractions','pipeline','reference','docs'];
    const hash = window.location.hash.replace('#', '');
    const startView = views.includes(hash) ? hash : 'repl';
    switchView(startView);
    updateDashboard();
    pipelineViz.render();
    showWelcomePopup();
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
                showWelcomePopup();
            }
            localStorage.setItem('churchMachine_bootId', data.bootId);
        })
        .catch(() => {});
}

function switchView(viewId) {
    currentView = viewId;
    window.location.hash = viewId;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const el = document.getElementById(viewId);
    if (el) el.classList.add('active');

    document.querySelectorAll('.view-buttons .btn-view').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById('viewBtn-' + viewId);
    if (activeBtn) activeBtn.classList.add('active');

    if (viewId === 'dashboard') updateDashboard();
    if (viewId === 'namespace') updateNamespace();
    if (viewId === 'abstractions') renderAbstractions();
    if (viewId === 'pipeline') pipelineViz.render();
    if (viewId === 'editor') {
        const sel = document.getElementById('langSelector');
        if (sel) showIntro(sel.value);
        if (typeof historyRefreshCode === 'function') {
            const area = document.getElementById('codeHistoryContent');
            if (area && !area.innerHTML.trim()) historyRefreshCode();
        }
    }
    if (viewId === 'tutorial') {
        if (activeTutorial === 'sliderule') {
            slideRuleTutorial.render('tutorialView');
        } else {
            churchTutorial.render('tutorialView');
        }
    }
    if (viewId === 'repl') {
        updateMathWelcome();
        showMathGuidePopup();
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
    if (which === 'sliderule') {
        slideRuleTutorial.render('tutorialView');
    } else {
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

function updateDashboard() {
    updateCRDisplay();
    updateDRDisplay();
    updateFlagsDisplay();
    updateInfoDisplay();
    if (selectedCR !== null) updateCRDetail();
}

function updateCRDisplay() {
    const container = document.getElementById('crRegs');
    if (!container) return;
    const localNames = {
        6: 'C-List', 7: 'CLOOMC', 8: 'Thread', 9: 'IRQ', 10: 'Fault', 15: 'Namespace'
    };
    let html = '<table class="cr-table"><thead><tr>';
    html += '<th>CR</th><th>M</th><th>Local Name</th>';
    html += '<th>word0: GT</th><th>Perms</th><th>Ver</th><th>Idx</th><th>Type</th>';
    html += '<th>word1: Location</th>';
    html += '<th>word2: B</th><th>F</th><th>Limit[16:0]</th>';
    html += '<th>word3: Ver</th><th>FNV Seal</th>';
    html += '</tr></thead><tbody>';
    for (let i = 0; i < 16; i++) {
        const cr = sim.getFormattedCR(i);
        const name = localNames[i] || '';
        const cls = cr.isNull ? 'cr-null' : 'cr-active';
        const clickable = !cr.isNull ? ' cr-clickable' : '';
        html += `<tr class="${cls}${clickable}" ${!cr.isNull ? `onclick="openCRDetail(${i})"` : ''}>`;
        html += `<td class="cr-idx">${i}</td>`;
        html += `<td class="cr-m ${cr.mBit ? 'cr-m-set' : ''}">${cr.mBit}</td>`;
        html += `<td class="cr-name">${name}</td>`;
        html += `<td class="cr-gt">0x${cr.word0_gt}</td>`;
        html += `<td class="cr-perms">[${cr.perms}]</td>`;
        html += `<td>${cr.gtVersion}</td>`;
        html += `<td>${cr.gtIndex}</td>`;
        html += `<td class="cr-type">${cr.gtTypeName}</td>`;
        html += `<td>0x${cr.word1_location.toString(16).toUpperCase().padStart(8, '0')}</td>`;
        html += `<td class="cr-flag">${cr.limitB}</td>`;
        html += `<td class="cr-flag">${cr.limitF}</td>`;
        html += `<td>0x${cr.limit17.toString(16).toUpperCase().padStart(5, '0')}</td>`;
        html += `<td>${cr.sealVersion}</td>`;
        html += `<td>0x${cr.sealFNV.toString(16).toUpperCase().padStart(7, '0')}</td>`;
        html += '</tr>';
    }
    html += '</tbody></table>';
    container.innerHTML = html;
}

let selectedCR = null;

function openCRDetail(crIdx) {
    selectedCR = crIdx;
    const detailTab = document.getElementById('dashTab-crdetail');
    if (detailTab) {
        const cr = sim.getFormattedCR(crIdx);
        const localNames = {
            6: 'C-List', 7: 'CLOOMC', 8: 'Thread', 9: 'IRQ', 10: 'Fault', 15: 'Namespace'
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
    const seal = entry.word2_seals & 0x01FFFFFF;
    h += `<tr><td style="color:var(--church-blue);width:120px;">Location</td><td>0x${loc.toString(16).toUpperCase().padStart(8,'0')}</td></tr>`;
    h += `<tr><td style="color:var(--church-blue)">Limit</td><td>0x${lim.limit.toString(16).toUpperCase().padStart(5,'0')} (${lim.limit + 1} words)</td></tr>`;
    h += `<tr><td style="color:var(--church-blue)">B (Bind)</td><td>${lim.b}</td></tr>`;
    h += `<tr><td style="color:var(--church-blue)">F (Far)</td><td>${lim.f}</td></tr>`;
    h += `<tr><td style="color:var(--church-blue)">G (GC)</td><td>${entry.gBit}</td></tr>`;
    h += `<tr><td style="color:var(--church-blue)">Chainable</td><td>${lim.chainable ? 'Yes' : 'No'}</td></tr>`;
    const typeNames = ['NULL','Inform','Outform','Abstract'];
    h += `<tr><td style="color:var(--church-blue)">GT Type</td><td>${typeNames[entry.gtType] || '?'} (${entry.gtType})</td></tr>`;
    h += `<tr><td style="color:var(--church-blue)">Version</td><td>${ver}</td></tr>`;
    h += `<tr><td style="color:var(--church-blue)">FNV Seal</td><td>0x${seal.toString(16).toUpperCase().padStart(7,'0')}</td></tr>`;
    h += '</tbody></table>';

    const wordCount = Math.min(lim.limit + 1, 64);
    let hasData = false;
    const asm = new ChurchAssembler();
    let memHtml = '<table class="cr-table code-view-table"><thead><tr><th>Addr</th><th>Hex</th><th>Decode</th></tr></thead><tbody>';
    for (let w = 0; w < wordCount; w++) {
        const addr = loc + w;
        if (addr >= sim.memory.length) break;
        const word = sim.memory[addr];
        if (word === 0 && !hasData) continue;
        hasData = true;
        const decoded = asm.disassemble(word);
        memHtml += `<tr>`;
        memHtml += `<td class="cr-idx">0x${addr.toString(16).toUpperCase().padStart(4,'0')}</td>`;
        memHtml += `<td class="cr-gt">0x${word.toString(16).toUpperCase().padStart(8,'0')}</td>`;
        memHtml += `<td class="code-disasm">${decoded}</td>`;
        memHtml += '</tr>';
    }
    memHtml += '</tbody></table>';
    if (hasData) {
        h += '<div class="clist-detail-title" style="margin-top:0.4rem;">Memory Contents</div>';
        h += memHtml;
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
        6: 'C-List', 7: 'CLOOMC', 8: 'Thread', 9: 'IRQ', 10: 'Fault', 15: 'Namespace'
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
    const crMbit = sim.cr[crIdx].m;
    const nsIdx = cr.gtIndex;

    const codeRegs = [7];
    const clistRegs = [6];
    const threadRegs = [8];
    const nsRegs = [15];
    const showCode = hasX || (crMbit && codeRegs.includes(crIdx));
    const showCList = hasL || (crMbit && clistRegs.includes(crIdx));
    const showThread = crMbit && threadRegs.includes(crIdx);
    const showNS = crMbit && nsRegs.includes(crIdx);

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
        const baseLoc = cr.word1_location >>> 0;
        const limitVal = cr.limit17;
        const wordCount = Math.min(limitVal + 1, 256);
        let hasCodeData = false;
        let codeHtml = '<table class="cr-table code-view-table"><thead><tr>';
        codeHtml += '<th>Addr</th><th>Hex</th><th>Instruction</th>';
        codeHtml += '</tr></thead><tbody>';
        const asm = new ChurchAssembler();
        for (let w = 0; w < wordCount; w++) {
            const addr = baseLoc + w;
            if (addr >= sim.memory.length) break;
            const word = sim.memory[addr];
            if (word === 0 && !hasCodeData) continue;
            hasCodeData = true;
            const isPC = (addr === sim.pc);
            const rowClass = isPC ? 'code-pc-row' : '';
            const decoded = word === 0 ? 'NOP / HALT' : asm.disassemble(word);
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
                (baseLoc + wordCount - 1).toString(16).toUpperCase().padStart(4,'0') + ').</div>';
        } else {
            html += codeHtml;
        }
        html += '</div>';
    }

    if (showCList) {
        html += '<div class="cr-detail-section">';
        html += '<div class="cr-detail-heading">C-List View \u2014 Accessible Entries</div>';
        const clistEntries = [];
        for (let i = 0; i < sim.nsCount; i++) {
            const e = sim.readNSEntry(i);
            if (!e) continue;
            const eLoc = e.word0_location >>> 0;
            const eLim = sim.parseNSWord1(e.word1_limit);
            clistEntries.push({ idx: i, entry: e, loc: eLoc, lim: eLim });
        }
        if (clistEntries.length === 0) {
            html += '<div style="color:var(--text-secondary);padding:0.5rem;">No namespace entries within this capability\'s range.</div>';
        } else {
            html += '<table class="cr-table"><thead><tr>';
            html += '<th>Idx</th><th>Label</th><th>Type</th><th>Location</th><th>B</th><th>Limit</th><th>FNV</th>';
            html += '</tr></thead><tbody>';
            for (let j = 0; j < clistEntries.length; j++) {
                const c = clistEntries[j];
                const e = c.entry;
                const typeNames = ['NULL','Inform','Outform','Abstract'];
                const sealFNV = e.word2_seals & 0x01FFFFFF;
                const isExpanded = (clistExpandedIdx === c.idx);
                html += `<tr class="cr-active clist-clickable${isExpanded ? ' clist-selected' : ''}" onclick="toggleCListEntry(${c.idx})" title="Click to inspect NS[${c.idx}]">`;
                html += `<td class="cr-idx">${c.idx}</td>`;
                html += `<td class="cr-name">${e.label || ''}</td>`;
                html += `<td>${typeNames[e.gtType] || '?'}</td>`;
                html += `<td>0x${c.loc.toString(16).toUpperCase().padStart(8,'0')}</td>`;
                html += `<td class="cr-flag">${c.lim.b}</td>`;
                html += `<td>0x${c.lim.limit.toString(16).toUpperCase().padStart(5,'0')}</td>`;
                html += `<td>0x${sealFNV.toString(16).toUpperCase().padStart(7,'0')}</td>`;
                html += '</tr>';
                if (isExpanded) {
                    html += `<tr class="clist-detail-row"><td colspan="7">${renderCListEntryDetail(c.idx, e)}</td></tr>`;
                }
            }
            html += '</tbody></table>';
        }
        html += '</div>';
    }

    if (showThread) {
        html += '<div class="cr-detail-section">';
        html += '<div class="cr-detail-heading">Thread Identity</div>';
        html += '<table class="cr-table"><tbody>';
        html += `<tr><td style="color:var(--church-blue)">Thread Index</td><td>${cr.gtIndex}</td></tr>`;
        html += `<tr><td style="color:var(--church-blue)">M bit</td><td class="${cr.mBit ? 'cr-m-set' : ''}">${cr.mBit}</td></tr>`;
        html += `<tr><td style="color:var(--church-blue)">Boot Gift</td><td>${cr.mBit ? 'Written under M elevation' : 'Normal'}</td></tr>`;
        const threadNS = sim.readNSEntry(cr.gtIndex);
        if (threadNS) {
            html += `<tr><td style="color:var(--church-blue)">NS Label</td><td>${threadNS.label || '(unnamed)'}</td></tr>`;
            html += `<tr><td style="color:var(--church-blue)">Chainable</td><td>${threadNS.chainable ? 'Yes' : 'No'}</td></tr>`;
        }
        html += '</tbody></table>';
        html += '</div>';
    }

    if (showNS) {
        html += '<div class="cr-detail-section">';
        html += '<div class="cr-detail-heading">Namespace Root \u2014 All Entries</div>';
        if (sim.nsCount === 0) {
            html += '<div style="color:var(--text-secondary);padding:0.5rem;">Namespace table is empty.</div>';
        } else {
            html += '<table class="cr-table"><thead><tr>';
            html += '<th>Idx</th><th>Label</th><th>Type</th><th>Location</th><th>B</th><th>G</th><th>Chain</th>';
            html += '</tr></thead><tbody>';
            const typeNames = ['NULL','Inform','Outform','Abstract'];
            for (let i = 0; i < sim.nsCount; i++) {
                const e = sim.readNSEntry(i);
                if (!e) continue;
                const loc = e.word0_location >>> 0;
                html += '<tr class="cr-active">';
                html += `<td class="cr-idx">${i}</td>`;
                html += `<td class="cr-name">${e.label || ''}</td>`;
                html += `<td>${typeNames[e.gtType] || '?'}</td>`;
                html += `<td>0x${loc.toString(16).toUpperCase().padStart(8,'0')}</td>`;
                html += `<td class="cr-flag">${sim.parseNSWord1(e.word1_limit).b}</td>`;
                html += `<td class="cr-flag">${e.gBit}</td>`;
                html += `<td>${e.chainable ? 'Yes' : 'No'}</td>`;
                html += '</tr>';
            }
            html += '</tbody></table>';
        }
        html += '</div>';
    }

    if (!showCode && !showCList && !showThread && !showNS) {
        html += '<div class="cr-detail-section">';
        html += '<div class="cr-detail-heading">Capability Info</div>';
        html += '<div style="color:var(--text-secondary);padding:0.5rem;">GT permissions control visibility. This capability does not grant viewable access (no R, X, or L). Run boot sequence to populate registers.</div>';
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
    html += `<tr><td>word0: GT</td><td class="cr-gt">0x${cr.word0_gt}</td><td>[${cr.perms}] Ver=${cr.gtVersion} Idx=${cr.gtIndex} Type=${cr.gtTypeName}</td></tr>`;
    html += `<tr><td>word1: Location</td><td>0x${cr.word1_location.toString(16).toUpperCase().padStart(8,'0')}</td><td>Base address in memory</td></tr>`;
    html += `<tr><td>word2: Limit</td><td>B=${cr.limitB} F=${cr.limitF} Limit=0x${cr.limit17.toString(16).toUpperCase().padStart(5,'0')}</td><td>Bound=${cr.limitB} Far=${cr.limitF} Size=${cr.limit17 + 1} words</td></tr>`;
    html += `<tr><td>word3: Seals</td><td>Ver=${cr.sealVersion} FNV=0x${cr.sealFNV.toString(16).toUpperCase().padStart(7,'0')}</td><td>Integrity seal</td></tr>`;
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
        const sealVer = (entry.word2_seals >>> 25) & 0x7F;
        const sealFNV = entry.word2_seals & 0x01FFFFFF;
        const gtPermStr = cr.perms;
        const typeNames = ['NULL','Inform','Outform','Abstract'];

        html += '<table class="cr-table"><tbody>';
        html += `<tr><td>Location</td><td>0x${loc.toString(16).toUpperCase().padStart(8,'0')}</td></tr>`;
        html += `<tr><td>GT Permissions</td><td>[${gtPermStr}]</td></tr>`;
        html += `<tr><td>GT Type</td><td>${typeNames[entry.gtType] || '?'}</td></tr>`;
        html += `<tr><td>B (Bind)</td><td>${lim.b}</td></tr>`;
        html += `<tr><td>F (Far)</td><td>${lim.f}</td></tr>`;
        html += `<tr><td>Limit</td><td>0x${lim.limit.toString(16).toUpperCase().padStart(5,'0')} (${lim.limit + 1} words)</td></tr>`;
        html += `<tr><td>Version</td><td>${sealVer}</td></tr>`;
        html += `<tr><td>FNV Seal</td><td>0x${sealFNV.toString(16).toUpperCase().padStart(7,'0')}</td></tr>`;
        html += `<tr><td>G bit</td><td>${entry.gBit}</td></tr>`;
        html += `<tr><td>Chainable</td><td>${entry.chainable ? 'Yes' : 'No'}</td></tr>`;
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
    const bootLabel = !sim.bootComplete ? `BOOT ${sim.bootStep}/6` : '';
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
        <button class="btn btn-success btn-sm" onclick="stepSim()">Step</button>
        <button class="btn btn-info btn-sm" onclick="slowBoot()" ${sim.bootComplete ? 'disabled style="opacity:0.5"' : ''}>Boot</button>
        <button class="btn btn-success btn-sm" onclick="runSim()">Run</button>
        <button class="btn btn-walk btn-sm" onclick="walkToggle()">${walkRunning ? 'Stop' : 'Walk'}</button>
        <button class="btn btn-warning btn-sm" onclick="faultClear()">Fault</button>
        <span class="flags-sep"></span>
        <span class="flag ${f.N ? 'flag-set' : ''}">N</span>
        <span class="flag ${f.Z ? 'flag-set' : ''}">Z</span>
        <span class="flag ${f.C ? 'flag-set' : ''}">C</span>
        <span class="flag ${f.V ? 'flag-set' : ''}">V</span>
        <span class="flag-info">PC: ${sim.pc}</span>
        <span class="flag-info">Steps: ${sim.stepCount}</span>
        <span class="flag-info">Stack: ${sim.callStack.length}</span>
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
        <div class="info-item"><span class="info-label">Abstraction Layers</span><span class="info-value">9 layers, ${abstractionRegistry ? abstractionRegistry.count() : 45} abstractions (Boot, System, Hardware, Math, Lambda Calculus, Social, IDE, Internet, GC)</span></div>
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

function renderMemoryDump(location, limit) {
    const wordCount = Math.min(limit, 64);
    if (wordCount <= 0) return '<span style="color:#888;">Empty (limit=0)</span>';
    let html = '<table class="ns-mem-table"><thead><tr>';
    html += '<th>Offset</th><th>Address</th><th>Hex</th><th>Decoded</th>';
    html += '</tr></thead><tbody>';
    const permNames = ['R','W','X','L','S','E'];
    const typeNames = {0:'NULL', 1:'Inform', 2:'Outform', 3:'Abstract'};
    for (let i = 0; i < wordCount; i++) {
        const addr = location + i;
        const word = sim.memory[addr] || 0;
        const hex = '0x' + (word >>> 0).toString(16).toUpperCase().padStart(8, '0');
        let decoded = '';
        if (word === 0) {
            decoded = '<span style="color:#666;">0 (empty)</span>';
        } else {
            const gtType = word & 0x3;
            const perms = (word >> 2) & 0x3F;
            const index = (word >> 8) & 0x1FFFF;
            const ver = (word >> 25) & 0x7F;
            const pStr = permNames.filter((_, b) => perms & (1 << b)).join('') || '------';
            const tName = typeNames[gtType] || '?';
            const label = sim.nsLabels[index] || '';
            decoded = `<span style="color:#4ec9b0;">${tName}</span> ` +
                      `<span style="color:#d4a843;">${pStr}</span> ` +
                      `\u2192 idx <span style="color:#569cd6;">${index}</span>` +
                      (label ? ` <span style="color:#9cdcfe;">(${label})</span>` : '') +
                      ` v${ver}`;
        }
        const addrHex = '0x' + addr.toString(16).toUpperCase().padStart(4, '0');
        html += `<tr><td style="color:#888;">+${i}</td><td>${addrHex}</td><td style="color:#ce9178;">${hex}</td><td>${decoded}</td></tr>`;
    }
    html += '</tbody></table>';
    if (limit > 64) {
        html += `<div style="color:#888;font-size:0.75rem;padding:0.25rem 0.5rem;">Showing first 64 of ${limit} words</div>`;
    }
    return html;
}

function updateNamespace() {
    const container = document.getElementById('namespaceTable');
    if (!container) return;
    let html = '<div class="ns-layout-header">NS_ENTRY_LAYOUT: 3 words per entry (96 bits) \u2014 click a row to inspect memory</div>';
    html += '<table class="ns-table"><thead><tr>';
    html += '<th>Idx</th><th class="ns-label-col">Label</th>';
    html += '<th>Type</th><th>Location</th>';
    html += '<th>B</th><th>F</th><th>Limit</th>';
    html += '<th>Ver</th><th>FNV Seal</th>';
    html += '<th>G</th><th>Actions</th>';
    html += '</tr></thead><tbody>';

    const typeNames = ['NULL','Inform','Outform','Abstract'];
    for (let i = 0; i < sim.nsCount; i++) {
        const e = sim.readNSEntry(i);
        if (!e) continue;
        const lim = sim.parseNSWord1(e.word1_limit);
        const ver = (e.word2_seals >>> 25) & 0x7F;
        const seal = e.word2_seals & 0x01FFFFFF;
        const isExpanded = (nsExpandedSlot === i);
        html += `<tr class="ns-row${isExpanded ? ' ns-row-active' : ''}" onclick="toggleNSDetail(${i})" style="cursor:pointer;">`;
        html += `<td>${i}</td>`;
        html += `<td class="ns-label">${e.label || '-'}</td>`;
        html += `<td>${typeNames[e.gtType] || '?'}</td>`;
        html += `<td>0x${e.word0_location.toString(16).toUpperCase().padStart(8, '0')}</td>`;
        html += `<td class="ns-flag">${lim.b}</td>`;
        html += `<td class="ns-flag">${lim.f}</td>`;
        html += `<td>0x${lim.limit.toString(16).toUpperCase().padStart(5, '0')}</td>`;
        html += `<td>${ver}</td>`;
        html += `<td>0x${seal.toString(16).toUpperCase().padStart(7, '0')}</td>`;
        html += `<td class="ns-flag">${e.gBit}</td>`;
        html += `<td class="ns-entry-actions"><button class="btn btn-primary btn-xs" onclick="event.stopPropagation();exportEntryMemory(${i})">Export</button> <button class="btn btn-xs" onclick="event.stopPropagation();importEntryMemory(${i})" style="background:#3a86ff;color:#fff;border:none;">Import</button></td>`;
        html += '</tr>';
        if (isExpanded) {
            html += `<tr class="ns-detail-row"><td colspan="11">`;
            html += `<div class="ns-detail-panel">`;
            html += `<div class="ns-detail-title">Memory at 0x${e.word0_location.toString(16).toUpperCase().padStart(4, '0')} \u2014 ${e.label || 'Slot '+i} (${lim.limit} words)</div>`;
            html += renderMemoryDump(e.word0_location, lim.limit);
            html += `</div></td></tr>`;
        }
    }
    html += '</tbody></table>';
    container.innerHTML = html;
}

let selectedAbsIndex = null;
let absCollapsedLayers = {};

function renderAbstractions() {
    if (!abstractionRegistry) return;
    const listEl = document.getElementById('absLayerList');
    if (!listEl) return;

    const layerNames = abstractionRegistry.getLayerNames();
    let html = '';

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
                html += `<div class="abs-item${isActive ? ' active' : ''}" onclick="showAbstractionDetail(${abs.index})">`;
                html += `<span class="abs-item-idx">${abs.index}</span>`;
                html += `<span class="abs-item-name">${abs.name}</span>`;
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
    const permStr = (p.R?'R':'')+(p.W?'W':'')+(p.X?'X':'')+(p.L?'L':'')+(p.S?'S':'')+(p.E?'E':'') || 'none';

    let html = '';

    html += '<div class="abs-detail-section">';
    html += `<div class="abs-detail-badge layer-${abs.layer}">Layer ${abs.layer} \u2014 ${layerName}</div>`;
    html += `<div class="abs-detail-desc">${abs.description}</div>`;
    html += '</div>';

    html += '<div class="abs-detail-section abs-polymorphic-section">';
    html += '<div class="abs-detail-label">Polymorphic Interface</div>';
    html += '<div class="abs-polymorphic-bar">';
    html += '<span class="abs-poly-method">create</span>';
    html += '<span class="abs-poly-method">destroy</span>';
    html += '<span class="abs-poly-method">call</span>';
    html += '<span class="abs-poly-method">inspect</span>';
    html += '</div>';
    html += '<div class="abs-poly-note">Every abstraction responds to these four operations. ';
    html += 'This uniformity is intentional \u2014 the same pattern applies whether the abstraction is a boot service, a hardware driver, a math library, or a social networking tool.</div>';
    html += '</div>';

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

    if (abs.methods && abs.methods.length > 0) {
        html += '<div class="abs-detail-section">';
        html += '<div class="abs-detail-label">Methods</div>';
        const methodPurposes = getMethodPurposes(abs);
        const methodExamples = getMethodExamples(abs);
        html += '<div class="abs-method-cards">';
        for (const m of abs.methods) {
            const purpose = methodPurposes[m] || 'Dispatched via CALL';
            const example = methodExamples[m] || null;
            html += '<div class="abs-method-card">';
            html += `<div class="abs-method-card-header">`;
            html += `<span class="abs-method-card-name">${abs.name}.${m}</span>`;
            html += `</div>`;
            html += `<div class="abs-method-card-desc">${purpose}</div>`;
            if (example) {
                html += `<pre class="abs-method-card-code">${example}</pre>`;
            }
            html += '</div>';
        }
        html += '</div>';
        html += '</div>';
    }

    html += '<div class="abs-detail-section">';
    html += '<div class="abs-detail-label">CR6/CR7 Canonical Form</div>';
    html += '<div class="abs-canonical">';
    html += '<div class="abs-canonical-diagram">';
    html += `<div class="abs-cr-box cr6-box">`;
    html += `<div class="abs-cr-label">CR6 (C-List)</div>`;
    html += `<div class="abs-cr-content">GT \u2192 NS[${abs.index}]</div>`;
    html += `<div class="abs-cr-perms">[E] Enter permission</div>`;
    html += `</div>`;
    html += `<div class="abs-cr-arrow">\u2192 CALL \u2192</div>`;
    html += `<div class="abs-cr-box cr7-box">`;
    html += `<div class="abs-cr-label">CR7 (CLOOMC)</div>`;
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
        'Deployer': { 'Build': 'Deployer.Build(binary_GT) — package for Gowin GW2AR-18', 'Upload': 'Deployer.Upload() — send via UART to Tang Nano (S perm)', 'Verify': 'Deployer.Verify() — readback + checksum via UART (L perm)', 'Boot': 'Deployer.Boot() — send boot command, FPGA begins execution' },
        'Browser': { 'Navigate': 'Browser.Navigate(site_GT) — LOAD content via L perm (no URLs)', 'Back': 'Browser.Back() — pop previous site GT from history', 'Bookmark': 'Browser.Bookmark(site_GT) — SAVE GT to bookmark c-list', 'Search': 'Browser.Search(scope_GT) — search within GT scope only' },
        'Messenger': { 'Send': 'Messenger.Send(recipient_GT, msg_GT) — send to approved contact', 'Receive': 'Messenger.Receive() — dequeue from inbox c-list', 'Contacts': 'Messenger.Contacts() — list parent-approved contact GTs', 'Block': 'Messenger.Block(contact_GT) — Mint.Revoke contact GT' },
        'Photos': { 'View': 'Photos.View(photo_GT) — LOAD photo data via L perm', 'Share': 'Photos.Share(photo_GT, recipient_GT) — TPERM to L-only, transfer', 'Upload': 'Photos.Upload(data_GT) — Memory.Allocate + store photo', 'Album': 'Photos.Album() — walk album c-list, return count' },
        'Social': { 'Post': 'Social.Post(content_GT) — publish to followers\' feed c-lists', 'Read': 'Social.Read() — LOAD next feed entry via L perm', 'Follow': 'Social.Follow(account_GT) — request follow (parent-gated)', 'Feed': 'Social.Feed() — count feed items available' },
        'Video': { 'Watch': 'Video.Watch(video_GT) — LOAD + stream via L perm', 'Search': 'Video.Search(scope_GT) — search within approved scope', 'Playlist': 'Video.Playlist() — walk playlist c-list', 'Share': 'Video.Share(video_GT, recipient_GT) — TPERM to L-only, transfer' },
        'Email': { 'Compose': 'Email.Compose(recipient_GT, body_GT) — allocate + send to inbox', 'Read': 'Email.Read() — dequeue from inbox c-list', 'Reply': 'Email.Reply(original_GT, body_GT) — reply in thread chain', 'Contacts': 'Email.Contacts() — list parent-approved email contacts' },
        'GC': { 'Scan': 'GC.Scan() — walk CRs + c-lists, set G-bit on live NS entries', 'Identify': 'GC.Identify() — find entries where G-bit != polarity', 'Clear': 'GC.Clear() — zero word0+word1 on garbage entries', 'Flip': 'GC.Flip() — toggle polarity for bidirectional cycle' },
    };
    if (knownPurposes[abs.name]) {
        return knownPurposes[abs.name];
    }
    for (const m of abs.methods) {
        purposes[m] = 'Dispatched via CALL';
    }
    return purposes;
}

function getMethodExamples(abs) {
    const examples = {
        'Salvation': {
            'LOAD': `; Salvation.LOAD — prove namespace lookup via mLoad pipeline
; mLoad 7-step: type check -> version match -> seal verify
;   -> bounds check -> perm check -> F-bit -> deliver
LOAD   CR1, NS[4]       ; mLoad pipeline validates GT:
                         ;   1. Type != NULL (00=NULL, 01=Inform)
                         ;   2. GT.version == NS[4].word2[31:25]
                         ;   3. FNV seal(word0,word1) == word2[24:0]
                         ;   4. Index 4 within NS bounds
                         ;   5. L perm required for LOAD
                         ;   6. F-bit=0 (local, not tunneled)
                         ;   7. CR1 <- 128-bit capability register
; CR1.word0 = GT packed: Ver(7)|Idx(17)|Perms(6)|Type(2)
; CR1.word1 = NS[4].word0 (location)
; CR1.word2 = NS[4].word1 (B|F|G|...|limit[16:0])
; CR1.word3 = NS[4].word2 (version[31:25]|seal[24:0])`,
            'TPERM': `; Salvation.TPERM — prove permission monotonicity
; TPERM can only remove permissions, never add them
; This is how the architecture enforces least privilege
LOAD   CR1, NS[4]       ; CR1 holds Salvation GT [E]
TPERM  CR1, #0b100000   ; Test E bit (bit 5 of perm field)
BRANCH.NE  @perm_fault  ; Z flag clear = permission denied
; Permission check passed
; Note: TPERM never escalates — if source lacks a bit,
; the result cannot have it. Monotonic restriction only.`,
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
                         ;   3. CR7 <- X-GT at c-list[0] (CLOOMC)
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
                         ;   CR7 <- Navana CLOOMC (DATA-domain)
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
;     recompute seal = FNV(word0, word1)
;     compare seal vs word2[24:0]
;     if mismatch: FAULT — tampered entry
;     check version consistency across all GTs
;     if GT.version > NS.version: stale/forged
;   Report anomalies to Navana.Monitor`,
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
;      word2 = (newVer<<25) | FNV_seal(loc, limit)
;   5. Pack GT:
;      GT = (1<<25)|(50<<8)|(0b000011<<2)|(0b01)
;         = ver=1, idx=50, R+W, Inform
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
;   CR7 loads via X perm at c-list[0]

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
;   seal = word2 & 0x01FFFFFF          ; preserve seal
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
; and recompute the FNV seal separately`,
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
;   4. If full: FAULT STACK_OVERFLOW`,
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
;   4. Recompute seal: FNV(word0, word1) for integrity
;   5. Update word2 = (version << 25) | newSeal`,
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
        'Deployer': {
            'Build': `; Deployer.Build — compile binary for Tang Nano 20K
LOAD   CR1, NS[36]      ; Load Deployer E-GT
LOAD   CR2, NS[81]      ; Binary GT (DATA object)

CALL   CR1              ; Deployer.Build:
;   1. DREAD binary from CR2's location
;   2. Add boot vector and NS table initialization
;   3. Package for FPGA: Gowin GW2AR-18 bitstream
;   4. Memory.Allocate for deployment image
;   5. Mint.Create GT for image
; CR2 <- deployment image GT`,
            'Upload': `; Deployer.Upload — send to Tang via UART
LOAD   CR1, NS[36]      ; Load Deployer E-GT

CALL   CR1              ; Deployer.Upload:
;   1. LOAD UART GT from c-list (NS[11])
;   2. For each word in deployment image:
;      SAVE word to UART (S perm on UART GT)
;   3. UART TX on pin 69 -> BL616 USB bridge
;   4. Wait for ACK after each block`,
            'Verify': `; Deployer.Verify — verify upload integrity
LOAD   CR1, NS[36]      ; Load Deployer E-GT

CALL   CR1              ; Deployer.Verify:
;   1. Request readback from Tang via UART
;   2. LOAD bytes from UART (L perm)
;   3. Compare against original image
;   4. Compute checksum match
; DR0 <- 1 if verified, 0 if mismatch`,
            'Boot': `; Deployer.Boot — boot the FPGA
LOAD   CR1, NS[36]      ; Load Deployer E-GT

CALL   CR1              ; Deployer.Boot:
;   1. Send boot command via UART
;   2. Tang Nano begins executing from boot vector
;   3. FPGA initializes NS table (slots 0-44)
;   4. Boot -> Salvation -> Navana (same as simulator)
;   5. 27MHz clock begins instruction execution`,
        },
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
;   1. Scan NS table (slots 45..nsCount):
;      read word1[29] (G-bit) for each entry
;      if G-bit != current polarity: entry is garbage
;   2. Build garbage list
; DR0 <- number of garbage entries found
; Skip boot slots 0-44 (always live)`,
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
    };
    return examples[abs.name] || {};
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

function stepSim() {
    if (!sim.bootComplete) {
        sim._bootStep();
        const con = document.getElementById('editorConsole');
        if (con) {
            con.textContent += `\n[boot ${sim.bootStep}/6] ${sim.output.split('\n').filter(l => l).pop()}`;
            con.scrollTop = con.scrollHeight;
        }
        updateDashboard();
        return;
    }
    const result = sim.step();
    if (result) {
        const con = document.getElementById('editorConsole');
        if (con) {
            con.textContent += `\n[${sim.stepCount}] ${result.desc || 'executed'}`;
            con.scrollTop = con.scrollHeight;
        }
        if (result.pipeline && pipelineViz) {
            pipelineViz.showFullPipeline(result.pipeline);
        }
    }
    updateDashboard();
}

let walkRunning = false;
let walkTimer = null;

function walkToggle() {
    if (walkRunning) {
        walkRunning = false;
        if (walkTimer) { clearTimeout(walkTimer); walkTimer = null; }
        if (pipelineViz) pipelineViz.stopAnimation();
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
                updateDashboard();
                walkNext();
            }
        }, 200);
        return;
    }
    walkRunning = true;
    switchView('pipeline');
    updateDashboard();
    walkNext();
}

function walkNext() {
    if (!walkRunning || !sim.bootComplete) {
        walkRunning = false;
        updateDashboard();
        return;
    }
    const result = sim.step();
    if (!result) {
        walkRunning = false;
        updateDashboard();
        return;
    }
    const con = document.getElementById('editorConsole');
    if (con) {
        con.textContent += `\n[${sim.stepCount}] ${result.desc || 'executed'}`;
        con.scrollTop = con.scrollHeight;
    }
    if (result.pipeline && pipelineViz) {
        pipelineViz.animate(result.pipeline, 500).then(() => {
            updateDashboard();
            if (walkRunning && sim.bootComplete) {
                walkTimer = setTimeout(walkNext, 600);
            } else {
                walkRunning = false;
                updateDashboard();
            }
        });
    } else {
        updateDashboard();
        if (walkRunning && sim.bootComplete) {
            walkTimer = setTimeout(walkNext, 1000);
        } else {
            walkRunning = false;
            updateDashboard();
        }
    }
}

let bootAnimating = false;
function slowBoot() {
    if (bootAnimating || sim.bootComplete) return;
    bootAnimating = true;
    const delay = 800;
    function nextPhase() {
        if (sim.bootComplete) {
            bootAnimating = false;
            const con = document.getElementById('editorConsole');
            if (con) {
                con.textContent += '\n--- Boot sequence complete ---';
                con.scrollTop = con.scrollHeight;
            }
            updateDashboard();
            return;
        }
        sim._bootStep();
        const con = document.getElementById('editorConsole');
        if (con) {
            con.textContent += `\n[boot ${sim.bootStep}/6] ${sim.output.split('\n').filter(l => l).pop()}`;
            con.scrollTop = con.scrollHeight;
        }
        updateDashboard();
        setTimeout(nextPhase, delay);
    }
    nextPhase();
}

function runSim() {
    while (!sim.bootComplete) {
        sim._bootStep();
    }
    const steps = sim.run(10000);
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

function faultClear() {
    sim.reset();
    pipelineViz.reset();
    const con = document.getElementById('editorConsole');
    if (con) con.textContent = 'FAULT: Machine cleared.';
    updateDashboard();
}

function resetSim() {
    sim.reset();
    pipelineViz.reset();
    while (!sim.bootComplete) {
        sim._bootStep();
    }
    const con = document.getElementById('editorConsole');
    if (con) con.textContent = 'Machine reset and booted.';
    updateDashboard();
}

function runGC() {
    if (!sim.bootComplete) {
        const con = document.getElementById('editorConsole');
        if (con) con.textContent += '\nGC Error: Boot must complete before running GC.\n';
        return;
    }
    sim.output += '[I/O] GC button pressed \u2014 invoking GC safe abstraction\n';
    sim.mElevation = true;
    const result = sim.runGC();
    sim.mElevation = false;
    sim.output += '[I/O] GC abstraction complete \u2014 RETURN\n';
    const con = document.getElementById('editorConsole');
    if (con) {
        con.textContent += '\n' + result.report + '\n';
        con.scrollTop = con.scrollHeight;
    }
    updateDashboard();
}

function loadExample(name) {
    const editor = document.getElementById('asmEditor');
    if (!editor) return;

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
; table at the end of this program (CR7).
; ============================================

; --- Initialize Ada's Store columns ---
DREAD DR1, CR7, 100        ; V1 = 1
DREAD DR2, CR7, 101        ; V2 = 2
DREAD DR3, CR7, 102        ; V3 = n = 4

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
DREAD DR15, CR7, 103       ; DR15 = B1 = 1
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
DREAD DR15, CR7, 104       ; DR15 = B3 = 1
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
DREAD DR15, CR7, 105       ; DR15 = B5 = 1
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
; DREAD DR, CR7, offset reads these values.
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
CALL CR0               ; Push frame, enter Salvation
RETURN CR0             ; Pop frame, return to next

; --- TEST 9: ELOADCALL - fused Load+TPERM+Call ---
ELOADCALL CR0, CR6, 4  ; Load Salvation + check E + call
RETURN CR0             ; Return from fused call

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
RETURN CR0             ; Return
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
RETURN CR0
`,
        'conditional': `; Conditional execution demo
LOAD CR0, CR6, 4       ; Load SUCC (Church numeral)
TPERM CR0, XL          ; Check \u2014 sets Z=1 (pass)

; This executes only if Z=1 (TPERM passed)
LOADEQ CR1, CR6, 6     ; Load ADD only if equal (Z=1)
LAMBDAEQ CR1           ; Apply ADD via LAMBDA only if equal

; This would skip if Z=0 (TPERM failed)
LOADNE CR2, CR6, 7     ; Load SUB only if not-equal (Z=0)

RETURN CR0
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
CALL CR5               ; Trigger GC abstraction

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
CALL CR0               ; Enter Salvation abstraction
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
;   Slot 2  Boot.Abstraction (E only, L bypassed via CR6 M-elevation)
;   Slot 3  Boot.CLOOMC (X only)
;   Slot 22 TRUE       (L only \u2014 no X, no E)
;   Slot 23 FALSE      (L only \u2014 no X, no E)
;   Slot 27 GC         (E only)
; ============================================

; --- ATTACK 1: CALL without E permission ---
; TRUE (slot 22) has only L \u2014 no E.
; CALL requires E via mLoad. Should FAULT.
LOAD CR0, CR6, 22      ; CR0 = TRUE (L only)
CALL CR0               ; FAULT: lacks E permission

; --- ATTACK 2: LAMBDA without X permission ---
; Constants (slot 7) has only E \u2014 no X.
; LAMBDA requires X via mLoad. Should FAULT.
LOAD CR1, CR6, 7       ; CR1 = Constants (E only)
LAMBDA CR1             ; FAULT: lacks X permission

; --- ATTACK 3: CALL something with only X ---
; Boot.CLOOMC (slot 3) has only X \u2014 no E.
; CALL requires E. Should FAULT.
LOAD CR2, CR6, 3       ; CR2 = Boot.CLOOMC (X only)
CALL CR2               ; FAULT: lacks E permission

; --- If we get here, something is broken ---
HALT
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
LOAD CR0, CR6, 10      ; CR0 = SUCC (XLE, B=0)
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

function showMathGuidePopup() {
    if (localStorage.getItem('churchMachine_mathGuideDismissed')) return;
    if (!localStorage.getItem('church_welcome_dismissed')) return;

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
        `CALL names the abstraction, the envelope opens, the body runs inside, and the envelope closes.</p>` +
        `</div>` +

        `<div style="flex:1;background:rgba(100,180,255,0.08);border:1px solid rgba(100,180,255,0.25);border-radius:8px;padding:0.6rem 0.8rem;">` +
        `<div style="font-weight:700;color:rgba(130,200,255,0.95);margin-bottom:0.3rem;">Right &mdash; The Body</div>` +
        `<p style="font-size:0.82rem;line-height:1.5;margin:0;">` +
        `Turing domain. Numbers and physical addresses. The challenge panel shows how the body computes: ` +
        `<strong>IADD DR0, DR0, DR1</strong> &mdash; add two registers. ` +
        `Values that can overflow. Loops that can run forever. The body can fail.</p>` +
        `</div>` +

        `</div>` +

        `<div style="background:rgba(100,200,100,0.06);border:1px solid rgba(100,200,100,0.2);border-radius:8px;padding:0.6rem 0.8rem;">` +
        `<p style="font-size:0.82rem;line-height:1.5;margin:0 0 0.4rem 0;">` +
        `Ada wrote the first program in 1843 using symbols &mdash; no compiler, no OS, no superuser. ` +
        `The Church Machine returns to what she had.</p>` +
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
    localStorage.setItem('churchMachine_mathGuideDismissed', '1');
    const modal = document.getElementById('mathGuideModal');
    if (modal) modal.style.display = 'none';
    showToolGuide('interactive');
}

function resetGuidePopups() {
    localStorage.removeItem('church_welcome_dismissed');
    localStorage.removeItem('churchMachine_mathGuideDismissed');
    localStorage.removeItem('churchMachine_toolGuide_interactive');
    localStorage.removeItem('churchMachine_toolGuide_hp35');
    localStorage.removeItem('churchMachine_toolGuide_abacus');
    localStorage.removeItem('churchMachine_toolGuide_sliderule');
    closeSettings();
    showWelcomePopup();
}

const TOOL_GUIDES = {
    interactive: {
        title: 'Interactive Math',
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
            `This is how Ada Lovelace wrote her first program in 1843: symbols first, then the machine runs them.</p></div>`
    },
    hp35: {
        title: 'HP-35 Scientific Calculator',
        body:
            `<div style="display:flex;gap:0.5rem;align-items:center;margin-bottom:0.75rem;">` +
            `<span style="font-size:2rem;">&#128425;</span>` +
            `<div><strong style="font-size:1rem;">The calculator that changed the world</strong>` +
            `<p style="font-size:0.82rem;color:var(--text-secondary);margin:0.2rem 0 0;">A 1972 HP-35, rebuilt in pure lambda calculus.</p></div></div>` +

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
            `No brackets needed, ever. Astronauts used this on Apollo missions!</p></div>` +

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
            `<p style="font-size:0.82rem;color:var(--text-secondary);margin:0.2rem 0 0;">A Japanese soroban \u2014 people have used these for 2,500 years.</p></div></div>` +

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
            `<p style="font-size:0.82rem;color:var(--text-secondary);margin:0.2rem 0 0;">Engineers used slide rules for 350 years \u2014 from bridges to moon rockets.</p></div></div>` +

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
            `<span style="color:#44aaff;">b</span> above the scale show you what\u2019s happening.</p></div>` +

            `<div style="background:rgba(100,200,100,0.06);border:1px solid rgba(100,200,100,0.2);border-radius:8px;padding:0.6rem 0.8rem;">` +
            `<div style="font-weight:600;color:rgba(100,200,100,0.9);font-size:0.78rem;text-transform:uppercase;letter-spacing:1px;margin-bottom:0.3rem;">How to learn</div>` +
            `<p style="font-size:0.82rem;line-height:1.55;margin:0;">` +
            `Click <strong>2 \u00d7 3</strong> to see the slide rule compute 6. Watch the hand-drawn arrow appear below. ` +
            `Then try dragging the C scale yourself and moving the cursor. ` +
            `NASA engineers calculated the Apollo trajectory with slide rules like this one.</p></div>`
    }
};

let currentToolGuide = null;

function showToolGuide(tool) {
    if (!TOOL_GUIDES[tool]) return;
    if (localStorage.getItem('churchMachine_toolGuide_' + tool)) return;
    if (!localStorage.getItem('church_welcome_dismissed')) return;
    if (!localStorage.getItem('churchMachine_mathGuideDismissed')) return;

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

function replExecute(cmdOverride) {
    const input = document.getElementById('replInput');
    const output = document.getElementById('replOutput');
    if (!input || !output) return;

    const command = cmdOverride || input.value.trim();
    if (!command) return;

    output.innerHTML += `<div class="repl-input-echo">\u03BB&gt; ${escapeHtml(command)}</div>`;

    const result = repl.execute(command);
    if (result) {
        if (result.type === 'result') {
            output.innerHTML += `<div class="repl-result">${escapeHtml(result.text)}</div>`;
            if (result.churchSteps && result.churchSteps.length > 0) {
                let traceHtml = '<div class="repl-trace">';
                for (const step of result.churchSteps) {
                    traceHtml += `<div class="repl-trace-step">${escapeHtml(step)}</div>`;
                }
                traceHtml += '</div>';
                output.innerHTML += traceHtml;
            }
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
    if (mode === 'abacus' && !abacusState.rendered) renderAbacusCalculator();
    if (mode === 'sliderule' && !slideruleState.rendered) renderSlideRuleCalculator();

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
    const challengeContent = document.getElementById('sidebarChallengeContent');
    const historyContent = document.getElementById('sidebarHistoryContent');
    const tabChallenge = document.getElementById('sidebarTabChallenge');
    const tabHistory = document.getElementById('sidebarTabHistory');

    if (tab === 'history') {
        if (challengeContent) challengeContent.style.display = 'none';
        if (historyContent) historyContent.style.display = 'block';
        if (tabChallenge) tabChallenge.classList.remove('active');
        if (tabHistory) tabHistory.classList.add('active');
        if (typeof historyRefresh === 'function') {
            const area = document.getElementById('historyContent');
            if (area && !area.innerHTML.trim()) historyRefresh();
        }
    } else {
        if (challengeContent) challengeContent.style.display = 'block';
        if (historyContent) historyContent.style.display = 'none';
        if (tabChallenge) tabChallenge.classList.add('active');
        if (tabHistory) tabHistory.classList.remove('active');
    }
}

function replKeydown(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        replExecute();
    }
}

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
    const typeNames = ['NULL', 'Inform', 'Outform', 'Abstract'];
    const clistStart = allocSize - clistCount;
    const freespace = allocSize - clistCount;

    let listing = `Namespace entry "${name}" created via Navana.Add:\n\n`;
    listing += `  NS Index:     ${r.nsIndex}\n`;
    listing += `  Version:      ${r.version}\n`;
    listing += `  GT Type:      ${typeNames[gtType] || 'Unknown'}\n`;
    listing += `  Location:     0x${location.toString(16)}\n`;
    listing += `  Limit:        ${limit}\n`;
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
        return `<div class="intro-tip intro-next-step"><strong>Step 1:</strong> Click the <strong>Compile</strong> button below the code editor to translate the program into machine instructions.</div>`;
    }

    if (d === 0) {
        return `<div class="intro-tip intro-next-step"><strong>Next step:</strong> You have compiled code -- now click <strong>Draft</strong> to see how the program maps to memory. You will see the lump layout: code region, capability list, and free space.</div>`;
    }

    if (a === 0) {
        return `<div class="intro-tip intro-next-step"><strong>Next step:</strong> Click <strong>Boot</strong> in the top-left first (the machine needs to start), then click <strong>Create Abstraction</strong> to load your program into the Church Machine's namespace as a real abstraction with its own security entry.</div>`;
    }

    if (langs.length <= 1) {
        const suggest = lang === 'symbolic' ? 'JavaScript' : (lang === 'javascript' ? 'Haskell' : (lang === 'haskell' ? 'Symbolic Math (Ada)' : 'JavaScript'));
        return `<div class="intro-tip intro-next-step"><strong>Challenge:</strong> You have compiled, drafted, and created an abstraction! Try switching to <strong>${suggest}</strong> in the language dropdown -- the same 20 machine instructions work for every language.</div>`;
    }

    if (c < 5) {
        return `<div class="intro-tip intro-next-step"><strong>Keep going:</strong> You have used ${langs.length} languages so far. Try editing the code -- change a variable or add a new operation, then <strong>Compile</strong> again to see how the machine code changes.</div>`;
    }

    if (lang === 'symbolic') {
        return `<div class="intro-tip intro-next-step"><strong>Explore:</strong> Try the <strong>Interactive Math</strong> tab to experiment with expressions interactively, then click <strong>Compile Session</strong> to turn your experiments into a program. Or visit the <strong>Tutorial</strong> tab for a guided walkthrough.</div>`;
    }

    return `<div class="intro-tip intro-next-step"><strong>Explore:</strong> Open the <strong>Tutorial</strong> tab for a guided discovery path, try the <strong>Interactive Math</strong> for interactive experiments, or view your progress in the <strong>Settings</strong> (gear icon below).</div>`;
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
RETURN CR0          ; Return result</div>
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

function getStudentSettings() {
    try {
        const raw = localStorage.getItem('church_student_settings');
        if (raw) {
            const s = JSON.parse(raw);
            if (!s.familyMembers) s.familyMembers = [];
            return s;
        }
    } catch (e) {}
    return { name: '', school: '', grade: '', familyMembers: [] };
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

function openSettings() {
    const settings = getStudentSettings();
    document.getElementById('settingName').value = settings.name || '';
    document.getElementById('settingSchool').value = settings.school || '';
    document.getElementById('settingGrade').value = settings.grade || '';
    renderFamilyMembers(settings.familyMembers || []);
    renderProgressReport();
    document.getElementById('settingsModal').style.display = 'flex';
}

function closeSettings() {
    document.getElementById('settingsModal').style.display = 'none';
}

function saveSettings() {
    const settings = {
        name: document.getElementById('settingName').value.trim(),
        school: document.getElementById('settingSchool').value.trim(),
        grade: document.getElementById('settingGrade').value,
        familyMembers: collectFamilyMembers()
    };
    localStorage.setItem('church_student_settings', JSON.stringify(settings));
    closeSettings();
}

function onGradeChange() {
    renderProgressReport();
}

const familyRoles = ['Parent', 'Parent', 'Child', 'Child', 'Child', 'Child', 'Child', 'Child'];

function renderFamilyMembers(members) {
    const container = document.getElementById('familyMembersList');
    if (!container) return;
    container.innerHTML = '';
    if (!members || members.length === 0) {
        addFamilyMemberRow('Parent', '');
        addFamilyMemberRow('Child', '');
        return;
    }
    members.forEach(m => addFamilyMemberRow(m.role || 'Child', m.name || ''));
}

function addFamilyMemberRow(role, name) {
    const container = document.getElementById('familyMembersList');
    if (!container) return;
    const count = container.children.length;
    if (count >= 8) return;
    const defaultRole = count < 2 ? (count === 0 ? 'Parent' : 'Child') : 'Child';
    const r = role || defaultRole;
    const n = name || '';
    const row = document.createElement('div');
    row.className = 'family-member-row';
    row.innerHTML =
        `<select class="modal-input family-role-select" style="width:100px;flex:none;">` +
        `<option value="Parent"${r === 'Parent' ? ' selected' : ''}>Parent</option>` +
        `<option value="Child"${r === 'Child' ? ' selected' : ''}>Child</option>` +
        `<option value="Guardian"${r === 'Guardian' ? ' selected' : ''}>Guardian</option>` +
        `<option value="Teacher"${r === 'Teacher' ? ' selected' : ''}>Teacher</option>` +
        `</select>` +
        `<input type="text" class="modal-input family-name-input" placeholder="Name" value="${escapeHtml(n)}">` +
        `<button class="btn-remove-member" onclick="this.parentElement.remove()" title="Remove">&times;</button>`;
    container.appendChild(row);
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
    const settings = getStudentSettings();
    const hasFamily = settings.familyMembers && settings.familyMembers.length > 0 &&
        settings.familyMembers.some(m => m.name && m.name.trim() !== '');
    if (!hasFamily) return true;
    return !localStorage.getItem('church_welcome_dismissed');
}

function showWelcomePopup() {
    if (!isWelcomeNeeded()) return;

    const body = document.getElementById('welcomeBody');
    if (!body) return;

    body.innerHTML =
        `<div style="background:rgba(218,165,32,0.06);border:1px solid rgba(218,165,32,0.2);border-radius:8px;padding:0.6rem 1rem;margin-bottom:0.75rem;font-size:0.88rem;line-height:1.55;">` +
        `<strong style="color:var(--church-gold);">Did you know?</strong> Cybercrime is now the world's third biggest economy &mdash; ` +
        `behind only the USA and China. If it were a country, it would be richer than Japan, Germany, and the UK combined. ` +
        `<a href="https://sipantic.blogspot.com/2025/11/the-cybercrime-tsunami.html" target="_blank" rel="noopener" style="color:var(--church-gold);">Read more</a></div>` +

        `<p style="font-size:0.88rem;line-height:1.55;margin-bottom:0.75rem;">` +
        `The Church Machine implements the <strong>Lambda Calculus</strong>: a universal model of computation that provides ` +
        `a rigorous mathematical foundation for designing secure and provably correct software and hardware, ` +
        `offering an alternative to the problematic von Neumann model.</p>` +

        `<div style="font-weight:700;color:var(--church-gold);font-size:1.05rem;margin-bottom:0.5rem;">Why does security matter?</div>` +

        `<p style="font-size:0.9rem;line-height:1.65;margin-bottom:0.75rem;">` +
        `Every computer your child uses &mdash; phones, tablets, laptops &mdash; runs software that can be tricked. ` +
        `Programs pretend to be other programs. Apps ask for permissions they should not have. ` +
        `A child clicks one wrong link and strangers can see their data. ` +
        `This is not a new problem. It is <em>the</em> problem of computing, and it was solved in 1936.</p>` +

        `<div style="background:rgba(218,165,32,0.08);border:1px solid rgba(218,165,32,0.25);border-radius:8px;padding:0.75rem 1rem;margin-bottom:0.75rem;">` +
        `<div style="font-weight:700;color:var(--church-gold);margin-bottom:0.4rem;">How Alonzo Church solved it</div>` +
        `<p style="font-size:0.85rem;line-height:1.55;margin:0 0 0.5rem 0;">` +
        `In 1936, mathematician <strong>Alonzo Church</strong> invented the lambda calculus &mdash; a way of computing where ` +
        `you can only use something if someone explicitly gives it to you. No sneaking, no stealing, no tricks. ` +
        `If you do not hold the key, the door does not open.</p>` +
        `<p style="font-size:0.85rem;line-height:1.55;margin:0;">` +
        `The Church Machine is built on this idea. Every action requires a <strong>Golden Token</strong> &mdash; ` +
        `an unforgeable digital key. Your child cannot send a message, share a file, or connect with anyone ` +
        `unless they hold the right token. And <em>you</em> control which tokens they hold.</p>` +
        `</div>` +

        `<div style="background:rgba(100,200,100,0.06);border:1px solid rgba(100,200,100,0.2);border-radius:8px;padding:0.75rem 1rem;margin-bottom:0.75rem;">` +
        `<div style="font-weight:700;color:var(--church-green);margin-bottom:0.4rem;">Hello Mum &mdash; the first safe message</div>` +
        `<p style="font-size:0.85rem;line-height:1.55;margin:0 0 0.5rem 0;">` +
        `When you register your family, the Church Machine creates a secure link between parent and child. ` +
        `Your child can then write their first program: <strong>Hello(Mum)</strong> &mdash; ` +
        `a message that travels through the Family security block, verified by Golden Tokens at every step.</p>` +
        `<p style="font-size:0.85rem;line-height:1.55;margin:0;">` +
        `No one else can send that message. No one else can intercept it. It works because Mum is not just a name &mdash; ` +
        `she is a <strong>Golden Token</strong>, alive, in charge, unforgeable and unique. That is what Church's mathematics gives us: ` +
        `a computer where "Hello Mum" (unlike Hello World from 1972) actually means something safe.</p>` +
        `</div>` +

        `<div style="font-weight:600;margin-bottom:0.5rem;">Getting started:</div>` +

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
        `<div class="welcome-step-text"><strong>Explore.</strong> The Code tab has four programming languages. The Tutorial tab has guided lessons (more coming soon). There is no wrong way to learn.</div>` +
        `</div>`;

    document.getElementById('welcomeModal').style.display = 'flex';

    const welcomeBody = body;
    const arrow = document.getElementById('welcomeScrollArrow');
    if (welcomeBody && arrow) {
        const checkScroll = () => {
            const gap = welcomeBody.scrollHeight - welcomeBody.scrollTop - welcomeBody.clientHeight;
            if (gap > 30) arrow.classList.remove('hidden');
            else arrow.classList.add('hidden');
        };
        checkScroll();
        welcomeBody._scrollHandler = checkScroll;
        welcomeBody.addEventListener('scroll', checkScroll);
    }
}

function closeWelcome() {
    localStorage.setItem('church_welcome_dismissed', '1');
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
    showMathGuidePopup();
}

function welcomeSkip() {
    closeWelcome();
    showMathGuidePopup();
}

function renderProgressReport() {
    const el = document.getElementById('progressReport');
    if (!el) return;
    const progress = getStudentProgress();
    const settings = getStudentSettings();
    const grade = document.getElementById('settingGrade').value || settings.grade;
    const name = document.getElementById('settingName').value.trim() || settings.name || 'Student';

    const gradeLabel = getGradeLabel(grade);
    let html = '';
    html += `<div class="progress-stat"><span class="progress-stat-label">Student</span><span class="progress-stat-value">${escapeHtml(name)}</span></div>`;
    if (gradeLabel) {
        html += `<div class="progress-stat"><span class="progress-stat-label">Level</span><span class="progress-stat-value">${gradeLabel}</span></div>`;
    }
    html += `<div class="progress-stat"><span class="progress-stat-label">Programs Compiled</span><span class="progress-stat-value">${progress.compilations}</span></div>`;
    html += `<div class="progress-stat"><span class="progress-stat-label">Abstractions Created</span><span class="progress-stat-value">${progress.abstractions}</span></div>`;
    html += `<div class="progress-stat"><span class="progress-stat-label">Drafts Viewed</span><span class="progress-stat-value">${progress.drafts}</span></div>`;
    html += `<div class="progress-stat"><span class="progress-stat-label">Interactive Math Sessions</span><span class="progress-stat-value">${progress.replSessions}</span></div>`;

    if (progress.langsUsed.length > 0) {
        const langNames = { english: 'English', symbolic: 'Symbolic Math', javascript: 'JavaScript', haskell: 'Haskell', assembly: 'Assembly' };
        html += `<div style="margin-top:0.5rem;"><span class="progress-stat-label">Languages Used</span></div>`;
        html += `<div class="progress-langs">`;
        for (const l of progress.langsUsed) {
            html += `<span class="progress-lang-badge">${langNames[l] || l}</span>`;
        }
        html += `</div>`;
    }

    if (progress.history.length > 0) {
        html += `<div style="margin-top:0.75rem;"><span class="progress-stat-label">Recent Activity</span></div>`;
        html += `<div class="progress-history">`;
        for (const h of progress.history.slice(0, 20)) {
            html += `<div class="progress-history-entry">${escapeHtml(h)}</div>`;
        }
        html += `</div>`;
    }

    el.innerHTML = html;
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
CALL CR0            ; domain crossing via E-GT</div>
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
        permObj = { R: sp.R?1:0, W: sp.W?1:0, X: sp.X?1:0, L: sp.L?1:0, S: sp.S?1:0, E: sp.E?1:0 };
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
        con.textContent += `To upload to Tang Nano 20K, use the Deploy button or WebSerial.\n`;
    }
}

async function uploadToTang() {
    const con = document.getElementById('editorConsole');
    if (!con) return;

    if (typeof PicoSerial === 'undefined') {
        con.textContent = 'Error: WebSerial module not loaded (webserial.js missing)';
        return;
    }

    if (!PicoSerial.isSupported()) {
        con.textContent = 'WebSerial is not supported in this browser.\nUse Chrome or Edge to upload to Tang Nano 20K.';
        return;
    }

    try {
        const image = sim.exportHardwareImage();
        con.textContent = `Ready: ${image.namespace.length} NS words + ${image.clist.length} C-list words\n\n`;

        if (!PicoSerial.isConnected()) {
            con.textContent += 'Select the FPGA UART port when prompted...\n';
            con.textContent += '(Choose the Tang Nano 20K serial port)\n\n';
            try {
                await PicoSerial.connect();
            } catch(e) {
                if (e.name === 'NotFoundError') {
                    con.textContent += 'No port selected. Cancelled.\n';
                    return;
                }
                con.textContent += 'Could not open port: ' + e.message + '\n\n';
                con.textContent += 'TROUBLESHOOTING:\n';
                con.textContent += '1. Check that the Tang Nano 20K is connected via USB\n';
                con.textContent += '2. Close any serial monitor that might have the port open\n';
                con.textContent += '3. Try again\n';
                return;
            }
        }

        con.textContent += 'Port connected. Sending data...\n';

        const result = await PicoSerial.uploadToFPGA(
            image.namespace,
            image.clist,
            function(msg) {
                con.textContent += msg + '\n';
            }
        );

        if (result.success) {
            con.textContent += '\nUpload successful! Tang Nano 20K booted with simulator data.\n';
        } else {
            con.textContent += '\nData sent but no boot banner received.\n';
            con.textContent += 'The FPGA may have already booted past the upload window.\n\n';
            con.textContent += 'To retry:\n';
            con.textContent += '  1. Press the reset button on the Tang Nano 20K\n';
            con.textContent += '  2. Immediately click "Deploy to Tang" again\n';
        }
    } catch(e) {
        con.textContent += 'Error: ' + e.message + '\n';
    }
}

const INSTRUCTION_DATA = [
    {
        opcode: 0, mnemonic: 'LOAD', domain: 'church',
        syntax: 'LOAD CRd, CRs, imm',
        brief: 'Load a Golden Token from the namespace into a context register',
        encoding: 'opcode[5]=00000 | cond[4] | CRd[4] | CRs[4] | slot[15]',
        fields: [
            { name: 'CRd', desc: 'Destination context register (CR0-CR15)' },
            { name: 'CRs', desc: 'Source C-List GT (must have L permission)' },
            { name: 'imm', desc: 'Namespace slot index (0-32767)' },
        ],
        permission: 'L (Load) on CRs',
        flags: 'None',
        details: 'Reads a GT from the namespace at the given slot index. The source register must hold a GT with L permission. The loaded GT is written to CRd after version and seal validation via mLoad.',
        example: 'LOAD CR0, CR6, 7    ; Load slot 7 into CR0 via C-List CR6',
    },
    {
        opcode: 1, mnemonic: 'SAVE', domain: 'church',
        syntax: 'SAVE CRd, CRs, imm',
        brief: 'Save a Golden Token into a C-List (capability list)',
        encoding: 'opcode[5]=00001 | cond[4] | CRd[4] | CRs[4] | slot[15]',
        fields: [
            { name: 'CRd', desc: 'Source context register containing GT to save' },
            { name: 'CRs', desc: 'C-List GT \u2014 the capability list to save into (must have S permission)' },
            { name: 'imm', desc: 'Slot index within the C-List (0-32767)' },
        ],
        permission: 'S (Save) on CRs; B=1 required on source GT',
        flags: 'None',
        details: 'Saves the GT from CRd into the C-List pointed to by CRs, at the specified slot index. A C-List (capability list) is a namespace entry that holds other GTs \u2014 it is the fundamental mechanism for storing and sharing capabilities. The target C-List GT must have S (Save) permission, and the source GT must have its B (Bind) bit set to 1. This prevents unauthorized capability propagation \u2014 you cannot save a GT you have not explicitly been allowed to share.',
        example: 'SAVE CR1, CR6, 20   ; Save CR1 into slot 20 of C-List CR6',
    },
    {
        opcode: 2, mnemonic: 'CALL', domain: 'church',
        syntax: 'CALL CRd',
        brief: 'Enter an abstraction \u2014 save context, auto-clear B on all passed GTs',
        encoding: 'opcode[5]=00010 | cond[4] | CRd[4] | 0[4] | 0[15]',
        fields: [
            { name: 'CRd', desc: 'Target GT (must have E permission)' },
        ],
        permission: 'E (Enter/Execute) on CRd',
        flags: 'None',
        details: 'Enters a namespace abstraction. The target GT must be an Inform E-GT. mLoad validates version, seal, and E permission. CALL then parses word1 to extract clistCount. If clistCount > 0, the lump is split: CR7 (code) gets location=base, limit=clistStart-1, X-only permissions; CR6 (c-list) gets location=base+clistStart, limit=clistCount-1, L-only permissions; where clistStart = (limit+1) - clistCount. The current PC, CRs, DRs, and flags are pushed onto the call stack. CALL automatically clears the B (Bind) bit on all preserved context registers passed to the callee \u2014 "use it, don\'t keep it" is the hardware default. To allow the callee to save a GT (delegation), the caller must explicitly set B=1 via TPERM before the CALL. PC is set to 0. RETURN is the only way to exit.',
        example: 'CALL CR3             ; Enter abstraction \u2014 split lump into CR7 (code, X) + CR6 (c-list, L)\n                     ; Callee gets GTs with B=0 \u2014 cannot SAVE them',
    },
    {
        opcode: 3, mnemonic: 'RETURN', domain: 'church',
        syntax: 'RETURN CRd',
        brief: 'Exit an abstraction \u2014 restore caller context',
        encoding: 'opcode[5]=00011 | cond[4] | CRd[4] | 0[4] | 0[15]',
        fields: [
            { name: 'CRd', desc: 'Return register (conventionally CR0)' },
        ],
        permission: 'None',
        flags: 'None',
        details: 'Pops the call stack and restores the caller\'s context (PC, CRs, DRs, flags). Shared between Church and Turing domains \u2014 it is the only exit from a safe Turing abstraction. If the call stack is empty, the machine halts.',
        example: 'RETURN CR0           ; Exit abstraction, restore caller',
    },
    {
        opcode: 4, mnemonic: 'CHANGE', domain: 'church',
        syntax: 'CHANGE CRd, imm',
        brief: 'Suspend/activate thread \u2014 save and load all machine registers',
        encoding: 'opcode[5]=00100 | cond[4] | CRd[4] | 0[4] | idx[15]',
        fields: [
            { name: 'CRd', desc: 'Thread GT \u2014 identifies the thread to change to' },
            { name: 'imm', desc: 'Thread control flags' },
        ],
        permission: 'Thread GT must be valid',
        flags: 'None',
        details: 'The thread suspend/activate instruction. CHANGE saves the entire machine register set of the current thread (all CRs, DRs, PC, flags) and then loads the complete register set of the target thread. This is the fundamental context-switch mechanism \u2014 one atomic instruction that suspends the running thread and activates another. All register state is preserved so the suspended thread can resume exactly where it left off.',
        example: 'CHANGE CR8, 0        ; Suspend current thread, activate thread in CR8',
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
        details: 'Switches the active namespace by reloading CR15 (the namespace root register) with a new namespace. CR15 is the machine\'s view of the entire capability world \u2014 all LOADs, SAVEs, and CALLs resolve through it. SWITCH atomically replaces that root, giving the current thread an entirely different set of visible capabilities. This is the mechanism for domain isolation, sandboxing, and controlled namespace transitions.',
        example: 'SWITCH CR3, 0        ; Switch namespace root (CR15) to namespace in CR3',
    },
    {
        opcode: 6, mnemonic: 'TPERM', domain: 'church',
        syntax: 'TPERM CRd, preset',
        brief: 'Attenuate permissions \u2014 remove bits from a GT',
        encoding: 'opcode[5]=00110 | cond[4] | CRd[4] | 0[4] | mask[15]',
        fields: [
            { name: 'CRd', desc: 'Context register holding the GT to attenuate' },
            { name: 'preset', desc: 'Permission mask \u2014 bits to keep (R, W, X, L, S, E, B combinations)' },
        ],
        permission: 'None \u2014 operates on cached register only',
        flags: 'Z=1 if resulting permissions are non-zero, N=!Z',
        details: 'Attenuates (reduces) the permission bits on the GT in CRd by ANDing with the given mask. Permissions can only be removed, never added \u2014 monotonic security. The attenuation is local to the cached context register and signals the M (modified) bit, just like any CR modification. The namespace slot is NOT updated until a legitimate SAVE commits the attenuated GT back to a c-list. Since CALL auto-clears B on all passed GTs, TPERM is also used for the special case of ALLOWING bind \u2014 explicitly setting B=1 before a CALL to delegate a capability the callee may keep.',
        example: '; Example 1: Strip write \u2014 hand off read-only\nTPERM CR0, RX        ; Keep only R+X, strip W,L,S,E\nCALL CR2             ; Callee can read+execute but not write\n\n; Example 2: ALLOW BIND \u2014 delegate a GT the callee may keep\nLOAD CR1, CR6, 3     ; Load GT from c-list slot 3\nTPERM CR1, RWXB      ; Keep R+W+X and SET B (Bind)\nCALL CR2             ; Callee receives CR1 with B=1\n                     ; Callee CAN save this GT (delegation)',
    },
    {
        opcode: 7, mnemonic: 'LAMBDA', domain: 'church',
        syntax: 'LAMBDA CRd',
        brief: 'Apply a lambda reduction in-scope (no context save)',
        encoding: 'opcode[5]=00111 | cond[4] | CRd[4] | 0[4] | 0[15]',
        fields: [
            { name: 'CRd', desc: 'Target GT (must have X permission)' },
        ],
        permission: 'X (Execute in-scope) on CRd',
        flags: 'None',
        details: 'Lightweight function application \u2014 applies a Church reduction without saving/restoring context (unlike CALL). The target GT must have X permission. Used for fast-path lambda calculus operations like SUCC, ADD, etc.',
        example: 'LAMBDA CR0           ; Apply reduction via CR0',
    },
    {
        opcode: 8, mnemonic: 'ELOADCALL', domain: 'church',
        syntax: 'ELOADCALL CRd, CRs, imm',
        brief: 'Fused LOAD + TPERM(E) + CALL in one instruction',
        encoding: 'opcode[5]=01000 | cond[4] | CRd[4] | CRs[4] | slot[15]',
        fields: [
            { name: 'CRd', desc: 'Destination for loaded GT' },
            { name: 'CRs', desc: 'C-List GT (must have L permission)' },
            { name: 'imm', desc: 'Namespace slot index' },
        ],
        permission: 'L on CRs, then E on loaded GT',
        flags: 'None',
        details: 'Fused instruction that performs LOAD, verifies E permission, and enters the abstraction \u2014 all in one cycle. Reduces the 3-instruction sequence (LOAD + TPERM + CALL) to a single instruction for common abstraction entry patterns.',
        example: 'ELOADCALL CR0, CR6, 12  ; Load slot 12, verify E, enter',
    },
    {
        opcode: 9, mnemonic: 'XLOADLAMBDA', domain: 'church',
        syntax: 'XLOADLAMBDA CRd, CRs, imm',
        brief: 'Fused LOAD + TPERM(X) + LAMBDA in one instruction',
        encoding: 'opcode[5]=01001 | cond[4] | CRd[4] | CRs[4] | slot[15]',
        fields: [
            { name: 'CRd', desc: 'Destination for loaded GT' },
            { name: 'CRs', desc: 'C-List GT (must have L permission)' },
            { name: 'imm', desc: 'Namespace slot index' },
        ],
        permission: 'L on CRs, then X on loaded GT',
        flags: 'None',
        details: 'Fused instruction that performs LOAD, verifies X permission, and applies a lambda reduction \u2014 all in one cycle. Used for fast-path Church reductions where the GT is loaded and applied in a single operation.',
        example: 'XLOADLAMBDA CR0, CR6, 7  ; Load slot 7, verify X, reduce',
    },
    {
        opcode: 10, mnemonic: 'DREAD', domain: 'turing',
        syntax: 'DREAD DRd, CRs, imm',
        brief: 'Read a data word from a GT-protected address into a data register',
        encoding: 'opcode[5]=01010 | cond[4] | DRd[4] | CRs[4] | offset[15]',
        fields: [
            { name: 'DRd', desc: 'Destination data register (DR0-DR15)' },
            { name: 'CRs', desc: 'GT pointing to data object (must have R permission)' },
            { name: 'imm', desc: 'Word offset within the data object' },
        ],
        permission: 'R (Read) on CRs',
        flags: 'None',
        details: 'Reads a 32-bit word from the address range protected by the GT in CRs, at the given offset. mLoad validates the GT (version, seal, bounds) and checks R permission. Works on any address range \u2014 memory, devices, or registers.',
        example: 'DREAD DR1, CR2, 0    ; Read word 0 from data object CR2',
    },
    {
        opcode: 11, mnemonic: 'DWRITE', domain: 'turing',
        syntax: 'DWRITE DRd, CRs, imm',
        brief: 'Write a data register value to a GT-protected address',
        encoding: 'opcode[5]=01011 | cond[4] | DRd[4] | CRs[4] | offset[15]',
        fields: [
            { name: 'DRd', desc: 'Source data register (value to write)' },
            { name: 'CRs', desc: 'GT pointing to data object (must have W permission)' },
            { name: 'imm', desc: 'Word offset within the data object' },
        ],
        permission: 'W (Write) on CRs',
        flags: 'None',
        details: 'Writes a 32-bit word from the specified DR to the address range protected by the GT in CRs. mLoad validates the GT and checks W permission. Bounds-checked against the entry limit. Works on memory, devices, or registers.',
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
        details: 'Extracts a bitfield from the first word of the data object pointed to by CRs. The extracted bits are right-aligned and zero-extended into DRd. Useful for parsing packed structures, GT fields, and device registers.',
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
        details: 'Inserts the low bits of DRd into the specified bitfield of the first word at the address protected by CRs. Other bits in the target word are preserved. Useful for modifying packed structures without full read-modify-write.',
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
        details: 'Computes DRa - DRb internally (without storing the result) and sets the ARM-style condition flags. Use with BRANCH or conditional instructions to control flow based on comparison results. C flag uses unsigned comparison semantics (C=1 if DRa \u2265 DRb unsigned).',
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
        details: 'Computes DRd = DRa + DRb as unsigned 32-bit integers and sets all four ARM-style flags. DR0 is hardwired to zero, so IADD DRd, DR0, DR0 initializes DRd to 0. C=1 if the result exceeds 32 bits. V=1 if signed overflow occurred.',
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
        details: 'Computes DRd = DRa - DRb as unsigned 32-bit integers and sets all four ARM-style flags. C flag follows ARM convention: C=1 means no borrow (DRa \u2265 DRb unsigned). ISUB DRd, DR0, DRx computes the two\'s complement negation.',
        example: 'ISUB DR4, DR3, DR1   ; DR4 = DR3 - DR1, set flags',
    },
    {
        opcode: 17, mnemonic: 'BRANCH', domain: 'turing',
        syntax: 'BRANCH[cond] offset',
        brief: 'Conditional branch with signed PC-relative offset',
        encoding: 'opcode[5]=10001 | cond[4] | 0[4] | 0[4] | signed_offset[15]',
        fields: [
            { name: 'offset', desc: 'Signed 15-bit PC-relative offset (-16384 to +16383)' },
        ],
        permission: 'None',
        flags: 'None (reads flags, does not set them)',
        details: 'Branches to PC + offset if the condition (from the condition field) is true. The offset is sign-extended from 15 bits. Typically used with a condition suffix: BRANCHEQ, BRANCHNE, BRANCHGT, etc. Bounded within the abstraction.',
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
        details: 'Shifts DRs left by shamt positions, filling vacated bits with zeros, and stores the result in DRd. C flag is set to the last bit shifted out (bit 32-shamt of the original value). Equivalent to multiplication by 2^shamt. V is always cleared.',
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
        details: 'Shifts DRs right by shamt positions. In logical mode (default), vacated high bits are filled with zeros. In arithmetic mode (ASR), vacated bits are filled with the sign bit, preserving the sign for signed division by powers of 2. C flag is the last bit shifted out (bit shamt-1). V is always cleared.',
        example: 'SHR DR2, DR1, 3      ; DR2 = DR1 >> 3 (logical)\nSHR DR3, DR1, 1, ASR ; DR3 = DR1 >>> 1 (arithmetic, sign-extending)',
    },
];

let selectedInstr = null;

function renderReference() {
    const churchList = document.getElementById('instrListChurch');
    const turingList = document.getElementById('instrListTuring');
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
        card.onclick = () => showInstructionDetail(instr.opcode);

        if (instr.domain === 'church') {
            churchList.appendChild(card);
        } else {
            turingList.appendChild(card);
        }
    });

    const returnCard = document.createElement('div');
    returnCard.className = 'instr-card instr-shared' + (selectedInstr === 3 ? ' active' : '');
    returnCard.innerHTML = `
        <span class="instr-opcode">3</span>
        <span class="instr-mnemonic">RETURN</span>
        <span class="instr-brief">Shared \u2014 exit from Turing abstraction</span>
    `;
    returnCard.onclick = () => showInstructionDetail(3);
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
            <div class="instr-detail-text">${instr.details}</div>
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
                { syntax: "Read from <em>CR7</em> at offset <em>0</em>", desc: "Read memory" },
                { syntax: "Write <em>value</em> to <em>CR7</em> at offset <em>0</em>", desc: "Write memory" },
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
                { syntax: "<em>x</em> = read(<em>CR7</em>, <em>offset</em>)", desc: "Read from capability" },
                { syntax: "write(<em>CR7</em>, <em>offset</em>, <em>value</em>)", desc: "Write to capability" },
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
            { heading: "Church Domain (Mind)", items: [
                { syntax: "LOAD CRd, [CRs, <em>idx</em>]", desc: "Load Golden Token" },
                { syntax: "SAVE [CRd, <em>idx</em>], CRs", desc: "Save Golden Token" },
                { syntax: "CALL CRd", desc: "Enter abstraction (E perm)" },
                { syntax: "RETURN", desc: "Return from abstraction" },
                { syntax: "LAMBDA CRd, <em>offset</em>", desc: "Capture closure" },
                { syntax: "SEAL CRd, CRs", desc: "Seal token" },
                { syntax: "UNSEAL CRd, CRs", desc: "Unseal (S perm)" },
                { syntax: "REVOKE <em>idx</em>", desc: "Revoke (bump version)" },
                { syntax: "CMPSWP CRd, CRs, CRt", desc: "Atomic compare-swap" },
                { syntax: "MINT CRd, <em>perms</em>", desc: "Create token" },
            ]},
            { heading: "Turing Domain (Body)", items: [
                { syntax: "DREAD DRd, [CRs, <em>off</em>]", desc: "Read data" },
                { syntax: "DWRITE [CRd, <em>off</em>], DRs", desc: "Write data" },
                { syntax: "IADD DRd, DRs, <em>imm</em>", desc: "Integer add" },
                { syntax: "ISUB DRd, DRs, <em>imm</em>", desc: "Integer subtract" },
                { syntax: "SHL DRd, DRs, <em>imm</em>", desc: "Shift left" },
                { syntax: "SHR DRd, DRs, <em>imm</em>", desc: "Shift right" },
                { syntax: "BFEXT DRd, DRs, <em>pos</em>, <em>w</em>", desc: "Bit field extract" },
                { syntax: "BFINS DRd, DRs, <em>pos</em>, <em>w</em>", desc: "Bit field insert" },
                { syntax: "MCMP DRa, DRb", desc: "Compare, set flags" },
                { syntax: "BRANCH <em>cond</em>, <em>target</em>", desc: "Branch (AL/EQ/NE/LT/GE/GT/LE)" },
            ]},
            { heading: "Condition Codes", items: [
                { syntax: ".EQ / .NE / .LT / .GE / .GT / .LE", desc: "Suffix any instruction" },
                { syntax: "IADD.EQ DR0, DR1, 1", desc: "Conditional add (only if equal)" },
            ]},
            { heading: "Registers", items: [
                { syntax: "CR0\u2013CR7", desc: "Capability registers (Golden Tokens)" },
                { syntax: "DR0\u2013DR15", desc: "Data registers (32-bit integers)" },
                { syntax: "CR6", desc: "C-list (L-only)" },
                { syntax: "CR7", desc: "Code region (X-only)" },
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
        assembly: ['ada_note_g', 'selftest', 'load_save', 'bernoulli', 'conditional', 'gc_test', 'turing_test', 'salvation', 'perm_attack', 'bind_attack'],
        javascript: ['cloomc_hello', 'cloomc_memory', 'cloomc_counter', 'cloomc_sliderule'],
        haskell: ['cloomc_church_math', 'cloomc_church_pair', 'cloomc_church_case', 'cloomc_church_lambda', 'cloomc_sliderule_hs'],
        symbolic: ['cloomc_ada_note_g']
    };

    const scroll = document.getElementById('exampleTabsScroll');
    if (scroll) {
        const tabs = scroll.querySelectorAll('.example-tab');
        const allowedSet = langExampleGroups[lang] || [];
        tabs.forEach(tab => {
            const ex = tab.getAttribute('data-example');
            tab.style.display = allowedSet.includes(ex) ? '' : 'none';
        });
    }

    if (!restoring) {
        const defaults = {
            english: 'english_hello',
            assembly: 'selftest',
            javascript: 'hello',
            haskell: 'church_math',
            symbolic: 'ada_note_g'
        };
        const defaultExample = defaults[lang];
        if (defaultExample) {
            if (lang === 'assembly') {
                loadExample(defaultExample);
            } else {
                loadCLOOMCExample(defaultExample);
            }
        }
        if (typeof historyShowLanguageStory === 'function') historyShowLanguageStory(lang);
        const syntaxPanel = document.getElementById('codeSyntaxPanel');
        if (syntaxPanel && syntaxPanel.style.display !== 'none') renderSyntaxRef(lang);
        showIntro(lang);
    }
}

function smartCompile() {
    const sel = document.getElementById('langSelector');
    const lang = sel ? sel.value : 'assembly';
    if (lang === 'assembly') {
        assembleAndLoad();
    } else {
        compileCLOOMC();
    }
}

function compileDraft() {
    const editor = document.getElementById('asmEditor');
    if (!editor || !cloomcCompiler) return;
    const source = editor.value;
    const con = document.getElementById('editorConsole');

    const result = cloomcCompiler.compile(source, []);

    if (result.errors.length > 0) {
        const errText = result.errors.map(e => `Line ${e.line || '?'}: ${e.message}`).join('\n');
        if (con) con.textContent = `CLOOMC++ Draft — compilation errors:\n${errText}`;
        showNextSteps('error');
        return;
    }

    const langNames = { english: 'English', haskell: 'Haskell', symbolic: 'Symbolic Math (Ada)', javascript: 'JavaScript' };
    const lang = langNames[result.language] || 'JavaScript';
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
    draft += `  CLOOMC++ DRAFT — "${result.abstractionName}" [${lang}]\n`;
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
        draft += `    CR7 (code):   base=0, limit=${clistStart - 1}, perms=X-only\n`;
        draft += `    CR6 (c-list): base+${clistStart}, limit=${clistCount - 1}, perms=L-only\n`;
    } else {
        draft += `    CR7 (code):   base=0, limit=${allocSize - 1}, perms=X-only\n`;
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

    const langNames2 = { english: 'English', haskell: 'Haskell', symbolic: 'Symbolic Math (Ada)', javascript: 'JavaScript' };
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
    listing += `  Version:     ${r.version}\n`;
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
        listing += `    CR7 (code):   base=0x${r.location.toString(16)}, limit=${clistStart - 1}, perms=X-only\n`;
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

    const examples = {
        'memory': `abstraction Memory {\n    capabilities {\n    }\n    method Allocate(size) {\n        location = read(CR7, 0)\n        needed = size + 255\n        needed = needed >> 8\n        needed = needed << 8\n        write(CR7, 0, location + needed)\n        return(location, needed)\n    }\n    method Free(location) {\n        return(0)\n    }\n}`,
        'mint': `abstraction Mint {\n    capabilities {\n        Memory\n    }\n    method Create(size, perms) {\n        result = call(Memory.Allocate(size))\n        return(result)\n    }\n    method Revoke(index) {\n        return(0)\n    }\n}`,
        'hello': `abstraction Hello {\n    capabilities {\n    }\n    method Greet(who) {\n        result = who + 1\n        return(result)\n    }\n}`,
        'counter': `abstraction Counter {\n    capabilities {\n    }\n    method Increment(value) {\n        result = value + 1\n        return(result)\n    }\n    method Add(a, b) {\n        result = a + b\n        return(result)\n    }\n}`,
        'church_math': `-- Church Machine Lambda Calculus\n-- Haskell front-end proves universal target\n\nabstraction ChurchMath {\n    capabilities {\n    }\n\n    -- Church successor: n + 1\n    method successor(n) = n + 1\n\n    -- Church addition: a + b\n    method add(a, b) = a + b\n\n    -- Church multiplication\n    method multiply(a, b) = a * b\n\n    -- Predecessor: max(0, n-1)\n    method predecessor(n) = if n > 0 then n - 1 else 0\n\n    -- isZero: 1 if n==0, else 0\n    method isZero(n) = if n == 0 then 1 else 0\n}`,
        'church_pair': `-- Church Pairs — Haskell front-end\n-- Pairs pack two 16-bit values\n\nabstraction ChurchPair {\n    capabilities {\n    }\n\n    -- Construct a pair from two values\n    method makePair(a, b) = (a, b)\n\n    -- Extract first element\n    method first(p) = fst p\n\n    -- Extract second element  \n    method second(p) = snd p\n\n    -- Swap pair elements\n    method swap(p) = (snd p, fst p)\n}`,
        'church_case': `-- Church Case Expressions — Haskell front-end\n-- Pattern matching compiles to MCMP + BRANCH chains\n\nabstraction ChurchCase {\n    capabilities {\n    }\n\n    -- Factorial via case\n    method factorial(n) = case n of 0 -> 1, _ -> n * (n - 1)\n\n    -- Classify a number\n    method classify(n) = case n of 0 -> 100, 1 -> 200, _ -> n + 300\n\n    -- Absolute value\n    method abs(n) = if n < 0 then 0 - n else n\n}`,
        'church_lambda': `-- Church Lambda Expressions — Haskell front-end\n-- Lambda calculus on Church Machine hardware\n\nabstraction ChurchLambda {\n    capabilities {\n    }\n\n    -- Identity function\n    method identity(x) = x\n\n    -- Constant function (returns first arg)\n    method constant(x, y) = x\n\n    -- Apply successor twice\n    method double_succ(n) = succ (succ n)\n\n    -- Let binding example\n    method letExample(x) = let a = x + 1 in a + a\n}`,
        'sliderule': `abstraction SlideRule {\n    capabilities { Constants }\n\n    method Add(a, b) {\n        result = a + b\n        return(result)\n    }\n\n    method Sub(a, b) {\n        result = a - b\n        return(result)\n    }\n\n    method Mul(a, b) {\n        acc = 0\n        sign = 0\n        if (b < 0) {\n            b = 0 - b\n            sign = 1\n        }\n        while (b > 0) {\n            low = bfext(b, 0, 1)\n            if (low == 1) {\n                acc = acc + a\n            }\n            a = a << 1\n            b = b >> 1\n        }\n        if (sign == 1) {\n            acc = 0 - acc\n        }\n        return(acc)\n    }\n\n    method Div(a, b) {\n        if (b == 0) {\n            return(0)\n        }\n        sign = 0\n        if (a < 0) {\n            a = 0 - a\n            sign = sign + 1\n        }\n        if (b < 0) {\n            b = 0 - b\n            sign = sign + 1\n        }\n        quot = 0\n        while (a >= b) {\n            a = a - b\n            quot = quot + 1\n        }\n        if (sign == 1) {\n            quot = 0 - quot\n        }\n        return(quot)\n    }\n\n    method Sqrt(n) {\n        if (n == 0) {\n            return(0)\n        }\n        if (n == 1) {\n            return(1)\n        }\n        guess = n >> 1\n        i = 0\n        while (i < 20) {\n            q = 0\n            rem = n\n            while (rem >= guess) {\n                rem = rem - guess\n                q = q + 1\n            }\n            next = guess + q\n            next = next >> 1\n            guess = next\n            i = i + 1\n        }\n        return(guess)\n    }\n\n    method Pow(base, exp) {\n        result = 1\n        while (exp > 0) {\n            acc = 0\n            m = base\n            r = result\n            while (r > 0) {\n                low = bfext(r, 0, 1)\n                if (low == 1) {\n                    acc = acc + m\n                }\n                m = m << 1\n                r = r >> 1\n            }\n            result = acc\n            exp = exp - 1\n        }\n        return(result)\n    }\n\n    method ToDegrees(radians) {\n        return(radians)\n    }\n\n    method ToRadians(degrees) {\n        return(degrees)\n    }\n}`,
        'ada_note_g': `-- Ada Lovelace — Note G (1843)\n-- The First Computer Program\n-- Computes B7 (Bernoulli number = -1/30)\n-- Written in Symbolic Mathematics notation\n\nabstraction NoteG {\n    capabilities {\n    }\n\n    method compute() {\n        -- Initialize Ada's Store columns\n        let V1 = 1\n        let V2 = 2\n        let V3 = 4\n\n        -- Operation 1: V4 = 2n = 8\n        let V4 = V2 * V3\n        let V5 = V4\n        let V6 = V4\n\n        -- Operation 2: 2n-1 = 7\n        let V4 = V4 - V1\n\n        -- Operation 3: 2n+1 = 9\n        let V5 = V5 + V1\n\n        -- Operation 4: (2n-1)/(2n+1) — CORRECTED per Bromley (1990)\n        let V11 = V4 / V5\n\n        -- Operation 5: divide coefficient by 2\n        let V11 = V11 / V2\n\n        -- Operation 6: accumulator\n        let V13 = 0\n        let V13 = V13 - V11\n\n        -- Operation 7: loop counter = n-1 = 3\n        let V10 = V3 - V1\n\n        -- Operation 8: denominator counter\n        let V7 = V2\n\n        -- Operation 9: 2n / counter\n        let V11 = V6 / V7\n\n        -- Operation 10: B1 * coefficient\n        let V15 = 1\n        let V12 = V15 * V11\n\n        -- Operation 11: accumulate\n        let V13 = V12 + V13\n\n        -- Operation 12: decrement loop\n        let V10 = V10 - V1\n\n        -- Operations 13-23: first iteration\n        let V6 = V6 - V1\n        let V7 = V1 + V7\n        let V8 = V6 / V7\n        let V11 = V8 * V11\n        let V6 = V6 - V1\n        let V7 = V1 + V7\n        let V9 = V6 / V7\n        let V11 = V9 * V11\n        let V15 = 1\n        let V12 = V15 * V11\n        let V13 = V12 + V13\n        let V10 = V10 - V1\n\n        -- Second iteration (B5 term)\n        let V6 = V6 - V1\n        let V7 = V1 + V7\n        let V8 = V6 / V7\n        let V11 = V8 * V11\n        let V6 = V6 - V1\n        let V7 = V1 + V7\n        let V9 = V6 / V7\n        let V11 = V9 * V11\n        let V15 = 1\n        let V12 = V15 * V11\n        let V13 = V12 + V13\n        let V10 = V10 - V1\n\n        -- Operation 24: B7 = -sum\n        let V15 = 0\n        let V15 = V15 - V13\n\n        -- Operation 25: increment n\n        let V3 = V1 + V3\n\n        halt\n    }\n}`,
        'sliderule_hs': `-- SlideRule — Haskell front-end\n-- Integer arithmetic on Church Machine hardware\n-- Proves both languages compile to the same 20-instruction target\n\nabstraction SlideRuleHS {\n    capabilities { Constants }\n\n    -- Basic arithmetic\n    method Add(a, b) = a + b\n\n    method Sub(a, b) = a - b\n\n    method Mul(a, b) = a * b\n\n    -- Integer division via repeated subtraction\n    method Div(a, b) = if b == 0 then 0 else a - (a - b)\n\n    -- Integer square root approximation\n    method Sqrt(n) = if n == 0 then 0 else if n == 1 then 1 else (n + 1) - (n - 1)\n\n    -- Power of 2 (base=2 exponentiation)\n    method Pow2(exp) = if exp == 0 then 1 else 2 * exp\n\n    -- Absolute value\n    method Abs(n) = if n < 0 then 0 - n else n\n\n    -- Signum: -1, 0, or 1\n    method Signum(n) = if n == 0 then 0 else if n > 0 then 1 else 0 - 1\n\n    -- Max of two values\n    method Max(a, b) = if a > b then a else b\n\n    -- Min of two values\n    method Min(a, b) = if a < b then a else b\n\n    -- Clamp value between lo and hi\n    method Clamp(x, lo, hi) = if x < lo then lo else if x > hi then hi else x\n}`,
        'english_hello': `Create an abstraction called Hello\n\nAdd a method called Greet that takes who\nSet result to who plus 1\nReturn the result`,
        'english_counter': `Create an abstraction called Counter\n\nAdd a method called Increment that takes value\nSet result to value plus 1\nReturn the result\n\nAdd a method called Add that takes a and b\nSet result to a plus b\nReturn the result\n\nAdd a method called Double that takes x\nSet result to x plus x\nReturn the result`,
    };

    editor.value = examples[name] || examples['hello'];
    updateLineNumbers();
    saveEditorState();

    const sel = document.getElementById('langSelector');
    if (sel) {
        const isHaskell = ['church_math','church_pair','church_case','church_lambda','sliderule_hs'].includes(name);
        const isSymbolic = ['ada_note_g'].includes(name);
        const isEnglish = ['english_hello','english_counter'].includes(name);
        sel.value = isEnglish ? 'english' : isSymbolic ? 'symbolic' : isHaskell ? 'haskell' : 'javascript';
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

    const langNames3 = { english: 'English', haskell: 'Haskell', symbolic: 'Symbolic Math (Ada)', javascript: 'JavaScript' };
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
    const langNames = { english: 'English', javascript: 'JavaScript', haskell: 'Haskell', symbolic: 'Symbolic Math (Ada)', assembly: 'Assembly' };
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
    try {
        const r = await fetch('/api/github/export-simulator', { method: 'POST' });
        const data = await r.json();
        if (data.ok) {
            alert(`Exported ${data.total} files to GitHub.\n\nPushed:\n${data.pushed.join('\n')}`);
        } else {
            const msg = data.errors ? data.errors.join('\n') : (data.error || 'Unknown error');
            alert(`Export had issues:\n\nPushed: ${data.pushed ? data.pushed.length : 0}\nErrors:\n${msg}`);
        }
    } catch (e) {
        alert('Export failed: ' + e.message);
    } finally {
        if (btn) btn.textContent = 'Push to GitHub';
    }
}

let libraryCache = null;
let libraryAllItems = [];

async function showLibrary() {
    document.getElementById('libraryModal').style.display = 'flex';
    const repoLink = document.getElementById('libraryGitHubLink');
    if (repoLink) {
        repoLink.href = '/api/library/repo-url';
        try {
            const r = await fetch('/api/library/repo-url');
            if (r.ok) {
                const data = await r.json();
                if (data.url) repoLink.href = data.url;
            }
        } catch (e) {}
    }
    await loadLibraryItems();
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
    } catch (e) {
        const body = document.getElementById('docsContentBody');
        if (body) body.innerHTML = '<div class="docs-placeholder">Failed to load document list.</div>';
    }
}

function renderDocsFileList() {
    const docsList = document.getElementById('docsFileList');
    const figsList = document.getElementById('docsFigureList');
    if (!docsList || !figsList || !docsData) return;

    docsList.innerHTML = docsData.docs.map(d => {
        const sizeKB = (d.size / 1024).toFixed(1);
        const label = d.name.replace('.md', '');
        return `<div class="docs-file-item" onclick="loadDoc('${d.name}')" data-doc="${d.name}"><span>${label}</span><span class="file-size">${sizeKB} KB</span></div>`;
    }).join('');

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

    try {
        const resp = await fetch('/api/docs/read/' + filename);
        const data = await resp.json();
        if (body) body.innerHTML = renderMarkdown(data.content);
    } catch (e) {
        if (body) body.innerHTML = '<div class="docs-placeholder">Failed to load document.</div>';
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

    const steps = {
        'compiled': `
            <div class="next-steps-label">Next Steps</div>
            <ul>
                <li><strong>Name this abstract idea</strong> — does the abstraction name describe what it does?</li>
                <li><strong>What functions does it perform?</strong> — look at the methods. Each one is a capability you are giving to the world.</li>
                <li><strong>Step through it</strong> — click <strong>Step</strong> to watch each instruction execute one at a time.</li>
                <li><strong>Create Abstraction</strong> — when you are ready, click the green button to give your idea a Body in the Church Machine.</li>
            </ul>`,
        'assembled': `
            <div class="next-steps-label">Next Steps</div>
            <ul>
                <li><strong>Step through it</strong> — click <strong>Step</strong> to execute one instruction at a time and watch the registers change.</li>
                <li><strong>Run it</strong> — click <strong>Run</strong> to execute all instructions until halt or fault.</li>
                <li><strong>Save to NS</strong> — save the assembled program to a namespace slot.</li>
                <li><strong>Try a different example</strong> — click the tabs above to explore more programs.</li>
            </ul>`,
        'created': `
            <div class="next-steps-label">Next Steps</div>
            <ul>
                <li><strong>Check the Namespace</strong> — click the <strong>Namespace</strong> tab to see your new abstraction's entry.</li>
                <li><strong>Inspect it</strong> — click <strong>Abstractions</strong> to see the lump layout, c-list, and Golden Token.</li>
                <li><strong>Call it</strong> — write another abstraction that holds a capability to yours, then CALL it.</li>
                <li><strong>Build something bigger</strong> — every abstraction you create can be used by the next one.</li>
            </ul>`,
        'error': `
            <div class="next-steps-label">Next Steps</div>
            <ul>
                <li><strong>Read the error</strong> — the line number tells you where to look.</li>
                <li><strong>Check your syntax</strong> — does every <code>{</code> have a matching <code>}</code>?</li>
                <li><strong>Try an example</strong> — click an example tab above to see working code you can modify.</li>
            </ul>`,
        'draft': `
            <div class="next-steps-label">Next Steps</div>
            <ul>
                <li><strong>Review the methods</strong> — are these the functions your abstraction needs?</li>
                <li><strong>Check capabilities</strong> — does your abstraction need access to other abstractions?</li>
                <li><strong>Look at the lump layout</strong> — code region (CR7) + capability list (CR6). Is the size right?</li>
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

document.addEventListener('DOMContentLoaded', init);
