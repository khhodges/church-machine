let sim = null;
let asm = null;
let runInterval = null;
let codeLoaded = false;

const ABI_NAMES = ['zero','ra','sp','gp','tp','t0','t1','t2','s0','s1',
    'a0','a1','a2','a3','a4','a5','a6','a7',
    's2','s3','s4','s5','s6','s7','s8','s9','s10','s11',
    't3','t4','t5','t6'];

const CR_LABELS = {6:'C-List', 7:'Nucleus', 8:'Percilla', 15:'Namespace'};
const NS_NAMES = {0:'Namespace', 1:'Nucleus', 2:'Boot C-List', 3:'Percilla',
    4:'Lambda', 5:'GT_CHURCH_SUCC', 6:'GT_CHURCH_PRED', 7:'GT_CHURCH_ADD',
    8:'GT_CHURCH_MUL', 9:'GT_TRUE', 10:'GT_FALSE', 11:'GT_PAIR',
    12:'GT_FST', 13:'GT_SND', 14:'GT_IF'};

function toHex32(val) {
    return '0x' + ((val >>> 0).toString(16)).padStart(8, '0');
}

function switchView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.btn-view').forEach(b => b.classList.remove('active'));
    document.getElementById('view-' + viewName).classList.add('active');
    const viewMap = {dashboard:'Dashboard', namespace:'Namespace', editor:'Assembly', capabilities:'Capabilities', instructions:'Instructions', docs:'Docs'};
    document.querySelectorAll('.btn-view').forEach(b => {
        if (b.textContent === viewMap[viewName]) b.classList.add('active');
    });
    if (viewName === 'dashboard') updateUI();
    if (viewName === 'namespace') updateNamespaceView();
    if (viewName === 'capabilities') updateCapabilitiesView();
    if (viewName === 'docs') loadDocsList();
}

function doReset() {
    stopRun();
    sim.reset();
    codeLoaded = false;
    clearConsole();
    updateUI();
    switchView('dashboard');
}

function doStep() {
    stopRun();
    if (!codeLoaded) {
        appendConsole('[ERROR] No code loaded. Use Assembly view: write or pick an example, then Assemble + Load.');
        switchView('dashboard');
        return;
    }
    if (sim.halted) {
        appendConsole('[INFO] Halted. Click Reset to restart.');
        switchView('dashboard');
        return;
    }
    const result = sim.step();
    if (result && result.disasm) {
        appendConsole(`[${sim.stepCount}] ${toHex32(sim.pc - 4)}: ${result.disasm}`);
    }
    updateUI();
    switchView('dashboard');
}

function doRun() {
    if (runInterval) return;
    if (!codeLoaded) {
        appendConsole('[ERROR] No code loaded. Use Assembly view: write or pick an example, then Assemble + Load.');
        switchView('dashboard');
        return;
    }
    if (sim.halted) {
        appendConsole('[INFO] Halted. Click Reset to restart.');
        switchView('dashboard');
        return;
    }
    runInterval = setInterval(() => {
        for (let i = 0; i < 100; i++) {
            const result = sim.step();
            if (!result || !result.executed || sim.halted) {
                stopRun();
                updateUI();
                return;
            }
        }
        updateUI();
    }, 16);
}

function doStop() {
    stopRun();
    updateUI();
}

function stopRun() {
    if (runInterval) { clearInterval(runInterval); runInterval = null; }
}

function gcMark() {
    const marked = sim.gcMark();
    updateGCStatus(`Mark: ${marked} entries marked`);
    updateUI();
    updateNamespaceView();
}

function gcScan() {
    const scanned = sim.gcScan();
    updateGCStatus(`Scan: ${scanned} entries cleared (reachable)`);
    updateUI();
    updateNamespaceView();
}

function gcSweep() {
    const garbage = sim.gcSweep();
    updateGCStatus(`Sweep: ${garbage.length} entries collected`);
    if (garbage.length > 0) {
        appendConsole(`[GC] Swept ${garbage.length} entries: ${garbage.map(g => `ns[${g.index}]`).join(', ')}`);
    }
    updateUI();
    updateNamespaceView();
}

