let savedEditorContent = '';
let currentView = 'dashboard';

// Track if editor has been initialized with default content
let editorInitialized = false;
// Track if Access.asm was auto-loaded (to allow replacement)
let autoLoadedAccessAsm = false;

// Code history for undo (Ctrl+Z)
const codeHistory = [];
const MAX_HISTORY = 50;
let lastSavedCode = '';

function pushCodeHistory(code) {
    // Don't push if same as last entry
    if (codeHistory.length > 0 && codeHistory[codeHistory.length - 1] === code) {
        return;
    }
    codeHistory.push(code);
    lastSavedCode = code;
    if (codeHistory.length > MAX_HISTORY) {
        codeHistory.shift();
    }
}

// Capture current state before any change (call this before modifying editor)
function capturePreChangeState() {
    const editor = document.getElementById('codeEditor');
    if (editor && editor.value !== lastSavedCode) {
        pushCodeHistory(editor.value);
    }
}

function undoCodeChange() {
    const editor = document.getElementById('codeEditor');
    if (!editor) return;
    
    if (codeHistory.length < 1) {
        editorLog('No undo history available', 'info');
        return;
    }
    
    // If history has items, pop the current state and restore previous
    if (codeHistory.length >= 2) {
        codeHistory.pop(); // Remove current state
        const previousCode = codeHistory[codeHistory.length - 1];
        editor.value = previousCode;
        savedEditorContent = previousCode;
        lastSavedCode = previousCode;
        updateLineNumbers();
        if (previousCode) {
            localStorage.setItem('ctmm_editor_content', previousCode);
        } else {
            localStorage.removeItem('ctmm_editor_content');
        }
        editorLog('Undo: restored previous code', 'info');
    } else if (codeHistory.length === 1) {
        // Only one item - restore it
        const previousCode = codeHistory[0];
        editor.value = previousCode;
        savedEditorContent = previousCode;
        lastSavedCode = previousCode;
        updateLineNumbers();
        if (previousCode) {
            localStorage.setItem('ctmm_editor_content', previousCode);
        }
        editorLog('Undo: restored to initial state', 'info');
    } else {
        editorLog('No undo history available', 'info');
    }
}

// Code status values stored in metadata field (bits 0-7)
const CODE_STATUS = {
    EMPTY: 0x00,      // No code loaded
    DRAFT: 0x01,      // Code is being developed
    COMPILED: 0x02,   // Successfully compiled
    TESTED: 0x03,     // Has passed testing
    APPROVED: 0x04,   // Approved for production use
    SIGNED: 0x05      // Cryptographically signed
};

function getCodeStatusLabel(metadata) {
    const statusCode = metadata & 0xFF;
    switch (statusCode) {
        case CODE_STATUS.EMPTY: return 'Empty';
        case CODE_STATUS.DRAFT: return 'Draft';
        case CODE_STATUS.COMPILED: return 'Compiled';
        case CODE_STATUS.TESTED: return 'Tested';
        case CODE_STATUS.APPROVED: return 'Approved';
        case CODE_STATUS.SIGNED: return 'Signed';
        default: return 'Unknown';
    }
}

function switchView(viewId) {
    currentView = viewId;
    
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
    
    document.querySelectorAll('.view-buttons .btn-view').forEach(btn => {
        btn.classList.remove('active');
    });
    const activeBtn = document.getElementById(`viewBtn-${viewId}`);
    if (activeBtn) {
        activeBtn.classList.add('active');
    }
    
    if (viewId === 'editor') {
        const editor = document.getElementById('codeEditor');
        if (editor && savedEditorContent === '') {
            savedEditorContent = editor.value;
        }
        // Load Access.asm as default ONLY on first initialization when editor is truly empty
        // and no saved content exists in localStorage
        const hasSavedContent = localStorage.getItem('ctmm_editor_content');
        if (!editorInitialized && editor && editor.value.trim() === '' && !hasSavedContent && typeof examplePrograms !== 'undefined' && examplePrograms.access) {
            setEditorCode(examplePrograms.access, 'Boot/Examples/access', '[RX]');
            savedEditorContent = examplePrograms.access;
            pushCodeHistory(examplePrograms.access);
            autoLoadedAccessAsm = true;
            editorLog('Loaded Access.asm as default template', 'info');
        }
        editorInitialized = true;
        if (typeof updateEditorToolbar === 'function') {
            updateEditorToolbar();
        }
        if (typeof updateEditorRegisters === 'function') {
            updateEditorRegisters();
        }
    }
}

