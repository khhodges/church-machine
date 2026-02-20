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
        html += `<tr class="${cls}">`;
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
