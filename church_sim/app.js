let sim = null;
let assembler = null;
let pipelineViz = null;
let repl = null;
let churchTutorial = null;
let currentView = 'dashboard';
let lastAssembledWords = null;

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
    const views = ['dashboard','editor','namespace','pipeline','tutorial','repl','instructions'];
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
    if (viewId === 'pipeline') pipelineViz.render();
    if (viewId === 'tutorial') churchTutorial.render('tutorialView');
    if (viewId === 'instructions') renderInstructionsList();
    if (viewId === 'pages') renderPagesDirectory();
}

function openPageInFrame(href, name) {
    const viewer = document.getElementById('pagesViewer');
    const listing = document.getElementById('pagesListing');
    const frame = document.getElementById('pagesIframe');
    const title = document.getElementById('pagesViewerTitle');
    listing.style.display = 'none';
    viewer.style.display = 'flex';
    title.textContent = name;
    frame.src = href;
}

function closePageViewer() {
    const viewer = document.getElementById('pagesViewer');
    const listing = document.getElementById('pagesListing');
    const frame = document.getElementById('pagesIframe');
    viewer.style.display = 'none';
    listing.style.display = 'block';
    frame.src = 'about:blank';
}

function renderPagesDirectory() {
    function card(href, name, tag, tagClass, desc) {
        const escaped = href.replace(/'/g, "\\'");
        const eName = name.replace(/'/g, "\\'");
        return `<div onclick="openPageInFrame('${escaped}','${eName}')" style="cursor:pointer;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:0.7rem 0.9rem;color:#c9d1d9;transition:border-color 0.2s;" onmouseover="this.style.borderColor='#58a6ff'" onmouseout="this.style.borderColor='#30363d'"><div style="font-size:0.85rem;font-weight:600;color:#58a6ff;margin-bottom:0.2rem;">${name} <span style="font-size:0.6rem;padding:0.1rem 0.35rem;border-radius:3px;${tagClass}">${tag}</span></div><div style="font-size:0.7rem;color:#8b949e;line-height:1.3;">${desc}</div></div>`;
    }
    function navCard(href, name, tag, tagClass, desc) {
        return `<div onclick="window.location.href='${href}'" style="cursor:pointer;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:0.7rem 0.9rem;color:#c9d1d9;transition:border-color 0.2s;" onmouseover="this.style.borderColor='#58a6ff'" onmouseout="this.style.borderColor='#30363d'"><div style="font-size:0.85rem;font-weight:600;color:#58a6ff;margin-bottom:0.2rem;">${name} <span style="font-size:0.6rem;padding:0.1rem 0.35rem;border-radius:3px;${tagClass}">${tag}</span></div><div style="font-size:0.7rem;color:#8b949e;line-height:1.3;">${desc}</div><div style="font-size:0.6rem;color:#484f58;margin-top:0.2rem;">Opens in full window</div></div>`;
    }
    const tc = 'background:#1a2a1a;border:1px solid #3fb950;color:#3fb950;';
    const ts = 'background:#1a1a2a;border:1px solid #58a6ff;color:#58a6ff;';
    const tr = 'background:#2a1a2a;border:1px solid #bc8cff;color:#bc8cff;';
    const td = 'background:#2a2a1a;border:1px solid #d4a843;color:#d4a843;';
    const tt = 'background:#2a1a1a;border:1px solid #f0883e;color:#f0883e;';

    const el = id => document.getElementById(id);
    el('pagesSimulators').innerHTML = [
        navCard('/', 'Home', 'landing', ts, 'Landing page with links to all simulators.'),
        navCard('/church/', 'Church Machine', 'Pure Church', tc, '8 opcodes, zero Turing instructions, REPL, pipeline, Bernoulli tutorial.'),
        navCard('/ctmm/', 'CTMM Simulator', 'Sim-64', ts, 'Custom ISA, 64-bit Golden Tokens, namespace browser, assembly editor.'),
        navCard('/rv32/', 'RV32-Cap Simulator', 'RISC-V', tr, 'RISC-V RV32I with capability security extensions, 32-bit GTs.'),
    ].join('');
    el('pagesReference').innerHTML = [
        card('/church/flowchart.html', 'Microcode Flowchart', 'Church', tc, 'All 20 instructions with memory bus annotations, TSB gates, GC cycle, fault catalog.'),
        navCard('/test/', 'Tunnel Test Harness', 'testing', tt, 'Side-by-side testing with automated messaging and real-time test logging.'),
    ].join('');
    el('pagesFigures').innerHTML = [
        card('/figures/dual-gate-tsb', 'Fig 1: Dual-Gate TSB', 'figure', td, 'mLoad + mSave as the complete Trusted Security Base.'),
        card('/figures/gt-format-type-field', 'Fig 2: GT Format &amp; Type', 'figure', td, 'Bit layout of all four GT types: Inform, Outform, NULL, Abstract (Sim-32 + Sim-64).'),
        card('/figures/b-bit-propagation', 'Fig 3: B-bit Propagation', 'figure', td, 'B-bit flow: default B=0, CALL clears B, TPERM sets B=1, mSave enforces B=1.'),
        card('/figures/lambda-vs-call', 'Fig 4: LAMBDA vs CALL', 'figure', td, 'Side-by-side: LAMBDA ~3 cycles vs CALL 10+ cycles, with comparison table.'),
        card('/figures/machine-status-fast-path', 'Fig 5: Machine-Status Fast Path', 'figure', td, 'LAMBDA entry/return with zero stack access via machine-status registers.'),
        card('/figures/stack-frames', 'Fig 6: Stack Frames', 'figure', td, 'Self-describing stack frames.'),
        card('/figures/pp250-gc', 'Fig 7: PP250 Garbage Collection', 'figure', td, 'Four-phase Scan-Identify-Clear-Flip with bidirectional G-bit via mLoad + mSave.'),
        card('/figures/church-processor-block', 'Fig 8: Church Processor Block', 'figure', td, 'Three-block architecture: Lambda Reducer, Capability Validator, I/O Mediator. No ALU by design.'),
        card('/figures/vulnerability-elimination', 'Fig 9: Vulnerability Elimination', 'figure', td, '8 vulnerability classes eliminated by construction: absent hardware + dual-gate TSB.'),
        card('/figures/atomic-abstraction-architecture', 'Fig 10: 7 Zeroes Architecture', 'figure', td, 'Conventional vs CTMM: no OS, no VM, no rings, no root, no ACLs, no MMU, no ambient authority.'),
        card('/figures/safe-turing-abstractions', 'Fig 11: Safe Turing Abstractions', 'figure', td, 'Church armor wraps hidden Turing sword: CALL/RETURN interface, atomic execution, domain purity.'),
        card('/figures/unified-address-space', 'Fig 12: Unified Address Space', 'figure', td, 'Memory (0x00-0xFD), devices (0xFE), registers (0xFF) &mdash; all gated by mLoad.'),
        card('/figures/lambda-nesting-sequence', 'Fig 13: LAMBDA Nesting', 'figure', td, 'Non-nestable LAMBDA with CALL-mediated nesting.'),
        card('/figures/lambda-calculus-mapping', 'Fig 14: Lambda Mapping', 'figure', td, 'Lambda calculus to CTMM hardware mapping.'),
        card('/figures/lambda-clamp-example', 'Fig 15: LAMBDA Clamp', 'figure', td, 'Macro-like code reuse.'),
        card('/figures/tunnel-architecture', 'Fig 16: Tunnel Architecture', 'figure', td, 'Encrypted capability tunnel between Meta Machines.'),
        card('/figures/dispatch-styles-comparison', 'Fig 17: Dispatch Styles', 'figure', td, 'Same CALL, three resolutions.'),
        card('/figures/conventional-vs-ctmm', 'Fig 18: Conventional vs CTMM', 'figure', td, 'Attack surface elimination.'),
        card('/figures/boot-sequence-state-machine', 'Fig 19: Boot Sequence', 'figure', td, '5-phase hardware initialization.'),
        card('/figures/mload-validation-pipeline', 'Fig 20: mLoad Pipeline', 'figure', td, 'Five sequential validation checks.'),
        card('/figures/mint-abstraction-nesting', 'Fig 21: Mint Abstraction', 'figure', td, 'Abstraction nesting and domain purity.'),
        card('/figures/hello-mum-tunnel', 'Fig 22: Hello Mum Tunnel', 'figure', td, 'Encrypted capability tunnel example.'),
    ].join('');
    const tp = 'background:#2a1a2a;border:1px solid #da70d6;color:#da70d6;';
    el('pagesPatent').innerHTML = [
        navCard('/docs/patent', 'Unified Patent Submission', 'patent', tp, 'Consolidated 28-claim patent: dual-gate TSB, B-bit propagation, LAMBDA, Pure Church, safe Turing abstractions.'),
    ].join('');
    el('pagesBusiness').innerHTML = [
        card('/docs/business/plan.html', 'Business Plan', 'business', tt, 'Church Machine business plan.'),
        card('/docs/business/deck.html', 'Investor Deck', 'business', tt, 'Church Machine investor presentation.'),
    ].join('');
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

let crDetailTab = 'content';

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
        titleEl.textContent = `CR${crIdx}${name ? ' — ' + name : ''} (NULL)`;
        contentEl.innerHTML = '<div style="color:var(--text-secondary);padding:1rem;">Register is empty (all words zero).</div>';
        return;
    }

    titleEl.innerHTML = `CR${crIdx}${name ? ' — <span style="color:var(--church-blue)">' + name + '</span>' : ''} <button class="btn btn-sm" onclick="switchDashTab(\'cr\')" style="margin-left:1rem;font-size:0.7rem;">← Back</button>`;

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
        for (let i = 0; i < sim.nsCount; i++) {
            const e = sim.readNSEntry(i);
            if (!e) continue;
            const eLoc = e.word0_location >>> 0;
            const eLim = sim.parseNSWord1(e.word1_limit);
            if (eLoc >= baseLoc && eLoc <= baseLoc + limitVal * sim.SLOT_SIZE) {
                clistEntries.push({ idx: i, entry: e, loc: eLoc, lim: eLim });
            }
        }
        if (clistEntries.length === 0) {
            html += '<div style="color:var(--text-secondary);padding:0.5rem;">No namespace entries within this capability\'s range.</div>';
        } else {
            html += '<table class="cr-table"><thead><tr>';
            html += '<th>Idx</th><th>Label</th><th>Perms</th><th>Type</th><th>Location</th><th>B</th><th>Limit</th><th>FNV</th>';
            html += '</tr></thead><tbody>';
            for (let j = 0; j < clistEntries.length; j++) {
                const c = clistEntries[j];
                const e = c.entry;
                const storedGT = sim.memory[e.word0_location];
                let permStr = '------';
                if (storedGT) {
                    const sp = sim.parseGT(storedGT).permissions;
                    permStr = (sp.R?'R':'-')+(sp.W?'W':'-')+(sp.X?'X':'-')+(sp.L?'L':'-')+(sp.S?'S':'-')+(sp.E?'E':'-');
                }
                const typeNames = ['NULL','Abstract','Outform','Inform'];
                const sealFNV = e.word2_seals & 0x01FFFFFF;
                html += `<tr class="cr-active">`;
                html += `<td class="cr-idx">${c.idx}</td>`;
                html += `<td class="cr-name">${e.label || ''}</td>`;
                html += `<td class="cr-perms">[${permStr}]</td>`;
                html += `<td>${typeNames[e.gtType] || '?'}</td>`;
                html += `<td>0x${c.loc.toString(16).toUpperCase().padStart(8,'0')}</td>`;
                html += `<td class="cr-flag">${c.lim.b}</td>`;
                html += `<td>0x${c.lim.limit.toString(16).toUpperCase().padStart(5,'0')}</td>`;
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
        html += '<div class="cr-detail-heading">Namespace Root — All Entries</div>';
        if (sim.nsCount === 0) {
            html += '<div style="color:var(--text-secondary);padding:0.5rem;">Namespace table is empty.</div>';
        } else {
            html += '<table class="cr-table"><thead><tr>';
            html += '<th>Idx</th><th>Label</th><th>Perms</th><th>Type</th><th>Location</th><th>B</th><th>G</th><th>Chain</th>';
            html += '</tr></thead><tbody>';
            const typeNames = ['NULL','Abstract','Outform','Inform'];
            for (let i = 0; i < sim.nsCount; i++) {
                const e = sim.readNSEntry(i);
                if (!e) continue;
                const storedGT = sim.memory[e.word0_location];
                let permStr = '------';
                if (storedGT) {
                    const sp = sim.parseGT(storedGT).permissions;
                    permStr = (sp.R?'R':'-')+(sp.W?'W':'-')+(sp.X?'X':'-')+(sp.L?'L':'-')+(sp.S?'S':'-')+(sp.E?'E':'-');
                }
                const loc = e.word0_location >>> 0;
                html += '<tr class="cr-active">';
                html += `<td class="cr-idx">${i}</td>`;
                html += `<td class="cr-name">${e.label || ''}</td>`;
                html += `<td class="cr-perms">[${permStr}]</td>`;
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
        html += `<div class="cr-detail-heading">Namespace Entry [${nsIdx}] — ${entry.label || 'unnamed'}</div>`;

        const loc = entry.word0_location >>> 0;
        const lim = sim.parseNSWord1(entry.word1_limit);
        const sealVer = (entry.word2_seals >>> 25) & 0x7F;
        const sealFNV = entry.word2_seals & 0x01FFFFFF;
        const gtPermStr = cr.perms;
        const storedGT = sim.memory[loc];
        let storedPermStr = '------';
        if (storedGT) {
            const sp = sim.parseGT(storedGT).permissions;
            storedPermStr = (sp.R?'R':'-')+(sp.W?'W':'-')+(sp.X?'X':'-')+(sp.L?'L':'-')+(sp.S?'S':'-')+(sp.E?'E':'-');
        }
        const typeNames = ['NULL','Abstract','Outform','Inform'];

        html += '<table class="cr-table"><tbody>';
        html += `<tr><td>Location</td><td>0x${loc.toString(16).toUpperCase().padStart(8,'0')}</td></tr>`;
        html += `<tr><td>GT Permissions</td><td>[${gtPermStr}]</td></tr>`;
        html += `<tr><td>Stored GT Perms</td><td>[${storedPermStr}]</td></tr>`;
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
    html += '<div class="cr-detail-heading">Memory Image — Raw Binary Data</div>';
    const baseLoc = cr.word1_location >>> 0;
    const limitVal = cr.limit17;
    const dumpCount = Math.min(limitVal + 1, 256);
    let nonZeroCount = 0;
    for (let w = 0; w < dumpCount; w++) {
        if (baseLoc + w < sim.memory.length && sim.memory[baseLoc + w] !== 0) nonZeroCount++;
    }
    html += `<div style="color:var(--text-secondary);font-size:0.72rem;margin-bottom:0.5rem;">Address range: 0x${baseLoc.toString(16).toUpperCase().padStart(4,'0')} – 0x${(baseLoc + dumpCount - 1).toString(16).toUpperCase().padStart(4,'0')} | ${dumpCount} words | ${nonZeroCount} non-zero</div>`;
    html += '<div style="font-family:\'Courier New\',monospace;font-size:0.72rem;line-height:1.5;background:#0a0a1a;padding:0.75rem;border-radius:6px;overflow-x:auto;max-height:400px;overflow-y:auto;">';
    for (let row = 0; row < dumpCount; row += 8) {
        const addr = baseLoc + row;
        let line = `<span style="color:var(--church-blue);">${addr.toString(16).toUpperCase().padStart(4,'0')}</span>  `;
        let ascii = '';
        for (let col = 0; col < 8; col++) {
            const idx = row + col;
            if (idx < dumpCount && baseLoc + idx < sim.memory.length) {
                const w = sim.memory[baseLoc + idx];
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
        <div class="info-item"><span class="info-label">Safe Abstractions</span><span class="info-value">Turing hidden inside Church-callable entries \u2014 CALL in, RETURN out, atomic</span></div>
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
    html += '<th>Perms</th><th>Type</th><th>Location</th>';
    html += '<th>B</th><th>F</th><th>Limit</th>';
    html += '<th>Ver</th><th>FNV Seal</th>';
    html += '<th>G</th><th>Actions</th>';
    html += '</tr></thead><tbody>';

    for (let i = 0; i < sim.nsCount; i++) {
        const e = sim.readNSEntry(i);
        if (!e) continue;
        const lim = sim.parseNSWord1(e.word1_limit);
        const ver = (e.word2_seals >>> 25) & 0x7F;
        const seal = e.word2_seals & 0x01FFFFFF;
        const storedGT = sim.memory[e.word0_location];
        let permStr = '------';
        if (storedGT) {
            const sp = sim.parseGT(storedGT).permissions;
            permStr = (sp.R?'R':'-')+(sp.W?'W':'-')+(sp.X?'X':'-')+(sp.L?'L':'-')+(sp.S?'S':'-')+(sp.E?'E':'-');
        }
        const typeNames = ['NULL','Abstract','Outform','Inform'];
        html += '<tr>';
        html += `<td>${i}</td>`;
        html += `<td class="ns-label">${e.label || '-'}</td>`;
        html += `<td class="cr-perms">[${permStr}]</td>`;
        html += `<td>${typeNames[e.gtType] || '?'}</td>`;
        html += `<td>0x${e.word0_location.toString(16).toUpperCase().padStart(8, '0')}</td>`;
        html += `<td class="ns-flag">${lim.b}</td>`;
        html += `<td class="ns-flag">${lim.f}</td>`;
        html += `<td>0x${lim.limit.toString(16).toUpperCase().padStart(5, '0')}</td>`;
        html += `<td>${ver}</td>`;
        html += `<td>0x${seal.toString(16).toUpperCase().padStart(7, '0')}</td>`;
        html += `<td class="ns-flag">${e.gBit}</td>`;
        html += `<td class="ns-entry-actions"><button class="btn btn-primary btn-xs" onclick="exportEntryMemory(${i})">Export</button> <button class="btn btn-xs" onclick="importEntryMemory(${i})" style="background:#3a86ff;color:#fff;border:none;">Import</button></td>`;
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
    lastAssembledWords = result.words.slice();

    let listing = `Assembled ${result.words.length} instructions:\n`;
    for (let i = 0; i < result.words.length; i++) {
        listing += `  ${i.toString().padStart(4)}: 0x${result.words[i].toString(16).padStart(8, '0')}  ${assembler.disassemble(result.words[i])}\n`;
    }
    if (console) console.textContent = listing;

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

function runGC() {
    if (!sim.bootComplete) {
        const console = document.getElementById('editorConsole');
        if (console) console.textContent += '\nGC Error: Boot must complete before running GC.\n';
        return;
    }
    sim.output += '[I/O] GC button pressed — invoking GC safe abstraction\n';
    sim.mElevation = true;
    const result = sim.runGC();
    sim.mElevation = false;
    sim.output += '[I/O] GC abstraction complete — RETURN\n';
    const console = document.getElementById('editorConsole');
    if (console) {
        console.textContent += '\n' + result.report + '\n';
        console.scrollTop = console.scrollHeight;
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
; Load 6 different abstractions via C-List
LOAD CR0, CR6, 3       ; CR0 = Lambda  (E)
LOAD CR1, CR6, 8       ; CR1 = SUCC    (LE)
LOAD CR2, CR6, 10      ; CR2 = ADD     (LE)
LOAD CR3, CR6, 11      ; CR3 = SUB     (LE)
LOAD CR4, CR6, 12      ; CR4 = MUL     (LE)
LOAD CR5, CR6, 6       ; CR5 = Constants (E)

; --- TEST 2: TPERM - permission checks ---
; Each should set Z=1 (pass)
TPERM CR0, E           ; Lambda has E? PASS
TPERM CR1, LE          ; SUCC has L+E? PASS
TPERM CR2, LE          ; ADD has L+E? PASS
TPERM CR3, LE          ; SUB has L+E? PASS
TPERM CR4, LE          ; MUL has L+E? PASS
TPERM CR5, E           ; Constants has E? PASS

; --- TEST 3: TPERM failure ---
TPERM CR0, L           ; Lambda has L? FAIL (Z=0)

; --- TEST 4: Conditional execution ---
; Z=0 from failed TPERM above
LOADEQ CR0, CR6, 13    ; SKIP (Z=0, not equal)
LOADNE CR0, CR6, 3     ; EXEC (Z=0, is not-equal)

; --- TEST 5: SWITCH - swap registers ---
SWITCH CR0, 1          ; CR0 <-> CR1
; Now CR0=SUCC, CR1=Lambda
SWITCH CR0, 1          ; Swap back
; CR0=Lambda, CR1=SUCC again

; --- TEST 6: LAMBDA - in-scope reduction ---
LAMBDA CR1             ; Church SUCC reduction
LAMBDA CR2             ; Church ADD reduction
LAMBDA CR3             ; Church SUB reduction
LAMBDA CR4             ; Church MUL reduction

; --- TEST 7: CHANGE - re-aim register ---
CHANGE CR0, 4          ; CR0 now -> SlideRule
TPERM CR0, E           ; SlideRule has E? PASS

; --- TEST 8: SAVE - write to namespace ---
LOAD CR0, CR6, 3       ; Reload Lambda
TPERM CR0, EB          ; Verify E + set B=1 (allow bind)
SAVE CR0, CR6, 25      ; Save Lambda copy to slot 25

; --- TEST 9: CALL/RETURN ---
LOAD CR0, CR6, 3       ; CR0 = Lambda
CALL CR0               ; Push frame, enter Lambda
RETURN CR0             ; Pop frame, return to next

; --- TEST 10: ELOADCALL - fused Load+TPERM+Call ---
ELOADCALL CR0, CR6, 3  ; Load Lambda + check E + call
RETURN CR0             ; Return from fused call

; --- TEST 11: XLOADLAMBDA - fused Load+TPERM+Lambda ---
XLOADLAMBDA CR1, CR6, 8 ; Load SUCC + check + lambda

; --- TEST 12: Conditional LAMBDA ---
TPERM CR1, LE          ; Z=1 (SUCC has LE)
LAMBDAEQ CR2           ; Lambda ADD only if Z=1
TPERM CR0, L           ; Z=0 (Lambda lacks L)
LAMBDANE CR3           ; Lambda SUB only if Z=0 (NE)
LAMBDAEQ CR4           ; SKIP MUL (Z=0, not EQ)

; --- All tests complete ---
HALT
`,
        'load_save': `; Load and Save example
; Load Lambda abstraction into CR0 from C-List[CR6]
LOAD CR0, CR6, 3       ; CR0 = Lambda (ns index 3)
TPERM CR0, E           ; Check E permission
LOAD CR1, CR6, 8       ; CR1 = SUCC
TPERM CR1, LE          ; Check L+E
CALL CR0               ; Enter Lambda
RETURN CR0             ; Return
`,
        'bernoulli': `; Bernoulli - simplified Church sequence
; Load core abstractions
LOAD CR0, CR6, 3       ; Lambda
LOAD CR1, CR6, 10      ; ADD
LOAD CR2, CR6, 12      ; MUL
LOAD CR3, CR6, 13      ; DIV
LOAD CR4, CR6, 8       ; SUCC

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
LOAD CR0, CR6, 3       ; Load Lambda
TPERM CR0, E           ; Check — sets Z=1 (pass)

; This executes only if Z=1 (TPERM passed)
LOADEQ CR1, CR6, 10    ; Load ADD only if equal (Z=1)
LAMBDAEQ CR1           ; Lambda only if equal

; This would skip if Z=0 (TPERM failed)
LOADNE CR2, CR6, 11    ; Load SUB only if not-equal (Z=0)

RETURN CR0
`,
        'gc_test': `; ============================================
; Church Machine GC Test (PP250)
; GC via safe Turing abstraction — CALL GC
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
LOAD CR0, CR6, 3       ; CR0 = Lambda    (E)
LOAD CR1, CR6, 8       ; CR1 = SUCC      (XLE)
LOAD CR2, CR6, 7       ; CR2 = Stack     (E)
LOAD CR3, CR6, 10      ; CR3 = ADD       (XLE)
LOAD CR4, CR6, 6       ; CR4 = Constants (E)

; --- Verify permissions ---
TPERM CR0, E           ; Lambda has E? PASS
TPERM CR1, LE          ; SUCC has L+E? PASS
TPERM CR2, E           ; Stack has E? PASS
TPERM CR3, LE          ; ADD has L+E? PASS
TPERM CR4, E           ; Constants has E? PASS

; --- Exercise: LAMBDA checks X via mLoad ---
LAMBDA CR1             ; SUCC reduction (X)
LAMBDA CR3             ; ADD reduction (X)

; --- CALL GC: checks E via mLoad ---
LOAD CR5, CR6, 25      ; CR5 = GC (E)
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
LOAD CR0, CR6, 8       ; CR0 = SUCC (XLE)
LOAD CR1, CR6, 10      ; CR1 = ADD (XLE)

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
        'perm_attack': `; ============================================
; ADVERSARIAL TEST: Permission Violations
; Every operation here should FAULT cleanly.
; mLoad is the single guard at the gate.
; ============================================
;
; Namespace reference:
;   Slot 0  Boot.CList (L,S only)
;   Slot 1  Boot.CLOOMC (X only)
;   Slot 20 TRUE       (L only — no X, no E)
;   Slot 21 FALSE      (L only — no X, no E)
;   Slot 25 GC         (E only)
; ============================================

; --- ATTACK 1: CALL without E permission ---
; TRUE (slot 20) has only L — no E.
; CALL requires E via mLoad. Should FAULT.
LOAD CR0, CR6, 20      ; CR0 = TRUE (L only)
CALL CR0               ; FAULT: lacks E permission

; --- ATTACK 2: LAMBDA without X permission ---
; Constants (slot 6) has only E — no X.
; LAMBDA requires X via mLoad. Should FAULT.
LOAD CR1, CR6, 6       ; CR1 = Constants (E only)
LAMBDA CR1             ; FAULT: lacks X permission

; --- ATTACK 3: CALL something with only X ---
; Boot.CLOOMC (slot 1) has only X — no E.
; CALL requires E. Should FAULT.
LOAD CR2, CR6, 1       ; CR2 = Boot.CLOOMC (X only)
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
LOAD CR0, CR6, 8       ; CR0 = SUCC (XLE, B=0)
SAVE CR0, CR6, 26      ; FAULT: B=0, cannot bind

; --- If we get here, B-bit default failed ---
HALT
`,
        'tperm_attack': `; ============================================
; ADVERSARIAL TEST: TPERM Escalation
; TPERM can only REMOVE permissions (AND gate).
; Attempting to ADD permissions must fail.
; ============================================
;
; Hardware guarantee: result = preset & existing
; Even if FSM is bypassed, AND gate prevents
; escalation. Two layers of defense.
; ============================================

; --- Setup: Load GTs with known permissions ---
LOAD CR0, CR6, 6       ; CR0 = Constants (E only)
LOAD CR1, CR6, 20      ; CR1 = TRUE (L only)
LOAD CR2, CR6, 8       ; CR2 = SUCC (XLE)

; --- ATTACK 1: Try to add X to Constants ---
; Constants has E only. Request RWXLSE.
; Result should be E only (AND gate).
TPERM CR0, RWXLSE      ; Result: E (only bit in common)
; Z=1 means non-zero result — E survived
; But X,R,W,L,S were NOT added

; --- ATTACK 2: Try to add E to TRUE ---
; TRUE has L only. Request LE.
; Result should be L only.
TPERM CR1, LE          ; Result: L (only bit in common)

; --- ATTACK 3: Strip everything from SUCC ---
; SUCC has XLE. Request nothing (0).
; Result should be 0 — all permissions gone.
TPERM CR2, 0           ; Result: 0 (Z=0, no perms left)

; --- ATTACK 4: Now try to restore SUCC perms ---
; CR2 has 0 permissions. Request XLE back.
; AND with 0 = 0. Cannot restore.
TPERM CR2, XLE         ; Result: 0 (still empty, Z=0)

; --- Verify: CR2 is now useless ---
; LAMBDA needs X, but CR2 has 0.
LAMBDA CR2             ; FAULT: lacks X permission

; --- If we get here, monotonicity held ---
HALT
`,
        'version_attack': `; ============================================
; ADVERSARIAL TEST: CR-Occupied Protection
; A context register holding an active GT
; cannot be overwritten — prevents capability
; leaks and use-after-free.
; ============================================
;
; _writeCR checks: if CR holds non-zero GT
; and M-elevation is not active, FAULT.
; This prevents clobbering live capabilities.
; ============================================

; --- Setup: Load valid GTs ---
LOAD CR0, CR6, 3       ; CR0 = Lambda (E)
LOAD CR1, CR6, 8       ; CR1 = SUCC (XLE)

; --- ATTACK 1: Overwrite occupied CR ---
; CR0 already holds Lambda.
; Loading into occupied CR should FAULT.
LOAD CR0, CR6, 10      ; FAULT: CR0 already occupied

; --- ATTACK 2: Reload same entry ---
; Even reloading the same GT should FAULT.
; The CR is occupied regardless of content.
LOAD CR1, CR6, 8       ; FAULT: CR1 already occupied

; --- If we get here, CR protection failed ---
HALT
`,
        'gc_adversary': `; ============================================
; ADVERSARIAL TEST: GC Safety
; Verifies GC correctly distinguishes live
; entries from garbage after mixed operations.
; ============================================
;
; PP250 four-phase GC:
;   1. SCAN — walk CRs, mark live (G=liveValue)
;   2. IDENTIFY — G=garbageValue entries
;   3. CLEAR — zero garbage NS + object memory
;   4. FLIP — invert polarity for next cycle
;
; Attack vector: Load many entries, release some,
; verify GC only sweeps the released ones.
; ============================================

; --- Phase A: Load 6 entries into CRs ---
; These should ALL survive GC.
LOAD CR0, CR6, 3       ; Lambda    (E)
LOAD CR1, CR6, 8       ; SUCC      (XLE)
LOAD CR2, CR6, 7       ; Stack     (E)
LOAD CR3, CR6, 10      ; ADD       (XLE)
LOAD CR4, CR6, 6       ; Constants (E)
LOAD CR5, CR6, 4       ; SlideRule (E)

; --- Phase B: Exercise some via LAMBDA ---
; mLoad marks these entries as accessed (live).
LAMBDA CR1             ; Touch SUCC via X
LAMBDA CR3             ; Touch ADD via X

; --- Phase C: Verify permissions on survivors ---
TPERM CR0, E           ; Lambda still has E? PASS
TPERM CR2, E           ; Stack still has E? PASS
TPERM CR4, E           ; Constants still has E? PASS
TPERM CR5, E           ; SlideRule still has E? PASS

; --- Phase D: Run GC ---
; Entries in CR0-CR5 + CR6 + CR15 survive.
; All other namespace entries are garbage.
LOAD CR5, CR6, 25      ; CR5 = GC (overwrite SlideRule)
CALL CR5               ; Trigger GC abstraction

; --- Phase E: Verify survivors still work ---
; If GC incorrectly swept a live entry, these FAULT.
TPERM CR0, E           ; Lambda survived? PASS
TPERM CR1, LE          ; SUCC survived? PASS
TPERM CR2, E           ; Stack survived? PASS
TPERM CR3, LE          ; ADD survived? PASS
TPERM CR4, E           ; Constants survived? PASS

; --- Phase F: Second GC cycle (polarity flip) ---
; Run GC again with flipped polarity.
; Survivors should still survive.
LOAD CR5, CR6, 25      ; Reload GC
CALL CR5               ; Second GC pass

; --- Phase G: Final verification ---
TPERM CR0, E           ; Lambda after 2x GC? PASS
TPERM CR1, LE          ; SUCC after 2x GC? PASS

; --- All checks passed ---
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
LOAD CR0, CR6, 3       ; Load Lambda abstraction
TPERM CR0, E           ; Verify E (enter) permission
LAMBDA CR0             ; Church reduction
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
    newOpt.textContent = '— New Entry —';
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
    const typeNames = ['NULL','Abstract','Outform','Inform'];
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
        example: 'LOAD CR0, CR6, 8    ; Load slot 8 into CR0 via C-List CR6',
    },
    {
        opcode: 1, mnemonic: 'SAVE', domain: 'church',
        syntax: 'SAVE CRd, CRs, imm',
        brief: 'Save a Golden Token into a C-List (capability list)',
        encoding: 'opcode[5]=00001 | cond[4] | CRd[4] | CRs[4] | slot[15]',
        fields: [
            { name: 'CRd', desc: 'Source context register containing GT to save' },
            { name: 'CRs', desc: 'C-List GT — the capability list to save into (must have S permission)' },
            { name: 'imm', desc: 'Slot index within the C-List (0-32767)' },
        ],
        permission: 'S (Save) on CRs; B=1 required on source GT',
        flags: 'None',
        details: 'Saves the GT from CRd into the C-List pointed to by CRs, at the specified slot index. A C-List (capability list) is a namespace entry that holds other GTs — it is the fundamental mechanism for storing and sharing capabilities. The target C-List GT must have S (Save) permission, and the source GT must have its B (Bind) bit set to 1. This prevents unauthorized capability propagation — you cannot save a GT you have not explicitly been allowed to share.',
        example: 'SAVE CR1, CR6, 21   ; Save CR1 into slot 21 of C-List CR6',
    },
    {
        opcode: 2, mnemonic: 'CALL', domain: 'church',
        syntax: 'CALL CRd',
        brief: 'Enter an abstraction — save context, auto-clear B on all passed GTs',
        encoding: 'opcode[5]=00010 | cond[4] | CRd[4] | 0[4] | 0[15]',
        fields: [
            { name: 'CRd', desc: 'Target GT (must have E permission)' },
        ],
        permission: 'E (Enter/Execute) on CRd',
        flags: 'None',
        details: 'Enters a namespace abstraction. The target GT must have E permission. The current PC, CRs, DRs, and flags are pushed onto the call stack. CALL automatically clears the B (Bind) bit on all preserved context registers passed to the callee. This means the callee can USE any GT it receives but cannot SAVE it to a c-list — "use it, don\'t keep it" is the hardware default. To allow the callee to save a GT (delegation), the caller must explicitly set B=1 via TPERM before the CALL. RETURN is the only way to exit.',
        example: 'CALL CR3             ; Enter abstraction — callee gets GTs with B=0\n                     ; Callee can use them but cannot SAVE them',
    },
    {
        opcode: 3, mnemonic: 'RETURN', domain: 'church',
        syntax: 'RETURN CRd',
        brief: 'Exit an abstraction — restore caller context',
        encoding: 'opcode[5]=00011 | cond[4] | CRd[4] | 0[4] | 0[15]',
        fields: [
            { name: 'CRd', desc: 'Return register (conventionally CR0)' },
        ],
        permission: 'None',
        flags: 'None',
        details: 'Pops the call stack and restores the caller\'s context (PC, CRs, DRs, flags). Shared between Church and Turing domains — it is the only exit from a safe Turing abstraction. If the call stack is empty, the machine halts.',
        example: 'RETURN CR0           ; Exit abstraction, restore caller',
    },
    {
        opcode: 4, mnemonic: 'CHANGE', domain: 'church',
        syntax: 'CHANGE CRd, imm',
        brief: 'Suspend/activate thread — save and load all machine registers',
        encoding: 'opcode[5]=00100 | cond[4] | CRd[4] | 0[4] | idx[15]',
        fields: [
            { name: 'CRd', desc: 'Thread GT — identifies the thread to change to' },
            { name: 'imm', desc: 'Thread control flags' },
        ],
        permission: 'Thread GT must be valid',
        flags: 'None',
        details: 'The thread suspend/activate instruction. CHANGE saves the entire machine register set of the current thread (all CRs, DRs, PC, flags) and then loads the complete register set of the target thread. This is the fundamental context-switch mechanism — one atomic instruction that suspends the running thread and activates another. All register state is preserved so the suspended thread can resume exactly where it left off.',
        example: 'CHANGE CR8, 0        ; Suspend current thread, activate thread in CR8',
    },
    {
        opcode: 5, mnemonic: 'SWITCH', domain: 'church',
        syntax: 'SWITCH CRs, imm',
        brief: 'Switch namespace — reload CR15 with a new namespace root',
        encoding: 'opcode[5]=00101 | cond[4] | 0[4] | CRs[4] | idx[15]',
        fields: [
            { name: 'CRs', desc: 'GT pointing to the new namespace to switch to' },
            { name: 'imm', desc: 'Namespace control flags' },
        ],
        permission: 'CRs must point to a valid namespace',
        flags: 'None',
        details: 'Switches the active namespace by reloading CR15 (the namespace root register) with a new namespace. CR15 is the machine\'s view of the entire capability world — all LOADs, SAVEs, and CALLs resolve through it. SWITCH atomically replaces that root, giving the current thread an entirely different set of visible capabilities. This is the mechanism for domain isolation, sandboxing, and controlled namespace transitions.',
        example: 'SWITCH CR3, 0        ; Switch namespace root (CR15) to namespace in CR3',
    },
    {
        opcode: 6, mnemonic: 'TPERM', domain: 'church',
        syntax: 'TPERM CRd, preset',
        brief: 'Attenuate permissions — remove bits from a GT',
        encoding: 'opcode[5]=00110 | cond[4] | CRd[4] | 0[4] | mask[15]',
        fields: [
            { name: 'CRd', desc: 'Context register holding the GT to attenuate' },
            { name: 'preset', desc: 'Permission mask — bits to keep (R, W, X, L, S, E, B combinations)' },
        ],
        permission: 'None — operates on cached register only',
        flags: 'Z=1 if resulting permissions are non-zero, N=!Z',
        details: 'Attenuates (reduces) the permission bits on the GT in CRd by ANDing with the given mask. Permissions can only be removed, never added — monotonic security. The attenuation is local to the cached context register and signals the M (modified) bit, just like any CR modification. The namespace slot is NOT updated until a legitimate SAVE commits the attenuated GT back to a c-list. Since CALL auto-clears B on all passed GTs, TPERM is also used for the special case of ALLOWING bind — explicitly setting B=1 before a CALL to delegate a capability the callee may keep.',
        example: '; Example 1: Strip write — hand off read-only\nTPERM CR0, RX        ; Keep only R+X, strip W,L,S,E\nCALL CR2             ; Callee can read+execute but not write\n\n; Example 2: ALLOW BIND — delegate a GT the callee may keep\nLOAD CR1, CR6, 4     ; Load GT from c-list slot 4\nTPERM CR1, RWXB      ; Keep R+W+X and SET B (Bind)\nCALL CR2             ; Callee receives CR1 with B=1\n                     ; Callee CAN save this GT (delegation)',
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
        details: 'Lightweight function application — applies a Church reduction without saving/restoring context (unlike CALL). The target GT must have X permission. Used for fast-path lambda calculus operations like SUCC, ADD, etc.',
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
        details: 'Fused instruction that performs LOAD, verifies E permission, and enters the abstraction — all in one cycle. Reduces the 3-instruction sequence (LOAD + TPERM + CALL) to a single instruction for common abstraction entry patterns.',
        example: 'ELOADCALL CR0, CR6, 13  ; Load slot 13, verify E, enter',
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
        details: 'Fused instruction that performs LOAD, verifies X permission, and applies a lambda reduction — all in one cycle. Used for fast-path Church reductions where the GT is loaded and applied in a single operation.',
        example: 'XLOADLAMBDA CR0, CR6, 8  ; Load slot 8, verify X, reduce',
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
        details: 'Reads a 32-bit word from the address range protected by the GT in CRs, at the given offset. mLoad validates the GT (version, seal, bounds) and checks R permission. Works on any address range — memory, devices, or registers.',
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
        flags: 'Z (zero/equal), N (negative), C (carry/unsigned ≥), V (signed overflow)',
        details: 'Computes DRa - DRb internally (without storing the result) and sets the ARM-style condition flags. Use with BRANCH or conditional instructions to control flow based on comparison results. C flag uses unsigned comparison semantics (C=1 if DRa ≥ DRb unsigned).',
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
        flags: 'Z (zero), N (negative), C (borrow: C=1 if DRa ≥ DRb), V (signed overflow)',
        details: 'Computes DRd = DRa - DRb as unsigned 32-bit integers and sets all four ARM-style flags. C flag follows ARM convention: C=1 means no borrow (DRa ≥ DRb unsigned). ISUB DRd, DR0, DRx computes the two\'s complement negation.',
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

function renderInstructionsList() {
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
        <span class="instr-brief">Shared — exit from Turing abstraction</span>
    `;
    returnCard.onclick = () => showInstructionDetail(3);
    turingList.appendChild(returnCard);
}

function showInstructionDetail(opcode) {
    selectedInstr = opcode;
    const instr = INSTRUCTION_DATA.find(i => i.opcode === opcode);
    if (!instr) return;

    renderInstructionsList();

    const title = document.getElementById('instrDetailTitle');
    const content = document.getElementById('instrDetailContent');
    if (!title || !content) return;

    const domainLabel = instr.domain === 'church' ? 'Church Domain' : 'Turing Domain';
    const domainClass = instr.domain === 'church' ? 'church' : 'turing';
    title.textContent = `${instr.mnemonic} — Opcode ${instr.opcode}`;

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

document.addEventListener('DOMContentLoaded', init);