function gcCycle() {
    const results = sim.gcCycle();
    updateGCStatus(`Cycle: ${results.marked}M ${results.scanned}S ${results.garbage.length}G`);
    if (results.garbage.length > 0) {
        appendConsole(`[GC] Full cycle: marked=${results.marked}, scanned=${results.scanned}, collected=${results.garbage.length}`);
        appendConsole(`[GC] Collected: ${results.garbage.map(g => `ns[${g.index}]`).join(', ')}`);
    } else {
        appendConsole(`[GC] Full cycle: marked=${results.marked}, scanned=${results.scanned}, no garbage found`);
    }
    updateUI();
    updateNamespaceView();
}

function updateGCStatus(msg) {
    const el = document.getElementById('gc-status');
    if (el) {
        el.textContent = msg;
        el.classList.add('gc-flash');
        setTimeout(() => el.classList.remove('gc-flash'), 1500);
    }
}

function updateUI() {
    updateRegisters();
    updateCRDisplay();
    updatePC();
    updateStepCount();
    updateBootStatus();
    updateStackIndicators();
}

function updateRegisters() {
    const tbody = document.getElementById('reg-table-body');
    tbody.innerHTML = '';
    for (let i = 0; i < 32; i++) {
        const val = sim.x[i];
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>x${i}</td><td>${ABI_NAMES[i]}</td><td>${toHex32(val)}</td><td>${val}</td>`;
        if (val !== 0) tr.classList.add('reg-nonzero');
        tbody.appendChild(tr);
    }
}

function updateCRDisplay() {
    const container = document.getElementById('cr-container');
    container.innerHTML = '';
    for (let i = 0; i < 16; i++) {
        const cr = sim.cr[i];
        const gt = sim.parseGT(cr.word0);
        const div = document.createElement('div');
        div.className = 'cr-card' + ([6,7,8,15].includes(i) ? ' special' : '');

        let label = `CR${i}`;
        if (CR_LABELS[i]) label += ` <span class="cr-label">(${CR_LABELS[i]})</span>`;

        let permBadges = '';
        const permNames = ['R','W','X','L','S','E'];
        permNames.forEach(p => {
            if (gt.permissions[p]) permBadges += `<span class="perm-badge perm-${p}">${p}</span>`;
        });

        const typeName = gt.typeName.toLowerCase();

        div.innerHTML = `
            <div class="cr-header">
                <span class="cr-name">${label}</span>
                <span class="cr-gt">${toHex32(cr.word0)}</span>
            </div>
            <div class="cr-body">
                <div class="cr-perms">${permBadges || '<span class="no-perms">none</span>'}</div>
                <span class="type-badge type-${typeName}">${gt.typeName}</span>
                <span class="cr-meta">v${gt.version} idx:${gt.index}</span>
            </div>
        `;
        container.appendChild(div);
    }
}

function updatePC() {
    document.getElementById('pc-value').textContent = toHex32(sim.pc);
}

function updateStepCount() {
    document.getElementById('step-count').textContent = sim.stepCount;
}

function updateBootStatus() {
    const el = document.getElementById('boot-status');
    el.textContent = sim.bootComplete ? 'Boot Complete' : 'Not Booted';
    el.className = 'boot-status ' + (sim.bootComplete ? 'booted' : 'not-booted');
}

function updateStackIndicators() {
    const state = sim.getState();
    const spaceEl = document.getElementById('stack-space');
    const framesEl = document.getElementById('stack-frames');
    const depthEl = document.getElementById('stack-depth');
    if (spaceEl) {
        spaceEl.className = 'stack-indicator ' + (state.stackSpace ? 'indicator-on' : 'indicator-off');
    }
    if (framesEl) {
        framesEl.className = 'stack-indicator ' + (state.stackFrames ? 'indicator-on' : 'indicator-off');
    }
    if (depthEl) {
        depthEl.textContent = `${state.callStackDepth}/${state.callStackMax}`;
    }
}

function doAssemble() {
    const source = document.getElementById('asm-editor').value;
    localStorage.setItem('rv32cap-asm', source);
    const result = asm.assemble(source);

    const outputEl = document.getElementById('asm-output');
    if (!result.success) {
        outputEl.innerHTML = '<div class="asm-errors">' +
            result.errors.map(e => `<div class="asm-error">Line ${e.line}: ${e.message}</div>`).join('') +
            '</div>';
        return;
    }

    let hexStr = '';
    for (let i = 0; i < result.bytes.length; i += 4) {
        const word = (result.bytes[i] | (result.bytes[i+1] << 8) | (result.bytes[i+2] << 16) | (result.bytes[i+3] << 24)) >>> 0;
        hexStr += toHex32(word) + '\n';
    }
    outputEl.innerHTML = `<div class="asm-success">Assembled ${result.bytes.length} bytes (${result.bytes.length/4} instructions)</div><pre>${hexStr}</pre>`;

    updateListing(result.listing);
}

function doLoad() {
    const source = document.getElementById('asm-editor').value;
    const result = asm.assemble(source);
    if (!result.success) {
        doAssemble();
        return;
    }
    sim.reset();
    sim.loadProgram(result.bytes);
    codeLoaded = true;
    clearConsole();
    appendConsole(`Loaded ${result.bytes.length} bytes — Ready to Step or Run`);
    updateUI();
    switchView('dashboard');
}

function updateListing(listing) {
    const tbody = document.getElementById('program-listing');
    tbody.innerHTML = '';
    listing.forEach(entry => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${toHex32(entry.addr)}</td><td>${entry.hex}</td><td>${entry.source}</td>`;
        tbody.appendChild(tr);
    });
}