function switchCapView(section) {
    const sections = {
        system: 'capSystemSection',
        clist: 'capClistSection'
    };
    Object.values(sections).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    const target = document.getElementById(sections[section]);
    if (target) target.style.display = 'block';
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
// Bits 32-47: Permissions (R/W/X/L/S/E/B/M on/off bits - M=Meta-Machine for hardware-level)
// Bits 48-63: Spare (future flags or Thread ID)

const PERM_BITS = {
    R: 0x0001, W: 0x0002, X: 0x0004, L: 0x0008,
    S: 0x0010, E: 0x0020, B: 0x0040, M: 0x0080, F: 0x0100
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

function formatLittleEndian(value) {
    // Mask to 64 bits to ensure consistent word size
    const masked = BigInt(value) & BigInt('0xFFFFFFFFFFFFFFFF');
    const hex = masked.toString(16).toUpperCase().padStart(16, '0');
    const bytes = [];
    for (let i = 0; i < 16; i += 2) {
        bytes.push(hex.substring(i, i + 2));
    }
    return '0x' + bytes.reverse().join('');
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

function formatLocation(value, isFar) {
    if (isFar && typeof value === 'string') {
        return value;
    }
    return formatWord(value);
}

// ==================== BOOT NAMESPACE ====================

// Boot state including cold restart detection
let coldRestart = true;

// Namespace Table: Raw 3-word entries (W1: Location, W2: Limit, W3: Seals/MAC)
// GT permissions are defined in Boot C-List, NOT here
// Offset = index into this table
const namespaceObjects = [
    // Offset 0: Namespace self-reference
    { offset: 0, name: "Namespace", type: "System", 
      word1_location: 0x0000, word2_limit: 0x10000, word3_seals: 0n,
      tooltip: "Hardware-managed Namespace Table - root of all capability addressing." },
    // Offset 1: Access.asm (Nucleus code)
    { offset: 1, name: "Access", type: "Code", linkage: "Boot/Access.asm",
      word1_location: 0x1000, word2_limit: 0x1000, word3_seals: 0n,
      tooltip: "Nucleus kernel code - provides secure entry points for system calls." },
    // Offset 2: Boot C-List
    { offset: 2, name: "Boot", type: "C-List",
      word1_location: 0x2000, word2_limit: 0x0100, word3_seals: 0n,
      tooltip: "Boot Capability List - initial C-List loaded during system bootstrap." },
    // Offset 3: Kenneth thread
    { offset: 3, name: "Kenneth", type: "Thread",
      word1_location: 0x3000, word2_limit: 0x0800, word3_seals: 0n,
      tooltip: "User thread identity for Kenneth." },
    // Offset 4: Matthew thread
    { offset: 4, name: "Matthew", type: "Thread",
      word1_location: 0x3800, word2_limit: 0x0800, word3_seals: 0n,
      tooltip: "User thread identity for Matthew." },
    // Offset 5: Daniel thread
    { offset: 5, name: "Daniel", type: "Thread",
      word1_location: 0x4000, word2_limit: 0x0800, word3_seals: 0n,
      tooltip: "User thread identity for Daniel." },
    // Offset 6: SlideRule abstraction
    { offset: 6, name: "SlideRule", type: "Abstraction",
      word1_location: 0x5000, word2_limit: 0x1000, word3_seals: 0n,
      tooltip: "SlideRule [FLOAT] - IEEE 754 floating-point math. Use CALL to invoke: ADD, SUB, MUL, DIV, LOG, EXP, SQRT, POW. Requires E permission." },
    // Offset 7: Abacus abstraction
    { offset: 7, name: "Abacus", type: "Abstraction",
      word1_location: 0x6000, word2_limit: 0x1000, word3_seals: 0n,
      tooltip: "Abacus [INTEGER] - 64-bit integer arithmetic. Use CALL to invoke: ADD, SUB, MUL, DIV, MOD, ABS, NEG, INC, DEC. Requires E permission." },
    // Offset 8: Circle abstraction
    { offset: 8, name: "Circle", type: "Abstraction",
      word1_location: 0x7000, word2_limit: 0x1000, word3_seals: 0n,
      tooltip: "Circle [GEOMETRY] - Circle calculations using SlideRule floats. PI, TWO_PI constants, CIRCUMFERENCE, AREA, DIAMETER functions." }
];

// Boot C-List at Namespace offset 2
// This is the AUTHORITATIVE source for all GT definitions (offset, permissions, metadata)
// Each entry is a GT pointing to a namespace offset with specific access rights
const bootCList = {
    name: "Boot",
    description: "Root abstraction C-List of the CTMM system",
    nsOffset: 2,  // Boot C-List is at Namespace offset 2
    entries: [
        // Index 0: Access.asm (Nucleus code) - GT pointing to NS offset 1
        // X = data permission to load code into CR7 (Nucleus register)
        { index: 0, name: "Access", nsOffset: 1, perms: ["X"], type: "Code", 
          desc: "Nucleus entry code", size: 0x1000 },
        // Index 1: Kenneth thread - GT pointing to NS offset 3
        // M = Meta-Machine hardware permission (clears all software permissions)
        { index: 1, name: "Kenneth", nsOffset: 3, perms: ["M"], type: "Thread", 
          desc: "Primary user identity", size: 0x0800 },
        // Index 2: Matthew thread - GT pointing to NS offset 4
        { index: 2, name: "Matthew", nsOffset: 4, perms: ["M"], type: "Thread", 
          desc: "Secondary user identity", size: 0x0800 },
        // Index 3: Daniel thread - GT pointing to NS offset 5
        { index: 3, name: "Daniel", nsOffset: 5, perms: ["M"], type: "Thread", 
          desc: "Tertiary user identity", size: 0x0800 },
        // Index 4: SlideRule abstraction - GT pointing to NS offset 6
        // E = Enter (external interface), B = Bind (capability permissions only)
        { index: 4, name: "SlideRule", nsOffset: 6, perms: ["E", "B"], type: "Abstraction", 
          desc: "IEEE 754 float operations", size: 0x1000 },
        // Index 5: Abacus abstraction - GT pointing to NS offset 7
        { index: 5, name: "Abacus", nsOffset: 7, perms: ["E", "B"], type: "Abstraction", 
          desc: "64-bit integer operations", size: 0x1000 },
        // Index 6: Circle abstraction - GT pointing to NS offset 8
        { index: 6, name: "Circle", nsOffset: 8, perms: ["E", "B"], type: "Abstraction", 
          desc: "Geometric calculations", size: 0x1000 }
    ]
};

// Permission validation constants
const DATA_PERMS = ['R', 'W', 'X'];  // Data permissions - for data/code access
const CAP_PERMS = ['E', 'B'];        // Capability permissions - for object entry/binding
const PROTECTED_PERMS = ['L', 'S'];  // Protected - only via CALL with M elevation
const META_PERM = 'M';               // Hardware-level access, clears all software perms
const FAR_PERM = 'F';                // Far - indicates remote URL location

// Validate permission combinations
function validatePermissions(perms) {
    const errors = [];
    const permSet = new Set(perms);
    
    // Rule 1: M clears all software permissions
    if (permSet.has('M')) {
        const softwarePerms = perms.filter(p => p !== 'M' && p !== 'F');
        if (softwarePerms.length > 0) {
            errors.push({
                type: 'critical',
                msg: `M (Meta-Machine) is a hardware permission that clears all software permissions. Remove: ${softwarePerms.join(', ')}`
            });
        }
    }
    
    // Rule 2: Data and Capability permissions are mutually exclusive
    const hasData = perms.some(p => DATA_PERMS.includes(p));
    const hasCap = perms.some(p => CAP_PERMS.includes(p));
    if (hasData && hasCap) {
        const dataFound = perms.filter(p => DATA_PERMS.includes(p));
        const capFound = perms.filter(p => CAP_PERMS.includes(p));
        errors.push({
            type: 'critical',
            msg: `Data permissions (${dataFound.join(',')}) and Capability permissions (${capFound.join(',')}) are mutually exclusive`
        });
    }
    
    // Rule 3: L and S should not appear in user-facing GTs
    const hasProtected = perms.some(p => PROTECTED_PERMS.includes(p));
    if (hasProtected) {
        const protFound = perms.filter(p => PROTECTED_PERMS.includes(p));
        errors.push({
            type: 'warning',
            msg: `L/S are protected permissions (hidden from users). ${protFound.join(',')} exposed - only accessible via CALL with M elevation`
        });
    }
    
    return errors;
}

// Apply M permission rule: clears all software permissions
function applyMPermRule(perms) {
    if (perms.includes('M')) {
        // M clears everything except F (Far)
        return perms.filter(p => p === 'M' || p === 'F');
    }
    return perms;
}

// Normalize permissions to enforce all rules
function normalizePermissions(perms) {
    if (!perms || !Array.isArray(perms)) return [];
    
    let result = [...perms];
    
    // Rule 1: M clears all software permissions
    if (result.includes('M')) {
        result = result.filter(p => p === 'M' || p === 'F');
        return result;
    }
    
    // Rule 2: Data and Capability are mutually exclusive - prefer Data if both present
    const hasData = result.some(p => DATA_PERMS.includes(p));
    const hasCap = result.some(p => CAP_PERMS.includes(p));
    if (hasData && hasCap) {
        // Remove capability permissions, keep data permissions
        result = result.filter(p => !CAP_PERMS.includes(p));
    }
    
    // Rule 3: Remove L and S (protected permissions) from user-facing GTs
    result = result.filter(p => !PROTECTED_PERMS.includes(p));
    
    return result;
}

// Safe accessor for permissions - always returns normalized perms for display/encoding
function getSafePerms(obj) {
    if (!obj) return [];
    const perms = obj.perms || [];
    return normalizePermissions(perms);
}

// Format permissions for display as string [RWX]
function formatPerms(perms) {
    const normalized = normalizePermissions(perms || []);
    return normalized.length > 0 ? `[${normalized.join('')}]` : '[-]';
}

// Helper to get GT from Boot C-List by name
function getBootGT(name) {
    return bootCList.entries.find(e => e.name === name);
}

// Helper to get namespace entry by offset
function getNSEntry(offset) {
    return namespaceObjects.find(o => o.offset === offset);
}

// Helper to build a full GT from Boot C-List entry
function buildGTFromCList(entry) {
    if (!entry) return null;
    const nsEntry = getNSEntry(entry.nsOffset);
    if (!nsEntry) {
        console.warn(`Namespace entry not found for offset ${entry.nsOffset}`);
        return null;
    }
    return {
        name: entry.name,
        nsOffset: entry.nsOffset,
        type: entry.type,
        perms: entry.perms,
        location: { type: "Local", offset: nsEntry.word1_location },
        size: entry.size || nsEntry.word2_limit,
        word1: nsEntry.word1_location,
        word2: nsEntry.word2_limit,
        word3: nsEntry.word3_seals,
        goldenKey: generateGoldenKey(),
        locked: false,
        desc: entry.desc
    };
}

// Legacy format for compatibility
const bootNamespace = {
    name: "Boot",
    location: 0x2000,
    description: "Root abstraction of the CTMM system",
    clist: bootCList.entries.map(e => ({ name: e.name, type: e.type, perms: e.perms, ref: `ns.offset.${e.nsOffset}` }))
};

const threadCLists = {
    Kenneth: {
        name: "Kenneth",
        description: "User thread with access to math abstractions",
        clist: [
            { name: "SlideRule", type: "Abstraction", perms: ["E"] },
            { name: "Abacus", type: "Abstraction", perms: ["E"] },
            { name: "Circle", type: "Abstraction", perms: ["E"] },
            { name: "LocalData", type: "Data", perms: ["R", "W"] }
        ]
    },
    Matthew: {
        name: "Matthew",
        description: "User thread with limited access",
        clist: [
            { name: "Abacus", type: "Abstraction", perms: ["E"] },
            { name: "LocalData", type: "Data", perms: ["R", "W"] }
        ]
    },
    Daniel: {
        name: "Daniel",
        description: "User thread with SlideRule access",
        clist: [
            { name: "SlideRule", type: "Abstraction", perms: ["E"] },
            { name: "LocalData", type: "Data", perms: ["R", "W"] }
        ]
    }
};

const abstractionCLists = {
    SlideRule: {
        name: "SlideRule",
        mathType: "FLOAT",
        description: "IEEE 754 floating-point operations. CALL this abstraction for float math.",
        clist: [
            { name: "GT_ADD", type: "Function", mathType: "float", perms: ["R", "X"], desc: "Float: a + b", base: 0x5100, size: 256 },
            { name: "GT_SUB", type: "Function", mathType: "float", perms: ["R", "X"], desc: "Float: a - b", base: 0x5200, size: 256 },
            { name: "GT_MUL", type: "Function", mathType: "float", perms: ["R", "X"], desc: "Float: a * b", base: 0x5300, size: 256 },
            { name: "GT_DIV", type: "Function", mathType: "float", perms: ["R", "X"], desc: "Float: a / b", base: 0x5400, size: 384 },
            { name: "GT_LOG", type: "Function", mathType: "float", perms: ["R", "X"], desc: "Float: ln(x)", base: 0x5580, size: 256 },
            { name: "GT_EXP", type: "Function", mathType: "float", perms: ["R", "X"], desc: "Float: e^x", base: 0x5680, size: 256 },
            { name: "GT_SQRT", type: "Function", mathType: "float", perms: ["R", "X"], desc: "Float: sqrt(x)", base: 0x5780, size: 256 },
            { name: "GT_POW", type: "Function", mathType: "float", perms: ["R", "X"], desc: "Float: x^y", base: 0x5880, size: 320 },
            { name: "LocalCode", type: "Code", perms: ["R", "X"], base: 0x5000, size: 256 },
            { name: "LocalData", type: "Data", perms: ["R", "W"], base: 0x5A00, size: 512 }
        ]
    },
    Abacus: {
        name: "Abacus",
        mathType: "INTEGER",
        description: "64-bit integer arithmetic operations. CALL this abstraction for integer math.",
        clist: [
            { name: "GT_ADD", type: "Function", mathType: "int64", perms: ["R", "X"], desc: "Int64: a + b", base: 0x6100, size: 192 },
            { name: "GT_SUB", type: "Function", mathType: "int64", perms: ["R", "X"], desc: "Int64: a - b", base: 0x6200, size: 192 },
            { name: "GT_MUL", type: "Function", mathType: "int64", perms: ["R", "X"], desc: "Int64: a * b", base: 0x6300, size: 192 },
            { name: "GT_DIV", type: "Function", mathType: "int64", perms: ["R", "X"], desc: "Int64: a / b", base: 0x6400, size: 320 },
            { name: "GT_MOD", type: "Function", mathType: "int64", perms: ["R", "X"], desc: "Int64: a mod b", base: 0x6580, size: 256 },
            { name: "GT_ABS", type: "Function", mathType: "int64", perms: ["R", "X"], desc: "Int64: |a|", base: 0x6680, size: 128 },
            { name: "GT_NEG", type: "Function", mathType: "int64", perms: ["R", "X"], desc: "Int64: -a", base: 0x6700, size: 128 },
            { name: "GT_INC", type: "Function", mathType: "int64", perms: ["R", "X"], desc: "Int64: a + 1", base: 0x6780, size: 64 },
            { name: "GT_DEC", type: "Function", mathType: "int64", perms: ["R", "X"], desc: "Int64: a - 1", base: 0x67C0, size: 64 },
            { name: "LocalCode", type: "Code", perms: ["R", "X"], base: 0x6000, size: 256 },
            { name: "LocalData", type: "Data", perms: ["R", "W"], base: 0x6800, size: 512 }
        ]
    },
    Circle: {
        name: "Circle",
        mathType: "GEOMETRY",
        description: "Circle geometry using float math. Provides PI constants and circle functions.",
        clist: [
            { name: "GT_PI", type: "Constant", mathType: "float", perms: ["R"], desc: "Float: PI = 3.14159...", value: 3.14159265358979, base: 0x7000, size: 8 },
            { name: "GT_TWO_PI", type: "Constant", mathType: "float", perms: ["R"], desc: "Float: 2*PI = 6.28318...", value: 6.28318530717958, base: 0x7008, size: 8 },
            { name: "GT_CIRCUMFERENCE", type: "Function", mathType: "float", perms: ["R", "X"], desc: "Float: C = 2*PI*r", base: 0x7100, size: 192 },
            { name: "GT_AREA", type: "Function", mathType: "float", perms: ["R", "X"], desc: "Float: A = PI*r^2", base: 0x7200, size: 192 },
            { name: "GT_DIAMETER", type: "Function", mathType: "float", perms: ["R", "X"], desc: "Float: D = 2*r", base: 0x7300, size: 128 },
            { name: "LocalCode", type: "Code", perms: ["R", "X"], base: 0x7080, size: 128 },
            { name: "LocalData", type: "Data", perms: ["R", "W"], base: 0x7400, size: 512 }
        ]
    }
};

// ==================== BOOT SEQUENCE ====================

let bootState = {
    step: 0,
    complete: false
};

// ==================== BOOT SEQUENCE ====================
// Step 1: CLEAR_ALL, set cold_restart flag
// Step 2: LOAD_NS → CR15 (Namespace GT at offset 0)
// Step 3a: CHANGE 3 → CR8 (Kenneth thread FIRST)
// Step 3b: CALL HWGT → loads CR6 from NS[2], CR7 from NS[1], IP=0
// Step 4: Clear cold_restart flag, execution begins

const bootSteps = [
    {
        name: "Fault Restart",
        description: "CLEAR_ALL: Saving state, clearing registers, setting cold_restart...",
        action: () => {
            // Save thread state before reset (skip on cold restart)
            if (!coldRestart) {
                saveThreadState();
            }
            simulator.reset();
            coldRestart = true;  // Set cold restart flag
            // Note: Editor content preserved - user code is independent of boot state
        }
    },
    {
        name: "Load Namespace",
        description: "LOAD_NS CR15: Loading Namespace capability (offset 0, perms M+L)...",
        action: () => {
            // CR15 = GT pointing to Namespace offset 0 (self-reference)
            // Namespace GT has M (Meta-Machine) and L (Load) permissions for boot
            const nsEntry = getNSEntry(0);
            simulator.cr15 = {
                name: "Namespace",
                nsOffset: 0,
                type: "System",
                location: { type: "Local", offset: nsEntry.word1_location },
                perms: ["M", "L"],  // Meta-Machine + Load for boot operations
                locked: true,
                goldenKey: generateGoldenKey(),
                word1: nsEntry.word1_location,
                word2: nsEntry.word2_limit,
                word3: nsEntry.word3_seals
            };
            updateNamespaceDisplay();
        }
    },
    {
        name: "Switch Thread",
        description: "CHANGE 3: Switching to Kenneth thread (NS offset 3)...",
        action: () => {
            // CHANGE instruction switches CR8 directly to Thread at NS offset 3
            // This happens FIRST before loading C-List
            const kennethEntry = getBootGT("Kenneth");
            const kennethNS = getNSEntry(kennethEntry.nsOffset);
            simulator.cr8 = {
                name: "Kenneth",
                nsOffset: kennethEntry.nsOffset,
                type: "Thread",
                location: { type: "Local", offset: kennethNS.word1_location },
                perms: kennethEntry.perms,
                locked: false,
                goldenKey: generateGoldenKey(),
                word1: kennethNS.word1_location,
                word2: kennethNS.word2_limit,
                word3: kennethNS.word3_seals,
                clist: threadCLists.Kenneth.clist
            };
            updateNamespaceDisplay();
        }
    },
    {
        name: "Call Boot",
        description: "CALL HWGT: Loading CR6←NS[2], CR7←NS[1], IP=0...",
        action: () => {
            // CALL HWGT triggers hardwired load sequence:
            // 1. LOAD CR6 from NS offset 2 (Boot C-List)
            const bootNS = getNSEntry(2);
            const clistCount = bootCList.entries.length;
            simulator.contextRegs[6] = {
                name: "Boot",
                nsOffset: 2,
                type: "C-List",
                location: { type: "Local", offset: bootNS.word1_location },
                perms: ["E", "M"],  // Enter + Meta after successful boot
                locked: false,
                goldenKey: generateGoldenKey(),
                word1: bootNS.word1_location,
                word2: bootNS.word2_limit,
                word3: bootNS.word3_seals,
                clistCount: clistCount,
                clist: bootCList.entries
            };
            
            // 2. LOAD CR7 from NS offset 1 (Access.asm/Nucleus)
            const accessEntry = getBootGT("Access");
            const accessNS = getNSEntry(accessEntry.nsOffset);
            simulator.contextRegs[7] = {
                name: accessEntry.name,
                nsOffset: accessEntry.nsOffset,
                type: "Code",
                location: { type: "Local", offset: accessNS.word1_location },
                perms: accessEntry.perms,
                locked: true,
                goldenKey: generateGoldenKey(),
                word1: accessNS.word1_location,
                word2: accessNS.word2_limit,
                word3: accessNS.word3_seals,
                linkage: accessNS.linkage || "Boot/Access.asm",
                base: accessNS.word1_location,
                size: accessNS.word2_limit
            };
            
            // 3. IP = 0 (thread runs from first instruction)
            simulator.ip = 0;
            
            // 4. Clear cold restart flag - boot complete
            coldRestart = false;
            
            updateSystemState();
            
            // Update editor linkage display only if editor is empty
            // Don't overwrite user's code
            const editor = document.getElementById('codeEditor');
            if (editor && editor.value.trim() === '') {
                editorState.currentLinkage = 'Boot/Access.asm';
                editorState.currentPerms = '[X]';
                if (typeof updateEditorToolbar === 'function') {
                    updateEditorToolbar();
                }
            }
        }
    }
];

function executeFaultRestart() {
    switchView('dashboard');
    
    // Save current thread state before fault restart
    const savedState = saveThreadState();
    if (savedState) {
        log(`Thread state saved for ${simulator.cr8.name} before fault restart`, 'info');
    }
    
    // Brief pause to show state save, then perform restart
    setTimeout(() => {
        simulator.reset();
        bootState.step = 1; // Step 1 (Fault Restart) is now complete
        bootState.complete = false;
        // Note: Editor content preserved - user code is independent of boot state
        updateBootDisplay();
        updateDisplay();
        updateCapabilityExplorer();
        updateNamespaceDisplay();
        log('[BOOT 1] Fault Restart: Unrecoverable fault. State saved, registers cleared.', 'info');
    }, 300);
}

function executeBootStepManual(stepNum) {
    switchView('dashboard');
    
    // Step 0 (Fault Restart) has its own function
    if (stepNum === 0) {
        executeFaultRestart();
        return;
    }
    
    // Can only execute the next step in sequence
    if (stepNum !== bootState.step) {
        if (stepNum < bootState.step) {
            log(`Step ${stepNum + 1} already completed`, 'info');
        } else {
            log(`Complete step ${bootState.step + 1} first`, 'info');
        }
        return;
    }
    
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
        log('System already booted. Click Fault Restart to restart.', 'info');
    }
}

function stepInstruction() {
    // Legacy function - redirect to manual step execution
    executeBootStepManual(bootState.step);
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
        if (i <= bootState.step) {
            el.classList.add('done');
        } else if (i === bootState.step + 1) {
            el.classList.add('active');
        }
    }
    
    // Update Run button state
    const runBtn = document.getElementById('bootRunBtn');
    if (runBtn) {
        if (bootState.complete) {
            runBtn.textContent = 'Complete';
            runBtn.disabled = true;
            runBtn.style.opacity = '0.6';
        } else {
            runBtn.textContent = 'Run All';
            runBtn.disabled = false;
            runBtn.style.opacity = '1';
        }
    }
}

function saveThreadState() {
    // Save complete thread state to the active thread object before reset
    if (!simulator.cr8 || simulator.cr8.name === 'NULL') {
        return null; // No active thread to save
    }
    
    const threadName = simulator.cr8.name;
    const threadState = {
        // Context Registers (CR0-CR7)
        contextRegs: JSON.parse(JSON.stringify(simulator.contextRegs)),
        // Data Registers (DR0-DR15) - convert BigInt to string for storage
        dataRegs: {},
        // Indicators (condition flags)
        flags: { ...simulator.flags },
        // Lambda states
        ip: simulator.ip,
        stackDepth: simulator.stackDepth,
        cr6: simulator.contextRegs[6] ? JSON.parse(JSON.stringify(simulator.contextRegs[6])) : null,
        cr7: simulator.contextRegs[7] ? JSON.parse(JSON.stringify(simulator.contextRegs[7])) : null,
        cr8: JSON.parse(JSON.stringify(simulator.cr8)),
        cr15: simulator.cr15 ? JSON.parse(JSON.stringify(simulator.cr15)) : null
    };
    
    // Convert BigInt data registers to strings for JSON storage
    for (let i = 0; i < 16; i++) {
        threadState.dataRegs[i] = simulator.dataRegs[i].toString();
    }
    
    // Store in thread's saved state
    if (!window.savedThreadStates) {
        window.savedThreadStates = {};
    }
    window.savedThreadStates[threadName] = threadState;
    
    log(`Thread state saved for ${threadName}`, 'info');
    return threadState;
}

function resetCPU() {
    switchView('dashboard');
    
    // Save current thread state before reset
    const savedState = saveThreadState();
    if (savedState) {
        // Show pause indication - update boot status briefly
        const status = document.getElementById('bootStatus');
        if (status) {
            status.textContent = `Saved ${simulator.cr8.name} thread state...`;
            status.style.color = 'var(--warning)';
        }
    }
    
    // Perform hardware reset after brief pause
    setTimeout(() => {
        simulator.reset();
        bootState.step = 0;
        bootState.complete = false;
        updateBootDisplay();
        updateDisplay();
        updateCapabilityExplorer();
        updateNamespaceDisplay();
        log('System reset - all registers cleared', 'info');
    }, 300);
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
    
    let nsHtml = '<div class="ns-header">Namespace Table (CR15: ' + simulator.cr15.name + ')</div>';
    nsHtml += '<div class="ns-table-header"><span class="ns-col-offset">Offset</span><span class="ns-col-name">Name</span><span class="ns-col-type">Type</span><span class="ns-col-word1">Word1 (Location)</span><span class="ns-col-word2">Word2 (Limit)</span><span class="ns-col-perms">Perms</span></div>';
    
    const typeTooltips = {
        'System': 'System object - Namespace self-reference.',
        'C-List': 'Capability List containing Golden Token entries.',
        'Thread': 'User identity with its own C-List of capabilities.',
        'Code': 'Executable code object (assembly).',
        'Abstraction': 'Protected abstraction containing function Golden Tokens.'
    };
    
    const allObjects = [...namespaceObjects, ...dynamicObjects];
    allObjects.forEach(obj => {
        // Look up permissions from Boot C-List (authoritative source for GTs)
        const gtEntry = getBootGT(obj.name);
        const perms = obj.perms || (gtEntry ? gtEntry.perms : []);
        const permStr = perms.join('');
        const typeClass = obj.type.toLowerCase().replace('-', '');
        const baseTypeTooltip = typeTooltips[obj.type] || 'Namespace object with capability-controlled access.';
        const offset = obj.offset !== undefined ? obj.offset : '?';
        const word1 = obj.word1_location !== undefined ? `0x${obj.word1_location.toString(16).toUpperCase().padStart(4, '0')}` : `0x${(obj.location || 0).toString(16).toUpperCase().padStart(4, '0')}`;
        const word2 = obj.word2_limit !== undefined ? obj.word2_limit : (obj.size || 0);
        const tooltip = `Offset ${offset}: ${obj.type} [${permStr}] | ${baseTypeTooltip}`;
        const dynamicTag = obj.dynamic ? ' <span class="ns-dynamic-tag">(custom)</span>' : '';
        nsHtml += `
            <div class="ns-object ns-${typeClass}" data-name="${obj.name}" data-type="${obj.type}" data-tooltip="${tooltip}">
                <div class="ns-obj-row">
                    <span class="ns-col-offset">${offset}</span>
                    <span class="ns-col-name">${obj.name}${dynamicTag}</span>
                    <span class="ns-col-type">${obj.type}</span>
                    <span class="ns-col-word1">${word1}</span>
                    <span class="ns-col-word2">${word2}</span>
                    <span class="ns-col-perms">[${permStr}]</span>
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
        const permsStr = item.perms ? `[${item.perms.join('')}]` : '';
        const baseStr = item.base !== undefined ? `Base: 0x${item.base.toString(16).toUpperCase()}` : '';
        const sizeStr = item.size ? `Size: ${item.size}` : '';
        const details = [permsStr, baseStr, sizeStr].filter(s => s).join(' | ');
        html += `<div class="hier-item hier-gt" data-name="${item.name}" data-type="${item.type}" data-tooltip="Linked GT ${details}">${item.name}</div>`;
    });
    
    children.forEach(obj => {
        const permsStr = obj.perms ? `[${obj.perms.join('')}]` : '';
        const baseStr = obj.location !== undefined ? `Base: 0x${obj.location.toString(16).toUpperCase()}` : '';
        const sizeStr = obj.size ? `Size: ${obj.size}` : '';
        const details = [permsStr, baseStr, sizeStr].filter(s => s).join(' | ');
        html += `<div class="hier-item" data-name="${obj.name}" data-type="${obj.type}">`;
        html += `<div class="hier-node hier-dynamic" data-tooltip="Custom ${obj.type} ${details}">`;
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
                const permsStr = item.perms ? `[${item.perms.join('')}]` : '';
                const typeDesc = item.type === 'Abstraction' ? 'Enter-only abstraction' : item.type;
                html += `<div class="hier-item hier-gt" data-name="${item.name}" data-type="${item.type}" data-tooltip="GT ${permsStr} | ${typeDesc}: ${item.name}">${item.name}</div>`;
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
        'SlideRule': '[FLOAT] IEEE 754 floating-point. CALL to use: ADD, SUB, MUL, DIV, LOG, EXP, SQRT, POW',
        'Abacus': '[INTEGER] 64-bit integer arithmetic. CALL to use: ADD, SUB, MUL, DIV, MOD, ABS, NEG, INC, DEC',
        'Circle': '[GEOMETRY] Circle calculations (uses floats). PI, TWO_PI, CIRCUMFERENCE, AREA, DIAMETER'
    };
    const mathTypeBadges = {
        'SlideRule': 'FLOAT',
        'Abacus': 'INTEGER',
        'Circle': 'GEOMETRY'
    };
    ['SlideRule', 'Abacus', 'Circle'].forEach(name => {
        const gtEntry = getBootGT(name);
        const absPerms = gtEntry ? `[${gtEntry.perms.join('')}]` : '[E]';
        const mathBadge = mathTypeBadges[name];
        html += `<div class="hier-item" data-name="${name}" data-type="Abstraction">`;
        html += `<div class="hier-node hier-abstraction" data-tooltip="Abstraction ${absPerms} (Enter via CALL) | ${abstractionDescs[name]}">`;
        html += `<div class="hier-label"><span class="math-type-badge math-${mathBadge.toLowerCase()}">${mathBadge}</span> ${name}</div>`;
        html += '</div>';
        if (abstractionCLists[name]) {
            html += '<div class="hier-clist">';
            abstractionCLists[name].clist.forEach(item => {
                if (item.type === 'Function') {
                    const permsStr = item.perms ? `[${item.perms.join('')}]` : '[RX]';
                    const baseStr = item.base !== undefined ? `0x${item.base.toString(16).toUpperCase()}` : '0x0000';
                    const sizeStr = item.size || 0;
                    const mathTypeLabel = item.mathType === 'float' ? 'Float' : item.mathType === 'int64' ? 'Int64' : '';
                    const mathDesc = item.desc || (mathTypeLabel ? `${mathTypeLabel} operation` : 'Function');
                    html += `<div class="hier-item hier-gt hier-func" data-name="${item.name}" data-type="Function" data-parent="${name}" data-base="${item.base || 0}" data-size="${item.size || 0}" data-tooltip="${mathDesc} | ${permsStr} | Base: ${baseStr} | Size: ${sizeStr}B | Click to view code">${item.name}</div>`;
                } else if (item.type === 'Constant') {
                    const baseStr = item.base !== undefined ? `0x${item.base.toString(16).toUpperCase()}` : '0x0000';
                    html += `<div class="hier-item hier-gt hier-const" data-name="${item.name}" data-type="Constant" data-parent="${name}" data-tooltip="${item.desc} | [R] | Base: ${baseStr}" data-value="${item.value}">${item.name}</div>`;
                }
            });
            html += '</div>';
        }
        html += renderDynamicChildren(name);
        html += '</div>';
    });
    
    html += '<div class="hier-group-label" data-tooltip="User-created objects in the Boot namespace.">Custom Objects</div>';
    dynamicObjects.filter(obj => obj.parent === 'Boot').forEach(obj => {
        const permsStr = obj.perms ? `[${obj.perms.join('')}]` : '';
        const baseStr = obj.location !== undefined ? `Base: 0x${obj.location.toString(16).toUpperCase()}` : '';
        const sizeStr = obj.size ? `Size: ${obj.size}` : '';
        const details = [permsStr, baseStr, sizeStr].filter(s => s).join(' | ');
        html += `<div class="hier-item" data-name="${obj.name}" data-type="${obj.type}">`;
        html += `<div class="hier-node hier-dynamic" data-tooltip="Custom ${obj.type} ${details}">`;
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
                const permNames = {R:'Read', W:'Write', X:'Execute', L:'Load', S:'Store', E:'Enter', B:'Bind', M:'Meta-Machine', F:'Far (Remote URL)'};
                return permNames[p] || p;
            }).join(', ')}` : 'No capability loaded. Register is empty.';
        
        const row = document.createElement('div');
        row.className = `register-row tooltip-bottom ${isNull ? 'null' : ''}`;
        row.setAttribute('data-tooltip', tooltip);
        row.innerHTML = `
            <span class="name">CR${i}</span>
            <span class="role">${role}</span>
            <span class="value">${reg.name}</span>
            <span class="perms tooltip-bottom" data-tooltip="${permTooltip}">${reg.perms.join('') || '---'}</span>
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
        row.className = 'register-row tooltip-bottom';
        row.setAttribute('data-tooltip', '64-bit data register. Holds numeric values for arithmetic operations.');
        row.innerHTML = `
            <span class="name">DR${i}</span>
            <span class="value">0x${hexStr}</span>
        `;
        container.appendChild(row);
    }
}

function updateSystemState() {
    // CR15: Namespace - show name and offset
    const cr15 = simulator.cr15;
    const cr15Text = cr15?.name || 'NULL';
    const cr15Offset = cr15?.nsOffset !== undefined ? ` @${cr15.nsOffset}` : '';
    document.getElementById('cr15Name').textContent = cr15Text + cr15Offset;
    
    // CR8: Thread - show name
    document.getElementById('cr8Name').textContent = simulator.cr8?.name || 'NULL';
    
    // CR6: C-List - show name with [perms] and (count)
    const cr6 = simulator.contextRegs[6];
    let cr6Text = 'NULL';
    if (cr6 && cr6.name && cr6.name !== 'NULL') {
        const count = cr6.clistCount !== undefined ? cr6.clistCount : (cr6.clist?.length || 0);
        const perms = cr6.perms && cr6.perms.length > 0 ? `[${cr6.perms.join('')}]` : '';
        cr6Text = `${cr6.name} ${perms} (${count})`;
    }
    document.getElementById('cr6Name').textContent = cr6Text;
    
    const cr7 = simulator.contextRegs[7];
    // CR7 holds code objects (Nucleus), not C-Lists - display based on object type
    const isCr7Valid = cr7 && cr7.name && cr7.name !== 'NULL';
    if (isCr7Valid) {
        // For code/data objects, only show permissions if they exist (no empty brackets)
        const permsStr = (cr7.perms && cr7.perms.length > 0) ? `[${cr7.perms.join('')}]` : '';
        const baseStr = cr7.base !== undefined ? ` @0x${cr7.base.toString(16).toUpperCase()}` : '';
        const sizeStr = cr7.size ? `:${cr7.size}` : '';
        document.getElementById('cr7NameDisplay').textContent = `${cr7.name} ${permsStr}${baseStr}${sizeStr}`;
        
        const cr7Row = document.getElementById('cr7Row');
        if (cr7Row && cr7.linkage) {
            let codePreview = '';
            const parentName = cr7.linkage.split('/')[1];
            let codeKey = cr7.name;
            if (parentName === 'Abacus' && ['GT_ADD', 'GT_SUB', 'GT_MUL', 'GT_DIV'].includes(cr7.name)) {
                codeKey = 'Abacus_' + cr7.name;
            }
            const code = functionBetaCode[codeKey] || functionBetaCode[cr7.name];
            if (code) {
                const lines = code.split('\n').filter(l => l.trim() && !l.trim().startsWith(';')).slice(0, 4);
                codePreview = ' | Code: ' + lines.join(' / ');
            }
            cr7Row.setAttribute('data-tooltip', `Linkage: ${cr7.linkage} | Perms: ${permsStr} | Base: 0x${(cr7.base || 0).toString(16).toUpperCase()} | Size: ${cr7.size || 0} bytes${codePreview}`);
        }
    } else {
        document.getElementById('cr7NameDisplay').textContent = 'NULL';
    }
    
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
    // Dashboard output log removed - log to console for debugging
    console.log(`[${type.toUpperCase()}] ${message}`);
}

function runBootSequence() {
    switchView('dashboard');
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
    TPERM: { operands: ['cr', 'mask', 'index'], help: 'Test CR permissions against mask. Optional index validates against object W2 limit. Z=1 if all pass, C=perms OK, V=bounds OK.', isCap: true },
    B: { operands: ['condition', 'offset'], help: 'Branch to offset. Use condition code (EQ/NE/GT/LT/etc) or leave empty.', isBranch: true },
    BL: { operands: ['offset'], help: 'Branch with Link. Saves return address to DR7, then jumps to offset.', isBranch: true },
    LOAD: { operands: ['destCR', 'srcCR', 'index'], help: 'Load capability at index via CR[src] into CR[dest]. Requires Load permission.', isCap: true },
    SAVE: { operands: ['destCR', 'srcDR'], help: 'Save DR[src] to location via CR[dest]. Requires Save permission.', isCap: true },
    CALL: { operands: ['cr'], help: 'Call procedure in CR[reg]. Requires Enter permission. Pushes return frame.', isCap: true },
    RETURN: { operands: [], help: 'Return from procedure. Pops stack frame and restores CR6, CR7, IP.', isCap: true },
    CHANGE: { operands: ['offset'], help: 'Switch to thread at scope offset. Changes CR8 (Thread).', isCap: true },
    SWITCH: { operands: ['cr'], help: 'Set CR15 (Namespace) to capability in CR[reg]. Requires Load permission.', isCap: true }
};

document.addEventListener('DOMContentLoaded', () => {
    loadFromStorage();
    updateDisplay();
    updateCapabilityExplorer();
    log('CTMM Simulator Ready', 'info');
    
    // CR7 click handler - switch to Assembly Editor
    const cr7Row = document.getElementById('cr7Row');
    if (cr7Row) {
        cr7Row.addEventListener('click', () => {
            switchView('editor');
            log('Switched to Assembly Editor (CR7 Nucleus)', 'info');
        });
    }
    
    // CR15 click handler - switch to Namespace Browser
    const cr15Row = document.getElementById('cr15Row');
    if (cr15Row) {
        cr15Row.addEventListener('click', () => {
            switchView('namespace');
            log('Switched to Namespace Browser (CR15)', 'info');
        });
    }
    
    // CR8 click handler - switch to Dashboard (Thread view)
    const cr8Row = document.getElementById('cr8Row');
    if (cr8Row) {
        cr8Row.addEventListener('click', () => {
            switchView('dashboard');
            log('Switched to Dashboard (CR8 Thread)', 'info');
        });
    }
    
    // CR6 click handler - switch to Capabilities Explorer and show CR6 detail with C-List entries
    const cr6Row = document.getElementById('cr6Row');
    if (cr6Row) {
        cr6Row.addEventListener('click', () => {
            // Populate simulator.clist from CR6's clist entries before switching
            const cr6Cap = simulator.contextRegs[6];
            if (cr6Cap && cr6Cap.clist && cr6Cap.clist.length > 0) {
                // Convert clist entries to capability objects for display
                simulator.clist = cr6Cap.clist.map(entry => {
                    const nsObj = namespaceObjects.find(o => o.offset === entry.nsOffset);
                    // Determine locked status based on type (Abstractions are locked system resources)
                    const isLocked = entry.type === 'Abstraction';
                    return {
                        name: entry.name,
                        type: entry.type || 'Unknown',
                        nsOffset: entry.nsOffset,
                        location: { type: "Local", offset: nsObj ? nsObj.word1_location : 0 },
                        perms: entry.perms || [],
                        size: nsObj ? nsObj.word2_limit : 0,
                        goldenKey: generateGoldenKey(),
                        locked: isLocked
                    };
                });
            }
            switchView('capabilities');
            // Re-render the Capabilities Explorer with the updated clist
            updateCapabilityExplorer();
            // After switching, select CR6 in the explorer (use longer timeout for DOM update)
            setTimeout(() => {
                if (cr6Cap) {
                    // Show the capability detail panel first (this clears selections)
                    showCapabilityDetail(null, cr6Cap, 'CR6');
                    // Then find and select the CR6 card after showCapabilityDetail clears them
                    document.querySelectorAll('.token-card').forEach(card => {
                        const regBadge = card.querySelector('.token-reg');
                        if (regBadge && regBadge.textContent === 'CR6') {
                            card.classList.add('selected');
                        }
                    });
                }
            }, 100);
            log('Switched to Capabilities Explorer (CR6 C-List)', 'info');
        });
    }
});

// ==================== CAPABILITY EXPLORER ====================

function createTokenCard(cap, regLabel, showDeleteBtn = true) {
    const isNull = cap.name === 'NULL';
    const card = document.createElement('div');
    card.className = `token-card ${isNull ? 'null-cap' : ''}`;
    card.onclick = (evt) => {
        // Don't trigger detail view if clicking delete button
        if (evt.target.classList.contains('token-delete-btn')) return;
        showCapabilityDetail(evt, cap, regLabel);
    };
    
    const allPerms = ['R', 'W', 'X', 'L', 'S', 'E', 'B', 'M', 'F'];
    const permBadges = allPerms.map(p => {
        const hasIt = cap.perms.includes(p);
        return `<span class="perm-badge perm-${p.toLowerCase()} ${hasIt ? '' : 'inactive'}">${p}</span>`;
    }).join('');
    
    const tooltip = cap.description || cap.tooltip || getObjectTooltip(cap.name, cap.type);
    card.setAttribute('data-tooltip', tooltip);
    
    // Extract index from regLabel for delete functionality
    const indexMatch = regLabel.match(/\[(\d+)\]/);
    const clistIndex = indexMatch ? parseInt(indexMatch[1]) : -1;
    
    const deleteBtn = showDeleteBtn && clistIndex >= 0 
        ? `<button class="token-delete-btn" onclick="showDeleteCapabilityModal(${clistIndex}, '${cap.name}')" data-tooltip="Delete ${cap.name}">×</button>` 
        : '';
    
    card.innerHTML = `
        ${deleteBtn}
        <div class="token-header">
            <span class="token-name">${cap.name}</span>
            <span class="token-reg">${regLabel}</span>
        </div>
        <div class="token-perms">${permBadges}</div>
        ${cap.locked ? '<div class="lock-indicator">🔒 Locked</div>' : ''}
    `;
    
    return card;
}

function getObjectTooltip(name, type) {
    const tooltips = {
        'Namespace': 'Hardware-managed Namespace Table - root of all capability addressing',
        'Boot': 'Boot Capability List - initial C-List loaded during system bootstrap',
        'Kenneth': 'User thread identity for Kenneth - M permission for hardware-level access',
        'Matthew': 'User thread identity for Matthew - M permission for hardware-level access',
        'Daniel': 'User thread identity for Daniel - M permission for hardware-level access',
        'SlideRule': 'IEEE 754 floating-point math abstraction (ADD, SUB, MUL, DIV, LOG, EXP, SQRT, POW)',
        'Abacus': '64-bit integer arithmetic abstraction (ADD, SUB, MUL, DIV, MOD, NEG, ABS, CMP)',
        'Circle': 'Geometric calculations abstraction (AREA, CIRCUMFERENCE, ARC_LENGTH, SECTOR_AREA)',
        'Access': 'Nucleus kernel code - secure entry points for system calls',
        'NULL': 'Null capability - no access rights, typically indicates uninitialized register'
    };
    return tooltips[name] || `${type || 'Object'}: ${name}`;
}

let currentEditingCap = null;
let currentEditingRegLabel = null;

function getCapabilityHierarchy(cap) {
    const hierarchy = [];
    
    // Check if it's the Namespace itself
    if (cap.name === 'Namespace' || cap.location?.offset === 0) {
        hierarchy.push({ name: 'Namespace', type: 'Root', offset: 0 });
        return hierarchy;
    }
    
    // Check if it's a Thread (default/system threads are directly under Namespace, not Boot)
    const threadNames = ['Kenneth', 'Matthew', 'Daniel'];
    if (cap.type === 'Thread' || threadNames.includes(cap.name)) {
        hierarchy.push({ name: 'Namespace', type: 'Root', offset: 0 });
        hierarchy.push({ name: cap.name, type: 'Thread', offset: cap.location?.offset || 0 });
        return hierarchy;
    }
    
    // Check if it's the Boot C-List
    if (cap.name === 'Boot') {
        hierarchy.push({ name: 'Namespace', type: 'Root', offset: 0 });
        hierarchy.push({ name: 'Boot', type: 'C-List', offset: 1 });
        return hierarchy;
    }
    
    // Check if this capability is in the Boot C-List (excluding threads)
    const bootCListEntry = bootCList.entries.find(e => e.name === cap.name);
    if (bootCListEntry && bootCListEntry.type !== 'Thread') {
        hierarchy.push({ name: 'Namespace', type: 'Root', offset: 0 });
        hierarchy.push({ name: 'Boot', type: 'C-List', offset: 1 });
        hierarchy.push({ name: cap.name, type: cap.type || bootCListEntry.type, offset: bootCListEntry.nsOffset });
        return hierarchy;
    }
    
    // Check thread C-Lists
    for (const [threadName, threadData] of Object.entries(threadCLists)) {
        const threadEntry = threadData.clist.find(e => e.name === cap.name);
        if (threadEntry) {
            hierarchy.push({ name: 'Namespace', type: 'Root', offset: 0 });
            hierarchy.push({ name: threadName, type: 'Thread', offset: threadName === 'Kenneth' ? 2 : 
                            threadName === 'Matthew' ? 4 : threadName === 'Daniel' ? 5 : 0 });
            hierarchy.push({ name: cap.name, type: threadEntry.type, offset: 0 });
            return hierarchy;
        }
    }
    
    // Check abstraction C-Lists
    for (const [absName, absData] of Object.entries(abstractionCLists)) {
        const absEntry = absData.clist.find(e => e.name === cap.name);
        if (absEntry) {
            hierarchy.push({ name: 'Namespace', type: 'Root', offset: 0 });
            hierarchy.push({ name: 'Boot', type: 'C-List', offset: 1 });
            hierarchy.push({ name: absName, type: 'Abstraction', offset: 0 });
            hierarchy.push({ name: cap.name, type: absEntry.type, offset: 0 });
            return hierarchy;
        }
    }
    
    // Default: just the capability itself
    hierarchy.push({ name: cap.name, type: cap.type || 'Unknown', offset: cap.location?.offset || 0 });
    return hierarchy;
}

function getRegisterAssignment(cap) {
    const assignments = [];
    
    // Check special registers - order: CRn first, then Type, then size/status
    if (simulator.cr15 && simulator.cr15.name === cap.name) {
        assignments.push({ reg: 'CR15', desc: 'Namespace Root' });
        if (cap.perms && cap.perms.includes('M')) {
            assignments.push({ reg: 'Namespace', desc: 'Namespace root (M permission)' });
        }
    }
    if (simulator.cr8 && simulator.cr8.name === cap.name) {
        assignments.push({ reg: 'CR8', desc: 'Current Thread' });
        if (cap.perms && cap.perms.includes('M')) {
            assignments.push({ reg: 'Thread', desc: 'Thread identity (M permission)' });
            assignments.push({ reg: 'Running', desc: 'Thread is active in CR8' });
        }
    }
    if (simulator.contextRegs[7] && simulator.contextRegs[7].name === cap.name) {
        assignments.push({ reg: 'CR7', desc: 'Nucleus' });
        // Show code status for CR7
        if (cap.perms && cap.perms.includes('X')) {
            const metadata = cap.nsEntry ? Number(cap.nsEntry.word3_seals & BigInt(0xFFFFFFFF)) : 0;
            const statusLabel = getCodeStatusLabel(metadata);
            assignments.push({ reg: 'Code', desc: 'Executable code' });
            assignments.push({ reg: statusLabel, desc: 'Code status from metadata' });
        }
    }
    if (simulator.contextRegs[6] && simulator.contextRegs[6].name === cap.name) {
        assignments.push({ reg: 'CR6', desc: 'Current C-List' });
        const clistSize = simulator.clist ? simulator.clist.length : 0;
        assignments.push({ reg: 'C-List', desc: 'Capability list' });
        assignments.push({ reg: `[${clistSize}]`, desc: `${clistSize} entries` });
    }
    
    // Check other context registers (CR0-CR5) - order: CRn first, then Type, then status
    for (let i = 0; i < 6; i++) {
        if (simulator.contextRegs[i] && simulator.contextRegs[i].name === cap.name) {
            assignments.push({ reg: `CR${i}`, desc: 'Context Register' });
            // Add type indicator based on capability type
            const regCap = simulator.contextRegs[i];
            if (regCap.perms && regCap.perms.includes('X')) {
                const metadata = regCap.nsEntry ? Number(regCap.nsEntry.word3_seals & BigInt(0xFFFFFFFF)) : 0;
                const statusLabel = getCodeStatusLabel(metadata);
                assignments.push({ reg: 'Code', desc: 'Executable code' });
                assignments.push({ reg: statusLabel, desc: 'Code status from metadata' });
            } else if (regCap.type === 'Thread' || regCap.perms?.includes('M')) {
                assignments.push({ reg: 'Thread', desc: 'Thread identity' });
                // Check if this thread is in CR8 (running) or not (suspended)
                const isInCR8 = simulator.cr8 && simulator.cr8.name === cap.name;
                assignments.push({ reg: isInCR8 ? 'Running' : 'Suspended', desc: isInCR8 ? 'Thread is active in CR8' : 'Thread is not loaded in CR8' });
            } else if (regCap.type === 'Abstraction') {
                assignments.push({ reg: 'Abstraction', desc: 'Protected abstraction' });
            } else if (regCap.type === 'C-List') {
                assignments.push({ reg: 'C-List', desc: 'Capability list' });
            } else if (regCap.type) {
                assignments.push({ reg: regCap.type, desc: `${regCap.type} capability` });
            }
        }
    }
    
    // Check if it's in the current C-List (only if not already in a register)
    if (simulator.clist && assignments.length === 0) {
        const clistIndex = simulator.clist.findIndex(c => c.name === cap.name);
        if (clistIndex >= 0) {
            const clistEntry = simulator.clist[clistIndex];
            // Show type-specific label based on entry type - order: Type, then status
            if (clistEntry.perms && clistEntry.perms.includes('X')) {
                const metadata = clistEntry.nsEntry ? Number(clistEntry.nsEntry.word3_seals & BigInt(0xFFFFFFFF)) : 0;
                const statusLabel = getCodeStatusLabel(metadata);
                assignments.push({ reg: 'Code', desc: 'Executable code' });
                assignments.push({ reg: statusLabel, desc: 'Code status from metadata' });
            } else if (clistEntry.type === 'Thread' || clistEntry.perms?.includes('M')) {
                assignments.push({ reg: 'Thread', desc: 'Thread identity capability' });
                // Check if this thread is in CR8 (running) or not (suspended)
                const isInCR8 = simulator.cr8 && simulator.cr8.name === cap.name;
                assignments.push({ reg: isInCR8 ? 'Running' : 'Suspended', desc: isInCR8 ? 'Thread is active in CR8' : 'Thread is not loaded in CR8' });
            } else if (clistEntry.type === 'Abstraction') {
                assignments.push({ reg: 'Abstraction', desc: 'Protected abstraction capability' });
            } else if (clistEntry.type === 'C-List') {
                assignments.push({ reg: 'C-List', desc: 'Capability list' });
            } else {
                const entryType = clistEntry.type || 'Entry';
                assignments.push({ reg: entryType, desc: `${entryType} capability` });
            }
        }
    }
    
    return assignments;
}

function showCapabilityDetail(evt, cap, regLabel) {
    document.querySelectorAll('.token-card').forEach(c => c.classList.remove('selected'));
    if (evt && evt.currentTarget) {
        evt.currentTarget.classList.add('selected');
    }
    
    currentEditingCap = cap;
    currentEditingRegLabel = regLabel;
    
    const panel = document.getElementById('capDetailPanel');
    const allPerms = ['R', 'W', 'X', 'L', 'S', 'E', 'B', 'M', 'F'];
    const permNames = {
        R: 'Read', W: 'Write', X: 'Execute',
        L: 'Load', S: 'Store', E: 'Enter', B: 'Bind', M: 'Meta-Machine', F: 'Far (Remote URL)'
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
    
    const macPopupContent = macValidation.valid 
        ? `MAC Valid | Stored: 0x${macValidation.stored.toString(16).toUpperCase().padStart(4, '0')} | Calculated: 0x${macValidation.calculated.toString(16).toUpperCase().padStart(4, '0')}`
        : `SECURITY TRAP! MAC Mismatch | Stored: 0x${macValidation.stored.toString(16).toUpperCase().padStart(4, '0')} | Calculated: 0x${macValidation.calculated.toString(16).toUpperCase().padStart(4, '0')}`;
    
    // Get hierarchy and register info
    const hierarchy = getCapabilityHierarchy(cap);
    const registers = getRegisterAssignment(cap);
    
    const hierarchyHtml = hierarchy.map((h, i) => 
        `<span class="hier-item ${i === hierarchy.length - 1 ? 'hier-current' : ''}" data-tooltip="${h.type} at offset ${h.offset}">${h.name}</span>`
    ).join('<span class="hier-arrow">→</span>');
    
    // Capability is unlocked if it's loaded in any register, otherwise check the locked property
    const isLoaded = registers.length > 0;
    const isLocked = !isLoaded && cap.locked === true;
    const registerBadges = registers.length > 0 
        ? registers.map(r => `<span class="reg-badge-small" data-tooltip="${r.desc}">${r.reg}</span>`).join(' ')
        : '';
    const lockStatusHtml = isLocked 
        ? '<span class="lock-status locked" data-tooltip="Navigate to the C-List parent and perform Load GT to unlock access rights">🔒 Locked</span>'
        : `<span class="lock-status unlocked" data-tooltip="Unlocked for use as Permissions allow">🔓 Unlocked</span>${registerBadges ? ' ' + registerBadges : ''}`;
    
    panel.innerHTML = `
        <div class="cap-title-bar">
            <div class="cap-lock-status">
                ${lockStatusHtml}
            </div>
            <div class="cap-hierarchy-title" data-tooltip="Capability hierarchy path from Namespace root">
                ${hierarchyHtml}
            </div>
        </div>
        
        <div class="word-stack">
            <div class="word-row gt-row">
                <div class="word-key" data-tooltip="Golden Token - 64-bit capability key that grants access rights">GT</div>
                <div class="hex-btns">
                    <button class="hex-btn" data-tooltip="Big-Endian (MSB first): ${formatGTHex(gt)}" id="gtHexBtn">Hex</button>
                    <button class="le-btn" data-tooltip="Little-Endian (LSB first, ARM byte order): ${formatLittleEndian(gt)}" id="gtLeBtn">LE</button>
                </div>
                <div class="word-fields">
                    <div class="field-group field-left">
                        <span class="field-label" data-tooltip="Bits 0-31: Index into the Namespace Table pointing to the object descriptor">Offset [0:31]</span>
                        <input type="text" id="gtOffset" class="field-input" value="0x${offset.toString(16).toUpperCase().padStart(8, '0')}" onchange="updateGTFromEditor()">
                    </div>
                    <div class="field-group field-center">
                        <span class="field-label" data-tooltip="Bits 32-47: Reserved for future use">Spare [32:47]</span>
                        <input type="text" id="gtSpare" class="field-input" value="0x${spare.toString(16).toUpperCase().padStart(4, '0')}" onchange="updateGTFromEditor()">
                    </div>
                    <div class="field-group field-right">
                        <div class="field-label-row">
                            <span class="field-label" data-tooltip="Bits 48-63: Permission flags (R=Read, W=Write, X=Execute, L=Load, S=Save, E=Enter, B=Bind, M=Meta-Machine, F=Far/Remote URL)">Perms [48:63]</span>
                            <span class="perm-hex">= 0x${gtDecoded.permBits.toString(16).toUpperCase().padStart(4, '0')}</span>
                        </div>
                        <div class="perm-checkboxes">${permCheckboxes}</div>
                    </div>
                </div>
            </div>
            
            <div class="word-row nmd-row">
                <div class="word-key" data-tooltip="Namespace Descriptor Word 1 - ${cap.perms.includes('F') ? 'Remote URL location' : 'Physical memory address'}">W1</div>
                <div class="hex-btns">
                    ${cap.perms.includes('F') ? '<span class="hex-btn-disabled" data-tooltip="URL mode - hex display not applicable">--</span>' : `<button class="hex-btn" data-tooltip="Big-Endian (MSB first): ${formatWord(cap.nsEntry.word1_location)}" id="w1HexBtn">Hex</button>`}
                    ${cap.perms.includes('F') ? '<span class="hex-btn-disabled" data-tooltip="URL mode - LE display not applicable">--</span>' : `<button class="le-btn" data-tooltip="Little-Endian (LSB first, ARM byte order): ${formatLittleEndian(cap.nsEntry.word1_location)}" id="w1LeBtn">LE</button>`}
                </div>
                <div class="word-fields">
                    <div class="field-group field-right-full">
                        <span class="field-label" data-tooltip="Bits 0-63: ${cap.perms.includes('F') ? 'Remote URL location (F bit set)' : 'Physical memory address (local)'}">${cap.perms.includes('F') ? 'Location (URL)' : 'Location (Address)'} [0:63]</span>
                        <input type="text" id="nsLocation" class="field-input field-wide ${cap.perms.includes('F') ? 'url-field' : ''}" value="${formatLocation(cap.nsEntry.word1_location, cap.perms.includes('F'))}" onchange="updateNSFromEditor()">
                    </div>
                </div>
            </div>
            
            <div class="word-row nmd-row">
                <div class="word-key" data-tooltip="Namespace Descriptor Word 2 - ${cap.perms.includes('F') ? 'Content length in bytes' : 'Size limit in bytes'}">W2</div>
                <div class="hex-btns">
                    <button class="hex-btn" data-tooltip="Big-Endian (MSB first): ${formatWord(cap.nsEntry.word2_limit)}" id="w2HexBtn">Hex</button>
                    <button class="le-btn" data-tooltip="Little-Endian (LSB first, ARM byte order): ${formatLittleEndian(cap.nsEntry.word2_limit)}" id="w2LeBtn">LE</button>
                </div>
                <div class="word-fields">
                    <div class="field-group field-right-full">
                        <span class="field-label" data-tooltip="Bits 0-63: ${cap.perms.includes('F') ? 'Content length for remote resource' : 'Maximum size - hardware enforces bounds checking'}">${cap.perms.includes('F') ? 'Length' : 'Limit'} [0:63]</span>
                        <input type="text" id="nsLimit" class="field-input field-wide" value="${formatWord(cap.nsEntry.word2_limit)}" onchange="updateNSFromEditor()">
                    </div>
                </div>
            </div>
            
            <div class="word-row nmd-row">
                <div class="word-key" data-tooltip="Namespace Descriptor Word 3 - Seals containing metadata, type, and MAC for integrity">W3</div>
                <div class="hex-btns">
                    <button class="hex-btn" data-tooltip="Big-Endian (MSB first): ${formatWord(cap.nsEntry.word3_seals)}" id="w3HexBtn">Hex</button>
                    <button class="le-btn" data-tooltip="Little-Endian (LSB first, ARM byte order): ${formatLittleEndian(cap.nsEntry.word3_seals)}" id="w3LeBtn">LE</button>
                </div>
                <div class="word-fields">
                    <div class="field-group field-left">
                        <span class="field-label" data-tooltip="Bits 0-31: Object metadata (creation time, version, etc.)">Meta [0:31]</span>
                        <input type="text" id="nsMeta" class="field-input" value="0x${(Number(cap.nsEntry.word3_seals) & 0xFFFFFFFF).toString(16).toUpperCase().padStart(8, '0')}" onchange="updateNSFromEditor()">
                    </div>
                    <div class="field-group field-center">
                        <span class="field-label" data-tooltip="Bits 32-47: Object type identifier (Code, Data, CList, Thread, etc.)">Type [32:47]</span>
                        <select id="nsType" class="field-select" onchange="updateNSFromEditor()">${typeOptions}</select>
                    </div>
                    <div class="field-group field-right mac-field ${macValidation.valid ? 'mac-valid' : 'mac-invalid'}" data-tooltip="${macPopupContent}">
                        <span class="field-label" data-tooltip="Bits 48-63: Message Authentication Code - hardware validates integrity on LOAD">MAC [48:63]</span>
                        <div class="mac-inline">
                            <span id="nsMACValue" class="mac-value">${macValidation.valid ? '✓' : '⚠'} 0x${getMACFromSeals(cap.nsEntry).toString(16).toUpperCase().padStart(4, '0')}</span>
                            <button class="btn-recalc-mini" onclick="recalculateMAC()" title="Recalculate MAC">↻</button>
                        </div>
                    </div>
                </div>
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
    const gtHexBtn = document.getElementById('gtHexBtn');
    const gtLeBtn = document.getElementById('gtLeBtn');
    if (gtHexBtn) gtHexBtn.setAttribute('data-tooltip', `Big-Endian (MSB first): ${formatGTHex(gt)}`);
    if (gtLeBtn) gtLeBtn.setAttribute('data-tooltip', `Little-Endian (LSB first, ARM byte order): ${formatLittleEndian(gt)}`);
    
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
    
    const isFar = currentEditingCap.perms.includes('F');
    let location;
    if (isFar && !locationStr.startsWith('0x')) {
        location = locationStr;
    } else {
        location = BigInt(parseInt(locationStr, 16) || parseInt(locationStr, 10) || 0);
    }
    const limit = BigInt(parseInt(limitStr, 16) || parseInt(limitStr, 10) || 0);
    const meta = parseInt(metaStr, 16) || parseInt(metaStr, 10) || 0;
    const typeCode = Object.entries(OBJECT_TYPES).find(([k, v]) => v === typeVal)?.[0] || 0x0004;
    
    currentEditingCap.nsEntry.word1_location = location;
    currentEditingCap.nsEntry.word2_limit = limit;
    
    const storedMAC = getMACFromSeals(currentEditingCap.nsEntry);
    currentEditingCap.nsEntry.word3_seals = BigInt(meta & 0xFFFFFFFF) | 
                                             (BigInt(typeCode) << BigInt(32)) |
                                             (BigInt(storedMAC) << BigInt(48));
    
    // Update W1 Hex/LE tooltips
    const w1HexBtn = document.getElementById('w1HexBtn');
    const w1LeBtn = document.getElementById('w1LeBtn');
    if (w1HexBtn) w1HexBtn.setAttribute('data-tooltip', `Big-Endian (MSB first): ${formatWord(location)}`);
    if (w1LeBtn) w1LeBtn.setAttribute('data-tooltip', `Little-Endian (LSB first, ARM byte order): ${formatLittleEndian(location)}`);
    
    // Update W2 Hex/LE tooltips
    const w2HexBtn = document.getElementById('w2HexBtn');
    const w2LeBtn = document.getElementById('w2LeBtn');
    if (w2HexBtn) w2HexBtn.setAttribute('data-tooltip', `Big-Endian (MSB first): ${formatWord(limit)}`);
    if (w2LeBtn) w2LeBtn.setAttribute('data-tooltip', `Little-Endian (LSB first, ARM byte order): ${formatLittleEndian(limit)}`);
    
    // Update W3 Hex/LE tooltips
    const w3HexBtn = document.getElementById('w3HexBtn');
    const w3LeBtn = document.getElementById('w3LeBtn');
    if (w3HexBtn) w3HexBtn.setAttribute('data-tooltip', `Big-Endian (MSB first): ${formatWord(currentEditingCap.nsEntry.word3_seals)}`);
    if (w3LeBtn) w3LeBtn.setAttribute('data-tooltip', `Little-Endian (LSB first, ARM byte order): ${formatLittleEndian(currentEditingCap.nsEntry.word3_seals)}`);
    
    updateMACValidationDisplay();
}

function updateMACValidationDisplay() {
    if (!currentEditingCap || !currentEditingCap.nsEntry) return;
    
    const offset = currentEditingCap.location.offset || 0;
    const macValidation = validateMAC(offset, currentEditingCap.nsEntry);
    
    const macField = document.querySelector('.mac-field');
    if (macField) {
        macField.classList.remove('mac-valid', 'mac-invalid');
        macField.classList.add(macValidation.valid ? 'mac-valid' : 'mac-invalid');
        
        const tooltipContent = macValidation.valid 
            ? `MAC Valid | Stored: 0x${macValidation.stored.toString(16).toUpperCase().padStart(4, '0')} | Calculated: 0x${macValidation.calculated.toString(16).toUpperCase().padStart(4, '0')}`
            : `SECURITY TRAP! MAC Mismatch | Stored: 0x${macValidation.stored.toString(16).toUpperCase().padStart(4, '0')} | Calculated: 0x${macValidation.calculated.toString(16).toUpperCase().padStart(4, '0')}`;
        macField.setAttribute('data-tooltip', tooltipContent);
    }
    
    const macValueEl = document.getElementById('nsMACValue');
    if (macValueEl) {
        macValueEl.innerHTML = `${macValidation.valid ? '✓' : '⚠'} 0x${macValidation.stored.toString(16).toUpperCase().padStart(4, '0')}`;
    }
}

function recalculateMAC() {
    if (!currentEditingCap || !currentEditingCap.nsEntry) return;
    
    const offset = currentEditingCap.location.offset || 0;
    const newMAC = calculateMAC(offset, currentEditingCap.nsEntry);
    setMACInSeals(currentEditingCap.nsEntry, newMAC);
    
    updateMACValidationDisplay();
    log(`MAC recalculated: 0x${newMAC.toString(16).toUpperCase().padStart(4, '0')}`, 'info');
}

function getCapabilityTypeLabel(cap) {
    // Check for specific types based on name/type
    const type = cap.type || '';
    const name = cap.name || '';
    
    if (type === 'Thread' || ['Kenneth', 'Matthew', 'Daniel'].includes(name)) {
        return 'Thread';
    }
    if (type === 'Code' || name === 'Access' || name.endsWith('.asm')) {
        return 'Code';
    }
    if (type === 'Abstraction' || ['SlideRule', 'Abacus', 'Circle'].includes(name)) {
        return 'Abstraction';
    }
    if (type === 'C-List' || name === 'Boot') {
        return 'C-List';
    }
    if (type === 'Data') {
        return 'Data';
    }
    if (type === 'Namespace' || name === 'Namespace') {
        return 'Namespace';
    }
    
    return type || 'Object';
}

function getContextRegister(index) {
    // Get register from contextRegs, with special handling for cr15 and cr8
    if (index === 15 && simulator.cr15 && simulator.cr15.name && simulator.cr15.name !== 'NULL') {
        return simulator.cr15;
    }
    if (index === 8 && simulator.cr8 && simulator.cr8.name && simulator.cr8.name !== 'NULL') {
        return simulator.cr8;
    }
    return simulator.contextRegs[index];
}

function updateCapabilityExplorer() {
    const crGrid = document.getElementById('crButtonGrid');
    const clistContainer = document.getElementById('clistTokens');
    
    if (!crGrid) return;
    
    // Sync simulator.clist from CR6's clist entries
    const cr6Cap = simulator.contextRegs[6];
    if (cr6Cap && cr6Cap.clist && cr6Cap.clist.length > 0) {
        simulator.clist = cr6Cap.clist.map(entry => {
            const nsObj = namespaceObjects.find(o => o.offset === entry.nsOffset);
            const isAbstraction = ['Abacus', 'SlideRule', 'Circle'].includes(entry.name) || 
                                 (nsObj && nsObj.type === 'Abstraction');
            return {
                name: entry.name,
                type: entry.type || (nsObj ? nsObj.type : 'Unknown'),
                perms: entry.perms || [],
                locked: isAbstraction,
                location: { type: 'Local', offset: entry.nsOffset || 0 },
                nsOffset: entry.nsOffset || 0,
                size: nsObj ? (nsObj.word2_limit || nsObj.size || 1024) : 1024,
                nsEntry: nsObj || null,
                goldenKey: entry.goldenKey || generateGoldenKey()
            };
        });
    }
    
    // Render 16 CR buttons with type-based color coding
    crGrid.innerHTML = '';
    for (let i = 0; i < 16; i++) {
        const reg = getContextRegister(i);
        const hasGT = reg && reg.name && reg.name !== 'NULL';
        
        // Determine type class for color coding
        let typeClass = 'cr-empty';
        if (hasGT) {
            const type = getCapabilityTypeLabel(reg);
            if (type === 'Namespace' || reg.name === 'Namespace' || reg.name === 'SYSTEM_ROOT') {
                typeClass = 'cr-namespace';
            } else if (type === 'Thread' || reg.perms?.includes('M')) {
                typeClass = 'cr-thread';
            } else if (type === 'C-List') {
                typeClass = 'cr-clist';
            } else if (type === 'Code' || type === 'Nucleus') {
                typeClass = 'cr-code';
            } else if (type === 'Abstraction') {
                typeClass = 'cr-abstraction';
            } else {
                typeClass = 'cr-loaded';
            }
        }
        
        const btn = document.createElement('button');
        btn.className = `cr-btn ${typeClass}`;
        btn.innerHTML = `<span class="cr-num">${i}</span>`;
        btn.setAttribute('data-tooltip', hasGT ? `CR${i}: ${reg.name} [${(reg.perms || []).join('')}]` : `CR${i}: Empty`);
        
        btn.onclick = () => selectContextRegister(i, hasGT);
        
        crGrid.appendChild(btn);
    }
    
    // Render C-List
    clistContainer.innerHTML = '';
    if (simulator.clist && simulator.clist.length > 0) {
        simulator.clist.forEach((cap, i) => {
            const typeLabel = getCapabilityTypeLabel(cap);
            clistContainer.appendChild(createTokenCard(cap, `[${i}] ${typeLabel}`));
        });
    } else {
        clistContainer.innerHTML = '<p style="color: var(--text-secondary); font-style: italic; padding: 0.5rem;">No capabilities in C-List</p>';
    }
}

function selectContextRegister(regIndex, hasGT) {
    const reg = getContextRegister(regIndex);
    const regLabel = `CR${regIndex}`;
    
    // Handle empty register - show NULL details
    if (!hasGT || !reg || !reg.name || reg.name === 'NULL') {
        showEmptyRegisterDetail(regIndex);
        return;
    }
    
    // Build capability with required location.offset for showCapabilityDetail
    const cap = {
        name: reg.name,
        type: reg.type || getCapabilityTypeLabel(reg),
        perms: reg.perms || [],
        locked: reg.locked,
        location: reg.location || { offset: reg.nsOffset || 0 },
        size: reg.size || 1024,
        nsOffset: reg.nsOffset || 0,
        nsEntry: reg.nsEntry,
        goldenKey: reg.goldenKey
    };
    
    // Ensure location has offset
    if (!cap.location.offset && cap.location.offset !== 0) {
        cap.location.offset = cap.nsOffset || 0;
    }
    
    // Use the existing showCapabilityDetail function with register label
    showCapabilityDetail(null, cap, regLabel);
}

function showEmptyRegisterDetail(regIndex) {
    const panel = document.getElementById('capDetailPanel');
    
    panel.innerHTML = `
        <div class="cap-title-bar">
            <div class="cap-lock-status">
                <span class="lock-status locked" data-tooltip="Register is empty - no capability loaded">🔒 Empty</span>
                <span class="reg-badge-small" data-tooltip="Context Register ${regIndex}">CR${regIndex}</span>
            </div>
            <div class="cap-hierarchy-title" data-tooltip="Empty context register">
                <span class="hier-item hier-current">Empty Context Register</span>
            </div>
        </div>
        
        <div class="gt-editor">
            <div class="gt-row gt-header-row">
                <div class="gt-row-label">GT</div>
                <div class="gt-hex-btns"></div>
                <div class="gt-fields">
                    <div class="gt-field">
                        <span class="gt-field-label" data-tooltip="No Golden Token loaded">NULL</span>
                    </div>
                </div>
            </div>
            
            <p style="color: var(--text-secondary); font-style: italic; padding: 1rem; text-align: center;">
                No capability loaded in CR${regIndex}.<br>
                Use LOAD instruction to load a capability from C-List.
            </p>
        </div>
    `;
}

function createSampleCapabilities() {
    simulator.cr15 = {
        name: "SYSTEM_ROOT",
        location: { type: "Literal", name: "system.namespace" },
        perms: ["M"],  // Meta permission for namespace root
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
        perms: ["E"],  // Enter only - M added after successful CALL
        locked: false,
        goldenKey: generateGoldenKey()
    };
    
    simulator.contextRegs[7] = {
        name: "KernelCode",
        location: { type: "Literal", name: "kernel.entry" },
        perms: ["X"],  // Execute permission for code
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
            perms: ["L", "S"],  // Load/Save for capability operations
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
    
    const exBtn = document.getElementById('toggleExamples');
    const regBtn = document.getElementById('toggleRegisters');
    if (exBtn) exBtn.classList.add('active');
    if (regBtn) regBtn.classList.add('active');
    
    restoreEditorPanelState();
});

// ==================== PARADIGM TABS ====================

function switchParadigm(paradigm) {
    const panel = document.querySelector('.editor-examples-panel');
    if (!panel) return;
    
    panel.querySelectorAll('.paradigm-tab').forEach(t => t.classList.remove('active'));
    panel.querySelectorAll('.paradigm-content').forEach(c => c.classList.remove('active'));
    
    panel.querySelector(`.paradigm-tab[onclick*="${paradigm}"]`).classList.add('active');
    document.getElementById(`${paradigm}Examples`).classList.add('active');
}

// ==================== ASSEMBLY EDITOR ====================

let editorState = {
    program: [],
    pc: 0,
    running: false,
    parsed: [],
    currentLinkage: 'Boot/Nucleus',
    currentPerms: '[RX]'
};

function updateEditorToolbar() {
    const pathEl = document.getElementById('editorFilePath');
    const permsEl = document.getElementById('editorPerms');
    const headerEl = document.getElementById('editorHeaderFilename');
    
    const linkageWithExt = editorState.currentLinkage.endsWith('.asm') ? editorState.currentLinkage : editorState.currentLinkage + '.asm';
    if (pathEl) pathEl.textContent = linkageWithExt;
    if (permsEl) permsEl.textContent = editorState.currentPerms;
    
    // Extract filename from linkage path for editor header
    const parts = editorState.currentLinkage.split('/');
    let filename = parts[parts.length - 1];
    if (!filename.endsWith('.asm')) filename += '.asm';
    if (headerEl) headerEl.textContent = filename;
}

const examplePrograms = {
    access: `; =============================================
; ACCESS.ASM - FAILSAFE INPUT VALIDATION
; =============================================
; Purpose: Generic input validation pattern that
; checks capabilities and data WITHOUT leaking
; information about which check failed.
;
; SECURITY PRINCIPLE: All failures branch to the
; same FAULT handler - no error codes, no timing
; differences, no information leakage.
;
; Inputs:
;   CR0 = Capability to validate
;   DR0 = Data value to validate
;   DR1 = Maximum allowed value
;
; Output:
;   On success: Proceeds to protected operation
;   On failure: FAULT (uniform, no leakage)
; =============================================

; === CAPABILITY VALIDATION ===
; Test that CR0 has required permissions
TPERM 0 RW        ; Must have Read+Write
B NE fault        ; Any failure -> FAULT

TPERM 0 B         ; Must have Bind permission
B NE fault        ; Any failure -> FAULT

; === DATA BOUNDS VALIDATION ===
; Ensure DR0 is within acceptable range
CMP 0 0           ; DR0 >= 0? (non-negative)
B MI fault        ; Negative -> FAULT

CMP 0 1           ; DR0 <= DR1? (within max)
B GT fault        ; Exceeds max -> FAULT

; === ALL CHECKS PASSED ===
; Safe to proceed with protected operation
LOAD 1 0 0        ; Use validated capability
; ... protected operations here ...
RETURN            ; Success return

; === SINGLE FAILURE MODE ===
; All validation failures come here
; No error codes - no information leakage
fault:
FAULT             ; Uniform failure - triggers FirstFault`,

    firstfault: `; =============================================
; FIRSTFAULT.ASM - UNIFORM FAULT HANDLER
; =============================================
; Purpose: Single entry point for ALL failures.
; Provides failsafe recovery without leaking
; any information about what caused the fault.
;
; SECURITY PRINCIPLE: Every fault looks identical
; from outside - same timing, same behavior,
; same observable state. Attackers learn nothing.
;
; Actions:
;   1. Save thread state (for audit/recovery)
;   2. Clear all sensitive registers
;   3. Transfer to trusted fault handler
;   4. No information returned to caller
; =============================================

; === FAULT ENTRY POINT ===
; Hardware jumps here on any FAULT instruction
; or unhandled exception

; Step 1: Save thread identity for audit log
; (CR8 contains thread GT - preserved for logging)
; The Nucleus logs: WHO faulted, WHEN, WHERE (IP)
; but NOT why - that would leak information

; Step 2: Clear all Data Registers
; Prevent any computed values from leaking
ADDI 0 0          ; DR0 = 0
ADDI 1 0          ; DR1 = 0
ADDI 2 0          ; DR2 = 0
ADDI 3 0          ; DR3 = 0
ADDI 4 0          ; DR4 = 0
ADDI 5 0          ; DR5 = 0
ADDI 6 0          ; DR6 = 0
ADDI 7 0          ; DR7 = 0

; Step 3: Clear sensitive Context Registers
; Keep only CR7 (Nucleus), CR8 (Thread), CR15 (Namespace)
CHANGE 0 NULL     ; CR0 = NULL
CHANGE 1 NULL     ; CR1 = NULL
CHANGE 2 NULL     ; CR2 = NULL
CHANGE 3 NULL     ; CR3 = NULL
CHANGE 4 NULL     ; CR4 = NULL
CHANGE 5 NULL     ; CR5 = NULL
; CR6 (C-List) - cleared by Nucleus
; CR7 (Nucleus) - preserved for recovery
; CR8 (Thread) - preserved for audit
; CR15 (Namespace) - preserved for recovery

; Step 4: Transfer to Nucleus fault handler
; The Nucleus will:
;   - Log the fault (thread, time, IP only)
;   - Optionally notify administrator
;   - Terminate or restart the thread
;   - Never reveal WHY it faulted

; Jump to Nucleus handler (CR7) - never returns to caller
CALL 7            ; Transfer control to Nucleus
; Nucleus decides: terminate thread or restart
; NO RETURN to original caller - no information leakage

; === END FAULT HANDLER ===
; Observable behavior is IDENTICAL for:
;   - Permission failures
;   - Bounds violations
;   - Invalid capabilities
;   - Any other security violation
; Attackers cannot distinguish failure modes`,

    counter: `; =============================================
; COUNTER LOOP EXAMPLE
; =============================================
; Purpose: Demonstrates basic loop control using
; arithmetic operations and flag-based branching.
;
; Algorithm: Count from 0 to 5 by incrementing
; a counter register and comparing to a limit.
;
; Registers used:
;   DR0 = counter (starts at 0)
;   DR1 = limit value (5)
;   DR2 = increment value (1)
;
; Flags demonstrated:
;   Z (Zero) - set when counter equals limit
;   N (Negative) - set when counter < limit
; =============================================

; Initialize registers
ADDI 0 0      ; DR0 = 0 (counter starts at zero)
ADDI 1 5      ; DR1 = 5 (we count up to this)
ADDI 2 1      ; DR2 = 1 (add 1 each iteration)

; === LOOP START (address 3) ===
ADD 0 2       ; DR0 = DR0 + DR2 (increment counter)
              ; Sets NZCV flags based on result

CMP 0 1       ; Compare: DR0 - DR1 (counter - limit)
              ; Sets flags based on comparison result
              ; Use conditional branch to control loop

; Use B LT -2 to branch back if Less Than
; Loop continues while counter < limit
; Final: DR0 = 5 (counter reached limit)`,

    fibonacci: `; =============================================
; FIBONACCI SEQUENCE EXAMPLE
; =============================================
; Purpose: Calculate Fibonacci numbers using
; the classic F(n) = F(n-1) + F(n-2) formula.
;
; The Fibonacci sequence: 0, 1, 1, 2, 3, 5, 8...
; Each number is the sum of the two before it.
;
; Registers used:
;   DR0 = F(n-1) - previous Fibonacci number
;   DR1 = F(n) - current Fibonacci number
;   DR2 = temp - holds intermediate calculation
;
; After execution:
;   DR0, DR1 hold consecutive Fibonacci numbers
; =============================================

; Initialize with F(0)=0 and F(1)=1
ADDI 0 0      ; DR0 = 0 (F(0) - first Fibonacci)
ADDI 1 1      ; DR1 = 1 (F(1) - second Fibonacci)
ADDI 2 0      ; DR2 = 0 (temp storage)

; === Calculate F(2) = 0 + 1 = 1 ===
MOV 2 0       ; temp = F(n-1) = 0
ADD 2 1       ; temp = F(n-1) + F(n) = 0 + 1 = 1
MOV 0 1       ; shift: F(n-1) = old F(n) = 1
MOV 1 2       ; F(n) = temp = 1
              ; Now: DR0=1, DR1=1 (sequence: 0,1,1)

; === Calculate F(3) = 1 + 1 = 2 ===
MOV 2 0       ; temp = F(n-1) = 1
ADD 2 1       ; temp = 1 + 1 = 2
MOV 0 1       ; shift: F(n-1) = 1
MOV 1 2       ; F(n) = 2
              ; Now: DR0=1, DR1=2 (sequence: 0,1,1,2)

; === Calculate F(4) = 1 + 2 = 3 ===
MOV 2 0       ; temp = 1
ADD 2 1       ; temp = 1 + 2 = 3
MOV 0 1       ; F(n-1) = 2
MOV 1 2       ; F(n) = 3
              ; Now: DR0=2, DR1=3 (sequence: 0,1,1,2,3)`,

    multiply: `; =============================================
; MULTIPLICATION BY REPEATED ADDITION
; =============================================
; Purpose: Multiply two numbers without a MUL
; instruction, using only ADD and SUB.
;
; Algorithm: Add the multiplicand to result
; as many times as the multiplier indicates.
; Example: 6 * 7 = 6+6+6+6+6+6+6 = 42
;
; Registers used:
;   DR0 = result (accumulator, starts at 0)
;   DR1 = multiplicand (6 - added repeatedly)
;   DR2 = multiplier/counter (7 - counts down)
;   DR3 = decrement value (1)
;
; Flags demonstrated:
;   Z (Zero) - set when counter reaches 0
; =============================================

; Initialize multiplication: 6 * 7
ADDI 0 0      ; DR0 = 0 (result accumulator)
ADDI 1 6      ; DR1 = 6 (multiplicand)
ADDI 2 7      ; DR2 = 7 (multiplier = loop count)
ADDI 3 1      ; DR3 = 1 (subtract 1 each iteration)

; === MULTIPLY LOOP (address 4) ===
ADD 0 1       ; result = result + multiplicand
              ; DR0 grows: 6, 12, 18, 24, 30, 36, 42

SUB 2 3       ; counter = counter - 1
              ; DR2 shrinks: 6, 5, 4, 3, 2, 1, 0
              ; Sets Z=1 when counter reaches 0

; Use B NE -2 to branch back if Not Equal (Z=0)
; Loop runs 7 times (once per multiplier value)
;
; Final result: DR0 = 42 (6 * 7 = 42)
; Counter: DR2 = 0 (loop complete)`,

    flags: `; =============================================
; NZCV FLAG DEMONSTRATION
; =============================================
; Purpose: Show how condition flags are set by
; arithmetic and compare operations in CTMM.
;
; The four flags:
;   N (Negative) - Result is negative (sign bit set)
;   Z (Zero)     - Result is exactly zero
;   C (Carry)    - Set on unsigned carry/no borrow
;   V (Overflow) - Set on signed overflow
;
; Flags enable conditional branching:
;   B EQ target  - branch if equal (Z set)
;   B NE target  - branch if not equal
;   B LT target  - branch if less than
;   B GT target  - branch if greater than
; =============================================

; === TEST 1: Equal comparison (Z flag) ===
ADDI 0 10     ; DR0 = 10
ADDI 1 10     ; DR1 = 10
CMP 0 1       ; Compare: 10 - 10 = 0
              ; Z flag set when result is zero
              ; Use: B EQ branches when values equal

; === TEST 2: Less than comparison (N flag) ===
ADDI 2 5      ; DR2 = 5
CMP 2 0       ; Compare: 5 - 10 (smaller - larger)
              ; N flag indicates negative result
              ; Use: B LT branches when less than

; === TEST 3: Subtraction producing negative ===
ADDI 3 0      ; DR3 = 0
SUB 3 0       ; DR3 = 0 - 10 (produces negative)
              ; Flags set based on result
              ; Check N, Z, C, V in Condition Flags panel`,

    callerCode: `; =============================================
; CALLER CODE - Church Lambda Invocation
; =============================================
; Purpose: Demonstrate how a program invokes a
; capability-protected function using Golden Tokens.
;
; The Church paradigm separates:
;   - DATA (integers in DR registers)
;   - CAPABILITIES (Golden Tokens in CR registers)
;
; Key Security Principle:
;   You cannot call code directly by address!
;   You must hold a valid Golden Token (capability)
;   with Execute (X) permission to invoke code.
;
; Protocol:
;   1. Load GT selector into CR register
;   2. Prepare data arguments in DR registers
;   3. Execute CALL with capability
;   4. Receive results after RETURN
; =============================================

; === STEP 1: Load Golden Token Selector ===
; The GT identifies WHICH function to call
; Load from C-List (your authorized capabilities)
LOAD 1 6 2    ; CR1 = C-List[2] (GT_WRITE capability)
              ; CR6 holds reference to C-List
              ; Index 2 = GT_WRITE function token
              ; CR1 now holds the function selector

; === STEP 2: Prepare Data Arguments ===
; Arguments go in DATA registers (DR), not CR!
; The callee receives these values
ADDI 1 100    ; DR1 = 100 (first argument: address)
ADDI 2 42     ; DR2 = 42 (second argument: value)
              ; DR0 reserved for return status

; === STEP 3: Execute Capability CALL ===
; CALL requires Enter (E) permission on capability
CALL 0        ; Call via capability in CR0
              ; Validates E permission before transfer
              ; If valid: context switch to callee
              ; If invalid: security violation

; ============================================
; CONTEXT SWITCH BOUNDARY
; ============================================
; After CALL, control transfers to Guard Code
; The GT selector (CR1) travels with you
; Your DR/CR state is saved to Thread Object
; Callee's code runs at offset 0
; ============================================

; === STEP 4: After RETURN - Check Results ===
; Guard Code has finished and returned control
; Results follow a strict protocol:
;
;   DR0 = Status code (0=SUCCESS, 1=ERROR)
;   DR1 = First return value (data)
;   DR2 = Second return value (data)
;   DR3 = Third return value (data)
;
;   CR0-CR3 = Returned capabilities (if any)
;             These are type-safe GT references
;             NOT integers - real capabilities!
;
; Check status before using return values:
CMP 0 0       ; Is DR0 == 0? (success check)
              ; B NE error_handler  ; branch if error`,

    guardCode: `; =============================================
; GUARD CODE - Capability-Protected Entry Point
; =============================================
; Purpose: Demonstrate secure function dispatch
; using Golden Token validation and TPERM checks.
;
; This is the CALLEE side of a capability call.
; Guard Code runs in a protected namespace with
; its own C-List of authorized capabilities.
;
; Security Model:
;   - CALL already validated Execute permission
;   - GT selector arrives in CR1 (capability!)
;   - Guard must validate GT before dispatching
;   - Use TPERM to check permissions before use
;
; Why Golden Tokens matter:
;   - Caller cannot forge the GT selector
;   - GT is cryptographically sealed (MAC)
;   - Permissions checked before access
;   - TPERM validates permissions/bounds
; =============================================

; === ENTRY POINT (Offset 0) ===
; Execution begins here after CALL
; CR1 contains the GT selector from caller

; === STEP 1: Validate GT Selector ===
; Before dispatching, verify the capability
; TPERM checks permissions and optional index bounds
TPERM 1 R     ; Test: Does CR1 have Read permission?
              ; Add index: TPERM 1 R 5 validates index 5 < object size
              ; Sets Z=1 if permission present
              ; Sets Z=0 if permission missing
              ; B EQ continue  ; proceed if valid
              ; B NE reject    ; reject if missing perm!

; === STEP 2: Load Reference GTs for Dispatch ===
; Compare caller's GT against known function GTs
LOAD 2 6 0    ; CR2 = GT_READ from our C-List
LOAD 3 6 1    ; CR3 = GT_WRITE from our C-List  
LOAD 4 6 2    ; CR4 = GT_DELETE from our C-List
              ; These are the functions we support

; === STEP 3: GT Dispatch Logic ===
; Compare capabilities (not integers!)
; Each GT has a unique cryptographic identity
;
; Pseudocode dispatch:
;   if CR1 == CR2: goto handle_read
;   if CR1 == CR3: goto handle_write
;   if CR1 == CR4: goto handle_delete
;   else: goto invalid_gt_trap
;
; Note: Capability comparison uses cryptographic MACs
; You cannot forge a matching capability

; === STEP 4: Execute Requested Operation ===
; (Implementation of read/write/delete here)
; Access data using capabilities, not addresses

; ============================================
; RETURN PROTOCOL
; ============================================
; Prepare results for caller:
;
;   DR0 = Status (0=OK, 1=PERMISSION_DENIED,
;                 2=BOUNDS_ERROR, 3=INVALID_GT)
;   DR1-DR3 = Return data values
;   CR0-CR3 = Return capabilities (if granting)
;
; Key rule: Capabilities stay in CR registers!
; Never try to store a GT in a DR register.
; This separation is fundamental to CTMM security.
; ============================================

ADDI 0 0      ; DR0 = 0 (STATUS_OK)
RETURN        ; Return to caller context
              ; Restores caller's state from stack
              ; Execution continues after CALL`
};

function setupCodeEditor() {
    const editor = document.getElementById('codeEditor');
    if (!editor) return;
    
    // Load saved content and linkage from localStorage if available
    const savedContent = localStorage.getItem('ctmm_editor_content');
    const savedLinkage = localStorage.getItem('ctmm_editor_linkage');
    const savedPerms = localStorage.getItem('ctmm_editor_perms');
    if (savedContent) {
        editor.value = savedContent;
        savedEditorContent = savedContent;
        lastSavedCode = savedContent;
        if (savedLinkage) editorState.currentLinkage = savedLinkage;
        if (savedPerms) editorState.currentPerms = savedPerms;
        pushCodeHistory(savedContent);
        updateEditorToolbar();
        updateLineNumbers();
    }
    
    // Track code changes for undo history
    // Capture state immediately on first input, then debounce subsequent saves
    let historyTimeout = null;
    let firstInputSinceChange = true;
    let saveTimeout = null;
    editor.addEventListener('input', () => {
        updateLineNumbers();
        checkEditorModified();
        
        // Immediately capture state on first change (for instant undo)
        if (firstInputSinceChange) {
            capturePreChangeState();
            firstInputSinceChange = false;
        }
        
        // Debounce history saves for final state
        clearTimeout(historyTimeout);
        historyTimeout = setTimeout(() => {
            pushCodeHistory(editor.value);
            firstInputSinceChange = true; // Reset for next batch of changes
        }, 1000);
        
        // Auto-save to localStorage on every change (debounced)
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            localStorage.setItem('ctmm_editor_content', editor.value);
            localStorage.setItem('ctmm_editor_linkage', editorState.currentLinkage || '');
            localStorage.setItem('ctmm_editor_perms', editorState.currentPerms || '');
        }, 300);
    });
    editor.addEventListener('scroll', syncScroll);
    editor.addEventListener('keydown', handleTab);
    editor.addEventListener('click', updateLineInfo);
    editor.addEventListener('keyup', updateLineInfo);
    
    // Ctrl+Z undo handler
    editor.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            undoCodeChange();
        }
    });
    
    savedEditorContent = editor.value;
    // Initialize history with current content
    if (editor.value.trim()) {
        pushCodeHistory(editor.value);
    }
    updateLineNumbers();
}

