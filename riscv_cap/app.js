let sim = null;
let asm = null;
let runInterval = null;
let codeLoaded = false;
let programListing = [];

const ABI_NAMES = ['zero','ra','sp','gp','tp','t0','t1','t2','s0','s1',
    'a0','a1','a2','a3','a4','a5','a6','a7',
    's2','s3','s4','s5','s6','s7','s8','s9','s10','s11',
    't3','t4','t5','t6'];

const CR_LABELS = {6:'C-List', 7:'Nucleus', 8:'Priscilla', 15:'Namespace'};
const NS_NAMES = {0:'Namespace', 1:'Nucleus', 2:'Boot C-List', 3:'Priscilla',
    4:'Lambda', 5:'GT_CHURCH_SUCC', 6:'GT_CHURCH_PRED', 7:'GT_CHURCH_ADD',
    8:'GT_CHURCH_MUL', 9:'GT_TRUE', 10:'GT_FALSE', 11:'GT_PAIR',
    12:'GT_FST', 13:'GT_SND', 14:'GT_IF',
    15:'TunnelKey_Child', 16:'Son_Messaging', 17:'ABI_Child',
    18:'Inbox', 19:'Outbox', 20:'Reply_Tunnel'};

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
    programListing = [];
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
    updateProgramListing();
}