function loadExample(name) {
    const examples = {
        'arithmetic': `# Basic Arithmetic
    addi t0, zero, 10    # t0 = 10
    addi t1, zero, 20    # t1 = 20
    add  t2, t0, t1      # t2 = t0 + t1 = 30
    sub  t3, t1, t0      # t3 = t1 - t0 = 10
    slli t4, t0, 2       # t4 = t0 << 2 = 40
    and  t5, t0, t1      # t5 = t0 & t1
    or   t6, t0, t1      # t6 = t0 | t1
    ecall                 # halt`,

        'capability': `# Capability Demo
    # Load a capability from C-List
    addi a0, zero, 1     # C-List index 1
    cap.load cr0, a0     # Load cap from slot 1 into CR0
    addi a0, zero, 2     # C-List index 2
    cap.load cr1, a0     # Load cap from slot 2 into CR1
    cap.save cr0, a0     # Save CR0 back to slot 2
    ecall                 # halt`,

        'loop': `# Loop Example - Sum 1 to N
    addi t0, zero, 10    # N = 10
    addi t1, zero, 0     # sum = 0
    addi t2, zero, 1     # i = 1
loop:
    add  t1, t1, t2      # sum += i
    addi t2, t2, 1       # i++
    bge  t0, t2, loop    # if N >= i, goto loop (i.e., while i <= N)
    ecall                 # halt`,

        'access': `# =============================================
# ACCESS.ASM — LAMBDA TEST HARNESS (RV32-Cap)
# =============================================
# Purpose: Demonstrates the CAP.LAMBDA instruction
# applying Church functions to data registers.
# CAP.LAMBDA uses X permission (not E like CAP.CALL),
# is non-nestable, and operates in-place.
#
# Flow: Enter Lambda abstraction via CAP.CALL,
# CAP.LOAD individual function GTs [R,X] from
# the namespace, then apply with CAP.LAMBDA.
#
# Output: a0 (x10) holds result of each application
#
# Namespace layout:
#   [4] = Lambda       [E]  (abstraction)
#   [5] = GT_CHURCH_SUCC [R,X] (successor)
#   [7] = GT_CHURCH_ADD  [R,X] (addition)
#   [8] = GT_CHURCH_MUL  [R,X] (multiplication)
# =============================================

# === STEP 1: Enter Lambda Abstraction ===
# Load Lambda [E] from namespace index 4
    cap.load cr0, cr6, 4     # CR0 <- ns[4] (Lambda)
    cap.tperm t0, cr0        # t0 = permission bits
    andi t0, t0, 0x20        # isolate E bit (bit 5)
    beqz t0, fault           # FAULT if no E permission

# CALL Lambda to enter its scope
    cap.call cr0             # Enter Lambda scope

# === STEP 2: Load SUCC function [R,X] ===
# Namespace index 5 = GT_CHURCH_SUCC
    cap.load cr0, cr6, 5     # CR0 <- ns[5] (SUCC [R,X])
    cap.tperm t0, cr0        # t0 = permission bits
    andi t0, t0, 0x04        # isolate X bit (bit 2)
    beqz t0, fault           # FAULT if no X permission

# === STEP 3: LAMBDA SUCC ===
# a0 = 3, apply SUCC -> expect a0 = 4
    addi a0, zero, 3         # a0 = 3
    cap.lambda cr0, a0       # SUCC(3) -> a0 = 4

# === STEP 4: Load ADD function [R,X] ===
# Namespace index 7 = GT_CHURCH_ADD
    cap.load cr1, cr6, 7     # CR1 <- ns[7] (ADD [R,X])

# === STEP 5: LAMBDA ADD ===
# a0 = 4 (from SUCC), set a1 = 10
    addi a1, zero, 10        # a1 = 10
    cap.lambda cr1, a0       # ADD(4, 10) -> a0 = 14

# === STEP 6: Load MUL function [R,X] ===
# Namespace index 8 = GT_CHURCH_MUL
    cap.load cr2, cr6, 8     # CR2 <- ns[8] (MUL [R,X])

# === STEP 7: LAMBDA MUL ===
# a0 = 14 (from ADD), a1 = 10
# Need a1 = 3: set it
    addi a1, zero, 3         # a1 = 3
    cap.lambda cr2, a0       # MUL(14, 3) -> a0 = 42

# === DONE: a0 = 42 (the answer) ===
    j done

fault:
    ebreak                    # FAULT — uniform failure

done:
    ecall                     # HALT — a0 = 42`,

        'hello_mum': `# ================================================
# HELLO MUM — "mymother" side (receiver)
# ================================================
# "mymother" (Sim-32, RV32-Cap) receives a message
# from "me" (Sim-64, CTMM) through the encrypted
# capability tunnel.
#
# This is the receiving half of:
#   CALL(CONNECT(me, mymother))
# ONE Church instruction + THREE Golden Tokens
#
# Namespace layout:
#   [4] = Tunnel_Key_Me   (tunnel crypto key)
#   [5] = Inbox           (message buffer, RW)
#   [6] = Service_Handler (messaging service code)
#   [7] = ABI_Me          (register map descriptor)
#
# CR6 = C-List [L,S] (from boot)
# ================================================

# === STEP 1: Load inbox capability ===
# mLoad validates: L permission on CR6, MAC, version
    cap.load cr0, cr6, 5     # CR0 = Inbox GT from namespace[5]

# === STEP 2: Load tunnel key for decryption ===
    cap.load cr1, cr6, 4     # CR1 = Tunnel_Key_Me from namespace[4]

# === STEP 3: Simulate received message ===
# In real hardware, tunnel microcode would decrypt
# and ABI-translate the payload into x10-x15.
# Here we simulate the received "Hello" message:
    addi a0, zero, 72        # x10 = 'H' (72) — from DR0 via ABI
    addi a1, zero, 101       # x11 = 'e' (101) — from DR1 via ABI
    addi a2, zero, 108       # x12 = 'l' (108) — from DR2 via ABI
    addi a3, zero, 108       # x13 = 'l' (108) — from DR3 via ABI
    addi a4, zero, 111       # x14 = 'o' (111) — from DR4 via ABI
    addi a5, zero, 77        # x15 = 'M' (77)  — from DR5 via ABI

# === STEP 4: Store message to inbox ===
# CAP.SAVE writes the inbox capability back
# validating W permission through mLoad
    cap.save cr0, cr6, 5     # Store inbox GT back to namespace[5]

# === STEP 5: Send acknowledgment ===
# Set return value: message received successfully
    addi a0, zero, 1         # x10 = 1 (ACK: message received)

# === Message received! ===
# The tunnel returns ACK to "me"
# ABI descriptor maps x10 back to DR0
    ecall                     # halt — demo complete`
    };

    const editor = document.getElementById('asm-editor');
    if (examples[name]) {
        editor.value = examples[name];
        localStorage.setItem('rv32cap-asm', editor.value);
        if (name === 'hello_mum') {
            setupHelloMumNamespace();
        }
    }
}