function checkEditorModified() {
    const editor = document.getElementById('codeEditor');
    if (!editor) return;
    
    if (editor.value !== savedEditorContent) {
        editor.classList.remove('editor-saved');
        editor.classList.add('editor-modified');
    } else {
        editor.classList.remove('editor-modified');
    }
}

function markEditorSaved() {
    const editor = document.getElementById('codeEditor');
    if (!editor) return;
    
    savedEditorContent = editor.value;
    editor.classList.remove('editor-modified');
    editor.classList.add('editor-saved');
    
    // Persist to localStorage so changes carry between sessions
    localStorage.setItem('ctmm_editor_content', editor.value);
    localStorage.setItem('ctmm_editor_linkage', editorState.currentLinkage);
    localStorage.setItem('ctmm_editor_perms', editorState.currentPerms);
    
    setTimeout(() => {
        editor.classList.remove('editor-saved');
    }, 2000);
}

function clearCode() {
    const editor = document.getElementById('codeEditor');
    if (!editor) return;
    
    // Save current state to history before clearing (force push even if same as lastSavedCode)
    if (editor.value.trim() !== '') {
        codeHistory.push(editor.value);
        if (codeHistory.length > MAX_HISTORY) {
            codeHistory.shift();
        }
    }
    
    editor.value = '';
    savedEditorContent = '';
    autoLoadedAccessAsm = false;
    lastSavedCode = '';
    updateLineNumbers();
    localStorage.removeItem('ctmm_editor_content');
    codeHistory.push('');
    editorLog('Code cleared', 'info');
}

function saveCode() {
    markEditorSaved();
    const savePath = editorState.currentLinkage.endsWith('.asm') ? editorState.currentLinkage : editorState.currentLinkage + '.asm';
    editorLog('Code saved to ' + savePath, 'success');
}

