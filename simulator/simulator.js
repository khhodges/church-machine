// =============================================================================
// simulator.js — Church Machine CPU Simulator
// =============================================================================
//
// This is the heart of the browser-based Church Machine IDE.  It implements a
// cycle-accurate (at the instruction level) simulation of the Church Machine
// CPU — a capability-based computer architecture targeting the Efinix Ti60
// F225 FPGA.
//
// PRIMARY CLASS
//   ChurchSimulator
//     Instantiated once in app.js as `sim`.  Emits 'stateChange' events so the
//     IDE UI can re-render after every instruction or boot step.
//
// MEMORY MAP  (all addresses are word-addressed 32-bit words)
//   0x0000 – 0xFCFF   Object lumps  (heap / stack / thread lumps)
//   0xFD00 – 0xFDFF   Namespace (NS) table  — up to 256 × 3-word entries
//   0xFE00 – 0xFEFF   I/O segment  — memory-mapped device registers
//   0xFF00 – 0xFFFF   Boot ROM  — read-only; written during _bootStep()
//
// NAMESPACE TABLE (NS)
//   Each entry is 3 words wide:
//     word0  location   — base address of the abstraction's lump (Golden Token)
//     word1  limit/meta — bits[16:0] lump size in words; bits[25:17] c-list
//                         count; bits[27:26] GT type (Null/Inform/Outform/
//                         Abstract); bit[28] chainable; bit[29] f-flag;
//                         bit[30] b-flag; bit[31] G-bit (GC liveness)
//     word2  seals      — bits[31:25] version; bits[15:0] CRC-16 seal
//
// THREAD LUMP LAYOUT  (256 words, NS[1] "Boot.Thread")
//   +0        Header word
//   +1..+16   Data Registers  DR0–DR15
//   +17..+80  Heap (64 words)
//   +81..+211 Free space
//   +212..+243 Stack (32 words, grows down from +243)
//   +244..+255 Caps zone — GT home slots for CR0–CR11 (CR6=c-list root)
//
// CAPABILITY REGISTERS (CRs)
//   CR0–CR11   General-purpose GT holders
//   CR12       Thread identity (privileged)
//   CR13       IRQ / system reserved
//   CR14       Privileged
//   CR15       Current abstraction (set by CALL, cleared by RETURN)
//   CR6        C-list root — points to the abstraction's capability list
//
// BOOT SEQUENCE  (_bootStep)
//   Step 0   CHANGE  — set DR0 to boot sentinel
//   Step 1   LOAD    — CR15 ← NS[3] (Boot.Kernel)
//   Step 2   CALL    — push sentinel frame, enter Boot.Kernel
//   Step 3   ELOADCALL — load+call Boot.Init
//   Step 4   RETURN  — unwind sentinel frame, boot complete
//   The full sequence mirrors hardware/boot_rom.py BOOT_PROGRAM exactly.
//
// GARBAGE COLLECTOR  (runGC)
//   Tri-colour mark-sweep over the NS table.
//   Phase 1 MARK  — flip G-bit on all valid entries → garbage suspects
//   Phase 2 SCAN  — walk CR0–CR15 + call-stack frames; mark reachable entries live
//   Phase 3 SWEEP — collect entries still marked garbage
//   Phase 4 CLEAR — zero NS words + lump words; bump version; flip polarity
//
// INSTRUCTION SET  (partial — see assembler.js for full encoding)
//   LOAD, SAVE, CALL, RETURN, CHANGE, SWITCH, TPERM, LAMBDA
//   ELOADCALL, XLOADLAMBDA, DREAD, DWRITE
//   BFEXT, BFINS, MCMP, IADD, ISUB, BRANCH, SHL, SHR
//
// KEY METHODS
//   boot()           — run the full boot sequence to completion
//   _bootStep()      — execute one boot step (for single-stepping)
//   step()           — execute one user instruction
//   runGC()          — run a full GC cycle; returns structured phases[]
//   readNSEntry(i)   — parse all fields of NS entry i into a plain object
//   parseGT(word0)   — decode a Golden Token word into index/version/type
//   parseNSWord1(w)  — decode limit/clistCount/gtType/G-bit from word1
//   markGarbage(i)   — set G-bit to current garbage polarity
//   markLive(i)      — set G-bit to current live polarity
//   isNSEntryValid(i)— true if word0 or word1 is non-zero
//
// HARDWARE CROSS-REFERENCE
//   hardware/boot_rom.py   — Amaranth HDL boot ROM (BOOT_PROGRAM, DEMO_CLIST,
//                            DEMO_NAMESPACE); _bootStep() mirrors this exactly
//   hardware/call.py       — CALL/RETURN micro-op implementation
//
// =============================================================================

// Offset of the caps zone (CR0-CR11 GT home slots) inside a 256-word thread lump
const THREAD_CAPS_OFFSET = 244;

class ChurchSimulator {
    constructor() {
        this._listeners = {};
        this.NS_TABLE_BASE = 0xFD00;
        this.NS_ENTRY_WORDS = 3;
        this.MAX_NS_ENTRIES = 256;
        this.SLOT_SIZE = 0x40;   // 64 words — FPGA minimum slot allocation (boot_rom.py line 339)

        this.abstractionRegistry = null;
        this.systemAbstractions = null;
        this.deviceAbstractions = null;

        this.reset();
    }

    initAbstractions(registry, systemAbs, deviceAbs) {
        this.abstractionRegistry = registry;
        this.systemAbstractions = systemAbs;
        this.deviceAbstractions = deviceAbs;
    }

