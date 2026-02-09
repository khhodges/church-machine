let sim = null;
let asm = null;
let runInterval = null;

const ABI_NAMES = ['zero','ra','sp','gp','tp','t0','t1','t2','s0','s1',
    'a0','a1','a2','a3','a4','a5','a6','a7',
    's2','s3','s4','s5','s6','s7','s8','s9','s10','s11',
    't3','t4','t5','t6'];

const CR_LABELS = {6:'C-List', 7:'Nucleus', 8:'Thread', 15:'Namespace'};

function toHex32(val) {
    return '0x' + ((val >>> 0).toString(16)).padStart(8, '0');
}

function switchView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.btn-view').forEach(b => b.classList.remove('active'));
    document.getElementById('view-' + viewName).classList.add('active');
    document.querySelectorAll('.btn-view').forEach(b => {
        if (b.textContent.toLowerCase().includes(viewName.substring(0, 4))) b.classList.add('active');
    });
    if (viewName === 'dashboard') updateUI();
    if (viewName === 'namespace') updateNamespaceView();
    if (viewName === 'capabilities') updateCapabilitiesView();
}

function doReset() {
    stopRun();
    sim.reset();
    clearConsole();
    updateUI();
    switchView('dashboard');
}

function doStep() {
    stopRun();
    const result = sim.step();
    if (result && result.disasm) {
        appendConsole(`[${sim.stepCount}] ${toHex32(sim.pc - 4)}: ${result.disasm}`);
    }
    updateUI();
    switchView('dashboard');
}

function doRun() {
    if (runInterval) return;
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

function updateUI() {
    updateRegisters();
    updateCRDisplay();
    updatePC();
    updateStepCount();
    updateBootStatus();
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
        const permNames = ['R','W','X','L','S','E','B','M','F','G'];
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
    clearConsole();
    appendConsole(`Loaded ${result.bytes.length} bytes`);
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
    ecall                 # halt`
    };

    const editor = document.getElementById('asm-editor');
    if (examples[name]) {
        editor.value = examples[name];
        localStorage.setItem('rv32cap-asm', editor.value);
    }
}

function updateNamespaceView() {
    const tbody = document.getElementById('ns-table-body');
    tbody.innerHTML = '';
    sim.namespaceTable.forEach((entry, i) => {
        if (!entry) return;
        const tr = document.createElement('tr');
        const version = (entry.versionSeals >>> 27) & 0x1F;
        const seals = entry.versionSeals & 0x07FFFFFF;
        tr.innerHTML = `<td>${i}</td><td>${toHex32(entry.location)}</td><td>${toHex32(entry.limit)}</td><td>${version}</td><td>${toHex32(seals)}</td>`;
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
    html += `<div class="gt-field gt-version" style="width:15.625%"><div class="gt-field-label">Version</div><div class="gt-field-value">${gt.version}</div><div class="gt-field-bits">[31:27]</div></div>`;
    html += `<div class="gt-field gt-index" style="width:46.875%"><div class="gt-field-label">Index</div><div class="gt-field-value">${gt.index}</div><div class="gt-field-bits">[26:12]</div></div>`;
    html += `<div class="gt-field gt-perms" style="width:31.25%"><div class="gt-field-label">Permissions</div><div class="gt-field-value">${((cr.word0 >> 2) & 0x3FF).toString(2).padStart(10, '0')}</div><div class="gt-field-bits">[11:2]</div></div>`;
    html += `<div class="gt-field gt-type" style="width:6.25%"><div class="gt-field-label">Type</div><div class="gt-field-value">${gt.type}</div><div class="gt-field-bits">[1:0]</div></div>`;
    html += '</div>';
    diagram.innerHTML = html;

    const permDisplay = document.getElementById('perm-display');
    const permNames = ['R','W','X','L','S','E','B','M','F','G'];
    const permDescriptions = {
        R:'Read data', W:'Write data', X:'Execute code',
        L:'Load capability', S:'Save capability', E:'Enter abstraction',
        B:'Bound check', M:'Machine level', F:'Foreign/remote', G:'Garbage collection'
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
    if (savedAsm) document.getElementById('asm-editor').value = savedAsm;

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
