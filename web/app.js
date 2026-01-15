function switchView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
}

function generateGoldenKey() {
    let key = '';
    for (let i = 0; i < 48; i++) {
        key += Math.floor(Math.random() * 16).toString(16).toUpperCase();
    }
    return key.match(/.{1,8}/g).join('-');
}

// ==================== GOLDEN TOKEN (64-bit) STRUCTURE ====================
// Bits 0-31:  Offset (index into Namespace Table)
// Bits 32-47: Permissions (R/W/X/L/S/E/B on/off bits)
// Bits 48-63: Spare (future flags or Thread ID)

const PERM_BITS = {
    R: 0x0001, W: 0x0002, X: 0x0004, L: 0x0008,
    S: 0x0010, E: 0x0020, B: 0x0040
};

function encodeGoldenToken(offset, perms, spare = 0) {
    let permBits = 0;
    perms.forEach(p => { permBits |= (PERM_BITS[p] || 0); });
    const gt = BigInt(offset & 0xFFFFFFFF) |
               (BigInt(permBits & 0xFFFF) << BigInt(32)) |
               (BigInt(spare & 0xFFFF) << BigInt(48));
    return gt;
}

function decodeGoldenToken(gt) {
    const bigGT = BigInt(gt);
    const offset = Number(bigGT & BigInt(0xFFFFFFFF));
    const permBits = Number((bigGT >> BigInt(32)) & BigInt(0xFFFF));
    const spare = Number((bigGT >> BigInt(48)) & BigInt(0xFFFF));
    
    const perms = [];
    Object.entries(PERM_BITS).forEach(([p, bit]) => {
        if (permBits & bit) perms.push(p);
    });
    
    return { offset, perms, permBits, spare };
}

function formatGTHex(gt) {
    return '0x' + BigInt(gt).toString(16).toUpperCase().padStart(16, '0');
}

function formatGTBinary(gt) {
    return BigInt(gt).toString(2).padStart(64, '0');
}

// ==================== NAMESPACE ENTRY (3-word triplet) ====================
// Word 1: Location (Physical RAM address OR URL)
// Word 2: Limit (Object size in bytes/words)
// Word 3: Seals = MetaData[0:31] + Type[32:47] + MAC[48:63]
// MAC = Hash(GT_Offset + W1 + W2 + W3_Meta)

const OBJECT_TYPES = {
    0x0000: 'Null',
    0x0001: 'Data',
    0x0002: 'Code',
    0x0003: 'Thread',
    0x0004: 'Abstraction',
    0x0005: 'CList',
    0x0006: 'Function'
};

function createNamespaceEntry(location, limit, type, metadata = 0) {
    const typeCode = Object.entries(OBJECT_TYPES).find(([k, v]) => v === type)?.[0] || 0x0004;
    return {
        word1_location: BigInt(location),
        word2_limit: BigInt(limit),
        word3_seals: BigInt(metadata & 0xFFFFFFFF) | (BigInt(typeCode) << BigInt(32)),
        type: type,
        metadata: metadata
    };
}

function simpleHash(values) {
    let hash = BigInt(0x5A5A5A5A);
    values.forEach(v => {
        const bigV = BigInt(v);
        hash = hash ^ bigV;
        hash = ((hash << BigInt(13)) | (hash >> BigInt(51))) & BigInt(0xFFFFFFFFFFFFFFFF);
        hash = (hash * BigInt(0x9E3779B9)) & BigInt(0xFFFFFFFFFFFFFFFF);
    });
    return Number((hash >> BigInt(48)) & BigInt(0xFFFF));
}

function calculateMAC(gtOffset, nsEntry) {
    const w3Meta = Number(nsEntry.word3_seals & BigInt(0xFFFFFFFF));
    return simpleHash([gtOffset, Number(nsEntry.word1_location), Number(nsEntry.word2_limit), w3Meta]);
}

function setMACInSeals(nsEntry, mac) {
    nsEntry.word3_seals = (nsEntry.word3_seals & BigInt(0x0000FFFFFFFFFFFF)) | (BigInt(mac) << BigInt(48));
    return nsEntry;
}

function getMACFromSeals(nsEntry) {
    return Number((nsEntry.word3_seals >> BigInt(48)) & BigInt(0xFFFF));
}

function validateMAC(gtOffset, nsEntry) {
    const storedMAC = getMACFromSeals(nsEntry);
    const calculatedMAC = calculateMAC(gtOffset, nsEntry);
    return { valid: storedMAC === calculatedMAC, stored: storedMAC, calculated: calculatedMAC };
}

function getTypeFromSeals(nsEntry) {
    const typeCode = Number((nsEntry.word3_seals >> BigInt(32)) & BigInt(0xFFFF));
    return OBJECT_TYPES[typeCode] || 'Unknown';
}

function formatWord(value) {
    return '0x' + BigInt(value).toString(16).toUpperCase().padStart(16, '0');
}

// ==================== BOOT NAMESPACE ====================

const bootNamespace = {
    name: "Boot",
    location: 0x0000,
    description: "Root abstraction of the CTMM system",
    clist: [
        { name: "Kenneth", type: "Thread", ref: "threads.kenneth" },
        { name: "Matthew", type: "Thread", ref: "threads.matthew" },
        { name: "Daniel", type: "Thread", ref: "threads.daniel" },
        { name: "SlideRule", type: "Abstraction", ref: "abstractions.sliderule" },
        { name: "Abacus", type: "Abstraction", ref: "abstractions.abacus" }
    ]
};

const namespaceObjects = [
    { location: 0x0000, name: "Boot", type: "Abstraction", perms: ["R", "L", "S", "E", "B"], size: 4096 },
    { location: 0x2000, name: "Kenneth", type: "Thread", perms: ["R", "W", "E"], size: 1024 },
    { location: 0x3000, name: "Matthew", type: "Thread", perms: ["R", "W", "E"], size: 1024 },
    { location: 0x4000, name: "Daniel", type: "Thread", perms: ["R", "W", "E"], size: 1024 },
    { location: 0x5000, name: "SlideRule", type: "Abstraction", perms: ["R", "L", "E"], size: 2048 },
    { location: 0x6000, name: "Abacus", type: "Abstraction", perms: ["R", "L", "E"], size: 2048 }
];

const threadCLists = {
    Kenneth: {
        name: "Kenneth",
        description: "User thread with access to math abstractions",
        clist: [
            { name: "SlideRule", type: "Abstraction", perms: ["R", "L", "E"] },
            { name: "Abacus", type: "Abstraction", perms: ["R", "L", "E"] },
            { name: "LocalData", type: "Data", perms: ["R", "W"] }
        ]
    },
    Matthew: {
        name: "Matthew",
        description: "User thread with limited access",
        clist: [
            { name: "Abacus", type: "Abstraction", perms: ["R", "E"] },
            { name: "LocalData", type: "Data", perms: ["R", "W"] }
        ]
    },
    Daniel: {
        name: "Daniel",
        description: "User thread with SlideRule access",
        clist: [
            { name: "SlideRule", type: "Abstraction", perms: ["R", "E"] },
            { name: "LocalData", type: "Data", perms: ["R", "W"] }
        ]
    }
};

const abstractionCLists = {
    SlideRule: {
        name: "SlideRule",
        description: "Logarithmic math operations abstraction",
        clist: [
            { name: "GT_ADD", type: "Function", perms: ["R", "X", "E"], desc: "Addition" },
            { name: "GT_SUB", type: "Function", perms: ["R", "X", "E"], desc: "Subtraction" },
            { name: "GT_MUL", type: "Function", perms: ["R", "X", "E"], desc: "Multiplication" },
            { name: "GT_DIV", type: "Function", perms: ["R", "X", "E"], desc: "Division" },
            { name: "GT_LOG", type: "Function", perms: ["R", "X", "E"], desc: "Logarithm" },
            { name: "GT_EXP", type: "Function", perms: ["R", "X", "E"], desc: "Exponent" },
            { name: "GT_SQRT", type: "Function", perms: ["R", "X", "E"], desc: "Square Root" },
            { name: "GT_POW", type: "Function", perms: ["R", "X", "E"], desc: "Power" },
            { name: "LocalCode", type: "Code", perms: ["R", "X"] },
            { name: "LocalData", type: "Data", perms: ["R", "W"] }
        ]
    },
    Abacus: {
        name: "Abacus",
        description: "Integer arithmetic operations abstraction",
        clist: [
            { name: "GT_ADD", type: "Function", perms: ["R", "X", "E"], desc: "Integer Add" },
            { name: "GT_SUB", type: "Function", perms: ["R", "X", "E"], desc: "Integer Subtract" },
            { name: "GT_MUL", type: "Function", perms: ["R", "X", "E"], desc: "Integer Multiply" },
            { name: "GT_DIV", type: "Function", perms: ["R", "X", "E"], desc: "Integer Divide" },
            { name: "GT_MOD", type: "Function", perms: ["R", "X", "E"], desc: "Modulo" },
            { name: "GT_ABS", type: "Function", perms: ["R", "X", "E"], desc: "Absolute Value" },
            { name: "GT_NEG", type: "Function", perms: ["R", "X", "E"], desc: "Negate" },
            { name: "GT_INC", type: "Function", perms: ["R", "X", "E"], desc: "Increment" },
            { name: "GT_DEC", type: "Function", perms: ["R", "X", "E"], desc: "Decrement" },
            { name: "LocalCode", type: "Code", perms: ["R", "X"] },
            { name: "LocalData", type: "Data", perms: ["R", "W"] }
        ]
    }
};

// ==================== BOOT SEQUENCE ====================

let bootState = {
    step: 0,
    complete: false
};

const bootSteps = [
    {
        name: "Hardware Reset",
        description: "Power energized. Clearing all registers to NULL...",
        action: () => {
            simulator.reset();
        }
    },
    {
        name: "Load Namespace",
        description: "Setting CR15 with Boot namespace capability...",
        action: () => {
            const bootObj = namespaceObjects.find(o => o.name === "Boot");
            simulator.cr15 = {
                name: "Boot",
                location: { type: "Local", offset: 0x0000 },
                perms: bootObj ? bootObj.perms : ["R", "L", "S", "E", "B"],
                locked: true,
                goldenKey: generateGoldenKey(),
                clist: bootNamespace.clist
            };
            updateNamespaceDisplay();
        }
    },
    {
        name: "Initialize Thread",
        description: "Creating Kenneth thread capability in CR8...",
        action: () => {
            const kennethObj = namespaceObjects.find(o => o.name === "Kenneth");
            simulator.cr8 = {
                name: "Kenneth",
                location: { type: "Local", offset: 0x1000 },
                perms: kennethObj ? kennethObj.perms : ["R", "W", "E"],
                locked: false,
                goldenKey: generateGoldenKey(),
                clist: threadCLists.Kenneth.clist
            };
            simulator.contextRegs[6] = {
                name: "C-LIST",
                location: { type: "Local", offset: 0x500 },
                perms: ["R", "L", "S"],
                locked: false,
                goldenKey: generateGoldenKey()
            };
            updateNamespaceDisplay();
        }
    },
    {
        name: "Load Nucleus",
        description: "Loading kernel code capability into CR7...",
        action: () => {
            simulator.contextRegs[7] = {
                name: "NUCLEUS",
                location: { type: "Literal", name: "kernel.code" },
                perms: ["R", "X", "E"],
                locked: true,
                goldenKey: generateGoldenKey()
            };
        }
    }
];

function stepInstruction() {
    if (bootState.step < 4) {
        executeBootStep(bootState.step);
        bootState.step++;
        updateBootDisplay();
        updateDisplay();
        updateCapabilityExplorer();
        
        if (bootState.step >= 4) {
            bootState.complete = true;
            log('Boot sequence complete - system ready', 'success');
        }
    } else {
        log('System already booted. Use Reset to restart.', 'info');
    }
}

function executeBootStep(stepNum) {
    const step = bootSteps[stepNum];
    step.action();
    log(`[BOOT ${stepNum + 1}] ${step.name}: ${step.description}`, 'info');
}

function updateBootDisplay() {
    for (let i = 1; i <= 4; i++) {
        const el = document.getElementById(`bootStep${i}`);
        if (!el) continue;
        
        el.classList.remove('active', 'done');
        if (i < bootState.step) {
            el.classList.add('done');
        } else if (i === bootState.step) {
            el.classList.add('active');
        }
    }
    
    const status = document.getElementById('bootStatus');
    if (status) {
        if (bootState.step === 0) {
            status.textContent = 'Press Step to begin boot sequence';
        } else if (bootState.step < 4) {
            status.textContent = bootSteps[bootState.step - 1].description;
        } else {
            status.textContent = 'Boot complete - System ready';
            status.style.color = 'var(--success)';
        }
    }
}

function resetCPU() {
    simulator.reset();
    bootState.step = 0;
    bootState.complete = false;
    updateBootDisplay();
    updateDisplay();
    updateCapabilityExplorer();
    updateNamespaceDisplay();
    log('System reset - all registers cleared', 'info');
}

function updateNamespaceDisplay() {
    const nsPanel = document.getElementById('namespaceList');
    const hierPanel = document.getElementById('hierarchyTree');
    if (!nsPanel || !hierPanel) return;
    
    if (!simulator.cr15 || simulator.cr15.name === 'NULL') {
        nsPanel.innerHTML = '<div class="ns-empty">Namespace not loaded</div>';
        hierPanel.innerHTML = '<div class="ns-empty">Boot system to view hierarchy</div>';
        return;
    }
    
    let nsHtml = '<div class="ns-header">Namespace Objects (CR15: ' + simulator.cr15.name + ')</div>';
    const typeTooltips = {
        'Root': 'Root namespace abstraction containing the entire Boot system.',
        'Thread': 'User identity with its own C-List of capabilities.',
        'Abstraction': 'Protected object containing function Golden Tokens.'
    };
    
    const allObjects = [...namespaceObjects, ...dynamicObjects];
    allObjects.forEach(obj => {
        const permStr = obj.perms.join('');
        const typeClass = obj.type.toLowerCase().replace('-', '');
        const tooltip = typeTooltips[obj.type] || 'Namespace object with capability-controlled access.';
        const dynamicTag = obj.dynamic ? ' <span class="ns-dynamic-tag">(custom)</span>' : '';
        nsHtml += `
            <div class="ns-object ns-${typeClass}" data-name="${obj.name}" data-type="${obj.type}" data-tooltip="${tooltip}">
                <div class="ns-obj-header">
                    <span class="ns-obj-name">${obj.name}${dynamicTag}</span>
                    <span class="ns-obj-type">${obj.type}</span>
                </div>
                <div class="ns-obj-details">
                    <span class="ns-obj-loc" data-tooltip="Memory location address">0x${obj.location.toString(16).toUpperCase().padStart(4, '0')}</span>
                    <span class="ns-obj-size" data-tooltip="Object size in bytes">${obj.size}B</span>
                    <span class="ns-obj-perms" data-tooltip="Permission flags: R=Read, W=Write, X=Execute, L=Load, S=Store, E=Enter, B=Bind">${permStr}</span>
                </div>
            </div>
        `;
    });
    nsPanel.innerHTML = nsHtml;
    
    hierPanel.innerHTML = buildHierarchyTree();
    
    attachContextMenuListeners();
}

function renderDynamicChildren(parentName) {
    let html = '';
    const children = dynamicObjects.filter(o => o.parent === parentName);
    const clistChildren = dynamicCLists[parentName] || [];
    
    if (children.length === 0 && clistChildren.length === 0) return '';
    
    html += '<div class="hier-clist">';
    
    clistChildren.forEach(item => {
        html += `<div class="hier-item hier-gt" data-name="${item.name}" data-type="${item.type}" data-tooltip="Linked: ${item.name}">${item.name}</div>`;
    });
    
    children.forEach(obj => {
        html += `<div class="hier-item" data-name="${obj.name}" data-type="${obj.type}">`;
        html += `<div class="hier-node hier-dynamic" data-tooltip="Custom object: ${obj.type}">`;
        html += `<div class="hier-label">${obj.name} <span class="hier-custom-tag">(custom)</span></div>`;
        html += '</div>';
        html += renderDynamicChildren(obj.name);
        html += '</div>';
    });
    
    html += '</div>';
    return html;
}