    on(event, fn) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(fn);
    }

    emit(event, data) {
        (this._listeners[event] || []).forEach(fn => fn(data));
    }

    reset() {
        this.cr = [];
        for (let i = 0; i < 16; i++) {
            this.cr[i] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
        }

        this.dr = new Array(16).fill(0);

        this.pc = 0;
        this.physicalPC = 0;
        this.flags = { N: false, Z: false, C: false, V: false };
        this.sto = 243;  // sp_max = lumpSize(256) - caps(12) - 1; hardware starts here, CALL decrements
        this.running = false;
        this.halted = false;
        this.stepCount = 0;
        this.output = '';
        this.callStack = [];
        this.lambdaActive = false;
        this.lambdaReturnPC = 0;
        this.faultLog = [];
        this._instrHistory = [];

        this.memory = new Uint32Array(65536);

        this.nsLabels = {};
        this.nsCount = 0;
        this.gcPolarity = 0;
        this.nsHandlers = {};
        this.nsClistMap = {};

        this.bootComplete = false;
        this.mElevation = false;
        this.bootStep = 0;
        this.ledBits = 0;
        this.ledMode = 'boot';
        this.lastCapability = null;
        this.auditLog = [];

        this._initNamespaceTable();
        this.output += '--- HARD RESET: all registers zeroed ---\n';
        this.output += 'Boot microcode ready. Step or Run to begin boot sequence.\n';
        this.emit('reset', {});
        this.emit('stateChange', this.getState());
    }

    _returnToBoot() {
        for (let i = 0; i < 16; i++) {
            this._clearCR(i);
        }
        this.dr.fill(0);
        this.flags = { N: false, Z: false, C: false, V: false };
        this.sto = 243;  // sp_max reset
        this.callStack = [];
        this.lambdaActive = false;
        this.lambdaReturnPC = 0;
        this.pc = 0;
        this.physicalPC = 0;
        this.halted = false;
        this.running = false;
        this.bootComplete = false;
        this.mElevation = false;
        this.bootStep = 0;
        this.ledBits = 0;
        this.ledMode = 'boot';
        this.output += '[PP250] Machine state cleared. Re-entering boot sequence.\n';
        this.emit('stateChange', this.getState());
    }

    packNSWord1(limit17, bFlag, fFlag, gBit, chainable, gtType, clistCount) {
        return (
            ((bFlag & 1) << 31) |
            ((fFlag & 1) << 30) |
            ((gBit & 1) << 29) |
            ((chainable & 1) << 28) |
            ((gtType & 3) << 26) |
            (((clistCount || 0) & 0x1FF) << 17) |
            (limit17 & 0x1FFFF)
        ) >>> 0;
    }

    parseNSWord1(word1) {
        return {
            b: (word1 >>> 31) & 1,
            f: (word1 >>> 30) & 1,
            g: (word1 >>> 29) & 1,
            chainable: (word1 >>> 28) & 1,
            gtType: (word1 >>> 26) & 3,
            clistCount: (word1 >>> 17) & 0x1FF,
            limit: word1 & 0x1FFFF,
        };
    }

    packLimitWord(limit17, bFlag, fFlag) {
        return this.packNSWord1(limit17, bFlag, fFlag, 0, 0, 0, 0);
    }

    parseLimitWord(word1) {
        return this.parseNSWord1(word1);
    }

    // Lump header at word 0 of every abstraction/thread lump.
    // Format matches hardware LUMP_HEADER_LAYOUT in hardware/layouts.py:
    //   [31:27] magic    = 0x1F  — always; traps if CPU tries to execute it
    //   [26:23] n_minus_6        — lumpSize = 2^(val+6); 0 → 64 words (SLOT_SIZE)
    //   [22:10] cw               — code word count (0..8191)
    //   [ 9: 8] typ              — object type: 00=lump, 01=data, 10=Thread, 11=Outform
    //   [ 7: 0] cc               — c-list slot count (0..255)
    packLumpHeader(n_minus_6, cw, cc, typ = 0) {
        return (
            (0x1F              << 27) |
            ((n_minus_6 & 0xF) << 23) |
            ((cw & 0x1FFF)     << 10) |
            ((typ & 0x3)       <<  8) |
            (cc & 0xFF)
        ) >>> 0;
    }

    parseLumpHeader(word) {
        word = word >>> 0;
        const magic     = (word >>> 27) & 0x1F;
        const n_minus_6 = (word >>> 23) & 0xF;
        const cw        = (word >>> 10) & 0x1FFF;
        const typ       = (word >>>  8) & 0x3;
        const cc        = word & 0xFF;
        // lumpSize = 2^(n_minus_6+6): slot allocation in words (always a power of 2, ≥ 64).
        // Matches call.py line 402: lumpSize_reg.eq(Const(1,15) << (_hdr.n_minus_6 + 6)).
        // c-list starts at lumpBase + (lumpSize - cc), i.e. at the physical end of the slot
        // (call.py line 282: base = NS_base + (lumpSize − cc) × 4).
        const lumpSize  = 1 << (n_minus_6 + 6);
        return { magic, n_minus_6, lumpSize, cw, typ, cc, valid: magic === 0x1F };
    }

    writeNSEntry(idx, location, limit17, bFlag, fFlag, gBit, chainable, gtType, version, clistCount) {
        const base = this.NS_TABLE_BASE + idx * this.NS_ENTRY_WORDS;
        this.memory[base + 0] = location >>> 0;
        this.memory[base + 1] = this.packNSWord1(limit17, bFlag, fFlag, gBit, chainable, gtType, clistCount || 0);
        this.memory[base + 2] = this.makeVersionSeals(version || 0, location, limit17);
        if (idx >= this.nsCount) this.nsCount = idx + 1;
    }

    readNSEntry(idx) {
        if (idx < 0 || idx >= this.MAX_NS_ENTRIES) return null;
        const base = this.NS_TABLE_BASE + idx * this.NS_ENTRY_WORDS;
        const w0 = this.memory[base + 0];
        const w1 = this.memory[base + 1];
        const w2 = this.memory[base + 2];
        if (w0 === 0 && w1 === 0) return null;
        const parsed = this.parseNSWord1(w1);
        return {
            word0_location: w0,
            word1_limit: w1,
            word2_seals: w2,
            gBit: parsed.g,
            gtType: parsed.gtType,
            clistCount: parsed.clistCount,
            chainable: parsed.chainable ? true : false,
            label: this.nsLabels[idx] || '',
        };
    }

    isNSEntryValid(idx) {
        if (idx < 0 || idx >= this.MAX_NS_ENTRIES) return false;
        const base = this.NS_TABLE_BASE + idx * this.NS_ENTRY_WORDS;
        return (this.memory[base] !== 0 || this.memory[base + 1] !== 0);
    }

    get namespaceTable() {
        const entries = [];
        for (let i = 0; i < this.nsCount; i++) {
            entries.push(this.readNSEntry(i));
        }
        return entries;
    }

    _getAbstractionCatalog() {
        if (this.abstractionRegistry) {
            const all = this.abstractionRegistry.getAllAbstractions();
            return all.map(a => ({
                label: a.name,
                perms: a.perms,
                chainable: a.chainable || false,
                handler: a.handler || null,
            }));
        }
        return [
            { label: 'Boot.NS',      perms: {R:0,W:0,X:0,L:0,S:0,E:0}, chainable: false },
            { label: 'Boot.Thread',   perms: {R:0,W:0,X:0,L:0,S:0,E:0}, chainable: false },
            { label: 'Boot.Abstr',    perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: '(empty)',       perms: {R:0,W:0,X:0,L:0,S:0,E:0}, chainable: false },
            { label: 'Salvation',     perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Navana',        perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Mint',          perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Memory',        perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Scheduler',     perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Stack',         perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: true },
            { label: 'DijkstraFlag',  perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'UART',          perms: {R:0,W:0,X:0,L:1,S:1,E:1}, chainable: false },
            { label: 'LED',           perms: {R:0,W:0,X:0,L:1,S:1,E:1}, chainable: false },
            { label: 'Button',        perms: {R:0,W:0,X:0,L:1,S:0,E:1}, chainable: false },
            { label: 'Timer',         perms: {R:0,W:0,X:0,L:1,S:1,E:1}, chainable: false },
            { label: 'Display',       perms: {R:0,W:0,X:0,L:1,S:1,E:1}, chainable: false },
            { label: 'SlideRule',     perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: true },
            { label: 'Abacus',        perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: true },
            { label: 'Constants',     perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Circle',        perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'SUCC',          perms: {R:0,W:0,X:1,L:1,S:0,E:1}, chainable: false },
            { label: 'PRED',          perms: {R:0,W:0,X:1,L:1,S:0,E:1}, chainable: false },
            { label: 'ADD',           perms: {R:0,W:0,X:1,L:1,S:0,E:1}, chainable: false },
            { label: 'SUB',           perms: {R:0,W:0,X:1,L:1,S:0,E:1}, chainable: false },
            { label: 'MUL',           perms: {R:0,W:0,X:1,L:1,S:0,E:1}, chainable: false },
            { label: 'ISZERO',        perms: {R:0,W:0,X:1,L:1,S:0,E:1}, chainable: false },
            { label: 'TRUE',          perms: {R:0,W:0,X:0,L:1,S:0,E:0}, chainable: false },
            { label: 'FALSE',         perms: {R:0,W:0,X:0,L:1,S:0,E:0}, chainable: false },
            { label: 'Family',        perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Schoolroom',    perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Friends',       perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Tunnel',        perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Negotiate',     perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Editor',        perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Assembler',     perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Debugger',      perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Deployer',      perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Browser',       perms: {R:0,W:0,X:0,L:1,S:0,E:1}, chainable: false },
            { label: 'Messenger',     perms: {R:0,W:0,X:0,L:1,S:0,E:1}, chainable: false },
            { label: 'Photos',        perms: {R:0,W:0,X:0,L:1,S:0,E:1}, chainable: false },
            { label: 'Social',        perms: {R:0,W:0,X:0,L:1,S:0,E:1}, chainable: false },
            { label: 'Video',         perms: {R:0,W:0,X:0,L:1,S:0,E:1}, chainable: false },
            { label: 'Email',         perms: {R:0,W:0,X:0,L:1,S:0,E:1}, chainable: false },
            { label: 'PAIR',          perms: {R:0,W:0,X:1,L:1,S:0,E:1}, chainable: false },
            { label: 'GC',            perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false, handler: 'gc' },
            { label: 'Thread',        perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
        ];
    }

    _initNamespaceTable() {
        // GT type semantics: 0=NULL, 1=Inform (concrete lump in memory), 2=Outform (remote/F-bit), 3=Abstract (PassKey/value)
        // All boot-time slots (Boot.NS, Boot.Thread, Boot.Abstr, Salvation, Navana, Mint, etc.) are Inform (type=1)
        // because they reference concrete physical memory lumps in the namespace table.
        // Abstract (type=3) GTs are only created by Navana.Abstraction.Add (user uploads) and Navana.MintPassKey.
        this.nsLabels = {};
        this.nsCount = 0;
        const abstractions = this._getAbstractionCatalog();
        const clistChildren = [];
        const clistGTs = [];

        // Hardware-accurate device register sizes (matches boot_rom.py _MMIO_ENTRIES)
        // LED:   5 words (LED0–LED4, one per LED; bit[0]=R drives pin)      → limit17 = 4
        // UART:  3 words (TX@0, STATUS@1, RX@2)                             → limit17 = 2
        // Button:1 word  (button state bitmask)                              → limit17 = 0
        // Timer: 5 words (TICKS_LO, TICKS_HI, TOD_EPOCH, ALARM_CMP, CTL)   → limit17 = 4
        const DEVICE_REG_LIMITS = { 11: 2, 12: 4, 13: 0, 14: 4 };

        const THREAD_LUMP_SIZE = 256;
        const BOOT_ABSTR_LUMP_SIZE = 256;
        const slotSizes = {};
        slotSizes[1] = THREAD_LUMP_SIZE;
        slotSizes[2] = BOOT_ABSTR_LUMP_SIZE;

        let runningOffset = 0;
        for (let i = 0; i < abstractions.length; i++) {
            const a = abstractions[i];
            if (i === 3) {
                this.writeNSEntry(i, 0, 0, 0, 0, 0, 0, 0, 0, 0);
                this.nsLabels[i] = a.label;
                clistGTs.push(0);
                clistChildren.push(i);
                continue;
            }
            const loc = (i === 0) ? 0 : runningOffset;
            const mySize = slotSizes[i] || this.SLOT_SIZE;
            if (i > 0) runningOffset += mySize;
            else runningOffset = this.SLOT_SIZE;
            const lim17 = (i === 0) ? (this.memory.length - 1)
                        : (DEVICE_REG_LIMITS[i] !== undefined ? DEVICE_REG_LIMITS[i]
                        : (mySize - 1));
            const nsTableCount = (i === 0) ? abstractions.length : 0;
            this.writeNSEntry(i, loc, lim17, 0, 0, 0, a.chainable ? 1 : 0, 1, 0, nsTableCount);
            this.nsLabels[i] = a.label;
            if (a.handler) {
                this.nsHandlers[i] = a.handler;
            }
            clistChildren.push(i);
            const gtWord = this.createGT(0, i, a.perms, 1);
            clistGTs.push(gtWord);
        }
        this.nsClistMap[2] = clistChildren;

        const THREAD_SW = 32;
        const THREAD_CC = 64;
        const THREAD_N_MINUS_6 = 2;
        const threadLoc = this.memory[this.NS_TABLE_BASE + 1 * this.NS_ENTRY_WORDS];
        this.memory[threadLoc] = this.packLumpHeader(THREAD_N_MINUS_6, THREAD_SW, THREAD_CC, 2);

        // DEMO_CLIST hardware alignment: override C-List slots 8–11 with device GTs so
        // hardware code "LOAD CR3, CR6, 8" picks up the LED device, exactly as on Ti60 F225.
        //   [8]  LED_DEV   R|W → NS slot 12 (5 registers: LED0–LED4, bit[0]=R drives pin)
        //   [9]  UART_DEV  R|W → NS slot 11 (3 registers: TX@0, STATUS@1, RX@2)
        //   [10] BTN_DEV   R   → NS slot 13 (1 register: button state bitmask)
        //   [11] TIMER_DEV R|W → NS slot 14 (5 registers: TICKS_LO, HI, TOD, ALARM_CMP, CTL)
        // Permissions match hardware DEMO_CLIST (boot_rom.py lines 357-360)
        const HW_DEVICE_SLOTS = [
            { nsIdx: 12, perms: {R:1,W:1,X:0,L:0,S:0,E:0} }, // [8]  LED_DEV   R|W (5 regs)
            { nsIdx: 11, perms: {R:1,W:1,X:0,L:0,S:0,E:0} }, // [9]  UART_DEV  R|W (3 regs)
            { nsIdx: 13, perms: {R:1,W:0,X:0,L:0,S:0,E:0} }, // [10] BTN_DEV   R   (1 reg)
            { nsIdx: 14, perms: {R:1,W:1,X:0,L:0,S:0,E:0} }, // [11] TIMER_DEV R|W (5 regs)
        ];
        for (let i = 0; i < HW_DEVICE_SLOTS.length; i++) {
            const d = HW_DEVICE_SLOTS[i];
            clistGTs[8 + i] = this.createGT(0, d.nsIdx, d.perms, 1);
        }

        // Slot 2 (Boot.Abstr) lump layout — with lump header at word 0:
        //   Word  0:       Lump header (magic=0x1F, n_minus_6=2→lumpSize=256, cw=17, typ=0, cc=12)
        //   Words 1–17:   Code region  (NUC_CODE_WORDS = 17 instructions; loaded by loadProgram)
        //   Words 18–243: Freespace    (226 words, available for code growth via Patch)
        //   Words 244–255:C-list       (12 GT words, at physical end; matching hardware DEMO_CLIST)
        //   Physical backing: BOOT_ABSTR_LUMP_SIZE = 256 words (n_minus_6=2 → 2^8 = 256)
        //   → CR14: base=lump_start, limit=cw-1=16  (code region; cload reads cw from lump header)
        //   → CR6:  base=lump_start+244, limit=cc-1=11  (c-list at physical end)
        const NUC_CODE_WORDS    = 17;
        const DEMO_CLIST_SIZE   = 12;
        const bootAbstrLoc      = this.memory[this.NS_TABLE_BASE + 2 * this.NS_ENTRY_WORDS];
        const N_MINUS_6         = 2;
        const lumpSize          = BOOT_ABSTR_LUMP_SIZE;
        // Truncate to hardware DEMO_CLIST size — entries beyond idx 11 are simulator-only abstractions
        // not present in the boot c-list on real hardware.
        clistGTs.length         = DEMO_CLIST_SIZE;
        const bootClistCount    = DEMO_CLIST_SIZE;
        const clistStart        = lumpSize - bootClistCount;  // = 244 (c-list at physical end)

        // Word 0: lump header — hardware reads this to simultaneously derive CR14 and CR6
        this.memory[bootAbstrLoc] = this.packLumpHeader(N_MINUS_6, NUC_CODE_WORDS, bootClistCount, 0);

        // C-list at physical end (words 52–63); words 1–17 filled by loadProgram
        for (let i = 0; i < bootClistCount; i++) {
            this.memory[bootAbstrLoc + clistStart + i] = clistGTs[i];
        }
        this.memory[bootAbstrLoc + clistStart] = 0;  // GT[0] = null (filled by SAVE epilogue)

        // NS entry: limit17 = lumpSize - cc - 1 = 243  (valid PC range 0..242 via +1 fetch offset)
        const codeRegionLimit   = lumpSize - bootClistCount - 1;  // = 243
        const bootNSBase        = this.NS_TABLE_BASE + 2 * this.NS_ENTRY_WORDS;
        const bootW1            = this.packNSWord1(codeRegionLimit, 0, 0, 0, 0, 1, bootClistCount);
        this.memory[bootNSBase + 1] = bootW1;
        this.memory[bootNSBase + 2] = this.makeVersionSeals(0, bootAbstrLoc, codeRegionLimit);
    }

    _bootStep() {
        // All boot CRs are Inform-type (type=1) GTs — they name concrete NS slots that have
        // physical lumps.  Abstract GTs (type=3) are only minted at runtime by Navana.Abstraction.Add
        // and Navana.MintPassKey; the boot ROM never creates them.
        if (this.bootComplete) return false;   // nothing to do once boot has finished
        if (this.halted) return false;         // stop re-entering after a boot fault (prevents infinite loop in runSim)

        switch (this.bootStep) {

            // ════════════════════════════════════════════════════════════════════
            // B:00  FAULT_RST
            // Hardware power-on reset: wipe all architectural state before any
            // capability is loaded.  This is the only phase that runs unconditionally
            // at every cold or warm reset.
            // ════════════════════════════════════════════════════════════════════
            case 0: {
                for (let i = 0; i < 16; i++) {   // iterate CR0–CR15 (all 16 capability registers)
                    this._clearCR(i);             // set each CR to NULL (word0=0, word1=0, …)
                }
                this.dr.fill(0);                  // zero all 16 data registers (DR0–DR15)
                this.mElevation = true;           // enable M-elevation: mLoad bypasses R/W/X/L perms during boot
                this.output += '[BOOT] FAULT_RST — All CRs cleared to NULL, all DRs zeroed. M-Elevation ON.\n';
                this.bootStep++;                  // advance state machine → B:01
                this.ledBits = 0b000001;          // LED bit 0 ON = FAULT_RST complete
                this.ledMode = 'boot';            // set LED display to boot-progress mode
                break;
            }

            // ════════════════════════════════════════════════════════════════════
            // B:01  LOAD_NS
            // Load the Namespace descriptor (NS Slot 0) into CR15.
            // CR15 is the privileged "namespace root": from here the hardware can
            // locate every NS entry and therefore every lump in the system.
            // Zero permissions — the NS slot is never directly read/written through
            // CR15; it is only used internally by mLoad for bounds/version checks.
            // ════════════════════════════════════════════════════════════════════
            case 1: {
                const gt15 = this.createGT(0, 0, {R:0,W:0,X:0,L:0,S:0,E:0}, 1); // zero-perm Inform GT for NS Slot 0 (the namespace table itself)
                const check = this.mLoad(gt15, null, undefined);                   // mLoad with M-elevation; reads NS word0/word1 for Slot 0
                if (!check.ok) {
                    this.fault('BOOT', `LOAD_NS mLoad failed: ${check.message}`);  // NS entry missing or corrupted — unrecoverable
                    return false;
                }
                this._writeCR(15, gt15, check.entry);                              // write validated GT + NS entry into CR15
                this.output += `[BOOT] LOAD_NS — CR15 <- mLoad(Slot 0) Namespace (base=0x0000, size=${this.memory.length} words, NS table entries=${this.nsCount})\n`;
                this.bootStep++;                  // advance state machine → B:02
                this.ledBits = 0b000011;          // LED bit 1 ON = LOAD_NS complete
                break;
            }

            // ════════════════════════════════════════════════════════════════════
            // B:02  INIT_THRD
            // Load the Thread descriptor (NS Slot 1) into CR12.
            // CR12 is the "thread identity" register: its NS entry encodes the lump
            // base address and total size, from which the hardware derives the stack
            // ceiling (sp_max = lumpSize − caps − 1) and heap floor.
            // Zero permissions — the hardware reads CR12 internally; programs never
            // issue mLoad/mSave through CR12 directly.
            // ════════════════════════════════════════════════════════════════════
            case 2: {
                const gt12 = this.createGT(0, 1, {R:0,W:0,X:0,L:0,S:0,E:0}, 1); // zero-perm Inform GT for NS Slot 1 (thread lump)
                const check12 = this.mLoad(gt12, null, undefined);                 // M-elevation mLoad; reads thread lump NS entry
                if (!check12.ok) {
                    this.fault('BOOT', `INIT_THRD mLoad(Thread) failed: ${check12.message}`);
                    return false;
                }
                this._writeCR(12, gt12, check12.entry);                            // CR12 ← thread identity token (encodes lump base + size)
                this.output += `[BOOT] INIT_THRD — CR12 <- mLoad(Slot 1) Thread identity (zero perms, Inform)\n`;
                this.bootStep++;                  // advance state machine → B:03
                this.ledBits = 0b000111;          // LED bit 2 ON = INIT_THRD complete
                break;
            }

            // ════════════════════════════════════════════════════════════════════
            // B:03  INIT_ABSTR  (falls through directly to B:04 — indivisible pair)
            // Load the Boot Abstraction descriptor (NS Slot 2) into CR6 with E-perm.
            // The E-type GT written here is a transient snapshot: case 4 immediately
            // snapshots it as oldCR6GT before overwriting CR6 with the L-type c-list
            // token that LOAD_NUC derives from the lump header.
            // ════════════════════════════════════════════════════════════════════
            case 3: {
                const gt6 = this.createGT(0, 2, {R:0,W:0,X:0,L:0,S:0,E:1}, 1);  // E-perm Inform GT for NS Slot 2 (Boot.Abstr)
                const check6 = this.mLoad(gt6, null, undefined);                   // M-elevation mLoad; validates Boot.Abstr NS entry
                if (!check6.ok) {
                    this.fault('BOOT', `INIT_ABSTR mLoad(Boot.Abstr) failed: ${check6.message}`);
                    return false;
                }
                this._writeCR(6, gt6, check6.entry);                              // CR6 ← E-type Inform token for Slot 2 (will be saved to stack frame in B:04)
                this.output += '[BOOT] INIT_ABSTR — CR6 <- mLoad(Slot 2) Boot.Abstr (E, M-elevation)\n';
                this.bootStep++;                  // advance state machine → B:04
                this.ledBits = 0b001111;          // LED bit 3 ON = INIT_ABSTR complete
                // ↓ fall through — B:03 and B:04 always execute together in one Step
            }

            // ════════════════════════════════════════════════════════════════════
            // B:04  LOAD_NUC  (and B:05 COMPLETE, also indivisible)
            // "Load Nucleus": the hardware's CALL microcode for the Boot Abstraction.
            //
            //   1. Re-issue an E-type mLoad on Slot 2 to walk its C-List (TPERM).
            //   2. Read lump header[0] to extract cc (c-list words) and lumpSize.
            //   3. Push a sentinel CALL frame into thread lump memory so that any
            //      eventual RETURN from the root abstraction reboots the machine.
            //   4. Simultaneously derive CR14 (code, R+X) and CR6 (c-list, L) from
            //      the lump header — exactly as the CALL microcode does at runtime.
            //   5. Set PC = 0 (first instruction of the Boot Abstraction).
            //   6. Drop M-elevation and mark boot complete.
            // ════════════════════════════════════════════════════════════════════
            case 4: {
                // ── Step 1: TPERM — walk Boot.Abstr C-List via E-perm mLoad ──────────
                const gt2 = this.createGT(0, 2, {R:0,W:0,X:0,L:0,S:0,E:1}, 1);   // re-issue E-GT for Slot 2; triggers TPERM permission check
                const check2 = this.mLoad(gt2, 'E', undefined);                    // E-perm mLoad: validates NS entry and returns C-List base
                if (!check2.ok) {
                    this.fault('BOOT', `LOAD_NUC mLoad(Boot.Abstr) failed: ${check2.message}`);
                    return false;
                }
                const abstrEntry = check2.entry;                                    // NS entry for Slot 2: word0_location = lump base address
                const abstrParsed = this.parseNSWord1(abstrEntry.word1_limit);     // decode NS word1 to extract the F (Far) bit
                if (abstrParsed.f === 1) {                                          // Far-lumps are not supported at boot (cross-chip capability)
                    this.fault('BOOT', 'LOAD_NUC: Boot.Abstr has F-bit set (Far) — FAULT');
                    return false;
                }
                if (check2.parsed.type !== 1) {                                     // must be Inform (type=1); Abstract GTs forbidden at boot
                    this.fault('BOOT', `LOAD_NUC: Boot.Abstr type is ${check2.parsed.typeName}, must be Inform`);
                    return false;
                }

                // ── Step 2: Read lump header (word 0) ────────────────────────────────
                const base = abstrEntry.word0_location;                             // physical memory index of Boot.Abstr lump word 0
                const hdrWord = this.memory[base] >>> 0;                            // raw 32-bit lump header word (magic | cc | cw | lumpSize)
                const hdr = this.parseLumpHeader(hdrWord);                          // decode header fields into {magic, cc, cw, lumpSize, valid}
                if (!hdr.valid) {                                                    // magic field must be 0x1F; any other value = corrupt image
                    this.fault('BOOT', `LOAD_NUC: lump header magic=0x${hdr.magic.toString(16)} (expected 0x1F)`);
                    return false;
                }
                const cw        = hdr.cw;                                           // code-words count (used by IDE for heap allocation; not used here)
                const cc        = hdr.cc;                                           // c-list word count: fixes start of c-list zone in the lump
                const lumpSz    = hdr.lumpSize;                                     // total lump size in 32-bit words
                const clistStart = lumpSz - cc;                                     // c-list begins at the physical end of the slot (offset from base)
                if (cc === 0) {                                                      // a zero cc means no C-List — CR6 cannot be set, so boot cannot proceed
                    this.fault('BOOT', 'LOAD_NUC: lump header cc=0 — no C-List');
                    return false;
                }

                // ── Step 3: Push sentinel CALL frame ─────────────────────────────────
                // CALL microcode saves the caller's CR6 E-GT and a frame word on the
                // stack before overwriting CR6/CR14.  We replicate that here so that
                // RETURN from the root abstraction sees a valid (sentinel) frame and
                // reboots rather than crashing with an empty-stack fault.
                const sp_max = 243;                                                  // stack ceiling: lumpSize(256) - caps(12) - 1 = 243
                const oldCR6GT = this.cr[6].word0 >>> 0;                            // snapshot E-type GT written by B:03 INIT_ABSTR
                const sentinelFrameWord = this._packFrameWordRaw(0x7FFF, 1, sp_max); // frameWord: NIA=0x7FFF (poison, all 15 bits set), sz=1 (CALL frame), prev_STO=sp_max
                this.callStack.push({               // push to JS call-stack mirror so RETURN handler can inspect it
                    sentinel: true,                 // flag: RETURN will detect this and raise STACK_UNDERFLOW fault
                    returnPC: 0x7FFF,               // poison return address — never executed, catches stray RETs
                    savedCRs: this.cr.map(c => ({...c})), // snapshot of all CRs at boot entry point
                    savedDRs: [...this.dr],         // snapshot of all DRs (all zero at boot)
                    savedFlags: {...this.flags},     // snapshot of flags (all clear at boot)
                    savedSTO: sp_max,               // previous STO = sp_max (the empty-stack sentinel value)
                    sz: 1,                          // sz=1 → CALL-type frame (not LAMBDA)
                    frameWord: sentinelFrameWord,   // packed frame word for display in thread lump view
                });
                const threadBase = this.cr[12] && this.cr[12].word1;               // physical base of thread lump (from CR12 NS entry, set in B:02)
                if (threadBase) {
                    this.memory[threadBase + sp_max]     = sentinelFrameWord;       // lump[+sp_max] = frame word (visible in ② stack zone as orange "sentinel")
                    this.memory[threadBase + sp_max - 1] = oldCR6GT;               // lump[+sp_max-1] = saved E-type CR6 GT from B:03
                }
                this.sto = sp_max - 2;              // STO = sp_max-2: two words consumed by the sentinel frame (frame word + E-GT)

                // ── Step 4: Derive CR14 (code) and CR6 (c-list) from lump header ─────
                // Hardware does this simultaneously from the header word; both tokens
                // are Inform-type, zero gt_seq, referencing Slot 2 (same physical lump).
                const cr14GT = this.createGT(0, 2, {R:1,W:0,X:1,L:0,S:0,E:0}, 1);         // R+X Inform GT for Slot 2 → CR14 is the code-execution token
                const cr14Word1 = this.packNSWord1(cw - 1, 0, 0, 0, 0, 1, 0);              // NS word1 encodes limit = cw-1 (inclusive last valid PC, matching NS format convention)
                this.cr[14] = {
                    word0: cr14GT,                  // Golden Token identifying the code lump
                    word1: base,                    // physical base address of lump (first instruction at base+0)
                    word2: cr14Word1,               // limit word (cw-1 = inclusive last valid PC; used by _fetchInstruction with > check)
                    word3: abstrEntry.word2_seals,  // seal field copied from NS entry (version + seal bits)
                    m: this.mElevation ? 1 : 0     // M-elevation is still ON at this point (cleared below)
                };

                const cr6GT = this.createGT(0, 2, {R:0,W:0,X:0,L:0,S:0,E:1}, 1);          // E-perm Inform GT for Slot 2 → CR6 is the c-list token (E allows recursive CALL via CR6)
                const cr6Word1 = this.packNSWord1(cc - 1, 0, 0, 0, 0, 1, 0);               // NS word1 encodes limit = cc − 1 (covers all c-list words)
                this.cr[6] = {
                    word0: cr6GT,                   // Golden Token with E-perm (E allows CALL via CR6 for recursive abstraction)
                    word1: (base + clistStart) >>> 0, // physical base of c-list zone (= base + lumpSz − cc)
                    word2: cr6Word1,                // limit word for the c-list region
                    word3: abstrEntry.word2_seals,  // same seal field as CR14
                    m: this.mElevation ? 1 : 0
                };
                // NOTE: CR6 is NOT written back to the caps zone (+250) — it lives exclusively
                // in CALL stack frames.  The caps zone entry for CR6 remains 0 until a SAVE runs.

                // ── Step 5: Set PC and emit log ───────────────────────────────────────
                this.pc = 0;                        // first instruction of Boot Abstraction is at lump word 0 (offset from lump base)
                this.output += `[BOOT] LOAD_NUC — hdr=0x${hdrWord.toString(16).toUpperCase().padStart(8,'0')} (cw=${cw},cc=${cc},lumpSize=${lumpSz}); CR14+CR6 ← simultaneous from lump header; CR14(X,cw=${cw},lim=0..${cw-1}) CR6(E,base=0x${(base+clistStart).toString(16).toUpperCase()},lim=${cc-1}), PC=0\n`;
                this.output += `[BOOT] SENTINEL CALL — frame@+${sp_max}=0x${sentinelFrameWord.toString(16).toUpperCase().padStart(8,'0')} (NIA=0x7FFF,sz=1,prev_STO=${sp_max}), E-GT@+${sp_max-1}=0x${oldCR6GT.toString(16).toUpperCase().padStart(8,'0')}, STO=${this.sto}\n`;

                // ── Step 6 (B:05): COMPLETE ───────────────────────────────────────────
                this.bootStep++;                    // advance state machine → B:05 (COMPLETE)
                this.mElevation = false;            // drop M-elevation: normal capability checks now apply to all subsequent instructions
                this.bootComplete = true;           // signal the step-loop to stop calling _bootStep and start dispatching instructions
                this.ledBits = 0b111111;            // all 6 LEDs ON = boot complete
                this.ledMode = 'boot';              // LED display stays in boot-progress mode until first user toggle
                this.output += '[BOOT] COMPLETE — M-Elevation OFF. All Layer 0–1 abstractions initialized. Boot complete.\n';
                break;
            }
        }
        this.emit('stateChange', this.getState());  // notify UI that machine state has changed (triggers register/memory panel refresh)
        return true;                                 // return true = a boot step was executed; false = already complete or faulted
    }

    parseGT(gt32) {
        gt32 = gt32 >>> 0;
        const permBits = (gt32 >>> 25) & 0x7F;
        const type    = (gt32 >>> 23) & 0x3;
        const gt_seq  = (gt32 >>> 16) & 0x7F;
        const index   =  gt32         & 0xFFFF;
        return {
            gt_seq, index,
            permissions: {
                B: (permBits >>> 6) & 1,
                E: (permBits >>> 5) & 1,
                S: (permBits >>> 4) & 1,
                L: (permBits >>> 3) & 1,
                X: (permBits >>> 2) & 1,
                W: (permBits >>> 1) & 1,
                R: (permBits >>> 0) & 1,
            },
            type,
            typeName: ['NULL','Inform','Outform','Abstract'][type & 3],
        };
    }

    createGT(gt_seq, slotId, perms, type) {
        const p = (this.getPermBits(perms) << 25) >>> 0;
        const t = ((type   & 0x3)  << 23) >>> 0;
        const s = ((gt_seq & 0x7F) << 16) >>> 0;
        const i = (slotId  & 0xFFFF)      >>> 0;
        return (p | t | s | i) >>> 0;
    }

    getPermBits(permsObj) {
        let bits = 0;
        if (permsObj.R) bits |= 1;
        if (permsObj.W) bits |= 2;
        if (permsObj.X) bits |= 4;
        if (permsObj.L) bits |= 8;
        if (permsObj.S) bits |= 16;
        if (permsObj.E) bits |= 32;
        if (permsObj.B) bits |= 64;
        return bits & 0x7F;
    }

    computeSeal(location, limit17) {
        let crc = 0xFFFF;
        const update = (byte) => {
            for (let i = 0; i < 8; i++) {
                const bit = ((byte >>> (7 - i)) & 1) ^ ((crc >>> 15) & 1);
                crc = ((crc << 1) & 0xFFFF) ^ (bit ? 0x1021 : 0);
            }
        };
        update((location >>> 24) & 0xFF);
        update((location >>> 16) & 0xFF);
        update((location >>>  8) & 0xFF);
        update( location         & 0xFF);
        update((limit17  >>> 16) & 0xFF);
        update((limit17  >>>  8) & 0xFF);
        update( limit17          & 0xFF);
        return crc & 0xFFFF;
    }

    makeVersionSeals(gt_seq, location, limit17) {
        const seal = this.computeSeal(location, limit17);
        return (((gt_seq & 0x7F) << 25) | (seal & 0xFFFF)) >>> 0;
    }

    validateMAC(entry) {
        if (!entry) return false;
        const storedSeal = entry.word2_seals & 0xFFFF;
        const lim = this.parseNSWord1(entry.word1_limit);
        return storedSeal === this.computeSeal(entry.word0_location, lim.limit);
    }

    _validateClistSlotPerms(parsed, slotIdx) {
        const p = parsed.permissions;
        const permStr = (p.B?'B':'')+(p.R?'R':'')+(p.W?'W':'')+(p.X?'X':'')+(p.L?'L':'')+(p.S?'S':'')+(p.E?'E':'');
        if (slotIdx === 0) {
            const hasX = p.X;
            const onlyXorRX = hasX && !p.W && !p.L && !p.S && !p.E;
            if (!onlyXorRX) {
                return { ok: false, fault: 'DOMAIN_PURITY', message: `CLOOMC slot 0 has ${permStr||'no'} permissions — only X or RX allowed` };
            }
        } else {
            if (p.X && p.E) {
                return { ok: false, fault: 'DOMAIN_PURITY', message: `C-List slot ${slotIdx} has ${permStr} — mixed XE not allowed (use separate slots for X and E)` };
            }
        }
        return { ok: true };
    }

    mLoad(gt32, requiredPerm, srcCRIdx, absoluteAddress, rangeOverride) {
        const parsed = this.parseGT(gt32);
        if (parsed.index >= this.nsCount) {
            return { ok: false, fault: 'BOUNDS', message: `namespace index ${parsed.index} out of bounds` };
        }
        const entry = this.readNSEntry(parsed.index);
        if (!entry) {
            return { ok: false, fault: 'BOUNDS', message: `namespace entry ${parsed.index} is null` };
        }
        const nsGtSeq = (entry.word2_seals >>> 25) & 0x7F;
        const versionMatch = parsed.gt_seq === nsGtSeq;
        const sealValid = this.validateMAC(entry);

        const bBit = parsed.permissions.B || 0;
        const fBit = (entry.word1_limit >>> 30) & 1;

        const permPass = requiredPerm === null || this.mElevation || !!parsed.permissions[requiredPerm];

        let rangePass = true;
        let rangeInfo = null;
        if (absoluteAddress !== undefined && absoluteAddress !== null) {
            let base, upperBound;
            if (rangeOverride) {
                base = rangeOverride.base;
                upperBound = rangeOverride.upperBound;
            } else {
                base = entry.word0_location;
                const lim = this.parseNSWord1(entry.word1_limit);
                upperBound = (base + lim.limit) >>> 0;
            }
            rangePass = absoluteAddress >= base && absoluteAddress <= upperBound;
            rangeInfo = { pass: rangePass, address: absoluteAddress, base, limit: upperBound };
        }

        const auditEntry = {
            gate: 'mLoad',
            label: this.nsLabels[parsed.index] || 'entry_'+parsed.index,
            nsIndex: parsed.index,
            requiredPerm,
            checks: {
                version: { pass: versionMatch },
                seal:    { pass: sealValid },
                perm:    { pass: permPass, perm: requiredPerm },
            },
            b: bBit, f: fBit,
            result: (versionMatch && sealValid && permPass && rangePass) ? 'pass' : 'fail',
        };
        if (rangeInfo) auditEntry.checks.range = rangeInfo;
        this.auditLog.push(auditEntry);
        this.lastCapability = {
            op: requiredPerm,
            label: auditEntry.label,
            perms: parsed.permissions,
            b: bBit,
            f: fBit,
            versionMatch,
            sealValid,
        };
        if (!versionMatch) {
            return { ok: false, fault: 'VERSION', message: `gt_seq mismatch: GT seq ${parsed.gt_seq}, entry seq ${nsGtSeq}` };
        }
        if (!sealValid) {
            return { ok: false, fault: 'SEAL', message: `CRC seal validation failed for entry ${parsed.index}` };
        }
        if (requiredPerm !== null && !this.mElevation && !parsed.permissions[requiredPerm]) {
            return { ok: false, fault: 'PERMISSION', message: `lacks ${requiredPerm} permission` };
        }
        if (!rangePass) {
            const rBase = rangeInfo.base;
            const rLimit = rangeInfo.limit;
            return { ok: false, fault: 'RANGE', message: `address ${absoluteAddress} outside valid range [${rBase}..${rLimit}]` };
        }
        this.markLive(parsed.index);
        return { ok: true, parsed, entry, index: parsed.index };
    }

    mSave(gt32, targetIdx, srcCRIdx, absoluteAddress, rangeOverride) {
        const parsed = this.parseGT(gt32);
        const srcEntry = this.readNSEntry(parsed.index);
        if (!srcEntry) {
            return { ok: false, fault: 'BOUNDS', message: `source entry ${parsed.index} is null` };
        }

        const srcVersionMatch = parsed.gt_seq === ((srcEntry.word2_seals >>> 25) & 0x7F);
        const srcSealValid = this.validateMAC(srcEntry);

        const bBit = parsed.permissions.B || 0;
        const fBit = (srcEntry.word1_limit >>> 30) & 1;

        const bindPass = bBit === 1 || this.mElevation;
        let farPass = true;
        if (targetIdx !== null && targetIdx !== undefined) {
            const tgtEntry = this.readNSEntry(targetIdx);
            if (tgtEntry) {
                const tgtWord1 = this.parseNSWord1(tgtEntry.word1_limit);
                if (tgtWord1.f === 1 && !this.mElevation) farPass = false;
            }
        }

        let rangePass = true;
        let rangeInfo = null;
        if (absoluteAddress !== undefined && absoluteAddress !== null) {
            let base, upperBound;
            if (rangeOverride) {
                base = rangeOverride.base;
                upperBound = rangeOverride.upperBound;
            } else {
                base = srcEntry.word0_location;
                const lim = this.parseNSWord1(srcEntry.word1_limit);
                upperBound = (base + lim.limit) >>> 0;
            }
            rangePass = absoluteAddress >= base && absoluteAddress <= upperBound;
            rangeInfo = { pass: rangePass, address: absoluteAddress, base, limit: upperBound };
        }

        const saveAudit = {
            gate: 'mSave',
            label: this.nsLabels[parsed.index] || 'entry_'+parsed.index,
            nsIndex: parsed.index,
            requiredPerm: 'S',
            checks: {
                version: { pass: srcVersionMatch },
                seal:    { pass: srcSealValid },
                bind:    { pass: bindPass },
                far:     { pass: farPass },
            },
            b: bBit, f: fBit,
            result: (srcVersionMatch && srcSealValid && bindPass && farPass && rangePass) ? 'pass' : 'fail',
        };
        if (rangeInfo) saveAudit.checks.range = rangeInfo;
        this.auditLog.push(saveAudit);
        this.lastCapability = {
            op: 'S',
            label: saveAudit.label,
            perms: parsed.permissions,
            b: bBit,
            f: fBit,
            versionMatch: srcVersionMatch,
            sealValid: srcSealValid,
        };
        if (!srcVersionMatch) {
            return { ok: false, fault: 'VERSION', message: `source gt_seq mismatch: GT seq ${parsed.gt_seq}, entry seq ${(srcEntry.word2_seals >>> 25) & 0x7F}` };
        }
        if (!srcSealValid) {
            return { ok: false, fault: 'SEAL', message: `source CRC seal validation failed for entry ${parsed.index}` };
        }
        if (!bindPass) {
            return { ok: false, fault: 'BIND', message: `GT has B=0 — not bindable to c-list` };
        }
        if (!farPass) {
            return { ok: false, fault: 'FAR', message: `target slot ${targetIdx} is FAR (F=1) — requires HTTP/tunnel access` };
        }
        if (!rangePass) {
            const rBase = rangeInfo.base;
            const rLimit = rangeInfo.limit;
            return { ok: false, fault: 'RANGE', message: `address ${absoluteAddress} outside valid range [${rBase}..${rLimit}]` };
        }
        return { ok: true, parsed, srcEntry };
    }

    markLive(idx) {
        const base = this.NS_TABLE_BASE + idx * this.NS_ENTRY_WORDS;
        const w1 = this.memory[base + 1];
        if (this.gcPolarity === 0) {
            this.memory[base + 1] = (w1 | (1 << 29)) >>> 0;
        } else {
            this.memory[base + 1] = (w1 & ~(1 << 29)) >>> 0;
        }
    }

    markGarbage(idx) {
        const base = this.NS_TABLE_BASE + idx * this.NS_ENTRY_WORDS;
        const w1 = this.memory[base + 1];
        if (this.gcPolarity === 0) {
            this.memory[base + 1] = (w1 & ~(1 << 29)) >>> 0;
        } else {
            this.memory[base + 1] = (w1 | (1 << 29)) >>> 0;
        }
    }

    getGBit(idx) {
        const base = this.NS_TABLE_BASE + idx * this.NS_ENTRY_WORDS;
        return (this.memory[base + 1] >>> 29) & 1;
    }

    isGarbage(idx) {
        return this.getGBit(idx) === this.gcPolarity;
    }

    runGC() {
        const log = [];
        const garbageValue = this.gcPolarity;
        const liveValue = garbageValue ? 0 : 1;
        log.push('=== PP250 Deterministic Garbage Collection ===');
        log.push(`GC polarity: G=${garbageValue} means GARBAGE, G=${liveValue} means LIVE`);
        log.push('');

        // ── Phase 1: MARK ────────────────────────────────────────────────────
        const p1Lines = [];
        const priorCount = this.nsCount;

        // Collect holes and mark in a single pass
        const holes = [];
        let markCount = 0;
        for (let i = 0; i < priorCount; i++) {
            if (!this.isNSEntryValid(i)) {
                holes.push(i);
            } else {
                this.markGarbage(i);
                markCount++;
            }
        }

        // Overview shown BEFORE marking description
        p1Lines.push(`Namespace table: ${priorCount} slot${priorCount !== 1 ? 's' : ''}  [NS[0]..NS[${priorCount - 1}]]`);
        p1Lines.push(`  ${markCount} valid  ·  ${holes.length} empty ${holes.length === 1 ? 'hole' : 'holes'}`);
        if (holes.length > 0) {
            p1Lines.push(`  Holes: ${holes.map(h => 'NS[' + h + ']').join(', ')}`);
        }

        // CR15 current slot size
        const cr15gt = this.cr[15] ? this.cr[15].word0 : 0;
        if (cr15gt !== 0) {
            const cr15parsed = this.parseGT(cr15gt);
            const cr15idx = cr15parsed.index;
            const cr15base = this.NS_TABLE_BASE + cr15idx * this.NS_ENTRY_WORDS;
            const cr15w1 = this.memory[cr15base + 1];
            const cr15limit = cr15w1 & 0x1FFFF;
            const cr15label = this.nsLabels[cr15idx] || '(unnamed)';
            p1Lines.push(`CR15 → NS[${cr15idx}]  "${cr15label}"  —  slot size: ${cr15limit} words`);
        } else {
            p1Lines.push(`CR15 → (null — no current abstraction)`);
        }

        p1Lines.push('');
        p1Lines.push(`Polarity: G=${garbageValue} = garbage,  G=${liveValue} = live`);
        p1Lines.push(`Marked all ${markCount} valid entries as garbage suspects`);
        p1Lines.push('(Pessimistic — every entry suspect until proven reachable)');
        log.push('--- Phase 1: MARK ---');
        log.push(...p1Lines);
        log.push('');

        // ── Phase 2: SCAN ────────────────────────────────────────────────────
        const p2Lines = [];
        const liveSet = new Set();
        for (let cr = 0; cr < 16; cr++) {
            const gt32 = this.cr[cr].word0;
            if (gt32 === 0) continue;
            const parsed = this.parseGT(gt32);
            const idx = parsed.index;
            if (idx < this.nsCount && this.isNSEntryValid(idx)) {
                this.markLive(idx);
                liveSet.add(idx);
                const label = this.nsLabels[idx] || '(unnamed)';
                p2Lines.push(`CR${cr} → NS[${idx}] "${label}" LIVE`);
                log.push(`  CR${cr} -> NS[${idx}] "${label}" — LIVE (G=${liveValue})`);
            }
        }
        if (this.callStack) {
            for (const frame of this.callStack) {
                for (const crKey of ['cr5', 'cr6', 'cr14']) {
                    if (frame[crKey]) {
                        const gt32 = frame[crKey].word0;
                        if (gt32 === 0) continue;
                        const parsed = this.parseGT(gt32);
                        const idx = parsed.index;
                        if (idx < this.nsCount && this.isNSEntryValid(idx) && !liveSet.has(idx)) {
                            this.markLive(idx);
                            liveSet.add(idx);
                            const label = this.nsLabels[idx] || '(unnamed)';
                            p2Lines.push(`Stack ${crKey} → NS[${idx}] "${label}" LIVE`);
                            log.push(`  CallStack ${crKey} -> NS[${idx}] "${label}" — LIVE (G=${liveValue})`);
                        }
                    }
                }
            }
        }
        const tracedFromClist = new Set();
        const traceQueue = [...liveSet];
        let clistTraced = 0;
        while (traceQueue.length > 0) {
            const parentIdx = traceQueue.shift();
            if (tracedFromClist.has(parentIdx)) continue;
            tracedFromClist.add(parentIdx);
            const children = this.nsClistMap[parentIdx];
            if (!children) continue;
            for (const childIdx of children) {
                if (liveSet.has(childIdx)) continue;
                if (childIdx < this.nsCount && this.isNSEntryValid(childIdx)) {
                    this.markLive(childIdx);
                    liveSet.add(childIdx);
                    traceQueue.push(childIdx);
                    clistTraced++;
                    const label = this.nsLabels[childIdx] || '(unnamed)';
                    log.push(`  C-List NS[${parentIdx}] -> NS[${childIdx}] "${label}" — LIVE (G=${liveValue})`);
                }
            }
        }
        if (clistTraced > 0) p2Lines.push(`C-list trace: ${clistTraced} additional entries reachable`);
        p2Lines.push(`${liveSet.size} live entries confirmed — marked safe`);
        log.push('--- Phase 2: SCAN ---');
        log.push(`Scan complete: ${liveSet.size} live entries confirmed.`);
        log.push('');

        // ── Phase 3: SWEEP ───────────────────────────────────────────────────
        const _GT_TYPE_NAMES = ['Null', 'Inform', 'Outform', 'Abstract'];
        const p3Lines = [];
        const candidates = [];
        for (let i = 0; i < priorCount; i++) {
            if (!this.isNSEntryValid(i)) continue;
            if (!this.isGarbage(i)) continue;
            const entry = this.readNSEntry(i);
            const label = this.nsLabels[i] || '(unnamed)';
            const loc = entry ? (entry.word0_location >>> 0) : 0;
            const w1parsed = entry ? this.parseNSWord1(entry.word1_limit) : null;
            const typeName  = w1parsed ? (_GT_TYPE_NAMES[w1parsed.gtType] || '?') : '?';
            const limit     = w1parsed ? w1parsed.limit : 0;
            const clistCnt  = w1parsed ? w1parsed.clistCount : 0;
            const w2base    = this.NS_TABLE_BASE + i * this.NS_ENTRY_WORDS + 2;
            const version   = (this.memory[w2base] >>> 25) & 0x7F;
            candidates.push({ index: i, label, loc });
            p3Lines.push(`NS[${i}]  "${label}"`);
            p3Lines.push(`  ${typeName}  ·  @0x${loc.toString(16).toUpperCase().padStart(4,'0')}  ·  ${limit} words  ·  ${clistCnt} caps  ·  v${version}`);
            log.push(`  GARBAGE NS[${i}] "${label}" type=${typeName} @0x${loc.toString(16).toUpperCase().padStart(8,'0')} limit=${limit} clist=${clistCnt} ver=${version} — G=${garbageValue}`);
        }
        if (candidates.length === 0) {
            p3Lines.push('No garbage entries — all NS entries are reachable from a CR root');
        } else {
            p3Lines.push('');
            p3Lines.push('Why garbage? None of the above entries are reachable from');
            p3Lines.push('any CR (CR0–CR15) or saved CR in the call-stack frames.');
            p3Lines.push('Phase 4 will zero their NS table words and lump memory.');
        }
        p3Lines.push('');
        p3Lines.push(`→ ${candidates.length} ${candidates.length === 1 ? 'entry' : 'entries'} queued for reclamation`);
        log.push('--- Phase 3: SWEEP ---');
        log.push(`Identified ${candidates.length} garbage entries.`);
        log.push('');

        // ── Phase 4: CLEAR + FLIP ────────────────────────────────────────────
        const p4Lines = [];
        let freedSlots = 0;
        let freedWords = 0;
        for (const c of candidates) {
            if (c.index === 0) {
                p4Lines.push(`SKIP NS[0] "Boot.NS" — namespace root protected`);
                log.push(`  SKIP NS[0] "Boot.NS" — namespace root is protected`);
                continue;
            }
            const base = this.NS_TABLE_BASE + c.index * this.NS_ENTRY_WORDS;
            const w2 = this.memory[base + 2];
            const oldVersion = (w2 >>> 25) & 0x7F;
            const newVersion = (oldVersion + 1) & 0x7F;
            this.memory[base + 0] = 0;
            this.memory[base + 1] = 0;
            this.memory[base + 2] = (newVersion << 25) >>> 0;

            let wordsCleared = 0;
            for (let w = 0; w < this.SLOT_SIZE; w++) {
                if (this.memory[c.loc + w] !== 0) {
                    this.memory[c.loc + w] = 0;
                    wordsCleared++;
                }
            }
            freedWords += wordsCleared;
            p4Lines.push(`CLEAR NS[${c.index}] "${c.label}" — ${wordsCleared} words zeroed`);
            log.push(`  CLEAR NS[${c.index}] "${c.label}" — version ${oldVersion}->${newVersion}, ${wordsCleared} object words zeroed`);

            delete this.nsLabels[c.index];
            freedSlots++;
        }

        let newCount = 0;
        for (let i = priorCount - 1; i >= 0; i--) {
            if (this.isNSEntryValid(i)) {
                newCount = i + 1;
                break;
            }
        }
        this.nsCount = newCount;

        this.gcPolarity = this.gcPolarity ? 0 : 1;

        // Slot accounting
        p4Lines.push('');
        if (freedSlots > 0) {
            p4Lines.push(`Reclaimed by this GC run:`);
            for (const c of candidates) {
                if (c.index === 0) continue;
                p4Lines.push(`  NS[${c.index}]  "${c.label}"`);
            }
        } else {
            p4Lines.push('No slots reclaimed — all entries were reachable');
        }
        if (holes.length > 0) {
            p4Lines.push('');
            p4Lines.push(`Already free before GC (empty holes):`);
            p4Lines.push(`  ${holes.map(h => 'NS[' + h + ']').join('  ')}`);
        } else {
            p4Lines.push('No empty holes — table was contiguous');
        }
        p4Lines.push('');
        p4Lines.push(`${priorCount}  slots before GC`);
        p4Lines.push(`−  ${freedSlots}  reclaimed  (unreachable, no CR root)`);
        p4Lines.push(`=  ${newCount}  slots remaining`);
        p4Lines.push('');
        p4Lines.push(`${freedWords} lump words reclaimed`);
        p4Lines.push(`Polarity flipped → G=${this.gcPolarity} marks garbage next run`);

        log.push('--- Phase 4: CLEAR ---');
        log.push('');
        log.push(`=== GC Complete: ${freedSlots} slots freed, ${freedWords} object memory words reclaimed ===`);
        log.push(`Namespace: ${priorCount} -> ${this.nsCount} entries (${freedSlots} swept)`);
        log.push(`Live: ${liveSet.size} entries protected by CR references`);
        log.push(`Next GC polarity flipped: G=${this.gcPolarity} will mean GARBAGE`);

        const report = log.join('\n');
        this.output += report + '\n';
        this.emit('stateChange', this.getState());
        return {
            freedSlots, freedWords, liveCount: liveSet.size, report,
            priorCount, newCount: this.nsCount,
            phases: [
                { num: 1, name: 'Mark',  desc: 'Pessimistic assumption — flag every NS entry as suspect', lines: p1Lines },
                { num: 2, name: 'Scan',  desc: 'Walk all CR roots + call stack; mark reachable entries live', lines: p2Lines },
                { num: 3, name: 'Sweep', desc: 'Identify entries still flagged as garbage; build reclaim list', lines: p3Lines },
                { num: 4, name: 'Clear', desc: 'Zero NS entries + object words; bump version; flip polarity', lines: p4Lines },
            ]
        };
    }


    _writeCR(crIdx, gt32, entry) {
        this.cr[crIdx].word0 = gt32;
        this.cr[crIdx].word1 = entry.word0_location >>> 0;
        this.cr[crIdx].word2 = entry.word1_limit >>> 0;
        this.cr[crIdx].word3 = entry.word2_seals >>> 0;
        this.cr[crIdx].m = this.mElevation ? 1 : 0;
        if (crIdx <= 11 && crIdx !== 6) {
            const threadBase = this.cr[12] && this.cr[12].word1;
            if (threadBase) {
                const homeAddr = (threadBase + THREAD_CAPS_OFFSET + crIdx) >>> 0;
                const cr12GT = this.cr[12].word0;
                if (cr12GT) {
                    const homeCheck = this.mLoad(cr12GT, null, undefined, homeAddr);
                    if (!homeCheck.ok) {
                        this.fault(homeCheck.fault, `_writeCR(${crIdx}): home slot ${homeCheck.message}`);
                        return false;
                    }
                }
                this.memory[homeAddr] = gt32 >>> 0;
            }
        }
        return true;
    }

    _clearCR(crIdx) {
        this.cr[crIdx] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
        // Zero the home slot too (CR6 excluded — lives in stack frames)
        if (crIdx <= 11 && crIdx !== 6) {
            const threadBase = this.cr[12] && this.cr[12].word1;
            if (threadBase) {
                this.memory[threadBase + THREAD_CAPS_OFFSET + crIdx] = 0;
            }
        }
    }

    checkCondition(condCode) {
        const { N, Z, C, V } = this.flags;
        switch (condCode) {
            case 0x0: return Z;
            case 0x1: return !Z;
            case 0x2: return C;
            case 0x3: return !C;
            case 0x4: return N;
            case 0x5: return !N;
            case 0x6: return V;
            case 0x7: return !V;
            case 0x8: return C && !Z;
            case 0x9: return !C || Z;
            case 0xA: return N === V;
            case 0xB: return N !== V;
            case 0xC: return !Z && (N === V);
            case 0xD: return Z || (N !== V);
            case 0xE: return true;
            case 0xF: return false;
            default: return true;
        }
    }

    condName(code) {
        return ['EQ','NE','CS','CC','MI','PL','VS','VC','HI','LS','GE','LT','GT','LE','AL','NV'][code & 0xF];
    }

    opName(code) {
        const names = ['LOAD','SAVE','CALL','RETURN','CHANGE','SWITCH','TPERM','LAMBDA','ELOADCALL','XLOADLAMBDA','DREAD','DWRITE','BFEXT','BFINS','MCMP','IADD','ISUB','BRANCH','SHL','SHR'];
        return names[code] || '???';
    }

    decodeInstruction(instr) {
        instr = instr >>> 0;
        return {
            opcode: (instr >>> 27) & 0x1F,
            cond:   (instr >>> 23) & 0xF,
            crDst:  (instr >>> 19) & 0xF,
            crSrc:  (instr >>> 15) & 0xF,
            imm:    instr & 0x7FFF,
            raw:    instr,
        };
    }

    _packFrameWordRaw(returnPC, sz, savedSTO, flags = {}) {
        const { N=false, Z=false, C=false, V=false } = flags;
        const flagBits = ((N ? 1 : 0) << 3) | ((Z ? 1 : 0) << 2) | ((C ? 1 : 0) << 1) | (V ? 1 : 0);
        return (
            ((flagBits & 0xF) << 28) |
            ((returnPC & 0x7FFF) << 13) |
            ((sz & 1) << 12) |
            (savedSTO & 0xFFF)
        ) >>> 0;
    }

    _packFrameWord(returnPC, sz, savedSTO) {
        return this._packFrameWordRaw(returnPC, sz, savedSTO, this.flags);
    }

    _unpackFrameWord(word) {
        const flagBits = (word >>> 28) & 0xF;
        return {
            flags:    { N: !!(flagBits & 8), Z: !!(flagBits & 4), C: !!(flagBits & 2), V: !!(flagBits & 1) },
            returnPC: (word >>> 13) & 0x7FFF,
            sz:       (word >>> 12) & 1,
            savedSTO: word & 0xFFF,
        };
    }

    encodeInstruction(opcode, cond, crDst, crSrc, imm) {
        return (
            ((opcode & 0x1F) << 27) |
            ((cond & 0xF) << 23) |
            ((crDst & 0xF) << 19) |
            ((crSrc & 0xF) << 15) |
            (imm & 0x7FFF)
        ) >>> 0;
    }

    fault(type, message) {
        const lastH = this._instrHistory && this._instrHistory.length > 0
            ? this._instrHistory[this._instrHistory.length - 1] : null;
        const faultStep = (lastH && lastH.step === this.stepCount) ? this.stepCount : null;
        const entry = {
            type, message, pc: this.pc, physicalPC: this.physicalPC, step: this.stepCount,
            crSnapshot: this.cr ? this.cr.map(c => c ? {...c} : null) : [],
            drSnapshot: this.dr ? [...this.dr] : [],
            flagsSnapshot: this.flags ? {...this.flags} : {},
            instrHistory: this._instrHistory ? this._instrHistory.map(h => ({...h})) : [],
            faultStep: faultStep,
        };
        this.faultLog.push(entry);
        this.output += `FAULT [${type}] at PC=${this.pc}: ${message}\n`;
        this.halted = true;
        this.running = false;
        if (this.abstractionRegistry) {
            const idxMatch = message.match(/(?:entry|index|slot|CR)\s*(\d+)/i);
            if (idxMatch) {
                const idx = parseInt(idxMatch[1]);
                if (idx < 45) this.abstractionRegistry.reportFault(idx);
            }
        }
        this.emit('fault', entry);
        this.emit('output', this.output);
    }

    // Compute the physical memory address of the NEXT instruction to be fetched,
    // from current this.pc + CR14 lump base, WITHOUT executing anything.
    // Used by run() for stop-before-execute breakpoint semantics.
    // Returns -1 if CR14 is invalid or the address cannot be determined.
    _nextPhysicalAddr() {
        if (!this.bootComplete) {
            return this.pc;
        }
        const cr14 = this.cr[14];
        if (!cr14 || cr14.word0 === 0) return -1;
        const cr14Parsed = this.parseGT(cr14.word0);
        if (!cr14Parsed.permissions.X) return -1;
        const entry = this.readNSEntry(cr14Parsed.index);
        if (!entry) return -1;
        return (entry.word0_location + 1 + this.pc) >>> 0;
    }

    _fetchInstruction() {
        if (!this.bootComplete) {
            if (this.pc >= this.memory.length) {
                return { ok: false, fault: 'BOUNDS', message: `PC=${this.pc} out of memory (pre-boot)` };
            }
            this.physicalPC = this.pc;
            return { ok: true, word: this.memory[this.pc], addr: this.pc };
        }

        const cr14 = this.cr[14];
        if (!cr14 || cr14.word0 === 0) {
            return { ok: false, fault: 'NULL_CAP', message: 'CR14 (code register) is NULL — no code capability' };
        }
        const cr14Parsed = this.parseGT(cr14.word0);
        if (!cr14Parsed.permissions.X) {
            return { ok: false, fault: 'PERM_X', message: 'CR14 lacks X permission for instruction fetch' };
        }
        const entry = this.readNSEntry(cr14Parsed.index);
        if (!entry) {
            return { ok: false, fault: 'BOUNDS', message: `CR14 NS entry ${cr14Parsed.index} not found` };
        }
        const cr14w2 = this.parseNSWord1((this.cr[14].word2 || 0) >>> 0);
        if (this.pc > cr14w2.limit) {
            return { ok: false, fault: 'BOUNDS', message: `PC=${this.pc} exceeds CR14 code limit (limit17=${cr14w2.limit}, last valid PC)` };
        }
        // +1: skip lump header at word 0; code region starts at word0_location + 1
        const fetchAddr = entry.word0_location + 1 + this.pc;
        if (fetchAddr >= this.memory.length) {
            return { ok: false, fault: 'BOUNDS', message: `fetch address 0x${fetchAddr.toString(16)} out of memory` };
        }
        this.physicalPC = fetchAddr;
        return { ok: true, word: this.memory[fetchAddr], addr: fetchAddr };
    }

    step() {
        if (this.halted) return null;
        this.auditLog = [];

        const fetch = this._fetchInstruction();
        if (!fetch.ok) {
            this.fault(fetch.fault, fetch.message);
            return null;
        }
        const instrWord = fetch.word;
        if (instrWord === 0) {
            if (!this.bootComplete) {
                this.output += `[PP250] Zero instruction at PC=${this.pc} (addr=0x${fetch.addr.toString(16)}) — pre-boot zero, returning to boot sequence\n`;
                this._returnToBoot();
                return { pc: this.pc, physicalPC: this.physicalPC, instr: null, desc: 'PP250: zero instruction -> reboot' };
            }
            this.output += `[PP250] HALT at PC=${this.pc} (addr=0x${fetch.addr.toString(16)}) — machine stopped.\n`;
            this.halted = true;
            this.running = false;
            this.emit('stateChange', this.getState());
            return { pc: this.pc, physicalPC: this.physicalPC, instr: null, desc: 'HALT: machine stopped' };
        }

        const d = this.decodeInstruction(instrWord);
        this.stepCount++;

        this._instrHistory.push({
            step: this.stepCount,
            pc: this.pc,
            physicalPC: fetch.addr,
            raw: instrWord,
            opName: this.opName(d.opcode),
            cond: this.condName(d.cond),
            crDst: d.crDst,
            crSrc: d.crSrc,
            imm: d.imm,
        });
        if (this._instrHistory.length > 5) this._instrHistory.shift();

        if (!this.checkCondition(d.cond)) {
            const result = {
                pc: this.pc,
                physicalPC: this.physicalPC,
                instr: d,
                skipped: true,
                desc: `${this.opName(d.opcode)}${this.condName(d.cond)} skipped (condition false)`,
            };
            this.pc++;
            this.emit('step', result);
            this.emit('stateChange', this.getState());
            return result;
        }

        let result = null;
        switch (d.opcode) {
            case 0: result = this._execLoad(d); break;
            case 1: result = this._execSave(d); break;
            case 2: result = this._execCall(d); break;
            case 3: result = this._execReturn(d); break;
            case 4: result = this._execChange(d); break;
            case 5: result = this._execSwitch(d); break;
            case 6: result = this._execTperm(d); break;
            case 7: result = this._execLambda(d); break;
            case 8: result = this._execEloadcall(d); break;
            case 9: result = this._execXloadlambda(d); break;
            case 10: result = this._execDread(d); break;
            case 11: result = this._execDwrite(d); break;
            case 12: result = this._execBfext(d); break;
            case 13: result = this._execBfins(d); break;
            case 14: result = this._execMcmp(d); break;
            case 15: result = this._execIadd(d); break;
            case 16: result = this._execIsub(d); break;
            case 17: result = this._execBranch(d); break;
            case 18: result = this._execShl(d); break;
            case 19: result = this._execShr(d); break;
            default:
                this.fault('INVALID_OP', `Unknown opcode ${d.opcode}`);
                return null;
        }

        if (result) {
            this.dr[0] = 0;
            result.physicalPC = this.physicalPC;
            result.auditPipeline = this._auditPipeline();
            this.emit('step', result);
            this.emit('stateChange', this.getState());
        }
        return result;
    }

    _execLoad(d) {
        const clistGT = this.cr[d.crSrc].word0;
        if (clistGT === 0) {
            this.fault('NULL_CAP', `LOAD: CR${d.crSrc} is NULL`);
            return null;
        }
        let clistLoc;
        let clistSize;
        if (d.crSrc === 6) {
            clistLoc = this.cr[d.crSrc].word1;
            clistSize = this.parseNSWord1(this.cr[6].word2).limit + 1;
        } else {
            const lumpBase = this.cr[d.crSrc].word1;
            const hdrWord = this.memory[lumpBase] >>> 0;
            const hdr = this.parseLumpHeader(hdrWord);
            clistLoc = (hdr.valid && hdr.cc > 0) ? (lumpBase + hdr.lumpSize - hdr.cc) >>> 0 : lumpBase;
            clistSize = (hdr.valid && hdr.cc > 0) ? hdr.cc : 1;
        }
        const absAddr = (clistLoc + d.imm) >>> 0;
        const clistRange = { base: clistLoc, upperBound: (clistLoc + clistSize - 1) >>> 0 };
        const check = this.mLoad(clistGT, d.crSrc === 6 ? null : 'L', d.crSrc, absAddr, clistRange);
        if (!check.ok) {
            this.fault(check.fault, `LOAD: CR${d.crSrc}: ${check.message}`);
            return null;
        }
        const slotGT = this.memory[clistLoc + d.imm] || 0;
        if (slotGT === 0) {
            this.fault('NULL_CAP', `LOAD: c-list offset ${d.imm} is empty (NULL GT)`);
            return null;
        }
        const slotParsed = this.parseGT(slotGT);

        if (d.crSrc === 6) {
            const permCheck = this._validateClistSlotPerms(slotParsed, d.imm);
            if (!permCheck.ok) {
                this.fault(permCheck.fault, `LOAD: ${permCheck.message}`);
                return null;
            }
        }

        const targetIdx = slotParsed.index;
        if (targetIdx >= this.nsCount || !this.isNSEntryValid(targetIdx)) {
            this.fault('BOUNDS', `LOAD: namespace index ${targetIdx} out of bounds`);
            return null;
        }
        const entry = this.readNSEntry(targetIdx);
        if (!entry) {
            this.fault('BOUNDS', `LOAD: entry ${targetIdx} is null`);
            return null;
        }
        if (!this.validateMAC(entry)) {
            this.fault('SEAL', `LOAD: entry ${targetIdx} seal failed`);
            return null;
        }
        if (!this._writeCR(d.crDst, slotGT, entry)) return null;
        const label = this.nsLabels[targetIdx] || 'entry_'+targetIdx;
        const desc = `LOAD CR${d.crDst}, [CR${d.crSrc} + ${d.imm}] -> ${label}`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: this._loadPipeline(d, label) };
    }

    _execSave(d) {
        const srcGT = this.cr[d.crDst].word0;
        if (srcGT === 0) {
            this.fault('NULL_CAP', `SAVE: CR${d.crDst} is NULL`);
            return null;
        }
        const saveCheck = this.mSave(srcGT, null, d.crDst);
        if (!saveCheck.ok) {
            this.fault(saveCheck.fault, `SAVE: CR${d.crDst}: ${saveCheck.message}`);
            return null;
        }
        const savedCap = this.lastCapability;
        const clistGT = this.cr[d.crSrc].word0;
        if (clistGT === 0) {
            this.fault('NULL_CAP', `SAVE: CR${d.crSrc} C-List is NULL`);
            return null;
        }
        let clistLoc;
        let clistSize;
        if (d.crSrc === 6) {
            clistLoc = this.cr[d.crSrc].word1;
            clistSize = this.parseNSWord1(this.cr[6].word2).limit + 1;
        } else {
            const lumpBase = this.cr[d.crSrc].word1;
            const hdrWord = this.memory[lumpBase] >>> 0;
            const hdr = this.parseLumpHeader(hdrWord);
            clistLoc = (hdr.valid && hdr.cc > 0) ? (lumpBase + hdr.lumpSize - hdr.cc) >>> 0 : lumpBase;
            clistSize = (hdr.valid && hdr.cc > 0) ? hdr.cc : 1;
        }
        const saveAbsAddr = (clistLoc + d.imm) >>> 0;
        const saveClistRange = { base: clistLoc, upperBound: (clistLoc + clistSize - 1) >>> 0 };
        const clistCheck = this.mLoad(clistGT, 'S', d.crSrc, saveAbsAddr, saveClistRange);
        if (!clistCheck.ok) {
            this.fault(clistCheck.fault, `SAVE: CR${d.crSrc}: ${clistCheck.message}`);
            return null;
        }
        this.lastCapability = savedCap;

        if (d.crSrc === 6) {
            const srcParsedCheck = this.parseGT(srcGT);
            const slotPermCheck = this._validateClistSlotPerms(srcParsedCheck, d.imm);
            if (!slotPermCheck.ok) {
                this.fault(slotPermCheck.fault, `SAVE: ${slotPermCheck.message}`);
                return null;
            }
        }

        this.memory[clistLoc + d.imm] = srcGT;
        const srcParsed = saveCheck.parsed;
        const clistIdx = clistCheck.parsed.index;
        if (!this.nsClistMap[clistIdx]) {
            this.nsClistMap[clistIdx] = [];
        }
        if (!this.nsClistMap[clistIdx].includes(srcParsed.index)) {
            this.nsClistMap[clistIdx].push(srcParsed.index);
        }
        const label = this.nsLabels[srcParsed.index] || 'entry_'+srcParsed.index;
        const desc = `SAVE CR${d.crDst} -> [CR${d.crSrc} + ${d.imm}] (${label})`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc };
    }

    _execCall(d) {
        const sourceGT = this.cr[d.crDst].word0;
        if (sourceGT === 0) {
            this.fault('NULL_CAP', `CALL: CR${d.crDst} is NULL`);
            return null;
        }
        const srcParsed = this.parseGT(sourceGT);
        if (srcParsed.type === 0) {
            this.fault('TYPE', `CALL: CR${d.crDst} GT type is NULL — cannot CALL a NULL GT`);
            return;
        }
        if (srcParsed.type !== 1 && srcParsed.type !== 3) {
            this.fault('TYPE', `CALL: CR${d.crDst} GT type is ${srcParsed.typeName}, must be Inform or Abstract`);
            return null;
        }
        const check = this.mLoad(sourceGT, 'E', d.crDst);
        if (!check.ok) {
            this.fault(check.fault, `CALL: CR${d.crDst}: ${check.message}`);
            return null;
        }
        const nsEntry = check.entry;
        const word1 = this.parseNSWord1(nsEntry.word1_limit);
        if (word1.f === 1) {
            this.fault('FAR', `CALL: CR${d.crDst} has F-bit set (Far)`);
            return null;
        }

        const handler = this.nsHandlers[check.index];
        if (handler) {
            // Handler dispatches are atomic (no real call frame): save and restore CR6 so
            // the caller's c-list base (CR6.word1) is never corrupted by _writeCR's lump-start write.
            const savedCR6 = {...this.cr[6]};
            this._writeCR(6, sourceGT, nsEntry);
            const handlerResult = this._dispatchHandler(d, check, handler);
            this.cr[6] = savedCR6;
            return handlerResult;
        }

        if (this.abstractionRegistry) {
            const abstraction = this.abstractionRegistry.getAbstraction(check.index);
            if (abstraction && abstraction.methods.length > 0) {
                this.abstractionRegistry.activate(check.index);
                const savedCR6 = {...this.cr[6]};
                this._writeCR(6, sourceGT, nsEntry);
                const abstrResult = this._dispatchAbstraction(d, check, abstraction);
                this.cr[6] = savedCR6;
                return abstrResult;
            }
        }

        const savedSTO = this.sto;
        const callThreadBase = this.cr[12] && this.cr[12].word1;
        if (callThreadBase) {
            const newSTO = (savedSTO - 2) & 0xFFF;
            const hdrWord = this.memory[callThreadBase] >>> 0;
            const hdr = this.parseLumpHeader(hdrWord);
            const lumpSize = hdr.valid ? hdr.lumpSize : 256;
            const sw = (hdr.valid && hdr.typ === 2) ? hdr.cw : 0;
            const sp_max = lumpSize - 12 - 1;
            const sp_min = sp_max - sw + 1;
            if (newSTO < sp_min) {
                this.fault('BOUNDS', `CALL CR${d.crDst}: stack overflow — STO would become ${newSTO}, sp_min=${sp_min} (sw=${sw}, ${this.callStack.length} frame(s) deep)`);
                return null;
            }
        }
        // STO-1 stores the CALLER'S old CR6 word0 (L-type post-boot).
        // RETURN restores CR6 from savedCRs (not from memory); STO-1 is the
        // hardware-accurate memory layout for the thread lump display.
        const oldCR6GT = this.cr[6].word0 >>> 0;
        const frameWord = this._packFrameWord(this.pc + 1, 1, savedSTO);
        this.callStack.push({
            returnPC:   this.pc + 1,
            savedCRs:   this.cr.map(c => ({...c})),
            savedDRs:   [...this.dr],
            savedFlags: {...this.flags},
            savedSTO,
            sz: 1,
            frameWord,
        });
        if (callThreadBase) {
            this.memory[callThreadBase + savedSTO]     = frameWord;
            this.memory[callThreadBase + savedSTO - 1] = oldCR6GT;
        }
        this.sto = (savedSTO - 2) & 0xFFF;

        const base = nsEntry.word0_location;
        const label = this.nsLabels[check.index] || 'abstraction';
        let cr7Desc = '';

        // Read lump header at word 0 — hardware reads this to simultaneously derive CR14+CR6.
        // Layout: magic(5) | n_minus_6(4) | cw(13) | typ(2) | cc(8)
        const hdrWord = this.memory[base] >>> 0;
        const hdr = this.parseLumpHeader(hdrWord);
        const hasLumpHeader = hdr.valid && hdr.cc > 0;

        if (hasLumpHeader) {
            const cw       = hdr.cw;
            const cc       = hdr.cc;
            const lumpSz   = hdr.lumpSize;
            // clistStart = lumpSz - cc: c-list occupies the LAST cc words of the slot.
            // Matches call.py line 282: base = NS_base + (lumpSize − cc) × 4 (byte addr of c-list[0]).
            // lumpSz is always 2^(n_minus_6+6) (a power of 2, min 64 words) — NOT (1+cw+cc).
            const clistStart = lumpSz - cc;

            // CR14 (code, RX, M=1) and CR6 (c-list, E+M=1) set simultaneously from single lump header read.
            // M=1 on both: CALL Phase 1 mLoad is always M-elevated (call.py: mload_m_elevated = 1).
            const cr14GT = this.createGT(srcParsed.gt_seq, check.index, {R:1,W:0,X:1,L:0,S:0,E:0}, 1);
            const cr14Word1 = this.packNSWord1(cw - 1, 0, 0, 0, 0, 1, 0);
            this.cr[14] = {
                word0: cr14GT,
                word1: base,
                word2: cr14Word1,
                word3: nsEntry.word2_seals,
                m: 1    // CALL Phase 1 mLoad is always M-elevated
            };

            // CR6: E-only GT — same slot/seq/type as source, perms fixed to E alone.
            // E allows recursive CALL via CR6 directly. Device GTs (L+S+E) have L/S stripped.
            // Matches boot LOAD_NUC convention (line 624): CR6 always carries E perm.
            // M is recorded in cr.m = 1 (not in the GT perms field).
            const cr6GT = this.createGT(srcParsed.gt_seq, check.index, {R:0,W:0,X:0,L:0,S:0,E:1}, srcParsed.type);
            const cr6Word1 = this.packNSWord1(cc - 1, 0, 0, 0, 0, 1, 0);
            this.cr[6] = {
                word0: cr6GT,                       // E-only (recursive CALL via CR6; matches boot LOAD_NUC CR6)
                word1: (base + clistStart) >>> 0,
                word2: cr6Word1,
                word3: nsEntry.word2_seals,
                m: 1    // M set (CALL Phase 1 mLoad always M-elevated; call.py: mload_m_elevated = 1)
            };
            // CR6 lives in the CALL stack frame (written above); NOT in the caps zone

            cr7Desc = `, hdr=0x${hdrWord.toString(16).toUpperCase().padStart(8,'0')} → CR14+CR6 simultaneous: CR14(RX M=1,cw=${cw},lim=0..${cw-1}) CR6(E M=1,cc=${cc},base=0x${(base+clistStart).toString(16).toUpperCase()})`;
        } else {
            // Non-lump-header path: write E-only GT to CR6 (strip L/S from device GT) + M.
            // Matches boot LOAD_NUC convention: CR6 = E perm (recursive CALL via CR6).
            const cr6GTnorm = this.createGT(srcParsed.gt_seq, check.index, {R:0,W:0,X:0,L:0,S:0,E:1}, srcParsed.type);
            this._writeCR(6, cr6GTnorm, nsEntry);
            this.cr[6].m = 1;   // M set (CALL always M-elevated; _writeCR uses global mElevation which may be 0 post-boot)

            const clistLoc = nsEntry.word0_location;
            const cr14GTVal = this.memory[clistLoc];
            if (cr14GTVal !== 0) {
                const cr14Parsed = this.parseGT(cr14GTVal);
                if (cr14Parsed.type === 1 && cr14Parsed.permissions.X) {
                    const cr14Entry = this.readNSEntry(cr14Parsed.index);
                    if (cr14Entry) {
                        const cr14Word1p = this.parseNSWord1(cr14Entry.word1_limit);
                        if (cr14Word1p.f !== 1) {
                            const cr14Check = this.mLoad(cr14GTVal, 'X', undefined);
                            if (cr14Check.ok) {
                                this._writeCR(14, cr14GTVal, cr14Check.entry);
                                cr7Desc = `, CR14 <- X-GT(Slot ${cr14Parsed.index})`;
                            }
                        }
                    }
                }
            }
        }

        const desc = `CALL CR${d.crDst} -> ${label}${cr7Desc}`;
        this.output += desc + '\n';
        const prevPC = this.pc;
        this.pc = 0;
        return { pc: prevPC, instr: d, desc, pipeline: this._callPipeline(d, label) };
    }

    _dispatchAbstraction(d, check, abstraction) {
        const label = abstraction.name;

        if (check.index === 5) {
            const cr1GT = this.cr[1].word0;
            if (cr1GT !== 0) {
                const cr1Parsed = this.parseGT(cr1GT);
                if (cr1Parsed.type === 3) {  // Type 3 = Abstract GT (PassKey)
                    const desc = `CALL CR${d.crDst} -> Navana.ValidatePassKey [PassKey in CR1]`;
                    this.output += desc + '\n';

                    const result = this.abstractionRegistry.dispatchMethod(5, 'ValidatePassKey', this, {
                        passKeyGT: cr1GT
                    });

                    if (result && result.ok) {
                        const driverGT = result.result.driverGT;
                        if (driverGT) {
                            const driverParsed = this.parseGT(driverGT);
                            const driverEntry = this.readNSEntry(driverParsed.index);
                            if (driverEntry) {
                                this._writeCR(1, driverGT, driverEntry);
                                this.output += `  ${result.message}\n`;
                                this.output += `  CR1 <- E-perm LED driver (NS[${driverParsed.index}])\n`;
                            } else {
                                this.output += `  ValidatePassKey succeeded but driver NS[${driverParsed.index}] entry missing\n`;
                                this.fault('PERM', `CALL Navana: driver NS entry not found at index ${driverParsed.index}`);
                                return null;
                            }
                        } else {
                            this.output += `  ValidatePassKey succeeded but no driver GT returned\n`;
                            this.fault('PERM', 'CALL Navana: no driver GT in validation result');
                            return null;
                        }
                        this.dr[0] = result.result.permMask || 0;
                    } else {
                        this.output += `  ${result ? result.message : 'Navana.ValidatePassKey failed'}\n`;
                        this.fault('PERM', `CALL Navana: PassKey validation failed — ${result ? result.message : 'unknown error'}`);
                        return null;
                    }

                    this.pc++;
                    return { pc: this.pc - 1, instr: d, desc, pipeline: [
                        { stage: 'CALL', desc: 'Enter Navana (PassKey gate)', perm: 'E', status: 'pass' },
                        { stage: 'VALIDATE', desc: `PassKey validated for ${result.result.device}`, status: 'pass' },
                        { stage: 'GRANT', desc: 'CR1 <- E-perm LED driver', status: 'pass' },
                        { stage: 'RETURN', desc: 'Exit Navana', status: 'pass' },
                    ]};
                }
            }

            let methodName, argDR0, argDR1, encodedDstReg = null;
            if (d.imm & 0x4000) {
                const packed = d.imm & 0x3FFF;
                const methodIdx = (packed >> 8) & 0xF;
                const leftReg = (packed >> 4) & 0xF;
                const rightReg = packed & 0xF;
                encodedDstReg = d.crSrc;
                argDR0 = this.dr[leftReg];
                argDR1 = this.dr[rightReg];
                methodName = (methodIdx >= 0 && methodIdx < abstraction.methods.length)
                    ? abstraction.methods[methodIdx]
                    : (abstraction.methods[0] || 'Apply');
            } else {
                methodName = this._selectNavanaMethod(d) || abstraction.methods[0] || 'Apply';
                argDR0 = this.dr[0];
                argDR1 = this.dr[1];
            }
            const desc = `CALL CR${d.crDst} -> ${label}.${methodName} [abstraction dispatch]`;
            this.output += desc + '\n';

            if (this.abstractionRegistry) {
                const result = this.abstractionRegistry.dispatchMethod(check.index, methodName, this, {
                    dr0: argDR0, dr1: argDR1
                });
                if (result && result.message) {
                    this.output += `  ${result.message}\n`;
                }
                if (result && result.ok && result.result !== undefined && typeof result.result === 'number') {
                    if (encodedDstReg !== null) {
                        this.dr[encodedDstReg] = result.result;
                    } else {
                        this.dr[0] = result.result;
                    }
                }
                if (result && !result.ok && result.fault) {
                    this.fault(result.fault, `${label}.${methodName}: ${result.message}`);
                    this.pc++;
                    return { pc: this.pc - 1, instr: d, desc, pipeline: [
                        { stage: 'CALL', desc: `Enter ${label} abstraction`, perm: 'E', status: 'pass' },
                        { stage: 'DISPATCH', desc: `${label}.${methodName}`, status: 'fail' },
                        { stage: 'FAULT', desc: `${result.fault}: ${result.message}`, status: 'fail' },
                    ]};
                }
            }

            this.pc++;
            return { pc: this.pc - 1, instr: d, desc, pipeline: [
                { stage: 'CALL', desc: `Enter ${label} abstraction`, perm: 'E', status: 'pass' },
                { stage: 'DISPATCH', desc: `${label}.${methodName}`, status: 'pass' },
                { stage: 'RETURN', desc: `Exit ${label}`, status: 'pass' },
            ]};
        }

        let methodIndex, argDR0, argDR1, desc, encodedDstReg;
        // ISA extension: encoded CALL mode (imm bit 14 set)
        // Packs method index, source operand registers, and destination DR into CALL instruction
        // fields (imm[11:8]=method, imm[7:4]=leftDR, imm[3:0]=rightDR, crSrc=dstDR).
        // Result is written directly to dstDR, bypassing DR0 zero-register enforcement.
        // Legacy mode (imm bit 14 clear) uses DR3 as method selector with DR0/DR1 operands.
        if (d.imm & 0x4000) {
            const packed = d.imm & 0x3FFF;
            methodIndex = (packed >> 8) & 0xF;
            const leftReg = (packed >> 4) & 0xF;
            const rightReg = packed & 0xF;
            encodedDstReg = d.crSrc;
            argDR0 = this.dr[leftReg];
            argDR1 = this.dr[rightReg];
            const methodName2 = (methodIndex >= 0 && methodIndex < abstraction.methods.length)
                ? abstraction.methods[methodIndex]
                : (abstraction.methods[0] || 'Apply');
            desc = `CALL CR${d.crDst} -> ${label}.${methodName2} [DR${leftReg}, DR${rightReg}] -> DR${encodedDstReg}`;
        } else {
            methodIndex = this.dr[3] || 0;
            encodedDstReg = null;
            argDR0 = this.dr[0];
            argDR1 = this.dr[1];
            desc = `CALL CR${d.crDst} -> ${label}.${abstraction.methods[methodIndex] || 'Apply'} [DR3=${methodIndex}]`;
        }
        const methodName = (methodIndex >= 0 && methodIndex < abstraction.methods.length)
            ? abstraction.methods[methodIndex]
            : (abstraction.methods[0] || 'Apply');
        this.output += desc + '\n';

        if (this.abstractionRegistry) {
            const result = this.abstractionRegistry.dispatchMethod(check.index, methodName, this, {
                dr0: argDR0, dr1: argDR1
            });
            if (result && result.message) {
                this.output += `  ${result.message}\n`;
            }
            if (result && result.ok && result.result !== undefined && typeof result.result === 'number') {
                if (encodedDstReg !== null) {
                    this.dr[encodedDstReg] = result.result;
                } else {
                    this.dr[0] = result.result;
                }
                if (result.result2 !== undefined && typeof result.result2 === 'number') {
                    const secondReg = encodedDstReg !== null ? Math.min(encodedDstReg + 1, 15) : 1;
                    this.dr[secondReg] = result.result2;
                }
            }
            if (result && !result.ok && result.fault) {
                this.fault(result.fault, `${label}.${methodName}: ${result.message}`);
                this.pc++;
                return { pc: this.pc - 1, instr: d, desc, pipeline: [
                    { stage: 'CALL', desc: `Enter ${label} abstraction`, perm: 'E', status: 'pass' },
                    { stage: 'DISPATCH', desc: `${label}.${methodName}`, status: 'fail' },
                    { stage: 'FAULT', desc: `${result.fault}: ${result.message}`, status: 'fail' },
                ]};
            }
        }

        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: [
            { stage: 'CALL', desc: `Enter ${label} abstraction`, perm: 'E', status: 'pass' },
            { stage: 'DISPATCH', desc: `${label}.${methodName}`, status: 'pass' },
            { stage: 'RETURN', desc: `Exit ${label}`, status: 'pass' },
        ]};
    }

    _selectNavanaMethod(d) {
        const dr0 = this.dr[0];
        if (dr0 === 0) return 'Init';
        if (dr0 === 1) return 'Manage';
        if (dr0 === 2) return 'Monitor';
        if (dr0 === 3) return 'IDS';
        if (dr0 === 4) return 'MintPassKey';
        if (dr0 === 5) return 'GetPassKeyAuditLog';
        return null;
    }

    _dispatchHandler(d, check, handler) {
        const label = this.nsLabels[check.index] || 'handler';
        switch (handler) {
            case 'gc': {
                const desc = `CALL CR${d.crDst} -> ${label} [safe Turing abstraction: GC]`;
                this.output += desc + '\n';
                this.output += `[M] Entering atomic Turing abstraction: ${label}\n`;
                this.mElevation = true;
                const gcResult = this.runGC();
                this.mElevation = false;
                this.output += `[M] Exiting atomic Turing abstraction: ${label} — RETURN\n`;
                this.pc++;
                return { pc: this.pc - 1, instr: d, desc, pipeline: [
                    { stage: 'CALL', desc: `Enter ${label} safe abstraction`, perm: 'E', status: 'pass' },
                    { stage: 'GC-SCAN', desc: `Scan CRs, confirm ${gcResult.liveCount} live entries`, status: 'pass' },
                    { stage: 'GC-SWEEP', desc: `Sweep ${gcResult.freedSlots} garbage entries`, status: 'pass' },
                    { stage: 'RETURN', desc: `Exit ${label}, flip polarity`, status: 'pass' },
                ]};
            }
            case 'led_driver': {
                const desc = `CALL CR${d.crDst} -> ${label} [LED driver E-perm abstraction]`;
                this.output += desc + '\n';

                const dr0 = this.dr[0];
                const dr1 = this.dr[1];
                const callerGT = this.cr[d.crDst].word0;

                if (this.abstractionRegistry) {
                    const result = this.abstractionRegistry.dispatchMethod(5, 'CallLEDDriver', this, {
                        callerGT: callerGT,
                        dr0: dr0,
                        dr1: dr1
                    });

                    if (result && result.ok) {
                        this.output += `  ${result.message}\n`;
                        if (result.result && result.result.state !== undefined) {
                            this.dr[0] = result.result.state;
                        }
                        if (result.result && result.result.led !== undefined) {
                            this.dr[0] = result.result.state || 0;
                        }
                    } else {
                        this.output += `  ${result ? result.message : 'LED driver call failed'}\n`;
                        this.fault('PERM', `LED driver: ${result ? result.message : 'unknown error'}`);
                        return null;
                    }
                }

                this.pc++;
                const methodNames = ['Set', 'Clear', 'Pattern', 'Get'];
                const methodSelector = (dr0 >>> 24) & 0xFF;
                let dispatchMethod;
                if (methodSelector > 0 && methodSelector <= 3) {
                    dispatchMethod = methodSelector;
                } else if (dr1 > 0) {
                    dispatchMethod = 0;
                } else {
                    dispatchMethod = 2;
                }
                const methodName = methodNames[dispatchMethod] || 'Set';
                return { pc: this.pc - 1, instr: d, desc, pipeline: [
                    { stage: 'CALL', desc: `Enter LED driver`, perm: 'E', status: 'pass' },
                    { stage: 'DISPATCH', desc: `LED.${methodName}(DR0=0x${dr0.toString(16)}, DR1=0x${dr1.toString(16)})`, status: 'pass' },
                    { stage: 'DEVICE', desc: `Hardware write at 0xFE10`, status: 'pass' },
                    { stage: 'RETURN', desc: `Exit LED driver`, status: 'pass' },
                ]};
            }
            default:
                this.fault('HANDLER', `Unknown handler: ${handler}`);
                return null;
        }
    }

    _execReturn(d) {
        if (this.callStack.length === 0) {
            this.fault('STACK_UNDERFLOW', 'RETURN with no call frames — stack is empty (no sentinel pushed). Nothing to return to.');
            return null;
        }
        const mask = d.imm & 0xFFF;
        const frame = this.callStack.pop();

        // Sentinel frame: NIA=0x7FFF (poison) signals the bottom of the call stack.
        // RETURN through the sentinel means the top-level abstraction tried to return
        // past the last frame — this is a stack-underflow fault.
        if (frame.sentinel) {
            this.fault('STACK_UNDERFLOW', 'RETURN through sentinel frame (NIA=0x7FFF) — stack underflow: no caller above the root abstraction.');
            return null;
        }

        if (frame.savedCRs) {
            const tnBaseRet = this.cr[12] && this.cr[12].word1;
            for (let i = 0; i < frame.savedCRs.length; i++) {
                this.cr[i] = {...frame.savedCRs[i]};
                // Restore GT home slot for CR0-CR11 except CR6 (CR6 lives in stack frames)
                if (i <= 11 && i !== 6 && tnBaseRet) {
                    this.memory[tnBaseRet + THREAD_CAPS_OFFSET + i] = this.cr[i].word0 >>> 0;
                }
            }
        }
        if (frame.savedDRs) this.dr = [...frame.savedDRs];
        if (frame.savedFlags) this.flags = {...frame.savedFlags};
        if (typeof frame.savedSTO === 'number') this.sto = frame.savedSTO;
        const clearedCRs = [];
        for (let i = 0; i < 12; i++) {
            if (mask & (1 << i)) {
                this._clearCR(i);
                clearedCRs.push(`CR${i}`);
            }
        }
        const frameTag = frame.sz === 0 ? 'LAMBDA' : 'CALL';
        const maskDesc = mask ? ` MASK=0b${mask.toString(2).padStart(12, '0')} cleared[${clearedCRs.join(',')}]` : '';
        const desc = `RETURN (${frameTag}/SZ=${frame.sz}) PC→${frame.returnPC}${maskDesc}`;
        this.output += desc + '\n';
        this.pc = frame.returnPC;
        return { pc: frame.returnPC, instr: d, desc, pipeline: this._returnPipeline(d, frame, mask) };
    }

    _execChange(d) {
        const srcGT = this.cr[d.crSrc].word0;
        if (srcGT === 0) {
            this.fault('NULL_CAP', `CHANGE: CR${d.crSrc} is NULL`);
            return null;
        }
        const targetIdx = d.imm;
        if (targetIdx >= this.nsCount || !this.isNSEntryValid(targetIdx)) {
            this.fault('BOUNDS', `CHANGE: index ${targetIdx} out of bounds`);
            return null;
        }
        const entry = this.readNSEntry(targetIdx);
        if (!entry) {
            this.fault('BOUNDS', `CHANGE: entry ${targetIdx} is null`);
            return null;
        }
        const gt = this.memory[entry.word0_location] || 0;
        if (!this._writeCR(d.crDst, gt, entry)) return null;
        const desc = `CHANGE CR${d.crDst}, [CR${d.crSrc}] idx=${targetIdx}`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc };
    }

    _execSwitch(d) {
        const srcGT = this.cr[d.crSrc].word0;
        const target = d.imm & 0x7;
        if (srcGT === 0) {
            this.fault('NULL_CAP', `SWITCH: CR${d.crSrc} is NULL`);
            return null;
        }
        const temp = { ...this.cr[d.crSrc] };
        this.cr[d.crSrc] = { ...this.cr[target] };
        this.cr[target] = temp;
        const desc = `SWITCH CR${d.crSrc} <-> CR${target}`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc };
    }

    _execTperm(d) {
        const gt = this.cr[d.crDst].word0;
        const bSet = (d.imm >>> 4) & 1;
        const presetCode = d.imm & 0xF;

        const presetMasks = [
            [],                ['R'],           ['R','W'],       ['X'],
            ['R','X'],         ['R','W','X'],   ['L'],           ['S'],
            ['E'],             ['L','S'],       null,            null,
            null,              null,  null,  null,
        ];

        if (presetMasks[presetCode] === null) {
            this.flags.Z = false;
            this.flags.N = true;
            this.flags.C = false;
            this.flags.V = false;
            const desc = `TPERM CR${d.crDst}, RSV${presetCode} [reserved, ignored] — Z=0`;
            this.output += desc + '\n';
            this.pc++;
            return { pc: this.pc - 1, instr: d, desc };
        }

        if (gt === 0) {
            this.flags.Z = false;
            this.flags.N = true;
            this.flags.C = false;
            this.flags.V = false;
            const desc = `TPERM CR${d.crDst} [NULL] — Z=0`;
            this.output += desc + '\n';
            this.pc++;
            return { pc: this.pc - 1, instr: d, desc };
        }

        const parsed = this.parseGT(gt);
        const required = presetMasks[presetCode];
        const hasAll = required.every(p => parsed.permissions[p] === 1);

        if (bSet && hasAll) {
            this.cr[d.crDst].word0 = (this.cr[d.crDst].word0 & ~(1 << 31)) >>> 0;
        }

        this.flags.Z = hasAll;
        this.flags.N = !hasAll;
        this.flags.C = false;
        this.flags.V = false;

        const permStr = (required.join('') || 'CLEAR') + (bSet ? '+B' : '');
        const result = hasAll ? 'PASS' : 'FAIL';
        const bMsg = (bSet && hasAll) ? ' B->0' : '';
        const desc = `TPERM CR${d.crDst}, ${permStr} -> ${result} (Z=${hasAll ? 1 : 0})${bMsg}`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: this._tpermPipeline(d, parsed, hasAll) };
    }

    _execLambda(d) {
        const crIdx = d.crDst;
        const targetGT = this.cr[crIdx].word0;
        if (targetGT === 0) {
            this.fault('NULL_CAP', `LAMBDA: CR${crIdx} is NULL`);
            return null;
        }
        const check = this.mLoad(targetGT, 'X', crIdx);
        if (!check.ok) {
            this.fault(check.fault, `LAMBDA: CR${crIdx}: ${check.message}`);
            return null;
        }

        const savedSTO = this.sto;
        const frameWord = this._packFrameWord(this.pc + 1, 0, savedSTO);
        this.callStack.push({
            returnPC:   this.pc + 1,
            savedCRs:   this.cr.map(c => ({...c})),
            savedFlags: {...this.flags},
            savedSTO,
            sz: 0,
            frameWord,
            isLambda: true,
        });
        this.sto = (savedSTO + 1) & 0xFFF;

        const label = this.nsLabels[check.index] || 'reduction';
        const desc = `LAMBDA CR${crIdx} -> ${label} [SZ=0, STO:${savedSTO}->${this.sto}]`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: this._lambdaPipeline(d, label) };
    }

    _execEloadcall(d) {
        const clistGT = this.cr[d.crSrc].word0;
        if (clistGT === 0) {
            this.fault('NULL_CAP', `ELOADCALL: CR${d.crSrc} C-List is NULL`);
            return null;
        }
        let srcLoc;
        let ecClistSize;
        if (d.crSrc === 6) {
            srcLoc = this.cr[d.crSrc].word1;
            ecClistSize = this.parseNSWord1(this.cr[6].word2).limit + 1;
        } else {
            const lumpBase = this.cr[d.crSrc].word1;
            const hdrWord = this.memory[lumpBase] >>> 0;
            const hdr = this.parseLumpHeader(hdrWord);
            srcLoc = (hdr.valid && hdr.cc > 0) ? (lumpBase + hdr.lumpSize - hdr.cc) >>> 0 : lumpBase;
            ecClistSize = (hdr.valid && hdr.cc > 0) ? hdr.cc : 1;
        }
        const ecAbsAddr = (srcLoc + d.imm) >>> 0;
        const ecClistRange = { base: srcLoc, upperBound: (srcLoc + ecClistSize - 1) >>> 0 };
        const loadCheck = this.mLoad(clistGT, d.crSrc === 6 ? null : 'L', d.crSrc, ecAbsAddr, ecClistRange);
        if (!loadCheck.ok) {
            this.fault(loadCheck.fault, `ELOADCALL LOAD: CR${d.crSrc}: ${loadCheck.message}`);
            return null;
        }

        const slotGT = this.memory[srcLoc + d.imm] || 0;
        if (slotGT === 0) {
            this.fault('NULL_CAP', `ELOADCALL: c-list offset ${d.imm} is empty`);
            return null;
        }
        const slotParsed = this.parseGT(slotGT);
        const targetIdx = slotParsed.index;
        if (targetIdx >= this.nsCount || !this.isNSEntryValid(targetIdx)) {
            this.fault('BOUNDS', `ELOADCALL: namespace index ${targetIdx} out of bounds`);
            return null;
        }
        const entry = this.readNSEntry(targetIdx);
        if (!entry) {
            this.fault('BOUNDS', `ELOADCALL: entry ${targetIdx} is null`);
            return null;
        }
        if (!this.validateMAC(entry)) {
            this.fault('SEAL', `ELOADCALL: entry ${targetIdx} seal failed`);
            return null;
        }

        // Validate the slot GT and gather TPERM / CR7 data before touching any CRs.
        const tpermCheck = this.mLoad(slotGT, 'E', undefined);
        if (!tpermCheck.ok) {
            this.fault(tpermCheck.fault, `ELOADCALL TPERM: CR${d.crDst}: ${tpermCheck.message}`);
            return null;
        }
        const clistEntry = tpermCheck.entry;
        const clistLoc = clistEntry.word0_location;
        const cr7GT = this.memory[clistLoc];
        let cr7Check = null;
        if (cr7GT !== 0) {
            const cr7Parsed = this.parseGT(cr7GT);
            if (cr7Parsed.type === 1) {
                const cr7Entry = this.readNSEntry(cr7Parsed.index);
                if (cr7Entry) {
                    const chk = this.mLoad(cr7GT, 'X', undefined);
                    if (chk.ok) cr7Check = chk;
                }
            }
        }

        const savedSTO_ec = this.sto;
        const ecThreadBase = this.cr[12] && this.cr[12].word1;
        if (ecThreadBase) {
            const newSTO_ec = (savedSTO_ec - 2) & 0xFFF;
            const hdrWord_ec = this.memory[ecThreadBase] >>> 0;
            const hdr_ec = this.parseLumpHeader(hdrWord_ec);
            const lumpSize_ec = hdr_ec.valid ? hdr_ec.lumpSize : 256;
            const sw_ec = (hdr_ec.valid && hdr_ec.typ === 2) ? hdr_ec.cw : 0;
            const sp_max_ec = lumpSize_ec - 12 - 1;
            const sp_min_ec = sp_max_ec - sw_ec + 1;
            if (newSTO_ec < sp_min_ec) {
                this.fault('BOUNDS', `ELOADCALL CR${d.crDst}: stack overflow — STO would become ${newSTO_ec}, sp_min=${sp_min_ec} (sw=${sw_ec}, ${this.callStack.length} frame(s) deep)`);
                return null;
            }
        }
        const frameWord_ec = this._packFrameWord(this.pc + 1, 1, savedSTO_ec);
        // Save CRs BEFORE any _writeCR calls so RETURN correctly restores the caller's context.
        this.callStack.push({
            returnPC:   this.pc + 1,
            savedCRs:   this.cr.map(c => ({...c})),
            savedDRs:   [...this.dr],
            savedFlags: {...this.flags},
            savedSTO:   savedSTO_ec,
            sz: 1,
            frameWord:  frameWord_ec,
        });
        this.sto = (savedSTO_ec - 2) & 0xFFF;

        // Now write the loaded GT and set up CR6/CR7 for the callee context.
        if (!this._writeCR(d.crDst, slotGT, entry)) return null;
        if (cr7Check) {
            this._writeCR(6, slotGT, clistEntry);
            this._writeCR(7, cr7GT, cr7Check.entry);
        }

        const label = this.nsLabels[targetIdx] || 'abstraction';
        const desc = `ELOADCALL CR${d.crDst}, [CR${d.crSrc} + ${d.imm}] -> ${label} (LOAD+TPERM+CALL)`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: this._eloadcallPipeline(d, label) };
    }

    _execXloadlambda(d) {
        const clistGT = this.cr[d.crSrc].word0;
        if (clistGT === 0) {
            this.fault('NULL_CAP', `XLOADLAMBDA: CR${d.crSrc} C-List is NULL`);
            return null;
        }
        let srcLoc;
        let xlClistSize;
        if (d.crSrc === 6) {
            srcLoc = this.cr[d.crSrc].word1;
            xlClistSize = this.parseNSWord1(this.cr[6].word2).limit + 1;
        } else {
            const lumpBase = this.cr[d.crSrc].word1;
            const hdrWord = this.memory[lumpBase] >>> 0;
            const hdr = this.parseLumpHeader(hdrWord);
            srcLoc = (hdr.valid && hdr.cc > 0) ? (lumpBase + hdr.lumpSize - hdr.cc) >>> 0 : lumpBase;
            xlClistSize = (hdr.valid && hdr.cc > 0) ? hdr.cc : 1;
        }
        const xlAbsAddr = (srcLoc + d.imm) >>> 0;
        const xlClistRange = { base: srcLoc, upperBound: (srcLoc + xlClistSize - 1) >>> 0 };
        const loadCheck = this.mLoad(clistGT, d.crSrc === 6 ? null : 'L', d.crSrc, xlAbsAddr, xlClistRange);
        if (!loadCheck.ok) {
            this.fault(loadCheck.fault, `XLOADLAMBDA LOAD: CR${d.crSrc}: ${loadCheck.message}`);
            return null;
        }

        const slotGT = this.memory[srcLoc + d.imm] || 0;
        if (slotGT === 0) {
            this.fault('NULL_CAP', `XLOADLAMBDA: c-list offset ${d.imm} is empty`);
            return null;
        }
        const slotParsed = this.parseGT(slotGT);
        const targetIdx = slotParsed.index;
        if (targetIdx >= this.nsCount || !this.isNSEntryValid(targetIdx)) {
            this.fault('BOUNDS', `XLOADLAMBDA: slot ${targetIdx} out of bounds`);
            return null;
        }
        const entry = this.readNSEntry(targetIdx);
        if (!entry) {
            this.fault('BOUNDS', `XLOADLAMBDA: slot ${targetIdx} is null`);
            return null;
        }
        if (!this.validateMAC(entry)) {
            this.fault('SEAL', `XLOADLAMBDA: slot ${targetIdx} seal failed`);
            return null;
        }

        if (!this._writeCR(d.crDst, slotGT, entry)) return null;

        if (!slotParsed.permissions.X) {
            this.fault('PERMISSION', `XLOADLAMBDA TPERM: CR${d.crDst} lacks X permission`);
            return null;
        }

        const label = this.nsLabels[targetIdx] || 'slot';
        const desc = `XLOADLAMBDA CR${d.crDst}, [CR${d.crSrc} + ${d.imm}] -> ${label} (LOAD+TPERM+LAMBDA)`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: this._xloadlambdaPipeline(d, label) };
    }

    _execDread(d) {
        const drIdx = d.crDst;
        const dataGT = this.cr[d.crSrc].word0;
        if (dataGT === 0) {
            this.fault('NULL_CAP', `DREAD: CR${d.crSrc} is NULL`);
            return null;
        }
        const srcCR = this.cr[d.crSrc];
        const loc = srcCR.word1;
        const offset = d.imm;
        const absAddr = (loc + offset) >>> 0;
        const check = this.mLoad(dataGT, 'R', d.crSrc, absAddr);
        if (!check.ok) {
            this.fault(check.fault, `DREAD: CR${d.crSrc}: ${check.message}`);
            return null;
        }
        const value = this.memory[loc + offset];
        this.dr[drIdx] = value >>> 0;
        const label = this.nsLabels[check.index] || 'data';
        const desc = `DREAD DR${drIdx}, [CR${d.crSrc} + ${offset}] -> 0x${(value >>> 0).toString(16).toUpperCase().padStart(8,'0')} (${label})`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: [
            { stage: 'DREAD', desc: `Read word ${offset} from ${label} into DR${drIdx}`, perm: 'R', status: 'pass' },
        ]};
    }

    _execDwrite(d) {
        const drIdx = d.crDst;
        const dataGT = this.cr[d.crSrc].word0;
        if (dataGT === 0) {
            this.fault('NULL_CAP', `DWRITE: CR${d.crSrc} is NULL`);
            return null;
        }
        const srcCR = this.cr[d.crSrc];
        const loc = srcCR.word1;
        const offset = d.imm;
        const absAddr = (loc + offset) >>> 0;
        const check = this.mLoad(dataGT, 'W', d.crSrc, absAddr);
        if (!check.ok) {
            this.fault(check.fault, `DWRITE: CR${d.crSrc}: ${check.message}`);
            return null;
        }
        const value = this.dr[drIdx] >>> 0;
        this.memory[loc + offset] = value;

        // Route device writes to simulated hardware peripherals
        const devNsIdx = check.index;
        if (devNsIdx === 12) {
            // LED_DEV: offsets 0–4 each control one LED; bit[0] = R (red) drives the pin
            // Matches hardware: DWRITE DR1, CR3, 0 sets LED0 R-bit (bit[0] of word at offset 0)
            if (offset <= 4) {
                if (value & 1) {
                    this.ledBits |= (1 << offset);
                } else {
                    this.ledBits &= ~(1 << offset);
                }
            }
            this.ledMode = 'program';
        }

        const label = this.nsLabels[check.index] || 'data';
        const devTag = devNsIdx === 12 ? ` [→ LED${offset} = ${value & 1 ? 'ON' : 'OFF'} (bit[0] drives pin)]`
                     : devNsIdx === 11 ? ` [→ UART ${offset===0?'TX':offset===1?'STATUS':'RX'}]`
                     : devNsIdx === 13 ? ' [→ BTN read-only]'
                     : devNsIdx === 14 ? ` [→ TIMER ${['TICKS_LO','TICKS_HI','TOD_EPOCH','ALARM_CMP','ALARM_CTL'][offset]||'reg'}]`
                     : '';
        const desc = `DWRITE DR${drIdx}, [CR${d.crSrc} + ${offset}] <- 0x${value.toString(16).toUpperCase().padStart(8,'0')} (${label})${devTag}`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: [
            { stage: 'DWRITE', desc: `Write DR${drIdx} to word ${offset} of ${label}`, perm: 'W', status: 'pass' },
        ]};
    }

    _setFlags(result) {
        result = result >>> 0;
        this.flags.Z = (result === 0);
        this.flags.N = ((result >>> 31) & 1) === 1;
    }

    _setAddFlags(a, b, result) {
        const r = result >>> 0;
        this.flags.Z = (r === 0);
        this.flags.N = ((r >>> 31) & 1) === 1;
        this.flags.C = (result > 0xFFFFFFFF);
        const sa = (a >>> 31) & 1;
        const sb = (b >>> 31) & 1;
        const sr = (r >>> 31) & 1;
        this.flags.V = ((sa === sb) && (sr !== sa));
    }

    _setSubFlags(a, b, result) {
        const r = result >>> 0;
        this.flags.Z = (r === 0);
        this.flags.N = ((r >>> 31) & 1) === 1;
        this.flags.C = (a >= b);
        const sa = (a >>> 31) & 1;
        const sb = (b >>> 31) & 1;
        const sr = (r >>> 31) & 1;
        this.flags.V = ((sa !== sb) && (sr !== sa));
    }

    _execBfext(d) {
        const dataGT = this.cr[d.crSrc].word0;
        if (dataGT === 0) {
            this.fault('NULL_CAP', `BFEXT: CR${d.crSrc} is NULL`);
            return null;
        }
        const loc = this.cr[d.crSrc].word1;
        const check = this.mLoad(dataGT, 'R', d.crSrc, loc);
        if (!check.ok) {
            this.fault(check.fault, `BFEXT: CR${d.crSrc}: ${check.message}`);
            return null;
        }
        const pos = (d.imm >>> 5) & 0x1F;
        const width = d.imm & 0x1F;
        if (width === 0 || pos + width > 32) {
            this.fault('BOUNDS', `BFEXT: invalid bitfield pos=${pos} width=${width}`);
            return null;
        }
        const word = this.memory[loc] >>> 0;
        const mask = ((1 << width) - 1) >>> 0;
        const value = (word >>> pos) & mask;
        const drIdx = d.crDst;
        this.dr[drIdx] = value >>> 0;
        const label = this.nsLabels[check.index] || 'data';
        const desc = `BFEXT DR${drIdx}, [CR${d.crSrc}], pos=${pos}, w=${width} -> 0x${value.toString(16).toUpperCase()} (${label})`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: [
            { stage: 'BFEXT', desc: `Extract bits [${pos}:${pos+width-1}] from ${label} into DR${drIdx}`, perm: 'R', status: 'pass' },
        ]};
    }

    _execBfins(d) {
        const dataGT = this.cr[d.crSrc].word0;
        if (dataGT === 0) {
            this.fault('NULL_CAP', `BFINS: CR${d.crSrc} is NULL`);
            return null;
        }
        const loc = this.cr[d.crSrc].word1;
        const check = this.mLoad(dataGT, 'W', d.crSrc, loc);
        if (!check.ok) {
            this.fault(check.fault, `BFINS: CR${d.crSrc}: ${check.message}`);
            return null;
        }
        const pos = (d.imm >>> 5) & 0x1F;
        const width = d.imm & 0x1F;
        if (width === 0 || pos + width > 32) {
            this.fault('BOUNDS', `BFINS: invalid bitfield pos=${pos} width=${width}`);
            return null;
        }
        const drIdx = d.crDst;
        const insertVal = this.dr[drIdx] >>> 0;
        const mask = (((1 << width) - 1) << pos) >>> 0;
        const oldWord = this.memory[loc] >>> 0;
        const newWord = ((oldWord & ~mask) | ((insertVal << pos) & mask)) >>> 0;
        this.memory[loc] = newWord;
        const label = this.nsLabels[check.index] || 'data';
        const desc = `BFINS DR${drIdx}, [CR${d.crSrc}], pos=${pos}, w=${width} <- 0x${(insertVal & ((1 << width) - 1)).toString(16).toUpperCase()} (${label})`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: [
            { stage: 'BFINS', desc: `Insert bits [${pos}:${pos+width-1}] from DR${drIdx} into ${label}`, perm: 'W', status: 'pass' },
        ]};
    }

    _execMcmp(d) {
        const a = this.dr[d.crDst] >>> 0;
        const b = this.dr[d.crSrc] >>> 0;
        this._setSubFlags(a, b, a - b);
        const desc = `MCMP DR${d.crDst}, DR${d.crSrc} -> ${a} vs ${b} [Z=${this.flags.Z?1:0} N=${this.flags.N?1:0} C=${this.flags.C?1:0} V=${this.flags.V?1:0}]`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: [
            { stage: 'MCMP', desc: `Compare DR${d.crDst}(${a}) with DR${d.crSrc}(${b})`, status: 'pass' },
        ]};
    }

    _execIadd(d) {
        const drA = d.crSrc;
        const a = this.dr[drA] >>> 0;
        let b, bDesc;
        if (d.imm & 0x4000) {
            b = (d.imm & 0x3FFF) >>> 0;
            bDesc = `#${b}`;
        } else {
            const drB = d.imm & 0xF;
            b = this.dr[drB] >>> 0;
            bDesc = `DR${drB}`;
        }
        const result = a + b;
        this._setAddFlags(a, b, result);
        this.dr[d.crDst] = result >>> 0;
        const desc = `IADD DR${d.crDst}, DR${drA}, ${bDesc} -> ${a} + ${b} = ${result >>> 0} [Z=${this.flags.Z?1:0} N=${this.flags.N?1:0} C=${this.flags.C?1:0} V=${this.flags.V?1:0}]`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: [
            { stage: 'IADD', desc: `DR${d.crDst} = DR${drA} + ${bDesc}`, status: 'pass' },
        ]};
    }

    _execIsub(d) {
        const drA = d.crSrc;
        const a = this.dr[drA] >>> 0;
        let b, bDesc;
        if (d.imm & 0x4000) {
            b = (d.imm & 0x3FFF) >>> 0;
            bDesc = `#${b}`;
        } else {
            const drB = d.imm & 0xF;
            b = this.dr[drB] >>> 0;
            bDesc = `DR${drB}`;
        }
        const result = a - b;
        this._setSubFlags(a, b, result);
        this.dr[d.crDst] = result >>> 0;
        const desc = `ISUB DR${d.crDst}, DR${drA}, ${bDesc} -> ${a} - ${b} = ${result >>> 0} [Z=${this.flags.Z?1:0} N=${this.flags.N?1:0} C=${this.flags.C?1:0} V=${this.flags.V?1:0}]`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: [
            { stage: 'ISUB', desc: `DR${d.crDst} = DR${drA} - ${bDesc}`, status: 'pass' },
        ]};
    }

    _execBranch(d) {
        const soff = (d.imm & 0x4000) ? (d.imm | 0xFFFF8000) : d.imm;
        const target = this.pc + soff;
        if (target < 0 || target >= this.memory.length) {
            this.fault('BOUNDS', `BRANCH: target PC=${target} out of range`);
            return null;
        }
        const desc = `BRANCH ${soff >= 0 ? '+' : ''}${soff} -> PC=${target}`;
        this.output += desc + '\n';
        this.pc = target;
        return { pc: this.pc - soff, instr: d, desc, pipeline: [
            { stage: 'BRANCH', desc: `Branch to PC=${target} (offset ${soff})`, status: 'pass' },
        ]};
    }

    _execShl(d) {
        const drSrc = d.crSrc;
        const shamt = d.imm & 0x1F;
        const value = this.dr[drSrc] >>> 0;
        const lastBitOut = shamt > 0 ? ((value >>> (32 - shamt)) & 1) : 0;
        const result = (value << shamt) >>> 0;
        this.flags.Z = (result === 0);
        this.flags.N = ((result >>> 31) & 1) === 1;
        this.flags.C = lastBitOut === 1;
        this.flags.V = false;
        this.dr[d.crDst] = result;
        const desc = `SHL DR${d.crDst}, DR${drSrc}, ${shamt} -> 0x${result.toString(16).toUpperCase().padStart(8,'0')} [Z=${this.flags.Z?1:0} N=${this.flags.N?1:0} C=${this.flags.C?1:0}]`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: [
            { stage: 'SHL', desc: `DR${d.crDst} = DR${drSrc} << ${shamt}`, status: 'pass' },
        ]};
    }

    _execShr(d) {
        const drSrc = d.crSrc;
        const shamt = d.imm & 0x1F;
        const arith = (d.imm >>> 5) & 1;
        const value = this.dr[drSrc] >>> 0;
        const lastBitOut = shamt > 0 ? ((value >>> (shamt - 1)) & 1) : 0;
        let result;
        if (arith) {
            result = (value | 0) >> shamt;
            result = result >>> 0;
        } else {
            result = value >>> shamt;
        }
        this.flags.Z = (result === 0);
        this.flags.N = ((result >>> 31) & 1) === 1;
        this.flags.C = lastBitOut === 1;
        this.flags.V = false;
        this.dr[d.crDst] = result;
        const shType = arith ? 'ASR' : 'LSR';
        const desc = `SHR DR${d.crDst}, DR${drSrc}, ${shamt} ${shType} -> 0x${result.toString(16).toUpperCase().padStart(8,'0')} [Z=${this.flags.Z?1:0} N=${this.flags.N?1:0} C=${this.flags.C?1:0}]`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: [
            { stage: 'SHR', desc: `DR${d.crDst} = DR${drSrc} ${shType} ${shamt}`, status: 'pass' },
        ]};
    }

    _eloadcallPipeline(d, label) {
        return [
            { stage: 'LOAD', desc: `Namespace lookup via CR${d.crSrc}, index ${d.imm}`, perm: 'L', status: 'pass' },
            { stage: 'TPERM', desc: `Verify E permission on ${label}`, perm: 'E', status: 'pass' },
            { stage: 'CALL', desc: `Enter ${label}, save context`, status: 'pass' },
        ];
    }

    _xloadlambdaPipeline(d, label) {
        return [
            { stage: 'LOAD', desc: `C-List slot lookup [CR${d.crSrc} + ${d.imm}]`, perm: 'L', status: 'pass' },
            { stage: 'TPERM', desc: `Verify X permission on ${label}`, perm: 'X', status: 'pass' },
            { stage: 'LAMBDA', desc: `Church reduction via ${label}`, status: 'pass' },
        ];
    }

    _loadPipeline(d, label) {
        return [
            { stage: 'LOAD', desc: `Namespace lookup via CR${d.crSrc}`, perm: 'L', status: 'pass' },
            { stage: 'TPERM', desc: `Verify L permission on CR${d.crSrc}`, perm: 'L', status: 'pass' },
            { stage: 'VALIDATE', desc: `CRC-16 seal check on entry ${d.imm}`, status: 'pass' },
            { stage: 'WRITE', desc: `Write ${label} to CR${d.crDst}`, status: 'pass' },
        ];
    }

    _callPipeline(d, label) {
        return [
            { stage: 'LOAD',  desc: `Read target GT from CR${d.crDst}`, perm: 'L', status: 'pass' },
            { stage: 'TPERM', desc: `Verify E permission on target`, perm: 'E', status: 'pass' },
            { stage: 'PUSH',  desc: `Push E-GT (word 0) + frame word (SZ=1): FLAGS|PC|SZ|STO`, status: 'pass' },
            { stage: 'CALL',  desc: `Enter ${label}, CR6/CR14 derived, PC←0`, status: 'pass' },
        ];
    }

    _returnPipeline(d, frame, mask) {
        const stages = [];
        const frameTag = frame.sz === 0 ? 'LAMBDA' : 'CALL';
        stages.push({ stage: 'POP', desc: `Pop ${frame.sz === 0 ? '1-word LAMBDA' : '2-word CALL'} frame; restore FLAGS, STO←${frame.savedSTO}`, status: 'pass' });
        if (frame.sz === 1) {
            stages.push({ stage: 'E-GT', desc: 'Revalidate caller E-GT → re-derive CR6/CR14', perm: 'E', status: 'pass' });
        }
        stages.push({ stage: 'RETURN', desc: `PC→${frame.returnPC}${mask ? `, MASK clears ${mask.toString(2).padStart(12,'0')}` : ''}`, status: 'pass' });
        return stages;
    }

    _tpermPipeline(d, parsed, hasAll) {
        const permBits = [];
        for (const p of ['R','W','X','L','S','E']) {
            if (parsed.permissions[p]) permBits.push(p);
        }
        return [
            { stage: 'TPERM', desc: `Check permissions [${permBits.join(',')}] -> ${hasAll ? 'PASS' : 'FAIL'}`, status: hasAll ? 'pass' : 'fail' },
        ];
    }

    _lambdaPipeline(d, label) {
        return [
            { stage: 'LOAD',   desc: `Read CR${d.crDst} GT`, perm: 'L', status: 'pass' },
            { stage: 'TPERM',  desc: `Verify X permission`, perm: 'X', status: 'pass' },
            { stage: 'PUSH',   desc: `Push 1-word frame (SZ=0): FLAGS|PC|SZ|STO`, status: 'pass' },
            { stage: 'LAMBDA', desc: `Church reduction via ${label}`, status: 'pass' },
        ];
    }

    _auditPipeline() {
        return this.auditLog.map(a => {
            const checks = a.checks;
            const checkList = Object.entries(checks).map(([k, v]) => ({
                name: k.toUpperCase(),
                pass: v.pass,
                perm: v.perm || null,
            }));
            return {
                stage: a.gate,
                type: a.gate,
                desc: `${a.gate}(NS[${a.nsIndex}]="${a.label}"${a.requiredPerm ? ', '+a.requiredPerm : ''})`,
                label: a.label,
                nsIndex: a.nsIndex,
                requiredPerm: a.requiredPerm,
                checks: checkList,
                status: a.result,
                b: a.b,
                f: a.f,
            };
        });
    }

    loadProgram(words, startAddr) {
        const abstrSlot = 2;
        const abstrBase = this.NS_TABLE_BASE + abstrSlot * this.NS_ENTRY_WORDS;
        const codeLoc = this.memory[abstrBase] || (abstrSlot * this.SLOT_SIZE);
        const baseAddr = this.bootComplete ? codeLoc : (startAddr || 0);
        // +1: lump header occupies word 0 of the lump; code starts at word 1.
        // _fetchInstruction also adds +1 so PC=0 maps to word 1.
        const codeStart = this.bootComplete ? baseAddr + 1 : baseAddr;
        for (let i = 0; i < words.length; i++) {
            if (codeStart + i < this.memory.length) {
                this.memory[codeStart + i] = words[i] >>> 0;
            }
        }

        // After boot, keep the lump header cw and NS entry limit17 in sync with
        // the actual instruction count so that the code view shows all words.
        if (this.bootComplete && baseAddr < this.memory.length) {
            const hdrWord  = this.memory[baseAddr] >>> 0;
            const hdr      = this.parseLumpHeader(hdrWord);
            if (hdr.valid) {
                const clistStart = hdr.lumpSize - hdr.cc;           // first c-list word (relative to lump base)
                const maxCW      = Math.max(0, clistStart - 1);     // can't overlap the c-list or header
                const newCW      = Math.min(words.length, maxCW);
                if (newCW !== hdr.cw) {
                    // Update lump header cw field (bits 22:10)
                    this.memory[baseAddr] = ((hdrWord & ~(0x1FFF << 10)) | ((newCW & 0x1FFF) << 10)) >>> 0;
                    // Update NS entry word1 limit17 and reseal word2
                    const nsBase       = this.NS_TABLE_BASE + abstrSlot * this.NS_ENTRY_WORDS;
                    const oldW1        = this.memory[nsBase + 1] >>> 0;
                    const oldW2        = this.memory[nsBase + 2] >>> 0;
                    const w1f          = this.parseNSWord1(oldW1);
                    const newLimit17   = newCW - 1;
                    this.memory[nsBase + 1] = this.packNSWord1(newLimit17, w1f.b, w1f.f, w1f.g, w1f.chainable, w1f.gtType, w1f.clistCount);
                    const existingGtSeq    = (oldW2 >>> 25) & 0x7F;
                    this.memory[nsBase + 2] = this.makeVersionSeals(existingGtSeq, baseAddr, newLimit17);
                    // Mirror into CR14 which holds the code-region capability
                    const cr14 = this.cr[14];
                    if (cr14) {
                        cr14.word2 = this.memory[nsBase + 1];
                        cr14.word3 = this.memory[nsBase + 2];
                    }
                }
            }
        }

        this.pc = 0;
        this.halted = false;
        this.running = false;
        this.sto = 243;
        this.callStack = [];
        this.stepCount = 0;
        this.lambdaActive = false;
        this.lambdaReturnPC = 0;
        this.faultLog = [];
        this._instrHistory = [];
        this.emit('programLoaded', { addr: baseAddr, length: words.length });
        this.emit('stateChange', this.getState());
    }

    loadHardwareBinary(hwProgram, hwNamespace, hwClist, hwLabels, abstractions) {
        this.reset();

        this.memory = new Uint32Array(65536);
        this.nsLabels = {};
        this.nsCount = 0;
        this.nsClistMap = {};

        const nsEntryCount = hwNamespace.length / 3;
        for (let i = 0; i < nsEntryCount; i++) {
            const loc  = hwNamespace[i * 3 + 0];
            const w1   = hwNamespace[i * 3 + 1];
            const parsed1 = this.parseNSWord1(w1);
            const base = this.NS_TABLE_BASE + i * this.NS_ENTRY_WORDS;
            this.memory[base + 0] = loc >>> 0;
            this.memory[base + 1] = w1 >>> 0;
            this.memory[base + 2] = this.makeVersionSeals(0, loc, parsed1.limit);
            if (hwLabels && hwLabels[i]) {
                this.nsLabels[i] = hwLabels[i];
            } else {
                this.nsLabels[i] = `HW Slot ${i}`;
            }
            this.nsCount = i + 1;
        }

        const abstrSlot = 2;
        const abstrNSBase = this.NS_TABLE_BASE + abstrSlot * this.NS_ENTRY_WORDS;
        const abstrLoc = this.memory[abstrNSBase] || (abstrSlot * this.SLOT_SIZE);

        // Write hardware program first (hwProgram[0] = lump header, hwProgram[1+] = code)
        for (let i = 0; i < hwProgram.length; i++) {
            if (hwProgram[i] !== 0) {
                this.memory[abstrLoc + i] = hwProgram[i] >>> 0;
            }
        }

        // Derive c-list placement from lump header at word 0 (hardware-accurate)
        const abstrHdrWord  = (abstrLoc < this.memory.length) ? (this.memory[abstrLoc] >>> 0) : 0;
        const abstrHdr      = this.parseLumpHeader(abstrHdrWord);
        const abstrLumpSize = abstrHdr.valid ? abstrHdr.lumpSize : (this.SLOT_SIZE || 64);
        const abstrClistCount = abstrHdr.valid ? abstrHdr.cc : hwClist.length;
        const abstrClistStart = abstrLumpSize - abstrClistCount;  // c-list at physical end
        const safeClistCopy = Math.min(hwClist.length, abstrClistCount);

        for (let i = 0; i < safeClistCopy; i++) {
            this.memory[abstrLoc + abstrClistStart + i] = hwClist[i] >>> 0;
        }

        const clistChildren = [];
        for (let i = 0; i < nsEntryCount; i++) clistChildren.push(i);
        this.nsClistMap[2] = clistChildren;

        if (abstractions) {
            for (const abs of abstractions) {
                if (abs.clist && abs.nsIndex !== undefined) {
                    const absBase = this.NS_TABLE_BASE + abs.nsIndex * this.NS_ENTRY_WORDS;
                    const absLoc = this.memory[absBase];
                    for (let i = 0; i < abs.clist.length; i++) {
                        this.memory[absLoc + i] = abs.clist[i] >>> 0;
                    }
                }
                if (abs.code && abs.codeNsIndex !== undefined) {
                    const codeBase = this.NS_TABLE_BASE + abs.codeNsIndex * this.NS_ENTRY_WORDS;
                    const codeLoc = this.memory[codeBase];
                    for (let i = 0; i < abs.code.length; i++) {
                        this.memory[codeLoc + i] = abs.code[i] >>> 0;
                    }
                }
            }
        }

        this.output = '';
        this.output += '=== HARDWARE BINARY LOADED (Tang Nano 20K) ===\n';
        this.output += `Namespace: ${nsEntryCount} entries written to NS_TABLE_BASE (0x${this.NS_TABLE_BASE.toString(16).toUpperCase()})\n`;
        this.output += `Boot.Abstr: code at 0x${abstrLoc.toString(16).padStart(4,'0').toUpperCase()}, C-List (${abstrClistCount} GTs) at 0x${(abstrLoc + abstrClistStart).toString(16).padStart(4,'0').toUpperCase()}\n`;
        this.output += `Boot ROM: ${hwProgram.length} instructions at code region 0x${abstrLoc.toString(16).padStart(4,'0').toUpperCase()}\n`;
        if (abstractions) {
            for (const abs of abstractions) {
                const label = abs.label || `NS ${abs.nsIndex}`;
                this.output += `Abstraction: ${label} (NS ${abs.nsIndex}, code NS ${abs.codeNsIndex})\n`;
            }
        }
        this.output += '\n--- Namespace Entries ---\n';
        for (let i = 0; i < nsEntryCount; i++) {
            const base = this.NS_TABLE_BASE + i * this.NS_ENTRY_WORDS;
            const loc = this.memory[base];
            const w1 = this.memory[base + 1];
            const parsed = this.parseNSWord1(w1);
            const label = this.nsLabels[i] || '';
            this.output += `  [${i.toString().padStart(2)}] ${label.padEnd(20)} loc=0x${loc.toString(16).padStart(4,'0')} lim=${parsed.limit} F=${parsed.f} G=${parsed.g}\n`;
        }
        this.output += '\n--- C-List GTs ---\n';
        for (let i = 0; i < hwClist.length; i++) {
            const gt = hwClist[i] >>> 0;
            const p = this.parseGT(gt);
            const permStr = (p.permissions.B ? 'B':'') + (p.permissions.R ? 'R':'') +
                           (p.permissions.W ? 'W':'') + (p.permissions.X ? 'X':'') +
                           (p.permissions.L ? 'L':'') + (p.permissions.S ? 'S':'') +
                           (p.permissions.E ? 'E':'');
            this.output += `  [${i}] 0x${gt.toString(16).padStart(8,'0')} ${p.typeName.padEnd(8)} ${(permStr||'------').padEnd(6)} -> idx ${p.index}\n`;
        }
        this.output += `\n--- CLOOMC Code (Boot.Abstr code region, at 0x${abstrLoc.toString(16).padStart(4,'0').toUpperCase()}) ---\n`;
        for (let i = 0; i < hwProgram.length; i++) {
            const w = hwProgram[i] >>> 0;
            if (w === 0) continue;
            this.output += `  PC=${i} (0x${(abstrLoc+i).toString(16).padStart(4,'0')}): 0x${w.toString(16).padStart(8,'0')}\n`;
        }
        if (abstractions) {
            for (const abs of abstractions) {
                if (abs.code && abs.codeNsIndex !== undefined) {
                    const codeBase = this.NS_TABLE_BASE + abs.codeNsIndex * this.NS_ENTRY_WORDS;
                    const codeLoc = this.memory[codeBase];
                    const label = abs.label || `NS ${abs.nsIndex}`;
                    this.output += `\n--- ${label} Code (NS ${abs.codeNsIndex}, at 0x${codeLoc.toString(16).padStart(4,'0').toUpperCase()}) ---\n`;
                    for (let i = 0; i < abs.code.length; i++) {
                        const w = abs.code[i] >>> 0;
                        if (w === 0) continue;
                        this.output += `  PC=${i} (0x${(codeLoc+i).toString(16).padStart(4,'0')}): 0x${w.toString(16).padStart(8,'0')}\n`;
                    }
                }
            }
        }
        this.output += '\nStep or Run to begin boot sequence with hardware data.\n';

        this.pc = 0;
        this.halted = false;
        this.running = false;
        this.bootComplete = false;
        this.mElevation = false;
        this.bootStep = 0;
        this.ledBits = 0; this.ledMode = 'boot';
        this.faultLog = [];
        this._instrHistory = [];
        this.stepCount = 0;
        this.callStack = [];
        this.sto = 243;  // sp_max reset

        this.emit('programLoaded', { addr: 0, length: hwProgram.length });
        this.emit('stateChange', this.getState());
    }

    loadImageFromBinary(nsWords, clistWords, bootProgram) {
        this.reset();

        this.memory = new Uint32Array(65536);
        this.nsLabels = {};
        this.nsCount = 0;
        this.nsClistMap = {};

        const NS_WORDS = 192;
        const CLIST_WORDS = 64;
        const nsEntryCount = Math.floor(Math.min(nsWords.length, NS_WORDS) / 3);

        for (let i = 0; i < nsEntryCount; i++) {
            const loc = nsWords[i * 3 + 0] >>> 0;
            const w1  = nsWords[i * 3 + 1] >>> 0;
            const w2  = nsWords[i * 3 + 2] >>> 0;
            const base = this.NS_TABLE_BASE + i * this.NS_ENTRY_WORDS;
            this.memory[base + 0] = loc;
            this.memory[base + 1] = w1;
            this.memory[base + 2] = w2;
            this.nsLabels[i] = `Slot ${i}`;
            this.nsCount = i + 1;
        }

        const abstrSlot = 2;
        const abstrNSBase = this.NS_TABLE_BASE + abstrSlot * this.NS_ENTRY_WORDS;
        const abstrLoc = this.memory[abstrNSBase] || (abstrSlot * this.SLOT_SIZE);
        const abstrW1 = this.memory[abstrNSBase + 1];
        const abstrParsed = this.parseNSWord1(abstrW1);
        const abstrAllocSize = abstrParsed.limit + 1;
        const clistCount = Math.min(clistWords.length, CLIST_WORDS);
        const abstrClistCount = abstrParsed.clistCount || clistCount;
        const abstrClistStart = abstrAllocSize - abstrClistCount;
        const safeClistCopy = Math.min(clistCount, abstrClistCount);

        for (let i = 0; i < safeClistCopy; i++) {
            this.memory[abstrLoc + abstrClistStart + i] = clistWords[i] >>> 0;
        }

        const hwBoot = bootProgram || (typeof HW_BOOT_PROGRAM !== 'undefined' ? HW_BOOT_PROGRAM : null);
        if (hwBoot) {
            for (let i = 0; i < hwBoot.length; i++) {
                if (hwBoot[i] !== 0) {
                    this.memory[abstrLoc + i] = hwBoot[i] >>> 0;
                }
            }
        }

        const clistChildren = [];
        for (let i = 0; i < nsEntryCount; i++) clistChildren.push(i);
        this.nsClistMap[2] = clistChildren;

        this.output = '';
        this.output += '=== BINARY IMAGE LOADED ===\n';
        this.output += `Namespace: ${nsEntryCount} entries at NS_TABLE_BASE (0x${this.NS_TABLE_BASE.toString(16).toUpperCase()})\n`;
        this.output += `Boot.Abstr: code at 0x${abstrLoc.toString(16).padStart(4,'0').toUpperCase()}, C-List (${abstrClistCount} GTs) at 0x${(abstrLoc + abstrClistStart).toString(16).padStart(4,'0').toUpperCase()}\n`;
        this.output += '\n--- Namespace Entries ---\n';
        for (let i = 0; i < nsEntryCount; i++) {
            const base = this.NS_TABLE_BASE + i * this.NS_ENTRY_WORDS;
            const loc = this.memory[base];
            const w1 = this.memory[base + 1];
            const parsed = this.parseNSWord1(w1);
            const label = this.nsLabels[i] || '';
            this.output += `  [${i.toString().padStart(2)}] ${label.padEnd(20)} loc=0x${loc.toString(16).padStart(4,'0')} lim=${parsed.limit} F=${parsed.f} G=${parsed.g}\n`;
        }
        this.output += '\n--- C-List GTs ---\n';
        for (let i = 0; i < clistCount; i++) {
            const gt = clistWords[i] >>> 0;
            if (gt === 0) continue;
            const p = this.parseGT(gt);
            const permStr = (p.permissions.B ? 'B':'') + (p.permissions.R ? 'R':'') +
                           (p.permissions.W ? 'W':'') + (p.permissions.X ? 'X':'') +
                           (p.permissions.L ? 'L':'') + (p.permissions.S ? 'S':'') +
                           (p.permissions.E ? 'E':'');
            this.output += `  [${i}] 0x${gt.toString(16).padStart(8,'0')} ${p.typeName.padEnd(8)} ${(permStr||'-------').padEnd(7)} -> idx ${p.index}\n`;
        }
        if (hwBoot) {
            this.output += `\n--- CLOOMC Code (Boot.Abstr code region, at 0x${abstrLoc.toString(16).padStart(4,'0').toUpperCase()}) ---\n`;
            for (let i = 0; i < hwBoot.length; i++) {
                const w = hwBoot[i] >>> 0;
                if (w === 0) continue;
                const disasm = (typeof ChurchAssembler !== 'undefined') ? new ChurchAssembler().disassemble(w) : '';
                this.output += `  PC=${i} (0x${(abstrLoc+i).toString(16).padStart(4,'0')}): 0x${w.toString(16).padStart(8,'0')}  ${disasm}\n`;
            }
        }
        this.output += '\nStep or Run to begin boot sequence with loaded data.\n';

        this.pc = 0;
        this.halted = false;
        this.running = false;
        this.bootComplete = false;
        this.mElevation = false;
        this.bootStep = 0;
        this.ledBits = 0; this.ledMode = 'boot';
        this.faultLog = [];
        this._instrHistory = [];
        this.stepCount = 0;
        this.callStack = [];
        this.sto = 243;  // sp_max reset

        this.emit('programLoaded', { addr: 0, length: hwBoot ? hwBoot.length : 0 });
        this.emit('stateChange', this.getState());
    }

    exportHardwareImage() {
        const NS_WORDS = 192;
        const CLIST_WORDS = 64;

        const nsWords = new Uint32Array(NS_WORDS);
        const nsEntries = Math.min(this.nsCount || 16, 64);
        for (let i = 0; i < nsEntries; i++) {
            const base = this.NS_TABLE_BASE + i * this.NS_ENTRY_WORDS;
            nsWords[i * 3 + 0] = this.memory[base + 0] >>> 0;
            nsWords[i * 3 + 1] = this.memory[base + 1] >>> 0;
            nsWords[i * 3 + 2] = this.memory[base + 2] >>> 0;
        }

        const clistWords = new Uint32Array(CLIST_WORDS);
        const abstrNSBase = this.NS_TABLE_BASE + 2 * this.NS_ENTRY_WORDS;
        const abstrLoc = this.memory[abstrNSBase] || (2 * this.SLOT_SIZE);
        const abstrW1 = this.memory[abstrNSBase + 1];
        const abstrParsed = this.parseNSWord1(abstrW1);
        const abstrAllocSize = abstrParsed.limit + 1;
        const abstrClistCount = abstrParsed.clistCount || 0;
        const abstrClistStart = abstrAllocSize - abstrClistCount;
        const clistBase = abstrLoc + abstrClistStart;
        for (let i = 0; i < Math.min(abstrClistCount, CLIST_WORDS); i++) {
            clistWords[i] = this.memory[clistBase + i] >>> 0;
        }

        return { namespace: nsWords, clist: clistWords };
    }

    // run() returns { steps, stopReason, breakpointAddr? }
    // stopReason: 'breakpoint' | 'halted' | 'maxSteps' | 'bootExit' | 'stopped'
    run(maxSteps, breakpoints) {
        maxSteps = maxSteps || 10000;
        this.running = true;
        let steps = 0;
        let stopReason = 'stopped';
        let breakpointAddr = null;
        while (this.running && !this.halted && this.bootComplete && steps < maxSteps) {
            // Stop-before-execute breakpoint check: compute the physical address of the NEXT
            // instruction to be fetched (from this.pc + CR14 lump base) and compare against
            // the breakpoint set.  Skip on the very first step so we advance past any BP the
            // simulator is already sitting on at entry to run().
            if (steps > 0 && breakpoints) {
                const nextAddr = this._nextPhysicalAddr();
                if (nextAddr >= 0 && breakpoints.has(nextAddr >>> 0)) {
                    stopReason = 'breakpoint';
                    breakpointAddr = nextAddr >>> 0;
                    break;
                }
            }
            const result = this.step();
            if (!result) { stopReason = this.halted ? 'halted' : 'bootExit'; break; }
            if (!this.bootComplete) { stopReason = 'bootExit'; break; }
            steps++;
        }
        if (stopReason === 'stopped') {
            if (this.halted)         stopReason = 'halted';
            else if (steps >= maxSteps) stopReason = 'maxSteps';
        }
        this.running = false;
        return { steps, stopReason, breakpointAddr };
    }

    getState() {
        return {
            cr: this.cr.map(c => ({...c})),
            dr: [...this.dr],
            pc: this.pc,
            physicalPC: this.physicalPC,
            flags: {...this.flags},
            sto: this.sto,
            callStack: this.callStack.length,
            callFrames: this.callStack.map(f => ({ sz: f.sz, returnPC: f.returnPC, savedSTO: f.savedSTO, frameWord: f.frameWord })),
            stepCount: this.stepCount,
            halted: this.halted,
            output: this.output,
            namespaceTable: this.namespaceTable,
        };
    }

    getFormattedCR(idx) {
        const cr = this.cr[idx];
        const isEmpty = !cr || (cr.word0 === 0 && cr.word1 === 0 && cr.word2 === 0 && cr.word3 === 0 && cr.m === 0);
        if (isEmpty) {
            return {
                index: idx, isNull: true, mBit: 0,
                word0_gt: '00000000', perms: '-------', gtSeq: 0, gtIndex: 0, gtType: 'NULL', gtTypeName: 'NULL',
                word1_location: 0,
                word2_limit_raw: 0, limitB: 0, limitF: 0, limit17: 0,
                word3_seals_raw: 0, sealGtSeq: 0, sealCRC: 0,
            };
        }
        const parsed = this.parseGT(cr.word0);
        const lim = this.parseNSWord1(cr.word2);
        const sealGtSeq = (cr.word3 >>> 25) & 0x7F;
        const sealCRC = cr.word3 & 0xFFFF;
        const permStr = (parsed.permissions.B ? 'B' : '-') +
                        (parsed.permissions.R ? 'R' : '-') +
                        (parsed.permissions.W ? 'W' : '-') +
                        (parsed.permissions.X ? 'X' : '-') +
                        (parsed.permissions.L ? 'L' : '-') +
                        (parsed.permissions.S ? 'S' : '-') +
                        (parsed.permissions.E ? 'E' : '-');
        return {
            index: idx, isNull: false, mBit: cr.m || 0,
            word0_gt: cr.word0.toString(16).toUpperCase().padStart(8, '0'),
            perms: permStr,
            gtSeq: parsed.gt_seq,
            gtIndex: parsed.index,
            gtType: parsed.type,
            gtTypeName: parsed.typeName,
            word1_location: cr.word1,
            word2_limit_raw: cr.word2,
            limitB: parsed.permissions.B,
            limitF: lim.f,
            limit17: lim.limit,
            word3_seals_raw: cr.word3,
            sealGtSeq: sealGtSeq,
            sealCRC: sealCRC,
        };
    }

    saveToNamespace(label, words, perms, gtType) {
        perms = perms || {R:0,W:0,X:1,L:0,S:0,E:0};
        gtType = (gtType !== undefined && gtType !== null) ? gtType : 1;
        let idx = -1;
        for (let i = 0; i < this.nsCount; i++) {
            if (this.nsLabels[i] === label) { idx = i; break; }
        }
        if (idx === -1) {
            idx = this.nsCount;
        }
        const loc = idx * this.SLOT_SIZE;
        const codeLen = words.length;
        const totalLen = 1 + codeLen;
        const lim17 = Math.min(totalLen - 1, 0x1FFFF);
        const gtWord = this.createGT(0, idx, perms, gtType);
        this.writeNSEntry(idx, loc, lim17, 0, 0, 0, 0, gtType, 0);
        this.nsLabels[idx] = label;
        this.memory[loc] = gtWord;
        for (let i = 0; i < codeLen; i++) {
            this.memory[loc + 1 + i] = words[i] >>> 0;
        }
        this.emit('stateChange', this.getState());
        return idx;
    }

    saveToNamespaceAt(idx, label, words, perms, gtType) {
        perms = perms || {R:0,W:0,X:1,L:0,S:0,E:0};
        gtType = (gtType !== undefined && gtType !== null) ? gtType : 1;
        const loc = idx * this.SLOT_SIZE;
        const codeLen = words.length;
        const totalLen = 1 + codeLen;
        const lim17 = Math.min(totalLen - 1, 0x1FFFF);
        const gtWord = this.createGT(0, idx, perms, gtType);
        for (let j = 0; j < this.SLOT_SIZE; j++) {
            if (loc + j < this.memory.length) this.memory[loc + j] = 0;
        }
        this.writeNSEntry(idx, loc, lim17, 0, 0, 0, 0, gtType, 0);
        this.nsLabels[idx] = label;
        this.memory[loc] = gtWord;
        for (let i = 0; i < codeLen; i++) {
            this.memory[loc + 1 + i] = words[i] >>> 0;
        }
        this.emit('stateChange', this.getState());
        return idx;
    }

    getEntryMemory(idx) {
        const entry = this.readNSEntry(idx);
        if (!entry) return null;
        const loc = entry.word0_location;
        const lim = this.parseNSWord1(entry.word1_limit);
        const gt = this.memory[loc];
        const codeWords = [];
        for (let i = 1; i <= lim.limit; i++) {
            codeWords.push(this.memory[loc + i]);
        }
        return { label: entry.label, location: loc, limit: lim.limit, gt: gt, words: codeWords, codeLength: codeWords.length };
    }

    setEntryMemory(idx, dataWords) {
        const entry = this.readNSEntry(idx);
        if (!entry) return false;
        const loc = entry.word0_location;
        const lim17 = Math.min(dataWords.length - 1, 0x1FFFF);
        const parsed = this.parseNSWord1(entry.word1_limit);
        this.writeNSEntry(idx, loc, lim17, parsed.b, parsed.f, parsed.g, parsed.chainable, parsed.gtType, (entry.word2_seals >>> 25) & 0x7F);
        for (let i = 0; i < dataWords.length; i++) {
            this.memory[loc + i] = dataWords[i] >>> 0;
        }
        this.emit('stateChange', this.getState());
        return true;
    }

    getNSTableMemoryDump() {
        const dump = [];
        for (let i = 0; i < this.nsCount; i++) {
            const base = this.NS_TABLE_BASE + i * this.NS_ENTRY_WORDS;
            dump.push({
                index: i,
                label: this.nsLabels[i] || '',
                raw: [this.memory[base], this.memory[base + 1], this.memory[base + 2]],
            });
        }
        return dump;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChurchSimulator;
}