function updateProgramListing() {
    const tbody = document.getElementById('dash-program-listing');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (programListing.length === 0) return;
    const currentPC = sim.pc;
    programListing.forEach(entry => {
        const tr = document.createElement('tr');
        const isActive = (entry.addr === currentPC);
        if (isActive) tr.classList.add('pc-active');
        tr.innerHTML = `<td>${toHex32(entry.addr)}</td><td>${entry.hex}</td><td>${entry.source}</td>`;
        tbody.appendChild(tr);
        if (isActive) {
            setTimeout(() => tr.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 0);
        }
    });
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
    programListing = result.listing || [];
    clearConsole();
    appendConsole(`Loaded ${result.bytes.length} bytes — Ready to Step or Run`);
    updateUI();
    updateProgramListing();
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
# HELLO MUM / HELLO SON — Bidirectional Tunnel
# ================================================
# Priscilla's machine (RV32-Cap Sim-32) — "mymother"
#
# PART 1: Receive "Hello Mum" from Kenneth (CTMM)
#   Kenneth's CALL(CONNECT(me, mymother)) arrives
#   via encrypted tunnel. ABI maps DR0-DR5 → x10-x15.
#
# PART 2: Send "Hello Son" back to Kenneth
#   Priscilla replies through the reverse tunnel.
#   CALL(CONNECT(mymother, son)) — symmetric flow.
#
# ONE Church instruction each direction.
# THREE Golden Tokens each direction.
# SEVEN zeroes — no OS, no VM, no privilege,
#   no superuser, no unauthorized code,
#   no unauthorized data, no containment escape.
#
# Namespace layout (ns[15-20]):
#   [15] TunnelKey_Child [R]   — shared crypto key
#   [16] Son_Messaging   [E,F] — Outform+Far to Kenneth
#   [17] ABI_Child       [R]   — register map x→DR
#   [18] Inbox           [R,W] — received messages
#   [19] Outbox          [R,W] — outgoing messages
#   [20] Reply_Tunnel    [E,F] — Outform+Far return path
# ================================================

# ────────────────────────────────────────────
# PART 1: RECEIVE "Hello Mum" from Kenneth
# ────────────────────────────────────────────

# === Load tunnel key for decryption ===
    cap.load cr0, cr6, 15    # CR0 ← TunnelKey_Child [R]
    cap.tperm t0, cr0        # test permissions
    andi t0, t0, 0x01        # isolate R bit
    beqz t0, fault           # FAULT if no R permission

# === Load Inbox to store received message ===
    cap.load cr1, cr6, 18    # CR1 ← Inbox [R,W]
    cap.tperm t0, cr1        # test permissions
    andi t0, t0, 0x02        # isolate W bit
    beqz t0, fault           # FAULT if no W permission

# === Simulate received "Hello Mum" payload ===
# In hardware: tunnel microcode decrypts + ABI maps
# DR0-DR5 (64-bit) → x10-x15 (32-bit)
    addi a0, zero, 72        # x10 = 'H' (72)
    addi a1, zero, 101       # x11 = 'e' (101)
    addi a2, zero, 108       # x12 = 'l' (108)
    addi a3, zero, 108       # x13 = 'l' (108)
    addi a4, zero, 111       # x14 = 'o' (111)
    addi a5, zero, 77        # x15 = 'M' (77)

# === Store to Inbox (W permission validated) ===
    cap.save cr1, cr6, 18    # Persist Inbox GT

# ────────────────────────────────────────────
# PART 2: SEND "Hello Son" back to Kenneth
# ────────────────────────────────────────────

# === Load Outbox for composing reply ===
    cap.load cr2, cr6, 19    # CR2 ← Outbox [R,W]

# === Prepare "Hello Son" in data registers ===
    addi a0, zero, 72        # x10 = 'H' (72)
    addi a1, zero, 101       # x11 = 'e' (101)
    addi a2, zero, 108       # x12 = 'l' (108)
    addi a3, zero, 108       # x13 = 'l' (108)
    addi a4, zero, 111       # x14 = 'o' (111)
    addi a5, zero, 83        # x15 = 'S' (83)

# === Store outgoing message ===
    cap.save cr2, cr6, 19    # Persist Outbox GT

# === Load ABI descriptor for Kenneth's arch ===
    cap.load cr3, cr6, 17    # CR3 ← ABI_Child [R]
    cap.tperm t0, cr3        # test permissions
    andi t0, t0, 0x01        # isolate R bit
    beqz t0, fault           # FAULT if no R

# === Load reverse tunnel service ===
    cap.load cr4, cr6, 20    # CR4 ← Reply_Tunnel [E]
    cap.tperm t0, cr4        # test permissions
    andi t0, t0, 0x20        # isolate E bit
    beqz t0, fault           # FAULT if no E

# === THE Church instruction — reverse direction ===
# CALL(CONNECT(mymother, son))
# → E permission on CR4 validated
# → Outform detected: tunnel path entered
# → ABI maps x10-x15 (32-bit) → DR0-DR5 (64-bit)
# → Payload encrypted with TunnelKey_Child
# → Sent to Kenneth's endpoint
    cap.call cr4             # ONE instruction. Hello Son.

# === Reply sent! Kenneth receives "Hello Son" ===
# On return: x10 = Kenneth's acknowledgment
# Bidirectional tunnel complete.
    j done

fault:
    ebreak                    # FAULT — uniform failure

done:
    ecall                     # HALT — bidirectional demo complete`
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
    sim.cr[6].word0 = sim.createGT(0, 1, { R:1, W:1, X:0, L:1, S:1, E:0 }, 0);

    updateNamespaceView();
    updateUI();

    appendConsole('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    appendConsole('HELLO MUM / HELLO SON — Bidirectional Tunnel');
    appendConsole('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    appendConsole('"mymother" (Priscilla) = RV32-Cap Sim-32');
    appendConsole('"me" (Kenneth)        = CTMM Sim-64');
    appendConsole('');
    appendConsole('--- BINDING PROVENANCE (FamilyRegistry) ---');
    appendConsole('The FamilyRegistry abstraction created these');
    appendConsole('entries at bind time via CALL(FamilyRegistry.Register):');
    appendConsole('  1. Generated shared tunnel key material');
    appendConsole('  2. Created matching Outform+Far entries on both machines');
    appendConsole('  3. Set remote address in location field (0xC7440001)');
    appendConsole('  4. Set F=1 (Far) + B=1 (Bound) in limit word');
    appendConsole('  5. Sealed entries with MAC — binding is now permanent');
    appendConsole('     until GC revokes');
    appendConsole('');
    appendConsole('Tunnel namespace entries (ns[15-20]):');
    appendConsole('  [15] TunnelKey_Child [R]     — shared crypto key');
    appendConsole('  [16] Son_Messaging   [E,F,B] — Outform+Far to Kenneth @ 0xC7440001');
    appendConsole('  [17] ABI_Child       [R]     — register map x→DR');
    appendConsole('  [18] Inbox           [R,W]   — received messages');
    appendConsole('  [19] Outbox          [R,W]   — outgoing messages');
    appendConsole('  [20] Reply_Tunnel    [E,F,B] — Outform+Far return @ 0xC7440001');
    appendConsole('');
    appendConsole('Location field holds remote endpoint address,');
    appendConsole('placed there by FamilyRegistry at bind time.');
    appendConsole('No DNS. No IP lookup. The capability IS the address.');
    appendConsole('');
    appendConsole('CR6 = C-List [R,W,L,S] — mymother C-List');
    appendConsole('');
    appendConsole('PART 1: Receive "Hello Mum" from Kenneth');
    appendConsole('PART 2: Send "Hello Son" back to Kenneth');
    appendConsole('');
    appendConsole('Click Assemble → Load → Step to trace.');
    appendConsole('Open CTMM Simulator for Kenneth side.');
    appendConsole('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
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
        const limitRaw = entry.limit >>> 0;
        const bFlag = (limitRaw >>> 31) & 1;
        const fFlag = (limitRaw >>> 30) & 1;
        const limitVal = limitRaw & 0x1FFFF;
        const bfBadge = (bFlag || fFlag) ? `<span class="mac-badge" style="background:${fFlag ? '#e67e22' : '#3498db'};color:#fff;font-size:10px;">${bFlag ? 'B' : ''}${fFlag ? 'F' : ''}</span>` : '';
        const nsName = NS_NAMES[i] || '';
        tr.innerHTML = `<td>${i}</td><td>${nsName}</td><td>${toHex32(entry.location)}</td><td>${toHex32(limitVal)}${bfBadge}</td><td>${version}</td><td>${toHex32(seals)}</td><td>${macBadge}</td><td>${gBadge}</td>`;
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
    sim.on('tunnel', (data) => {
        if (data.direction === 'send') {
            const displayMsg = data.message === 'HelloS' ? 'Hello Son' : data.message;
            const notification = {
                target: 'ctmm',
                message: displayMsg,
                timestamp: Date.now(),
                seen: false,
                details: {
                    from: '<b>Priscilla</b> (RV32-Cap Sim-32)',
                    to: '<b>Kenneth</b> (CTMM Sim-64)',
                    items: [
                        { label: 'Instruction', value: 'CALL(CONNECT(mymother, son))' },
                        { label: 'Golden Tokens', value: '3 (Tunnel Key + ABI + Reply Tunnel)' },
                        { label: 'ABI Mapping', value: 'x10-x15 (32-bit) \u2192 DR0-DR5 (64-bit)' },
                        { label: 'Payload', value: data.payload.map(c => String.fromCharCode(c & 0x7F)).join('') },
                        { label: 'Result', value: 'x10 = 1 (ACK \u2014 remote acknowledged)' }
                    ]
                }
            };
            localStorage.setItem('rv32cap-tunnel-notification', JSON.stringify(notification));
            appendConsole('[NOTIFICATION] "' + displayMsg + '" sent to Kenneth (CTMM) \u2014 notification posted');
        }
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
            programListing = result.listing || [];
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

let pendingTunnelMessages = [];

function formatTunnelTime(ts) {
    const d = ts ? new Date(ts) : new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
}

function escapeTunnelHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function checkTunnelNotifications() {
    const raw = localStorage.getItem('ctmm-tunnel-notification');
    if (!raw) return;
    try {
        const queue = JSON.parse(raw);
        if (!Array.isArray(queue)) return;
        let changed = false;
        for (const notif of queue) {
            if (notif && notif.target === 'rv32cap' && !notif.seen) {
                pendingTunnelMessages.push(notif);
                notif.seen = true;
                changed = true;
                appendConsole('[TUNNEL] Incoming message from Kenneth (CTMM) — click notification to view');
            }
        }
        if (changed) {
            const pruned = queue.filter(n => !n.seen || (Date.now() - (n.timestamp || 0)) < 300000);
            localStorage.setItem('ctmm-tunnel-notification', JSON.stringify(pruned));
            updateNotifyBadge();
        }
    } catch(e) {}
}

function updateNotifyBadge() {
    const btn = document.getElementById('btn-tunnel-notify');
    const badge = document.getElementById('tunnel-badge');
    if (!btn || !badge) return;
    if (pendingTunnelMessages.length > 0) {
        btn.style.display = 'inline-flex';
        badge.textContent = pendingTunnelMessages.length;
    } else {
        btn.style.display = 'none';
    }
}

function sendHelloSon() {
    const notification = {
        target: 'ctmm',
        message: 'Hello Son',
        timestamp: Date.now(),
        seen: false,
        details: {
            from: '<b>Priscilla</b> (RV32-Cap Sim-32)',
            to: '<b>Kenneth</b> (CTMM Sim-64)',
            items: [
                { label: 'Instruction', value: 'CALL(CONNECT(mymother, son))' },
                { label: 'Golden Tokens', value: '3 (Tunnel Key + ABI + Reply Tunnel)' },
                { label: 'ABI Mapping', value: 'x10-x15 (32-bit) \u2192 DR0-DR5 (64-bit)' },
                { label: 'Payload', value: 'HelloS (72,101,108,108,111,83)' },
                { label: 'Result', value: 'x10 = 1 (ACK \u2014 remote acknowledged)' }
            ]
        }
    };
    const existingQ = JSON.parse(localStorage.getItem('rv32cap-tunnel-notification') || '[]');
    const sendQ = Array.isArray(existingQ) ? existingQ : [];
    sendQ.push(notification);
    localStorage.setItem('rv32cap-tunnel-notification', JSON.stringify(sendQ));
    appendConsole('[TUNNEL] "Hello Son" sent to Kenneth (CTMM) via encrypted tunnel');
    appendConsole('[TUNNEL] Notification posted — Kenneth\'s CTMM page will show badge');
}

window.sendHelloSon = sendHelloSon;

function sendRv32Reply(replyText) {
    if (!replyText || !replyText.trim()) return;
    const notification = {
        target: 'ctmm',
        message: replyText.trim(),
        timestamp: Date.now(),
        seen: false,
        details: {
            from: '<b>Priscilla</b> (RV32-Cap Sim-32)',
            to: '<b>Kenneth</b> (CTMM Sim-64)',
            items: [
                { label: 'Instruction', value: 'CALL(CONNECT(mymother, son))' },
                { label: 'Golden Tokens', value: '3 (Tunnel Key + ABI + Reply Tunnel)' },
                { label: 'ABI Mapping', value: 'x10-x15 (32-bit) \u2192 DR0-DR5 (64-bit)' },
                { label: 'Type', value: 'Interactive tunnel reply' }
            ]
        }
    };
    const existingRQ = JSON.parse(localStorage.getItem('rv32cap-tunnel-notification') || '[]');
    const replyQ = Array.isArray(existingRQ) ? existingRQ : [];
    replyQ.push(notification);
    localStorage.setItem('rv32cap-tunnel-notification', JSON.stringify(replyQ));
    const overlay = document.getElementById('tunnelMsgOverlay');
    if (overlay) overlay.remove();
    appendConsole('[NOTIFICATION] "' + replyText.trim() + '" sent to Kenneth (CTMM)');
}

function showTunnelNotification() {
    if (pendingTunnelMessages.length === 0) return;
    const notif = pendingTunnelMessages.shift();
    updateNotifyBadge();

    const existing = document.getElementById('tunnelMsgOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'tunnelMsgOverlay';
    overlay.className = 'tunnel-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    const items = (notif.details && notif.details.items) || [
        { label: 'Instruction', value: 'CALL(CONNECT(me, mymother))' },
        { label: 'Golden Tokens', value: '3 (Tunnel Key + Service + ABI)' },
        { label: 'ABI Mapping', value: 'DR0-DR5 (64-bit) \u2192 x10-x15 (32-bit)' }
    ];
    const from = (notif.details && notif.details.from) || '<b>Kenneth</b> (CTMM Sim-64)';
    const to = (notif.details && notif.details.to) || '<b>Priscilla</b> (RV32-Cap Sim-32)';
    const message = notif.message || 'Hello Mum';
    const safeMessage = escapeTunnelHtml(message);
    const timeStr = formatTunnelTime(notif.timestamp);

    overlay.innerHTML = `
        <div class="tunnel-msg-panel">
            <div class="tunnel-msg-header">
                <span class="tunnel-msg-icon">&#x1F4E5;</span>
                <span>Message Received via Encrypted Tunnel</span>
                <button class="tunnel-msg-close" onclick="document.getElementById('tunnelMsgOverlay').remove()">&times;</button>
            </div>
            <div class="tunnel-msg-body">
                <div class="tunnel-msg-timestamp">${timeStr}</div>
                <div class="tunnel-msg-payload${message.length > 30 ? ' tunnel-long-msg' : ''}">"${safeMessage}"</div>
                <div class="tunnel-reply-section">
                    <input type="text" class="tunnel-reply-input" id="tunnelReplyInput" placeholder="Type a reply to Kenneth..." maxlength="200">
                    <button class="tunnel-reply-btn" onclick="sendRv32Reply(document.getElementById('tunnelReplyInput').value)">Send Reply</button>
                </div>
                <div class="tunnel-msg-flow">
                    ${from} <span style="color:#42a5f5;font-size:1.5em">&rarr;</span> ${to}
                </div>
                <div class="tunnel-msg-details">
                    ${items.map(item => `<div class="tunnel-detail-row"><span class="tunnel-detail-label">${item.label}</span><span class="tunnel-detail-value">${item.value}</span></div>`).join('')}
                </div>
                <div class="tunnel-msg-zeroes">
                    <span style="color: #42a5f5">7 Zeroes:</span> No OS, No VM, No privilege, No superuser, No unauthorized code, No unauthorized data, No containment escape
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    const input = document.getElementById('tunnelReplyInput');
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') sendRv32Reply(input.value);
        });
    }
}

window.addEventListener('storage', (e) => {
    if (e.key === 'ctmm-tunnel-notification') {
        checkTunnelNotifications();
    }
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        checkTunnelNotifications();
        setInterval(checkTunnelNotifications, 2000);
    });
} else {
    checkTunnelNotifications();
    setInterval(checkTunnelNotifications, 2000);
}