function buildHierarchyTree() {
    let html = '<div class="hier-item" data-name="Boot" data-type="Root">';
    html += '<div class="hier-node hier-root" data-tooltip="Root namespace abstraction. Contains all threads and protected abstractions.">';
    html += '<div class="hier-label">Boot</div>';
    html += '</div>';
    html += '<div class="hier-children">';
    
    html += '<div class="hier-group">';
    html += '<div class="hier-group-label" data-tooltip="User identities that can execute code with their own C-List permissions.">Threads</div>';
    ['Kenneth', 'Matthew', 'Daniel'].forEach(name => {
        const isActive = simulator.cr8 && simulator.cr8.name === name;
        const activeText = isActive ? ' (ACTIVE - currently executing)' : '';
        html += `<div class="hier-item" data-name="${name}" data-type="Thread">`;
        html += `<div class="hier-node hier-thread ${isActive ? 'hier-active' : ''}" data-tooltip="User identity with its own C-List of capabilities.${activeText}">`;
        html += `<div class="hier-label">${name}</div>`;
        html += '</div>';
        if (threadCLists[name]) {
            html += '<div class="hier-clist">';
            threadCLists[name].clist.forEach(item => {
                html += `<div class="hier-item hier-gt" data-name="${item.name}" data-type="${item.type}" data-tooltip="Golden Token granting access to ${item.name}.">${item.name}</div>`;
            });
            html += '</div>';
        }
        html += renderDynamicChildren(name);
        html += '</div>';
    });
    html += '</div>';
    
    html += '<div class="hier-group">';
    html += '<div class="hier-group-label" data-tooltip="Protected objects containing function Golden Tokens.">Abstractions</div>';
    const abstractionDescs = {
        'SlideRule': 'Floating-point math functions (ADD, SUB, MUL, DIV, LOG, EXP, SQRT, POW)',
        'Abacus': 'Integer math functions (ADD, SUB, MUL, DIV, MOD, ABS, NEG, INC, DEC)'
    };
    ['SlideRule', 'Abacus'].forEach(name => {
        html += `<div class="hier-item" data-name="${name}" data-type="Abstraction">`;
        html += `<div class="hier-node hier-abstraction" data-tooltip="${abstractionDescs[name]}">`;
        html += `<div class="hier-label">${name}</div>`;
        html += '</div>';
        if (abstractionCLists[name]) {
            html += '<div class="hier-clist">';
            abstractionCLists[name].clist.forEach(item => {
                if (item.type === 'Function') {
                    html += `<div class="hier-item hier-gt hier-func" data-name="${item.name}" data-type="Function" data-tooltip="Golden Token granting permission to invoke ${item.name} function.">${item.name}</div>`;
                }
            });
            html += '</div>';
        }
        html += renderDynamicChildren(name);
        html += '</div>';
    });
    
    html += '<div class="hier-group-label" data-tooltip="User-created objects in the Boot namespace.">Custom Objects</div>';
    dynamicObjects.filter(obj => obj.parent === 'Boot').forEach(obj => {
        html += `<div class="hier-item" data-name="${obj.name}" data-type="${obj.type}">`;
        html += `<div class="hier-node hier-dynamic" data-tooltip="Custom object: ${obj.type}">`;
        html += `<div class="hier-label">${obj.name} <span class="hier-custom-tag">(custom)</span></div>`;
        html += '</div>';
        html += renderDynamicChildren(obj.name);
        html += '</div>';
    });
    html += '</div>';
    
    html += '</div></div>';
    return html;
}

function updateDisplay() {
    updateContextRegisters();
    updateDataRegisters();
    updateSystemState();
    updateFlags();
}

const crTooltips = {
    0: 'General-purpose capability register. Holds Golden Tokens for accessing protected resources.',
    1: 'General-purpose capability register. Holds Golden Tokens for accessing protected resources.',
    2: 'General-purpose capability register. Holds Golden Tokens for accessing protected resources.',
    3: 'General-purpose capability register. Holds Golden Tokens for accessing protected resources.',
    4: 'General-purpose capability register. Holds Golden Tokens for accessing protected resources.',
    5: 'General-purpose capability register. Holds Golden Tokens for accessing protected resources.',
    6: 'C-LIST LCA: Lowest Common Ancestor pointer. References the capability list for current context.',
    7: 'NUCLEUS: Hardware protection ring. Contains the trusted kernel capability.'
};

function updateContextRegisters() {
    const container = document.getElementById('contextRegs');
    container.innerHTML = '';
    
    const roles = {
        6: 'C-LIST LCA',
        7: 'NUCLEUS'
    };
    
    for (let i = 0; i < 6; i++) {
        const reg = simulator.contextRegs[i];
        const isNull = reg.name === 'NULL';
        const role = 'GENERAL';
        const tooltip = crTooltips[i];
        const permTooltip = reg.perms.length > 0 ? 
            `Permissions: ${reg.perms.map(p => {
                const permNames = {R:'Read', W:'Write', X:'Execute', L:'Load', S:'Store', E:'Enter', B:'Bind'};
                return permNames[p] || p;
            }).join(', ')}` : 'No capability loaded. Register is empty.';
        
        const row = document.createElement('div');
        row.className = `register-row ${isNull ? 'null' : ''}`;
        row.setAttribute('data-tooltip', tooltip);
        row.innerHTML = `
            <span class="name">CR${i}</span>
            <span class="role">${role}</span>
            <span class="value">${reg.name}</span>
            <span class="perms" data-tooltip="${permTooltip}">${reg.perms.join('') || '---'}</span>
        `;
        container.appendChild(row);
    }
}

let dataRegPage = 0;

function showDataRegPage(page) {
    dataRegPage = page;
    updateDataRegisters();
    
    const prevBtn = document.getElementById('drPrev');
    const nextBtn = document.getElementById('drNext');
    const label = document.getElementById('drPageLabel');
    
    if (page === 0) {
        prevBtn.disabled = true;
        nextBtn.disabled = false;
        label.textContent = '0-7';
    } else {
        prevBtn.disabled = false;
        nextBtn.disabled = true;
        label.textContent = '8-15';
    }
}

function updateDataRegisters() {
    const container = document.getElementById('dataRegs');
    container.innerHTML = '';
    
    const startIdx = dataRegPage * 8;
    const endIdx = startIdx + 8;
    
    for (let i = startIdx; i < endIdx; i++) {
        const value = simulator.dataRegs[i];
        const hexStr = value.toString(16).toUpperCase().padStart(16, '0');
        
        const row = document.createElement('div');
        row.className = 'register-row';
        row.setAttribute('data-tooltip', '64-bit data register. Holds numeric values for arithmetic operations.');
        row.innerHTML = `
            <span class="name">DR${i}</span>
            <span class="value">0x${hexStr}</span>
        `;
        container.appendChild(row);
    }
}

function updateSystemState() {
    document.getElementById('cr15Name').textContent = simulator.cr15.name;
    document.getElementById('cr8Name').textContent = simulator.cr8.name;
    document.getElementById('cr6Name').textContent = simulator.contextRegs[6]?.name || 'NULL';
    document.getElementById('cr7NameDisplay').textContent = simulator.contextRegs[7]?.name || 'NULL';
    document.getElementById('ipValue').textContent = simulator.ip;
    document.getElementById('stackDepth').textContent = simulator.stackDepth;
}

function updateFlags() {
    const flagIds = ['flagN', 'flagZ', 'flagC', 'flagV'];
    const flagNames = ['N', 'Z', 'C', 'V'];
    
    flagIds.forEach((id, i) => {
        const el = document.getElementById(id);
        if (simulator.flags[flagNames[i]]) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });
    
    const flagP = document.getElementById('flagP');
    const flagB = document.getElementById('flagB');
    if (flagP) {
        if (simulator.flags.C) {
            flagP.classList.add('active');
        } else {
            flagP.classList.remove('active');
        }
    }
    if (flagB) {
        if (simulator.flags.V) {
            flagB.classList.add('active');
        } else {
            flagB.classList.remove('active');
        }
    }
}

function log(message, type = 'info') {
    const logContainer = document.getElementById('outputLog');
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = `> ${message}`;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
}

function runBootSequence() {
    if (bootState.complete) {
        log('System already booted. Use Reset to restart.', 'info');
        return;
    }
    while (bootState.step < 4) {
        executeBootStep(bootState.step);
        bootState.step++;
    }
    bootState.complete = true;
    updateBootDisplay();
    updateDisplay();
    updateCapabilityExplorer();
    log('Boot sequence complete - system ready', 'success');
}

const instructionInfo = {
    ADD: { operands: ['dest', 'src'], help: 'DR[dest] = DR[dest] + DR[src]. Sets NZCV flags.' },
    SUB: { operands: ['dest', 'src'], help: 'DR[dest] = DR[dest] - DR[src]. Sets NZCV flags.' },
    MUL: { operands: ['dest', 'src'], help: 'DR[dest] = DR[dest] * DR[src]. Sets N, Z flags.' },
    NEG: { operands: ['dest', 'src'], help: 'DR[dest] = -DR[src] (two\'s complement negate). Sets NZCV flags.' },
    ADDI: { operands: ['dest', 'immediate'], help: 'DR[dest] = DR[dest] + immediate. Sets NZCV flags.' },
    SUBI: { operands: ['dest', 'immediate'], help: 'DR[dest] = DR[dest] - immediate. Sets NZCV flags.' },
    MOV: { operands: ['dest', 'src'], help: 'DR[dest] = DR[src]. Sets N, Z flags.' },
    MVN: { operands: ['dest', 'src'], help: 'DR[dest] = NOT DR[src] (bitwise). Sets N, Z flags.' },
    AND: { operands: ['dest', 'src'], help: 'DR[dest] = DR[dest] AND DR[src]. Sets N, Z flags.' },
    ORR: { operands: ['dest', 'src'], help: 'DR[dest] = DR[dest] OR DR[src]. Sets N, Z flags.' },
    EOR: { operands: ['dest', 'src'], help: 'DR[dest] = DR[dest] XOR DR[src]. Sets N, Z flags.' },
    BIC: { operands: ['dest', 'src'], help: 'DR[dest] = DR[dest] AND (NOT DR[src]). Bit clear. Sets N, Z flags.' },
    NOT: { operands: ['dest', 'src'], help: 'DR[dest] = NOT DR[src]. Sets N, Z flags.' },
    LSL: { operands: ['dest', 'src', 'amount'], help: 'Logical shift left. DR[dest] = DR[src] << amount. Sets N, Z, C flags.' },
    LSR: { operands: ['dest', 'src', 'amount'], help: 'Logical shift right. DR[dest] = DR[src] >> amount. Sets N, Z, C flags.' },
    ASR: { operands: ['dest', 'src', 'amount'], help: 'Arithmetic shift right (sign extends). Sets N, Z, C flags.' },
    ROR: { operands: ['dest', 'src', 'amount'], help: 'Rotate right. Bits that fall off wrap around. Sets N, Z, C flags.' },
    CMP: { operands: ['reg1', 'reg2'], help: 'Compare DR[reg1] - DR[reg2]. Sets flags only, no result stored.' },
    CMN: { operands: ['reg1', 'reg2'], help: 'Compare negative DR[reg1] + DR[reg2]. Sets flags only.' },
    TST: { operands: ['reg1', 'reg2'], help: 'Test bits DR[reg1] AND DR[reg2]. Sets N, Z flags only.' },
    TEQ: { operands: ['reg1', 'reg2'], help: 'Test equal DR[reg1] XOR DR[reg2]. Sets N, Z flags only.' },
    TPERM: { operands: ['cr', 'mask', 'bounds'], help: 'Test if CR has permissions in mask. Optional BOUNDS check. Sets Z=1 if pass.', isCap: true },
    B: { operands: ['condition', 'offset'], help: 'Branch to offset. Use condition code (EQ/NE/GT/LT/etc) or leave empty.', isBranch: true },
    BL: { operands: ['offset'], help: 'Branch with Link. Saves return address to DR7, then jumps to offset.', isBranch: true },
    LOAD: { operands: ['destCR', 'srcCR', 'index'], help: 'Load capability at index via CR[src] into CR[dest]. Requires Load permission.', isCap: true },
    SAVE: { operands: ['destCR', 'srcDR'], help: 'Save DR[src] to location via CR[dest]. Requires Save permission.', isCap: true },
    CALL: { operands: ['cr'], help: 'Call procedure in CR[reg]. Requires Enter permission. Pushes return frame.', isCap: true },
    RETURN: { operands: [], help: 'Return from procedure. Pops stack frame and restores CR6, CR7, IP.', isCap: true },
    CHANGE: { operands: ['offset'], help: 'Switch to thread at scope offset. Changes CR8 (Thread).', isCap: true },
    SWITCH: { operands: ['cr'], help: 'Set CR15 (Namespace) to capability in CR[reg]. Requires Load permission.', isCap: true }
};

function updateInstrHelp() {
    const instr = document.getElementById('instrSelect').value;
    const info = instructionInfo[instr];
    
    const operandContainer = document.getElementById('operandInputs');
    operandContainer.innerHTML = '';
    
    info.operands.forEach((op, i) => {
        if (op === 'immediate' || op === 'amount' || op === 'offset' || op === 'index') {
            const input = document.createElement('input');
            input.type = 'number';
            input.id = `operand${i}`;
            input.placeholder = op;
            input.value = op === 'amount' ? '1' : '0';
            operandContainer.appendChild(input);
        } else if (op === 'condition') {
            const select = document.createElement('select');
            select.id = `operand${i}`;
            const conditions = ['(none)', 'EQ', 'NE', 'CS', 'CC', 'MI', 'PL', 'VS', 'VC', 'HI', 'LS', 'GE', 'LT', 'GT', 'LE'];
            conditions.forEach(c => {
                const option = document.createElement('option');
                option.value = c === '(none)' ? '' : c;
                option.textContent = c;
                select.appendChild(option);
            });
            operandContainer.appendChild(select);
        } else if (op === 'mask') {
            const input = document.createElement('input');
            input.type = 'text';
            input.id = `operand${i}`;
            input.placeholder = 'e.g., RW, LSE, RWXLSEB';
            input.value = 'RW';
            input.style.width = '120px';
            operandContainer.appendChild(input);
        } else if (op === 'bounds') {
            const input = document.createElement('input');
            input.type = 'number';
            input.id = `operand${i}`;
            input.placeholder = 'bounds (optional)';
            input.value = '';
            input.style.width = '100px';
            operandContainer.appendChild(input);
        } else if (op === 'cr' || op === 'destCR' || op === 'srcCR') {
            const select = document.createElement('select');
            select.id = `operand${i}`;
            for (let r = 0; r < 8; r++) {
                const option = document.createElement('option');
                option.value = r;
                option.textContent = `CR${r}`;
                select.appendChild(option);
            }
            const opt8 = document.createElement('option');
            opt8.value = 8;
            opt8.textContent = 'CR8 (Thread)';
            select.appendChild(opt8);
            const opt15 = document.createElement('option');
            opt15.value = 15;
            opt15.textContent = 'CR15 (Namespace)';
            select.appendChild(opt15);
            if (i === 1) select.value = '1';
            operandContainer.appendChild(select);
        } else if (op === 'srcDR') {
            const select = document.createElement('select');
            select.id = `operand${i}`;
            for (let r = 0; r < 8; r++) {
                const option = document.createElement('option');
                option.value = r;
                option.textContent = `DR${r}`;
                select.appendChild(option);
            }
            operandContainer.appendChild(select);
        } else {
            const select = document.createElement('select');
            select.id = `operand${i}`;
            for (let r = 0; r < 8; r++) {
                const option = document.createElement('option');
                option.value = r;
                option.textContent = `DR${r}`;
                select.appendChild(option);
            }
            if (i === 1) select.value = '1';
            operandContainer.appendChild(select);
        }
    });
    
    document.getElementById('instrHelp').textContent = info.help;
}

function executeCommand() {
    const instr = document.getElementById('instrSelect').value;
    const info = instructionInfo[instr];
    
    const args = info.operands.map((op, i) => {
        const el = document.getElementById(`operand${i}`);
        if (!el) return undefined;
        if (op === 'mask' || op === 'condition') {
            return el.value;
        }
        if (op === 'bounds') {
            const val = el.value.trim();
            return val === '' ? undefined : parseInt(val);
        }
        return parseInt(el.value);
    });
    
    try {
        const result = simulator.execute(instr, ...args.filter(a => a !== undefined));
        
        const argsStr = args.filter(a => a !== undefined).join(' ');
        const isError = result.startsWith('Error:');
        log(`${instr} ${argsStr}: ${result}`, isError ? 'error' : 'success');
        
        updateDisplay();
        updateCapabilityExplorer();
    } catch (e) {
        log(`Error: ${e.message}`, 'error');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadFromStorage();
    updateDisplay();
    updateInstrHelp();
    updateCapabilityExplorer();
    log('CTMM Simulator Ready', 'info');
    log('Select an instruction and click Execute, or use Reset/Step/Run controls', 'info');
    
    // CR7 click handler - switch to Assembly Editor
    const cr7Row = document.getElementById('cr7Row');
    if (cr7Row) {
        cr7Row.addEventListener('click', () => {
            const editorView = document.getElementById('editor');
            if (editorView) {
                document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
                editorView.classList.add('active');
                document.getElementById('viewSelect').value = 'editor';
                log('Switched to Assembly Editor (CR7 Nucleus)', 'info');
            }
        });
    }
});

// ==================== CAPABILITY EXPLORER ====================