function setupHelloMumNamespace() {
    const entries = [
        { location: 0x0000A000, limit: 0x0000A0FF, name: 'Tunnel_Key_Me' },
        { location: 0x0000B000, limit: 0x0000B0FF, name: 'Inbox' },
        { location: 0x0000C000, limit: 0x0000C0FF, name: 'Service_Handler' },
        { location: 0x0000D000, limit: 0x0000D0FF, name: 'ABI_Me' }
    ];

    for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const nsIdx = 4 + i;
        NS_NAMES[nsIdx] = e.name;
        while (sim.namespaceTable.length <= nsIdx) {
            sim.namespaceTable.push({ location: 0, limit: 0, versionSeals: sim.makeVersionSeals(0, 0, 0), gBit: 0 });
        }
        sim.namespaceTable[nsIdx] = {
            location: e.location,
            limit: e.limit,
            versionSeals: sim.makeVersionSeals(0, e.location, e.limit),
            gBit: 0
        };
    }

    sim.cr[6].word0 = sim.createGT(0, 1, { R:1, W:1, X:0, L:1, S:1, E:0 }, 0);

    updateNamespaceView();
    updateRegisterView();

    const output = document.getElementById('asm-output');
    if (output) {
        output.innerHTML =
            '<span style="color:#7fd">━━━ HELLO MUM — Namespace configured ━━━</span>\n' +
            '"mymother" (Percilla) = RV32-Cap Sim-32 (x0-x31, 32-bit)\n' +
            '"me" (Kenneth)       = CTMM Sim-64 (DR0-DR15, 64-bit)\n\n' +
            'Namespace entries added:\n' +
            '  [4] Tunnel_Key_Me   (0xA000-0xA0FF)\n' +
            '  [5] Inbox           (0xB000-0xB0FF)\n' +
            '  [6] Service_Handler (0xC000-0xC0FF)\n' +
            '  [7] ABI_Me          (0xD000-0xD0FF)\n\n' +
            'CR6 = C-List [R,W,L,S] — "mymother" C-List\n\n' +
            'Click Assemble → Load → Step to receive message.\n' +
            'Open CTMM Simulator for "me" sender side.\n' +
            '<span style="color:#7fd">━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</span>';
    }
}

