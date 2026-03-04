let sim = null;
let assembler = null;
let pipelineViz = null;
let repl = null;
let churchTutorial = null;
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

    abstractionRegistry = new AbstractionRegistry();
    systemAbstractions = new SystemAbstractions(abstractionRegistry);
    deviceAbstractions = new DeviceAbstractions(abstractionRegistry);
    sim.initAbstractions(abstractionRegistry, systemAbstractions, deviceAbstractions);

    if (typeof CLOOMCCompiler !== 'undefined') {
        cloomcCompiler = new CLOOMCCompiler();
    }

    window.churchTutorial = churchTutorial;

    sim.on('stateChange', () => updateDashboard());
    sim.on('fault', (f) => appendOutput(`FAULT [${f.type}]: ${f.message}`, 'error'));
    sim.on('halt', () => appendOutput('Machine halted.', 'info'));

    loadEditorState();
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
    const views = ['dashboard','editor','namespace','abstractions','pipeline','tutorial','repl','reference'];
    const hash = window.location.hash.replace('#', '');
    const startView = views.includes(hash) ? hash : 'dashboard';
    switchView(startView);
    updateDashboard();
    pipelineViz.render();
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
    if (viewId === 'tutorial') churchTutorial.render('tutorialView');
    if (viewId === 'reference') renderReference();
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
        <button class="btn btn-warning btn-sm" onclick="resetSim()">Reset</button>
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
        return;
    }

    sim.loadProgram(result.words, 0);
    lastAssembledWords = result.words.slice();

    let listing = `Assembled ${result.words.length} instructions:\n`;
    for (let i = 0; i < result.words.length; i++) {
        listing += `  ${i.toString().padStart(4)}: 0x${result.words[i].toString(16).padStart(8, '0')}  ${assembler.disassemble(result.words[i])}\n`;
    }
    if (con) con.textContent = listing;

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

function resetSim() {
    sim.reset();
    const con = document.getElementById('editorConsole');
    if (con) con.textContent = 'Machine reset.';
    pipelineViz.reset();
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

function appendOutput(text, type) {
    const editorConsole = document.getElementById('editorConsole');
    if (editorConsole) {
        editorConsole.textContent += '\n' + text;
        editorConsole.scrollTop = editorConsole.scrollHeight;
    }
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function saveEditorState() {
    const editor = document.getElementById('asmEditor');
    if (editor) {
        localStorage.setItem('church_editor_code', editor.value);
    }
}

function loadEditorState() {
    const editor = document.getElementById('asmEditor');
    if (editor) {
        const saved = localStorage.getItem('church_editor_code');
        if (saved) {
            editor.value = saved;
        } else {
            editor.value = `; Pure Church Machine \u2014 Assembly Editor
; 10 opcodes: LOAD, SAVE, CALL, RETURN, CHANGE, SWITCH, TPERM, LAMBDA, ELOADCALL, XLOADLAMBDA
; All instructions support ARM-style condition suffixes
;
; Load an abstraction and verify its permissions
LOAD CR0, CR6, 4       ; Load SUCC (Church numeral, DATA-domain code object)
TPERM CR0, XL          ; Verify X+L permissions
LAMBDA CR0             ; Apply via LAMBDA instruction
RETURN CR0             ; Return result
`;
        }
    }
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
        details: 'Enters a namespace abstraction. The target GT must have E permission. The current PC, CRs, DRs, and flags are pushed onto the call stack. CALL automatically clears the B (Bind) bit on all preserved context registers passed to the callee. This means the callee can USE any GT it receives but cannot SAVE it to a c-list \u2014 "use it, don\'t keep it" is the hardware default. To allow the callee to save a GT (delegation), the caller must explicitly set B=1 via TPERM before the CALL. RETURN is the only way to exit.',
        example: 'CALL CR3             ; Enter abstraction \u2014 callee gets GTs with B=0\n                     ; Callee can use them but cannot SAVE them',
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
        return;
    }

    let listing = `CLOOMC++ compiled "${result.abstractionName}" — ${result.methods.length} method(s):\n\n`;
    for (const m of result.methods) {
        listing += `  method ${m.name}: ${m.code.length} instruction(s)\n`;
        for (let i = 0; i < m.code.length; i++) {
            const word = m.code[i];
            listing += `    ${i.toString().padStart(4)}: 0x${word.toString(16).padStart(8, '0')}  ${assembler.disassemble(word)}\n`;
        }
        listing += '\n';
    }

    if (result.manifest && result.manifest.length > 0) {
        listing += 'Compilation manifest:\n';
        for (const entry of result.manifest) {
            for (const m of entry.mapping || []) {
                listing += `  src:${m.src} -> addr:${m.addr} ${m.desc}\n`;
            }
        }
    }

    if (con) con.textContent = listing;
    appendOutput(`CLOOMC++ compiled "${result.abstractionName}" — ${result.methods.length} methods`, 'info');
}

function compileAndCreateAbstraction() {
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

    if (!sim.bootComplete) {
        if (con) con.textContent = 'Boot not complete — run boot sequence first.';
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

    const upload = {
        abstraction: result.abstractionName || 'UserAbstraction',
        type: 'abstraction',
        grants: ['E'],
        capabilities: uploadCaps,
        methods: result.methods
    };

    const addResult = abstractionRegistry.dispatchMethod(5, 'Abstraction.Add', sim, { upload: upload });

    if (!addResult || !addResult.ok) {
        if (con) con.textContent = `Abstraction creation failed: ${addResult ? addResult.message : 'unknown error'}`;
        return;
    }

    let listing = `Abstraction "${upload.abstraction}" created via Navana.Abstraction.Add:\n`;
    listing += `  NS Index: ${addResult.result.nsIndex}\n`;
    listing += `  Version: ${addResult.result.version}\n`;
    listing += `  Location: 0x${addResult.result.location.toString(16)}\n`;
    listing += `  Alloc Size: ${addResult.result.allocSize}\n`;
    listing += `  Code Size: ${addResult.result.codeSize}\n`;
    listing += `  C-List Count: ${addResult.result.clistCount}\n`;
    listing += `  Methods: ${addResult.result.methods.join(', ')}\n`;
    listing += `  E-GT: 0x${addResult.result.eGT.toString(16).padStart(8, '0')}\n`;

    if (con) con.textContent = listing;
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
    };

    editor.value = examples[name] || examples['hello'];
    updateLineNumbers();
    saveEditorState();
}

document.addEventListener('DOMContentLoaded', init);