function createTokenCard(cap, regLabel) {
    const isNull = cap.name === 'NULL';
    const card = document.createElement('div');
    card.className = `token-card ${isNull ? 'null-cap' : ''}`;
    card.onclick = (evt) => showCapabilityDetail(evt, cap, regLabel);
    
    const allPerms = ['R', 'W', 'X', 'L', 'S', 'E', 'B'];
    const permBadges = allPerms.map(p => {
        const hasIt = cap.perms.includes(p);
        return `<span class="perm-badge perm-${p.toLowerCase()} ${hasIt ? '' : 'inactive'}">${p}</span>`;
    }).join('');
    
    card.innerHTML = `
        <div class="token-header">
            <span class="token-name">${cap.name}</span>
            <span class="token-reg">${regLabel}</span>
        </div>
        <div class="token-perms">${permBadges}</div>
        ${cap.locked ? '<div class="lock-indicator">🔒 Locked</div>' : ''}
    `;
    
    return card;
}

let currentEditingCap = null;
let currentEditingRegLabel = null;

function showCapabilityDetail(evt, cap, regLabel) {
    document.querySelectorAll('.token-card').forEach(c => c.classList.remove('selected'));
    if (evt && evt.currentTarget) {
        evt.currentTarget.classList.add('selected');
    }
    
    currentEditingCap = cap;
    currentEditingRegLabel = regLabel;
    
    const panel = document.getElementById('capDetailPanel');
    const allPerms = ['R', 'W', 'X', 'L', 'S', 'E', 'B'];
    const permNames = {
        R: 'Read', W: 'Write', X: 'Execute',
        L: 'Load', S: 'Store', E: 'Enter', B: 'Bind'
    };
    
    const offset = cap.location.offset || 0;
    const spare = cap.spare || 0;
    
    if (!cap.nsEntry) {
        cap.nsEntry = createNamespaceEntry(
            cap.location.offset || 0x1000,
            cap.size || 1024,
            cap.type || 'Abstraction',
            0
        );
        const mac = calculateMAC(offset, cap.nsEntry);
        setMACInSeals(cap.nsEntry, mac);
    }
    
    const gt = encodeGoldenToken(offset, cap.perms, spare);
    const gtDecoded = decodeGoldenToken(gt);
    const macValidation = validateMAC(gtDecoded.offset, cap.nsEntry);
    
    const permCheckboxes = allPerms.map(p => {
        const checked = cap.perms.includes(p) ? 'checked' : '';
        return `<label class="gt-perm-check" title="${permNames[p]}">
            <input type="checkbox" data-perm="${p}" ${checked} onchange="updateGTFromEditor()">
            <span class="perm-badge perm-${p.toLowerCase()}">${p}</span>
        </label>`;
    }).join('');
    
    const typeOptions = Object.values(OBJECT_TYPES).map(t => 
        `<option value="${t}" ${t === getTypeFromSeals(cap.nsEntry) ? 'selected' : ''}>${t}</option>`
    ).join('');
    
    panel.innerHTML = `
        <h2>${cap.name} <span class="reg-badge">${regLabel}</span></h2>
        
        <div class="gt-section">
            <h3 class="section-title">Golden Token (64-bit Key)</h3>
            <div class="gt-hex-display">
                <span class="gt-label">Hex:</span>
                <code id="gtHexValue">${formatGTHex(gt)}</code>
            </div>
            
            <div class="gt-bit-layout">
                <div class="bit-field" data-tooltip="Index into Namespace Table (0-4,294,967,295)">
                    <div class="bit-header">
                        <span class="bit-range">[0:31]</span>
                        <span class="bit-name">Offset</span>
                    </div>
                    <input type="text" id="gtOffset" class="bit-input" value="0x${offset.toString(16).toUpperCase()}" onchange="updateGTFromEditor()">
                </div>
                
                <div class="bit-field" data-tooltip="Permission bits: R/W/X/L/S/E/B (can downgrade without recalculating MAC)">
                    <div class="bit-header">
                        <span class="bit-range">[32:47]</span>
                        <span class="bit-name">Permissions</span>
                    </div>
                    <div class="perm-checkboxes">${permCheckboxes}</div>
                    <div class="perm-hex">= 0x${gtDecoded.permBits.toString(16).toUpperCase().padStart(4, '0')}</div>
                </div>
                
                <div class="bit-field" data-tooltip="Reserved for future use (Thread ID, flags)">
                    <div class="bit-header">
                        <span class="bit-range">[48:63]</span>
                        <span class="bit-name">Spare</span>
                    </div>
                    <input type="text" id="gtSpare" class="bit-input" value="0x${spare.toString(16).toUpperCase().padStart(4, '0')}" onchange="updateGTFromEditor()">
                </div>
            </div>
            
            <div class="gt-security-note">
                <strong>Security Rule:</strong> MAC does not cover permissions. You can downgrade rights (turn off bits) without recalculating the crypto signature.
            </div>
        </div>
        
        <div class="ns-entry-section">
            <h3 class="section-title">Namespace Entry (3-Word Descriptor)</h3>
            <p class="ns-intro-text">Pointed to by GT Offset. Hardware validates MAC on every LOAD.</p>
            
            <div class="ns-word-layout">
                <div class="ns-word" data-tooltip="Physical RAM address or URL (network/cloud)">
                    <div class="word-header">
                        <span class="word-num">Word 1</span>
                        <span class="word-name">Location</span>
                    </div>
                    <input type="text" id="nsLocation" class="word-input" value="${formatWord(cap.nsEntry.word1_location)}" onchange="updateNSFromEditor()">
                </div>
                
                <div class="ns-word" data-tooltip="Object size in bytes - defines the access boundary">
                    <div class="word-header">
                        <span class="word-num">Word 2</span>
                        <span class="word-name">Limit</span>
                    </div>
                    <input type="text" id="nsLimit" class="word-input" value="${formatWord(cap.nsEntry.word2_limit)}" onchange="updateNSFromEditor()">
                    <div class="word-decimal">(${Number(cap.nsEntry.word2_limit)} bytes)</div>
                </div>
                
                <div class="ns-word ns-word-seals" data-tooltip="Metadata[0:31] + Type[32:47] + MAC[48:63]">
                    <div class="word-header">
                        <span class="word-num">Word 3</span>
                        <span class="word-name">Seals</span>
                    </div>
                    <div class="seals-breakdown">
                        <div class="seal-field">
                            <span class="seal-label">Meta[0:31]:</span>
                            <input type="text" id="nsMeta" class="seal-input" value="0x${(Number(cap.nsEntry.word3_seals) & 0xFFFFFFFF).toString(16).toUpperCase().padStart(8, '0')}" onchange="updateNSFromEditor()">
                        </div>
                        <div class="seal-field">
                            <span class="seal-label">Type[32:47]:</span>
                            <select id="nsType" class="seal-select" onchange="updateNSFromEditor()">${typeOptions}</select>
                        </div>
                        <div class="seal-field">
                            <span class="seal-label">MAC[48:63]:</span>
                            <span id="nsMACValue" class="seal-value">0x${getMACFromSeals(cap.nsEntry).toString(16).toUpperCase().padStart(4, '0')}</span>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="mac-validation ${macValidation.valid ? 'mac-valid' : 'mac-invalid'}">
                <div class="mac-status">
                    <span class="mac-icon">${macValidation.valid ? '✓' : '⚠'}</span>
                    <span class="mac-text">${macValidation.valid ? 'MAC Valid - Object Authenticated' : 'SECURITY TRAP - MAC Mismatch!'}</span>
                </div>
                <div class="mac-details">
                    <div class="mac-formula">MAC = Hash(GT_Offset + W1 + W2 + W3_Meta)</div>
                    <div class="mac-values">
                        <span>Stored: 0x${macValidation.stored.toString(16).toUpperCase().padStart(4, '0')}</span>
                        <span>Calculated: 0x${macValidation.calculated.toString(16).toUpperCase().padStart(4, '0')}</span>
                    </div>
                </div>
                <button class="btn btn-recalc" onclick="recalculateMAC()">Recalculate MAC</button>
            </div>
        </div>
    `;
}

function updateGTFromEditor() {
    if (!currentEditingCap) return;
    
    const offsetStr = document.getElementById('gtOffset').value;
    const spareStr = document.getElementById('gtSpare').value;
    const offset = parseInt(offsetStr, 16) || parseInt(offsetStr, 10) || 0;
    const spare = parseInt(spareStr, 16) || parseInt(spareStr, 10) || 0;
    
    const perms = [];
    document.querySelectorAll('.gt-perm-check input:checked').forEach(cb => {
        perms.push(cb.dataset.perm);
    });
    
    currentEditingCap.location.offset = offset;
    currentEditingCap.perms = perms;
    currentEditingCap.spare = spare;
    
    const gt = encodeGoldenToken(offset, perms, spare);
    document.getElementById('gtHexValue').textContent = formatGTHex(gt);
    
    const gtDecoded = decodeGoldenToken(gt);
    document.querySelector('.perm-hex').textContent = `= 0x${gtDecoded.permBits.toString(16).toUpperCase().padStart(4, '0')}`;
    
    updateMACValidationDisplay();
    updateDisplay();
    updateCapabilityExplorer();
}

function updateNSFromEditor() {
    if (!currentEditingCap || !currentEditingCap.nsEntry) return;
    
    const locationStr = document.getElementById('nsLocation').value;
    const limitStr = document.getElementById('nsLimit').value;
    const metaStr = document.getElementById('nsMeta').value;
    const typeVal = document.getElementById('nsType').value;
    
    const location = BigInt(parseInt(locationStr, 16) || parseInt(locationStr, 10) || 0);
    const limit = BigInt(parseInt(limitStr, 16) || parseInt(limitStr, 10) || 0);
    const meta = parseInt(metaStr, 16) || parseInt(metaStr, 10) || 0;
    const typeCode = Object.entries(OBJECT_TYPES).find(([k, v]) => v === typeVal)?.[0] || 0x0004;
    
    currentEditingCap.nsEntry.word1_location = location;
    currentEditingCap.nsEntry.word2_limit = limit;
    
    const storedMAC = getMACFromSeals(currentEditingCap.nsEntry);
    currentEditingCap.nsEntry.word3_seals = BigInt(meta & 0xFFFFFFFF) | 
                                             (BigInt(typeCode) << BigInt(32)) |
                                             (BigInt(storedMAC) << BigInt(48));
    
    document.querySelector('.word-decimal').textContent = `(${Number(limit)} bytes)`;
    
    updateMACValidationDisplay();
}

function updateMACValidationDisplay() {
    if (!currentEditingCap || !currentEditingCap.nsEntry) return;
    
    const offset = currentEditingCap.location.offset || 0;
    const macValidation = validateMAC(offset, currentEditingCap.nsEntry);
    
    const macDiv = document.querySelector('.mac-validation');
    if (macDiv) {
        macDiv.className = `mac-validation ${macValidation.valid ? 'mac-valid' : 'mac-invalid'}`;
        macDiv.querySelector('.mac-icon').textContent = macValidation.valid ? '✓' : '⚠';
        macDiv.querySelector('.mac-text').textContent = macValidation.valid ? 'MAC Valid - Object Authenticated' : 'SECURITY TRAP - MAC Mismatch!';
        macDiv.querySelector('.mac-values').innerHTML = `
            <span>Stored: 0x${macValidation.stored.toString(16).toUpperCase().padStart(4, '0')}</span>
            <span>Calculated: 0x${macValidation.calculated.toString(16).toUpperCase().padStart(4, '0')}</span>
        `;
    }
    
    document.getElementById('nsMACValue').textContent = `0x${macValidation.stored.toString(16).toUpperCase().padStart(4, '0')}`;
}

function recalculateMAC() {
    if (!currentEditingCap || !currentEditingCap.nsEntry) return;
    
    const offset = currentEditingCap.location.offset || 0;
    const newMAC = calculateMAC(offset, currentEditingCap.nsEntry);
    setMACInSeals(currentEditingCap.nsEntry, newMAC);
    
    updateMACValidationDisplay();
    log(`MAC recalculated: 0x${newMAC.toString(16).toUpperCase().padStart(4, '0')}`, 'info');
}

function updateCapabilityExplorer() {
    const systemContainer = document.getElementById('systemTokens');
    const contextContainer = document.getElementById('contextTokens');
    const clistContainer = document.getElementById('clistTokens');
    
    if (!systemContainer) return;
    
    systemContainer.innerHTML = '';
    contextContainer.innerHTML = '';
    clistContainer.innerHTML = '';
    
    systemContainer.appendChild(createTokenCard(simulator.cr15, 'CR15 (Namespace)'));
    systemContainer.appendChild(createTokenCard(simulator.cr8, 'CR8 (Thread)'));
    
    for (let i = 0; i < 8; i++) {
        const cap = simulator.contextRegs[i];
        contextContainer.appendChild(createTokenCard(cap, `CR${i}`));
    }
    
    if (simulator.clist && simulator.clist.length > 0) {
        simulator.clist.forEach((cap, i) => {
            clistContainer.appendChild(createTokenCard(cap, `C-List[${i}]`));
        });
    } else {
        clistContainer.innerHTML = '<p style="color: var(--text-secondary); font-style: italic; padding: 0.5rem;">No capabilities in C-List</p>';
    }
}

function createSampleCapabilities() {
    simulator.cr15 = {
        name: "SYSTEM_ROOT",
        location: { type: "Literal", name: "system.namespace" },
        perms: ["R", "L", "S", "E", "B"],
        locked: true,
        goldenKey: generateGoldenKey()
    };
    
    simulator.cr8 = {
        name: "USER_ALICE",
        location: { type: "Local", offset: 0x2000 },
        perms: ["R", "W"],
        locked: false,
        goldenKey: generateGoldenKey()
    };
    
    simulator.contextRegs[0] = {
        name: "DataBuffer",
        location: { type: "Local", offset: 0x100 },
        perms: ["R", "W"],
        locked: false,
        goldenKey: generateGoldenKey()
    };
    
    simulator.contextRegs[1] = {
        name: "CodeSegment",
        location: { type: "Local", offset: 0x500 },
        perms: ["R", "X"],
        locked: true,
        goldenKey: generateGoldenKey()
    };
    
    simulator.contextRegs[2] = {
        name: "SecureVault",
        location: { type: "Local", offset: 0x800 },
        perms: ["R"],
        locked: true,
        goldenKey: generateGoldenKey()
    };
    
    simulator.contextRegs[6] = {
        name: "UserCList",
        location: { type: "Local", offset: 0x300 },
        perms: ["R", "L", "S", "B"],
        locked: false,
        goldenKey: generateGoldenKey()
    };
    
    simulator.contextRegs[7] = {
        name: "KernelCode",
        location: { type: "Literal", name: "kernel.entry" },
        perms: ["R", "X", "E"],
        locked: true,
        goldenKey: generateGoldenKey()
    };
    
    simulator.clist = [
        {
            name: "PrinterAccess",
            location: { type: "Local", offset: 0x10 },
            perms: ["W"],
            locked: false,
            goldenKey: generateGoldenKey()
        },
        {
            name: "NetworkSocket",
            location: { type: "Local", offset: 0x20 },
            perms: ["R", "W"],
            locked: false,
            goldenKey: generateGoldenKey()
        },
        {
            name: "FileSystem",
            location: { type: "Local", offset: 0x400 },
            perms: ["R", "W", "L", "S"],
            locked: false,
            goldenKey: generateGoldenKey()
        }
    ];
    
    updateCapabilityExplorer();
    updateDisplay();
    log('Sample capabilities loaded - click on tokens to explore!', 'success');
}

// ==================== INSTRUCTION VISUALIZER ====================

const vizInstrInfo = {
    ADD: { operands: ['dest', 'src'], twoReg: true, op: '+', desc: 'Add two registers' },
    SUB: { operands: ['dest', 'src'], twoReg: true, op: '-', desc: 'Subtract source from destination' },
    MUL: { operands: ['dest', 'src'], twoReg: true, op: '*', desc: 'Multiply two registers' },
    NEG: { operands: ['dest', 'src'], twoReg: true, op: 'NEG', desc: 'Negate source into destination' },
    AND: { operands: ['dest', 'src'], twoReg: true, op: 'AND', desc: 'Bitwise AND' },
    ORR: { operands: ['dest', 'src'], twoReg: true, op: 'OR', desc: 'Bitwise OR' },
    EOR: { operands: ['dest', 'src'], twoReg: true, op: 'XOR', desc: 'Bitwise exclusive OR' },
    NOT: { operands: ['dest', 'src'], twoReg: true, op: 'NOT', desc: 'Bitwise NOT' },
    MOV: { operands: ['dest', 'src'], twoReg: true, op: 'MOV', desc: 'Copy value between registers' },
    MVN: { operands: ['dest', 'src'], twoReg: true, op: 'MVN', desc: 'Move NOT (copy inverted value)' },
    LSL: { operands: ['dest', 'src', 'amt'], shift: true, op: '<<', desc: 'Logical shift left' },
    LSR: { operands: ['dest', 'src', 'amt'], shift: true, op: '>>', desc: 'Logical shift right' }
};

let vizState = {
    instr: null,
    dest: 0,
    src: 0,
    amt: 1,
    srcVal1: BigInt(0),
    srcVal2: BigInt(0),
    result: BigInt(0),
    step: 0,
    ready: false
};