function updateNamespaceView() {
    const tbody = document.getElementById('ns-table-body');
    tbody.innerHTML = '';
    sim.namespaceTable.forEach((entry, i) => {
        if (!entry) return;
        const tr = document.createElement('tr');
        const version = (entry.versionSeals >>> 25) & 0x7F;
        const seals = entry.versionSeals & 0x01FFFFFF;
        const macValid = sim.validateMAC(entry);
        const macBadge = macValid
            ? '<span class="mac-badge mac-valid">MAC OK</span>'
            : '<span class="mac-badge mac-invalid">MAC FAIL</span>';
        const gBit = entry.gBit || 0;
        const gBadge = gBit ? '<span class="mac-badge mac-invalid">G</span>' : '<span class="mac-badge mac-valid">-</span>';
        const nsName = NS_NAMES[i] || '';
        tr.innerHTML = `<td>${i}</td><td>${nsName}</td><td>${toHex32(entry.location)}</td><td>${toHex32(entry.limit)}</td><td>${version}</td><td>${toHex32(seals)}</td><td>${macBadge}</td><td>${gBadge}</td>`;
        tbody.appendChild(tr);
    });
}

function updateCapabilitiesView() {
    updateGTDiagram(0);
}

function showCRDetail(crIndex) {
    updateGTDiagram(crIndex);
    document.querySelectorAll('.btn-cr').forEach(b => b.classList.remove('active'));
    document.querySelector(`.btn-cr[data-cr="${crIndex}"]`)?.classList.add('active');
}

