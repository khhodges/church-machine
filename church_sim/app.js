let sim = null;
let assembler = null;
let pipelineViz = null;
let repl = null;
let churchTutorial = null;
let currentView = 'dashboard';

function init() {
    sim = new ChurchSimulator();
    assembler = new ChurchAssembler();
    pipelineViz = new PipelineVisualizer('pipelineContainer');
    repl = new ChurchREPL(sim, pipelineViz);
    churchTutorial = new BernoulliTutorial(repl, pipelineViz);

    window.churchTutorial = churchTutorial;

    sim.on('stateChange', () => updateDashboard());
    sim.on('fault', (f) => appendOutput(`FAULT [${f.type}]: ${f.message}`, 'error'));
    sim.on('halt', () => appendOutput('Machine halted.', 'info'));

    loadEditorState();
    switchView('dashboard');
    updateDashboard();
    pipelineViz.render();
}

function switchView(viewId) {
    currentView = viewId;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const el = document.getElementById(viewId);
    if (el) el.classList.add('active');

    document.querySelectorAll('.view-buttons .btn-view').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById('viewBtn-' + viewId);
    if (activeBtn) activeBtn.classList.add('active');

    if (viewId === 'dashboard') updateDashboard();
    if (viewId === 'namespace') updateNamespace();
    if (viewId === 'pipeline') pipelineViz.render();
    if (viewId === 'tutorial') churchTutorial.render('tutorialView');
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
        detailTab.textContent = `CR${crIdx}${name ? ' — ' + name : ''}`;
        detailTab.style.display = '';
    }
    switchDashTab('crdetail');
    updateCRDetail();
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
        titleEl.textContent = `CR${crIdx}${name ? ' — ' + name : ''} (NULL)`;
        contentEl.innerHTML = '<div style="color:var(--text-secondary);padding:1rem;">Register is empty (all words zero).</div>';
        return;
    }

    titleEl.innerHTML = `CR${crIdx}${name ? ' — <span style="color:var(--church-blue)">' + name + '</span>' : ''} — Detail View <button class="btn btn-sm" onclick="switchDashTab(\'cr\')" style="margin-left:1rem;font-size:0.7rem;">← Back to CR Table</button>`;

    let html = '<div class="cr-detail-grid">';

    html += '<div class="cr-detail-section">';
    html += '<div class="cr-detail-heading">128-bit Register Words</div>';
    html += '<table class="cr-table cr-detail-words"><thead><tr>';
    html += '<th>Word</th><th>Value</th><th>Decoded</th>';
    html += '</tr></thead><tbody>';
    html += `<tr><td>word0: GT</td><td class="cr-gt">0x${cr.word0_gt}</td><td>[${cr.perms}] Ver=${cr.gtVersion} Idx=${cr.gtIndex} Type=${cr.gtTypeName}</td></tr>`;
    html += `<tr><td>word1: Location</td><td>0x${cr.word1_location.toString(16).toUpperCase().padStart(8,'0')}</td><td>Base address</td></tr>`;
    html += `<tr><td>word2: Limit</td><td>B=${cr.limitB} F=${cr.limitF} Limit=0x${cr.limit17.toString(16).toUpperCase().padStart(5,'0')}</td><td>Bound=${cr.limitB} Frozen=${cr.limitF}</td></tr>`;
    html += `<tr><td>word3: Seals</td><td>Ver=${cr.sealVersion} FNV=0x${cr.sealFNV.toString(16).toUpperCase().padStart(7,'0')}</td><td>Integrity seal</td></tr>`;
    html += `<tr><td>M bit</td><td class="${cr.mBit ? 'cr-m-set' : ''}">${cr.mBit}</td><td>${cr.mBit ? 'Written under M elevation' : 'Normal write'}</td></tr>`;
    html += '</tbody></table>';
    html += '</div>';

    const nsIdx = cr.gtIndex;
    const ns = sim.namespaceTable;

    if (nsIdx < ns.length) {
        const entry = ns[nsIdx];
        html += '<div class="cr-detail-section">';
        html += `<div class="cr-detail-heading">Namespace Entry [${nsIdx}] — ${entry.label || 'unnamed'}</div>`;

        const loc = entry.word0_location >>> 0;
        const lim = sim.parseLimitWord(entry.word1_limit);
        const sealVer = (entry.word2_seals >>> 25) & 0x7F;
        const sealFNV = entry.word2_seals & 0x01FFFFFF;
        const p = entry.gtPerms || {};
        const permStr = (p.R?'R':'-')+(p.W?'W':'-')+(p.X?'X':'-')+(p.L?'L':'-')+(p.S?'S':'-')+(p.E?'E':'-');

        html += '<table class="cr-table"><tbody>';
        html += `<tr><td>Location</td><td>0x${loc.toString(16).toUpperCase().padStart(8,'0')}</td></tr>`;
        html += `<tr><td>Permissions</td><td>[${permStr}]</td></tr>`;
        html += `<tr><td>B (Bind)</td><td>${lim.b}</td></tr>`;
        html += `<tr><td>F (Frozen)</td><td>${lim.f}</td></tr>`;
        html += `<tr><td>Limit</td><td>0x${lim.limit.toString(16).toUpperCase().padStart(5,'0')}</td></tr>`;
        html += `<tr><td>Version</td><td>${sealVer}</td></tr>`;
        html += `<tr><td>FNV Seal</td><td>0x${sealFNV.toString(16).toUpperCase().padStart(7,'0')}</td></tr>`;
        html += `<tr><td>G bit</td><td>${entry.gBit}</td></tr>`;
        html += `<tr><td>Chainable</td><td>${entry.chainable ? 'Yes' : 'No'}</td></tr>`;
        html += '</tbody></table>';
        html += '</div>';
    }

    const parsedPerms = sim.parseGT(sim.cr[crIdx].word0).permissions;
    const hasX = parsedPerms.X;
    const hasL = parsedPerms.L;

    const codeRegs = [7];
    const clistRegs = [6];
    const threadRegs = [8];
    const nsRegs = [15];
    const showCode = hasX || codeRegs.includes(crIdx);
    const showCList = hasL || clistRegs.includes(crIdx);
    const showThread = threadRegs.includes(crIdx);
    const showNS = nsRegs.includes(crIdx);

    if (showCode) {
        html += '<div class="cr-detail-section">';
        html += '<div class="cr-detail-heading">Code View — Executable Memory</div>';
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
                baseLoc.toString(16).toUpperCase().padStart(4,'0') + ' – 0x' +
                (baseLoc + wordCount - 1).toString(16).toUpperCase().padStart(4,'0') + ').</div>';
        } else {
            html += codeHtml;
        }
        html += '</div>';
    }

    if (showCList) {
        html += '<div class="cr-detail-section">';
        html += '<div class="cr-detail-heading">C-List View — Accessible Entries</div>';
        const baseLoc = cr.word1_location >>> 0;
        const limitVal = cr.limit17;
        const clistEntries = [];
        for (let i = 0; i < ns.length; i++) {
            const e = ns[i];
            const eLoc = e.word0_location >>> 0;
            const eLim = sim.parseLimitWord(e.word1_limit);
            if (eLoc >= baseLoc && eLoc <= baseLoc + limitVal * 0x100) {
                clistEntries.push({ idx: i, entry: e, loc: eLoc, lim: eLim });
            }
        }
        if (clistEntries.length === 0) {
            html += '<div style="color:var(--text-secondary);padding:0.5rem;">No namespace entries within this capability\'s range.</div>';
        } else {
            html += '<table class="cr-table"><thead><tr>';
            html += '<th>Offset</th><th>Idx</th><th>Label</th><th>Perms</th><th>Location</th><th>B</th><th>F</th><th>Limit</th><th>Ver</th><th>FNV Seal</th>';
            html += '</tr></thead><tbody>';
            for (let j = 0; j < clistEntries.length; j++) {
                const c = clistEntries[j];
                const e = c.entry;
                const p = e.gtPerms || {};
                const permStr = (p.R?'R':'-')+(p.W?'W':'-')+(p.X?'X':'-')+(p.L?'L':'-')+(p.S?'S':'-')+(p.E?'E':'-');
                const sealVer = (e.word2_seals >>> 25) & 0x7F;
                const sealFNV = e.word2_seals & 0x01FFFFFF;
                html += `<tr class="cr-active">`;
                html += `<td class="cr-idx">+${j}</td>`;
                html += `<td>${c.idx}</td>`;
                html += `<td class="cr-name">${e.label || ''}</td>`;
                html += `<td class="cr-perms">[${permStr}]</td>`;
                html += `<td>0x${c.loc.toString(16).toUpperCase().padStart(8,'0')}</td>`;
                html += `<td class="cr-flag">${c.lim.b}</td>`;
                html += `<td class="cr-flag">${c.lim.f}</td>`;
                html += `<td>0x${c.lim.limit.toString(16).toUpperCase().padStart(5,'0')}</td>`;
                html += `<td>${sealVer}</td>`;
                html += `<td>0x${sealFNV.toString(16).toUpperCase().padStart(7,'0')}</td>`;
                html += '</tr>';
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
        const threadNS = cr.gtIndex < ns.length ? ns[cr.gtIndex] : null;
        if (threadNS) {
            html += `<tr><td style="color:var(--church-blue)">NS Label</td><td>${threadNS.label || '(unnamed)'}</td></tr>`;
            html += `<tr><td style="color:var(--church-blue)">Chainable</td><td>${threadNS.chainable ? 'Yes' : 'No'}</td></tr>`;
        }
        html += '</tbody></table>';
        html += '</div>';
    }

    if (showNS) {
        html += '<div class="cr-detail-section">';
        html += '<div class="cr-detail-heading">Namespace Root — All Entries</div>';
        if (ns.length === 0) {
            html += '<div style="color:var(--text-secondary);padding:0.5rem;">Namespace table is empty.</div>';
        } else {
            html += '<table class="cr-table"><thead><tr>';
            html += '<th>Idx</th><th>Label</th><th>Perms</th><th>Type</th><th>Location</th><th>B</th><th>G</th><th>Chainable</th>';
            html += '</tr></thead><tbody>';
            for (let i = 0; i < ns.length; i++) {
                const e = ns[i];
                const p = e.gtPerms || {};
                const permStr = (p.R?'R':'-')+(p.W?'W':'-')+(p.X?'X':'-')+(p.L?'L':'-')+(p.S?'S':'-')+(p.E?'E':'-');
                const loc = e.word0_location >>> 0;
                const typeNames = ['NULL','Abstract','Outform','Reserved'];
                html += '<tr class="cr-active">';
                html += `<td class="cr-idx">${i}</td>`;
                html += `<td class="cr-name">${e.label || ''}</td>`;
                html += `<td class="cr-perms">[${permStr}]</td>`;
                html += `<td>${typeNames[e.gtType] || '?'}</td>`;
                html += `<td>0x${loc.toString(16).toUpperCase().padStart(8,'0')}</td>`;
                html += `<td class="cr-flag">${sim.parseLimitWord(e.word1_limit).b}</td>`;
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
        html += '<div style="color:var(--text-secondary);padding:0.5rem;">This register holds an active capability. No specialized view available for this register.</div>';
        html += '</div>';
    }
    html += '</div>';

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
    container.innerHTML = `
        <button class="btn btn-success btn-sm" onclick="stepSim()">Step</button>
        <button class="btn btn-success btn-sm" onclick="runSim()">Run</button>
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
    `;
}

function updateInfoDisplay() {
    const container = document.getElementById('machineInfo');
    if (!container) return;
    container.innerHTML = `
        <div class="info-item"><span class="info-label">Architecture</span><span class="info-value">Pure Church Machine</span></div>
        <div class="info-item"><span class="info-label">Base Opcodes</span><span class="info-value">8 (LOAD, SAVE, CALL, RETURN, CHANGE, SWITCH, TPERM, LAMBDA)</span></div>
        <div class="info-item"><span class="info-label">Fused Opcodes</span><span class="info-value">2 (ELOADCALL, XLOADLAMBDA) \u2014 same security, 57% fewer cycles</span></div>
        <div class="info-item"><span class="info-label">Instruction</span><span class="info-value">32-bit: opcode[4] | cond[4] | cr_dst[4] | cr_src[4] | imm[16]</span></div>
        <div class="info-item"><span class="info-label">Conditions</span><span class="info-value">16 ARM-style (EQ, NE, CS, CC, MI, PL, VS, VC, HI, LS, GE, LT, GT, LE, AL, NV)</span></div>
        <div class="info-item"><span class="info-label">Turing Instructions</span><span class="info-value">ZERO \u2014 Pure Church domain only</span></div>
        <div class="info-item"><span class="info-label">Golden Tokens</span><span class="info-value">32-bit: Version(7) | Index(17) | Perms(6) | Type(2)</span></div>
        <div class="info-item"><span class="info-label">Security</span><span class="info-value">7-step \u2192 3-step fused \u2192 programmable chain</span></div>
        <div class="info-item"><span class="info-label">Programmable</span><span class="info-value">Chainable abstractions accept method sequence programs</span></div>
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

function updateNamespace() {
    const container = document.getElementById('namespaceTable');
    if (!container) return;
    let html = '<div class="ns-layout-header">NS_ENTRY_LAYOUT: 3 words per entry (96 bits)</div>';
    html += '<table class="ns-table"><thead><tr>';
    html += '<th>Idx</th><th class="ns-label-col">Label</th>';
    html += '<th>word0: Location</th>';
    html += '<th>word1: B</th><th>word1: F</th><th>word1: Limit[16:0]</th>';
    html += '<th>word2: Ver[31:25]</th><th>word2: FNV Seal[24:0]</th>';
    html += '<th>G</th>';
    html += '</tr></thead><tbody>';

    for (let i = 0; i < sim.namespaceTable.length; i++) {
        const e = sim.namespaceTable[i];
        if (!e) continue;
        const lim = sim.parseLimitWord(e.word1_limit);
        const ver = (e.word2_seals >>> 25) & 0x7F;
        const seal = e.word2_seals & 0x01FFFFFF;
        html += '<tr>';
        html += `<td>${i}</td>`;
        html += `<td class="ns-label">${e.label || '-'}</td>`;
        html += `<td>0x${e.word0_location.toString(16).toUpperCase().padStart(8, '0')}</td>`;
        html += `<td class="ns-flag">${lim.b}</td>`;
        html += `<td class="ns-flag">${lim.f}</td>`;
        html += `<td>0x${lim.limit.toString(16).toUpperCase().padStart(5, '0')}</td>`;
        html += `<td>${ver}</td>`;
        html += `<td>0x${seal.toString(16).toUpperCase().padStart(7, '0')}</td>`;
        html += `<td class="ns-flag">${e.gBit}</td>`;
        html += '</tr>';
    }
    html += '</tbody></table>';
    container.innerHTML = html;
}

function assembleAndLoad() {
    const editor = document.getElementById('asmEditor');
    if (!editor) return;
    const source = editor.value;
    saveEditorState();

    const result = assembler.assemble(source);

    const console = document.getElementById('editorConsole');
    if (result.errors.length > 0) {
        const errText = result.errors.map(e => `Line ${e.line}: ${e.message}`).join('\n');
        if (console) console.textContent = `Assembly errors:\n${errText}`;
        return;
    }

    sim.reset();
    sim.loadProgram(result.words, 0);

    let listing = `Assembled ${result.words.length} instructions:\n`;
    for (let i = 0; i < result.words.length; i++) {
        listing += `  ${i.toString().padStart(4)}: 0x${result.words[i].toString(16).padStart(8, '0')}  ${assembler.disassemble(result.words[i])}\n`;
    }
    if (console) console.textContent = listing;
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

function runSim() {
    while (!sim.bootComplete) {
        sim._bootStep();
    }
    const steps = sim.run(10000);
    const con = document.getElementById('editorConsole');
    if (con) {
        con.textContent += `\nBoot complete. Ran ${steps} steps. ${sim.halted ? 'Halted.' : 'Stopped.'}`;
        con.scrollTop = con.scrollHeight;
    }
    updateDashboard();
}

function resetSim() {
    sim.reset();
    const console = document.getElementById('editorConsole');
    if (console) console.textContent = 'Machine reset.';
    pipelineViz.reset();
    updateDashboard();
}

function loadExample(name) {
    const editor = document.getElementById('asmEditor');
    if (!editor) return;

    const examples = {
        'load_save': `; Load and Save example
; Load Lambda abstraction into CR0 from C-List[CR6]
LOAD CR0, CR6, 2       ; CR0 = Lambda (ns index 2)
TPERM CR0, E           ; Check E permission
LOAD CR1, CR6, 7       ; CR1 = SUCC
TPERM CR1, LE          ; Check L+E
CALL CR0               ; Enter Lambda
RETURN CR0             ; Return
`,
        'bernoulli': `; Bernoulli - simplified Church sequence
; Load core abstractions
LOAD CR0, CR6, 2       ; Lambda
LOAD CR1, CR6, 9       ; ADD
LOAD CR2, CR6, 11      ; MUL
LOAD CR3, CR6, 12      ; DIV
LOAD CR4, CR6, 7       ; SUCC

; Verify permissions on all
TPERM CR0, E           ; Lambda enter
TPERM CR1, LE          ; ADD load+enter
TPERM CR2, LE          ; MUL load+enter
TPERM CR3, LE          ; DIV load+enter
TPERM CR4, LE          ; SUCC load+enter

; Execute reductions
LAMBDA CR1             ; Church ADD
LAMBDA CR2             ; Church MUL
LAMBDA CR3             ; Church DIV
LAMBDA CR4             ; Church SUCC

; Return result
RETURN CR0
`,
        'conditional': `; Conditional execution demo
LOAD CR0, CR6, 2       ; Load Lambda
TPERM CR0, E           ; Check — sets Z=1 (pass)

; This executes only if Z=1 (TPERM passed)
LOADEQ CR1, CR6, 9     ; Load ADD only if equal (Z=1)
LAMBDAEQ CR1           ; Lambda only if equal

; This would skip if Z=0 (TPERM failed)
LOADNE CR2, CR6, 10    ; Load SUB only if not-equal (Z=0)

RETURN CR0
`,
    };

    const code = examples[name];
    if (code) {
        editor.value = code;
        saveEditorState();
    }
}

function replExecute() {
    const input = document.getElementById('replInput');
    const output = document.getElementById('replOutput');
    if (!input || !output) return;

    const command = input.value.trim();
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

    input.value = '';
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
            editor.value = `; Pure Church Machine — Assembly Editor
; 8 opcodes: LOAD, SAVE, CALL, RETURN, CHANGE, SWITCH, TPERM, LAMBDA
; All instructions support ARM-style condition suffixes
;
; Load an abstraction and verify its permissions
LOAD CR0, CR6, 2       ; Load Lambda abstraction
TPERM CR0, E           ; Verify E (enter) permission
LAMBDA CR0             ; Church reduction
RETURN CR0             ; Return result
`;
        }
    }
}

document.addEventListener('DOMContentLoaded', init);