function updateVizInstruction() {
    const instr = document.getElementById('vizInstrSelect').value;
    const info = vizInstrInfo[instr];
    const container = document.getElementById('vizOperands');
    
    let html = `
        <div class="viz-operand-row">
            <label>Destination (DR):</label>
            <input type="number" id="vizDest" min="0" max="7" value="0">
        </div>
        <div class="viz-operand-row">
            <label>Source (DR):</label>
            <input type="number" id="vizSrc" min="0" max="7" value="1">
        </div>
    `;
    
    if (info.shift) {
        html += `
            <div class="viz-operand-row">
                <label>Shift Amount:</label>
                <input type="number" id="vizAmt" min="1" max="63" value="4">
            </div>
        `;
    }
    
    html += `
        <div class="viz-operand-row">
            <label>Source Value (hex):</label>
            <input type="text" id="vizSrcValue" value="0x42" placeholder="0x...">
        </div>
    `;
    
    if (info.twoReg && !['NEG', 'NOT', 'MOV', 'MVN'].includes(instr)) {
        html += `
            <div class="viz-operand-row">
                <label>Dest Initial (hex):</label>
                <input type="text" id="vizDestValue" value="0x10" placeholder="0x...">
            </div>
        `;
    }
    
    container.innerHTML = html;
    document.getElementById('vizRunBtn').disabled = true;
    vizState.ready = false;
}

function setupVisualization() {
    const instr = document.getElementById('vizInstrSelect').value;
    const info = vizInstrInfo[instr];
    
    vizState.instr = instr;
    vizState.dest = parseInt(document.getElementById('vizDest').value) || 0;
    vizState.src = parseInt(document.getElementById('vizSrc').value) || 1;
    
    const srcValInput = document.getElementById('vizSrcValue').value;
    vizState.srcVal2 = BigInt(srcValInput.startsWith('0x') ? srcValInput : '0x' + srcValInput);
    
    const destValInput = document.getElementById('vizDestValue');
    if (destValInput) {
        const val = destValInput.value;
        vizState.srcVal1 = BigInt(val.startsWith('0x') ? val : '0x' + val);
    } else {
        vizState.srcVal1 = BigInt(0);
    }
    
    if (info.shift) {
        vizState.amt = parseInt(document.getElementById('vizAmt').value) || 1;
    }
    
    document.getElementById('vizSrcReg1').querySelector('.viz-reg-label').textContent = `DR${vizState.dest}`;
    document.getElementById('vizSrcReg1').querySelector('.viz-reg-value').textContent = formatHex(vizState.srcVal1);
    
    document.getElementById('vizSrcReg2').querySelector('.viz-reg-label').textContent = `DR${vizState.src}`;
    document.getElementById('vizSrcReg2').querySelector('.viz-reg-value').textContent = formatHex(vizState.srcVal2);
    
    document.getElementById('vizALU').querySelector('.viz-alu-op').textContent = info.op;
    document.getElementById('vizALUResult').textContent = '-';
    
    document.getElementById('vizDestReg').querySelector('.viz-reg-label').textContent = `DR${vizState.dest}`;
    document.getElementById('vizDestReg').querySelector('.viz-reg-value').textContent = '-';
    
    ['vizFlagN', 'vizFlagZ', 'vizFlagC', 'vizFlagV'].forEach(id => {
        document.getElementById(id).classList.remove('active', 'changed');
    });
    
    const steps = generateSteps(instr, info);
    const stepsContainer = document.getElementById('vizSteps');
    stepsContainer.innerHTML = steps.map((s, i) => 
        `<div class="viz-step" id="vizStep${i}"><span class="viz-step-num">${i + 1}</span>${s}</div>`
    ).join('');
    
    vizState.step = 0;
    vizState.ready = true;
    document.getElementById('vizRunBtn').disabled = false;
}

function generateSteps(instr, info) {
    const d = vizState.dest, s = vizState.src;
    const steps = [];
    
    steps.push(`Read value from <strong>DR${s}</strong>: ${formatHex(vizState.srcVal2)}`);
    
    if (info.twoReg && !['NEG', 'NOT', 'MOV', 'MVN'].includes(instr)) {
        steps.push(`Read current value from <strong>DR${d}</strong>: ${formatHex(vizState.srcVal1)}`);
    }
    
    let opDesc;
    switch (instr) {
        case 'ADD': opDesc = `Add: ${formatHex(vizState.srcVal1)} + ${formatHex(vizState.srcVal2)}`; break;
        case 'SUB': opDesc = `Subtract: ${formatHex(vizState.srcVal1)} - ${formatHex(vizState.srcVal2)}`; break;
        case 'MUL': opDesc = `Multiply: ${formatHex(vizState.srcVal1)} * ${formatHex(vizState.srcVal2)}`; break;
        case 'NEG': opDesc = `Negate: -${formatHex(vizState.srcVal2)}`; break;
        case 'AND': opDesc = `Bitwise AND: ${formatHex(vizState.srcVal1)} AND ${formatHex(vizState.srcVal2)}`; break;
        case 'ORR': opDesc = `Bitwise OR: ${formatHex(vizState.srcVal1)} OR ${formatHex(vizState.srcVal2)}`; break;
        case 'EOR': opDesc = `Bitwise XOR: ${formatHex(vizState.srcVal1)} XOR ${formatHex(vizState.srcVal2)}`; break;
        case 'NOT': opDesc = `Bitwise NOT: ~${formatHex(vizState.srcVal2)}`; break;
        case 'MOV': opDesc = `Copy value: ${formatHex(vizState.srcVal2)}`; break;
        case 'MVN': opDesc = `Move NOT: ~${formatHex(vizState.srcVal2)}`; break;
        case 'LSL': opDesc = `Shift left by ${vizState.amt}: ${formatHex(vizState.srcVal2)} << ${vizState.amt}`; break;
        case 'LSR': opDesc = `Shift right by ${vizState.amt}: ${formatHex(vizState.srcVal2)} >> ${vizState.amt}`; break;
        default: opDesc = `Execute ${instr}`;
    }
    steps.push(`ALU computes: ${opDesc}`);
    
    const result = computeResult(instr);
    vizState.result = result;
    steps.push(`Write result to <strong>DR${d}</strong>: ${formatHex(result)}`);
    
    steps.push(`Update condition flags (N, Z, C, V)`);
    
    return steps;
}

function computeResult(instr) {
    const mask = BigInt("0xFFFFFFFFFFFFFFFF");
    const a = vizState.srcVal1;
    const b = vizState.srcVal2;
    const amt = vizState.amt;
    
    let result;
    switch (instr) {
        case 'ADD': result = (a + b) & mask; break;
        case 'SUB': result = (a - b) & mask; break;
        case 'MUL': result = (a * b) & mask; break;
        case 'NEG': result = (-b) & mask; break;
        case 'AND': result = a & b; break;
        case 'ORR': result = a | b; break;
        case 'EOR': result = a ^ b; break;
        case 'NOT': result = (~b) & mask; break;
        case 'MOV': result = b; break;
        case 'MVN': result = (~b) & mask; break;
        case 'LSL': result = (b << BigInt(amt)) & mask; break;
        case 'LSR': result = b >> BigInt(amt); break;
        default: result = BigInt(0);
    }
    return result;
}

function formatHex(val) {
    if (typeof val === 'bigint') {
        return '0x' + val.toString(16).toUpperCase();
    }
    return '0x' + val.toString(16).toUpperCase();
}

async function runVisualization() {
    if (!vizState.ready) return;
    
    document.getElementById('vizRunBtn').disabled = true;
    const info = vizInstrInfo[vizState.instr];
    const totalSteps = info.twoReg && !['NEG', 'NOT', 'MOV', 'MVN'].includes(vizState.instr) ? 5 : 4;
    
    for (let i = 0; i < totalSteps; i++) {
        await animateStep(i, totalSteps);
        await sleep(800);
    }
    
    document.getElementById('vizRunBtn').disabled = false;
}

async function animateStep(stepNum, totalSteps) {
    document.querySelectorAll('.viz-step').forEach((el, i) => {
        el.classList.remove('active');
        if (i < stepNum) el.classList.add('done');
    });
    
    const currentStep = document.getElementById(`vizStep${stepNum}`);
    if (currentStep) {
        currentStep.classList.add('active');
    }
    
    document.querySelectorAll('.viz-reg-box').forEach(el => el.classList.remove('active', 'highlight'));
    document.getElementById('vizDataFlow').classList.remove('show');
    
    const instr = vizState.instr;
    const hasDestRead = !['NEG', 'NOT', 'MOV', 'MVN'].includes(instr);
    
    if (stepNum === 0) {
        document.getElementById('vizSrcReg2').classList.add('active');
    } else if (stepNum === 1 && hasDestRead) {
        document.getElementById('vizSrcReg1').classList.add('active');
    } else if ((hasDestRead && stepNum === 2) || (!hasDestRead && stepNum === 1)) {
        document.getElementById('vizDataFlow').classList.add('show');
        document.getElementById('vizALUResult').textContent = formatHex(vizState.result);
    } else if ((hasDestRead && stepNum === 3) || (!hasDestRead && stepNum === 2)) {
        document.getElementById('vizDestReg').classList.add('highlight');
        document.getElementById('vizDestReg').querySelector('.viz-reg-value').textContent = formatHex(vizState.result);
    } else {
        updateVizFlags();
    }
}