function updateGTDiagram(crIndex) {
    const cr = sim.cr[crIndex];
    const gt = sim.parseGT(cr.word0);

    const diagram = document.getElementById('gt-diagram');
    let html = `<div class="gt-title">CR${crIndex} Golden Token: ${toHex32(cr.word0)}</div>`;
    html += '<div class="gt-bits">';
    html += `<div class="gt-field gt-version" style="width:21.875%"><div class="gt-field-label">Version</div><div class="gt-field-value">${gt.version}</div><div class="gt-field-bits">[31:25]</div></div>`;
    html += `<div class="gt-field gt-index" style="width:53.125%"><div class="gt-field-label">Index</div><div class="gt-field-value">${gt.index}</div><div class="gt-field-bits">[24:8]</div></div>`;
    html += `<div class="gt-field gt-perms" style="width:18.75%"><div class="gt-field-label">Permissions</div><div class="gt-field-value">${((cr.word0 >> 2) & 0x3F).toString(2).padStart(6, '0')}</div><div class="gt-field-bits">[7:2]</div></div>`;
    html += `<div class="gt-field gt-type" style="width:6.25%"><div class="gt-field-label">Type</div><div class="gt-field-value">${gt.type}</div><div class="gt-field-bits">[1:0]</div></div>`;
    html += '</div>';
    diagram.innerHTML = html;

    const permDisplay = document.getElementById('perm-display');
    const permNames = ['R','W','X','L','S','E'];
    const permDescriptions = {
        R:'Read data', W:'Write data', X:'Execute code',
        L:'Load capability', S:'Save capability', E:'Enter abstraction',
    };
    let permHtml = '<div class="perm-grid">';
    permNames.forEach(p => {
        const active = gt.permissions[p];
        permHtml += `<div class="perm-item ${active ? 'active' : ''}">
            <span class="perm-badge perm-${p}">${p}</span>
            <span class="perm-desc">${permDescriptions[p]}</span>
        </div>`;
    });
    permHtml += '</div>';
    permDisplay.innerHTML = permHtml;

    const detail = document.getElementById('gt-detail');
    detail.innerHTML = `
        <div class="gt-detail-row"><span>Type:</span><span class="type-badge type-${gt.typeName.toLowerCase()}">${gt.typeName}</span></div>
        <div class="gt-detail-row"><span>Version:</span><span>${gt.version}</span></div>
        <div class="gt-detail-row"><span>Index:</span><span>${gt.index} (slot address: ${gt.index * 3})</span></div>
        <div class="gt-detail-row"><span>Raw:</span><span class="mono">${toHex32(cr.word0)}</span></div>
        <div class="gt-detail-row"><span>Binary:</span><span class="mono">${cr.word0.toString(2).padStart(32, '0')}</span></div>
        <div class="gt-detail-row"><span>Word 1:</span><span class="mono">${toHex32(cr.word1)}</span></div>
        <div class="gt-detail-row"><span>Word 2:</span><span class="mono">${toHex32(cr.word2)}</span></div>
        <div class="gt-detail-row"><span>Word 3:</span><span class="mono">${toHex32(cr.word3)}</span></div>
    `;
}

function appendConsole(text) {
    const el = document.getElementById('console-output');
    el.textContent += text + '\n';
    el.scrollTop = el.scrollHeight;
}

function clearConsole() {
    document.getElementById('console-output').textContent = '';
}

window.switchView = switchView;
window.doReset = doReset;
window.doStep = doStep;
window.doRun = doRun;
window.doStop = doStop;
window.doAssemble = doAssemble;
window.doLoad = doLoad;
window.loadExample = loadExample;
window.showCRDetail = showCRDetail;