function updateLineNumbers() {
    const editor = document.getElementById('codeEditor');
    const lineNumbers = document.getElementById('lineNumbers');
    if (!editor || !lineNumbers) return;
    
    const lines = editor.value.split('\n').length;
    let nums = [];
    for (let i = 1; i <= lines; i++) {
        nums.push(`<span>${i}</span>`);
    }
    lineNumbers.innerHTML = nums.join('');
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
    
    const stringArgInstructions = {
        'B': [0, 1],
        'BL': [0, 1],
        'TPERM': [1],
        'LOAD': [1],
        'CALL': [0],
        'SWITCH': [0],
        'CHANGE': [1]
    };
    
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        let label = null;
        
        const labelMatch = line.match(/^(\w+):\s*/);
        if (labelMatch) {
            label = labelMatch[1];
            line = line.substring(labelMatch[0].length).trim();
        }
        
        const commentIdx = line.indexOf(';');
        if (commentIdx !== -1) {
            line = line.substring(0, commentIdx).trim();
        }
        
        if (line === '') {
            if (label) {
                program.push({
                    line: i + 1,
                    instr: 'LABEL',
                    args: [],
                    label: label,
                    raw: lines[i]
                });
            }
            continue;
        }
        
        const parts = line.split(/\s+/);
        const instr = parts[0].toUpperCase();
        const stringPositions = stringArgInstructions[instr] || [];
        
        const args = parts.slice(1).map((a, idx) => {
            if (stringPositions.includes(idx)) {
                return a;
            }
            const num = parseInt(a);
            if (isNaN(num)) {
                return a;
            }
            return num;
        });
        
        program.push({
            line: i + 1,
            instr: instr,
            args: args,
            label: label,
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

function toggleExamplesPanel() {
    const content = document.querySelector('.editor-content');
    const btn = document.getElementById('toggleExamples');
    const fullBtn = document.getElementById('toggleFullCode');
    const regBtn = document.getElementById('toggleRegisters');
    
    if (content.classList.contains('full-code')) {
        content.classList.remove('full-code');
        fullBtn.classList.remove('active');
        fullBtn.textContent = 'Expand';
        content.classList.add('hide-registers');
        content.classList.add('hide-output');
        regBtn.classList.remove('active');
    }
    
    content.classList.toggle('hide-examples');
    btn.classList.toggle('active', !content.classList.contains('hide-examples'));
    
    updateExpandButtonState();
    saveEditorPanelState();
}

function toggleRegistersPanel() {
    const content = document.querySelector('.editor-content');
    const btn = document.getElementById('toggleRegisters');
    const fullBtn = document.getElementById('toggleFullCode');
    const exBtn = document.getElementById('toggleExamples');
    
    if (content.classList.contains('full-code')) {
        content.classList.remove('full-code');
        fullBtn.classList.remove('active');
        fullBtn.textContent = 'Expand';
        content.classList.add('hide-examples');
        content.classList.add('hide-output');
        exBtn.classList.remove('active');
    }
    
    content.classList.toggle('hide-registers');
    btn.classList.toggle('active', !content.classList.contains('hide-registers'));
    
    updateExpandButtonState();
    saveEditorPanelState();
}

function updateExpandButtonState() {
    const content = document.querySelector('.editor-content');
    const fullBtn = document.getElementById('toggleFullCode');
    
    const allHidden = content.classList.contains('hide-examples') && 
                      content.classList.contains('hide-registers') &&
                      content.classList.contains('hide-output');
    
    if (allHidden && !content.classList.contains('full-code')) {
        content.classList.add('full-code');
        fullBtn.classList.add('active');
        fullBtn.textContent = 'Collapse';
    }
}

function toggleFullCode() {
    const content = document.querySelector('.editor-content');
    const fullBtn = document.getElementById('toggleFullCode');
    const exBtn = document.getElementById('toggleExamples');
    const regBtn = document.getElementById('toggleRegisters');
    
    const isExpanded = content.classList.toggle('full-code');
    
    if (isExpanded) {
        content.classList.add('hide-examples', 'hide-registers', 'hide-output');
        fullBtn.classList.add('active');
        fullBtn.textContent = 'Collapse';
        exBtn.classList.remove('active');
        regBtn.classList.remove('active');
    } else {
        content.classList.remove('hide-examples', 'hide-registers', 'hide-output');
        fullBtn.classList.remove('active');
        fullBtn.textContent = 'Expand';
        exBtn.classList.add('active');
        regBtn.classList.add('active');
    }
    
    saveEditorPanelState();
    
    setTimeout(() => {
        updateLineNumbers();
        const editor = document.getElementById('codeEditor');
        if (editor) {
            const lineNumbers = document.getElementById('lineNumbers');
            if (lineNumbers) {
                lineNumbers.scrollTop = editor.scrollTop;
            }
        }
    }, 50);
}

function saveEditorPanelState() {
    const content = document.querySelector('.editor-content');
    const state = {
        hideExamples: content.classList.contains('hide-examples'),
        hideRegisters: content.classList.contains('hide-registers'),
        hideOutput: content.classList.contains('hide-output'),
        fullCode: content.classList.contains('full-code')
    };
    localStorage.setItem('ctmm_editor_panels', JSON.stringify(state));
}

function restoreEditorPanelState() {
    const saved = localStorage.getItem('ctmm_editor_panels');
    if (!saved) return;
    
    try {
        const state = JSON.parse(saved);
        const content = document.querySelector('.editor-content');
        const exBtn = document.getElementById('toggleExamples');
        const regBtn = document.getElementById('toggleRegisters');
        const fullBtn = document.getElementById('toggleFullCode');
        
        if (state.fullCode) {
            content.classList.add('full-code', 'hide-examples', 'hide-registers', 'hide-output');
            fullBtn.classList.add('active');
            fullBtn.textContent = 'Collapse';
            exBtn.classList.remove('active');
            regBtn.classList.remove('active');
        } else {
            if (state.hideExamples) {
                content.classList.add('hide-examples');
                exBtn.classList.remove('active');
            } else {
                exBtn.classList.add('active');
            }
            if (state.hideRegisters) {
                content.classList.add('hide-registers');
                regBtn.classList.remove('active');
            } else {
                regBtn.classList.add('active');
            }
            if (state.hideOutput) {
                content.classList.add('hide-output');
            }
        }
    } catch (e) {
        console.error('Error restoring editor panel state:', e);
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
    
    markEditorSaved();
    clearEditorConsole();
    editorLog('Running program...', 'info');
    simulator.softReset();
    
    while (editorState.pc < editorState.program.length) {
        const instr = editorState.program[editorState.pc];
        const faultOccurred = executeEditorInstruction(instr);
        editorState.pc++;
        
        if (faultOccurred) {
            editorLog('*** HALTED: FAULT detected - investigate before continuing ***', 'error');
            updateEditorStatus();
            updateEditorRegisters();
            updateParsedView();
            updateDisplay();
            highlightCurrentLine();
            return;
        }
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
        simulator.softReset();
        markEditorSaved();
        clearEditorConsole();
        editorLog('Starting step execution...', 'info');
        updateParsedView();
    }
    
    if (editorState.pc >= editorState.program.length) {
        editorLog('Program completed', 'success');
        return;
    }
    
    const instr = editorState.program[editorState.pc];
    const faultOccurred = executeEditorInstruction(instr);
    editorState.pc++;
    
    if (faultOccurred) {
        editorLog('*** FAULT detected - investigate before continuing ***', 'error');
    }
    
    updateEditorStatus();
    updateEditorRegisters();
    highlightCurrentLine();
    updateDisplay();
}

function executeEditorInstruction(instr) {
    const { instr: op, args, line } = instr;
    let faultOccurred = false;
    
    try {
        let result;
        switch (op) {
            // Turing: Two-operand arithmetic/logic
            case 'ADD':
            case 'SUB':
            case 'MUL':
            case 'AND':
            case 'ORR':
            case 'EOR':
            case 'BIC':
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
            
            // Turing: Immediate arithmetic
            case 'ADDI':
            case 'SUBI':
                result = simulator.execute(op, args[0], args[1]);
                break;
            
            // Turing: Shift operations
            case 'LSL':
            case 'LSR':
            case 'ASR':
            case 'ROR':
                result = simulator.execute(op, args[0], args[1], args[2]);
                break;
            
            // Turing: Branch instructions
            // Syntax: B label OR B condition label
            case 'B': {
                let target, cond;
                const conditions = ['EQ', 'NE', 'CS', 'CC', 'MI', 'PL', 'VS', 'VC', 
                                   'HI', 'LS', 'GE', 'LT', 'GT', 'LE', 'AL'];
                
                if (args.length === 1) {
                    target = args[0];
                    cond = 'AL';
                } else if (args.length >= 2) {
                    const firstArg = String(args[0]).toUpperCase();
                    if (conditions.includes(firstArg)) {
                        cond = firstArg;
                        target = args[1];
                    } else {
                        target = args[0];
                        cond = String(args[1]).toUpperCase();
                    }
                }
                
                if (simulator.checkCondition(cond)) {
                    const targetLine = findLabel(target);
                    if (targetLine >= 0) {
                        editorState.pc = targetLine;
                        result = `Branch to ${target} (line ${targetLine})`;
                    } else {
                        result = `FAULT: Label '${target}' not found`;
                        faultOccurred = true;
                    }
                } else {
                    result = `Branch not taken (${cond} failed)`;
                }
                editorLog(`[${line}] ${op} ${args.join(' ')}: ${result}`, faultOccurred ? 'error' : 'exec');
                updateEditorStatus();
                return faultOccurred;
            }
            
            case 'BL': {
                let target, cond;
                const conditions = ['EQ', 'NE', 'CS', 'CC', 'MI', 'PL', 'VS', 'VC', 
                                   'HI', 'LS', 'GE', 'LT', 'GT', 'LE', 'AL'];
                
                if (args.length === 1) {
                    target = args[0];
                    cond = 'AL';
                } else if (args.length >= 2) {
                    const firstArg = String(args[0]).toUpperCase();
                    if (conditions.includes(firstArg)) {
                        cond = firstArg;
                        target = args[1];
                    } else {
                        target = args[0];
                        cond = 'AL';
                    }
                }
                
                if (simulator.checkCondition(cond)) {
                    const targetLine = findLabel(target);
                    if (targetLine >= 0) {
                        simulator.setDataReg(14, BigInt(editorState.pc + 1));
                        editorState.pc = targetLine;
                        result = `Branch with link to ${target}, LR=${editorState.pc}`;
                    } else {
                        result = `FAULT: Label '${target}' not found`;
                        faultOccurred = true;
                    }
                } else {
                    result = `Branch not taken (${cond} failed)`;
                }
                editorLog(`[${line}] ${op} ${args.join(' ')}: ${result}`, faultOccurred ? 'error' : 'exec');
                updateEditorStatus();
                return faultOccurred;
            }
            
            // Church: Capability instructions
            case 'LOAD':
                result = simulator.execute(op, args[0], args[1], args[2]);
                break;
            
            case 'SAVE':
                result = simulator.execute(op, args[0], args[1]);
                break;
            
            case 'CALL':
                result = simulator.execute(op, args[0]);
                break;
            
            case 'RETURN':
                result = simulator.execute(op);
                break;
            
            case 'CHANGE':
                result = simulator.execute(op, args[0], args[1]);
                break;
            
            case 'SWITCH':
                result = simulator.execute(op, args[0]);
                break;
            
            case 'TPERM':
                result = simulator.execute(op, args[0], args[1], args[2]);
                break;
            
            default:
                result = `Unknown instruction: ${op}`;
                faultOccurred = true;
        }
        
        // Check if result contains FAULT
        if (result && typeof result === 'string' && result.includes('FAULT')) {
            faultOccurred = true;
        }
        
        editorLog(`[${line}] ${op} ${args.join(' ')}: ${result}`, faultOccurred ? 'error' : 'exec');
        return faultOccurred;
    } catch (e) {
        editorLog(`[${line}] Error: ${e.message}`, 'error');
        return true;
    }
}

function findLabel(label) {
    for (let i = 0; i < editorState.program.length; i++) {
        if (editorState.program[i].label === label) {
            return i;
        }
    }
    return -1;
}

function resetProgram(preserveLinkage = true) {
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

function clearEditor() {
    document.getElementById('codeEditor').value = '';
    editorState.currentLinkage = 'Boot/Nucleus';
    editorState.currentPerms = '[RX]';
    updateEditorToolbar();
    resetProgram();
}

function setEditorCode(code, linkage, perms) {
    const editor = document.getElementById('codeEditor');
    editor.value = code;
    editorState.currentLinkage = linkage || '';
    editorState.currentPerms = perms || '';
    updateLineNumbers();
    updateEditorToolbar();
    
    // Also update localStorage to persist the change
    localStorage.setItem('ctmm_editor_content', code);
    localStorage.setItem('ctmm_editor_linkage', editorState.currentLinkage);
    localStorage.setItem('ctmm_editor_perms', editorState.currentPerms);
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
    
    const contentIds = {
        console: 'editorConsole',
        turing: 'editorTuring',
        church: 'editorChurch'
    };
    const content = document.getElementById(contentIds[tab]);
    if (content) content.classList.remove('hidden');
    
    if (tab === 'turing') updateTuringRegisters();
    if (tab === 'church') updateChurchRegisters();
}

function updateTuringRegisters() {
    const container = document.getElementById('turingRegList');
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < 16; i++) {
        const val = simulator.dataRegs[i] || 0;
        const div = document.createElement('div');
        div.className = 'reg-item';
        div.innerHTML = `<span class="reg-name">DR${i}</span><span class="reg-value">0x${val.toString(16).padStart(16, '0')}</span>`;
        container.appendChild(div);
    }
}

function updateChurchRegisters() {
    const container = document.getElementById('churchRegList');
    if (!container) return;
    container.innerHTML = '';
    
    const crNames = {
        0: 'CR0', 1: 'CR1', 2: 'CR2', 3: 'CR3',
        4: 'CR4', 5: 'CR5 (Nodal)', 6: 'CR6 (C-List)', 7: 'CR7 (Nucleus)',
        8: 'CR8 (Thread)', 9: 'SPARE', 10: 'SPARE', 11: 'SPARE',
        12: 'SPARE', 13: 'SPARE', 14: 'SPARE', 15: 'CR15 (Namespace)'
    };
    
    for (let i = 0; i < 16; i++) {
        const cr = simulator.contextRegs[i];
        const isSpare = crNames[i] === 'SPARE';
        const div = document.createElement('div');
        div.className = 'reg-item' + (isSpare ? ' spare' : '');
        const name = isSpare ? `CR${i} SPARE` : crNames[i];
        const val = cr && cr.name ? cr.name : 'NULL';
        div.innerHTML = `<span class="reg-name">${name}</span><span class="reg-value">${val}</span>`;
        container.appendChild(div);
    }
}

function updateEditorRegisters() {
    const crContainer = document.getElementById('editorContextRegs');
    const drContainer = document.getElementById('editorDataRegs');
    
    if (crContainer) {
        crContainer.innerHTML = '';
        const roles = { 6: 'C-List', 7: 'Nucleus' };
        for (let i = 0; i < 8; i++) {
            const reg = simulator.contextRegs[i];
            const isNull = !reg || reg.name === 'NULL';
            const role = roles[i] || '';
            let permsDisplay = '---';
            if (reg && reg.perms && reg.perms.length > 0) {
                if (i === 6) {
                    const count = reg.clistCount !== undefined ? reg.clistCount : (reg.clist?.length || 0);
                    permsDisplay = `[${reg.perms.join('')}] (${count})`;
                } else if (i === 7) {
                    permsDisplay = `[${reg.perms.join('')}]`;
                } else {
                    permsDisplay = reg.perms.join('');
                }
            }
            const row = document.createElement('div');
            row.className = `register-row ${isNull ? 'null' : ''}`;
            row.innerHTML = `
                <span class="name">CR${i}${role ? ' ' + role : ''}</span>
                <span class="value">${reg ? reg.name : 'NULL'}</span>
                <span class="perms">${permsDisplay}</span>
            `;
            crContainer.appendChild(row);
        }
    }
    
    if (drContainer) {
        drContainer.innerHTML = '';
        for (let i = 0; i < 16; i++) {
            const value = simulator.dataRegs[i] || 0n;
            const hexStr = value.toString(16).toUpperCase().padStart(16, '0');
            const row = document.createElement('div');
            row.className = 'register-row';
            row.innerHTML = `
                <span class="name">DR${i}</span>
                <span class="value" title="0x${hexStr}">0x${hexStr.slice(-8)}</span>
                <span class="perms"></span>
            `;
            drContainer.appendChild(row);
        }
    }
    
    ['N', 'Z', 'C', 'V'].forEach(flag => {
        const el = document.getElementById(`editorFlag${flag}`);
        if (el) {
            el.classList.toggle('active', simulator.flags[flag]);
        }
    });
}

function loadExample(name) {
    const isTuring = examplePrograms.hasOwnProperty(name);
    const isLambda = codeTemplates.hasOwnProperty(name);
    const code = examplePrograms[name] || codeTemplates[name];
    if (code) {
        const editor = document.getElementById('codeEditor');
        const currentCode = editor ? editor.value : '';
        
        // Save current state to history before change
        capturePreChangeState();
        
        let newCode;
        let shouldReplace = false;
        
        // Replace if empty, or if Access.asm was auto-loaded
        if (currentCode.trim() === '' || autoLoadedAccessAsm) {
            shouldReplace = true;
            autoLoadedAccessAsm = false; // Clear flag after first replacement
        }
        
        if (shouldReplace) {
            newCode = code;
        } else {
            // Append with separator
            newCode = currentCode + '\n\n; ============================================\n; APPENDED: ' + name + '\n; ============================================\n\n' + code;
        }
        
        setEditorCode(newCode, `Boot/Examples/${name}`, '[RX]');
        savedEditorContent = newCode;
        pushCodeHistory(newCode);
        resetProgram();
        
        if (!shouldReplace) {
            editorLog(`Appended example: ${name}`, 'success');
        } else {
            editorLog(`Loaded example: ${name}`, 'success');
        }
        
        // Update paradigm tab to match loaded example
        if (isTuring) {
            switchParadigm('turing');
        } else if (isLambda) {
            switchParadigm('church');
        }
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
    
    editorLog('CR7 capability loaded into editor', 'success');
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
    const errorEl = document.getElementById('cr7Error');
    
    if (!name) {
        errorEl.textContent = 'Error: Name required';
        errorEl.style.display = 'block';
        return;
    }
    if (!locationStr) {
        errorEl.textContent = 'Error: Location required';
        errorEl.style.display = 'block';
        return;
    }
    errorEl.style.display = 'none';
    
    let location;
    if (locationStr.startsWith('local:')) {
        const offset = parseInt(locationStr.substring(6)) || 0;
        location = { type: 'Local', offset: offset };
    } else {
        location = { type: 'Literal', name: locationStr || 'kernel.code' };
    }
    
    const perms = ['X', 'R'];
    
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
    completedLessons: new Set(),
    hasUnsavedChanges: false
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
                            <div class="token-label">64-bit Golden Token</div>
                            <div class="token-key" id="demoToken1">0xA3F291B4CC87D2E1</div>
                        </div>
                    </div>
                    <div class="demo-explanation">
                        <p>This is a <strong>Golden Token (GT)</strong> - a 64-bit capability key containing an offset, permissions, and spare bits.</p>
                        <p>Each GT points to a <strong>3-word Namespace Entry</strong> that describes the resource's location, size, and security seals.</p>
                    </div>
                </div>`
            },
            {
                text: `<h3>The Nine Permissions</h3>
                <p>Each capability grants specific permissions encoded in the GT. The CTMM uses nine permission types:</p>
                <ul>
                    <li><code>R</code> - <strong>Read</strong>: View data or code</li>
                    <li><code>W</code> - <strong>Write</strong>: Modify data</li>
                    <li><code>X</code> - <strong>Execute</strong>: Run as code</li>
                    <li><code>L</code> - <strong>Load</strong>: Load capabilities from children</li>
                    <li><code>S</code> - <strong>Store</strong>: Store capabilities to children</li>
                    <li><code>E</code> - <strong>Enter</strong>: Switch namespace or call procedure</li>
                    <li><code>B</code> - <strong>Bind</strong>: Save token to namespace DNA (persistent storage)</li>
                    <li><code>M</code> - <strong>Meta-Machine</strong>: Hardware-level access (Namespace, Threads only)</li>
                    <li><code>F</code> - <strong>Far</strong>: Indicates remote URL location vs local memory</li>
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
                            <span class="perm-demo-badge" style="background: #a855f7; color: #1a1a2e;">M</span>
                            <span class="perm-demo-badge" style="background: #06b6d4; color: #1a1a2e;">F</span>
                        </div>
                    </div>
                    <div class="demo-explanation">
                        <p>Permissions are encoded in bits [48:63] of the GT. The <code>M</code> permission marks hardware-level resources (Namespace, Threads), while <code>F</code> indicates a remote URL.</p>
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
        title: "Golden Token Structure",
        steps: [
            {
                text: `<h3>The 64-bit Golden Token</h3>
                <p>Each capability is represented by a <strong>64-bit Golden Token (GT)</strong> with three fields in Little-Endian (ARM) format:</p>
                <ul>
                    <li><strong>Offset [0:31]</strong> - 32-bit index into the Namespace Table</li>
                    <li><strong>Spare [32:47]</strong> - 16 reserved bits for future use</li>
                    <li><strong>Perms [48:63]</strong> - 16-bit permission flags (R, W, X, L, S, E, B, M, F)</li>
                </ul>
                <div class="key-concept">
                    <strong>Key Insight:</strong> The GT contains just enough to locate and authorize access. The detailed resource description lives in the Namespace Entry.
                </div>`,
                demo: `<div class="demo-title">GT Bit Layout (Little-Endian)</div>
                <div class="demo-content">
                    <div class="demo-visual">
                        <div style="display: flex; gap: 0.5rem; justify-content: center; font-family: monospace;">
                            <div style="background: #4ade80; color: #1a1a2e; padding: 0.5rem 1rem; border-radius: 4px; text-align: center;">
                                <div style="font-size: 0.7rem;">Offset</div>
                                <div>[0:31]</div>
                            </div>
                            <div style="background: #94a3b8; color: #1a1a2e; padding: 0.5rem 1rem; border-radius: 4px; text-align: center;">
                                <div style="font-size: 0.7rem;">Spare</div>
                                <div>[32:47]</div>
                            </div>
                            <div style="background: #f59e0b; color: #1a1a2e; padding: 0.5rem 1rem; border-radius: 4px; text-align: center;">
                                <div style="font-size: 0.7rem;">Perms</div>
                                <div>[48:63]</div>
                            </div>
                        </div>
                    </div>
                    <div class="demo-explanation">
                        <p>The Offset points to a 3-word entry in the Namespace Table. Permissions determine what operations are allowed.</p>
                    </div>
                </div>`
            },
            {
                text: `<h3>The 3-Word Namespace Entry</h3>
                <p>Each GT Offset points to a <strong>3-word (192-bit) Namespace Entry</strong> describing the resource:</p>
                <ul>
                    <li><strong>Word 1 (W1)</strong> - <em>Location</em>: Physical address (or URL if F permission set)</li>
                    <li><strong>Word 2 (W2)</strong> - <em>Limit</em>: Object size in bytes</li>
                    <li><strong>Word 3 (W3)</strong> - <em>Seals</em>: Metadata, Type, and MAC for integrity</li>
                </ul>
                <div class="highlight">
                    The F (Far) permission changes how W1 is interpreted: local memory address vs. remote URL.
                </div>`,
                demo: `<div class="demo-title">Namespace Entry Structure</div>
                <div class="demo-content">
                    <div class="demo-visual">
                        <div style="display: flex; flex-direction: column; gap: 0.3rem; font-family: monospace;">
                            <div style="display: flex; align-items: center; gap: 0.5rem;">
                                <span style="color: var(--accent); width: 40px;">W1:</span>
                                <div style="flex: 1; background: var(--bg-panel); padding: 0.4rem 0.8rem; border-radius: 4px; border-left: 3px solid #4ade80;">Location [0:63] - Address or URL</div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 0.5rem;">
                                <span style="color: var(--accent); width: 40px;">W2:</span>
                                <div style="flex: 1; background: var(--bg-panel); padding: 0.4rem 0.8rem; border-radius: 4px; border-left: 3px solid #60a5fa;">Limit [0:63] - Size in bytes</div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 0.5rem;">
                                <span style="color: var(--accent); width: 40px;">W3:</span>
                                <div style="flex: 1; background: var(--bg-panel); padding: 0.4rem 0.8rem; border-radius: 4px; border-left: 3px solid #f59e0b;">Meta [0:31] | Type [32:47] | MAC [48:63]</div>
                            </div>
                        </div>
                    </div>
                </div>`
            },
            {
                text: `<h3>MAC Validation</h3>
                <p>The <strong>MAC (Message Authentication Code)</strong> in W3 provides hardware-enforced integrity:</p>
                <ul>
                    <li>Calculated from: GT Offset + W1 (Location) + W2 (Limit)</li>
                    <li>Verified during every <code>LOAD</code> operation</li>
                    <li>Prevents tampering with capability metadata</li>
                </ul>
                <div class="key-concept">
                    <strong>Security Guarantee:</strong> If the MAC doesn't match, the LOAD fails - even with correct permissions.
                </div>`,
                demo: `<div class="demo-title">MAC Validation Flow</div>
                <div class="demo-content">
                    <div class="demo-visual">
                        <div style="display: flex; flex-direction: column; gap: 0.5rem; align-items: center;">
                            <div style="padding: 0.5rem 1rem; background: var(--bg-panel); border-radius: 4px; font-size: 0.85rem;">hash(Offset + W1 + W2)</div>
                            <div style="color: var(--accent);">&darr; compare</div>
                            <div style="padding: 0.5rem 1rem; background: var(--bg-panel); border-radius: 4px; font-size: 0.85rem;">Stored MAC in W3[48:63]</div>
                            <div style="display: flex; gap: 1rem; margin-top: 0.5rem;">
                                <span style="color: var(--success);">Match = Allow</span>
                                <span style="color: var(--error);">Mismatch = Deny</span>
                            </div>
                        </div>
                    </div>
                </div>`,
                interactive: {
                    type: "quiz",
                    question: "What does W3 in the Namespace Entry contain?",
                    options: [
                        "Just the object's size",
                        "The location address only",
                        "Metadata, Type, and MAC (integrity seal)",
                        "User permissions"
                    ],
                    correct: 2,
                    feedback: {
                        correct: "Correct! W3 contains the Metadata, Type identifier, and MAC for integrity verification.",
                        incorrect: "Not quite. W3 holds the Seals: Metadata [0:31], Type [32:47], and MAC [48:63]."
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
                <p><code>CR15</code> receives the system namespace capability with <code>M</code> permission only - the root of all accessible resources. The M (Meta-Machine) permission marks hardware-level access exclusively.</p>
                <h3>Step 3: Initialize Thread</h3>
                <p><code>CR8</code> gets the user thread capability, and <code>CR6</code> receives the C-List (capability list) for user access.</p>
                <h3>Step 4: Load Nucleus</h3>
                <p>The kernel code capability is loaded into <code>CR7</code>. This is the core operating system code with <code>X</code> permission (data access to code object).</p>`,
                demo: `<div class="demo-title">Register States After Boot</div>
                <div class="demo-content">
                    <div class="demo-visual register-demo">
                        <div class="reg-demo-item"><span class="reg-demo-name">CR7</span><span class="reg-demo-value">NUCLEUS [X]</span></div>
                        <div class="reg-demo-item"><span class="reg-demo-name">CR15</span><span class="reg-demo-value">NAMESPACE [M]</span></div>
                        <div class="reg-demo-item"><span class="reg-demo-name">CR8</span><span class="reg-demo-value">KENNETH [M]</span></div>
                        <div class="reg-demo-item"><span class="reg-demo-name">CR6</span><span class="reg-demo-value">BOOT [E]</span></div>
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
                    <li><strong>Context Registers (CR0-CR7)</strong>: Hold capabilities (programmer-accessible)</li>
                    <li><strong>Meta-Machine Registers (CR8-CR15)</strong>: Reserved for hardware/OS</li>
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
                <p>The 16 Context Registers are divided into two groups:</p>
                <ul>
                    <li><strong>CR0-CR7 (Programmer)</strong>: Accessible to application code
                        <ul>
                            <li><code>CR0-CR5</code> - General-purpose capability registers</li>
                            <li><code>CR6</code> - <strong>C-List LCA</strong>: Current capability list</li>
                            <li><code>CR7</code> - <strong>Nucleus</strong>: Kernel code capability</li>
                        </ul>
                    </li>
                    <li><strong>CR8-CR15 (Meta-Machine)</strong>: Reserved for hardware/OS
                        <ul>
                            <li><code>CR8</code> - <strong>Thread</strong>: Current process identity</li>
                            <li><code>CR15</code> - <strong>Namespace</strong>: Root of resources</li>
                        </ul>
                    </li>
                </ul>
                <div class="highlight">
                    Only CR0-CR7 can be addressed by programmer instructions. CR8-CR15 are managed by the meta-machine.
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
                            <div style="color: var(--accent);">&darr; CALL [X capability]</div>
                            <div style="padding: 0.5rem 1rem; background: var(--accent); color: white; border-radius: 4px;">Protected Procedure</div>
                            <div style="color: var(--success);">&darr; RETURN</div>
                            <div style="padding: 0.5rem 1rem; background: var(--bg-panel); border-radius: 4px;">Back to User Code</div>
                        </div>
                    </div>
                </div>`
            },
            {
                text: `<h3>Capability-Based Math: Integer vs Float</h3>
                <p>In the CTMM, even basic arithmetic is controlled by capabilities. Programs distinguish between integer and floating-point math by <strong>which abstraction they CALL</strong>:</p>
                <ul>
                    <li><strong style="color: #e67e22;">Abacus</strong> - 64-bit integer arithmetic (ADD, SUB, MUL, DIV, MOD, ABS, NEG)</li>
                    <li><strong style="color: #3498db;">SlideRule</strong> - IEEE 754 floating-point (ADD, SUB, MUL, DIV, LOG, EXP, SQRT, POW)</li>
                    <li><strong style="color: #9b59b6;">Circle</strong> - Geometry using floats (PI, CIRCUMFERENCE, AREA, DIAMETER)</li>
                </ul>
                <div class="key-concept">
                    <strong>Key Insight:</strong> There are no separate integer/float opcodes. The <em>capability you hold</em> determines the math type. No capability = no math!
                </div>`,
                demo: `<div class="demo-title">Math via CALL</div>
                <div class="demo-content">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div style="background: rgba(230, 126, 34, 0.15); padding: 1rem; border-radius: 6px; border-left: 3px solid #e67e22;">
                            <div style="color: #e67e22; font-weight: bold; margin-bottom: 0.5rem;">Integer Math</div>
                            <code style="font-size: 0.8rem; color: var(--text-secondary);">LOAD CR1, Abacus<br/>CALL CR1  ; Enter int64 ADD</code>
                        </div>
                        <div style="background: rgba(52, 152, 219, 0.15); padding: 1rem; border-radius: 6px; border-left: 3px solid #3498db;">
                            <div style="color: #3498db; font-weight: bold; margin-bottom: 0.5rem;">Float Math</div>
                            <code style="font-size: 0.8rem; color: var(--text-secondary);">LOAD CR1, SlideRule<br/>CALL CR1  ; Enter IEEE754 ADD</code>
                        </div>
                    </div>
                    <div class="demo-explanation">
                        <p>Both use "ADD" but produce different results based on which abstraction (and thus which hardware) they invoke.</p>
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
                    <li><strong>Unforgeable tokens</strong>: 64-bit Golden Tokens with MAC validation cannot be forged</li>
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
                text: `<h3>Shared Privileges - Eliminated</h3>
                <p>Traditional operating systems use <strong>shared privilege levels</strong> (Ring 0-3, user/kernel mode):</p>
                <div class="highlight">
                    All code at the same privilege level can access all resources at that level - a massive attack surface.
                </div>
                <p>This creates fundamental vulnerabilities:</p>
                <ul>
                    <li><strong>Kernel exploits</strong>: One bug gives access to EVERYTHING in Ring 0</li>
                    <li><strong>Driver vulnerabilities</strong>: Trusted drivers run with full kernel privilege</li>
                    <li><strong>Lateral movement</strong>: Compromising one process aids attacking others at same level</li>
                </ul>
                <div class="key-concept">
                    <strong>CTMM Solution:</strong> No shared privileges exist. Each Golden Token grants specific access to specific resources. There is no "privilege level" - only individual capabilities.
                </div>`,
                demo: `<div class="demo-title">Shared Privileges vs Capabilities</div>
                <div class="demo-content">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div style="background: rgba(248, 113, 113, 0.15); padding: 1rem; border-radius: 6px;">
                            <div style="color: var(--error); font-weight: bold; margin-bottom: 0.5rem;">Ring 0 (All or Nothing)</div>
                            <div style="font-size: 0.85rem; color: var(--text-secondary);">Kernel mode = access to ALL memory, ALL devices, ALL processes</div>
                        </div>
                        <div style="background: rgba(74, 222, 128, 0.15); padding: 1rem; border-radius: 6px;">
                            <div style="color: var(--success); font-weight: bold; margin-bottom: 0.5rem;">Capabilities (Precise)</div>
                            <div style="font-size: 0.85rem; color: var(--text-secondary);">Each GT grants access to ONE specific resource with specific permissions</div>
                        </div>
                    </div>
                </div>`
            },
            {
                text: `<h3>Return-Oriented Programming (ROP) - Defeated</h3>
                <p><strong>ROP attacks</strong> exploit the fundamental flaw of mixed code and data:</p>
                <div class="highlight">
                    Attackers chain existing code fragments ("gadgets") ending in RET to build malicious programs without injecting new code.
                </div>
                <p>Why ROP works on traditional systems:</p>
                <ul>
                    <li><strong>Flat memory</strong>: Code and return addresses share the same space</li>
                    <li><strong>Unprotected stack</strong>: Return addresses can be overwritten</li>
                    <li><strong>Executable code reuse</strong>: Any code in memory can be "jumped to"</li>
                </ul>
                <div class="key-concept">
                    <strong>CTMM Solution:</strong> The CALL/RETURN mechanism uses Golden Tokens, not memory addresses. You cannot CALL code without holding a valid capability with E (Enter) permission. Return addresses are protected by hardware - there is no stack to overflow.
                </div>`,
                demo: `<div class="demo-title">ROP Attack vs CTMM Protection</div>
                <div class="demo-content">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div style="background: rgba(248, 113, 113, 0.15); padding: 1rem; border-radius: 6px;">
                            <div style="color: var(--error); font-weight: bold; margin-bottom: 0.5rem;">Traditional Stack</div>
                            <div style="font-size: 0.8rem; color: var(--text-secondary); font-family: monospace;">
                                RET addr → gadget1<br/>
                                RET addr → gadget2<br/>
                                RET addr → system()
                            </div>
                        </div>
                        <div style="background: rgba(74, 222, 128, 0.15); padding: 1rem; border-radius: 6px;">
                            <div style="color: var(--success); font-weight: bold; margin-bottom: 0.5rem;">CTMM Protected</div>
                            <div style="font-size: 0.8rem; color: var(--text-secondary); font-family: monospace;">
                                CALL requires GT with [E]<br/>
                                No GT = No execution<br/>
                                Hardware-protected returns
                            </div>
                        </div>
                    </div>
                </div>`
            },
            {
                text: `<h3>Congratulations!</h3>
                <p>You've learned the fundamentals of capability-based security:</p>
                <ul>
                    <li>Capabilities are unforgeable tokens granting specific access</li>
                    <li>The 8 permissions (R, W, X, L, S, E, B, M) control what you can do. M=Meta-Machine distinguishes hardware-level access.</li>
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
    },
    {
        title: "Lambda Combinators",
        steps: [
            {
                text: `<h3>Lambda Calculus and Capabilities</h3>
                <p>Alonzo Church's <strong>lambda calculus</strong> is the theoretical foundation for all computation. In CTMM, lambda expressions become Golden Tokens:</p>
                <ul>
                    <li><strong>Lambda abstraction</strong> (λx.body) = A GT pointing to executable code</li>
                    <li><strong>Application</strong> (f x) = CALL instruction with arguments in registers</li>
                    <li><strong>Binding</strong> = Loading GTs from C-Lists into Context Registers</li>
                </ul>
                <div class="key-concept">
                    <strong>Key Insight:</strong> Every lambda becomes a capability. You can only apply functions you have tokens for.
                </div>`,
                demo: `<div class="demo-title">Lambda as Capability</div>
                <div class="demo-content">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div style="background: rgba(147, 51, 234, 0.15); padding: 1rem; border-radius: 6px; border-left: 3px solid #9333ea;">
                            <div style="color: #9333ea; font-weight: bold; margin-bottom: 0.5rem;">Lambda Calculus</div>
                            <code style="font-size: 0.9rem;">λf.λx. f x</code>
                        </div>
                        <div style="background: rgba(234, 179, 8, 0.15); padding: 1rem; border-radius: 6px; border-left: 3px solid #eab308;">
                            <div style="color: #eab308; font-weight: bold; margin-bottom: 0.5rem;">CTMM Assembly</div>
                            <code style="font-size: 0.85rem;">LOAD CR0, [CR6+0]<br/>CALL CR0</code>
                        </div>
                    </div>
                </div>`
            },
            {
                text: `<h3>Church Booleans</h3>
                <p>In lambda calculus, booleans are functions that select between two arguments:</p>
                <ul>
                    <li><strong>TRUE</strong> = λx.λy.x (returns first argument)</li>
                    <li><strong>FALSE</strong> = λx.λy.y (returns second argument)</li>
                    <li><strong>IF-THEN-ELSE</strong> = λb.λt.λf. b t f (applies boolean to branches)</li>
                </ul>
                <p>In CTMM, each boolean is a GT. Calling it with two argument GTs returns one of them.</p>`,
                demo: `<div class="demo-title">Church Boolean Implementation</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.8rem; overflow-x: auto;">
; TRUE: Returns first argument
true:
    LOAD CR0, [CR1+0]    ; CR0 = first arg
    RETURN

; FALSE: Returns second argument  
false:
    LOAD CR0, [CR2+0]    ; CR0 = second arg
    RETURN

; IF b THEN t ELSE f
if_then_else:
    CALL CR0             ; Call bool with t,f in CR1,CR2
    RETURN</pre>
                </div>`
            },
            {
                text: `<h3>Church Numerals</h3>
                <p>Numbers as functions that apply f to x n times:</p>
                <ul>
                    <li><strong>ZERO</strong> = λf.λx. x (apply f zero times)</li>
                    <li><strong>ONE</strong> = λf.λx. f x (apply f once)</li>
                    <li><strong>TWO</strong> = λf.λx. f (f x) (apply f twice)</li>
                    <li><strong>SUCC</strong> = λn.λf.λx. f (n f x) (add one)</li>
                </ul>
                <p>Each numeral is a GT. Calling it with function and base GTs produces the result.</p>`,
                demo: `<div class="demo-title">Church Numeral Implementation</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.8rem; overflow-x: auto;">
; ZERO: Identity on x (ignore f)
zero:
    LOAD CR0, [CR2+0]    ; Return x unchanged
    RETURN

; SUCC: Add one to numeral n
; Input: CR0=n, CR1=f, CR2=x
succ:
    LOAD CR3, [CR0+0]    ; Save n
    CALL CR3             ; (n f x) -> CR0
    LOAD CR3, [CR0+0]    ; Save result
    LOAD CR0, [CR1+0]    ; CR0 = f
    CALL CR0             ; f(n f x)
    RETURN</pre>
                </div>`
            },
            {
                text: `<h3>The Y Combinator</h3>
                <p>The <strong>Y combinator</strong> enables recursion without explicit self-reference:</p>
                <div class="highlight">
                    Y = λf. (λx. f (x x)) (λx. f (x x))
                </div>
                <p>In CTMM, a GT in the C-List can point back to the current code block, enabling the self-application pattern (x x) through CALL.</p>`,
                demo: `<div class="demo-title">Y Combinator Pattern</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.8rem; overflow-x: auto;">
; Y-COMBINATOR: Fixed-point for recursion
; CR6[0] contains GT pointing to this code

; Load self-reference from C-List
LOAD CR0, [CR6+0]    ; CR0 = GT to self

; Self-application: (x x)
CALL CR0             ; Execute self

; The called code receives its own GT
; enabling recursion via CALL CR0

RETURN</pre>
                </div>`
            },
            {
                text: `<h3>Pairs (CONS)</h3>
                <p>Pairs store two values using closures:</p>
                <ul>
                    <li><strong>PAIR</strong> = λa.λb.λf. f a b (create pair)</li>
                    <li><strong>FST</strong> = λp. p TRUE (get first element)</li>
                    <li><strong>SND</strong> = λp. p FALSE (get second element)</li>
                </ul>
                <p>A pair is a GT that, when called with a selector (TRUE or FALSE), returns the corresponding element.</p>`,
                demo: `<div class="demo-title">Pair Implementation</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.8rem; overflow-x: auto;">
; PAIR: Returns selector function capturing a,b
pair:
    LOAD CR0, [CR6+0]    ; GT to pair_select
    RETURN

; Called when pair applied to selector
pair_select:
    CALL CR0             ; Selector chooses CR1 or CR2
    RETURN

; FST: Get first element
fst:
    LOAD CR1, [CR6+1]    ; TRUE GT
    CALL CR0             ; pair(TRUE)
    RETURN</pre>
                </div>`
            },
            {
                text: `<h3>Try the Examples</h3>
                <p>The Assembly Editor includes working implementations of these lambda combinators:</p>
                <ul>
                    <li><strong>Y-Combinator</strong> - Self-referencing recursion pattern</li>
                    <li><strong>Factorial</strong> - Recursive calculation using Y pattern</li>
                    <li><strong>Church Booleans</strong> - TRUE, FALSE, IF-THEN-ELSE, NOT</li>
                    <li><strong>Church Numerals</strong> - ZERO, SUCC, ADD</li>
                    <li><strong>Pairs</strong> - CONS, FST, SND (CAR/CDR)</li>
                </ul>
                <div class="key-concept">
                    <strong>Try It:</strong> Go to Assembly Editor → Lambda Examples tab to load and run these programs.
                </div>`,
                interactive: {
                    type: "quiz",
                    question: "How does CTMM implement lambda application (f x)?",
                    options: [
                        "Using the APPLY instruction",
                        "Using the CALL instruction with the function GT",
                        "By copying code directly",
                        "Through shared memory"
                    ],
                    correct: 1,
                    feedback: {
                        correct: "Correct! Lambda application becomes CALL with the function's Golden Token. Arguments are passed in registers.",
                        incorrect: "Not quite. In CTMM, lambda application (f x) is implemented using CALL with the function's GT."
                    }
                }
            }
        ]
    },
    {
        title: "Assembly Editor",
        steps: [
            {
                text: `<h3>The Assembly Editor</h3>
                <p>The Assembly Editor is where you write and execute CTMM programs. It provides:</p>
                <ul>
                    <li><strong>Code Editor</strong> - Write CTMM assembly with syntax highlighting</li>
                    <li><strong>Example Programs</strong> - Pre-built examples in Turing and Lambda tabs</li>
                    <li><strong>Output Panel</strong> - See execution results and logs</li>
                    <li><strong>Instruction Palette</strong> - Quick reference for available instructions</li>
                </ul>
                <div class="key-concept">
                    <strong>Tip:</strong> Your code is automatically saved to browser storage, so you won't lose work between sessions.
                </div>`,
                demo: `<div class="demo-title">Editor Layout</div>
                <div class="demo-content">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px;">
                            <div style="color: var(--text-primary); font-weight: bold; margin-bottom: 0.5rem;">Left Panel</div>
                            <div style="font-size: 0.85rem; color: var(--text-secondary);">Code editor with line numbers and syntax highlighting</div>
                        </div>
                        <div style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px;">
                            <div style="color: var(--text-primary); font-weight: bold; margin-bottom: 0.5rem;">Right Panel</div>
                            <div style="font-size: 0.85rem; color: var(--text-secondary);">Output tabs: Console, Registers, Memory</div>
                        </div>
                    </div>
                </div>`
            },
            {
                text: `<h3>Instruction Syntax</h3>
                <p>CTMM assembly uses a simple syntax:</p>
                <ul>
                    <li><strong>Comments</strong>: Lines starting with <code>;</code></li>
                    <li><strong>Labels</strong>: Names ending with <code>:</code> (e.g., <code>loop:</code>)</li>
                    <li><strong>Instructions</strong>: <code>OPCODE operands</code></li>
                </ul>
                <p>Registers are referenced by number:</p>
                <ul>
                    <li><strong>DR0-DR15</strong>: Data registers for values</li>
                    <li><strong>CR0-CR15</strong>: Context registers for capabilities</li>
                </ul>`,
                demo: `<div class="demo-title">Syntax Examples</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.85rem;">
; This is a comment
start:              ; This is a label
    ADDI 0 5        ; DR0 = 5 (immediate)
    ADD 1 0         ; DR1 = DR1 + DR0
    CMP 0 1         ; Compare DR0 with DR1
    B EQ done       ; Branch if equal
    B start         ; Loop back
done:
    RETURN          ; Return from call</pre>
                </div>`
            },
            {
                text: `<h3>Turing Examples</h3>
                <p>The <strong>Turing Examples</strong> tab contains programs using data operations:</p>
                <ul>
                    <li><strong>Counter Loop</strong> - Basic counting with flags and branching</li>
                    <li><strong>Fibonacci</strong> - Calculate Fibonacci sequence</li>
                    <li><strong>Multiply</strong> - Multiplication by repeated addition</li>
                    <li><strong>NZCV Flags</strong> - Demonstrate condition flags</li>
                    <li><strong>Caller Code</strong> - How to invoke abstractions via CALL</li>
                </ul>
                <div class="key-concept">
                    <strong>Try It:</strong> Go to Assembly Editor → Turing Examples → Select any example to load it into the editor.
                </div>`,
                demo: `<div class="demo-title">Counter Loop Example</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.8rem;">
; Count from 0 to 5
ADDI 0 0      ; DR0 = 0 (counter)
ADDI 1 5      ; DR1 = 5 (limit)
ADDI 2 1      ; DR2 = 1 (increment)

loop:
ADD 0 2       ; counter++
CMP 0 1       ; compare to limit
B LT loop     ; loop while < 5
; Final: DR0 = 5</pre>
                </div>`
            },
            {
                text: `<h3>Lambda Examples</h3>
                <p>The <strong>Lambda Examples</strong> tab contains Church lambda calculus implementations:</p>
                <ul>
                    <li><strong>Y-Combinator</strong> - Fixed-point combinator for recursion</li>
                    <li><strong>Factorial</strong> - Recursive n! using Y pattern</li>
                    <li><strong>Capability Check</strong> - Validate GT permissions before use</li>
                    <li><strong>Church Booleans</strong> - TRUE, FALSE, IF-THEN-ELSE, NOT</li>
                    <li><strong>Church Numerals</strong> - ZERO, SUCC, ADD</li>
                    <li><strong>Pairs</strong> - CONS, FST, SND (CAR/CDR)</li>
                </ul>
                <div class="key-concept">
                    <strong>Key Pattern:</strong> All lambda examples use GTs in the C-List (CR6) to reference functions, enabling recursion and higher-order programming.
                </div>`,
                demo: `<div class="demo-title">Factorial Example</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.8rem;">
; fact(n) = n * fact(n-1)
CMP 0 0           ; n == 0?
B EQ base_case

MOV 1 0           ; save n
SUBI 0 1          ; n - 1
LOAD 0 6 0        ; GT to self
CALL 0            ; recurse
MUL 0 1           ; n * fact(n-1)
RETURN

base_case:
ADDI 0 1          ; return 1
RETURN</pre>
                </div>`
            },
            {
                text: `<h3>Running Programs</h3>
                <p>After loading or writing code:</p>
                <ol>
                    <li><strong>Boot the system</strong> - Use Dashboard → Run Boot Sequence</li>
                    <li><strong>Step through code</strong> - Click Step to execute one instruction</li>
                    <li><strong>Run continuously</strong> - Click Run to execute until halt or breakpoint</li>
                    <li><strong>Watch registers</strong> - Monitor DR and CR values in the Dashboard</li>
                </ol>
                <p>The Output panel shows execution logs and any errors.</p>`,
                interactive: {
                    type: "quiz",
                    question: "What tab contains the Y-Combinator and Church Boolean examples?",
                    options: [
                        "Turing Examples",
                        "Lambda Examples",
                        "Instructions",
                        "Namespace"
                    ],
                    correct: 1,
                    feedback: {
                        correct: "Correct! Lambda Examples contains Church lambda calculus implementations including Y-Combinator, Church Booleans, and Church Numerals.",
                        incorrect: "Not quite. The Lambda Examples tab contains the Church lambda calculus implementations."
                    }
                }
            }
        ]
    },
    {
        title: "Example Programs",
        steps: [
            {
                text: `<h3>Counter Loop</h3>
                <p>The simplest example demonstrates <strong>loop control</strong> using flags:</p>
                <ul>
                    <li>Initialize a counter (DR0) and limit (DR1)</li>
                    <li>Increment counter each iteration</li>
                    <li>Compare counter to limit</li>
                    <li>Branch back while counter < limit</li>
                </ul>
                <p>This teaches the fundamental pattern: <strong>init → loop body → compare → branch</strong></p>`,
                demo: `<div class="demo-title">Counter Pattern</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.85rem;">
ADDI 0 0      ; DR0 = 0 (counter)
ADDI 1 5      ; DR1 = 5 (limit)
ADDI 2 1      ; DR2 = 1 (step)

loop:
ADD 0 2       ; counter += step
CMP 0 1       ; counter - limit
B LT loop     ; if < 0, keep looping

; Result: DR0 = 5</pre>
                </div>`
            },
            {
                text: `<h3>Fibonacci Sequence</h3>
                <p>Calculates F(n) = F(n-1) + F(n-2) iteratively:</p>
                <ul>
                    <li>DR0 holds F(n-1), DR1 holds F(n)</li>
                    <li>Each step: compute sum, then shift values</li>
                    <li>Produces sequence: 0, 1, 1, 2, 3, 5, 8, 13...</li>
                </ul>
                <p>Demonstrates <strong>multi-register coordination</strong> and the shift pattern.</p>`,
                demo: `<div class="demo-title">Fibonacci Pattern</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.85rem;">
ADDI 0 0      ; DR0 = F(0) = 0
ADDI 1 1      ; DR1 = F(1) = 1

; Each iteration:
MOV 2 0       ; temp = F(n-1)
ADD 2 1       ; temp = F(n-1) + F(n)
MOV 0 1       ; shift: F(n-1) = old F(n)
MOV 1 2       ; F(n) = temp

; Repeat to generate sequence</pre>
                </div>`
            },
            {
                text: `<h3>Multiplication</h3>
                <p>Multiplies without a MUL instruction using <strong>repeated addition</strong>:</p>
                <ul>
                    <li>6 × 7 = 6+6+6+6+6+6+6 = 42</li>
                    <li>Add multiplicand to result, decrement counter</li>
                    <li>Stop when counter reaches zero (Z flag set)</li>
                </ul>
                <p>Shows how complex operations can be built from simple primitives.</p>`,
                demo: `<div class="demo-title">Multiply Pattern</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.85rem;">
ADDI 0 0      ; DR0 = result = 0
ADDI 1 6      ; DR1 = multiplicand
ADDI 2 7      ; DR2 = multiplier (counter)
ADDI 3 1      ; DR3 = decrement

loop:
ADD 0 1       ; result += multiplicand
SUB 2 3       ; counter--
B NE loop     ; loop until counter = 0

; Result: DR0 = 42</pre>
                </div>`
            },
            {
                text: `<h3>Y-Combinator: What Is It?</h3>
                <p>The <strong>Y combinator</strong> is a mathematical discovery that enables recursion without naming the function:</p>
                <div class="highlight">
                    Y = λf. (λx. f (x x)) (λx. f (x x))
                </div>
                <p>In plain terms: <strong>a function that calls itself without knowing its own name</strong>.</p>
                <div class="key-concept">
                    <strong>The Problem:</strong> To write factorial(n), you need factorial to call factorial. But how does a function know its own name?<br><br>
                    <strong>Y-Combinator Solution:</strong> Pass the function a reference to itself as a parameter. The function doesn't need a name - it has a <em>capability</em> to invoke itself.
                </div>`,
                demo: `<div class="demo-title">Y-Combinator in CTMM</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.85rem;">
; Y-COMBINATOR for recursion
; CR6[0] = GT pointing to THIS code

LOAD 0 6 0        ; CR0 = GT to self
TPERM 0 X         ; Verify executable
B NE fault        ; Failsafe check

CALL 0            ; Self-application (x x)
; This code CALLS ITSELF via the GT
; No function name needed!

RETURN</pre>
                    <p style="margin-top: 0.5rem; color: var(--text-secondary);">The Golden Token IS the self-reference - no symbol table lookup required.</p>
                </div>`
            },
            {
                text: `<h3>Factorial with Recursion</h3>
                <p>Combines the Y pattern with actual computation:</p>
                <ul>
                    <li><strong>Base case</strong>: If n=0, return 1</li>
                    <li><strong>Recursive case</strong>: n × fact(n-1)</li>
                    <li>Uses LOAD to get self-reference, CALL to recurse</li>
                </ul>
                <p>This demonstrates <strong>real recursive algorithms</strong> in CTMM assembly.</p>`,
                demo: `<div class="demo-title">Factorial Implementation</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.85rem;">
; Input: DR0 = n
; Output: DR0 = n!

CMP 0 0           ; n == 0?
B EQ base         ; yes: return 1

MOV 1 0           ; DR1 = n (save)
SUBI 0 1          ; DR0 = n-1
LOAD 0 6 0        ; CR0 = GT to self
CALL 0            ; DR0 = fact(n-1)
MUL 0 1           ; DR0 = (n-1)! * n
RETURN

base:
ADDI 0 1          ; return 1
RETURN</pre>
                </div>`
            },
            {
                text: `<h3>Capability Validation (Failsafe)</h3>
                <p>Before using a gifted GT, <strong>validate it</strong> using the failsafe pattern:</p>
                <ul>
                    <li><strong>TPERM</strong> - Test if GT has required permissions</li>
                    <li><strong>Branch to FAULT</strong> - All failures go to same handler</li>
                    <li><strong>No error codes</strong> - Prevents information leakage</li>
                </ul>
                <p>This is the <strong>failsafe pattern</strong> - attackers cannot learn which check failed.</p>`,
                demo: `<div class="demo-title">Failsafe Validation Pattern</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.85rem;">
; Validate CR0 before use

TPERM 0 RWX       ; Has R+W+X?
B NE fault        ; No: FAULT (not error code!)

; Safe to use
LOAD 1 0 0        ; Use capability
; ... operations ...
RETURN

; Single failure mode - no leakage
fault:
FAULT             ; Uniform failure</pre>
                </div>`,
                interactive: {
                    type: "quiz",
                    question: "Why should you validate a gifted capability before using it?",
                    options: [
                        "To make the code run faster",
                        "To check if it has the permissions you need",
                        "To convert it to a different type",
                        "To copy it to another register"
                    ],
                    correct: 1,
                    feedback: {
                        correct: "Correct! You must verify a capability has the permissions you need before attempting operations that require those permissions.",
                        incorrect: "Not quite. Validation ensures the capability has the permissions required for your intended operations."
                    }
                }
            }
        ]
    },
    {
        title: "Performance Benefits",
        steps: [
            {
                text: `<h3>Why Golden Tokens Improve Performance</h3>
                <p>Traditional systems waste cycles on <strong>security checks at every operation</strong>. CTMM's capability architecture provides performance advantages:</p>
                <ul>
                    <li><strong>Single validation</strong> - Permissions checked once when GT is created, not on every use</li>
                    <li><strong>Hardware-enforced</strong> - No software overhead for access control</li>
                    <li><strong>Direct dispatch</strong> - CALL jumps directly to validated code location</li>
                    <li><strong>No context switches</strong> - Capabilities eliminate kernel trap overhead</li>
                </ul>
                <div class="key-concept">
                    <strong>Key Insight:</strong> Security becomes a compile-time cost, not a runtime cost.
                </div>`,
                demo: `<div class="demo-title">Traditional vs. Capability Access</div>
                <div class="demo-content">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div style="background: var(--bg-tertiary); padding: 0.8rem; border-radius: 6px;">
                            <div style="color: var(--warning); font-weight: bold; margin-bottom: 0.5rem;">Traditional (Slow)</div>
                            <pre style="font-size: 0.75rem; margin: 0;">1. System call trap
2. Check user ID
3. Check ACL table
4. Validate operation
5. Perform access
6. Return to user</pre>
                        </div>
                        <div style="background: var(--bg-tertiary); padding: 0.8rem; border-radius: 6px;">
                            <div style="color: var(--success); font-weight: bold; margin-bottom: 0.5rem;">CTMM (Fast)</div>
                            <pre style="font-size: 0.75rem; margin: 0;">1. LOAD/CALL with GT
   (hardware validates
    permissions in
    single cycle)
2. Done</pre>
                        </div>
                    </div>
                </div>`
            },
            {
                text: `<h3>Why Y-Combinator Is Faster with Golden Tokens</h3>
                <p>In <strong>traditional binary code</strong>, every recursive call requires:</p>
                <ul>
                    <li><strong>Symbol table lookup</strong> - Find "factorial" in memory (10-50 cycles)</li>
                    <li><strong>Permission check</strong> - OS validates caller can execute target (100+ cycles)</li>
                    <li><strong>Stack validation</strong> - Check stack bounds, allocate frame (20+ cycles)</li>
                    <li><strong>Address calculation</strong> - Compute actual jump address (5+ cycles)</li>
                </ul>
                <p>With <strong>Golden Tokens</strong>, recursion is a <em>single hardware instruction</em>:</p>
                <ul>
                    <li><strong>No lookup</strong> - GT contains the code address directly</li>
                    <li><strong>Pre-validated</strong> - Permissions checked when GT was created</li>
                    <li><strong>Hardware stack</strong> - CPU manages frames automatically</li>
                </ul>
                <div class="key-concept" style="border-color: var(--success);">
                    <strong>Result:</strong> 100+ cycles per call → 1-3 cycles per call. For factorial(10), that's 1000+ cycles saved!
                </div>`,
                demo: `<div class="demo-title">Traditional vs CTMM Recursion</div>
                <div class="demo-content">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div style="background: var(--bg-tertiary); padding: 0.8rem; border-radius: 6px;">
                            <div style="color: var(--error); font-weight: bold; margin-bottom: 0.5rem;">Traditional (SLOW)</div>
                            <pre style="font-size: 0.75rem; margin: 0;">call factorial     ; Name lookup
; → Symbol table: "factorial"?
; → Permission: Can I call this?
; → Stack: Is there room?
; → Address: Where is it?
; → FINALLY: Jump to code

; PER CALL: ~150 cycles</pre>
                        </div>
                        <div style="background: var(--bg-tertiary); padding: 0.8rem; border-radius: 6px;">
                            <div style="color: var(--success); font-weight: bold; margin-bottom: 0.5rem;">CTMM + GT (FAST)</div>
                            <pre style="font-size: 0.75rem; margin: 0;">LOAD 0 6 0    ; Get GT (1 cycle)
CALL 0        ; Jump via GT (2 cycles)
; → GT has address + permissions
; → Hardware handles stack
; → Direct jump, no lookup

; PER CALL: ~3 cycles</pre>
                        </div>
                    </div>
                    <p style="margin-top: 0.5rem; color: var(--accent); font-weight: bold;">50x faster recursion!</p>
                </div>`
            },
            {
                text: `<h3>Church Encodings: Data as Code</h3>
                <p>Church Booleans and Numerals represent data as <strong>executable functions</strong>:</p>
                <ul>
                    <li><strong>TRUE</strong> = GT that returns first argument</li>
                    <li><strong>FALSE</strong> = GT that returns second argument</li>
                    <li><strong>Numbers</strong> = GTs that apply a function N times</li>
                </ul>
                <p>Performance benefit: <strong>No type checking overhead</strong>. The GT itself IS the type - calling it performs the correct operation automatically.</p>`,
                demo: `<div class="demo-title">Data = Validated Code</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.8rem;">
; IF-THEN-ELSE with Church Booleans:
; CR0 = bool, CR1 = then, CR2 = else

CALL 0        ; That's it! One instruction.

; bool IS the selector function:
; - If TRUE: returns CR1 (then branch)
; - If FALSE: returns CR2 (else branch)

; No runtime type check needed:
; The GT's existence proves it's valid
; The GT's permissions prove it's safe</pre>
                </div>`
            },
            {
                text: `<h3>Capability Caching</h3>
                <p>Once a GT is loaded into a Context Register, it stays validated:</p>
                <ul>
                    <li><strong>CR6</strong> holds frequently-used GTs (C-List)</li>
                    <li><strong>Repeated calls</strong> reuse the same validated token</li>
                    <li><strong>No re-validation</strong> needed between calls</li>
                </ul>
                <p>This is like having a "fast path" that bypasses all security checks after the first access.</p>`,
                demo: `<div class="demo-title">Factorial Loop Performance</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.8rem;">
; Computing 10! with cached GT:

LOAD 0 6 0    ; Load GT once (validated)

loop:
  ; ... compute step ...
  CALL 0      ; Reuse same GT - instant!
  ; ... 
  B loop      ; No re-validation needed

; 10 recursive calls = 10 CALL instructions
; NOT 10 × (lookup + permission check + ...)
; Speedup: potentially 10-100x</pre>
                </div>`
            },
            {
                text: `<h3>Parallel Execution Potential</h3>
                <p>Because GTs encode complete access rights, the hardware can:</p>
                <ul>
                    <li><strong>Prefetch</strong> - Load target code before CALL completes</li>
                    <li><strong>Speculate</strong> - Begin execution knowing permissions are valid</li>
                    <li><strong>Parallelize</strong> - Independent GTs can execute concurrently</li>
                </ul>
                <p>Traditional systems must serialize through security checkpoints. CTMM's design enables modern CPU optimizations.</p>`,
                demo: `<div class="demo-title">Hardware Optimization</div>
                <div class="demo-content">
                    <div style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px;">
                        <div style="margin-bottom: 0.5rem; font-weight: bold; color: var(--accent);">What the CPU sees:</div>
                        <pre style="font-size: 0.8rem; margin: 0;">
GT = { location: 0x5000, perms: RX, valid: ✓ }

CALL GT →
  ├─ Prefetch code at 0x5000 (parallel)
  ├─ Allocate stack frame (parallel)
  └─ Jump when ready (no wait)</pre>
                    </div>
                </div>`,
                interactive: {
                    type: "quiz",
                    question: "Why is Y-Combinator recursion faster with Golden Tokens?",
                    options: [
                        "GTs use less memory than function pointers",
                        "The recursive GT is pre-validated, eliminating per-call security checks",
                        "Church calculus is inherently faster than imperative code",
                        "CTMM uses a faster CPU clock"
                    ],
                    correct: 1,
                    feedback: {
                        correct: "Correct! The GT contains pre-validated permissions and location, so each recursive CALL is a direct jump without security overhead.",
                        incorrect: "Not quite. The key benefit is that the GT's permissions are validated once at creation time, not on every recursive call."
                    }
                }
            }
        ]
    },
    {
        title: "Remote Golden Tokens",
        steps: [
            {
                text: `<h3>The F Bit: Remote Location Flag</h3>
                <p>The <strong>F (Far) bit</strong> in a Golden Token indicates that the target object resides at a <strong>remote URL</strong> rather than in local memory:</p>
                <ul>
                    <li><strong>F=0</strong>: Local object - Offset indexes the local Namespace Table</li>
                    <li><strong>F=1</strong>: Remote object - Offset indexes a URL Table containing remote endpoints</li>
                </ul>
                <p>This enables <strong>transparent distributed computing</strong> where code doesn't need to know if a capability points to local or remote resources.</p>
                <div class="key-concept">
                    <strong>Key Insight:</strong> The same CALL instruction works for both local and remote objects - the hardware handles the difference.
                </div>`,
                demo: `<div class="demo-title">Local vs. Remote GT</div>
                <div class="demo-content">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div style="background: var(--bg-tertiary); padding: 0.8rem; border-radius: 6px;">
                            <div style="color: var(--accent); font-weight: bold; margin-bottom: 0.5rem;">Local GT (F=0)</div>
                            <pre style="font-size: 0.75rem; margin: 0;">Offset: 0x042
→ Namespace[0x042]
→ Location: 0x5000
→ Direct memory access</pre>
                        </div>
                        <div style="background: var(--bg-tertiary); padding: 0.8rem; border-radius: 6px;">
                            <div style="color: var(--warning); font-weight: bold; margin-bottom: 0.5rem;">Remote GT (F=1)</div>
                            <pre style="font-size: 0.75rem; margin: 0;">Offset: 0x007
→ URLTable[0x007]
→ "https://api.srv/obj"
→ Network request</pre>
                        </div>
                    </div>
                </div>`
            },
            {
                text: `<h3>URL Paging</h3>
                <p><strong>URL Paging</strong> extends virtual memory to the network. Just as traditional paging loads memory pages from disk, CTMM can load capability pages from remote URLs:</p>
                <ul>
                    <li><strong>Page fault</strong> - When accessing a remote GT, the system fetches the page</li>
                    <li><strong>Caching</strong> - Remote pages are cached locally for performance</li>
                    <li><strong>Coherence</strong> - The MAC ensures fetched data hasn't been tampered with</li>
                    <li><strong>Lazy loading</strong> - Remote capabilities are only fetched when first used</li>
                </ul>`,
                demo: `<div class="demo-title">URL Paging Flow</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.8rem;">
LOAD 0 6 5      ; Load GT from C-List[5] (F=1)

Hardware detects F=1:
  1. Check local cache for page
  2. If miss: fetch from URLTable[offset]
     GET https://remote.srv/namespace/page
  3. Validate MAC of received data
  4. Store in local cache
  5. Complete LOAD with cached data

; Subsequent accesses hit cache - no network delay</pre>
                </div>`
            },
            {
                text: `<h3>Remote Proxy Abstractions</h3>
                <p>A <strong>Remote Proxy</strong> is a local GT that represents a remote service. When you CALL a proxy GT, the system:</p>
                <ul>
                    <li><strong>Marshals</strong> arguments from Data Registers</li>
                    <li><strong>Transmits</strong> the request to the remote endpoint</li>
                    <li><strong>Unmarshals</strong> the response back into registers</li>
                </ul>
                <p>The calling code is unaware this happened - it just sees a normal CALL/RETURN.</p>`,
                demo: `<div class="demo-title">Remote Proxy Pattern</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.8rem;">
; CR2 = proxy GT to remote "Calculator" service
; F=1, permissions=[E,X]

ADDI 0 42         ; DR0 = argument (42)
ADDI 1 7          ; DR1 = argument (7)
CALL 2            ; Invoke remote service

; Behind the scenes:
;   → Package: {op: "multiply", args: [42, 7]}
;   → POST https://calc.srv/api
;   → Response: {result: 294}
;   → DR0 = 294

; To the code, it looks like a local call!</pre>
                </div>`
            },
            {
                text: `<h3>Security of Remote GTs</h3>
                <p>Remote capabilities maintain <strong>full security guarantees</strong>:</p>
                <ul>
                    <li><strong>MAC validation</strong> - Every remote response is cryptographically verified</li>
                    <li><strong>Permission enforcement</strong> - Remote server checks GT permissions before executing</li>
                    <li><strong>Capability unforgeable</strong> - Cannot fabricate a remote GT without the server's cooperation</li>
                    <li><strong>Audit trail</strong> - All remote accesses are logged with GT identity</li>
                </ul>
                <div class="key-concept" style="border-color: var(--success);">
                    <strong>Security Guarantee:</strong> A remote GT is as secure as a local GT. The network transport doesn't weaken the capability model.
                </div>`,
                demo: `<div class="demo-title">Remote Security Flow</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.8rem;">
CALL remoteGT

Client side:
  1. Attach GT's MAC to request
  2. Sign with thread's identity (CR8)
  3. Encrypt payload (TLS)

Server side:
  4. Verify MAC matches GT
  5. Check permissions allow operation
  6. Execute if valid
  7. Sign response with server MAC

Client side:
  8. Verify server MAC
  9. Return result to caller

; Tampering at any step = detected & rejected</pre>
                </div>`
            },
            {
                text: `<h3>Performance Considerations</h3>
                <p>Remote GTs introduce <strong>network latency</strong>, but CTMM optimizes this:</p>
                <ul>
                    <li><strong>Aggressive caching</strong> - Immutable objects cached indefinitely</li>
                    <li><strong>Prefetching</strong> - Predict and fetch remote GTs before they're needed</li>
                    <li><strong>Batching</strong> - Multiple remote calls combined into single request</li>
                    <li><strong>Connection pooling</strong> - Reuse connections to same remote host</li>
                </ul>
                <p>The key insight: <strong>capability validation happens once</strong> when the GT is created, not on every remote call.</p>`,
                demo: `<div class="demo-title">Performance Optimization</div>
                <div class="demo-content">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div style="background: var(--bg-tertiary); padding: 0.8rem; border-radius: 6px;">
                            <div style="color: var(--warning); font-weight: bold; margin-bottom: 0.5rem;">Naive Remote (Slow)</div>
                            <pre style="font-size: 0.7rem; margin: 0;">Each call:
  - Open connection
  - Authenticate
  - Send request
  - Wait response
  - Close connection

10 calls = 10× overhead</pre>
                        </div>
                        <div style="background: var(--bg-tertiary); padding: 0.8rem; border-radius: 6px;">
                            <div style="color: var(--success); font-weight: bold; margin-bottom: 0.5rem;">CTMM Remote (Fast)</div>
                            <pre style="font-size: 0.7rem; margin: 0;">First call:
  - Open connection
  - GT = auth token
  
Subsequent:
  - Reuse connection
  - Send request
  - Get response

10 calls ≈ 1× overhead</pre>
                        </div>
                    </div>
                </div>`,
                interactive: {
                    type: "quiz",
                    question: "What does the F bit in a Golden Token indicate?",
                    options: [
                        "The capability has been frozen and cannot be modified",
                        "The target object is at a remote URL, not local memory",
                        "The capability grants full permissions",
                        "The capability is a function, not data"
                    ],
                    correct: 1,
                    feedback: {
                        correct: "Correct! The F (Far) bit indicates the GT points to a remote resource accessed via URL rather than local memory.",
                        incorrect: "Not quite. The F bit distinguishes between local objects (F=0) and remote objects at URLs (F=1)."
                    }
                }
            }
        ]
    },
    {
        title: "Failsafe Security",
        steps: [
            {
                text: `<h3>The Information Leakage Problem</h3>
                <p>Traditional error handling creates <strong>information leakage paths</strong>:</p>
                <ul>
                    <li><strong>Error codes</strong> - Reveal which validation failed</li>
                    <li><strong>Timing differences</strong> - Different checks take different time</li>
                    <li><strong>Exception types</strong> - Distinguish permission vs. bounds errors</li>
                </ul>
                <p>Attackers can <strong>probe the system</strong> with different inputs and learn from varying responses.</p>
                <div class="key-concept" style="border-color: var(--error);">
                    <strong>Security Risk:</strong> Returning -1 for "permission denied" and -2 for "bounds error" tells attackers exactly what to attack next.
                </div>`,
                demo: `<div class="demo-title">Leakage Example (BAD)</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.8rem;">
; INSECURE - leaks information!
TPERM 0 RW
B NE perm_error   ; Return -1

CMP 0 100
B GT bounds_error ; Return -2

; ... operations ...
RETURN

perm_error:
SUBI 0 1          ; DR0 = -1 (LEAKS: permission issue)
RETURN

bounds_error:
SUBI 0 2          ; DR0 = -2 (LEAKS: bounds issue)
RETURN</pre>
                    <p style="color: var(--error); margin-top: 0.5rem;">Attacker learns: "I have permissions but wrong bounds"</p>
                </div>`
            },
            {
                text: `<h3>The Failsafe Solution: Single Failure Mode</h3>
                <p>CTMM's failsafe pattern ensures <strong>all failures look identical</strong>:</p>
                <ul>
                    <li><strong>One handler</strong> - All failures branch to FAULT</li>
                    <li><strong>No codes</strong> - No information returned</li>
                    <li><strong>Same timing</strong> - Constant-time failure path</li>
                    <li><strong>Same behavior</strong> - Identical observable outcome</li>
                </ul>
                <p>The attacker learns only <strong>one bit of information</strong>: success or failure.</p>`,
                demo: `<div class="demo-title">Failsafe Pattern (GOOD)</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.8rem;">
; SECURE - no information leakage
TPERM 0 RW
B NE fault        ; All failures -> same place

CMP 0 100
B GT fault        ; All failures -> same place

; ... operations ...
RETURN

; Single failure mode
fault:
FAULT             ; Uniform - attacker learns nothing</pre>
                    <p style="color: var(--success); margin-top: 0.5rem;">Attacker learns: "Something failed" (nothing more)</p>
                </div>`
            },
            {
                text: `<h3>Access.asm: Generic Validation</h3>
                <p><strong>Access.asm</strong> is the standard entry point for validating inputs:</p>
                <ul>
                    <li>Checks <strong>capability permissions</strong> with TPERM</li>
                    <li>Checks <strong>data bounds</strong> with CMP</li>
                    <li>All failures branch to <strong>fault:</strong></li>
                    <li>Only proceeds if <strong>ALL</strong> checks pass</li>
                </ul>
                <p>Use Access.asm as a template for all protected entry points.</p>`,
                demo: `<div class="demo-title">Access.asm Structure</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.8rem;">
; === CAPABILITY VALIDATION ===
TPERM 0 RW        ; Required permissions
B NE fault

TPERM 0 B         ; Additional permission
B NE fault

; === DATA VALIDATION ===
CMP 0 0           ; Non-negative?
B MI fault

CMP 0 1           ; Within max?
B GT fault

; === ALL PASSED - PROCEED ===
LOAD 1 0 0        ; Safe to use
RETURN

fault:
FAULT             ; Single failure mode</pre>
                </div>`
            },
            {
                text: `<h3>FirstFault.asm: Uniform Recovery</h3>
                <p><strong>FirstFault.asm</strong> handles all faults uniformly:</p>
                <ul>
                    <li><strong>Clears all Data Registers</strong> - No computed values leak</li>
                    <li><strong>Clears sensitive Context Registers</strong> - No capabilities leak</li>
                    <li><strong>Preserves audit info</strong> - CR8 (thread) for logging</li>
                    <li><strong>Returns to Nucleus</strong> - Trusted handler decides next step</li>
                </ul>
                <p>The Nucleus logs WHO faulted and WHEN, but <strong>never WHY</strong>.</p>`,
                demo: `<div class="demo-title">FirstFault.asm Flow</div>
                <div class="demo-content">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div style="background: var(--bg-tertiary); padding: 0.8rem; border-radius: 6px;">
                            <div style="color: var(--accent); font-weight: bold; margin-bottom: 0.5rem;">Cleared (Security)</div>
                            <pre style="font-size: 0.75rem; margin: 0;">DR0-DR7 = 0
CR0-CR5 = NULL</pre>
                        </div>
                        <div style="background: var(--bg-tertiary); padding: 0.8rem; border-radius: 6px;">
                            <div style="color: var(--success); font-weight: bold; margin-bottom: 0.5rem;">Preserved (Audit)</div>
                            <pre style="font-size: 0.75rem; margin: 0;">CR7 = Nucleus
CR8 = Thread (WHO)
CR15 = Namespace</pre>
                        </div>
                    </div>
                </div>`
            },
            {
                text: `<h3>The Failsafe Principle</h3>
                <p>Kenneth Hamer-Hodges' design follows the <strong>"fail safe, fail secure"</strong> principle:</p>
                <ul>
                    <li><strong>Deny by default</strong> - If anything is wrong, deny everything</li>
                    <li><strong>Reveal nothing</strong> - Failures give no diagnostic information</li>
                    <li><strong>Audit internally</strong> - Log for administrators, not attackers</li>
                    <li><strong>Recover cleanly</strong> - Clear state and restart from known-good</li>
                </ul>
                <div class="key-concept" style="border-color: var(--success);">
                    <strong>Remember:</strong> Security is measured by what attackers CANNOT learn, not what the system CAN do.
                </div>`,
                demo: `<div class="demo-title">Failsafe Design Summary</div>
                <div class="demo-content">
                    <div style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px;">
                        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                            <div style="display: flex; align-items: center; gap: 0.5rem;">
                                <span style="color: var(--success);">✓</span>
                                <span>TPERM → FAULT (no error codes)</span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 0.5rem;">
                                <span style="color: var(--success);">✓</span>
                                <span>CMP → FAULT (same handler)</span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 0.5rem;">
                                <span style="color: var(--success);">✓</span>
                                <span>FirstFault clears all state</span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 0.5rem;">
                                <span style="color: var(--success);">✓</span>
                                <span>Nucleus logs WHO, WHEN (not WHY)</span>
                            </div>
                        </div>
                    </div>
                </div>`,
                interactive: {
                    type: "quiz",
                    question: "Why should ALL validation failures go to the same FAULT handler?",
                    options: [
                        "It makes the code shorter and easier to read",
                        "It prevents information leakage about which check failed",
                        "It runs faster than multiple error handlers",
                        "It saves memory by having only one handler"
                    ],
                    correct: 1,
                    feedback: {
                        correct: "Correct! A single failure mode prevents attackers from learning which validation check failed, closing an information leakage path.",
                        incorrect: "Not quite. The primary security benefit is preventing attackers from learning which specific check failed."
                    }
                }
            }
        ]
    },
    {
        title: "Church Instructions Deep Dive",
        steps: [
            {
                text: `<h3>Church Instructions Overview</h3>
                <p>The <strong>Church instructions</strong> are the capability-manipulation half of the CTMM instruction set. Named after Alonzo Church, they embody the <strong>lambda calculus</strong> philosophy: everything is a function reference (capability).</p>
                <p>There are <strong>6 Church instructions</strong> and an additional test instruction (<strong>TPERM</strong> - Test the permission and scope of a Golden Token):</p>
                <ul>
                    <li><strong>LOAD</strong> - Read a Golden Token from memory into a Context Register</li>
                    <li><strong>SAVE</strong> - Write a Golden Token from a Context Register to memory</li>
                    <li><strong>CALL</strong> - Invoke code referenced by a Golden Token</li>
                    <li><strong>RETURN</strong> - Return from invoked code to the caller</li>
                    <li><strong>CHANGE</strong> - Switch to a different C-List (capability context)</li>
                    <li><strong>SWITCH</strong> - Switch to a different thread identity</li>
                </ul>
                <div class="key-concept">
                    <strong>Key Insight:</strong> Church instructions operate on <em>capabilities</em> (GTs), not raw data. Every memory access, every function call, every context switch requires a valid GT.
                </div>`,
                demo: `<div class="demo-title">Church vs Turing Machines interwork through the Lambda Calculus Meta-Machine as a CTMM</div>
                <div class="demo-content">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div style="background: var(--bg-tertiary); padding: 0.8rem; border-radius: 6px;">
                            <div style="color: var(--accent); font-weight: bold; margin-bottom: 0.5rem;">Church Instructions operate on Golden Tokens (Capabilities)</div>
                            <pre style="font-size: 0.75rem; margin: 0;">LOAD  - Get capability
SAVE  - Store capability
CALL  - Invoke via capability
RETURN - Return control
CHANGE - Switch C-List
SWITCH - Switch thread
TPERM - Test permissions and scope</pre>
                        </div>
                        <div style="background: var(--bg-tertiary); padding: 0.8rem; border-radius: 6px;">
                            <div style="color: var(--success); font-weight: bold; margin-bottom: 0.5rem;">Turing Instructions operate on binary computation on data</div>
                            <pre style="font-size: 0.75rem; margin: 0;">ADD, SUB, MUL, DIV
AND, OR, XOR, NOT
LSL, LSR, ROR
CMP, CMN, TST
B, BL, BX
MOV, ADDI, SUBI</pre>
                        </div>
                    </div>
                </div>`
            },
            {
                text: `<h3>LOAD: Retrieving Golden Tokens</h3>
                <p>The <strong>LOAD</strong> instruction reads a Golden Token from memory (via a capability) into a Context Register.</p>
                <p><strong>What happens during LOAD:</strong></p>
                <ol>
                    <li><strong>Permission Check</strong> - Source GT must have Load (L) permission</li>
                    <li><strong>Bounds Check</strong> - Index must be within the object's Limit</li>
                    <li><strong>MAC Validation</strong> - Hardware verifies the stored GT's integrity</li>
                    <li><strong>Copy to CR</strong> - The GT is copied to the destination Context Register</li>
                </ol>
                <p>If <strong>any check fails</strong>, the instruction triggers a FAULT - no partial results, no error codes.</p>
                <div class="key-concept" style="border-color: var(--warning);">
                    <strong>Security Note:</strong> You cannot LOAD a capability unless you already have a C-List that grants Load access. This is the foundation of capability-based security throughout the Namespace hierarchal DNA structure. To prevent malware, the DNA locks out of the Namespace all unknown objects and limits network browsing to read-only data and Scripts that lack Namespace capability privileges.
                </div>`,
                demo: `<div class="demo-title">LOAD Instruction Examples</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.8rem;">
; Syntax: LOAD dest, source, index
; dest   = destination CR (0-15)
; source = source CR containing GT (0-15)
; index  = offset within object (0-8191 immediate or DR)

; Register addressing (I=0):
LOAD 0 6 0      ; CR0 = memory[CR6 + DR0]
                ; Load GT from C-List at DR0 offset

; Immediate addressing (I=1):
LOAD 0 6 3      ; CR0 = memory[CR6 + 3]
                ; Load GT from C-List entry 3

; Common patterns:
LOAD 0 6 0      ; Get first C-List entry
LOAD 1 15 0    ; Get from Namespace root
LOAD 2 7 5      ; Get from Nucleus entry 5</pre>
                </div>`
            },
            {
                text: `<h3>SAVE: Storing Golden Tokens</h3>
                <p>The <strong>SAVE</strong> instruction writes a Golden Token from a Context Register into the Namespace hierarchy, thereby changing the application's persistent DNA. Used to remember dynamically created or granted objects.</p>
                <p><strong>What happens during SAVE:</strong></p>
                <ol>
                    <li><strong>Permission Check</strong> - Destination GT must be a C-List with Save (S) permission</li>
                    <li><strong>Bounds Check</strong> - Index must be within the object's size Limit</li>
                    <li><strong>B-bit Check</strong> - The source GT to be saved must have the B (Bind) bit. If not set, it cannot be saved, preventing theft of a capability when dynamically sharing a GT. It is bound to the CRn of the dynamic thread and is automatically surrendered when the RETURN occurs.</li>
                    <li><strong>MAC Update</strong> - The MAC for stored GT is unchanged</li>
                    <li><strong>Write to Memory</strong> - The GT is stored at the C-List destination offset if Save permission exists</li>
                </ol>
                <p><strong>Permission Inheritance:</strong> The saved GT retains its original permissions - SAVE doesn't amplify rights.</p>`,
                demo: `<div class="demo-title">SAVE Instruction Examples</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.8rem;">
; Syntax: SAVE dest, source, index
; dest   = destination C-List allowing Save
; source = source CRn containing GT to be saved with B (Bind) set
; index  = offset within the destination object <= size

; Store GT from CR0 into C-List entry 5:
SAVE CR[source] CR[dest] 5

; Build a new C-List by storing capabilities:
; (allocate new C-List GT)
SAVE 0 1 0      ; Store CR1 as entry 0
; Now CR0 is a C-List with 1 new entry

; SECURITY: Cannot save a GT without bind allowed (B=true)</pre>
                </div>`
            },
            {
                text: `<h3>CALL: Invoking Lambda Calculus function abstractions</h3>
                <p>The <strong>CALL</strong> instruction is the heart of CTMM threaded execution. A Thread is a secure, private execution through the application Namespace with confidential variables (both GT and data). It transfers control to helper functions (code) specified by a Golden Token that identifies a node in the application's DNA hierarchy.</p>
                <p><strong>What happens during CALL:</strong></p>
                <ol>
                    <li><strong>Permission Check</strong> - GT[source] must have Enter (E) permission</li>
                    <li><strong>Push Return Frame</strong> - Current CR7, PI as offset, CR6 (nodal C-List), + indicator flags saved to hardware-managed Thread stack (LIFO)</li>
                    <li><strong>Prevent Information Leakage</strong> - Use the identified Mask field to reset and clear all identified data registers and additional context registers not identified as valid API variables</li>
                    <li><strong>Load New Abstraction Context</strong> - Use LOAD GT Microcode to unlock new CR6 nodal C-List and set M=true, retrieve GT and offset zero</li>
                    <li><strong>Load New Function Context</strong> - Use LOAD GT Microcode to unlock new CR7 Access Code and set PI offset to zero</li>
                    <li><strong>Begin Execution</strong> - Resume Thread in a new isolated context and a new function as a new private context</li>
                </ol>`,
                demo: `<div class="demo-title">CALL Instruction Examples</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.8rem;">
; Syntax: CALL source
; source = CR containing executable GT (0-15)

; Basic CALL:
LOAD 0 6 5      ; CR0 = function GT from C-List[5]
CALL 0          ; Execute function, will RETURN here

; CALL with arguments (in Data Registers):
ADDI 0 42       ; DR0 = argument 1
ADDI 1 7        ; DR1 = argument 2
LOAD 2 6 3      ; CR2 = "multiply" function GT
CALL 2          ; DR0 = result after RETURN

; Y-Combinator self-call:
LOAD 0 6 0      ; CR0 = GT pointing to THIS code
CALL 0          ; Recursive self-invocation

; CALL to abstraction (math operation):
LOAD 0 6 4      ; CR0 = Abacus (integer math) GT
CALL 0          ; Hardware integer operation</pre>
                </div>`
            },
            {
                text: `<h3>RETURN: Completing Invocations</h3>
                <p>The <strong>RETURN</strong> instruction reverses a CALL, returning control to the caller.</p>
                <p><strong>What happens during RETURN:</strong></p>
                <ol>
                    <li><strong>Pop Return Frame</strong> - Retrieve saved PI, CR6, CR7, and flags from hardware stack</li>
                    <li><strong>Restore Context</strong> - Reset CR6 to caller's nodal C-List, CR7 to caller's Access Code</li>
                    <li><strong>Surrender Bound GTs</strong> - Any GTs with boundDuringCall flag are automatically released (B-bit enforcement)</li>
                    <li><strong>Resume Execution</strong> - Continue at instruction after the CALL</li>
                </ol>
                <p><strong>Return Values:</strong> By convention, results are left in DR0 (data) or CR0 (capability). The called function sets these before RETURN.</p>
                <div class="key-concept">
                    <strong>Hardware Stack:</strong> CTMM uses a hardware-managed return stack, not software. This prevents stack smashing attacks - you cannot overwrite return addresses.
                </div>`,
                demo: `<div class="demo-title">RETURN Instruction Examples</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.8rem;">
; Syntax: RETURN
; No arguments - pops from hardware stack

; Basic function pattern:
my_function:
  ; ... do work ...
  MOV 0 5         ; DR0 = result (e.g., 5)
  RETURN          ; Return to caller

; Caller sees:
CALL 0            ; Invoke my_function
; DR0 now contains 5

; Returning a capability:
get_capability:
  LOAD 0 6 3      ; CR0 = some GT
  RETURN          ; Caller receives GT in CR0

; Conditional return:
  CMP 0 0
  B EQ done       ; If DR0 == 0, skip to done
  ; ... more work ...
done:
  RETURN          ; Always reaches here</pre>
                </div>`
            },
            {
                text: `<h3>CHANGE: Switching C-Lists</h3>
                <p>The <strong>CHANGE</strong> instruction switches the current C-List (CR6) to a different capability context.</p>
                <p><strong>What happens during CHANGE:</strong></p>
                <ol>
                    <li><strong>Permission Check</strong> - New C-List GT must have appropriate access</li>
                    <li><strong>Validate C-List</strong> - Target must be a valid C-List structure</li>
                    <li><strong>Update CR6</strong> - CR6 now points to the new C-List</li>
                </ol>
                <p><strong>Use Cases:</strong></p>
                <ul>
                    <li>Entering a <strong>sandbox</strong> with restricted capabilities</li>
                    <li>Switching to a <strong>library's</strong> private capability set</li>
                    <li>Implementing <strong>least privilege</strong> by narrowing available GTs</li>
                </ul>`,
                demo: `<div class="demo-title">CHANGE Instruction Examples</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.8rem;">
; Syntax: CHANGE source
; source = CR containing new C-List GT (0-15)

; Switch to a restricted C-List:
LOAD 0 6 10     ; CR0 = restricted C-List GT
CHANGE 0        ; CR6 = CR0 (now using restricted set)
; ... operate with fewer capabilities ...

; Common pattern - sandbox execution:
LOAD 0 6 8      ; CR0 = sandbox C-List
SAVE 6 1 0      ; Save code GT in sandbox
CHANGE 0        ; Enter sandbox
LOAD 0 6 0      ; Load code from sandbox C-List
CALL 0          ; Execute with limited rights
; On RETURN, CR6 is restored to original

; Direct addressing (Mode=0):
CHANGE 5        ; CR6 = CR5

; C-List lookup (Mode=1):
CHANGE 5        ; CR6 = memory[CR6 + 5]</pre>
                </div>`
            },
            {
                text: `<h3>SWITCH: Changing Thread Identity</h3>
                <p>The <strong>SWITCH</strong> instruction changes the current thread identity (CR8).</p>
                <p><strong>What happens during SWITCH:</strong></p>
                <ol>
                    <li><strong>Permission Check</strong> - Caller must have M (Meta) permission on target</li>
                    <li><strong>Validate Thread GT</strong> - Target must be a valid Thread capability</li>
                    <li><strong>Update CR8</strong> - Current thread identity changes</li>
                </ol>
                <p><strong>Why this matters:</strong> CR8 identifies WHO is executing code. Audit logs use CR8. Permission checks reference CR8. SWITCH enables:</p>
                <ul>
                    <li><strong>Impersonation</strong> - Acting on behalf of another user (with permission)</li>
                    <li><strong>Service accounts</strong> - Background tasks with specific identity</li>
                    <li><strong>Privilege escalation</strong> (controlled) - Temporarily gaining rights</li>
                </ul>`,
                demo: `<div class="demo-title">SWITCH Instruction Examples</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.8rem;">
; Syntax: SWITCH source
; source = CR containing new Thread GT (0-15)

; Switch to service account:
LOAD 0 7 3      ; CR0 = service thread GT from Nucleus
TPERM 0 M       ; Verify we have Meta permission
B NE fault      ; Fail if not authorized
SWITCH 0        ; CR8 = service thread
; ... now executing as service account ...

; Return to original identity (if saved):
SWITCH 5        ; CR8 = saved original thread in CR5

; Common pattern - sudo-like:
SAVE 6 8 0      ; Save current thread GT
SWITCH 0        ; Become admin
CALL 1          ; Do privileged operation
LOAD 5 6 0      ; Restore original thread GT
SWITCH 5        ; Become original user again</pre>
                </div>`
            },
            {
                text: `<h3>TPERM: Testing Permissions</h3>
                <p>The <strong>TPERM</strong> instruction tests whether a Golden Token has specific permission bits set.</p>
                <p><strong>What happens during TPERM:</strong></p>
                <ol>
                    <li><strong>Read Permissions</strong> - Extract permission bits from the GT</li>
                    <li><strong>Compare with Mask</strong> - Check if required bits are set</li>
                    <li><strong>Set Condition Flags</strong> - Z=1 if ALL required permissions present</li>
                </ol>
                <p><strong>Permission Bits:</strong></p>
                <ul>
                    <li><strong>R</strong> (Read) - Can read data through this GT</li>
                    <li><strong>W</strong> (Write) - Can write data through this GT</li>
                    <li><strong>X</strong> (Execute) - Can CALL this GT</li>
                    <li><strong>L</strong> (Lock) - Cannot be copied (SAVE fails)</li>
                    <li><strong>S</strong> (Seal) - Object is sealed (immutable)</li>
                    <li><strong>E</strong> (Extend) - Can create child capabilities</li>
                    <li><strong>B</strong> (Bounds) - Has restricted bounds</li>
                    <li><strong>M</strong> (Meta) - Hardware-level permissions</li>
                </ul>`,
                demo: `<div class="demo-title">TPERM Instruction Examples</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.8rem;">
; Syntax: TPERM source, permissions
; source = CR containing GT to test (0-15)
; permissions = bit mask (R, W, X, L, S, E, B, M)

; Test for read permission:
TPERM 0 R         ; Test if CR0 has Read
B NE fault        ; Fail if not readable

; Test for read AND write:
TPERM 0 RW        ; Test if CR0 has both R and W
B NE fault        ; Fail if either missing

; Test for execute permission:
TPERM 0 X         ; Is CR0 executable?
B EQ can_call     ; Yes - proceed to CALL
B NE fault        ; No - failsafe

; Failsafe pattern (always use this):
TPERM 0 RW
B NE fault
TPERM 0 B
B NE fault
; ... all checks passed, proceed ...</pre>
                </div>`
            },
            {
                text: `<h3>Church Instructions Summary</h3>
                <p>The <strong>6 Church instructions</strong> plus TPERM form a complete <strong>capability manipulation language</strong>:</p>
                <div class="key-concept" style="border-color: var(--accent);">
                    <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
                        <tr style="border-bottom: 1px solid var(--border);">
                            <td style="padding: 0.3rem 0;"><strong>LOAD</strong></td>
                            <td>Memory → Register (read capability, requires L permission)</td>
                        </tr>
                        <tr style="border-bottom: 1px solid var(--border);">
                            <td style="padding: 0.3rem 0;"><strong>SAVE</strong></td>
                            <td>Register → Memory (write capability, requires S on dest, B on source)</td>
                        </tr>
                        <tr style="border-bottom: 1px solid var(--border);">
                            <td style="padding: 0.3rem 0;"><strong>CALL</strong></td>
                            <td>Enter function via capability (requires E, loads CR6/CR7)</td>
                        </tr>
                        <tr style="border-bottom: 1px solid var(--border);">
                            <td style="padding: 0.3rem 0;"><strong>RETURN</strong></td>
                            <td>Return from CALL (restores CR6/CR7, surrenders bound GTs)</td>
                        </tr>
                        <tr style="border-bottom: 1px solid var(--border);">
                            <td style="padding: 0.3rem 0;"><strong>CHANGE</strong></td>
                            <td>Switch capability context (C-List)</td>
                        </tr>
                        <tr style="border-bottom: 1px solid var(--border);">
                            <td style="padding: 0.3rem 0;"><strong>SWITCH</strong></td>
                            <td>Change thread identity</td>
                        </tr>
                        <tr>
                            <td style="padding: 0.3rem 0;"><strong>TPERM</strong></td>
                            <td>Test permission bits and scope (test instruction)</td>
                        </tr>
                    </table>
                </div>
                <p>Together with the Turing instructions (arithmetic, logic, branching), these form the complete CTMM instruction set.</p>`,
                demo: `<div class="demo-title">Complete Program Example</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.75rem;">
; Secure function that validates, computes, and returns

; 1. Validate input capability
TPERM 0 RX        ; Need Read and Execute
B NE fault

; 2. Load data through capability
LOAD 1 0 0        ; CR1 = first entry

; 3. Compute (Turing instructions)
ADDI 0 10         ; DR0 = 10
MUL 0 1           ; DR0 = DR0 * DR1

; 4. Store result through capability
TPERM 2 W         ; Need Write on output
B NE fault
SAVE 2 0 0        ; Store result

; 5. Return to caller
RETURN

fault:
FAULT             ; Uniform failure</pre>
                </div>`,
                interactive: {
                    type: "quiz",
                    question: "Which Church instruction transfers control to an abstraction?",
                    options: [
                        "LOAD - loads capabilities from memory",
                        "SAVE - stores capabilities to memory",
                        "CALL - invokes abstraction with E permission",
                        "CHANGE - switches thread identity"
                    ],
                    correct: 2,
                    feedback: {
                        correct: "Correct! CALL is the instruction that transfers control to abstractions. It requires the E (Enter) permission on the target GT.",
                        incorrect: "Not quite. CALL is the instruction for invoking abstractions. LOAD/SAVE move GTs, and CHANGE switches thread identity."
                    }
                }
            }
        ]
    }
];

function loadLesson(lessonIndex) {
    tutorialState.currentLesson = lessonIndex;
    tutorialState.currentStep = 0;
    
    // Sync dropdown
    const select = document.getElementById('lessonSelect');
    if (select) select.value = lessonIndex;
    
    renderCurrentStep();
}

function renderCurrentStep() {
    const lesson = lessons[tutorialState.currentLesson];
    if (!lesson) {
        console.error('Invalid lesson index:', tutorialState.currentLesson);
        return;
    }
    
    const step = lesson.steps[tutorialState.currentStep];
    if (!step) {
        console.error('Invalid step index:', tutorialState.currentStep, 'for lesson', tutorialState.currentLesson);
        return;
    }
    
    const lessonKey = `tutorial_${tutorialState.currentLesson}_${tutorialState.currentStep}`;
    const savedEdits = JSON.parse(localStorage.getItem('tutorialEdits') || '{}');
    
    const lessonTextEl = document.getElementById('lessonText');
    const lessonDemoEl = document.getElementById('lessonDemo');
    
    lessonTextEl.innerHTML = savedEdits[lessonKey + '_text'] || step.text || '';
    lessonDemoEl.innerHTML = savedEdits[lessonKey + '_demo'] || step.demo || '';
    
    lessonTextEl.contentEditable = 'true';
    lessonDemoEl.contentEditable = 'true';
    
    lessonTextEl.addEventListener('input', () => tutorialState.hasUnsavedChanges = true);
    lessonDemoEl.addEventListener('input', () => tutorialState.hasUnsavedChanges = true);
    
    const interactiveContainer = document.getElementById('lessonInteractive');
    if (step.interactive) {
        renderInteractive(step.interactive, interactiveContainer);
    } else {
        interactiveContainer.innerHTML = '';
    }
    
    // Update step indicator
    const stepIndicator = document.getElementById('stepIndicator');
    if (stepIndicator) {
        stepIndicator.textContent = `Step ${tutorialState.currentStep + 1} of ${lesson.steps.length}`;
    }
    
    // Update button states
    const prevBtn = document.getElementById('prevStepBtn');
    const nextBtn = document.getElementById('nextStepBtn');
    if (prevBtn) prevBtn.disabled = tutorialState.currentStep === 0;
    if (nextBtn) nextBtn.disabled = tutorialState.currentStep >= lesson.steps.length - 1;
    
    tutorialState.hasUnsavedChanges = false;
    updateTutorialSaveButton();
}

function tutorialPrevStep() {
    if (tutorialState.currentStep > 0) {
        tutorialState.currentStep--;
        renderCurrentStep();
    }
}

function tutorialNextStep() {
    const lesson = lessons[tutorialState.currentLesson];
    if (lesson && tutorialState.currentStep < lesson.steps.length - 1) {
        tutorialState.currentStep++;
        renderCurrentStep();
    }
}

function saveTutorialEdits() {
    const lessonKey = `tutorial_${tutorialState.currentLesson}_${tutorialState.currentStep}`;
    const savedEdits = JSON.parse(localStorage.getItem('tutorialEdits') || '{}');
    
    const lessonTextEl = document.getElementById('lessonText');
    const lessonDemoEl = document.getElementById('lessonDemo');
    
    savedEdits[lessonKey + '_text'] = lessonTextEl.innerHTML;
    savedEdits[lessonKey + '_demo'] = lessonDemoEl.innerHTML;
    
    localStorage.setItem('tutorialEdits', JSON.stringify(savedEdits));
    tutorialState.hasUnsavedChanges = false;
    updateTutorialSaveButton();
    
    log('Tutorial edits saved', 'success');
}

function resetTutorialStep() {
    const lessonKey = `tutorial_${tutorialState.currentLesson}_${tutorialState.currentStep}`;
    const savedEdits = JSON.parse(localStorage.getItem('tutorialEdits') || '{}');
    
    delete savedEdits[lessonKey + '_text'];
    delete savedEdits[lessonKey + '_demo'];
    
    localStorage.setItem('tutorialEdits', JSON.stringify(savedEdits));
    tutorialState.hasUnsavedChanges = false;
    
    renderCurrentStep();
    log('Tutorial step reset to original', 'info');
}

function updateTutorialSaveButton() {
    const saveBtn = document.getElementById('saveTutorialBtn');
    if (saveBtn) {
        if (tutorialState.hasUnsavedChanges) {
            saveBtn.classList.add('has-changes');
            saveBtn.textContent = 'Save Edits *';
        } else {
            saveBtn.classList.remove('has-changes');
            saveBtn.textContent = 'Save Edits';
        }
    }
}

function exportAllTutorials() {
    const savedEdits = JSON.parse(localStorage.getItem('tutorialEdits') || '{}');
    
    const exportData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        lessonTitles: lessons.map(l => l.title),
        edits: savedEdits
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ctmm-tutorials-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    log('Tutorial edits exported', 'success');
}

function importAllTutorials(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const importData = JSON.parse(e.target.result);
            
            if (!importData.edits) {
                log('Invalid tutorial file format', 'error');
                return;
            }
            
            localStorage.setItem('tutorialEdits', JSON.stringify(importData.edits));
            renderCurrentStep();
            log(`Imported ${Object.keys(importData.edits).length / 2} tutorial edits`, 'success');
        } catch (err) {
            log('Failed to parse tutorial file', 'error');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
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


function completeLesson() {
    tutorialState.completedLessons.add(tutorialState.currentLesson);
    
    // Advance to next lesson if not at end
    if (tutorialState.currentLesson < lessons.length - 1) {
        loadLesson(tutorialState.currentLesson + 1);
    }
}

function tryInSimulator() {
    switchView('dashboard');
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
    localStorage.setItem('ctmm_namespace_state', JSON.stringify(state));
}

function loadFromStorage() {
    try {
        const saved = localStorage.getItem('ctmm_namespace_state');
        if (saved) {
            const state = JSON.parse(saved);
            dynamicObjects = state.dynamicObjects || [];
            dynamicCLists = state.dynamicCLists || {};
            nextAddress = state.nextAddress || 0x8000;
            
            // Normalize permissions on dynamic objects (enforces all validation rules)
            dynamicObjects.forEach(obj => {
                if (obj.perms) {
                    obj.perms = normalizePermissions(obj.perms);
                }
            });
            
            // Normalize C-List permissions
            Object.keys(dynamicCLists).forEach(key => {
                if (dynamicCLists[key] && dynamicCLists[key].forEach) {
                    dynamicCLists[key].forEach(entry => {
                        if (entry.perms) {
                            entry.perms = normalizePermissions(entry.perms);
                        }
                    });
                }
            });
            
            if (state.namespaceModifications) {
                state.namespaceModifications.forEach(mod => {
                    const obj = namespaceObjects.find(o => o.name === mod.name);
                    if (obj) {
                        obj.type = mod.type;
                        obj.size = mod.size;
                        obj.perms = normalizePermissions(mod.perms || []);
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
    localStorage.removeItem('ctmm_namespace_state');
    dynamicObjects = [];
    dynamicCLists = {};
    nextAddress = 0x8000;
    log('Cleared stored namespace state', 'info');
}

function exportNamespaceState() {
    const state = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        dynamicObjects,
        dynamicCLists,
        nextAddress,
        namespaceObjects: namespaceObjects.map(o => ({
            name: o.name,
            type: o.type,
            size: o.size,
            perms: o.perms,
            address: o.address
        })),
        simulatorState: {
            contextRegs: simulator.contextRegs,
            dataRegs: simulator.dataRegs,
            flags: simulator.flags,
            ip: simulator.ip,
            bootStep: simulator.bootStep
        }
    };
    
    const jsonString = JSON.stringify(state, (key, value) => 
        typeof value === 'bigint' ? value.toString() + 'n' : value
    , 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ctmm_state_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    log('Exported namespace state to file', 'success');
}

function importNamespaceState(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const state = JSON.parse(e.target.result);
            
            // Normalize permissions on imported dynamic objects
            if (state.dynamicObjects) {
                state.dynamicObjects.forEach(obj => {
                    if (obj.perms) obj.perms = normalizePermissions(obj.perms);
                });
                dynamicObjects = state.dynamicObjects;
            }
            
            // Normalize permissions on imported C-Lists
            if (state.dynamicCLists) {
                Object.keys(state.dynamicCLists).forEach(key => {
                    if (state.dynamicCLists[key] && state.dynamicCLists[key].forEach) {
                        state.dynamicCLists[key].forEach(entry => {
                            if (entry.perms) entry.perms = normalizePermissions(entry.perms);
                        });
                    }
                });
                dynamicCLists = state.dynamicCLists;
            }
            
            if (state.nextAddress) nextAddress = state.nextAddress;
            
            if (state.namespaceObjects) {
                state.namespaceObjects.forEach(mod => {
                    const obj = namespaceObjects.find(o => o.name === mod.name);
                    if (obj) {
                        obj.type = mod.type;
                        obj.size = mod.size;
                        obj.perms = normalizePermissions(mod.perms || []);
                    }
                });
            }
            saveToStorage();
            renderNamespaceBrowser();
            log('Imported namespace state from file', 'success');
        } catch (err) {
            log('Failed to import state: ' + err.message, 'error');
        }
    };
    reader.readAsText(file);
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
    if (e.target && e.target.closest && !e.target.closest('.context-menu')) {
        hideContextMenu();
    }
});

document.addEventListener('contextmenu', function(e) {
    if (e.target && e.target.closest && !e.target.closest('.ns-object') && !e.target.closest('.hier-item')) {
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
    
    ['R', 'W', 'X', 'L', 'S', 'E', 'B', 'M'].forEach(p => {
        const el = document.getElementById(`modalPerm${p}`);
        if (el) el.checked = (p === 'R');
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
    const descField = document.getElementById('modalObjDesc');
    if (descField) descField.value = obj.description || obj.tooltip || '';
    document.getElementById('modalObjType').value = obj.type;
    document.getElementById('modalObjSize').value = obj.size.toString();
    
    updatePermissionsForType(obj.type);
    
    ['R', 'W', 'X', 'L', 'S', 'E', 'B', 'M'].forEach(p => {
        const checkbox = document.getElementById(`modalPerm${p}`);
        if (checkbox && !checkbox.disabled) {
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

// ==================== ADD/DELETE CAPABILITY FUNCTIONS ====================

let pendingDeleteIndex = -1;
let pendingDeleteName = '';
let pendingDeleteType = 'capability'; // 'capability' or 'object'

function showAddCapabilityModal() {
    contextMenuState.editMode = false;
    document.getElementById('modalTitle').textContent = 'Add New Capability';
    document.getElementById('objectModal').querySelector('.modal-btn-confirm').textContent = 'Create';
    
    // Reset form
    document.getElementById('modalObjName').value = '';
    const descField = document.getElementById('modalObjDesc');
    if (descField) descField.value = '';
    document.getElementById('modalObjType').value = 'Data';
    document.getElementById('modalObjSize').value = '1024';
    
    // Reset permissions based on type
    updatePermissionsForType('Data');
    
    // Set default permissions
    ['R', 'W', 'X', 'L', 'S', 'E', 'B', 'M'].forEach(p => {
        const checkbox = document.getElementById(`modalPerm${p}`);
        if (checkbox) {
            checkbox.checked = (p === 'R'); // Only R checked by default
        }
    });
    
    populateParentSelect();
    document.getElementById('modalParent').value = 'Boot';
    
    document.getElementById('objectModal').classList.add('visible');
}

function showDeleteCapabilityModal(clistIndex, capName) {
    pendingDeleteIndex = clistIndex;
    pendingDeleteName = capName;
    
    document.getElementById('deleteCapName').textContent = capName;
    
    // Analyze impact
    const impactList = document.getElementById('deleteImpactList');
    impactList.innerHTML = '';
    
    const impacts = analyzeDeleteImpact(clistIndex, capName);
    
    if (impacts.length === 0) {
        impactList.innerHTML = '<li>No dependencies found. Safe to delete.</li>';
    } else {
        impacts.forEach(impact => {
            const li = document.createElement('li');
            li.textContent = impact.message;
            li.className = impact.severity === 'danger' ? 'impact-danger' : 'impact-warning';
            impactList.appendChild(li);
        });
    }
    
    document.getElementById('deleteModal').classList.add('visible');
}

function analyzeDeleteImpact(clistIndex, capName) {
    const impacts = [];
    const cap = simulator.clist[clistIndex];
    
    if (!cap) return impacts;
    
    // Check if loaded in any context register
    for (let i = 0; i < 16; i++) {
        const reg = getContextRegister(i);
        if (reg && reg.name === capName) {
            impacts.push({
                message: `Loaded in CR${i} - will be unloaded`,
                severity: 'warning'
            });
        }
    }
    
    // Check if it's a special register
    if (simulator.cr15 && simulator.cr15.name === capName) {
        impacts.push({
            message: 'This is the Namespace root (CR15) - cannot delete',
            severity: 'danger'
        });
    }
    
    if (simulator.cr8 && simulator.cr8.name === capName) {
        impacts.push({
            message: 'This is the active Thread (CR8) - cannot delete',
            severity: 'danger'
        });
    }
    
    if (simulator.contextRegs[6] && simulator.contextRegs[6].name === capName) {
        impacts.push({
            message: 'This is the current C-List (CR6) - cannot delete',
            severity: 'danger'
        });
    }
    
    if (simulator.contextRegs[7] && simulator.contextRegs[7].name === capName) {
        impacts.push({
            message: 'This is the Nucleus (CR7) - system may become unstable',
            severity: 'warning'
        });
    }
    
    // Check C-List references in other places
    const refs = findAllCListReferences(capName);
    if (refs && refs.length > 0) {
        refs.forEach(ref => {
            impacts.push({
                message: `Referenced in ${ref} C-List`,
                severity: 'warning'
            });
        });
    }
    
    // Check if it's a Thread
    if (cap.type === 'Thread' || cap.perms?.includes('M')) {
        impacts.push({
            message: 'Thread capability - associated thread context will be lost',
            severity: 'warning'
        });
    }
    
    // Check if it's a C-List
    if (cap.type === 'C-List') {
        impacts.push({
            message: 'C-List capability - all contained entries become inaccessible',
            severity: 'danger'
        });
    }
    
    return impacts;
}

function closeDeleteModal() {
    document.getElementById('deleteModal').classList.remove('visible');
    pendingDeleteIndex = -1;
    pendingDeleteName = '';
    pendingDeleteType = 'capability';
}

function confirmDeleteCapability() {
    // Handle object deletion
    if (pendingDeleteType === 'object') {
        confirmObjectDelete();
        return;
    }
    
    // Handle capability deletion from C-List
    if (pendingDeleteIndex < 0 || !simulator.clist) {
        closeDeleteModal();
        return;
    }
    
    const cap = simulator.clist[pendingDeleteIndex];
    
    // Prevent deleting critical system capabilities
    if (simulator.cr15 && simulator.cr15.name === cap.name) {
        log('Cannot delete Namespace root', 'error');
        closeDeleteModal();
        return;
    }
    
    if (simulator.cr8 && simulator.cr8.name === cap.name) {
        log('Cannot delete active Thread', 'error');
        closeDeleteModal();
        return;
    }
    
    if (simulator.contextRegs[6] && simulator.contextRegs[6].name === cap.name) {
        log('Cannot delete current C-List', 'error');
        closeDeleteModal();
        return;
    }
    
    // Unload from any context registers
    for (let i = 0; i < 16; i++) {
        const reg = getContextRegister(i);
        if (reg && reg.name === cap.name) {
            if (i === 15) {
                simulator.cr15 = null;
            } else if (i === 8) {
                simulator.cr8 = null;
            } else {
                simulator.contextRegs[i] = null;
            }
        }
    }
    
    // Remove from C-List
    simulator.clist.splice(pendingDeleteIndex, 1);
    
    // Remove from dynamic objects if applicable
    const dynIndex = dynamicObjects.findIndex(o => o.name === cap.name);
    if (dynIndex >= 0) {
        dynamicObjects.splice(dynIndex, 1);
    }
    
    log(`Deleted capability "${pendingDeleteName}" from C-List`, 'info');
    
    closeDeleteModal();
    updateCapabilityExplorer();
    updateNamespaceDisplay();
    updateDisplay();
    saveToStorage();
}

function confirmObjectDelete() {
    const name = pendingDeleteName;
    const dynObj = dynamicObjects.find(o => o.name === name);
    
    // Check if it's a built-in object - prevent deletion
    if (!dynObj) {
        const builtIn = namespaceObjects.find(o => o.name === name);
        if (builtIn) {
            log('Cannot delete built-in system objects', 'error');
            closeDeleteModal();
            return;
        }
    }
    
    // Check if it's in critical registers
    for (let i = 0; i < 16; i++) {
        const reg = getContextRegister(i);
        if (reg && reg.name === name) {
            if (i === 15 || i === 8 || i === 6) {
                log(`Cannot delete "${name}" - loaded in critical register CR${i}`, 'error');
                closeDeleteModal();
                return;
            }
            // Clear non-critical registers
            if (i !== 15 && i !== 8) {
                simulator.contextRegs[i] = null;
            }
        }
    }
    
    // Perform the deletion
    if (dynObj) {
        deleteObjectRecursive(name);
        log(`Deleted object "${name}" and its children`, 'info');
        saveToStorage();
        updateNamespaceDisplay();
        updateCapabilityExplorer();
        updateDisplay();
    }
    
    closeDeleteModal();
}

function confirmObjectModal() {
    const name = document.getElementById('modalObjName').value.trim();
    if (!name) {
        log('Object name is required', 'error');
        return;
    }
    
    const descField = document.getElementById('modalObjDesc');
    const description = descField ? descField.value.trim() : '';
    if (!description && !contextMenuState.editMode) {
        log('Description is required', 'error');
        return;
    }
    
    const type = document.getElementById('modalObjType').value;
    const size = parseInt(document.getElementById('modalObjSize').value);
    const parent = document.getElementById('modalParent').value;
    
    let perms = [];
    ['R', 'W', 'X', 'L', 'S', 'E', 'B', 'M'].forEach(p => {
        const el = document.getElementById(`modalPerm${p}`);
        if (el && el.checked) {
            perms.push(p);
        }
    });
    
    // Always normalize permissions (enforces all validation rules)
    const originalPerms = [...perms];
    perms = normalizePermissions(perms);
    
    // Log any changes made by normalization
    if (JSON.stringify(originalPerms) !== JSON.stringify(perms)) {
        log(`Permissions normalized: ${originalPerms.join(',')} → ${perms.join(',')}`, 'warn');
    }
    
    if (contextMenuState.editMode) {
        updateObject(contextMenuState.targetObject, { name, type, size, perms, parent, description });
    } else {
        createObject(name, type, size, perms, parent, description);
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

function createObject(name, type, size, perms, parentName, description = '') {
    if (findObject(name)) {
        log(`Object "${name}" already exists`, 'error');
        return;
    }
    
    // Always normalize permissions at creation time
    const normalizedPerms = normalizePermissions(perms || []);
    
    const location = allocateAddress(size);
    const newObj = {
        location,
        name,
        type,
        perms: normalizedPerms,
        size,
        parent: parentName,
        description: description,
        tooltip: description || `${type}: ${name}`,
        dynamic: true
    };
    
    dynamicObjects.push(newObj);
    
    addToCList(parentName, name, type, perms, description);
    
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
    
    // Always normalize permissions on update
    if (updates.perms) {
        updates.perms = normalizePermissions(updates.perms);
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
    if (updates.description !== undefined) {
        obj.description = updates.description;
        obj.tooltip = updates.description || `${updates.type}: ${updates.name}`;
    }
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
    const type = contextMenuState.targetType;
    
    // Show confirmation modal with impact analysis
    showDeleteObjectModal(name, type);
}

function showDeleteObjectModal(objName, objType) {
    pendingDeleteName = objName;
    
    document.getElementById('deleteCapName').textContent = objName;
    
    // Analyze impact
    const impactList = document.getElementById('deleteImpactList');
    impactList.innerHTML = '';
    
    const impacts = analyzeObjectDeleteImpact(objName, objType);
    
    if (impacts.length === 0) {
        impactList.innerHTML = '<li class="impact-safe">No dependencies found. Safe to delete.</li>';
    } else {
        impacts.forEach(impact => {
            const li = document.createElement('li');
            li.innerHTML = impact.message;
            li.className = impact.severity === 'danger' ? 'impact-danger' : 
                          impact.severity === 'critical' ? 'impact-critical' : 'impact-warning';
            impactList.appendChild(li);
        });
    }
    
    // Store delete type for confirmation
    pendingDeleteType = 'object';
    
    document.getElementById('deleteModal').classList.add('visible');
}

function analyzeObjectDeleteImpact(objName, objType) {
    const impacts = [];
    const obj = findObject(objName);
    const dynObj = dynamicObjects.find(o => o.name === objName);
    
    // Check if it's a built-in object
    if (!dynObj) {
        const builtIn = namespaceObjects.find(o => o.name === objName);
        if (builtIn) {
            impacts.push({
                message: '<strong>⛔ BUILT-IN OBJECT</strong> - This is a system object and cannot be deleted',
                severity: 'critical'
            });
            return impacts;
        }
    }
    
    // Check if loaded in any context register
    for (let i = 0; i < 16; i++) {
        const reg = getContextRegister(i);
        if (reg && reg.name === objName) {
            if (i === 15) {
                impacts.push({
                    message: '<strong>⛔ CR15 (Namespace)</strong> - Cannot delete the Namespace root',
                    severity: 'critical'
                });
            } else if (i === 8) {
                impacts.push({
                    message: '<strong>⛔ CR8 (Thread)</strong> - Cannot delete the active Thread identity',
                    severity: 'critical'
                });
            } else if (i === 7) {
                impacts.push({
                    message: '<strong>⚠️ CR7 (Nucleus)</strong> - System kernel code will be unloaded',
                    severity: 'danger'
                });
            } else if (i === 6) {
                impacts.push({
                    message: '<strong>⛔ CR6 (C-List)</strong> - Cannot delete the current capability list',
                    severity: 'critical'
                });
            } else {
                impacts.push({
                    message: `<strong>CR${i}</strong> will be cleared - capability access lost`,
                    severity: 'warning'
                });
            }
        }
    }
    
    // Check for child objects
    const children = dynamicObjects.filter(o => o.parent === objName);
    if (children.length > 0) {
        impacts.push({
            message: `<strong>${children.length} child object(s)</strong> will also be deleted: ${children.map(c => c.name).join(', ')}`,
            severity: 'danger'
        });
    }
    
    // Check C-List references
    const refs = findAllCListReferences(objName);
    if (refs && refs.length > 0) {
        impacts.push({
            message: `Referenced in <strong>${refs.length} C-List(s)</strong>: ${refs.join(', ')} - references will be removed`,
            severity: 'warning'
        });
    }
    
    // Type-specific warnings
    if (objType === 'Thread' || (obj && obj.perms && obj.perms.includes('M'))) {
        impacts.push({
            message: '<strong>Thread capability</strong> - Thread context and identity will be permanently lost',
            severity: 'danger'
        });
    }
    
    if (objType === 'C-List') {
        impacts.push({
            message: '<strong>C-List capability</strong> - All contained entries become permanently inaccessible',
            severity: 'danger'
        });
    }
    
    if (objType === 'Code') {
        impacts.push({
            message: '<strong>Code capability</strong> - Executable code will be permanently removed',
            severity: 'warning'
        });
    }
    
    if (objType === 'Abstraction') {
        impacts.push({
            message: '<strong>Abstraction</strong> - All function entries and methods will be lost',
            severity: 'warning'
        });
    }
    
    // Check namespace entry
    const nsEntry = namespaceObjects.find(o => o.name === objName);
    if (nsEntry) {
        impacts.push({
            message: `Namespace offset <strong>${nsEntry.offset}</strong> (0x${nsEntry.offset.toString(16).padStart(2, '0')}) will be freed`,
            severity: 'warning'
        });
    }
    
    return impacts;
}

function addToCList(parentName, childName, childType, childPerms, description = '') {
    // Always normalize permissions when adding to C-List
    const normalizedPerms = normalizePermissions(childPerms || []);
    
    const entry = {
        name: childName,
        type: childType,
        perms: normalizedPerms,
        tooltip: description || `${childType}: ${childName}`,
        description: description
    };
    
    if (threadCLists[parentName]) {
        threadCLists[parentName].clist.push(entry);
    } else if (abstractionCLists[parentName]) {
        abstractionCLists[parentName].clist.push(entry);
    } else if (parentName === 'Boot') {
        bootNamespace.clist.push({
            name: childName,
            type: childType,
            ref: `dynamic.${childName.toLowerCase()}`,
            tooltip: description || `${childType}: ${childName}`,
            description: description
        });
        // Also add to simulator.clist if Boot is the current C-List
        if (simulator.clist) {
            const obj = findObject(childName);
            const nsOffset = obj ? (typeof obj.location === 'number' ? obj.location : 0) : 0;
            simulator.clist.push({
                name: childName,
                type: childType,
                perms: childPerms,
                location: { offset: nsOffset },
                nsOffset: nsOffset,
                size: obj ? obj.size : 1024,
                tooltip: description || `${childType}: ${childName}`,
                description: description,
                goldenKey: generateGoldenKey(),
                locked: true
            });
        }
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
    document.getElementById('linkModal').classList.add('visible');
}

function closeLinkModal() {
    document.getElementById('linkModal').classList.remove('visible');
}

// Find the next free offset in the namespace table
function getNextFreeNamespaceOffset() {
    let maxOffset = 0;
    namespaceObjects.forEach(obj => {
        if (obj.offset > maxOffset) {
            maxOffset = obj.offset;
        }
    });
    return maxOffset + 1;
}


// Calculate permission bits from permission array
function calculatePermissionBits(perms) {
    const permBits = {
        'R': 0x0001, 'W': 0x0002, 'X': 0x0004, 'L': 0x0008,
        'S': 0x0010, 'E': 0x0020, 'B': 0x0040, 'M': 0x0080, 'F': 0x0100
    };
    let value = 0;
    if (perms) {
        perms.forEach(p => {
            if (permBits[p]) {
                value |= permBits[p];
            }
        });
    }
    return value;
}

const functionBetaCode = {
    GT_CIRCUMFERENCE: `; ====================================================
; GT_CIRCUMFERENCE: C = 2 * PI * r
; Beta-reduction of Circle.circumference
; TYPE: Float -> Float (requires floating-point radius)
; IEEE 754: Binary64 (double precision, 64-bit)
; ====================================================
; Register usage:
;   CR0 = Parameter GT (radius, must be Float type)
;   DR0 = radius value (after validation)
;   DR1 = result (output)
;   CR5 = Thread C-List (contains GT_TWO_PI)
;   CR6 = Nodal C-List (current function GTs)
; ====================================================

; === FORMAL TYPE VALIDATION ===
; Step 1: Validate parameter GT has Read permission
TPERM 0 R           ; Test CR0 has Read permission
B NE perm_trap      ; TRAP: Missing Read permission

; Step 2: Validate parameter is Float type (Type=0x02)
; Hardware checks Namespace Entry Word3[32:47] = FLOAT
TPERM 0 R 0         ; Verify index 0 within object bounds
B NE type_trap      ; TRAP: Not a valid Float GT

; === IEEE 754 SPECIAL VALUE CHECK ===
; Check for NaN (exponent=0x7FF, mantissa!=0)
; If radius is NaN, result must be NaN (quiet propagation)
TST 0 0             ; Hardware NaN detection
B VS nan_propagate  ; Propagate NaN per IEEE 754

; Check for Infinity (exponent=0x7FF, mantissa=0)
; +Inf * 2PI = +Inf, -Inf * 2PI = -Inf
; Handled correctly by FPU

; Step 3: Load TWO_PI constant, verify it exists
LOAD 1 5 1          ; CR1 = GT_TWO_PI from CR5[1]
TPERM 1 R           ; Validate constant is readable
B NE const_trap     ; TRAP: TWO_PI constant missing

; === VALIDATED COMPUTATION ===
; All preconditions verified - safe to compute
MUL 1 0             ; DR1 = TWO_PI * radius (IEEE 754 multiply)

; === IEEE 754 POST-COMPUTATION ===
; FPSR flags set by hardware:
;   - Inexact: if result was rounded
;   - Overflow: if |result| > MAX_FLOAT -> ±Inf
;   - Underflow: if |result| < MIN_NORMAL -> denormal/zero

; Result in DR1, return to caller
RETURN              ; Exit with result in DR1

; === TRAP HANDLERS ===
perm_trap:
    ; Security violation: parameter lacks Read permission
    ; Hardware triggers capability fault
    
type_trap:
    ; Type mismatch: expected Float, got other type
    ; Hardware triggers type fault
    
const_trap:
    ; Missing constant: Thread C-List corrupted
    ; Hardware triggers integrity fault

nan_propagate:
    ; IEEE 754: NaN input produces NaN output
    ; Return quiet NaN (QNaN) to caller
    RETURN`,

    GT_AREA: `; ====================================================
; GT_AREA: A = PI * r^2
; Beta-reduction of Circle.area
; TYPE: Float -> Float (requires floating-point radius)
; IEEE 754: Binary64 (double precision, 64-bit)
; ====================================================
; Register usage:
;   CR0 = Parameter GT (radius, must be Float type)
;   DR0 = radius value (after validation)
;   DR1 = result (output)
;   DR2 = scratch (r^2)
;   CR5 = Thread C-List (contains GT_PI at index 0)
;   CR6 = Nodal C-List (current function GTs)
; ====================================================

; === FORMAL TYPE VALIDATION ===
; Step 1: Validate parameter GT has Read permission
TPERM 0 R           ; Test CR0 has Read permission
B NE perm_trap      ; TRAP: Missing Read permission

; Step 2: Validate parameter is Float type
; Hardware checks Namespace Entry Type field
TPERM 0 R 0         ; Verify index 0 within bounds
B NE type_trap      ; TRAP: Not a valid Float GT

; === IEEE 754 SPECIAL VALUE CHECK ===
; Check for NaN input
TST 0 0             ; Hardware NaN detection
B VS nan_propagate  ; NaN input -> NaN output

; Check for Infinity
; +Inf^2 * PI = +Inf (valid)
; -Inf: handled below in domain check

; Step 3: Validate radius >= 0 (domain check)
; IEEE 754: -0.0 is valid and equals +0.0 for comparison
CMP 0 0             ; Compare radius to zero
B MI domain_trap    ; TRAP: Negative radius invalid (not -0.0)

; Step 4: Load PI constant, verify integrity
LOAD 1 5 0          ; CR1 = GT_PI from CR5[0]
TPERM 1 R           ; Validate constant is readable
B NE const_trap     ; TRAP: PI constant missing

; === VALIDATED COMPUTATION (IEEE 754) ===
; All preconditions verified - safe to compute
MOV 2 0             ; DR2 = radius
MUL 2 0             ; DR2 = r * r = r^2 (IEEE 754 multiply)
MUL 1 2             ; DR1 = PI * r^2 (IEEE 754 multiply)

; === IEEE 754 POST-COMPUTATION ===
; FPSR flags set by hardware:
;   - Inexact: result rounded (almost always for PI)
;   - Overflow: if r^2 * PI > MAX_FLOAT -> +Inf
;   - Underflow: if result denormalized

; Result in DR1, return to caller
RETURN              ; Exit with result in DR1

; === TRAP HANDLERS ===
perm_trap:
    ; Security violation: parameter lacks Read permission
type_trap:
    ; Type mismatch: expected Float, got Integer or other
domain_trap:
    ; Domain error: radius must be non-negative
    ; IEEE 754: Would produce invalid result
const_trap:
    ; Integrity fault: PI constant not in Thread C-List
nan_propagate:
    ; IEEE 754: NaN^2 * PI = NaN (quiet propagation)
    RETURN`,

    GT_DIAMETER: `; ====================================================
; GT_DIAMETER: D = 2 * r
; Beta-reduction of Circle.diameter
; TYPE: Float -> Float (requires floating-point radius)
; IEEE 754: Binary64 (double precision, 64-bit)
; ====================================================
; Register usage:
;   CR0 = Parameter GT (radius, must be Float type)
;   DR0 = radius value (after validation)
;   DR1 = result (output)
;   CR6 = Nodal C-List (current function GTs)
; ====================================================

; === FORMAL TYPE VALIDATION ===
; Step 1: Validate parameter GT has Read permission
TPERM 0 R           ; Test CR0 has Read permission
B NE perm_trap      ; TRAP: Missing Read permission

; Step 2: Validate parameter is Float type
TPERM 0 R 0         ; Verify index 0 within bounds
B NE type_trap      ; TRAP: Not a valid Float GT

; === IEEE 754 SPECIAL VALUE CHECK ===
TST 0 0             ; Hardware NaN detection
B VS nan_propagate  ; NaN * 2 = NaN

; Infinity handling:
; +Inf * 2 = +Inf, -Inf * 2 = -Inf (valid per IEEE 754)

; === VALIDATED COMPUTATION (IEEE 754) ===
; D = 2 * r (equivalent to r + r for exact result)
MOV 1 0             ; DR1 = radius
ADD 1 0             ; DR1 = r + r = 2*r (IEEE 754 add, exact)

; Note: 2*r via addition is always exact (no rounding)
; This avoids Inexact flag that multiply might set

; Result in DR1, return to caller
RETURN              ; Exit with result in DR1

; === TRAP HANDLERS ===
perm_trap:
    ; Security violation: parameter lacks permission
type_trap:
    ; Type mismatch: expected Float
nan_propagate:
    ; IEEE 754: NaN + NaN = NaN
    RETURN`,

    GT_ADD: `; ====================================================
; GT_ADD (SlideRule): a + b
; Beta-reduction of floating-point addition
; TYPE: (Float, Float) -> Float
; IEEE 754: Binary64 (double precision, 64-bit)
; ====================================================
; Register usage:
;   CR0 = First operand GT (must be Float)
;   CR1 = Second operand GT (must be Float)
;   DR0 = operand a, DR1 = operand b
;   Result in DR0
; ====================================================

; === FORMAL TYPE VALIDATION ===
TPERM 0 R           ; Validate CR0 has Read
B NE perm_trap      ; TRAP on permission failure
TPERM 0 R 0         ; Validate index within bounds
B NE type_trap      ; TRAP: operand a not Float

TPERM 1 R           ; Validate CR1 has Read
B NE perm_trap      ; TRAP on permission failure
TPERM 1 R 0         ; Validate index within bounds
B NE type_trap      ; TRAP: operand b not Float

; === IEEE 754 SPECIAL VALUE CHECK ===
; NaN propagation: if either operand is NaN, result is NaN
TST 0 0             ; Check a for NaN
B VS nan_propagate
TST 1 1             ; Check b for NaN
B VS nan_propagate

; Infinity rules (IEEE 754 Section 6.1):
; (+Inf) + (+Inf) = +Inf
; (-Inf) + (-Inf) = -Inf
; (+Inf) + (-Inf) = NaN (Invalid operation)
; Inf + finite = Inf

; === VALIDATED COMPUTATION (IEEE 754) ===
ADD 0 1             ; DR0 = DR0 + DR1 (IEEE 754 add)

; === IEEE 754 FPSR FLAGS ===
; Hardware sets:
;   - Invalid (V): if +Inf + -Inf (produces NaN)
;   - Overflow: if result > MAX_FLOAT
;   - Underflow: if result denormalized
;   - Inexact: if result was rounded

B VS invalid_trap   ; +Inf + -Inf case

RETURN              ; Exit with validated result

; === TRAP HANDLERS ===
perm_trap:
    ; Capability permission denied
type_trap:
    ; Type error: Float required
nan_propagate:
    ; IEEE 754: NaN + x = NaN, x + NaN = NaN
    RETURN
invalid_trap:
    ; IEEE 754 Invalid: +Inf + -Inf = NaN`,

    GT_SUB: `; ====================================================
; GT_SUB (SlideRule): a - b
; Beta-reduction of floating-point subtraction
; TYPE: (Float, Float) -> Float
; IEEE 754: Binary64 (double precision, 64-bit)
; ====================================================
; Register usage:
;   CR0 = First operand GT (must be Float)
;   CR1 = Second operand GT (must be Float)
;   DR0 = operand a, DR1 = operand b
;   Result in DR0
; ====================================================

; === FORMAL TYPE VALIDATION ===
TPERM 0 R           ; Validate CR0 has Read
B NE perm_trap
TPERM 0 R 0         ; Validate index within bounds
B NE type_trap

TPERM 1 R           ; Validate CR1 has Read
B NE perm_trap
TPERM 1 R 0         ; Validate index within bounds
B NE type_trap

; === IEEE 754 SPECIAL VALUE CHECK ===
TST 0 0             ; Check a for NaN
B VS nan_propagate
TST 1 1             ; Check b for NaN
B VS nan_propagate

; Infinity rules (IEEE 754):
; (+Inf) - (-Inf) = +Inf
; (-Inf) - (+Inf) = -Inf
; (+Inf) - (+Inf) = NaN (Invalid)
; (-Inf) - (-Inf) = NaN (Invalid)

; === VALIDATED COMPUTATION (IEEE 754) ===
SUB 0 1             ; DR0 = DR0 - DR1 (IEEE 754 subtract)

; === IEEE 754 FPSR FLAGS ===
B VS invalid_trap   ; Inf - Inf case

RETURN              ; Exit with result

; === TRAP HANDLERS ===
perm_trap:
type_trap:
nan_propagate:
    ; IEEE 754: NaN - x = NaN
    RETURN
invalid_trap:
    ; IEEE 754 Invalid: Inf - Inf = NaN`,

    GT_MUL: `; ====================================================
; GT_MUL (SlideRule): a * b
; Beta-reduction of floating-point multiplication
; TYPE: (Float, Float) -> Float
; IEEE 754: Binary64 (double precision, 64-bit)
; ====================================================
; Register usage:
;   CR0, CR1 = Operand GTs (must be Float)
;   DR0 = a, DR1 = b
;   Result in DR0
; ====================================================

; === FORMAL TYPE VALIDATION ===
TPERM 0 R           ; Validate CR0 readable
B NE perm_trap
TPERM 0 R 0         ; Validate index within bounds
B NE type_trap

TPERM 1 R           ; Validate CR1 readable
B NE perm_trap
TPERM 1 R 0         ; Validate index within bounds
B NE type_trap

; === IEEE 754 SPECIAL VALUE CHECK ===
TST 0 0             ; Check a for NaN
B VS nan_propagate
TST 1 1             ; Check b for NaN
B VS nan_propagate

; Infinity * Zero = NaN (Invalid operation)
; Infinity * Finite = ±Inf (sign from XOR of signs)
; Infinity * Infinity = ±Inf

; === VALIDATED COMPUTATION (IEEE 754) ===
MUL 0 1             ; DR0 = DR0 * DR1 (IEEE 754 multiply)

; === IEEE 754 FPSR FLAGS ===
; Invalid: 0 * Inf or Inf * 0
; Overflow: |result| > MAX_FLOAT -> ±Inf
; Underflow: |result| < MIN_NORMAL -> denormal
; Inexact: result rounded

B VS invalid_trap   ; 0 * Inf case

RETURN

; === TRAP HANDLERS ===
perm_trap:
type_trap:
nan_propagate:
    ; IEEE 754: NaN * x = NaN
    RETURN
invalid_trap:
    ; IEEE 754 Invalid: 0 * Inf = NaN`,

    GT_DIV: `; ====================================================
; GT_DIV (SlideRule): a / b
; Beta-reduction of floating-point division
; TYPE: (Float, Float) -> Float
; IEEE 754: Binary64 (double precision, 64-bit)
; ====================================================
; Register usage:
;   CR0 = Dividend GT (Float)
;   CR1 = Divisor GT (Float)
;   DR0 = a, DR1 = b
;   Result in DR0
; ====================================================

; === FORMAL TYPE VALIDATION ===
TPERM 0 R           ; Validate dividend readable
B NE perm_trap
TPERM 0 R 0         ; Validate index within bounds
B NE type_trap

TPERM 1 R           ; Validate divisor readable
B NE perm_trap
TPERM 1 R 0         ; Validate index within bounds
B NE type_trap

; === IEEE 754 SPECIAL VALUE CHECK ===
TST 0 0             ; Check dividend for NaN
B VS nan_propagate
TST 1 1             ; Check divisor for NaN
B VS nan_propagate

; IEEE 754 Division Special Cases:
; ±Inf / ±Inf = NaN (Invalid)
; ±0 / ±0 = NaN (Invalid)
; ±Finite / ±0 = ±Inf (DivideByZero flag, NOT a trap!)
; ±Finite / ±Inf = ±0
; ±Inf / ±Finite = ±Inf

; === IEEE 754 DIVIDE BY ZERO CHECK ===
; Note: IEEE 754 does NOT trap on divide by zero!
; Instead it returns ±Inf and sets DivideByZero flag
CMP 1 1             ; Test if DR1 == 0
B EQ divzero_inf    ; Return ±Inf per IEEE 754

; === VALIDATED COMPUTATION (IEEE 754) ===
; DR0 = DR0 / DR1 (IEEE 754 divide)
; Hardware handles all special cases

; === IEEE 754 FPSR FLAGS ===
; DivideByZero: finite / 0 -> ±Inf
; Invalid: 0/0 or Inf/Inf -> NaN
; Overflow: |result| > MAX_FLOAT
; Underflow: |result| < MIN_NORMAL
; Inexact: result rounded

RETURN

; === TRAP HANDLERS ===
perm_trap:
    ; Capability permission denied
type_trap:
    ; Type mismatch - not Float
nan_propagate:
    ; IEEE 754: NaN / x = NaN, x / NaN = NaN
    RETURN
divzero_inf:
    ; IEEE 754: finite / 0 = ±Inf (not an error!)
    ; Set DivideByZero flag in FPSR
    ; Return Inf with sign = XOR(sign(a), sign(0))
    RETURN`,

    GT_MOD: `; ====================================================
; GT_MOD (Abacus): a mod b
; Beta-reduction of integer modulo
; TYPE: (Integer, Integer) -> Integer
; PRECONDITION: b != 0
; ====================================================
; Register usage:
;   CR0 = Dividend GT (must be Integer type)
;   CR1 = Divisor GT (must be Integer, non-zero)
;   DR0 = a, DR1 = b
;   Result in DR0 = a mod b
; ====================================================

; === FORMAL TYPE VALIDATION ===
TPERM 0 R           ; Validate CR0 readable
B NE perm_trap
TPERM 0 R 0         ; Validate index within bounds
B NE type_trap

TPERM 1 R           ; Validate CR1 readable
B NE perm_trap
TPERM 1 R 0         ; Validate index within bounds
B NE type_trap

; === DOMAIN VALIDATION ===
CMP 1 1             ; Check divisor != 0
B EQ divzero_trap   ; TRAP on modulo by zero

; === VALIDATED COMPUTATION ===
; Integer modulo: DR0 = DR0 mod DR1
; Result is always in range [0, |b|-1]
RETURN

; === TRAP HANDLERS ===
perm_trap:
type_trap:
divzero_trap:`,

    GT_ABS: `; ====================================================
; GT_ABS (Abacus): |a|
; Beta-reduction of integer absolute value
; TYPE: Integer -> Integer
; ====================================================
; Register usage:
;   CR0 = Input GT (must be Integer type)
;   DR0 = input value
;   Result in DR0 = |a|
; ====================================================

; === FORMAL TYPE VALIDATION ===
TPERM 0 R           ; Validate readable
B NE perm_trap
TPERM 0 R 0         ; Validate index within bounds
B NE type_trap

; === VALIDATED COMPUTATION ===
CMP 0 0             ; Test sign of input
B PL done           ; If positive/zero, already absolute
NEG 0 0             ; Negate if negative
B VS overflow_trap  ; Check for MIN_INT overflow

done:
RETURN

; === TRAP HANDLERS ===
perm_trap:
type_trap:
overflow_trap:
    ; ABS(MIN_INT) overflows - no positive representation`,

    GT_NEG: `; ====================================================
; GT_NEG (Abacus): -a
; Beta-reduction of integer negation
; TYPE: Integer -> Integer
; ====================================================
; Register usage:
;   CR0 = Input GT (must be Integer type)
;   DR0 = input value
;   Result in DR0 = -a
; ====================================================

; === FORMAL TYPE VALIDATION ===
TPERM 0 R           ; Validate readable
B NE perm_trap
TPERM 0 R 0         ; Validate index within bounds
B NE type_trap

; === VALIDATED COMPUTATION ===
NEG 0 0             ; DR0 = -DR0
B VS overflow_trap  ; NEG(MIN_INT) overflows

RETURN

; === TRAP HANDLERS ===
perm_trap:
type_trap:
overflow_trap:`,

    GT_INC: `; ====================================================
; GT_INC (Abacus): a + 1
; Beta-reduction of integer increment
; TYPE: Integer -> Integer
; ====================================================
; Register usage:
;   CR0 = Input GT (must be Integer type)
;   DR0 = input value
;   Result in DR0 = a + 1
; ====================================================

; === FORMAL TYPE VALIDATION ===
TPERM 0 R           ; Validate readable
B NE perm_trap
TPERM 0 R 0         ; Validate index within bounds
B NE type_trap

; === VALIDATED COMPUTATION ===
ADDI 0 1            ; DR0 = DR0 + 1
B VS overflow_trap  ; Check for signed overflow

RETURN

; === TRAP HANDLERS ===
perm_trap:
type_trap:
overflow_trap:
    ; MAX_INT + 1 causes overflow`,

    GT_DEC: `; ====================================================
; GT_DEC (Abacus): a - 1
; Beta-reduction of integer decrement
; TYPE: Integer -> Integer
; ====================================================
; Register usage:
;   CR0 = Input GT (must be Integer type)
;   DR0 = input value
;   Result in DR0 = a - 1
; ====================================================

; === FORMAL TYPE VALIDATION ===
TPERM 0 R           ; Validate readable
B NE perm_trap
TPERM 0 R 0         ; Validate index within bounds
B NE type_trap

; === VALIDATED COMPUTATION ===
SUBI 0 1            ; DR0 = DR0 - 1
B VS underflow_trap ; Check for signed underflow

RETURN

; === TRAP HANDLERS ===
perm_trap:
type_trap:
underflow_trap:
    ; MIN_INT - 1 causes underflow`,

    GT_LOG: `; ====================================================
; GT_LOG (SlideRule): ln(x)
; Beta-reduction of natural logarithm
; TYPE: Float -> Float
; IEEE 754: Binary64 (double precision, 64-bit)
; DOMAIN: x > 0 (x = 0 returns -Inf, x < 0 returns NaN)
; ====================================================
; Register usage:
;   CR0 = Input GT (must be Float)
;   DR0 = input value x
;   Result in DR0 = ln(x)
; ====================================================

; === FORMAL TYPE VALIDATION ===
TPERM 0 R           ; Validate readable
B NE perm_trap
TPERM 0 R 0         ; Validate index within bounds
B NE type_trap

; === IEEE 754 SPECIAL VALUE CHECK ===
TST 0 0             ; Check for NaN
B VS nan_propagate  ; ln(NaN) = NaN

; === IEEE 754 DOMAIN RULES ===
; ln(+Inf) = +Inf (valid)
; ln(+0) = -Inf (DivideByZero flag)
; ln(-0) = -Inf (DivideByZero flag, same as +0)
; ln(x < 0) = NaN (Invalid flag)
; ln(1) = +0 (exact)

CMP 0 0             ; Compare x to zero
B EQ log_zero       ; ln(0) = -Inf per IEEE 754
B MI log_negative   ; ln(negative) = NaN per IEEE 754

; === VALIDATED COMPUTATION (IEEE 754) ===
; Hardware FPU computes ln(x) for x > 0
; Uses polynomial approximation or table lookup
; Result rounded per current rounding mode

; === IEEE 754 FPSR FLAGS ===
; DivideByZero: ln(0) -> -Inf
; Invalid: ln(negative) -> NaN
; Inexact: almost always (ln rarely exact)

RETURN

; === TRAP HANDLERS ===
perm_trap:
type_trap:
nan_propagate:
    ; IEEE 754: ln(NaN) = NaN
    RETURN
log_zero:
    ; IEEE 754: ln(±0) = -Inf
    ; Sets DivideByZero flag (pole error)
    ; Returns -Infinity
    RETURN
log_negative:
    ; IEEE 754: ln(x < 0) = NaN
    ; Sets Invalid flag
    ; Returns quiet NaN
    RETURN`,

    GT_EXP: `; ====================================================
; GT_EXP (SlideRule): e^x
; Beta-reduction of exponential function
; TYPE: Float -> Float
; IEEE 754: Binary64 (double precision, 64-bit)
; RANGE: Result always > 0 (or 0 for underflow)
; ====================================================
; Register usage:
;   CR0 = Input GT (must be Float)
;   DR0 = exponent x
;   Result in DR0 = e^x
; ====================================================

; === FORMAL TYPE VALIDATION ===
TPERM 0 R           ; Validate readable
B NE perm_trap
TPERM 0 R 0         ; Validate index within bounds
B NE type_trap

; === IEEE 754 SPECIAL VALUE CHECK ===
TST 0 0             ; Check for NaN
B VS nan_propagate  ; e^NaN = NaN

; === IEEE 754 DOMAIN RULES ===
; e^(+Inf) = +Inf
; e^(-Inf) = +0 (exact)
; e^(+0) = 1 (exact)
; e^(-0) = 1 (exact)
; e^(large positive) = +Inf (Overflow)
; e^(large negative) = +0 (Underflow)

; === VALIDATED COMPUTATION (IEEE 754) ===
; Hardware FPU computes e^x
; Result always positive (or +0 for underflow)
; Uses polynomial approximation or table lookup

; === IEEE 754 FPSR FLAGS ===
; Overflow: e^(x > ~709.78) -> +Inf
; Underflow: e^(x < ~-745.13) -> +0 (denormal or zero)
; Inexact: almost always (e^x rarely exact)

RETURN

; === TRAP HANDLERS ===
perm_trap:
type_trap:
nan_propagate:
    ; IEEE 754: e^NaN = NaN
    RETURN`,

    GT_SQRT: `; ====================================================
; GT_SQRT (SlideRule): sqrt(x)
; Beta-reduction of square root
; TYPE: Float -> Float
; IEEE 754: Binary64 (double precision, 64-bit)
; DOMAIN: x >= 0 (x < 0 returns NaN)
; ====================================================
; Register usage:
;   CR0 = Input GT (must be Float)
;   DR0 = input value x
;   Result in DR0 = sqrt(x)
; ====================================================

; === FORMAL TYPE VALIDATION ===
TPERM 0 R           ; Validate readable
B NE perm_trap
TPERM 0 R 0         ; Validate index within bounds
B NE type_trap

; === IEEE 754 SPECIAL VALUE CHECK ===
TST 0 0             ; Check for NaN
B VS nan_propagate  ; sqrt(NaN) = NaN

; === IEEE 754 DOMAIN RULES ===
; sqrt(+Inf) = +Inf
; sqrt(+0) = +0 (exact)
; sqrt(-0) = -0 (exact, preserves sign)
; sqrt(x > 0) = positive result
; sqrt(x < 0) = NaN (Invalid flag)

CMP 0 0             ; Compare x to zero
B MI sqrt_negative  ; sqrt(negative) = NaN per IEEE 754

; === VALIDATED COMPUTATION (IEEE 754) ===
; Hardware FPU computes sqrt(x) for x >= 0
; IEEE 754 requires sqrt to be correctly rounded
; This is one of the few operations that must be exact!

; === IEEE 754 FPSR FLAGS ===
; Invalid: sqrt(negative) -> NaN
; Inexact: when result cannot be exactly represented
; Note: sqrt of perfect squares may be exact

RETURN

; === TRAP HANDLERS ===
perm_trap:
type_trap:
nan_propagate:
    ; IEEE 754: sqrt(NaN) = NaN
    RETURN
sqrt_negative:
    ; IEEE 754: sqrt(x < 0) = NaN
    ; Sets Invalid flag
    ; Returns quiet NaN (imaginary result not representable)
    RETURN`,

    GT_POW: `; ====================================================
; GT_POW (SlideRule): x^y (power function)
; Beta-reduction of x raised to power y
; TYPE: (Float, Float) -> Float
; IEEE 754: Binary64 (double precision, 64-bit)
; ====================================================
; Register usage:
;   CR0 = Base GT x (Float)
;   CR1 = Exponent GT y (Float)
;   DR0 = x, DR1 = y
;   Result in DR0 = x^y
; ====================================================

; === FORMAL TYPE VALIDATION ===
TPERM 0 R           ; Validate base readable
B NE perm_trap
TPERM 0 R 0         ; Validate index within bounds
B NE type_trap

TPERM 1 R           ; Validate exponent readable
B NE perm_trap
TPERM 1 R 0         ; Validate index within bounds
B NE type_trap

; === IEEE 754 SPECIAL VALUE CHECK ===
TST 0 0             ; Check x for NaN
B VS nan_propagate
TST 1 1             ; Check y for NaN
B VS nan_propagate

; === IEEE 754 POW SPECIAL CASES (C99/IEEE 754-2008) ===
; pow(±0, y) where y < 0 and y is odd integer = ±Inf (DivByZero)
; pow(±0, y) where y < 0 and y not odd int = +Inf (DivByZero)
; pow(±0, y) where y > 0 and y is odd integer = ±0
; pow(±0, y) where y > 0 and y not odd int = +0
; pow(-1, ±Inf) = 1
; pow(+1, y) = 1 for any y (even NaN!)
; pow(x, ±0) = 1 for any x (even NaN!)
; pow(x, y) where x < 0 and y non-integer = NaN (Invalid)
; pow(+Inf, y) where y < 0 = +0
; pow(+Inf, y) where y > 0 = +Inf
; pow(-Inf, y) = (-1)^y * pow(+Inf, y) for integer y

; Check special case: x^0 = 1 for all x
CMP 1 0             ; Is y == 0?
B EQ pow_one        ; Return 1.0

; Check special case: 1^y = 1 for all y
; (Check if x == 1.0)

; === DOMAIN VALIDATION ===
CMP 0 0             ; Is x == 0?
B EQ pow_zero_base  ; Handle 0^y cases

CMP 0 0             ; Is x < 0?
B MI pow_neg_base   ; Handle negative base

; === VALIDATED COMPUTATION (IEEE 754) ===
pow_compute:
; Power via: x^y = exp(y * ln(x))
; This is the standard implementation
LOAD 2 6 0          ; Load GT_LOG from C-List
CALL 2              ; DR0 = ln(x)
MUL 0 1             ; DR0 = y * ln(x)
LOAD 3 6 1          ; Load GT_EXP from C-List
CALL 3              ; DR0 = exp(y * ln(x)) = x^y

; === IEEE 754 FPSR FLAGS ===
; Overflow: result > MAX_FLOAT -> +Inf
; Underflow: result < MIN_NORMAL -> denormal/0
; Inexact: almost always
; Invalid: neg^non-integer
; DivByZero: 0^negative

RETURN

; === SPECIAL CASE HANDLERS ===
pow_one:
    ; IEEE 754: x^0 = 1.0 for all x (even NaN)
    ; Load 1.0 into DR0
    RETURN

pow_zero_base:
    ; 0^y cases per IEEE 754
    CMP 1 0             ; Is y < 0?
    B MI divzero_inf    ; 0^negative = Inf (DivByZero)
    ; 0^positive = 0
    RETURN

pow_neg_base:
    ; x < 0: check if y is integer
    ; If y is non-integer, result is complex (NaN)
    ; If y is integer, use (-1)^y * |x|^y
    B invalid_trap      ; Simplified: trap on negative base

; === TRAP HANDLERS ===
perm_trap:
type_trap:
nan_propagate:
    ; IEEE 754: pow(NaN, y) = NaN, pow(x, NaN) = NaN
    ; Exception: pow(1, NaN) = 1, pow(NaN, 0) = 1
    RETURN
invalid_trap:
    ; IEEE 754 Invalid: negative^non-integer
    ; Returns NaN
    RETURN
divzero_inf:
    ; IEEE 754: 0^negative = Inf (DivByZero flag)
    RETURN`,

    Abacus_GT_ADD: `; ====================================================
; GT_ADD (Abacus): a + b
; Beta-reduction of INTEGER addition
; TYPE: (Integer, Integer) -> Integer
; ====================================================
; Register usage:
;   CR0 = First operand GT (must be Integer type)
;   CR1 = Second operand GT (must be Integer type)
;   DR0 = operand a, DR1 = operand b
;   Result in DR0
; ====================================================

; === FORMAL TYPE VALIDATION ===
; Step 1: Validate first operand is Integer
TPERM 0 R           ; Validate CR0 has Read permission
B NE perm_trap      ; TRAP on permission failure
TPERM 0 R 0         ; Validate index within bounds (8 bytes, 64-bit)
B NE type_trap      ; TRAP: operand a not Integer

; Step 2: Validate second operand is Integer
TPERM 1 R           ; Validate CR1 has Read permission
B NE perm_trap      ; TRAP on permission failure
TPERM 1 R 0         ; Validate index within bounds type
B NE type_trap      ; TRAP: operand b not Integer

; === VALIDATED COMPUTATION ===
ADD 0 1             ; DR0 = DR0 + DR1 (integer add)

; Check for signed overflow (V flag)
B VS overflow_trap  ; TRAP on integer overflow

RETURN              ; Exit with validated result

; === TRAP HANDLERS ===
perm_trap:
    ; Security violation: operand lacks Read permission
    ; Hardware triggers capability fault
type_trap:
    ; Type mismatch: expected Integer, got Float or other
    ; Integer operations require whole numbers
overflow_trap:
    ; Arithmetic overflow: result exceeds 64-bit signed range
    ; MAX_INT + positive or MIN_INT + negative`,

    Abacus_GT_SUB: `; ====================================================
; GT_SUB (Abacus): a - b
; Beta-reduction of INTEGER subtraction
; TYPE: (Integer, Integer) -> Integer
; ====================================================
; Register usage:
;   CR0 = First operand GT (must be Integer type)
;   CR1 = Second operand GT (must be Integer type)
;   DR0 = operand a, DR1 = operand b
;   Result in DR0 = a - b
; ====================================================

; === FORMAL TYPE VALIDATION ===
TPERM 0 R           ; Validate CR0 readable
B NE perm_trap
TPERM 0 R 0         ; Validate index within bounds
B NE type_trap

TPERM 1 R           ; Validate CR1 readable
B NE perm_trap
TPERM 1 R 0         ; Validate index within bounds type
B NE type_trap

; === VALIDATED COMPUTATION ===
SUB 0 1             ; DR0 = DR0 - DR1 (integer sub)
B VS underflow_trap ; Check for signed underflow

RETURN              ; Exit with result

; === TRAP HANDLERS ===
perm_trap:
    ; Capability permission denied
type_trap:
    ; Type mismatch - expected Integer, got Float
underflow_trap:
    ; Arithmetic underflow: MIN_INT - positive`,

    Abacus_GT_MUL: `; ====================================================
; GT_MUL (Abacus): a * b
; Beta-reduction of INTEGER multiplication
; TYPE: (Integer, Integer) -> Integer
; ====================================================
; Register usage:
;   CR0, CR1 = Operand GTs (must be Integer type)
;   DR0 = a, DR1 = b
;   Result in DR0 = a * b
; ====================================================

; === FORMAL TYPE VALIDATION ===
TPERM 0 R           ; Validate CR0 readable
B NE perm_trap
TPERM 0 R 0         ; Validate index within bounds
B NE type_trap

TPERM 1 R           ; Validate CR1 readable
B NE perm_trap
TPERM 1 R 0         ; Validate index within bounds
B NE type_trap

; === VALIDATED COMPUTATION ===
MUL 0 1             ; DR0 = DR0 * DR1 (integer mul)
B VS overflow_trap  ; Check for overflow (result > 64 bits)

RETURN

; === TRAP HANDLERS ===
perm_trap:
    ; Permission denied
type_trap:
    ; Type error: Integer required, Float given
overflow_trap:
    ; Product exceeds 64-bit signed integer range`,

    Abacus_GT_DIV: `; ====================================================
; GT_DIV (Abacus): a / b (integer division)
; Beta-reduction of INTEGER division (truncates toward zero)
; TYPE: (Integer, Integer) -> Integer
; PRECONDITION: b != 0
; ====================================================
; Register usage:
;   CR0 = Dividend GT (Integer)
;   CR1 = Divisor GT (Integer, must be non-zero)
;   DR0 = a, DR1 = b
;   Result in DR0 = a / b (truncated)
; ====================================================

; === FORMAL TYPE VALIDATION ===
TPERM 0 R           ; Validate dividend readable
B NE perm_trap
TPERM 0 R 0         ; Validate index within bounds
B NE type_trap

TPERM 1 R           ; Validate divisor readable
B NE perm_trap
TPERM 1 R 0         ; Validate index within bounds
B NE type_trap

; === DOMAIN VALIDATION ===
; CRITICAL: Check for division by zero
CMP 1 1             ; Test if DR1 == 0
B EQ divzero_trap   ; TRAP: Division by zero is undefined

; Check for special case: MIN_INT / -1 (overflows)
; MIN_INT = 0x8000000000000000 = -9223372036854775808
; -MIN_INT cannot be represented in 64-bit signed

; === VALIDATED COMPUTATION ===
; Safe to divide - divisor verified non-zero
; DR0 = DR0 / DR1 (integer division, truncates)
; Remainder discarded (use GT_MOD for remainder)
RETURN

; === TRAP HANDLERS ===
perm_trap:
    ; Capability permission denied
type_trap:
    ; Type mismatch - Integer required
divzero_trap:
    ; CRITICAL: Division by zero attempted
    ; This is a fatal arithmetic exception
    ; Hardware halts and reports fault`
};

function openFunctionInEditor(funcName, parentAbstraction) {
    let codeKey = funcName;
    if (parentAbstraction === 'Abacus' && ['GT_ADD', 'GT_SUB', 'GT_MUL', 'GT_DIV'].includes(funcName)) {
        codeKey = 'Abacus_' + funcName;
    }
    const code = functionBetaCode[codeKey] || functionBetaCode[funcName];
    if (code) {
        const abstraction = abstractionCLists[parentAbstraction];
        const funcGT = abstraction ? abstraction.clist.find(c => c.name === funcName) : null;
        const linkagePath = parentAbstraction ? `Boot/${parentAbstraction}/${funcName}` : `Boot/${funcName}`;
        const permsStr = funcGT?.perms ? `[${funcGT.perms.join('')}]` : '[RX]';
        
        setEditorCode(code, linkagePath, permsStr);
        resetProgram();
        
        switchView('editor');
        
        simulator.contextRegs[7] = {
            name: funcName,
            location: { type: "Local", offset: funcGT?.base || 0x0000 },
            perms: funcGT?.perms || ["R", "X"],
            locked: true,
            goldenKey: generateGoldenKey(),
            linkage: linkagePath,
            base: funcGT?.base || 0x0000,
            size: funcGT?.size || 0
        };
        updateSystemState();
        updateCapabilityExplorer();
        
        log(`Loaded ${linkagePath} [${(funcGT?.perms || ["R","X"]).join('')}] Base:0x${(funcGT?.base || 0).toString(16).toUpperCase()} Size:${funcGT?.size || 0}`, 'info');
    } else {
        log(`No beta-reduction code available for ${funcName}`, 'warning');
    }
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
            const parent = this.dataset.parent || null;
            selectObject(name, type);
            
            if (type === 'Function') {
                openFunctionInEditor(name, parent);
            }
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

// ==================== DYNAMIC TOOLTIP SYSTEM ====================
// Creates floating tooltips positioned dynamically to avoid clipping

let floatingTooltip = null;

function createFloatingTooltip() {
    if (!floatingTooltip) {
        floatingTooltip = document.createElement('div');
        floatingTooltip.className = 'floating-tooltip';
        floatingTooltip.style.cssText = `
            position: fixed;
            padding: 0.6rem 0.8rem;
            background: linear-gradient(135deg, #1e1e2e 0%, #2a2a3e 100%);
            color: #eaeaea;
            font-size: 0.8rem;
            font-weight: normal;
            border-radius: 6px;
            border: 1px solid #e94560;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
            max-width: 280px;
            white-space: normal;
            text-align: center;
            line-height: 1.4;
            z-index: 999999;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.15s ease;
        `;
        document.body.appendChild(floatingTooltip);
    }
    return floatingTooltip;
}

function showFloatingTooltip(element) {
    const tooltip = createFloatingTooltip();
    const text = element.getAttribute('data-tooltip');
    if (!text) return;
    
    tooltip.textContent = text;
    tooltip.style.opacity = '1';
    
    const rect = element.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    
    // Position below the element by default
    let top = rect.bottom + 8;
    let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
    
    // If tooltip would go below viewport, show above
    if (top + tooltipRect.height > window.innerHeight) {
        top = rect.top - tooltipRect.height - 8;
    }
    
    // Keep tooltip within horizontal bounds
    if (left < 10) left = 10;
    if (left + tooltipRect.width > window.innerWidth - 10) {
        left = window.innerWidth - tooltipRect.width - 10;
    }
    
    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';
}

function hideFloatingTooltip() {
    if (floatingTooltip) {
        floatingTooltip.style.opacity = '0';
    }
}

// Attach tooltip listeners to elements with data-tooltip
function initDynamicTooltips() {
    document.addEventListener('mouseenter', (e) => {
        if (!e.target || !e.target.closest) return;
        const target = e.target.closest('[data-tooltip]');
        if (target) {
            showFloatingTooltip(target);
        }
    }, true);
    
    document.addEventListener('mouseleave', (e) => {
        if (!e.target || !e.target.closest) return;
        const target = e.target.closest('[data-tooltip]');
        if (target) {
            hideFloatingTooltip();
        }
    }, true);
}

initDynamicTooltips();

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
        hideFloatingTooltip();
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
; CR6 = Nodal C-List (GTs for current node)
; CR5 = Thread C-List (thread parameters, constants, C/D objects)

; Setup: Load the self-referencing GT from C-List (CR6)
LOAD 0 6 0        ; CR0 = GT to self from nodal C-List

; Step 1: Create inner lambda (λx.f(x x))
; The GT in CR0 points to code that will call itself
TPERM 0 X         ; Verify CR0 has Execute permission
B NE fault        ; Any failure -> FAULT (failsafe)

; Step 2: Apply f to (x x) - self-application via CALL
CALL 0            ; Execute the GT - this is (x x)

; Step 3: The called function receives its own GT
; enabling recursion without explicit self-reference
; The callee can CALL CR0 to recurse

; On return, result is in DR0
RETURN            ; Return from Y-combinator application

; === FAILSAFE: No error codes ===
fault:
FAULT             ; Uniform failure - no information leakage`,

    'factorial': `; ================================================
; FACTORIAL using recursive GT calls
; fact(n) = n * fact(n-1), fact(0) = 1
; Input: DR0 = n, Output: DR0 = n!
; ================================================
; CR6 = Nodal C-List (GTs for current node)
; CR5 = Thread C-List (thread parameters, constants, C/D objects)

; Base case check
CMP 0 0           ; Compare DR0 with 0
B EQ base_case    ; If n == 0, return 1

; Recursive case: n * fact(n-1)
MOV 1 0           ; DR1 = n (save for multiplication)
SUBI 0 1          ; DR0 = n - 1

; Load recursive GT from nodal C-List (CR6)
LOAD 0 6 0        ; CR0 = GT to factorial from C-List
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
B NE fault        ; If missing -> FAULT (no error codes!)

; Step 2: Test bounds (optional size check)
TPERM 0 B         ; Verify has Bind permission
B NE fault        ; If missing -> FAULT

; Step 3: Capability is valid - proceed
LOAD 1 0 0        ; Use the validated capability
; ... safe operations here ...
RETURN

; === FAILSAFE: Single failure mode ===
; No error codes - prevents information leakage
; Attacker cannot learn WHICH check failed
fault:
FAULT             ; Uniform failure - no leakage`,

    'church_bool': `; ================================================
; CHURCH BOOLEANS using Golden Tokens
; TRUE  = λx.λy.x  (select first)
; FALSE = λx.λy.y  (select second)
; ================================================
; CR6 = Nodal C-List (GTs for current node)
; CR5 = Thread C-List (thread parameters, constants, C/D objects)

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
; Load TRUE/FALSE from nodal C-List (CR6)
not:
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
; CR6 = Nodal C-List (GTs for current node)
; CR5 = Thread C-List (thread parameters, constants, C/D objects)

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
; CR6 = Nodal C-List (GTs for current node)
; CR5 = Thread C-List (thread parameters, constants, C/D objects)

; PAIR: Create a pair from two values
; Input: CR1=first, CR2=second
; Returns: GT that when called with selector returns element
pair:
; Store a and b, return selector function
; The returned GT captures CR1 and CR2
LOAD 0 6 0        ; CR0 = GT to pair_select from C-List
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
LOAD 1 6 1        ; CR1 = TRUE GT from C-List
CALL 0            ; pair(TRUE) -> first element
RETURN

; SND: Get second element of pair
; Input: CR0 = pair
snd:
LOAD 1 6 2        ; CR1 = FALSE GT from C-List
CALL 0            ; pair(FALSE) -> second element
RETURN`,

    'circle': `; ================================================
; CIRCLE ABSTRACTION using Golden Tokens
; Demonstrates using GT constants from Thread C-List
; ================================================
; CR6 = Nodal C-List (circle operation GTs)
; CR5 = Thread C-List (constants like PI)
;
; Thread C-List (CR5) layout:
;   [0] = PI constant GT (value: 3.14159...)
;   [1] = TWO_PI constant GT
;
; Circle C-List (CR6) layout:
;   [0] = circumference GT
;   [1] = area GT
;   [2] = diameter GT

; ------------------------------------------------
; CIRCUMFERENCE: C = 2 * PI * r
; Input: DR0 = radius
; Output: DR0 = circumference
; ------------------------------------------------
circumference:
LOAD 0 5 0        ; CR0 = PI GT from Thread C-List
TPERM 0 R         ; Verify read permission on constant
; DR1 = PI value (loaded from GT data)
MUL 0 1           ; DR0 = r * PI
ADDI 1 2          ; DR1 = 2
MUL 0 1           ; DR0 = 2 * PI * r
RETURN

; ------------------------------------------------
; AREA: A = PI * r^2
; Input: DR0 = radius
; Output: DR0 = area
; ------------------------------------------------
area:
MOV 1 0           ; DR1 = r (save radius)
MUL 0 1           ; DR0 = r * r = r^2
LOAD 0 5 0        ; CR0 = PI GT from Thread C-List
TPERM 0 R         ; Verify read permission
; DR2 = PI value
MUL 0 2           ; DR0 = PI * r^2
RETURN

; ------------------------------------------------
; DIAMETER: D = 2 * r
; Input: DR0 = radius
; Output: DR0 = diameter
; ------------------------------------------------
diameter:
ADDI 1 2          ; DR1 = 2
MUL 0 1           ; DR0 = 2 * r
RETURN

; ------------------------------------------------
; Usage example:
; LOAD 0 6 0      ; Load circumference GT from Circle C-List
; ADDI 0 5        ; DR0 = radius = 5
; CALL 0          ; Calculate circumference
; Result in DR0
; ------------------------------------------------`,

    'omega': `; ================================================
; OMEGA - Non-termination example
; ω = λx.x x
; Ω = ω ω = (λx.x x)(λx.x x) -> infinite loop
; WARNING: This will not terminate!
; ================================================
; CR6 = Nodal C-List (GTs for current node)
; CR5 = Thread C-List (thread parameters, constants, C/D objects)

; Self-application: λx.x x
omega:
LOAD 0 0 0        ; CR0 = self (x)
TPERM 0 X         ; Verify executable
CALL 0            ; x x (call self with self)
; Never reaches here if truly self-referential
RETURN

; To create Ω, call omega with itself:
; LOAD 0 6 n      ; Load omega GT from C-List (CR6)
; CALL 0          ; This triggers infinite recursion
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
    'TPERM': 'Test permissions and bounds on capability'
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
        if (e.target && e.target.closest && !e.target.closest('.code-context-menu')) {
            hideCodeContextMenu();
        }
    });
    
    // Global Ctrl+Z handler for editor view
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
            // Only handle if we're on the editor view
            if (currentView === 'editor') {
                e.preventDefault();
                e.stopPropagation();
                undoCodeChange();
            }
        }
    });
    
    // Initialize currentView from DOM to sync with actual active view
    const activeView = document.querySelector('.view.active');
    if (activeView) {
        currentView = activeView.id;
    }
});

// ============ Instructions View ============

const churchInstrFormats = [
    {
        name: "LOAD",
        brief: "Load GT from C-List to CR",
        syntax: "LOAD CRd, [CRn+idx]",
        desc: "Copy Golden Token from C-List slot into Context Register.",
        format: [
            { name: "Cond", bits: 4, desc: "Condition code (AL=always)" },
            { name: "Op", bits: 6, value: "000001", desc: "LOAD opcode" },
            { name: "CRd", bits: 3, desc: "Destination CR (0-7)" },
            { name: "CRn", bits: 3, desc: "Source C-List register (0-7)" },
            { name: "Reserved", bits: 2, value: "0", desc: "Reserved (CR8-15 meta-machine only)" },
            { name: "I", bits: 1, desc: "0=immediate offset, 1=register" },
            { name: "Index", bits: 13, desc: "Offset or DR number" }
        ],
        variants: [
            { name: "Immediate", fields: { I: "0", Index: "Literal offset 0-8191" } },
            { name: "Register", fields: { I: "1", Index: "Index[3:0] = DR number" } }
        ]
    },
    {
        name: "SAVE",
        brief: "Save CR to C-List slot",
        syntax: "SAVE CRs, [CRn+idx]",
        desc: "Copy Context Register GT into C-List slot.",
        format: [
            { name: "Cond", bits: 4, desc: "Condition code" },
            { name: "Op", bits: 6, value: "000010", desc: "SAVE opcode" },
            { name: "CRs", bits: 3, desc: "Source CR (0-7)" },
            { name: "CRn", bits: 3, desc: "Target C-List register (0-7)" },
            { name: "Reserved", bits: 2, value: "0", desc: "Reserved (CR8-15 meta-machine only)" },
            { name: "I", bits: 1, desc: "0=immediate offset, 1=register" },
            { name: "Index", bits: 13, desc: "Offset or DR number" }
        ],
        variants: [
            { name: "Immediate", fields: { I: "0", Index: "Literal offset 0-8191" } },
            { name: "Register", fields: { I: "1", Index: "Index[3:0] = DR number" } }
        ]
    },
    {
        name: "CALL",
        brief: "Enter abstraction",
        syntax: "CALL CRs",
        desc: "Transfer control to abstraction entry point. Pushes return state, switches context.",
        format: [
            { name: "Cond", bits: 4, desc: "Condition code" },
            { name: "Op", bits: 6, value: "000011", desc: "CALL opcode" },
            { name: "CRs", bits: 3, desc: "Abstraction capability (0-7)" },
            { name: "Reserved", bits: 1, value: "0", desc: "Reserved" },
            { name: "L", bits: 1, desc: "Link bit (save return)" },
            { name: "Reserved", bits: 17, value: "0", desc: "Must be zero" }
        ],
        variants: [
            { name: "CALL", fields: { L: "0 = no link" } },
            { name: "CALLL", fields: { L: "1 = save return address" } }
        ]
    },
    {
        name: "RETURN",
        brief: "Return from call",
        syntax: "RETURN",
        desc: "Return from CALL. Pops return address, restores caller context.",
        format: [
            { name: "Cond", bits: 4, desc: "Condition code" },
            { name: "Op", bits: 6, value: "000100", desc: "RETURN opcode" },
            { name: "Reserved", bits: 22, value: "0", desc: "Must be zero" }
        ],
        variants: []
    },
    {
        name: "CHANGE",
        brief: "Switch thread identity",
        syntax: "CHANGE CRn, idx | CHANGE nsOffset",
        desc: "Load new thread capability into CR8.",
        format: [
            { name: "Cond", bits: 4, desc: "Condition code" },
            { name: "Op", bits: 6, value: "000101", desc: "CHANGE opcode" },
            { name: "Mode", bits: 1, desc: "0=NS offset, 1=C-List lookup" },
            { name: "CRn", bits: 3, desc: "Source C-List (0-7, Mode=1)" },
            { name: "Reserved", bits: 1, value: "0", desc: "Reserved" },
            { name: "Idx/Offset", bits: 17, desc: "C-List index or NS offset" }
        ],
        variants: [
            { name: "NS Offset", fields: { Mode: "0", Idx: "Namespace offset" } },
            { name: "C-List", fields: { Mode: "1", CRn: "C-List register, Idx: slot" } }
        ]
    },
    {
        name: "SWITCH",
        brief: "Switch C-List context",
        syntax: "SWITCH CRs | SWITCH CRn, idx",
        desc: "Load new C-List capability into CR6.",
        format: [
            { name: "Cond", bits: 4, desc: "Condition code" },
            { name: "Op", bits: 6, value: "000110", desc: "SWITCH opcode" },
            { name: "Mode", bits: 1, desc: "0=direct CR, 1=C-List lookup" },
            { name: "CRs", bits: 3, desc: "Source CR (0-7, Mode=0)" },
            { name: "CRn", bits: 3, desc: "Source C-List (0-7, Mode=1)" },
            { name: "Reserved", bits: 2, value: "0", desc: "Reserved (CR8-15 meta-machine only)" },
            { name: "Index", bits: 13, desc: "C-List slot index (Mode=1)" }
        ],
        variants: [
            { name: "Direct", fields: { Mode: "0", CRs: "CR containing C-List GT" } },
            { name: "C-List lookup", fields: { Mode: "1", CRn: "C-List register, Index: slot" } }
        ]
    },
    {
        name: "TPERM",
        brief: "Test GT permissions and bounds",
        syntax: "TPERM CRs, permMask [, index]",
        desc: "Compare CR permission bits against mask. Optional index validates against object size from namespace metadata (W2 limit). Sets Z=1 if all checks pass.",
        format: [
            { name: "Cond", bits: 4, desc: "Condition code" },
            { name: "Op", bits: 6, value: "000111", desc: "TPERM opcode" },
            { name: "CRs", bits: 3, desc: "CR to test (0-7)" },
            { name: "I", bits: 1, desc: "Index present (1=yes)" },
            { name: "Perms", bits: 9, desc: "Permission mask (9 bits: R W X L S E B M F)" },
            { name: "Index", bits: 9, desc: "Access index to validate against W2 limit (if I=1)" }
        ],
        variants: [
            { name: "Perms only", fields: { I: "0", Perms: "Permission bits to test" } },
            { name: "Perms + Index", fields: { I: "1", Perms: "Permission bits", Index: "Offset to validate < W2 limit" } }
        ]
    }
];

const turingInstrFormats = [
    {
        name: "Data Processing",
        brief: "ADD, SUB, AND, ORR, EOR, etc.",
        syntax: "OP{cond}{S} DRd, DRn, DRm/#imm",
        desc: "ARM-style ALU operations on Data Registers with optional flag updates.",
        format: [
            { name: "Cond", bits: 4, desc: "Condition code (4 bits)" },
            { name: "00", bits: 2, value: "00", desc: "Data processing ID" },
            { name: "I", bits: 1, desc: "Immediate flag (1=imm)" },
            { name: "Opcode", bits: 4, desc: "Operation: ADD=0100" },
            { name: "S", bits: 1, desc: "Set flags (1=yes)" },
            { name: "DRn", bits: 4, desc: "First operand register" },
            { name: "DRd", bits: 4, desc: "Destination register" },
            { name: "Operand2", bits: 12, desc: "Shift/Imm (see variants)" }
        ],
        variants: [
            { name: "Register", fields: { I: "0", Operand2: "Shift[11:5] | Type[6:5] | DRm[3:0]" } },
            { name: "Immediate", fields: { I: "1", Operand2: "Rotate[11:8] | Imm8[7:0]" } }
        ],
        opcodes: [
            { code: "0000", name: "AND", desc: "Rd = Rn & Op2" },
            { code: "0001", name: "EOR", desc: "Rd = Rn ^ Op2" },
            { code: "0010", name: "SUB", desc: "Rd = Rn - Op2" },
            { code: "0100", name: "ADD", desc: "Rd = Rn + Op2" },
            { code: "1010", name: "CMP", desc: "Rn - Op2 (flags only)" },
            { code: "1100", name: "ORR", desc: "Rd = Rn | Op2" },
            { code: "1101", name: "MOV", desc: "Rd = Op2" },
            { code: "1110", name: "BIC", desc: "Rd = Rn & ~Op2" },
            { code: "1111", name: "MVN", desc: "Rd = ~Op2" }
        ]
    },
    {
        name: "Multiply",
        brief: "MUL, MLA, UMULL, SMULL",
        syntax: "MUL{cond}{S} DRd, DRn, DRm",
        desc: "32/64-bit multiply operations with optional accumulate.",
        format: [
            { name: "Cond", bits: 4, desc: "Condition code" },
            { name: "0000", bits: 4, value: "0000", desc: "Multiply ID" },
            { name: "A", bits: 1, desc: "Accumulate flag" },
            { name: "S", bits: 1, desc: "Set flags" },
            { name: "DRd", bits: 4, desc: "Destination (lo)" },
            { name: "DRa", bits: 4, desc: "Accumulate reg" },
            { name: "DRm", bits: 4, desc: "Multiplier" },
            { name: "1001", bits: 4, value: "1001", desc: "Multiply signature" },
            { name: "DRn", bits: 4, desc: "Multiplicand" },
            { name: "U", bits: 1, desc: "Unsigned flag" },
            { name: "L", bits: 1, desc: "Long (64-bit)" }
        ],
        variants: [
            { name: "MUL", fields: { A: "0", U: "x", L: "0" } },
            { name: "MLA", fields: { A: "1", U: "x", L: "0" } },
            { name: "UMULL", fields: { A: "0", U: "1", L: "1" } },
            { name: "SMULL", fields: { A: "0", U: "0", L: "1" } }
        ]
    },
    {
        name: "Branch",
        brief: "B, BL, BX",
        syntax: "B{cond} offset / BL{cond} offset",
        desc: "PC-relative branch with optional link (subroutine call).",
        format: [
            { name: "Cond", bits: 4, desc: "Condition code" },
            { name: "101", bits: 3, value: "101", desc: "Branch ID" },
            { name: "L", bits: 1, desc: "Link bit (1=BL)" },
            { name: "Offset", bits: 24, desc: "Signed offset (<<2)" }
        ],
        variants: [
            { name: "B", fields: { L: "0 = Branch only" } },
            { name: "BL", fields: { L: "1 = Save LR, branch" } }
        ],
        conditions: [
            { code: "0000", name: "EQ", desc: "Z=1 (equal)" },
            { code: "0001", name: "NE", desc: "Z=0 (not equal)" },
            { code: "1010", name: "GE", desc: "N=V (>=)" },
            { code: "1011", name: "LT", desc: "N!=V (<)" },
            { code: "1100", name: "GT", desc: "Z=0, N=V (>)" },
            { code: "1101", name: "LE", desc: "Z=1 or N!=V (<=)" },
            { code: "1110", name: "AL", desc: "Always execute" }
        ]
    },
    {
        name: "Load/Store",
        brief: "LDR, STR (Data Registers)",
        syntax: "LDR{cond} DRd, [DRn, #offset]",
        desc: "Load/Store Data Register from memory via capability bounds.",
        format: [
            { name: "Cond", bits: 4, desc: "Condition code" },
            { name: "01", bits: 2, value: "01", desc: "Load/Store ID" },
            { name: "I", bits: 1, desc: "Immediate offset" },
            { name: "P", bits: 1, desc: "Pre/post index" },
            { name: "U", bits: 1, desc: "Up/down offset" },
            { name: "B", bits: 1, desc: "Byte/word" },
            { name: "W", bits: 1, desc: "Writeback" },
            { name: "L", bits: 1, desc: "Load/Store (1=load)" },
            { name: "DRn", bits: 4, desc: "Base register" },
            { name: "DRd", bits: 4, desc: "Src/Dest register" },
            { name: "Offset", bits: 12, desc: "Offset (imm or reg)" }
        ],
        variants: [
            { name: "LDR", fields: { L: "1", B: "0 = 64-bit word" } },
            { name: "STR", fields: { L: "0", B: "0 = 64-bit word" } },
            { name: "LDRB", fields: { L: "1", B: "1 = byte" } },
            { name: "STRB", fields: { L: "0", B: "1 = byte" } }
        ]
    },
    {
        name: "Shift",
        brief: "LSL, LSR, ASR, ROR",
        syntax: "LSL{cond}{S} DRd, DRn, #amt/DRm",
        desc: "Logical/arithmetic shifts and rotates. Encoded via Data Processing.",
        format: [
            { name: "Cond", bits: 4, desc: "Condition code" },
            { name: "00", bits: 2, value: "00", desc: "Data processing" },
            { name: "0", bits: 1, value: "0", desc: "Register mode" },
            { name: "1101", bits: 4, value: "1101", desc: "MOV opcode" },
            { name: "S", bits: 1, desc: "Set flags" },
            { name: "0000", bits: 4, value: "0000", desc: "Rn unused" },
            { name: "DRd", bits: 4, desc: "Destination" },
            { name: "Shift", bits: 5, desc: "Shift amount" },
            { name: "Type", bits: 2, desc: "Shift type" },
            { name: "0", bits: 1, value: "0", desc: "Immediate shift" },
            { name: "DRm", bits: 4, desc: "Source register" }
        ],
        variants: [
            { name: "LSL", fields: { Type: "00 = Logical left" } },
            { name: "LSR", fields: { Type: "01 = Logical right" } },
            { name: "ASR", fields: { Type: "10 = Arithmetic right" } },
            { name: "ROR", fields: { Type: "11 = Rotate right" } }
        ]
    }
];

function switchInstrTab(tab) {
    const churchPanel = document.getElementById('instrChurch');
    const turingPanel = document.getElementById('instrTuring');
    const tabChurch = document.getElementById('tabChurch');
    const tabTuring = document.getElementById('tabTuring');
    
    if (tab === 'church') {
        churchPanel.classList.remove('hidden');
        turingPanel.classList.add('hidden');
        tabChurch.classList.add('active');
        tabTuring.classList.remove('active');
    } else {
        churchPanel.classList.add('hidden');
        turingPanel.classList.remove('hidden');
        tabChurch.classList.remove('active');
        tabTuring.classList.add('active');
    }
}

function renderBitField(field, startBit, totalBits) {
    const endBit = startBit - field.bits + 1;
    const width = (field.bits / totalBits) * 100;
    const bitRange = field.bits === 1 ? `${startBit}` : `${startBit}:${endBit}`;
    const hasValue = field.value !== undefined;
    const valueInfo = hasValue ? ` Value: ${field.value}` : '';
    const tooltip = `${field.name} (${field.bits} bits, ${bitRange}): ${field.desc}${valueInfo}`;
    
    return `
        <div class="bit-field ${hasValue ? 'bit-fixed' : ''}" style="flex: 0 0 ${width.toFixed(2)}%;" data-tooltip="${tooltip}">
            <div class="bit-range">${bitRange}</div>
            <div class="bit-name">${field.name}</div>
            <div class="bit-width">${field.bits}</div>
        </div>
    `;
}

function renderInstrFormat(instr) {
    const totalBits = instr.format.reduce((sum, f) => sum + f.bits, 0);
    let bitPos = totalBits - 1;
    const fieldsHtml = instr.format.map(field => {
        const html = renderBitField(field, bitPos, totalBits);
        bitPos -= field.bits;
        return html;
    }).join('');
    
    let variantsHtml = '';
    if (instr.variants && instr.variants.length > 0) {
        variantsHtml = `
            <div class="instr-variants">
                <div class="variant-label">Variants:</div>
                ${instr.variants.map(v => `
                    <div class="variant-item">
                        <span class="variant-name">${v.name}</span>
                        <span class="variant-fields">${Object.entries(v.fields).map(([k, val]) => `${k}=${val}`).join(', ')}</span>
                    </div>
                `).join('')}
            </div>
        `;
    }
    
    let opcodesHtml = '';
    if (instr.opcodes) {
        opcodesHtml = `
            <div class="instr-opcodes">
                <div class="opcode-label">Opcodes:</div>
                <div class="opcode-grid">
                    ${instr.opcodes.map(op => `
                        <div class="opcode-item">
                            <span class="opcode-code">${op.code}</span>
                            <span class="opcode-name">${op.name}</span>
                            <span class="opcode-desc">${op.desc}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }
    
    let conditionsHtml = '';
    if (instr.conditions) {
        conditionsHtml = `
            <div class="instr-conditions">
                <div class="cond-label">Conditions:</div>
                <div class="cond-grid">
                    ${instr.conditions.map(c => `
                        <div class="cond-item">
                            <span class="cond-code">${c.code}</span>
                            <span class="cond-name">${c.name}</span>
                            <span class="cond-desc">${c.desc}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }
    
    let notesHtml = '';
    if (instr.notes) {
        notesHtml = `
            <div class="instr-notes">
                <span class="notes-icon">!</span>
                <span class="notes-text">${instr.notes}</span>
            </div>
        `;
    }
    
    return `
        <div class="instr-format-card">
            <div class="instr-format-header">
                <span class="instr-format-name">${instr.name}</span>
                <span class="instr-format-syntax">${instr.syntax}</span>
            </div>
            <div class="instr-format-brief">${instr.brief}</div>
            <div class="instr-format-desc">${instr.desc}</div>
            ${notesHtml}
            <div class="bit-diagram">
                <div class="bit-fields">${fieldsHtml}</div>
                <div class="field-descs">
                    ${instr.format.map(f => `
                        <div class="field-desc-item">
                            <span class="field-desc-name">${f.name}</span>
                            <span class="field-desc-text">${f.desc}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            ${variantsHtml}
            ${opcodesHtml}
            ${conditionsHtml}
        </div>
    `;
}

function initInstructionsView() {
    const churchGrid = document.getElementById('churchInstrGrid');
    const turingGrid = document.getElementById('turingInstrGrid');
    
    if (churchGrid) {
        churchGrid.innerHTML = churchInstrFormats.map(renderInstrFormat).join('');
    }
    
    if (turingGrid) {
        turingGrid.innerHTML = turingInstrFormats.map(renderInstrFormat).join('');
    }
}

// Initialize instructions view on load
document.addEventListener('DOMContentLoaded', () => {
    initInstructionsView();
});