function updateVizFlags() {
    const result = vizState.result;
    const signBit = BigInt("0x8000000000000000");
    
    const n = (result & signBit) !== BigInt(0);
    const z = result === BigInt(0);
    
    const flags = { N: n, Z: z, C: false, V: false };
    
    ['N', 'Z', 'C', 'V'].forEach(f => {
        const el = document.getElementById(`vizFlag${f}`);
        if (flags[f]) {
            el.classList.add('active', 'changed');
        } else {
            el.classList.remove('active');
        }
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function resetVisualization() {
    vizState = {
        instr: null, dest: 0, src: 0, amt: 1,
        srcVal1: BigInt(0), srcVal2: BigInt(0),
        result: BigInt(0), step: 0, ready: false
    };
    
    document.getElementById('vizSrcReg1').querySelector('.viz-reg-label').textContent = 'DR?';
    document.getElementById('vizSrcReg1').querySelector('.viz-reg-value').textContent = '-';
    document.getElementById('vizSrcReg2').querySelector('.viz-reg-label').textContent = 'DR?';
    document.getElementById('vizSrcReg2').querySelector('.viz-reg-value').textContent = '-';
    document.getElementById('vizDestReg').querySelector('.viz-reg-label').textContent = 'DR?';
    document.getElementById('vizDestReg').querySelector('.viz-reg-value').textContent = '-';
    document.getElementById('vizALU').querySelector('.viz-alu-op').textContent = '?';
    document.getElementById('vizALUResult').textContent = '-';
    
    document.querySelectorAll('.viz-reg-box').forEach(el => el.classList.remove('active', 'highlight'));
    document.getElementById('vizDataFlow').classList.remove('show');
    
    ['vizFlagN', 'vizFlagZ', 'vizFlagC', 'vizFlagV'].forEach(id => {
        document.getElementById(id).classList.remove('active', 'changed');
    });
    
    document.getElementById('vizSteps').innerHTML = '<p class="viz-hint">Select an instruction and click Setup to begin</p>';
    document.getElementById('vizRunBtn').disabled = true;
}

document.addEventListener('DOMContentLoaded', () => {
    updateVizInstruction();
    setupCodeEditor();
});

// ==================== PARADIGM TABS ====================

function switchParadigm(paradigm) {
    document.querySelectorAll('.paradigm-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.paradigm-content').forEach(c => c.classList.remove('active'));
    
    document.querySelector(`.paradigm-tab[onclick*="${paradigm}"]`).classList.add('active');
    document.getElementById(`${paradigm}Examples`).classList.add('active');
    
    if (paradigm === 'church') {
        loadExample('callerCode');
    }
}

// ==================== ASSEMBLY EDITOR ====================

let editorState = {
    program: [],
    pc: 0,
    running: false,
    parsed: []
};

const examplePrograms = {
    counter: `; Counter Loop - Count from 0 to 5
ADDI 0 0      ; DR0 = 0 (counter)
ADDI 1 5      ; DR1 = 5 (limit)
ADDI 2 1      ; DR2 = 1 (increment)

; Loop start (address 3)
ADD 0 2       ; DR0 = DR0 + 1
CMP 0 1       ; Compare counter to limit
; When DR0 < DR1, loop continues`,

    fibonacci: `; Fibonacci Sequence
; Calculates first few Fibonacci numbers
ADDI 0 0      ; DR0 = 0 (F(0))
ADDI 1 1      ; DR1 = 1 (F(1))
ADDI 2 0      ; DR2 = temp

; Calculate F(2) = F(0) + F(1)
MOV 2 0       ; temp = F(0)
ADD 2 1       ; temp = F(0) + F(1)
MOV 0 1       ; F(0) = F(1)
MOV 1 2       ; F(1) = temp

; Calculate F(3)
MOV 2 0       ; temp = F(0)
ADD 2 1       ; temp = F(0) + F(1)
MOV 0 1       ; F(0) = F(1)
MOV 1 2       ; F(1) = temp`,

    multiply: `; Multiply 6 * 7 using repeated addition
ADDI 0 0      ; DR0 = 0 (result)
ADDI 1 6      ; DR1 = 6 (multiplicand)
ADDI 2 7      ; DR2 = 7 (multiplier/counter)
ADDI 3 1      ; DR3 = 1 (decrement)

; Loop: Add DR1 to result DR2 times
ADD 0 1       ; result += multiplicand
SUB 2 3       ; counter--
; Repeat until DR2 = 0
; Final result in DR0 = 42`,

    flags: `; Flag Demo - Shows how NZCV flags work
ADDI 0 10     ; DR0 = 10
ADDI 1 10     ; DR1 = 10
CMP 0 1       ; Compare equal: Z=1

ADDI 2 5      ; DR2 = 5
CMP 2 0       ; Compare 5 < 10: N=1 (negative result)

ADDI 3 0      ; DR3 = 0
SUB 3 0       ; DR3 = 0 - 10: N=1, C=0 (borrow)`,

    callerCode: `; ========== CALLER CODE ==========
; Prepares GT selector and arguments
; then invokes CALL to capability

; Step 1: Load GT selector from C-List
; CR1 = GT_WRITE capability (from namespace)
LOAD 1 6 2    ; CR1 = C-List[2] (GT_WRITE cap)

; Step 2: Prepare data arguments only
ADDI 1 100    ; DR1 = arg1 (address - data)
ADDI 2 42     ; DR2 = arg2 (value - data)

; Step 3: Execute CALL with GT in CR1
; Meta-machine validates E permission
; GT capability passed in CR1
CALL 0        ; Call via CR0 capability

; -------- CONTEXT SWITCH --------
; Control transfers to Guard Code
; GT selector arrives in CR1 (not DR!)
; Line numbers restart at offset 0
; ================================

; Step 4: After RETURN
; DR0 = status (0=OK, 1=ERR)
; DR1-DR3 = return data values
; CR0-CR3 = GT vars (type-safe caps)`,

    guardCode: `; ========== GUARD CODE ==========
; Entry point at offset 0
; CALL already validated E permission
; GT selector arrives in CR1 (capability)

; Offset 0: Validate GT selector
; CR1 contains GT capability from caller
; Use TPERM to check GT type

TPERM 1 R     ; Verify CR1 is valid GT cap

; GT Dispatch - compare CR1 to known GTs
; Load reference GTs from namespace
LOAD 2 6 0    ; CR2 = GT_READ from C-List
LOAD 3 6 1    ; CR3 = GT_WRITE from C-List
LOAD 4 6 2    ; CR4 = GT_DELETE from C-List

; Compare GT keys (caps, not integers!)
; Branch based on capability match
; B match_read   ; if CR1 == CR2
; B match_write  ; if CR1 == CR3
; B match_delete ; if CR1 == CR4

; ========== RETURN PROTOCOL ==========
; DR0 = return status (0=OK, 1=ERR)
; DR1-DR3 = return data values
; CR0-CR3 = GT variables (type-safe)
; Capabilities stay in CR domain!
; RETURN unwinds to caller context
RETURN`
};

function setupCodeEditor() {
    const editor = document.getElementById('codeEditor');
    if (!editor) return;
    
    editor.addEventListener('input', updateLineNumbers);
    editor.addEventListener('scroll', syncScroll);
    editor.addEventListener('keydown', handleTab);
    editor.addEventListener('click', updateLineInfo);
    editor.addEventListener('keyup', updateLineInfo);
    
    updateLineNumbers();
}

function updateLineNumbers() {
    const editor = document.getElementById('codeEditor');
    const lineNumbers = document.getElementById('lineNumbers');
    if (!editor || !lineNumbers) return;
    
    const lines = editor.value.split('\n').length;
    let nums = [];
    for (let i = 1; i <= lines; i++) {
        nums.push(i);
    }
    lineNumbers.innerHTML = nums.join('<br>');
}

function syncScroll() {
    const editor = document.getElementById('codeEditor');
    const lineNumbers = document.getElementById('lineNumbers');
    if (lineNumbers && editor) {
        lineNumbers.scrollTop = editor.scrollTop;
    }
}

function handleTab(e) {
    if (e.key === 'Tab') {
        e.preventDefault();
        const editor = e.target;
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        editor.value = editor.value.substring(0, start) + '    ' + editor.value.substring(end);
        editor.selectionStart = editor.selectionEnd = start + 4;
    }
}

function updateLineInfo() {
    const editor = document.getElementById('codeEditor');
    const lineInfo = document.getElementById('lineInfo');
    if (!editor || !lineInfo) return;
    
    const text = editor.value.substring(0, editor.selectionStart);
    const line = text.split('\n').length;
    lineInfo.textContent = `Line ${line}`;
}

function parseProgram(code) {
    const lines = code.split('\n');
    const program = [];
    
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        
        const commentIdx = line.indexOf(';');
        if (commentIdx !== -1) {
            line = line.substring(0, commentIdx).trim();
        }
        
        if (line === '') continue;
        
        const parts = line.split(/\s+/);
        const instr = parts[0].toUpperCase();
        const args = parts.slice(1).map(a => parseInt(a));
        
        program.push({
            line: i + 1,
            instr: instr,
            args: args,
            raw: lines[i]
        });
    }
    
    return program;
}

function editorLog(msg, type = 'info') {
    const console = document.getElementById('editorConsole');
    if (!console) return;
    
    const line = document.createElement('div');
    line.className = `console-line ${type}`;
    line.textContent = msg;
    console.appendChild(line);
    console.scrollTop = console.scrollHeight;
}

function clearEditorConsole() {
    const console = document.getElementById('editorConsole');
    if (console) {
        console.innerHTML = '';
    }
}

function runProgram() {
    const code = document.getElementById('codeEditor').value;
    editorState.program = parseProgram(code);
    editorState.pc = 0;
    
    if (editorState.program.length === 0) {
        editorLog('No instructions to execute', 'error');
        return;
    }
    
    clearEditorConsole();
    editorLog('Running program...', 'info');
    simulator.reset();
    
    while (editorState.pc < editorState.program.length) {
        const instr = editorState.program[editorState.pc];
        executeEditorInstruction(instr);
        editorState.pc++;
    }
    
    editorLog('Program completed', 'success');
    updateEditorStatus();
    updateEditorRegisters();
    updateParsedView();
    updateDisplay();
}

function stepProgram() {
    if (editorState.program.length === 0) {
        const code = document.getElementById('codeEditor').value;
        editorState.program = parseProgram(code);
        editorState.pc = 0;
        simulator.reset();
        clearEditorConsole();
        editorLog('Starting step execution...', 'info');
        updateParsedView();
    }
    
    if (editorState.pc >= editorState.program.length) {
        editorLog('Program completed', 'success');
        return;
    }
    
    const instr = editorState.program[editorState.pc];
    executeEditorInstruction(instr);
    editorState.pc++;
    
    updateEditorStatus();
    updateEditorRegisters();
    highlightCurrentLine();
    updateDisplay();
}

function executeEditorInstruction(instr) {
    const { instr: op, args, line } = instr;
    
    try {
        let result;
        switch (op) {
            case 'ADD':
            case 'SUB':
            case 'MUL':
            case 'AND':
            case 'ORR':
            case 'EOR':
            case 'MOV':
            case 'MVN':
            case 'NEG':
            case 'NOT':
            case 'CMP':
            case 'CMN':
            case 'TST':
            case 'TEQ':
                result = simulator.execute(op, args[0], args[1]);
                break;
            case 'ADDI':
            case 'SUBI':
                result = simulator.execute(op, args[0], args[1]);
                break;
            case 'LSL':
            case 'LSR':
            case 'ASR':
            case 'ROR':
                result = simulator.execute(op, args[0], args[1], args[2]);
                break;
            default:
                result = `Unknown instruction: ${op}`;
        }
        editorLog(`[${line}] ${op} ${args.join(' ')}: ${result}`, 'exec');
    } catch (e) {
        editorLog(`[${line}] Error: ${e.message}`, 'error');
    }
}

function resetProgram() {
    editorState.program = [];
    editorState.pc = 0;
    simulator.reset();
    
    clearEditorConsole();
    editorLog('Program reset', 'info');
    editorLog('Write code and click Run or Step to execute', 'info');
    
    updateEditorStatus();
    updateEditorRegisters();
    updateDisplay();
    
    const parsed = document.getElementById('editorParsed');
    if (parsed) parsed.innerHTML = '';
}

function updateEditorStatus() {
    document.getElementById('editorPC').textContent = editorState.pc;
    
    const status = editorState.pc >= editorState.program.length ? 'Completed' : 'Running';
    document.getElementById('editorStatus').textContent = status;
}

function updateEditorRegisters() {
    const container = document.getElementById('editorRegisters');
    if (!container) return;
    
    let html = '<div class="reg-display">';
    for (let i = 0; i < 8; i++) {
        const val = simulator.dataRegs[i].toString(16).toUpperCase().padStart(4, '0');
        html += `<div class="reg-item"><div class="name">DR${i}</div><div class="val">0x${val}</div></div>`;
    }
    html += '</div>';
    
    html += '<div style="margin-top: 1rem;"><strong style="color: var(--text-secondary);">Flags:</strong> ';
    html += `N=${simulator.flags.N ? 1 : 0} Z=${simulator.flags.Z ? 1 : 0} `;
    html += `C=${simulator.flags.C ? 1 : 0} V=${simulator.flags.V ? 1 : 0}</div>`;
    
    container.innerHTML = html;
}

function updateParsedView() {
    const container = document.getElementById('editorParsed');
    if (!container) return;
    
    let html = '';
    editorState.program.forEach((p, i) => {
        const current = i === editorState.pc ? 'current-line' : '';
        html += `<div class="parsed-line ${current}">`;
        html += `<span class="parsed-addr">${i.toString().padStart(2, '0')}</span>`;
        html += `<span class="parsed-instr">${p.instr}</span> `;
        html += `<span class="parsed-args">${p.args.join(', ')}</span>`;
        html += '</div>';
    });
    
    container.innerHTML = html || '<div class="console-line info">No instructions parsed</div>';
}

function highlightCurrentLine() {
    const parsed = document.getElementById('editorParsed');
    if (!parsed) return;
    
    parsed.querySelectorAll('.parsed-line').forEach((el, i) => {
        el.classList.toggle('current-line', i === editorState.pc);
    });
}

function switchOutputTab(tab) {
    document.querySelectorAll('.output-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.output-content').forEach(c => c.classList.add('hidden'));
    
    event.target.classList.add('active');
    
    const content = document.getElementById(
        tab === 'console' ? 'editorConsole' : 
        tab === 'registers' ? 'editorRegisters' : 'editorParsed'
    );
    if (content) content.classList.remove('hidden');
    
    if (tab === 'registers') updateEditorRegisters();
    if (tab === 'parsed') updateParsedView();
}

function loadExample(name) {
    const code = examplePrograms[name];
    if (code) {
        document.getElementById('codeEditor').value = code;
        updateLineNumbers();
        resetProgram();
        editorLog(`Loaded example: ${name}`, 'success');
    }
}

function loadCR7() {
    const cr7 = simulator.contextRegs[7];
    
    document.getElementById('cr7Name').value = cr7.name || 'NULL';
    
    if (cr7.location) {
        if (cr7.location.type === 'Literal') {
            document.getElementById('cr7Location').value = cr7.location.name || '';
        } else if (cr7.location.type === 'Local') {
            document.getElementById('cr7Location').value = `local:${cr7.location.offset || 0}`;
        }
    } else {
        document.getElementById('cr7Location').value = '';
    }
    
    const perms = cr7.perms || [];
    document.getElementById('cr7PermR').checked = perms.includes('R');
    document.getElementById('cr7PermW').checked = perms.includes('W');
    document.getElementById('cr7PermX').checked = perms.includes('X');
    document.getElementById('cr7PermL').checked = perms.includes('L');
    document.getElementById('cr7PermS').checked = perms.includes('S');
    document.getElementById('cr7PermE').checked = perms.includes('E');
    document.getElementById('cr7PermB').checked = perms.includes('B');
    
    document.getElementById('cr7Key').textContent = cr7.goldenKey || 'Not initialized';
    
    editorLog('CR7 capability loaded into editor', 'success');
}

const mintedCapabilities = [];

function mintCapability() {
    const name = document.getElementById('mintName').value.trim();
    const locationType = document.getElementById('mintLocationType').value;
    const locationValue = document.getElementById('mintLocation').value.trim();
    const targetReg = parseInt(document.getElementById('mintTarget').value);
    const size = parseInt(document.getElementById('mintSize').value);
    
    if (!name) {
        dnsLog('ERROR: Capability name is required', 'error');
        return;
    }
    
    if (!locationValue) {
        dnsLog('ERROR: Location is required', 'error');
        return;
    }
    
    let location;
    if (locationType === 'local') {
        const offset = parseInt(locationValue);
        if (isNaN(offset)) {
            dnsLog('ERROR: Local location requires a numeric offset', 'error');
            return;
        }
        location = { type: 'Local', offset: offset };
    } else {
        location = { type: 'Literal', name: locationValue };
    }
    
    const perms = [];
    if (document.getElementById('mintPermR').checked) perms.push('R');
    if (document.getElementById('mintPermW').checked) perms.push('W');
    if (document.getElementById('mintPermX').checked) perms.push('X');
    if (document.getElementById('mintPermL').checked) perms.push('L');
    if (document.getElementById('mintPermS').checked) perms.push('S');
    if (document.getElementById('mintPermE').checked) perms.push('E');
    if (document.getElementById('mintPermB').checked) perms.push('B');
    
    if (perms.length === 0) {
        dnsLog('WARNING: No permissions selected - capability will have no access rights', 'warning');
    }
    
    const goldenKey = generateGoldenKey();
    
    const newCapability = {
        name: name,
        location: location,
        perms: perms,
        size: size,
        locked: true,
        goldenKey: goldenKey
    };
    
    simulator.contextRegs[targetReg] = newCapability;
    
    mintedCapabilities.push({
        ...newCapability,
        targetReg: targetReg,
        timestamp: new Date().toLocaleTimeString()
    });
    
    updateMintPreview(newCapability, targetReg);
    updateRegistryList();
    dnsLog(`MINTED: ${name} [${perms.join('')}] -> CR${targetReg}`, 'success');
    
    updateDisplay();
    updateCapabilityExplorer();
    log(`Capability minted: ${name} [${perms.join('')}] in CR${targetReg}`, 'success');
}

function updateMintPreview(cap, targetReg) {
    const preview = document.getElementById('mintPreview');
    const locationStr = cap.location.type === 'Local' 
        ? `local:${cap.location.offset}` 
        : cap.location.name;
    
    const sizeStr = cap.size >= 1048576 ? `${cap.size / 1048576} MB` :
                    cap.size >= 1024 ? `${cap.size / 1024} KB` : 
                    `${cap.size} bytes`;
    
    let permsHtml = cap.perms.map(p => `<span class="preview-perm">${p}</span>`).join('');
    if (permsHtml === '') permsHtml = '<span class="preview-perm" style="opacity: 0.5;">---</span>';
    
    preview.innerHTML = `
        <div class="preview-token">
            <div class="preview-token-header">
                <span class="preview-token-icon">🔑</span>
                <span class="preview-token-name">${cap.name}</span>
            </div>
            <div class="preview-token-key">${cap.goldenKey}</div>
            <div class="preview-token-perms">${permsHtml}</div>
            <div class="preview-token-target">CR${targetReg} | ${locationStr} | ${sizeStr}</div>
        </div>
    `;
}

function updateRegistryList() {
    const list = document.getElementById('registryList');
    
    if (mintedCapabilities.length === 0) {
        list.innerHTML = '<div class="registry-empty">No capabilities minted yet</div>';
        return;
    }
    
    let html = '';
    mintedCapabilities.slice().reverse().forEach(cap => {
        const permsHtml = cap.perms.map(p => {
            const permClass = `perm-${p.toLowerCase()}`;
            return `<span class="registry-item-perm ${permClass}">${p}</span>`;
        }).join('');
        
        html += `
            <div class="registry-item">
                <span class="registry-item-name">${cap.name} (CR${cap.targetReg})</span>
                <div class="registry-item-perms">${permsHtml}</div>
            </div>
        `;
    });
    
    list.innerHTML = html;
}

function dnsLog(message, type = 'info') {
    const logOutput = document.getElementById('dnsLogOutput');
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    const timestamp = new Date().toLocaleTimeString();
    entry.textContent = `[${timestamp}] ${message}`;
    logOutput.appendChild(entry);
    logOutput.scrollTop = logOutput.scrollHeight;
}

function saveCR7() {
    const name = document.getElementById('cr7Name').value.trim() || 'NUCLEUS';
    const locationStr = document.getElementById('cr7Location').value.trim();
    
    let location;
    if (locationStr.startsWith('local:')) {
        const offset = parseInt(locationStr.substring(6)) || 0;
        location = { type: 'Local', offset: offset };
    } else {
        location = { type: 'Literal', name: locationStr || 'kernel.code' };
    }
    
    const perms = [];
    if (document.getElementById('cr7PermR').checked) perms.push('R');
    if (document.getElementById('cr7PermW').checked) perms.push('W');
    if (document.getElementById('cr7PermX').checked) perms.push('X');
    if (document.getElementById('cr7PermL').checked) perms.push('L');
    if (document.getElementById('cr7PermS').checked) perms.push('S');
    if (document.getElementById('cr7PermE').checked) perms.push('E');
    if (document.getElementById('cr7PermB').checked) perms.push('B');
    
    const existingKey = simulator.contextRegs[7].goldenKey;
    const goldenKey = existingKey || generateGoldenKey();
    
    simulator.contextRegs[7] = {
        name: name,
        location: location,
        perms: perms,
        locked: true,
        goldenKey: goldenKey
    };
    
    document.getElementById('cr7Key').textContent = goldenKey;
    
    updateDisplay();
    updateCapabilityExplorer();
    editorLog(`CR7 updated: ${name} [${perms.join('')}]`, 'success');
    log(`CR7 capability saved: ${name}`, 'success');
}

const tutorialState = {
    currentLesson: 0,
    currentStep: 0,
    completedLessons: new Set()
};

const lessons = [
    {
        title: "Introduction to Capabilities",
        steps: [
            {
                text: `<h3>What is a Capability?</h3>
                <p>In traditional security systems, access control is managed through <strong>Access Control Lists (ACLs)</strong> - lists that define who can access what resources.</p>
                <p>The CTMM uses a fundamentally different approach: <strong>Capability-Based Security</strong>.</p>
                <div class="key-concept">
                    <strong>Key Concept:</strong> A capability is an unforgeable token that grants specific rights to a resource. If you have the token, you have the access - no need to check lists or permissions separately.
                </div>`,
                demo: `<div class="demo-title">Golden Token Example</div>
                <div class="demo-content">
                    <div class="demo-visual">
                        <div class="golden-token-demo">
                            <div class="token-label">192-bit Golden Token</div>
                            <div class="token-key" id="demoToken1">A3F2-91B4-CC87-D2E1-9087-54AB</div>
                        </div>
                    </div>
                    <div class="demo-explanation">
                        <p>This is a <strong>Golden Token</strong> - a cryptographic key that cannot be forged or guessed.</p>
                        <p>Each capability in the CTMM has its own unique Golden Token that proves authenticity.</p>
                    </div>
                </div>`
            },
            {
                text: `<h3>The Seven Permissions</h3>
                <p>Each capability grants specific permissions. The CTMM uses seven permission types:</p>
                <ul>
                    <li><code>R</code> - <strong>Read</strong>: View data or code</li>
                    <li><code>W</code> - <strong>Write</strong>: Modify data</li>
                    <li><code>X</code> - <strong>Execute</strong>: Run as code</li>
                    <li><code>L</code> - <strong>Load</strong>: Load capabilities from children</li>
                    <li><code>S</code> - <strong>Store</strong>: Store capabilities to children</li>
                    <li><code>E</code> - <strong>Enter</strong>: Switch namespace or call procedure</li>
                    <li><code>B</code> - <strong>Bind</strong>: Save token to namespace DNA (persistent storage)</li>
                </ul>`,
                demo: `<div class="demo-title">Permission Badges</div>
                <div class="demo-content">
                    <div class="demo-visual">
                        <div class="permission-demo">
                            <span class="perm-demo-badge" style="background: #4ade80; color: #1a1a2e;">R</span>
                            <span class="perm-demo-badge" style="background: #f87171; color: #1a1a2e;">W</span>
                            <span class="perm-demo-badge" style="background: #60a5fa; color: #1a1a2e;">X</span>
                            <span class="perm-demo-badge" style="background: #c084fc; color: #1a1a2e;">L</span>
                            <span class="perm-demo-badge" style="background: #fb923c; color: #1a1a2e;">S</span>
                            <span class="perm-demo-badge" style="background: #fbbf24; color: #1a1a2e;">E</span>
                            <span class="perm-demo-badge" style="background: #2dd4bf; color: #1a1a2e;">B</span>
                        </div>
                    </div>
                    <div class="demo-explanation">
                        <p>Permissions can be combined. For example, a file might have <code>RW</code> (read and write) while executable code has <code>RXE</code> (read, execute, enter).</p>
                    </div>
                </div>`
            },
            {
                text: `<h3>Why Capabilities Matter</h3>
                <p>Traditional security has a fundamental flaw called the <strong>"Confused Deputy"</strong> problem:</p>
                <div class="highlight">
                    A trusted program (the deputy) can be tricked into misusing its authority on behalf of a malicious actor.
                </div>
                <p>Capabilities solve this because:</p>
                <ul>
                    <li>Authority is always explicit - you must present the capability</li>
                    <li>Delegation is controlled - you can only give away what you have</li>
                    <li>No ambient authority - programs only have the capabilities they're given</li>
                </ul>`,
                interactive: {
                    type: "quiz",
                    question: "What makes a capability different from a traditional permission?",
                    options: [
                        "Capabilities are stored in a database",
                        "Capabilities are unforgeable tokens that must be presented to gain access",
                        "Capabilities are just passwords",
                        "Capabilities only work with files"
                    ],
                    correct: 1,
                    feedback: {
                        correct: "Correct! Capabilities are unforgeable tokens. Having the token IS having the access.",
                        incorrect: "Not quite. Capabilities are unforgeable tokens - if you have the token, you have the access."
                    }
                }
            }
        ]
    },
    {
        title: "The Boot Sequence",
        steps: [
            {
                text: `<h3>Starting the CTMM</h3>
                <p>When the CTMM powers on, it goes through a <strong>4-step boot sequence</strong> to establish a secure foundation.</p>
                <p>This sequence ensures that the system starts in a known, secure state with proper capabilities in place.</p>
                <div class="key-concept">
                    <strong>Why it matters:</strong> Each step builds upon the previous one, creating a chain of trust from hardware to user space.
                </div>`,
                demo: `<div class="demo-title">Boot Sequence Steps</div>
                <div class="demo-content">
                    <div class="demo-visual">
                        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                            <div style="padding: 0.8rem; background: var(--bg-panel); border-radius: 4px; border-left: 3px solid var(--accent);">1. Hardware Reset</div>
                            <div style="padding: 0.8rem; background: var(--bg-panel); border-radius: 4px; border-left: 3px solid var(--success);">2. Load Namespace</div>
                            <div style="padding: 0.8rem; background: var(--bg-panel); border-radius: 4px; border-left: 3px solid #60a5fa;">3. Initialize Thread</div>
                            <div style="padding: 0.8rem; background: var(--bg-panel); border-radius: 4px; border-left: 3px solid var(--warning);">4. Load Nucleus</div>
                        </div>
                    </div>
                    <div class="demo-explanation">
                        <p>Each step adds essential capabilities to the system, building up from bare hardware to a fully operational environment.</p>
                    </div>
                </div>`
            },
            {
                text: `<h3>Step 1: Hardware Reset</h3>
                <p>All registers are cleared to <code>NULL</code>. This ensures no leftover data from previous sessions.</p>
                <h3>Step 2: Load Namespace</h3>
                <p><code>CR15</code> receives the system namespace capability with <code>RLSEB</code> permissions - the root of all accessible resources.</p>
                <h3>Step 3: Initialize Thread</h3>
                <p><code>CR8</code> gets the user thread capability, and <code>CR6</code> receives the C-List (capability list) for user access.</p>
                <h3>Step 4: Load Nucleus</h3>
                <p>The kernel code capability is loaded into <code>CR7</code>. This is the core operating system code with <code>RXE</code> permissions.</p>`,
                demo: `<div class="demo-title">Register States After Boot</div>
                <div class="demo-content">
                    <div class="demo-visual register-demo">
                        <div class="reg-demo-item"><span class="reg-demo-name">CR7</span><span class="reg-demo-value">NUCLEUS [RXE]</span></div>
                        <div class="reg-demo-item"><span class="reg-demo-name">CR15</span><span class="reg-demo-value">SYSTEM_NS [RLSEB]</span></div>
                        <div class="reg-demo-item"><span class="reg-demo-name">CR8</span><span class="reg-demo-value">USER_MAIN [RW]</span></div>
                        <div class="reg-demo-item"><span class="reg-demo-name">CR6</span><span class="reg-demo-value">C-LIST [RLS]</span></div>
                    </div>
                    <div class="demo-explanation">
                        <p>After boot, these four registers hold the essential capabilities needed to run the system securely.</p>
                    </div>
                </div>`
            },
            {
                text: `<h3>Try It Yourself</h3>
                <p>You can experience the boot sequence in the simulator:</p>
                <ol>
                    <li>Go to the <strong>CPU State Dashboard</strong></li>
                    <li>Click <strong>Step</strong> to advance through each boot stage</li>
                    <li>Watch how registers change from NULL to active capabilities</li>
                    <li>Or click <strong>Run</strong> to complete all steps at once</li>
                </ol>
                <div class="highlight">
                    After booting, check the <strong>Capability Explorer</strong> to see the Golden Tokens that were created!
                </div>`,
                interactive: {
                    type: "quiz",
                    question: "Which register holds the kernel (Nucleus) capability after boot?",
                    options: ["CR0", "CR6", "CR7", "CR15"],
                    correct: 2,
                    feedback: {
                        correct: "Correct! CR7 holds the Nucleus (kernel code) capability.",
                        incorrect: "Not quite. CR7 is designated for the Nucleus capability."
                    }
                }
            }
        ]
    },
    {
        title: "Context & Data Registers",
        steps: [
            {
                text: `<h3>Two Types of Registers</h3>
                <p>The CTMM has two distinct register types, each serving a different purpose:</p>
                <ul>
                    <li><strong>Context Registers (CR0-CR7)</strong>: Hold capabilities (access rights)</li>
                    <li><strong>Data Registers (DR0-DR7)</strong>: Hold 64-bit numeric values</li>
                </ul>
                <div class="key-concept">
                    <strong>Key Insight:</strong> This separation enforces security at the hardware level. You cannot accidentally treat a number as a capability or vice versa.
                </div>`,
                demo: `<div class="demo-title">Register Comparison</div>
                <div class="demo-content">
                    <div class="demo-visual">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                            <div style="background: rgba(233, 69, 96, 0.2); padding: 1rem; border-radius: 6px;">
                                <div style="color: var(--accent); font-weight: bold; margin-bottom: 0.5rem;">Context Registers</div>
                                <div style="font-size: 0.85rem; color: var(--text-secondary);">CR0-CR7, CR8, CR15</div>
                                <div style="font-size: 0.85rem; color: var(--text-primary); margin-top: 0.3rem;">Hold capabilities</div>
                            </div>
                            <div style="background: rgba(74, 222, 128, 0.2); padding: 1rem; border-radius: 6px;">
                                <div style="color: var(--success); font-weight: bold; margin-bottom: 0.5rem;">Data Registers</div>
                                <div style="font-size: 0.85rem; color: var(--text-secondary);">DR0-DR7</div>
                                <div style="font-size: 0.85rem; color: var(--text-primary); margin-top: 0.3rem;">Hold 64-bit numbers</div>
                            </div>
                        </div>
                    </div>
                </div>`
            },
            {
                text: `<h3>Special Context Registers</h3>
                <p>Some context registers have special roles:</p>
                <ul>
                    <li><code>CR6</code> - <strong>C-List LCA</strong>: Points to your list of available capabilities</li>
                    <li><code>CR7</code> - <strong>Nucleus</strong>: The kernel/OS code capability</li>
                    <li><code>CR8</code> - <strong>Thread</strong>: Your current process/user identity</li>
                    <li><code>CR15</code> - <strong>Namespace</strong>: The root of accessible resources</li>
                </ul>
                <div class="highlight">
                    CR0-CR5 are general-purpose capability registers you can use for your own capabilities.
                </div>`,
                demo: `<div class="demo-title">Special Register Roles</div>
                <div class="demo-content">
                    <div class="demo-visual register-demo">
                        <div class="reg-demo-item"><span class="reg-demo-name">CR6</span><span class="reg-demo-value">C-List (Your capabilities)</span></div>
                        <div class="reg-demo-item"><span class="reg-demo-name">CR7</span><span class="reg-demo-value">Nucleus (Kernel)</span></div>
                        <div class="reg-demo-item"><span class="reg-demo-name">CR8</span><span class="reg-demo-value">Thread (Your identity)</span></div>
                        <div class="reg-demo-item"><span class="reg-demo-name">CR15</span><span class="reg-demo-value">Namespace (Root scope)</span></div>
                    </div>
                </div>`
            },
            {
                text: `<h3>Data Register Operations</h3>
                <p>Data registers support arithmetic and logic operations:</p>
                <ul>
                    <li><strong>Arithmetic:</strong> ADD, SUB, MUL, NEG, ADDI, SUBI</li>
                    <li><strong>Logic:</strong> AND, ORR, EOR, NOT, BIC</li>
                    <li><strong>Shifts:</strong> LSL, LSR, ASR, ROR</li>
                    <li><strong>Compare:</strong> CMP, CMN, TST, TEQ</li>
                </ul>
                <p>These operations set <strong>NZCV flags</strong> (Negative, Zero, Carry, Overflow) for conditional branching.</p>`,
                interactive: {
                    type: "quiz",
                    question: "What type of data do Context Registers hold?",
                    options: [
                        "64-bit numbers",
                        "Capabilities (access rights with Golden Tokens)",
                        "Text strings",
                        "Memory addresses only"
                    ],
                    correct: 1,
                    feedback: {
                        correct: "Correct! Context Registers hold capabilities - unforgeable tokens granting access rights.",
                        incorrect: "Not quite. Context Registers specifically hold capabilities, not regular data."
                    }
                }
            }
        ]
    },
    {
        title: "Capability Operations",
        steps: [
            {
                text: `<h3>Working with Capabilities</h3>
                <p>The CTMM provides special instructions for capability manipulation:</p>
                <ul>
                    <li><code>LOAD d s i</code> - Load capability from memory into register</li>
                    <li><code>SAVE d s</code> - Save capability from register to memory</li>
                    <li><code>CALL reg</code> - Enter a procedure using the capability in reg</li>
                    <li><code>RETURN</code> - Exit current procedure</li>
                    <li><code>SWITCH reg</code> - Change namespace to capability in reg</li>
                </ul>
                <div class="key-concept">
                    <strong>Important:</strong> These operations always check permissions. You cannot SAVE without the B (Bind) permission!
                </div>`,
                demo: `<div class="demo-title">Capability Flow</div>
                <div class="demo-content">
                    <div class="demo-visual">
                        <div style="display: flex; align-items: center; gap: 1rem; justify-content: center;">
                            <div style="padding: 0.8rem; background: var(--bg-panel); border-radius: 4px; border: 1px solid var(--accent);">Memory</div>
                            <div style="color: var(--accent);">LOAD &rarr;</div>
                            <div style="padding: 0.8rem; background: var(--accent); color: white; border-radius: 4px;">CR</div>
                            <div style="color: var(--success);">&rarr; SAVE</div>
                            <div style="padding: 0.8rem; background: var(--bg-panel); border-radius: 4px; border: 1px solid var(--success);">Memory</div>
                        </div>
                    </div>
                    <div class="demo-explanation">
                        <p>LOAD brings capabilities into registers for use. SAVE (with B permission) stores them persistently.</p>
                    </div>
                </div>`
            },
            {
                text: `<h3>The CALL and RETURN Pattern</h3>
                <p>To execute protected code:</p>
                <ol>
                    <li>Load the code capability into a context register</li>
                    <li>Use <code>CALL</code> to enter the procedure</li>
                    <li>The procedure executes with its own capability scope</li>
                    <li><code>RETURN</code> exits and restores the previous context</li>
                </ol>
                <div class="highlight">
                    CALL requires the <code>E</code> (Enter) permission on the capability. This controls who can invoke what code.
                </div>`,
                demo: `<div class="demo-title">Procedure Call Flow</div>
                <div class="demo-content">
                    <div class="demo-visual">
                        <div style="display: flex; flex-direction: column; gap: 0.5rem; align-items: center;">
                            <div style="padding: 0.5rem 1rem; background: var(--bg-panel); border-radius: 4px;">User Code</div>
                            <div style="color: var(--accent);">&darr; CALL [RXE capability]</div>
                            <div style="padding: 0.5rem 1rem; background: var(--accent); color: white; border-radius: 4px;">Protected Procedure</div>
                            <div style="color: var(--success);">&darr; RETURN</div>
                            <div style="padding: 0.5rem 1rem; background: var(--bg-panel); border-radius: 4px;">Back to User Code</div>
                        </div>
                    </div>
                </div>`
            },
            {
                text: `<h3>Namespace Switching</h3>
                <p>The <code>SWITCH</code> instruction changes the current namespace (CR15):</p>
                <ul>
                    <li>Effectively changes "where you are" in the system</li>
                    <li>Determines what resources you can see and access</li>
                    <li>Requires <code>E</code> (Enter) permission on the target capability</li>
                </ul>
                <p>This enables secure isolation between different parts of the system.</p>`,
                interactive: {
                    type: "quiz",
                    question: "Which permission is required to use CALL or SWITCH on a capability?",
                    options: ["R (Read)", "W (Write)", "X (Execute)", "E (Enter)"],
                    correct: 3,
                    feedback: {
                        correct: "Correct! The E (Enter) permission is required for CALL and SWITCH operations.",
                        incorrect: "Not quite. The E (Enter) permission specifically controls entry into procedures and namespaces."
                    }
                }
            }
        ]
    },
    {
        title: "Security Boundaries",
        steps: [
            {
                text: `<h3>How Capabilities Enforce Security</h3>
                <p>The CTMM's security comes from strict capability checking at every operation:</p>
                <ul>
                    <li><strong>No capability = No access</strong>: Without the right token, operations fail</li>
                    <li><strong>Permission checking</strong>: Each operation requires specific permissions</li>
                    <li><strong>Unforgeable tokens</strong>: 192-bit Golden Keys cannot be guessed</li>
                    <li><strong>No privilege escalation</strong>: You cannot gain permissions you weren't given</li>
                </ul>
                <div class="key-concept">
                    <strong>The Principle of Least Privilege</strong>: Every component gets only the capabilities it needs - nothing more.
                </div>`,
                demo: `<div class="demo-title">Access Denied Example</div>
                <div class="demo-content">
                    <div class="demo-visual">
                        <div style="background: rgba(248, 113, 113, 0.2); padding: 1rem; border-radius: 6px; border: 1px solid var(--error);">
                            <div style="color: var(--error); font-weight: bold;">Attempted: SAVE without B permission</div>
                            <div style="color: var(--text-secondary); font-size: 0.85rem; margin-top: 0.5rem;">Result: Operation denied - missing Bind permission</div>
                        </div>
                    </div>
                    <div class="demo-explanation">
                        <p>Even if you have a valid capability, operations fail if you lack the specific permission required.</p>
                    </div>
                </div>`
            },
            {
                text: `<h3>The Confused Deputy Problem - Solved</h3>
                <p>Traditional systems suffer from the "Confused Deputy" vulnerability:</p>
                <div class="highlight">
                    A privileged program is tricked into misusing its authority for an attacker's benefit.
                </div>
                <p>Capabilities prevent this because:</p>
                <ul>
                    <li>Authority must be explicitly passed with each request</li>
                    <li>A program can only use capabilities it was given</li>
                    <li>No ambient authority means no unintended privilege use</li>
                </ul>`,
                demo: `<div class="demo-title">Traditional vs Capability Security</div>
                <div class="demo-content">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div style="background: rgba(248, 113, 113, 0.15); padding: 1rem; border-radius: 6px;">
                            <div style="color: var(--error); font-weight: bold; margin-bottom: 0.5rem;">Traditional (Vulnerable)</div>
                            <div style="font-size: 0.85rem; color: var(--text-secondary);">"I'm the compiler, let me write anywhere I have access to"</div>
                        </div>
                        <div style="background: rgba(74, 222, 128, 0.15); padding: 1rem; border-radius: 6px;">
                            <div style="color: var(--success); font-weight: bold; margin-bottom: 0.5rem;">Capability (Secure)</div>
                            <div style="font-size: 0.85rem; color: var(--text-secondary);">"Write to THIS specific file using THIS capability"</div>
                        </div>
                    </div>
                </div>`
            },
            {
                text: `<h3>Congratulations!</h3>
                <p>You've learned the fundamentals of capability-based security:</p>
                <ul>
                    <li>Capabilities are unforgeable tokens granting specific access</li>
                    <li>The 7 permissions (R, W, X, L, S, E, B) control what you can do</li>
                    <li>The boot sequence establishes the secure foundation</li>
                    <li>Context and Data registers serve different purposes</li>
                    <li>Capability operations require proper permissions</li>
                </ul>
                <div class="key-concept">
                    <strong>Next Steps:</strong> Try the simulator! Use the CPU State Dashboard to boot the system, explore the Capability Explorer, and write programs in the Assembly Editor.
                </div>`,
                interactive: {
                    type: "quiz",
                    question: "What is the main advantage of capability-based security over traditional ACLs?",
                    options: [
                        "It's faster",
                        "It uses less memory",
                        "Authority is explicit and cannot be misused through confused deputy attacks",
                        "It's easier to configure"
                    ],
                    correct: 2,
                    feedback: {
                        correct: "Correct! Capabilities make authority explicit, preventing confused deputy attacks and unintended privilege use.",
                        incorrect: "Not quite. The key advantage is that capabilities make authority explicit, preventing confused deputy attacks."
                    }
                }
            }
        ]
    }
];

function loadLesson(lessonIndex) {
    tutorialState.currentLesson = lessonIndex;
    tutorialState.currentStep = 0;
    
    document.querySelectorAll('.lesson-btn').forEach((btn, i) => {
        btn.classList.toggle('active', i === lessonIndex);
    });
    
    renderCurrentStep();
}

function renderCurrentStep() {
    const lesson = lessons[tutorialState.currentLesson];
    const step = lesson.steps[tutorialState.currentStep];
    
    document.getElementById('lessonTitle').textContent = lesson.title;
    document.getElementById('lessonText').innerHTML = step.text || '';
    document.getElementById('lessonDemo').innerHTML = step.demo || '';
    
    const interactiveContainer = document.getElementById('lessonInteractive');
    if (step.interactive) {
        renderInteractive(step.interactive, interactiveContainer);
    } else {
        interactiveContainer.innerHTML = '';
    }
    
    document.getElementById('stepIndicator').textContent = 
        `Step ${tutorialState.currentStep + 1} of ${lesson.steps.length}`;
    
    document.getElementById('prevBtn').disabled = tutorialState.currentStep === 0;
    document.getElementById('nextBtn').disabled = tutorialState.currentStep >= lesson.steps.length - 1;
}

function renderInteractive(interactive, container) {
    if (interactive.type === 'quiz') {
        let html = `<div class="interactive-title">Quick Check</div>`;
        html += `<div class="quiz-question">${interactive.question}</div>`;
        html += `<div class="quiz-options">`;
        interactive.options.forEach((opt, i) => {
            html += `<button class="quiz-option" onclick="checkAnswer(${i}, ${interactive.correct})">${opt}</button>`;
        });
        html += `</div>`;
        html += `<div class="quiz-feedback" id="quizFeedback" style="display: none;"></div>`;
        container.innerHTML = html;
    }
}

function checkAnswer(selected, correct) {
    const options = document.querySelectorAll('.quiz-option');
    const feedback = document.getElementById('quizFeedback');
    const lesson = lessons[tutorialState.currentLesson];
    const step = lesson.steps[tutorialState.currentStep];
    
    options.forEach((opt, i) => {
        opt.disabled = true;
        if (i === correct) {
            opt.classList.add('correct');
        } else if (i === selected && selected !== correct) {
            opt.classList.add('incorrect');
        }
    });
    
    feedback.style.display = 'block';
    if (selected === correct) {
        feedback.className = 'quiz-feedback correct';
        feedback.textContent = step.interactive.feedback.correct;
    } else {
        feedback.className = 'quiz-feedback incorrect';
        feedback.textContent = step.interactive.feedback.incorrect;
    }
}

function prevStep() {
    if (tutorialState.currentStep > 0) {
        tutorialState.currentStep--;
        renderCurrentStep();
    }
}

function nextStep() {
    const lesson = lessons[tutorialState.currentLesson];
    if (tutorialState.currentStep < lesson.steps.length - 1) {
        tutorialState.currentStep++;
        renderCurrentStep();
    }
}

function completeLesson() {
    tutorialState.completedLessons.add(tutorialState.currentLesson);
    
    document.querySelectorAll('.lesson-btn').forEach((btn, i) => {
        if (tutorialState.completedLessons.has(i)) {
            btn.classList.add('completed');
        }
    });
    
    const progress = (tutorialState.completedLessons.size / lessons.length) * 100;
    document.getElementById('tutorialProgress').style.width = `${progress}%`;
    document.getElementById('progressText').textContent = 
        `${tutorialState.completedLessons.size} / ${lessons.length} completed`;
    
    if (tutorialState.currentLesson < lessons.length - 1) {
        loadLesson(tutorialState.currentLesson + 1);
    }
}

function tryInSimulator() {
    switchView('dashboard');
    document.getElementById('viewSelect').value = 'dashboard';
}

document.addEventListener('DOMContentLoaded', function() {
    if (lessons.length > 0) {
        loadLesson(0);
    }
});

// ==================== CONTEXT MENU & OBJECT MANAGEMENT ====================

let contextMenuState = {
    targetObject: null,
    targetType: null,
    editMode: false
};

let dynamicObjects = [];
let nextAddress = 0x8000;
let dynamicCLists = {};

let selectedObject = {
    name: null,
    type: null
};

function saveToStorage() {
    const state = {
        dynamicObjects,
        dynamicCLists,
        nextAddress,
        namespaceModifications: namespaceObjects.map(o => ({
            name: o.name,
            type: o.type,
            size: o.size,
            perms: o.perms
        }))
    };
    localStorage.setItem('pp250_namespace_state', JSON.stringify(state));
}

function loadFromStorage() {
    try {
        const saved = localStorage.getItem('pp250_namespace_state');
        if (saved) {
            const state = JSON.parse(saved);
            dynamicObjects = state.dynamicObjects || [];
            dynamicCLists = state.dynamicCLists || {};
            nextAddress = state.nextAddress || 0x8000;
            
            if (state.namespaceModifications) {
                state.namespaceModifications.forEach(mod => {
                    const obj = namespaceObjects.find(o => o.name === mod.name);
                    if (obj) {
                        obj.type = mod.type;
                        obj.size = mod.size;
                        obj.perms = mod.perms;
                    }
                });
            }
            
            log('Restored saved namespace state', 'info');
        }
    } catch (e) {
        console.error('Failed to load saved state:', e);
    }
}

function clearStoredState() {
    localStorage.removeItem('pp250_namespace_state');
    dynamicObjects = [];
    dynamicCLists = {};
    nextAddress = 0x8000;
    log('Cleared stored namespace state', 'info');
}

function selectObject(name, type) {
    selectedObject.name = name;
    selectedObject.type = type;
    
    document.querySelectorAll('.ns-object.selected, .hier-item.selected').forEach(el => {
        el.classList.remove('selected');
    });
    
    document.querySelectorAll(`.ns-object[data-name="${name}"], .hier-item[data-name="${name}"]`).forEach(el => {
        el.classList.add('selected');
    });
    
    const label = document.getElementById('selectedObjectName');
    if (label) {
        label.textContent = name || 'None';
    }
    
    contextMenuState.targetObject = name;
    contextMenuState.targetType = type;
}

function toolbarAction(action) {
    if (!selectedObject.name && action !== 'add') {
        log('Please select an object first by clicking on it', 'warning');
        return;
    }
    
    if (action === 'add' && !selectedObject.name) {
        contextMenuState.targetObject = 'Boot';
        contextMenuState.targetType = 'Root';
    }
    
    contextMenuAction(action);
}

function hideContextMenu() {
    document.getElementById('contextMenu').classList.remove('visible');
}

function showContextMenu(e, objectName, objectType) {
    e.preventDefault();
    contextMenuState.targetObject = objectName;
    contextMenuState.targetType = objectType;
    
    const menu = document.getElementById('contextMenu');
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    menu.classList.add('visible');
}

document.addEventListener('click', function(e) {
    if (!e.target.closest('.context-menu')) {
        hideContextMenu();
    }
});

document.addEventListener('contextmenu', function(e) {
    if (!e.target.closest('.ns-object') && !e.target.closest('.hier-item')) {
        hideContextMenu();
    }
});

function contextMenuAction(action) {
    hideContextMenu();
    
    switch(action) {
        case 'add':
            openAddObjectModal();
            break;
        case 'edit':
            openEditObjectModal();
            break;
        case 'link':
            openLinkModal();
            break;
        case 'delete':
            deleteObject();
            break;
    }
}

function updatePermissionsForType(type) {
    const dataPerms = ['R', 'W', 'X'];
    const capPerms = ['L', 'S', 'E', 'B'];
    
    const isDataType = (type === 'Data');
    
    dataPerms.forEach(p => {
        const checkbox = document.getElementById(`modalPerm${p}`);
        const label = checkbox.parentElement;
        checkbox.disabled = !isDataType;
        label.classList.toggle('perm-disabled', !isDataType);
        if (!isDataType) checkbox.checked = false;
    });
    
    capPerms.forEach(p => {
        const checkbox = document.getElementById(`modalPerm${p}`);
        const label = checkbox.parentElement;
        checkbox.disabled = isDataType;
        label.classList.toggle('perm-disabled', isDataType);
        if (isDataType) checkbox.checked = false;
    });
}

function openAddObjectModal() {
    contextMenuState.editMode = false;
    document.getElementById('modalTitle').textContent = 'Add New Object';
    document.getElementById('objectModal').querySelector('.modal-btn-confirm').textContent = 'Create';
    
    document.getElementById('modalObjName').value = '';
    document.getElementById('modalObjType').value = 'Data';
    document.getElementById('modalObjSize').value = '1024';
    
    ['R', 'W', 'X', 'L', 'S', 'E', 'B'].forEach(p => {
        document.getElementById(`modalPerm${p}`).checked = (p === 'R');
    });
    
    updatePermissionsForType('Data');
    
    populateParentSelect();
    document.getElementById('modalParent').value = contextMenuState.targetObject || 'Boot';
    
    document.getElementById('objectModal').classList.add('visible');
}

function openEditObjectModal() {
    contextMenuState.editMode = true;
    document.getElementById('modalTitle').textContent = 'Edit Object';
    document.getElementById('objectModal').querySelector('.modal-btn-confirm').textContent = 'Save';
    
    const obj = findObject(contextMenuState.targetObject);
    if (!obj) {
        log('Object not found for editing', 'error');
        return;
    }
    
    document.getElementById('modalObjName').value = obj.name;
    document.getElementById('modalObjType').value = obj.type;
    document.getElementById('modalObjSize').value = obj.size.toString();
    
    updatePermissionsForType(obj.type);
    
    ['R', 'W', 'X', 'L', 'S', 'E', 'B'].forEach(p => {
        const checkbox = document.getElementById(`modalPerm${p}`);
        if (!checkbox.disabled) {
            checkbox.checked = obj.perms.includes(p);
        }
    });
    
    populateParentSelect();
    document.getElementById('modalParent').value = obj.parent || 'Boot';
    
    document.getElementById('objectModal').classList.add('visible');
}

function closeObjectModal() {
    document.getElementById('objectModal').classList.remove('visible');
}

function confirmObjectModal() {
    const name = document.getElementById('modalObjName').value.trim();
    if (!name) {
        log('Object name is required', 'error');
        return;
    }
    
    const type = document.getElementById('modalObjType').value;
    const size = parseInt(document.getElementById('modalObjSize').value);
    const parent = document.getElementById('modalParent').value;
    
    const perms = [];
    ['R', 'W', 'X', 'L', 'S', 'E', 'B'].forEach(p => {
        if (document.getElementById(`modalPerm${p}`).checked) {
            perms.push(p);
        }
    });
    
    if (contextMenuState.editMode) {
        updateObject(contextMenuState.targetObject, { name, type, size, perms, parent });
    } else {
        createObject(name, type, size, perms, parent);
    }
    
    closeObjectModal();
    updateNamespaceDisplay();
    updateCapabilityExplorer();
    updateDisplay();
}

function findObject(name) {
    let obj = namespaceObjects.find(o => o.name === name);
    if (!obj) {
        obj = dynamicObjects.find(o => o.name === name);
    }
    return obj;
}

function getAllObjects() {
    return [...namespaceObjects, ...dynamicObjects];
}

function allocateAddress(size) {
    const alignedSize = Math.ceil(size / 0x1000) * 0x1000;
    const addr = nextAddress;
    nextAddress += alignedSize;
    return addr;
}

function createObject(name, type, size, perms, parentName) {
    if (findObject(name)) {
        log(`Object "${name}" already exists`, 'error');
        return;
    }
    
    const location = allocateAddress(size);
    const newObj = {
        location,
        name,
        type,
        perms,
        size,
        parent: parentName,
        dynamic: true
    };
    
    dynamicObjects.push(newObj);
    
    addToCList(parentName, name, type, perms);
    
    log(`Created object "${name}" at 0x${location.toString(16).toUpperCase().padStart(4, '0')}`, 'info');
    saveToStorage();
}

function findAllCListReferences(name) {
    const refs = [];
    
    if (bootNamespace.clist.some(c => c.name === name)) {
        refs.push({ parent: 'Boot', type: 'boot' });
    }
    
    Object.keys(threadCLists).forEach(threadName => {
        if (threadCLists[threadName].clist.some(c => c.name === name)) {
            refs.push({ parent: threadName, type: 'thread' });
        }
    });
    
    Object.keys(abstractionCLists).forEach(absName => {
        if (abstractionCLists[absName].clist.some(c => c.name === name)) {
            refs.push({ parent: absName, type: 'abstraction' });
        }
    });
    
    Object.keys(dynamicCLists).forEach(dynName => {
        if (dynamicCLists[dynName].some(c => c.name === name)) {
            refs.push({ parent: dynName, type: 'dynamic' });
        }
    });
    
    return refs;
}

function updateObject(oldName, updates) {
    let obj = dynamicObjects.find(o => o.name === oldName);
    let isBuiltIn = false;
    
    if (!obj) {
        obj = namespaceObjects.find(o => o.name === oldName);
        isBuiltIn = true;
    }
    
    if (!obj) {
        log('Object not found', 'error');
        return;
    }
    
    const oldParent = obj.parent;
    const parentChanged = oldParent !== updates.parent;
    
    const allRefs = findAllCListReferences(oldName);
    
    removeFromCLists(oldName);
    
    if (oldName !== updates.name && dynamicCLists[oldName]) {
        dynamicCLists[updates.name] = dynamicCLists[oldName];
        delete dynamicCLists[oldName];
    }
    
    obj.name = updates.name;
    obj.type = updates.type;
    obj.size = updates.size;
    obj.perms = updates.perms;
    if (!isBuiltIn) {
        obj.parent = updates.parent;
    }
    
    const addedParents = new Set();
    
    allRefs.forEach(ref => {
        if (parentChanged && ref.parent === oldParent) {
            return;
        }
        if (!addedParents.has(ref.parent)) {
            addToCList(ref.parent, updates.name, updates.type, updates.perms);
            addedParents.add(ref.parent);
        }
    });
    
    if (!addedParents.has(updates.parent)) {
        addToCList(updates.parent, updates.name, updates.type, updates.perms);
    }
    
    dynamicObjects.forEach(child => {
        if (child.parent === oldName) {
            child.parent = updates.name;
        }
    });
    
    log(`Updated object "${updates.name}"`, 'info');
    saveToStorage();
    syncSimulatorCapabilities(oldName, updates);
}

function syncSimulatorCapabilities(oldName, updates) {
    const updateCap = (cap) => {
        if (cap && cap.name === oldName) {
            cap.name = updates.name;
            cap.perms = updates.perms;
            if (updates.size) {
                cap.location = { type: "Local", offset: updates.location || cap.location?.offset || 0 };
            }
        }
    };
    
    updateCap(simulator.cr15);
    updateCap(simulator.cr8);
    
    for (let i = 0; i < 8; i++) {
        updateCap(simulator.contextRegs[i]);
    }
    
    if (simulator.clist) {
        simulator.clist.forEach(updateCap);
    }
}

function deleteObjectRecursive(name) {
    const children = dynamicObjects.filter(o => o.parent === name);
    children.forEach(child => {
        deleteObjectRecursive(child.name);
    });
    
    const idx = dynamicObjects.findIndex(o => o.name === name);
    if (idx >= 0) {
        dynamicObjects.splice(idx, 1);
    }
    
    removeFromCLists(name);
    
    if (dynamicCLists[name]) {
        delete dynamicCLists[name];
    }
}

function deleteObject() {
    const name = contextMenuState.targetObject;
    const obj = dynamicObjects.find(o => o.name === name);
    
    if (obj) {
        deleteObjectRecursive(name);
        log(`Deleted object "${name}" and its children`, 'info');
        saveToStorage();
        updateNamespaceDisplay();
        updateCapabilityExplorer();
        updateDisplay();
    } else {
        log('Cannot delete built-in objects', 'warning');
    }
}

function addToCList(parentName, childName, childType, childPerms) {
    const entry = {
        name: childName,
        type: childType,
        perms: childPerms
    };
    
    if (threadCLists[parentName]) {
        threadCLists[parentName].clist.push(entry);
    } else if (abstractionCLists[parentName]) {
        abstractionCLists[parentName].clist.push(entry);
    } else if (parentName === 'Boot') {
        bootNamespace.clist.push({
            name: childName,
            type: childType,
            ref: `dynamic.${childName.toLowerCase()}`
        });
    } else {
        if (!dynamicCLists[parentName]) {
            dynamicCLists[parentName] = [];
        }
        dynamicCLists[parentName].push(entry);
    }
}

function removeFromCLists(name) {
    bootNamespace.clist = bootNamespace.clist.filter(c => c.name !== name);
    
    Object.values(threadCLists).forEach(thread => {
        thread.clist = thread.clist.filter(c => c.name !== name);
    });
    
    Object.values(abstractionCLists).forEach(abs => {
        abs.clist = abs.clist.filter(c => c.name !== name);
    });
    
    Object.keys(dynamicCLists).forEach(key => {
        dynamicCLists[key] = dynamicCLists[key].filter(c => c.name !== name);
    });
}

function populateParentSelect() {
    const select = document.getElementById('modalParent');
    select.innerHTML = '<option value="Boot">Boot (root)</option>';
    
    Object.keys(threadCLists).forEach(name => {
        select.innerHTML += `<option value="${name}">${name} (Thread)</option>`;
    });
    
    Object.keys(abstractionCLists).forEach(name => {
        select.innerHTML += `<option value="${name}">${name} (Abstraction)</option>`;
    });
    
    dynamicObjects.filter(o => o.type === 'C-List' || o.type === 'Abstraction').forEach(obj => {
        select.innerHTML += `<option value="${obj.name}">${obj.name} (${obj.type})</option>`;
    });
}

function openLinkModal() {
    document.getElementById('linkSource').value = contextMenuState.targetObject;
    
    const targetSelect = document.getElementById('linkTarget');
    targetSelect.innerHTML = '';
    
    targetSelect.innerHTML += '<option value="Boot">Boot (root)</option>';
    Object.keys(threadCLists).forEach(name => {
        if (name !== contextMenuState.targetObject) {
            targetSelect.innerHTML += `<option value="${name}">${name}</option>`;
        }
    });
    Object.keys(abstractionCLists).forEach(name => {
        if (name !== contextMenuState.targetObject) {
            targetSelect.innerHTML += `<option value="${name}">${name}</option>`;
        }
    });
    
    document.getElementById('linkModal').classList.add('visible');
}

function closeLinkModal() {
    document.getElementById('linkModal').classList.remove('visible');
}

function confirmLinkModal() {
    const source = document.getElementById('linkSource').value;
    const target = document.getElementById('linkTarget').value;
    
    const obj = findObject(source);
    if (obj) {
        addToCList(target, source, obj.type, obj.perms || ['R']);
        log(`Linked "${source}" to ${target}'s C-List`, 'info');
        updateNamespaceDisplay();
    }
    
    closeLinkModal();
}

function attachContextMenuListeners() {
    document.querySelectorAll('.ns-object').forEach(el => {
        el.addEventListener('click', function(e) {
            const name = this.dataset.name;
            const type = this.dataset.type;
            selectObject(name, type);
        });
        el.addEventListener('contextmenu', function(e) {
            const name = this.dataset.name;
            const type = this.dataset.type;
            selectObject(name, type);
            showContextMenu(e, name, type);
        });
    });
    
    document.querySelectorAll('.hier-item').forEach(el => {
        el.addEventListener('click', function(e) {
            e.stopPropagation();
            const name = this.dataset.name;
            const type = this.dataset.type || 'unknown';
            selectObject(name, type);
        });
        el.addEventListener('contextmenu', function(e) {
            e.stopPropagation();
            const name = this.dataset.name;
            const type = this.dataset.type || 'unknown';
            selectObject(name, type);
            showContextMenu(e, name, type);
        });
    });
}

// ==================== TOOLTIP AUTO-FADE ====================
// Hide tooltips after 5 seconds of mouse inactivity
let tooltipFadeTimer = null;
const TOOLTIP_FADE_DELAY = 5000;

function resetTooltipFadeTimer() {
    document.body.classList.remove('tooltip-hidden');
    if (tooltipFadeTimer) {
        clearTimeout(tooltipFadeTimer);
    }
    tooltipFadeTimer = setTimeout(() => {
        document.body.classList.add('tooltip-hidden');
    }, TOOLTIP_FADE_DELAY);
}

document.addEventListener('mousemove', resetTooltipFadeTimer);
document.addEventListener('mouseenter', resetTooltipFadeTimer, true);
resetTooltipFadeTimer();

// ==================== CODE EDITOR CONTEXT MENU ====================
let codeEditorCursorPos = 0;

function showCodeContextMenu(e) {
    e.preventDefault();
    const menu = document.getElementById('codeContextMenu');
    const editor = document.getElementById('codeEditor');
    
    codeEditorCursorPos = editor.selectionStart;
    
    const menuWidth = 200;
    const submenuWidth = 180;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    let posX = e.pageX;
    let posY = e.pageY;
    
    if (posX + menuWidth + submenuWidth > viewportWidth) {
        menu.querySelectorAll('.submenu').forEach(sub => sub.classList.add('flip-left'));
    } else {
        menu.querySelectorAll('.submenu').forEach(sub => sub.classList.remove('flip-left'));
    }
    
    if (posX + menuWidth > viewportWidth) {
        posX = viewportWidth - menuWidth - 10;
    }
    
    const menuHeight = 350;
    if (posY + menuHeight > viewportHeight) {
        posY = viewportHeight - menuHeight - 10;
    }
    
    menu.style.left = posX + 'px';
    menu.style.top = posY + 'px';
    menu.classList.add('visible');
    
    document.getElementById('contextMenu').classList.remove('visible');
}

function hideCodeContextMenu() {
    document.getElementById('codeContextMenu').classList.remove('visible');
}

const codeTemplates = {
    'ycombinator': `; ================================================
; Y-COMBINATOR using Golden Tokens
; Fixed-point combinator for recursion via capabilities
; Y = λf.(λx.f(x x))(λx.f(x x))
; ================================================

; Setup: Load the self-referencing GT into CR0
LOAD 0 15 0       ; CR0 = GT to self (the function to recurse)

; Step 1: Create inner lambda (λx.f(x x))
; The GT in CR0 points to code that will call itself
TPERM 0 X         ; Verify CR0 has Execute permission
B NE error        ; Branch to error if not executable

; Step 2: Apply f to (x x) - self-application via CALL
CALL 0            ; Execute the GT - this is (x x)

; Step 3: The called function receives its own GT
; enabling recursion without explicit self-reference
; The callee can CALL CR0 to recurse

; On return, result is in DR0
RETURN            ; Return from Y-combinator application

error:
; Security trap - invalid capability
MOV 0 0           ; NOP - handle error`,

    'factorial': `; ================================================
; FACTORIAL using recursive GT calls
; fact(n) = n * fact(n-1), fact(0) = 1
; Input: DR0 = n, Output: DR0 = n!
; ================================================

; Base case check
CMP 0 0           ; Compare DR0 with 0
B EQ base_case    ; If n == 0, return 1

; Recursive case: n * fact(n-1)
MOV 1 0           ; DR1 = n (save for multiplication)
SUBI 0 1          ; DR0 = n - 1

; Load recursive GT and call
LOAD 0 15 0       ; CR0 = GT to factorial function
TPERM 0 X         ; Verify execute permission
CALL 0            ; Recurse: DR0 = fact(n-1)

; Multiply: n * fact(n-1)
MUL 0 1           ; DR0 = DR0 * DR1 = fact(n-1) * n
RETURN

base_case:
ADDI 0 1          ; DR0 = 1 (0! = 1)
RETURN`,

    'capcheck': `; ================================================
; CAPABILITY VALIDATION PATTERN
; Safely check a gifted GT before use
; ================================================

; Step 1: Test required permissions (RWX)
TPERM 0 RWX       ; Check CR0 has Read+Write+Execute
B NE reject       ; If missing permissions, reject

; Step 2: Test bounds (optional size check)
TPERM 0 R BOUNDS 1024  ; Verify size >= 1024 bytes
B NE reject       ; If too small, reject

; Step 3: Capability is valid - proceed
LOAD 1 0 0        ; Use the validated capability
; ... safe operations here ...
RETURN

reject:
; Capability failed validation - potential malware
NEG 0 0           ; Set error flag (DR0 = 0)
SUBI 0 1          ; DR0 = -1 (error code)
RETURN            ; Return with error`,

    'church_bool': `; ================================================
; CHURCH BOOLEANS using Golden Tokens
; TRUE  = λx.λy.x  (select first)
; FALSE = λx.λy.y  (select second)
; ================================================

; TRUE: Returns first argument (CR1)
true:
LOAD 0 1 0        ; CR0 = first argument GT
RETURN            ; Return first

; FALSE: Returns second argument (CR2)
false:
LOAD 0 2 0        ; CR0 = second argument GT
RETURN            ; Return second

; IF-THEN-ELSE: λb.λt.λf. b t f
; Input: CR0=bool, CR1=then-branch, CR2=else-branch
if_then_else:
TPERM 0 X         ; Verify bool is callable
CALL 0            ; Call bool with then/else in CR1/CR2
RETURN            ; Result is in CR0

; NOT: λb. b FALSE TRUE
not:
; Swap CR1 and CR2, then call bool
LOAD 3 1 0        ; CR3 = temp = CR1
LOAD 1 2 0        ; CR1 = CR2 (FALSE position)
LOAD 2 3 0        ; CR2 = temp (TRUE position)
CALL 0            ; bool selects opposite
RETURN`,

    'church_num': `; ================================================
; CHURCH NUMERALS using Golden Tokens
; 0 = λf.λx.x           (apply f zero times)
; 1 = λf.λx.f x         (apply f once)
; n = λf.λx.f^n x       (apply f n times)
; ================================================

; ZERO: λf.λx.x (identity on x)
zero:
LOAD 0 2 0        ; CR0 = x (second arg, ignore f)
RETURN

; SUCC: λn.λf.λx.f(n f x)
; Add one to Church numeral
; Input: CR0=n, CR1=f, CR2=x
succ:
; First compute (n f x)
LOAD 3 0 0        ; CR3 = n (save numeral)
CALL 3            ; Apply n to f,x -> result in CR0

; Then apply f one more time
LOAD 3 0 0        ; CR3 = (n f x) result
LOAD 0 1 0        ; CR0 = f
LOAD 1 3 0        ; CR1 = previous result
CALL 0            ; f(n f x)
RETURN

; ADD: λm.λn.λf.λx. m f (n f x)
; Input: CR0=m, CR1=n, CR2=f, CR3=x
add:
; First: (n f x)
LOAD 4 1 0        ; CR4 = n
LOAD 5 2 0        ; Prepare f for n
CALL 4            ; n f x -> CR0

; Then: m f (result)
LOAD 4 0 0        ; CR4 = m
LOAD 1 0 0        ; CR1 = (n f x) as new x
LOAD 0 2 0        ; CR0 = f
CALL 4            ; m f (n f x)
RETURN`,

    'pair': `; ================================================
; PAIR (CONS) using Golden Tokens
; PAIR = λa.λb.λf. f a b
; FST  = λp. p TRUE
; SND  = λp. p FALSE
; ================================================

; PAIR: Create a pair from two values
; Input: CR1=first, CR2=second
; Returns: GT that when called with selector returns element
pair:
; Store a and b, return selector function
; The returned GT captures CR1 and CR2
LOAD 0 6 0        ; CR0 = GT to pair_select
RETURN

; Called when pair is applied to selector
pair_select:
; CR0 = selector (TRUE or FALSE)
; CR1, CR2 still hold the paired values
CALL 0            ; Selector chooses CR1 or CR2
RETURN

; FST: Get first element of pair
; Input: CR0 = pair
fst:
LOAD 1 15 1       ; CR1 = TRUE GT
CALL 0            ; pair(TRUE) -> first element
RETURN

; SND: Get second element of pair
; Input: CR0 = pair
snd:
LOAD 1 15 2       ; CR1 = FALSE GT
CALL 0            ; pair(FALSE) -> second element
RETURN`,

    'omega': `; ================================================
; OMEGA - Non-termination example
; ω = λx.x x
; Ω = ω ω = (λx.x x)(λx.x x) -> infinite loop
; WARNING: This will not terminate!
; ================================================

; Self-application: λx.x x
omega:
LOAD 0 0 0        ; CR0 = self (x)
TPERM 0 X         ; Verify executable
CALL 0            ; x x (call self with self)
; Never reaches here if truly self-referential
RETURN

; To create Ω, call omega with itself:
; LOAD 0 [omega_gt]
; CALL 0
; This demonstrates non-termination in lambda calc`
};

const instructionComments = {
    'ADD': 'Add: DR[dest] = DR[dest] + DR[src]',
    'SUB': 'Subtract: DR[dest] = DR[dest] - DR[src]',
    'MUL': 'Multiply: DR[dest] = DR[dest] * DR[src]',
    'NEG': 'Negate: DR[dest] = -DR[src]',
    'ADDI': 'Add immediate: DR[dest] = DR[dest] + imm',
    'SUBI': 'Subtract immediate: DR[dest] = DR[dest] - imm',
    'AND': 'Bitwise AND: DR[dest] = DR[dest] AND DR[src]',
    'ORR': 'Bitwise OR: DR[dest] = DR[dest] OR DR[src]',
    'EOR': 'Bitwise XOR: DR[dest] = DR[dest] XOR DR[src]',
    'BIC': 'Bit clear: DR[dest] = DR[dest] AND NOT DR[src]',
    'NOT': 'Bitwise NOT: DR[dest] = NOT DR[src]',
    'MOV': 'Move: DR[dest] = DR[src]',
    'MVN': 'Move NOT: DR[dest] = NOT DR[src]',
    'LSL': 'Logical shift left by amt bits',
    'LSR': 'Logical shift right by amt bits',
    'ASR': 'Arithmetic shift right (preserves sign)',
    'ROR': 'Rotate right by amt bits',
    'CMP': 'Compare: sets flags from DR[r1] - DR[r2]',
    'CMN': 'Compare negative: sets flags from DR[r1] + DR[r2]',
    'TST': 'Test bits: sets flags from DR[r1] AND DR[r2]',
    'TEQ': 'Test equal: sets flags from DR[r1] XOR DR[r2]',
    'B': 'Branch to offset (conditional if code given)',
    'BL': 'Branch with link: saves return address',
    'LOAD': 'Load capability from namespace into CR',
    'SAVE': 'Save data using capability permissions',
    'CALL': 'Call procedure via capability',
    'RETURN': 'Return from procedure call',
    'CHANGE': 'Context switch to thread at offset',
    'SWITCH': 'Set CR15 namespace to capability in CR',
    'TPERM': 'Test permissions on capability'
};

function insertInstruction(instr, operands) {
    const editor = document.getElementById('codeEditor');
    const text = editor.value;
    const pos = codeEditorCursorPos;
    
    let lineStart = text.lastIndexOf('\n', pos - 1) + 1;
    let lineEnd = text.indexOf('\n', pos);
    if (lineEnd === -1) lineEnd = text.length;
    
    const currentLine = text.substring(lineStart, lineEnd).trim();
    const isEmptyLine = currentLine === '';
    
    let insertText = operands ? `${instr} ${operands}` : instr;
    
    const comment = instructionComments[instr];
    if (comment) {
        insertText += `  ; ${comment}`;
    }
    
    if (!isEmptyLine) {
        insertText = '\n' + insertText;
    }
    
    const newText = text.substring(0, pos) + insertText + text.substring(pos);
    editor.value = newText;
    
    const newPos = pos + insertText.length;
    editor.selectionStart = newPos;
    editor.selectionEnd = newPos;
    editor.focus();
    
    hideCodeContextMenu();
    
    if (typeof updateLineNumbers === 'function') {
        updateLineNumbers();
    }
}

function insertTemplate(templateName) {
    const editor = document.getElementById('codeEditor');
    const template = codeTemplates[templateName];
    
    if (!template) {
        console.error('Template not found:', templateName);
        return;
    }
    
    const text = editor.value;
    const pos = codeEditorCursorPos;
    
    let insertText = template;
    
    if (pos > 0 && text[pos - 1] !== '\n') {
        insertText = '\n\n' + insertText;
    }
    
    const newText = text.substring(0, pos) + insertText + text.substring(pos);
    editor.value = newText;
    
    const newPos = pos + insertText.length;
    editor.selectionStart = newPos;
    editor.selectionEnd = newPos;
    editor.focus();
    
    hideCodeContextMenu();
    
    if (typeof updateLineNumbers === 'function') {
        updateLineNumbers();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const codeEditor = document.getElementById('codeEditor');
    if (codeEditor) {
        codeEditor.addEventListener('contextmenu', showCodeContextMenu);
    }
    
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.code-context-menu')) {
            hideCodeContextMenu();
        }
    });
});