document.addEventListener('DOMContentLoaded', () => {
    sim = new RiscVCapSimulator();
    asm = new RiscVAssembler();

    document.getElementById('btn-reset').onclick = doReset;
    document.getElementById('btn-step').onclick = doStep;
    document.getElementById('btn-run').onclick = doRun;
    document.getElementById('btn-stop').onclick = doStop;

    document.getElementById('btn-assemble')?.addEventListener('click', doAssemble);
    document.getElementById('btn-load')?.addEventListener('click', doLoad);

    document.querySelectorAll('[data-example]').forEach(btn => {
        btn.addEventListener('click', () => loadExample(btn.dataset.example));
    });

    document.querySelectorAll('.btn-cr').forEach(btn => {
        btn.addEventListener('click', () => showCRDetail(parseInt(btn.dataset.cr)));
    });

    sim.on('step', updateUI);
    sim.on('reset', updateUI);
    sim.on('halt', () => { stopRun(); updateUI(); });
    sim.on('fault', (data) => { appendConsole('FAULT: ' + data.message); updateUI(); });
    sim.on('output', (data) => {
        if (typeof data === 'string') appendConsole(data);
        else if (data && data.text) appendConsole(data.text);
    });

    updateUI();

    const savedAsm = localStorage.getItem('rv32cap-asm');
    if (savedAsm) {
        document.getElementById('asm-editor').value = savedAsm;
    } else {
        loadExample('access');
    }

    const editorSource = document.getElementById('asm-editor').value;
    if (editorSource && editorSource.trim()) {
        const result = asm.assemble(editorSource);
        if (result.success) {
            sim.reset();
            sim.loadProgram(result.bytes);
            codeLoaded = true;
            appendConsole(`Auto-loaded ${result.bytes.length} bytes — Ready to Step or Run`);
            updateUI();
        }
    }

    const editor = document.getElementById('asm-editor');
    const lineNums = document.getElementById('line-numbers');
    if (editor && lineNums) {
        function updateLineNumbers() {
            const lines = editor.value.split('\n').length;
            lineNums.innerHTML = Array.from({length: lines}, (_, i) => `<div>${i + 1}</div>`).join('');
        }
        editor.addEventListener('input', updateLineNumbers);
        editor.addEventListener('scroll', () => { lineNums.scrollTop = editor.scrollTop; });
        updateLineNumbers();
    }

    if (editor) {
        editor.addEventListener('input', () => {
            localStorage.setItem('rv32cap-asm', editor.value);
        });
    }

    let activeTooltip = null;

    function showFieldTooltip(el) {
        hideFieldTooltip();
        const data = el.getAttribute('data-tooltip');
        if (!data) return;
        const parts = data.split('|');
        const title = parts[0] || '';
        const bits = parts[1] || '';
        const desc = parts[2] || '';

        const tip = document.createElement('div');
        tip.className = 'field-tooltip';
        tip.innerHTML =
            '<div class="tip-title">' + title + '</div>' +
            '<div class="tip-bits">' + bits + '</div>' +
            '<div class="tip-desc">' + desc + '</div>';

        document.body.appendChild(tip);
        activeTooltip = { el: el, tip: tip };

        const elRect = el.getBoundingClientRect();
        let left = elRect.left + elRect.width / 2 - tip.offsetWidth / 2;
        let top = elRect.bottom + 8;

        if (left + tip.offsetWidth > window.innerWidth - 8) {
            left = window.innerWidth - tip.offsetWidth - 8;
        }
        if (left < 8) {
            left = 8;
        }
        if (top + tip.offsetHeight > window.innerHeight - 8) {
            top = elRect.top - tip.offsetHeight - 8;
        }

        tip.style.left = left + 'px';
        tip.style.top = top + 'px';
    }

    function hideFieldTooltip() {
        if (activeTooltip) {
            if (activeTooltip.tip.parentNode) {
                activeTooltip.tip.parentNode.removeChild(activeTooltip.tip);
            }
            activeTooltip = null;
        }
    }

    document.querySelectorAll('.bit-field[data-tooltip]').forEach(el => {
        el.addEventListener('mouseenter', () => showFieldTooltip(el));
        el.addEventListener('mouseleave', () => hideFieldTooltip());
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            if (activeTooltip && activeTooltip.el === el) {
                hideFieldTooltip();
            } else {
                showFieldTooltip(el);
            }
        });
    });

    document.addEventListener('click', () => hideFieldTooltip());
});

