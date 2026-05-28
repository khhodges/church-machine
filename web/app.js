let savedEditorContent = '';
let currentView = 'dashboard';
let currentZoomAbstraction = null;
const mathTypeBadges = {
    'SlideRule': 'FLOAT',
    'Abacus': 'INTEGER',
    'Circle': 'GEOMETRY',
    'Mint': 'SYSTEM',
    'CapabilityManager': 'SYSTEM',
    'DateTime': 'TIME',
    'Lambda': 'FUNCTIONAL',
    'Constants': 'CONSTANT',
    'Stack': 'RPN',
    'HP35': 'CALCULATOR',
    'FamilyRegistry': 'NETWORK'
};
let currentUser = null;
let viewingTutorialFromLanding = false;

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
    
    const backBtn = document.getElementById('tutorialBackToLanding');
    if (backBtn) {
        if (viewId === 'tutorial' && viewingTutorialFromLanding) {
            backBtn.style.display = 'inline-block';
        } else {
            backBtn.style.display = 'none';
            if (viewId !== 'tutorial') {
                viewingTutorialFromLanding = false;
            }
        }
    }
    
    if (viewId === 'capabilities') {
        updateCapabilityExplorer();
    }
    
    if (viewId === 'abstractionZoom') {
        renderAbstractionZoom();
    }
    
    if (viewId === 'hp35calc') {
        renderHP35Calculator();
    }
    
    if (viewId === 'dashboard') {
        updateDisplay();
    }
    
    if (viewId === 'namespace') {
        updateNamespaceDisplay();
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
    window.location.hash = viewId;
    try { localStorage.setItem('ctmm_lastView', viewId); } catch(e) {}
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
// Bits 32-37: Permissions (R/W/X/L/S/E - 6 bits only)
// Bits 38-47: Version (10 bits, reallocated from removed B/M/F/G)
// Bits 48-63: Type (16 bits — Inform/Outform/NULL/Abstract)

const PERM_BITS = {
    R: 0x0001, W: 0x0002, X: 0x0004, L: 0x0008,
    S: 0x0010, E: 0x0020
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
// GT permissions are defined in Boot C-List or Services C-List, NOT here
// Offset = index into this table
// Minimal boot namespace — grows at runtime via CALL(Thread.Mint(type, size, access))
let namespaceObjects = [
    { offset: 0, name: "Namespace", type: "System",
      word1_location: 0x0000, word2_limit: 0x10000, word3_seals: 0n,
      tooltip: "Hardware-managed Namespace Table — root of all capability addressing. The single wired GT." },
    { offset: 1, name: "Kenneth", type: "Thread",
      word1_location: 0x1000, word2_limit: 0x0800, word3_seals: 0n,
      tooltip: "Primary user thread identity. CR8 points here. M elevated on CR by microcode only." },
    { offset: 2, name: "Services", type: "C-List",
      word1_location: 0x2000, word2_limit: 0x0100, word3_seals: 0n,
      tooltip: "Services C-List — stable in CR5. Contains self[E] → Namespace[E] → Mint, GC, Lookup." },
    { offset: 3, name: "Boot", type: "C-List",
      word1_location: 0x3000, word2_limit: 0x0100, word3_seals: 0n,
      tooltip: "Root abstraction C-List — loaded into CR6. Symbolic method names for available abstractions." },
    { offset: 4, name: "Access", type: "Code", linkage: "Boot/Access.asm",
      word1_location: 0x4000, word2_limit: 0x1000, word3_seals: 0n,
      tooltip: "Boot nucleus code — loaded into CR7. Resolves symbolic names from CR6 to executable code." },
    { offset: 5, name: "SlideRule", type: "Abstraction",
      word1_location: 0x5000, word2_limit: 0x1000, word3_seals: 0n,
      tooltip: "SlideRule [FLOAT] — IEEE 754 floating-point math. Method-selector dispatch (DR0=method)." },
    { offset: 6, name: "Abacus", type: "Abstraction",
      word1_location: 0x6000, word2_limit: 0x1000, word3_seals: 0n,
      tooltip: "Abacus [INTEGER] — 64-bit integer arithmetic. Method-selector dispatch (DR0=method)." },
    { offset: 7, name: "Circle", type: "Abstraction",
      word1_location: 0x7000, word2_limit: 0x1000, word3_seals: 0n,
      tooltip: "Circle [GEOMETRY] — PI, circumference, area. Method-selector dispatch (DR0=method)." },
    { offset: 8, name: "Mint", type: "Abstraction",
      word1_location: 0xC000, word2_limit: 0x1000, word3_seals: 0n,
      tooltip: "Namespace Mint method — creates new GTs with domain-pure permissions via CALL(Thread.Mint)." },
    { offset: 9, name: "CapabilityManager", type: "Abstraction",
      word1_location: 0xD000, word2_limit: 0x1000, word3_seals: 0n,
      tooltip: "CapabilityManager — simplified Mint: creates Data [RWX] or C-List [LSE] objects." },
    { offset: 10, name: "DateTime", type: "Abstraction",
      word1_location: 0x9000, word2_limit: 0x1000, word3_seals: 0n,
      tooltip: "DateTime [TIME] — ISO 8601 date/time. DR0=mode → DR1-DR6 components." },
    { offset: 11, name: "Lambda", type: "Abstraction",
      word1_location: 0xA000, word2_limit: 0x2000, word3_seals: 0n,
      tooltip: "Lambda [FUNCTIONAL] — Church calculus primitives: Y-Combinator, Church numerals, Pairs, Booleans." },
    { offset: 12, name: "Constants", type: "Abstraction",
      word1_location: 0xE000, word2_limit: 0x1000, word3_seals: 0n,
      tooltip: "Constants [CONSTANT] — Physical and mathematical constants as Abstract GTs. Unforgeable, incorruptible identity tokens for PI, E, PHI, c, h, k_B, N_A, G." },
    { offset: 13, name: "Stack", type: "Abstraction",
      word1_location: 0xF000, word2_limit: 0x1000, word3_seals: 0n,
      tooltip: "Stack [RPN] — Church-encoded RPN stack using nested pairs. PUSH, POP, SWAP, DUP, PEEK, CLEAR. stack = PAIR(top, rest), empty = FALSE." },
    { offset: 14, name: "HP35", type: "Abstraction",
      word1_location: 0x10000, word2_limit: 0x2000, word3_seals: 0n,
      tooltip: "HP35 [CALCULATOR] — HP-35 scientific calculator. Pure lambda calculus RPN engine. Digit entry, arithmetic (+,−,×,÷), scientific (√,sin,cos,log,exp), stack ops (ENTER,swap,CLR)." },
    { offset: 15, name: "FamilyRegistry", type: "Abstraction",
      word1_location: 0x12000, word2_limit: 0x2000, word3_seals: 0n,
      tooltip: "FamilyRegistry [NETWORK] — Secure machine-to-machine binding. Creates namespace entries with remote endpoint addresses at bind time. No DNS, no IP lookup — the capability IS the address. F(Far) flag for remote execution, B(Bind) for permanent binding." }
];

// Services C-List at Namespace offset 2
// Stable in CR5 — set at boot, never changes on CALL/RETURN
// Contains self[E] (Thread abstraction), which gives access to Namespace methods
const servicesCList = {
    name: "Services",
    description: "Thread's available services — stable in CR5",
    nsOffset: 2,
    entries: [
        { index: 0, name: "self", nsOffset: 1, perms: ["E"], type: "Thread",
          desc: "Thread's own abstraction — gateway to Namespace.Mint, GC, Lookup" },
        { index: 1, name: "Namespace", nsOffset: 0, perms: ["E"], type: "System",
          desc: "Namespace abstraction — contains Mint, GC, Lookup methods (accessed via self)" }
    ]
};

// Boot C-List at Namespace offset 3
// Root abstraction C-List — loaded into CR6. Contains symbolic method names.
// Dynamic — switches on every CALL/RETURN.
const bootCList = {
    name: "Boot",
    description: "Root abstraction C-List — symbolic entries for available abstractions",
    nsOffset: 3,
    entries: [
        { index: 0, name: "NULL", nsOffset: -1, perms: [], type: "NULL",
          desc: "NULL Golden Token — clears any CR when loaded", size: 0 },
        { index: 1, name: "Access", nsOffset: 4, perms: ["R", "X"], type: "Code",
          desc: "Boot nucleus code — hardware-enforced CALL entry point (slot 1)", size: 0x1000 },
        { index: 2, name: "SlideRule", nsOffset: 5, perms: ["E"], type: "Abstraction",
          desc: "IEEE 754 float operations — method-selector dispatch (DR0=method)", size: 0x1000 },
        { index: 3, name: "Abacus", nsOffset: 6, perms: ["E"], type: "Abstraction",
          desc: "64-bit integer operations — method-selector dispatch (DR0=method)", size: 0x1000 },
        { index: 4, name: "Circle", nsOffset: 7, perms: ["E"], type: "Abstraction",
          desc: "Circle geometry — PI, circumference, area. method-selector dispatch (DR0=method)", size: 0x1000 },
        { index: 5, name: "Mint", nsOffset: 8, perms: ["E"], type: "Abstraction",
          desc: "Namespace Mint method — creates new GTs. CALL(Thread.Mint(type, size, access))", size: 0x1000 },
        { index: 6, name: "CapabilityManager", nsOffset: 9, perms: ["E"], type: "Abstraction",
          desc: "Creates Data [RWX] and C-List [LSE] objects. Simplified Mint interface", size: 0x1000 },
        { index: 7, name: "DateTime", nsOffset: 10, perms: ["E"], type: "Abstraction",
          desc: "ISO 8601 date/time. DR0=mode → DR1-DR6 components", size: 0x1000 },
        { index: 8, name: "Lambda", nsOffset: 11, perms: ["E"], type: "Abstraction",
          desc: "Church lambda calculus primitives — Y-Combinator, Church numerals, Pairs, Booleans", size: 0x2000 },
        { index: 9, name: "Constants", nsOffset: 12, perms: ["E"], type: "Abstraction",
          desc: "Physical/mathematical constants as Abstract GTs — PI, E, PHI, c, h, k_B, N_A, G", size: 0x1000 },
        { index: 10, name: "Stack", nsOffset: 13, perms: ["E"], type: "Abstraction",
          desc: "Church-encoded RPN stack — PUSH, POP, SWAP, DUP, PEEK, CLEAR via nested pairs", size: 0x1000 },
        { index: 11, name: "HP35", nsOffset: 14, perms: ["E"], type: "Abstraction",
          desc: "HP-35 scientific calculator — pure lambda calculus RPN engine", size: 0x2000 },
        { index: 12, name: "FamilyRegistry", nsOffset: 15, perms: ["E"], type: "Abstraction",
          desc: "Secure machine-to-machine binding — remote endpoint addresses at bind time", size: 0x2000 }
    ]
};

// Permission validation constants - 6 GT permission bits only (R,W,X,L,S,E)
const DATA_PERMS = ['R', 'W', 'X'];  // Data permissions - for data/code access
const LAMBDA_PERMS = ['L', 'S', 'E'];  // Lambda permissions - for capability operations
const ALL_GT_PERMS = ['R', 'W', 'X', 'L', 'S', 'E'];

// Validate permission combinations
function validatePermissions(perms) {
    const errors = [];
    
    const invalidPerms = perms.filter(p => !ALL_GT_PERMS.includes(p));
    if (invalidPerms.length > 0) {
        errors.push({
            type: 'critical',
            msg: `Invalid GT permissions: ${invalidPerms.join(', ')}. Only R,W,X,L,S,E are valid GT permissions.`
        });
    }
    
    return errors;
}

// Normalize permissions to enforce all rules
function normalizePermissions(perms) {
    if (!perms || !Array.isArray(perms)) return [];
    
    return perms.filter(p => ALL_GT_PERMS.includes(p));
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
    return bootCList.entries.find(e => e.name === name) ||
           servicesCList.entries.find(e => e.name === name);
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
    location: 0x3000,
    description: "Root abstraction of the CM system",
    clist: bootCList.entries.map(e => ({ name: e.name, type: e.type, perms: e.perms, ref: `ns.offset.${e.nsOffset}` }))
};

const threadCLists = {
    Kenneth: {
        name: "Kenneth",
        description: "Primary thread — one thread at boot, others minted at runtime. Boot C-List (CR6) provides SlideRule, Abacus, Circle, DateTime, Lambda, Constants. Services C-List (CR5) provides self, Namespace, Mint.",
        clist: []
    }
};

const abstractionCLists = {
    SlideRule: {
        name: "SlideRule",
        mathType: "FLOAT",
        description: "IEEE 754 floating-point math. DR0=method selector: 0=ADD, 1=SUB, 2=MUL, 3=DIV, 4=MOD, 5=LOG, 6=EXP, 7=SQRT, 8=POW. Args: DR1=a, DR2=b (binary ops). Result in DR0.",
        methodSelector: { 0: 'ADD', 1: 'SUB', 2: 'MUL', 3: 'DIV', 4: 'MOD', 5: 'LOG', 6: 'EXP', 7: 'SQRT', 8: 'POW' },
        clist: [
            { name: "NULL", type: "NULL", perms: [], desc: "NULL Golden Token — clears any CR when loaded", size: 0 },
            { name: "Access", type: "Code", perms: ["R", "X"], desc: "Method dispatcher — DR0 selects operation (0=ADD, 1=SUB, 2=MUL, 3=DIV, 4=MOD, 5=LOG, 6=EXP, 7=SQRT, 8=POW)", base: 0x5000, size: 0x1000 },
            { name: "LocalData", type: "Data", perms: ["R", "W"], base: 0x5A00, size: 512 }
        ]
    },
    Abacus: {
        name: "Abacus",
        mathType: "INTEGER",
        description: "64-bit integer arithmetic. DR0=method selector: 0=ADD, 1=SUB, 2=MUL, 3=DIV, 4=MOD, 5=ABS, 6=NEG, 7=INC, 8=DEC. Args: DR1=a, DR2=b (binary ops). Result in DR0.",
        methodSelector: { 0: 'ADD', 1: 'SUB', 2: 'MUL', 3: 'DIV', 4: 'MOD', 5: 'ABS', 6: 'NEG', 7: 'INC', 8: 'DEC' },
        clist: [
            { name: "NULL", type: "NULL", perms: [], desc: "NULL Golden Token — clears any CR when loaded", size: 0 },
            { name: "Access", type: "Code", perms: ["R", "X"], desc: "Method dispatcher — DR0 selects operation (0=ADD, 1=SUB, 2=MUL, 3=DIV, 4=MOD, 5=ABS, 6=NEG, 7=INC, 8=DEC)", base: 0x6000, size: 0x1000 },
            { name: "LocalData", type: "Data", perms: ["R", "W"], base: 0x6800, size: 512 }
        ]
    },
    Circle: {
        name: "Circle",
        mathType: "GEOMETRY",
        description: "Circle geometry. DR0=method selector: 0=PI, 1=TWO_PI, 2=CIRCUMFERENCE, 3=AREA, 4=DIAMETER. DR1=radius for computation methods. Result in DR0.",
        methodSelector: { 0: 'PI', 1: 'TWO_PI', 2: 'CIRCUMFERENCE', 3: 'AREA', 4: 'DIAMETER' },
        clist: [
            { name: "NULL", type: "NULL", perms: [], desc: "NULL Golden Token — clears any CR when loaded", size: 0 },
            { name: "Access", type: "Code", perms: ["R", "X"], desc: "Method dispatcher — DR0 selects operation (0=PI, 1=TWO_PI, 2=CIRCUMFERENCE, 3=AREA, 4=DIAMETER)", base: 0x7000, size: 0x1000 },
            { name: "LocalData", type: "Data", perms: ["R", "W"], base: 0x7400, size: 512 }
        ]
    },
    DateTime: {
        name: "DateTime",
        mathType: "TIME",
        description: "ISO 8601 date/time. DR0=method selector: 0=TIMESTAMP, 1=DATE, 2=TIME, 3=EPOCH, 4=COMPONENTS (DR1-DR6). Result in DR0 or DR1-DR6.",
        methodSelector: { 0: 'TIMESTAMP', 1: 'DATE', 2: 'TIME', 3: 'EPOCH', 4: 'COMPONENTS' },
        clist: [
            { name: "NULL", type: "NULL", perms: [], desc: "NULL Golden Token — clears any CR when loaded", size: 0 },
            { name: "Access", type: "Code", perms: ["R", "X"], desc: "Method dispatcher — DR0 selects mode (0=TIMESTAMP, 1=DATE, 2=TIME, 3=EPOCH, 4=COMPONENTS)", base: 0x9000, size: 0x1000 },
            { name: "LocalData", type: "Data", perms: ["R", "W"], base: 0x9600, size: 512 }
        ]
    },
    Lambda: {
        name: "Lambda",
        mathType: "FUNCTIONAL",
        description: "Church's lambda calculus primitives. Y-Combinator for recursion, Church numerals for arithmetic, Pairs for data structures, Booleans for logic. Slot [1] Access code is hardware-enforced entry point.",
        clist: [
            { name: "NULL", type: "NULL", perms: [], desc: "NULL Golden Token — clears any CR when loaded", size: 0 },
            { name: "Access", type: "Code", perms: ["R", "X"], desc: "CLOOMC code block — hardware-enforced CALL entry point (slot 1)", base: 0xA000, size: 256 },
            { name: "GT_Y_COMBINATOR", type: "Function", perms: ["R", "X"], desc: "Y f = f (Y f) - fixed-point combinator for recursion", base: 0xA100, size: 512 },
            { name: "GT_CHURCH_SUCC", type: "Function", perms: ["R", "X"], desc: "λn.λf.λx. f (n f x) - successor", base: 0xA300, size: 256 },
            { name: "GT_CHURCH_PRED", type: "Function", perms: ["R", "X"], desc: "λn.λf.λx. n (λg.λh. h (g f)) (λu.x) (λu.u) - predecessor", base: 0xA400, size: 384 },
            { name: "GT_CHURCH_ADD", type: "Function", perms: ["R", "X"], desc: "λm.λn.λf.λx. m f (n f x) - addition", base: 0xA580, size: 256 },
            { name: "GT_CHURCH_MUL", type: "Function", perms: ["R", "X"], desc: "λm.λn.λf. m (n f) - multiplication", base: 0xA680, size: 256 },
            { name: "GT_PAIR", type: "Function", perms: ["R", "X"], desc: "λx.λy.λf. f x y - create pair", base: 0xA780, size: 192 },
            { name: "GT_FST", type: "Function", perms: ["R", "X"], desc: "λp. p (λx.λy. x) - first of pair", base: 0xA840, size: 128 },
            { name: "GT_SND", type: "Function", perms: ["R", "X"], desc: "λp. p (λx.λy. y) - second of pair", base: 0xA8C0, size: 128 },
            { name: "GT_TRUE", type: "Function", perms: ["R", "X"], desc: "λx.λy. x - Church TRUE", base: 0xA940, size: 64 },
            { name: "GT_FALSE", type: "Function", perms: ["R", "X"], desc: "λx.λy. y - Church FALSE", base: 0xA980, size: 64 },
            { name: "GT_IF", type: "Function", perms: ["R", "X"], desc: "λc.λt.λf. c t f - conditional", base: 0xA9C0, size: 128 },
            { name: "GT_CHURCH_SUB", type: "Function", perms: ["R", "X"], desc: "λm.λn. n PRED m - subtraction (Church: repeated predecessor)", base: 0xAA40, size: 256 },
            { name: "GT_CHURCH_DIV", type: "Function", perms: ["R", "X"], desc: "λm.λn. Y (λf.λq. IF (LEQ n m) (f (SUB m n) (SUCC q)) q) m 0 - integer division", base: 0xAB40, size: 384 },
            { name: "GT_CHURCH_POW", type: "Function", perms: ["R", "X"], desc: "λb.λe. e (MUL b) 1 - exponentiation (Church: repeated multiplication)", base: 0xAC40, size: 256 },
            { name: "GT_CHURCH_ISZERO", type: "Function", perms: ["R", "X"], desc: "λn. n (λx. FALSE) TRUE - zero test", base: 0xAD40, size: 128 },
            { name: "GT_CHURCH_LEQ", type: "Function", perms: ["R", "X"], desc: "λm.λn. ISZERO (SUB m n) - less-than-or-equal", base: 0xAE40, size: 192 },
            { name: "LocalData", type: "Data", perms: ["R", "W"], base: 0xAF40, size: 512 }
        ]
    },
    Mint: {
        name: "Mint",
        mathType: "FORGE",
        description: "Capability forge. DR0=method selector: 0=MINT (DR1=perm,DR2=type,DR3=size→CR0), 1=RESTRICT (CR0=src,DR1=mask→CR0), 2=REVOKE (CR0=target), 3=INSPECT (CR0=target→DR1-DR4).",
        isNamespaceMethod: true,
        methodSelector: { 0: 'MINT', 1: 'RESTRICT', 2: 'REVOKE', 3: 'INSPECT' },
        clist: [
            { name: "NULL", type: "NULL", perms: [], desc: "NULL Golden Token — clears any CR when loaded", size: 0 },
            { name: "Access", type: "Code", perms: ["R", "X"], desc: "Method dispatcher — DR0 selects operation (0=MINT, 1=RESTRICT, 2=REVOKE, 3=INSPECT)", base: 0xC000, size: 0x1000 },
            { name: "LocalData", type: "Data", perms: ["R", "W"], base: 0xC800, size: 512 }
        ]
    },
    Stack: {
        name: "Stack",
        mathType: "RPN",
        description: "Church-encoded RPN stack using nested pairs. stack = PAIR(top, rest), empty = FALSE. All operations are pure lambda calculus — PUSH creates a new pair, POP extracts via FST/SND, SWAP reorders top two. DR0=method selector: 0=PUSH, 1=POP, 2=SWAP, 3=DUP, 4=PEEK, 5=CLEAR, 6=DEPTH.",
        methodSelector: { 0: 'PUSH', 1: 'POP', 2: 'SWAP', 3: 'DUP', 4: 'PEEK', 5: 'CLEAR', 6: 'DEPTH' },
        clist: [
            { name: "NULL", type: "NULL", perms: [], desc: "NULL Golden Token — clears any CR when loaded", size: 0 },
            { name: "Access", type: "Code", perms: ["R", "X"], desc: "Stack method dispatcher — DR0 selects operation. Church-encoded: stack = PAIR(top, rest)", base: 0xF000, size: 0x400 },
            { name: "GT_PUSH", type: "Function", perms: ["R", "X"], desc: "λval.λstack. PAIR val stack — push value onto stack", base: 0xF400, size: 128 },
            { name: "GT_POP", type: "Function", perms: ["R", "X"], desc: "λstack. FST stack — remove and return top element", base: 0xF480, size: 128 },
            { name: "GT_SWAP", type: "Function", perms: ["R", "X"], desc: "λstack. PAIR (FST (SND stack)) (PAIR (FST stack) (SND (SND stack))) — swap top two", base: 0xF500, size: 192 },
            { name: "GT_DUP", type: "Function", perms: ["R", "X"], desc: "λstack. PAIR (FST stack) stack — duplicate top element", base: 0xF5C0, size: 128 },
            { name: "GT_PEEK", type: "Function", perms: ["R", "X"], desc: "λstack. FST stack — read top without removing", base: 0xF640, size: 64 },
            { name: "GT_CLEAR", type: "Function", perms: ["R", "X"], desc: "λstack. FALSE — return empty stack", base: 0xF680, size: 64 },
            { name: "GT_DEPTH", type: "Function", perms: ["R", "X"], desc: "λstack. Y (λf.λs.λn. IF (ISZERO s) n (f (SND s) (SUCC n))) stack 0 — count elements", base: 0xF6C0, size: 256 },
            { name: "LocalData", type: "Data", perms: ["R", "W"], base: 0xF800, size: 512 }
        ]
    },
    HP35: {
        name: "HP35",
        mathType: "CALCULATOR",
        description: "HP-35 scientific calculator — the world's first handheld scientific calculator (Hewlett-Packard, 1972). Pure lambda calculus RPN engine. All arithmetic via Church numerals, stack via nested pairs, constants via Abstract GTs. DR0=method selector for operations.",
        methodSelector: { 0: 'DIGIT', 1: 'ENTER', 2: 'ADD', 3: 'SUB', 4: 'MUL', 5: 'DIV', 6: 'SQRT', 7: 'SIN', 8: 'COS', 9: 'LOG', 10: 'EXP', 11: 'POW', 12: 'CHS', 13: 'CLR', 14: 'CLX', 15: 'SWAP', 16: 'PI', 17: 'EEX', 18: 'ARC' },
        clist: [
            { name: "NULL", type: "NULL", perms: [], desc: "NULL Golden Token — clears any CR when loaded", size: 0 },
            { name: "Access", type: "Code", perms: ["R", "X"], desc: "HP-35 calculator dispatcher — RPN engine using Church lambda calculus", base: 0x10000, size: 0x800 },
            { name: "GT_DIGIT", type: "Function", perms: ["R", "X"], desc: "λd. append digit d to X register display — Church SUCC chain builds number", base: 0x10800, size: 256 },
            { name: "GT_ENTER", type: "Function", perms: ["R", "X"], desc: "λstack. PUSH X onto stack, lift — PAIR(X, stack)", base: 0x10900, size: 192 },
            { name: "GT_ADD", type: "Function", perms: ["R", "X"], desc: "λx.λy. CHURCH_ADD x y — pop Y, add to X, result in X", base: 0x10A00, size: 256 },
            { name: "GT_SUB", type: "Function", perms: ["R", "X"], desc: "λx.λy. CHURCH_SUB y x — pop Y, subtract X from Y, result in X", base: 0x10B00, size: 256 },
            { name: "GT_MUL", type: "Function", perms: ["R", "X"], desc: "λx.λy. CHURCH_MUL x y — pop Y, multiply by X, result in X", base: 0x10C00, size: 256 },
            { name: "GT_DIV", type: "Function", perms: ["R", "X"], desc: "λx.λy. CHURCH_DIV y x — pop Y, divide Y by X, result in X", base: 0x10D00, size: 384 },
            { name: "GT_SQRT", type: "Function", perms: ["R", "X"], desc: "λx. Y (λf.λg. IF (LEQ (MUL g g) x) (f (SUCC g)) (PRED g)) 0 — Newton's method via Church", base: 0x10E00, size: 512 },
            { name: "GT_SIN", type: "Function", perms: ["R", "X"], desc: "λx. Taylor series: x - x³/3! + x⁵/5! - ... via Church combinators", base: 0x10F00, size: 512 },
            { name: "GT_COS", type: "Function", perms: ["R", "X"], desc: "λx. Taylor series: 1 - x²/2! + x⁴/4! - ... via Church combinators", base: 0x11000, size: 512 },
            { name: "GT_LOG", type: "Function", perms: ["R", "X"], desc: "λx. natural log via Y-Combinator iterative refinement", base: 0x11100, size: 512 },
            { name: "GT_EXP", type: "Function", perms: ["R", "X"], desc: "λx. eˣ via Taylor series: 1 + x + x²/2! + x³/3! + ... Church POW chain", base: 0x11200, size: 512 },
            { name: "GT_POW", type: "Function", perms: ["R", "X"], desc: "λx.λy. CHURCH_POW x y — Y raised to X power", base: 0x11300, size: 256 },
            { name: "GT_CHS", type: "Function", perms: ["R", "X"], desc: "λx. negate sign — Church PAIR(sign, magnitude) toggle", base: 0x11400, size: 128 },
            { name: "GT_CLR", type: "Function", perms: ["R", "X"], desc: "λstack. FALSE — clear entire stack and display", base: 0x11480, size: 64 },
            { name: "GT_CLX", type: "Function", perms: ["R", "X"], desc: "λstack. PAIR 0 (SND stack) — clear X register only", base: 0x114C0, size: 128 },
            { name: "GT_SWAP_XY", type: "Function", perms: ["R", "X"], desc: "λstack. SWAP top two — exchange X and Y registers", base: 0x11540, size: 192 },
            { name: "GT_PI_CONST", type: "Function", perms: ["R", "X"], desc: "λ. push PI (Abstract GT from Constants) onto stack", base: 0x11600, size: 128 },
            { name: "GT_EEX", type: "Function", perms: ["R", "X"], desc: "λx.λe. x × 10ᵉ — enter exponent via Church POW(10, e) then MUL", base: 0x11680, size: 256 },
            { name: "GT_ARC", type: "Function", perms: ["R", "X"], desc: "λ. toggle arc mode — next trig function uses inverse (asin, acos, atan)", base: 0x11780, size: 128 },
            { name: "DisplayBuffer", type: "Data", perms: ["R", "W"], desc: "15-digit LED display buffer — HP-35 red LED format", base: 0x11800, size: 64 },
            { name: "StackData", type: "Data", perms: ["R", "W"], desc: "4-register RPN stack storage (X, Y, Z, T) — Church-encoded pairs", base: 0x11840, size: 256 },
            { name: "LocalData", type: "Data", perms: ["R", "W"], base: 0x11A00, size: 512 }
        ]
    },
    Constants: {
        name: "Constants",
        mathType: "CONSTANT",
        description: "Physical and mathematical constants as Abstract GTs. Each constant is an unforgeable identity token — present the Abstract GT to retrieve the value. Constants cannot be corrupted because they never exist as bare data.",
        clist: [
            { name: "NULL", type: "NULL", perms: [], desc: "NULL Golden Token — clears any CR when loaded", size: 0 },
            { name: "Access", type: "Code", perms: ["R", "X"], desc: "Constants dispatcher — validates Abstract GT in CR1 and returns value in DR0", base: 0xE000, size: 0x1000 },
            { name: "GT_PI", type: "Abstract", perms: [], desc: "π — ratio of circle circumference to diameter (3.14159265358979...)", base: 0xE100, size: 0, value: Math.PI, gtType: "Abstract" },
            { name: "GT_E", type: "Abstract", perms: [], desc: "e — Euler's number, base of natural logarithm (2.71828182845904...)", base: 0xE108, size: 0, value: Math.E, gtType: "Abstract" },
            { name: "GT_PHI", type: "Abstract", perms: [], desc: "φ — golden ratio (1+√5)/2 (1.61803398874989...)", base: 0xE110, size: 0, value: (1 + Math.sqrt(5)) / 2, gtType: "Abstract" },
            { name: "GT_SQRT2", type: "Abstract", perms: [], desc: "√2 — Pythagoras' constant (1.41421356237309...)", base: 0xE118, size: 0, value: Math.SQRT2, gtType: "Abstract" },
            { name: "GT_LN2", type: "Abstract", perms: [], desc: "ln(2) — natural logarithm of 2 (0.69314718055994...)", base: 0xE120, size: 0, value: Math.LN2, gtType: "Abstract" },
            { name: "GT_LN10", type: "Abstract", perms: [], desc: "ln(10) — natural logarithm of 10 (2.30258509299404...)", base: 0xE128, size: 0, value: Math.LN10, gtType: "Abstract" },
            { name: "GT_C", type: "Abstract", perms: [], desc: "c — speed of light in vacuum (299,792,458 m/s)", base: 0xE130, size: 0, value: 299792458, gtType: "Abstract" },
            { name: "GT_PLANCK", type: "Abstract", perms: [], desc: "h — Planck constant (6.62607015 × 10⁻³⁴ J·s)", base: 0xE138, size: 0, value: 6.62607015e-34, gtType: "Abstract" },
            { name: "GT_BOLTZMANN", type: "Abstract", perms: [], desc: "k_B — Boltzmann constant (1.380649 × 10⁻²³ J/K)", base: 0xE140, size: 0, value: 1.380649e-23, gtType: "Abstract" },
            { name: "GT_AVOGADRO", type: "Abstract", perms: [], desc: "N_A — Avogadro constant (6.02214076 × 10²³ mol⁻¹)", base: 0xE148, size: 0, value: 6.02214076e23, gtType: "Abstract" },
            { name: "GT_G", type: "Abstract", perms: [], desc: "G — gravitational constant (6.67430 × 10⁻¹¹ m³/(kg·s²))", base: 0xE150, size: 0, value: 6.67430e-11, gtType: "Abstract" },
            { name: "LocalData", type: "Data", perms: ["R", "W"], base: 0xEA00, size: 512 }
        ]
    },
    FamilyRegistry: {
        name: "FamilyRegistry",
        mathType: "NETWORK",
        description: "Secure machine-to-machine binding abstraction. Creates namespace entries with remote endpoint addresses at bind time — no DNS, no IP lookup. The capability IS the address. F(Far) flag distinguishes virtual memory caching (F=0, HTTP GET/PUT) from remote execution (F=1, encrypted tunnel). B(Bind) flag seals the binding permanently until GC revokes.",
        methodSelector: { 0: 'REGISTER', 1: 'LOOKUP', 2: 'BIND', 3: 'REVOKE', 4: 'STATUS' },
        clist: [
            { name: "NULL", type: "NULL", perms: [], desc: "NULL Golden Token — clears any CR when loaded", size: 0 },
            { name: "Access", type: "Code", perms: ["R", "X"], desc: "FamilyRegistry dispatcher — DR0=method selector for Register, Lookup, Bind, Revoke", base: 0x12000, size: 0x800 },
            { name: "GT_REGISTER", type: "Function", perms: ["L", "E"], desc: "Register a family member: DR0=0, DR1=name, DR2=arch. Creates matching tunnel key pairs on both machines.", base: 0x12800, size: 0x200 },
            { name: "GT_LOOKUP", type: "Function", perms: ["L", "E"], desc: "Lookup registered member: DR0=1, DR1=name. Returns remote endpoint address in DR0, architecture in DR1.", base: 0x12A00, size: 0x200 },
            { name: "GT_BIND", type: "Function", perms: ["L", "E"], desc: "Bind remote endpoint: DR0=2, CR1=target. Creates Outform+Far namespace entry with remote address in location field, sets F=1 B=1 in limit word.", base: 0x12C00, size: 0x200 },
            { name: "GT_REVOKE", type: "Function", perms: ["L", "E"], desc: "Revoke binding: DR0=3, CR1=target. Clears remote address, resets F and B flags. Entry becomes local-only.", base: 0x12E00, size: 0x200 },
            { name: "GT_STATUS", type: "Function", perms: ["L", "E"], desc: "Query binding status: DR0=4, CR1=target. Returns F flag in DR0, B flag in DR1, remote address in DR2.", base: 0x13000, size: 0x200 },
            { name: "RegistryTable", type: "Data", perms: ["R", "W"], desc: "Family member registry — maps names to remote endpoint addresses and architecture types", base: 0x13200, size: 0x800 },
            { name: "LocalData", type: "Data", perms: ["R", "W"], desc: "Working storage for binding operations", base: 0x13A00, size: 512 }
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
// Step 2: LOAD_NS → CR15 (Namespace GT at offset 0 — the one wired GT)
// Step 3: SWITCH_THREAD → CR8 (Kenneth at NS offset 1), CR5 ← Services C-List (NS offset 2)
// Step 4: CALL_BOOT → CR6 ← Boot C-List (NS offset 3), CR7 ← Access code (NS offset 4), NIA=0

const bootSteps = [
    {
        name: "Fault Restart",
        description: "CLEAR_ALL: Saving state, clearing registers, setting cold_restart...",
        action: () => {
            if (!coldRestart) {
                try { saveThreadState(); } catch(e) {}
            }
            simulator.reset();
            coldRestart = true;
        }
    },
    {
        name: "Load Namespace",
        description: "LOAD_NS CR15: Loading the single wired GT — Namespace (offset 0, no GT perms, M elevated on CR by microcode)...",
        action: () => {
            const nsEntry = getNSEntry(0);
            simulator.cr15 = {
                name: "Namespace",
                nsOffset: 0,
                type: "System",
                location: { type: "Local", offset: nsEntry.word1_location },
                perms: [],
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
        name: "Switch Thread + Load Services",
        description: "CHANGE 1: CR8 ← Kenneth (NS offset 1), CR5 ← Services C-List [E] (NS offset 2, stable)...",
        action: () => {
            const kennethNS = getNSEntry(1);
            simulator.cr8 = {
                name: "Kenneth",
                nsOffset: 1,
                type: "Thread",
                location: { type: "Local", offset: kennethNS.word1_location },
                perms: [],
                locked: false,
                goldenKey: generateGoldenKey(),
                word1: kennethNS.word1_location,
                word2: kennethNS.word2_limit,
                word3: kennethNS.word3_seals,
                clist: threadCLists.Kenneth.clist
            };

            const servicesNS = getNSEntry(2);
            simulator.contextRegs[5] = {
                name: "Services",
                nsOffset: 2,
                type: "C-List",
                location: { type: "Local", offset: servicesNS.word1_location },
                perms: ["E"],
                locked: false,
                goldenKey: generateGoldenKey(),
                word1: servicesNS.word1_location,
                word2: servicesNS.word2_limit,
                word3: servicesNS.word3_seals,
                clistCount: servicesCList.entries.length,
                clist: servicesCList.entries,
                isServices: true
            };

            updateNamespaceDisplay();
        }
    },
    {
        name: "Call Boot",
        description: "CALL HWGT: CR6 ← Boot C-List [E] (NS offset 3), CR7 ← Access code [X] (NS offset 4), NIA=0...",
        action: () => {
            const bootNS = getNSEntry(3);
            const clistCount = bootCList.entries.length;
            simulator.contextRegs[6] = {
                name: "Boot",
                nsOffset: 3,
                type: "C-List",
                location: { type: "Local", offset: bootNS.word1_location },
                perms: ["E"],
                locked: false,
                goldenKey: generateGoldenKey(),
                word1: bootNS.word1_location,
                word2: bootNS.word2_limit,
                word3: bootNS.word3_seals,
                clistCount: clistCount,
                clist: bootCList.entries
            };

            const accessNS = getNSEntry(4);
            simulator.contextRegs[7] = {
                name: "Access",
                nsOffset: 4,
                type: "Code",
                location: { type: "Local", offset: accessNS.word1_location },
                perms: ["X"],
                locked: true,
                goldenKey: generateGoldenKey(),
                word1: accessNS.word1_location,
                word2: accessNS.word2_limit,
                word3: accessNS.word3_seals,
                linkage: accessNS.linkage || "Boot/Access.asm",
                base: accessNS.word1_location,
                size: accessNS.word2_limit
            };

            simulator.nia = 0;
            coldRestart = false;

            updateSystemState();

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
    const bootDescs = [
        'CLEAR_ALL — save state, clear registers, cold restart',
        'LOAD_NS CR15 — Namespace root (wired GT, M elevated on CR)',
        'CHANGE 1 — CR8 ← Kenneth, CR5 ← Services C-List [E]',
        'CALL HWGT — CR6 ← Boot C-List [E], CR7 ← Access [X], NIA=0'
    ];
    traceRecord(`B${stepNum + 1}`, 'BOOT', [step.name], bootDescs[stepNum] || step.description);
    updateTraceView();
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
    const bigIntReplacer = (key, value) => typeof value === 'bigint' ? value.toString() : value;
    const safeClone = (obj) => obj ? JSON.parse(JSON.stringify(obj, bigIntReplacer)) : null;
    
    const threadState = {
        contextRegs: safeClone(simulator.contextRegs),
        dataRegs: {},
        flags: { ...simulator.flags },
        nia: simulator.nia,
        stackDepth: simulator.stackDepth,
        cr6: safeClone(simulator.contextRegs[6]),
        cr7: safeClone(simulator.contextRegs[7]),
        cr8: safeClone(simulator.cr8),
        cr15: safeClone(simulator.cr15)
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
        simulator.clist = [];
        namespaceObjects = namespaceObjects.filter(o => !o.dynamic);
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
        if (vocabularyViewActive) {
            const content = document.getElementById('vocabularyContent');
            if (content) content.innerHTML = buildVocabularyView();
        }
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
    
    const allObjects = namespaceObjects;
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

    if (vocabularyViewActive) {
        const content = document.getElementById('vocabularyContent');
        if (content) content.innerHTML = buildVocabularyView();
    }
}

// ==================== VOCABULARY VIEW ====================

let vocabularyViewActive = false;

const abstractionDomains = {
    SlideRule:       { domain: 'Mathematics',  desc: 'Floating-point arithmetic' },
    Abacus:          { domain: 'Mathematics',  desc: '64-bit integer arithmetic' },
    Circle:          { domain: 'Geometry',     desc: 'Circle geometry calculations' },
    DateTime:        { domain: 'Time',         desc: 'ISO 8601 date and time' },
    Lambda:          { domain: 'Computation',  desc: 'Church lambda calculus primitives' },
    Stack:           { domain: 'Computation',  desc: 'Church-encoded RPN stack' },
    HP35:            { domain: 'Calculator',   desc: 'HP-35 scientific calculator' },
    Constants:       { domain: 'Constants',    desc: 'Physical and mathematical constants' },
    Mint:            { domain: 'System',       desc: 'Capability forge (namespace method)' },
    FamilyRegistry:  { domain: 'Networking',   desc: 'Secure machine-to-machine binding' }
};

function getPublicWords(absName) {
    const abs = abstractionCLists[absName];
    if (!abs) return [];
    if (abs.methodSelector) {
        return Object.values(abs.methodSelector);
    }
    return abs.clist
        .filter(item => item.type === 'Function')
        .map(item => item.name.replace(/^GT_/, ''));
}

function buildVocabularyView() {
    if (!simulator.cr15 || simulator.cr15.name === 'NULL') {
        return '<div class="ns-empty">Boot system to view vocabulary</div>';
    }

    const domainMap = {};
    Object.keys(abstractionCLists).forEach(absName => {
        const meta = abstractionDomains[absName] || { domain: 'Other', desc: '' };
        const domain = meta.domain;
        if (!domainMap[domain]) domainMap[domain] = [];
        domainMap[domain].push(absName);
    });

    const domainOrder = ['Mathematics', 'Geometry', 'Time', 'Computation', 'Calculator', 'Constants', 'System', 'Networking', 'Other'];
    const sortedDomains = Object.keys(domainMap).sort((a, b) => {
        const ai = domainOrder.indexOf(a);
        const bi = domainOrder.indexOf(b);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    let html = '';
    sortedDomains.forEach(domain => {
        html += `<div class="vocab-domain-card">`;
        html += `<div class="vocab-domain-header"><span class="vocab-domain-name">${domain}</span></div>`;
        domainMap[domain].forEach(absName => {
            const meta = abstractionDomains[absName] || {};
            const mathBadge = mathTypeBadges[absName] || 'ABS';
            const words = getPublicWords(absName);
            html += `<div class="vocab-abstraction">`;
            html += `<div class="vocab-abs-header">`;
            html += `<span class="math-type-badge math-${mathBadge.toLowerCase()}">${mathBadge}</span>`;
            html += `<span class="vocab-abs-name">${absName}</span>`;
            if (meta.desc) html += `<span class="vocab-abs-desc">${meta.desc}</span>`;
            html += `</div>`;
            if (words.length > 0) {
                html += `<div class="vocab-word-list">`;
                words.forEach(word => {
                    html += `<span class="vocab-word">${word}</span>`;
                });
                html += `</div>`;
            } else {
                html += `<div class="vocab-no-words">No public words</div>`;
            }
            html += `</div>`;
        });
        html += `</div>`;
    });
    return html;
}

function toggleVocabularyView() {
    const namespaceLayout = document.getElementById('namespaceLayout');
    const vocabLayout = document.getElementById('vocabularyLayout');
    const toggle = document.getElementById('vocabViewToggle');
    if (!namespaceLayout || !vocabLayout || !toggle) return;

    vocabularyViewActive = !vocabularyViewActive;

    if (vocabularyViewActive) {
        namespaceLayout.style.display = 'none';
        vocabLayout.style.display = 'block';
        toggle.classList.add('btn-vocab-active');
        const content = document.getElementById('vocabularyContent');
        if (content) content.innerHTML = buildVocabularyView();
    } else {
        namespaceLayout.style.display = '';
        vocabLayout.style.display = 'none';
        toggle.classList.remove('btn-vocab-active');
    }
}

function renderDynamicChildren(parentName) {
    let html = '';
    const children = namespaceObjects.filter(o => o.dynamic && o.parent === parentName);
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
    html += '<div class="hier-node hier-root" data-tooltip="Root abstraction. Minimal boot namespace — grows via CALL(Thread.Mint).">';
    html += '<div class="hier-label">Boot</div>';
    html += '</div>';
    html += '<div class="hier-children">';

    const bootThreads = namespaceObjects.filter(o => o.type === 'Thread' && !o.dynamic);
    if (bootThreads.length > 0) {
        html += '<div class="hier-group">';
        html += '<div class="hier-group-label" data-tooltip="User thread identities. One thread at boot — others minted at runtime.">Threads</div>';
        bootThreads.forEach(tObj => {
            const name = tObj.name;
            const isActive = simulator.cr8 && simulator.cr8.name === name;
            const activeText = isActive ? ' (ACTIVE — currently executing)' : '';
            html += `<div class="hier-item" data-name="${name}" data-type="Thread">`;
            html += `<div class="hier-node hier-thread ${isActive ? 'hier-active' : ''}" data-tooltip="Thread identity. CR8 points here. M elevated on CR by microcode only.${activeText}">`;
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
    }

    html += '<div class="hier-group">';
    html += '<div class="hier-group-label" data-tooltip="Services C-List (CR5, stable) — Thread\'s gateway to Namespace.Mint, GC, Lookup.">Services</div>';
    servicesCList.entries.forEach(entry => {
        const permsStr = `[${entry.perms.join('')}]`;
        html += `<div class="hier-item hier-gt" data-name="${entry.name}" data-type="${entry.type}" data-tooltip="${entry.desc} ${permsStr}">${entry.name}</div>`;
    });

    if (abstractionCLists.Mint) {
        html += '<div class="hier-item" data-name="Mint" data-type="Namespace Method">';
        html += '<div class="hier-node hier-abstraction" data-tooltip="Namespace method — accessed via CALL(Thread.Mint). Not a standalone abstraction.">';
        html += '<div class="hier-label"><span class="math-type-badge math-forge">FORGE</span> Mint (Namespace method)</div>';
        html += '</div>';
        html += '<div class="hier-clist">';
        abstractionCLists.Mint.clist.forEach(item => {
            if (item.type === 'Function') {
                const permsStr = item.perms ? `[${item.perms.join('')}]` : '[RX]';
                html += `<div class="hier-item hier-gt hier-func" data-name="${item.name}" data-type="Function" data-parent="Mint" data-base="${item.base || 0}" data-size="${item.size || 0}" data-tooltip="${item.desc} | ${permsStr} | Click to view code">${item.name}</div>`;
            }
        });
        html += '</div></div>';
    }
    html += '</div>';

    const bootAbstractions = namespaceObjects.filter(o => o.type === 'Abstraction' && !o.dynamic);
    if (bootAbstractions.length > 0) {
        html += '<div class="hier-group">';
        html += '<div class="hier-group-label" data-tooltip="Boot-time abstractions. Others minted at runtime via CALL(Thread.Mint).">Abstractions</div>';
        bootAbstractions.forEach(aObj => {
            const name = aObj.name;
            const gtEntry = getBootGT(name);
            const absPerms = gtEntry ? `[${gtEntry.perms.join('')}]` : '[E]';
            const mathBadge = mathTypeBadges[name] || 'ABS';
            html += `<div class="hier-item" data-name="${name}" data-type="Abstraction">`;
            html += `<div class="hier-node hier-abstraction" data-tooltip="Abstraction ${absPerms} (Enter via CALL) | ${aObj.tooltip || name}">`;
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
                    } else if (item.type === 'Abstract') {
                        html += `<div class="hier-item hier-gt hier-abstract" data-name="${item.name}" data-type="Abstract" data-parent="${name}" data-tooltip="${item.desc} | Abstract GT — identity only, no permissions" style="color: #f472b6;">${item.name}</div>`;
                    }
                });
                html += '</div>';
            }
            html += renderDynamicChildren(name);
            html += '</div>';
        });

        const runtimeAbstractions = ['Circle', 'DateTime', 'Lambda'].filter(n => abstractionCLists[n] && !namespaceObjects.find(o => o.name === n && !o.dynamic));
        if (runtimeAbstractions.length > 0) {
            html += '<div class="hier-group-label" data-tooltip="Not in boot namespace — available via CALL(Thread.Mint) at runtime.">Mintable (runtime)</div>';
            runtimeAbstractions.forEach(name => {
                const mathBadge = mathTypeBadges[name] || 'ABS';
                html += `<div class="hier-item" data-name="${name}" data-type="Abstraction" style="opacity:0.6">`;
                html += `<div class="hier-node hier-abstraction" data-tooltip="Mintable at runtime via CALL(Thread.Mint). Not in boot namespace.">`;
                html += `<div class="hier-label"><span class="math-type-badge math-${mathBadge.toLowerCase()}">${mathBadge}</span> ${name} <span class="hier-custom-tag">(mintable)</span></div>`;
                html += '</div></div>';
            });
        }

        html += '</div>';
    }

    const dynamicRoots = namespaceObjects.filter(obj => obj.dynamic && obj.parent === 'Boot');
    if (dynamicRoots.length > 0) {
        html += '<div class="hier-group-label" data-tooltip="User-created objects in the Boot namespace.">Custom Objects</div>';
        dynamicRoots.forEach(obj => {
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
    }

    html += '</div></div>';
    return html;
}

function updateDisplay() {
    updateContextRegisters();
    updateDataRegisters();
    updateSystemState();
    updateFlags();
    updateStackPanel();
}

const crTooltips = {
    0: 'General-purpose capability register. Holds Golden Tokens for accessing protected resources.',
    1: 'General-purpose capability register. Holds Golden Tokens for accessing protected resources.',
    2: 'General-purpose capability register. Holds Golden Tokens for accessing protected resources.',
    3: 'General-purpose capability register. Holds Golden Tokens for accessing protected resources.',
    4: 'General-purpose capability register. Holds Golden Tokens for accessing protected resources.',
    5: 'SERVICES C-LIST [E]: Thread services gateway. Stable — set at boot, never changes on CALL/RETURN. Contains self[E] → Namespace[E] → Mint, GC, Lookup.',
    6: 'ACTIVE C-LIST [E]: Current abstraction\'s symbolic method names. Dynamic — switches on every CALL/RETURN.',
    7: 'ACTIVE NUCLEUS [X]: Current method code. Dynamic — switches on every CALL/RETURN. Resolves CR6 symbols to executable code.'
};

function getCListForCR(crCap) {
    if (!crCap || crCap.name === 'NULL') return null;
    if (crCap.clist && crCap.clist.length > 0) return crCap.clist;
    const name = crCap.name.replace(/^CLIST_/, '');
    if (name === 'Services') return servicesCList.entries;
    if (abstractionCLists[name]) return abstractionCLists[name].clist;
    if (threadCLists[name]) return threadCLists[name].clist;
    return null;
}

function openCListForCR(crIdx) {
    const crCap = crIdx < 8 ? simulator.contextRegs[crIdx] : null;
    if (!crCap) return;
    const clistEntries = getCListForCR(crCap);
    if (clistEntries && clistEntries.length > 0) {
        simulator.clist = clistEntries.map(entry => {
            const nsObj = namespaceObjects.find(o => o.offset === entry.nsOffset);
            const isLocked = entry.type === 'Abstraction';
            return {
                name: entry.name,
                type: entry.type || 'Unknown',
                nsOffset: entry.nsOffset,
                location: { type: "Local", offset: nsObj ? nsObj.word1_location : (entry.base || 0) },
                perms: entry.perms || [],
                size: nsObj ? nsObj.word2_limit : (entry.size || 0),
                goldenKey: generateGoldenKey(),
                locked: isLocked
            };
        });
    }
    switchView('capabilities');
    updateCapabilityExplorer();
    setTimeout(() => {
        if (crCap) {
            const resolvedCList = crCap.clist || getCListForCR(crCap);
            const capWithCList = Object.assign({}, crCap, { clist: resolvedCList || null });
            showCapabilityDetail(null, capWithCList, `CR${crIdx}`);
            document.querySelectorAll('.token-card').forEach(card => {
                const regBadge = card.querySelector('.token-reg');
                if (regBadge && regBadge.textContent === `CR${crIdx}`) {
                    card.classList.add('selected');
                }
            });
        }
    }, 100);
    log(`Switched to Capabilities Explorer (CR${crIdx} C-List)`, 'info');
}

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
        const hasCList = !isNull && getCListForCR(reg) !== null;
        const permTooltip = reg.perms.length > 0 ? 
            `Permissions: ${reg.perms.map(p => {
                const permNames = {R:'Read', W:'Write', X:'Execute', L:'Load', S:'Store', E:'Enter'};
                return permNames[p] || p;
            }).join(', ')}${hasCList ? ' — Click to view C-List' : ''}` : 'No capability loaded. Register is empty.';
        
        const row = document.createElement('div');
        row.className = `register-row tooltip-bottom ${isNull ? 'null' : ''}${hasCList ? ' has-clist' : ''}`;
        row.setAttribute('data-tooltip', tooltip);
        row.innerHTML = `
            <span class="name">CR${i}</span>
            <span class="role">${role}</span>
            <span class="value">${reg.name}${hasCList ? ' \u25B6' : ''}</span>
            <span class="perms tooltip-bottom" data-tooltip="${permTooltip}">${reg.perms.join('') || '---'}</span>
        `;
        if (hasCList) {
            row.style.cursor = 'pointer';
            const crIdx = i;
            row.addEventListener('click', () => openCListForCR(crIdx));
        }
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
            const code = functionBetaCode[cr7.name];
            if (code) {
                const lines = code.split('\n').filter(l => l.trim() && !l.trim().startsWith(';')).slice(0, 4);
                codePreview = ' | Code: ' + lines.join(' / ');
            }
            cr7Row.setAttribute('data-tooltip', `Linkage: ${cr7.linkage} | Perms: ${permsStr} | Base: 0x${(cr7.base || 0).toString(16).toUpperCase()} | Size: ${cr7.size || 0} bytes${codePreview}`);
        }
    } else {
        document.getElementById('cr7NameDisplay').textContent = 'NULL';
    }
    
    document.getElementById('niaValue').textContent = simulator.nia;
    document.getElementById('stackDepth').textContent = `${simulator.stackDepth * 3} words`;
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
    RETURN: { operands: [], help: 'Return from procedure. Pops stack frame and restores CR6, CR7, NIA.', isCap: true },
    LAMBDA: { operands: ['cr', 'dr'], help: 'Apply Church function in CR[cr] to DR[dr]. Requires X permission. Non-nestable. Result in DR[dr].', isCap: true },
    HALT: { operands: [], help: 'Stop program execution cleanly.' },
    CHANGE: { operands: ['cr_or_index'], help: 'Create new thread GT and load into CR8. I=0: from CRs, I=1: from C-List[idx]. Clears exclusive monitors.', isCap: true },
    SWITCH: { operands: ['cr', 'target'], help: 'Copy capability to system register CR8-15. I=0: from CRs, I=1: from C-List[idx]. Target: 0=CR8...7=CR15.', isCap: true }
};

document.addEventListener('DOMContentLoaded', () => {
    loadFromStorage();
    updateDisplay();
    updateCapabilityExplorer();
    const _ctmmViews = ['dashboard','namespace','editor','capabilities','abstractionZoom','hp35calc','instructions','tutorial','code'];
    const _ctmmHash = window.location.hash.replace('#', '');
    let _ctmmStart = _ctmmViews.includes(_ctmmHash) ? _ctmmHash : null;
    if (!_ctmmStart) { try { const s = localStorage.getItem('ctmm_lastView'); if (s && _ctmmViews.includes(s)) _ctmmStart = s; } catch(e) {} }
    if (_ctmmStart) switchView(_ctmmStart);
    log('CM Simulator Ready', 'info');
    
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
    
    const cr6Row = document.getElementById('cr6Row');
    if (cr6Row) {
        cr6Row.addEventListener('click', () => openCListForCR(6));
    }
    
    // Stack depth click handler - scroll to stack panel
    const stackDepthRow = document.getElementById('stackDepthRow');
    if (stackDepthRow) {
        stackDepthRow.addEventListener('click', () => {
            const stackPanel = document.querySelector('.panel.call-stack');
            if (stackPanel) {
                stackPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
    }
    
    // Editor stack indicator click handler - switch to dashboard and scroll to stack
    const editorStackIndicator = document.getElementById('editorStackIndicator');
    if (editorStackIndicator) {
        editorStackIndicator.addEventListener('click', () => {
            switchView('dashboard');
            setTimeout(() => {
                const stackPanel = document.querySelector('.panel.call-stack');
                if (stackPanel) {
                    stackPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 100);
        });
    }
});

// Update the stack panel in the Dashboard with current call stack frames
function updateStackPanel() {
    const stackList = document.getElementById('stackList');
    const stackWordCount = document.getElementById('stackWordCount');
    if (!stackList) return;
    
    const callStack = simulator.callStack;
    const wordCount = callStack.length * 3;
    
    // Update word count display
    if (stackWordCount) {
        stackWordCount.textContent = `(${wordCount} words)`;
    }
    
    // Also update Dashboard and Editor stack displays
    const stackDepthEl = document.getElementById('stackDepth');
    if (stackDepthEl) {
        stackDepthEl.textContent = `${wordCount} words`;
    }
    const editorStackDepth = document.getElementById('editorStackDepth');
    if (editorStackDepth) {
        editorStackDepth.textContent = wordCount;
    }
    
    if (callStack.length === 0) {
        stackList.innerHTML = '<div class="stack-empty">Stack is empty</div>';
        return;
    }
    
    // Build stack frame entries (3 words each: returnNIA, CR6, CR7)
    let framesHtml = '';
    callStack.forEach((frame, i) => {
        const frameNum = callStack.length - i; // Reverse order (most recent first)
        const cr6Name = frame.cr6 ? frame.cr6.name : 'NULL';
        const cr6Perms = frame.cr6 && frame.cr6.perms ? `[${frame.cr6.perms.join('')}]` : '';
        const cr7Name = frame.cr7 ? frame.cr7.name : 'NULL';
        const cr7Perms = frame.cr7 && frame.cr7.perms ? `[${frame.cr7.perms.join('')}]` : '';
        
        framesHtml += `
            <div class="stack-frame">
                <div class="stack-frame-header">Frame ${frameNum}</div>
                <div class="stack-word">
                    <span class="stack-word-label">W0:</span>
                    <span class="stack-word-name">returnNIA</span>
                    <span class="stack-word-value">${frame.returnNIA}</span>
                </div>
                <div class="stack-word">
                    <span class="stack-word-label">W1:</span>
                    <span class="stack-word-name">CR6</span>
                    <span class="stack-word-value">${cr6Name} ${cr6Perms}</span>
                </div>
                <div class="stack-word">
                    <span class="stack-word-label">W2:</span>
                    <span class="stack-word-name">CR7</span>
                    <span class="stack-word-value">${cr7Name} ${cr7Perms}</span>
                </div>
            </div>
        `;
    });
    
    stackList.innerHTML = framesHtml;
}

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
    
    const allPerms = ['R', 'W', 'X', 'L', 'S', 'E'];
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
        'Kenneth': 'Primary thread identity — M elevated on CR by microcode only',
        'Services': 'Services C-List — stable in CR5. Contains self[E] → Namespace → Mint, GC, Lookup',
        'SlideRule': 'IEEE 754 floating-point math abstraction — Method-selector dispatch: DR0=method (0=ADD,1=SUB,2=MUL,3=DIV,4=MOD,5=LOG,6=EXP,7=SQRT,8=POW)',
        'Abacus': '64-bit integer arithmetic abstraction — Method-selector dispatch: DR0=method (0=ADD,1=SUB,2=MUL,3=DIV,4=MOD,5=ABS,6=NEG,7=INC,8=DEC)',
        'Circle': 'Geometric calculations — mintable at runtime via CALL(Thread.Mint)',
        'Access': 'Boot nucleus code — loaded into CR7. Resolves symbolic names from CR6 to executable code',
        'NULL': 'Null capability - no access rights, typically indicates uninitialized register',
        'Constants': 'Physical/mathematical constants as Abstract GTs — unforgeable identity tokens for PI, E, PHI, c, h, k_B, N_A, G. Present Abstract GT in CR1 to retrieve value.',
        'Stack': 'Church-encoded RPN stack — PUSH, POP, SWAP, DUP, PEEK, CLEAR via nested pairs. stack = PAIR(top, rest), empty = FALSE.',
        'HP35': 'HP-35 scientific calculator — pure lambda calculus RPN engine. All arithmetic via Church numerals, stack via nested pairs, constants via Abstract GTs.',
        'FamilyRegistry': 'Secure machine-to-machine binding — creates namespace entries with remote endpoint addresses at bind time. No DNS, no IP lookup. The capability IS the address.'
    };
    return tooltips[name] || `${type || 'Object'}: ${name}`;
}

let currentEditingCap = null;
let currentEditingRegLabel = null;
let currentEditingClistIndex = -1;
let currentExecutionLine = -1;

function getCapabilityHierarchy(cap) {
    const hierarchy = [];
    
    // Check if it's the Namespace itself
    if (cap.name === 'Namespace' || cap.location?.offset === 0) {
        hierarchy.push({ name: 'Namespace', type: 'Root', offset: 0 });
        return hierarchy;
    }
    
    // Check if it's a Thread
    const nsThread = namespaceObjects.find(o => o.type === 'Thread' && o.name === cap.name);
    if (cap.type === 'Thread' || nsThread) {
        hierarchy.push({ name: 'Namespace', type: 'Root', offset: 0 });
        hierarchy.push({ name: cap.name, type: 'Thread', offset: nsThread ? nsThread.offset : (cap.location?.offset || 0) });
        return hierarchy;
    }

    // Check if it's a Services or Boot C-List
    if (cap.name === 'Services' || cap.name === 'Boot') {
        hierarchy.push({ name: 'Namespace', type: 'Root', offset: 0 });
        const nsObj = namespaceObjects.find(o => o.name === cap.name);
        hierarchy.push({ name: cap.name, type: 'C-List', offset: nsObj ? nsObj.offset : 0 });
        return hierarchy;
    }

    // Check if this capability is in the Boot C-List
    const bootCListEntry = bootCList.entries.find(e => e.name === cap.name);
    if (bootCListEntry) {
        hierarchy.push({ name: 'Namespace', type: 'Root', offset: 0 });
        hierarchy.push({ name: 'Boot', type: 'C-List', offset: bootCList.nsOffset });
        hierarchy.push({ name: cap.name, type: cap.type || bootCListEntry.type, offset: bootCListEntry.nsOffset });
        return hierarchy;
    }

    // Check Services C-List
    const serviceEntry = servicesCList.entries.find(e => e.name === cap.name);
    if (serviceEntry) {
        hierarchy.push({ name: 'Namespace', type: 'Root', offset: 0 });
        hierarchy.push({ name: 'Services', type: 'C-List', offset: servicesCList.nsOffset });
        hierarchy.push({ name: cap.name, type: serviceEntry.type, offset: serviceEntry.nsOffset });
        return hierarchy;
    }

    // Check thread C-Lists
    for (const [threadName, threadData] of Object.entries(threadCLists)) {
        const threadEntry = threadData.clist.find(e => e.name === cap.name);
        if (threadEntry) {
            hierarchy.push({ name: 'Namespace', type: 'Root', offset: 0 });
            const tNS = namespaceObjects.find(o => o.name === threadName);
            hierarchy.push({ name: threadName, type: 'Thread', offset: tNS ? tNS.offset : 0 });
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
        if (cap.type === 'Namespace' || cap.name === 'Namespace' || cap.name === 'SYSTEM_ROOT') {
            assignments.push({ reg: 'Namespace', desc: 'Namespace root' });
        }
    }
    if (simulator.cr8 && simulator.cr8.name === cap.name) {
        assignments.push({ reg: 'CR8', desc: 'Current Thread' });
        if (cap.type === 'Thread') {
            assignments.push({ reg: 'Thread', desc: 'Thread identity' });
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
            } else if (regCap.type === 'Thread') {
                assignments.push({ reg: 'Thread', desc: 'Thread identity' });
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
            } else if (clistEntry.type === 'Thread') {
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

function getContentTabInfo(cap) {
    const objType = cap.type || getTypeFromSeals(cap.nsEntry);
    const capName = cap.name || 'Unknown';
    const allP = ['R', 'W', 'X', 'L', 'S', 'E'];

    const renderCListEntries = (entries, parentName) => {
        if (!entries || entries.length === 0) return '<div style="color:#94a3b8;padding:0.5rem;">No entries</div>';
        return entries.map((entry, i) => {
            const badges = allP.map(p => {
                const has = entry.perms && entry.perms.includes(p);
                return `<span class="perm-badge perm-${p.toLowerCase()} ${has ? '' : 'inactive'}">${p}</span>`;
            }).join('');

            let w1 = '--', w2 = '--', w3 = '--';
            const nsObj = entry.nsOffset !== undefined ? namespaceObjects.find(o => o.offset === entry.nsOffset) : null;
            if (nsObj) {
                w1 = `0x${nsObj.word1_location.toString(16).toUpperCase().padStart(4, '0')}`;
                w2 = `0x${nsObj.word2_limit.toString(16).toUpperCase().padStart(4, '0')}`;
                w3 = `0x${Number(nsObj.word3_seals || 0).toString(16).toUpperCase().padStart(8, '0')}`;
            } else if (entry.base !== undefined) {
                w1 = `0x${entry.base.toString(16).toUpperCase().padStart(4, '0')}`;
                w2 = entry.size !== undefined ? `0x${entry.size.toString(16).toUpperCase().padStart(4, '0')}` : '--';
                const entryType = entry.type || 'Abstraction';
                const typeCode = Object.entries(OBJECT_TYPES).find(([k, v]) => v === entryType)?.[0] || 0x0004;
                w3 = `0x${(Number(typeCode) << 16).toString(16).toUpperCase().padStart(8, '0')}`;
            } else if (entry.word1_location !== undefined) {
                w1 = `0x${entry.word1_location.toString(16).toUpperCase().padStart(4, '0')}`;
                w2 = entry.word2_limit !== undefined ? `0x${entry.word2_limit.toString(16).toUpperCase().padStart(4, '0')}` : '--';
                w3 = '--';
            }

            const isExec = entry.perms && entry.perms.includes('X');
            const execClass = isExec ? ' clist-tab-executable' : '';
            const execAttr = isExec ? ` data-func-name="${entry.name}" data-parent="${parentName}"` : '';
            const execHint = isExec ? ' — Click to view code' : '';
            return `<div class="clist-tab-entry-wrap">
                <div class="clist-tab-entry${execClass}"${execAttr} data-tooltip="${entry.type || 'Object'}: ${entry.name}${entry.desc ? ' — ' + entry.desc : ''}${execHint}" onclick="this.parentElement.classList.toggle('expanded')">
                    <span class="clist-tab-idx">[${i}]</span>
                    <span class="clist-tab-name">${entry.name}</span>
                    <span class="clist-tab-perms">${badges}</span>
                    <span class="clist-tab-expand">▸</span>
                </div>
                <div class="clist-tab-words">
                    <div class="clist-word"><span class="clist-word-label">W1</span><span class="clist-word-desc">Location</span><span class="clist-word-val">${w1}</span></div>
                    <div class="clist-word"><span class="clist-word-label">W2</span><span class="clist-word-desc">Limit</span><span class="clist-word-val">${w2}</span></div>
                    <div class="clist-word"><span class="clist-word-label">W3</span><span class="clist-word-desc">Seals</span><span class="clist-word-val">${w3}</span></div>
                </div>
            </div>`;
        }).join('');
    };

    if (objType === 'C-List' || objType === 'CList') {
        const entries = cap.clist || [];
        const count = entries.length;
        return {
            label: `C-List (${count})`,
            tooltip: 'Capability List entries',
            html: `<div class="content-tab-section">
                <div class="clist-tab-header"><span class="clist-tab-count">${count} entries</span></div>
                <div class="clist-tab-entries">${renderCListEntries(entries, capName)}</div>
            </div>`
        };
    }

    if (objType === 'Thread') {
        const threadInfo = threadCLists[capName];
        const threadNS = namespaceObjects.find(o => o.name === capName);
        const base = threadNS ? `0x${threadNS.word1_location.toString(16).toUpperCase()}` : '--';
        const size = threadNS ? `0x${threadNS.word2_limit.toString(16).toUpperCase()}` : '--';
        const threadEntries = threadInfo ? threadInfo.clist : [];

        const formatCR = (idx) => {
            const reg = (idx === 8) ? simulator.cr8 : simulator.contextRegs[idx];
            if (!reg || reg.name === 'NULL') return '<span style="color:var(--text-muted)">— empty —</span>';
            const permsStr = reg.perms && reg.perms.length > 0 ? ` [${reg.perms.join('')}]` : '';
            const typeStr = reg.type ? ` (${reg.type})` : '';
            return `${reg.name}${permsStr}${typeStr}`;
        };

        let crRows = '';
        for (let i = 0; i <= 7; i++) {
            crRows += `<div class="content-tab-field"><span class="content-tab-key">CR${i}</span><span class="content-tab-val">${formatCR(i)}</span></div>`;
        }
        crRows += `<div class="content-tab-field"><span class="content-tab-key">CR8</span><span class="content-tab-val">${formatCR(8)}</span></div>`;

        return {
            label: 'Thread',
            tooltip: 'Thread object layout — live context register state',
            html: `<div class="content-tab-section">
                <div class="content-tab-heading">Thread Identity: ${capName}</div>
                <div class="content-tab-grid">
                    <div class="content-tab-field"><span class="content-tab-key">Base</span><span class="content-tab-val">${base}</span></div>
                    <div class="content-tab-field"><span class="content-tab-key">Size</span><span class="content-tab-val">${size}</span></div>
                </div>
                <div class="content-tab-heading" style="margin-top:0.5rem;">Context Registers (live)</div>
                <div class="content-tab-grid">${crRows}</div>
                ${threadEntries.length > 0 ? `<div class="content-tab-heading" style="margin-top:0.5rem;">Thread-Local Entries</div>
                <div class="clist-tab-entries">${renderCListEntries(threadEntries.map((e, i) => ({...e, nsOffset: e.nsOffset})), capName)}</div>` : ''}
                ${threadInfo ? `<div class="content-tab-desc">${threadInfo.description}</div>` : ''}
            </div>`
        };
    }

    if (objType === 'Code') {
        const linkage = cap.linkage || 'Boot/Access.asm';
        const codeNS = namespaceObjects.find(o => o.name === capName);
        const base = codeNS ? `0x${codeNS.word1_location.toString(16).toUpperCase()}` : '--';
        const size = codeNS ? `0x${codeNS.word2_limit.toString(16).toUpperCase()}` : '--';
        return {
            label: 'Code',
            tooltip: 'Code object — executable instructions',
            html: `<div class="content-tab-section">
                <div class="content-tab-heading">Code Object: ${capName}</div>
                <div class="content-tab-grid">
                    <div class="content-tab-field"><span class="content-tab-key">Linkage</span><span class="content-tab-val">${linkage}</span></div>
                    <div class="content-tab-field"><span class="content-tab-key">Base</span><span class="content-tab-val">${base}</span></div>
                    <div class="content-tab-field"><span class="content-tab-key">Size</span><span class="content-tab-val">${size}</span></div>
                    <div class="content-tab-field"><span class="content-tab-key">Perms</span><span class="content-tab-val">[${(cap.perms || []).join(', ')}]</span></div>
                </div>
                <div class="content-tab-desc">Loaded into CR7 (Nucleus register) during boot. Contains the secure entry points for system calls. X permission required for execution.</div>
            </div>`
        };
    }

    if (objType === 'Data') {
        const dataNS = namespaceObjects.find(o => o.name === capName);
        const base = dataNS ? `0x${dataNS.word1_location.toString(16).toUpperCase()}` : 
                     cap.base !== undefined ? `0x${cap.base.toString(16).toUpperCase()}` : '--';
        const size = dataNS ? `0x${dataNS.word2_limit.toString(16).toUpperCase()}` :
                     cap.size !== undefined ? `0x${cap.size.toString(16).toUpperCase()}` : '--';
        return {
            label: 'Data',
            tooltip: 'Data object — memory region',
            html: `<div class="content-tab-section">
                <div class="content-tab-heading">Data Object: ${capName}</div>
                <div class="content-tab-grid">
                    <div class="content-tab-field"><span class="content-tab-key">Base</span><span class="content-tab-val">${base}</span></div>
                    <div class="content-tab-field"><span class="content-tab-key">Size</span><span class="content-tab-val">${size}</span></div>
                    <div class="content-tab-field"><span class="content-tab-key">Perms</span><span class="content-tab-val">[${(cap.perms || []).join(', ')}]</span></div>
                </div>
                <div class="content-tab-desc">Turing domain data region. R permission for reading, W for writing. Hardware enforces bounds checking via W2 (Limit).</div>
            </div>`
        };
    }

    if (objType === 'Function') {
        const desc = cap.desc || '';
        const mathType = cap.mathType || '';
        const base = cap.base !== undefined ? `0x${cap.base.toString(16).toUpperCase()}` : '--';
        const size = cap.size !== undefined ? `${cap.size} bytes` : '--';
        return {
            label: 'Lambda',
            tooltip: 'Function — executable lambda',
            html: `<div class="content-tab-section">
                <div class="content-tab-heading">Function: ${capName}</div>
                <div class="content-tab-grid">
                    <div class="content-tab-field"><span class="content-tab-key">Base</span><span class="content-tab-val">${base}</span></div>
                    <div class="content-tab-field"><span class="content-tab-key">Size</span><span class="content-tab-val">${size}</span></div>
                    ${mathType ? `<div class="content-tab-field"><span class="content-tab-key">Domain</span><span class="content-tab-val">${mathType}</span></div>` : ''}
                    <div class="content-tab-field"><span class="content-tab-key">Perms</span><span class="content-tab-val">[${(cap.perms || []).join(', ')}]</span></div>
                </div>
                ${desc ? `<div class="content-tab-desc">${desc}</div>` : ''}
                <div class="content-tab-desc">Invoked via LAMBDA CRn,x — uses X permission (not E). Arguments/results in data registers. Machine-status fast path.</div>
            </div>`
        };
    }

    if (objType === 'Abstraction') {
        const absCList = abstractionCLists[capName];
        if (absCList) {
            const entries = absCList.clist || [];
            const count = entries.length;
            return {
                label: `Contents (${count})`,
                tooltip: `${capName} abstraction internal C-List`,
                html: `<div class="content-tab-section">
                    <div class="content-tab-heading">${capName} [${absCList.mathType || ''}]</div>
                    ${absCList.description ? `<div class="content-tab-desc">${absCList.description}</div>` : ''}
                    <div class="clist-tab-header" style="margin-top:0.4rem;"><span class="clist-tab-count">${count} entries</span></div>
                    <div class="clist-tab-entries">${renderCListEntries(entries, capName)}</div>
                </div>`
            };
        }
        const base = cap.nsEntry ? `0x${Number(cap.nsEntry.word1_location).toString(16).toUpperCase()}` : '--';
        const size = cap.nsEntry ? `0x${Number(cap.nsEntry.word2_limit).toString(16).toUpperCase()}` : '--';
        return {
            label: 'Abstraction',
            tooltip: 'Abstraction object details',
            html: `<div class="content-tab-section">
                <div class="content-tab-heading">Abstraction: ${capName}</div>
                <div class="content-tab-grid">
                    <div class="content-tab-field"><span class="content-tab-key">Base</span><span class="content-tab-val">${base}</span></div>
                    <div class="content-tab-field"><span class="content-tab-key">Size</span><span class="content-tab-val">${size}</span></div>
                    <div class="content-tab-field"><span class="content-tab-key">Perms</span><span class="content-tab-val">[${(cap.perms || []).join(', ')}]</span></div>
                </div>
                <div class="content-tab-desc">Callable via CALL instruction with E permission. Domain separation enforced — capabilities never leak into data registers.</div>
            </div>`
        };
    }

    if (objType === 'System' && capName === 'Namespace') {
        const nsEntries = namespaceObjects.map(o => ({
            name: o.name,
            type: o.type,
            perms: o.perms || [],
            nsOffset: o.offset,
            base: o.word1_location,
            size: o.word2_limit,
            desc: o.tooltip || ''
        }));
        const count = nsEntries.length;
        return {
            label: `Namespace (${count})`,
            tooltip: 'Namespace Table — all entries in the DNA tree',
            html: `<div class="content-tab-section">
                <div class="content-tab-heading">Namespace Table (${count} entries)</div>
                <div class="content-tab-desc">Root of all capability addressing. Each entry is a 3-word descriptor (Location, Limit, Seals). M elevated on CR15 by microcode — never stored in GT.</div>
                <div class="clist-tab-entries" style="margin-top:0.4rem;">${renderCListEntries(nsEntries, 'Namespace')}</div>
            </div>`
        };
    }

    if (objType === 'Null') {
        return {
            label: 'Null',
            tooltip: 'NULL Golden Token — empty/invalid/revoked',
            html: `<div class="content-tab-section">
                <div class="content-tab-heading">NULL Token</div>
                <div class="content-tab-desc">GT Type 10 (NULL) — unambiguous initialization, clean revocation, and GC clarity. No namespace entry is referenced.</div>
            </div>`
        };
    }

    const hasFallbackCList = cap.clist && cap.clist.length > 0;
    if (hasFallbackCList) {
        const entries = cap.clist;
        const count = entries.length;
        return {
            label: `Contents (${count})`,
            tooltip: `${objType} entries`,
            html: `<div class="content-tab-section">
                <div class="content-tab-heading">${capName} [${objType}]</div>
                <div class="clist-tab-header"><span class="clist-tab-count">${count} entries</span></div>
                <div class="clist-tab-entries">${renderCListEntries(entries, capName)}</div>
            </div>`
        };
    }

    return {
        label: 'Info',
        tooltip: 'Object information',
        html: `<div class="content-tab-section">
            <div class="content-tab-heading">${capName}</div>
            <div class="content-tab-grid">
                <div class="content-tab-field"><span class="content-tab-key">Type</span><span class="content-tab-val">${objType}</span></div>
                <div class="content-tab-field"><span class="content-tab-key">Perms</span><span class="content-tab-val">[${(cap.perms || []).join(', ')}]</span></div>
            </div>
        </div>`
    };
}

function showCapabilityDetail(evt, cap, regLabel) {
    document.querySelectorAll('.token-card').forEach(c => c.classList.remove('selected'));
    if (evt && evt.currentTarget) {
        evt.currentTarget.classList.add('selected');
    }
    
    currentEditingCap = cap;
    currentEditingRegLabel = regLabel;
    
    // Track C-List index if this is a C-List entry (not a context register)
    currentEditingClistIndex = -1;
    if (regLabel && regLabel.startsWith('CL[')) {
        const match = regLabel.match(/CL\[(\d+)\]/);
        if (match) {
            currentEditingClistIndex = parseInt(match[1]);
        }
    } else if (cap.name && simulator.clist) {
        // Find by name in clist
        currentEditingClistIndex = simulator.clist.findIndex(c => c.name === cap.name);
    }
    
    const panel = document.getElementById('capDetailPanel');
    const allPerms = ['R', 'W', 'X', 'L', 'S', 'E'];
    const permNames = {
        R: 'Read', W: 'Write', X: 'Execute',
        L: 'Load', S: 'Store', E: 'Enter'
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
    
    const hasCList = cap.clist && cap.clist.length > 0;
    const clistCount = hasCList ? cap.clist.length : 0;

    const wordStackHtml = `
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
                        <span class="field-label" data-tooltip="Bits 32-47: GT type field (Inform, Outform, NULL, Abstract)">Type [32:47]</span>
                        <input type="text" id="gtSpare" class="field-input" value="0x${spare.toString(16).toUpperCase().padStart(4, '0')}" onchange="updateGTFromEditor()">
                    </div>
                    <div class="field-group field-right">
                        <div class="field-label-row">
                            <span class="field-label" data-tooltip="Bits 48-53: Permission flags (R=Read, W=Write, X=Execute, L=Load, S=Save, E=Enter)">Perms [48:53]</span>
                            <span class="perm-hex">= 0x${gtDecoded.permBits.toString(16).toUpperCase().padStart(4, '0')}</span>
                        </div>
                        <div class="perm-checkboxes">${permCheckboxes}</div>
                    </div>
                </div>
            </div>
            
            <div class="word-row nmd-row">
                <div class="word-key" data-tooltip="Namespace Descriptor Word 1 - ${cap.isFar ? 'Remote URL location' : 'Physical memory address'}">W1</div>
                <div class="hex-btns">
                    ${cap.isFar ? '<span class="hex-btn-disabled" data-tooltip="URL mode - hex display not applicable">--</span>' : `<button class="hex-btn" data-tooltip="Big-Endian (MSB first): ${formatWord(cap.nsEntry.word1_location)}" id="w1HexBtn">Hex</button>`}
                    ${cap.isFar ? '<span class="hex-btn-disabled" data-tooltip="URL mode - LE display not applicable">--</span>' : `<button class="le-btn" data-tooltip="Little-Endian (LSB first, ARM byte order): ${formatLittleEndian(cap.nsEntry.word1_location)}" id="w1LeBtn">LE</button>`}
                </div>
                <div class="word-fields">
                    <div class="field-group field-right-full">
                        <span class="field-label" data-tooltip="Bits 0-63: ${cap.isFar ? 'Remote URL location' : 'Physical memory address (local)'}">${cap.isFar ? 'Location (URL)' : 'Location (Address)'} [0:63]</span>
                        <input type="text" id="nsLocation" class="field-input field-wide ${cap.isFar ? 'url-field' : ''}" value="${formatLocation(cap.nsEntry.word1_location, cap.isFar)}" onchange="updateNSFromEditor()">
                    </div>
                </div>
            </div>
            
            <div class="word-row nmd-row">
                <div class="word-key" data-tooltip="Namespace Descriptor Word 2 - ${cap.isFar ? 'Content length in bytes' : 'Size limit in bytes'}">W2</div>
                <div class="hex-btns">
                    <button class="hex-btn" data-tooltip="Big-Endian (MSB first): ${formatWord(cap.nsEntry.word2_limit)}" id="w2HexBtn">Hex</button>
                    <button class="le-btn" data-tooltip="Little-Endian (LSB first, ARM byte order): ${formatLittleEndian(cap.nsEntry.word2_limit)}" id="w2LeBtn">LE</button>
                </div>
                <div class="word-fields">
                    <div class="field-group field-right-full">
                        <span class="field-label" data-tooltip="Bits 0-63: ${cap.isFar ? 'Content length for remote resource' : 'Maximum size - hardware enforces bounds checking'}">${cap.isFar ? 'Length' : 'Limit'} [0:63]</span>
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
        </div>`;

    const contentTabInfo = getContentTabInfo(cap);

    const hasE = cap.perms && cap.perms.includes('E') && abstractionCLists[cap.name];
    const zoomBtnHtml = hasE ? `<button class="cap-detail-tab zoom-tab-btn" onclick="zoomToAbstraction('${cap.name}')" data-tooltip="Zoom into this abstraction's C-List">Zoom</button>` : '';

    const tabBarHtml = `
        <div class="cap-detail-tabs">
            <button class="cap-detail-tab" onclick="switchCapDetailTab('gt', this)" data-tooltip="Golden Token and Namespace Descriptor">GT</button>
            <button class="cap-detail-tab active" onclick="switchCapDetailTab('content', this)" data-tooltip="${contentTabInfo.tooltip}">${contentTabInfo.label}</button>
            ${zoomBtnHtml}
        </div>`;

    panel.innerHTML = `
        <div class="cap-title-bar">
            <div class="cap-lock-status">
                ${lockStatusHtml}
            </div>
            <div class="cap-hierarchy-title" data-tooltip="Capability hierarchy path from Namespace root">
                ${hierarchyHtml}
            </div>
        </div>
        ${tabBarHtml}
        <div id="gtTabContent" style="display:none;">${wordStackHtml}</div>
        <div id="contentTabContent">${contentTabInfo.html}</div>
    `;

    panel.querySelectorAll('.clist-tab-executable').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const funcName = el.dataset.funcName;
            const parent = el.dataset.parent;
            if (funcName) openFunctionInEditor(funcName, parent);
        });
    });
}

function switchCapDetailTab(tab, btn) {
    document.querySelectorAll('.cap-detail-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    const gtContent = document.getElementById('gtTabContent');
    const contentTab = document.getElementById('contentTabContent');
    if (tab === 'gt') {
        if (gtContent) gtContent.style.display = '';
        if (contentTab) contentTab.style.display = 'none';
    } else {
        if (gtContent) gtContent.style.display = 'none';
        if (contentTab) contentTab.style.display = '';
    }
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
    
    // CRITICAL: Sync permissions back to simulator context registers
    // This ensures Assembly Editor sees the updated permissions
    if (currentEditingRegLabel) {
        const match = currentEditingRegLabel.match(/^CR(\d+)$/);
        if (match) {
            const regNum = parseInt(match[1]);
            if (regNum < 8 && simulator.contextRegs[regNum]) {
                simulator.contextRegs[regNum].perms = [...perms];
                simulator.contextRegs[regNum].location = currentEditingCap.location;
            } else if (regNum === 8 && simulator.cr8) {
                simulator.cr8.perms = [...perms];
            } else if (regNum === 15 && simulator.cr15) {
                simulator.cr15.perms = [...perms];
            }
        }
    }
    
    // CRITICAL: Also sync C-List entry permissions if editing a C-List entry
    if (currentEditingClistIndex >= 0) {
        // Update simulator.clist
        if (simulator.clist && simulator.clist[currentEditingClistIndex]) {
            simulator.clist[currentEditingClistIndex].perms = [...perms];
        }
        // Update CR6's clist (the authoritative source)
        const cr6 = simulator.contextRegs[6];
        if (cr6 && cr6.clist && cr6.clist[currentEditingClistIndex]) {
            cr6.clist[currentEditingClistIndex].perms = [...perms];
        }
    }
    
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
    
    const isFar = currentEditingCap.isFar || false;
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
    
    if (type === 'Thread' || namespaceObjects.some(o => o.type === 'Thread' && o.name === name)) {
        return 'Thread';
    }
    if (type === 'Code' || name === 'Access' || name.endsWith('.asm')) {
        return 'Code';
    }
    if (type === 'Abstraction' || abstractionCLists[name] !== undefined) {
        return 'Abstraction';
    }
    if (type === 'C-List' || name === 'Boot' || name === 'Services') {
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
            const isAbstraction = (nsObj && nsObj.type === 'Abstraction') ||
                                 (abstractionCLists[entry.name] !== undefined);
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
            } else if (type === 'Thread') {
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
    
    if (!hasGT || !reg || !reg.name || reg.name === 'NULL') {
        showEmptyRegisterDetail(regIndex);
        return;
    }
    
    const resolvedCList = reg.clist || getCListForCR(reg);
    const cap = {
        name: reg.name,
        type: reg.type || getCapabilityTypeLabel(reg),
        perms: reg.perms || [],
        locked: reg.locked,
        location: reg.location || { offset: reg.nsOffset || 0 },
        size: reg.size || 1024,
        nsOffset: reg.nsOffset || 0,
        nsEntry: reg.nsEntry,
        goldenKey: reg.goldenKey,
        clist: resolvedCList || null
    };
    
    if (!cap.location.offset && cap.location.offset !== 0) {
        cap.location.offset = cap.nsOffset || 0;
    }
    
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
    populateCodeFileDropdown();
    initBreakpointClicks();
    
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
    currentPerms: '[RX]',
    breakpoints: new Set(),
    pausedAtBreakpoint: false
};

const TRACE_MAX = 127;
let traceHistory = [];
let traceSeq = 0;

function traceRecord(line, op, args, result, linkage) {
    const entry = {
        seq: traceSeq++,
        line: line,
        op: op,
        args: args.join(' '),
        result: result || '',
        linkage: linkage || editorState.currentLinkage,
        fault: result && typeof result === 'string' && result.includes('FAULT')
    };
    traceHistory.push(entry);
    if (traceHistory.length > TRACE_MAX) {
        traceHistory.shift();
    }
}

function clearTrace() {
    traceHistory = [];
    traceSeq = 0;
    updateTraceView();
}

function updateTraceView() {
    const container = document.getElementById('editorTrace');
    if (!container) return;
    container.innerHTML = '';
    if (traceHistory.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'console-line info';
        empty.textContent = 'No instructions traced yet';
        container.appendChild(empty);
        return;
    }
    const frag = document.createDocumentFragment();
    for (let i = traceHistory.length - 1; i >= 0; i--) {
        const e = traceHistory[i];
        const row = document.createElement('div');
        row.className = `trace-row${e.fault ? ' trace-fault' : ''}`;

        const seqSpan = document.createElement('span');
        seqSpan.className = 'trace-seq';
        seqSpan.textContent = String(e.seq).padStart(4, ' ');

        const lineSpan = document.createElement('span');
        lineSpan.className = 'trace-line';
        lineSpan.textContent = `L${e.line}`;

        const instrSpan = document.createElement('span');
        instrSpan.className = 'trace-instr';
        instrSpan.textContent = e.args ? `${e.op} ${e.args}` : e.op;

        const commentSpan = document.createElement('span');
        commentSpan.className = 'trace-comment';
        const shortResult = e.result.length > 60 ? e.result.substring(0, 57) + '...' : e.result;
        commentSpan.textContent = `; ${shortResult}`;
        commentSpan.title = e.result;

        row.appendChild(seqSpan);
        row.appendChild(lineSpan);
        row.appendChild(instrSpan);
        row.appendChild(commentSpan);
        frag.appendChild(row);
    }
    container.appendChild(frag);
}

function updateEditorToolbar() {
    const pathEl = document.getElementById('editorFilePath');
    const permsEl = document.getElementById('editorPerms');
    const selectEl = document.getElementById('editorFileSelect');
    
    const linkageWithExt = editorState.currentLinkage.endsWith('.asm') ? editorState.currentLinkage : editorState.currentLinkage + '.asm';
    if (pathEl) pathEl.textContent = linkageWithExt;
    if (permsEl) permsEl.textContent = editorState.currentPerms;
    
    // Update dropdown selection to match current file
    if (selectEl && editorState.currentLinkage) {
        const parts = editorState.currentLinkage.split('/');
        const key = parts[parts.length - 1];
        selectEl.value = key;
    }
}

function populateCodeFileDropdown() {
    const selectEl = document.getElementById('editorFileSelect');
    if (!selectEl) return;
    
    selectEl.innerHTML = '<option value="">Select file...</option>';
    
    // Group 1: Example Programs (Turing)
    const turingGroup = document.createElement('optgroup');
    turingGroup.label = 'Turing Examples';
    const turingExamples = ['access', 'firstfault', 'counter', 'fibonacci', 'multiply', 'flags', 'callerCode'];
    turingExamples.forEach(name => {
        if (examplePrograms[name]) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name + '.asm';
            turingGroup.appendChild(opt);
        }
    });
    selectEl.appendChild(turingGroup);
    
    // Group 2: Lambda/Church Examples
    const lambdaGroup = document.createElement('optgroup');
    lambdaGroup.label = 'Lambda Examples';
    const lambdaExamples = ['hp35_lambda', 'sliderule_lambda', 'hello_mum', 'ycombinator', 'factorial', 'capcheck', 'capmgr', 'datetime', 'church_bool', 'church_num', 'pair'];
    lambdaExamples.forEach(name => {
        if (codeTemplates[name]) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name + '.asm';
            lambdaGroup.appendChild(opt);
        }
    });
    selectEl.appendChild(lambdaGroup);
    
    // Group 3: Abstraction Functions (GT_*)
    const funcGroup = document.createElement('optgroup');
    funcGroup.label = 'Abstraction Functions';
    Object.keys(functionBetaCode).sort().forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name + '.asm';
        funcGroup.appendChild(opt);
    });
    selectEl.appendChild(funcGroup);
}

function selectCodeFile(name) {
    if (!name) return;
    
    // Try to find code in examplePrograms, codeTemplates, or functionBetaCode
    let code = examplePrograms[name] || codeTemplates[name] || functionBetaCode[name];
    if (!code) return;
    
    // Determine linkage path based on source and parent abstraction
    let linkage;
    if (examplePrograms[name]) {
        linkage = `Boot/Examples/${name}`;
    } else if (codeTemplates[name]) {
        linkage = `Boot/Lambda/${name}`;
    } else if (functionBetaCode[name]) {
        // Map GT_* functions to their parent abstractions
        const parentAbstraction = getParentAbstraction(name);
        linkage = `Boot/${parentAbstraction}/${name}`;
    }
    
    capturePreChangeState();
    setEditorCode(code, linkage, '[RX]');
    savedEditorContent = code;
    pushCodeHistory(code);
    resetProgram();
    editorLog(`Loaded: ${name}.asm`, 'success');
}

function getParentAbstraction(funcName) {
    // Lambda (functional) - Church calculus true macros (still in C-List)
    if (['GT_Y_COMBINATOR', 'GT_CHURCH_SUCC', 'GT_CHURCH_PRED', 'GT_CHURCH_ADD', 'GT_CHURCH_MUL', 
         'GT_PAIR', 'GT_FST', 'GT_SND', 'GT_TRUE', 'GT_FALSE', 'GT_IF'].includes(funcName)) {
        return 'Lambda';
    }
    // Default fallback - use Nucleus for unknown functions
    return 'Nucleus';
}

const examplePrograms = {
    access: `; =============================================
; ACCESS.ASM - LAMBDA TEST HARNESS
; =============================================
; Purpose: Demonstrates the LAMBDA instruction
; applying Church functions to data registers.
; LAMBDA uses X permission (not E like CALL),
; is non-nestable, and operates in-place.
;
; Flow: Enter Lambda abstraction via CALL,
; LOAD individual function GTs [R,X] from its
; C-List, then apply with LAMBDA instruction.
;
; Output: DR0 holds result of each application
; =============================================

; === STEP 1: Enter Lambda Abstraction ===
; Load Lambda [E] from root C-List index 8
LOAD 0 6 8        ; CR0 <- C-List[8] (Lambda)
TPERM 0 E         ; Verify Enter permission
B NE fault        ; FAULT if missing

; CALL Lambda to get its local C-List
CALL 0            ; Enter Lambda scope

; === STEP 2: Load SUCC function [R,X] ===
; Lambda C-List[3] = GT_CHURCH_SUCC
LOAD 0 6 3        ; CR0 <- SUCC [R,X]
TPERM 0 X         ; Verify eXecute permission
B NE fault        ; FAULT if missing

; === STEP 3: LAMBDA SUCC ===
; DR0 = 3, apply SUCC -> expect DR0 = 4
ADDI 0 3          ; DR0 = 3
LAMBDA 0 0        ; SUCC(3) -> DR0 = 4

; === STEP 4: Load ADD function [R,X] ===
; Lambda C-List[5] = GT_CHURCH_ADD
LOAD 1 6 5        ; CR1 <- ADD [R,X]

; === STEP 5: LAMBDA ADD ===
; DR0 = 4 (from SUCC), set DR1 = 10
ADDI 1 10         ; DR1 = 0+10 = 10
LAMBDA 1 0        ; ADD(4, 10) -> DR0 = 14

; === STEP 6: Load MUL function [R,X] ===
; Lambda C-List[6] = GT_CHURCH_MUL
LOAD 2 6 6        ; CR2 <- MUL [R,X]

; === STEP 7: LAMBDA MUL ===
; DR0 = 14 (from ADD), DR1 still 10
; Need DR1 = 3: subtract 7 from 10
SUBI 1 7          ; DR1 = 10-7 = 3
LAMBDA 2 0        ; MUL(14, 3) -> DR0 = 42

; === DONE: DR0 = 42 (the answer) ===
B done

fault:
FAULT

done:
HALT`,

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
; The Nucleus logs: WHO faulted, WHEN, WHERE (NIA)
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
; Load NULL GT from Boot C-List[0] into each CR
; Keep only CR7 (Nucleus), CR8 (Thread), CR15 (Namespace)
LOAD 0 6 0        ; CR0 = NULL GT (from C-List[0])
LOAD 1 6 0        ; CR1 = NULL GT
LOAD 2 6 0        ; CR2 = NULL GT
LOAD 3 6 0        ; CR3 = NULL GT
LOAD 4 6 0        ; CR4 = NULL GT
LOAD 5 6 0        ; CR5 = NULL GT
; CR6 (C-List) - cleared by Nucleus
; CR7 (Nucleus) - preserved for recovery
; CR8 (Thread) - preserved for audit
; CR15 (Namespace) - preserved for recovery

; Step 4: Transfer to Nucleus fault handler
; The Nucleus will:
;   - Log the fault (thread, time, NIA only)
;   - Optionally notify administrator
;   - Terminate or restart the thread
;   - Never reveal WHY it faulted

; Load Access code [R,X] from C-List[1] (hardware-enforced entry point)
LOAD 0 6 1        ; CR0 = Access [R,X] from Boot C-List
CALL 0            ; Re-enter nucleus code — never returns
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
; arithmetic and compare operations in CM.
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
; This separation is fundamental to CM security.
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
    let savedLinkage = localStorage.getItem('ctmm_editor_linkage');
    const savedPerms = localStorage.getItem('ctmm_editor_perms');
    
    // Migrate old invalid linkages (e.g., Boot/Functions/GT_DATETIME -> Boot/DateTime/GT_DATETIME)
    if (savedLinkage && savedLinkage.includes('/Functions/')) {
        const funcMatch = savedLinkage.match(/\/Functions\/(GT_\w+|Abacus_GT_\w+)/);
        if (funcMatch) {
            const funcName = funcMatch[1];
            const parentAbstraction = getParentAbstraction(funcName);
            savedLinkage = `Boot/${parentAbstraction}/${funcName}`;
            localStorage.setItem('ctmm_editor_linkage', savedLinkage);
        }
    }
    
    if (savedContent) {
        const isOldAccess = (savedContent.includes('TPERM 0 RW') && savedContent.includes('TPERM 0 S') && savedContent.includes('ACCESS.ASM'))
            || (savedContent.includes('LOAD 0 6 4') && savedContent.includes('TPERM 0 E') && savedContent.includes('RETURN'))
            || (savedContent.includes('ACCESS.ASM') && savedContent.includes('TPERM 0 E') && !savedContent.includes('B done'))
            || (savedContent.includes('ACCESS.ASM') && savedContent.includes('TPERM 0 E') && !savedContent.includes('HALT'))
            || (savedContent.includes('ACCESS.ASM') && savedContent.includes('FAILSAFE INPUT VALIDATION') && !savedContent.includes('LAMBDA'));
        if (isOldAccess && typeof examplePrograms !== 'undefined' && examplePrograms.access) {
            editor.value = examplePrograms.access;
            savedEditorContent = examplePrograms.access;
            lastSavedCode = examplePrograms.access;
            localStorage.setItem('ctmm_editor_content', examplePrograms.access);
            editorState.currentLinkage = 'Boot/Examples/access';
            editorState.currentPerms = '[RX]';
            localStorage.setItem('ctmm_editor_linkage', editorState.currentLinkage);
            localStorage.setItem('ctmm_editor_perms', editorState.currentPerms);
            editorLog('Updated Access.asm to current version', 'info');
        } else {
            editor.value = savedContent;
            savedEditorContent = savedContent;
            lastSavedCode = savedContent;
        }
        if (savedLinkage && !isOldAccess) editorState.currentLinkage = savedLinkage;
        if (savedPerms && !isOldAccess) editorState.currentPerms = savedPerms;
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

function updateLineNumbers(highlightLine = null) {
    const editor = document.getElementById('codeEditor');
    const lineNumbers = document.getElementById('lineNumbers');
    if (!editor || !lineNumbers) return;
    
    const lineToHighlight = highlightLine !== null ? highlightLine : currentExecutionLine;
    
    const lines = editor.value.split('\n').length;
    let nums = [];
    for (let i = 1; i <= lines; i++) {
        const isHighlighted = i === lineToHighlight;
        const hasBP = editorState.breakpoints.has(i);
        let cls = '';
        if (isHighlighted && hasBP) cls = 'exec-line bp-line';
        else if (isHighlighted) cls = 'exec-line';
        else if (hasBP) cls = 'bp-line';
        nums.push(`<span class="${cls}" data-line="${i}">${i}</span>`);
    }
    lineNumbers.innerHTML = nums.join('');
}

function toggleBreakpoint(lineNum) {
    if (editorState.breakpoints.has(lineNum)) {
        editorState.breakpoints.delete(lineNum);
    } else {
        editorState.breakpoints.add(lineNum);
    }
    updateLineNumbers();
    updateParsedView();
}

function initBreakpointClicks() {
    const lineNumbers = document.getElementById('lineNumbers');
    if (!lineNumbers) return;
    lineNumbers.addEventListener('click', (e) => {
        const span = e.target.closest('span[data-line]');
        if (span) {
            const lineNum = parseInt(span.dataset.line);
            if (!isNaN(lineNum)) toggleBreakpoint(lineNum);
        }
    });
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

function ensureBooted() {
    if (bootState.complete) return true;

    const cr7 = simulator.contextRegs[7];
    const stepsRun = bootState.step;
    const stepsRemain = 4 - stepsRun;
    const stepNames = ['Fault Restart', 'Load Namespace', 'Switch Thread + Load Services', 'Call Boot'];

    let html = '<div class="cr7-overlay" id="cr7Overlay" onclick="if(event.target===this)closeCR7Overlay()">';
    html += '<div class="cr7-panel">';
    html += '<div class="cr7-panel-header">';
    html += '<span>Boot Required — Cannot Execute</span>';
    html += '<button onclick="closeCR7Overlay()" class="cr7-close">&times;</button>';
    html += '</div>';
    html += '<div class="cr7-panel-body">';

    html += '<div class="cr7-section">';
    html += '<div class="cr7-section-title">CR7 — Active Nucleus [X]</div>';
    if (cr7 && cr7.name !== 'NULL') {
        html += `<div class="cr7-field"><span class="cr7-label">Name</span><span class="cr7-value">${cr7.name}</span></div>`;
        html += `<div class="cr7-field"><span class="cr7-label">Perms</span><span class="cr7-value">${cr7.perms ? '[' + cr7.perms.join('') + ']' : '[]'}</span></div>`;
    } else {
        html += '<div class="cr7-empty">NULL — no code loaded</div>';
    }
    html += '</div>';

    html += '<div class="cr7-section">';
    html += '<div class="cr7-section-title" style="color: var(--error)">Diagnostic</div>';
    html += `<div class="cr7-field"><span class="cr7-label">Boot steps completed</span><span class="cr7-value">${stepsRun} of 4</span></div>`;
    for (let i = 0; i < 4; i++) {
        const done = i < stepsRun;
        const icon = done ? '<span style="color:var(--success)">&#10003;</span>' : '<span style="color:var(--error)">&#10007;</span>';
        html += `<div class="cr7-field"><span class="cr7-label">${icon} Step ${i + 1}</span><span class="cr7-value">${stepNames[i]}</span></div>`;
    }
    html += `<div class="cr7-field" style="margin-top:0.5em"><span class="cr7-label">Status</span><span class="cr7-value" style="color:var(--error)">Cannot execute — ${stepsRemain} boot step${stepsRemain > 1 ? 's' : ''} remaining</span></div>`;
    html += `<div class="cr7-field"><span class="cr7-label">Action</span><span class="cr7-value">Complete boot sequence on the Dashboard before running code</span></div>`;
    html += '</div>';

    html += '</div></div></div>';
    document.body.insertAdjacentHTML('beforeend', html);
    return false;
}

function runOrContinue() {
    if (editorState.pausedAtBreakpoint && editorState.program.length > 0 && editorState.nia < editorState.program.length) {
        runProgram(true);
    } else {
        runProgram(false);
    }
}

function runProgram(continueFromCurrent = false) {
  try {
    if (!continueFromCurrent) {
        if (!autoBootIfNeeded()) return;

        const code = document.getElementById('codeEditor').value;
        editorState.program = parseProgram(code);
        editorState.nia = 0;
        
        if (editorState.program.length === 0) {
            editorLog('No instructions to execute', 'error');
            return;
        }
        
        markEditorSaved();
        clearEditorConsole();
        simulator.softReset();
    }

    const hasBPs = editorState.breakpoints.size > 0;
    editorState.pausedAtBreakpoint = false;
    if (hasBPs) {
        editorLog('Running to breakpoint...', 'info');
    } else {
        editorLog('Running program...', 'info');
    }
    
    const MAX_INSTRUCTIONS = 10000;
    let count = 0;
    let hitBreakpoint = false;
    let skipFirstBPCheck = continueFromCurrent;
    
    while (editorState.nia < editorState.program.length) {
        if (count++ > MAX_INSTRUCTIONS) {
            editorLog('*** HALTED: Execution limit reached (possible infinite loop) ***', 'error');
            break;
        }

        const instr = editorState.program[editorState.nia];
        if (hasBPs && !skipFirstBPCheck && editorState.breakpoints.has(instr.line)) {
            hitBreakpoint = true;
            editorState.pausedAtBreakpoint = true;
            editorLog(`*** BREAKPOINT hit at line ${instr.line} ***`, 'info');
            break;
        }
        skipFirstBPCheck = false;

        const faultOccurred = executeEditorInstruction(instr);
        editorState.nia++;
        
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
    
    if (hitBreakpoint) {
        editorLog('Use Step to single-step, or Run to continue to next breakpoint', 'info');
    } else if (count <= MAX_INSTRUCTIONS) {
        editorLog('Program completed successfully', 'success');
    }
    updateEditorStatus();
    updateEditorRegisters();
    updateParsedView();
    updateDisplay();
    highlightCurrentLine();
    updateCapabilityExplorer();
  } catch (e) {
    console.error('runProgram error:', e);
    editorLog('*** Error: ' + e.message + ' ***', 'error');
  }
}

function autoBootIfNeeded() {
    if (!bootState.complete) {
        for (let i = bootState.step; i < 4; i++) {
            executeBootStep(i);
            bootState.step = i + 1;
        }
        bootState.complete = true;
        updateBootDisplay();
        updateDisplay();
        updateCapabilityExplorer();
        log('Auto-boot complete — system ready', 'success');
    }
    return true;
}

function stepProgram() {
    if (!autoBootIfNeeded()) return;

    if (editorState.program.length === 0) {
        const code = document.getElementById('codeEditor').value;
        editorState.program = parseProgram(code);
        editorState.nia = 0;
        simulator.softReset();
        markEditorSaved();
        clearEditorConsole();
        editorLog('Starting step execution...', 'info');
        updateParsedView();
    }
    
    if (editorState.nia >= editorState.program.length) {
        editorLog('Program completed', 'success');
        return;
    }
    
    const instr = editorState.program[editorState.nia];
    const faultOccurred = executeEditorInstruction(instr);
    editorState.nia++;
    
    if (faultOccurred) {
        editorLog('*** FAULT detected - investigate before continuing ***', 'error');
    }
    
    updateEditorStatus();
    updateEditorRegisters();
    highlightCurrentLine();
    updateDisplay();
    updateCapabilityExplorer();
}

function syncEditorToCR7() {
    const cr7 = simulator.contextRegs[7];
    if (!cr7 || cr7.name === 'NULL') return;
    const linkage = cr7.linkage || `${cr7.name}/Nucleus.asm`;
    const perms = cr7.perms ? `[${cr7.perms.join('')}]` : '[X]';
    editorState.currentLinkage = linkage;
    editorState.currentPerms = perms;

    const nameLower = cr7.name.toLowerCase();
    const code = functionBetaCode[cr7.name]
              || examplePrograms[cr7.name] || examplePrograms[nameLower]
              || codeTemplates[cr7.name] || codeTemplates[nameLower];
    if (code) {
        const editor = document.getElementById('codeEditor');
        if (editor) {
            editor.value = code;
            updateLineNumbers();
        }
    }

    updateEditorToolbar();
}

function showCR7Code() {
    const cr6 = simulator.contextRegs[6];
    const cr7 = simulator.contextRegs[7];
    const cr5 = simulator.contextRegs[5];

    let html = '<div class="cr7-overlay" id="cr7Overlay" onclick="if(event.target===this)closeCR7Overlay()">';
    html += '<div class="cr7-panel">';
    html += '<div class="cr7-panel-header">';
    html += '<span>Simulator Context — Live State</span>';
    html += '<button onclick="closeCR7Overlay()" class="cr7-close">&times;</button>';
    html += '</div>';
    html += '<div class="cr7-panel-body">';

    html += '<div class="cr7-section">';
    html += '<div class="cr7-section-title">CR7 — Active Nucleus [X]</div>';
    if (cr7 && cr7.name !== 'NULL') {
        const perms = cr7.perms ? `[${cr7.perms.join('')}]` : '[]';
        html += `<div class="cr7-field"><span class="cr7-label">Name</span><span class="cr7-value">${cr7.name}</span></div>`;
        html += `<div class="cr7-field"><span class="cr7-label">Perms</span><span class="cr7-value perm-badge-green">${perms}</span></div>`;
        html += `<div class="cr7-field"><span class="cr7-label">Type</span><span class="cr7-value">${cr7.type || 'Code'}</span></div>`;
        if (cr7.linkage) {
            html += `<div class="cr7-field"><span class="cr7-label">Linkage</span><span class="cr7-value cr7-linkage">${cr7.linkage}</span></div>`;
        }
        if (cr7.base !== undefined) {
            html += `<div class="cr7-field"><span class="cr7-label">Base</span><span class="cr7-value">0x${cr7.base.toString(16).toUpperCase()}</span></div>`;
        }
        if (cr7.size !== undefined) {
            html += `<div class="cr7-field"><span class="cr7-label">Limit</span><span class="cr7-value">0x${cr7.size.toString(16).toUpperCase()}</span></div>`;
        }
        if (cr7.nsOffset !== undefined) {
            html += `<div class="cr7-field"><span class="cr7-label">NS Offset</span><span class="cr7-value">${cr7.nsOffset}</span></div>`;
        }
        if (cr7.goldenKey) {
            html += `<div class="cr7-field"><span class="cr7-label">Golden Key</span><span class="cr7-value cr7-key">${cr7.goldenKey}</span></div>`;
        }
    } else {
        html += '<div class="cr7-empty">NULL — no code loaded</div>';
    }
    html += '</div>';

    html += '<div class="cr7-section">';
    html += '<div class="cr7-section-title">CR6 — Active C-List [E]</div>';
    if (cr6 && cr6.name !== 'NULL') {
        const perms6 = cr6.perms ? `[${cr6.perms.join('')}]` : '[]';
        html += `<div class="cr7-field"><span class="cr7-label">Scope</span><span class="cr7-value">${cr6.name} ${perms6}</span></div>`;
        if (cr6.clistCount !== undefined) {
            html += `<div class="cr7-field"><span class="cr7-label">Entries</span><span class="cr7-value">${cr6.clistCount}</span></div>`;
        }
        if (cr6.clist && cr6.clist.length > 0) {
            html += '<div class="cr7-clist">';
            cr6.clist.forEach((entry, idx) => {
                const ePerms = entry.perms ? `[${entry.perms.join('')}]` : '';
                const eType = entry.type || '';
                const eName = entry.name || `Entry_${idx}`;
                const typeClass = eType === 'NULL' ? 'cr7-type-null' : eType === 'Code' ? 'cr7-type-code' : eType === 'Function' ? 'cr7-type-func' : 'cr7-type-abs';
                html += `<div class="cr7-clist-entry">`;
                html += `<span class="cr7-clist-idx">[${idx}]</span>`;
                html += `<span class="cr7-clist-name">${eName}</span>`;
                html += `<span class="cr7-clist-type ${typeClass}">${eType}</span>`;
                html += `<span class="cr7-clist-perms">${ePerms}</span>`;
                html += `</div>`;
            });
            html += '</div>';
        }
    } else {
        html += '<div class="cr7-empty">NULL — no scope loaded</div>';
    }
    html += '</div>';

    html += '<div class="cr7-section">';
    html += '<div class="cr7-section-title">CR5 — Services [E] (stable)</div>';
    if (cr5 && cr5.name !== 'NULL') {
        html += `<div class="cr7-field"><span class="cr7-label">Name</span><span class="cr7-value">${cr5.name}</span></div>`;
        if (cr5.clist && cr5.clist.length > 0) {
            html += '<div class="cr7-clist">';
            cr5.clist.forEach((entry, idx) => {
                const ePerms = entry.perms ? `[${entry.perms.join('')}]` : '';
                html += `<div class="cr7-clist-entry">`;
                html += `<span class="cr7-clist-idx">[${idx}]</span>`;
                html += `<span class="cr7-clist-name">${entry.name || `Entry_${idx}`}</span>`;
                html += `<span class="cr7-clist-perms">${ePerms}</span>`;
                html += `</div>`;
            });
            html += '</div>';
        }
    } else {
        html += '<div class="cr7-empty">NULL — not loaded</div>';
    }
    html += '</div>';

    html += '<div class="cr7-section">';
    html += '<div class="cr7-section-title">CR0–CR4 (instruction-addressable)</div>';
    html += '<div class="cr7-clist">';
    for (let i = 0; i <= 4; i++) {
        const cr = simulator.contextRegs[i];
        const name = cr && cr.name !== 'NULL' ? cr.name : 'NULL';
        const p = cr && cr.perms ? `[${cr.perms.join('')}]` : '';
        const cls = name === 'NULL' ? 'cr7-type-null' : '';
        html += `<div class="cr7-clist-entry">`;
        html += `<span class="cr7-clist-idx">CR${i}</span>`;
        html += `<span class="cr7-clist-name ${cls}">${name}</span>`;
        html += `<span class="cr7-clist-perms">${p}</span>`;
        html += `</div>`;
    }
    html += '</div></div>';

    html += '<div class="cr7-section">';
    html += '<div class="cr7-section-title">Execution</div>';
    html += `<div class="cr7-field"><span class="cr7-label">NIA</span><span class="cr7-value">${editorState.nia}</span></div>`;
    html += `<div class="cr7-field"><span class="cr7-label">Stack Depth</span><span class="cr7-value">${simulator.stackDepth || 0}</span></div>`;
    const flags = simulator.flags;
    html += `<div class="cr7-field"><span class="cr7-label">Flags</span><span class="cr7-value">N=${flags.N?1:0} Z=${flags.Z?1:0} C=${flags.C?1:0} V=${flags.V?1:0}</span></div>`;
    html += '</div>';

    html += '</div></div></div>';

    const existing = document.getElementById('cr7Overlay');
    if (existing) existing.remove();
    document.body.insertAdjacentHTML('beforeend', html);
}

function closeCR7Overlay() {
    const overlay = document.getElementById('cr7Overlay');
    if (overlay) overlay.remove();
}

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

function sendCtmmReply(replyText) {
    if (!replyText || !replyText.trim()) return;
    const notification = {
        target: 'rv32cap',
        message: replyText.trim(),
        timestamp: Date.now(),
        seen: false,
        details: {
            from: '<b>Kenneth</b> (CM Sim-64)',
            to: '<b>Priscilla</b> (Capability Sim-32)',
            items: [
                { label: 'Instruction', value: 'CALL(CONNECT(me, mymother))' },
                { label: 'Golden Tokens', value: '3 (Tunnel Key + Service + ABI)' },
                { label: 'ABI Mapping', value: 'DR0-DR5 (64-bit) \u2192 x10-x15 (32-bit)' },
                { label: 'Type', value: 'Interactive tunnel reply' }
            ]
        }
    };
    const existing = JSON.parse(localStorage.getItem('ctmm-tunnel-notification') || '[]');
    const queue = Array.isArray(existing) ? existing : [];
    queue.push(notification);
    localStorage.setItem('ctmm-tunnel-notification', JSON.stringify(queue));
    const overlay = document.getElementById('tunnelMsgOverlay');
    if (overlay) overlay.remove();
}

function showTunnelMessage(direction, message, details, timestamp) {
    const existing = document.getElementById('tunnelMsgOverlay');
    if (existing) existing.remove();
    
    const isSend = direction === 'send';
    const arrow = isSend ? '&rarr;' : '&larr;';
    const title = isSend ? 'Message Sent via Encrypted Tunnel' : 'Message Received via Encrypted Tunnel';
    const color = isSend ? '#00e676' : '#42a5f5';
    const icon = isSend ? '&#x1F4E4;' : '&#x1F4E5;';
    const timeStr = formatTunnelTime(timestamp);
    const safeMessage = escapeTunnelHtml(message);
    
    const overlay = document.createElement('div');
    overlay.id = 'tunnelMsgOverlay';
    overlay.className = 'cr7-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    
    overlay.innerHTML = `
        <div class="tunnel-msg-panel">
            <div class="tunnel-msg-header" style="border-bottom-color: ${color}">
                <span class="tunnel-msg-icon">${icon}</span>
                <span>${title}</span>
                <button onclick="document.getElementById('tunnelMsgOverlay').remove()" class="cr7-close">&times;</button>
            </div>
            <div class="tunnel-msg-body">
                <div class="tunnel-msg-timestamp" style="color: ${color}">${timeStr}</div>
                <div class="tunnel-msg-payload${message.length > 30 ? ' tunnel-long-msg' : ''}" style="border-color: ${color}; color: ${color}">
                    "${safeMessage}"
                </div>
                <div class="tunnel-reply-section">
                    <input type="text" class="tunnel-reply-input" id="tunnelReplyInput" placeholder="Type a reply to Priscilla..." maxlength="200">
                    <button class="tunnel-reply-btn" onclick="sendCtmmReply(document.getElementById('tunnelReplyInput').value)" style="background: ${color}">Send Reply</button>
                </div>
                <div class="tunnel-msg-flow">
                    ${details.from} <span style="color:${color};font-size:1.5em">${arrow}</span> ${details.to}
                </div>
                <div class="tunnel-msg-details">
                    ${details.items.map(item => `<div class="tunnel-detail-row"><span class="tunnel-detail-label">${item.label}</span><span class="tunnel-detail-value">${item.value}</span></div>`).join('')}
                </div>
                <div class="tunnel-msg-zeroes">
                    <span style="color: ${color}">7 Zeroes:</span> No OS, No VM, No privilege, No superuser, No unauthorized code, No unauthorized data, No containment escape
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(overlay);
    const input = document.getElementById('tunnelReplyInput');
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') sendCtmmReply(input.value);
        });
    }
}

function closeTunnelMessage() {
    const overlay = document.getElementById('tunnelMsgOverlay');
    if (overlay) overlay.remove();
}

function executeMethodSelector(absName, methodSelector) {
    const abs = abstractionCLists[absName];
    if (!abs || !abs.methodSelector) return null;
    
    const dr0 = Number(simulator.dataRegs[0] || 0n);
    const methodName = abs.methodSelector[dr0];
    if (!methodName) return `FAULT: METHOD: ${absName} — invalid method selector DR0=${dr0}`;
    
    const dr1 = Number(simulator.dataRegs[1] || 0n);
    const dr2 = Number(simulator.dataRegs[2] || 0n);
    const dr3 = Number(simulator.dataRegs[3] || 0n);
    let result = 0;
    let desc = '';
    
    if (absName === 'SlideRule') {
        switch (methodName) {
            case 'ADD': result = dr1 + dr2; desc = `ADD(${dr1}, ${dr2}) = ${result}`; break;
            case 'SUB': result = dr1 - dr2; desc = `SUB(${dr1}, ${dr2}) = ${result}`; break;
            case 'MUL': result = dr1 * dr2; desc = `MUL(${dr1}, ${dr2}) = ${result}`; break;
            case 'DIV': 
                if (dr2 === 0) return `FAULT: DIV_BY_ZERO: SlideRule.DIV — DR2=0`;
                result = dr1 / dr2; desc = `DIV(${dr1}, ${dr2}) = ${result}`; break;
            case 'MOD':
                if (dr2 === 0) return `FAULT: DIV_BY_ZERO: SlideRule.MOD — DR2=0`;
                result = dr1 % dr2; desc = `MOD(${dr1}, ${dr2}) = ${result}`; break;
            case 'LOG': result = Math.log(dr1); desc = `LOG(${dr1}) = ${result}`; break;
            case 'EXP': result = Math.exp(dr1); desc = `EXP(${dr1}) = ${result}`; break;
            case 'SQRT': result = Math.sqrt(dr1); desc = `SQRT(${dr1}) = ${result}`; break;
            case 'POW': result = Math.pow(dr1, dr2); desc = `POW(${dr1}, ${dr2}) = ${result}`; break;
        }
    } else if (absName === 'Abacus') {
        const a = BigInt(dr1), b = BigInt(dr2);
        switch (methodName) {
            case 'ADD': result = a + b; desc = `ADD(${dr1}, ${dr2}) = ${result}`; break;
            case 'SUB': result = a - b; desc = `SUB(${dr1}, ${dr2}) = ${result}`; break;
            case 'MUL': result = a * b; desc = `MUL(${dr1}, ${dr2}) = ${result}`; break;
            case 'DIV':
                if (b === 0n) return `FAULT: DIV_BY_ZERO: Abacus.DIV — DR2=0`;
                result = a / b; desc = `DIV(${dr1}, ${dr2}) = ${result}`; break;
            case 'MOD':
                if (b === 0n) return `FAULT: DIV_BY_ZERO: Abacus.MOD — DR2=0`;
                result = a % b; desc = `MOD(${dr1}, ${dr2}) = ${result}`; break;
            case 'ABS': result = a < 0n ? -a : a; desc = `ABS(${dr1}) = ${result}`; break;
            case 'NEG': result = -a; desc = `NEG(${dr1}) = ${result}`; break;
            case 'INC': result = a + 1n; desc = `INC(${dr1}) = ${result}`; break;
            case 'DEC': result = a - 1n; desc = `DEC(${dr1}) = ${result}`; break;
        }
    } else if (absName === 'Circle') {
        const PI = 3.14159265358979;
        switch (methodName) {
            case 'PI': result = PI; desc = `PI = ${result}`; break;
            case 'TWO_PI': result = 2 * PI; desc = `TWO_PI = ${result}`; break;
            case 'CIRCUMFERENCE': result = 2 * PI * dr1; desc = `CIRCUMFERENCE(r=${dr1}) = ${result}`; break;
            case 'AREA': result = PI * dr1 * dr1; desc = `AREA(r=${dr1}) = ${result}`; break;
            case 'DIAMETER': result = 2 * dr1; desc = `DIAMETER(r=${dr1}) = ${result}`; break;
        }
    } else if (absName === 'DateTime') {
        const now = new Date();
        switch (methodName) {
            case 'TIMESTAMP': desc = `TIMESTAMP = ${now.toISOString()}`; result = 0; break;
            case 'DATE': desc = `DATE = ${now.toISOString().split('T')[0]}`; result = 0; break;
            case 'TIME': desc = `TIME = ${now.toTimeString().split(' ')[0]}`; result = 0; break;
            case 'EPOCH': result = Math.floor(now.getTime() / 1000); desc = `EPOCH = ${result}`; break;
            case 'COMPONENTS':
                simulator.dataRegs[1] = BigInt(now.getFullYear());
                simulator.dataRegs[2] = BigInt(now.getMonth() + 1);
                simulator.dataRegs[3] = BigInt(now.getDate());
                simulator.dataRegs[4] = BigInt(now.getHours());
                simulator.dataRegs[5] = BigInt(now.getMinutes());
                simulator.dataRegs[6] = BigInt(now.getSeconds());
                desc = `COMPONENTS → DR1-DR6 = ${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()} ${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`;
                result = 0; break;
        }
    } else if (absName === 'Mint') {
        switch (methodName) {
            case 'MINT': desc = `MINT(perm=0x${dr1.toString(16)}, type=${dr2}, size=${dr3}) → new GT in CR0`; result = 0; break;
            case 'RESTRICT': desc = `RESTRICT(CR0, mask=0x${dr1.toString(16)}) → restricted GT in CR0`; result = 0; break;
            case 'REVOKE': desc = `REVOKE(CR0) → version bumped, all copies invalidated`; result = 0; break;
            case 'INSPECT': desc = `INSPECT(CR0) → DR1=perms, DR2=type, DR3=version, DR4=offset`; result = 0; break;
        }
    } else if (absName === 'FamilyRegistry') {
        if (!window._familyRegistry) window._familyRegistry = {};
        switch (methodName) {
            case 'REGISTER': {
                const nameCode = dr1;
                const archCode = dr2;
                const archName = archCode === 1 ? 'CM-64' : archCode === 2 ? 'Capability' : `arch-${archCode}`;
                const remoteAddr = 0xC7440000 + nameCode;
                window._familyRegistry[nameCode] = { name: nameCode, arch: archName, archCode: archCode, addr: remoteAddr, bound: false };
                desc = `REGISTER(name=${nameCode}, arch=${archName}) → registered at 0x${remoteAddr.toString(16).toUpperCase()}, tunnel key pair created`;
                result = 1; break;
            }
            case 'LOOKUP': {
                const entry = window._familyRegistry[dr1];
                if (entry) {
                    simulator.dataRegs[1] = BigInt(entry.archCode);
                    desc = `LOOKUP(${dr1}) → addr=0x${entry.addr.toString(16).toUpperCase()}, arch=${entry.arch}`;
                    result = entry.addr;
                } else {
                    desc = `LOOKUP(${dr1}) → FAULT: not registered`;
                    result = 0;
                }
                break;
            }
            case 'BIND': {
                const cr1 = simulator.contextRegs[1];
                if (cr1 && cr1.type === 'Outform') {
                    cr1.far = true;
                    cr1.bound = true;
                    const regEntry = Object.values(window._familyRegistry).find(e => !e.bound);
                    if (regEntry) {
                        cr1.remoteAddr = regEntry.addr;
                        regEntry.bound = true;
                        const nsObj = namespaceObjects.find(o => o.name === cr1.name);
                        if (nsObj) {
                            nsObj.word2_limit = (nsObj.word2_limit & 0x1FFFF) | (1 << 31) | (1 << 30);
                            nsObj.word1_location = regEntry.addr;
                        }
                        desc = `BIND(CR1=${cr1.name}) → F=1 B=1, location=0x${regEntry.addr.toString(16).toUpperCase()} written to namespace entry`;
                    } else {
                        desc = `BIND(CR1=${cr1.name}) → F=1 B=1, remote address bound`;
                    }
                } else {
                    desc = `BIND(CR1) → FAULT: CR1 must be Outform type`;
                }
                result = 1; break;
            }
            case 'REVOKE': {
                const cr1 = simulator.contextRegs[1];
                if (cr1) {
                    cr1.far = false;
                    cr1.bound = false;
                    const nsObj = namespaceObjects.find(o => o.name === cr1.name);
                    if (nsObj) {
                        nsObj.word2_limit = nsObj.word2_limit & 0x1FFFF;
                    }
                    desc = `REVOKE(CR1=${cr1.name}) → F=0 B=0, binding cleared`;
                } else {
                    desc = `REVOKE(CR1) → no capability to revoke`;
                }
                result = 1; break;
            }
            case 'STATUS': {
                const cr1 = simulator.contextRegs[1];
                const isBound = cr1 && cr1.bound;
                const isFar = cr1 && cr1.far;
                const addr = cr1 && cr1.remoteAddr ? cr1.remoteAddr : 0;
                simulator.dataRegs[0] = BigInt(isFar ? 1 : 0);
                simulator.dataRegs[1] = BigInt(isBound ? 1 : 0);
                simulator.dataRegs[2] = BigInt(addr);
                desc = `STATUS(CR1=${cr1?cr1.name:'NULL'}) → F=${isFar?1:0}, B=${isBound?1:0}, addr=0x${addr.toString(16).toUpperCase()}`;
                result = isFar ? 1 : 0; break;
            }
        }
    }
    
    if (typeof result === 'bigint') {
        simulator.dataRegs[0] = result & BigInt("0xFFFFFFFFFFFFFFFF");
    } else {
        simulator.dataRegs[0] = BigInt(Math.round(result)) & BigInt("0xFFFFFFFFFFFFFFFF");
    }
    
    return `${absName}.${methodName}: ${desc}`;
}

function executeConstantsDispatch() {
    const constCList = abstractionCLists.Constants.clist;
    const cr1 = simulator.contextRegs[1];
    if (!cr1 || cr1.type !== 'Abstract') {
        return `FAULT: TYPE_ABSTRACT — Constants requires Abstract GT in CR1, got ${cr1 ? cr1.type || 'unknown' : 'empty'}`;
    }
    if (!cr1.name || !cr1.name.startsWith('GT_')) {
        return `FAULT: PROVENANCE — Abstract GT in CR1 not recognized (expected GT_* constant name)`;
    }
    const constEntry = constCList.find(e => e.name === cr1.name && e.type === 'Abstract');
    if (!constEntry || constEntry.value === undefined) {
        return `FAULT: INVALID_CONSTANT — Abstract GT "${cr1.name}" not recognized by Constants`;
    }
    const constNames = { GT_PI: 'π', GT_E: 'e', GT_PHI: 'φ', GT_SQRT2: '√2', GT_LN2: 'ln(2)', GT_LN10: 'ln(10)', GT_C: 'c', GT_PLANCK: 'h', GT_BOLTZMANN: 'k_B', GT_AVOGADRO: 'N_A', GT_G: 'G' };
    const symbol = constNames[cr1.name] || cr1.name;
    const value = constEntry.value;
    if (Number.isInteger(value) || Math.abs(value) > 1) {
        simulator.dataRegs[0] = BigInt(Math.round(value)) & BigInt("0xFFFFFFFFFFFFFFFF");
    } else {
        const ieee754Bits = new BigUint64Array(new Float64Array([value]).buffer);
        simulator.dataRegs[0] = ieee754Bits[0];
    }
    return `Constants.${symbol}: ${value} → DR0`;
}

function resolveCallTarget(targetName) {
    const nsObj = namespaceObjects.find(o => o.name === targetName);
    if (!nsObj) return;

    if (nsObj.type === 'Abstraction' || nsObj.type === 'C-List' ||
        (nsObj.type === 'Thread' && targetName === 'Boot')) {
        const absCList = abstractionCLists[targetName];
        if (absCList) {
            const cr6 = simulator.contextRegs[6];
            if (cr6) {
                cr6.name = targetName;
                cr6.nsOffset = nsObj.offset;
                cr6.type = "C-List";
                cr6.clist = absCList.clist;
                cr6.clistCount = absCList.clist.length;
                cr6.word1 = nsObj.word1_location;
                cr6.word2 = nsObj.word2_limit;
                cr6.word3 = nsObj.word3_seals;
            }
        } else if (targetName === 'Boot') {
            const cr6 = simulator.contextRegs[6];
            if (cr6) {
                cr6.name = "Boot";
                cr6.nsOffset = bootCList.nsOffset;
                cr6.type = "C-List";
                cr6.clist = bootCList.entries;
                cr6.clistCount = bootCList.entries.length;
                cr6.word1 = nsObj.word1_location;
                cr6.word2 = nsObj.word2_limit;
                cr6.word3 = nsObj.word3_seals;
            }
        }

        let codeNS = null;
        let codeLinkage = null;
        if (absCList) {
            codeNS = nsObj;
            codeLinkage = `${targetName}/Nucleus.asm`;
        } else if (targetName === 'Boot') {
            const accessEntry = bootCList.entries.find(e => e.name === 'Access');
            if (accessEntry) {
                codeNS = namespaceObjects.find(o => o.offset === accessEntry.nsOffset);
                codeLinkage = codeNS?.linkage || 'Boot/Access.asm';
            }
        }

        if (codeNS) {
            const cr7 = simulator.contextRegs[7];
            if (cr7) {
                cr7.name = codeNS.name || targetName;
                cr7.nsOffset = codeNS.offset;
                cr7.type = "Code";
                cr7.linkage = codeLinkage;
                cr7.base = codeNS.word1_location;
                cr7.size = codeNS.word2_limit;
                cr7.word1 = codeNS.word1_location;
                cr7.word2 = codeNS.word2_limit;
                cr7.word3 = codeNS.word3_seals;
            }
        }
    }
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
                        editorState.nia = targetLine;
                        result = `Branch to ${target} (line ${targetLine})`;
                    } else {
                        result = `FAULT: Label '${target}' not found`;
                        faultOccurred = true;
                    }
                } else {
                    const isFaultGuard = String(target || '').toLowerCase() === 'fault';
                    if (isFaultGuard) {
                        const guardReasons = {
                            'NE': 'values equal — permission check passed',
                            'GT': 'not greater — bounds check passed',
                            'GE': 'less than — check passed',
                            'LT': 'not less — check passed',
                            'LE': 'greater — check passed',
                            'EQ': 'not equal — check passed',
                            'CS': 'no carry — check passed',
                            'CC': 'carry set — check passed',
                            'MI': 'not negative — check passed',
                            'PL': 'negative — check passed'
                        };
                        result = `OK: ${guardReasons[cond] || 'condition not met — check passed'}`;
                    } else {
                        result = `Branch not taken (${cond} not met)`;
                    }
                }
                const logLevel = faultOccurred ? 'error' : (String(target || '').toLowerCase() === 'fault' && !simulator.checkCondition(cond)) ? 'success' : 'exec';
                traceRecord(line, op, args, result, editorState.currentLinkage);
                editorLog(`[${line}] ${op} ${args.join(' ')}: ${result}`, logLevel);
                updateTraceView();
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
                        simulator.setDataReg(14, BigInt(editorState.nia + 1));
                        editorState.nia = targetLine;
                        result = `Branch with link to ${target}, LR=${editorState.nia}`;
                    } else {
                        result = `FAULT: Label '${target}' not found`;
                        faultOccurred = true;
                    }
                } else {
                    result = `Branch not taken (${cond} failed)`;
                }
                traceRecord(line, op, args, result, editorState.currentLinkage);
                editorLog(`[${line}] ${op} ${args.join(' ')}: ${result}`, faultOccurred ? 'error' : 'exec');
                updateTraceView();
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
            
            case 'CALL': {
                const callCR = simulator.contextRegs[args[0]];
                const callTargetName = callCR ? callCR.name : null;
                const isOutform = callCR && callCR.type === 'Outform';
                result = simulator.execute(op, args[0]);
                if (result && !result.startsWith('FAULT') && callTargetName) {
                    if (isOutform && result.includes('[TUNNEL]')) {
                        const drVals = [];
                        for (let i = 0; i <= 5; i++) drVals.push(Number(simulator.dataRegs[i] || 0n));
                        const tunnelMatch = result.match(/Payload:.*\("(.+?)"\)/);
                        const payloadMsg = tunnelMatch ? tunnelMatch[1] : drVals.map(c => String.fromCharCode(c & 0x7F)).join('');
                        const msgChars = payloadMsg.split('');
                        const displayMsg = msgChars.join('') === 'HelloM' ? 'Hello Mum' : payloadMsg;
                        const tunnelNotification = {
                            target: 'rv32cap',
                            message: displayMsg,
                            timestamp: Date.now(),
                            seen: false,
                            details: {
                                from: '<b>Kenneth</b> (CM Sim-64)',
                                to: '<b>Priscilla</b> (Capability Sim-32)',
                                items: [
                                    { label: 'Instruction', value: 'CALL(CONNECT(me, mymother))' },
                                    { label: 'Golden Tokens', value: '3 (Tunnel Key + Service + ABI)' },
                                    { label: 'Tunnel', value: callCR.tunnelId || 'encrypted' },
                                    { label: 'Endpoint', value: callCR.remoteEndpoint || 'remote' },
                                    { label: 'ABI Mapping', value: 'DR0-DR5 (64-bit) \u2192 x10-x15 (32-bit)' },
                                    { label: 'Result', value: 'DR0 = 1 (ACK \u2014 remote acknowledged)' }
                                ]
                            }
                        };
                        const existingQ = JSON.parse(localStorage.getItem('ctmm-tunnel-notification') || '[]');
                        const sendQ = Array.isArray(existingQ) ? existingQ : [];
                        sendQ.push(tunnelNotification);
                        localStorage.setItem('ctmm-tunnel-notification', JSON.stringify(sendQ));
                        result += '\n  [NOTIFICATION] Sent to Priscilla (Capability) \u2014 check her Sim-32 page';
                    } else {
                        resolveCallTarget(callTargetName);
                        const absData = abstractionCLists[callTargetName];
                        if (absData && absData.methodSelector) {
                            const dispatchResult = executeMethodSelector(callTargetName);
                            if (dispatchResult) {
                                if (dispatchResult.startsWith('FAULT')) {
                                    faultOccurred = true;
                                    result = dispatchResult;
                                } else {
                                    result += ` → [DISPATCH] ${dispatchResult}`;
                                }
                            }
                        } else if (callTargetName === 'Constants') {
                            const dispatchResult = executeConstantsDispatch();
                            if (dispatchResult) {
                                if (dispatchResult.startsWith('FAULT')) {
                                    faultOccurred = true;
                                    result = dispatchResult;
                                } else {
                                    result += ` → [DISPATCH] ${dispatchResult}`;
                                }
                            }
                        }
                        syncEditorToCR7();
                        const cr7Now = simulator.contextRegs[7];
                        if (cr7Now && cr7Now.name !== 'NULL') {
                            result += ` → CR7 = ${cr7Now.linkage || cr7Now.name}`;
                        }
                    }
                }
                break;
            }
            
            case 'RETURN':
                result = simulator.execute(op);
                if (!result || !result.startsWith('FAULT')) {
                    syncEditorToCR7();
                    const cr7Now = simulator.contextRegs[7];
                    if (cr7Now && cr7Now.name !== 'NULL') {
                        result += ` → CR7 = ${cr7Now.linkage || cr7Now.name}`;
                    }
                }
                break;
            
            case 'CHANGE':
                result = simulator.execute(op, args[0], args[1]);
                if (!result || !result.startsWith('FAULT')) {
                    syncEditorToCR7();
                    const cr7Now = simulator.contextRegs[7];
                    if (cr7Now && cr7Now.name !== 'NULL') {
                        result += ` → CR7 = ${cr7Now.linkage || cr7Now.name}`;
                    }
                }
                break;
            
            case 'SWITCH':
                result = simulator.execute(op, args[0], args[1], args[2]);
                break;
            
            case 'TPERM':
                result = simulator.execute(op, args[0], args[1], args[2]);
                break;
            
            case 'LAMBDA': {
                const lambdaCR = simulator.contextRegs[args[0]];
                result = simulator.execute(op, args[0], args[1]);
                if (!result || !result.startsWith('FAULT')) {
                    if (lambdaCR && lambdaCR.name !== 'NULL') {
                        const lambdaLinkage = lambdaCR.linkage || `${lambdaCR.name}/Lambda.asm`;
                        const lambdaPerms = lambdaCR.perms ? `[${lambdaCR.perms.join('')}]` : '[X]';
                        editorState.currentLinkage = lambdaLinkage;
                        editorState.currentPerms = lambdaPerms;

                        const lambdaCode = functionBetaCode[lambdaCR.name];
                        if (lambdaCode) {
                            const editor = document.getElementById('codeEditor');
                            if (editor) {
                                editor.value = lambdaCode;
                                updateLineNumbers();
                            }
                        }

                        updateEditorToolbar();
                    }
                }
                break;
            }
            
            case 'LABEL':
                return false;
            
            case 'HALT': {
                traceRecord(line, 'HALT', [], 'Program stopped', editorState.currentLinkage);
                editorLog(`[${line}] HALT: Program stopped`, 'success');
                updateTraceView();
                editorState.nia = editorState.program.length;
                const haltDRs = [];
                for (let i = 0; i <= 5; i++) haltDRs.push(Number(simulator.dataRegs[i] || 0n));
                const haltMsg = haltDRs.map(c => String.fromCharCode(c & 0x7F)).join('');
                const isHelloSon = haltMsg === 'HelloS' ||
                    (haltDRs[1] === 101 && haltDRs[2] === 108 && haltDRs[3] === 108 && haltDRs[4] === 111 && haltDRs[5] === 83);
                if (isHelloSon) {
                    setTimeout(() => {
                        showTunnelMessage('receive', 'Hello Son', {
                            from: '<b>Priscilla</b> (Capability Sim-32)',
                            to: '<b>Kenneth</b> (CM Sim-64)',
                            items: [
                                { label: 'Source', value: 'Reverse tunnel from mymother' },
                                { label: 'Golden Tokens', value: '3 (Tunnel Key + Reply + ABI)' },
                                { label: 'ABI Mapping', value: 'x10-x15 (32-bit) → DR0-DR5 (64-bit)' },
                                { label: 'Payload', value: 'DR0-DR5 = "HelloS" (Hello Son)' },
                                { label: 'Inbox', value: 'Son_Inbox [R,W] — validated by mLoad' },
                                { label: 'Status', value: 'Bidirectional tunnel complete' }
                            ]
                        });
                    }, 100);
                }
                return false;
            }
            
            default:
                result = `Unknown instruction: ${op}`;
                faultOccurred = true;
        }
        
        // Check if result contains FAULT
        if (result && typeof result === 'string' && result.includes('FAULT')) {
            faultOccurred = true;
        }
        
        traceRecord(line, op, args, result, editorState.currentLinkage);
        editorLog(`[${line}] ${op} ${args.join(' ')}: ${result}`, faultOccurred ? 'error' : 'exec');
        updateTraceView();
        return faultOccurred;
    } catch (e) {
        traceRecord(line, op, args, e.message, editorState.currentLinkage);
        editorLog(`[${line}] Error: ${e.message}`, 'error');
        updateTraceView();
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
    editorState.nia = 0;
    editorState.pausedAtBreakpoint = false;
    currentExecutionLine = -1;
    simulator.softReset();
    for (let i = 0; i < 8; i++) {
        simulator.contextRegs[i] = simulator.createNullCapability();
    }
    bootState.step = 0;
    bootState.complete = false;
    updateBootDisplay();
    
    clearEditorConsole();
    clearTrace();
    editorLog('Program reset — capability registers cleared to NULL', 'info');
    editorLog('Write code and click Run or Step to execute', 'info');
    
    updateEditorStatus();
    updateEditorRegisters();
    updateLineNumbers();
    updateDisplay();
    updateCapabilityExplorer();
    
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
    document.getElementById('editorNIA').textContent = editorState.nia;
    document.getElementById('editorStackDepth').textContent = `${simulator.stackDepth * 3}`;
    
    const status = editorState.nia >= editorState.program.length ? 'Completed' : 'Running';
    document.getElementById('editorStatus').textContent = status;
    
    // Update Dashboard panels with current state
    updateFlags();
    updateStackPanel();
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
        const current = i === editorState.nia ? 'current-line' : '';
        const hasBP = editorState.breakpoints.has(p.line) ? 'has-breakpoint' : '';
        html += `<div class="parsed-line ${current} ${hasBP}">`;
        const bpDot = hasBP ? '<span class="bp-dot"></span>' : '';
        html += `${bpDot}<span class="parsed-addr">${i.toString().padStart(2, '0')}</span>`;
        html += `<span class="parsed-instr">${p.instr}</span> `;
        html += `<span class="parsed-args">${p.args.join(', ')}</span>`;
        html += '</div>';
    });
    
    container.innerHTML = html || '<div class="console-line info">No instructions parsed</div>';
}

function highlightCurrentLine() {
    const parsed = document.getElementById('editorParsed');
    if (!parsed) return;
    
    // Find the source line number for the current instruction
    currentExecutionLine = -1;
    if (editorState.program && editorState.program[editorState.nia]) {
        currentExecutionLine = editorState.program[editorState.nia].line;
    }
    
    // Highlight line number in the code editor gutter
    updateLineNumbers(currentExecutionLine);
    
    // Scroll the code editor to show the current line
    const editor = document.getElementById('codeEditor');
    if (editor && currentExecutionLine > 0) {
        const lineHeight = 18; // Fixed line height for consistency
        const targetScroll = (currentExecutionLine - 1) * lineHeight - editor.clientHeight / 2 + lineHeight;
        editor.scrollTop = Math.max(0, targetScroll);
        
        // Also sync line numbers scroll
        const lineNumbers = document.getElementById('lineNumbers');
        if (lineNumbers) {
            lineNumbers.scrollTop = editor.scrollTop;
        }
    }
    
    // Highlight in parsed view
    parsed.querySelectorAll('.parsed-line').forEach((el, i) => {
        const isCurrent = i === editorState.nia;
        el.classList.toggle('current-line', isCurrent);
        if (isCurrent) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });
}

function switchOutputTab(tab) {
    document.querySelectorAll('.output-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.output-content').forEach(c => c.classList.add('hidden'));
    
    event.target.classList.add('active');
    
    const contentIds = {
        console: 'editorConsole',
        trace: 'editorTrace',
        turing: 'editorTuring',
        church: 'editorChurch'
    };
    const content = document.getElementById(contentIds[tab]);
    if (content) content.classList.remove('hidden');
    
    if (tab === 'trace') updateTraceView();
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
        4: 'CR4', 5: 'CR5 (Services)', 6: 'CR6 (Active C-List)', 7: 'CR7 (Nucleus)',
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
        
        shouldReplace = true;
        if (autoLoadedAccessAsm) autoLoadedAccessAsm = false;
        
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
        
        if (name === 'hello_mum') {
            autoBootIfNeeded();
            setupHelloMumNamespace();
        }
        
        if (!shouldReplace) {
            editorLog(`Appended example: ${name}`, 'success');
        } else {
            editorLog(`Loaded example: ${name}`, 'success');
        }
        
        if (isTuring) {
            switchParadigm('turing');
        } else if (isLambda) {
            switchParadigm('church');
        }
    }
}

function setupHelloMumNamespace() {
    if (!ensureBooted()) return;

    if (!window._familyRegistry) window._familyRegistry = {};
    window._familyRegistry[1] = { name: 1, arch: 'Capability', archCode: 2, addr: 0xC7440001, bound: true };

    const tunnelKey = simulator.createCapability("Tunnel_Key_Mum", ["R"]);
    tunnelKey.type = "Inform";
    tunnelKey.tunnelEndpoint = "mymother.namespace.local";
    tunnelKey.keyMaterial = "[HMAC-SHA256 tunnel key — hardware-protected]";

    const mumService = simulator.createCapability("Mum_Messaging", ["E"]);
    mumService.type = "Outform";
    mumService.remoteEndpoint = "https://mymother.ctmm.net/messaging";
    mumService.tunnelId = "tunnel_me_mum_001";
    mumService.far = true;
    mumService.bound = true;
    mumService.remoteAddr = 0xC7440001;

    const abiDescriptor = simulator.createCapability("ABI_Mum", ["R"]);
    abiDescriptor.type = "Inform";
    abiDescriptor.abiMap = {
        src_arch: "CM-64", src_regs: "DR0-DR15 (64-bit)",
        dst_arch: "Capability", dst_regs: "x0-x31 (32-bit)",
        arg_map: "DR0→x10, DR1→x11, DR2→x12, DR3→x13, DR4→x14, DR5→x15, DR6→x16, DR7→x17, DR8→x18",
        ret_map: "x10→DR0"
    };

    const sonInbox = simulator.createCapability("Son_Inbox", ["R", "W"]);
    sonInbox.type = "Inform";

    const sonService = simulator.createCapability("Son_Receive", ["E"]);
    sonService.type = "Inform";

    const meCList = simulator.createCapability("Me_CList", ["E"]);
    meCList.type = "Inform";
    meCList.clist = [tunnelKey, mumService, abiDescriptor, sonInbox, sonService];

    simulator.contextRegs[6] = meCList;
    simulator.registerCapability(meCList);

    const helloMumNsEntries = [
        { name: "Tunnel_Key_Mum", type: "Abstraction", perms: ["R"],
          word1_location: 0xA100, word2_limit: 0x100,
          tooltip: "HMAC-SHA256 tunnel key for encrypted channel to mymother." },
        { name: "Mum_Messaging", type: "Abstraction", perms: ["E"],
          word1_location: 0xC7440001, word2_limit: (1 << 31) | (1 << 30) | 0x200,
          tooltip: "Outform+Far GT — remote messaging to mymother (Capability) @ 0xC7440001. F=1 B=1. Address placed by FamilyRegistry at bind time." },
        { name: "ABI_Mum", type: "Abstraction", perms: ["R"],
          word1_location: 0xA400, word2_limit: 0x100,
          tooltip: "ABI descriptor: DR0-DR8 (64-bit) → x10-x18 (32-bit)." },
        { name: "Son_Inbox", type: "Data", perms: ["R", "W"],
          word1_location: 0xA600, word2_limit: 0x400,
          tooltip: "Inbox for receiving \"Hello Son\" reply from mymother (Priscilla)." },
        { name: "Son_Receive", type: "Abstraction", perms: ["E"],
          word1_location: 0xA700, word2_limit: 0x100,
          tooltip: "Service handler for receiving reverse-tunnel messages from mymother." },
        { name: "Me_CList", type: "C-List", perms: ["E"],
          word1_location: 0xA500, word2_limit: 0x100,
          tooltip: "Hello Mum/Son C-List for \"me\" — holds Tunnel Key, Messaging, ABI, Son Inbox." }
    ];

    const baseOffset = namespaceObjects.length;

    namespaceObjects = namespaceObjects.filter(o => !o._helloMum);

    helloMumNsEntries.forEach((entry, i) => {
        namespaceObjects.push({
            offset: baseOffset + i,
            name: entry.name,
            type: entry.type,
            perms: entry.perms,
            word1_location: entry.word1_location,
            word2_limit: entry.word2_limit,
            word3_seals: 0n,
            tooltip: entry.tooltip,
            dynamic: true,
            _helloMum: true
        });
    });

    updateDisplay();
    updateCapabilityExplorer();
    updateNamespaceDisplay();

    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('HELLO MUM / HELLO SON — Bidirectional Tunnel', 'success');
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('', 'info');
    log('--- BINDING PROVENANCE (FamilyRegistry) ---', 'info');
    log('The FamilyRegistry abstraction (NS offset 15) created', 'info');
    log('these entries at bind time via CALL(FamilyRegistry.Register):', 'info');
    log('  1. Generated shared tunnel key material', 'info');
    log('  2. Created matching Outform+Far entries on both machines', 'info');
    log('  3. Set remote address in location field (0xC7440001)', 'info');
    log('  4. Set F=1 (Far) + B=1 (Bound) in limit word', 'info');
    log('  5. Sealed entries with MAC — binding is permanent', 'info');
    log('     until GC revokes', 'info');
    log('', 'info');
    log('CR6 = Me_CList [E] — "me" C-List:', 'info');
    log('  [0] Tunnel_Key_Mum  [R]     — Inform (tunnel crypto key)', 'info');
    log('  [1] Mum_Messaging   [E,F,B] — Outform+Far to mymother @ 0xC7440001', 'info');
    log('  [2] ABI_Mum         [R]     — Inform (register map)', 'info');
    log('  [3] Son_Inbox       [R,W]   — Inform (receive reply)', 'info');
    log('  [4] Son_Receive     [E]     — Inform (reply handler)', 'info');
    log('', 'info');
    log('Location field holds remote endpoint address,', 'info');
    log('placed there by FamilyRegistry at bind time.', 'info');
    log('No DNS. No IP lookup. The capability IS the address.', 'info');
    log('', 'info');
    log('"me" (Kenneth) = CM Sim-64 (DR0-DR15, 64-bit)', 'info');
    log('"mymother" (Priscilla) = Capability Sim-32 (x0-x31, 32-bit)', 'info');
    log('', 'info');
    log('PART 1: Send "Hello Mum" → mymother (Priscilla)', 'info');
    log('PART 2: Receive "Hello Son" ← mymother (Priscilla)', 'info');
    log('', 'info');
    log('Click Step to trace the bidirectional flow.', 'info');
    log('Open Capability Simulator for "mymother" side.', 'info');
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    editorLog('Hello Mum/Son: Namespace ready. Step to send + receive.', 'success');
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
                <p>The CM uses a fundamentally different approach: <strong>Capability-Based Security</strong>.</p>
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
                        <p>This is a <strong>Golden Token (GT)</strong> - a 64-bit capability key containing an offset, type, and permission bits.</p>
                        <p>Each GT points to a <strong>3-word Namespace Entry</strong> that describes the resource's location, size, and security seals.</p>
                    </div>
                </div>`
            },
            {
                text: `<h3>The Ten Permissions</h3>
                <p>Each capability grants specific permissions encoded in the GT. The CM uses ten permission types organized into mutually exclusive domains:</p>
                <ul>
                    <li><code>R</code> - <strong>Read</strong>: View data or code</li>
                    <li><code>W</code> - <strong>Write</strong>: Modify data</li>
                    <li><code>X</code> - <strong>Execute</strong>: Run as code</li>
                    <li><code>L</code> - <strong>Load</strong>: Load capabilities from children</li>
                    <li><code>S</code> - <strong>Store</strong>: Store capabilities to children</li>
                    <li><code>E</code> - <strong>Enter</strong>: Switch namespace or call procedure</li>
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
                            <span class="perm-demo-badge" style="background: #84cc16; color: #1a1a2e;">G</span>
                        </div>
                    </div>
                    <div class="demo-explanation">
                        <p>Permissions are encoded in bits [48:63] of the GT. The <code>M</code> permission marks hardware-level resources (Namespace, Threads), <code>F</code> indicates a remote URL, and <code>G</code> is the garbage collection flag for deterministic GC.</p>
                    </div>
                </div>`
            },
            {
                text: `<h3>Why Capabilities Matter</h3>
                <p>Traditional security has fundamental flaws like the <strong>"Confused Deputy"</strong> problem, "ROP" (Return-Oriented Programming), default privileges, and centralised superusers:</p>
                <div class="highlight">
                    A trusted program (the deputy) can be tricked into misusing its authority on behalf of a malicious actor.
                </div><div class="highlight">Malware can silently create attack code inside the system without detection.</div><div class="highlight">Increased surveillance to detect malware only leads to digital dictatorship</div>
                <p>Capabilities solve this because:</p>
                <ul>
                    <li>Authority is always explicit - you must present the capability</li>
                    <li>Delegation is controlled - you can only give away what you have</li>
                    <li>No ambient authority - programs only have the capabilities they're given</li><li>The power is distributed atomically and incrementally in line with democracy</li>
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
                    <li><strong>Type [32:47]</strong> - 16-bit type field (Inform, Outform, NULL, Abstract)</li>
                    <li><strong>Perms [48:53]</strong> - 6-bit permission flags (R, W, X, L, S, E) Read Data Allowed, Write Data Allowed, eXecute CLOOMC allowed, Load Capability from a GT allowed, Save GT allowed, Enter a Lambda Calculus Abstraction allowed</li>
                </ul>
                <div class="key-concept">
                    <strong>Key Insight:</strong> The GT contains just enough to locate and authorise access. The detailed resource description lives in the Namespace Entry.
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
                                <div style="font-size: 0.7rem;">Type</div>
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
                    The isFar property on a capability changes how W1 &amp; W2 are interpreted: local memory address vs. remote URL.
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
                text: `<h3>Starting the CM</h3>
                <p>When the CM powers on, it goes through a <strong>4-step boot sequence</strong> to establish a secure foundation.</p>
                <p>This sequence ensures that the system starts in a known, secure state with proper capabilities in place.</p>
                <div class="key-concept">
                    <strong>Why it matters:</strong> Each step builds upon the previous one, creating a chain of trust from hardware to user space. This sequence runs for all double-faults (unrecovered).</div>`,
                demo: `<div class="demo-title">Boot Sequence Steps</div>
                <div class="demo-content">
                    <div class="demo-visual">
                        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                            <div style="padding: 0.8rem; background: var(--bg-panel); border-radius: 4px; border-left: 3px solid var(--accent);">1. Hardware Reset</div>
                            <div style="padding: 0.8rem; background: var(--bg-panel); border-radius: 4px; border-left: 3px solid var(--success);">2. Load Namespace</div>
                            <div style="padding: 0.8rem; background: var(--bg-panel); border-radius: 4px; border-left: 3px solid #60a5fa;">3. Initialise Thread</div>
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
                <p><code>CR15</code> receives the system namespace capability with <code>L,S</code> permissions - the root of all accessible resources.</p>
                <h3>Step 3: Initialise Thread</h3>
                <p><code>CR8</code> gets the user thread capability for the Namespace Context Register, and <code>CR6</code> receives the C-List (capability list) for Boot abstraction.</p>
                <h3>Step 4: Load Nucleus</h3>
                <p>The CLOOMC code object is loaded into <code>CR7</code>. This is the core boot code with <code>X</code> permission (execute access to code object).</p><p>Sets the IA (Instruction Address) to zero to start the Boot Programmed Function Abstraction that kicks off self-test and recovery actions</p>`,
                demo: `<div class="demo-title">Register States After Boot</div>
                <div class="demo-content">
                    <div class="demo-visual register-demo">
                        <div class="reg-demo-item"><span class="reg-demo-name">CR7</span><span class="reg-demo-value">CLOOMC [X]</span></div>
                        <div class="reg-demo-item"><span class="reg-demo-name">CR15</span><span class="reg-demo-value">NAMESPACE [M]</span></div>
                        <div class="reg-demo-item"><span class="reg-demo-name">CR8</span><span class="reg-demo-value">THREAD SHELL [M]</span></div>
                        <div class="reg-demo-item"><span class="reg-demo-name">CR6</span><span class="reg-demo-value">BOOT C-LIST [E]</span></div>
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
                    <li>Or click <strong>Run</strong> to complete all steps at once</li><li>Go to the ASSEMBLY tab to try the samples and your hand at CLOOMC</li>
                </ol>
                <div class="highlight">
                    After booting, check the <strong>Capability Explorer</strong> to see the Golden Tokens that were LOADED!
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
                <p>The CM has two distinct register types, each serving a different purpose:</p>
                <ul>
                    <li><strong>Context GT Registers (CR0-CR7)</strong>: Hold capabilities (programmer contoled security)</li>
                    <li><strong>Meta-Machine Registers (CR8-CR15)</strong>: Reserved for hardware (Lambda Calculus functions)</li>
                    <li><strong>Data Registers (DR0-DR15)</strong>: Hold 64-bit numeric values</li>
                </ul>
                <div class="key-concept">
                    <strong>Key Insight:</strong> This separation enforces security at the hardware level. You cannot accidentally treat a number as a capability or vice versa, and it supports real-time, deterministic garbage collection.</div>`,
                demo: `<div class="demo-title">Register Comparison</div>
                <div class="demo-content">
                    <div class="demo-visual">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                            <div style="background: rgba(233, 69, 96, 0.2); padding: 1rem; border-radius: 6px;">
                                <div style="color: var(--accent); font-weight: bold; margin-bottom: 0.5rem;">Context Registers</div>
                                <div style="font-size: 0.85rem; color: var(--text-secondary);">CR0-CR7, CR8, CR15</div>
                                <div style="font-size: 0.85rem; color: var(--text-primary); margin-top: 0.3rem;">Hold type, location, range, and access capabilities rights</div>
                            </div>
                            <div style="background: rgba(74, 222, 128, 0.2); padding: 1rem; border-radius: 6px;">
                                <div style="color: var(--success); font-weight: bold; margin-bottom: 0.5rem;">Data Registers</div>
                                <div style="font-size: 0.85rem; color: var(--text-secondary);">DR0-DR15 (like ARM)</div>
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
                    <li><strong>CR0-CR7 (Programmer Security)</strong>: Accessible to application code
                        <ul>
                            <li><code>CR0-CR5</code> - General-purpose capability registers</li>
                            <li><code>CR6</code> - <strong>C-List</strong>: Current capability list</li>
                            <li><code>CR7</code> - <strong>Nucleus</strong>: CLOOMC functions as eXecutable capability</li>
                        </ul>
                    </li>
                    <li><strong>CR8-CR15 (Meta-Machine)</strong>: Reserved for hardware/OS
                        <ul>
                            <li><code>CR8</code> - <strong>Thread</strong>: Current process identity (full machine state when suspended)</li>
                            <li><code>CR15</code> - <strong>Namespace</strong>: Root of resources</li>
                        </ul>
                    </li>
                </ul>
                <div class="highlight">
                    Only CR0-CR7 can be addressed by programmer instructions. CR8-CR15 are managed by the Lambda Calculus meta-machine.
                </div>`,
                demo: `<div class="demo-title">Special Register Roles</div>
                <div class="demo-content">
                    <div class="demo-visual register-demo">
                        <div class="reg-demo-item"><span class="reg-demo-name">CR6</span><span class="reg-demo-value">C-List (Golden Tokens)</span></div>
                        <div class="reg-demo-item"><span class="reg-demo-name">CR7</span><span class="reg-demo-value">Nucleus (CLOOMC)</span></div>
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
                <p>The CM provides special instructions for capability manipulation:</p>
                <ul>
                    <li><code>LOAD d s i</code> - Load capability from memory into register</li>
                    <li><code>SAVE d s</code> - Save capability from register to memory</li>
                    <li><code>CALL reg</code> - Enter a procedure using the capability in reg</li>
                    <li><code>RETURN</code> - Exit current procedure</li>
                    <li><code>SWITCH reg</code> - Change namespace to capability in reg</li>
                </ul>
                <div class="key-concept">
                    <strong>Important:</strong> These operations always check permissions. You cannot SAVE without the S (Save) permission!
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
                        <p>LOAD brings capabilities into registers for use. SAVE (with S permission) stores them persistently.</p>
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
                <p>In the CM, even basic arithmetic is controlled by capabilities. Programs distinguish between integer and floating-point math by <strong>which abstraction they CALL</strong>:</p>
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
                            <code style="font-size: 0.8rem; color: var(--text-secondary);">LOAD CR1, Abacus<br/>ADDI 0 0  ; DR0=0 (ADD)<br/>CALL CR1  ; Dispatch int64 ADD</code>
                        </div>
                        <div style="background: rgba(52, 152, 219, 0.15); padding: 1rem; border-radius: 6px; border-left: 3px solid #3498db;">
                            <div style="color: #3498db; font-weight: bold; margin-bottom: 0.5rem;">Float Math</div>
                            <code style="font-size: 0.8rem; color: var(--text-secondary);">LOAD CR1, SlideRule<br/>ADDI 0 0  ; DR0=0 (ADD)<br/>CALL CR1  ; Dispatch IEEE754 ADD</code>
                        </div>
                    </div>
                    <div class="demo-explanation">
                        <p>Both use "ADD" but produce different results based on which abstraction (and thus which hardware) they invoke.</p>
                    </div>
                </div>`
            },
            {
                text: `<h3>System Register Updates</h3>
                <p>The <code>SWITCH</code> instruction copies a capability to a system register (CR8-CR15):</p>
                <ul>
                    <li>Uses a 3-bit target field to select destination: 0=CR8, 1=CR9, ... 7=CR15</li>
                    <li>Supports I-bit variants: I=0 (register source) or I=1 (C-List lookup)</li>
                    <li>Requires <code>L</code> (Load) permission on the source capability</li>
                </ul>
                <p>This enables controlled updates to system registers like Thread (CR8) and Namespace (CR15).</p>`,
                interactive: {
                    type: "quiz",
                    question: "Which permission is required to use CALL on a capability?",
                    options: ["R (Read)", "W (Write)", "X (Execute)", "E (Enter)"],
                    correct: 3,
                    feedback: {
                        correct: "Correct! The E (Enter) permission is required for CALL operations. SWITCH requires L (Load) permission.",
                        incorrect: "Not quite. The E (Enter) permission specifically controls entry into abstractions via CALL."
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
                <p>The CM's security comes from strict capability checking at every operation:</p>
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
                            <div style="color: var(--error); font-weight: bold;">Attempted: SAVE without S permission</div>
                            <div style="color: var(--text-secondary); font-size: 0.85rem; margin-top: 0.5rem;">Result: Operation denied - missing Save permission</div>
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
                    <strong>CM Solution:</strong> No shared privileges exist. Each Golden Token grants specific access to specific resources. There is no "privilege level" - only individual capabilities.
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
                    <strong>CM Solution:</strong> The CALL/RETURN mechanism uses Golden Tokens, not memory addresses. You cannot CALL code without holding a valid capability with E (Enter) permission. Return addresses are protected by hardware - there is no stack to overflow.
                </div>`,
                demo: `<div class="demo-title">ROP Attack vs CM Protection</div>
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
                            <div style="color: var(--success); font-weight: bold; margin-bottom: 0.5rem;">CM Protected</div>
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
                    <li>The 6 permissions (R, W, X, L, S, E) control what you can do.</li>
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
                <p>Alonzo Church's <strong>lambda calculus</strong> is the theoretical foundation for all computation. In CM, lambda expressions become Golden Tokens:</p>
                <ul>
                    <li><strong>Lambda abstraction</strong> (λx.body) = A GT pointing to executable code</li>
                    <li><strong>Application</strong> (f x) = CALL instruction with arguments in registers</li>
                    <li><strong>Loading</strong> = Loading GTs from C-Lists into Context Registers</li>
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
                            <div style="color: #eab308; font-weight: bold; margin-bottom: 0.5rem;">CM Assembly</div>
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
                <p>In CM, each boolean is a GT. Calling it with two argument GTs returns one of them.</p>`,
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
                <p>In CM, a GT in the C-List can point back to the current code block, enabling the self-application pattern (x x) through CALL.</p>`,
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
                    question: "How does CM implement lambda application (f x)?",
                    options: [
                        "Using the APPLY instruction",
                        "Using the CALL instruction with the function GT",
                        "By copying code directly",
                        "Through shared memory"
                    ],
                    correct: 1,
                    feedback: {
                        correct: "Correct! Lambda application becomes CALL with the function's Golden Token. Arguments are passed in registers.",
                        incorrect: "Not quite. In CM, lambda application (f x) is implemented using CALL with the function's GT."
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
                <p>The Assembly Editor is where you write and execute CM programs. It provides:</p>
                <ul>
                    <li><strong>Code Editor</strong> - Write CM assembly with syntax highlighting</li>
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
                <p>CM assembly uses a simple syntax:</p>
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
                demo: `<div class="demo-title">Y-Combinator in CM</div>
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
                <p>This demonstrates <strong>real recursive algorithms</strong> in CM assembly.</p>`,
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
                <p>Traditional systems waste cycles on <strong>security checks at every operation</strong>. CM's capability architecture provides performance advantages:</p>
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
                            <div style="color: var(--success); font-weight: bold; margin-bottom: 0.5rem;">CM (Fast)</div>
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
                demo: `<div class="demo-title">Traditional vs CM Recursion</div>
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
                            <div style="color: var(--success); font-weight: bold; margin-bottom: 0.5rem;">CM + GT (FAST)</div>
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
                <p>Traditional systems must serialize through security checkpoints. CM's design enables modern CPU optimizations.</p>`,
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
                        "CM uses a faster CPU clock"
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
                <p><strong>URL Paging</strong> extends virtual memory to the network. Just as traditional paging loads memory pages from disk, CM can load capability pages from remote URLs:</p>
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
                <p>Remote GTs introduce <strong>network latency</strong>, but CM optimizes this:</p>
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
                            <div style="color: var(--success); font-weight: bold; margin-bottom: 0.5rem;">CM Remote (Fast)</div>
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
                <p>CM's failsafe pattern ensures <strong>all failures look identical</strong>:</p>
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

TPERM 0 S         ; Additional permission
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
                </div>`
            },
            {
                text: `<h3>CALL/RETURN Register Masks: Preventing Malware</h3>
                <p>The <strong>CALL</strong> and <strong>RETURN</strong> instructions include register mask fields to prevent information leakage between caller and callee:</p>
                <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; margin: 1rem 0;">
                    <tr style="background: var(--bg-tertiary);"><th style="padding: 0.5rem; text-align: left;">Register Group</th><th style="padding: 0.5rem; text-align: left;">Behavior</th><th style="padding: 0.5rem; text-align: left;">Purpose</th></tr>
                    <tr><td style="padding: 0.5rem;"><strong>DR8-15</strong></td><td>Always cleared</td><td>Scratch space - never used for API</td></tr>
                    <tr style="background: var(--bg-tertiary);"><td style="padding: 0.5rem;"><strong>DR0-7</strong></td><td>Mask-controlled (8 bits)</td><td>API data variables</td></tr>
                    <tr><td style="padding: 0.5rem;"><strong>CR0-5</strong></td><td>Mask-controlled (6 bits)</td><td>API capabilities</td></tr>
                    <tr style="background: var(--bg-tertiary);"><td style="padding: 0.5rem;"><strong>CR6-7</strong></td><td>Fixed by Lambda Calculus</td><td>CR6=C-List, CR7=Nucleus (CR8=Thread identity)</td></tr>
                </table>
                <div class="key-concept" style="border-color: var(--error);">
                    <strong>Malware Defense:</strong> Mask bits prevent untrusted code from reading the caller's private data (CALL) or leaking internal state back to malicious callers (RETURN).
                </div>`,
                demo: `<div class="demo-title">Register Mask Examples</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.8rem;">
; === MASK SETUP FOR CALL ===
; Goal: Pass DR0-1 (two args), clear all capabilities
; DR mask: bit=1 means CLEAR that register
;   keep DR0-1, clear DR2-7 → 0b11111100 = 0xFC
; CR mask: clear all CR0-5 → 0b00111111 = 0x3F
; Combined: (DR_mask << 6) | CR_mask
MOV DR2, #0xFC       ; DR mask (use DR2 as temp)
LSL DR2, DR2, #6     ; Shift left 6 bits
ORR DR2, DR2, #0x3F  ; OR with CR mask
; DR2 now holds mask = 0x3F3F
; Load arguments into DR0 and DR1
MOV DR0, #42         ; First argument
MOV DR1, #10         ; Second argument  
CALL CR0, DR2        ; Call with mask in DR2

; === MASK SETUP FOR RETURN ===
; Goal: Return only DR0 (result), clear rest
; DR mask: keep DR0, clear DR1-7 → 0b11111110 = 0xFE
; CR mask: clear all CR0-5 → 0b00111111 = 0x3F
MOV DR1, #0xFE       ; DR mask
LSL DR1, DR1, #6     ; Shift left 6 bits
ORR DR1, DR1, #0x3F  ; OR with CR mask
; DR1 now holds mask = 0x3FBF
RETURN DR1           ; Return with mask

; === COMMON MASK PATTERNS ===
; Format: (DR_mask << 6) | CR_mask
; Full clear (pass nothing):
;   DR=0xFF, CR=0x3F → 0x3FFF
; Pass all (clear nothing):
;   DR=0x00, CR=0x00 → 0x0000
; Pass DR0 only, no caps:
;   DR=0xFE, CR=0x3F → 0x3FBF
; Pass DR0-1, no caps:
;   DR=0xFC, CR=0x3F → 0x3F3F</pre>
                </div>`
            },
            {
                text: `<h3>The 14-Bit API Boundary</h3>
                <p>The register mask creates a <strong>hardware-enforced API boundary</strong> between caller and callee:</p>
                <ul>
                    <li><strong>8 bits for DR0-7</strong> - Which data registers pass through (bit=1 clears register)</li>
                    <li><strong>6 bits for CR0-5</strong> - Which capability registers pass through (bit=1 clears register)</li>
                    <li><strong>Total: 14 bits</strong> - Combined as <code>(DR_mask &lt;&lt; 6) | CR_mask</code></li>
                </ul>
                <h4>Common Mask Patterns</h4>
                <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; margin: 1rem 0;">
                    <tr style="background: var(--bg-tertiary);"><th style="padding: 0.5rem; text-align: left;">Pattern</th><th style="padding: 0.5rem;">DR Mask</th><th style="padding: 0.5rem;">CR Mask</th><th style="padding: 0.5rem;">Combined</th></tr>
                    <tr><td style="padding: 0.5rem;">Full clear (pass nothing)</td><td style="text-align: center;">0xFF</td><td style="text-align: center;">0x3F</td><td style="text-align: center; font-family: monospace;">0x3FFF</td></tr>
                    <tr style="background: var(--bg-tertiary);"><td style="padding: 0.5rem;">Pass all (clear nothing)</td><td style="text-align: center;">0x00</td><td style="text-align: center;">0x00</td><td style="text-align: center; font-family: monospace;">0x0000</td></tr>
                    <tr><td style="padding: 0.5rem;">Pass DR0 only, no caps</td><td style="text-align: center;">0xFE</td><td style="text-align: center;">0x3F</td><td style="text-align: center; font-family: monospace;">0x3FBF</td></tr>
                    <tr style="background: var(--bg-tertiary);"><td style="padding: 0.5rem;">Pass DR0-1, no caps</td><td style="text-align: center;">0xFC</td><td style="text-align: center;">0x3F</td><td style="text-align: center; font-family: monospace;">0x3F3F</td></tr>
                    <tr><td style="padding: 0.5rem;">Pass DR0 + CR0</td><td style="text-align: center;">0xFE</td><td style="text-align: center;">0x3E</td><td style="text-align: center; font-family: monospace;">0x3FBE</td></tr>
                </table>
                <p><strong>Why this prevents malware:</strong></p>
                <ul>
                    <li>Malicious callee cannot read caller's <strong>private variables</strong> (DR2-7 cleared)</li>
                    <li>Malicious callee cannot access caller's <strong>restricted capabilities</strong> (CR0-5 cleared)</li>
                    <li>Malicious callee cannot leak <strong>internal secrets</strong> on RETURN</li>
                    <li>DR8-15 always cleared - <strong>no hidden channels</strong></li>
                </ul>`,
                demo: `<div class="demo-title">Malware Attack Prevention</div>
                <div class="demo-content">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div style="background: rgba(231, 76, 60, 0.1); border-left: 3px solid var(--error); padding: 0.8rem; border-radius: 0 6px 6px 0;">
                            <div style="color: var(--error); font-weight: bold; margin-bottom: 0.5rem;">Without Mask (Vulnerable)</div>
                            <pre style="font-size: 0.7rem; margin: 0;">Caller has DR3 = secret key
CALL malware
; Malware reads DR3 = secret!
; Malware copies to hidden channel
RETURN
; Secret leaked!</pre>
                        </div>
                        <div style="background: rgba(46, 204, 113, 0.1); border-left: 3px solid var(--success); padding: 0.8rem; border-radius: 0 6px 6px 0;">
                            <div style="color: var(--success); font-weight: bold; margin-bottom: 0.5rem;">With Mask (Protected)</div>
                            <pre style="font-size: 0.7rem; margin: 0;">Caller has DR3 = secret key
CALL malware, mask=0xFC1F
; Hardware clears DR2-7
; Malware sees DR3 = 0
RETURN mask
; Secret protected!</pre>
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
                <p>The <strong>Church instructions</strong> are the capability-manipulation half of the CM instruction set. Named after Alonzo Church, they embody the <strong>lambda calculus</strong> philosophy: everything is a function reference (capability).</p>
                <p>There are <strong>7 Church instructions</strong> plus a test instruction (<strong>TPERM</strong> - Test the permission and scope of a Golden Token):</p>
                <ul>
                    <li><strong>LOAD</strong> - Read a Golden Token from memory into a Context Register</li>
                    <li><strong>SAVE</strong> - Write a Golden Token from a Context Register to memory</li>
                    <li><strong>CALL</strong> - Invoke code referenced by a Golden Token (E permission)</li>
                    <li><strong>RETURN</strong> - Return from invoked code to the caller</li>
                    <li><strong>LAMBDA</strong> - Apply Church function in-place via X permission (non-nestable)</li>
                    <li><strong>CHANGE</strong> - Create new thread GT and write to CR8 (thread identity)</li>
                    <li><strong>SWITCH</strong> - Copy capability to system register CR8-CR15</li>
                </ul>
                <div class="key-concept">
                    <strong>Key Insight:</strong> Church instructions operate on <em>capabilities</em> (GTs), not raw data. Every memory access, every function call, every context switch requires a valid GT.
                </div>`,
                demo: `<div class="demo-title">Church vs Turing Machines interwork through the Lambda Calculus Meta-Machine as a CM</div>
                <div class="demo-content">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div style="background: var(--bg-tertiary); padding: 0.8rem; border-radius: 6px;">
                            <div style="color: var(--accent); font-weight: bold; margin-bottom: 0.5rem;">Church Instructions operate on Golden Tokens (Capabilities)</div>
                            <pre style="font-size: 0.75rem; margin: 0;">LOAD   - Get capability
SAVE   - Store capability
CALL   - Invoke via capability (E)
RETURN - Return control
LAMBDA - Apply function (X)
CHANGE - Switch C-List
SWITCH - Switch thread
TPERM  - Test perms and scope</pre>
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
                    <li><strong>S-bit Check</strong> - The source GT to be saved must have the S (Save) bit. If not set, it cannot be saved, preventing theft of a capability when dynamically sharing a GT.</li>
                    <li><strong>MAC Update</strong> - The MAC for stored GT is unchanged</li>
                    <li><strong>Write to Memory</strong> - The GT is stored at the C-List destination offset if Save permission exists</li>
                </ol>
                <p><strong>Permission Inheritance:</strong> The saved GT retains its original permissions - SAVE doesn't amplify rights.</p>`,
                demo: `<div class="demo-title">SAVE Instruction Examples</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.8rem;">
; Syntax: SAVE dest, source, index
; dest   = destination C-List allowing Save
; source = source CRn containing GT to be saved with S (Save) set
; index  = offset within the destination object <= size

; Store GT from CR0 into C-List entry 5:
SAVE CR[source] CR[dest] 5

; Build a new C-List by storing capabilities:
; (allocate new C-List GT)
SAVE 0 1 0      ; Store CR1 as entry 0
; Now CR0 is a C-List with 1 new entry

; SECURITY: Cannot save a GT without save allowed (S=true)</pre>
                </div>`
            },
            {
                text: `<h3>CALL: Invoking Lambda Calculus function abstractions</h3>
                <p>The <strong>CALL</strong> instruction is the heart of CM threaded execution. A Thread is a secure, private execution through the application Namespace with confidential variables (both GT and data). It transfers control to helper functions (code) specified by a Golden Token that identifies a node in the application's DNA hierarchy.</p>
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

; CALL to abstraction (method-selector dispatch):
LOAD 0 6 3      ; CR0 = Abacus (integer math) GT
ADDI 0 0        ; DR0 = 0 (ADD method selector)
CALL 0          ; Dispatch: Access reads DR0, performs ADD</pre>
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
                    <strong>Hardware Stack:</strong> CM uses a hardware-managed return stack, not software. This prevents stack smashing attacks - you cannot overwrite return addresses.
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
                text: `<h3>CHANGE: Creating New Thread Identity</h3>
                <p>The <strong>CHANGE</strong> instruction creates a new thread GT and writes it to CR8 (Thread identity register).</p>
                <p><strong>What happens during CHANGE:</strong></p>
                <ol>
                    <li><strong>Load Source Capability</strong> - From register (I=0) or C-List lookup (I=1)</li>
                    <li><strong>Create Thread GT</strong> - New GT derived from source capability</li>
                    <li><strong>Write to CR8</strong> - Thread identity updated (target always 0)</li>
                    <li><strong>Clear Exclusive Monitor</strong> - Per ARM CLREX semantics</li>
                </ol>
                <p><strong>Use Cases:</strong></p>
                <ul>
                    <li>Creating a new <strong>thread context</strong> for isolated execution</li>
                    <li>Switching to a <strong>different user identity</strong></li>
                    <li>Implementing <strong>process isolation</strong> at hardware level</li>
                </ul>`,
                demo: `<div class="demo-title">CHANGE Instruction Examples</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.8rem;">
; Syntax: CHANGE CRs (I=0) or CHANGE idx (I=1)
; Creates new thread GT and writes to CR8

; Register addressing (I=0):
LOAD 0 6 5      ; CR0 = thread template from C-List
CHANGE 0        ; CR8 = new thread GT from CR0

; C-List lookup (I=1):
CHANGE 3        ; CR8 = new thread GT from C-List[3]

; Common pattern - create isolated context:
LOAD 0 7 2      ; CR0 = thread template from Nucleus
CHANGE 0        ; CR8 = new thread identity
; ... execute with new identity ...
; Note: CHANGE always targets CR8 (target=0)

; Exclusive monitor is cleared on CHANGE
; (per ARM CLREX semantics)</pre>
                </div>`
            },
            {
                text: `<h3>SWITCH: Copying to System Registers</h3>
                <p>The <strong>SWITCH</strong> instruction copies a capability to a system register (CR8-CR15).</p>
                <p><strong>What happens during SWITCH:</strong></p>
                <ol>
                    <li><strong>Permission Check</strong> - Source must have L (Load) permission</li>
                    <li><strong>Select Target</strong> - 3-bit target field selects CR8-CR15 (0=CR8, 7=CR15)</li>
                    <li><strong>Copy Capability</strong> - GT copied to selected system register</li>
                    <li><strong>Clear Monitor</strong> - If target=0 (CR8), exclusive monitor cleared</li>
                </ol>
                <p><strong>Target field mapping:</strong></p>
                <ul>
                    <li><strong>0 = CR8</strong> - Thread identity</li>
                    <li><strong>1 = CR9</strong> - Interrupt handler</li>
                    <li><strong>2 = CR10</strong> - Double fault handler</li>
                    <li><strong>7 = CR15</strong> - Namespace root</li>
                </ul>`,
                demo: `<div class="demo-title">SWITCH Instruction Examples</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.8rem;">
; Syntax: SWITCH CRs, target (I=0) or SWITCH idx, target (I=1)
; Copies capability to system register CR8-CR15
; target: 0=CR8, 1=CR9, 2=CR10, ... 7=CR15

; Copy to CR8 (Thread) - target=0:
LOAD 0 7 3      ; CR0 = thread GT from Nucleus
SWITCH 0, 0     ; CR8 = CR0 (thread identity)

; Copy to CR15 (Namespace) - target=7:
LOAD 0 6 2      ; CR0 = namespace GT from C-List
SWITCH 0, 7     ; CR15 = CR0 (namespace root)

; C-List lookup mode (I=1):
SWITCH 5, 0     ; CR8 = C-List[5]

; Common pattern - update interrupt handler:
LOAD 0 7 4      ; CR0 = interrupt handler GT
SWITCH 0, 1     ; CR9 = interrupt handler

; Requires L (Load) permission on source</pre>
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
                <p><strong>Permission Bits (6 total in 2 mutually exclusive domains):</strong></p>
                <ul>
                    <li><strong>Turing (Data):</strong> R (Read), W (Write), X (Execute)</li>
                    <li><strong>Church (Capability):</strong> L (Load from C-List), S (Save to C-List), E (Enter abstraction)</li>
                </ul>`,
                demo: `<div class="demo-title">TPERM Instruction Examples</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.8rem;">
; Syntax: TPERM source, permissions
; source = CR containing GT to test (0-15)
; permissions = bit mask (R, W, X, L, S, E)

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
                <p>Together with the Turing instructions (arithmetic, logic, branching), these form the complete CM instruction set.</p>`,
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
                        "CHANGE - creates new thread GT in CR8"
                    ],
                    correct: 2,
                    feedback: {
                        correct: "Correct! CALL is the instruction that transfers control to abstractions. It requires the E (Enter) permission on the target GT.",
                        incorrect: "Not quite. CALL is the instruction for invoking abstractions. LOAD/SAVE move GTs, CHANGE creates thread identity in CR8, and SWITCH copies to system registers CR8-CR15."
                    }
                }
            }
        ]
    },
    {
        title: "Branch Instructions",
        steps: [
            {
                text: `<h3>Branch Instructions Overview</h3>
                <p>The <strong>Branch instructions</strong> are Turing-side control flow operations that allow conditional and unconditional jumps in program execution.</p>
                <p>There are <strong>2 Branch instructions</strong>:</p>
                <ul>
                    <li><strong>B [condition] label</strong> - Conditional branch to a label</li>
                    <li><strong>BL label</strong> - Branch with Link (saves return address in DR7)</li>
                </ul>
                <div class="key-concept">
                    <strong>Key Insight:</strong> Branch conditions check the <strong>NZCV flags</strong> set by comparison and arithmetic instructions (CMP, SUBS, etc.). This is the ARM-style conditional execution model.
                </div>`,
                demo: `<div class="demo-title">Branch Instruction Syntax</div>
                <div class="demo-content">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div style="background: var(--bg-tertiary); padding: 0.8rem; border-radius: 6px;">
                            <div style="color: var(--accent); font-weight: bold; margin-bottom: 0.5rem;">B - Conditional Branch</div>
                            <pre style="font-size: 0.75rem; margin: 0;">B label       ; Always branch
BEQ label     ; Branch if equal (Z=1)
BNE label     ; Branch if not equal (Z=0)
BGT label     ; Branch if greater than
BLT label     ; Branch if less than</pre>
                        </div>
                        <div style="background: var(--bg-tertiary); padding: 0.8rem; border-radius: 6px;">
                            <div style="color: var(--success); font-weight: bold; margin-bottom: 0.5rem;">BL - Branch with Link</div>
                            <pre style="font-size: 0.75rem; margin: 0;">BL subroutine  ; Save return addr to DR7
               ; then jump to subroutine
               
; Return by jumping to DR7:
; (use B with register addressing)</pre>
                        </div>
                    </div>
                </div>`
            },
            {
                text: `<h3>Condition Codes</h3>
                <p>Branch conditions check the <strong>NZCV flags</strong> (Negative, Zero, Carry, Overflow) set by comparison and arithmetic instructions.</p>
                <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                    <tr style="background: var(--bg-tertiary);"><th style="padding: 0.5rem; text-align: left;">Condition</th><th style="padding: 0.5rem; text-align: left;">Meaning</th><th style="padding: 0.5rem; text-align: left;">Flag Test</th></tr>
                    <tr><td style="padding: 0.4rem; color: var(--accent);"><strong>EQ</strong></td><td>Equal / Zero</td><td>Z = 1</td></tr>
                    <tr style="background: var(--bg-tertiary);"><td style="padding: 0.4rem; color: var(--accent);"><strong>NE</strong></td><td>Not Equal</td><td>Z = 0</td></tr>
                    <tr><td style="padding: 0.4rem; color: var(--accent);"><strong>CS/HS</strong></td><td>Carry Set / Unsigned >=</td><td>C = 1</td></tr>
                    <tr style="background: var(--bg-tertiary);"><td style="padding: 0.4rem; color: var(--accent);"><strong>CC/LO</strong></td><td>Carry Clear / Unsigned <</td><td>C = 0</td></tr>
                    <tr><td style="padding: 0.4rem; color: var(--accent);"><strong>MI</strong></td><td>Minus (Negative)</td><td>N = 1</td></tr>
                    <tr style="background: var(--bg-tertiary);"><td style="padding: 0.4rem; color: var(--accent);"><strong>PL</strong></td><td>Plus (Positive/Zero)</td><td>N = 0</td></tr>
                    <tr><td style="padding: 0.4rem; color: var(--accent);"><strong>VS</strong></td><td>Overflow Set</td><td>V = 1</td></tr>
                    <tr style="background: var(--bg-tertiary);"><td style="padding: 0.4rem; color: var(--accent);"><strong>VC</strong></td><td>Overflow Clear</td><td>V = 0</td></tr>
                </table>`,
                demo: `<div class="demo-title">Extended Condition Codes</div>
                <div class="demo-content">
                    <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                        <tr style="background: var(--bg-tertiary);"><th style="padding: 0.5rem; text-align: left;">Condition</th><th style="padding: 0.5rem; text-align: left;">Meaning</th><th style="padding: 0.5rem; text-align: left;">Flag Test</th></tr>
                        <tr><td style="padding: 0.4rem; color: var(--warning);"><strong>HI</strong></td><td>Unsigned Higher</td><td>C = 1 AND Z = 0</td></tr>
                        <tr style="background: var(--bg-tertiary);"><td style="padding: 0.4rem; color: var(--warning);"><strong>LS</strong></td><td>Unsigned Lower/Same</td><td>C = 0 OR Z = 1</td></tr>
                        <tr><td style="padding: 0.4rem; color: var(--success);"><strong>GE</strong></td><td>Signed >=</td><td>N = V</td></tr>
                        <tr style="background: var(--bg-tertiary);"><td style="padding: 0.4rem; color: var(--success);"><strong>LT</strong></td><td>Signed <</td><td>N ≠ V</td></tr>
                        <tr><td style="padding: 0.4rem; color: var(--success);"><strong>GT</strong></td><td>Signed ></td><td>Z = 0 AND N = V</td></tr>
                        <tr style="background: var(--bg-tertiary);"><td style="padding: 0.4rem; color: var(--success);"><strong>LE</strong></td><td>Signed <=</td><td>Z = 1 OR N ≠ V</td></tr>
                        <tr><td style="padding: 0.4rem; color: var(--text-muted);"><strong>AL</strong></td><td>Always</td><td>Always true</td></tr>
                    </table>
                </div>`
            },
            {
                text: `<h3>Branch Instruction Examples</h3>
                <p>Here are practical examples showing how branch instructions work with condition codes:</p>
                <div class="key-concept">
                    <strong>Remember:</strong> You must set the flags with a comparison (CMP) or flag-setting arithmetic (SUBS, ADDS) <em>before</em> the conditional branch.
                </div>`,
                demo: `<div class="demo-title">Branch Test Cases</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.8rem;">
; Test 1: Equal condition
    MOV DR0, #5
    CMP DR0, #5      ; Sets Z=1 (equal)
    BEQ equal_case   ; Taken (Z=1)
    
; Test 2: Not equal  
    MOV DR0, #3
    CMP DR0, #5      ; Sets Z=0 (not equal)
    BNE not_equal    ; Taken (Z=0)

; Test 3: Unsigned comparison
    MOV DR0, #10
    CMP DR0, #5      ; 10 > 5, sets C=1
    BHI higher       ; Taken (C=1 AND Z=0)

; Test 4: Signed comparison
    MOV DR0, #-5
    CMP DR0, #3      ; -5 < 3
    BLT less_than    ; Taken (N ≠ V)

; Test 5: Loop with counter
loop:
    SUBS DR1, DR1, #1  ; Decrement, set flags
    BNE loop           ; Loop while DR1 ≠ 0</pre>
                </div>`
            },
            {
                text: `<h3>Loop Patterns</h3>
                <p>Loops are implemented using conditional branches that jump backward in the code:</p>
                <ul>
                    <li><strong>Counter loops</strong> - Decrement a register until zero</li>
                    <li><strong>Sentinel loops</strong> - Compare against a termination value</li>
                    <li><strong>Flag-based loops</strong> - Check a condition flag each iteration</li>
                </ul>
                <div class="key-concept" style="border-color: var(--warning);">
                    <strong>Performance Note:</strong> Use <code>SUBS</code> instead of <code>SUB</code> followed by <code>CMP</code> - the S suffix sets flags automatically, saving an instruction.
                </div>`,
                demo: `<div class="demo-title">Common Loop Patterns</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.8rem;">
; Pattern 1: Count down to zero
    MOV DR0, #10         ; Counter = 10
countdown:
    ; ... loop body ...
    SUBS DR0, DR0, #1    ; Counter--
    BNE countdown        ; Repeat if not zero

; Pattern 2: Count up to limit
    MOV DR0, #0          ; Counter = 0
    MOV DR1, #100        ; Limit = 100
countup:
    ; ... loop body ...
    ADD DR0, DR0, #1     ; Counter++
    CMP DR0, DR1         ; Compare to limit
    BLT countup          ; Repeat if < limit

; Pattern 3: Subroutine call
    BL myFunction        ; Call, save return in DR7
    ; ... continues here after return ...

myFunction:
    ; ... function body ...
    MOV DR15, DR7        ; Return to caller</pre>
                </div>`
            }
        ]
    },
    {
        title: "Church Indicators & TPERM",
        steps: [
            {
                text: `<h3>Church Indicators Overview</h3>
                <p>The CM has two sets of condition flags:</p>
                <ul>
                    <li><strong>Turing Flags (NZCV)</strong> - Set by arithmetic and comparison instructions</li>
                    <li><strong>Church Flags (P, B)</strong> - Set by capability validation instructions</li>
                </ul>
                <p>The <strong>Church Indicators</strong> are capability-specific status flags that report the result of permission and bounds checking:</p>
                <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem; margin: 1rem 0;">
                    <tr style="background: var(--bg-tertiary);"><th style="padding: 0.5rem; text-align: left;">Flag</th><th style="padding: 0.5rem; text-align: left;">Name</th><th style="padding: 0.5rem; text-align: left;">Meaning</th></tr>
                    <tr><td style="padding: 0.5rem; color: var(--accent);"><strong>P</strong></td><td>Perm OK</td><td>Permission check passed - the GT has the required permissions</td></tr>
                    <tr style="background: var(--bg-tertiary);"><td style="padding: 0.5rem; color: var(--accent);"><strong>B</strong></td><td>Bounds OK</td><td>Bounds check passed - the index is within the object's limit</td></tr>
                </table>
                <div class="key-concept">
                    <strong>Key Insight:</strong> Church indicators complement Turing flags - use <strong>NZCV</strong> for arithmetic/logic operations, <strong>P/B</strong> for capability validation before sensitive operations.
                </div>
                <div class="key-concept" style="border-color: var(--warning); margin-top: 0.5rem;">
                    <strong>Important:</strong> When sharing unknown or untrusted data variables with an abstraction, always test them before use. Validate permissions with TPERM before passing capabilities to other code.
                </div>`,
                demo: `<div class="demo-title">Two Flag Sets in the CM</div>
                <div class="demo-content">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div style="background: var(--bg-tertiary); padding: 0.8rem; border-radius: 6px;">
                            <div style="color: var(--success); font-weight: bold; margin-bottom: 0.5rem;">Turing Flags (NZCV)</div>
                            <pre style="font-size: 0.75rem; margin: 0;">N - Negative (result < 0)
Z - Zero (result = 0)
C - Carry (unsigned overflow)
V - Overflow (signed overflow)

Set by: CMP, SUBS, ADDS, etc.</pre>
                        </div>
                        <div style="background: var(--bg-tertiary); padding: 0.8rem; border-radius: 6px;">
                            <div style="color: var(--accent); font-weight: bold; margin-bottom: 0.5rem;">Church Flags (P, B)</div>
                            <pre style="font-size: 0.75rem; margin: 0;">P - Perm OK (has permissions)
B - Bounds OK (index valid)

Z flag also used:
Z=1 when BOTH P and B pass

Set by: TPERM instruction</pre>
                        </div>
                    </div>
                </div>`
            },
            {
                text: `<h3>The TPERM Instruction</h3>
                <p><strong>TPERM</strong> (Test Permissions) validates a Golden Token's permissions and optionally checks bounds:</p>
                <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.85rem; margin: 1rem 0;">TPERM CRs, permMask [, index]</pre>
                <p><strong>Parameters:</strong></p>
                <ul>
                    <li><strong>CRs</strong> - Context Register to test (0-15)</li>
                    <li><strong>permMask</strong> - Permission bits to check (R, W, X, L, S, E)</li>
                    <li><strong>index</strong> - Optional index for bounds checking against W2 limit</li>
                </ul>
                <p><strong>Flags Set:</strong></p>
                <ul>
                    <li><strong>P = 1</strong> if GT has ALL specified permissions</li>
                    <li><strong>B = 1</strong> if index is within bounds (or no index specified)</li>
                    <li><strong>Z = 1</strong> if BOTH P and B pass (all checks successful)</li>
                </ul>`,
                demo: `<div class="demo-title">TPERM Instruction Examples</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.8rem;">
; Test for Enter permission only
TPERM CR0, E         ; P=1 if CR0 has E perm
                     ; B=1 (no bounds check)
                     ; Z=1 if P=1 AND B=1

; Test for Read and Write permissions
TPERM CR1, RW        ; P=1 if CR1 has BOTH R and W
                     ; Z=1 if all checks pass

; Test permissions with bounds check
TPERM CR6, L, 5      ; P=1 if CR6 has L perm
                     ; B=1 if 5 < object limit
                     ; Z=1 if BOTH pass

; Test for multiple permissions
TPERM CR6, LS        ; P=1 if CR6 has BOTH L and S
                     ; Tests for Load + Save access</pre>
                </div>`
            },
            {
                text: `<h3>Failsafe Validation Pattern</h3>
                <p>The Church indicators enable a <strong>failsafe validation pattern</strong> - always test permissions before performing sensitive operations:</p>
                <div class="key-concept" style="border-color: var(--warning);">
                    <strong>Security Rule:</strong> Never trust a capability without validation. Use TPERM to check permissions before CALL, LOAD, or SAVE operations.
                </div>
                <p><strong>Why This Matters:</strong></p>
                <ul>
                    <li>Capabilities may have been modified or restricted</li>
                    <li>Bounds may have changed due to object resizing</li>
                    <li>Failsafe design requires explicit validation</li>
                    <li>Z=0 means "unsafe to proceed" - branch to fault handler</li>
                </ul>`,
                demo: `<div class="demo-title">Failsafe Validation Examples</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.8rem;">
; Pattern 1: Validate before CALL
validate_call:
    TPERM CR0, E         ; Test for Enter permission
    BEQ safe_call        ; Z=1 means safe to proceed
    B fault_handler      ; Z=0 means validation failed

safe_call:
    CALL 0 0             ; Safe to call now

; Pattern 2: Validate before LOAD
validate_load:
    TPERM CR6, L, 3      ; Test Load perm + bounds
    BNE access_fault     ; Z=0 means FAULT
    LOAD 0 6 3           ; Safe to load entry 3

; Pattern 3: Full access validation
access_check:
    TPERM CR0, RWX       ; Need R, W, and X
    BEQ full_access      ; All permissions granted
    TPERM CR0, R         ; Fallback: read-only?
    BEQ readonly_access  ; Read access granted
    B no_access          ; No access at all</pre>
                </div>`
            },
            {
                text: `<h3>Conditional Execution with Church Flags</h3>
                <p>After TPERM, you can use <strong>conditional branches</strong> based on the Z flag:</p>
                <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem; margin: 1rem 0;">
                    <tr style="background: var(--bg-tertiary);"><th style="padding: 0.5rem; text-align: left;">Branch</th><th style="padding: 0.5rem; text-align: left;">Condition</th><th style="padding: 0.5rem; text-align: left;">Meaning</th></tr>
                    <tr><td style="padding: 0.5rem; color: var(--success);"><strong>BEQ</strong></td><td>Z = 1</td><td>Both permission and bounds checks passed</td></tr>
                    <tr style="background: var(--bg-tertiary);"><td style="padding: 0.5rem; color: var(--error);"><strong>BNE</strong></td><td>Z = 0</td><td>At least one check failed - FAULT</td></tr>
                </table>
                <div class="key-concept">
                    <strong>Best Practice:</strong> Always use BNE to branch to a fault handler when Z=0. This follows the failsafe principle - fail securely rather than continue with invalid capabilities.
                </div>`,
                demo: `<div class="demo-title">Complete Validation Workflow</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; font-size: 0.8rem;">
; Access.asm - Capability Validation Entry Point
; This is the standard entry for all abstraction calls

access_entry:
    ; Step 1: Validate caller's capability
    TPERM CR0, E         ; Must have Enter permission
    BNE first_fault      ; No E -> FAULT
    
    ; Step 2: Validate index bounds
    TPERM CR6, M, DR0    ; Check C-List bounds
    BNE first_fault      ; Out of bounds -> FAULT
    
    ; Step 3: Load and validate target
    LOAD 1 6 DR0         ; Load target capability
    TPERM CR1, X         ; Must be executable
    BNE first_fault      ; Not executable -> FAULT
    
    ; All checks passed - safe to proceed
    CALL 1 0             ; Enter the abstraction
    RETURN               ; Return to caller

first_fault:
    ; Single fault handler - no information leakage
    ; Just FAULT, no error codes or details
    B fault_handler</pre>
                </div>`
            }
        ]
    },
    {
        title: "Capability Manager",
        steps: [
            {
                text: `<h3>Creating New Golden Tokens</h3>
                <p>The <strong>CapabilityManager</strong> abstraction creates new Golden Tokens for objects. Unlike other abstractions that perform computations, CapabilityManager allocates and initializes new capabilities.</p>
                <div class="key-concept">
                    <strong>Key Concept:</strong> To create objects in CM, you CALL the CapabilityManager with the object type and size. It returns a new GT in CR0 with full type-appropriate permissions.
                </div>
                <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; margin: 1rem 0;">
                    <tr style="background: var(--bg-tertiary);"><th style="padding: 0.5rem; text-align: left;">Property</th><th style="padding: 0.5rem; text-align: left;">Value</th></tr>
                    <tr><td style="padding: 0.5rem;"><strong>Namespace Offset</strong></td><td>9 (sibling to SlideRule, Abacus, Circle)</td></tr>
                    <tr style="background: var(--bg-tertiary);"><td style="padding: 0.5rem;"><strong>Boot C-List Index</strong></td><td>7</td></tr>
                    <tr><td style="padding: 0.5rem;"><strong>Boot C-List Perms</strong></td><td>[E] - Enter only (minimal privilege)</td></tr>
                </table>`,
                demo: `<div class="demo-title">CapabilityManager in Namespace</div>
                <div class="demo-content">
                    <div class="demo-visual">
                        <div class="hier-preview">
                            <div style="padding: 0.5rem; background: var(--bg-tertiary); border-radius: 4px; margin: 0.25rem 0;">
                                <span class="math-type-badge math-capability" style="font-size: 0.7rem; padding: 0.15rem 0.4rem;">CAPABILITY</span>
                                CapabilityManager [E]
                            </div>
                        </div>
                    </div>
                    <div class="demo-explanation">
                        <p>CapabilityManager appears in the Namespace Browser alongside other abstractions. It has only <strong>[E]</strong> permission (Enter) - the minimum needed to CALL it.</p>
                    </div>
                </div>`
            },
            {
                text: `<h3>API: Object Type and Size</h3>
                <p>The CapabilityManager API uses data registers to specify what to create:</p>
                <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; margin: 1rem 0;">
                    <tr style="background: var(--bg-tertiary);"><th style="padding: 0.5rem; text-align: left;">Register</th><th style="padding: 0.5rem; text-align: left;">Input</th><th style="padding: 0.5rem; text-align: left;">Description</th></tr>
                    <tr><td style="padding: 0.5rem;"><strong>DR0</strong></td><td>Object Type</td><td>0 = Data object, 1 = C-List object</td></tr>
                    <tr style="background: var(--bg-tertiary);"><td style="padding: 0.5rem;"><strong>DR1</strong></td><td>Size</td><td>Size in words (3-word Namespace entry limit)</td></tr>
                </table>
                <p>After the CALL returns, <strong>CR0</strong> contains the new Golden Token with appropriate permissions.</p>
                <div class="highlight">
                    <strong>Two Object Types:</strong><br>
                    • <strong>Data (0)</strong>: For storing numeric values, arrays, buffers<br>
                    • <strong>C-List (1)</strong>: For storing Golden Tokens (capability lists)
                </div>`,
                demo: `<div class="demo-title">API Call Pattern</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 4px; font-size: 0.8rem;">
; Set up API parameters
MOV DR0, #0          ; Type 0 = Data object
MOV DR1, #256        ; Size = 256 words

; Load CapabilityManager GT from C-List
LOAD 1 7 CR1         ; CR1 = CapabilityManager [E]

; Create the object
CALL 1 0             ; CALL CapabilityManager

; CR0 now contains new GT with [R,W,X,B]</pre>
                </div>`
            },
            {
                text: `<h3>Returned Permissions by Type</h3>
                <p>The CapabilityManager returns the new GT in <strong>CR0</strong> with permissions based on object type:</p>
                <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; margin: 1rem 0;">
                    <tr style="background: var(--bg-tertiary);"><th style="padding: 0.5rem; text-align: center;">Type</th><th style="padding: 0.5rem; text-align: center;">DR0</th><th style="padding: 0.5rem; text-align: center;">Returned Permissions</th><th style="padding: 0.5rem; text-align: left;">Meaning</th></tr>
                    <tr><td style="padding: 0.5rem; text-align: center;"><strong>Data</strong></td><td style="text-align: center;">0</td><td style="text-align: center;"><span style="background: #4ade80; color: #1a1a2e; padding: 0.1rem 0.3rem; border-radius: 3px;">R</span> <span style="background: #f87171; color: #1a1a2e; padding: 0.1rem 0.3rem; border-radius: 3px;">W</span> <span style="background: #60a5fa; color: #1a1a2e; padding: 0.1rem 0.3rem; border-radius: 3px;">X</span></td><td>Read, Write, Execute</td></tr>
                    <tr style="background: var(--bg-tertiary);"><td style="padding: 0.5rem; text-align: center;"><strong>C-List</strong></td><td style="text-align: center;">1</td><td style="text-align: center;"><span style="background: #c084fc; color: #1a1a2e; padding: 0.1rem 0.3rem; border-radius: 3px;">L</span> <span style="background: #fb923c; color: #1a1a2e; padding: 0.1rem 0.3rem; border-radius: 3px;">S</span> <span style="background: #fbbf24; color: #1a1a2e; padding: 0.1rem 0.3rem; border-radius: 3px;">E</span></td><td>Load, Save, Enter</td></tr>
                </table>
                <div class="key-concept">
                    <strong>Mutual Exclusivity:</strong> Data permissions (R,W,X) and Capability permissions (L,S,E) are mutually exclusive. A GT has either data access OR capability access, never both.
                </div>`,
                demo: `<div class="demo-title">Permission Sets</div>
                <div class="demo-content">
                    <div class="demo-visual" style="display: flex; gap: 2rem; justify-content: center;">
                        <div style="text-align: center;">
                            <div style="font-weight: bold; margin-bottom: 0.5rem;">Data Object</div>
                            <div style="font-size: 1.5rem;">
                                <span style="background: #4ade80; color: #1a1a2e; padding: 0.2rem 0.5rem; border-radius: 4px; margin: 0.1rem;">R</span>
                                <span style="background: #f87171; color: #1a1a2e; padding: 0.2rem 0.5rem; border-radius: 4px; margin: 0.1rem;">W</span>
                                <span style="background: #60a5fa; color: #1a1a2e; padding: 0.2rem 0.5rem; border-radius: 4px; margin: 0.1rem;">X</span>
                            </div>
                        </div>
                        <div style="text-align: center;">
                            <div style="font-weight: bold; margin-bottom: 0.5rem;">C-List Object</div>
                            <div style="font-size: 1.5rem;">
                                <span style="background: #c084fc; color: #1a1a2e; padding: 0.2rem 0.5rem; border-radius: 4px; margin: 0.1rem;">L</span>
                                <span style="background: #fb923c; color: #1a1a2e; padding: 0.2rem 0.5rem; border-radius: 4px; margin: 0.1rem;">S</span>
                                <span style="background: #fbbf24; color: #1a1a2e; padding: 0.2rem 0.5rem; border-radius: 4px; margin: 0.1rem;">E</span>
                            </div>
                        </div>
                    </div>
                </div>`
            },
            {
                text: `<h3>Complete Example: Creating Objects</h3>
                <p>Here's a complete example showing how to create both a data buffer and a C-List:</p>`,
                demo: `<div class="demo-title">CapMgr.asm - Creating Objects</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 4px; font-size: 0.8rem;">
; CapMgr.asm - Demonstrate CapabilityManager usage
; Creates a data buffer and a C-List

; === Part 1: Create a Data Buffer ===
    MOV DR0, #0          ; Type 0 = Data object
    MOV DR1, #64         ; Size = 64 words
    LOAD 1 7 CR1         ; Load CapabilityManager GT
    CALL 1 0             ; Create object
    ; CR0 = new Data GT [R,W,X,B]
    
    ; Store value in new buffer
    MOV DR2, #42         ; Value to store
    ; Use CR0 to access the new object...

; === Part 2: Create a C-List ===
    MOV DR0, #1          ; Type 1 = C-List object
    MOV DR1, #16         ; Size = 16 entries
    LOAD 1 7 CR1         ; Load CapabilityManager GT
    CALL 1 0             ; Create object
    ; CR0 = new C-List GT [L,S,E,B]
    
    ; Now can SAVE capabilities to new C-List
    SAVE 0 0 CR2         ; Save CR2 to index 0 of new C-List</pre>
                </div>`
            }
        ]
    },
    {
        title: "Mint: The Capability Forge",
        steps: [
            {
                text: `<h3>Beyond CapabilityManager</h3>
                <p>The <strong>Mint</strong> abstraction is the general-purpose capability forge. While CapabilityManager creates only Data [RWX] or C-List [LSE] objects, Mint can create Golden Tokens with <em>any</em> domain-pure permission set — any subset of Turing [RWX] or any subset of Church [LSE], but never both. Oil and water do not mix.</p>
                <div class="key-concept">
                    <strong>Key Concept:</strong> Mint is the foundation for all future capability creation. It provides four operations: GT_MINT (create), GT_RESTRICT (attenuate), GT_REVOKE (invalidate), and GT_INSPECT (read metadata).
                </div>
                <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; margin: 1rem 0;">
                    <tr style="background: var(--bg-tertiary);"><th style="padding: 0.5rem; text-align: left;">Property</th><th style="padding: 0.5rem; text-align: left;">Value</th></tr>
                    <tr><td style="padding: 0.5rem;"><strong>Namespace Offset</strong></td><td>12</td></tr>
                    <tr style="background: var(--bg-tertiary);"><td style="padding: 0.5rem;"><strong>Boot C-List Index</strong></td><td>10</td></tr>
                    <tr><td style="padding: 0.5rem;"><strong>Boot C-List Perms</strong></td><td>[E] - Enter only (minimal privilege)</td></tr>
                    <tr style="background: var(--bg-tertiary);"><td style="padding: 0.5rem;"><strong>Address Range</strong></td><td>0xC000 - 0xCFFF</td></tr>
                </table>`,
                demo: `<div class="demo-title">Mint in Namespace</div>
                <div class="demo-content">
                    <div class="demo-visual">
                        <div class="hier-preview">
                            <div style="padding: 0.5rem; background: var(--bg-tertiary); border-radius: 4px; margin: 0.25rem 0;">
                                <span class="math-type-badge math-forge" style="font-size: 0.7rem; padding: 0.15rem 0.4rem;">FORGE</span>
                                Mint [E]
                            </div>
                        </div>
                    </div>
                    <div class="demo-explanation">
                        <p>Mint is a capability-protected abstraction. You need a GT with [E] permission to CALL it. This is the Golden Rule: even the capability forge itself is governed by capabilities.</p>
                    </div>
                </div>`
            },
            {
                text: `<h3>GT_MINT: Domain-Pure Permission Creation</h3>
                <p>GT_MINT creates a new Golden Token with any valid domain-pure permission set. Turing [RWX] and Church [LSE] are mutually exclusive — mixing them FAULTs immediately:</p>
                <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; margin: 1rem 0;">
                    <tr style="background: var(--bg-tertiary);"><th style="padding: 0.5rem;">Register</th><th style="padding: 0.5rem;">Input</th><th style="padding: 0.5rem;">Description</th></tr>
                    <tr><td style="padding: 0.5rem;"><strong>DR0</strong></td><td>Perm Mask</td><td>6-bit mask: R(0x01) W(0x02) X(0x04) L(0x08) S(0x10) E(0x20)</td></tr>
                    <tr style="background: var(--bg-tertiary);"><td style="padding: 0.5rem;"><strong>DR1</strong></td><td>Type</td><td>0=Data, 1=Code, 2=C-List, 3=Thread, 4=Abstraction</td></tr>
                    <tr><td style="padding: 0.5rem;"><strong>DR2</strong></td><td>Size</td><td>Size in words (1-65536)</td></tr>
                    <tr style="background: var(--bg-tertiary);"><td style="padding: 0.5rem;"><strong>CR0</strong></td><td>Return</td><td>New GT with requested permissions</td></tr>
                </table>`,
                demo: `<div class="demo-title">GT_MINT Usage</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 4px; font-size: 0.8rem;">
; Create a read-only data object
MOV DR0, #0x01       ; Perms = R only (bit 0)
MOV DR1, #0          ; Type = Data
MOV DR2, #128        ; Size = 128 words
LOAD CR1, CR6, 10    ; CR1 = Mint [E] from C-List
CALL 1               ; CALL Mint → GT_MINT
; CR0 = new GT [R] for 128-word data object

; Create a load-only C-List (no save, no enter)
MOV DR0, #0x08       ; Perms = L only (bit 3)
MOV DR1, #2          ; Type = C-List
MOV DR2, #32         ; Size = 32 entries
CALL 1               ; CALL Mint → GT_MINT
; CR0 = new GT [L] — read-only C-List</pre>
                </div>`
            },
            {
                text: `<h3>GT_RESTRICT: Monotonic Attenuation</h3>
                <p>GT_RESTRICT derives a new GT from an existing one with <em>fewer</em> permissions. This is the principle of <strong>monotonic attenuation</strong> — you can only reduce permissions, never escalate them.</p>
                <div class="highlight">
                    <strong>Security Guarantee:</strong> The new permission mask must be a strict subset of the source GT's permissions. Any attempt to add permissions not in the source FAULT immediately.
                </div>`,
                demo: `<div class="demo-title">GT_RESTRICT Usage</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 4px; font-size: 0.8rem;">
; Start with a [R,W,X] data GT in CR0
; Restrict it to read-only for sharing
MOV DR0, #0x01       ; New perms = R only
LOAD CR1, CR6, 10    ; CR1 = Mint [E]
CALL 1               ; GT_RESTRICT
; CR0 = same object, now [R] only
; Original [R,W,X] GT is unaffected</pre>
                </div>`
            },
            {
                text: `<h3>GT_REVOKE: Deterministic Invalidation</h3>
                <p>GT_REVOKE bumps the namespace entry's version number. Every existing GT pointing to that entry becomes instantly invalid — the next mLoad will detect a version mismatch and FAULT.</p>
                <div class="key-concept">
                    <strong>Total Revocation:</strong> There is no partial revoke. All copies, everywhere, become invalid simultaneously. This is deterministic capability revocation — fundamental to secure resource management.
                </div>`,
                demo: `<div class="demo-title">Revocation Flow</div>
                <div class="demo-content">
                    <div class="demo-visual" style="text-align: center; font-size: 0.85rem;">
                        <div style="padding: 0.5rem; background: var(--bg-tertiary); border-radius: 4px; margin: 0.5rem 0;">GT v1 [RWX] &rarr; valid &#10003;</div>
                        <div style="padding: 0.3rem; color: var(--accent);">GT_REVOKE bumps to v2</div>
                        <div style="padding: 0.5rem; background: rgba(248, 113, 113, 0.2); border-radius: 4px; margin: 0.5rem 0; border: 1px solid rgba(248, 113, 113, 0.4);">GT v1 [RWX] &rarr; FAULT (version mismatch)</div>
                    </div>
                </div>`
            }
        ]
    },
    {
        title: "Atomic Operations (LOADX/SAVEX)",
        steps: [
            {
                text: `<h3>Lock-Free Synchronization</h3>
                <p>In multi-threaded systems, multiple threads may try to update the same capability simultaneously. Traditional locks are slow and can deadlock.</p>
                <p>CM provides <strong>atomic load/store operations</strong> for lock-free synchronization:</p>
                <ul>
                    <li><code>LOADX</code> - Load Exclusive: Load a GT and set an exclusive monitor</li>
                    <li><code>SAVEX</code> - Store Exclusive: Conditionally store if monitor is still valid</li>
                </ul>
                <div class="key-concept">
                    <strong>Key Insight:</strong> These follow ARM's LDREX/STREX semantics. The hardware tracks whether another thread has modified the location since your LOADX.
                </div>`,
                demo: `<div class="demo-title">Exclusive Monitor Concept</div>
                <div class="demo-content">
                    <div class="demo-visual">
                        <div style="display: flex; gap: 2rem; justify-content: center; align-items: center;">
                            <div style="text-align: center; padding: 1rem; background: var(--bg-tertiary); border-radius: 8px;">
                                <div style="font-weight: bold; color: var(--accent);">Thread 0</div>
                                <div style="font-family: monospace; margin-top: 0.5rem;">LOADX CR0, [CR6+5]</div>
                                <div style="color: #4ade80; font-size: 0.8rem; margin-top: 0.3rem;">Monitor SET</div>
                            </div>
                            <div style="font-size: 2rem;">→</div>
                            <div style="text-align: center; padding: 1rem; background: var(--bg-tertiary); border-radius: 8px;">
                                <div style="font-weight: bold; color: var(--accent);">Memory</div>
                                <div style="font-family: monospace; margin-top: 0.5rem;">C-List[5]</div>
                                <div style="color: #f59e0b; font-size: 0.8rem; margin-top: 0.3rem;">Monitored</div>
                            </div>
                        </div>
                    </div>
                    <div class="demo-explanation">
                        <p>Each thread has its own exclusive monitor. When you LOADX, the hardware remembers which address you're watching.</p>
                    </div>
                </div>`
            },
            {
                text: `<h3>LOADX - Load Exclusive</h3>
                <p><code>LOADX CRd, [CRn+idx]</code> performs two operations:</p>
                <ol>
                    <li>Loads the GT from C-List slot into destination CR (same as LOAD)</li>
                    <li>Sets the per-thread exclusive monitor for that address</li>
                </ol>
                <div class="highlight">
                    The monitor tracks: "I loaded from this address. Tell me if someone else writes here."
                </div>
                <p><strong>Permission required:</strong> Source CR must have <code>L</code> (Load) permission.</p>`,
                demo: `<div class="demo-title">LOADX Binary Format</div>
                <div class="demo-content">
                    <div style="display: flex; gap: 0.3rem; justify-content: center; font-family: monospace; font-size: 0.8rem;">
                        <div style="background: #6366f1; padding: 0.4rem; border-radius: 4px; text-align: center;">
                            <div>Cond</div><div>4</div>
                        </div>
                        <div style="background: #8b5cf6; padding: 0.4rem; border-radius: 4px; text-align: center;">
                            <div>001000</div><div>6</div>
                        </div>
                        <div style="background: #4ade80; padding: 0.4rem; border-radius: 4px; text-align: center;">
                            <div>CRd</div><div>3</div>
                        </div>
                        <div style="background: #f59e0b; padding: 0.4rem; border-radius: 4px; text-align: center;">
                            <div>CRn</div><div>3</div>
                        </div>
                        <div style="background: #94a3b8; padding: 0.4rem; border-radius: 4px; text-align: center;">
                            <div>Rsv</div><div>3</div>
                        </div>
                        <div style="background: #60a5fa; padding: 0.4rem; border-radius: 4px; text-align: center;">
                            <div>Index</div><div>13</div>
                        </div>
                    </div>
                </div>`
            },
            {
                text: `<h3>SAVEX - Store Exclusive</h3>
                <p><code>SAVEX DRd, CRs, [CRn+idx]</code> is a conditional store:</p>
                <ol>
                    <li>Checks if the exclusive monitor is still valid for that address</li>
                    <li>If valid: stores the GT and sets DRd = 0 (success)</li>
                    <li>If invalid: does NOT store and sets DRd = 1 (failure)</li>
                </ol>
                <div class="key-concept">
                    <strong>Critical:</strong> The monitor becomes invalid if:
                    <ul>
                        <li>Another thread writes to that address</li>
                        <li>A context switch (CHANGE) occurs</li>
                        <li>An interrupt happens</li>
                    </ul>
                </div>`,
                demo: `<div class="demo-title">SAVEX Success/Fail</div>
                <div class="demo-content">
                    <div class="demo-visual" style="display: flex; gap: 2rem; justify-content: center;">
                        <div style="text-align: center; padding: 1rem; background: #16a34a22; border: 1px solid #4ade80; border-radius: 8px;">
                            <div style="color: #4ade80; font-weight: bold;">Success (DR=0)</div>
                            <div style="font-size: 0.85rem; margin-top: 0.5rem;">Monitor valid<br>GT stored</div>
                        </div>
                        <div style="text-align: center; padding: 1rem; background: #dc262622; border: 1px solid #f87171; border-radius: 8px;">
                            <div style="color: #f87171; font-weight: bold;">Failure (DR=1)</div>
                            <div style="font-size: 0.85rem; margin-top: 0.5rem;">Monitor cleared<br>Must retry</div>
                        </div>
                    </div>
                </div>`
            },
            {
                text: `<h3>Atomic Compare-and-Swap Pattern</h3>
                <p>The classic use case is implementing a lock-free update:</p>`,
                demo: `<div class="demo-title">Lock-Free GT Update</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 4px; font-size: 0.8rem;">
; Atomically update GT at C-List[5]
; Uses LOADX/SAVEX for lock-free operation

retry:
    LOADX CR0, [CR6+5]   ; Load GT, set monitor
    
    ; Modify the capability (e.g., restrict perms)
    TPERM CR0, RW        ; Keep only R,W perms
    
    ; Try to store back
    SAVEX DR0, CR0, [CR6+5]  ; Conditional store
    
    ; Check result
    CMP DR0, #1          ; Did it fail?
    BEQ retry            ; Yes - someone else wrote, retry
    
    ; Success! GT atomically updated</pre>
                    <div class="demo-explanation">
                        <p>If another thread modifies C-List[5] between our LOADX and SAVEX, the monitor is cleared and SAVEX fails. We simply retry.</p>
                    </div>
                </div>`
            },
            {
                text: `<h3>16 Per-Thread Monitors</h3>
                <p>CM supports <strong>16 concurrent threads</strong>, each with its own exclusive monitor:</p>
                <ul>
                    <li>Thread ID is stored in CR8 (Thread identity register)</li>
                    <li>Each thread can have exactly ONE active monitor</li>
                    <li>A new LOADX replaces the previous monitor</li>
                </ul>
                <div class="highlight">
                    This design enables true parallel lock-free programming on multi-core CM systems.
                </div>`,
                interactive: {
                    type: "quiz",
                    question: "What happens if SAVEX fails?",
                    options: [
                        "The system crashes with a FAULT",
                        "The destination register is set to 1 and you should retry",
                        "The GT is stored anyway with corrupted data",
                        "The thread is terminated"
                    ],
                    correct: 1,
                    feedback: {
                        correct: "Correct! SAVEX is non-destructive on failure. DR=1 signals you should retry the LOADX/modify/SAVEX sequence.",
                        incorrect: "Not quite. SAVEX simply sets DR=1 on failure, allowing you to retry the atomic operation."
                    }
                }
            }
        ]
    },
    {
        title: "Multiple Register Operations (LDM/STM)",
        steps: [
            {
                text: `<h3>Efficient Bulk Transfers</h3>
                <p>Context switches and procedure calls often need to save/restore multiple Context Registers. Doing this one at a time is slow.</p>
                <p>CM provides bulk operations:</p>
                <ul>
                    <li><code>LDM</code> - Load Multiple: Load several CRs from consecutive C-List slots</li>
                    <li><code>STM</code> - Store Multiple: Store several CRs to consecutive C-List slots</li>
                </ul>
                <div class="key-concept">
                    <strong>Security:</strong> Each individual load/store goes through mLoad/mSave validation. LDM/STM cannot bypass capability security!
                </div>`,
                demo: `<div class="demo-title">Bulk vs Individual Operations</div>
                <div class="demo-content">
                    <div class="demo-visual" style="display: flex; gap: 2rem; justify-content: center;">
                        <div style="text-align: center;">
                            <div style="color: #f87171; font-weight: bold; margin-bottom: 0.5rem;">Slow (6 instructions)</div>
                            <pre style="background: var(--bg-tertiary); padding: 0.5rem; font-size: 0.75rem; border-radius: 4px;">LOAD CR0, [CR6+0]
LOAD CR1, [CR6+1]
LOAD CR2, [CR6+2]
LOAD CR3, [CR6+3]
LOAD CR4, [CR6+4]
LOAD CR5, [CR6+5]</pre>
                        </div>
                        <div style="text-align: center;">
                            <div style="color: #4ade80; font-weight: bold; margin-bottom: 0.5rem;">Fast (1 instruction)</div>
                            <pre style="background: var(--bg-tertiary); padding: 0.5rem; font-size: 0.75rem; border-radius: 4px;">LDM CR6, {CR0-CR5}




</pre>
                        </div>
                    </div>
                </div>`
            },
            {
                text: `<h3>LDM - Load Multiple</h3>
                <p><code>LDM CRn, {register-list}</code> loads multiple CRs from consecutive C-List entries:</p>
                <ul>
                    <li><strong>CRn</strong>: Base C-List register (must have L permission)</li>
                    <li><strong>{register-list}</strong>: Bitmask of CR0-CR7 to load</li>
                </ul>
                <div class="highlight">
                    Only CR0-CR7 can be loaded (3-bit encoding). CR8-CR15 are protected system registers.
                </div>`,
                demo: `<div class="demo-title">LDM Binary Format</div>
                <div class="demo-content">
                    <div style="display: flex; gap: 0.3rem; justify-content: center; font-family: monospace; font-size: 0.8rem; flex-wrap: wrap;">
                        <div style="background: #6366f1; padding: 0.4rem; border-radius: 4px; text-align: center;">
                            <div>Cond</div><div>4</div>
                        </div>
                        <div style="background: #8b5cf6; padding: 0.4rem; border-radius: 4px; text-align: center;">
                            <div>001010</div><div>6</div>
                        </div>
                        <div style="background: #4ade80; padding: 0.4rem; border-radius: 4px; text-align: center;">
                            <div>CRn</div><div>3</div>
                        </div>
                        <div style="background: #f59e0b; padding: 0.4rem; border-radius: 4px; text-align: center;">
                            <div>U</div><div>1</div>
                        </div>
                        <div style="background: #60a5fa; padding: 0.4rem; border-radius: 4px; text-align: center;">
                            <div>W</div><div>1</div>
                        </div>
                        <div style="background: #94a3b8; padding: 0.4rem; border-radius: 4px; text-align: center;">
                            <div>Reserved</div><div>9</div>
                        </div>
                        <div style="background: #c084fc; padding: 0.4rem; border-radius: 4px; text-align: center;">
                            <div>RegList</div><div>8</div>
                        </div>
                    </div>
                    <div style="margin-top: 1rem; font-size: 0.85rem;">
                        <strong>U</strong>: Direction (0=descending, 1=ascending)<br>
                        <strong>W</strong>: Writeback base register<br>
                        <strong>RegList</strong>: Bit i = load CR[i]
                    </div>
                </div>`
            },
            {
                text: `<h3>STM - Store Multiple</h3>
                <p><code>STM CRn, {register-list}</code> stores multiple CRs to consecutive C-List entries:</p>
                <ul>
                    <li><strong>CRn</strong>: Base C-List register (must have S permission)</li>
                    <li><strong>{register-list}</strong>: Bitmask of CR0-CR7 to store</li>
                </ul>
                <div class="key-concept">
                    <strong>S-bit validation:</strong> Each CR being stored must have the <code>S</code> (Save) permission, just like individual SAVE operations.
                </div>`,
                demo: `<div class="demo-title">Context Save/Restore Pattern</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 4px; font-size: 0.8rem;">
; Save context before interrupt
STM CR6, {CR0-CR5}   ; Save all user CRs to C-List

; ... handle interrupt ...

; Restore context after interrupt
LDM CR6, {CR0-CR5}   ; Restore all user CRs from C-List</pre>
                </div>`
            },
            {
                text: `<h3>Security: mLoad and mSave</h3>
                <p>LDM/STM are NOT shortcuts that bypass security. Each register transfer internally calls:</p>
                <ul>
                    <li><strong>mLoad</strong>: Permission check (L), bounds check, MAC validation</li>
                    <li><strong>mSave</strong>: Permission check (S), B-bit validation, bounds check</li>
                </ul>
                <div class="highlight">
                    If ANY single transfer fails validation, the entire LDM/STM faults. No partial updates occur.
                </div>`,
                interactive: {
                    type: "quiz",
                    question: "Can LDM be used to load CR15 (Namespace register)?",
                    options: [
                        "Yes, just include bit 15 in the register list",
                        "No, CR8-CR15 are protected system registers not addressable by instructions",
                        "Yes, but only with M (Meta) permission",
                        "No, LDM only works with data registers"
                    ],
                    correct: 1,
                    feedback: {
                        correct: "Correct! The 3-bit CR encoding (0-7) physically prevents instructions from addressing CR8-CR15. This is a hardware security boundary.",
                        incorrect: "Not quite. CR8-CR15 are protected by the 3-bit instruction encoding - they simply cannot be addressed by any instruction."
                    }
                }
            }
        ]
    },
    {
        title: "LDI and TPERM Presets",
        steps: [
            {
                text: `<h3>LDI - Load Immediate</h3>
                <p><code>LDI DRd, #imm22</code> loads a 22-bit constant directly into a data register:</p>
                <ul>
                    <li><strong>DRd</strong>: Destination data register (0-15)</li>
                    <li><strong>imm22</strong>: 22-bit immediate value (0 to 4,194,303)</li>
                </ul>
                <div class="key-concept">
                    <strong>Zero-extended:</strong> The 22-bit value is zero-extended to 64 bits. For larger constants, use multiple LDI with shifts.
                </div>`,
                demo: `<div class="demo-title">LDI Binary Format</div>
                <div class="demo-content">
                    <div style="display: flex; gap: 0.3rem; justify-content: center; font-family: monospace; font-size: 0.8rem;">
                        <div style="background: #6366f1; padding: 0.4rem; border-radius: 4px; text-align: center;">
                            <div>Cond</div><div>4</div>
                        </div>
                        <div style="background: #8b5cf6; padding: 0.4rem; border-radius: 4px; text-align: center;">
                            <div>001100</div><div>6</div>
                        </div>
                        <div style="background: #4ade80; padding: 0.4rem; border-radius: 4px; text-align: center;">
                            <div>DRd</div><div>4</div>
                        </div>
                        <div style="background: #60a5fa; padding: 0.4rem; border-radius: 4px; text-align: center;">
                            <div>Imm22</div><div>22</div>
                        </div>
                    </div>
                    <pre style="background: var(--bg-tertiary); padding: 0.8rem; margin-top: 1rem; border-radius: 4px; font-size: 0.8rem;">
; Load constants into data registers
LDI DR0, #1000       ; DR0 = 1000
LDI DR1, #0x3FFFFF   ; DR1 = 4194303 (max 22-bit)</pre>
                </div>`
            },
            {
                text: `<h3>TPERM Presets Overview</h3>
                <p>Instead of specifying a 6-bit permission mask, TPERM can use <strong>preset codes</strong> for common patterns:</p>
                <table style="width: 100%; border-collapse: collapse; font-size: 0.8rem; margin: 0.5rem 0;">
                    <tr style="background: var(--bg-tertiary);"><th style="padding: 0.3rem;">Code</th><th>Name</th><th>Permissions</th><th>Category</th></tr>
                    <tr><td style="text-align: center;">0</td><td>CLEAR</td><td>(none)</td><td>-</td></tr>
                    <tr style="background: var(--bg-tertiary);"><td style="text-align: center;">1</td><td>R</td><td>R</td><td>Data</td></tr>
                    <tr><td style="text-align: center;">2</td><td>RW</td><td>R,W</td><td>Data</td></tr>
                    <tr style="background: var(--bg-tertiary);"><td style="text-align: center;">3</td><td>X</td><td>X</td><td>Data</td></tr>
                    <tr><td style="text-align: center;">4</td><td>RX</td><td>R,X</td><td>Data</td></tr>
                    <tr style="background: var(--bg-tertiary);"><td style="text-align: center;">5</td><td>RWX</td><td>R,W,X</td><td>Data</td></tr>
                </table>
                <div class="highlight">
                    Presets 0-5 cover common <strong>data access patterns</strong>.
                </div>`,
                demo: `<div class="demo-title">Data Presets</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 4px; font-size: 0.8rem;">
; Using TPERM with preset codes
TPERM CR0, #0        ; Test for CLEAR (no perms)
TPERM CR1, #2        ; Test for RW access
TPERM CR2, #5        ; Test for full RWX access</pre>
                </div>`
            },
            {
                text: `<h3>Lambda Permission Presets (6-12)</h3>
                <p>Presets 6-12 test the <strong>Lambda permissions</strong> individually, in order:</p>
                <table style="width: 100%; border-collapse: collapse; font-size: 0.8rem; margin: 0.5rem 0;">
                    <tr style="background: var(--bg-tertiary);"><th style="padding: 0.3rem;">Code</th><th>Name</th><th>Permission</th><th>Meaning</th></tr>
                    <tr><td style="text-align: center; background: #c084fc22;">6</td><td>L</td><td><span style="background: #c084fc; color: #1a1a2e; padding: 0.1rem 0.3rem; border-radius: 3px;">L</span></td><td>Load capability</td></tr>
                    <tr style="background: var(--bg-tertiary);"><td style="text-align: center; background: #fb923c22;">7</td><td>S</td><td><span style="background: #fb923c; color: #1a1a2e; padding: 0.1rem 0.3rem; border-radius: 3px;">S</span></td><td>Save capability</td></tr>
                    <tr><td style="text-align: center; background: #fbbf2422;">8</td><td>E</td><td><span style="background: #fbbf24; color: #1a1a2e; padding: 0.1rem 0.3rem; border-radius: 3px;">E</span></td><td>Enter abstraction</td></tr>
                    <tr style="background: var(--bg-tertiary);"><td style="text-align: center; background: #2dd4bf22;">9</td><td>LS</td><td><span style="background: #c084fc; color: #1a1a2e; padding: 0.1rem 0.3rem; border-radius: 3px;">L</span> <span style="background: #fb923c; color: #1a1a2e; padding: 0.1rem 0.3rem; border-radius: 3px;">S</span></td><td>Load + Save</td></tr>
                    <tr><td style="text-align: center; background: #a855f722;">10</td><td>LE</td><td><span style="background: #c084fc; color: #1a1a2e; padding: 0.1rem 0.3rem; border-radius: 3px;">L</span> <span style="background: #fbbf24; color: #1a1a2e; padding: 0.1rem 0.3rem; border-radius: 3px;">E</span></td><td>Load + Enter</td></tr>
                    <tr style="background: var(--bg-tertiary);"><td style="text-align: center; background: #06b6d422;">11</td><td>SE</td><td><span style="background: #fb923c; color: #1a1a2e; padding: 0.1rem 0.3rem; border-radius: 3px;">S</span> <span style="background: #fbbf24; color: #1a1a2e; padding: 0.1rem 0.3rem; border-radius: 3px;">E</span></td><td>Save + Enter</td></tr>
                    <tr><td style="text-align: center; background: #84cc1622;">12</td><td>LSE</td><td><span style="background: #c084fc; color: #1a1a2e; padding: 0.1rem 0.3rem; border-radius: 3px;">L</span> <span style="background: #fb923c; color: #1a1a2e; padding: 0.1rem 0.3rem; border-radius: 3px;">S</span> <span style="background: #fbbf24; color: #1a1a2e; padding: 0.1rem 0.3rem; border-radius: 3px;">E</span></td><td>Full Lambda access</td></tr>
                </table>
                <div class="key-concept">
                    <strong>Order:</strong> Codes 6-8 map to individual Lambda permissions: <strong>L, S, E</strong>. Codes 9-12 are common combos. Codes 13-15 are reserved (FAULT).
                </div>`,
                demo: `<div class="demo-title">Lambda Permission Tests</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 4px; font-size: 0.8rem;">
; Test individual Lambda permissions
TPERM CR0, #6        ; Has L (Load)?
BEQ can_load         ; Yes - can load from this C-List

TPERM CR1, #7        ; Has S (Save)?
BEQ can_save         ; Yes - can save to this C-List</pre>
                </div>`
            },
            {
                text: `<h3>Preset 13: LS Combo</h3>
                <p>Preset 13 tests for <strong>Load + Save</strong> together - a common pattern for C-List management:</p>
                <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; margin: 0.5rem 0;">
                    <tr style="background: var(--bg-tertiary);"><th style="padding: 0.4rem;">Code</th><th>Name</th><th>Permissions</th><th>Use Case</th></tr>
                    <tr><td style="text-align: center;">13</td><td>LS</td><td><span style="background: #c084fc; color: #1a1a2e; padding: 0.1rem 0.3rem; border-radius: 3px;">L</span> <span style="background: #fb923c; color: #1a1a2e; padding: 0.1rem 0.3rem; border-radius: 3px;">S</span></td><td>Full C-List access</td></tr>
                    <tr style="background: var(--bg-tertiary);"><td style="text-align: center;">14-15</td><td>RESERVED</td><td colspan="2" style="color: #f87171;">FAULT if used</td></tr>
                </table>`,
                demo: `<div class="demo-title">LS Permission Check</div>
                <div class="demo-content">
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 4px; font-size: 0.8rem;">
; Check if we can fully manage a C-List
TPERM CR0, #13       ; Has L+S permissions?
BNE access_denied    ; No - can't modify this C-List

; We have full C-List access
LOAD CR1, [CR0+0]    ; Load from it
SAVE CR1, [CR0+1]    ; Save to it</pre>
                </div>`
            },
            {
                text: `<h3>TPERM Binary Format with Presets</h3>
                <p>TPERM has a P-bit to select between mask mode and preset mode:</p>
                <ul>
                    <li><strong>P=0</strong>: Use 6-bit explicit permission mask</li>
                    <li><strong>P=1</strong>: Use 4-bit preset code (0-13)</li>
                </ul>`,
                demo: `<div class="demo-title">TPERM Format</div>
                <div class="demo-content">
                    <div style="display: flex; gap: 0.3rem; justify-content: center; font-family: monospace; font-size: 0.75rem; flex-wrap: wrap;">
                        <div style="background: #6366f1; padding: 0.4rem; border-radius: 4px; text-align: center;">
                            <div>Cond</div><div>4</div>
                        </div>
                        <div style="background: #8b5cf6; padding: 0.4rem; border-radius: 4px; text-align: center;">
                            <div>000111</div><div>6</div>
                        </div>
                        <div style="background: #4ade80; padding: 0.4rem; border-radius: 4px; text-align: center;">
                            <div>CRs</div><div>3</div>
                        </div>
                        <div style="background: #f59e0b; padding: 0.4rem; border-radius: 4px; text-align: center;">
                            <div>P</div><div>1</div>
                        </div>
                        <div style="background: #60a5fa; padding: 0.4rem; border-radius: 4px; text-align: center;">
                            <div>I</div><div>1</div>
                        </div>
                        <div style="background: #c084fc; padding: 0.4rem; border-radius: 4px; text-align: center;">
                            <div>Perms/Preset</div><div>10</div>
                        </div>
                        <div style="background: #94a3b8; padding: 0.4rem; border-radius: 4px; text-align: center;">
                            <div>Index</div><div>8</div>
                        </div>
                    </div>
                    <div style="margin-top: 1rem; font-size: 0.85rem;">
                        <strong>P=0</strong>: Perms = 6-bit mask (R,W,X,L,S,E)<br>
                        <strong>P=1</strong>: Perms[3:0] = preset code (0-13)
                    </div>
                </div>`,
                interactive: {
                    type: "quiz",
                    question: "Which preset code tests for the E (Enter) permission?",
                    options: [
                        "Code 5 (RWX)",
                        "Code 6 (L)",
                        "Code 8 (E)",
                        "Code 13 (LS)"
                    ],
                    correct: 2,
                    feedback: {
                        correct: "Correct! Preset codes 6-8 follow the Lambda permission order (L,S,E), so E is at code 8.",
                        incorrect: "Remember: codes 6-8 follow Lambda order (L,S,E). E is the 3rd Lambda permission, so it's at code 6+2=8."
                    }
                }
            }
        ]
    },
    {
        title: "Hello Mum: The Holy Grail",
        steps: [
            {
                text: `<h3>Why "Hello Mum" Replaces "Hello World"</h3>
                <p>In 1978, "Hello World" proved one thing: <strong>a process can output text.</strong></p>
                <p>It assumed a monolithic kernel with unrestricted hardware access, virtual memory managed by privileged page tables, and a superuser who can read, modify, or delete anything.</p>
                <div class="key-concept">
                    <strong>"Hello Mum" (2026)</strong> proves something far more profound: two people can communicate securely across different machine architectures, through an encrypted capability tunnel, with every step validated by hardware &mdash; <em>no operating system in the path, no virtual memory, no privileged hardware mode, no superuser.</em>
                </div>
                <p>This is <strong>the Holy Grail of computer science</strong> &mdash; secure communication as the atomic primitive, not text output.</p>`,
                demo: `<div class="demo-title">Hello World vs Hello Mum</div>
                <div class="demo-content">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div style="background: #1e1e2e; padding: 0.8rem; border-radius: 6px; border: 1px solid #f87171;">
                            <div style="color: #f87171; font-weight: bold; margin-bottom: 0.5rem;">Hello World (1978)</div>
                            <pre style="font-size: 0.7rem; margin: 0;">printf("Hello World\\n");</pre>
                            <div style="color: #94a3b8; font-size: 0.7rem; margin-top: 0.5rem;">Requires: kernel, VM, root, syscalls</div>
                        </div>
                        <div style="background: #1e1e2e; padding: 0.8rem; border-radius: 6px; border: 1px solid #4ade80;">
                            <div style="color: #4ade80; font-weight: bold; margin-bottom: 0.5rem;">Hello Mum (2026)</div>
                            <pre style="font-size: 0.7rem; margin: 0;">CALL(CONNECT(me, mymother))</pre>
                            <div style="color: #94a3b8; font-size: 0.7rem; margin-top: 0.5rem;">Requires: 1 instruction, 3 Golden Tokens</div>
                        </div>
                    </div>
                </div>`
            },
            {
                text: `<h3>One Instruction, Three Tokens, Seven Zeroes</h3>
                <p>From the caller's perspective, the entire program is <strong>one semantic action</strong>:</p>
                <pre style="background: var(--bg-tertiary); padding: 0.6rem; border-radius: 4px; font-size: 0.9rem; text-align: center;">CALL(CONNECT(me, mymother))</pre>
                <p>"Communicate with my mother." The caller does not think about registers, tunnels, encryption, or architecture differences. Church's lambda calculus says: apply an abstraction to arguments and receive results.</p>
                <div class="highlight">
                    The machine decomposes this one Church instruction into <strong>three Golden Tokens</strong>:
                </div>
                <table style="width: 100%; border-collapse: collapse; font-size: 0.8rem; margin: 0.5rem 0;">
                    <tr style="background: var(--bg-tertiary);"><th style="padding: 0.3rem;">GT</th><th>Register</th><th>Type</th><th>Permission</th><th>Purpose</th></tr>
                    <tr><td><strong>me</strong></td><td>CR8</td><td>Inform</td><td><span style="background: #a855f7; color: #1a1a2e; padding: 0.1rem 0.3rem; border-radius: 3px;">M</span></td><td>Thread identity (microcode/metadata)</td></tr>
                    <tr style="background: var(--bg-tertiary);"><td><strong>tunnel key</strong></td><td>CR0</td><td>Inform</td><td><span style="background: #4ade80; color: #1a1a2e; padding: 0.1rem 0.3rem; border-radius: 3px;">R</span></td><td>Crypto key for encrypted channel</td></tr>
                    <tr><td><strong>mymother</strong></td><td>CR1</td><td>Outform</td><td><span style="background: #fbbf24; color: #1a1a2e; padding: 0.1rem 0.3rem; border-radius: 3px;">E</span></td><td>Remote messaging abstraction</td></tr>
                </table>`,
                demo: `<div class="demo-title">The Seven Zeroes</div>
                <div class="demo-content">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem; font-size: 0.75rem;">
                        <div style="background: #1e293b; padding: 0.5rem; border-radius: 4px; border-left: 3px solid #4ade80;"><strong style="color: #4ade80;">Zero OS</strong><br>No kernel, no monolithic OS</div>
                        <div style="background: #1e293b; padding: 0.5rem; border-radius: 4px; border-left: 3px solid #60a5fa;"><strong style="color: #60a5fa;">Zero VM</strong><br>No page tables, no TLB</div>
                        <div style="background: #1e293b; padding: 0.5rem; border-radius: 4px; border-left: 3px solid #c084fc;"><strong style="color: #c084fc;">Zero Privilege</strong><br>No ring 0, no supervisor mode</div>
                        <div style="background: #1e293b; padding: 0.5rem; border-radius: 4px; border-left: 3px solid #fbbf24;"><strong style="color: #fbbf24;">Zero Superuser</strong><br>No root, no admin, no god mode</div>
                        <div style="background: #1e293b; padding: 0.5rem; border-radius: 4px; border-left: 3px solid #f87171;"><strong style="color: #f87171;">Zero Unauth Code</strong><br>Malware path eliminated</div>
                        <div style="background: #1e293b; padding: 0.5rem; border-radius: 4px; border-left: 3px solid #fb923c;"><strong style="color: #fb923c;">Zero Unauth Data</strong><br>Ransomware path eliminated</div>
                        <div style="background: #1e293b; padding: 0.5rem; border-radius: 4px; border-left: 3px solid #2dd4bf; grid-column: 1 / -1;"><strong style="color: #2dd4bf;">Zero Containment Escape</strong> &mdash; AI breakout path does not exist</div>
                    </div>
                    <div style="text-align: center; margin-top: 0.5rem; color: #94a3b8; font-size: 0.75rem;">All seven share one root cause: <strong>mLoad is the single trusted gate and nobody goes around it.</strong></div>
                </div>`
            },
            {
                text: `<h3>Two Machines, Two Architectures</h3>
                <p>The proof-of-concept uses <strong>both simulators</strong> to demonstrate architecture independence:</p>
                <table style="width: 100%; border-collapse: collapse; font-size: 0.8rem; margin: 0.5rem 0;">
                    <tr style="background: var(--bg-tertiary);"><th style="padding: 0.3rem;">Property</th><th>"me" (CM Sim-64)</th><th>"mymother" (Capability Sim-32)</th></tr>
                    <tr><td>ISA</td><td>ARM-inspired CM</td><td>RISC-V RV32I + cap extensions</td></tr>
                    <tr style="background: var(--bg-tertiary);"><td>Data registers</td><td>DR0-DR15 (64-bit)</td><td>x0-x31 (32-bit)</td></tr>
                    <tr><td>Capability regs</td><td>CR0-CR15 (64-bit GTs)</td><td>CR0-CR15 (32-bit GTs)</td></tr>
                    <tr style="background: var(--bg-tertiary);"><td>GT format</td><td>64-bit Golden Token</td><td>32-bit Golden Token</td></tr>
                    <tr><td>mLoad path</td><td colspan="2" style="text-align: center; color: #4ade80;"><strong>Identical semantics</strong></td></tr>
                </table>
                <div class="key-concept">
                    The architectures, ISAs, register widths, and GT formats are all different. But the <strong>capability semantics are identical</strong> &mdash; and that is what matters.
                </div>`,
                demo: `<div class="demo-title">ABI Descriptor: The Bridge</div>
                <div class="demo-content">
                    <div style="background: #1e1e2e; padding: 0.8rem; border-radius: 6px;">
                        <div style="color: #fbbf24; font-weight: bold; margin-bottom: 0.5rem;">Register Mapping (ABI_Mum)</div>
                        <pre style="font-size: 0.7rem; margin: 0; color: #e2e8f0;">Arguments:   DR0 &rarr; x10   DR1 &rarr; x11
             DR2 &rarr; x12   DR3 &rarr; x13
             DR4 &rarr; x14   DR5 &rarr; x15
             DR6 &rarr; x16   DR7 &rarr; x17
             DR8 &rarr; x18

Returns:     x10  &rarr; DR0   x11 &rarr; DR1

64-bit values: low 32 bits transmitted
               high 32 truncated with flag</pre>
                    </div>
                    <div style="margin-top: 0.5rem; font-size: 0.75rem; color: #94a3b8;">The ABI descriptor lives in a standard namespace entry, accessed through mLoad with R permission. Fetched once, cached locally. Cost vs network: <strong>0.005%</strong> &mdash; unmeasurable.</div>
                </div>`
            },
            {
                text: `<h3>Step 1: The C-List Setup</h3>
                <p>When you load the Hello Mum example, the simulator configures <strong>"me"'s C-List</strong> in CR6 with exactly three Golden Tokens:</p>
                <table style="width: 100%; border-collapse: collapse; font-size: 0.8rem; margin: 0.5rem 0;">
                    <tr style="background: var(--bg-tertiary);"><th style="padding: 0.3rem;">Index</th><th>Name</th><th>Type</th><th>Perm</th><th>NS Location</th></tr>
                    <tr><td style="text-align: center;">[0]</td><td>Tunnel_Key_Mum</td><td>Inform</td><td><span style="background: #4ade80; color: #1a1a2e; padding: 0.1rem 0.3rem; border-radius: 3px;">R</span></td><td style="font-family: monospace; font-size: 0.75rem;">0xA100 (256 bytes)</td></tr>
                    <tr style="background: var(--bg-tertiary);"><td style="text-align: center;">[1]</td><td>Mum_Messaging</td><td>Outform</td><td><span style="background: #fbbf24; color: #1a1a2e; padding: 0.1rem 0.3rem; border-radius: 3px;">E</span></td><td style="font-family: monospace; font-size: 0.75rem;">0xA200 (512 bytes)</td></tr>
                    <tr><td style="text-align: center;">[2]</td><td>ABI_Mum</td><td>Inform</td><td><span style="background: #4ade80; color: #1a1a2e; padding: 0.1rem 0.3rem; border-radius: 3px;">R</span></td><td style="font-family: monospace; font-size: 0.75rem;">0xA400 (256 bytes)</td></tr>
                </table>
                <p style="font-size: 0.8rem;">The C-List itself (<strong>Me_CList</strong>) is at <code>0xA500</code>. All four entries sit within the <strong>Lambda abstraction</strong> region (NS offset 11, 0xA000&ndash;0xBFFF) of Kenneth's namespace DNA tree.</p>
                <div class="highlight">
                    Notice: the C-List GT has <strong>E</strong> permission only. Three instructions have architectural approval to elevate <strong>M</strong> on a CR: <strong>CALL, RETURN, and CHANGE</strong>. M on the CR is what authorizes mLoad to access the namespace &mdash; but M is <em>never</em> stored in the GT itself. Domain separation is absolute: capabilities in CRs, values in DRs.
                </div>
                <p>Try it: Click the <strong>Hello Mum</strong> button in the Assembly Editor to load the example and configure the namespace.</p>`,
                demo: `<div class="demo-title">Namespace DNA Location</div>
                <div class="demo-content">
                    <div style="background: #1e1e2e; padding: 0.6rem; border-radius: 6px; font-size: 0.7rem; font-family: monospace;">
                        <div style="color: #94a3b8; margin-bottom: 0.4rem;">Kenneth's Namespace DNA Tree:</div>
                        <div style="color: #60a5fa;">NS[0]  0x0000 Namespace (root)</div>
                        <div style="color: #94a3b8;">NS[1]  0x1000 Access (Nucleus)</div>
                        <div style="color: #94a3b8;">NS[2]  0x2000 Boot (C-List)</div>
                        <div style="color: #fbbf24;">NS[3]  0x3000 Kenneth (Thread)</div>
                        <div style="color: #94a3b8;">  &hellip;</div>
                        <div style="color: #c084fc; font-weight: bold;">NS[11] 0xA000 Lambda (2000h region)</div>
                        <div style="color: #4ade80; padding-left: 1.2rem;">&boxvr; 0xA100 Tunnel_Key_Mum [R]</div>
                        <div style="color: #fbbf24; padding-left: 1.2rem;">&boxvr; 0xA200 Mum_Messaging [E]</div>
                        <div style="color: #4ade80; padding-left: 1.2rem;">&boxvr; 0xA400 ABI_Mum [R]</div>
                        <div style="color: #c084fc; padding-left: 1.2rem;">&boxur; 0xA500 Me_CList [E]</div>
                    </div>
                    <div style="text-align: center; margin-top: 0.5rem; font-size: 0.7rem; color: #94a3b8;">All Hello Mum entries live within the Lambda region. GC Mark-Scan walks this tree via mLoad.</div>
                </div>`
            },
            {
                text: `<h3>Step 2: LOAD the Tunnel Key</h3>
                <p>The first instruction loads the tunnel key from the C-List:</p>
                <pre style="background: var(--bg-tertiary); padding: 0.6rem; border-radius: 4px; font-size: 0.85rem;">LOAD 0 6 0    ; CR0 &larr; C-List[0] (Tunnel_Key_Mum)</pre>
                <p>This is a <strong>Church instruction</strong>. Under the hood, the LOAD instruction triggers <strong>mLoad</strong> &mdash; the single trusted path for all namespace access:</p>
                <ol style="font-size: 0.85rem;">
                    <li><strong>Permission check:</strong> CR6 has M (elevated by CALL) &rarr; M authorizes namespace access &rarr; proceed.</li>
                    <li><strong>Bounds check:</strong> Is index 0 within the C-List? Yes (3 entries) &rarr; proceed.</li>
                    <li><strong>MAC validation:</strong> Does the entry's Fowler-Noll-Vo (FNV) Message Authentication Code match its computed hash? Yes &rarr; entry is untampered.</li>
                    <li><strong>Version check:</strong> Has the entry been recycled by GC? No &rarr; still valid.</li>
                    <li><strong>Type check:</strong> Is the loaded GT NULL? No (it's Inform) &rarr; safe to write to CR.</li>
                </ol>
                <div class="key-concept">
                    <strong>Golden Rule:</strong> mLoad is the <em>only</em> way to write a capability into a Context Register. No instruction, no microcode, no hardware path bypasses it. This is the foundation of failsafe security.
                </div>`,
                demo: `<div class="demo-title">mLoad Validation Chain</div>
                <div class="demo-content">
                    <div style="font-size: 0.75rem;">
                        <div style="display: flex; align-items: center; gap: 0.3rem; margin-bottom: 0.3rem;">
                            <span style="background: #4ade80; color: #1a1a2e; padding: 0.2rem 0.4rem; border-radius: 3px; font-weight: bold;">1</span>
                            <span>M elevated on CR6 &rarr;</span>
                            <span style="color: #4ade80;">PASS</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 0.3rem; margin-bottom: 0.3rem;">
                            <span style="background: #4ade80; color: #1a1a2e; padding: 0.2rem 0.4rem; border-radius: 3px; font-weight: bold;">2</span>
                            <span>Index 0 &lt; 3 (bounds) &rarr;</span>
                            <span style="color: #4ade80;">PASS</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 0.3rem; margin-bottom: 0.3rem;">
                            <span style="background: #4ade80; color: #1a1a2e; padding: 0.2rem 0.4rem; border-radius: 3px; font-weight: bold;">3</span>
                            <span>Fowler-Noll-Vo Message Authentication Code = expected &rarr;</span>
                            <span style="color: #4ade80;">PASS</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 0.3rem; margin-bottom: 0.3rem;">
                            <span style="background: #4ade80; color: #1a1a2e; padding: 0.2rem 0.4rem; border-radius: 3px; font-weight: bold;">4</span>
                            <span>Version matches registry &rarr;</span>
                            <span style="color: #4ade80;">PASS</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 0.3rem; margin-bottom: 0.3rem;">
                            <span style="background: #4ade80; color: #1a1a2e; padding: 0.2rem 0.4rem; border-radius: 3px; font-weight: bold;">5</span>
                            <span>Type = Inform (not NULL) &rarr;</span>
                            <span style="color: #4ade80;">PASS</span>
                        </div>
                        <div style="margin-top: 0.5rem; padding: 0.4rem; background: #16a34a22; border-radius: 4px; text-align: center; color: #4ade80; font-weight: bold;">
                            CR0 = Tunnel_Key_Mum [R]
                        </div>
                    </div>
                </div>`
            },
            {
                text: `<h3>Step 3: TPERM &mdash; Verify the Key</h3>
                <p>Before using the tunnel key, the code verifies it has Read permission:</p>
                <pre style="background: var(--bg-tertiary); padding: 0.6rem; border-radius: 4px; font-size: 0.85rem;">TPERM 0 R     ; Does CR0 have Read permission?
B NE fault    ; If not &rarr; FAULT (uniform failure)</pre>
                <p>TPERM tests the permission bits on a Context Register's GT without modifying anything. It sets condition flags:</p>
                <ul style="font-size: 0.85rem;">
                    <li><strong>Z=1</strong>: All requested permissions are present (EQ condition)</li>
                    <li><strong>Z=0</strong>: One or more permissions are missing (NE condition)</li>
                </ul>
                <div class="highlight">
                    The Branch NE (not-equal) instruction jumps to the fault handler if permissions are missing. The fault handler is a <strong>single, uniform</strong> failure point &mdash; no error codes, no information leakage. Attackers learn nothing.
                </div>
                <p>In this case, Tunnel_Key_Mum has [R] permission, so TPERM sets Z=1 and the branch is <strong>not taken</strong>. Execution continues.</p>`,
                demo: `<div class="demo-title">Permission Test Flow</div>
                <div class="demo-content">
                    <div style="font-size: 0.8rem;">
                        <div style="background: #1e1e2e; padding: 0.6rem; border-radius: 6px; margin-bottom: 0.5rem;">
                            <span style="color: #94a3b8;">CR0:</span> <span style="color: #4ade80;">Tunnel_Key_Mum</span> <span style="background: #4ade80; color: #1a1a2e; padding: 0.1rem 0.3rem; border-radius: 3px;">R</span>
                        </div>
                        <div style="text-align: center; margin: 0.3rem 0;">
                            <span style="color: #94a3b8;">TPERM 0 R &rarr; need [R], have [R]</span>
                        </div>
                        <div style="text-align: center; padding: 0.4rem; background: #16a34a22; border-radius: 4px; color: #4ade80; font-weight: bold;">
                            Z=1 (PASS) &mdash; branch NOT taken
                        </div>
                    </div>
                </div>`
            },
            {
                text: `<h3>Step 4: LOAD the Service GT</h3>
                <p>Next, load mymother's messaging service from C-List index 1:</p>
                <pre style="background: var(--bg-tertiary); padding: 0.6rem; border-radius: 4px; font-size: 0.85rem;">LOAD 1 6 1    ; CR1 &larr; C-List[1] (Mum_Messaging)
TPERM 1 E     ; Does CR1 have Enter permission?
B NE fault    ; If not &rarr; FAULT</pre>
                <p>This loads an <strong>Outform GT</strong> &mdash; a capability that references a <em>remote</em> resource on another machine. The same mLoad validation chain runs:</p>
                <ul style="font-size: 0.85rem;">
                    <li>L permission on CR6 &rarr; PASS</li>
                    <li>Bounds, MAC, version checks &rarr; PASS</li>
                    <li>Outform type is valid for LOAD &rarr; CR1 gets the GT</li>
                </ul>
                <div class="key-concept">
                    <strong>Outform GT:</strong> The key innovation for network transparency. An Outform looks like any other GT to the caller, but it references a service on a different machine. The caller doesn't know or care &mdash; they just CALL it.
                </div>`,
                demo: `<div class="demo-title">Inform vs Outform</div>
                <div class="demo-content">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem; font-size: 0.75rem;">
                        <div style="background: #1e293b; padding: 0.6rem; border-radius: 6px; border: 1px solid #4ade80;">
                            <div style="color: #4ade80; font-weight: bold;">Inform (Local)</div>
                            <div style="margin-top: 0.3rem;">Points to a resource in <em>this</em> namespace.<br>Tunnel_Key_Mum [R]<br>ABI_Mum [R]</div>
                        </div>
                        <div style="background: #1e293b; padding: 0.6rem; border-radius: 6px; border: 1px solid #fbbf24;">
                            <div style="color: #fbbf24; font-weight: bold;">Outform (Remote)</div>
                            <div style="margin-top: 0.3rem;">Points to a service on a <em>different</em> machine.<br>Mum_Messaging [E]<br>Tunnel path: HTTPS</div>
                        </div>
                    </div>
                    <div style="text-align: center; margin-top: 0.5rem; color: #94a3b8; font-size: 0.7rem;">Both use the same mLoad path. Both are validated identically. Network transparency.</div>
                </div>`
            },
            {
                text: `<h3>Step 5: Prepare the Message</h3>
                <p>The message "Hello Mum" is placed into <strong>data registers</strong> &mdash; the Turing domain:</p>
                <pre style="background: var(--bg-tertiary); padding: 0.6rem; border-radius: 4px; font-size: 0.85rem;">ADDI 0 72     ; DR0 = 'H' (ASCII 72)
ADDI 1 101    ; DR1 = 'e' (ASCII 101)
ADDI 2 108    ; DR2 = 'l' (ASCII 108)
ADDI 3 108    ; DR3 = 'l' (ASCII 108)
ADDI 4 111    ; DR4 = 'o' (ASCII 111)
ADDI 5 32     ; DR5 = ' ' (ASCII 32)
ADDI 6 77     ; DR6 = 'M' (ASCII 77)
ADDI 7 117    ; DR7 = 'u' (ASCII 117)
ADDI 8 109    ; DR8 = 'm' (ASCII 109)</pre>
                <p>These are <strong>Turing instructions</strong> operating purely on values. No capabilities are involved. Domain separation is absolute:</p>
                <ul style="font-size: 0.85rem;">
                    <li><strong>CRs</strong> hold Golden Tokens (Church domain) &mdash; oil</li>
                    <li><strong>DRs</strong> hold numeric values (Turing domain) &mdash; water</li>
                    <li>They never mix. mLoad is the gate between them.</li>
                </ul>`,
                demo: `<div class="demo-title">Data Registers After Step 5</div>
                <div class="demo-content">
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.4rem; font-size: 0.75rem;">
                        <div style="background: #1e293b; padding: 0.4rem; border-radius: 4px; text-align: center;"><strong>DR0</strong> = 72<br><span style="color: #60a5fa; font-size: 1.2rem;">'H'</span></div>
                        <div style="background: #1e293b; padding: 0.4rem; border-radius: 4px; text-align: center;"><strong>DR1</strong> = 101<br><span style="color: #60a5fa; font-size: 1.2rem;">'e'</span></div>
                        <div style="background: #1e293b; padding: 0.4rem; border-radius: 4px; text-align: center;"><strong>DR2</strong> = 108<br><span style="color: #60a5fa; font-size: 1.2rem;">'l'</span></div>
                        <div style="background: #1e293b; padding: 0.4rem; border-radius: 4px; text-align: center;"><strong>DR3</strong> = 108<br><span style="color: #60a5fa; font-size: 1.2rem;">'l'</span></div>
                        <div style="background: #1e293b; padding: 0.4rem; border-radius: 4px; text-align: center;"><strong>DR4</strong> = 111<br><span style="color: #60a5fa; font-size: 1.2rem;">'o'</span></div>
                        <div style="background: #1e293b; padding: 0.4rem; border-radius: 4px; text-align: center;"><strong>DR5</strong> = 32<br><span style="color: #60a5fa; font-size: 1.2rem;">' '</span></div>
                        <div style="background: #1e293b; padding: 0.4rem; border-radius: 4px; text-align: center;"><strong>DR6</strong> = 77<br><span style="color: #60a5fa; font-size: 1.2rem;">'M'</span></div>
                        <div style="background: #1e293b; padding: 0.4rem; border-radius: 4px; text-align: center;"><strong>DR7</strong> = 117<br><span style="color: #60a5fa; font-size: 1.2rem;">'u'</span></div>
                        <div style="background: #1e293b; padding: 0.4rem; border-radius: 4px; text-align: center;"><strong>DR8</strong> = 109<br><span style="color: #60a5fa; font-size: 1.2rem;">'m'</span></div>
                    </div>
                    <div style="text-align: center; margin-top: 0.5rem; font-weight: bold; color: #60a5fa; font-size: 0.9rem;">"H e l l o &nbsp; M u m"</div>
                </div>`
            },
            {
                text: `<h3>Step 6: CALL &mdash; The Holy Grail</h3>
                <p>This is the moment. <strong>One Church instruction:</strong></p>
                <pre style="background: var(--bg-tertiary); padding: 0.6rem; border-radius: 4px; font-size: 0.95rem; text-align: center; color: #4ade80;">CALL 1    ; CALL(CONNECT(me, mymother))</pre>
                <p>When the machine executes CALL on CR1 (the Outform GT), the following happens <strong>automatically</strong>, entirely in hardware:</p>
                <ol style="font-size: 0.85rem;">
                    <li><strong>E permission checked</strong> on CR1 &rarr; validated by mLoad</li>
                    <li><strong>Outform detected</strong> &rarr; tunnel path entered</li>
                    <li><strong>Tunnel key read</strong> from CR0 via mLoad (R permission)</li>
                    <li><strong>ABI descriptor loaded</strong> from namespace (R permission)</li>
                    <li><strong>DR0-DR5 serialized</strong> per ABI arg_map to wire format</li>
                    <li><strong>Payload encrypted</strong> with tunnel key (HMAC-SHA256)</li>
                    <li><strong>Sent to mymother's endpoint</strong> via HTTPS</li>
                    <li>mymother validates, executes, returns encrypted result</li>
                    <li><strong>Response decrypted</strong> and deserialized into DR0</li>
                </ol>
                <div class="key-concept">
                    <strong>The Holy Grail:</strong> The caller wrote one intent: "talk to Mum." The machine decomposed it into three GT operations. Two architectures collaborated. The caller saw: "I called a function and got a result." This is network transparency through Church's abstraction.
                </div>`,
                demo: `<div class="demo-title">CALL Execution Flow</div>
                <div class="demo-content">
                    <div style="font-size: 0.7rem;">
                        <div style="display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.3rem;">
                            <span style="background: #6366f1; padding: 0.2rem 0.4rem; border-radius: 3px; color: white;">CALL 1</span>
                            <span>&rarr;</span>
                            <span style="color: #fbbf24;">E check on CR1</span>
                            <span style="color: #4ade80;">PASS</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.3rem;">
                            <span style="width: 4rem;">&nbsp;</span>
                            <span>&rarr;</span>
                            <span style="color: #fbbf24;">Outform detected</span>
                            <span style="color: #c084fc;">tunnel path</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.3rem;">
                            <span style="width: 4rem;">&nbsp;</span>
                            <span>&rarr;</span>
                            <span style="color: #4ade80;">Read tunnel key (CR0, R)</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.3rem;">
                            <span style="width: 4rem;">&nbsp;</span>
                            <span>&rarr;</span>
                            <span style="color: #60a5fa;">ABI map: DR0-5 &rarr; x10-15</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.3rem;">
                            <span style="width: 4rem;">&nbsp;</span>
                            <span>&rarr;</span>
                            <span style="color: #f87171;">Encrypt &amp; send via HTTPS</span>
                        </div>
                        <div style="margin-top: 0.4rem; padding: 0.4rem; background: #16a34a22; border-radius: 4px; text-align: center; color: #4ade80; font-weight: bold;">
                            "Hello Mum" delivered &mdash; DR0 = acknowledgment
                        </div>
                    </div>
                </div>`
            },
            {
                text: `<h3>Step 7: The Other Side (mymother)</h3>
                <p>On mymother's Capability machine, the message arrives through the tunnel. The messaging service:</p>
                <ol style="font-size: 0.85rem;">
                    <li><strong>Decrypts</strong> the payload using the matching tunnel key</li>
                    <li><strong>Validates</strong> the payload MAC (HMAC-SHA256)</li>
                    <li><strong>ABI maps</strong> the incoming data: x10='H', x11='e', x12='l', x13='l', x14='o', x15=' ', x16='M', x17='u', x18='m'</li>
                    <li><strong>Stores</strong> the message in the Inbox via CAP.STORE (W permission on CR2)</li>
                    <li><strong>Returns</strong> acknowledgment in x10 (ack code: MESSAGE_RECEIVED)</li>
                </ol>
                <p>The service code <strong>never knows</strong> the caller was on a different architecture. It just executed a function and returned results.</p>
                <div class="highlight">
                    You can see the mymother side by clicking <strong>"MyMother &rarr;"</strong> in the top bar to open the Capability Simulator.
                </div>`,
                demo: `<div class="demo-title">mymother Receives</div>
                <div class="demo-content">
                    <pre style="background: #1e1e2e; padding: 0.6rem; border-radius: 6px; font-size: 0.7rem; color: #e2e8f0;">; mymother's Capability messaging service
; Arguments arrive per ABI descriptor:
;   x10='H' x11='e' x12='l' x13='l' x14='o'
;   x15=' ' x16='M' x17='u' x18='m'

; Store in Inbox (capability-protected)
CAP.LOAD  CR2, CR6, 7     ; CR2 = Inbox [R,W]
CAP.STORE CR2, x10, 0     ; Write 'H'
CAP.STORE CR2, x11, 4     ; Write 'e'
; ... store remaining chars ...

; Return acknowledgment
ADDI  x10, x0, 1          ; ack = MESSAGE_RECEIVED
RETURN                     ; Back through tunnel</pre>
                </div>`
            },
            {
                text: `<h3>The Security Proof</h3>
                <p>Every single step in the Hello Mum flow passes through mLoad. Every check that fails triggers a uniform <strong>FAULT</strong> &mdash; unrecoverable, no information leakage:</p>
                <table style="width: 100%; border-collapse: collapse; font-size: 0.7rem; margin: 0.5rem 0;">
                    <tr style="background: var(--bg-tertiary);"><th style="padding: 0.3rem;">Step</th><th>Check</th><th>Failure</th></tr>
                    <tr><td>LOAD CR0</td><td>M on CR6 (elevated by CALL)</td><td style="color: #f87171;">FAULT: PERMISSION</td></tr>
                    <tr style="background: var(--bg-tertiary);"><td>LOAD CR0</td><td>MAC on entry 0</td><td style="color: #f87171;">FAULT: MAC</td></tr>
                    <tr><td>LOAD CR0</td><td>Version on entry 0</td><td style="color: #f87171;">FAULT: VERSION</td></tr>
                    <tr style="background: var(--bg-tertiary);"><td>LOAD CR1</td><td>M on CR6, MAC, version</td><td style="color: #f87171;">FAULT (same chain)</td></tr>
                    <tr><td>CALL CR1</td><td>E perm on CR1</td><td style="color: #f87171;">FAULT: PERMISSION</td></tr>
                    <tr style="background: var(--bg-tertiary);"><td>CALL CR1</td><td>R perm on tunnel key</td><td style="color: #f87171;">FAULT: PERMISSION</td></tr>
                    <tr><td>CALL CR1</td><td>Encryption with key</td><td style="color: #f87171;">FAULT: CRYPTO</td></tr>
                    <tr style="background: var(--bg-tertiary);"><td>CALL CR1</td><td>Response decryption</td><td style="color: #f87171;">FAULT: CRYPTO</td></tr>
                </table>
                <div class="key-concept">
                    <strong>No path around mLoad.</strong> Every FAULT looks identical from outside &mdash; same timing, same behavior, same observable state. Attackers learn nothing. This is failsafe security.
                </div>`,
                demo: `<div class="demo-title">Why Each Zero Is Zero</div>
                <div class="demo-content">
                    <div style="font-size: 0.7rem; line-height: 1.6;">
                        <div><strong style="color: #f87171;">Malware</strong> needs X permission on a valid GT to execute code. No GT? No execution. Escalation path eliminated.</div>
                        <div style="margin-top: 0.3rem;"><strong style="color: #fb923c;">Ransomware</strong> needs W permission on every file it encrypts. No GT with W? Can't touch it. Mass encryption impossible.</div>
                        <div style="margin-top: 0.3rem;"><strong style="color: #2dd4bf;">AI Breakout</strong> requires container/kernel escape. No container. No kernel. AI holds GTs for exactly what it's granted. Intelligence doesn't forge Golden Tokens.</div>
                        <div style="margin-top: 0.5rem; padding: 0.4rem; background: #1e293b; border-radius: 4px; text-align: center;">
                            <span style="color: #4ade80; font-weight: bold;">Root cause:</span> mLoad is the single trusted gate.<br>Nobody goes around it. Not even the Nucleus.
                        </div>
                    </div>
                </div>`
            },
            {
                text: `<h3>Try It Yourself</h3>
                <p>Now that you understand the flow, run it in the simulator:</p>
                <ol>
                    <li>Go to the <strong>Assembly Editor</strong> view</li>
                    <li>Click the <strong>Hello Mum</strong> example button (under Church Examples)</li>
                    <li>Click <strong>Step</strong> to trace each instruction</li>
                    <li>Watch the Dashboard update as capabilities load into CRs</li>
                    <li>Observe data registers fill with "Hello Mum" characters</li>
                    <li>See the CALL instruction enter the tunnel</li>
                </ol>
                <div class="key-concept">
                    <strong>What to observe:</strong> Each LOAD triggers an mLoad validation chain. Each TPERM confirms permissions before proceeding. The CALL instruction detects the Outform type and enters the tunnel path. The entire flow is <strong>one intent, three tokens, seven zeroes</strong>.
                </div>
                <p>Then open the <strong>Capability Simulator</strong> (MyMother link) to see the receiving side.</p>`,
                interactive: {
                    type: "quiz",
                    question: "How many Golden Tokens does the Hello Mum proof require?",
                    options: [
                        "One (the CALL instruction)",
                        "Two (tunnel key and service GT)",
                        "Three (me, tunnel key, mymother)",
                        "Seven (one for each zero)"
                    ],
                    correct: 2,
                    feedback: {
                        correct: "Correct! Three Golden Tokens: 'me' (CR8, thread identity), the tunnel key (CR0, R permission), and 'mymother' (CR1, Outform with E permission).",
                        incorrect: "The answer is three: 'me' in CR8 (thread identity), the tunnel key in CR0 (R permission for crypto), and 'mymother' in CR1 (Outform GT with E permission for the remote service)."
                    }
                }
            }
        ]
    },
    {
        title: "Programmable Method Security",
        steps: [
            {
                text: `<h3>Three Levels of Method-Selector Security</h3>
                <p>When you CALL an abstraction, the Access code at slot [1] dispatches to the requested method. In CM, the <strong>method selector itself is programmable</strong> &mdash; the abstraction author chooses the security level:</p>
                <ol>
                    <li><strong>Integer selector</strong> (DR0 = 0, 1, 2&hellip;) &mdash; simple, fast, but an attacker who gains the capability could walk the selector space</li>
                    <li><strong>Text string selector</strong> (DR0 points to a data region) &mdash; the Access dispatcher matches a string, optionally obfuscated. Much harder to enumerate</li>
                    <li><strong>Abstract GT selector</strong> (a CR holds an Abstract GT) &mdash; the dispatcher validates the GT before dispatching. You need a valid capability just to <em>select</em> the method</li>
                </ol>
                <div class="key-concept">
                    <strong>Key Insight:</strong> This is programmable security that <em>cannot exist</em> without CM technology. In von Neumann machines, method dispatch is always by name or offset &mdash; structural, never secured. In CM, dispatch happens inside the abstraction's scope behind the Access code, so the author has complete freedom to program the security level of the selector itself.
                </div>`,
                demo: `<div class="demo-title">Three Dispatch Security Modes</div>
                <div class="demo-content">
                    <div style="font-size: 0.75rem;">
                        <div style="margin-bottom: 0.8rem; padding: 0.5rem; background: var(--bg-panel); border-radius: 4px; border-left: 3px solid #4ade80;">
                            <div style="color: #4ade80; font-weight: bold; margin-bottom: 0.3rem;">Integer Dispatch (Simple)</div>
                            <div style="font-family: monospace; color: #94a3b8;">MOV DR0, #3 &nbsp; ; method = DIV</div>
                            <div style="font-family: monospace; color: #94a3b8;">CALL CR0 &nbsp;&nbsp;&nbsp;&nbsp; ; dispatch</div>
                            <div style="color: #f87171; margin-top: 0.2rem; font-size: 0.7rem;">Risk: attacker can try DR0 = 0, 1, 2&hellip;</div>
                        </div>
                        <div style="margin-bottom: 0.8rem; padding: 0.5rem; background: var(--bg-panel); border-radius: 4px; border-left: 3px solid #f59e0b;">
                            <div style="color: #f59e0b; font-weight: bold; margin-bottom: 0.3rem;">String Dispatch (Obscured)</div>
                            <div style="font-family: monospace; color: #94a3b8;">MOV DR0, #str_addr ; obfuscated name</div>
                            <div style="font-family: monospace; color: #94a3b8;">CALL CR0 &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ; string match</div>
                            <div style="color: #f59e0b; margin-top: 0.2rem; font-size: 0.7rem;">Harder: must guess the string</div>
                        </div>
                        <div style="padding: 0.5rem; background: var(--bg-panel); border-radius: 4px; border-left: 3px solid #a78bfa;">
                            <div style="color: #a78bfa; font-weight: bold; margin-bottom: 0.3rem;">Abstract GT Dispatch (Capability-Protected)</div>
                            <div style="font-family: monospace; color: #94a3b8;">LOAD CR1, CR6, #key ; Abstract GT</div>
                            <div style="font-family: monospace; color: #94a3b8;">CALL CR0 &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ; GT validated</div>
                            <div style="color: #4ade80; margin-top: 0.2rem; font-size: 0.7rem;">Secure: need valid GT to select method</div>
                        </div>
                    </div>
                </div>`
            },
            {
                text: `<h3>The Abstract GT Type</h3>
                <p>The CM GT type field encodes four types:</p>
                <ul>
                    <li><strong>Inform (00)</strong> &mdash; local resource (data, code, C-List)</li>
                    <li><strong>Outform (01)</strong> &mdash; remote resource (network-transparent)</li>
                    <li><strong>NULL (10)</strong> &mdash; empty/cleared slot</li>
                    <li><strong>Abstract (11)</strong> &mdash; pure identity token, no data access</li>
                </ul>
                <p>An <strong>Abstract GT</strong> carries <em>no</em> data access rights &mdash; no R, W, X, L, S, or E permissions. It is purely an <strong>identity token</strong>: unforgeable, revocable, and scope-confined.</p>
                <div class="key-concept">
                    <strong>Key Property:</strong> Abstract GTs can only exist in Context Registers (CRs), never in Data Registers (DRs). They are created by Mint, sealed with version+FNV, and validated by mLoad like any other GT. But they grant no resource access &mdash; they prove identity.
                </div>`,
                demo: `<div class="demo-title">Abstract GT Properties</div>
                <div class="demo-content">
                    <div style="font-size: 0.75rem;">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
                            <div style="padding: 0.4rem; background: var(--bg-panel); border-radius: 4px; text-align: center;">
                                <div style="color: #a78bfa; font-weight: bold;">Unforgeable</div>
                                <div style="color: #94a3b8; font-size: 0.7rem;">Only Mint creates them</div>
                            </div>
                            <div style="padding: 0.4rem; background: var(--bg-panel); border-radius: 4px; text-align: center;">
                                <div style="color: #a78bfa; font-weight: bold;">Revocable</div>
                                <div style="color: #94a3b8; font-size: 0.7rem;">GC version bump invalidates all copies</div>
                            </div>
                            <div style="padding: 0.4rem; background: var(--bg-panel); border-radius: 4px; text-align: center;">
                                <div style="color: #a78bfa; font-weight: bold;">Non-transferable</div>
                                <div style="color: #94a3b8; font-size: 0.7rem;">Only moves via capability-safe paths</div>
                            </div>
                            <div style="padding: 0.4rem; background: var(--bg-panel); border-radius: 4px; text-align: center;">
                                <div style="color: #a78bfa; font-weight: bold;">Scope-confined</div>
                                <div style="color: #94a3b8; font-size: 0.7rem;">Valid only within issuing abstraction</div>
                            </div>
                        </div>
                        <div style="margin-top: 0.5rem; padding: 0.4rem; background: #a78bfa22; border-radius: 4px; text-align: center; font-size: 0.7rem;">
                            <span style="color: #a78bfa;">Type bits = 11 (Abstract)</span> &mdash; No permissions, pure identity
                        </div>
                    </div>
                </div>`
            },
            {
                text: `<h3>Abstract GTs as Protected Credentials</h3>
                <p>In traditional systems, login credentials are just data &mdash; strings, tokens, cookies &mdash; that can be copied, leaked, replayed, or forged. Abstract GTs make credentials a <strong>hardware-protected type</strong>.</p>
                <p>A service abstraction mints an Abstract GT, hands it to the caller via a CR, and that GT serves as both:</p>
                <ul>
                    <li><strong>Login credential</strong> &mdash; "prove you are authorised to use this service"</li>
                    <li><strong>Method selector</strong> &mdash; "AND tell me what you want" in a single CR</li>
                </ul>
                <p>This is <strong>two layers</strong> of Golden Token protection: one GT to enter the abstraction (CALL), another GT to select the method (Abstract GT in CR). No operating system, no virtual memory, no privilege mode can offer this.</p>
                <div class="key-concept">
                    <strong>Versus Traditional Systems:</strong> Software tokens (JWT, OAuth, API keys) are just data strings &mdash; they can be leaked via logs, debuggers, memory dumps, or side channels. An Abstract GT is a hardware-enforced type that cannot exist in a Data Register, cannot be printed, and cannot be extracted from its capability-safe path.
                </div>`,
                demo: `<div class="demo-title">Credential Security Comparison</div>
                <div class="demo-content">
                    <div style="font-size: 0.75rem;">
                        <div style="margin-bottom: 0.8rem;">
                            <div style="color: #f87171; font-weight: bold; margin-bottom: 0.3rem;">Traditional Credentials (Software)</div>
                            <div style="padding: 0.4rem; background: #f8717122; border-radius: 4px; font-family: monospace; font-size: 0.7rem; color: #94a3b8;">
                                token = "eyJhbGciOiJIUzI1NiJ9..."<br>
                                // Can be: logged, copied, leaked,<br>
                                // replayed, forged, intercepted
                            </div>
                        </div>
                        <div>
                            <div style="color: #4ade80; font-weight: bold; margin-bottom: 0.3rem;">Abstract GT Credential (Hardware)</div>
                            <div style="padding: 0.4rem; background: #4ade8022; border-radius: 4px; font-family: monospace; font-size: 0.7rem; color: #94a3b8;">
                                LOAD CR1, CR6, #cred ; Abstract GT<br>
                                CALL CR0 &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ; validated by mLoad<br>
                                ; Cannot: log, copy to DR, print,<br>
                                ; forge, or extract from CR path
                            </div>
                        </div>
                        <div style="margin-top: 0.5rem; padding: 0.4rem; background: #16a34a22; border-radius: 4px; text-align: center; color: #4ade80; font-weight: bold; font-size: 0.8rem;">
                            Hardware-enforced credential &gt; Software token
                        </div>
                    </div>
                </div>`,
                interactive: {
                    type: "quiz",
                    question: "Why can't an Abstract GT credential be leaked like a JWT token?",
                    options: [
                        "It uses stronger encryption",
                        "It can only exist in Context Registers, never in Data Registers",
                        "It has a shorter expiry time",
                        "It requires two-factor authentication"
                    ],
                    correct: 1,
                    feedback: {
                        correct: "Correct! Abstract GTs are a hardware-enforced type that can only exist in CRs. They cannot be copied to DRs, printed, logged, or extracted from the capability-safe path. This is fundamentally different from software tokens which are just data.",
                        incorrect: "The key insight is that Abstract GTs can only exist in Context Registers (CRs), never in Data Registers (DRs). Unlike software tokens (which are just data strings), an Abstract GT is a hardware-enforced type that cannot be copied, printed, or extracted from the capability path."
                    }
                }
            }
        ]
    },
    {
        title: "Constants as Abstract GTs",
        steps: [
            {
                text: `<h3>Why Constants Need Protection</h3>
                <p>In conventional computers, a constant like <strong>&pi;</strong> is just a number sitting in memory or a register. Any bug, buffer overflow, or injection attack could <strong>corrupt it</strong> &mdash; and corrupted constants produce wrong answers silently.</p>
                <p>The CM takes a different approach: physical and mathematical constants are <strong>Abstract Golden Tokens</strong> &mdash; unforgeable identity tokens that the Constants abstraction issued via Mint.</p>
                <div class="key-concept">
                    <strong>Key Insight:</strong> Constants never exist as bare data. Each constant is an Abstract GT (type 0b11) with <em>no permissions</em>. It carries only identity &mdash; the Constants abstraction knows what value that identity maps to.
                </div>`,
                demo: `<div class="demo-title">Conventional vs CM Constants</div>
                <div class="demo-content">
                    <div style="font-size: 0.75rem;">
                        <div style="margin-bottom: 0.8rem;">
                            <div style="color: #f87171; font-weight: bold; margin-bottom: 0.3rem;">Conventional (Bare Data)</div>
                            <div style="padding: 0.4rem; background: #f8717122; border-radius: 4px; font-family: monospace; font-size: 0.7rem; color: #94a3b8;">
                                pi = 3.14159265358979<br>
                                // Stored in DR or memory<br>
                                // Any code can overwrite it<br>
                                // Buffer overflow corrupts it
                            </div>
                        </div>
                        <div>
                            <div style="color: #f472b6; font-weight: bold; margin-bottom: 0.3rem;">CM (Abstract GT)</div>
                            <div style="padding: 0.4rem; background: #f472b622; border-radius: 4px; font-family: monospace; font-size: 0.7rem; color: #94a3b8;">
                                LOAD CR1, CR0, #2  ; GT_PI<br>
                                ; Abstract GT in CR1<br>
                                ; Cannot exist in DR<br>
                                ; Cannot be overwritten
                            </div>
                        </div>
                    </div>
                </div>`
            },
            {
                text: `<h3>Using the Constants Abstraction</h3>
                <p>The Constants abstraction holds Abstract GTs for both <strong>mathematical constants</strong> (&pi;, e, &phi;, &radic;2, ln2, ln10) and <strong>physical constants</strong> (c, h, k<sub>B</sub>, N<sub>A</sub>, G).</p>
                <p>To retrieve a constant value:</p>
                <ol>
                    <li><strong>LOAD</strong> the Constants abstraction into a CR from the Boot C-List (slot 9)</li>
                    <li><strong>LOAD</strong> the desired Abstract GT from the Constants C-List into CR1</li>
                    <li><strong>CALL</strong> the Constants abstraction &mdash; it validates the Abstract GT in CR1 and returns the value in DR0</li>
                </ol>
                <div class="key-concept">
                    <strong>Abstract GT Dispatch:</strong> This is the most secure method-selector dispatch mode. The caller must hold the Abstract GT (capability gate) AND pass it via CR (hardware-enforced path). No integer or string guessing can bypass this.
                </div>`,
                demo: `<div class="demo-title">Constants Dispatch Pattern</div>
                <div class="demo-content">
                    <div style="font-size: 0.75rem;">
                        <div style="padding: 0.5rem; background: #f472b622; border-radius: 4px; font-family: monospace; font-size: 0.7rem; color: #94a3b8;">
                            ; Load Constants abstraction<br>
                            LOAD CR0, CR6, #9  ; Constants [E]<br><br>
                            ; Load GT_PI Abstract GT<br>
                            LOAD CR1, CR0, #2  ; GT_PI<br><br>
                            ; Retrieve value<br>
                            CALL CR0           ; validates CR1<br>
                            ; DR0 = 3.14159265...<br><br>
                            ; Load GT_C (speed of light)<br>
                            LOAD CR1, CR0, #8  ; GT_C<br>
                            CALL CR0<br>
                            ; DR0 = 299792458
                        </div>
                    </div>
                </div>`
            },
            {
                text: `<h3>Available Constants</h3>
                <p>The Constants abstraction provides identity tokens for fundamental constants used in science and engineering:</p>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; font-size: 0.8rem;">
                    <div>
                        <div style="color: #c084fc; font-weight: bold; margin-bottom: 0.3rem;">Mathematical</div>
                        <div style="color: #94a3b8;"><strong style="color: #f472b6;">GT_PI</strong> &mdash; &pi; = 3.14159...</div>
                        <div style="color: #94a3b8;"><strong style="color: #f472b6;">GT_E</strong> &mdash; e = 2.71828...</div>
                        <div style="color: #94a3b8;"><strong style="color: #f472b6;">GT_PHI</strong> &mdash; &phi; = 1.61803...</div>
                        <div style="color: #94a3b8;"><strong style="color: #f472b6;">GT_SQRT2</strong> &mdash; &radic;2 = 1.41421...</div>
                        <div style="color: #94a3b8;"><strong style="color: #f472b6;">GT_LN2</strong> &mdash; ln(2) = 0.69314...</div>
                        <div style="color: #94a3b8;"><strong style="color: #f472b6;">GT_LN10</strong> &mdash; ln(10) = 2.30258...</div>
                    </div>
                    <div>
                        <div style="color: #c084fc; font-weight: bold; margin-bottom: 0.3rem;">Physical</div>
                        <div style="color: #94a3b8;"><strong style="color: #f472b6;">GT_C</strong> &mdash; 299,792,458 m/s</div>
                        <div style="color: #94a3b8;"><strong style="color: #f472b6;">GT_PLANCK</strong> &mdash; 6.626&times;10<sup>-34</sup> J&middot;s</div>
                        <div style="color: #94a3b8;"><strong style="color: #f472b6;">GT_BOLTZMANN</strong> &mdash; 1.381&times;10<sup>-23</sup> J/K</div>
                        <div style="color: #94a3b8;"><strong style="color: #f472b6;">GT_AVOGADRO</strong> &mdash; 6.022&times;10<sup>23</sup> /mol</div>
                        <div style="color: #94a3b8;"><strong style="color: #f472b6;">GT_G</strong> &mdash; 6.674&times;10<sup>-11</sup> m&sup3;/(kg&middot;s&sup2;)</div>
                    </div>
                </div>`,
                interactive: {
                    type: "quiz",
                    question: "Why are physical constants Abstract GTs instead of plain numbers?",
                    options: [
                        "They are too large to fit in Data Registers",
                        "They cannot be corrupted — Abstract GTs carry identity, not data, and only exist in CRs",
                        "They need encryption for security",
                        "They change too frequently to store directly"
                    ],
                    correct: 1,
                    feedback: {
                        correct: "Correct! Abstract GTs are pure identity tokens in Context Registers. The constant's value is never exposed as bare data that could be corrupted by bugs, overflows, or attacks. Only the Constants abstraction can dereference the identity to a value.",
                        incorrect: "The key insight is that Abstract GTs protect constants by making them identity tokens, not data. They can only exist in Context Registers, so no bug, overflow, or attack can corrupt them. The Constants abstraction is the only code that knows the identity-to-value mapping."
                    }
                }
            }
        ]
    },
    {
        title: "HP-35: Calculator from Lambda Calculus",
        steps: [
            {
                text: `<h3>Building a Calculator from Nothing</h3>
                <p>The HP-35 was the world's first handheld scientific calculator (Hewlett-Packard, 1972). We rebuild it as a CM abstraction using <strong>pure lambda calculus</strong> &mdash; no hardware ALU, no floating-point unit.</p>
                <p>Every operation &mdash; addition, square root, sine &mdash; is composed from three foundations:</p>
                <div class="key-concept">
                    <strong>The Three Foundations:</strong><br>
                    1. <strong>Church Numerals</strong> &mdash; numbers as lambda functions: 3 = &lambda;f.&lambda;x. f(f(f(x)))<br>
                    2. <strong>Nested Pairs</strong> &mdash; the RPN stack: stack = PAIR(top, PAIR(next, rest))<br>
                    3. <strong>Abstract GTs</strong> &mdash; constants like &pi; as unforgeable identity tokens
                </div>`,
                demo: `<div class="demo-title">HP-35 RPN Stack Model</div>
                <div class="demo-content">
                    <div style="font-size: 0.75rem;">
                        <div style="color: #88ccff; font-family: monospace; line-height: 1.6; font-size: 0.7rem;">
                            ; RPN: Enter 3, Enter 4, press +<br>
                            <br>
                            ; Step 1: Key "3"<br>
                            DIGIT(SUCC&sup3;(ZERO)) &rarr; X=3<br>
                            stack = PAIR(3, FALSE)<br>
                            <br>
                            ; Step 2: ENTER<br>
                            PUSH X &rarr; PAIR(3, PAIR(3, FALSE))<br>
                            <br>
                            ; Step 3: Key "4"<br>
                            DIGIT(SUCC&sup4;(ZERO)) &rarr; X=4<br>
                            stack = PAIR(4, PAIR(3, FALSE))<br>
                            <br>
                            ; Step 4: Press +<br>
                            CHURCH_ADD(3, 4) = 7<br>
                            POP &rarr; stack = PAIR(7, FALSE)
                        </div>
                    </div>
                </div>`
            },
            {
                text: `<h3>Abstraction Dependencies</h3>
                <p>A programmer builds the HP-35 step by step, starting from foundations already in the system:</p>
                <p><strong>Step 1:</strong> The <span style="color:#88ccff">Lambda</span> abstraction provides Church numerals (SUCC, PRED, ADD, SUB, MUL, DIV, POW), booleans (TRUE, FALSE, IF), pairs (PAIR, FST, SND), and the Y-Combinator for recursion.</p>
                <p><strong>Step 2:</strong> The <span style="color:#88ccff">Stack</span> abstraction uses Lambda's pairs to build an RPN stack: PUSH = PAIR(val, stack), POP = FST(stack), SWAP reorders the top two.</p>
                <p><strong>Step 3:</strong> The <span style="color:#88ccff">HP35</span> abstraction wires Lambda's arithmetic, Stack's RPN, and Constants' Abstract GTs into a complete calculator.</p>
                <div class="key-concept">
                    <strong>Key Insight:</strong> No operation is primitive. Addition is repeated succession. Multiplication is repeated addition. Exponentiation is repeated multiplication. The entire calculator is built from &lambda;f.&lambda;x. f(x).
                </div>`,
                demo: `<div class="demo-title">Dependency Chain</div>
                <div class="demo-content">
                    <div style="font-size: 0.75rem;">
                        <div style="font-family: monospace; line-height: 1.8; font-size: 0.7rem;">
                            <span style="color:#f472b6">HP35</span> depends on:<br>
                            &nbsp;&nbsp;<span style="color:#88ccff">Stack</span> &larr; PUSH, POP, SWAP, CLEAR<br>
                            &nbsp;&nbsp;<span style="color:#88ccff">Lambda</span> &larr; ADD, SUB, MUL, DIV, POW<br>
                            &nbsp;&nbsp;<span style="color:#f472b6">Constants</span> &larr; PI (Abstract GT)<br>
                            <br>
                            <span style="color:#88ccff">Stack</span> depends on:<br>
                            &nbsp;&nbsp;<span style="color:#88ccff">Lambda</span> &larr; PAIR, FST, SND, FALSE<br>
                            <br>
                            <span style="color:#88ccff">Lambda</span> depends on:<br>
                            &nbsp;&nbsp;Nothing &mdash; pure lambda calculus
                        </div>
                    </div>
                </div>`
            },
            {
                text: `<h3>Try It</h3>
                <p>Click the <strong>HP-35</strong> tab in the navigation bar to open the calculator. Try this RPN calculation:</p>
                <p>1. Press <strong>3</strong> then <strong>ENTER</strong><br>
                2. Press <strong>4</strong><br>
                3. Press <strong>+</strong><br>
                4. The display shows <strong>7</strong></p>
                <p>Watch the <strong>Lambda Calculus Trace</strong> panel on the right &mdash; it shows every operation decomposed into its Church lambda expression.</p>
                <div class="key-concept">
                    <strong>RPN Advantage:</strong> No parentheses, no equals key, no operator precedence. The stack <em>is</em> the memory. This maps perfectly to lambda calculus where function application is the only operation.
                </div>`,
                demo: `<div class="demo-title">Scientific Functions</div>
                <div class="demo-content">
                    <div style="font-size: 0.75rem;">
                        <div style="font-family: monospace; line-height: 1.6; font-size: 0.7rem;">
                            <span style="color:#fbbf24;">; sin(0.5) via Taylor series</span><br>
                            SIN_TAYLOR(x) =<br>
                            &nbsp;&nbsp;x - x&sup3;/3! + x&sup5;/5! - ...<br>
                            <br>
                            Each term is Church arithmetic:<br>
                            &nbsp;&nbsp;x&sup3; = MUL(x, MUL(x, x))<br>
                            &nbsp;&nbsp;3! = MUL(3, MUL(2, 1))<br>
                            &nbsp;&nbsp;DIV = Y(&lambda;f.&lambda;q. IF(LEQ n m)<br>
                            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;(f(SUB m n)(SUCC q)) q)
                        </div>
                    </div>
                </div>`,
                interaction: {
                    type: "quiz",
                    question: "In the HP-35's RPN model, what does pressing '+' actually do at the lambda calculus level?",
                    options: [
                        "Calls a hardware ADD instruction",
                        "Pops two values, applies CHURCH_ADD (repeated SUCC), pushes result",
                        "Sends a signal to the SlideRule abstraction",
                        "Stores the sum in a Data Register"
                    ],
                    correct: 1,
                    feedback: {
                        correct: "Correct! The HP-35 pops X and Y from the stack (FST/SND of pairs), applies CHURCH_ADD which is repeated SUCC (successor), and pushes the result back. No hardware ALU involved — it's pure lambda calculus.",
                        incorrect: "The HP-35 abstraction uses Church lambda calculus, not hardware. CHURCH_ADD is defined as λm.λn.λf.λx. m f (n f x) — it applies the successor function m times starting from n. The result is pushed back onto the RPN stack."
                    }
                }
            }
        ]
    }
];

function loadLesson(lessonIndex) {
    tutorialState.currentLesson = lessonIndex;
    tutorialState.currentStep = 0;
    
    updateLessonDropdownLabel(lessonIndex);
    
    renderCurrentStep();
}

function updateLessonDropdownLabel(lessonIndex) {
    const label = document.getElementById('lessonDropdownLabel');
    if (!label) return;
    const item = document.querySelector(`.lesson-dropdown-item[data-lesson="${lessonIndex}"]`);
    if (item) label.textContent = item.textContent;
    document.querySelectorAll('.lesson-dropdown-item').forEach(el => el.classList.remove('active'));
    if (item) item.classList.add('active');
}

function initLessonDropdown() {
    const dropdown = document.getElementById('lessonDropdown');
    const trigger = document.getElementById('lessonDropdownTrigger');
    if (!dropdown || !trigger) return;

    trigger.addEventListener('click', function(e) {
        e.stopPropagation();
        dropdown.classList.toggle('open');
    });

    document.addEventListener('click', function() {
        dropdown.classList.remove('open');
    });

    dropdown.querySelector('.lesson-dropdown-menu').addEventListener('click', function(e) {
        e.stopPropagation();
    });

    document.querySelectorAll('.lesson-dropdown-item').forEach(function(item) {
        item.addEventListener('click', function() {
            const lessonIndex = parseInt(this.getAttribute('data-lesson'));
            dropdown.classList.remove('open');
            loadLesson(lessonIndex);
        });
    });
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
    
    // Update step indicators (top and bottom)
    const stepText = `Step ${tutorialState.currentStep + 1} of ${lesson.steps.length}`;
    const stepIndicator = document.getElementById('stepIndicator');
    const stepIndicatorBottom = document.getElementById('stepIndicatorBottom');
    if (stepIndicator) stepIndicator.textContent = stepText;
    if (stepIndicatorBottom) stepIndicatorBottom.textContent = stepText;
    
    // Update button states (top and bottom)
    const prevBtn = document.getElementById('prevStepBtn');
    const nextBtn = document.getElementById('nextStepBtn');
    const prevBtnBottom = document.getElementById('prevStepBtnBottom');
    const nextBtnBottom = document.getElementById('nextStepBtnBottom');
    const atFirst = tutorialState.currentStep === 0;
    const atLast = tutorialState.currentStep >= lesson.steps.length - 1;
    if (prevBtn) prevBtn.disabled = atFirst;
    if (nextBtn) nextBtn.disabled = atLast;
    if (prevBtnBottom) prevBtnBottom.disabled = atFirst;
    if (nextBtnBottom) nextBtnBottom.disabled = atLast;
    
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

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const icons = {
        success: '✓',
        error: '✗',
        info: 'ℹ'
    };
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span>${message}`;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

function saveTutorialEdits() {
    try {
        const lessonKey = `tutorial_${tutorialState.currentLesson}_${tutorialState.currentStep}`;
        const savedEdits = JSON.parse(localStorage.getItem('tutorialEdits') || '{}');
        
        const lessonTextEl = document.getElementById('lessonText');
        const lessonDemoEl = document.getElementById('lessonDemo');
        
        savedEdits[lessonKey + '_text'] = lessonTextEl.innerHTML;
        savedEdits[lessonKey + '_demo'] = lessonDemoEl.innerHTML;
        
        localStorage.setItem('tutorialEdits', JSON.stringify(savedEdits));
        tutorialState.hasUnsavedChanges = false;
        updateTutorialSaveButton();
        
        showToast('Tutorial edits saved', 'success');
        log('Tutorial edits saved', 'success');
    } catch (error) {
        showToast('Failed to save edits', 'error');
        log('Failed to save tutorial edits: ' + error.message, 'error');
    }
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
    initLessonDropdown();
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

let nextAddress = 0x8000;
let dynamicCLists = {};

let selectedObject = {
    name: null,
    type: null
};

function saveToStorage() {
    const state = {
        dynamicEntries: namespaceObjects.filter(o => o.dynamic),
        dynamicCLists,
        nextAddress,
        namespaceModifications: namespaceObjects.filter(o => !o.dynamic).map(o => ({
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
            
            const dynamicEntries = state.dynamicEntries || state.dynamicObjects || [];
            dynamicEntries.forEach(obj => {
                if (obj.perms) {
                    obj.perms = normalizePermissions(obj.perms);
                }
                obj.dynamic = true;
            });
            namespaceObjects = namespaceObjects.filter(o => !o.dynamic);
            namespaceObjects.push(...dynamicEntries);
            
            dynamicCLists = state.dynamicCLists || {};
            nextAddress = state.nextAddress || 0x8000;
            
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
                    const obj = namespaceObjects.find(o => o.name === mod.name && !o.dynamic);
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
    namespaceObjects = namespaceObjects.filter(o => !o.dynamic);
    dynamicCLists = {};
    nextAddress = 0x8000;
    log('Cleared stored namespace state', 'info');
}

function exportNamespaceState() {
    const state = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        dynamicEntries: namespaceObjects.filter(o => o.dynamic),
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
            nia: simulator.nia,
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

function runGCCycle() {
    // Run garbage collection cycle on the namespace hierarchy (DNA)
    // Uses CR15 as the root of the namespace
    
    if (!simulator.cr15 || simulator.cr15.name === 'NULL') {
        addToLog('error', 'GC CYCLE: Cannot run - no namespace loaded (CR15 is NULL). Boot the system first.');
        return;
    }
    
    addToLog('info', 'GC CYCLE: Starting hierarchical DNA scan...');
    
    // Build root set from all active context registers
    const roots = [];
    if (simulator.cr15 && simulator.cr15.name !== 'NULL') {
        roots.push(simulator.cr15);
    }
    
    // Add CR6 (current C-List) if loaded
    if (simulator.contextRegs[6] && simulator.contextRegs[6].name !== 'NULL') {
        roots.push(simulator.contextRegs[6]);
    }
    
    // Add any other loaded CRs with clists
    for (let i = 0; i < 8; i++) {
        const cr = simulator.contextRegs[i];
        if (cr && cr.name !== 'NULL' && cr.clist) {
            roots.push(cr);
        }
    }
    
    // Phase 1: Mark - set G=TRUE on all namespace entries
    addToLog('info', 'GC PHASE 1 (Mark): Setting G=TRUE on all Namespace entries...');
    let totalMarked = 0;
    for (const root of roots) {
        totalMarked += simulator.gcMark(root);
    }
    addToLog('info', `GC PHASE 1 Complete: Marked ${totalMarked} entries with G=TRUE`);
    
    // Phase 2: Scan - walk hierarchy from roots, valid key access resets G
    addToLog('info', 'GC PHASE 2 (Scan): Walking hierarchy from roots...');
    let totalScanned = 0;
    for (const root of roots) {
        totalScanned += simulator.gcScan(root, new Set());
    }
    addToLog('info', `GC PHASE 2 Complete: Scanned ${totalScanned} reachable entries (G reset to FALSE)`);
    
    // Phase 3: Sweep - find entries still marked with G (garbage)
    addToLog('info', 'GC PHASE 3 (Sweep): Identifying unreachable entries...');
    const garbage = [];
    for (const root of roots) {
        garbage.push(...simulator.gcSweep(root));
    }
    
    if (garbage.length === 0) {
        addToLog('success', 'GC CYCLE COMPLETE: No garbage found - all entries are reachable');
    } else {
        addToLog('warn', `GC CYCLE COMPLETE: Found ${garbage.length} unreachable entries (garbage):`);
        for (const item of garbage) {
            addToLog('warn', `  - ${item.path} (G=TRUE, no valid key access)`);
        }
    }
    
    // Refresh the namespace browser to show updated G flags
    renderNamespaceBrowser();
}

function importNamespaceState(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const state = JSON.parse(e.target.result);
            
            // Normalize permissions on imported dynamic objects
            if (state.dynamicObjects || state.dynamicEntries) {
                const entries = state.dynamicEntries || state.dynamicObjects;
                entries.forEach(obj => {
                    if (obj.perms) obj.perms = normalizePermissions(obj.perms);
                    obj.dynamic = true;
                });
                namespaceObjects = namespaceObjects.filter(o => !o.dynamic);
                namespaceObjects.push(...entries);
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
    const capPerms = ['L', 'S', 'E'];
    
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
    
    ['R', 'W', 'X', 'L', 'S', 'E'].forEach(p => {
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
    
    ['R', 'W', 'X', 'L', 'S', 'E'].forEach(p => {
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
    ['R', 'W', 'X', 'L', 'S', 'E'].forEach(p => {
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
    if (cap.type === 'Thread') {
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
    const dynIndex = namespaceObjects.findIndex(o => o.name === cap.name && o.dynamic);
    if (dynIndex >= 0) {
        namespaceObjects.splice(dynIndex, 1);
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
    const dynObj = namespaceObjects.find(o => o.name === name && o.dynamic);
    
    // Check if it's a built-in object - prevent deletion
    if (!dynObj) {
        const builtIn = namespaceObjects.find(o => o.name === name && !o.dynamic);
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
    ['R', 'W', 'X', 'L', 'S', 'E'].forEach(p => {
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
    return namespaceObjects.find(o => o.name === name);
}

function getAllObjects() {
    return namespaceObjects;
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
    
    namespaceObjects.push(newObj);
    
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
    let obj = namespaceObjects.find(o => o.name === oldName && o.dynamic);
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
    
    namespaceObjects.filter(o => o.dynamic).forEach(child => {
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
    const children = namespaceObjects.filter(o => o.dynamic && o.parent === name);
    children.forEach(child => {
        deleteObjectRecursive(child.name);
    });
    
    const idx = namespaceObjects.findIndex(o => o.name === name && o.dynamic);
    if (idx >= 0) {
        namespaceObjects.splice(idx, 1);
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
    const dynObj = namespaceObjects.find(o => o.name === objName && o.dynamic);
    
    // Check if it's a built-in object
    if (!dynObj) {
        const builtIn = namespaceObjects.find(o => o.name === objName && !o.dynamic);
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
    const children = namespaceObjects.filter(o => o.dynamic && o.parent === objName);
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
    if (objType === 'Thread') {
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
    
    namespaceObjects.filter(o => o.dynamic && (o.type === 'C-List' || o.type === 'Abstraction')).forEach(obj => {
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


// Calculate permission bits from permission array (6-bit: R,W,X,L,S,E)
function calculatePermissionBits(perms) {
    const permBits = {
        'R': 0x0001, 'W': 0x0002, 'X': 0x0004, 'L': 0x0008,
        'S': 0x0010, 'E': 0x0020
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
; Method-selector dispatch through Access code
ADDI 0 5            ; DR0 = 5 (LOG method selector)
CALL 1              ; DR0 = ln(x) via Access dispatcher
MUL 0 1             ; DR0 = y * ln(x)
ADDI 0 6            ; DR0 = 6 (EXP method selector)
CALL 1              ; DR0 = exp(y * ln(x)) = x^y via Access

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
    ; Hardware halts and reports fault`,

    GT_CREATE: `; ====================================================
; GT_CREATE (CapabilityManager): Create New Golden Token
; Allocates a new object and returns a GT with permissions
; API: DR0=type (0=Data, 1=C-List), DR1=size in words
; Returns: CR0 = new GT with appropriate permissions
; ====================================================
; Register usage:
;   DR0 = type (0=Data Object, 1=C-List)
;   DR1 = size in words (object capacity)
;   CR0 = output: new Golden Token
; Permission Sets:
;   Data:   [R,W,X] - Read, Write, Execute
;   C-List: [L,S,E] - Load, Save, Enter
; ====================================================

; === PARAMETER VALIDATION ===
; Step 1: Validate type is valid (0 or 1)
CMP 0 0             ; Check if DR0 == 0 (Data)
B EQ valid_type
CMP 0 1             ; Check if DR0 == 1 (C-List)
B EQ valid_type
B NE fault          ; Invalid type -> FAULT

valid_type:
; Step 2: Validate size is reasonable (1-65536 words)
CMP 1 0             ; Check DR1 > 0
B LE fault          ; Size <= 0 -> FAULT
MOV 2 65536         ; Maximum size
CMP 1 2
B GT fault          ; Size > 65536 -> FAULT

; === NAMESPACE ALLOCATION ===
; Step 3: Find free slot in Namespace Table
; Hardware searches for unused entry (W0[valid]=0)
; Allocates 3-word descriptor:
;   W0: Location (base address in memory)
;   W1: Limit (size in words - 1)
;   W2: Seals (MAC, type metadata)

; Step 4: Allocate memory for the object
; Hardware allocates DR1 words of zeroed memory
; Sets W0 = allocated base address
; Sets W1 = DR1 - 1 (limit is size-1)
; Sets W2 = calculated MAC + type bits

; === GOLDEN TOKEN CONSTRUCTION ===
; Step 5: Build 64-bit Golden Token
; Bits 0-31:  Offset into Namespace Table
; Bits 32-37: Permissions (6-bit: R,W,X,L,S,E)
; Bits 38-63: Version/spare

; Step 6: Set permissions based on type
CMP 0 0             ; Is this a Data object?
B EQ data_perms
B NE clist_perms

data_perms:
; Data object: grant [R,W,X]
; Allows reading, writing, and executing
; R = Read data values     (bit 0 = 0x01)
; W = Write data values    (bit 1 = 0x02)
; X = Execute as code      (bit 2 = 0x04)
MOV 0 #0x07         ; R+W+X = 0x01+0x02+0x04 = 0x07
B done_perms

clist_perms:
; C-List object: grant [L,S,E]
; Allows loading, saving, and entering
; L = Load GTs from C-List (bit 3 = 0x08)
; S = Save GTs into C-List (bit 4 = 0x10)
; E = Enter/CALL through   (bit 5 = 0x20)
MOV 0 #0x38         ; L+S+E = 0x08+0x10+0x20 = 0x38

done_perms:
; Step 7: Store new GT in CR0 for caller
; Hardware constructs GT from:
;   - Namespace offset (from allocation)
;   - Permissions (from DR0)
;   - Valid bit set

; CR0 now contains the new Golden Token
; Caller owns full permissions to the new object
RETURN              ; Return with GT in CR0

; === FAILSAFE: No error codes ===
fault:
    FAULT           ; Uniform failure - no information leakage`,

    GT_DATETIME: `; ====================================================
; GT_DATETIME (DateTime): ISO 8601 Date/Time Functions
; Returns current date/time in various ISO 8601 formats
; API: DR0=mode selects output format
; ====================================================
; Mode values (DR0):
;   0 = Full ISO timestamp (YYYY-MM-DDTHH:MM:SSZ)
;   1 = Date only (YYYY-MM-DD)
;   2 = Time only (HH:MM:SS)
;   3 = Unix epoch seconds (numeric in DR1)
;   4 = Components (Y/M/D/H/M/S in DR1-DR6)
; ====================================================
; Return values:
;   Modes 0-2: CR0 = GT to string data object
;   Mode 3:    DR1 = Unix epoch seconds
;   Mode 4:    DR1=Year, DR2=Month, DR3=Day,
;              DR4=Hour, DR5=Minute, DR6=Second
; ====================================================

; === PARAMETER VALIDATION ===
; Step 1: Validate mode is valid (0-4)
CMP 0 0             ; Check if DR0 >= 0
B LT fault          ; Negative mode -> FAULT
CMP 0 4             ; Check if DR0 <= 4
B GT fault          ; Mode > 4 -> FAULT

; === MODE DISPATCH ===
CMP 0 0
B EQ mode_timestamp
CMP 0 1
B EQ mode_date
CMP 0 2
B EQ mode_time
CMP 0 3
B EQ mode_epoch
CMP 0 4
B EQ mode_components
B fault             ; Shouldn't reach here

; === MODE 0: Full ISO Timestamp ===
mode_timestamp:
; Hardware reads system RTC (Real-Time Clock)
; Formats as: YYYY-MM-DDTHH:MM:SSZ (20 chars)
; Allocates string object, stores formatted time
; Returns GT to string in CR0
; String is read-only: permissions [R,B]
RETURN

; === MODE 1: Date Only ===
mode_date:
; Hardware reads system RTC
; Formats as: YYYY-MM-DD (10 chars)
; Returns GT to string in CR0
RETURN

; === MODE 2: Time Only ===
mode_time:
; Hardware reads system RTC
; Formats as: HH:MM:SS (8 chars)
; Returns GT to string in CR0
RETURN

; === MODE 3: Unix Epoch ===
mode_epoch:
; Hardware reads system RTC
; Converts to seconds since 1970-01-01T00:00:00Z
; Stores 64-bit integer in DR1
RETURN

; === MODE 4: Date/Time Components ===
mode_components:
; Hardware reads system RTC
; Decomposes into individual values:
;   DR1 = Year (e.g., 2026)
;   DR2 = Month (1-12)
;   DR3 = Day (1-31)
;   DR4 = Hour (0-23)
;   DR5 = Minute (0-59)
;   DR6 = Second (0-59)
; All values as 64-bit integers
RETURN

; === FAILSAFE: No error codes ===
fault:
    FAULT           ; Uniform failure - no information leakage`,

    GT_Y_COMBINATOR: `; ====================================================
; GT_Y_COMBINATOR (Lambda): Fixed-Point Combinator
; Enables recursion in lambda calculus
; Y f = f (Y f)
; ====================================================
; The Y-Combinator allows anonymous recursion by
; finding the fixed-point of a function.
;
; Lambda calculus: Y = λf. (λx. f (x x)) (λx. f (x x))
; This creates infinite expansion that enables recursion
; without explicit self-reference.
;
; Invoked via: LAMBDA CRn, DRm (X permission, not E)
; The LAMBDA instruction applies code to values in
; data registers without domain crossing.
; ====================================================
; API: DR0 = function argument (iteration count)
; Return: DR0 = fixed-point result
; ====================================================

; Step 1: Y-combinator applies function to its own
; fixed point: result = f(Y f)
; Hardware unrolls: f(f(f(f(...))))
; Lazy evaluation halts at base case

; Step 2: Check base case (DR0 == 0 means converged)
CMP 0 #0            ; Has argument converged?
B EQ done           ; Base case reached -> return

; Step 3: Apply one iteration (decrement toward base)
SUB 0 0 #1          ; DR0 = DR0 - 1 (approach fixed point)

done:
; Result in DR0, return to caller
RETURN

; === FAILSAFE: No error codes ===
fault:
    FAULT           ; Uniform failure - no information leakage`,

    GT_CHURCH_SUCC: `; ====================================================
; GT_CHURCH_SUCC (Lambda): Church Numeral Successor
; λn.λf.λx. f (n f x)
; ====================================================
; Church numerals encode natural numbers as functions:
;   0 = λf.λx. x           (apply f zero times)
;   1 = λf.λx. f x         (apply f once)
;   2 = λf.λx. f (f x)     (apply f twice)
;   n = λf.λx. f^n x       (apply f n times)
;
; SUCC adds one more application of f
; ====================================================
; API: DR0 = Church numeral (encoded as iteration count)
; Return: DR0 = successor numeral (n + 1)
; ====================================================

; Step 1: Get current numeral from DR0
; DR0 contains n (the number of f-applications)

; Step 2: Successor adds one more application
ADD 0 0 #1          ; DR0 = DR0 + 1

RETURN              ; Return successor in DR0

; === FAILSAFE: No error codes ===
fault:
    FAULT           ; Uniform failure - no information leakage`,

    GT_CHURCH_PRED: `; ====================================================
; GT_CHURCH_PRED (Lambda): Church Numeral Predecessor
; λn.λf.λx. n (λg.λh. h (g f)) (λu.x) (λu.u)
; ====================================================
; Predecessor is surprisingly complex in lambda calculus.
; It uses pairs to "delay" the application by one step.
;
; The trick: Apply f (n-1) times by consuming one
; application to extract the value.
; ====================================================
; API: DR0 = Church numeral (encoded as iteration count)
; Return: DR0 = predecessor numeral (max(0, n-1))
; ====================================================

; Step 1: Get current numeral from DR0
CMP 0 #0            ; Check if n = 0
B EQ pred_zero      ; pred(0) = 0 (no negative Church numerals)

; Step 2: Predecessor subtracts one application
SUB 0 0 #1          ; DR0 = DR0 - 1
RETURN

pred_zero:
; Predecessor of zero is zero (Church numerals are natural numbers)
MOV 0 #0            ; DR0 = 0
RETURN

; === FAILSAFE: No error codes ===
fault:
    FAULT           ; Uniform failure - no information leakage`,

    GT_CHURCH_ADD: `; ====================================================
; GT_CHURCH_ADD (Lambda): Church Numeral Addition
; λm.λn.λf.λx. m f (n f x)
; ====================================================
; Addition: Apply f m times, then n times
; Total: m + n applications of f
; ====================================================
; API: DR0 = first numeral (m)
;      DR1 = second numeral (n)
; Return: DR0 = sum (m + n)
; ====================================================

; Church addition is function composition:
; (m + n) f x = m f (n f x)
; Apply n first, then m more times

ADD 0 0 1           ; DR0 = DR0 + DR1

RETURN              ; Return sum in DR0

; === FAILSAFE: No error codes ===
fault:
    FAULT           ; Uniform failure - no information leakage`,

    GT_CHURCH_MUL: `; ====================================================
; GT_CHURCH_MUL (Lambda): Church Numeral Multiplication
; λm.λn.λf. m (n f)
; ====================================================
; Multiplication: Apply (n f) m times
; Each application of (n f) applies f n times
; Total: m * n applications of f
; ====================================================
; API: DR0 = first numeral (m)
;      DR1 = second numeral (n)
; Return: DR0 = product (m * n)
; ====================================================

; Church multiplication is function composition:
; (m * n) f = m (n f)
; Compose n with itself m times

MUL 0 0 1           ; DR0 = DR0 * DR1

RETURN              ; Return product in DR0

; === FAILSAFE: No error codes ===
fault:
    FAULT           ; Uniform failure - no information leakage`,

    GT_PAIR: `; ====================================================
; GT_PAIR (Lambda): Construct a Pair
; λx.λy.λf. f x y
; ====================================================
; Pairs are the fundamental data structure in lambda
; calculus. A pair captures two values and provides
; them to a selector function.
;
; Invoked via: LAMBDA CRn, DRm (X permission)
; Pair is encoded in DR0 (first) and DR1 (second).
; FST and SND extract elements from the pair.
; ====================================================
; API: DR0 = first element
;      DR1 = second element
; Return: DR0, DR1 = pair (values preserved in-place)
; ====================================================

; Church PAIR: λx.λy.λf. f x y
; The pair captures both values — DR0 and DR1
; already hold them, so the pair is "constructed"
; by preserving the register state.

; No-op: values remain in DR0, DR1 for FST/SND
RETURN              ; Pair constructed in DR0, DR1

; === FAILSAFE: No error codes ===
fault:
    FAULT           ; Uniform failure - no information leakage`,

    GT_FST: `; ====================================================
; GT_FST (Lambda): First Element of Pair
; λp. p (λx.λy. x)
; ====================================================
; Apply the pair to a selector that chooses first.
; FST selects the first element of a pair.
;
; Invoked via: LAMBDA CRn, DRm (X permission)
; Pair is encoded in DR0 (first) and DR1 (second).
; ====================================================
; API: DR0 = first element, DR1 = second element
; Return: DR0 = first element (unchanged)
; ====================================================

; Church FST: λp. p (λx.λy. x)
; The selector returns the first argument
; DR0 already holds the first element — no-op

RETURN              ; Return first element in DR0

; === FAILSAFE: No error codes ===
fault:
    FAULT           ; Uniform failure - no information leakage`,

    GT_SND: `; ====================================================
; GT_SND (Lambda): Second Element of Pair
; λp. p (λx.λy. y)
; ====================================================
; Apply the pair to a selector that chooses second.
; SND selects the second element of a pair.
;
; Invoked via: LAMBDA CRn, DRm (X permission)
; Pair is encoded in DR0 (first) and DR1 (second).
; ====================================================
; API: DR0 = first element, DR1 = second element
; Return: DR0 = second element
; ====================================================

; Church SND: λp. p (λx.λy. y)
; The selector returns the second argument
MOV 0 1             ; DR0 = DR1 (select second element)

RETURN              ; Return second element in DR0

; === FAILSAFE: No error codes ===
fault:
    FAULT           ; Uniform failure - no information leakage`,

    GT_TRUE: `; ====================================================
; GT_TRUE (Lambda): Church Boolean TRUE
; λx.λy. x
; ====================================================
; TRUE selects the first of two options.
; Used with IF for conditional execution.
; ====================================================
; Return: DR0 = 1 (canonical true value)
; ====================================================

; Church TRUE: λx.λy. x
; When applied to (then, else), returns then

MOV 0 #1            ; DR0 = 1 (true)
RETURN

; === FAILSAFE: No error codes ===
fault:
    FAULT           ; Uniform failure - no information leakage`,

    GT_FALSE: `; ====================================================
; GT_FALSE (Lambda): Church Boolean FALSE
; λx.λy. y
; ====================================================
; FALSE selects the second of two options.
; Used with IF for conditional execution.
; ====================================================
; Return: DR0 = 0 (canonical false value)
; ====================================================

; Church FALSE: λx.λy. y
; When applied to (then, else), returns else

MOV 0 #0            ; DR0 = 0 (false)
RETURN

; === FAILSAFE: No error codes ===
fault:
    FAULT           ; Uniform failure - no information leakage`,

    GT_IF: `; ====================================================
; GT_IF (Lambda): Church Conditional
; λc.λt.λf. c t f
; ====================================================
; IF applies condition to then/else branches.
; If condition is TRUE, returns then-value.
; If condition is FALSE, returns else-value.
; ====================================================
; API: DR0 = condition (0=false, nonzero=true)
;      DR1 = then-value
;      DR2 = else-value
; Return: DR0 = selected value
; ====================================================

; Step 1: Evaluate condition
CMP 0 #0            ; Is condition false?
B EQ select_else    ; Zero = FALSE -> select else

; TRUE path: select then-value
select_then:
MOV 0 1             ; DR0 = DR1 (then-value)
RETURN

; FALSE path: select else-value
select_else:
MOV 0 2             ; DR0 = DR2 (else-value)
RETURN

; === FAILSAFE: No error codes ===
fault:
    FAULT           ; Uniform failure - no information leakage`,

    GT_MINT: `; ====================================================
; GT_MINT (Mint): Create Domain-Pure Golden Token
; The fundamental capability creation primitive
; ====================================================
; API: DR0 = permission mask (domain-pure, 6-bit)
;        TURING domain: R(0x01) W(0x02) X(0x04)
;        CHURCH domain: L(0x08) S(0x10) E(0x20)
;        RWX and LSE are MUTUALLY EXCLUSIVE (oil and water)
;      DR1 = object type
;        0 = Data, 1 = Code, 2 = C-List
;        3 = Thread, 4 = Abstraction
;      DR2 = size in words
; Return: CR0 = new Golden Token with requested perms
; ====================================================
; Security: Only callable through mLoad with E perm.
; The Mint abstraction is itself a capability —
; you need a GT with [E] to reach GT_MINT.
; This is the Golden Rule in action: no bypass.
; ====================================================

; === PARAMETER VALIDATION ===
; Step 1: Validate permission mask (0x00-0x3F)
MOV 3 #0x3F         ; Maximum valid perm mask
CMP 0 3             ; DR0 <= 0x3F?
B GT fault          ; Invalid perm mask -> FAULT
CMP 0 #0            ; DR0 > 0? (must grant something)
B EQ fault          ; Zero perms -> FAULT

; Step 2: Domain exclusivity — RWX and LSE are oil and water
; Turing domain (RWX) bits 0-2, Church domain (LSE) bits 3-5
AND 3 0 #0x07       ; DR3 = Turing bits (R,W,X)
AND 4 0 #0x38       ; DR4 = Church bits (L,S,E)
CMP 3 #0            ; Has Turing bits?
B NE .checkChurch   ; Yes — verify no Church bits
B .domainOK         ; No Turing bits, Church-only is fine
.checkChurch:
CMP 4 #0            ; Also has Church bits?
B NE fault          ; RWX + LSE mixed -> FAULT
.domainOK:

; Step 3: Validate object type (0-4)
CMP 1 #0
B MI fault          ; Negative type -> FAULT
CMP 1 #4
B GT fault          ; Type > 4 -> FAULT

; Step 3: Validate size (1-65536 words)
CMP 2 #0
B LE fault          ; Size <= 0 -> FAULT
MOV 3 #65536
CMP 2 3
B GT fault          ; Size > 65536 -> FAULT

; === NAMESPACE ALLOCATION ===
; Step 4: Find free namespace entry
; Hardware searches for unused slot (version=0, valid=0)
; Allocates 3-word descriptor:
;   W0: Location (base address)
;   W1: Limit (size - 1)
;   W2: Seals (MAC + version + type bits)

; Step 5: Compute MAC seal
; MAC = FNV-1a(location, limit, version)
; Hardware-protected — cannot be forged

; === GOLDEN TOKEN CONSTRUCTION ===
; Step 6: Build 64-bit Golden Token
;   Bits 0-31:  Namespace offset
;   Bits 32-37: Permission mask from DR0
;   Bits 38-63: Version from namespace entry

; Step 7: Store GT in CR0 for caller
; CR0 now holds the new Golden Token
; Caller owns exactly the permissions requested
RETURN              ; Return with GT in CR0

; === FAILSAFE: No error codes ===
fault:
    FAULT           ; Uniform failure - no information leakage`,

    GT_RESTRICT: `; ====================================================
; GT_RESTRICT (Mint): Derive Restricted Golden Token
; Creates a new GT with subset permissions
; ====================================================
; API: CR0 = source Golden Token (to restrict)
;      DR0 = new permission mask (must be subset)
; Return: CR0 = restricted GT (same namespace entry,
;         fewer permissions, same version)
; ====================================================
; Security: Cannot escalate — new perms must be a
; strict subset of source perms. This is monotonic
; permission attenuation (can only reduce, never add).
; ====================================================

; === VALIDATION ===
; Step 1: Verify CR0 is valid (not NULL/revoked)
; mLoad checks MAC, version, bounds automatically

; Step 2: Extract source permissions
; Read perm bits from CR0's GT encoding
; Source perms in DR1 (set by microcode)

; Step 3: Verify subset relationship
; new_perms AND source_perms must equal new_perms
; i.e., no bits in new_perms absent from source_perms
AND 2 0 1           ; DR2 = DR0 AND DR1
CMP 2 0             ; DR2 == DR0?
B NE fault          ; Not a subset -> FAULT

; Step 4: Verify non-empty result
CMP 0 #0
B EQ fault          ; Zero perms -> FAULT

; Step 5: Domain exclusivity — result must not mix RWX + LSE
AND 3 0 #0x07       ; DR3 = Turing bits (R,W,X)
AND 4 0 #0x38       ; DR4 = Church bits (L,S,E)
CMP 3 #0
B EQ .restrictOK    ; Pure Church — fine
CMP 4 #0
B NE fault          ; Mixed domains -> FAULT
.restrictOK:

; === CONSTRUCT RESTRICTED GT ===
; Step 5: Build new GT with same offset, new perms
; Same namespace entry, same version
; Only the permission field changes
; CR0 = restricted GT
RETURN              ; Return restricted GT in CR0

; === FAILSAFE: No error codes ===
fault:
    FAULT           ; Uniform failure - no information leakage`,

    GT_REVOKE: `; ====================================================
; GT_REVOKE (Mint): Revoke a Golden Token
; Bumps namespace version to invalidate all copies
; ====================================================
; API: CR0 = target Golden Token (to revoke)
; Return: DR0 = 1 (success)
; Effect: All existing copies of this GT will FAULT
;         on next mLoad because version mismatch
; ====================================================
; Security: Revocation is immediate and total.
; Every GT pointing to this namespace entry becomes
; invalid. There is no "partial revoke" — version
; bump invalidates ALL copies simultaneously.
; This is deterministic capability revocation.
; ====================================================

; === VALIDATION ===
; Step 1: Verify CR0 is valid
; mLoad checks MAC, version, bounds

; Step 2: Verify caller has authority to revoke
; Caller must hold GT with sufficient permissions
; (checked by mLoad on entry to Mint abstraction)

; === REVOCATION ===
; Step 3: Bump namespace entry version
; Increment version field in W2 (Seals word)
; All existing GTs now have stale version

; Step 4: Recompute MAC with new version
; MAC = FNV-1a(location, limit, new_version)
; Ensures integrity of updated entry

; Step 5: Invalidate CR0
; Set CR0 = NULL GT (type=10, all perms zero)
; Caller's own copy is also revoked

; Step 6: Return success
MOV 0 #1            ; DR0 = 1 (revoked)
RETURN

; === FAILSAFE: No error codes ===
fault:
    FAULT           ; Uniform failure - no information leakage`,

    GT_INSPECT: `; ====================================================
; GT_INSPECT (Mint): Read Golden Token Metadata
; Non-destructive inspection of GT fields
; ====================================================
; API: CR0 = target Golden Token (to inspect)
; Return: DR0 = permission mask (6-bit RWXLSE)
;         DR1 = object type (0-4)
;         DR2 = version number
;         DR3 = namespace offset
;         DR4 = GT type field (00=Inform, 01=Outform,
;                              10=NULL, 11=Abstract)
; ====================================================
; Security: Read-only. Does not modify the GT or
; namespace entry. Requires valid GT in CR0
; (mLoad validates on entry).
; ====================================================

; === VALIDATION ===
; Step 1: Verify CR0 is valid
; mLoad checks MAC, version, bounds
; NULL GT types cause FAULT

; === EXTRACTION ===
; Step 2: Extract permission mask
; Read bits 32-37 of 64-bit GT encoding
; DR0 = 6-bit permission mask

; Step 3: Determine object type from namespace
; Read type metadata from W2 (Seals word)
; DR1 = type code (0=Data, 1=Code, 2=C-List,
;                  3=Thread, 4=Abstraction)

; Step 4: Extract version
; Read version field from GT bits 38-63
; DR2 = version number

; Step 5: Extract namespace offset
; Read bits 0-31 of GT encoding
; DR3 = namespace table offset

; Step 6: Extract GT type field
; Read 2-bit type from GT encoding
; DR4 = type code (00/01/10/11)

RETURN              ; Return metadata in DR0-DR4

; === FAILSAFE: No error codes ===
fault:
    FAULT           ; Uniform failure - no information leakage`
};

function openFunctionInEditor(funcName, parentAbstraction) {
    let codeKey = funcName;
    if (parentAbstraction === 'Abacus' && funcName.startsWith('GT_')) {
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
            } else if (type === 'Abstraction' && abstractionCLists[name]) {
                zoomToAbstraction(name);
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

function zoomToAbstraction(absName) {
    if (!abstractionCLists[absName]) return;
    currentZoomAbstraction = absName;
    switchView('abstractionZoom');
}

function renderAbstractionZoom() {
    const summaryPanel = document.getElementById('zoomGtSummary');
    const listPanel = document.getElementById('zoomAbstractionList');
    const mainPanel = document.getElementById('zoomClistPanel');
    if (!summaryPanel || !mainPanel) return;

    if (typeof abstractionCLists === 'undefined' || !abstractionCLists) {
        summaryPanel.innerHTML = '<div class="zoom-empty">Boot the system first to view abstractions.</div>';
        if (listPanel) listPanel.innerHTML = '';
        mainPanel.innerHTML = '';
        return;
    }

    if (!currentZoomAbstraction && simulator.contextRegs[6] && simulator.contextRegs[6].name && abstractionCLists[simulator.contextRegs[6].name]) {
        currentZoomAbstraction = simulator.contextRegs[6].name;
    }

    const allAbstractions = Object.keys(abstractionCLists);
    let listHtml = '<div class="zoom-abs-header">Abstractions</div>';
    allAbstractions.forEach(name => {
        const abs = abstractionCLists[name];
        const mathBadge = mathTypeBadges[name] || 'ABS';
        const isActive = currentZoomAbstraction === name;
        const isCR6 = simulator.contextRegs[6] && simulator.contextRegs[6].name === name;
        listHtml += `<div class="zoom-abs-item ${isActive ? 'zoom-abs-active' : ''} ${isCR6 ? 'zoom-abs-cr6' : ''}" onclick="currentZoomAbstraction='${name}';renderAbstractionZoom()">`;
        listHtml += `<span class="math-type-badge math-${mathBadge.toLowerCase()}">${mathBadge}</span> ${name}`;
        if (isCR6) listHtml += ' <span class="zoom-cr6-tag">CR6</span>';
        listHtml += '</div>';
    });
    listPanel.innerHTML = listHtml;

    if (!currentZoomAbstraction || !abstractionCLists[currentZoomAbstraction]) {
        summaryPanel.innerHTML = '<div class="zoom-empty">Select an abstraction from the list to zoom in.</div>';
        mainPanel.innerHTML = '<div class="zoom-empty">No abstraction selected</div>';
        return;
    }

    const absName = currentZoomAbstraction;
    const abs = abstractionCLists[absName];
    const nsObj = namespaceObjects.find(o => o.name === absName);
    const gtEntry = getBootGT(absName);
    const mathBadge = mathTypeBadges[absName] || 'ABS';
    const isCR6Active = simulator.contextRegs[6] && simulator.contextRegs[6].name === absName;
    const permsStr = gtEntry ? gtEntry.perms.join('') : 'E';

    let summaryHtml = '<div class="zoom-gt-card">';
    summaryHtml += `<div class="zoom-gt-title"><span class="math-type-badge math-${mathBadge.toLowerCase()}">${mathBadge}</span> ${absName}`;
    if (isCR6Active) summaryHtml += ' <span class="zoom-cr6-tag">CR6 Active</span>';
    summaryHtml += '</div>';
    summaryHtml += `<div class="zoom-gt-perms">`;
    ['R','W','X','L','S','E'].forEach(p => {
        const has = permsStr.includes(p);
        summaryHtml += `<span class="perm-badge perm-${p.toLowerCase()} ${has ? '' : 'inactive'}">${p}</span>`;
    });
    summaryHtml += '</div>';
    summaryHtml += `<div class="zoom-gt-desc">${abs.description || ''}</div>`;
    if (nsObj) {
        summaryHtml += '<div class="zoom-gt-meta">';
        summaryHtml += `<span>Offset: ${nsObj.offset}</span>`;
        summaryHtml += `<span>Base: 0x${(nsObj.base || 0).toString(16).toUpperCase()}</span>`;
        summaryHtml += `<span>Size: ${nsObj.size || 0}B</span>`;
        summaryHtml += '</div>';
    }
    if (abs.methodSelector) {
        summaryHtml += '<div class="zoom-methods">';
        summaryHtml += '<div class="zoom-methods-label">DR0 Method Selector:</div>';
        const methods = Object.entries(abs.methodSelector).map(([k,v]) => `<span class="zoom-method-chip">${k}: ${v}</span>`).join('');
        summaryHtml += methods;
        summaryHtml += '</div>';
    }
    summaryHtml += '</div>';
    summaryPanel.innerHTML = summaryHtml;

    const cr6Clist = simulator.contextRegs[6] ? simulator.contextRegs[6].clist : null;
    const cr6Names = new Set();
    if (cr6Clist && isCR6Active) {
        cr6Clist.forEach(entry => { if (entry && entry.name) cr6Names.add(entry.name); });
    }

    let mainHtml = '<div class="zoom-clist-header">';
    mainHtml += `<h3>C-List Entries (${abs.clist.length} slots)</h3>`;
    mainHtml += '</div>';
    mainHtml += '<div class="zoom-clist-table">';
    mainHtml += '<div class="zoom-clist-row zoom-clist-row-header">';
    mainHtml += '<span class="zoom-col-idx">#</span>';
    mainHtml += '<span class="zoom-col-name">Name</span>';
    mainHtml += '<span class="zoom-col-type">Type</span>';
    mainHtml += '<span class="zoom-col-perms">Permissions</span>';
    mainHtml += '<span class="zoom-col-addr">Address</span>';
    mainHtml += '<span class="zoom-col-size">Size</span>';
    mainHtml += '<span class="zoom-col-desc">Description</span>';
    mainHtml += '</div>';

    abs.clist.forEach((entry, idx) => {
        const inCR6 = cr6Names.has(entry.name);
        const rowClass = inCR6 ? 'zoom-clist-row zoom-row-active' : 'zoom-clist-row';
        const typeClass = entry.type === 'NULL' ? 'zoom-type-null' : 
                          entry.type === 'Code' ? 'zoom-type-code' :
                          entry.type === 'Data' ? 'zoom-type-data' :
                          entry.type === 'Function' ? 'zoom-type-func' :
                          entry.type === 'Constant' ? 'zoom-type-const' :
                          entry.type === 'Abstract' ? 'zoom-type-abstract' : '';

        mainHtml += `<div class="${rowClass}">`;
        mainHtml += `<span class="zoom-col-idx">[${idx}]</span>`;
        mainHtml += `<span class="zoom-col-name ${typeClass}">${entry.name}${inCR6 ? ' <span class="zoom-cr6-dot"></span>' : ''}</span>`;
        mainHtml += `<span class="zoom-col-type"><span class="zoom-type-label ${typeClass}">${entry.type || '—'}</span></span>`;

        let permHtml = '';
        if (entry.perms && entry.perms.length > 0) {
            ['R','W','X','L','S','E'].forEach(p => {
                const has = entry.perms.includes(p);
                permHtml += `<span class="perm-badge perm-${p.toLowerCase()} ${has ? '' : 'inactive'}">${p}</span>`;
            });
        } else {
            permHtml = '<span style="color:#64748b;">—</span>';
        }
        mainHtml += `<span class="zoom-col-perms">${permHtml}</span>`;

        const baseStr = entry.base !== undefined ? `0x${entry.base.toString(16).toUpperCase()}` : '—';
        const sizeStr = entry.size ? `${entry.size}B` : '—';
        mainHtml += `<span class="zoom-col-addr">${baseStr}</span>`;
        mainHtml += `<span class="zoom-col-size">${sizeStr}</span>`;
        mainHtml += `<span class="zoom-col-desc">${entry.desc || ''}</span>`;
        mainHtml += '</div>';
    });

    mainHtml += '</div>';

    if (isCR6Active) {
        mainHtml += '<div class="zoom-cr6-legend"><span class="zoom-cr6-dot"></span> Currently loaded in CR6</div>';
    }

    mainPanel.innerHTML = mainHtml;
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
TPERM 0 S         ; Verify has Save permission
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
; Usage example (method-selector dispatch):
; LOAD 0 6 4      ; Load Circle [E] from Boot C-List
; CALL 0          ; Enter Circle scope
; ADDI 0 2        ; DR0 = 2 (CIRCUMFERENCE method)
; ADDI 1 5        ; DR1 = radius = 5
; CALL 1          ; Access dispatcher: circumference(5)
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
; This demonstrates non-termination in lambda calc`,

    'hello_mum': `; ================================================
; HELLO MUM / HELLO SON — Bidirectional Tunnel
; ================================================
; Kenneth's machine (CM Sim-64) — "me"
;
; PART 1: Send "Hello Mum" → mymother (Priscilla)
;   CALL(CONNECT(me, mymother)) — one Church instruction
;   THREE Golden Tokens: tunnel key, service, ABI
;
; PART 2: Receive "Hello Son" ← mymother (Priscilla)
;   Priscilla's reply arrives via reverse tunnel
;   Son_Inbox [R,W] stores the incoming message
;
; SEVEN zeroes both directions: no OS, no VM,
;   no privilege, no superuser, no unauthorized code,
;   no unauthorized data, no containment escape
;
; C-List layout (CR6):
;   [0] Tunnel_Key_Mum  [R]   — Inform (crypto key)
;   [1] Mum_Messaging   [E]   — Outform (remote)
;   [2] ABI_Mum         [R]   — Inform (register map)
;   [3] Son_Inbox       [R,W] — Inform (reply buffer)
;   [4] Son_Receive     [E]   — Inform (reply handler)
; ================================================

; ────────────────────────────────────────────
; PART 1: SEND "Hello Mum" to Priscilla
; ────────────────────────────────────────────

; === Load tunnel key ===
LOAD 0 6 0        ; CR0 = Tunnel_Key_Mum from C-List
TPERM 0 R         ; Verify R permission
B NE fault        ; FAULT if missing

; === Load service GT ===
LOAD 1 6 1        ; CR1 = Mum_Messaging (Outform)
TPERM 1 E         ; Verify E permission
B NE fault        ; FAULT if missing

; === Prepare "Hello Mum" in data registers ===
ADDI 0 72         ; DR0 = 'H' (72)
ADDI 1 101        ; DR1 = 'e' (101)
ADDI 2 108        ; DR2 = 'l' (108)
ADDI 3 108        ; DR3 = 'l' (108)
ADDI 4 111        ; DR4 = 'o' (111)
ADDI 5 77         ; DR5 = 'M' (77)

; === THE Church instruction — forward ===
; CALL(CONNECT(me, mymother))
CALL 1            ; ONE instruction. Hello Mum sent.

; ────────────────────────────────────────────
; PART 2: RECEIVE "Hello Son" from Priscilla
; ────────────────────────────────────────────

; === Load Son_Inbox to read reply ===
LOAD 2 6 3        ; CR2 = Son_Inbox [R,W]
TPERM 2 R         ; Verify R permission
B NE fault        ; FAULT if missing

; === Simulate received "Hello Son" payload ===
; In hardware: reverse tunnel decrypts + ABI maps
; x10-x15 (32-bit) → DR0-DR5 (64-bit)
ADDI 0 72         ; DR0 = 'H' (72)
ADDI 1 101        ; DR1 = 'e' (101)
ADDI 2 108        ; DR2 = 'l' (108)
ADDI 3 108        ; DR3 = 'l' (108)
ADDI 4 111        ; DR4 = 'o' (111)
ADDI 5 83         ; DR5 = 'S' (83)

; === Bidirectional tunnel complete ===
; DR0-DR5 now holds "HelloS" from Priscilla
; Both sides validated by mLoad. No OS. No privilege.
HALT

; === FAILSAFE ===
fault:
FAULT`,

    'capmgr': `; ================================================
; CAPABILITY MANAGER DEMO
; Creates Data and C-List objects using CapabilityManager
; API: DR0=type (0=Data, 1=C-List), DR1=size in words
; Returns: CR0=new GT with [RWXB] or [LSEB]
; ================================================
; Boot C-List Layout:
;   [7] = CapabilityManager [E]

; ------------------------------------------------
; PART 1: Create a Data Buffer
; ------------------------------------------------
    MOV DR0, #0          ; Type 0 = Data object
    MOV DR1, #64         ; Size = 64 words
    LOAD 1 7 CR1         ; CR1 = CapabilityManager [E]
    TPERM CR1, E         ; Verify Enter permission
    BNE fault            ; No E -> FAULT
    CALL 1 0             ; Create object
    ; CR0 now holds new GT with [R,W,X,B]
    
    ; Store the new capability for later use
    MOV CR2, CR0         ; CR2 = our new data buffer GT

; ------------------------------------------------
; PART 2: Create a C-List
; ------------------------------------------------
    MOV DR0, #1          ; Type 1 = C-List object
    MOV DR1, #8          ; Size = 8 entries
    LOAD 1 7 CR1         ; CR1 = CapabilityManager [E]
    CALL 1 0             ; Create C-List
    ; CR0 now holds new GT with [L,S,E,B]
    
    ; Save our data buffer GT to the new C-List
    MOV CR3, CR0         ; CR3 = our new C-List GT
    TPERM CR3, S         ; Verify Save permission
    BNE fault            ; No S -> FAULT
    SAVE 2 3 0           ; Save CR2 (data buffer) to index 0 of CR3 (C-List)
    
    ; Success! DR0 indicates how many objects created
    MOV DR0, #2          ; Created 2 objects
    RETURN

; === FAILSAFE: No error codes ===
fault:
    FAULT                ; Uniform failure - no information leakage`,

    'datetime': `; ================================================
; DATETIME DEMO
; Demonstrates the DateTime abstraction
; API: DR0=mode (0=ISO, 1=Date, 2=Time, 3=Epoch, 4=Components)
; Returns: DR1-DR6 for components, or CR0 for string GT
; ================================================
; Boot C-List Layout:
;   [8] = DateTime [E,B]

; ------------------------------------------------
; PART 1: Get Unix Epoch (Mode 3)
; ------------------------------------------------
    MOV DR0, #3          ; Mode 3 = Unix epoch seconds
    LOAD 1 8 CR1         ; CR1 = DateTime [E,B]
    TPERM CR1, E         ; Verify Enter permission
    BNE fault            ; No E -> FAULT
    CALL 1 0             ; Get epoch time
    ; DR1 now contains Unix epoch seconds
    
    ; Save epoch to DR7 for later comparison
    MOV DR7, DR1         ; DR7 = epoch seconds

; ------------------------------------------------
; PART 2: Get Date/Time Components (Mode 4)
; ------------------------------------------------
    MOV DR0, #4          ; Mode 4 = Components
    LOAD 1 8 CR1         ; CR1 = DateTime [E,B]
    CALL 1 0             ; Get components
    ; DR1 = Year (e.g., 2026)
    ; DR2 = Month (1-12)
    ; DR3 = Day (1-31)
    ; DR4 = Hour (0-23)
    ; DR5 = Minute (0-59)
    ; DR6 = Second (0-59)
    
    ; Example: Check if it's afternoon
    CMP DR4, #12         ; Compare hour with 12
    BLT morning          ; If < 12, it's morning
    
afternoon:
    MOV DR0, #1          ; Afternoon indicator
    B done
    
morning:
    MOV DR0, #0          ; Morning indicator
    
done:
    RETURN               ; Return with time info in registers

; === FAILSAFE: No error codes ===
fault:
    FAULT                ; Uniform failure - no information leakage`,

    'hp35_lambda': `; ================================================
; HP-35 SCIENTIFIC CALCULATOR — PURE LAMBDA
; ================================================
; The world's first handheld scientific calculator
; (Hewlett-Packard, 1972) rebuilt using ONLY Church
; domain instructions: LOAD, SAVE, CALL, LAMBDA,
; TPERM, RETURN. Zero binary/Turing instructions.
;
; All arithmetic via Church numerals.
; Stack via nested pairs (PAIR, FST, SND).
; Constants via Abstract GTs (PI, E from Constants).
; Recursion via Y-combinator.
;
; CHURCH DOMAIN ONLY: L, S, E permissions
; No ADD, SUB, MUL, MOV, CMP, B — none needed.
;
; ================================================
; HP35 C-List layout (CR6 = nodal C-List):
;   [0]  NULL
;   [1]  Access         [R,X] — this dispatcher
;   [2]  GT_DIGIT       [R,X] — digit entry
;   [3]  GT_ENTER       [R,X] — push X, lift stack
;   [4]  GT_ADD         [R,X] — Church ADD
;   [5]  GT_SUB         [R,X] — Church SUB
;   [6]  GT_MUL         [R,X] — Church MUL
;   [7]  GT_DIV         [R,X] — Church DIV
;   [8]  GT_SQRT        [R,X] — Newton via Y-comb
;   [9]  GT_SIN         [R,X] — Taylor series
;   [10] GT_COS         [R,X] — Taylor series
;   [11] GT_LOG         [R,X] — Y-comb refinement
;   [12] GT_EXP         [R,X] — Taylor POW chain
;   [13] GT_POW         [R,X] — Church POW
;   [14] GT_CHS         [R,X] — negate sign
;   [15] GT_CLR         [R,X] — clear all
;   [16] GT_CLX         [R,X] — clear X only
;   [17] GT_SWAP        [R,X] — swap X, Y
;   [18] GT_PI          [R,X] — push PI
;   [19] DisplayBuffer  [R,W] — 15-digit LED
;   [20] StackData      [R,W] — X, Y, Z, T pairs
;
; CR5 = Thread C-List:
;   [0]  Lambda         [E]   — Church numeral engine
;   [1]  Stack          [E]   — RPN pair operations
;   [2]  Constants      [E]   — Abstract GT vault
;
; DR0 = method selector (key pressed)
; ================================================

; ------------------------------------------------
; ACCESS DISPATCHER (slot [1])
; Input:  DR0 = method selector (0-18)
;         DR1 = argument (digit value, etc.)
; Output: DR0 = result or display update
;
; Pure Church dispatch: encode DR0 as Church
; numeral, index into C-List, LAMBDA the GT.
; ------------------------------------------------
access:
; Load the method GT from our own C-List
; DR0 holds method index (0=DIGIT..18=ARC)
; Offset by 2 because slots 0,1 are NULL/Access
; So method 0 (DIGIT) -> C-List slot [2], etc.
LOAD 0 6 0        ; CR0 = NULL (clear workspace)

; Step 1: Enter Lambda abstraction for Church encoding
LOAD 1 5 0        ; CR1 = Lambda [E] from Thread C-List
TPERM 1 E         ; Verify Enter permission
CALL 1            ; Enter Lambda scope — CR6 = Lambda C-List

; Step 2: Load Church SUCC and ZERO
LOAD 0 6 3        ; CR0 = GT_CHURCH_SUCC [R,X]
LOAD 1 6 2        ; CR1 = GT_CHURCH_ZERO [R,X]

; Step 3: Build Church numeral for method selector
; Apply SUCC (DR0) times to ZERO — result is Church(DR0)
; This uses LAMBDA with X permission (non-nestable)
LAMBDA 0 0        ; Church(DR0) = SUCC^DR0(ZERO)

; Step 4: Return to HP35 scope
RETURN            ; Back to HP35 C-List in CR6

; Step 5: Use Church numeral to index C-List
; Church(n) applied to LOAD gives us slot [n+2]
LOAD 0 6 0        ; CR0 = method GT from indexed slot
TPERM 0 X         ; Verify eXecute permission
LAMBDA 0 0        ; Apply the method function
RETURN            ; Result in DR0

; ------------------------------------------------
; GT_DIGIT (slot [2]): Append digit to X register
; λd. X = X * 10 + d
;
; Pure Church: MUL(X, TEN) then ADD(X, d)
; where TEN = SUCC^10(ZERO)
; ------------------------------------------------
digit:
; Enter Lambda to get Church arithmetic
LOAD 1 5 0        ; CR1 = Lambda [E]
TPERM 1 E         ; Verify
CALL 1            ; Enter Lambda scope

; Load Church MUL and ADD
LOAD 0 6 6        ; CR0 = GT_CHURCH_MUL [R,X]
LOAD 1 6 5        ; CR1 = GT_CHURCH_ADD [R,X]

; X = X * 10: multiply current value by Church(10)
LAMBDA 0 0        ; DR0 = CHURCH_MUL(X, TEN)

; X = X + d: add the digit
LAMBDA 1 0        ; DR0 = CHURCH_ADD(X*10, d)

RETURN            ; Back to HP35 scope

; Update display buffer
LOAD 0 6 19       ; CR0 = DisplayBuffer [R,W]
TPERM 0 S         ; Verify Save permission
SAVE 0 0          ; Write display value
RETURN

; ------------------------------------------------
; GT_ENTER (slot [3]): Push X onto stack, lift
; λstack. PAIR(X, stack)
;
; Pure Church: PAIR = λa.λb.λf. f a b
; Stack lift: T=Z, Z=Y, Y=X, X=X (duplicate)
; ------------------------------------------------
enter:
; Enter Stack abstraction for PAIR
LOAD 1 5 1        ; CR1 = Stack [E]
TPERM 1 E         ; Verify
CALL 1            ; Enter Stack scope

; Load PUSH operation from Stack C-List
LOAD 0 6 2        ; CR0 = GT_PUSH [R,X]

; Apply PUSH: creates PAIR(X, rest_of_stack)
LAMBDA 0 0        ; DR0 = PAIR(X, stack)

RETURN            ; Back to HP35 scope

; Save new stack state
LOAD 0 6 20       ; CR0 = StackData [R,W]
TPERM 0 S         ; Verify Save permission
SAVE 0 0          ; Persist stack
RETURN

; ------------------------------------------------
; GT_ADD (slot [4]): Pop Y, add to X
; λx.λy. CHURCH_ADD x y
;
; Pure Church: ADD = λm.λn.λf.λx. m f (n f x)
; Apply f m times, then n more times
; ------------------------------------------------
add:
; Load stack: pop Y into DR1, X in DR0
LOAD 1 5 1        ; CR1 = Stack [E]
TPERM 1 E         ; Verify
CALL 1            ; Enter Stack

LOAD 0 6 3        ; CR0 = GT_POP [R,X]
LAMBDA 0 0        ; DR1 = POP (Y value)
RETURN            ; Back to HP35

; Enter Lambda for Church ADD
LOAD 1 5 0        ; CR1 = Lambda [E]
TPERM 1 E         ; Verify
CALL 1            ; Enter Lambda

LOAD 0 6 5        ; CR0 = GT_CHURCH_ADD [R,X]
LAMBDA 0 0        ; DR0 = ADD(Y, X)
RETURN            ; Result in DR0

; ------------------------------------------------
; GT_SUB (slot [5]): Pop Y, subtract
; λx.λy. CHURCH_SUB y x
;
; Church SUB uses PRED:
; PRED = λn.λf.λx. n(λg.λh.h(g f))(λu.x)(λu.u)
; SUB = λm.λn. n PRED m
; ------------------------------------------------
sub:
LOAD 1 5 1        ; CR1 = Stack [E]
TPERM 1 E         ; Verify
CALL 1            ; Enter Stack

LOAD 0 6 3        ; CR0 = GT_POP [R,X]
LAMBDA 0 0        ; DR1 = POP (Y value)
RETURN            ; Back to HP35

LOAD 1 5 0        ; CR1 = Lambda [E]
TPERM 1 E         ; Verify
CALL 1            ; Enter Lambda

LOAD 0 6 8        ; CR0 = GT_CHURCH_SUB [R,X]
LAMBDA 0 0        ; DR0 = SUB(Y, X)
RETURN

; ------------------------------------------------
; GT_MUL (slot [6]): Pop Y, multiply
; λx.λy. CHURCH_MUL x y
;
; MUL = λm.λn.λf. m(n f)
; Apply n f, then apply that m times
; ------------------------------------------------
mul:
LOAD 1 5 1        ; CR1 = Stack [E]
TPERM 1 E         ; Verify
CALL 1            ; Enter Stack

LOAD 0 6 3        ; CR0 = GT_POP [R,X]
LAMBDA 0 0        ; DR1 = POP (Y value)
RETURN            ; Back to HP35

LOAD 1 5 0        ; CR1 = Lambda [E]
TPERM 1 E         ; Verify
CALL 1            ; Enter Lambda

LOAD 0 6 6        ; CR0 = GT_CHURCH_MUL [R,X]
LAMBDA 0 0        ; DR0 = MUL(Y, X)
RETURN

; ------------------------------------------------
; GT_DIV (slot [7]): Pop Y, divide
; λx.λy. CHURCH_DIV y x
;
; Church DIV via repeated subtraction:
; DIV = Y(λf.λn.λm. IF(LEQ m n)(SUCC(f(SUB n m) m)) ZERO)
; Requires Y-combinator for recursion
; ------------------------------------------------
div:
LOAD 1 5 1        ; CR1 = Stack [E]
TPERM 1 E         ; Verify
CALL 1            ; Enter Stack

LOAD 0 6 3        ; CR0 = GT_POP [R,X]
LAMBDA 0 0        ; DR1 = POP (Y value)
RETURN            ; Back to HP35

LOAD 1 5 0        ; CR1 = Lambda [E]
TPERM 1 E         ; Verify
CALL 1            ; Enter Lambda

; Church DIV needs Y-combinator for recursion
LOAD 0 6 9        ; CR0 = GT_CHURCH_DIV [R,X]
LAMBDA 0 0        ; DR0 = Y(λf... DIV(Y,X))
RETURN

; ------------------------------------------------
; GT_SQRT (slot [8]): Square root of X
; λx. Newton's method via Y-combinator
;
; SQRT = Y(λf.λg. IF(LEQ(MUL g g) x)
;                     (f (SUCC g))
;                     (PRED g)) ZERO
; ------------------------------------------------
sqrt:
LOAD 1 5 0        ; CR1 = Lambda [E]
TPERM 1 E         ; Verify
CALL 1            ; Enter Lambda

; Y-combinator drives Newton iteration
; Each step: guess -> if guess^2 <= x, try guess+1
;            else return guess-1
LOAD 0 6 10       ; CR0 = GT_CHURCH_SQRT [R,X]
LAMBDA 0 0        ; DR0 = Y(Newton)(X)
RETURN

; ------------------------------------------------
; GT_SIN (slot [9]): Sine via Taylor series
; λx. x - x^3/3! + x^5/5! - x^7/7! + ...
;
; Each term: Church POW for x^n, Church factorial
; for n!, Church DIV for division, alternating
; Church SUB/ADD for sign.
; All encoded as nested LAMBDA applications.
; ------------------------------------------------
sin:
LOAD 1 5 0        ; CR1 = Lambda [E]
TPERM 1 E         ; Verify
CALL 1            ; Enter Lambda

LOAD 0 6 11       ; CR0 = GT_TAYLOR_SIN [R,X]
LAMBDA 0 0        ; DR0 = SIN_TAYLOR(X)
RETURN

; ------------------------------------------------
; GT_COS (slot [10]): Cosine via Taylor series
; λx. 1 - x^2/2! + x^4/4! - x^6/6! + ...
; ------------------------------------------------
cos:
LOAD 1 5 0        ; CR1 = Lambda [E]
TPERM 1 E         ; Verify
CALL 1            ; Enter Lambda

LOAD 0 6 12       ; CR0 = GT_TAYLOR_COS [R,X]
LAMBDA 0 0        ; DR0 = COS_TAYLOR(X)
RETURN

; ------------------------------------------------
; GT_LOG (slot [11]): Natural log via Y-combinator
; λx. Y(λf.λx. iterative refinement) x
; ------------------------------------------------
log:
LOAD 1 5 0        ; CR1 = Lambda [E]
TPERM 1 E         ; Verify
CALL 1            ; Enter Lambda

LOAD 0 6 13       ; CR0 = GT_CHURCH_LN [R,X]
LAMBDA 0 0        ; DR0 = LN(X)
RETURN

; ------------------------------------------------
; GT_EXP (slot [12]): e^x via Taylor series
; λx. 1 + x + x^2/2! + x^3/3! + ...
;
; CHURCH_POW builds each x^n term
; Church factorial computes n!
; Bounded by fixed number of terms
; ------------------------------------------------
exp:
LOAD 1 5 0        ; CR1 = Lambda [E]
TPERM 1 E         ; Verify
CALL 1            ; Enter Lambda

LOAD 0 6 14       ; CR0 = GT_TAYLOR_EXP [R,X]
LAMBDA 0 0        ; DR0 = EXP_TAYLOR(X)
RETURN

; ------------------------------------------------
; GT_POW (slot [13]): Y raised to X power
; λx.λy. CHURCH_POW x y
;
; POW = λm.λn. n m
; Apply m n times: m(m(m(...))) n times
; ------------------------------------------------
pow:
LOAD 1 5 1        ; CR1 = Stack [E]
TPERM 1 E         ; Verify
CALL 1            ; Enter Stack

LOAD 0 6 3        ; CR0 = GT_POP [R,X]
LAMBDA 0 0        ; DR1 = POP (Y value)
RETURN            ; Back to HP35

LOAD 1 5 0        ; CR1 = Lambda [E]
TPERM 1 E         ; Verify
CALL 1            ; Enter Lambda

LOAD 0 6 7        ; CR0 = GT_CHURCH_POW [R,X]
LAMBDA 0 0        ; DR0 = POW(Y, X)
RETURN

; ------------------------------------------------
; GT_CHS (slot [14]): Negate sign of X
; λx. PAIR(NOT(FST sign), SND magnitude)
;
; Church encoding: number = PAIR(sign, magnitude)
; NOT = λb. b FALSE TRUE
; ------------------------------------------------
chs:
LOAD 1 5 0        ; CR1 = Lambda [E]
TPERM 1 E         ; Verify
CALL 1            ; Enter Lambda

; Church NOT on the sign component
LOAD 0 6 15       ; CR0 = GT_CHURCH_NEG [R,X]
LAMBDA 0 0        ; DR0 = PAIR(NOT sign, magnitude)
RETURN

; ------------------------------------------------
; GT_CLR (slot [15]): Clear entire stack
; λstack. FALSE
;
; Church FALSE = λx.λy.y (empty stack)
; All four registers become ZERO
; ------------------------------------------------
clr:
LOAD 1 5 0        ; CR1 = Lambda [E]
TPERM 1 E         ; Verify
CALL 1            ; Enter Lambda

LOAD 0 6 2        ; CR0 = GT_CHURCH_ZERO [R,X]
LAMBDA 0 0        ; DR0 = ZERO (clear X)
RETURN

; Clear stack storage
LOAD 0 6 20       ; CR0 = StackData [R,W]
TPERM 0 S         ; Verify Save
SAVE 0 0          ; Write empty stack
RETURN

; ------------------------------------------------
; GT_CLX (slot [16]): Clear X register only
; λstack. PAIR(ZERO, SND stack)
;
; Keep Y,Z,T intact, set X = 0
; FST/SND via Church pair selectors
; ------------------------------------------------
clx:
LOAD 1 5 1        ; CR1 = Stack [E]
TPERM 1 E         ; Verify
CALL 1            ; Enter Stack

; Get rest of stack (SND)
LOAD 0 6 5        ; CR0 = GT_SND [R,X]
LAMBDA 0 0        ; DR1 = SND(stack) = (Y,Z,T)
RETURN

; Re-pair with ZERO as new X
LOAD 1 5 0        ; CR1 = Lambda [E]
TPERM 1 E         ; Verify
CALL 1            ; Enter Lambda

LOAD 0 6 2        ; CR0 = GT_CHURCH_ZERO [R,X]
LAMBDA 0 0        ; DR0 = ZERO

RETURN
LOAD 1 5 1        ; CR1 = Stack [E]
CALL 1            ; Enter Stack

LOAD 0 6 2        ; CR0 = GT_PUSH [R,X]
LAMBDA 0 0        ; DR0 = PAIR(ZERO, rest)
RETURN

; ------------------------------------------------
; GT_SWAP (slot [17]): Swap X and Y
; λstack. PAIR(FST(SND s), PAIR(FST s, SND(SND s)))
;
; Destructure top two, rebuild in swapped order
; All via Church pair selectors
; ------------------------------------------------
swap:
LOAD 1 5 1        ; CR1 = Stack [E]
TPERM 1 E         ; Verify
CALL 1            ; Enter Stack

LOAD 0 6 6        ; CR0 = GT_SWAP_XY [R,X]
LAMBDA 0 0        ; DR0 = swapped stack
RETURN

; ------------------------------------------------
; GT_PI (slot [18]): Push PI onto stack
; λ. PUSH(Constants.PI, stack)
;
; PI is an Abstract GT in the Constants abstraction
; Present the Abstract GT, receive value via CALL.
; The constant never exists as bare data.
; ------------------------------------------------
push_pi:
; Lift stack first
LOAD 1 5 1        ; CR1 = Stack [E]
TPERM 1 E         ; Verify
CALL 1            ; Enter Stack

LOAD 0 6 2        ; CR0 = GT_PUSH [R,X]
LAMBDA 0 0        ; Stack lifted
RETURN

; Get PI from Constants abstraction
LOAD 1 5 2        ; CR1 = Constants [E]
TPERM 1 E         ; Verify Enter permission
CALL 1            ; Enter Constants scope

; Present Abstract GT for PI
LOAD 0 6 2        ; CR0 = GT_PI (Abstract GT)
CALL 0            ; Constants validates and returns value
RETURN            ; DR0 = 3.14159265358979...

; Save to stack X register
LOAD 0 6 20       ; CR0 = StackData [R,W]
TPERM 0 S         ; Verify Save
SAVE 0 0          ; Write PI as new X
RETURN

; ================================================
; INSTRUCTION COUNT: Zero Turing instructions.
;
; Used ONLY: LOAD, SAVE, CALL, LAMBDA, TPERM, RETURN
;
; No ADD, SUB, MUL, MOV, CMP, B, ADDI, SUBI,
; LSL, LSR, AND, ORR, EOR, BIC — none needed.
;
; Every computation is a capability-mediated
; lambda application. The HP-35 proves that a
; complete scientific calculator can be built
; from pure Church lambda calculus on CM,
; secured by Golden Tokens at every step.
;
; Dependencies (all entered via CALL with E perm):
;   Lambda    — Church numerals, SUCC, ADD, MUL...
;   Stack     — PAIR-based RPN: PUSH, POP, SWAP
;   Constants — Abstract GTs: PI, E, PHI, SQRT2...
; ================================================`,

    'sliderule_lambda': `; ================================================
; SLIDERULE — Pure Lambda Calculus Arithmetic
; ================================================
;
; The SlideRule abstraction provides 9 arithmetic
; operations using ONLY Church domain instructions:
; LOAD, SAVE, CALL, LAMBDA, TPERM, RETURN.
; Zero binary/Turing instructions.
;
; Method-selector dispatch: DR0 selects operation.
; Arguments in DR1 (a), DR2 (b) for binary ops.
; Result returned in DR0.
;
; CHURCH DOMAIN ONLY: L, S, E permissions
; No ADD, SUB, MUL, MOV, CMP, B — none needed.
;
; ================================================
; SlideRule C-List layout (CR6 = nodal C-List):
;   [0]  NULL
;   [1]  Access          [R,X] — this dispatcher
;   [2]  GT_FP_ADD       [R,X] — Church ADD
;   [3]  GT_FP_SUB       [R,X] — Church SUB
;   [4]  GT_FP_MUL       [R,X] — Church MUL
;   [5]  GT_FP_DIV       [R,X] — Church DIV (Y-comb)
;   [6]  GT_FP_MOD       [R,X] — Church MOD (Y-comb)
;   [7]  GT_FP_LOG       [R,X] — Church LN (Y-comb)
;   [8]  GT_FP_EXP       [R,X] — Church EXP (Taylor)
;   [9]  GT_FP_SQRT      [R,X] — Church SQRT (Newton)
;   [10] GT_FP_POW       [R,X] — Church POW
;   [11] LocalData       [R,W] — scratch workspace
;
; CR5 = Thread C-List:
;   [0]  Lambda          [E]   — Church numeral engine
;
; Lambda C-List layout (CR6 after CALL Lambda):
;   [0]  NULL
;   [1]  Access          [R,X]
;   [2]  GT_Y_COMBINATOR [R,X] — Y f = f(Y f)
;   [3]  GT_CHURCH_SUCC  [R,X] — λn.λf.λx. f(n f x)
;   [4]  GT_CHURCH_PRED  [R,X] — predecessor
;   [5]  GT_CHURCH_ADD   [R,X] — λm.λn.λf.λx. m f(n f x)
;   [6]  GT_CHURCH_MUL   [R,X] — λm.λn.λf. m(n f)
;   [7]  GT_PAIR         [R,X]
;   [8]  GT_FST          [R,X]
;   [9]  GT_SND          [R,X]
;   [10] GT_TRUE         [R,X]
;   [11] GT_FALSE        [R,X] — also CHURCH ZERO
;   [12] GT_IF           [R,X] — λc.λt.λf. c t f
;   [13] GT_CHURCH_SUB   [R,X] — λm.λn. n PRED m
;   [14] GT_CHURCH_DIV   [R,X] — Y(λf... repeated SUB)
;   [15] GT_CHURCH_POW   [R,X] — λb.λe. e(MUL b) 1
;   [16] GT_CHURCH_ISZERO [R,X]
;   [17] GT_CHURCH_LEQ   [R,X] — ISZERO(SUB m n)
;
; DR0 = method selector (0=ADD..8=POW)
; DR1 = operand a
; DR2 = operand b (binary ops)
; ================================================

; ------------------------------------------------
; ACCESS DISPATCHER (slot [1])
; Input:  DR0 = method selector (0-8)
;         DR1 = a, DR2 = b
; Output: DR0 = result
;
; Pure Church dispatch: encode DR0 as Church
; numeral, index into C-List, LAMBDA the GT.
; ------------------------------------------------
access:
LOAD 0 6 0        ; CR0 = NULL (clear workspace)

; Step 1: Enter Lambda for Church encoding
LOAD 1 5 0        ; CR1 = Lambda [E] from Thread C-List
TPERM 1 E         ; Verify Enter permission
CALL 1            ; Enter Lambda scope — CR6 = Lambda C-List

; Step 2: Load Church SUCC and FALSE (=ZERO)
LOAD 0 6 3        ; CR0 = GT_CHURCH_SUCC [R,X] (slot 3)
LOAD 1 6 11       ; CR1 = GT_FALSE [R,X] (slot 11 = ZERO)

; Step 3: Build Church numeral for method selector
; Apply SUCC (DR0) times to ZERO
LAMBDA 0 0        ; Church(DR0) = SUCC^DR0(ZERO)

; Step 4: Return to SlideRule scope
RETURN            ; Back to SlideRule C-List in CR6

; Step 5: Use Church numeral to index C-List
; Method 0 (ADD) -> slot [2], method 1 (SUB) -> slot [3], etc.
LOAD 0 6 0        ; CR0 = method GT from indexed slot
TPERM 0 X         ; Verify eXecute permission
LAMBDA 0 0        ; Apply the method function
RETURN            ; Result in DR0

; ------------------------------------------------
; GT_FP_ADD (slot [2]): a + b
; λa.λb. CHURCH_ADD a b
;
; Church ADD = λm.λn.λf.λx. m f (n f x)
; Apply f m times, then n more times
;
; Input:  DR1 = a, DR2 = b
; Output: DR0 = a + b
; ------------------------------------------------
fp_add:
LOAD 1 5 0        ; CR1 = Lambda [E]
TPERM 1 E         ; Verify
CALL 1            ; Enter Lambda scope

LOAD 0 6 5        ; CR0 = GT_CHURCH_ADD [R,X] (slot 5)
LAMBDA 0 0        ; DR0 = CHURCH_ADD(DR1, DR2)
RETURN

; ------------------------------------------------
; GT_FP_SUB (slot [3]): a - b
; λa.λb. CHURCH_SUB a b
;
; Church SUB uses PRED:
; PRED = λn.λf.λx. n(λg.λh.h(g f))(λu.x)(λu.u)
; SUB = λm.λn. n PRED m
;
; Input:  DR1 = a, DR2 = b
; Output: DR0 = a - b
; ------------------------------------------------
fp_sub:
LOAD 1 5 0        ; CR1 = Lambda [E]
TPERM 1 E         ; Verify
CALL 1            ; Enter Lambda scope

LOAD 0 6 13       ; CR0 = GT_CHURCH_SUB [R,X] (slot 13)
LAMBDA 0 0        ; DR0 = CHURCH_SUB(DR1, DR2)
RETURN

; ------------------------------------------------
; GT_FP_MUL (slot [4]): a * b
; λa.λb. CHURCH_MUL a b
;
; Church MUL = λm.λn.λf. m(n f)
; Apply (n f) m times
;
; Input:  DR1 = a, DR2 = b
; Output: DR0 = a * b
; ------------------------------------------------
fp_mul:
LOAD 1 5 0        ; CR1 = Lambda [E]
TPERM 1 E         ; Verify
CALL 1            ; Enter Lambda scope

LOAD 0 6 6        ; CR0 = GT_CHURCH_MUL [R,X] (slot 6)
LAMBDA 0 0        ; DR0 = CHURCH_MUL(DR1, DR2)
RETURN

; ------------------------------------------------
; GT_FP_DIV (slot [5]): a / b
; λa.λb. CHURCH_DIV a b
;
; Church DIV via repeated subtraction with Y-comb:
; DIV = Y(λf.λn.λm. IF(LEQ m n)(SUCC(f(SUB n m) m)) ZERO)
;
; Input:  DR1 = a, DR2 = b
; Output: DR0 = a / b (integer division)
; ------------------------------------------------
fp_div:
LOAD 1 5 0        ; CR1 = Lambda [E]
TPERM 1 E         ; Verify
CALL 1            ; Enter Lambda scope

LOAD 0 6 14       ; CR0 = GT_CHURCH_DIV [R,X] (slot 14)
LAMBDA 0 0        ; DR0 = CHURCH_DIV(DR1, DR2)
RETURN

; ------------------------------------------------
; GT_FP_MOD (slot [6]): a mod b
; λa.λb. SUB a (MUL b (DIV a b))
;
; MOD computed as: a - b * floor(a/b)
; Composes DIV, MUL, SUB — all Church primitives
;
; Input:  DR1 = a, DR2 = b
; Output: DR0 = a mod b
; ------------------------------------------------
fp_mod:
LOAD 1 5 0        ; CR1 = Lambda [E]
TPERM 1 E         ; Verify
CALL 1            ; Enter Lambda scope

; Step 1: quotient = DIV(a, b)
LOAD 0 6 14       ; CR0 = GT_CHURCH_DIV [R,X] (slot 14)
LAMBDA 0 0        ; DR0 = DIV(DR1, DR2) = quotient

; Step 2: product = MUL(quotient, b)
LOAD 0 6 6        ; CR0 = GT_CHURCH_MUL [R,X] (slot 6)
LAMBDA 0 0        ; DR0 = MUL(quotient, DR2) = product

; Step 3: remainder = SUB(a, product)
LOAD 0 6 13       ; CR0 = GT_CHURCH_SUB [R,X] (slot 13)
LAMBDA 0 0        ; DR0 = SUB(DR1, product) = a mod b
RETURN

; ------------------------------------------------
; GT_FP_LOG (slot [7]): ln(a)
; λa. Y-combinator iterative log
;
; Counts how many times a can be divided by e:
; LOG = Y(λf.λx.λn. IF(LEQ x 1) n (f(DIV x e)(SUCC n))) a 0
; Y-combinator provides recursion, LEQ provides
; termination, DIV reduces the argument each step.
;
; Input:  DR1 = a
; Output: DR0 = ln(a) (Church numeral approximation)
; ------------------------------------------------
fp_log:
LOAD 1 5 0        ; CR1 = Lambda [E]
TPERM 1 E         ; Verify
CALL 1            ; Enter Lambda scope

; Build the recursive log function from primitives
; Y-combinator: slot 2
; DIV: slot 14 (divide by e each iteration)
; LEQ: slot 17 (termination: x <= 1?)
; SUCC: slot 3 (increment counter)

LOAD 0 6 2        ; CR0 = GT_Y_COMBINATOR [R,X] (slot 2)
LOAD 1 6 14       ; CR1 = GT_CHURCH_DIV [R,X] (slot 14)
LAMBDA 0 0        ; Y(λf... step function)
LAMBDA 1 0        ; Feed DIV for x/e reduction

LOAD 0 6 17       ; CR0 = GT_CHURCH_LEQ [R,X] (slot 17)
LAMBDA 0 0        ; Termination: IF(x <= 1) return n

LOAD 0 6 3        ; CR0 = GT_CHURCH_SUCC [R,X] (slot 3)
LAMBDA 0 0        ; Increment count each iteration
RETURN

; ------------------------------------------------
; GT_FP_EXP (slot [8]): e^a
; λa. Taylor series: 1 + x + x^2/2! + x^3/3! + ...
;
; Each term: POW for x^n, then DIV by factorial.
; Accumulate via ADD. Bounded to 4 terms.
; All computed with Church numerals.
;
; Input:  DR1 = a
; Output: DR0 = e^a (Church numeral approximation)
; ------------------------------------------------
fp_exp:
LOAD 1 5 0        ; CR1 = Lambda [E]
TPERM 1 E         ; Verify
CALL 1            ; Enter Lambda scope

; Term 0: 1 (identity)
; Term 1: x (= a)
; Term 2: x^2 / 2!
; Term 3: x^3 / 3!

; Start with term 1: POW(x, 1) = x
LOAD 0 6 15       ; CR0 = GT_CHURCH_POW [R,X] (slot 15)
LAMBDA 0 0        ; DR0 = POW(a, 1) = a

; Accumulate: 1 + x
LOAD 0 6 5        ; CR0 = GT_CHURCH_ADD [R,X] (slot 5)
LAMBDA 0 0        ; DR0 = ADD(1, a) = 1 + x

; Term 2: POW(x, 2) / 2
LOAD 0 6 15       ; CR0 = GT_CHURCH_POW [R,X] (slot 15)
LAMBDA 0 0        ; DR0 = POW(a, 2) = a^2
LOAD 0 6 14       ; CR0 = GT_CHURCH_DIV [R,X] (slot 14)
LAMBDA 0 0        ; DR0 = DIV(a^2, 2) = a^2/2!

; Accumulate: 1 + x + x^2/2!
LOAD 0 6 5        ; CR0 = GT_CHURCH_ADD [R,X] (slot 5)
LAMBDA 0 0        ; DR0 = 1 + x + x^2/2!

; Term 3: POW(x, 3) / 6
LOAD 0 6 15       ; CR0 = GT_CHURCH_POW [R,X] (slot 15)
LAMBDA 0 0        ; DR0 = POW(a, 3) = a^3
LOAD 0 6 14       ; CR0 = GT_CHURCH_DIV [R,X] (slot 14)
LAMBDA 0 0        ; DR0 = DIV(a^3, 6) = a^3/3!

; Accumulate: 1 + x + x^2/2! + x^3/3!
LOAD 0 6 5        ; CR0 = GT_CHURCH_ADD [R,X] (slot 5)
LAMBDA 0 0        ; DR0 = e^a (4-term approximation)
RETURN

; ------------------------------------------------
; GT_FP_SQRT (slot [9]): sqrt(a)
; λa. Integer square root via Y-combinator
;
; SQRT = Y(λf.λg. IF(LEQ(MUL g g) a)
;                     (f (SUCC g))
;                     (PRED g)) ZERO
; Linear search: increment guess until guess^2 > a,
; then back off one step.
;
; Input:  DR1 = a
; Output: DR0 = floor(sqrt(a))
; ------------------------------------------------
fp_sqrt:
LOAD 1 5 0        ; CR1 = Lambda [E]
TPERM 1 E         ; Verify
CALL 1            ; Enter Lambda scope

; Y-combinator for recursion (slot 2)
; MUL for squaring guess (slot 6)
; LEQ for comparison (slot 17)
; SUCC for incrementing guess (slot 3)
; PRED for backing off (slot 4)

LOAD 0 6 2        ; CR0 = GT_Y_COMBINATOR [R,X] (slot 2)
LOAD 1 6 6        ; CR1 = GT_CHURCH_MUL [R,X] (slot 6)
LAMBDA 0 0        ; Y(step function)
LAMBDA 1 0        ; Feed MUL for guess^2

LOAD 0 6 17       ; CR0 = GT_CHURCH_LEQ [R,X] (slot 17)
LAMBDA 0 0        ; IF(guess^2 <= a) continue else stop

LOAD 0 6 3        ; CR0 = GT_CHURCH_SUCC [R,X] (slot 3)
LAMBDA 0 0        ; Increment guess

LOAD 0 6 4        ; CR0 = GT_CHURCH_PRED [R,X] (slot 4)
LAMBDA 0 0        ; Back off when exceeded
RETURN

; ------------------------------------------------
; GT_FP_POW (slot [10]): a^b
; λa.λb. CHURCH_POW a b
;
; Church POW = λb.λe. e (MUL b) 1
; Apply (MUL base) exponent times to identity.
; Beautifully simple: exponentiation is just
; "multiply by base" applied exponent times.
;
; Input:  DR1 = a (base), DR2 = b (exponent)
; Output: DR0 = a^b
; ------------------------------------------------
fp_pow:
LOAD 1 5 0        ; CR1 = Lambda [E]
TPERM 1 E         ; Verify
CALL 1            ; Enter Lambda scope

LOAD 0 6 15       ; CR0 = GT_CHURCH_POW [R,X] (slot 15)
LAMBDA 0 0        ; DR0 = CHURCH_POW(DR1, DR2)
RETURN

; ================================================
; INSTRUCTION COUNT: Zero Turing instructions.
;
; Used ONLY: LOAD, CALL, LAMBDA, TPERM, RETURN
;
; No ADD, SUB, MUL, MOV, CMP, B, ADDI, SUBI,
; LSL, LSR, AND, ORR, EOR, BIC — none needed.
;
; Every computation is a capability-mediated
; lambda application. The SlideRule proves that
; all arithmetic can be expressed entirely in
; pure Church lambda calculus, with capability
; security at every operation.
;
; Comparison to binary SlideRule:
;   Binary:  DR0=method, uses ALU (ADD/MUL/DIV)
;   Lambda:  DR0=method, uses LAMBDA reductions
;   Same interface, same results, different domain.
;
; Lambda C-List slot reference (verified):
;   [2]  Y_COMBINATOR    [5]  ADD     [13] SUB
;   [3]  SUCC             [6]  MUL     [14] DIV
;   [4]  PRED             [11] FALSE=0 [15] POW
;                          [12] IF      [17] LEQ
;
; Dependencies (entered via CALL with E perm):
;   Lambda — Church numerals, Y-combinator, pairs
; ================================================`
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
    'TPERM': 'Test permissions and bounds on capability',
    'LAMBDA': 'Apply Church function via X permission (non-nestable)',
    'HALT': 'Stop program execution'
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
            { name: "Op", bits: 5, value: "00001", desc: "LOAD opcode" },
            { name: "Cond", bits: 4, desc: "Condition code (AL=always)" },
            { name: "I", bits: 1, desc: "0=immediate offset, 1=register" },
            { name: "CRd", bits: 3, desc: "Destination CR (0-7)" },
            { name: "CRn", bits: 3, desc: "Source C-List register (0-7)" },
            { name: "Index", bits: 10, desc: "C-List index (0-1023)" },
            { name: "Reserved", bits: 6, value: "0", desc: "Reserved" }
        ],
        variants: [
            { name: "Immediate", fields: { I: "0", Index: "Literal offset 0-1023" } },
            { name: "Register", fields: { I: "1", Index: "Index[3:0] = DR number" } }
        ]
    },
    {
        name: "SAVE",
        brief: "Save CR to C-List slot",
        syntax: "SAVE CRs, [CRn+idx]",
        desc: "Copy Context Register GT into C-List slot.",
        format: [
            { name: "Op", bits: 5, value: "00010", desc: "SAVE opcode" },
            { name: "Cond", bits: 4, desc: "Condition code" },
            { name: "I", bits: 1, desc: "0=immediate offset, 1=register" },
            { name: "CRs", bits: 3, desc: "Source CR (0-7)" },
            { name: "CRn", bits: 3, desc: "Target C-List register (0-7)" },
            { name: "Index", bits: 10, desc: "C-List index (0-1023)" },
            { name: "Reserved", bits: 6, value: "0", desc: "Reserved" }
        ],
        variants: [
            { name: "Immediate", fields: { I: "0", Index: "Literal offset 0-1023" } },
            { name: "Register", fields: { I: "1", Index: "Index[3:0] = DR number" } }
        ]
    },
    {
        name: "CALL",
        brief: "Enter abstraction",
        syntax: "CALL CRs [, mask]",
        desc: "Transfer control to abstraction entry point. Pushes return state, switches context. Clears registers per mask to prevent information leakage. DR8-15 always cleared automatically.",
        format: [
            { name: "Op", bits: 5, value: "00011", desc: "CALL opcode" },
            { name: "Cond", bits: 4, desc: "Condition code" },
            { name: "I", bits: 1, desc: "1=embedded mask, 0=use DR15" },
            { name: "CRs", bits: 3, desc: "Abstraction capability (0-7)" },
            { name: "CRn", bits: 3, desc: "Return capability register" },
            { name: "Mask", bits: 6, desc: "Permission mask (when I=1)" },
            { name: "Reserved", bits: 6, value: "0", desc: "Reserved" }
        ],
        variants: [
            { name: "No mask", fields: { DR: "0x00", CR: "0x00", desc: "All API registers passed" } },
            { name: "Full clear", fields: { DR: "0xFF", CR: "0x3F", desc: "All cleared - no data passed" } }
        ],
        security: "DR8-15 always cleared (never used for API). CR6=C-List, CR7=Nucleus fixed by Lambda Calculus; CR8=Thread identity. Mask bits prevent malware from reading caller's private data."
    },
    {
        name: "RETURN",
        brief: "Return from call",
        syntax: "RETURN [mask]",
        desc: "Return from CALL. Pops return state, restores caller context. Clears registers per mask to prevent information leakage back to caller. DR8-15 always cleared automatically.",
        format: [
            { name: "Op", bits: 5, value: "00100", desc: "RETURN opcode" },
            { name: "Cond", bits: 4, desc: "Condition code" },
            { name: "I", bits: 1, desc: "Reserved" },
            { name: "CRn", bits: 3, desc: "Return capability (0-7)" },
            { name: "Reserved", bits: 19, value: "0", desc: "Reserved" }
        ],
        variants: [
            { name: "No mask", fields: { DR: "0x00", CR: "0x00", desc: "All results returned" } },
            { name: "Full clear", fields: { DR: "0xFF", CR: "0x3F", desc: "All cleared - no results returned" } }
        ],
        security: "DR8-15 always cleared (callee scratch space). CR6-7 restored from call stack (Lambda Calculus fixed). Mask bits prevent malware from leaking internal state back to caller."
    },
    {
        name: "CHANGE",
        brief: "Switch thread identity",
        syntax: "CHANGE CRs | CHANGE CRn, idx",
        desc: "Create new thread Golden Token and load into CR8. I=0 uses capability in CRs as source; I=1 loads from C-List. Clears exclusive monitors (ARM CLREX semantics).",
        format: [
            { name: "Op", bits: 5, value: "00101", desc: "CHANGE opcode" },
            { name: "Cond", bits: 4, desc: "Condition code" },
            { name: "I", bits: 1, desc: "0=register source, 1=C-List lookup" },
            { name: "CRs/CRn", bits: 3, desc: "Source CR (I=0) or C-List register (I=1)" },
            { name: "Reserved", bits: 3, value: "0", desc: "Reserved" },
            { name: "Index", bits: 10, desc: "C-List slot index (when I=1, 0-1023)" },
            { name: "Reserved", bits: 6, value: "0", desc: "Reserved" }
        ],
        variants: [
            { name: "Register", fields: { I: "0", CRs: "Source capability register" } },
            { name: "C-List", fields: { I: "1", CRn: "C-List register", Index: "slot" } }
        ],
        notes: "CHANGE creates a new thread GT from the source capability. Unlike SWITCH which copies existing capabilities, CHANGE establishes a new thread identity."
    },
    {
        name: "SWITCH",
        brief: "Switch system register context",
        syntax: "SWITCH CRs, target | SWITCH CRn, idx, target",
        desc: "Load capability into system register CR8-CR15 based on 3-bit target field. Target: 0=CR8(Thread), 1=CR9(Interrupt), 2=CR10(DFault), 3-6=CR11-14(future), 7=CR15(Namespace). CHANGE is alias for SWITCH with target=0.",
        format: [
            { name: "Op", bits: 5, value: "00110", desc: "SWITCH opcode" },
            { name: "Cond", bits: 4, desc: "Condition code" },
            { name: "I", bits: 1, desc: "0=direct CR, 1=C-List lookup" },
            { name: "CRn", bits: 3, desc: "Source CR/C-List (0-7)" },
            { name: "Target", bits: 3, desc: "Destination: 0=CR8, 1=CR9, 2=CR10, 3-6=CR11-14, 7=CR15" },
            { name: "Index", bits: 10, desc: "C-List slot index (when I=1, 0-1023)" },
            { name: "Reserved", bits: 6, value: "0", desc: "Reserved" }
        ],
        variants: [
            { name: "Direct", fields: { I: "0", CRs: "CR containing capability", Target: "Destination CR8-CR15" } },
            { name: "C-List lookup", fields: { I: "1", CRn: "C-List register", Index: "slot", Target: "Destination" } }
        ],
        notes: "Target maps: 0→CR8(Thread), 1→CR9(Interrupt), 2→CR10(DFault), 3-6→CR11-14(future), 7→CR15(Namespace). Both I=0 (register) and I=1 (C-List) variants supported."
    },
    {
        name: "TPERM",
        brief: "Test GT permissions and bounds",
        syntax: "TPERM CRs, permMask [, index]",
        desc: "Compare CR permission bits against mask. Optional index validates against object size from namespace metadata (W2 limit). Sets Z=1 if all checks pass.",
        format: [
            { name: "Op", bits: 5, value: "00111", desc: "TPERM opcode" },
            { name: "Cond", bits: 4, desc: "Condition code" },
            { name: "P", bits: 1, desc: "0=mask mode, 1=preset mode" },
            { name: "CRs", bits: 3, desc: "CR to test (0-7)" },
            { name: "I", bits: 1, desc: "Index present (1=yes)" },
            { name: "Perms/Preset", bits: 6, desc: "P=0: 6-bit mask (R,W,X,L,S,E). P=1: Preset[3:0] (0-13)" },
            { name: "Index", bits: 8, desc: "Access index for bounds check (if I=1)" }
        ],
        variants: [
            { name: "Mask mode", fields: { P: "0", Perms: "6-bit permission mask (R W X L S E)" } },
            { name: "Preset mode", fields: { P: "1", Preset: "0=CLEAR, 1=R, 2=RW, 3=X, 4=RX, 5=RWX, 6=L, 7=S, 8=E, 9=LS, 10=LE, 11=SE, 12=LSE, 13-15=FAULT" } }
        ],
        notes: "Codes 6-8 match Lambda permission order (L,S,E). Codes 9-12 are common combos (LS,LE,SE,LSE). Codes 13-15 cause FAULT_TPERM_RSV."
    },
    {
        name: "LOADX",
        brief: "Load Exclusive (atomic)",
        syntax: "LOADX CRd, [CRn+idx]",
        desc: "Load GT from C-List and set exclusive monitor for current thread. Used with SAVEX for atomic read-modify-write operations.",
        format: [
            { name: "Op", bits: 5, value: "01000", desc: "LOADX opcode" },
            { name: "Cond", bits: 4, desc: "Condition code" },
            { name: "I", bits: 1, desc: "0=immediate, 1=register index" },
            { name: "CRd", bits: 3, desc: "Destination CR (0-7)" },
            { name: "CRn", bits: 3, desc: "Source C-List register (0-7)" },
            { name: "Index", bits: 10, desc: "C-List slot index (0-1023)" },
            { name: "Reserved", bits: 6, value: "0", desc: "Reserved" }
        ],
        security: "Sets per-thread exclusive monitor. Monitor cleared by SAVEX, CHANGE, or interrupts. Enables lock-free synchronization.",
        notes: "16 per-thread monitors (one per Thread ID 0-15). ARM LDREX semantics."
    },
    {
        name: "SAVEX",
        brief: "Store Exclusive (conditional)",
        syntax: "SAVEX DRd, CRs, [CRn+idx]",
        desc: "Conditionally store GT if exclusive monitor is still valid. Returns success/fail status in data register.",
        format: [
            { name: "Op", bits: 5, value: "01001", desc: "SAVEX opcode" },
            { name: "Cond", bits: 4, desc: "Condition code" },
            { name: "I", bits: 1, desc: "0=immediate, 1=register index" },
            { name: "CRs", bits: 3, desc: "Source CR to store (0-7)" },
            { name: "CRn", bits: 3, desc: "Target C-List register (0-7)" },
            { name: "Index", bits: 10, desc: "C-List slot index (0-1023)" },
            { name: "DRd", bits: 4, desc: "Result register (0=success, 1=fail)" },
            { name: "Reserved", bits: 2, value: "0", desc: "Reserved" }
        ],
        security: "Atomic compare-and-swap for capabilities. Prevents race conditions in multi-threaded GT updates.",
        notes: "DRd=0 on success (store completed), DRd=1 on failure (retry needed). Monitor always cleared after SAVEX."
    },
    {
        name: "LDM",
        brief: "Load Multiple CRs",
        syntax: "LDM CRn, {CR0-CR7}",
        desc: "Load multiple Context Registers from consecutive C-List entries. Each CR in register list uses mLoad with full permission/bounds/MAC validation.",
        format: [
            { name: "Op", bits: 5, value: "01010", desc: "LDM opcode" },
            { name: "Cond", bits: 4, desc: "Condition code" },
            { name: "U", bits: 1, desc: "0=descending, 1=ascending" },
            { name: "CRn", bits: 3, desc: "Base C-List register (0-7)" },
            { name: "W", bits: 1, desc: "Writeback base register" },
            { name: "Reserved", bits: 10, value: "0", desc: "Reserved" },
            { name: "RegList", bits: 8, desc: "CR bitmask (bit i = CR[i])" }
        ],
        security: "Each load goes through mLoad subroutine - full capability security enforced. Cannot bypass permission checks.",
        notes: "3-bit CR field means only CR0-CR7 addressable. CR8-CR15 (Thread, Nucleus, C-List, Namespace) are protected system registers."
    },
    {
        name: "STM",
        brief: "Store Multiple CRs",
        syntax: "STM CRn, {CR0-CR7}",
        desc: "Store multiple Context Registers to consecutive C-List entries. Each CR in register list uses mSave with full permission/bounds/MAC validation.",
        format: [
            { name: "Op", bits: 5, value: "01011", desc: "STM opcode" },
            { name: "Cond", bits: 4, desc: "Condition code" },
            { name: "U", bits: 1, desc: "0=descending, 1=ascending" },
            { name: "CRn", bits: 3, desc: "Base C-List register (0-7)" },
            { name: "W", bits: 1, desc: "Writeback base register" },
            { name: "Reserved", bits: 10, value: "0", desc: "Reserved" },
            { name: "RegList", bits: 8, desc: "CR bitmask (bit i = CR[i])" }
        ],
        security: "Each store goes through mSave subroutine - S-bit save validation enforced. Cannot bypass capability security model.",
        notes: "3-bit CR field prevents instruction-level access to protected system registers CR8-CR15."
    },
    {
        name: "LDI",
        brief: "Load Immediate to DR",
        syntax: "LDI DRd, #imm22",
        desc: "Load 22-bit zero-extended immediate constant into data register. For larger constants, use LDI followed by shift/add.",
        format: [
            { name: "Op", bits: 5, value: "11101", desc: "LDI opcode" },
            { name: "Cond", bits: 4, desc: "Condition code" },
            { name: "I", bits: 1, desc: "0=16-bit imm + shift, 1=22-bit direct" },
            { name: "Imm22/DRd+Imm", bits: 22, desc: "I=1: 22-bit immediate direct; I=0: DRd[3:0]+Imm16+Shift[1:0]" }
        ],
        notes: "Zero-extended to 64 bits. For full 64-bit constants, chain multiple LDI with LSL."
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
        desc: "NIA-relative branch with optional link (subroutine call).",
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
    const panels = ['instrChurch', 'instrTuring', 'instrTiming', 'instrGtTypes'];
    const tabs = ['tabChurch', 'tabTuring', 'tabTiming', 'tabGtTypes'];
    
    panels.forEach(id => document.getElementById(id)?.classList.add('hidden'));
    tabs.forEach(id => document.getElementById(id)?.classList.remove('active'));
    
    if (tab === 'church') {
        document.getElementById('instrChurch').classList.remove('hidden');
        document.getElementById('tabChurch').classList.add('active');
    } else if (tab === 'turing') {
        document.getElementById('instrTuring').classList.remove('hidden');
        document.getElementById('tabTuring').classList.add('active');
    } else if (tab === 'timing') {
        document.getElementById('instrTiming').classList.remove('hidden');
        document.getElementById('tabTiming').classList.add('active');
        renderTimingTable();
    } else if (tab === 'gtTypes') {
        document.getElementById('instrGtTypes').classList.remove('hidden');
        document.getElementById('tabGtTypes').classList.add('active');
        renderGtTypesReference();
    }
}

const instructionTiming = {
    clockSpeed: 2.0,
    technology: "28nm CMOS",
    assumptions: [
        "2 GHz clock (500 ps cycle time)",
        "L1 cache hit: 1 cycle latency",
        "L2 cache hit: 10 cycle latency",
        "Main memory: 100 cycle latency",
        "MAC validation: 3 cycles (pipelined SHA-256)",
        "Permission check: 1 cycle (combinational)",
        "Bounds check: 1 cycle (comparator)",
        "Exclusive monitor check: 1 cycle"
    ],
    categories: [
        {
            name: "Church Instructions (Capability Operations)",
            color: "#c084fc",
            instructions: [
                { name: "LOAD", cycles: "5-6", best: 5, worst: 106, time: "2.5-53 ns", notes: "L+Bounds+MAC validation; cache-dependent" },
                { name: "SAVE", cycles: "4-5", best: 4, worst: 105, time: "2.0-52.5 ns", notes: "S-bit+Bounds check; write-through" },
                { name: "LOADX", cycles: "6-7", best: 6, worst: 107, time: "3.0-53.5 ns", notes: "LOAD + monitor set (memory barrier)" },
                { name: "SAVEX", cycles: "5-6", best: 5, worst: 106, time: "2.5-53 ns", notes: "Monitor check + conditional store" },
                { name: "LDM", cycles: "5+4n", best: 9, worst: "5+104n", time: "4.5+ ns", notes: "n=register count; each uses mLoad" },
                { name: "STM", cycles: "4+4n", best: 8, worst: "4+104n", time: "4.0+ ns", notes: "n=register count; each uses mSave" },
                { name: "CALL", cycles: "8-12", best: 8, worst: 112, time: "4.0-56 ns", notes: "Push state + context switch + E check" },
                { name: "RETURN", cycles: "6-10", best: 6, worst: 110, time: "3.0-55 ns", notes: "Pop state + restore context" },
                { name: "CHANGE", cycles: "10-15", best: 10, worst: 115, time: "5.0-57.5 ns", notes: "Thread switch + monitor clear" },
                { name: "SWITCH", cycles: "8-12", best: 8, worst: 112, time: "4.0-56 ns", notes: "C-List context switch" },
                { name: "TPERM", cycles: "2", best: 2, worst: 2, time: "1.0 ns", notes: "Permission test (combinational)" }
            ]
        },
        {
            name: "Turing Instructions (Data Operations)",
            color: "#4ade80",
            instructions: [
                { name: "MOV", cycles: "1", best: 1, worst: 1, time: "0.5 ns", notes: "Register-to-register" },
                { name: "LDI", cycles: "1", best: 1, worst: 1, time: "0.5 ns", notes: "22-bit immediate load" },
                { name: "ADD/SUB", cycles: "1", best: 1, worst: 1, time: "0.5 ns", notes: "64-bit integer arithmetic" },
                { name: "MUL", cycles: "3-4", best: 3, worst: 4, time: "1.5-2.0 ns", notes: "64-bit multiply (pipelined)" },
                { name: "DIV", cycles: "20-40", best: 20, worst: 40, time: "10-20 ns", notes: "Iterative division" },
                { name: "AND/OR/XOR", cycles: "1", best: 1, worst: 1, time: "0.5 ns", notes: "Bitwise logic" },
                { name: "LSL/LSR/ASR", cycles: "1", best: 1, worst: 1, time: "0.5 ns", notes: "Barrel shifter" },
                { name: "ROR", cycles: "1", best: 1, worst: 1, time: "0.5 ns", notes: "Rotate right" },
                { name: "CMP/TST", cycles: "1", best: 1, worst: 1, time: "0.5 ns", notes: "Sets NZCV flags only" },
                { name: "B/BL", cycles: "1-3", best: 1, worst: 3, time: "0.5-1.5 ns", notes: "Branch (pipeline flush if taken)" },
                { name: "Bcond", cycles: "1-3", best: 1, worst: 3, time: "0.5-1.5 ns", notes: "Conditional branch" }
            ]
        },
        {
            name: "Abstraction Calls (Built-in Services)",
            color: "#f59e0b",
            instructions: [
                { name: "Abacus.add", cycles: "12-16", best: 12, worst: 116, time: "6-58 ns", notes: "CALL + 1-cycle op + RETURN" },
                { name: "Abacus.mul", cycles: "15-20", best: 15, worst: 120, time: "7.5-60 ns", notes: "CALL + 3-cycle MUL + RETURN" },
                { name: "SlideRule.fadd", cycles: "18-25", best: 18, worst: 125, time: "9-62.5 ns", notes: "IEEE 754 FP add" },
                { name: "SlideRule.fmul", cycles: "20-28", best: 20, worst: 128, time: "10-64 ns", notes: "IEEE 754 FP multiply" },
                { name: "SlideRule.fdiv", cycles: "40-60", best: 40, worst: 160, time: "20-80 ns", notes: "IEEE 754 FP divide" },
                { name: "Circle.sin/cos", cycles: "50-80", best: 50, worst: 180, time: "25-90 ns", notes: "CORDIC algorithm" },
                { name: "CapMgr.create", cycles: "100-200", best: 100, worst: 300, time: "50-150 ns", notes: "Namespace allocation + MAC" },
                { name: "DateTime.now", cycles: "15-20", best: 15, worst: 120, time: "7.5-60 ns", notes: "Read system clock" },
                { name: "Constants.π", cycles: "14-18", best: 14, worst: 118, time: "7-59 ns", notes: "CALL + Abstract GT validate + lookup + RETURN" }
            ]
        }
    ]
};

function renderTimingTable() {
    const container = document.getElementById('timingContent');
    if (!container) return;
    
    const t = instructionTiming;
    
    let html = `
        <div class="timing-header">
            <h3>Instruction Timing Estimates</h3>
            <div class="timing-specs">
                <div class="timing-spec"><span class="spec-label">Technology:</span> ${t.technology}</div>
                <div class="timing-spec"><span class="spec-label">Clock Speed:</span> ${t.clockSpeed} GHz (${(1000/t.clockSpeed).toFixed(0)} ps cycle)</div>
            </div>
        </div>
        
        <div class="timing-assumptions">
            <h4>Timing Assumptions</h4>
            <ul>
                ${t.assumptions.map(a => `<li>${a}</li>`).join('')}
            </ul>
        </div>
    `;
    
    t.categories.forEach(cat => {
        html += `
            <div class="timing-category">
                <h4 style="border-left: 4px solid ${cat.color}; padding-left: 0.75rem;">${cat.name}</h4>
                <table class="timing-table">
                    <thead>
                        <tr>
                            <th>Instruction</th>
                            <th>Cycles</th>
                            <th>Best Case</th>
                            <th>Worst Case</th>
                            <th>Time @ 2GHz</th>
                            <th>Notes</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${cat.instructions.map(instr => `
                            <tr>
                                <td class="instr-name">${instr.name}</td>
                                <td class="cycles">${instr.cycles}</td>
                                <td class="best">${instr.best}</td>
                                <td class="worst">${instr.worst}</td>
                                <td class="time">${instr.time}</td>
                                <td class="notes">${instr.notes}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    });
    
    html += `
        <div class="timing-legend">
            <h4>Cycle Breakdown for Capability Operations</h4>
            <div class="legend-grid">
                <div class="legend-item">
                    <span class="legend-cycles">1</span>
                    <span class="legend-desc">Permission check (L/S/E bits)</span>
                </div>
                <div class="legend-item">
                    <span class="legend-cycles">1</span>
                    <span class="legend-desc">Bounds check (index vs limit)</span>
                </div>
                <div class="legend-item">
                    <span class="legend-cycles">3</span>
                    <span class="legend-desc">MAC validation (pipelined SHA-256)</span>
                </div>
                <div class="legend-item">
                    <span class="legend-cycles">1-100</span>
                    <span class="legend-desc">Memory access (cache hierarchy)</span>
                </div>
                <div class="legend-item">
                    <span class="legend-cycles">1</span>
                    <span class="legend-desc">Exclusive monitor set/check</span>
                </div>
                <div class="legend-item">
                    <span class="legend-cycles">2-4</span>
                    <span class="legend-desc">Context state save/restore</span>
                </div>
            </div>
        </div>
        
        <div class="timing-security-note">
            <strong>Security vs Performance:</strong> Church instructions include mandatory security checks (permissions, bounds, MAC) 
            that add 3-5 cycles compared to raw memory access. This is the cost of failsafe security - every access is validated, 
            making buffer overflows, ROP attacks, and privilege escalation architecturally impossible.
        </div>
    `;
    
    container.innerHTML = html;
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
    
    let securityHtml = '';
    if (instr.security) {
        securityHtml = `
            <div class="instr-security">
                <span class="security-icon">&#128274;</span>
                <span class="security-text">${instr.security}</span>
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
            ${securityHtml}
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

function renderGtTypesReference() {
    const container = document.getElementById('gtTypesContent');
    if (!container || container.dataset.rendered) return;
    container.dataset.rendered = 'true';

    container.innerHTML = `
        <div style="padding: 1rem; max-width: 900px;">
            <h3 style="color: var(--accent); margin-bottom: 1rem;">Golden Token Type System</h3>

            <div style="background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem;">
                <h4 style="color: var(--text); margin-bottom: 0.75rem;">32-bit GT Format (Sim-32)</h4>
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 2px; font-family: monospace; font-size: 0.85rem; margin-bottom: 0.75rem;">
                    <div style="background: #7c3aed; color: white; padding: 0.5rem; text-align: center; border-radius: 4px 0 0 4px;">
                        Version [31:25]<br><span style="font-size: 0.75rem;">7 bits</span>
                    </div>
                    <div style="background: #2563eb; color: white; padding: 0.5rem; text-align: center;">
                        Index [24:8]<br><span style="font-size: 0.75rem;">17 bits (131K entries)</span>
                    </div>
                    <div style="background: #059669; color: white; padding: 0.5rem; text-align: center;">
                        Perms [7:2]<br><span style="font-size: 0.75rem;">6 bits (R,W,X,L,S,E)</span>
                    </div>
                    <div style="background: #dc2626; color: white; padding: 0.5rem; text-align: center; border-radius: 0 4px 4px 0;">
                        Type [1:0]<br><span style="font-size: 0.75rem;">2 bits</span>
                    </div>
                </div>
                <p style="color: var(--text-secondary); font-size: 0.8rem; margin: 0;">Domain purity enforced: R,W,X = Turing domain | L,S,E = Church domain — never both</p>
            </div>

            <div style="background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem;">
                <h4 style="color: var(--text); margin-bottom: 0.75rem;">GT Type Encoding</h4>
                <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                    <thead>
                        <tr style="border-bottom: 2px solid var(--border);">
                            <th style="text-align: left; padding: 0.5rem; color: var(--text-secondary);">Bits</th>
                            <th style="text-align: left; padding: 0.5rem; color: var(--text-secondary);">Type</th>
                            <th style="text-align: left; padding: 0.5rem; color: var(--text-secondary);">Purpose</th>
                            <th style="text-align: left; padding: 0.5rem; color: var(--text-secondary);">Permissions</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr style="border-bottom: 1px solid var(--border);">
                            <td style="padding: 0.5rem; font-family: monospace; color: #4ade80;">0b00</td>
                            <td style="padding: 0.5rem; color: var(--text); font-weight: bold;">Inform</td>
                            <td style="padding: 0.5rem; color: var(--text-secondary);">Data access — read/write memory via namespace entry</td>
                            <td style="padding: 0.5rem; color: var(--text-secondary);">R, W (Turing domain)</td>
                        </tr>
                        <tr style="border-bottom: 1px solid var(--border);">
                            <td style="padding: 0.5rem; font-family: monospace; color: #60a5fa;">0b01</td>
                            <td style="padding: 0.5rem; color: var(--text); font-weight: bold;">Outform</td>
                            <td style="padding: 0.5rem; color: var(--text-secondary);">Abstraction access — CALL entry, C-List traversal, LAMBDA</td>
                            <td style="padding: 0.5rem; color: var(--text-secondary);">X, L, S, E (Church domain)</td>
                        </tr>
                        <tr style="border-bottom: 1px solid var(--border);">
                            <td style="padding: 0.5rem; font-family: monospace; color: #fbbf24;">0b10</td>
                            <td style="padding: 0.5rem; color: var(--text); font-weight: bold;">NULL</td>
                            <td style="padding: 0.5rem; color: var(--text-secondary);">Empty slot — clears CR, required at C-List slot [0]</td>
                            <td style="padding: 0.5rem; color: var(--text-secondary);">None (all zero)</td>
                        </tr>
                        <tr>
                            <td style="padding: 0.5rem; font-family: monospace; color: #f472b6;">0b11</td>
                            <td style="padding: 0.5rem; color: var(--text); font-weight: bold;">Abstract</td>
                            <td style="padding: 0.5rem; color: var(--text-secondary);">Pure identity token — unforgeable credential, method selector key</td>
                            <td style="padding: 0.5rem; color: var(--text-secondary);">None (identity only)</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div style="background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem;">
                <h4 style="color: var(--text); margin-bottom: 0.75rem;">Abstract GT (0b11) — Pure Identity Token</h4>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                    <div>
                        <h5 style="color: #f472b6; margin-bottom: 0.5rem;">Properties</h5>
                        <ul style="color: var(--text-secondary); font-size: 0.85rem; margin: 0; padding-left: 1.2rem;">
                            <li><strong>Unforgeable</strong> — only Mint abstraction creates them</li>
                            <li><strong>Revocable</strong> — GC version bump invalidates</li>
                            <li><strong>CR-only path</strong> — cannot exist in Data Registers</li>
                            <li><strong>Scope-confined</strong> — validated by issuing abstraction</li>
                            <li><strong>No permissions</strong> — carries identity, not access rights</li>
                        </ul>
                    </div>
                    <div>
                        <h5 style="color: #f472b6; margin-bottom: 0.5rem;">Use Cases</h5>
                        <ul style="color: var(--text-secondary); font-size: 0.85rem; margin: 0; padding-left: 1.2rem;">
                            <li>Hardware-protected login credentials</li>
                            <li>Method-selector keys for secure dispatch</li>
                            <li>Opaque identity for authorization decisions</li>
                            <li>Two-layer capability protection (GT + CR path)</li>
                            <li>Revocable access tokens without software trust</li>
                        </ul>
                    </div>
                </div>
            </div>

            <div style="background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem;">
                <h4 style="color: var(--text); margin-bottom: 0.75rem;">Programmable Method-Selector Security</h4>
                <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 1rem;">
                    Method dispatch executes inside the abstraction's protected scope. The abstraction author chooses the dispatch mode:
                </p>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.75rem;">
                    <div style="background: var(--bg); border: 1px solid #4ade80; border-radius: 6px; padding: 0.75rem;">
                        <div style="color: #4ade80; font-weight: bold; font-size: 0.9rem; margin-bottom: 0.5rem;">Integer Dispatch: Integer in DR0</div>
                        <div style="color: var(--text-secondary); font-size: 0.8rem;">
                            Fast enumerable dispatch. Caller sets DR0 = method number, CALL enters abstraction.
                            Access code reads DR0 and branches.
                        </div>
                        <div style="color: var(--text-secondary); font-size: 0.75rem; margin-top: 0.5rem; font-style: italic;">
                            Security: Low — integers are guessable
                        </div>
                    </div>
                    <div style="background: var(--bg); border: 1px solid #60a5fa; border-radius: 6px; padding: 0.75rem;">
                        <div style="color: #60a5fa; font-weight: bold; font-size: 0.9rem; margin-bottom: 0.5rem;">String Dispatch: String in DR0</div>
                        <div style="color: var(--text-secondary); font-size: 0.8rem;">
                            Symbolic resolver matches method name string.
                            Harder to guess than integers but still data.
                        </div>
                        <div style="color: var(--text-secondary); font-size: 0.75rem; margin-top: 0.5rem; font-style: italic;">
                            Security: Medium — strings can leak via DRs
                        </div>
                    </div>
                    <div style="background: var(--bg); border: 1px solid #f472b6; border-radius: 6px; padding: 0.75rem;">
                        <div style="color: #f472b6; font-weight: bold; font-size: 0.9rem; margin-bottom: 0.5rem;">Abstract GT Dispatch: Abstract GT in CR</div>
                        <div style="color: var(--text-secondary); font-size: 0.8rem;">
                            Two-layer protection: caller must hold the Abstract GT (capability gate)
                            AND pass it via CR (hardware-enforced path).
                        </div>
                        <div style="color: var(--text-secondary); font-size: 0.75rem; margin-top: 0.5rem; font-style: italic;">
                            Security: Maximum — unforgeable + unextractable
                        </div>
                    </div>
                </div>
            </div>

            <div style="background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem;">
                <h4 style="color: var(--text); margin-bottom: 0.75rem;">Namespace Entry Metadata Flags</h4>
                <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 0.75rem;">
                    B and F are namespace entry metadata stored in high bits of the limit word — not GT permission bits:
                </p>
                <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                    <thead>
                        <tr style="border-bottom: 2px solid var(--border);">
                            <th style="text-align: left; padding: 0.5rem; color: var(--text-secondary);">Flag</th>
                            <th style="text-align: left; padding: 0.5rem; color: var(--text-secondary);">Bit</th>
                            <th style="text-align: left; padding: 0.5rem; color: var(--text-secondary);">Purpose</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr style="border-bottom: 1px solid var(--border);">
                            <td style="padding: 0.5rem; color: var(--text); font-weight: bold;">B (Bind)</td>
                            <td style="padding: 0.5rem; font-family: monospace; color: var(--accent);">limit[31]</td>
                            <td style="padding: 0.5rem; color: var(--text-secondary);">Controls whether SAVE can write to this entry. SAVE faults BIND if B=0.</td>
                        </tr>
                        <tr style="border-bottom: 1px solid var(--border);">
                            <td style="padding: 0.5rem; color: var(--text); font-weight: bold;">F (Far/Foreign)</td>
                            <td style="padding: 0.5rem; font-family: monospace; color: var(--accent);">limit[30]</td>
                            <td style="padding: 0.5rem; color: var(--text-secondary);">F=0: virtual memory (HTTP GET/PUT). F=1: remote execution (encrypted tunnel).</td>
                        </tr>
                        <tr>
                            <td style="padding: 0.5rem; color: var(--text); font-weight: bold;">M (Machine)</td>
                            <td style="padding: 0.5rem; font-family: monospace; color: var(--accent);">transient</td>
                            <td style="padding: 0.5rem; color: var(--text-secondary);">Microcode elevation flag. Never stored in GT — exists only during mLoad execution.</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div style="background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1rem;">
                <h4 style="color: var(--text); margin-bottom: 0.75rem;">Abstract GT vs Software Tokens</h4>
                <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                    <thead>
                        <tr style="border-bottom: 2px solid var(--border);">
                            <th style="text-align: left; padding: 0.5rem; color: var(--text-secondary);">Property</th>
                            <th style="text-align: center; padding: 0.5rem; color: #f472b6;">Abstract GT</th>
                            <th style="text-align: center; padding: 0.5rem; color: var(--text-secondary);">JWT / OAuth</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr style="border-bottom: 1px solid var(--border);">
                            <td style="padding: 0.5rem; color: var(--text);">Storage</td>
                            <td style="padding: 0.5rem; text-align: center; color: #4ade80;">CR only (hardware)</td>
                            <td style="padding: 0.5rem; text-align: center; color: #ef4444;">Any variable (software)</td>
                        </tr>
                        <tr style="border-bottom: 1px solid var(--border);">
                            <td style="padding: 0.5rem; color: var(--text);">Forgeable?</td>
                            <td style="padding: 0.5rem; text-align: center; color: #4ade80;">No — Mint only</td>
                            <td style="padding: 0.5rem; text-align: center; color: #ef4444;">Yes — string copy</td>
                        </tr>
                        <tr style="border-bottom: 1px solid var(--border);">
                            <td style="padding: 0.5rem; color: var(--text);">Extractable?</td>
                            <td style="padding: 0.5rem; text-align: center; color: #4ade80;">No — CR path only</td>
                            <td style="padding: 0.5rem; text-align: center; color: #ef4444;">Yes — printable data</td>
                        </tr>
                        <tr style="border-bottom: 1px solid var(--border);">
                            <td style="padding: 0.5rem; color: var(--text);">Revocable?</td>
                            <td style="padding: 0.5rem; text-align: center; color: #4ade80;">GC version bump</td>
                            <td style="padding: 0.5rem; text-align: center; color: #fbbf24;">Requires revocation list</td>
                        </tr>
                        <tr>
                            <td style="padding: 0.5rem; color: var(--text);">Leakable?</td>
                            <td style="padding: 0.5rem; text-align: center; color: #4ade80;">No — cannot enter DR</td>
                            <td style="padding: 0.5rem; text-align: center; color: #ef4444;">Yes — log, network, memory</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div style="background: var(--surface); border: 1px solid #f472b6; border-radius: 8px; padding: 1rem;">
                <h4 style="color: #f472b6; margin-bottom: 0.75rem;">Constants Abstraction — Physical Constants as Abstract GTs</h4>
                <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 1rem;">
                    Physical and mathematical constants are not bare numbers in Data Registers. Each constant is an Abstract GT — an unforgeable identity token
                    that the Constants abstraction issued. To retrieve a value, present the Abstract GT in CR1 and CALL Constants. The value appears in DR0.
                    The constant can never be corrupted because it never exists as unprotected data.
                </p>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                    <div>
                        <h5 style="color: var(--text); margin-bottom: 0.5rem;">Mathematical Constants</h5>
                        <table style="width: 100%; border-collapse: collapse; font-size: 0.8rem;">
                            <tbody>
                                <tr style="border-bottom: 1px solid var(--border);">
                                    <td style="padding: 0.3rem; color: #f472b6; font-family: monospace;">GT_PI</td>
                                    <td style="padding: 0.3rem; color: var(--text-secondary);">3.14159265358979...</td>
                                </tr>
                                <tr style="border-bottom: 1px solid var(--border);">
                                    <td style="padding: 0.3rem; color: #f472b6; font-family: monospace;">GT_E</td>
                                    <td style="padding: 0.3rem; color: var(--text-secondary);">2.71828182845904...</td>
                                </tr>
                                <tr style="border-bottom: 1px solid var(--border);">
                                    <td style="padding: 0.3rem; color: #f472b6; font-family: monospace;">GT_PHI</td>
                                    <td style="padding: 0.3rem; color: var(--text-secondary);">1.61803398874989...</td>
                                </tr>
                                <tr style="border-bottom: 1px solid var(--border);">
                                    <td style="padding: 0.3rem; color: #f472b6; font-family: monospace;">GT_SQRT2</td>
                                    <td style="padding: 0.3rem; color: var(--text-secondary);">1.41421356237309...</td>
                                </tr>
                                <tr style="border-bottom: 1px solid var(--border);">
                                    <td style="padding: 0.3rem; color: #f472b6; font-family: monospace;">GT_LN2</td>
                                    <td style="padding: 0.3rem; color: var(--text-secondary);">0.69314718055994...</td>
                                </tr>
                                <tr>
                                    <td style="padding: 0.3rem; color: #f472b6; font-family: monospace;">GT_LN10</td>
                                    <td style="padding: 0.3rem; color: var(--text-secondary);">2.30258509299404...</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <div>
                        <h5 style="color: var(--text); margin-bottom: 0.5rem;">Physical Constants</h5>
                        <table style="width: 100%; border-collapse: collapse; font-size: 0.8rem;">
                            <tbody>
                                <tr style="border-bottom: 1px solid var(--border);">
                                    <td style="padding: 0.3rem; color: #f472b6; font-family: monospace;">GT_C</td>
                                    <td style="padding: 0.3rem; color: var(--text-secondary);">299,792,458 m/s</td>
                                </tr>
                                <tr style="border-bottom: 1px solid var(--border);">
                                    <td style="padding: 0.3rem; color: #f472b6; font-family: monospace;">GT_PLANCK</td>
                                    <td style="padding: 0.3rem; color: var(--text-secondary);">6.626 x 10^-34 J-s</td>
                                </tr>
                                <tr style="border-bottom: 1px solid var(--border);">
                                    <td style="padding: 0.3rem; color: #f472b6; font-family: monospace;">GT_BOLTZMANN</td>
                                    <td style="padding: 0.3rem; color: var(--text-secondary);">1.381 x 10^-23 J/K</td>
                                </tr>
                                <tr style="border-bottom: 1px solid var(--border);">
                                    <td style="padding: 0.3rem; color: #f472b6; font-family: monospace;">GT_AVOGADRO</td>
                                    <td style="padding: 0.3rem; color: var(--text-secondary);">6.022 x 10^23 /mol</td>
                                </tr>
                                <tr>
                                    <td style="padding: 0.3rem; color: #f472b6; font-family: monospace;">GT_G</td>
                                    <td style="padding: 0.3rem; color: var(--text-secondary);">6.674 x 10^-11 m3/(kg-s2)</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
                <div style="margin-top: 1rem; padding: 0.75rem; background: var(--bg); border: 1px solid var(--border); border-radius: 6px;">
                    <div style="color: var(--text); font-weight: bold; font-size: 0.85rem; margin-bottom: 0.5rem;">Usage Pattern (Abstract GT Dispatch)</div>
                    <pre style="color: var(--text-secondary); font-size: 0.8rem; margin: 0; font-family: monospace;">LOAD CR0, CR6, #9       ; Load Constants abstraction [E]
LOAD CR1, CR0, #2       ; Load GT_PI Abstract GT into CR1
CALL CR0                ; Enter Constants — validates CR1
                        ; Result: DR0 = 3.14159265358979...</pre>
                </div>
            </div>
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

// ==================== CODE BROWSER ====================

let currentSourceFile = null;
let sourceCodeCache = {};

async function loadSourceFile(filename) {
    document.querySelectorAll('.file-item').forEach(el => el.classList.remove('active'));
    const fileItem = document.querySelector(`.file-item[data-file="${filename}"]`);
    if (fileItem) fileItem.classList.add('active');
    
    document.getElementById('currentFileName').textContent = `web/${filename}`;
    currentSourceFile = filename;
    
    const viewer = document.getElementById('codeViewerContent');
    viewer.innerHTML = '<div class="code-welcome"><p>Loading...</p></div>';
    
    try {
        let code;
        if (sourceCodeCache[filename]) {
            code = sourceCodeCache[filename];
        } else {
            const response = await fetch(`/${filename}?t=${Date.now()}`);
            if (!response.ok) throw new Error('File not found');
            code = await response.text();
            sourceCodeCache[filename] = code;
        }
        
        displaySourceCode(code, filename);
    } catch (err) {
        viewer.innerHTML = `<div class="code-welcome"><p style="color: var(--danger);">Error loading file: ${err.message}</p></div>`;
    }
}

function displaySourceCode(code, filename) {
    const viewer = document.getElementById('codeViewerContent');
    viewer.style.padding = '';
    viewer.style.overflow = '';
    const lines = code.split('\n');
    const extension = filename.split('.').pop();
    
    let html = '<div class="source-code-display">';
    lines.forEach((line, i) => {
        const lineNum = i + 1;
        const highlightedLine = syntaxHighlight(escapeHtml(line), extension);
        html += `<div class="code-line" data-line="${lineNum}">`;
        html += `<span class="line-number">${lineNum}</span>`;
        html += `<span class="line-content">${highlightedLine || ' '}</span>`;
        html += '</div>';
    });
    html += '</div>';
    
    viewer.innerHTML = html;
}

function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function syntaxHighlight(line, ext) {
    if (ext === 'js') {
        line = line.replace(/(\/\/.*$)/g, '<span class="comment">$1</span>');
        line = line.replace(/\b(const|let|var|function|return|if|else|for|while|switch|case|break|continue|new|this|class|extends|import|export|from|async|await|try|catch|throw|typeof|instanceof|in|of|true|false|null|undefined)\b/g, '<span class="keyword">$1</span>');
        line = line.replace(/(['"`])(?:(?!\1)[^\\]|\\.)*?\1/g, '<span class="string">$&</span>');
        line = line.replace(/\b(\d+\.?\d*)\b/g, '<span class="number">$1</span>');
        line = line.replace(/(\w+)\s*\(/g, '<span class="function">$1</span>(');
    } else if (ext === 'css') {
        line = line.replace(/(\/\*.*?\*\/)/g, '<span class="comment">$1</span>');
        line = line.replace(/([a-z-]+)\s*:/g, '<span class="property">$1</span>:');
        line = line.replace(/(#[0-9a-fA-F]{3,8})\b/g, '<span class="number">$1</span>');
        line = line.replace(/(\d+(?:px|rem|em|%|vh|vw|deg|s|ms)?)/g, '<span class="number">$1</span>');
    } else if (ext === 'html') {
        line = line.replace(/(&lt;!--.*?--&gt;)/g, '<span class="comment">$1</span>');
        line = line.replace(/(&lt;\/?)([\w-]+)/g, '$1<span class="keyword">$2</span>');
        line = line.replace(/([\w-]+)=/g, '<span class="property">$1</span>=');
        line = line.replace(/(".*?")/g, '<span class="string">$1</span>');
    } else if (ext === 'py') {
        line = line.replace(/(#.*$)/g, '<span class="comment">$1</span>');
        line = line.replace(/\b(def|class|import|from|return|if|elif|else|for|while|try|except|with|as|pass|break|continue|True|False|None|and|or|not|in|is|lambda)\b/g, '<span class="keyword">$1</span>');
        line = line.replace(/(['"])(?:(?!\1)[^\\]|\\.)*?\1/g, '<span class="string">$&</span>');
        line = line.replace(/\b(\d+\.?\d*)\b/g, '<span class="number">$1</span>');
    }
    return line;
}

function scrollToLine() {
    const lineNum = prompt('Enter line number:');
    if (lineNum && !isNaN(lineNum)) {
        const line = document.querySelector(`.code-line[data-line="${lineNum}"]`);
        if (line) {
            line.scrollIntoView({ behavior: 'smooth', block: 'center' });
            line.style.background = 'rgba(233, 69, 96, 0.3)';
            setTimeout(() => { line.style.background = ''; }, 2000);
        }
    }
}

function copyCodeToClipboard() {
    if (!currentSourceFile || !sourceCodeCache[currentSourceFile]) {
        alert('No file loaded');
        return;
    }
    navigator.clipboard.writeText(sourceCodeCache[currentSourceFile]).then(() => {
        alert('Code copied to clipboard!');
    }).catch(err => {
        alert('Failed to copy: ' + err);
    });
}

function searchInCode(event) {
    if (event.key === 'Enter') {
        executeCodeSearch();
    }
}

function executeCodeSearch() {
    const query = document.getElementById('codeSearchInput').value.trim().toLowerCase();
    if (!query) return;
    
    if (!currentSourceFile || !sourceCodeCache[currentSourceFile]) {
        alert('Load a file first to search');
        return;
    }
    
    const lines = document.querySelectorAll('.code-line');
    let matchCount = 0;
    let firstMatch = null;
    
    lines.forEach(line => {
        const content = line.querySelector('.line-content');
        const text = content.textContent.toLowerCase();
        if (text.includes(query)) {
            matchCount++;
            line.classList.add('search-match');
            if (!firstMatch) firstMatch = line;
        } else {
            line.classList.remove('search-match');
        }
    });
    
    if (firstMatch) {
        firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    
    const header = document.querySelector('.code-viewer-header');
    let resultsEl = header.querySelector('.search-results');
    if (!resultsEl) {
        resultsEl = document.createElement('span');
        resultsEl.className = 'search-results';
        header.insertBefore(resultsEl, header.firstChild.nextSibling);
    }
    resultsEl.textContent = matchCount > 0 ? `${matchCount} matches` : 'No matches';
}

// ==================== FIGURE VIEWER ====================

function loadFigure(url) {
    document.querySelectorAll('.file-item').forEach(el => el.classList.remove('active'));
    const figMap = {
        '/figures/': 'figures/lambda-flow',
        '/figures/stack-frames': 'figures/stack-frames',
        '/figures/lambda-nesting-sequence': 'figures/lambda-nesting',
        '/figures/lambda-calculus-mapping': 'figures/lambda-calculus',
        '/figures/lambda-clamp-example': 'figures/lambda-clamp',
        '/figures/tunnel-architecture': 'figures/tunnel-arch',
        '/figures/dispatch-styles-comparison': 'figures/dispatch-styles',
        '/figures/conventional-vs-ctmm': 'figures/conv-vs-ctmm',
        '/figures/boot-sequence-state-machine': 'figures/boot-seq',
        '/figures/mload-validation-pipeline': 'figures/mload-pipeline',
        '/figures/mint-abstraction-nesting': 'figures/mint-nesting',
        '/figures/hello-mum-tunnel': 'figures/hello-mum'
    };
    const dataFile = figMap[url] || url.replace(/^\//, '');
    const fileItem = document.querySelector(`.file-item[data-file="${dataFile}"]`);
    if (fileItem) fileItem.classList.add('active');

    const label = fileItem ? fileItem.textContent.trim() : url;
    document.getElementById('currentFileName').textContent = label;
    currentSourceFile = dataFile;

    const viewer = document.getElementById('codeViewerContent');
    viewer.innerHTML = `<iframe src="${url}?t=${Date.now()}" style="width:100%;height:100%;border:none;background:#0a0e17;"></iframe>`;
    viewer.style.padding = '0';
    viewer.style.overflow = 'hidden';
}

// ==================== DOC FILE VIEWER ====================

function renderMarkdown(md) {
    let html = md;
    html = html.replace(/^(#{1,6})\s+(.+)$/gm, function(_, hashes, text) {
        const level = hashes.length;
        return `<h${level}>${text}</h${level}>`;
    });
    html = html.replace(/^---+$/gm, '<hr>');
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function(_, lang, code) {
        return `<pre><code class="lang-${lang || 'text'}">${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`;
    });
    html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" style="max-width:100%">');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    html = html.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');
    const lines = html.split('\n');
    let result = [];
    let inList = false;
    let listType = '';
    let inTable = false;
    let tableRows = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const ulMatch = line.match(/^(\s*)[-*]\s+(.+)/);
        const olMatch = line.match(/^(\s*)\d+\.\s+(.+)/);
        const tableMatch = line.match(/^\|(.+)\|$/);
        if (tableMatch) {
            if (!inTable) { inTable = true; tableRows = []; }
            if (!/^[\s|:-]+$/.test(tableMatch[1])) {
                tableRows.push(tableMatch[1].split('|').map(c => c.trim()));
            }
            continue;
        } else if (inTable) {
            inTable = false;
            let t = '<table>';
            tableRows.forEach((row, ri) => {
                const tag = ri === 0 ? 'th' : 'td';
                t += '<tr>' + row.map(c => `<${tag}>${c}</${tag}>`).join('') + '</tr>';
            });
            t += '</table>';
            result.push(t);
            tableRows = [];
        }
        if (ulMatch) {
            if (!inList || listType !== 'ul') {
                if (inList) result.push(`</${listType}>`);
                result.push('<ul>'); inList = true; listType = 'ul';
            }
            result.push(`<li>${ulMatch[2]}</li>`);
        } else if (olMatch) {
            if (!inList || listType !== 'ol') {
                if (inList) result.push(`</${listType}>`);
                result.push('<ol>'); inList = true; listType = 'ol';
            }
            result.push(`<li>${olMatch[2]}</li>`);
        } else {
            if (inList) { result.push(`</${listType}>`); inList = false; }
            if (line.trim() === '' && !line.startsWith('<')) {
                result.push('');
            } else if (!line.startsWith('<')) {
                result.push(`<p>${line}</p>`);
            } else {
                result.push(line);
            }
        }
    }
    if (inList) result.push(`</${listType}>`);
    if (inTable && tableRows.length > 0) {
        let t = '<table>';
        tableRows.forEach((row, ri) => {
            const tag = ri === 0 ? 'th' : 'td';
            t += '<tr>' + row.map(c => `<${tag}>${c}</${tag}>`).join('') + '</tr>';
        });
        t += '</table>';
        result.push(t);
    }
    return result.join('\n').replace(/<p><\/p>/g, '').replace(/\n{3,}/g, '\n\n');
}

async function loadDocFile(filename) {
    document.querySelectorAll('.file-item').forEach(el => el.classList.remove('active'));
    const fileItem = document.querySelector(`.file-item[data-file="docs/${filename}"]`);
    if (fileItem) fileItem.classList.add('active');

    document.getElementById('currentFileName').textContent = `docs/${filename}`;
    currentSourceFile = 'docs/' + filename;

    const viewer = document.getElementById('codeViewerContent');
    viewer.style.padding = '';
    viewer.style.overflow = '';
    viewer.innerHTML = '<div class="code-welcome"><p>Loading...</p></div>';

    try {
        const response = await fetch(`/docs/${filename}?t=${Date.now()}`);
        if (!response.ok) throw new Error('File not found');
        const mdText = await response.text();
        sourceCodeCache['docs/' + filename] = mdText;
        const rendered = renderMarkdown(mdText);
        viewer.innerHTML = `<div class="markdown-body">${rendered}</div>`;
    } catch (err) {
        viewer.innerHTML = `<div class="code-welcome"><p style="color: var(--danger);">Error loading doc: ${err.message}</p></div>`;
    }
}

// ==================== AUTHENTICATION ====================

function toggleUserMenu() {
    const menu = document.getElementById('userMenu');
    menu.classList.toggle('show');
}

document.addEventListener('click', function(e) {
    const menu = document.getElementById('userMenu');
    const menuBtn = e.target.closest('.btn-menu');
    const menuContainer = e.target.closest('.user-menu-container');
    
    if (!menuBtn && !menuContainer && menu) {
        menu.classList.remove('show');
    }
});

function updateViewButtonsAuth(isAuthenticated) {
    const protectedViews = ['dashboard', 'namespace', 'editor', 'capabilities', 'instructions', 'code'];
    protectedViews.forEach(viewId => {
        const btn = document.getElementById(`viewBtn-${viewId}`);
        if (btn) {
            if (isAuthenticated) {
                btn.classList.remove('btn-disabled');
                btn.removeAttribute('title');
            } else {
                btn.classList.add('btn-disabled');
                btn.title = 'Sign in to access';
            }
        }
    });
}

async function checkAuthStatus() {
    try {
        const response = await fetch('/api/user');
        const data = await response.json();
        
        document.getElementById('authLoading').style.display = 'none';
        
        const landingPage = document.getElementById('landingPage');
        const mainContent = document.getElementById('mainContent');
        
        if (data.authenticated) {
            currentUser = data;
            document.getElementById('authLoggedIn').style.display = 'flex';
            document.getElementById('authLoggedOut').style.display = 'none';
            
            // Show simulator, hide landing page
            landingPage.style.display = 'none';
            mainContent.style.display = 'block';
            document.body.classList.remove('landing-mode');
            
            const avatar = document.getElementById('userAvatar');
            if (data.profile_image_url) {
                avatar.src = data.profile_image_url;
                avatar.style.display = 'block';
            } else {
                avatar.style.display = 'none';
            }
            
            const userName = document.getElementById('userName');
            userName.textContent = data.first_name || data.email || 'User';
            
            console.log('[INFO] Logged in as:', data.email || data.id);
            
            checkEnvironment();
            updateViewButtonsAuth(true);
        } else {
            checkEnvironment();
            currentUser = null;
            document.getElementById('authLoggedIn').style.display = 'none';
            document.getElementById('authLoggedOut').style.display = 'none';
            
            // Show landing page, hide simulator
            landingPage.style.display = 'block';
            mainContent.style.display = 'none';
            document.body.classList.add('landing-mode');
            updateViewButtonsAuth(false);
        }
    } catch (err) {
        console.error('Auth check failed:', err);
        document.getElementById('authLoading').style.display = 'none';
        document.getElementById('authLoggedOut').style.display = 'none';
        
        // Show landing page on error
        const landingPage = document.getElementById('landingPage');
        const mainContent = document.getElementById('mainContent');
        landingPage.style.display = 'block';
        mainContent.style.display = 'none';
        document.body.classList.add('landing-mode');
    }
}

async function saveStateToServer() {
    if (!currentUser) {
        alert('Please sign in to save your state');
        return;
    }
    
    try {
        const stateData = {
            namespace: window.namespaceObjects || {},
            bootCList: window.bootCList || [],
            contextRegisters: window.contextRegisters || {},
            dataRegisters: window.dataRegisters || {},
            flags: window.simulatorState?.flags || {},
            callStack: window.callStack || []
        };
        
        const editor = document.getElementById('codeEditor');
        const assemblyCode = editor ? editor.value : '';
        
        const response = await fetch('/api/state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'default',
                state_data: JSON.stringify(stateData),
                assembly_code: assemblyCode
            })
        });
        
        const result = await response.json();
        if (result.success) {
            editorLog('State saved to your account', 'success');
        } else {
            editorLog('Failed to save state', 'error');
        }
    } catch (err) {
        console.error('Save failed:', err);
        editorLog('Save failed: ' + err.message, 'error');
    }
}

async function loadStateFromServer() {
    if (!currentUser) {
        alert('Please sign in to load your saved state');
        return;
    }
    
    try {
        const response = await fetch('/api/state?name=default');
        const result = await response.json();
        
        if (result.found) {
            const stateData = JSON.parse(result.state_data);
            
            if (stateData.namespace) window.namespaceObjects = stateData.namespace;
            if (stateData.bootCList) window.bootCList = stateData.bootCList;
            if (stateData.contextRegisters) window.contextRegisters = stateData.contextRegisters;
            if (stateData.dataRegisters) window.dataRegisters = stateData.dataRegisters;
            if (stateData.flags && window.simulatorState) window.simulatorState.flags = stateData.flags;
            if (stateData.callStack) window.callStack = stateData.callStack;
            
            if (result.assembly_code) {
                const editor = document.getElementById('codeEditor');
                if (editor) {
                    editor.value = result.assembly_code;
                    savedEditorContent = result.assembly_code;
                    updateLineNumbers();
                }
            }
            
            updateContextRegistersDisplay();
            updateDataRegistersDisplay();
            updateFlagsDisplay();
            updateStackDisplay();
            editorLog('State loaded from your account', 'success');
        } else {
            editorLog('No saved state found', 'info');
        }
    } catch (err) {
        console.error('Load failed:', err);
        editorLog('Load failed: ' + err.message, 'error');
    }
}

let isDevelopmentMode = false;
let landingEditMode = false;
let originalLandingContent = {};

async function checkEnvironment() {
    try {
        const response = await fetch('/api/environment');
        const data = await response.json();
        isDevelopmentMode = data.is_development;
        
        if (isDevelopmentMode && currentUser) {
            const editLandingBtn = document.getElementById('editLandingBtn');
            if (editLandingBtn) {
                editLandingBtn.style.display = 'block';
            }
        }
        
        updateTutorialEditButtonsVisibility();
    } catch (err) {
        console.error('Environment check failed:', err);
    }
}

function updateTutorialEditButtonsVisibility() {
    const tutorialEditButtons = document.getElementById('tutorialEditButtons');
    if (tutorialEditButtons) {
        if (!isDevelopmentMode || landingEditMode) {
            tutorialEditButtons.style.display = 'none';
        } else {
            tutorialEditButtons.style.display = 'flex';
        }
    }
}

function showLandingPageEditor() {
    if (!isDevelopmentMode) {
        alert('Editing is only available in development mode');
        return;
    }
    
    const landingPage = document.getElementById('landingPage');
    const mainContent = document.getElementById('mainContent');
    const editControls = document.getElementById('landingEditControls');
    
    landingPage.style.display = 'block';
    mainContent.style.display = 'none';
    editControls.style.display = 'flex';
    
    toggleLandingEditMode();
    updateTutorialEditButtonsVisibility();
}

function exitLandingPageEditor() {
    const landingPage = document.getElementById('landingPage');
    const mainContent = document.getElementById('mainContent');
    const editControls = document.getElementById('landingEditControls');
    
    landingPage.style.display = 'none';
    mainContent.style.display = 'block';
    editControls.style.display = 'none';
    document.body.classList.remove('landing-mode');
    updateTutorialEditButtonsVisibility();
}

function showTutorialFromLanding() {
    viewingTutorialFromLanding = true;
    const landingPage = document.getElementById('landingPage');
    const mainContent = document.getElementById('mainContent');
    
    landingPage.style.display = 'none';
    mainContent.style.display = 'block';
    document.body.classList.remove('landing-mode');
    
    switchView('tutorial');
    
    const backBtn = document.getElementById('tutorialBackToLanding');
    if (backBtn) {
        backBtn.style.display = 'inline-block';
    }
    
    const tutorialSection = document.getElementById('tutorial');
    if (tutorialSection) {
        tutorialSection.scrollTop = 0;
    }
    window.scrollTo(0, 0);
}

function returnToLandingFromTutorial() {
    viewingTutorialFromLanding = false;
    const landingPage = document.getElementById('landingPage');
    const mainContent = document.getElementById('mainContent');
    
    landingPage.style.display = 'block';
    mainContent.style.display = 'none';
    document.body.classList.add('landing-mode');
    
    const backBtn = document.getElementById('tutorialBackToLanding');
    if (backBtn) {
        backBtn.style.display = 'none';
    }
}

async function loadLandingContent() {
    try {
        const response = await fetch('/api/landing-content');
        const data = await response.json();
        
        if (data.contents) {
            for (const [key, content] of Object.entries(data.contents)) {
                const section = document.querySelector(`[data-section="${key}"]`);
                if (section) {
                    section.innerHTML = content;
                }
            }
        }
    } catch (err) {
        console.error('Failed to load landing content:', err);
    }
}

function toggleLandingEditMode() {
    const welcomeSection = document.getElementById('landingWelcome');
    const cloocmSection = document.getElementById('landingCloomc');
    
    if (!landingEditMode) {
        landingEditMode = true;
        originalLandingContent = {
            welcome: welcomeSection.innerHTML,
            cloomc: cloocmSection.innerHTML
        };
        
        welcomeSection.classList.add('editing');
        cloocmSection.classList.add('editing');
        
        makeEditable(welcomeSection);
        makeEditable(cloocmSection);
    }
}

function makeEditable(container) {
    container.setAttribute('contenteditable', 'true');
}

function removeEditable(container) {
    container.removeAttribute('contenteditable');
}

function addLinkToSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
        alert('Please select some text first');
        return;
    }
    
    const url = prompt('Enter the URL for this link:', 'https://');
    if (!url || url === 'https://') {
        return;
    }
    
    const range = selection.getRangeAt(0);
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    
    try {
        range.surroundContents(link);
    } catch (e) {
        alert('Cannot create link across multiple elements. Select text within a single paragraph.');
    }
}

function removeLinkFromSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
        alert('Please select some text first');
        return;
    }
    
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const link = container.nodeType === 3 ? container.parentElement.closest('a') : container.closest('a');
    
    if (link) {
        const parent = link.parentNode;
        while (link.firstChild) {
            parent.insertBefore(link.firstChild, link);
        }
        parent.removeChild(link);
    } else {
        alert('No link found in selection');
    }
}

function cancelLandingEdit() {
    const welcomeSection = document.getElementById('landingWelcome');
    const cloocmSection = document.getElementById('landingCloomc');
    
    if (originalLandingContent.welcome) {
        welcomeSection.innerHTML = originalLandingContent.welcome;
    }
    if (originalLandingContent.cloomc) {
        cloocmSection.innerHTML = originalLandingContent.cloomc;
    }
    
    landingEditMode = false;
    welcomeSection.classList.remove('editing');
    cloocmSection.classList.remove('editing');
    removeEditable(welcomeSection);
    removeEditable(cloocmSection);
    
    exitLandingPageEditor();
}

async function saveLandingContent() {
    if (!isDevelopmentMode) {
        alert('Editing is only available in development mode');
        return;
    }
    
    const welcomeSection = document.getElementById('landingWelcome');
    const cloocmSection = document.getElementById('landingCloomc');
    
    try {
        const welcomeResponse = await fetch('/api/landing-content', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                section_key: 'welcome',
                content: welcomeSection.innerHTML
            })
        });
        
        const cloocmResponse = await fetch('/api/landing-content', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                section_key: 'cloomc',
                content: cloocmSection.innerHTML
            })
        });
        
        const welcomeResult = await welcomeResponse.json();
        const cloocmResult = await cloocmResponse.json();
        
        if (welcomeResult.success && cloocmResult.success) {
            landingEditMode = false;
            welcomeSection.classList.remove('editing');
            cloocmSection.classList.remove('editing');
            removeEditable(welcomeSection);
            removeEditable(cloocmSection);
            
            alert('Landing page content saved successfully!');
            exitLandingPageEditor();
        } else {
            alert('Failed to save some content');
        }
    } catch (err) {
        console.error('Save failed:', err);
        alert('Failed to save: ' + err.message);
    }
}

let pendingTunnelMessages = [];

function checkRv32TunnelNotifications() {
    const raw = localStorage.getItem('rv32cap-tunnel-notification');
    if (!raw) return;
    try {
        const queue = JSON.parse(raw);
        if (!Array.isArray(queue)) return;
        let changed = false;
        for (const notif of queue) {
            if (notif && notif.target === 'ctmm' && !notif.seen) {
                pendingTunnelMessages.push(notif);
                notif.seen = true;
                changed = true;
            }
        }
        if (changed) {
            const pruned = queue.filter(n => !n.seen || (Date.now() - (n.timestamp || 0)) < 300000);
            localStorage.setItem('rv32cap-tunnel-notification', JSON.stringify(pruned));
            updateCtmmNotifyBadge();
        }
    } catch(e) {}
}

function updateCtmmNotifyBadge() {
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

function showTunnelNotification() {
    if (pendingTunnelMessages.length === 0) return;
    const notif = pendingTunnelMessages.shift();
    updateCtmmNotifyBadge();

    const existing = document.getElementById('tunnelMsgOverlay');
    if (existing) existing.remove();

    const items = (notif.details && notif.details.items) || [];
    const from = (notif.details && notif.details.from) || '<b>Priscilla</b> (Capability Sim-32)';
    const to = (notif.details && notif.details.to) || '<b>Kenneth</b> (CM Sim-64)';
    const message = notif.message || 'Hello Son';

    showTunnelMessage('receive', message, {
        from: from,
        to: to,
        items: items.length > 0 ? items : [
            { label: 'Instruction', value: 'CALL(CONNECT(mymother, son))' },
            { label: 'Golden Tokens', value: '3 (Tunnel Key + ABI + Reply Tunnel)' },
            { label: 'ABI Mapping', value: 'x10-x15 (32-bit) \u2192 DR0-DR5 (64-bit)' }
        ]
    }, notif.timestamp);
}

window.addEventListener('storage', (e) => {
    if (e.key === 'rv32cap-tunnel-notification') {
        checkRv32TunnelNotifications();
    }
});

const hp35State = {
    stack: [0, 0, 0, 0],
    display: '0',
    inputMode: false,
    hasDecimal: false,
    lastEntry: false,
    arcMode: false,
    trace: [],
    maxTrace: 50
};

function hp35TraceLog(lambdaExpr, desc) {
    hp35State.trace.unshift({ lambda: lambdaExpr, desc: desc, time: Date.now() });
    if (hp35State.trace.length > hp35State.maxTrace) hp35State.trace.pop();
}

function hp35StackLift() {
    hp35State.stack[3] = hp35State.stack[2];
    hp35State.stack[2] = hp35State.stack[1];
    hp35State.stack[1] = hp35State.stack[0];
}

function hp35StackDrop() {
    hp35State.stack[0] = hp35State.stack[1];
    hp35State.stack[1] = hp35State.stack[2];
    hp35State.stack[2] = hp35State.stack[3];
}

function hp35UpdateDisplay() {
    const val = hp35State.stack[0];
    if (hp35State.inputMode) {
        hp35State.display = hp35State.display;
    } else {
        if (val === 0) {
            hp35State.display = '0.';
        } else if (Math.abs(val) >= 1e10 || (Math.abs(val) < 0.001 && val !== 0)) {
            hp35State.display = val.toExponential(9).replace('e+', ' ').replace('e-', ' -').replace('e', ' ');
        } else {
            let s = val.toPrecision(10);
            if (s.indexOf('.') === -1) s += '.';
            hp35State.display = s;
        }
    }
    renderHP35Display();
}

function hp35PressDigit(d) {
    if (!hp35State.inputMode) {
        if (hp35State.lastEntry) {
            hp35State.lastEntry = false;
        } else {
            hp35StackLift();
        }
        hp35State.display = '';
        hp35State.inputMode = true;
        hp35State.hasDecimal = false;
    }
    if (d === '.' && hp35State.hasDecimal) return;
    if (d === '.') hp35State.hasDecimal = true;
    hp35State.display += d;
    hp35State.stack[0] = parseFloat(hp35State.display) || 0;

    const churchDigit = d === '.' ? 'DECIMAL' : `SUCC^${d}(ZERO)`;
    hp35TraceLog(`DIGIT(${churchDigit})`, `Key: ${d} → display "${hp35State.display}"`);
    hp35UpdateDisplay();
}

function hp35PressEnter() {
    hp35State.inputMode = false;
    hp35StackLift();
    hp35State.lastEntry = true;
    hp35TraceLog('PUSH X → PAIR(X, PAIR(Y, PAIR(Z, T)))', `ENTER: X=${hp35State.stack[0]} pushed, stack lifted`);
    hp35UpdateDisplay();
}

function hp35BinaryOp(name, fn, lambdaExpr) {
    hp35State.inputMode = false;
    const x = hp35State.stack[0];
    const y = hp35State.stack[1];
    const result = fn(y, x);
    if (!isFinite(result)) {
        hp35TraceLog(`${lambdaExpr}(${y}, ${x})`, `FAULT: ${name} → not finite`);
        return;
    }
    hp35StackDrop();
    hp35State.stack[0] = result;
    hp35TraceLog(`${lambdaExpr}(${y}, ${x}) = ${result}`, `${name}: ${y} ${name} ${x} = ${result}`);
    hp35UpdateDisplay();
}

function hp35UnaryOp(name, fn, lambdaExpr) {
    hp35State.inputMode = false;
    const x = hp35State.stack[0];
    const result = fn(x);
    if (!isFinite(result)) {
        hp35TraceLog(`${lambdaExpr}(${x})`, `FAULT: ${name} → not finite`);
        return;
    }
    hp35State.stack[0] = result;
    hp35TraceLog(`${lambdaExpr}(${x}) = ${result}`, `${name}: f(${x}) = ${result}`);
    hp35UpdateDisplay();
}

function hp35PressOp(op) {
    switch(op) {
        case '+': hp35BinaryOp('+', (a,b) => a+b, 'CHURCH_ADD'); break;
        case '-': hp35BinaryOp('-', (a,b) => a-b, 'CHURCH_SUB'); break;
        case '×': hp35BinaryOp('×', (a,b) => a*b, 'CHURCH_MUL'); break;
        case '÷': hp35BinaryOp('÷', (a,b) => b===0 ? Infinity : a/b, 'CHURCH_DIV'); break;
        case 'yˣ': hp35BinaryOp('yˣ', (a,b) => Math.pow(a,b), 'CHURCH_POW'); break;
        case '√x': hp35UnaryOp('√x', Math.sqrt, 'Y(λf.λg. IF(LEQ(MUL g g) x)(f(SUCC g))(PRED g)) 0'); break;
        case 'sin':
            if (hp35State.arcMode) {
                hp35UnaryOp('arcsin', Math.asin, 'ARC(SIN_TAYLOR)');
                hp35State.arcMode = false;
            } else {
                hp35UnaryOp('sin', Math.sin, 'SIN_TAYLOR(x - x³/3! + x⁵/5! - ...)');
            }
            break;
        case 'cos':
            if (hp35State.arcMode) {
                hp35UnaryOp('arccos', Math.acos, 'ARC(COS_TAYLOR)');
                hp35State.arcMode = false;
            } else {
                hp35UnaryOp('cos', Math.cos, 'COS_TAYLOR(1 - x²/2! + x⁴/4! - ...)');
            }
            break;
        case 'tan':
            if (hp35State.arcMode) {
                hp35UnaryOp('arctan', Math.atan, 'ARC(DIV(SIN,COS))');
                hp35State.arcMode = false;
            } else {
                hp35UnaryOp('tan', Math.tan, 'DIV(SIN_TAYLOR, COS_TAYLOR)');
            }
            break;
        case 'log': hp35UnaryOp('log₁₀', Math.log10, 'DIV(LN_SERIES(x), LN_SERIES(10))'); break;
        case 'ln': hp35UnaryOp('ln', Math.log, 'Y(λf.λx. LN_SERIES(x))'); break;
        case 'eˣ': hp35UnaryOp('eˣ', Math.exp, 'EXP_TAYLOR(1 + x + x²/2! + x³/3! + ...)'); break;
        case '1/x': hp35UnaryOp('1/x', x => x===0 ? Infinity : 1/x, 'CHURCH_DIV(SUCC ZERO, x)'); break;
        case 'x²': hp35UnaryOp('x²', x => x*x, 'CHURCH_MUL(x, x)'); break;
        case 'π':
            hp35State.inputMode = false;
            hp35StackLift();
            hp35State.stack[0] = Math.PI;
            hp35TraceLog('CALL Constants(GT_PI) → DR0', `π = ${Math.PI}`);
            hp35UpdateDisplay();
            break;
        case 'CHS':
            hp35State.stack[0] = -hp35State.stack[0];
            if (hp35State.inputMode && hp35State.display.startsWith('-')) {
                hp35State.display = hp35State.display.slice(1);
            } else if (hp35State.inputMode) {
                hp35State.display = '-' + hp35State.display;
            }
            hp35TraceLog('PAIR(NOT(FST sign), SND magnitude)', `CHS: ${-hp35State.stack[0]} → ${hp35State.stack[0]}`);
            hp35UpdateDisplay();
            break;
        case 'CLX':
            hp35State.stack[0] = 0;
            hp35State.display = '0.';
            hp35State.inputMode = false;
            hp35TraceLog('PAIR(ZERO, SND stack)', 'CLX: clear X register');
            hp35UpdateDisplay();
            break;
        case 'CLR':
            hp35State.stack = [0, 0, 0, 0];
            hp35State.display = '0.';
            hp35State.inputMode = false;
            hp35State.hasDecimal = false;
            hp35TraceLog('FALSE — empty stack', 'CLR: clear all registers');
            hp35UpdateDisplay();
            break;
        case 'x⇄y':
            const tmp = hp35State.stack[0];
            hp35State.stack[0] = hp35State.stack[1];
            hp35State.stack[1] = tmp;
            hp35State.inputMode = false;
            hp35TraceLog('PAIR(FST(SND s))(PAIR(FST s)(SND(SND s)))', `SWAP: X=${hp35State.stack[0]}, Y=${hp35State.stack[1]}`);
            hp35UpdateDisplay();
            break;
        case 'R↓':
            const t0 = hp35State.stack[0];
            hp35State.stack[0] = hp35State.stack[1];
            hp35State.stack[1] = hp35State.stack[2];
            hp35State.stack[2] = hp35State.stack[3];
            hp35State.stack[3] = t0;
            hp35State.inputMode = false;
            hp35TraceLog('ROTATE_DOWN(stack)', `R↓: X=${hp35State.stack[0]} Y=${hp35State.stack[1]} Z=${hp35State.stack[2]} T=${hp35State.stack[3]}`);
            hp35UpdateDisplay();
            break;
        case 'STO':
            hp35TraceLog('SAVE(X, LocalData)', `STO: stored ${hp35State.stack[0]}`);
            break;
        case 'RCL':
            hp35TraceLog('LOAD(LocalData) → X', `RCL: recalled value`);
            break;
        case 'EEX':
            hp35State.inputMode = false;
            hp35TraceLog('MUL(x, POW(10, e))', 'EEX: enter exponent mode');
            break;
        case 'ARC':
            hp35State.arcMode = !hp35State.arcMode;
            hp35TraceLog('TOGGLE(arc_mode)', `ARC: ${hp35State.arcMode ? 'ON' : 'OFF'} — next trig uses inverse`);
            renderHP35Display();
            break;
    }
}

function renderHP35Display() {
    const displayEl = document.querySelector('.hp35-screen-value');
    if (displayEl) displayEl.textContent = hp35State.display;

    const arcIndicator = document.querySelector('.hp35-arc-indicator');
    if (arcIndicator) arcIndicator.style.visibility = hp35State.arcMode ? 'visible' : 'hidden';

    for (let i = 0; i < 4; i++) {
        const el = document.querySelector(`.hp35-stack-reg[data-reg="${i}"]`);
        if (el) {
            const labels = ['X','Y','Z','T'];
            const val = hp35State.stack[i];
            let valStr;
            if (i === 0 && hp35State.inputMode) {
                valStr = hp35State.display;
            } else if (Math.abs(val) >= 1e10 || (Math.abs(val) < 0.001 && val !== 0)) {
                valStr = val.toExponential(6);
            } else {
                valStr = val.toPrecision(10);
            }
            el.innerHTML = `<span class="hp35-reg-label">${labels[i]}:</span> <span class="hp35-reg-value">${valStr}</span>`;
        }
    }

    const traceEl = document.getElementById('hp35TracePanel');
    if (traceEl) {
        let traceHtml = '<div class="hp35-trace-header">Lambda Calculus Trace</div>';
        traceHtml += '<div class="hp35-trace-list">';
        hp35State.trace.forEach((t, idx) => {
            traceHtml += `<div class="hp35-trace-entry ${idx === 0 ? 'hp35-trace-latest' : ''}">`;
            traceHtml += `<div class="hp35-trace-lambda">${t.lambda}</div>`;
            traceHtml += `<div class="hp35-trace-desc">${t.desc}</div>`;
            traceHtml += '</div>';
        });
        traceHtml += '</div>';
        traceEl.innerHTML = traceHtml;
    }
}

function renderHP35Calculator() {
    const infoPanel = document.getElementById('hp35InfoPanel');
    const calcPanel = document.getElementById('hp35CalcPanel');
    const tracePanel = document.getElementById('hp35TracePanel');

    infoPanel.innerHTML = `
        <div class="hp35-info-card">
            <div class="hp35-info-title">HP-35 Scientific Calculator</div>
            <div class="hp35-info-subtitle">Hewlett-Packard, 1972</div>
            <div class="hp35-info-desc">The world's first handheld scientific calculator, reimplemented as a CM abstraction using pure lambda calculus.</div>
            <div class="hp35-info-section">
                <div class="hp35-info-label">Architecture</div>
                <div class="hp35-info-detail">RPN (Reverse Polish Notation) — no equals key, no parentheses. Enter operands first, then apply the operator.</div>
            </div>
            <div class="hp35-info-section">
                <div class="hp35-info-label">Lambda Foundation</div>
                <div class="hp35-info-detail">All arithmetic uses Church numerals (λf.λx. f(f(...x))). Stack is nested pairs: PAIR(top, rest). Constants are Abstract GTs from the Constants abstraction.</div>
            </div>
            <div class="hp35-info-section">
                <div class="hp35-info-label">4-Register Stack</div>
                <div class="hp35-stack-display">
                    <div class="hp35-stack-reg" data-reg="3"></div>
                    <div class="hp35-stack-reg" data-reg="2"></div>
                    <div class="hp35-stack-reg" data-reg="1"></div>
                    <div class="hp35-stack-reg" data-reg="0"></div>
                </div>
            </div>
            <div class="hp35-info-section">
                <div class="hp35-info-label">Abstraction Dependencies</div>
                <div class="hp35-deps">
                    <span class="hp35-dep-badge" onclick="zoomToAbstraction('Lambda')">Lambda</span>
                    <span class="hp35-dep-badge" onclick="zoomToAbstraction('Stack')">Stack</span>
                    <span class="hp35-dep-badge" onclick="zoomToAbstraction('Constants')">Constants</span>
                </div>
            </div>
        </div>
    `;

    calcPanel.innerHTML = `
        <div class="hp35-body">
            <div class="hp35-brand">
                <span class="hp35-hp-logo">HEWLETT · PACKARD</span>
                <span class="hp35-model">35</span>
            </div>
            <div class="hp35-screen">
                <div class="hp35-arc-indicator" style="visibility:hidden">ARC</div>
                <div class="hp35-screen-value">${hp35State.display}</div>
            </div>
            <div class="hp35-keys">
                <div class="hp35-key-row">
                    <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('x²')">x²</button>
                    <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('√x')">√x</button>
                    <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('eˣ')">eˣ</button>
                    <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('log')">LOG</button>
                    <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('ln')">LN</button>
                </div>
                <div class="hp35-key-row">
                    <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('ARC')">ARC</button>
                    <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('sin')">SIN</button>
                    <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('cos')">COS</button>
                    <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('tan')">TAN</button>
                    <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('1/x')">1/x</button>
                </div>
                <div class="hp35-key-row">
                    <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('x⇄y')">x⇄y</button>
                    <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('R↓')">R↓</button>
                    <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('STO')">STO</button>
                    <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('RCL')">RCL</button>
                    <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('yˣ')">yˣ</button>
                </div>
                <div class="hp35-key-row">
                    <button class="hp35-key hp35-key-enter" onclick="hp35PressEnter()">ENTER ↑</button>
                    <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('CHS')">CHS</button>
                    <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('EEX')">EEX</button>
                    <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('CLX')">CLX</button>
                </div>
                <div class="hp35-key-row">
                    <button class="hp35-key hp35-key-digit" onclick="hp35PressDigit('7')">7</button>
                    <button class="hp35-key hp35-key-digit" onclick="hp35PressDigit('8')">8</button>
                    <button class="hp35-key hp35-key-digit" onclick="hp35PressDigit('9')">9</button>
                    <button class="hp35-key hp35-key-op" onclick="hp35PressOp('+')">+</button>
                    <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('π')">π</button>
                </div>
                <div class="hp35-key-row">
                    <button class="hp35-key hp35-key-digit" onclick="hp35PressDigit('4')">4</button>
                    <button class="hp35-key hp35-key-digit" onclick="hp35PressDigit('5')">5</button>
                    <button class="hp35-key hp35-key-digit" onclick="hp35PressDigit('6')">6</button>
                    <button class="hp35-key hp35-key-op" onclick="hp35PressOp('-')">−</button>
                    <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('CLR')">CLR</button>
                </div>
                <div class="hp35-key-row">
                    <button class="hp35-key hp35-key-digit" onclick="hp35PressDigit('1')">1</button>
                    <button class="hp35-key hp35-key-digit" onclick="hp35PressDigit('2')">2</button>
                    <button class="hp35-key hp35-key-digit" onclick="hp35PressDigit('3')">3</button>
                    <button class="hp35-key hp35-key-op" onclick="hp35PressOp('×')">×</button>
                    <button class="hp35-key" style="visibility:hidden"></button>
                </div>
                <div class="hp35-key-row">
                    <button class="hp35-key hp35-key-digit" onclick="hp35PressDigit('0')">0</button>
                    <button class="hp35-key hp35-key-digit" onclick="hp35PressDigit('.')">.</button>
                    <button class="hp35-key" style="visibility:hidden"></button>
                    <button class="hp35-key hp35-key-op" onclick="hp35PressOp('÷')">÷</button>
                    <button class="hp35-key" style="visibility:hidden"></button>
                </div>
            </div>
        </div>
    `;

    hp35UpdateDisplay();
}

document.addEventListener('DOMContentLoaded', () => {
    checkAuthStatus();
    loadLandingContent();
    checkRv32TunnelNotifications();
    setInterval(checkRv32TunnelNotifications, 2000);
    loadHwInstrReference();
});

async function loadHwInstrReference() {
    const el = document.getElementById('hwInstrContent');
    if (!el) return;
    try {
        const r = await fetch('/docs/instruction-set.md?t=' + Date.now());
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const md = await r.text();
        el.innerHTML = '<div class="markdown-body">' + renderMarkdown(md) + '</div>';
    } catch (err) {
        el.innerHTML = '<p style="color:var(--danger);">Could not load hardware reference: ' + err.message + '</p>';
    }
}