let docsListLoaded = false;

function loadDocsList() {
    if (docsListLoaded) return;
    fetch('api/docs')
        .then(r => r.json())
        .then(files => {
            const list = document.getElementById('docs-file-list');
            list.innerHTML = '';
            files.forEach(f => {
                const btn = document.createElement('button');
                btn.className = 'docs-file-btn';
                btn.textContent = f.title;
                btn.dataset.file = f.name;
                btn.addEventListener('click', () => loadDoc(f.name, f.title));
                list.appendChild(btn);
            });
            docsListLoaded = true;
        })
        .catch(err => console.error('Failed to load docs list:', err));
}

function loadDoc(filename, title) {
    document.querySelectorAll('.docs-file-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.docs-file-btn[data-file="${filename}"]`)?.classList.add('active');
    document.getElementById('docs-current-file').textContent = title;
    const content = document.getElementById('docs-content');
    content.innerHTML = '<div class="docs-loading">Loading...</div>';
    fetch('api/docs/' + filename)
        .then(r => r.text())
        .then(md => {
            content.innerHTML = renderMarkdown(md);
        })
        .catch(err => {
            content.innerHTML = '<div class="docs-error">Failed to load document.</div>';
        });
}

function escapeHtmlDoc(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderMarkdown(md) {
    let html = escapeHtmlDoc(md);
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    const lines = html.split('\n');
    let result = [];
    let inTable = false;
    let inCode = false;
    let codeBlock = [];
    let inList = false;
    let listItems = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.startsWith('```')) {
            if (inCode) {
                result.push('<pre><code>' + codeBlock.join('\n').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</code></pre>');
                codeBlock = [];
                inCode = false;
            } else {
                inCode = true;
            }
            continue;
        }
        if (inCode) {
            codeBlock.push(line);
            continue;
        }

        if (line.startsWith('|') && line.endsWith('|')) {
            if (!inTable) {
                inTable = true;
                const cells = line.split('|').filter(c => c.trim());
                result.push('<div class="docs-table-wrap"><table><thead><tr>' + cells.map(c => '<th>' + c.trim() + '</th>').join('') + '</tr></thead><tbody>');
            } else if (line.match(/^\|[\s\-:|]+\|$/)) {
                continue;
            } else {
                const cells = line.split('|').filter(c => c.trim());
                result.push('<tr>' + cells.map(c => '<td>' + c.trim() + '</td>').join('') + '</tr>');
            }
            continue;
        } else if (inTable) {
            result.push('</tbody></table></div>');
            inTable = false;
        }

        if (line.match(/^[-*] /)) {
            if (!inList) { inList = true; result.push('<ul>'); }
            result.push('<li>' + line.replace(/^[-*] /, '') + '</li>');
            continue;
        } else if (line.match(/^\d+\. /)) {
            if (!inList) { inList = true; result.push('<ol>'); }
            result.push('<li>' + line.replace(/^\d+\. /, '') + '</li>');
            continue;
        } else if (inList && line.trim() === '') {
            inList = false;
            result.push(result[result.length-1]?.includes('<ol>') ? '</ol>' : '</ul>');
        }

        if (line.startsWith('<h')) {
            if (inList) { inList = false; result.push('</ul>'); }
            result.push(line);
        } else if (line.trim() === '') {
            result.push('');
        } else if (!line.startsWith('|')) {
            result.push('<p>' + line + '</p>');
        }
    }
    if (inTable) result.push('</tbody></table></div>');
    if (inList) result.push('</ul>');

    return '<div class="docs-rendered">' + result.join('\n') + '</div>';
}
