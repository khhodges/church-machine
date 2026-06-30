// =============================================================================
// simulator.js — Church Machine CPU Simulator
// =============================================================================
//
// Node.js compatibility shim: abstract_gt_manager.js is a separate file in
// the browser but must be loaded here when running under Node.js (test harnesses).
if (typeof module !== 'undefined' && typeof AbstractGTManager === 'undefined') {
    const _agm = require('./abstract_gt_manager.js');
    /* global AbstractGTManager */
    global.AbstractGTManager = _agm.AbstractGTManager;
}
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
//   0x0000 – 0xFBFF   Object lumps  (heap / stack / thread lumps)
//   0xF000 – 0xFFFF   Namespace (NS) table  — up to 1024 × 4-word entries (NS_TABLE_RESERVE=0x1000)
//   (I/O segment and Boot ROM are overlaid in the lump area at NS-registered addresses)
//
// NAMESPACE TABLE (NS)
//   Each entry is 4 words wide (stride = 16 bytes); word3 at +12 is reserved (always zero):
//     word0  location   — base address of the abstraction's lump (Golden Token)
//     word1  limit/meta — bits[16:0] lump size in words; bits[25:17] c-list
//                         count; bits[27:26] GT type (Null/Inform/Outform/
//                         Abstract); bit[28] G-bit (GC liveness — matches
//                         hardware Word1[28], excluded from CRC/integrity32
//                         by design so GC can set/clear without resealing);
//                         bit[29] reserved; bit[30] reserved (f_flag moved
//                         to GT word bit[25], per-token not per-NS-entry);
//                         bit[31] b-flag
//     word2  seals      — bits[31:25] version; bits[15:0] CRC-16 seal
//     word3  reserved   — must be zero; reserved for future Navana per-slot GT
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
//   CR12       Thread stack (privileged, system-wide — unchanged by CHANGE)
//   CR13       Interrupt handler (privileged, system-wide — unchanged by CHANGE)
//   CR14       Code register / CLOOMC (privileged, per-thread — set by CALL, saved/restored by CHANGE)
//   CR15       Namespace root (privileged, per-thread — saved/restored by CHANGE)
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

// ── Church Hardware Address Range (0xFFFFFF00 – 0xFFFFFFFF) ─────────────────
// Privileged control-register ports and M-bit authority ports.
// These 32-bit word addresses are used by the CHANGE authority check and by
// NS capability entries (slots 19-22 in boot_rom.py).
const CHURCH_HW_RANGE_BASE   = 0xFFFFFF00; // first word of the HW address range
const CR_PORT_CR12            = 0xFFFFFF0C; // CHANGE CR12 authority port (thread stack)
const CR_PORT_CR13            = 0xFFFFFF0D; // CHANGE CR13 authority port (interrupt handler)
const CR_PORT_CR14            = 0xFFFFFF0E; // CHANGE CR14 authority port (code register)
const CR_PORT_CR15            = 0xFFFFFF0F; // CHANGE CR15 authority port (namespace root)
const M_BIT_PORT_CR12         = 0xFFFFFF1C; // M-bit authority port for CR12
const M_BIT_PORT_CR13         = 0xFFFFFF1D; // M-bit authority port for CR13
const M_BIT_PORT_CR14         = 0xFFFFFF1E; // M-bit authority port for CR14
const M_BIT_PORT_CR15         = 0xFFFFFF1F; // M-bit authority port for CR15
const IO_PORT_PET_NAME_WR     = 0xFFFFFF38; // DWRITE to this addr marks c-list slot (value & 0x3F) as named
// Boot-default named slots — matches hardware/boot_rom.py DEMO_CLIST_NAMED_SLOTS.
// Used to reset petNameMemory to a clean baseline between program loads so that
// stale named-slot entries from a previous program cannot suppress NULL_CAP faults
// in a subsequent program that never declared those slots.
const BOOT_NAMED_SLOTS = Object.freeze([0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13]);


// SCHEDULER_IRQ_CLIST — simulated c-list for the Scheduler abstraction (NS slot 8).
// Mirrors hardware/boot_rom.py SCHEDULER_IRQ_CLIST (Task #1530).
// Four E-perm GTs grant the IRQ handler authority to perform CHANGE CR12/CR13.
// Layout (cc=4):
//   idx 0: E-perm GT → NS[19]  CR12_PORT_CAP  (authority to CHANGE CR12)
//   idx 1: E-perm GT → NS[20]  CR13_PORT_CAP  (authority to CHANGE CR13)
//   idx 2: E-perm GT → NS[21]  CR12_MBIT_CAP  (authority for CR12 M-bit)
//   idx 3: E-perm GT → NS[22]  CR13_MBIT_CAP  (authority for CR13 M-bit)
// Cross-reference: simulator/system_abstractions.js SCHEDULER_IRQ_CLIST_SPEC (Task #1530).
const SCHEDULER_IRQ_CLIST = [
    { name: 'CR12_PORT', target: 19, grants: { E: 1 } },
    { name: 'CR13_PORT', target: 20, grants: { E: 1 } },
    { name: 'CR12_MBIT', target: 21, grants: { E: 1 } },
    { name: 'CR13_MBIT', target: 22, grants: { E: 1 } },
];

// Pre-computed 32-bit instruction words from hardware/boot_rom.py BOOT_PROGRAM.
// Written into Boot.Abstr lump code region during _initNamespaceTable() so the
// binary matches what the hardware ROM contains. The IDE-chosen abstraction (lightning
// bolt) is written to Thread.caps[0] (thread[+244]) by setBootEntrySlot(); CHANGE
// RESTORE_CALL loads it into CR0, then CALL enters it directly.
const BOOT_ROM_WORDS = [
    0x077F8000, // [0]  LOAD   AL, CR15, CR15[0]   — load namespace cap from NS slot 0 into CR15
    0x27678001, // [1]  CHANGE AL, CR12, CR15, #1  — switch to Boot.Thread via CR15 namespace; RESTORE loads CR0 from thread[+244]
    0x17000000, // [2]  CALL   AL, CR0,  CR0        — enter IDE-chosen first abstraction (lightning bolt)
];

class ChurchSimulator {
    constructor() {
        this._listeners = {};
        // NS_TABLE_BASE is recomputed in reset() (and in the binary loaders) to
        // memory.length − NS_TABLE_RESERVE. For a 65536-word space: 0xF000.
        this.NS_TABLE_RESERVE = 0x1000;  // default 1024 entries × 4 words; updated in reset() from binary
        this.NS_TABLE_BASE = 0xF000;    // for 65536-word space: 0x10000 - 0x1000; recomputed in reset()
        this.NS_ENTRY_WORDS = 4;
        this.MAX_NS_ENTRIES = 1024;     // default; updated in reset() to match actual NS_TABLE_RESERVE
        this.SLOT_SIZE = 0x40;   // 64 words — FPGA minimum slot allocation (boot_rom.py line 339)

        // TPERM preset → required-permission array.
        // Exposed as an instance property so tests can inject non-standard
        // presets to exercise the domain-purity fault path.
        // null  = reserved preset  → _execTperm faults TPERM_RSV.
        // 'EXACT' = preset 14, identity check CRd.word0 === CRs.word0; faults BIND on mismatch (credential pinning assertion, not a comparison).
        // 'FRAME' = preset 13, call-stack query: Z=1 if a real return frame exists (RETURN would not underflow). No GT is read.
        // Codes 10-12 (RSV3, RSV4, RSV5) are unconditionally reserved → null (TPERM_RSV).
        this.tpermPresetMasks = [
            [],            ['R'],         ['R','W'],       ['X'],
            ['R','X'],     ['R','W','X'], ['L'],           ['S'],
            ['E'],         ['L','S'],     null,            null,
            null,          'FRAME',       'EXACT',         null,
        ];

        this.abstractionRegistry = null;
        this.systemAbstractions = null;
        this.deviceAbstractions = null;
        this.abstractGTManager = new AbstractGTManager();

        // Which NS slot the boot sequence jumps to at B:05/B:06.
        // Defaults to 3 (Boot.Abstr / LED flash); overridden by app.js
        // when the user selects a different boot-entry abstraction.
        // Intentionally NOT reset by reset() — persists across soft resets.
        this.bootEntrySlot = 3;

        // Immutable architectural identity: the canonical Boot.Abstr slot.
        // Captured once at construction from bootEntrySlot and NEVER mutated
        // afterwards — not by UI selection, not by lump loading, not by reset.
        // Use this (not bootEntrySlot) when you need the architectural slot
        // identity rather than the current UI selection.
        this._bootAbstrSlot = this.bootEntrySlot;

        this.reset();
    }

    // ── Pet-name slot resolver ────────────────────────────────────────────────
    // Searches nsLabels for a label matching `name` and returns its slot index.
    // Throws when not found and no fallback is given (programming error).
    // NS slot integer constants must not appear in application-layer JS; use
    // this helper instead so renaming an NS slot in the boot image propagates
    // automatically to all runtime code that refers to it by name.
    _slotByPetName(name, fallback = undefined) {
        if (this.nsLabels) {
            for (const [idx, label] of Object.entries(this.nsLabels)) {
                if (label === name) return parseInt(idx, 10);
            }
        }
        if (fallback !== undefined) return fallback;
        // No fallback supplied — missing pet-name is a programming error.
        throw new Error(`[_slotByPetName] no NS slot found for '${name}' and no fallback given`);
    }

    // Boot Image Designer Step 1 (Task #214): the size of the namespace memory
    // window (in 32-bit words). Driven by window.bootConfig.step1.totalNamespaceWords
    // when the IDE has saved a project boot config; otherwise falls back to the
    // historical demo default so existing tutorials keep working.
    _namespaceMemoryWords() {
        try {
            const t = (typeof window !== 'undefined' && window.bootConfig
                       && window.bootConfig.step1 && window.bootConfig.step1.totalNamespaceWords);
            if (Number.isInteger(t) && t >= 64) return t;
        } catch (_) { /* no window in tests */ }
        return 65536;
    }

    // Task #217: overlay a server-generated boot image onto the namespace
    // memory window. The binary is a raw 32-bit little-endian dump
    // produced by server/boot_image.py and is exactly what `memory[]`
    // should look like after `_initNamespaceTable()` finishes — so this
    // method just copies the words in. Call AFTER reset() (which sized
    // memory[] from window.bootConfig).
    //
    // Bytes longer than the memory window are truncated (defensive); a
    // shorter image leaves the tail untouched. nsCount is recomputed by
    // (a) scanning the resulting NS table for non-zero entries, then
    // (b) extending the count to include Step 3 reserved-but-empty slots
    //     from window.bootConfig so empty slots remain addressable in
    //     the dashboard and through the runtime nsCount.
    loadBootImage(arrayBuffer) {
        if (!arrayBuffer || arrayBuffer.byteLength < 4) return false;
        const src = new Uint32Array(arrayBuffer);

        // Backwards-scan for BOOT_IMAGE_FORMAT_TAG (Task #1244).
        // The tag's position encodes the actual NS table reserve size dynamically,
        // so we discover the reserve by finding the tag rather than using a
        // hardcoded offset. Scan limit: 8192 words covers up to 1024-slot NS tables
        // (4096 words) plus the 2 sentinel words and future headroom.
        const BOOT_IMAGE_FORMAT_TAG = 0xB0070563;  // must match boot_image.py; bumped Task #563/568
        let tagIdx = -1;
        const scanLimit = Math.min(8192, src.length);
        for (let _si = 1; _si <= scanLimit; _si++) {
            const _pos = src.length - _si;
            if ((src[_pos] >>> 0) === BOOT_IMAGE_FORMAT_TAG) {
                tagIdx = _pos;
                break;
            }
        }
        if (tagIdx < 0) {
            this.output += `[BOOTIMG] WARNING: BOOT_IMAGE_FORMAT_TAG not found in last 8192 words; ignoring binary — using built-in namespace defaults.\n`;
            return false;
        }
        const discoveredNsTableBase    = tagIdx + 1;
        const discoveredNsTableReserve = src.length - discoveredNsTableBase;
        // Reserve must be a positive multiple of NS_ENTRY_WORDS (4 words per slot).
        if (discoveredNsTableReserve < this.NS_ENTRY_WORDS || discoveredNsTableReserve % this.NS_ENTRY_WORDS !== 0) {
            this.output += `[BOOTIMG] WARNING: invalid NS table reserve ${discoveredNsTableReserve} (not a positive multiple of ${this.NS_ENTRY_WORDS}) derived from tag at word ${tagIdx}; ignoring binary.\n`;
            return false;
        }
        // Update instance variables to match the loaded binary's actual layout.
        this.NS_TABLE_RESERVE = discoveredNsTableReserve;
        this.NS_TABLE_BASE    = this.memory.length - this.NS_TABLE_RESERVE;
        this.MAX_NS_ENTRIES   = (discoveredNsTableReserve / this.NS_ENTRY_WORDS) | 0;

        // Boot-entry slot: stored at mem[NS_TABLE_BASE - 2] by the generator.
        const entrySlotIdx = tagIdx - 1;
        if (entrySlotIdx >= 0 && entrySlotIdx < src.length) {
            const storedSlot = src[entrySlotIdx] & 0xFF;
            if (storedSlot !== this.bootEntrySlot) {
                this.bootEntrySlot = storedSlot;
                this.output += `[BOOTIMG] Boot entry restored from image: Slot ${storedSlot}\n`;
            }
        }

        const n   = Math.min(src.length, this.memory.length);
        for (let i = 0; i < n; i++) this.memory[i] = src[i] >>> 0;
        // Recount NS entries from the table now that it's been replaced.
        const maxEntries = (this.NS_TABLE_RESERVE / this.NS_ENTRY_WORDS) | 0;
        let count = 0;
        for (let i = 0; i < maxEntries; i++) {
            const base = this.NS_TABLE_BASE + i * this.NS_ENTRY_WORDS;
            if (this.memory[base] !== 0 || this.memory[base + 1] !== 0) {
                count = i + 1;
            }
        }
        // Honour Step 3 empty-slot reservations from the saved boot config:
        // those NS entries are intentionally zeroed in the binary but must
        // still count toward nsCount so the namespace exposes the reserved
        // capacity to the runtime.
        const cfg = (typeof window !== 'undefined') ? window.bootConfig : null;
        const baseNamed = (cfg && cfg.step3 && Number.isInteger(cfg.step3.baseNamedNsCount))
            ? cfg.step3.baseNamedNsCount : 0;
        const empty = (cfg && cfg.step3 && Number.isInteger(cfg.step3.emptySlotCount))
            ? cfg.step3.emptySlotCount : 0;
        const reserved = Math.min(maxEntries, baseNamed + empty);
        if (reserved > count) count = reserved;
        this.nsCount = count;

        // Reseed nsLabels from the canonical abstraction catalog for every
        // populated NS slot.  loadBootImage() copies raw binary words into
        // memory but the binary carries no label strings — without this step
        // the namespace view can show stale or blank labels after a second
        // reset-then-reload cycle (nsLabels from the first _initNamespaceTable()
        // call is the only prior source of truth).
        // Hardware authority port slots (NS[19-22]: CR12_PORT/CR13_PORT/
        // CR12_MBIT/CR13_MBIT as used by SCHEDULER_IRQ_CLIST) are seeded under
        // their catalog names ("Loader", "SUCC", "PRED", "ADD") — these ARE the
        // authoritative software-visible abstraction names.  The c-list constant
        // names (CR12_PORT etc.) describe the c-list *capability position*, not
        // the NS slot label.  User pet names are restored afterwards by the
        // loadNamespaceState() call in app-shell.js so overwriting here is safe.
        const _bootCatalog = this._getAbstractionCatalog();
        for (let _bi = 0; _bi < count; _bi++) {
            const _bBase = this.NS_TABLE_BASE + _bi * this.NS_ENTRY_WORDS;
            const _hasEntry = (this.memory[_bBase] !== 0 || this.memory[_bBase + 1] !== 0);
            if (!_hasEntry) {
                // Slot is zeroed in the binary (free/reserved) — mark as free
                // so the namespace view shows '(free)' rather than a stale name.
                if (!this.nsLabels[_bi]) this.nsLabels[_bi] = '(free)';
                continue;
            }
            if (_bootCatalog[_bi]) {
                // Always use the catalog label for populated catalog slots —
                // this is the authoritative name for the slot.
                this.nsLabels[_bi] = _bootCatalog[_bi].label;
            } else if (!this.nsLabels[_bi]) {
                // Populated slot beyond catalog range with no existing label.
                this.nsLabels[_bi] = `slot_${_bi}`;
            }
        }

        // Integrity check: the minimum complete boot namespace has 23 slots
        // (indices 0-22 covering Boot.NS, Boot.Thread, Boot.Abstr, Salvation,
        // Navana, Mint, Memory, Scheduler, Stack, DijkstraFlag, freed 11-14,
        // Display, SlideRule, Abacus, Constants, Loader, SUCC, PRED, ADD).
        // Warn loudly in the console log when the binary is smaller than this.
        const _BOOT_SLOT_MIN = 23;
        if (count < _BOOT_SLOT_MIN) {
            this.output += `[BOOTIMG] WARNING: only ${count} NS slots active (< ${_BOOT_SLOT_MIN} expected). Boot namespace may be incomplete.\n`;
        } else {
            // Verify that every slot in the core 23 has a meaningful label.
            const _unlabelled = [];
            for (let _ci = 0; _ci < _BOOT_SLOT_MIN; _ci++) {
                const _lbl = this.nsLabels[_ci];
                if (!_lbl || _lbl === `slot_${_ci}`) _unlabelled.push(_ci);
            }
            if (_unlabelled.length > 0) {
                this.output += `[BOOTIMG] WARNING: ${_unlabelled.length} core boot slot(s) have no catalog label: [${_unlabelled.join(', ')}] — check the abstraction catalog.\n`;
            }
        }

        this.output += `[BOOTIMG] Loaded ${n}-word boot image; ${count} NS entries active.\n`;
        this.emit('stateChange', this.getState());
        return true;
    }

    initAbstractions(registry, systemAbs, deviceAbs) {
        this.abstractionRegistry = registry;
        this.systemAbstractions = systemAbs;
        this.deviceAbstractions = deviceAbs;
    }

    // Install a lazy-manifest entry's code body now (used by Boot Image
    // Designer Step 2 — Task #215 — to bake "resident" lumps into the
    // boot image). The NS entry's location word is already written by
    // _initNamespaceTable (honouring any physAddr override from
    // window.bootConfig.step2); this method just forces the lazy loader
    // to copy the actual code words in immediately. Idempotent.
    eagerInstallResident(slotIndex) {
        const entry = this.lazyManifest && this.lazyManifest[slotIndex];
        if (!entry) return false;
        // Sync allocBase to the NS-entry location written at init time so
        // lazyLoad places the body at the programmer-chosen address.
        const nsEntry = this.readNSEntry(slotIndex);
        if (nsEntry && nsEntry.word0_location > 0) {
            entry.allocBase = nsEntry.word0_location;
        }
        // Re-arm the loader: a 'hot' entry was marked loaded=true by
        // initLazyManifest, but we still need lazyLoad() to actually write
        // the code words once.
        entry.loaded = false;
        return this.lazyLoad(slotIndex);
    }

    initLazyManifest(manifest) {
        this.lazyManifest = manifest || {};
        let warmCount = 0, coldCount = 0, hotCount = 0;
        for (const [slotStr, entry] of Object.entries(this.lazyManifest)) {
            const slot = parseInt(slotStr, 10);
            if (entry.priority === 'hot') {
                hotCount++;
                entry.loaded = true;
                continue;
            }
            if (entry.priority === 'warm') {
                warmCount++;
                const nsEntry = this.readNSEntry(slot);
                if (nsEntry && nsEntry.word0_location > 0) {
                    entry.allocBase = nsEntry.word0_location;
                    entry.allocSize = entry.size || this.SLOT_SIZE;
                    const loc = nsEntry.word0_location;
                    const hdr = this.parseLumpHeader(this.memory[loc]);
                    // Zero the ENTIRE lump (header + code + c-list) so the block
                    // is free for alternative objects.  The NS entry authority
                    // (type, limit, gt_seq, seal) is never touched — it is the
                    // capability reference that survives eviction.
                    const lumpSize = hdr.valid ? hdr.lumpSize : (entry.allocSize || this.SLOT_SIZE);
                    for (let i = 0; i < lumpSize; i++) {
                        this.memory[loc + i] = 0;
                    }
                    // memory[loc] is now 0: magic=0 ≠ 0x1F → parseLumpHeader.valid=false
                    // → CODE_NOT_RESIDENT triggers on first CALL/LOAD to this slot.
                }
                entry.loaded = false;
                entry.loadCount = 0;
            } else if (entry.priority === 'cold') {
                coldCount++;
                entry.loaded = false;
                entry.loadCount = 0;
                // Mark NS entry as Outform (gtType=2) so the Mode 2 lazy-load
                // path fires in _execCall when a CALL arrives on this slot.
                // Warm entries keep gtType=1 (Inform) so Mode 1 restore fires
                // correctly on them — do not change warm entries here.
                const coldNsBase = this.NS_TABLE_BASE + slot * this.NS_ENTRY_WORDS;
                const coldW1 = this.memory[coldNsBase + 1];
                const coldW1f = this.parseNSWord1(coldW1);
                this.memory[coldNsBase + 1] = this.packNSWord1(
                    coldW1f.limit, coldW1f.b, coldW1f.g,
                    2 /* Outform */, coldW1f.clistCount);
            }
        }
        if (warmCount + coldCount > 0) {
            this.output += `[LOADER] Lazy load manifest: ${hotCount} hot, ${warmCount} warm, ${coldCount} cold slots registered\n`;
            if (warmCount > 0) {
                this.output += `[LOADER] ${warmCount} warm slot(s): entire lump zeroed (header+code+c-list), NS entry authority preserved — will lazy-load on first CALL/LOAD\n`;
            }
        }
    }

    lazyLoad(slotIndex) {
        const entry = this.lazyManifest[slotIndex];
        if (!entry) return false;
        if (entry.loaded) return true;

        const label = entry.label || this.nsLabels[slotIndex] || `slot_${slotIndex}`;
        this.output += `[LOADER] Loading ${label} (slot ${slotIndex}, priority=${entry.priority}, source=${entry.source})...\n`;

        if (this.abstractionRegistry) {
            this.abstractionRegistry.activate(slotIndex);
        }

        const bootUpload = entry.bootUpload;
        if (!bootUpload || !bootUpload.methods || bootUpload.methods.length === 0) {
            this.output += `[LOADER] FAIL: no bootUpload data for slot ${slotIndex}\n`;
            return false;
        }

        const lumpSize = entry.size || this.SLOT_SIZE;
        let loc = entry.allocBase;
        if (loc === undefined || loc === null || loc === 0) {
            loc = slotIndex * this.SLOT_SIZE;
            entry.allocBase = loc;
            entry.allocSize = lumpSize;
        }
        // Mode 1 grant-interval invariant: loc must lie within the NS entry's
        // existing grant (word0_location to word0_location + limit words).
        // allocBase is derived from word0_location in initLazyManifest(), so the
        // invariant is satisfied by construction in the current simulator.
        // A future relocating Loader must validate explicitly:
        //   loc >= nsEntry.word0_location  &&
        //   loc + lumpSize - 1 <= nsEntry.word0_location + parsedW1.limit

        let totalCodeWords = 0;
        const methodCode = [];
        for (const m of bootUpload.methods) {
            if (m.code && m.code.length > 0) {
                methodCode.push(m.code);
                totalCodeWords += m.code.length;
            }
        }

        if (totalCodeWords === 0) {
            this.output += `[LOADER] FAIL: no code in bootUpload for slot ${slotIndex}\n`;
            return false;
        }

        let offset = 1;
        for (const code of methodCode) {
            for (let i = 0; i < code.length; i++) {
                this.memory[loc + offset + i] = code[i];
            }
            offset += code.length;
        }

        const dataWords = bootUpload.data_words || [];
        for (let i = 0; i < dataWords.length; i++) {
            this.memory[loc + offset + i] = dataWords[i] >>> 0;
        }
        const totalDataWords = dataWords.length;

        const oldHdr = this.parseLumpHeader(this.memory[loc]);
        const cc = Math.max(oldHdr.valid ? oldHdr.cc : 0, (bootUpload.capabilities || []).length);
        const nMinus6 = Math.max(0, Math.ceil(Math.log2(lumpSize)) - 6);
        this.memory[loc] = this.packLumpHeader(nMinus6, totalCodeWords, cc, 0);

        // ── C-list GT setup for self-data-R capability ───────────────────────────
        // self-data-R GTs depend on the runtime lump base address, so they cannot
        // be pre-computed in the binary.  After the lump header is written we
        // synthesise the GT here and store it at lumpBase + (lumpSize - cc + idx).
        //
        // Convention: data-alias NS slots live at 200 + ns_slot, so Constants
        // (slot 18) gets its data alias at NS slot 218, etc.
        if (cc > 0) {
            const capsList = bootUpload.capabilities || [];
            const selfDataRIdx = capsList.findIndex(c => c && c.type === 'self-data-R');
            if (selfDataRIdx >= 0) {
                const dataBase   = (loc + 1 + totalCodeWords) >>> 0;
                const dataLimit  = totalDataWords > 0 ? totalDataWords - 1 : 0;
                const dataNsSlot = 200 + slotIndex;
                this.writeNSEntry(dataNsSlot, dataBase, dataLimit, 0, 0, 0, 1, 0, 0);
                this.nsLabels[dataNsSlot] = `${label}.data`;
                const dataGT = this.createGT(0, dataNsSlot, {R:1,W:0,X:0,L:0,S:0,E:0}, 1);
                this.memory[(loc + lumpSize - cc + selfDataRIdx) >>> 0] = dataGT;
                this.output += `[LOADER] ${label}: self-data-R → NS[${dataNsSlot}] base=0x${dataBase.toString(16).toUpperCase()} limit=${dataLimit} GT@lump+${lumpSize - cc + selfDataRIdx}\n`;
            }

        }

        // Update NS entry word0_location to the chosen physical address and
        // recompute the seal (word2).  Type, limit, and gt_seq are never changed.
        // This is Mode 1 (Restore): the Loader places the lump within the existing
        // grant; no new authority is minted.
        const nsBase = this.NS_TABLE_BASE + slotIndex * this.NS_ENTRY_WORDS;
        const nsW0Prev = this.memory[nsBase + 0];
        const nsW1     = this.memory[nsBase + 1];
        const nsW2Prev = this.memory[nsBase + 2];
        if (nsW0Prev !== 0 || nsW1 !== 0) {
            const gt_seq   = (nsW2Prev >>> 25) & 0x7F;
            const parsedW1 = this.parseNSWord1(nsW1);
            this.memory[nsBase + 0] = loc >>> 0;
            this.memory[nsBase + 2] = this.makeVersionSeals(gt_seq, loc, parsedW1.limit);
        }

        // Outform → Inform promotion: if the NS entry's gtType is still 2 (Outform,
        // written by initLazyManifest for cold slots), flip it to 1 (Inform) now that
        // the lump is resident.  Subsequent GT derivations from this NS entry will
        // carry type=1 so the normal Inform CALL path fires without re-triggering Mode 2.
        {
            const promNsBase = this.NS_TABLE_BASE + slotIndex * this.NS_ENTRY_WORDS;
            const promW1 = this.memory[promNsBase + 1];
            const promW1f = this.parseNSWord1(promW1);
            if (promW1f.gtType === 2) {
                this.memory[promNsBase + 1] = this.packNSWord1(
                    promW1f.limit, promW1f.b, promW1f.g,
                    1 /* Inform */, promW1f.clistCount);
                this.output += `[LOADER] NS[${slotIndex}] Outform→Inform promotion in NS entry word1\n`;
            }
        }

        entry.loaded = true;
        entry.loadCount = (entry.loadCount || 0) + 1;
        const dataNote = totalDataWords > 0 ? `, ${totalDataWords} data words` : '';
        this.output += `[LOADER] ${label} code installed at 0x${loc.toString(16)} (${lumpSize} words, ${totalCodeWords} code words${dataNote}, load #${entry.loadCount}) — GT preserved, seal recomputed\n`;

        this.auditLog.push({
            gate: 'Loader.Load',
            label: label,
            nsIndex: slotIndex,
            requiredPerm: null,
            checks: {
                manifest: { pass: true },
                install: { pass: true }
            },
            b: 0, f: 0,
            result: 'pass'
        });

        this.emit('lazyLoad', { slot: slotIndex, label: label });
        return true;
    }

    lazyEvict(slotIndex) {
        const entry = this.lazyManifest[slotIndex];
        if (!entry) return false;
        if (!entry.loaded) return false;
        if (entry.priority === 'hot') {
            this.output += `[LOADER] REFUSED: slot ${slotIndex} is HOT — cannot evict\n`;
            return false;
        }

        const label = this.nsLabels[slotIndex] || `slot_${slotIndex}`;

        const nsEntry = this.readNSEntry(slotIndex);
        if (nsEntry && nsEntry.word0_location > 0) {
            const loc = nsEntry.word0_location;
            const hdr = this.parseLumpHeader(this.memory[loc]);
            // Zero the ENTIRE lump (header + code + c-list) so the block is
            // free for alternative objects.  NS entry authority (type, limit,
            // gt_seq, seal) is never changed — only lump memory is freed.
            const lumpSize = hdr.valid ? hdr.lumpSize : (entry.allocSize || this.SLOT_SIZE);
            for (let i = 0; i < lumpSize; i++) {
                this.memory[loc + i] = 0;
            }
            // memory[loc] is now 0: magic=0 ≠ 0x1F → CODE_NOT_RESIDENT on next CALL/LOAD.
        }

        entry.loaded = false;
        this.output += `[LOADER] Evicted ${label} (slot ${slotIndex}) — entire lump zeroed, NS entry authority preserved\n`;

        this.auditLog.push({
            gate: 'Loader.Evict',
            label: label,
            nsIndex: slotIndex,
            requiredPerm: null,
            checks: { evict: { pass: true } },
            b: 0, f: 0,
            result: 'pass'
        });

        this.emit('lazyEvict', { slot: slotIndex, label: label });
        return true;
    }

    _dispatchLoaderLoad(targetSlot) {
        if (this.abstractionRegistry) {
            const loaderAbs = this.abstractionRegistry.getAbstraction(this._loaderSlot);
            if (loaderAbs && loaderAbs.dispatch && loaderAbs.dispatch['LOAD']) {
                this.output += `[LOADER] Dispatching Loader.Load(${targetSlot}) via NS[${this._loaderSlot}]\n`;
                const result = loaderAbs.dispatch['LOAD'](this, { dr1: targetSlot });
                return result && result.ok;
            }
        }
        return this.lazyLoad(targetSlot);
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
        // Generalised signed-return readout: tracks the most recent CALL that adopted
        // the signed-return convention. Shape: {absIndex, methodName, dr1, ledIndex?}.
        // null = no signed-return CALL has executed yet.
        this.lastSignedReturn = null;

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
        this.lambdaCachedFrame = null;
        this.faultLog = [];
        this._instrHistory = [];
        this._currentInstrLabel = null;
        this.faultViolationData = null;   // populated by B:00 FAULT_RST from last faultLog entry

        // Boot Image Designer Step 1 (Task #214): namespace memory window size
        // is programmer-chosen via the Boot Image Designer (totalNamespaceWords).
        // Falls back to historical 65536 when no project boot config is loaded.
        this.memory = new Uint32Array(this._namespaceMemoryWords());
        this.NS_TABLE_BASE = this.memory.length - this.NS_TABLE_RESERVE;

        this.nsLabels = {};
        this.nsChainable = {};
        this.nsCount = 0;
        this.gcPolarity = 0;
        this.nsHandlers = {};
        this.nsClistMap = {};

        this.bootComplete = false;
        this.mElevation = false;
        this.bootStep = 0;
        this._initThrdEntry = null;
        this._nucLumpData = null;
        this.callHomeStatus = null;
        this.callHomeTimestamp = null;
        this.ledBits = 0;
        this.ledMode = 'boot';
        this.uartRegs    = [0, 0, 0];      // TX@0, STATUS@1 (1=ready), RX@2
        this.buttonState = 0;              // button bitmask (reg 0)
        this.timerRegs   = [0, 0, 0, 0, 0]; // TICKS_LO@0, HI@1, TOD@2, ALARM_CMP@3, CTL@4
        this.lastCapability = null;
        this.auditLog = [];
        this.awaitingLump = null;

        // Three-tier fault recovery and scheduler interrupt state (Task #1077)
        this.irqState = {
            timerArmed: false,
            timerDeadline: 0,
            timerDuration: 0,
            irqActive: false,
            savedContext: null,
            suspendedStep: null,
            waitingOnFlags: {},   // Map: threadId (string) → flag name; supports N waiters
            pendingWakeFlags: [], // Set of signaled flags (array for ordered sweep)
        };

        // PetNameMemory (Task #1531): tracks which c-list slot indices carry a known named
        // capability, enabling LAZY_RESOLVE instead of NULL_CAP hard fault on those slots.
        // Mirrors hardware/pet_name_mem.py and hardware/boot_rom.py DEMO_CLIST_NAMED_SLOTS.
        // Initialised with the boot c-list named slots; updated by DWRITE to IO_PORT_PET_NAME_WR
        // (0xFFFFFF38) and by markNamedSlots() when a program with a capabilities block loads.
        // Boot named slots: {0,1,2,3,5,6,7,8,9,10,11,12,13} — matches DEMO_CLIST_NAMED_SLOTS.
        this.petNameMemory = new Set(BOOT_NAMED_SLOTS);

        // Lazy-Resolve: Transparent Thread Suspension (Task #1519)
        // Registry of pending NULL-GT or 0xFEED resolves, keyed by c-list slot index.
        // Each entry: { petName, slot, instrName, kind, pc, savedDRs, savedCRs, savedFlags, savedSto }
        this._pendingResolves = new Map();
        this._lazySuspended = false;


        this.lazyManifest = {};
        this._lastLoadTargetSlot = null;
        this._loaderSlot = 19;

        this._initNamespaceTable();
        this.output += '--- HARD RESET: all registers zeroed ---\n';
        this.output += 'Boot microcode ready. Step or Run to begin boot sequence.\n';
        this.emit('reset', {});
        this.emit('stateChange', this.getState());
    }

    /**
     * Centralised signed-return capture. Any CALL path that adopts the
     * signed-return convention (currently LED.Set/Clear/Toggle/State and the
     * LED driver handler) must funnel through this helper. It writes DR1,
     * and records `lastSignedReturn` for the live readout in the Abstractions
     * detail panel. DR0 remains hardwired zero; no bypass is needed.
     *
     * @param {number} absIndex   Namespace index of the dispatched abstraction.
     * @param {string} methodName Method name dispatched.
     * @param {number} signed     Signed result to write to DR1.
     * @param {Object|null} extras Optional metadata (e.g. {ledIndex}).
     */
    _recordSignedReturn(absIndex, methodName, signed, extras) {
        this._writeDR(1, signed);
        this.lastSignedReturn = Object.assign(
            { absIndex: absIndex, methodName: methodName, dr1: signed },
            extras || {}
        );
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
        this.lambdaCachedFrame = null;
        this.pc = 0;
        this.physicalPC = 0;
        this.halted = false;
        this.running = false;
        this.bootComplete = false;
        this.mElevation = false;
        this.bootStep = 0;
        this._initThrdEntry = null;
        this._nucLumpData = null;
        this.callHomeStatus = null;
        this.callHomeTimestamp = null;
        this.ledBits = 0;
        this.ledMode = 'boot';
        this.uartRegs    = [0, 0, 0];
        this.buttonState = 0;
        this.timerRegs   = [0, 0, 0, 0, 0];
        this.lastSignedReturn = null;
        this._currentInstrLabel = null;
        this.output += '[PP250] Machine state cleared. Re-entering boot sequence.\n';
        this.emit('stateChange', this.getState());
    }

    /*
     * _fastBoot(reason)
     *
     * PP250-style instant re-boot on fault.  On real hardware the boot FSM
     * runs three transitions (IDLE→FAULT_RST→LOAD_NS→COMPLETE) in 240 ns —
     * the programmer never sees the delay.  In the simulator this translates
     * to calling _returnToBoot() (which clears CRs/DRs and resets bootStep=0)
     * and then letting the normal _bootStep() loop re-run all eight boot
     * phases from the top — including B:04 CALL_HOME which reads faultLog and
     * automatically sets boot_reason=2 whenever the log is non-empty.
     *
     * reason — 0 = cold boot  2 = fault-recovery re-boot (matches firmware
     *          boot_reason field and simulator Tunnel.Register DR1 convention)
     *
     * Called by _tier3Recovery() on double-fault escalation.
     */
    _fastBoot(reason) {
        const tag = reason === 2 ? 'FAULT-RST' : 'COLD-RST';
        this.output += `[PP250] Fast boot — reason=${reason} (${tag}). ` +
            `Hardware FSM: 3 transitions × 240 ns. Simulator: full boot reset.\n`;
        this.auditLog.push({
            gate: 'PP250',
            desc:  `_fastBoot(reason=${reason}) — ${tag} — _returnToBoot() invoked`,
            label: `PP250 fast boot (reason=${reason})`,
            nsIndex: null,
            requiredPerm: null,
            checks: {},
            b: 0, f: 0,
            result: 'pass',
            stepCtx: 'PP250_FAST_BOOT',
        });
        this._returnToBoot();
    }

    packNSWord1(limit17, bFlag, gBit, gtType, clistCount) {
        return (
            ((bFlag & 1) << 31) |
            // bit[30]: f_flag (far-lump) — REMOVED in v2.0 ISA; always 0 in packNSWord1.
            //          In v1.x, f_flag lived in the GT word at bit[25]. In v2.0, it was
            //          retired entirely: far-lumps are no longer a gate in the mLoad/mSave path.
            //          parseNSWord1() returns f:0 for forward compatibility with any code that
            //          still reads the field; callers should treat f===1 as unreachable in v2.0.
            ((gBit & 1) << 29) |        // G-bit at bit[29] — matches server/boot_image.py pack_ns_word1 g→29.
            // bit[28] reserved — NOT used for chainable; chainable lives in this.nsChainable[] side-table.
            ((gtType & 3) << 26) |
            (((clistCount || 0) & 0x1FF) << 17) |
            (limit17 & 0x1FFFF)
        ) >>> 0;
    }

    parseNSWord1(word1) {
        return {
            b: (word1 >>> 31) & 1,
            // f: far-lump flag — REMOVED in v2.0; bit[30] is always 0 in the simulator's
            //    NS Word1 layout.  Exposed here so callers (mSave, boot, CALL) that check
            //    .f === 1 always see false and skip the far-lump restriction path.
            f: (word1 >>> 30) & 1,      // ★ v2.0: always 0; retained for API compatibility
            g: (word1 >>> 29) & 1,      // G-bit at bit[29] — matches packNSWord1 and boot_image.py.
            // bit[28] reserved — chainable is NOT in Word 1; see this.nsChainable[] side-table.
            gtType: (word1 >>> 26) & 3,
            clistCount: (word1 >>> 17) & 0x1FF,
            limit: word1 & 0x1FFFF,
        };
    }

    packLimitWord(limit17, bFlag) {
        return this.packNSWord1(limit17, bFlag, 0, 0, 0);
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

    // ── CRC-32/ISO-HDLC (poly=0xEDB88320, init=0xFFFFFFFF, xorout=0xFFFFFFFF) ──
    // Matches the hardware outform_iot.py CRC-32 check.
    // Input: array of uint32 values whose big-endian bytes form the message.
    _crc32Words(words) {
        let crc = 0xFFFFFFFF;
        for (let wi = 0; wi < words.length; wi++) {
            const w = words[wi] >>> 0;
            for (let shift = 24; shift >= 0; shift -= 8) {
                crc ^= (w >>> shift) & 0xFF;
                for (let b = 0; b < 8; b++) {
                    crc = (crc & 1) ? ((crc >>> 1) ^ 0xEDB88320) : (crc >>> 1);
                }
            }
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
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

    writeNSEntry(idx, location, limit17, bFlag, gBit, gtType, version, clistCount, abstract_gt) {
        if (gtType === 3) {
            throw new Error(
                `writeNSEntry(slot ${idx}): Abstract GTs (gtType=3) must never have NS entries. ` +
                `The NS table is only for Inform (1) and Outform (2) entries. ` +
                `See docs/abstract-io-addressing.md.`
            );
        }
        const base = this.NS_TABLE_BASE + idx * this.NS_ENTRY_WORDS;
        this.memory[base + 0] = location >>> 0;
        this.memory[base + 1] = this.packNSWord1(limit17, bFlag, gBit, gtType, clistCount || 0);
        this.memory[base + 2] = this.makeVersionSeals(version || 0, location, limit17);
        this.memory[base + 3] = (abstract_gt || 0) >>> 0;
        if (idx >= this.nsCount) this.nsCount = idx + 1;
    }

    readNSEntry(idx) {
        if (idx < 0 || idx >= this.MAX_NS_ENTRIES) return null;
        const base = this.NS_TABLE_BASE + idx * this.NS_ENTRY_WORDS;
        const w0 = this.memory[base + 0];
        const w1 = this.memory[base + 1];
        const w2 = this.memory[base + 2];
        const w3 = this.memory[base + 3];
        if (w0 === 0 && w1 === 0) return null;
        const parsed = this.parseNSWord1(w1);
        return {
            word0_location: w0,
            word1_limit: w1,
            word2_seals: w2,
            word3_abstract_gt: w3,
            gBit: parsed.g,
            gtType: parsed.gtType,
            clistCount: parsed.clistCount,
            chainable: this.nsChainable[idx] || false,
            label: this.nsLabels[idx] || '',
        };
    }

    isNSEntryValid(idx) {
        if (idx < 0 || idx >= this.MAX_NS_ENTRIES) return false;
        const base = this.NS_TABLE_BASE + idx * this.NS_ENTRY_WORDS;
        return (this.memory[base] !== 0 || this.memory[base + 1] !== 0);
    }

    // ── Interactive Pending-GT Resolution (Task #1448 + Task #1519) ────────────
    // Called by CListViewer when the user picks an NS abstraction from the
    // "Resolve Now" popover.  Writes a live Inform GT (E permission) into the
    // c-list slot that currently holds a pending sentinel (0xFEED____) or a
    // NULL GT (0x00000000) that triggered a lazy-suspend (Task #1519).
    //
    // Returns { ok: true, gt: <word> } on success, or { ok: false, error: <msg> }.
    resolvePendingSlot(slotIdx, nsIdx) {
        if (!this.bootComplete) return { ok: false, error: 'Simulator not booted' };
        if (nsIdx < 0 || !this.isNSEntryValid(nsIdx)) {
            return { ok: false, error: `NS[${nsIdx}] is not a valid namespace entry` };
        }

        const cr6 = this.cr && this.cr[6];
        if (!cr6 || (cr6.word0 >>> 0) === 0) return { ok: false, error: 'CR6 is null — no active c-list' };

        const clistBase = cr6.word1 >>> 0;
        let clistCount = 0;
        try { clistCount = this.parseNSWord1(cr6.word2).clistCount; } catch (e) { clistCount = 0; }

        if (slotIdx < 0 || slotIdx >= clistCount) {
            return { ok: false, error: `Slot ${slotIdx} is out of range (c-list has ${clistCount} entries)` };
        }

        const addr = clistBase + slotIdx;
        const existing = (this.memory[addr] >>> 0);
        const hasLazyEntry = this._pendingResolves && this._pendingResolves.has(slotIdx);

        // Accept 0xFEED pending sentinels (Task #1448) and NULL GTs that are
        // registered in _pendingResolves due to a lazy-suspend (Task #1519).
        if (!ChurchSimulator.isPendingGT(existing) && !(existing === 0 && hasLazyEntry)) {
            return { ok: false, error: `Slot ${slotIdx} does not hold a pending sentinel` };
        }

        const pendingName = ChurchSimulator.isPendingGT(existing)
            ? ChurchSimulator.pendingGTName(existing)
            : (hasLazyEntry ? this._pendingResolves.get(slotIdx).petName : `slot${slotIdx}`);
        const newGT = this.createGT(0, nsIdx, { R:0, W:0, X:0, L:0, S:0, E:1 }, 1);
        this.memory[addr] = newGT >>> 0;
        this.output += `[RESOLVE] CR${slotIdx} "${pendingName}" \u2192 NS[${nsIdx}] introduced interactively.\n`;

        // Resume suspended thread if this slot was the cause of a lazy-suspend.
        if (this._lazySuspended && hasLazyEntry) {
            const ctx = this._pendingResolves.get(slotIdx);
            this.pc = ctx.pc;
            if (ctx.savedCRs) {
                for (let i = 0; i < ctx.savedCRs.length; i++) {
                    if (ctx.savedCRs[i]) this.cr[i] = { ...ctx.savedCRs[i] };
                }
            }
            if (ctx.savedDRs) {
                for (let i = 0; i < ctx.savedDRs.length; i++) {
                    this.dr[i] = ctx.savedDRs[i];
                }
            }
            if (ctx.savedFlags) Object.assign(this.flags, ctx.savedFlags);
            this.sto = ctx.savedSto;
            this._lazySuspended = false;
            this._pendingResolves.delete(slotIdx);
            this.output += `[LAZY-RESOLVE] Thread resumed from PC=${ctx.pc} \u2014 retrying ${ctx.instrName} for slot ${slotIdx} "${pendingName}".\n`;
        }

        return { ok: true, gt: newGT, pendingName, nsIdx };
    }

    // ── Escalate Lazy-Resolve to NULL_CAP fault (Task #1519) ─────────────────
    // Called by the IDE after the wall-clock deadline expires.  Restores thread
    // context so the fault record carries the original PC / instruction, then
    // fires NULL_CAP with full details.
    escalateLazyResolve(slot) {
        const entry = this._pendingResolves.get(slot);
        if (!entry) {
            return { ok: false, error: `No pending resolve for slot ${slot}` };
        }
        // Restore context so the fault shows the original PC / instruction.
        this.pc = entry.pc;
        if (entry.savedCRs) {
            for (let i = 0; i < entry.savedCRs.length; i++) {
                if (entry.savedCRs[i]) this.cr[i] = { ...entry.savedCRs[i] };
            }
        }
        if (entry.savedDRs) {
            for (let i = 0; i < entry.savedDRs.length; i++) {
                this.dr[i] = entry.savedDRs[i];
            }
        }
        if (entry.savedFlags) Object.assign(this.flags, entry.savedFlags);
        this.sto = entry.savedSto;
        this._lazySuspended = false;
        this._pendingResolves.delete(slot);
        // Fire the NULL_CAP fault with full context so the programmer knows exactly what to do.
        this.fault('NULL_CAP',
            `${entry.instrName}: c-list slot ${slot} "${entry.petName}" deadline expired \u2014 Link Pet name '${entry.petName}' to a live NS entry to resolve`,
            { petName: entry.petName, slot, instrName: entry.instrName, savedPC: entry.pc, kind: entry.kind }
        );
        return { ok: true };
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
            // Use slot-indexed sparse access so that freed NS slots (freedNSSlot:true)
            // appear as null at their correct index position rather than being silently
            // shifted — which would assign the wrong NS slot to every subsequent entry.
            const dict = this.abstractionRegistry.abstractions;
            const maxIdx = Object.keys(dict).reduce((m, k) => Math.max(m, +k), -1);
            const result = [];
            for (let i = 0; i <= maxIdx; i++) {
                const a = dict[i];
                if (!a || a.freedNSSlot) {
                    result.push(null);
                } else {
                    result.push({
                        label: a.name,
                        perms: a.perms,
                        chainable: a.chainable || false,
                        handler: a.handler || null,
                    });
                }
            }
            return result;
        }
        return [
            { label: 'Boot.NS',      perms: {R:0,W:0,X:0,L:0,S:0,E:0}, chainable: false },
            { label: 'Boot.Thread',   perms: {R:0,W:0,X:0,L:0,S:0,E:0}, chainable: false },
            null,              // slot 2 freed — Startup.Config removed; hardware ISA owns M-state per CR register
            { label: 'LED flash',     perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Salvation',     perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Navana',        perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Mint',          perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Memory',        perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Scheduler',     perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Stack',         perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: true },
            { label: 'DijkstraFlag',  perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            null,              // slot 11 freed — UART NS slot eliminated (Task #431); Abstract UART GTs need no NS entry
            null,              // slot 12 freed — LED NS slot eliminated (Task #406); Abstract LED GTs need no NS entry
            null,              // slot 13 freed — Button NS slot eliminated (Task #431); Abstract Button GTs need no NS entry
            null,              // slot 14 freed — Timer NS slot eliminated (Task #431); Abstract Timer GTs need no NS entry
            { label: 'Display',       perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'SlideRule',     perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: true },
            { label: 'Abacus',        perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: true },
            { label: 'Constants',     perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Loader',        perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'SUCC',          perms: {R:0,W:0,X:1,L:0,S:0,E:0}, chainable: false },
            { label: 'PRED',          perms: {R:0,W:0,X:1,L:0,S:0,E:0}, chainable: false },
            { label: 'ADD',           perms: {R:0,W:0,X:1,L:0,S:0,E:0}, chainable: false },
            { label: 'SUB',           perms: {R:0,W:0,X:1,L:0,S:0,E:0}, chainable: false },
            { label: 'MUL',           perms: {R:0,W:0,X:1,L:0,S:0,E:0}, chainable: false },
            { label: 'ISZERO',        perms: {R:0,W:0,X:1,L:0,S:0,E:0}, chainable: false },
            { label: 'TRUE',          perms: {R:0,W:0,X:0,L:1,S:0,E:0}, chainable: false },
            { label: 'FALSE',         perms: {R:0,W:0,X:0,L:1,S:0,E:0}, chainable: false },
            null,              // slot 28 freed — Family (future idea, see docs/future-abstractions.md)
            null,              // slot 29 freed — Schoolroom (future idea, see docs/future-abstractions.md)
            null,              // slot 30 freed — Friends (future idea, see docs/future-abstractions.md)
            { label: 'Tunnel',        perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Keystone',      perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            null,              // slot 33 freed — Editor (future idea, see docs/future-abstractions.md)
            null,              // slot 34 freed — Assembler (future idea, see docs/future-abstractions.md)
            null,              // slot 35 freed — Debugger (future idea, see docs/future-abstractions.md)
            null,              // slot 36 freed — Deployer (future idea, see docs/future-abstractions.md)
            null,              // slot 37 freed — Browser (future idea, see docs/future-abstractions.md)
            null,              // slot 38 freed — Messenger (future idea, see docs/future-abstractions.md)
            null,              // slot 39 freed — Photos (future idea, see docs/future-abstractions.md)
            null,              // slot 40 freed — Social (future idea, see docs/future-abstractions.md)
            null,              // slot 41 freed — Video (future idea, see docs/future-abstractions.md)
            null,              // slot 42 freed — Email (future idea, see docs/future-abstractions.md)
            { label: 'PAIR',          perms: {R:0,W:0,X:1,L:0,S:0,E:0}, chainable: false },
            { label: 'GC',            perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false, handler: 'gc' },
            { label: 'Thread',        perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            null,              // slot 46 freed — Circle (future idea, see docs/future-abstractions.md)
            { label: 'Billing',       perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },   // NS[47] — P-GT quota enforcer (Task #760 Stage 1)
            { label: 'TuringMemory',  perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },   // NS[48] — domain-separated code allocator (Task #760 Stage 1)
            { label: 'ChurchMemory',     perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },   // NS[49] — abstract handle allocator (Task #760 Stage 1)
            { label: 'Scheduler.IRQ.Thread', perms: {R:0,W:0,X:0,L:0,S:0,E:0}, chainable: false }, // NS[50] — fixed boot-image IRQ thread; zero perms, authority via M-register on CHANGE (Task #1077)
            { label: 'Ethernet',             perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false }, // NS[51] — Ethernet MMIO abstraction (token 00003300, v1.1.0)
            { label: 'EventRouter',          perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false }, // NS[52] — event-to-handler routing table (token b3076308, v1.0.0)
        ];
    }

    _initNamespaceTable() {
        // GT type semantics: 0=NULL, 1=Inform (concrete lump in memory), 2=Outform (remote/F-bit), 3=Abstract (PassKey/value)
        // All boot-time slots (Boot.NS, Boot.Thread, Boot.Abstr, Salvation, Navana, Mint, etc.) are Inform (type=1)
        // because they reference concrete physical memory lumps in the namespace table.
        // Abstract (type=3) GTs are only created by Navana.Abstraction.Add (user uploads) and Navana.MintPassKey.
        this.nsLabels = {};
        this.nsChainable = {};
        this.nsCount = 0;
        const abstractions = this._getAbstractionCatalog();
        const clistChildren = [];
        const clistGTs = [];

        // Device register NS limits — all I/O devices migrated to Abstract GTs; no Inform NS entries remain.
        // LED:    freed Task #406 (slot 12); Abstract GTs in c-list[8]–[13].
        // UART:   freed Task #431 (slot 11); Abstract GT  in c-list[14].
        // Button: freed Task #431 (slot 13); Abstract GT  in c-list[15].
        // Timer:  freed Task #431 (slot 14); Abstract GT  in c-list[17] (moved from 16, Task #461).
        // Display (slot 15) is next in the migration roadmap.
        const DEVICE_REG_LIMITS = {};  // no device register Inform NS entries remain

        // Boot Image Designer Step 1 (Task #214): if a project boot config has
        // been saved by the IDE, use the programmer-chosen lump sizes. Otherwise
        // fall back to the historical demo defaults so existing tutorials still
        // work unchanged. See docs/foundation-lump-design.md §4.
        const _bcStep1 = (typeof window !== 'undefined' && window.bootConfig
                          && window.bootConfig.step1) ? window.bootConfig.step1 : null;
        const THREAD_LUMP_SIZE     = (_bcStep1 && _bcStep1.threadLumpWords)    || 256;
        // Boot.Abstr lump size: always 64w in the fallback init path (Task #568).
        // The hardcoded init is only a fallback when no binary boot image is present;
        // loadBootImage() uses the actual size from the generator.  Defaulting to 64w
        // keeps this path consistent with server/boot_image.py BOOT_ABSTR_DEFAULT_SIZE.
        const BOOT_ABSTR_LUMP_SIZE = 64;
        const NS_LUMP_SIZE         = (_bcStep1 && _bcStep1.namespaceLumpWords) || this.SLOT_SIZE;
        // Boot.Abstr at bootEntrySlot (default 3); slot 2 is freed (Startup.Config removed).
        const slotSizes = {};
        slotSizes[0] = NS_LUMP_SIZE;
        slotSizes[1] = THREAD_LUMP_SIZE;
        // Slot 2 freed — no override needed.
        slotSizes[this.bootEntrySlot] = BOOT_ABSTR_LUMP_SIZE;  // Boot.Abstr: 64w default

        // Boot Image Designer Step 2 (Task #215): per-slot physAddr overrides
        // for programmer-declared resident lumps. NS entries for those slots
        // are written with the chosen location directly, so the NS table is
        // correct from the moment _initNamespaceTable returns (no post-init
        // patching of NS words). Non-resident catalog slots and slots not
        // mentioned in step2 fall back to the historical runningOffset
        // layout, preserving compatibility with the existing demo.
        const _bcStep2Lumps = (typeof window !== 'undefined' && window.bootConfig
                               && window.bootConfig.step2
                               && window.bootConfig.step2.lumps) || [];
        const physAddrOverride = {};   // nsSlot → physAddr
        for (const e of _bcStep2Lumps) {
            if (e && e.resident && Number.isFinite(e.physAddr) && e.physAddr > 0) {
                physAddrOverride[e.nsSlot] = e.physAddr;
            }
        }

        let runningOffset = 0;
        for (let i = 0; i < abstractions.length; i++) {
            const a = abstractions[i];
            const mySize = slotSizes[i] || this.SLOT_SIZE;

            if (!a) {
                // Free/null slot — no physical lump, no address space consumed.
                // Task #1205: null slot 2 gap removed; runningOffset not advanced.
                // Leave the NS table entry as all-zeros (null/free).
                clistGTs.push(0);           // null GT in c-list at this position
                this.nsLabels[i] = '(free)';
                continue;
            }

            // Step 2 physAddr override (if any) replaces the runningOffset
            // location for this slot, but does not advance runningOffset —
            // resident lumps are placed in the usable region (after the
            // foundational layout) which is disjoint from the runningOffset
            // path, so subsequent foundational slots are unaffected.
            const overrideLoc = physAddrOverride[i];
            const loc = (i === 0) ? 0
                      : (overrideLoc !== undefined ? overrideLoc : runningOffset);
            // Slot 0 is the namespace physical-memory descriptor; the
            // namespace lump it anchors reserves NS_LUMP_SIZE words so
            // subsequent slots start after it (Task #214 Step 1).
            if (i > 0 && overrideLoc === undefined) runningOffset += mySize;
            else if (i === 0) runningOffset = NS_LUMP_SIZE;
            const lim17 = (i === 0) ? (this.memory.length - 1)
                        : (DEVICE_REG_LIMITS[i] !== undefined ? DEVICE_REG_LIMITS[i]
                        : (mySize - 1));
            const nsTableCount = (i === 0) ? abstractions.length : 0;
            // v2.0 GT layout: [31]=b_flag [30:28]=perm[2:0] [27]=dom ★[26:25]=gt_type ★[24:16]=gt_seq ...
            const _ap   = a.perms || {};
            const _dom  = (_ap.L || _ap.S || _ap.E) ? 1 : 0;
            const _p3   = _dom === 0
                ? (((_ap.X?1:0)<<2)|((_ap.W?1:0)<<1)|(_ap.R?1:0))
                : (((_ap.E?1:0)<<2)|((_ap.S?1:0)<<1)|(_ap.L?1:0));
            const abstractGtWord = ((_p3 << 28) | (_dom << 27)) >>> 0;
            this.writeNSEntry(i, loc, lim17, 0, 0, 1, 0, nsTableCount, abstractGtWord);
            this.nsChainable[i] = a.chainable || false;
            this.nsLabels[i] = a.label;
            if (a.handler) {
                this.nsHandlers[i] = a.handler;
            }
            clistChildren.push(i);
            const gtWord = this.createGT(0, i, a.perms, 1);
            clistGTs.push(gtWord);
        }

        // Step 3 (Task #216): reserve N blank NS entries at the end of the
        // table for the runtime lazy loader to claim when new lumps are
        // created. The IDE doesn't decide what goes in these slots — only
        // how much headroom to leave. Slot 0's clistCount stays = the
        // number of NAMED entries (the namespace lump describes only the
        // lumps it knows about); reserved entries are addressable via
        // nsCount but carry no descriptor until the lazy loader fills them.
        const step3 = (typeof window !== 'undefined' && window.bootConfig && window.bootConfig.step3) || null;
        const emptyCount = (step3 && Number.isFinite(step3.emptySlotCount))
                            ? Math.max(0, step3.emptySlotCount | 0) : 0;
        if (emptyCount > 0) {
            const startIdx = this.nsCount;
            const maxEntries = (this.NS_TABLE_RESERVE / this.NS_ENTRY_WORDS) | 0;
            const endIdx = startIdx + emptyCount;
            if (endIdx > maxEntries) {
                // Validation in the IDE/server prevents this; if we reach
                // here the boot config was hand-edited or out of sync.
                // Fail loudly rather than silently under-applying — the
                // lazy loader expects the configured number of slots.
                throw new Error(
                    `Boot config step3.emptySlotCount=${emptyCount} would push ` +
                    `nsCount from ${startIdx} to ${endIdx}, exceeding the NS ` +
                    `table capacity (${maxEntries}). Reduce the count or ` +
                    `enlarge the namespace table.`);
            }
            for (let idx = startIdx; idx < endIdx; idx++) {
                const base = this.NS_TABLE_BASE + idx * this.NS_ENTRY_WORDS;
                this.memory[base + 0] = 0;
                this.memory[base + 1] = 0;
                this.memory[base + 2] = 0;
                this.nsLabels[idx] = '(reserved)';
            }
            this.nsCount = endIdx;
        }

        const THREAD_SW = 32;
        const THREAD_CC = 12;
        // n_minus_6 is derived from the actual lump size so a programmer
        // -chosen THREAD_LUMP_SIZE > 256 gets a header that describes the
        // real allocation (was hardcoded to 2 ⇒ 256 words, which silently
        // drifted from server/boot_image.py for custom Step-1 sizes — see
        // tests/test_boot_image_matches_simulator.py).
        const THREAD_N_MINUS_6 = Math.max(0, Math.ceil(Math.log2(THREAD_LUMP_SIZE)) - 6);
        const threadLoc = this.memory[this.NS_TABLE_BASE + 1 * this.NS_ENTRY_WORDS];
        this.memory[threadLoc] = this.packLumpHeader(THREAD_N_MINUS_6, THREAD_SW, THREAD_CC, 2);

        // Thread caps zone — CR0 home slot at word offset +244 is pre-set to an E-GT
        // for bootEntrySlot (default: slot 3, LED flash) so the board boots standalone
        // without needing setBootEntrySlot() from the IDE.  Mirrors server/boot_image.py
        // which writes create_gt(0, boot_entry_slot, {"E":1}, 1) at thread_loc+244.
        // The IDE overwrites this when the user picks a different entry.  The "if empty"
        // guard in the INIT_ABSTR boot path (line ~1688) becomes a harmless no-op.
        this.memory[threadLoc + THREAD_CAPS_OFFSET] =
            this.createGT(0, this.bootEntrySlot, {E: 1}, 1);

        // DEMO_CLIST hardware alignment: slots 8–16 hold device GTs so
        // hardware code "LOAD CR3, CR6, 8" picks up the LED device, exactly as on Ti60 F225.
        //   [8]–[13] LED[0]–LED[5] Abstract GTs (type=0b11, ab_type=I/O, device_class=LED, device_data=0-5)
        //            No NS slot, no lump — capability entirely encoded in the 32-bit GT word (Task #406).
        //   [14] UART_DEV  R|W → Abstract GT (device_class=UART,  device_data=0=TX)    — Task #431
        //   [15] BTN_DEV   R   → Abstract GT (device_class=BUTTON, device_data=0=state) — Task #431
        //   [16] TIMER_DEV R|W → Abstract GT (device_class=TIMER,  device_data=0=TICKS_LO) — Task #431
        for (let ledIdx = 0; ledIdx < 6; ledIdx++) {
            const ab_data = ((ChurchSimulator.DEVICE_CLASS_LED & 0xFF) << 8) | (ledIdx & 0xFF);
            clistGTs[8 + ledIdx] = this.createAbstractGT(
                ChurchSimulator.AB_TYPE_IO, {R:1, W:1}, 0, ab_data);
        }
        // Slots 14–16: Abstract I/O GTs (Task #431) — no NS slot, no lump
        clistGTs[14] = this.createAbstractGT(ChurchSimulator.AB_TYPE_IO, {R:1,W:1}, 0,
            ((ChurchSimulator.DEVICE_CLASS_UART   & 0xFF) << 8) | 0);  // UART_DEV  R|W  reg0=TX
        clistGTs[15] = this.createAbstractGT(ChurchSimulator.AB_TYPE_IO, {R:1},     0,
            ((ChurchSimulator.DEVICE_CLASS_BUTTON & 0xFF) << 8) | 0);  // BTN_DEV   R    reg0=state
        // Slot 16: SlideRule Inform GT (NS slot 16, E-perm, gt_seq=0)
        // TIMER_DEV was erroneously placed here (Task #431); it conflicted with SlideRule at
        // NS slot 16. CALL instructions that reference SlideRule use "CALL CRn, CR6, 16"
        // (see app-absdetail.js) — so c-list slot 16 must carry the SlideRule GT, not TIMER_DEV.
        clistGTs[16] = this.createGT(0, 16, {E:1}, 1);  // SlideRule  E   -> NS idx 16
        // Slot 17: TIMER_DEV moved from slot 16 to avoid NS-slot conflict
        clistGTs[17] = this.createAbstractGT(ChurchSimulator.AB_TYPE_IO, {R:1,W:1}, 0,
            ((ChurchSimulator.DEVICE_CLASS_TIMER  & 0xFF) << 8) | 0);  // TIMER_DEV R|W  reg0=TICKS_LO
        // Slot 18: ChurchHW — hardware-control Abstract GT (W-only).
        // DWRITE through this GT marks a c-list slot (DR value & 0x3F) as named in PetNameMemory.
        // Used by the .petname <n> assembler pseudo-instruction (Task #1542).
        clistGTs[18] = this.createAbstractGT(ChurchSimulator.AB_TYPE_IO, {W:1}, 0,
            ((ChurchSimulator.DEVICE_CLASS_CHURCHHW & 0xFF) << 8) | 0);  // ChurchHW  W   PET_NAME_WR
        // Memory-manager GT at c-list[0]: R|W Inform capability over NS slot 0 (full namespace).
        // Mirrors boot_image.py "Memory-manager GT at c-list[0]" so the NS lump c-list matches
        // the Python-generated boot image exactly (Task #694).
        clistGTs[0] = this.createGT(0, 0, {R:1, W:1}, 1);
        const NUC_CODE_WORDS    = 3;
        const DEMO_CLIST_SIZE   = 19;   // slots 0–18; slot 18 = ChurchHW (Task #1542)

        // ── NS lump header and c-list (Task #694) ────────────────────────────────────
        // Write a valid lump header at memory[0] for the NS lump (Slot 0):
        //   magic=0x1F, n_minus_6=log2(NS_LUMP_SIZE)-6, cw=0, cc=catalog count, typ=0.
        // Write one GT word per catalog slot (named or null) into the NS lump c-list tail
        // at words NS_LUMP_SIZE−nsCatalogCount through NS_LUMP_SIZE−1.
        // This must happen BEFORE clistGTs is truncated to DEMO_CLIST_SIZE so that
        // catalog slots beyond 17 still have their NS-loop GT values available.
        const nsLumpNMinus6   = Math.max(0, Math.ceil(Math.log2(NS_LUMP_SIZE)) - 6);
        const nsCatalogCount  = abstractions.length;
        this.memory[0] = this.packLumpHeader(nsLumpNMinus6, 0, nsCatalogCount, 0);
        for (let ci = 0; ci < nsCatalogCount; ci++) {
            this.memory[NS_LUMP_SIZE - nsCatalogCount + ci] = (clistGTs[ci] || 0) >>> 0;
        }

        // Slots 0–16 map to NS slots 0–16 (or contain hardware-device Abstract GTs at 8–15).
        // Slot 17 (TIMER_DEV) is simulator-only; not present in the boot c-list on real hardware.
        clistGTs.length         = DEMO_CLIST_SIZE;
        // Save the completed DEMO_CLIST so _applyPendingSimLoad() (app-run.js) can
        // lazily install it into Boot.Abstr's free region when the NUC_PROGRAM is
        // loaded at Run time (the "LAZY LOAD does work on First CALL" fix).
        this.demoClistGTs       = clistGTs.slice();

        // ── Boot.Abstr lump (NS Slot 3) ────────────────────────────────────────────
        // Redesigned (Task #651): cc=0, cw=3. No c-list. Three instructions:
        //   CHANGE AL, CR12, CR12, #1  — switch to Boot.Thread (slot 1);
        //                                RESTORE_CALL loads CR0–CR11 from thread caps zone
        //                                (thread[+244..+255]). CR0 = programmable Entry E-GT.
        //   TPERM  AL, CR0,  #E        — restrict CR0 to E-permission only
        //   CALL   AL, CR0,  CR0       — enter configured first abstraction
        //                                (faults NULL_CAP if thread[+244] = 0)
        //   Word  0: Lump header (n_minus_6, cw=3, cc=0)
        //   Words 1–3: Code region
        //   Words 4..63: Free (no c-list — cc=0 means no c-list register)
        const bootEntryLoc     = this.memory[this.NS_TABLE_BASE + this.bootEntrySlot * this.NS_ENTRY_WORDS];
        const entryN_MINUS_6   = Math.max(0, Math.ceil(Math.log2(BOOT_ABSTR_LUMP_SIZE)) - 6);
        const entryLumpSize    = BOOT_ABSTR_LUMP_SIZE;
        this.memory[bootEntryLoc] = this.packLumpHeader(entryN_MINUS_6, NUC_CODE_WORDS, 0, 0);
        // Write 3 BOOT_PROGRAM instruction words into the code region (words 1..3).
        for (let i = 0; i < BOOT_ROM_WORDS.length && i < NUC_CODE_WORDS; i++) {
            this.memory[bootEntryLoc + 1 + i] = BOOT_ROM_WORDS[i] >>> 0;
        }
        // cc=0: no c-list region. All words after code region are freespace (already zero).
        const entryCRLimit     = entryLumpSize - 1;
        const entryNSBase      = this.NS_TABLE_BASE + this.bootEntrySlot * this.NS_ENTRY_WORDS;
        this.memory[entryNSBase + 1] = this.packNSWord1(entryCRLimit, 0, 0, 1, 0);
        this.memory[entryNSBase + 2] = this.makeVersionSeals(0, bootEntryLoc, entryCRLimit);
        this.nsClistMap[this.bootEntrySlot] = [];                     // Boot.Abstr has no c-list (cc=0)

        // Slot 2 freed — Startup.Config removed. The hardware ISA owns M-state per CR
        // register. CALL through a non-M E-GT drops M automatically (BOOT_ROM_WORDS[2]).
        // Thread.CR[0] entry E-GT is set by the boot image / setBootEntrySlot(); no
        // intermediary lump is needed.


        // ── Service abstraction c-lists (Task #971) ──────────────────────────────
        // Populate c-lists for the 14 service abstractions that have declared
        // capability requirements.  All are handler-based (cw=0 — no CLOOMC code);
        // only the lump header and c-list GT tail are written.  NS entry word1/word2
        // are corrected to reflect lim17 = lump_size − cc − 1 and the new cc.
        // Pure Church-calculus slots (SUCC/PRED/ADD/SUB/MUL/ISZERO/TRUE/FALSE/PAIR)
        // intentionally keep cc=0 and are absent from SERVICE_CLIST_DEFS.
        //
        // Single-authority model:
        //   Navana (5)  sole NS writer — holds R|W token to the namespace lump
        //   Memory (7)  sole physical allocator — calls GC (44) under pressure
        //   Mint   (6)  sole GT lifecycle manager — delegates NS writes to Navana
        //
        // Entry format: [ns_slot, [ descriptor, ... ]]
        //   Inform descriptor:   { type: 'inform',   ref: N,       perms: {E:1} }
        //   Abstract descriptor: { type: 'abstract', abType: T, rwPerms: {...}, abData: D }
        const SERVICE_CLIST_DEFS = [
            [ 4, [{ type:'inform', ref:5,  perms:{E:1} }]],                                                    // Salvation:    Navana E
            [ 5, [{ type:'inform', ref:0,  perms:{R:1,W:1} },                                                  // Navana:       namespace lump R|W
                  { type:'inform', ref:6,  perms:{E:1} },                                                      //               Mint E
                  { type:'inform', ref:7,  perms:{E:1} }]],                                                    //               Memory E
            [ 6, [{ type:'inform', ref:5,  perms:{E:1} }]],                                                    // Mint:         Navana E
            [ 7, [{ type:'inform', ref:44, perms:{E:1} }]],                                                    // Memory:       GC E
            [ 8, [{ type:'inform', ref:45, perms:{E:1} },                                                      // Scheduler:    Thread E
                  { type:'inform', ref:7,  perms:{E:1} },                                                      //               Memory E
                  { type:'inform', ref:19, perms:{E:1} },                                                      //               CR12_PORT_CAP E-GT (CHANGE CR12 authority; hw NS slot 19)
                  { type:'inform', ref:20, perms:{E:1} },                                                      //               CR13_PORT_CAP E-GT (CHANGE CR13 authority; hw NS slot 20)
                  { type:'inform', ref:21, perms:{E:1} },                                                      //               CR12_MBIT_CAP E-GT (CR12 M-bit authority; hw NS slot 21)
                  { type:'inform', ref:22, perms:{E:1} }]],                                                    //               CR13_MBIT_CAP E-GT (CR13 M-bit authority; hw NS slot 22)
            [ 9, [{ type:'inform', ref:7,  perms:{E:1} }]],                                                    // Stack:        Memory E
            [10, [{ type:'inform', ref:8,  perms:{E:1} }]],                                                    // DijkstraFlag: Scheduler E
            [15, [{ type:'abstract', abType:ChurchSimulator.AB_TYPE_IO, rwPerms:{R:1,W:1},                     // Display:      Abstract I/O GT
                   abData: (ChurchSimulator.DEVICE_CLASS_DISPLAY << 8) | 0 }]],
            [17, [{ type:'inform', ref:18, perms:{E:1} },                                                      // Abacus:       Constants E
                  { type:'inform', ref:15, perms:{E:1} }]],                                                    //               Display E
            [44, [{ type:'inform', ref:5,  perms:{E:1} },                                                      // GC:           Navana E
                  { type:'inform', ref:7,  perms:{E:1} }]],                                                    //               Memory E
            [45, [{ type:'inform', ref:8,  perms:{E:1} },                                                      // Thread:       Scheduler E
                  { type:'inform', ref:7,  perms:{E:1} },                                                      //               Memory E
                  { type:'inform', ref:19, perms:{E:1} },                                                      //               CR12_PORT_CAP E-GT (CHANGE CR12 authority; hw NS slot 19)
                  { type:'inform', ref:21, perms:{E:1} }]],                                                    //               CR12_MBIT_CAP E-GT (CR12 M-bit authority; hw NS slot 21)
            [47, [{ type:'inform', ref:7,  perms:{E:1} },                                                      // Billing:      Memory E
                  { type:'inform', ref:5,  perms:{E:1} }]],                                                    //               Navana E
            [48, [{ type:'inform', ref:7,  perms:{E:1} },                                                      // TuringMemory: Memory E
                  { type:'inform', ref:47, perms:{E:1} }]],                                                    //               Billing E
            [49, [{ type:'inform', ref:7,  perms:{E:1} },                                                      // ChurchMemory: Memory E
                  { type:'inform', ref:47, perms:{E:1} }]],                                                    //               Billing E
        ];
        for (const [cslot, entries] of SERVICE_CLIST_DEFS) {
            const cc  = entries.length;
            const loc = this.memory[this.NS_TABLE_BASE + cslot * this.NS_ENTRY_WORDS];
            if (!loc || !cc) continue;
            const sz    = slotSizes[cslot] || this.SLOT_SIZE;
            const lim17 = (sz - cc - 1) & 0x1FFFF;
            // lump header: cw=0 (handler-only), cc, typ=0
            const nm6 = Math.max(0, Math.ceil(Math.log2(sz)) - 6);
            this.memory[loc] = this.packLumpHeader(nm6, 0, cc, 0) >>> 0;
            // c-list GT words at lump tail
            for (let ci = 0; ci < entries.length; ci++) {
                const e = entries[ci];
                let gt;
                if (e.type === 'abstract') {
                    gt = this.createAbstractGT(e.abType, e.rwPerms, 0, e.abData);
                } else {
                    gt = this.createGT(0, e.ref, e.perms, 1);
                }
                this.memory[loc + sz - cc + ci] = gt >>> 0;
            }
            // Update NS entry word1 (lim17 + cc) and word2 (seal)
            const catEntry  = abstractions[cslot];
            const nsBase    = this.NS_TABLE_BASE + cslot * this.NS_ENTRY_WORDS;
            this.memory[nsBase + 1] = this.packNSWord1(lim17, 0, 0, 1, cc) >>> 0;
            this.memory[nsBase + 2] = this.makeVersionSeals(0, loc, lim17) >>> 0;
        }

        // Boot-entry slot: written at NS_TABLE_BASE - 2 (mirrors boot_image.py).
        // loadBootImage() reads this word and restores bootEntrySlot from the image.
        this.memory[this.NS_TABLE_BASE - 2] = this.bootEntrySlot >>> 0;
        // Format-version tag: written immediately before the NS table (at
        // NS_TABLE_BASE - 1) so that loadBootImage() can detect and reject
        // stale binaries. Bumped to 0x563 (Task #568) — Boot.Abstr placement is now
        // dynamic (64w default or saved lump size); abstractionLumpWords deprecated.
        // Must match boot_image.py BOOT_IMAGE_FORMAT_TAG and loadBootImage().
        const BOOT_IMAGE_FORMAT_TAG_INIT = 0xB0070563;  // bumped Task #568 (dynamic Boot.Abstr placement)
        this.memory[this.NS_TABLE_BASE - 1] = BOOT_IMAGE_FORMAT_TAG_INIT >>> 0;
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
                // ── Capture fault-violation context BEFORE clearing CRs ──────────────
                // If a fault caused this reset, snapshot the violation address while
                // the CRs still hold Namespace / Thread / Abstraction context.
                // This data is forwarded to CALL_HOME (B:04) in the boot packet.
                if (this.faultLog && this.faultLog.length > 0) {
                    const _lfe = this.faultLog[this.faultLog.length - 1];
                    const _snap = _lfe.crSnapshot || [];
                    // Extract NS slot index from a CR's GT word (bits [15:0])
                    const _crSlot  = cr => (cr && cr.word0) ? (cr.word0 & 0xFFFF) : null;
                    const _crLabel = slot => {
                        if (slot === null) return '—';
                        return (this.nsLabels && this.nsLabels[slot]) ? this.nsLabels[slot] : `NS[${slot}]`;
                    };
                    const _nsSlot  = _crSlot(_snap[15]);   // Namespace  (CR15)
                    const _thrSlot = _crSlot(_snap[12]);   // Thread     (CR12)
                    const _absSlot = _crSlot(_snap[14]);   // Abstraction (CR14)
                    // Method / instruction from the last entry in instrHistory
                    const _hist    = _lfe.instrHistory || [];
                    const _lastI   = _hist.length > 0 ? _hist[_hist.length - 1] : null;
                    const _methodStr = _lastI
                        ? `${_lastI.opName}(CR${_lastI.crDst},CR${_lastI.crSrc},imm=${_lastI.imm})`
                        : '—';
                    // Offset = physicalPC within the abstraction lump
                    // Abstraction lump base is CR14.word1 (physical base address)
                    const _absBase = (_snap[14] && _snap[14].word1 !== undefined) ? (_snap[14].word1 >>> 0) : 0;
                    const _faultPC = (_lfe.physicalPC || 0) >>> 0;
                    const _offset  = _faultPC - (_absBase + 1);
                    this.faultViolationData = {
                        namespace:   { nsSlot: _nsSlot,  label: _crLabel(_nsSlot) },
                        thread:      { nsSlot: _thrSlot, label: _crLabel(_thrSlot) },
                        abstraction: { nsSlot: _absSlot, label: _crLabel(_absSlot) },
                        method:      _methodStr,
                        instruction: _lastI
                            ? { physicalPC: _lastI.physicalPC, opName: _lastI.opName,
                                crDst: _lastI.crDst, crSrc: _lastI.crSrc, imm: _lastI.imm }
                            : null,
                        offset:      _offset,
                        pc:          _lfe.pc      || 0,
                        physicalPC:  _faultPC,
                        faultType:   _lfe.type    || '?',
                        faultMsg:    _lfe.message || '?',
                    };
                    this.output += `[BOOT] FAULT_RST — Captured fault context: ` +
                        `${_crLabel(_nsSlot)}.${_crLabel(_thrSlot)}.${_crLabel(_absSlot)}.${_methodStr} ` +
                        `@ physPC=0x${_faultPC.toString(16).toUpperCase()} offset=+${_offset}\n`;
                } else {
                    this.faultViolationData = null;  // cold boot — no prior fault
                }
                // ── Now wipe all architectural state ─────────────────────────────────
                for (let i = 0; i < 16; i++) {   // iterate CR0–CR15 (all 16 capability registers)
                    this._clearCR(i);             // set each CR to NULL (word0=0, word1=0, …)
                }
                this.dr.fill(0);                  // zero all 16 data registers (DR0–DR15)
                this.mElevation = true;           // enable M-elevation: mLoad bypasses R/W/X/L perms during boot
                this.output += '[BOOT] FAULT_RST — All CRs cleared to NULL, all DRs zeroed. M-Elevation ON.\n';
                // Synthetic audit entry — registers the CR/DR wipe in the TSB Audit trail
                this.auditLog.push({
                    gate: 'RST',
                    desc: 'CR0–CR15 → NULL  ·  DR0–DR15 → 0  ·  M-elevation ON',
                    label: 'All CRs / DRs cleared',
                    nsIndex: null,
                    requiredPerm: null,
                    checks: {},
                    b: 0, f: 0,
                    result: 'pass',
                    stepCtx: 'FAULT_RST',
                });
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
            // Load the thread stack GT (NS Slot 1) into CR12.
            // CR12 is the thread stack register: its NS entry encodes the lump
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
                this._writeCR(12, gt12, check12.entry);                            // CR12 ← thread stack token (encodes lump base + size)
                this.output += `[BOOT] INIT_THRD — CR12 <- mLoad(Slot 1) thread stack GT (zero perms, Inform)\n`;
                // Stash the thread NS entry for use in B:03 INIT_HEAP (case 3)
                this._initThrdEntry = check12.entry;
                this.bootStep++;                  // advance state machine → B:03
                this.ledBits = 0b000011;          // LED bit 1 still on; bit 2 reserved for INIT_HEAP
                break;
            }

            // ════════════════════════════════════════════════════════════════════
            // B:03  INIT_HEAP  (case 3)
            // Establish CR5 (Heap) as an RW capability over the thread lump.
            // Consistent with CHANGE CR12 hardware behaviour which synthesizes CR5
            // from the incoming thread's lump header at the same time it sets CR12.
            // ════════════════════════════════════════════════════════════════════
            case 3: {
                const _initThrdEntry = this._initThrdEntry;
                if (!_initThrdEntry) {
                    this.fault('BOOT', 'INIT_HEAP: missing thread NS entry from B:02 INIT_THRD');
                    return false;
                }
                const _threadBase12   = _initThrdEntry.word0_location;
                const _threadHdrWord12 = this.memory[_threadBase12] >>> 0;
                const _threadHdr12    = this.parseLumpHeader(_threadHdrWord12);
                const _threadCC12     = _threadHdr12.valid ? _threadHdr12.cc : 0;
                const _heapStart12    = 1 + 16 + _threadCC12;                     // first word above header + DR zone + c-list
                const _spMax12        = (_threadHdr12.valid ? _threadHdr12.lumpSize : 256) - 12 - 1;
                const gt5 = this.createGT(0, 1, {R:1,W:1,X:0,L:0,S:0,E:0}, 1);  // RW Inform GT for the thread lump (Slot 1)
                this._writeCR(5, gt5, _initThrdEntry);                             // CR5 ← heap RW token (base=thread lump, perms=RW)
                this.output += `[BOOT] INIT_HEAP — CR5 <- thread heap (RW, Inform, Slot 1) heap=[+${_heapStart12}..+${_spMax12}] (CHANGE-consistent)\n`;
                // Synthetic audit entry so the TSB Audit panel shows the CR5 heap
                // synthesis as an explicit capability gate (not an mLoad — the GT is
                // created directly by the boot state machine, CHANGE-consistent).
                this.auditLog.push({
                    gate: 'HEAP',
                    label: this.nsLabels[1] || 'Boot.Thread',
                    nsIndex: 1,
                    requiredPerm: null,
                    checks: {
                        version: { pass: true },
                        seal:    { pass: true },
                        perm:    { pass: true, perm: null },
                    },
                    b: 0, f: 0,
                    result: 'pass',
                    stepCtx: 'INIT_HEAP CR5←heap',
                });
                this.bootStep++;                  // advance state machine → B:04
                this.ledBits = 0b000111;          // LED bit 2 ON = INIT_HEAP complete
                break;
            }

            // ════════════════════════════════════════════════════════════════════
            // B:04  CALL_HOME  (case 4)
            // Send the Tunnel.Register identification packet and await ACK.
            // Offline-safe: always advances bootStep regardless of ACK result.
            // When the abstraction registry is available, dispatches via
            // Tunnel.Register; otherwise simulates the UART interaction directly
            // (write boot_reason/last_fault/fault_NIA to uartRegs[0], read ACK
            // from uartRegs[1]).
            // ════════════════════════════════════════════════════════════════════
            case 4: {
                const _bootReason = (this.faultLog && this.faultLog.length > 0) ? 2 : 0; // 0=cold, 2=fault-recovery
                const _lastFault  = (this.faultLog && this.faultLog.length > 0)
                    ? (this.faultLog[this.faultLog.length - 1].type || 0) : 0;
                const _faultNIA   = (this.faultLog && this.faultLog.length > 0)
                    ? (this.faultLog[this.faultLog.length - 1].pc || 0) : 0;

                let _ack = 0;
                let _callHomeMode = 'offline';

                if (this.abstractionRegistry) {
                    const _chResult = this.abstractionRegistry.dispatchMethod(
                        this._slotByPetName('Tunnel', 31), 'Register', this,
                        { dr1: _bootReason, dr2: _lastFault, dr3: _faultNIA }
                    );
                    if (_chResult && _chResult.ok !== false) {
                        _ack = (_chResult.dr0 !== undefined) ? (_chResult.dr0 | 0) : 0;
                        _callHomeMode = _ack > 0 ? 'online' : 'offline';
                    }
                } else if (this.uartRegs) {
                    this.uartRegs[0] = _bootReason;
                    this.uartRegs[0] = _lastFault;
                    this.uartRegs[0] = _faultNIA;
                    _ack = this.uartRegs[1] | 0;
                    _callHomeMode = _ack > 0 ? 'online' : 'offline';
                }

                this.output += `[BOOT] CALL_HOME — Tunnel.Register(boot_reason=${_bootReason}, last_fault=${_lastFault}, fault_NIA=0x${_faultNIA.toString(16).toUpperCase()}) ACK=${_ack} (${_callHomeMode})\n`;
                if (this.faultViolationData) {
                    const fv = this.faultViolationData;
                    this.output +=
                        `[BOOT] CALL_HOME — FaultViolation: ` +
                        `${fv.namespace.label}.${fv.thread.label}.${fv.abstraction.label}.${fv.method} ` +
                        `@ physPC=0x${fv.physicalPC.toString(16).toUpperCase()} offset=+${fv.offset} ` +
                        `[${fv.faultType}: ${fv.faultMsg}]\n`;
                }
                this.callHomeStatus = _callHomeMode;
                this.callHomeTimestamp = Date.now();
                // Synthetic audit entry — shows the CALL_HOME registration in the TSB Audit trail
                const _fvSuffix = this.faultViolationData
                    ? ` · Fault: ${this.faultViolationData.namespace.label}.${this.faultViolationData.thread.label}.${this.faultViolationData.abstraction.label}.${this.faultViolationData.method}`
                    : '';
                this.auditLog.push({
                    gate: 'CALL_HOME',
                    desc: `Tunnel.Register(reason=${_bootReason}, fault_NIA=0x${_faultNIA.toString(16).toUpperCase()}) ACK=${_ack} [${_callHomeMode}]${_fvSuffix}`,
                    label: `Tunnel.Register ACK=${_ack}`,
                    nsIndex: null,
                    requiredPerm: null,
                    checks: {},
                    b: 0, f: 0,
                    result: 'pass',
                    stepCtx: 'CALL_HOME',
                });
                this.bootStep++;                  // advance state machine → B:05  (offline-safe: always advance)
                this.ledBits = 0b001111;          // LED bit 3 ON = CALL_HOME complete
                break;
            }

            // ════════════════════════════════════════════════════════════════════
            // B:05  INIT_ABSTR  (case 5)
            // Load Boot.Abstr (NS Slot 3) into CR6 with E-perm.
            // Slot 2 is a free/null entry — Task #247.
            // The E-type GT written here is snapshotted as oldCR6GT in B:06 and
            // saved to the sentinel call frame in the thread stack.
            // ════════════════════════════════════════════════════════════════════
            case 5: {
                const gt6 = this.createGT(0, this.bootEntrySlot, {R:0,W:0,X:0,L:0,S:0,E:1}, 1);  // E-perm GT for boot entry
                const check6 = this.mLoad(gt6, null, undefined);                                    // M-elevation mLoad; validates boot entry NS entry
                const _b3Label = (this.nsLabels && this.nsLabels[this.bootEntrySlot]) || `Slot ${this.bootEntrySlot}`;
                if (!check6.ok) {
                    this.fault('BOOT', `INIT_ABSTR mLoad(${_b3Label}) failed: ${check6.message}`);
                    return false;
                }
                const _b3ActualNSType     = check6.entry.gtType;
                const _GT_TYPE_NAMES_B3   = ['NULL', 'Inform', 'Outform', 'Abstract'];
                const _b3ActualNSTypeName = _GT_TYPE_NAMES_B3[_b3ActualNSType & 3] || 'Unknown';
                const _b3NSTypePass       = _b3ActualNSType === 1;
                this._auditNSType(this.bootEntrySlot, _b3Label, _b3ActualNSType, _b3ActualNSTypeName, 'INIT_ABSTR');
                if (!_b3NSTypePass) {
                    this.fault('TYPE', `INIT_ABSTR: ${_b3Label} type is ${_b3ActualNSTypeName}, must be Inform`);
                    return false;
                }
                this._writeCR(6, gt6, check6.entry);                                               // CR6 ← E-type token for boot entry (saved to sentinel frame in B:06)
                this.output += `[BOOT] INIT_ABSTR — CR6 <- mLoad(Slot ${this.bootEntrySlot}, ${_b3Label}) (E, M-elevation)\n`;

                // Auto-install boot-entry E-GT into Zone ① CR0 (thread offset +244) if empty.
                // Bridges the gap between IDE convention (double-click to install) and the boot
                // sequence: a user who boots without manually installing CR0 will no longer see
                // CR0 as NULL during simulation.
                const _b5ThreadEntry = this.readNSEntry(1);
                if (_b5ThreadEntry && _b5ThreadEntry.word0_location) {
                    const _b5CR0Addr = (_b5ThreadEntry.word0_location >>> 0) + THREAD_CAPS_OFFSET;
                    if ((this.memory[_b5CR0Addr] >>> 0) === 0) {
                        this.memory[_b5CR0Addr] = this.createGT(0, this.bootEntrySlot, {E:1}, 1);
                        this.output += `[BOOT] INIT_ABSTR — CR0 home (offset +${THREAD_CAPS_OFFSET}) <- boot-entry E-GT auto-installed (Slot ${this.bootEntrySlot})\n`;
                    }
                }

                this.bootStep++;                  // advance state machine → B:06
                this.ledBits = 0b011111;          // LED bit 4 ON = INIT_ABSTR complete
                break;
            }

            // ════════════════════════════════════════════════════════════════════
            // B:06  NUC_CLIST  (case 6)
            // First half of nucleus load: validate Boot.Abstr NS entry, read the
            // lump header, push the sentinel CALL frame, and derive CR6 (c-list, E)
            // from the lump header.  Stashes base/layout data for NUC_CODE (B:07).
            //
            //   1. E-perm mLoad on Boot.Abstr (BOOT_ABSTR_NS_SLOT=3): validates
            //      the NS entry and checks F-bit and GT type.
            //   2. Read Boot.Abstr lump header (word 0) to extract cc and lumpSize.
            //   3. Push a sentinel CALL frame into thread lump memory so that any
            //      eventual RETURN from the root abstraction reboots the machine.
            //   4. Derive CR6 (c-list, E) from the lump header.
            //   5. Stash layout data for B:07 NUC_CODE.
            // ════════════════════════════════════════════════════════════════════
            case 6: {
                // ── Step 1: Direct E-perm mLoad of boot entry abstraction ────────────
                const _b4Label    = (this.nsLabels && this.nsLabels[this.bootEntrySlot]) || `Slot ${this.bootEntrySlot}`;
                const bootEntryGT = this.createGT(0, this.bootEntrySlot, {R:0,W:0,X:0,L:0,S:0,E:1}, 1); // E-GT for boot entry
                const entryCheck  = this.mLoad(bootEntryGT, 'E', undefined);                              // E-perm mLoad: validates NS entry
                if (!entryCheck.ok) {
                    this.fault('BOOT', `NUC_CLIST mLoad(${_b4Label}) failed: ${entryCheck.message}`);
                    return false;
                }
                const _actualNSType     = entryCheck.entry.gtType;
                const _GT_TYPE_NAMES    = ['NULL', 'Inform', 'Outform', 'Abstract'];
                const _actualNSTypeName = _GT_TYPE_NAMES[_actualNSType & 3] || 'Unknown';
                const _nsTypePass = _actualNSType === 1;
                this._auditNSType(this.bootEntrySlot, _b4Label, _actualNSType, _actualNSTypeName, 'NUC_CLIST');
                if (!_nsTypePass) {                                                                         // must be Inform (type=1)
                    this.fault('TYPE', `NUC_CLIST: ${_b4Label} type is ${_actualNSTypeName}, must be Inform`);
                    return false;
                }
                const entryNSEntry  = entryCheck.entry;                             // NS entry for boot entry abstraction
                const entryNSParsed = this.parseNSWord1(entryNSEntry.word1_limit);
                if (entryNSParsed.f === 1) {                                        // Far-lumps not supported at boot
                    this.fault('F_BIT', `NUC_CLIST: ${_b4Label} has F-bit set (Far) — not supported at boot`);
                    return false;
                }
                const bootEntrySlot = this.bootEntrySlot;

                // ── Step 2: Read Boot.Abstr lump header (word 0) ──────────────────────
                const base     = entryNSEntry.word0_location;                       // physical base of Boot.Abstr lump
                let hdrWord  = this.memory[base] >>> 0;                             // raw 32-bit lump header word
                let hdr      = this.parseLumpHeader(hdrWord);                       // decode {magic, cc, cw, lumpSize, valid}

                // ── Audit: record lump-header check in Gate Log ────────────────────────
                this._auditLumpHeader(this.bootEntrySlot, _b4Label, hdr);

                if (!hdr.valid) {
                    // Lump may be warm (zeroed by initLazyManifest). Try lazy-restore
                    // before faulting — warm slots have their code evicted at init but
                    // their bootUpload data is still in the manifest.
                    if (this.lazyLoad(bootEntrySlot)) {
                        hdrWord = this.memory[base] >>> 0;
                        hdr     = this.parseLumpHeader(hdrWord);
                        this._auditLumpHeader(bootEntrySlot, _b4Label, hdr);
                    }
                    if (!hdr.valid) {
                        this.fault('LUMP_MAGIC', `NUC_CLIST: ${_b4Label} lump header magic=0x${hdr.magic.toString(16)} (expected 0x1F) — lump not installed or memory zeroed`);
                        return false;
                    }
                }
                const cw         = hdr.cw;                                          // code-word count
                const cc         = hdr.cc;                                          // c-list word count
                const lumpSz     = hdr.lumpSize;                                    // total lump size in 32-bit words
                const clistStart = lumpSz - cc;                                     // c-list begins at physical end of lump

                // ── Step 3: Push sentinel CALL frame ──────────────────────────────────
                // Sentinel saves oldCR6GT (E-GT for Boot.Abstr written by B:05 INIT_ABSTR)
                // as the "saved caller CR6". returnPC=0x7FFF is a poison value; RETURN
                // detects it and raises STACK_UNDERFLOW instead of jumping to garbage.
                const sp_max = THREAD_CAPS_OFFSET - 1;                              // thread stack ceiling: THREAD_CAPS_OFFSET(244) - 1 = 243
                const oldCR6GT = this.cr[6].word0 >>> 0;                            // snapshot E-GT for Boot.Abstr written by B:05 INIT_ABSTR
                const sentinelFrameWord = this._packFrameWordRaw(0x7FFF, 1, sp_max);
                this.callStack.push({
                    sentinel: true,
                    returnPC: 0x7FFF,
                    savedCRs: this.cr.map(c => ({...c})),
                    savedDRs: [...this.dr],
                    savedFlags: {...this.flags},
                    savedSTO: sp_max,
                    sz: 1,
                    frameWord: sentinelFrameWord,
                });
                const threadBase = this.cr[12] && this.cr[12].word1;
                if (threadBase) {
                    this.memory[threadBase + sp_max]     = sentinelFrameWord;
                    this.memory[threadBase + sp_max - 1] = oldCR6GT;
                }
                this.sto = sp_max - 2;

                // ── Step 4: cc=0 (CLOOMC design) vs cc>0 (legacy) ─────────────────────
                // cc=0: CHANGE→TPERM→CALL path — no c-list.  thread[+244] holds the entry
                //       E-GT written by the boot image or setBootEntrySlot(); CALL CR0 dispatches.
                // cc>0: derive CR6 (c-list, E) from lump header (legacy saved-lump path).
                if (cc === 0) {
                    // CLOOMC design (Task #651): no c-list in Boot.Abstr.
                    // thread[+244] holds the boot entry E-GT (set by boot image or setBootEntrySlot()).
                    // The 3-instruction program (CHANGE→TPERM→CALL) reads it from caps zone at runtime.
                    // CR6 was written by B:05 INIT_ABSTR with the Boot.Abstr E-GT; that GT is already
                    // snapshotted into the sentinel frame above (thread[+242]).  Since cc=0 means there
                    // is no c-list at all, CR6 must be cleared to NULL so the machine state is consistent.
                    this.cr[6] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
                    this.output += `[BOOT] NUC_CLIST — cc=0 (no c-list, CHANGE→TPERM→CALL path); CR6←NULL; sentinel pushed (frame@+${sp_max}, STO=${this.sto})\n`;
                    this.output += `[BOOT] SENTINEL CALL — frame@+${sp_max}=0x${sentinelFrameWord.toString(16).toUpperCase().padStart(8,'0')} (NIA=0x7FFF,sz=1,prev_STO=${sp_max}), E-GT@+${sp_max-1}=0x${oldCR6GT.toString(16).toUpperCase().padStart(8,'0')}, STO=${this.sto}\n`;
                    this.auditLog.push({
                        gate: 'SENTINEL',
                        desc: `Boot.Abstr cc=0 (no c-list) — sentinel pushed @ +${sp_max}; thread[+${THREAD_CAPS_OFFSET}] holds boot entry E-GT`,
                        label: _b4Label + ' (no c-list)',
                        nsIndex: bootEntrySlot,
                        requiredPerm: null,
                        checks: { install: { pass: true } },
                        b: 0, f: 0,
                        result: 'pass',
                        stepCtx: 'NUC_CLIST sentinel-only',
                    });
                } else {
                    const cr6GT = this.createGT(0, bootEntrySlot, {R:0,W:0,X:0,L:0,S:0,E:1}, 1);   // E-perm c-list token
                    this.cr[6] = {
                        word0: cr6GT,
                        word1: (base + clistStart) >>> 0,
                        word2: entryNSEntry.word1_limit >>> 0,
                        word3: entryNSEntry.word2_seals,
                        m: this.mElevation ? 1 : 0
                    };
                    this.output += `[BOOT] NUC_CLIST — CR6(E) <- c-list of ${_b4Label} (base=0x${(base+clistStart).toString(16).toUpperCase()}, cc=${cc}); sentinel pushed (frame@+${sp_max}, STO=${this.sto})\n`;
                    this.output += `[BOOT] SENTINEL CALL — frame@+${sp_max}=0x${sentinelFrameWord.toString(16).toUpperCase().padStart(8,'0')} (NIA=0x7FFF,sz=1,prev_STO=${sp_max}), E-GT@+${sp_max-1}=0x${oldCR6GT.toString(16).toUpperCase().padStart(8,'0')}, STO=${this.sto}\n`;
                    this.auditLog.push({
                        gate: 'CR_WR',
                        desc: `CR6(E) ← ${_b4Label} c-list  · base=0x${(base+clistStart).toString(16).toUpperCase()}, cc=${cc}, sentinel pushed`,
                        label: _b4Label + ' c-list',
                        nsIndex: bootEntrySlot,
                        requiredPerm: 'E',
                        checks: { install: { pass: true } },
                        b: 0, f: 0,
                        result: 'pass',
                        stepCtx: 'NUC_CLIST CR6',
                    });
                }

                // ── Step 5: Stash layout data for B:07 NUC_CODE ───────────────────────
                this._nucLumpData = { base, hdrWord, cw, cc, lumpSz, clistStart, bootEntrySlot, label: _b4Label, entryNSEntry };

                this.bootStep++;                  // advance state machine → B:07 (NUC_CODE)
                this.ledBits = 0b011111;          // 5 LEDs on = NUC_CLIST complete
                break;
            }

            // ════════════════════════════════════════════════════════════════════
            // B:07  NUC_CODE  (case 7)
            // Second half of nucleus load: derive CR14 (code, R+X) from the lump
            // layout stashed by B:06 NUC_CLIST, then set PC = 0.
            // ════════════════════════════════════════════════════════════════════
            case 7: {
                const nd = this._nucLumpData;
                if (!nd) {
                    this.fault('BOOT', 'NUC_CODE: _nucLumpData is null (NUC_CLIST did not run)');
                    return false;
                }
                const { base, hdrWord, cw, cc, lumpSz, clistStart, bootEntrySlot, label: _b4Label, entryNSEntry } = nd;

                // ── Derive CR14 (code, R+X) from lump header ──────────────────────────
                const cr14GT = this.createGT(0, bootEntrySlot, {R:1,W:0,X:1,L:0,S:0,E:0}, 1);  // R+X code token
                this.cr[14] = {
                    word0: cr14GT,
                    word1: base,                    // physical base of Boot.Abstr lump
                    word2: entryNSEntry.word1_limit >>> 0,
                    word3: entryNSEntry.word2_seals,
                    m: this.mElevation ? 1 : 0
                };

                // ── Set PC = 0 ────────────────────────────────────────────────────────
                this.pc = 0;
                this._nucLumpData = null;                                            // clear stash

                this.output += `[BOOT] NUC_CODE — CR14(R+X) <- ${_b4Label} code lump (base=0x${base.toString(16).toUpperCase()}, cw=${cw}); PC=0\n`;
                this.auditLog.push({
                    gate: 'CR_WR',
                    desc: `CR14(R+X) ← ${_b4Label} code lump  · base=0x${base.toString(16).toUpperCase()}, cw=${cw}, PC←0`,
                    label: _b4Label + ' code',
                    nsIndex: bootEntrySlot,
                    requiredPerm: 'R+X',
                    checks: { install: { pass: true } },
                    b: 0, f: 0,
                    result: 'pass',
                    stepCtx: 'NUC_CODE CR14',
                });

                // B:07 is the final boot step. The hardware ISA owns M-state per CR register —
                // CALL through a non-M E-GT (BOOT_ROM_WORDS[2]: CALL AL, CR0, CR0) drops M
                // automatically on dispatch. No Startup.Config intermediary is needed.
                this.mElevation = false;            // drop M-elevation: normal capability checks now apply
                this._resetAllMBits();              // clear M-bits set on CRs during boot init;
                                                    // prevents stale m=1 from triggering writeback gate
                                                    // on the first CALL after boot completes.

                // ── Navana.Init (NS slot 5) ────────────────────────────────────────
                // Called exactly once at boot completion, after M-elevation is off and
                // all boot NS entries are in place.  Navana performs Stage-1 memory
                // allocation (SlideRule/Constants code regions, scheduler/stack/flag
                // buffers), discovers devices, mints LED PassKey, and wires Keystone.
                // A failure here is logged as a warning — the boot does not abort.
                if (this.abstractionRegistry) {
                    const navaInit = this.abstractionRegistry.dispatchMethod(5, 'Init', this, {});
                    const navaOk   = !!(navaInit && navaInit.ok);
                    this.output += navaOk
                        ? `[BOOT] Navana.Init — complete (${navaInit.message || 'OK'})\n`
                        : `[BOOT] Navana.Init — warning: ${(navaInit && navaInit.error) || 'no abstractionRegistry response'}\n`;
                    this.auditLog.push({
                        gate: 'Navana.Init',
                        desc: navaOk
                            ? `Navana.Init complete — ${navaInit.message || 'OK'}`
                            : `Navana.Init warning — ${(navaInit && navaInit.error) || 'no response'}`,
                        label: 'Navana',
                        nsIndex: 5,
                        requiredPerm: null,
                        checks: { init: { pass: navaOk } },
                        b: 0, f: 0,
                        result: navaOk ? 'pass' : 'warn',
                        stepCtx: 'NAVANA_INIT',
                    });
                }

                this.bootComplete = true;           // signal the step-loop to start dispatching instructions
                this.ledBits = 0b111111;            // all 6 LEDs on = boot complete
                this.ledMode = 'boot';              // LED display stays in boot-progress mode until first user toggle
                this.output += '[BOOT] COMPLETE — M-Elevation OFF. CALL CR0 will enter boot entry (Thread.CR[0]). Boot complete.\n';
                this.auditLog.push({
                    gate: 'CMPL',
                    desc: 'bootComplete ← true  ·  M-elevation OFF  ·  CALL CR0 dispatches to boot entry',
                    label: 'Boot complete',
                    nsIndex: null,
                    requiredPerm: null,
                    checks: {},
                    b: 0, f: 0,
                    result: 'pass',
                    stepCtx: 'COMPLETE',
                });
                break;
            }
        }
        this.emit('stateChange', this.getState());  // notify UI that machine state has changed (triggers register/memory panel refresh)
        return true;                                 // return true = a boot step was executed; false = already complete or faulted
    }

    parseGT(gt32) {
        // v2.0 GT layout: [31]=b_flag [30:28]=perm[2:0] [27]=dom
        //               ★[26:25]=gt_type  ★[24:16]=gt_seq(9b)  [15:0]=slot_id
        // f_flag is now in the NS SLOT authority word (Word 1 bit[31]), not the GT word.
        gt32 = gt32 >>> 0;
        const b_flag = (gt32 >>> 31) & 1;
        const perm3  = (gt32 >>> 28) & 0x7;
        const dom    = (gt32 >>> 27) & 0x1;
        const type   = (gt32 >>> 25) & 0x3;   // ★ was [24:23]
        const gt_seq = (gt32 >>> 16) & 0x1FF; // ★ 9 bits, was 7 bits at [22:16]
        const index  =  gt32         & 0xFFFF;
        // Decode permissions from dom+perm3 (mutual exclusion enforced by dom bit).
        const permissions = dom === 0
            ? { B: b_flag, R: (perm3>>>0)&1, W: (perm3>>>1)&1, X: (perm3>>>2)&1,
                           L: 0, S: 0, E: 0 }
            : { B: b_flag, R: 0, W: 0, X: 0,
                           L: (perm3>>>0)&1, S: (perm3>>>1)&1, E: (perm3>>>2)&1 };
        // Domain purity is now structurally guaranteed by the dom bit (0=Turing, 1=Church).
        // Only check single-Church-perm rule (CLOOMC security model).
        let malformed = false;
        let malformedReason = null;
        if (type !== 3) {
            const single = ChurchSimulator.isSinglePerm(permissions);
            if (!single.ok) {
                malformed = true;
                malformedReason = `multi-Church permissions (${single.bits})`;
            }
        }
        return {
            gt_seq, index,
            permissions,
            type,
            typeName: ['NULL','Inform','Outform','Abstract'][type & 3],
            malformed,
            malformedReason,
        };
    }

    // Domain-purity guard: a GT may not mix Turing {R,W,X} with Church {L,S,E}.
    static isDomainPure(perms) {
        const hasTuring = perms.R || perms.W || perms.X;
        const hasChurch  = perms.L || perms.S || perms.E;
        if (hasTuring && hasChurch) {
            const bits = (perms.B?'B':'')+(perms.R?'R':'')+(perms.W?'W':'')+(perms.X?'X':'')+(perms.L?'L':'')+(perms.S?'S':'')+(perms.E?'E':'');
            return { ok: false, bits };
        }
        return { ok: true };
    }

    // Single-Church-perm guard: a Church GT must carry exactly one permission bit
    // (enforcing "C-Lists only have E permission" from the security model).
    // Pure Turing GTs ({R,W,X} only) may carry multiple bits and are not checked here.
    static isSinglePerm(perms) {
        const hasChurch = perms.L || perms.S || perms.E;
        if (!hasChurch) return { ok: true };
        const churchCount = (perms.L ? 1 : 0) + (perms.S ? 1 : 0) + (perms.E ? 1 : 0);
        if (churchCount > 1) {
            const bits = (perms.L?'L':'')+(perms.S?'S':'')+(perms.E?'E':'');
            return { ok: false, bits };
        }
        return { ok: true };
    }

    createGT(gt_seq, slotId, perms, type) {
        const purity = ChurchSimulator.isDomainPure(perms);
        if (!purity.ok) {
            throw new Error(`createGT: domain-impure permissions (${purity.bits}) — slot ${slotId} mixes Turing {R,W,X} with Church {L,S,E}`);
        }
        const single = ChurchSimulator.isSinglePerm(perms);
        if (!single.ok) {
            throw new Error(`createGT: single-Church-perm violation (${single.bits}) — slot ${slotId} must carry exactly one Church permission`);
        }
        // v2.0 GT layout: [31]=b_flag [30:28]=perm[2:0] [27]=dom
        //               ★[26:25]=gt_type  ★[24:16]=gt_seq(9b)  [15:0]=slot_id
        // f_flag is in NS SLOT Word 1 bit[31], not in the GT word.
        const hasChurch = perms.L || perms.S || perms.E;
        const dom   = hasChurch ? 1 : 0;
        const perm3 = dom === 0
            ? (((perms.X ? 1 : 0) << 2) | ((perms.W ? 1 : 0) << 1) | (perms.R ? 1 : 0))
            : (((perms.E ? 1 : 0) << 2) | ((perms.S ? 1 : 0) << 1) | (perms.L ? 1 : 0));
        const b = (perms.B ? 1 : 0);
        const p = ((b << 31) | (perm3 << 28) | (dom << 27)) >>> 0;
        const t = ((type   & 0x3)  << 25) >>> 0; // ★ was << 23
        const s = ((gt_seq & 0x1FF) << 16) >>> 0; // ★ 9 bits, was 0x7F << 16
        const i = (slotId  & 0xFFFF)      >>> 0;
        return (p | t | s | i) >>> 0;
    }

    // Abstract GT helpers (Task #406) ─────────────────────────────────────────
    // v2.0 layout: [31:27]=ab_type  ★[26:25]=gt_type=0b11  [24]=R  [23]=W  [22:16]=gt_seq  [15:0]=ab_data
    // ab_data for ab_type=0x00 I/O: [15:8]=device_class  [7:0]=device_data
    static AB_TYPE_IO          = 0x00;   // I/O device (LED, UART, Button, Timer, Display)
    static AB_TYPE_M_ELEVATION = 0x01;   // M Abstraction — sets CRn(M=1)

    static DEVICE_CLASS_LED       = 0x01;
    static DEVICE_CLASS_UART      = 0x02;
    static DEVICE_CLASS_BUTTON    = 0x03;
    static DEVICE_CLASS_TIMER     = 0x04;
    static DEVICE_CLASS_DISPLAY   = 0x05;
    static DEVICE_CLASS_CHURCHHW  = 0x06;   // Church HW control (PetNameMemory write port)

    createAbstractGT(ab_type, perms, gt_seq, ab_data) {
        // Only R and W are valid perm bits for Abstract GTs (X/L/S/E/B are repurposed as ab_type).
        // Layout: bit[26]=R, bit[25]=W  (R is the higher bit per spec)
        const illegal = ['X','L','S','E','B'].filter(k => perms[k]);
        if (illegal.length) {
            throw new Error(
                `createAbstractGT: ${illegal.join(',')} are not valid perm bits for Abstract GTs ` +
                `— they are repurposed as ab_type.  Use only R and W.`
            );
        }
        const rBit = perms.R ? 1 : 0;
        const wBit = perms.W ? 1 : 0;
        return (
            ((ab_type & 0x1F) << 27) |
            (0b11             << 25) |   // ★ gt_type=Abstract at [26:25], was [24:23]
            (rBit             << 24) |   // ★ R at bit[24], was [26]
            (wBit             << 23) |   // ★ W at bit[23], was [25]
            ((gt_seq & 0x7F)  << 16) |
            (ab_data & 0xFFFF)
        ) >>> 0;
    }

    parseAbstractGT(gt32) {
        gt32 = gt32 >>> 0;
        const ab_type      = (gt32 >>> 27) & 0x1F;
        const type         = (gt32 >>> 25) & 0x3;   // ★ always 0b11 for Abstract; was [24:23]
        const R            = (gt32 >>> 24) & 1;      // ★ was [26]
        const W            = (gt32 >>> 23) & 1;      // ★ was [25]
        const gt_seq       = (gt32 >>> 16) & 0x7F;
        const ab_data      = gt32 & 0xFFFF;
        const device_class = (ab_data >>> 8) & 0xFF;
        const device_data  = ab_data & 0xFF;
        return { ab_type, R, W, type, gt_seq, ab_data, device_class, device_data };
    }
    // ──────────────────────────────────────────────────────────────────────────

    getPermBits(permsObj) {
        // Returns the 4-bit dom+perm encoding packed as (perm3 << 1) | dom.
        // Turing (dom=0): perm[2]=X, perm[1]=W, perm[0]=R.
        // Church  (dom=1): perm[2]=E, perm[1]=S, perm[0]=L.
        const hasChurch = permsObj.L || permsObj.S || permsObj.E;
        const dom   = hasChurch ? 1 : 0;
        const perm3 = dom === 0
            ? (((permsObj.X ? 1 : 0) << 2) | ((permsObj.W ? 1 : 0) << 1) | (permsObj.R ? 1 : 0))
            : (((permsObj.E ? 1 : 0) << 2) | ((permsObj.S ? 1 : 0) << 1) | (permsObj.L ? 1 : 0));
        return (perm3 << 1) | dom;   // 4-bit: [3:1]=perm3, [0]=dom
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
        // mTCB domain-purity chokepoint for LOAD and SAVE.
        //
        // Hardware rule (ctmm_cap_amaranth/perm_check.py, church_machine/perm_check.py):
        //   DATA_PERMS = R | W | X   (Turing domain)
        //   CAP_PERMS  = L | S | E   (Church domain)
        //   domain_purity_ok = ~(has_turing & has_church)
        //
        // Any of the 9 cross-pairs {R,W,X}×{L,S,E} is a violation.
        // Pure-Turing GTs (e.g. LED {R,W}) and pure-Church GTs (e.g. {E}) pass.
        //
        // This check lives here — not only in TPERM — because malware can acquire
        // GTs via LOAD (zero required permissions) without ever executing TPERM.
        // mLoad/mSave is the last line of defence against a mixed GT reaching a CR.
        const p = parsed.permissions;
        const hasTuring = p.R || p.W || p.X;
        const hasChurch = p.L || p.S || p.E;
        if (hasTuring && hasChurch) {
            const permStr = (p.B?'B':'')+(p.R?'R':'')+(p.W?'W':'')+(p.X?'X':'')+(p.L?'L':'')+(p.S?'S':'')+(p.E?'E':'');
            return { ok: false, fault: 'DOMAIN_PURITY', message: `C-List slot ${slotIdx} mixes Turing {R,W,X} with Church {L,S,E} permissions (${permStr})` };
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
            stepCtx: this._currentInstrLabel || null,
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
            stepCtx: this._currentInstrLabel || null,
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
            return { ok: false, fault: 'F_BIT', message: `target slot ${targetIdx} is FAR (F=1) — requires HTTP/tunnel access` };
        }
        if (!rangePass) {
            const rBase = rangeInfo.base;
            const rLimit = rangeInfo.limit;
            return { ok: false, fault: 'RANGE', message: `address ${absoluteAddress} outside valid range [${rBase}..${rLimit}]` };
        }
        return { ok: true, parsed, srcEntry };
    }

    markLive(idx) {
        // Matches hardware mload.py RESET_GBIT: clears G-bit (Word1[28]) on successful load.
        // G-bit at bit[28] — excluded from CRC-16 seal (seal covers location+limit17 only),
        // so this write requires no seal recomputation. Real-time update matches hardware.
        const base = this.NS_TABLE_BASE + idx * this.NS_ENTRY_WORDS;
        const w1 = this.memory[base + 1];
        if (this.gcPolarity === 0) {
            this.memory[base + 1] = (w1 | (1 << 28)) >>> 0;
        } else {
            this.memory[base + 1] = (w1 & ~(1 << 28)) >>> 0;
        }
    }

    markGarbage(idx) {
        // Matches hardware GC mark phase: sets G-bit (Word1[28]) to suspect.
        const base = this.NS_TABLE_BASE + idx * this.NS_ENTRY_WORDS;
        const w1 = this.memory[base + 1];
        if (this.gcPolarity === 0) {
            this.memory[base + 1] = (w1 & ~(1 << 28)) >>> 0;
        } else {
            this.memory[base + 1] = (w1 | (1 << 28)) >>> 0;
        }
    }

    getGBit(idx) {
        const base = this.NS_TABLE_BASE + idx * this.NS_ENTRY_WORDS;
        return (this.memory[base + 1] >>> 28) & 1;
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


    // ── Absent-lump helpers (shared by LOAD, ELOADCALL, XLOADLAMBDA) ───────────
    // _outformToken96: build the 96-bit IDE token from the three NS words of an
    // Outform entry (word0_location || word1_limit || word2_seals), returned as
    // 24 lowercase hex chars.  Matches the CTMM IDE token width (3 × 32 bits).
    _outformToken96(entry) {
        const w0 = (entry.word0_location >>> 0).toString(16).padStart(8, '0');
        const w1 = (entry.word1_limit    >>> 0).toString(16).padStart(8, '0');
        const w2 = (entry.word2_seals    >>> 0).toString(16).padStart(8, '0');
        return `${w0}${w1}${w2}`;   // 24-char hex = 96 bits
    }

    _absentLumpIntercept(entry, targetIdx, d, instrName) {
        if (!entry || entry.gtType !== 2) return null;
        // Use full 96-bit IDE token (3 × 32-bit NS words) for the fetch URL.
        const token = this._outformToken96(entry);
        const label = this.nsLabels[targetIdx] || 'entry_' + targetIdx;
        this.awaitingLump = { nsIndex: targetIdx, retryPC: this.pc, d, token };
        this.output += `\u27F3 Fetching lump: Slot ${targetIdx} (${label}) [${instrName}] — token=0x${token}\n`;
        return { absent: true, nsIndex: targetIdx, token, label };
    }
    // ─────────────────────────────────────────────────────────────────────────

    _writeDR(drIdx, value) {
        this.dr[drIdx] = value >>> 0;
        if (drIdx < 16) {
            const cr12 = this.cr[12];
            const threadBase = cr12 && cr12.word1;
            if (threadBase) {
                const homeAddr = (threadBase + 1 + drIdx) >>> 0;
                if (homeAddr < this.memory.length) {
                    this.memory[homeAddr] = value >>> 0;
                }
            }
        }
    }

    _writeCR(crIdx, gt32, entry) {
        this.cr[crIdx].word0 = gt32;
        this.cr[crIdx].word1 = entry.word0_location >>> 0;
        this.cr[crIdx].word2 = entry.word1_limit >>> 0;
        this.cr[crIdx].word3 = this.mElevation ? ((entry.word3_abstract_gt || 0) >>> 0) : 0;
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
        if (crIdx <= 11 && crIdx !== 6) {
            const threadBase = this.cr[12] && this.cr[12].word1;
            if (threadBase) {
                this._threadWrite(threadBase + THREAD_CAPS_OFFSET + crIdx, 0, `_clearCR(${crIdx})`);
            }
        }
    }

    // ── M-Window helpers (Task #406) ─────────────────────────────────────────
    // The M Abstraction uses CR15 as an inspection/modification window.
    // When M=1 is set on CRn, the 5 words of CRn are copied to DR11–DR15
    // so the Abstract Manager can decode them as data.  Clearing M writes
    // DR11–DR15 back (completing the round-trip) and resets CRn.m = 0.
    // Only CR15 can hold M=1 (hardware enforces via single 4-input AND gate).

    _integrity32(w0, w1) {
        // ROL(w0, 7) XOR ROL(w1 & ~(1<<28), 13) XOR 0xDEADBEEF
        // Matches hardware/integrity32.py: G-bit (bit 28) is masked from w1.
        const rol32 = (x, n) => (((x << n) | (x >>> (32 - n))) >>> 0);
        const w1m = (w1 & 0xEFFFFFFF) >>> 0;
        return (rol32(w0 >>> 0, 7) ^ rol32(w1m, 13) ^ 0xDEADBEEF) >>> 0;
    }

    _setMWindow(crIdx) {
        const cr = this.cr[crIdx];
        cr.m = 1;
        this.dr[11] = cr.word0 >>> 0;
        this.dr[12] = cr.word1 >>> 0;
        this.dr[13] = cr.word2 >>> 0;
        this.dr[14] = this._integrity32(cr.word1, cr.word2);
        this.dr[15] = cr.word3 >>> 0;
    }

    _mwinWriteback() {
        // Validated M-window writeback gate.  Must fire at every normal CALL and
        // RETURN boundary when CR15.m === 1.  Returns true if the operation may
        // proceed; false if it was aborted (INVALID_OP faulted).
        this._mwinWbFired = false;
        if (!this.cr[15] || this.cr[15].m !== 1) return true;
        this._mwinWbFired = true;
        const dr11 = this.dr[11] >>> 0;
        const dr12 = this.dr[12] >>> 0;
        const dr13 = this.dr[13] >>> 0;
        const dr14 = this.dr[14] >>> 0;
        // Gate 1: DR11 must be non-NULL (v2.0: gt_type at bits[26:25] != 0b00).
        const dr11Type = (dr11 >>> 25) & 0x3;   // ★ v2.0: gt_type moved from [24:23] to [26:25]
        // Gate 2: integrity32(DR12, DR13) must equal DR14.
        const computed = this._integrity32(dr12, dr13);
        // Gate 3: gt_seq from DR11[24:16] (v2.0: 9-bit) must match DR13[27:21] (NS seal format).
        const seqDR11 = (dr11 >>> 16) & 0x1FF;  // ★ v2.0: 9 bits, was 7 bits at [22:16]
        const seqDR13 = (dr13 >>> 21) & 0x7F;   // NS seal word: stays as simulator abstraction
        const pass = (dr11Type !== 0) && (computed === dr14) && (seqDR11 === seqDR13);
        this.cr[15].m = 0;
        if (pass) {
            this.cr[15].word0 = dr11;
            this.cr[15].word1 = dr12;
            this.cr[15].word2 = dr13;
            return true;
        }
        const why = dr11Type === 0 ? 'NULL DR11' :
                    computed !== dr14 ? `integrity mismatch (got 0x${computed.toString(16).toUpperCase()} expected 0x${dr14.toString(16).toUpperCase()})` :
                    `gt_seq mismatch (DR11[24:16]=${seqDR11} != DR13[27:21]=${seqDR13})`;
        this.fault('INVALID_OP', `M-window writeback failed: ${why}`);
        return false;
    }

    _clearMWindow(crIdx) {
        this.cr[crIdx].m = 0;
    }

    _resetAllMBits() {
        // CALL and RETURN boundaries reset CRn(M) on every CR.
        for (let i = 0; i < 16; i++) this.cr[i].m = 0;
    }
    // ─────────────────────────────────────────────────────────────────────────

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
        // v2.0 ISA: Church opcodes 0–9; Turing opcodes 16–25; 10–15 and 26–29 unassigned.
        const names = {
            0:'LOAD', 1:'SAVE', 2:'CALL', 3:'RETURN', 4:'CHANGE', 5:'SWITCH',
            6:'TPERM', 7:'LAMBDA', 8:'ELOADCALL', 9:'XLOADLAMBDA',
            16:'DREAD', 17:'DWRITE', 18:'BFEXT', 19:'BFINS', 20:'MCMP',
            21:'IADD', 22:'ISUB', 23:'BRANCH', 24:'SHL', 25:'SHR',
        };
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

    _capRead(crIdx, absAddr, perm, label) {
        const cr = this.cr[crIdx];
        if (!cr || cr.word0 === 0) {
            return { ok: false, fault: 'NULL_CAP', message: `${label}: CR${crIdx} is NULL` };
        }
        const check = this.mLoad(cr.word0, perm, crIdx, absAddr);
        if (!check.ok) {
            return { ok: false, fault: check.fault, message: `${label}: CR${crIdx} ${perm}-read @${absAddr}: ${check.message}` };
        }
        return { ok: true, value: this.memory[absAddr] >>> 0, check };
    }

    _threadRead(absAddr, label) {
        const cr12 = this.cr[12];
        if (!cr12 || cr12.word0 === 0) {
            this.fault('NULL_CAP', `${label}: CR12 (thread stack) is NULL`);
            return { ok: false };
        }
        const check = this.mLoad(cr12.word0, null, 12, absAddr);
        if (!check.ok) {
            this.fault(check.fault, `${label}: CR12 read @${absAddr}: ${check.message}`);
            return { ok: false };
        }
        return { ok: true, value: this.memory[absAddr] >>> 0 };
    }

    _threadWrite(absAddr, value, label) {
        const cr12 = this.cr[12];
        if (!cr12 || cr12.word0 === 0) {
            this.fault('NULL_CAP', `${label}: CR12 (thread stack) is NULL`);
            return false;
        }
        const check = this.mLoad(cr12.word0, null, 12, absAddr);
        if (!check.ok) {
            this.fault(check.fault, `${label}: CR12 write @${absAddr}: ${check.message}`);
            return false;
        }
        this.memory[absAddr] = value >>> 0;
        return true;
    }

    _flushLambdaCache() {
        if (!this.lambdaActive || !this.lambdaCachedFrame) return;
        const c = this.lambdaCachedFrame;
        if (c.threadBase) {
            this._threadWrite(c.threadBase + c.addr, c.word, 'LAMBDA_FLUSH');
        }
        this.lambdaActive = false;
        this.lambdaCachedFrame = null;
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

    fault(type, message, meta = null) {
        const lastH = this._instrHistory && this._instrHistory.length > 0
            ? this._instrHistory[this._instrHistory.length - 1] : null;
        const faultStep = (lastH && lastH.step === this.stepCount) ? this.stepCount : null;
        // Resolve the executing lump's label NOW, before any eviction can change nsLabels.
        const _cr14 = this.cr && this.cr[14];
        let faultLabel = null;
        let faultingAbstractionSlot = null;
        if (_cr14 && _cr14.word0) {
            faultingAbstractionSlot = _cr14.word0 & 0xFFFF;
            faultLabel = (this.nsLabels && this.nsLabels[faultingAbstractionSlot]) || `NS[${faultingAbstractionSlot}]`;
        }
        // Structured fields — Task #1077: shared between Fault Popup and .catch handler
        const faultCode = ChurchSimulator.FAULT_CODES.hasOwnProperty(type) ? ChurchSimulator.FAULT_CODES[type] : null;
        const faultingMnemonic = this._currentInstrLabel ? this._currentInstrLabel.opName : null;
        const entry = {
            type, message, pc: this.pc, physicalPC: this.physicalPC, step: this.stepCount,
            crSnapshot: this.cr ? this.cr.map(c => c ? {...c} : null) : [],
            drSnapshot: this.dr ? [...this.dr] : [],
            flagsSnapshot: this.flags ? {...this.flags} : {},
            instrHistory: this._instrHistory ? this._instrHistory.map(h => ({...h})) : [],
            faultStep: faultStep,
            faultLabel: faultLabel,
            // Structured fault record fields (Task #1077)
            faultCode: faultCode,
            faultingMnemonic: faultingMnemonic,
            involvedGT: (meta && meta.gt != null) ? meta.gt : null,
            pipelineStage: (meta && meta.pipelineStage) ? meta.pipelineStage : null,
            faultingAbstractionSlot: faultingAbstractionSlot,
            faultingAbstractionLabel: faultLabel,
            tier: null,
            catchInvoked: false,
            irqInvoked: false,
            tier3Recovery: false,
            ...(meta || {}),
        };

        // Helper: report fault to abstraction registry for MTBF tracking
        const _reportToRegistry = () => {
            if (!this.abstractionRegistry) return;
            const idxMatch = message.match(/(?:entry|index|slot|CR)\s*(\d+)/i);
            if (idxMatch) {
                const idx = parseInt(idxMatch[1]);
                if (idx < 64) this.abstractionRegistry.reportFault(idx);
            }
        };

        // ── Three-tier fault recovery (Task #1077) ────────────────────────────
        // Tier 3: double-fault — fault while Scheduler.IRQ frame is active
        if (this.irqState && this.irqState.irqActive) {
            entry.tier = 3;
            entry.tier3Recovery = true;
            this.faultLog.push(entry);
            this.output += `FAULT [${type}] (DOUBLE-FAULT \u2014 Tier 3) at PC=${this.pc}: ${message}\n`;
            _reportToRegistry();
            this._tier3Recovery(entry);
            this.emit('fault', entry);
            this.emit('output', this.output);
            return;
        }

        // Tier 1: .catch method on the faulting abstraction.
        // catchInvoked is set true whenever .catch is ATTEMPTED, regardless of outcome.
        // This matches the structured fault record schema: "whether .catch was called".
        if (faultingAbstractionSlot !== null && this.abstractionRegistry) {
            const catchResult = this._invokeCatch(faultingAbstractionSlot, entry);
            if (catchResult !== null) {
                entry.catchInvoked = true; // .catch was present and called
            }
            if (catchResult && catchResult.handled) {
                entry.tier = 1;
                this.faultLog.push(entry);
                this.output += `FAULT [${type}] at PC=${this.pc} caught by .catch on NS[${faultingAbstractionSlot}] (Tier 1) \u2014 recovered\n`;
                this.pc++;
                _reportToRegistry();
                this.emit('fault', entry);
                this.emit('output', this.output);
                return;
            }
        }

        // Tier 2: escalate to Scheduler.IRQ.
        // _fireSchedulerIRQ returns null when the IRQ frame was not entered (early guard),
        // true when dispatched + recovered, false when dispatched + not recovered.
        // irqInvoked reflects "was Scheduler.IRQ actually dispatched?" — null means no.
        this.output += `FAULT [${type}] at PC=${this.pc}: ${message}\n`;
        const irqResult = this._fireSchedulerIRQ('FAULT', entry);
        if (irqResult !== null) {
            entry.irqInvoked = true; // IRQ frame was entered (dispatch was attempted)
        }
        if (irqResult === true) {
            entry.tier = 2;
            this.faultLog.push(entry);
            this.output += `  \u2192 Scheduler.IRQ (Tier 2): fault escalated and handled\n`;
            _reportToRegistry();
            this.emit('fault', entry);
            this.emit('output', this.output);
            return;
        }

        // All tiers exhausted — halt (preserves pre-Task-#1077 behaviour)
        this.faultLog.push(entry);
        this.halted = true;
        this.running = false;
        _reportToRegistry();
        this.emit('fault', entry);
        this.emit('output', this.output);
    }

    // ── Three-tier fault recovery helpers (Task #1077) ────────────────────────

    // Tier 1: invoke the .catch method on the given NS slot, if bound.
    // Return contract (distinguishes "not found" from "called"):
    //   null                    — no .catch method on this slot (not dispatched)
    //   { invoked:true, handled:true }  — dispatched; handler accepted the fault
    //   { invoked:true, handled:false } — dispatched; handler declined or threw
    // catchInvoked in the fault record is set true for any non-null return.
    _invokeCatch(nsSlot, faultRecord) {
        if (!this.abstractionRegistry) return null;
        const a = this.abstractionRegistry.abstractions[nsSlot];
        if (!a) return null;
        const catchFn = a.dispatch['.CATCH'] || a.dispatch['CATCH'];
        if (!catchFn) return null;
        // .catch exists — dispatch it; catch throws so escalation continues
        try {
            const result = catchFn(this, { faultRecord });
            const handled = !!(result && result.handled);
            return { invoked: true, handled };
        } catch(e) {
            this.output += `  .catch handler on NS[${nsSlot}] threw: ${e.message} (catchInvoked=true, escalating)\n`;
            return { invoked: true, handled: false };
        }
    }

    // Tier 2: fire the Scheduler.IRQ method (hidden ELOADCALL semantics).
    // Returns true if the IRQ handler accepted and handled the event.
    // Called both from fault() (reason='FAULT') and from step() timer check (reason='TIMER').
    // For TIMER: also clears irqState.timerArmed (idempotent when step() already cleared it).
    // Returns:
    //   null  — IRQ frame was NOT entered (early guard: no registry, or already in IRQ frame)
    //   true  — IRQ frame was entered and handler returned ok=true (recovered / swept)
    //   false — IRQ frame was entered but handler returned ok=false (not recovered)
    _fireSchedulerIRQ(reason, faultRecord, slot) {
        if (!this.abstractionRegistry) return null;
        if (!this.irqState || this.irqState.irqActive) return null;

        // Resolve pet names to slot indices at call time (nsLabels is live here).
        const _schedulerSlot   = this._slotByPetName('Scheduler', 8);
        const _irqThreadSlot   = this._slotByPetName('Scheduler.IRQ.Thread', 50);

        // Clear the alarm flag immediately on TIMER fire so timerArmed is false
        // whether this is called from step() (which pre-clears it) or directly.
        if (reason === 'TIMER' && this.irqState.timerArmed) {
            this.irqState.timerArmed = false;
        }

        // ── Authority check (Task #1530) ──────────────────────────────────────
        // Before performing the simulated CHANGE CR12/CR13 thread-stack swap,
        // verify that the Scheduler abstraction holds E-perm GTs
        // for CR12_PORT (→ NS[19]) and CR13_PORT (→ NS[20]) in its c-list.
        // Mirrors the hardware mLoad pipeline's capability validation for CHANGE.
        // Cross-reference: hardware/boot_rom.py SCHEDULER_IRQ_CLIST (Task #1530).
        const _schedulerAbs = this.abstractionRegistry.getAbstraction(_schedulerSlot);
        const _clist = _schedulerAbs ? (_schedulerAbs.capabilities || []) : [];
        if (_clist.length > 0) {
            const _cr12Auth = _clist[0];
            const _cr13Auth = _clist[1];
            const _hasCR12 = _cr12Auth && _cr12Auth.target === 19 &&
                             _cr12Auth.grants && _cr12Auth.grants.E;
            const _hasCR13 = _cr13Auth && _cr13Auth.target === 20 &&
                             _cr13Auth.grants && _cr13Auth.grants.E;
            if (!_hasCR12 || !_hasCR13) {
                const _missing = [];
                if (!_hasCR12) _missing.push('CR12_PORT\u2192NS[19]');
                if (!_hasCR13) _missing.push('CR13_PORT\u2192NS[20]');
                this.output += `  [IRQ] CHANGE authority check FAILED \u2014 missing E-perm GTs: ${_missing.join(', ')}\n`;
                return false;
            }
            this.output += `  [IRQ] CHANGE authority check OK \u2014 CR12_PORT(NS[19]) + CR13_PORT(NS[20]) verified\n`;
        }
        // ─────────────────────────────────────────────────────────────────────

        this.irqState.irqActive = true;
        this.irqState.savedContext = {
            pc: this.pc,
            dr: this.dr ? [...this.dr] : [],
            cr: this.cr ? this.cr.map(c => c ? {...c} : null) : [],
            flags: this.flags ? {...this.flags} : {},
            sto: this.sto,
        };
        this.irqState.suspendedStep = this.stepCount;

        // Simulate CHANGE to the predefined IRQ thread (NS slot 50, Task #1077 §3).
        // In hardware, Scheduler.IRQ performs CHANGE to the fixed boot-image IRQ thread;
        // we track this here for auditability.
        this.irqState.irqThreadSlot = _irqThreadSlot;
        this.output += `  [IRQ] CHANGE \u2192 NS[${_irqThreadSlot}] (Scheduler.IRQ.Thread) — context saved at step ${this.stepCount}\n`;

        // Dispatch the IRQ handler on the Scheduler abstraction.
        // The handler represents the IRQ thread's sweep logic (wake sleeping threads,
        // process pending flags, and optionally handle Tier 2 fault recovery).
        const result = this.abstractionRegistry.dispatchMethod(
            _schedulerSlot, 'IRQ', this, { reason, faultRecord, slot, savedContext: this.irqState.savedContext }
        );

        // CHANGE back to the suspended thread's context (Task #1077 §3 restore).
        // Restore DR[] and flags saved at IRQ entry so the interrupted thread
        // resumes with its original register state.  CR[] restore is omitted in
        // simulation because CR words are GT-sealed and the Scheduler.IRQ handler
        // is contractually prohibited from mutating machine CRs (non-mutation
        // contract: IRQ handler may only write to thread registry state, not DR/CR).
        this.irqState.irqThreadSlot = null;
        if (this.irqState.savedContext) {
            const ctx = this.irqState.savedContext;
            if (this.dr && ctx.dr && ctx.dr.length) {
                for (let i = 0; i < ctx.dr.length && i < this.dr.length; i++) {
                    this.dr[i] = ctx.dr[i];
                }
            }
            if (this.flags && ctx.flags) {
                Object.assign(this.flags, ctx.flags);
            }
        }
        this.irqState.irqActive = false;

        if (result && result.ok) {
            this.output += `  Scheduler.IRQ: ${result.message}\n`;
            if (reason === 'FAULT' && this.irqState.savedContext) {
                // Resume past the faulting instruction
                this.pc = this.irqState.savedContext.pc + 1;
            }
            return true;
        }

        const errMsg = result ? result.message : 'no IRQ handler bound';
        this.output += `  Scheduler.IRQ failed: ${errMsg}\n`;
        return false;
    }

    // Tier 3: double-fault — CHANGE directly to GT burned into CR13 by PP250.
    // Simulated as an instant re-boot via _fastBoot(2) — no permanent halt.
    _tier3Recovery(faultRecord) {
        const cr13GT = (this.cr && this.cr[13] && this.cr[13].word0)
            ? (this.cr[13].word0 >>> 0) : 0;
        this.output += `TIER 3 RECOVERY: double-fault \u2014 CHANGE to CR13 GT=0x${cr13GT.toString(16).toUpperCase().padStart(8, '0')} (PP250 fast-boot recovery)\n`;
        if (this.irqState) this.irqState.irqActive = false;
        this._fastBoot(2);
        this.halted = false;
        this.running = false;
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
        const fetchAddr = cr14.word1 + 1 + this.pc;
        if (fetchAddr >= this.memory.length) {
            return { ok: false, fault: 'BOUNDS', message: `fetch address 0x${fetchAddr.toString(16)} out of memory` };
        }
        const check = this.mLoad(cr14.word0, 'X', 14, fetchAddr);
        if (!check.ok) {
            return { ok: false, fault: check.fault, message: `CR14 fetch: ${check.message}` };
        }
        this.physicalPC = fetchAddr;
        return { ok: true, word: this.memory[fetchAddr], addr: fetchAddr };
    }

    step() {
        // If we are suspended waiting for an absent-lump fetch, don't execute
        // anything — return a suspended sentinel.  app.js drives the async fetch
        // and calls receiveLump() to resume, so this should rarely be hit.
        if (this.awaitingLump) {
            return { suspended: true, awaitingLump: this.awaitingLump };
        }
        // Lazy-Resolve: thread suspended waiting for IDE to supply a GT (Task #1519).
        // Return a sentinel so the IDE can display the Pending Capabilities panel.
        // Execution resumes when resolvePendingSlot() or escalateLazyResolve() is called.
        if (this._lazySuspended) {
            return {
                lazySuspended: true,
                pendingResolves: [...this._pendingResolves.entries()].map(([slot, e]) => ({
                    slot, petName: e.petName, instrName: e.instrName, kind: e.kind,
                })),
            };
        }
        if (this.halted) return null;
        this.auditLog = [];

        // ── Scheduler timer interrupt check (Task #1077) ──────────────────────
        // Before fetching the next instruction: if the hardware alarm has fired
        // and Scheduler.IRQ is not already active, inject a hidden Scheduler.IRQ
        // (equivalent to an ELOADCALL Scheduler.IRQ before the normal instruction).
        // The timer is masked while irqActive to prevent nested interrupts.
        if (this.bootComplete && this.irqState &&
            this.irqState.timerArmed && !this.irqState.irqActive &&
            this.stepCount >= this.irqState.timerDeadline) {
            this.irqState.timerArmed = false;
            this.output += `[Timer] ALARM fired at step ${this.stepCount} (deadline=${this.irqState.timerDeadline}) \u2014 injecting Scheduler.IRQ\n`;
            this._fireSchedulerIRQ('TIMER', null);
            const timerResult = {
                pc: this.pc, physicalPC: this.physicalPC, instr: null,
                desc: `Timer IRQ: Scheduler.IRQ injected at step ${this.stepCount} (hidden ELOADCALL)`,
                timerIRQ: true,
            };
            timerResult.physicalPC = this.physicalPC;
            timerResult.auditPipeline = this._auditPipeline ? this._auditPipeline() : [];
            this.emit('step', timerResult);
            this.emit('stateChange', this.getState());
            return timerResult;
        }

        const fetch = this._fetchInstruction();
        if (!fetch.ok) {
            this.fault(fetch.fault, fetch.message);
            return null;
        }
        const instrWord = fetch.word;
        // v2.0: HALT (instrWord===0) does not exist. A zero word decodes to
        // LOAD EQ, CR0, CR0[0] — a conditional NOP that executes only when Z=1.
        // Pre-boot zero-word handling is retained via the boot PC sentinel path.
        if (instrWord === 0 && !this.bootComplete) {
            this.output += `[PP250] Zero instruction at PC=${this.pc} (addr=0x${fetch.addr.toString(16)}) — pre-boot zero, returning to boot sequence\n`;
            this._returnToBoot();
            return { pc: this.pc, physicalPC: this.physicalPC, instr: null, desc: 'PP250: zero instruction -> reboot' };
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

        // ── Hardware privilege fence ──────────────────────────────────────────────
        // CR12–CR15 are hardware-privileged; normal instructions may not name them.
        // Rule: fault = (reg >= 12) AND NOT (opcode ∈ {DREAD,DWRITE} AND reg == 14)
        //   CHANGE (opcode 4): fully exempt from the decode fence — crDst is checked
        //     inside _execChange (must be 12–15). crSrc is also unrestricted: the boot
        //     sequence uses `CHANGE CR12, CR12, 1` where crSrc==12 (the only instruction
        //     that may reach into the privileged bank as a source is CHANGE itself).
        //   DREAD (opcode 16) / DWRITE (opcode 17): may use CR14 as the source
        //     capability field to access read-only data packed after HALT in the
        //     code lump (`DREAD DR, CR14, offset` pattern).
        if (d.opcode !== 4) {
            // crDst encodes a CR index only for Church opcodes (0–9).
            // Turing opcodes (16–25) put a DR index in the same bit field — do not fence them.
            const isChurchOp = (d.opcode <= 9);
            if (isChurchOp && d.crDst >= 12) {
                this.fault('PRIV_REG', `${this.opName(d.opcode)}: CR${d.crDst} is privileged — only CHANGE may write CR12–CR15`);
                return null;
            }
            // crSrc is a true CR index only for specific opcodes; exclude the rest:
            //   0 (LOAD), 1 (SAVE)           — crSrc is the c-list CR ✓
            //   2 (CALL)                      — crSrc is a METHOD SELECTOR (0–15), NOT a CR ✗
            //   3 (RETURN)                    — crSrc is in the zero/mask field (always 0) ✓
            //   5 (SWITCH)                    — crSrc is the register to swap ✓
            //   6 (TPERM), 7 (LAMBDA)         — crSrc unused (stays 0, no false fault) ✓
            //   8 (ELOADCALL), 9 (XLOADLAMBDA)— crSrc is the c-list CR ✓
            //   16 (DREAD), 17 (DWRITE)       — crSrc is a CR (with CR14 exception)
            //   18–25 (other Turing)          — crSrc is a DR index, not a CR ✗
            const isDreadDwrite = (d.opcode === 16 || d.opcode === 17);
            // Opcodes where crSrc genuinely carries a CR index (privilege fence applies):
            const crSrcIsCapReg = [0, 1, 5, 8, 9, 16, 17].includes(d.opcode);
            if (crSrcIsCapReg && d.crSrc >= 12 && !(isDreadDwrite && d.crSrc === 14)) {
                this.fault('PRIV_REG', `${this.opName(d.opcode)}: CR${d.crSrc} is privileged — DREAD/DWRITE may use CR14 as source; all other instructions must use CR0–CR11`);
                return null;
            }
        }

        // Capture current instruction context so mLoad/mSave audit entries can
        // include a "location" row (Step#, PC, decoded instruction) for fault display.
        this._currentInstrLabel = {
            pc:         this.pc,
            physicalPC: this.physicalPC,
            step:       this.stepCount,
            opName:     this.opName(d.opcode),
            crDst:      d.crDst,
            crSrc:      d.crSrc,
            imm:        d.imm,
            instrWord:  d.raw,
        };

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
            // opcodes 10–15: unassigned in v2.0 ISA → FAULT
            case 10: case 11: case 12: case 13: case 14: case 15:
                this.fault('INVALID_OP', `Opcode ${d.opcode} is unassigned (reserved gap 10–15) in v2.0 ISA`);
                return null;
            // opcodes 16–25: Turing data-register instructions
            case 16: result = this._execDread(d); break;
            case 17: result = this._execDwrite(d); break;
            case 18: result = this._execBfext(d); break;
            case 19: result = this._execBfins(d); break;
            case 20: result = this._execMcmp(d); break;
            case 21: result = this._execIadd(d); break;
            case 22: result = this._execIsub(d); break;
            case 23: result = this._execBranch(d); break;
            case 24: result = this._execShl(d); break;
            case 25: result = this._execShr(d); break;
            // opcodes 26–29: unassigned in v2.0 ISA → FAULT
            case 26: case 27: case 28: case 29:
                this.fault('INVALID_OP', `Opcode ${d.opcode} is unassigned (reserved gap 26–29) in v2.0 ISA`);
                return null;
            case 0x1E:
                this.fault('INVALID_OP', `WORD (opcode 0x1E) is an inline data constant and cannot be executed — check your RETURN placement`);
                return null;
            default:
                this.fault('INVALID_OP', `Unknown opcode ${d.opcode}`);
                return null;
        }

        if (result) {
            // DR0 is the hardwired zero register — zeroed unconditionally after every
            // instruction. Signed results from device CALL paths are returned in DR1.
            this._writeDR(0, 0);
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
            clistSize = this.parseNSWord1(this.cr[6].word2).clistCount;
        } else {
            const lumpBase = this.cr[d.crSrc].word1;
            const hdrRead = this._capRead(d.crSrc, lumpBase, 'R', `LOAD CR${d.crSrc} lump-hdr`);
            if (!hdrRead.ok) { this.fault(hdrRead.fault, hdrRead.message); return null; }
            const hdr = this.parseLumpHeader(hdrRead.value);
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
        let slotGT = this.memory[clistLoc + d.imm] || 0;
        if (slotGT === 0) {
            const _pc = this.programCapabilities;
            const _pce = _pc && _pc[d.imm];
            const _pcn = _pce ? (typeof _pce === 'string' ? _pce : (_pce.name || null)) : null;
            // ── Lazy-Resolve: NULL GT with pet name → suspend thread (Task #1519) ──
            if (_pcn) {
                let _resolvedNsIdx = -1;
                for (const [_ridx, _rlbl] of Object.entries(this.nsLabels)) {
                    if (String(_rlbl).toUpperCase() === _pcn.toUpperCase()) {
                        _resolvedNsIdx = parseInt(_ridx, 10);
                        break;
                    }
                }
                if (_resolvedNsIdx >= 0 && this.isNSEntryValid(_resolvedNsIdx)) {
                    const _resolvedGT = this.createGT(0, _resolvedNsIdx, {R:0,W:0,X:0,L:0,S:0,E:1}, 1);
                    this.memory[clistLoc + d.imm] = _resolvedGT >>> 0;
                    slotGT = _resolvedGT >>> 0;
                    this.output += `[LAZY-RESOLVE] NULL Slot ${d.imm} "${_pcn}" \u2192 NS[${_resolvedNsIdx}] resolved instantly.\n`;
                    // Fall through to continue LOAD processing
                } else {
                    // No NS match — save context and suspend thread transparently
                    this._pendingResolves.set(d.imm, {
                        petName: _pcn, slot: d.imm, instrName: 'LOAD', kind: 'NULL_GT',
                        pc: this.pc,
                        savedDRs: [...this.dr],
                        savedCRs: this.cr.map(c => ({ ...c })),
                        savedFlags: { ...this.flags },
                        savedSto: this.sto,
                    });
                    this._lazySuspended = true;
                    this.output += `[LAZY-RESOLVE] LOAD: c-list slot ${d.imm} "${_pcn}" is NULL \u2014 thread suspended; link Pet name '${_pcn}' to a live NS entry to resume.\n`;
                    this.emit('lazyResolvePending', { petName: _pcn, slot: d.imm, instrName: 'LOAD', kind: 'NULL_GT' });
                    return { lazySuspended: true, petName: _pcn, slot: d.imm, instrName: 'LOAD', kind: 'NULL_GT', pc: this.pc, instr: d, desc: `LOAD: waiting for '${_pcn}' (slot ${d.imm})` };
                }
            } else if (this.petNameMemory.has(d.imm)) {
                // petNameMemory: slot was registered via IO_PORT_PET_NAME_WR or markNamedSlots().
                // Fire Scheduler.IRQ(LAZY_RESOLVE) instead of a hard NULL_CAP fault.
                this._pendingResolves.set(d.imm, {
                    petName: `slot${d.imm}`, slot: d.imm, instrName: 'LOAD', kind: 'NULL_GT',
                    pc: this.pc,
                    savedDRs: [...this.dr],
                    savedCRs: this.cr.map(c => ({ ...c })),
                    savedFlags: { ...this.flags },
                    savedSto: this.sto,
                });
                this._lazySuspended = true;
                this.output += `[LAZY-RESOLVE] LOAD: c-list slot ${d.imm} is named (PetNameMemory) \u2014 firing Scheduler.IRQ(LAZY_RESOLVE, slot=${d.imm})\n`;
                this.emit('lazyResolvePending', { petName: `slot${d.imm}`, slot: d.imm, instrName: 'LOAD', kind: 'NULL_GT' });
                this._fireSchedulerIRQ('LAZY_RESOLVE', null, d.imm);
                return { lazySuspended: true, petName: `slot${d.imm}`, slot: d.imm, instrName: 'LOAD',
                         kind: 'NULL_GT', pc: this.pc, instr: d,
                         desc: `LOAD: named slot ${d.imm} (PetNameMemory) \u2014 Scheduler.IRQ(LAZY_RESOLVE) fired` };
            } else {
                this.fault('NULL_CAP', `LOAD: c-list offset ${d.imm} is empty (NULL GT)`);
                return null;
            }
        }
        // ── Lazy-Resolve: pending GT intercept ────────────────────────────────
        // A pending sentinel (0xFEED____) means the slot has a declared pet name
        // but has not yet been introduced to a live GT.  Attempt instant resolution
        // for system abstractions with a fixed NS label; fire a structured fault
        // (LAZY_RESOLVE_PENDING) for instance-specific abstractions.
        if (ChurchSimulator.isPendingGT(slotGT)) {
            const _pendingName = ChurchSimulator.pendingGTName(slotGT);
            let _resolvedNsIdx = -1;
            for (const [_ridx, _rlbl] of Object.entries(this.nsLabels)) {
                if (String(_rlbl).toUpperCase() === _pendingName.toUpperCase()) {
                    _resolvedNsIdx = parseInt(_ridx, 10);
                    break;
                }
            }
            if (_resolvedNsIdx >= 0 && this.isNSEntryValid(_resolvedNsIdx)) {
                const _resolvedGT = this.createGT(0, _resolvedNsIdx, {R:0,W:0,X:0,L:0,S:0,E:1}, 1);
                this.memory[clistLoc + d.imm] = _resolvedGT >>> 0;
                slotGT = _resolvedGT >>> 0;
                this.output += `[LAZY-RESOLVE] Slot ${d.imm} "${_pendingName}" \u2192 NS[${_resolvedNsIdx}] resolved instantly.\n`;
            } else {
                this.fault('LAZY_RESOLVE_PENDING',
                    `LOAD: c-list slot ${d.imm} "${_pendingName}" is pending \u2014 not yet introduced to a live GT`,
                    { petName: _pendingName, slot: d.imm });
                return null;
            }
        }
        const slotParsed = this.parseGT(slotGT);

        // Defence-in-depth: reject malformed GT words that were written directly
        // into memory (e.g. by STORE or a test harness), bypassing createGT().
        // parseGT() sets the 'malformed' flag for any GT whose permission bits
        // violate isDomainPure or isSinglePerm, completing the defence chain
        // that createGT() starts at construction time.
        if (slotParsed.malformed) {
            this.auditLog.push({
                gate: 'malformedGT',
                desc: `malformedGT: ${slotParsed.malformedReason}`,
                reason: slotParsed.malformedReason,
                label: `C-List slot ${d.imm}`,
                nsIndex: null,
                requiredPerm: null,
                checks: { malformed: { pass: false } },
                b: 0, f: 0,
                result: 'fault',
            });
            this.fault('DOMAIN_PURITY',
                `LOAD: C-List slot ${d.imm} contains malformed GT — ${slotParsed.malformedReason}`,
                { malformedReason: slotParsed.malformedReason });
            return null;
        }

        if (d.crSrc === 6) {
            const permCheck = this._validateClistSlotPerms(slotParsed, d.imm);
            if (!permCheck.ok) {
                this.fault(permCheck.fault, `LOAD: ${permCheck.message}`);
                return null;
            }
        }

        if (slotParsed.type === 3) {
            const info = this.parseAbstractGT(slotGT);
            const fakeEntry = { word0_location: 0, word1_limit: 0, word3_abstract_gt: 0 };
            if (!this._writeCR(d.crDst, slotGT, fakeEntry)) return null;
            const CLASS_NAMES = ['IO','M-Elev','','','',''];
            const DC_NAMES   = {
                [ChurchSimulator.DEVICE_CLASS_LED]:      'LED',
                [ChurchSimulator.DEVICE_CLASS_UART]:     'UART',
                [ChurchSimulator.DEVICE_CLASS_BUTTON]:   'BTN',
                [ChurchSimulator.DEVICE_CLASS_TIMER]:    'TIMER',
                [ChurchSimulator.DEVICE_CLASS_DISPLAY]:  'DISPLAY',
                [ChurchSimulator.DEVICE_CLASS_CHURCHHW]: 'ChurchHW',
            };
            const dcName = DC_NAMES[info.device_class] || `dc=0x${info.device_class.toString(16).toUpperCase()}`;
            const abLabel = info.ab_type === ChurchSimulator.AB_TYPE_IO
                ? `Abstract.${dcName}[${info.device_data}]`
                : `Abstract(ab_type=0x${info.ab_type.toString(16).toUpperCase()})`;
            const desc = `LOAD CR${d.crDst}, [CR${d.crSrc} + ${d.imm}] \u2192 ${abLabel}`;
            this.output += desc + '\n';
            this.pc++;
            return { pc: this.pc - 1, instr: d, desc };
        }

        const targetIdx = slotParsed.index;
        this._lastLoadTargetSlot = targetIdx;
        if (targetIdx >= this.nsCount || !this.isNSEntryValid(targetIdx)) {
            this.fault('BOUNDS', `LOAD: namespace index ${targetIdx} out of bounds`);
            return null;
        }
        const entry = this.readNSEntry(targetIdx);
        if (!entry) {
            this.fault('BOUNDS', `LOAD: entry ${targetIdx} is null`);
            return null;
        }
        // Mode 2 — Outform: the GT in the c-list slot carries type=2.
        // Two sub-cases:
        //   (a) First cold load (!loaded): dispatch the Loader to install the lump,
        //       then promote Outform→Inform in the NS entry and destination CR.
        //   (b) Already installed (loaded=true, but c-list slot still holds the
        //       stale Outform GT): skip the Loader call, promote inline so the CR
        //       consistently receives an Inform GT on every LOAD.
        if (slotParsed.type === 2) {
            const manifest2 = this.lazyManifest[targetIdx];
            if (manifest2 && !manifest2.loaded) {
                this.output += `[LOADER] LOAD: CR${d.crDst} is Outform GT (NS[${targetIdx}]) — dispatching Loader (Mode 2)...\n`;
                const loaded = this._dispatchLoaderLoad(targetIdx);
                if (!loaded) {
                    this.fault('CODE_NOT_RESIDENT', `LOAD: CR${d.crDst} Outform lazy load failed for slot ${targetIdx}`);
                    return null;
                }
            }
            // Promote the GT from Outform→Inform regardless of whether the loader
            // just ran or the lump was already resident — the c-list slot is not
            // rewritten so any LOAD from it must canonicalise to Inform.
            const nsW2 = this.memory[this.NS_TABLE_BASE + targetIdx * this.NS_ENTRY_WORDS + 2];
            const gt_seq = (nsW2 >>> 25) & 0x7F;
            const informGT = this.createGT(gt_seq, targetIdx, slotParsed.permissions, 1);
            const freshEntry = this.readNSEntry(targetIdx);
            if (!this._writeCR(d.crDst, informGT, freshEntry)) return null;
            const label = this.nsLabels[targetIdx] || 'entry_' + targetIdx;
            const desc = `LOAD CR${d.crDst}, [CR${d.crSrc} + ${d.imm}] -> ${label} [Mode 2 lazy loaded]`;
            this.output += desc + '\n';
            this.pc++;
            return { pc: this.pc - 1, instr: d, desc };
        }
        if (this.lazyManifest[targetIdx] && !this.lazyManifest[targetIdx].loaded) {
            // Mode 1 — Restore: NS entry is valid but lump header magic is 0x00
            // (entire lump was zeroed on eviction).  Dispatch the Loader to
            // restore the lump at a valid address within the existing NS grant.
            // Type, limit, and gt_seq of the NS entry are never changed by the Loader.
            const lumpHdr = this.parseLumpHeader(this.memory[entry.word0_location]);
            if (!lumpHdr.valid) {
                this.output += `[LOADER] LOAD: NS[${targetIdx}] lump not resident (header magic=0x${(this.memory[entry.word0_location] >>> 27 & 0x1F).toString(16).toUpperCase()}, expected 0x1F) — dispatching Loader (Mode 1)...\n`;
                const loaded = this._dispatchLoaderLoad(targetIdx);
                if (loaded) {
                    const freshEntry = this.readNSEntry(targetIdx);
                    if (!this._writeCR(d.crDst, slotGT, freshEntry)) return null;
                    const label = this.nsLabels[targetIdx] || 'entry_'+targetIdx;
                    const desc = `LOAD CR${d.crDst}, [CR${d.crSrc} + ${d.imm}] -> ${label} [lazy loaded]`;
                    this.output += desc + '\n';
                    this.pc++;
                    return { pc: this.pc - 1, instr: d, desc };
                }
                this.fault('CODE_NOT_RESIDENT', `LOAD: slot ${targetIdx} lazy load failed`);
                return null;
                // TODO Mode 2 (OBJ_NOT_RESIDENT): when GT type is Abstract → dispatch
                // Loader.Construct to allocate a fresh NS slot and lump, then return
                // the new Inform GT to the thread's designated return register.
            }
        }

        // ── Absent-lump intercept ─────────────────────────────────────────────
        const absentLoad = this._absentLumpIntercept(entry, targetIdx, d, 'LOAD');
        if (absentLoad) return absentLoad;
        // ─────────────────────────────────────────────────────────────────────

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
        // Defence-in-depth: reject malformed GT words that were placed directly
        // into a CR (e.g. by a boot bug or a future vulnerability), bypassing
        // createGT().  parseGT() sets the 'malformed' flag for any GT whose
        // permission bits violate isDomainPure or isSinglePerm — catch it here
        // before the GT propagates into any C-List slot in memory.
        const srcGTParsed = this.parseGT(srcGT);
        if (srcGTParsed.malformed) {
            this.auditLog.push({
                gate: 'malformedGT',
                desc: `malformedGT: ${srcGTParsed.malformedReason}`,
                reason: srcGTParsed.malformedReason,
                label: `CR${d.crDst}`,
                nsIndex: null,
                requiredPerm: null,
                checks: { malformed: { pass: false } },
                b: 0, f: 0,
                result: 'fault',
            });
            this.fault('DOMAIN_PURITY',
                `SAVE: CR${d.crDst} contains malformed GT — ${srcGTParsed.malformedReason}`,
                { malformedReason: srcGTParsed.malformedReason });
            return null;
        }
        // Resolve the destination C-list NS index before calling mSave so that
        // the Far-bit (F=1) policy is enforced symmetrically with CALL/LOAD.
        // A SAVE that would write a capability into a Far-namespace C-list slot
        // must fault with F_BIT — previously targetIdx=null made that check
        // unreachable for every SAVE instruction (bug).
        const clistGT = this.cr[d.crSrc].word0;
        const clistTargetIdx = (clistGT !== 0) ? this.parseGT(clistGT).index : null;
        const saveCheck = this.mSave(srcGT, clistTargetIdx, d.crDst);
        if (!saveCheck.ok) {
            this.fault(saveCheck.fault, `SAVE: CR${d.crDst}: ${saveCheck.message}`);
            return null;
        }
        const savedCap = this.lastCapability;
        if (clistGT === 0) {
            this.fault('NULL_CAP', `SAVE: CR${d.crSrc} C-List is NULL`);
            return null;
        }
        let clistLoc;
        let clistSize;
        if (d.crSrc === 6) {
            clistLoc = this.cr[d.crSrc].word1;
            clistSize = this.parseNSWord1(this.cr[6].word2).clistCount;
        } else {
            const lumpBase = this.cr[d.crSrc].word1;
            const hdrRead = this._capRead(d.crSrc, lumpBase, 'R', `SAVE CR${d.crSrc} lump-hdr`);
            if (!hdrRead.ok) { this.fault(hdrRead.fault, hdrRead.message); return null; }
            const hdr = this.parseLumpHeader(hdrRead.value);
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
        let sourceGT = this.cr[d.crDst].word0;
        if (sourceGT === 0) {
            this.fault('NULL_CAP', `CALL: CR${d.crDst} is NULL`);
            return null;
        }
        let srcParsed = this.parseGT(sourceGT);
        if (srcParsed.type === 0) {
            this.fault('TYPE', `CALL: GT type is NULL — cannot CALL a NULL GT`);
            return;
        }
        // Mode 2 — Outform: the abstraction's lump has never been installed.
        // Intercept before the type-guard so Outform GTs trigger the lazy loader
        // rather than faulting with "GT type is Outform, must be Inform or Abstract".
        if (srcParsed.type === 2) {
            const nsSlot = srcParsed.index;
            this.output += `[LOADER] CALL: CR${d.crDst} is Outform GT (NS[${nsSlot}]) — dispatching Loader (Mode 2)...\n`;
            const loaded = this._dispatchLoaderLoad(nsSlot);
            if (!loaded) {
                this.fault('CODE_NOT_RESIDENT', `CALL: CR${d.crDst} Outform lazy load failed for slot ${nsSlot}`);
                return null;
            }
            // Promote the live CR from Outform→Inform: read fresh NS entry, rebuild GT with type=1.
            // Update word0 in-place so word2, word3, and m are preserved.
            const nsW2 = this.memory[this.NS_TABLE_BASE + nsSlot * this.NS_ENTRY_WORDS + 2];
            const gt_seq = (nsW2 >>> 25) & 0x7F;
            const informGT = this.createGT(gt_seq, nsSlot, srcParsed.permissions, 1);
            this.cr[d.crDst].word0 = informGT;
            sourceGT = informGT;
            srcParsed = this.parseGT(informGT);
            this.output += `[LOADER] CALL: Outform→Inform promotion complete for NS[${nsSlot}], proceeding with CALL CR${d.crDst}\n`;
        }
        if (srcParsed.type !== 1 && srcParsed.type !== 3) {
            this.fault('TYPE', `CALL: GT type is ${srcParsed.typeName}, must be Inform or Abstract`);
            return null;
        }
        // Abstract GT intercept: type=0b11 carries no lump and no NS slot.
        // CALL routes to the Abstract Manager (M-window: DR11=GT descriptor).
        // M is reset at every CALL boundary per architecture spec.
        if (srcParsed.type === 3) {
            this._resetAllMBits();
            return this._dispatchAbstractCall(d, sourceGT);
        }
        // Far-cap pre-check: reject before M-window writeback so that F_BIT fault
        // takes priority over any M-window state (e.g. NULL DR11 with M-bit set).
        // Architecturally, a far-capability violation is detected at capability
        // decode time, before any side-effects of the CALL boundary are triggered.
        {
            const preBase = this.NS_TABLE_BASE + srcParsed.index * this.NS_ENTRY_WORDS;
            const preW1   = this.memory[preBase + 1];
            if ((preW1 >>> 30) & 1) {
                this.fault('F_BIT', `CALL: CR${d.crDst} has F-bit set (Far)`);
                return null;
            }
        }
        // M-window writeback gate: Inform-type CALL path only.
        // Fires before NS lookup and stack push; not called on Abstract-GT dispatch.
        if (!this._mwinWriteback()) return null;
        const callTargetIdx = srcParsed.index;
        if (this.lazyManifest[callTargetIdx] && !this.lazyManifest[callTargetIdx].loaded) {
            // Mode 1 — Restore: NS entry is valid but lump header magic is 0x00
            // (entire lump was zeroed on eviction).  Dispatch the Loader to
            // restore the lump.  NS entry authority never changes.
            const callNsEntry = this.readNSEntry(callTargetIdx);
            if (callNsEntry && callNsEntry.word0_location > 0) {
                const callLumpHdr = this.parseLumpHeader(this.memory[callNsEntry.word0_location]);
                if (!callLumpHdr.valid) {
                    this.output += `[LOADER] CALL: NS[${callTargetIdx}] lump not resident (header magic=0x${(this.memory[callNsEntry.word0_location] >>> 27 & 0x1F).toString(16).toUpperCase()}, expected 0x1F) — dispatching Loader (Mode 1)...\n`;
                    const loaded = this._dispatchLoaderLoad(callTargetIdx);
                    if (!loaded) {
                        this.fault('CODE_NOT_RESIDENT', `CALL: CR${d.crDst} lazy load failed for slot ${callTargetIdx}`);
                        return null;
                        // Mode 2 (Outform / OBJ_NOT_RESIDENT) is handled above before the type-guard.
                    }
                    this.output += `[LOADER] CALL: slot ${callTargetIdx} lump restored, proceeding with CALL CR${d.crDst}\n`;
                }
            }
        }
        const callCrLabel = `CR${d.crDst}`;
        const check = this.mLoad(sourceGT, 'E', d.crDst);
        if (!check.ok) {
            this.fault(check.fault, `CALL: ${callCrLabel}: ${check.message}`);
            return null;
        }
        const nsEntry = check.entry;

        const handler = this.nsHandlers[check.index];
        if (handler) {
            // Handler dispatches are atomic (no real call frame): save and restore CR6 so
            // the caller's c-list base (CR6.word1) is never corrupted by _writeCR's lump-start write.
            const savedCR6 = {...this.cr[6]};
            this._writeCR(6, sourceGT, nsEntry);
            const handlerResult = this._dispatchHandler(d, check, handler);
            this.cr[6] = savedCR6;
            if (handlerResult && this._mwinWbFired && Array.isArray(handlerResult.pipeline)) {
                handlerResult.pipeline.unshift({ stage: 'MWIN_WB', desc: `M-window writeback: DR11–DR13 → CR15, M cleared`, status: 'pass' });
            }
            return handlerResult;
        }

        const lumpIsResident = nsEntry.word0_location > 0 &&
            this.parseLumpHeader(this.memory[nsEntry.word0_location]).valid;

        if (!lumpIsResident && this.abstractionRegistry) {
            const abstraction = this.abstractionRegistry.getAbstraction(check.index);
            if (abstraction && abstraction.methods.length > 0) {
                this.abstractionRegistry.activate(check.index);
                const savedCR6 = {...this.cr[6]};
                this._writeCR(6, sourceGT, nsEntry);
                const abstrResult = this._dispatchAbstraction(d, check, abstraction);
                this.cr[6] = savedCR6;
                if (abstrResult && this._mwinWbFired && Array.isArray(abstrResult.pipeline)) {
                    abstrResult.pipeline.unshift({ stage: 'MWIN_WB', desc: `M-window writeback: DR11–DR13 → CR15, M cleared`, status: 'pass' });
                }
                return abstrResult;
            }
        }

        // ── Lazy-Load: valid header but cw=0 means code section evicted ─────────
        // Checked here — BEFORE callStack.push / sto decrement / _resetAllMBits —
        // so that a LAZY_LOAD suspension leaves no partial call-frame in the stack
        // and the retry can re-enter _execCall cleanly (Task #1527).
        if (nsEntry.word0_location > 0) {
            const _hdr = this.parseLumpHeader(this.memory[nsEntry.word0_location]);
            if (_hdr.valid && _hdr.cw === 0) {
                const lazySlot = check.index;
                this.output += `[LAZY-LOAD] CALL CR${d.crDst}: NS[${lazySlot}] lump has cw=0 (code evicted) — firing Scheduler.IRQ(LAZY_LOAD, slot=${lazySlot})\n`;
                const fired = this._fireSchedulerIRQ('LAZY_LOAD', null, lazySlot);
                if (fired) {
                    return { lazySuspended: true, slot: lazySlot, instrName: 'CALL', kind: 'LAZY_LOAD',
                             pc: this.pc, instr: d,
                             desc: `CALL: LAZY_LOAD — NS[${lazySlot}] code not resident; Scheduler.IRQ fired` };
                }
                this.fault('CODE_NOT_RESIDENT', `CALL CR${d.crDst}: cw=0 on NS[${lazySlot}] (LAZY_LOAD IRQ failed)`);
                return null;
            }
        }

        this._flushLambdaCache();

        const savedSTO = this.sto;
        const callThreadBase = this.cr[12] && this.cr[12].word1;
        if (callThreadBase) {
            const hdrRead = this._threadRead(callThreadBase, `CALL CR${d.crDst} thread-hdr`);
            if (!hdrRead.ok) return null;
            const hdr = this.parseLumpHeader(hdrRead.value);
            const lumpSize = hdr.valid ? hdr.lumpSize : 256;
            const sw = (hdr.valid && hdr.typ === 2) ? hdr.cw : 0;
            const sp_max = lumpSize - 12 - 1;
            const sp_min = sp_max - sw + 1;
            const newSTO = (savedSTO - 2) & 0xFFF;
            if (newSTO < sp_min) {
                this.flags.V = true;
                this.output += `[STACK WARNING] CALL CR${d.crDst}: STO=${newSTO} below sw limit sp_min=${sp_min} (sw=${sw}) — V flag set\n`;
            }
            const threadCC = hdr.valid ? hdr.cc : 0;
            const heapEnd = 1 + 16 + threadCC;
            if (savedSTO < heapEnd || savedSTO - 1 < heapEnd) {
                this.fault('BOUNDS', `CALL CR${d.crDst}: stack overflow — STO=${savedSTO} would write into heap/DR zone (heapEnd=${heapEnd})`);
                return null;
            }
            if (savedSTO >= lumpSize || savedSTO - 1 >= lumpSize) {
                this.fault('BOUNDS', `CALL CR${d.crDst}: stack frame address ${savedSTO} out of thread lump (size=${lumpSize})`);
                return null;
            }
        }
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
            if (!this._threadWrite(callThreadBase + savedSTO, frameWord, `CALL CR${d.crDst} frame`)) {
                this.callStack.pop();
                return null;
            }
            if (!this._threadWrite(callThreadBase + savedSTO - 1, oldCR6GT, `CALL CR${d.crDst} CR6-save`)) {
                this.callStack.pop();
                return null;
            }
        }
        this.sto = (savedSTO - 2) & 0xFFF;
        this._resetAllMBits();   // CALL boundary: M is reset on all CRs (architecture rule)

        const base = nsEntry.word0_location;
        const label = this.nsLabels[check.index] || 'abstraction';
        let cr14Desc = '';

        const hdrCheck = this.mLoad(sourceGT, 'E', d.crDst, base);
        if (!hdrCheck.ok) {
            this.fault(hdrCheck.fault, `CALL CR${d.crDst} lump-hdr: ${hdrCheck.message}`);
            return null;
        }
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
            this.cr[14] = {
                word0: cr14GT,
                word1: base,
                word2: nsEntry.word1_limit >>> 0,
                word3: nsEntry.word2_seals,
                m: 1    // CALL Phase 1 mLoad is always M-elevated
            };

            // CR6: E-only GT — same slot/seq/type as source, perms fixed to E alone.
            // E allows recursive CALL via CR6 directly. Device GTs (L+S+E) have L/S stripped.
            // Matches boot LOAD_NUC convention (line 624): CR6 always carries E perm.
            // M is recorded in cr.m = 1 (not in the GT perms field).
            const cr6GT = this.createGT(srcParsed.gt_seq, check.index, {R:0,W:0,X:0,L:0,S:0,E:1}, srcParsed.type);
            this.cr[6] = {
                word0: cr6GT,                       // E-only (recursive CALL via CR6; matches boot LOAD_NUC CR6)
                word1: (base + clistStart) >>> 0,
                word2: nsEntry.word1_limit >>> 0,
                word3: nsEntry.word2_seals,
                m: 1    // M set (CALL Phase 1 mLoad always M-elevated; call.py: mload_m_elevated = 1)
            };
            // CR6 lives in the CALL stack frame (written above); NOT in the caps zone

            cr14Desc = `, hdr=0x${hdrWord.toString(16).toUpperCase().padStart(8,'0')} → CR14+CR6 simultaneous: CR14(RX M=1,cw=${cw},lim=0..${cw-1}) CR6(E M=1,cc=${cc},base=0x${(base+clistStart).toString(16).toUpperCase()})`;
        } else {
            // Non-lump-header path: write E-only GT to CR6 (strip L/S from device GT) + M.
            // Matches boot LOAD_NUC convention: CR6 = E perm (recursive CALL via CR6).
            const cr6GTnorm = this.createGT(srcParsed.gt_seq, check.index, {R:0,W:0,X:0,L:0,S:0,E:1}, srcParsed.type);
            this._writeCR(6, cr6GTnorm, nsEntry);
            this.cr[6].m = 1;   // M set (CALL always M-elevated; _writeCR uses global mElevation which may be 0 post-boot)

            const clistLoc = nsEntry.word0_location;
            const cr14ReadCheck = this.mLoad(sourceGT, 'E', d.crDst, clistLoc);
            if (!cr14ReadCheck.ok) {
                this.fault(cr14ReadCheck.fault, `CALL CR${d.crDst} clist[0]: ${cr14ReadCheck.message}`);
                return null;
            }
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
                                const rxGT = this.createGT(cr14Parsed.gt_seq, cr14Parsed.index, {R:1,W:0,X:1,L:0,S:0,E:0}, cr14Parsed.type);
                                this._writeCR(14, rxGT, cr14Check.entry);
                                cr14Desc = `, CR14 <- RX-GT(Slot ${cr14Parsed.index})`;
                            }
                        }
                    }
                }
            }
        }

        const desc = `CALL CR${d.crDst} -> ${label}${cr14Desc}`;
        this.output += desc + '\n';
        const prevPC = this.pc;
        // Hardware method-table dispatch.
        // CALL imm15 = method index.
        //   index=0 → NIA = lump_base + 1 (word 1, single-entry-point shortcut).
        //   index>0 → read memory[lump_base + index]; 0 = private → FAULT.
        //
        // Method-table entries are BRANCH instructions (opcode 23 in v2.0 ISA, 15-bit signed
        // offset in bits [14:0]).  The entry at lump word `methodIndex` sits at
        // lump-relative PC = methodIndex - 1 (fetch formula: physAddr = base+1+pc).
        // New PC = (methodIndex - 1) + branchOffset = bodyOffset.
        //
        // Backward compat: if the opcode field is not 23, the entry is treated as
        // a direct lump-relative PC (legacy bare-address format from pre-task-1134
        // LUMPs stored on disk).
        const methodIndex = (d.imm !== undefined) ? (d.imm & 0x7FFF) : 0;
        if (methodIndex === 0) {
            // Single entry point: word 1 of the lump (lump_base is word-indexed in simulator).
            this.pc = 1;
        } else {
            const lumpBaseWord = nsEntry.word0_location;  // word index of lump_base in memory[]
            const tableEntry = this.memory[lumpBaseWord + methodIndex] >>> 0;
            if (tableEntry === 0) {
                this.fault('PRIVATE_METHOD', `CALL CR${d.crDst}: method index ${methodIndex} is private (table entry = 0)`);
                return null;
            }
            const entryOpcode = (tableEntry >>> 27) & 0x1F;
            if (entryOpcode === 23) {  // BRANCH-encoded method-table entry (v2.0: opcode 23)
                // Decode 15-bit signed offset; table entry at lump PC (methodIndex - 1).
                const soff = (tableEntry & 0x4000)
                    ? ((tableEntry & 0x7FFF) | 0xFFFF8000)
                    : (tableEntry & 0x7FFF);
                this.pc = (methodIndex - 1) + soff;  // = bodyOffset
            } else {
                // Legacy: bare lump-relative PC (pre-task-1134 on-disk LUMPs).
                this.pc = tableEntry;
            }
        }
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
                        this._writeDR(1, result.result.permMask || 0);
                    } else {
                        this.output += `  ${result ? result.message : 'Navana.ValidatePassKey failed'}\n`;
                        this.fault('PERM', `CALL Navana: PassKey validation failed — ${result ? result.message : 'unknown error'}`);
                        return null;
                    }

                    this.pc++;
                    const pkReturnPC = this.pc;
                    return { pc: this.pc - 1, instr: d, desc, pipeline: [
                        ...this._callBoundaryStages(d, label),
                        { stage: 'VALIDATE', desc: `PassKey validated for ${result.result.device}`, status: 'pass' },
                        { stage: 'GRANT', desc: 'CR1 <- E-perm LED driver', status: 'pass' },
                        { stage: 'RETN', desc: `Returned to PC=${pkReturnPC}`, status: 'pass' },
                        { stage: 'ATOMIC', desc: 'Registered abstraction \u2014 no step-into', status: 'info' },
                    ]};
                }
            }

            let methodName, argDR1, argDR2, encodedDstReg = null;
            const isClistIndexedNav = d.imm !== 0 && !(d.imm & 0x4000);
            if (d.imm & 0x4000) {
                const packed = d.imm & 0x3FFF;
                const methodIdx = (packed >> 8) & 0x3F;
                const leftReg = (packed >> 4) & 0xF;
                const rightReg = packed & 0xF;
                encodedDstReg = d.crSrc;
                argDR1 = this.dr[leftReg];
                argDR2 = this.dr[rightReg];
                methodName = (methodIdx >= 0 && methodIdx < abstraction.methods.length)
                    ? abstraction.methods[methodIdx]
                    : (abstraction.methods[0] || 'Apply');
            } else if (isClistIndexedNav) {
                const methodIdx = d.crDst;
                argDR1 = this.dr[1];
                argDR2 = this.dr[2];
                methodName = (methodIdx >= 0 && methodIdx < abstraction.methods.length)
                    ? abstraction.methods[methodIdx]
                    : (abstraction.methods[0] || 'Apply');
            } else {
                methodName = this._selectNavanaMethod(d) || abstraction.methods[0] || 'Apply';
                argDR1 = this.dr[1];
                argDR2 = this.dr[2];
            }
            const desc = isClistIndexedNav
                ? `CALL ${d.crDst}, CR${d.crSrc}, #${d.imm} -> ${label}.${methodName} [method=${d.crDst}]`
                : `CALL CR${d.crDst} -> ${label}.${methodName} [abstraction dispatch]`;
            this.output += desc + '\n';

            let navDispatchResult = null;
            if (this.abstractionRegistry) {
                const result = this.abstractionRegistry.dispatchMethod(check.index, methodName, this, {
                    dr1: argDR1, dr2: argDR2
                });
                navDispatchResult = result;
                if (result && result.message) {
                    this.output += `  ${result.message}\n`;
                }
                if (result && result.ok && result.result !== undefined && typeof result.result === 'number') {
                    if (encodedDstReg !== null) {
                        this._writeDR(encodedDstReg, result.result);
                    } else {
                        this._writeDR(1, result.result);
                    }
                }
                if (result && !result.ok && result.fault) {
                    this.fault(result.fault, `${label}.${methodName}: ${result.message}`);
                    this.pc++;
                    return { pc: this.pc - 1, instr: d, desc, pipeline: [
                        ...this._callBoundaryStages(d, label),
                        { stage: 'FAULT', desc: `${result.fault}: ${result.message}`, status: 'fail' },
                        { stage: 'ATOMIC', desc: 'Registered abstraction \u2014 no step-into', status: 'info' },
                    ]};
                }
            }

            {
                const retVal = navDispatchResult && navDispatchResult.ok && navDispatchResult.result !== undefined && typeof navDispatchResult.result === 'number' ? navDispatchResult.result : null;
                const navDstReg = encodedDstReg !== null ? encodedDstReg : 1;
                const execDesc = retVal !== null
                    ? `${label}.${methodName}(DR1=${argDR1}, DR2=${argDR2}) \u2192 DR${navDstReg}=${retVal}`
                    : `${label}.${methodName}(DR1=${argDR1}, DR2=${argDR2})`;
                this.pc++;
                const returnPC = this.pc;
                return { pc: this.pc - 1, instr: d, desc, pipeline: [
                    ...this._callBoundaryStages(d, label),
                    { stage: 'EXEC', desc: execDesc, status: 'pass' },
                    { stage: 'RETN', desc: `Returned to PC=${returnPC}`, status: 'pass' },
                    { stage: 'ATOMIC', desc: 'Registered abstraction \u2014 no step-into', status: 'info' },
                ]};
            }
        }

        let methodIndex, argDR1, argDR2, desc, encodedDstReg;
        const isClistIndexed = d.imm !== 0 && !(d.imm & 0x4000);
        // ISA extension: encoded CALL mode (imm bit 14 set)
        // Packs method index, source operand registers, and destination DR into CALL instruction
        // fields (imm[13:8]=method, imm[7:4]=leftDR, imm[3:0]=rightDR, crSrc=dstDR).
        // Result is written directly to dstDR, bypassing DR0 zero-register enforcement.
        // C-list indexed mode (imm != 0, bit 14 clear): CRd is method selector (0–14).
        //   CRd=15 is the escape code: read DR3 as the extended method selector.
        // Legacy mode (imm=0, bit 14 clear) uses DR3 as method selector with DR1/DR2 operands.
        if (d.imm & 0x4000) {
            const packed = d.imm & 0x3FFF;
            methodIndex = (packed >> 8) & 0x3F;
            const leftReg = (packed >> 4) & 0xF;
            const rightReg = packed & 0xF;
            encodedDstReg = d.crSrc;
            argDR1 = this.dr[leftReg];
            argDR2 = this.dr[rightReg];
            const methodName2 = (methodIndex >= 0 && methodIndex < abstraction.methods.length)
                ? abstraction.methods[methodIndex]
                : (abstraction.methods[0] || 'Apply');
            desc = `CALL CR${d.crDst} -> ${label}.${methodName2} [DR${leftReg}, DR${rightReg}] -> DR${encodedDstReg}`;
        } else if (isClistIndexed) {
            methodIndex = (d.crDst === 15) ? (this.dr[3] || 0) : d.crDst;
            encodedDstReg = null;
            argDR1 = this.dr[1];
            argDR2 = this.dr[2];
            const methodLabel = abstraction.methods[methodIndex] || abstraction.methods[0] || 'Apply';
            desc = (d.crDst === 15)
                ? `CALL 15, CR${d.crSrc}, #${d.imm} -> ${label}.${methodLabel} [escape: DR3=${methodIndex}]`
                : `CALL ${d.crDst}, CR${d.crSrc}, #${d.imm} -> ${label}.${methodLabel} [method=${methodIndex}]`;
        } else {
            methodIndex = this.dr[3] || 0;
            encodedDstReg = null;
            argDR1 = this.dr[1];
            argDR2 = this.dr[2];
            desc = `CALL CR${d.crDst} -> ${label}.${abstraction.methods[methodIndex] || 'Apply'} [DR3=${methodIndex}]`;
        }
        const methodName = (methodIndex >= 0 && methodIndex < abstraction.methods.length)
            ? abstraction.methods[methodIndex]
            : (abstraction.methods[0] || 'Apply');
        this.output += desc + '\n';

        let genDispatchResult = null;
        if (this.abstractionRegistry) {
            // For LED (NS 12): ledIndex = d.imm - LED_CLIST_BASE (the call-site C-list offset).
            // _execCall sets check.ledIndex after mLoad; handler validates range 0–5.
            const LED_ABS_IDX = 12;
            const ledIndex = (check.index === LED_ABS_IDX && check.ledIndex !== undefined)
                ? check.ledIndex
                : 0;
            const result = this.abstractionRegistry.dispatchMethod(check.index, methodName, this, {
                dr1: argDR1, dr2: argDR2, ledIndex
            });
            genDispatchResult = result;
            if (result && result.message) {
                this.output += `  ${result.message}\n`;
            }
            if (result && result.result !== undefined && typeof result.result === 'number') {
                if (result.preserveDR1) {
                    // Signed-return convention: result goes to DR1 (≥0 success, <0 fault).
                    // DR0 remains zero unconditionally; callers branch on DR1 via BGE/BLT.
                    // Generic: any abstraction method may opt in by returning preserveDR1:true.
                    const extras = (check.index === LED_ABS_IDX) ? { ledIndex } : null;
                    this._recordSignedReturn(check.index, methodName, result.result, extras);
                    const tag = (check.index === LED_ABS_IDX) ? ` index=${ledIndex}` : '';
                    this.output += `DR1 = ${result.result}  [${label}.${methodName}${tag}]\n`;
                } else if (encodedDstReg !== null) {
                    this._writeDR(encodedDstReg, result.result);
                } else {
                    this._writeDR(1, result.result);
                }
                if (result.result2 !== undefined && typeof result.result2 === 'number') {
                    const secondReg = encodedDstReg !== null && encodedDstReg < 15 ? encodedDstReg + 1 : 2;
                    this._writeDR(secondReg, result.result2);
                }
            }
            if (result && !result.ok && result.fault) {
                this.fault(result.fault, `${label}.${methodName}: ${result.message}`);
                this.pc++;
                return { pc: this.pc - 1, instr: d, desc, pipeline: [
                    ...this._callBoundaryStages(d, label),
                    { stage: 'FAULT', desc: `${result.fault}: ${result.message}`, status: 'fail' },
                    { stage: 'ATOMIC', desc: 'Registered abstraction \u2014 no step-into', status: 'info' },
                ]};
            }
        }

        {
            const retVal = genDispatchResult && genDispatchResult.result !== undefined && typeof genDispatchResult.result === 'number' ? genDispatchResult.result : null;
            const dstReg = encodedDstReg !== null ? encodedDstReg : 1;
            const execDesc = retVal !== null
                ? `${label}.${methodName}(DR1=${argDR1}, DR2=${argDR2}) \u2192 DR${dstReg}=${retVal}`
                : `${label}.${methodName}(DR1=${argDR1}, DR2=${argDR2})`;
            this.pc++;
            const returnPC = this.pc;
            return { pc: this.pc - 1, instr: d, desc, pipeline: [
                ...this._callBoundaryStages(d, label),
                { stage: 'EXEC', desc: execDesc, status: 'pass' },
                { stage: 'RETN', desc: `Returned to PC=${returnPC}`, status: 'pass' },
                { stage: 'ATOMIC', desc: 'Registered abstraction \u2014 no step-into', status: 'info' },
            ]};
        }
    }

    _selectNavanaMethod(d) {
        const dr1 = this.dr[1];
        if (dr1 === 0) return 'Init';
        if (dr1 === 1) return 'Manage';
        if (dr1 === 2) return 'Monitor';
        if (dr1 === 3) return 'IDS';
        if (dr1 === 4) return 'MintPassKey';
        if (dr1 === 5) return 'GetPassKeyAuditLog';
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

                // DR1 encoding: [31:24]=method(0-3), [5:0]=LED capability offset (0-5)
                const dr1 = this.dr[1];
                const callerGT = this.cr[d.crDst].word0;

                if (this.abstractionRegistry) {
                    const result = this.abstractionRegistry.dispatchMethod(5, 'CallLEDDriver', this, {
                        callerGT: callerGT,
                        dr1: dr1,
                        dr2: 0
                    });

                    if (result && result.message) {
                        this.output += `  ${result.message}\n`;
                    }
                    // Signed-return: write numeric result to DR1 (≥0 success, <0 fault).
                    // DR0 remains zero unconditionally; callers branch on DR1 via BGE/BLT.
                    const _ledMethodSel = (dr1 >>> 24) & 0xFF;
                    const _ledMethodNames = ['Set', 'Clear', 'Toggle', 'State'];
                    const _ledMethodName = _ledMethodNames[_ledMethodSel <= 3 ? _ledMethodSel : 0] || 'Set';
                    const _ledOffsetDisp = dr1 & 0x3F;
                    if (result && result.result !== undefined && typeof result.result === 'number') {
                        // Generic signed-return capture (LED driver path always uses the convention).
                        this._recordSignedReturn(12, _ledMethodName, result.result, { ledIndex: _ledOffsetDisp });
                        this.output += `DR1 = ${result.result}  [LED.${_ledMethodName} index=${_ledOffsetDisp}]\n`;
                    }
                    if (result && !result.ok && result.fault) {
                        this.fault(result.fault, `LED driver: ${result.message}`);
                        return null;
                    }
                }

                this.pc++;
                const ledMethodNames = ['Set', 'Clear', 'Toggle', 'State'];
                const ledMethodSel = (dr1 >>> 24) & 0xFF;
                const ledMethodName = ledMethodNames[ledMethodSel <= 3 ? ledMethodSel : 0] || 'Set';
                const ledOffsetDisp = dr1 & 0x3F;
                return { pc: this.pc - 1, instr: d, desc, pipeline: [
                    { stage: 'CALL', desc: `Enter LED driver`, perm: 'E', status: 'pass' },
                    { stage: 'DISPATCH', desc: `LED.${ledMethodName}(offset=${ledOffsetDisp}) — DR1 signed return`, status: 'pass' },
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
        // M-window writeback gate: must fire before frame pop and _resetAllMBits().
        if (!this._mwinWriteback()) return null;
        const mask = d.imm & 0xFFF;
        const frame = this.callStack.pop();

        // Sentinel frame: NIA=0x7FFF (poison) signals the bottom of the call stack.
        // RETURN through the sentinel means the top-level abstraction tried to return
        // past the last frame — this is a stack-underflow fault.
        if (frame.sentinel) {
            this.fault('STACK_UNDERFLOW', 'RETURN through sentinel frame (NIA=0x7FFF) — stack underflow: no caller above the root abstraction.');
            return null;
        }

        this._resetAllMBits();   // RETURN boundary: M is reset on all CRs (architecture rule)

        // Mask semantics: set bit = PRESERVE callee's CR (return value); clear bit = restore caller's.
        // One combined pass ensures callee internal GTs are never visible to the caller
        // unless explicitly preserved as return values.
        const tnBaseRet = this.cr[12] && this.cr[12].word1;
        const clearedCRs = [];
        const preservedCRs = [];
        for (let i = 0; i < 12; i++) {
            if (mask & (1 << i)) {
                // Preserve callee's CR_i — it carries a return value to the caller
                preservedCRs.push(`CR${i}`);
            } else if (frame.savedCRs && frame.savedCRs[i] !== undefined) {
                // Not a return value — restore the caller's saved state
                this.cr[i] = {...frame.savedCRs[i]};
                if (i !== 6 && tnBaseRet) {
                    this._threadWrite(tnBaseRet + THREAD_CAPS_OFFSET + i, this.cr[i].word0 >>> 0, `RETURN CR${i}-restore`);
                }
            } else {
                // Not a return value and caller had nothing saved — scrub
                this._clearCR(i);
                clearedCRs.push(`CR${i}`);
            }
        }

        if (frame.savedDRs) {
            for (let di = 0; di < 16; di++) {
                this._writeDR(di, frame.savedDRs[di]);
            }
        }
        if (frame.savedFlags) this.flags = {...frame.savedFlags};
        if (typeof frame.savedSTO === 'number') this.sto = frame.savedSTO;
        const frameTag = frame.sz === 0 ? 'LAMBDA' : 'CALL';
        const isLeafLambda = frame.sz === 0 && this.lambdaActive && this.lambdaCachedFrame;
        if (isLeafLambda) {
            const cachedReturnPC = this.lambdaReturnPC;
            this.lambdaActive = false;
            this.lambdaCachedFrame = null;
            this.pc = cachedReturnPC;
            const cr14 = this.cr[14];
            if (cr14 && cr14.word0 !== 0) {
                const cr14Parsed = this.parseGT(cr14.word0);
                const entry = this.readNSEntry(cr14Parsed.index);
                if (entry) {
                    this.physicalPC = entry.word0_location + 1 + cachedReturnPC;
                }
            }
            const maskDesc = mask ? ` MASK=0b${mask.toString(2).padStart(12, '0')} preserved[${preservedCRs.join(',')||'none'}]` : '';
            const desc = `RETURN (LAMBDA/SZ=0) PC→${cachedReturnPC} [leaf — NIA cache, no memory read]${maskDesc}`;
            this.output += desc + '\n';
            return { pc: cachedReturnPC, instr: d, desc, pipeline: this._returnPipeline(d, frame, mask) };
        }
        const maskDesc = mask ? ` MASK=0b${mask.toString(2).padStart(12, '0')} preserved[${preservedCRs.join(',')||'none'}]` : '';
        const desc = `RETURN (${frameTag}/SZ=${frame.sz}) PC→${frame.returnPC}${maskDesc}`;
        this.output += desc + '\n';
        this.pc = frame.returnPC;
        return { pc: frame.returnPC, instr: d, desc, pipeline: this._returnPipeline(d, frame, mask) };
    }

    _execChange(d) {
        this._flushLambdaCache();

        // CHANGE CRd, CRs[idx]
        //   CRd  (d.crDst) — destination: must be a privileged register CR12–CR15.
        //   CRs  (d.crSrc) — source capability used to access the NS entry.
        //   idx  (d.imm)   — NS slot index (identifies the thread or system GT to load).
        //
        // Semantics by destination:
        //   CR12 (thread stack)  system-wide: load GT directly; no per-thread save.
        //   CR13 (interrupt handler)   system-wide: load GT directly; no per-thread save.
        //   CR14 (code register)       per-thread:  full context switch — atomically
        //      saves the outgoing thread's per-thread registers and restores the
        //      incoming thread's saved state (if any), then resumes at its saved PC.
        //   CR15 (namespace root)      per-thread:  same full context switch as CR14.
        //
        // Per-thread save covers: CR0–CR11, CR14, CR15, DR0–DR15, STO, PC, FLAGS.
        // CR12 and CR13 are system-wide — never saved or restored per-thread.

        if (d.crDst < 12) {
            this.fault('PRIV_REG', `CHANGE: target CR${d.crDst} is not privileged — CHANGE may only write CR12–CR15`);
            return null;
        }

        const srcGT = this.cr[d.crSrc].word0;
        if (srcGT === 0) {
            this.fault('NULL_CAP', `CHANGE: CR${d.crSrc} (source) is NULL`);
            return null;
        }
        const targetIdx = d.imm;
        if (targetIdx >= this.nsCount || !this.isNSEntryValid(targetIdx)) {
            this.fault('BOUNDS', `CHANGE: NS index ${targetIdx} out of bounds`);
            return null;
        }
        const entry = this.readNSEntry(targetIdx);
        if (!entry) {
            this.fault('BOUNDS', `CHANGE: NS entry ${targetIdx} is null`);
            return null;
        }
        const gtRead = this._capRead(d.crSrc, entry.word0_location, null, `CHANGE CR${d.crDst}`);
        if (!gtRead.ok) {
            this.fault(gtRead.fault, gtRead.message);
            return null;
        }
        const gt = gtRead.value || 0;

        // ── System-wide registers (CR12/CR13): direct privileged write, no save ──
        if (d.crDst === 12 || d.crDst === 13) {
            // Authority check: source cap must carry S-perm and its location must
            // match the target CR's port address in the Church Hardware Address Range.
            // M-elevation during boot (this.mElevation) bypasses this check.
            //
            // CHANGE CR12 first-activation bypass: mirrors the hardware RESTORE_CALL FSM
            // which runs unconditionally on the first CHANGE CR12 after boot (before any
            // per-thread state has been saved).  The Boot.Abstr program uses CR12's own
            // zero-perm GT as the source, so S-perm is never present; the first-activation
            // path is privileged by construction (it can only be reached from Boot.Abstr).
            //
            // The bypass is deliberately narrowed to crSrc === crDst === 12 — the
            // "self-reload" pattern used exclusively by Boot.Abstr.  Any CHANGE CR12 that
            // names a DIFFERENT source register (e.g. T11: crSrc=0) must still satisfy
            // the full S-perm + port-address authority check.
            const isFirstActivation = d.crDst === 12 && d.crSrc === 12 &&
                (!this._threadContextMap || !this._threadContextMap.has(targetIdx));
            if (!this.mElevation && !isFirstActivation) {
                const srcParsed = this.parseGT(this.cr[d.crSrc].word0);
                if (!srcParsed.permissions['S']) {
                    this.fault('PERM_S', `CHANGE CR${d.crDst}: source CR${d.crSrc} lacks S-perm (required for system-wide CR12/CR13 write)`);
                    return null;
                }
                const expectedPort = (d.crDst === 12) ? CR_PORT_CR12 : CR_PORT_CR13;
                const srcLocation = (this.cr[d.crSrc].word1 >>> 0);
                if (srcLocation !== (expectedPort >>> 0)) {
                    this.fault('PERM_S', `CHANGE CR${d.crDst}: source CR${d.crSrc} location 0x${srcLocation.toString(16).padStart(8,'0')} does not match CR${d.crDst} port address 0x${expectedPort.toString(16).padStart(8,'0')}`);
                    return null;
                }
            }
            // ── CHANGE CR12: synthesize a valid zero-perm GT ──────────────────────
            // The raw word at entry.word0_location is the thread lump header (magic+cc+cw),
            // not a valid GT.  Using it as cr[12].word0 would break every subsequent
            // mLoad(cr12.word0, ...) call (e.g. CALL thread-hdr read, _threadRead, _threadWrite).
            // Instead synthesise a zero-perm Inform GT for targetIdx, matching the GT
            // created by the boot ROM in B:02 (INIT_THRD).  The gt_seq is taken from the
            // NS entry so mLoad's version check passes.
            const gtToWrite = (d.crDst === 12)
                ? this.createGT((entry.word2_seals >>> 25) & 0x7F, targetIdx, {R:0,W:0,X:0,L:0,S:0,E:0}, 1)
                : gt;
            if (!this._writeCR(d.crDst, gtToWrite, entry)) return null;

            // ── CHANGE CR12: mirror the hardware RESTORE_CALL FSM ──────────────────
            // When mElevation=true (boot) or when this thread slot has never been
            // suspended (first-activation), the hardware loads CR0–CR11 from the
            // incoming thread's caps zone (thread[+THREAD_CAPS_OFFSET .. +THREAD_CAPS_OFFSET+11]).
            // Without this restore the subsequent TPERM/CALL will see NULL in CR0 and fault.
            //
            // Note: we populate the CRs directly rather than via _writeCR because at this
            // point cr[12].word0 holds the raw lump-header word (the GT read from the thread
            // lump's first word), which is not a valid GT and would cause _writeCR's
            // home-slot mLoad authority check to fault.  The RESTORE_CALL FSM is a hardware-
            // privileged operation that bypasses normal capability authority checking.
            const doRestoreCall = d.crDst === 12 && (this.mElevation || isFirstActivation);
            if (doRestoreCall) {
                const threadEntry = this.readNSEntry(targetIdx);
                if (threadEntry) {
                    const tBase = threadEntry.word0_location;
                    for (let i = 0; i < 12; i++) {
                        const gtWord = this.memory[tBase + THREAD_CAPS_OFFSET + i] >>> 0;
                        if (gtWord !== 0) {
                            const capEntry = this.readNSEntry(this.parseGT(gtWord).index);
                            if (capEntry) {
                                this.cr[i] = {
                                    word0: gtWord,
                                    word1: capEntry.word0_location >>> 0,
                                    word2: capEntry.word1_limit >>> 0,
                                    word3: 0,
                                    m: 0,
                                };
                            } else {
                                this.cr[i] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
                            }
                        } else {
                            this.cr[i] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
                        }
                    }
                }
            }

            const desc = `CHANGE CR${d.crDst} (system-wide${doRestoreCall ? `; RESTORE_CALL: CR0–CR11 loaded from thread[+${THREAD_CAPS_OFFSET}..+${THREAD_CAPS_OFFSET + 11}]` : '; CR12/CR13 unchanged by context switch'}) <- [CR${d.crSrc}+${targetIdx}]`;
            this.output += desc + '\n';
            this.pc++;
            return { pc: this.pc - 1, instr: d, desc };
        }

        // ── Per-thread registers (CR14/CR15): full context switch ─────────────────
        // 1. Save outgoing thread state (CR0–CR11, CR14, CR15, DR0–DR15, STO, PC+1).
        //    CR12/CR13 are system-wide and excluded from the per-thread snapshot.
        if (!this._threadContextMap) this._threadContextMap = new Map();
        const outSlot = this._currentThreadSlot ?? null;
        this._threadContextMap.set(outSlot, {
            crs:   this.cr.slice(0, 12).map(c => ({ ...c })),  // CR0–CR11 only
            cr14:  { ...this.cr[14] },
            cr15:  { ...this.cr[15] },
            drs:   [...this.dr],
            flags: { ...this.flags },
            sto:   this.sto,
            pc:    this.pc + 1,   // resume at the instruction *after* this CHANGE
        });

        const inState = this._threadContextMap.get(targetIdx);

        // 2a. Restore incoming thread state if it was previously suspended.
        //     Use the incoming thread's own saved CR14/CR15 (not the instruction's gt).
        if (inState) {
            for (let i = 0; i < 12; i++) this.cr[i] = { ...inState.crs[i] };
            this.cr[14] = { ...inState.cr14 };
            this.cr[15] = { ...inState.cr15 };
            this.dr = [...inState.drs];
            this.flags = { ...inState.flags };
            this.sto = inState.sto;
            this._currentThreadSlot = targetIdx;
            const resumePC = inState.pc;
            const desc = `CHANGE CR${d.crDst} (context switch: CR0–CR11+CR14+CR15+DRs saved for slot ${outSlot !== null ? outSlot : 'boot'}; resuming slot ${targetIdx} at PC=${resumePC}; CR12/CR13 unchanged)`;
            this.output += desc + '\n';
            this.pc = resumePC;   // resume at saved PC (no additional increment)
            return { pc: resumePC, instr: d, desc };
        }

        // 2b. First activation of this thread slot: synthesise a valid R+X GT for the
        //     target NS slot and install it into the destination CR.
        //
        //     The raw word at entry.word0_location is the thread lump header
        //     (magic + cc + cw), NOT a valid Golden Token.  Writing it into
        //     CR14.word0 would corrupt every subsequent mLoad / code-lump fetch
        //     with a bogus NS index or version.  This is the same class of bug
        //     fixed for CR12 in Task #655.
        //
        //     Instead synthesise a valid R+X GT matching the B:07 NUC_CODE boot
        //     ROM pattern (line 1575: createGT with R+X, same gt_seq as the NS
        //     entry so mLoad's version check passes).
        const fa_gt_seq = (entry.word2_seals >>> 25) & 0x7F;
        const codeGT = this.createGT(fa_gt_seq, targetIdx, {R:1,W:0,X:1,L:0,S:0,E:0}, 1);
        if (!this._writeCR(d.crDst, codeGT, entry)) return null;
        // Restore CR0–CR11 from the incoming thread lump's caps zone (THREAD_CAPS_OFFSET).
        // Mirrors hardware RESTORE_CALL FSM: cr_index=i → c-list[i] → thread word tBase+THREAD_CAPS_OFFSET+i.
        // CR0 slot (thread[+244]) holds the programmable Entry E-GT (written by SetEntry / setBootEntrySlot).
        const threadEntry = this.readNSEntry(targetIdx);
        if (threadEntry) {
            const tBase = threadEntry.word0_location;
            for (let i = 0; i < 12; i++) {
                const gtWord = this.memory[tBase + THREAD_CAPS_OFFSET + i] >>> 0;
                if (gtWord !== 0) {
                    const capEntry = this.readNSEntry(this.parseGT(gtWord).index);
                    this._writeCR(i, gtWord, capEntry);
                } else {
                    this.cr[i] = { word0: 0, word1: 0, word2: 0, word3: 0 };
                }
            }
        }
        this._currentThreadSlot = targetIdx;
        const desc = `CHANGE CR${d.crDst} (context switch: CR0–CR11+CR14+CR15+DRs saved for slot ${outSlot !== null ? outSlot : 'boot'}; first activation of slot ${targetIdx} — starting at PC=0; CR0 restored from thread[+244]; CR12/CR13 unchanged) <- [CR${d.crSrc}+${targetIdx}]`;
        this.output += desc + '\n';
        this.pc = 0;   // first activation always begins at PC=0
        return { pc: 0, instr: d, desc };
    }

    _execSwitch(d) {
        // Hardware reference: hardware/switch.py — PassKey-gated one-way privileged install.
        // Three hard checks before any register is touched; source is never modified.
        // (D-11 CLOSED: simulator now matches hardware behaviour.)

        const target = d.imm & 0x7;

        // 1. Target validity — only Tgt=5 (→CR13) and Tgt=7 (→CR15) are permitted.
        const SWITCH_TGT_CR13 = 5;
        const SWITCH_TGT_CR15 = 7;
        if (target !== SWITCH_TGT_CR13 && target !== SWITCH_TGT_CR15) {
            this.fault('INVALID_OP', `SWITCH: target ${target} is not a valid SWITCH target (must be 5→CR13 or 7→CR15)`);
            return null;
        }
        const destCR = (target === SWITCH_TGT_CR13) ? 13 : 15;

        // 2. Source range check — crSrc must be 0–7 (lower CR bank).
        if (d.crSrc > 7) {
            this.fault('INVALID_OP', `SWITCH: source CR${d.crSrc} out of range (must be CR0–CR7)`);
            return null;
        }
        const srcCR = this.cr[d.crSrc];

        // 3. PassKey type check — source must be Abstract GT (gt_type == 3).
        //    NULL (type 0), Inform (type 1), and Outform (type 2) all fault here.
        if (srcCR.word0 === 0) {
            this.fault('INVALID_OP', `SWITCH: CR${d.crSrc} is NULL — must be an Abstract PassKey GT`);
            return null;
        }
        const parsed = this.parseGT(srcCR.word0);
        if (parsed.type !== 3) {
            this.fault('INVALID_OP', `SWITCH: CR${d.crSrc} is ${parsed.typeName} (type ${parsed.type}) — must be Abstract (type 3) PassKey GT`);
            return null;
        }

        // 4. Sentinel address check — CR.word1 (location) must equal the hardware-reserved
        //    sentinel for the chosen target: 0xFFFFFFFE for CR13, 0xFFFFFFFF for CR15.
        const SENTINEL_CR13 = 0xFFFFFFFE;
        const SENTINEL_CR15 = 0xFFFFFFFF;
        const expectedSentinel = (destCR === 13) ? SENTINEL_CR13 : SENTINEL_CR15;
        if ((srcCR.word1 >>> 0) !== expectedSentinel) {
            const got = (srcCR.word1 >>> 0).toString(16).toUpperCase().padStart(8, '0');
            const exp = expectedSentinel.toString(16).toUpperCase();
            this.fault('INVALID_OP', `SWITCH: CR${d.crSrc}.location=0x${got} ≠ sentinel 0x${exp} required for CR${destCR}`);
            return null;
        }

        // 5. One-way privileged install — copy source into target; source CR is NOT modified.
        //    Hardware uses ChurchMLoad with m_elevated=1 which also resets G=0 on the NS entry;
        //    in the simulator we copy the full CR object straight (NS G-bit is managed by LOAD/mLoad paths).
        this.cr[destCR] = { ...srcCR };

        const desc = `SWITCH CR${d.crSrc} → CR${destCR} (PassKey install; source unchanged)`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc };
    }

    _execTperm(d) {
        // Mode 2: capability attenuation — imm15 = 0x7FFF (all 15 bits set).
        // Reads the source GT from CRd, reads the requested permission subset from CRs,
        // validates that requested ⊆ source (no expansion), then writes the attenuated
        // GT (source NS metadata + requested permissions) back to CRd.
        // Flags: Z=1 on success, Z=0 on failure (NULL source or expansion attempt); N=!Z, C=0, V=0.
        if (d.imm === 0x7FFF) {
            const srcGT = this.cr[d.crDst].word0;

            // NULL source GT → Z=0, N=1, no fault
            if (srcGT === 0) {
                this.flags.Z = false;
                this.flags.N = true;
                this.flags.C = false;
                this.flags.V = false;
                const desc = `TPERM CR${d.crDst}, ATTENUATE [MODE2] NULL source GT — Z=0`;
                this.output += desc + '\n';
                this.pc++;
                return { pc: this.pc - 1, instr: d, desc };
            }

            const srcParsed = this.parseGT(srcGT);
            const reqGT     = this.cr[d.crSrc].word0;
            const reqParsed = this.parseGT(reqGT);
            const srcPerms  = srcParsed.permissions;
            const reqPerms  = reqParsed.permissions;

            // Validate: every requested permission must already be held by the source GT.
            // If any requested bit is absent from the source, it is an expansion attempt → Z=0.
            const PERM_KEYS = ['R', 'W', 'X', 'L', 'S', 'E'];
            let isExpansion = false;
            for (const p of PERM_KEYS) {
                if (reqPerms[p] && !srcPerms[p]) {
                    isExpansion = true;
                    break;
                }
            }

            const srcPermStr = PERM_KEYS.filter(p => srcPerms[p]).join('') || 'CLEAR';
            const reqPermStr = PERM_KEYS.filter(p => reqPerms[p]).join('') || 'CLEAR';

            if (isExpansion) {
                this.flags.Z = false;
                this.flags.N = true;
                this.flags.C = false;
                this.flags.V = false;
                const desc = `TPERM CR${d.crDst}, ATTENUATE [MODE2] expansion {${reqPermStr}} ⊄ {${srcPermStr}} — Z=0`;
                this.output += desc + '\n';
                this.pc++;
                return { pc: this.pc - 1, instr: d, desc };
            }

            // Build attenuated GT: source NS metadata (index, version, type) + requested permissions.
            // The B (Busy) bit is object-lock metadata, not a grantable permission — inherit it
            // from the source GT so the lock state of the object is preserved accurately.
            const newPerms = { R: reqPerms.R, W: reqPerms.W, X: reqPerms.X,
                               L: reqPerms.L, S: reqPerms.S, E: reqPerms.E,
                               B: srcPerms.B };
            const newGT = this.createGT(srcParsed.gt_seq, srcParsed.index, newPerms, srcParsed.type);
            this.cr[d.crDst].word0 = newGT;

            this.flags.Z = true;
            this.flags.N = false;
            this.flags.C = false;
            this.flags.V = false;

            const desc = `TPERM CR${d.crDst}, ATTENUATE [MODE2] {${srcPermStr}} → {${reqPermStr}} — Z=1`;
            this.output += desc + '\n';
            this.pc++;
            return { pc: this.pc - 1, instr: d, desc };
        }

        const gt = this.cr[d.crDst].word0;
        const bSet = (d.imm >>> 4) & 1;
        const presetCode = d.imm & 0xF;
        const presetMasks = this.tpermPresetMasks;

        // TPERM EXACT (preset 14): credential-pinning assertion — 32-bit identity check CRd.word0 === CRs.word0.
        // Match: sets Z=1 and continues (credential confirmed).
        // Mismatch: hard fault BIND — same semantics as mLoad permission failure.
        // There is no Z=0 path; EXACT has no alternative meaning.
        if (presetMasks[presetCode] === 'EXACT') {
            const crdGT = this.cr[d.crDst].word0 >>> 0;
            const crsGT = this.cr[d.crSrc].word0 >>> 0;
            if (crdGT !== crsGT) {
                this.fault('BIND', `TPERM CR${d.crDst} EXACT [14]: credential mismatch — 0x${crdGT.toString(16).padStart(8,'0')} vs CR${d.crSrc} 0x${crsGT.toString(16).padStart(8,'0')} — BIND fault`);
                return null;
            }
            this.flags.Z = true; this.flags.N = false; this.flags.C = false; this.flags.V = false;
            const descExact = `TPERM CR${d.crDst} EXACT [14]: credential match — Z=1`;
            this.output += descExact + '\n';
            this.pc++;
            return { pc: this.pc - 1, instr: d, desc: descExact };
        }

        // TPERM FRAME (preset 13): call-stack query — does a real return frame exist?
        // Z=1 if the top of the call stack is a genuine caller frame (RETURN would succeed).
        // Z=0 if the stack is empty or only the boot sentinel remains.
        // crDst is ignored; no GT is read; no frame is pushed.
        if (presetMasks[presetCode] === 'FRAME') {
            const hasFrame = this.callStack.length > 0 &&
                             this.callStack[this.callStack.length - 1].returnPC !== 0x7FFF;
            this.flags.Z = hasFrame;
            this.flags.N = !hasFrame;
            this.flags.C = false;
            this.flags.V = false;
            const descFrame = `TPERM CR${d.crDst} FRAME [13]: ${hasFrame ? 'frame exists' : 'no frame'} (depth=${this.callStack.length}) — Z=${hasFrame ? 1 : 0}`;
            this.output += descFrame + '\n';
            this.pc++;
            return { pc: this.pc - 1, instr: d, desc: descFrame };
        }

        if (presetMasks[presetCode] === null) {
            this.fault('TPERM_RSV', `TPERM CR${d.crDst}: reserved preset code ${presetCode} — hardware fault`);
            return null;
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

        // GT bounds check (C.2): verify base + size fits inside the permitted
        // memory region (below the NS table).  Hardware rejects the GT when the
        // span [word0_location .. word0_location + limit] overlaps the NS table.
        // This is a flag-setting failure, not a hard fault.
        // Uses JS float64 arithmetic (no >>> 0) to detect 32-bit overflow:
        // if location + limitOffset > 0xFFFFFFFF the true sum still fits in
        // float64, so we can compare it against NS_TABLE_BASE without wrapping.
        if (parsed.index < this.MAX_NS_ENTRIES) {
            const nsEntryBase = this.NS_TABLE_BASE + parsed.index * this.NS_ENTRY_WORDS;
            const location    = (this.memory[nsEntryBase]     >>> 0);  // word0: base (words)
            const limitWord   = (this.memory[nsEntryBase + 1] >>> 0);  // word1: packed
            const limitOffset = this.parseNSWord1(limitWord).limit;    // bits[16:0]
            // Check unconditionally — location=0 is a valid base address.
            // sumF64 is computed in float64 so 32-bit overflow is detectable.
            const sumF64 = location + limitOffset;
            if (sumF64 >= this.NS_TABLE_BASE || sumF64 > 0xFFFFFFFF) {
                this.flags.Z = false;
                this.flags.N = true;
                this.flags.C = false;
                this.flags.V = false;
                const desc = `TPERM CR${d.crDst}: GT bounds fail (${location}+${limitOffset}=${sumF64} >= NS=${this.NS_TABLE_BASE}) — Z=0`;
                this.output += desc + '\n';
                this.pc++;
                return { pc: this.pc - 1, instr: d, desc };
            }
        }

        // Full 3×3 domain-purity check on the TPERM result permissions.
        // Mirrors hardware perm_check.py:
        //   DATA_PERMS = R | W | X   (Turing domain)
        //   CAP_PERMS  = L | S | E   (Church domain)
        //   domain_purity_ok = ~(has_turing & has_church)
        // All 9 cross-pairs {R,W,X}×{L,S,E} are forbidden at creation time.
        // TPERM can only attenuate (intersect) permissions, so if the result is
        // mixed the preset and GT were already incompatible.
        const resultR   = required.includes('R') && !!parsed.permissions['R'];
        const resultW   = required.includes('W') && !!parsed.permissions['W'];
        const resultX   = required.includes('X') && !!parsed.permissions['X'];
        const resultL   = required.includes('L') && !!parsed.permissions['L'];
        const resultS   = required.includes('S') && !!parsed.permissions['S'];
        const resultE   = required.includes('E') && !!parsed.permissions['E'];
        if ((resultR || resultW || resultX) && (resultL || resultS || resultE)) {
            this.fault('TPERM_RSV', `TPERM CR${d.crDst}: result mixes Turing {R,W,X} with Church {L,S,E} permissions — domain-purity violation`);
            return null;
        }

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
        // D-9 idempotent re-entry rule (hardware/core.py nested_lambda_fault):
        //   LAMBDA CR6 (CR_CLIST) while lambdaActive=1 → idempotent, permitted.
        //   LAMBDA CRn (n≠6)      while lambdaActive=1 → INVALID_OP fault.
        if (this.lambdaActive && crIdx !== 6) {
            this.fault('INVALID_OP', `LAMBDA CR${crIdx}: nested LAMBDA while lambda_active=1 is not permitted (CR${crIdx} ≠ CR6/CR_CLIST)`);
            return null;
        }
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

        this._flushLambdaCache();

        const savedSTO = this.sto;
        const lambdaThreadBase = this.cr[12] && this.cr[12].word1;
        if (lambdaThreadBase) {
            const hdrRead = this._threadRead(lambdaThreadBase, `LAMBDA CR${crIdx} thread-hdr`);
            if (!hdrRead.ok) return null;
            const threadHdr = this.parseLumpHeader(hdrRead.value);
            const threadLumpSize = threadHdr.valid ? threadHdr.lumpSize : 256;
            const threadCC = threadHdr.valid ? threadHdr.cc : 0;
            const heapEnd = 1 + 16 + threadCC;
            const sw = (threadHdr.valid && threadHdr.typ === 2) ? threadHdr.cw : 0;
            const sp_max = threadLumpSize - 12 - 1;
            const sp_min = sp_max - sw + 1;
            const newSTO = (savedSTO - 1) & 0xFFF;
            if (newSTO < sp_min) {
                this.flags.V = true;
                this.output += `[STACK WARNING] LAMBDA CR${crIdx}: STO=${newSTO} below sw limit sp_min=${sp_min} (sw=${sw}) — V flag set\n`;
            }
            if (savedSTO < heapEnd) {
                this.fault('BOUNDS', `LAMBDA CR${crIdx}: stack overflow — STO=${savedSTO} would write into heap/DR zone (heapEnd=${heapEnd})`);
                return null;
            }
            if (savedSTO >= threadLumpSize) {
                this.fault('BOUNDS', `LAMBDA CR${crIdx}: stack frame address ${savedSTO} out of thread lump (size=${threadLumpSize})`);
                return null;
            }
        }
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
        this.lambdaActive = true;
        this.lambdaReturnPC = this.pc + 1;
        this.lambdaCachedFrame = { addr: savedSTO, word: frameWord, threadBase: lambdaThreadBase };
        this.sto = (savedSTO - 1) & 0xFFF;

        const label = this.nsLabels[check.index] || 'reduction';
        const desc = `LAMBDA CR${crIdx} -> ${label} [SZ=0, STO:${savedSTO}->${this.sto}]`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: this._lambdaPipeline(d, label) };
    }

    _execEloadcall(d) {
        this._flushLambdaCache();

        const clistGT = this.cr[d.crSrc].word0;
        if (clistGT === 0) {
            this.fault('NULL_CAP', `ELOADCALL: CR${d.crSrc} C-List is NULL`);
            return null;
        }
        let srcLoc;
        let ecClistSize;
        if (d.crSrc === 6) {
            srcLoc = this.cr[d.crSrc].word1;
            ecClistSize = this.parseNSWord1(this.cr[6].word2).clistCount;
        } else {
            const lumpBase = this.cr[d.crSrc].word1;
            const hdrRead = this._capRead(d.crSrc, lumpBase, 'R', `ELOADCALL CR${d.crSrc} lump-hdr`);
            if (!hdrRead.ok) { this.fault(hdrRead.fault, hdrRead.message); return null; }
            const hdr = this.parseLumpHeader(hdrRead.value);
            srcLoc = (hdr.valid && hdr.cc > 0) ? (lumpBase + hdr.lumpSize - hdr.cc) >>> 0 : lumpBase;
            ecClistSize = (hdr.valid && hdr.cc > 0) ? hdr.cc : 1;
        }
        // imm15[14:8] = method index (0–127); imm15[7:0] = c-list row (0–255).
        const ecRow = d.imm & 0xFF;
        const ecMethodIdx = (d.imm >>> 8) & 0x7F;
        const ecAbsAddr = (srcLoc + ecRow) >>> 0;
        const ecClistRange = { base: srcLoc, upperBound: (srcLoc + ecClistSize - 1) >>> 0 };
        const loadCheck = this.mLoad(clistGT, d.crSrc === 6 ? null : 'L', d.crSrc, ecAbsAddr, ecClistRange);
        if (!loadCheck.ok) {
            this.fault(loadCheck.fault, `ELOADCALL LOAD: CR${d.crSrc}: ${loadCheck.message}`);
            return null;
        }

        let slotGT = this.memory[srcLoc + ecRow] || 0;
        if (slotGT === 0) {
            const _pc = this.programCapabilities;
            const _pce = _pc && _pc[ecRow];
            const _pcn = _pce ? (typeof _pce === 'string' ? _pce : (_pce.name || null)) : null;
            // ── Lazy-Resolve: NULL GT with pet name → suspend thread (Task #1519) ──
            if (_pcn) {
                let _resolvedNsIdx = -1;
                for (const [_ridx, _rlbl] of Object.entries(this.nsLabels)) {
                    if (String(_rlbl).toUpperCase() === _pcn.toUpperCase()) {
                        _resolvedNsIdx = parseInt(_ridx, 10);
                        break;
                    }
                }
                if (_resolvedNsIdx >= 0 && this.isNSEntryValid(_resolvedNsIdx)) {
                    const _resolvedGT = this.createGT(0, _resolvedNsIdx, {R:0,W:0,X:0,L:0,S:0,E:1}, 1);
                    this.memory[srcLoc + ecRow] = _resolvedGT >>> 0;
                    slotGT = _resolvedGT >>> 0;
                    this.output += `[LAZY-RESOLVE] NULL Slot ${ecRow} "${_pcn}" \u2192 NS[${_resolvedNsIdx}] resolved instantly.\n`;
                    // Fall through to continue ELOADCALL processing
                } else {
                    this._pendingResolves.set(ecRow, {
                        petName: _pcn, slot: ecRow, instrName: 'ELOADCALL', kind: 'NULL_GT',
                        pc: this.pc,
                        savedDRs: [...this.dr],
                        savedCRs: this.cr.map(c => ({ ...c })),
                        savedFlags: { ...this.flags },
                        savedSto: this.sto,
                    });
                    this._lazySuspended = true;
                    this.output += `[LAZY-RESOLVE] ELOADCALL: c-list row ${ecRow} "${_pcn}" is NULL \u2014 thread suspended; link Pet name '${_pcn}' to a live NS entry to resume.\n`;
                    this.emit('lazyResolvePending', { petName: _pcn, slot: ecRow, instrName: 'ELOADCALL', kind: 'NULL_GT' });
                    // ── Fire Scheduler.IRQ(LAZY_RESOLVE) so the scheduler can suspend
                    // this thread and wake it when the pending c-list slot is resolved
                    // (Task #1527: wire LAZY_RESOLVE into the ELOADCALL pipeline).
                    this._fireSchedulerIRQ('LAZY_RESOLVE', null, ecRow);
                    return { lazySuspended: true, petName: _pcn, slot: ecRow, instrName: 'ELOADCALL', kind: 'NULL_GT', pc: this.pc, instr: d, desc: `ELOADCALL: waiting for '${_pcn}' (slot ${ecRow})` };
                }
            } else if (this.petNameMemory.has(ecRow)) {
                // petNameMemory: slot was registered via IO_PORT_PET_NAME_WR or markNamedSlots().
                // Fire Scheduler.IRQ(LAZY_RESOLVE) instead of a hard NULL_CAP fault.
                this._pendingResolves.set(ecRow, {
                    petName: `slot${ecRow}`, slot: ecRow, instrName: 'ELOADCALL', kind: 'NULL_GT',
                    pc: this.pc,
                    savedDRs: [...this.dr],
                    savedCRs: this.cr.map(c => ({ ...c })),
                    savedFlags: { ...this.flags },
                    savedSto: this.sto,
                });
                this._lazySuspended = true;
                this.output += `[LAZY-RESOLVE] ELOADCALL: c-list slot ${ecRow} is named (PetNameMemory) \u2014 firing Scheduler.IRQ(LAZY_RESOLVE, slot=${ecRow})\n`;
                this.emit('lazyResolvePending', { petName: `slot${ecRow}`, slot: ecRow, instrName: 'ELOADCALL', kind: 'NULL_GT' });
                this._fireSchedulerIRQ('LAZY_RESOLVE', null, ecRow);
                return { lazySuspended: true, petName: `slot${ecRow}`, slot: ecRow, instrName: 'ELOADCALL',
                         kind: 'NULL_GT', pc: this.pc, instr: d,
                         desc: `ELOADCALL: named slot ${ecRow} (PetNameMemory) \u2014 Scheduler.IRQ(LAZY_RESOLVE) fired` };
            } else {
                this.fault('NULL_CAP', `ELOADCALL: c-list row ${ecRow} is empty`);
                return null;
            }
        }
        // ── Lazy-Resolve: pending GT intercept (ELOADCALL) ────────────────────────
        // A pending sentinel (0xFEED____) means the slot has a declared pet name
        // but has not yet been introduced to a live GT.  Attempt instant resolution
        // for system abstractions with a fixed NS label; fire a structured
        // Scheduler.IRQ(LAZY_RESOLVE) for instance-specific abstractions (Task #1527).
        if (ChurchSimulator.isPendingGT(slotGT)) {
            const _pendingName = ChurchSimulator.pendingGTName(slotGT);
            let _resolvedNsIdx = -1;
            for (const [_ridx, _rlbl] of Object.entries(this.nsLabels)) {
                if (String(_rlbl).toUpperCase() === _pendingName.toUpperCase()) {
                    _resolvedNsIdx = parseInt(_ridx, 10);
                    break;
                }
            }
            if (_resolvedNsIdx >= 0 && this.isNSEntryValid(_resolvedNsIdx)) {
                const _resolvedGT = this.createGT(0, _resolvedNsIdx, {R:0,W:0,X:0,L:0,S:0,E:1}, 1);
                this.memory[srcLoc + ecRow] = _resolvedGT >>> 0;
                slotGT = _resolvedGT >>> 0;
                this.output += `[LAZY-RESOLVE] ELOADCALL: Slot ${ecRow} "${_pendingName}" \u2192 NS[${_resolvedNsIdx}] resolved instantly.\n`;
                // Fall through to continue ELOADCALL processing
            } else {
                this.output += `[LAZY-RESOLVE] ELOADCALL: c-list slot ${ecRow} "${_pendingName}" is pending \u2014 firing Scheduler.IRQ(LAZY_RESOLVE, slot=${ecRow})\n`;
                this._fireSchedulerIRQ('LAZY_RESOLVE', null, ecRow);
                return { lazySuspended: true, petName: _pendingName, slot: ecRow, instrName: 'ELOADCALL',
                         kind: 'PENDING_GT', pc: this.pc, instr: d,
                         desc: `ELOADCALL: pending slot ${ecRow} ('${_pendingName}') — Scheduler.IRQ(LAZY_RESOLVE) fired` };
            }
        }
        let slotParsed = this.parseGT(slotGT);
        const targetIdx = slotParsed.index;
        if (targetIdx >= this.nsCount || !this.isNSEntryValid(targetIdx)) {
            this.fault('BOUNDS', `ELOADCALL: namespace index ${targetIdx} out of bounds`);
            return null;
        }
        let entry = this.readNSEntry(targetIdx);
        if (!entry) {
            this.fault('BOUNDS', `ELOADCALL: entry ${targetIdx} is null`);
            return null;
        }
        // Mode 2 — Outform: the c-list slot holds a GT with type=2 (Outform).
        // Intercept before the TPERM check so the lazy loader fires and the
        // slot GT is promoted to Inform before the combined LOAD+CALL continues.
        if (slotParsed.type === 2) {
            const manifest2 = this.lazyManifest[targetIdx];
            if (manifest2 && !manifest2.loaded) {
                this.output += `[LOADER] ELOADCALL: c-list [CR${d.crSrc} + ${ecRow}] is Outform GT (NS[${targetIdx}]) — dispatching Loader (Mode 2)...\n`;
                const loaded = this._dispatchLoaderLoad(targetIdx);
                if (!loaded) {
                    this.fault('CODE_NOT_RESIDENT', `ELOADCALL: Outform lazy load failed for slot ${targetIdx}`);
                    return null;
                }
            }
            // Promote the slot GT from Outform→Inform so the TPERM check and
            // subsequent CALL phase operate on a valid Inform GT.
            const nsW2_promote = this.memory[this.NS_TABLE_BASE + targetIdx * this.NS_ENTRY_WORDS + 2];
            const gt_seq_promote = (nsW2_promote >>> 25) & 0x7F;
            slotGT = this.createGT(gt_seq_promote, targetIdx, slotParsed.permissions, 1);
            slotParsed = this.parseGT(slotGT);
            // Re-read the NS entry so subsequent checks (_absentLumpIntercept,
            // validateMAC, _writeCR) see the promoted Inform state.
            entry = this.readNSEntry(targetIdx);
            this.output += `[LOADER] ELOADCALL: Outform→Inform promotion complete for NS[${targetIdx}], proceeding with LOAD+CALL\n`;
        }
        // ── Absent-lump intercept ─────────────────────────────────────────────
        const absentEC = this._absentLumpIntercept(entry, targetIdx, d, 'ELOADCALL');
        if (absentEC) return absentEC;
        // ─────────────────────────────────────────────────────────────────────
        if (!this.validateMAC(entry)) {
            this.fault('SEAL', `ELOADCALL: entry ${targetIdx} seal failed`);
            return null;
        }

        // Validate the slot GT and gather TPERM / CR14 data before touching any CRs.
        const tpermCheck = this.mLoad(slotGT, 'E', undefined);
        if (!tpermCheck.ok) {
            this.fault(tpermCheck.fault, `ELOADCALL TPERM: CR${d.crDst}: ${tpermCheck.message}`);
            return null;
        }
        const clistEntry = tpermCheck.entry;
        const clistLoc = clistEntry.word0_location;
        const cr14Read = this.mLoad(slotGT, 'E', undefined, clistLoc);
        if (!cr14Read.ok) {
            this.fault(cr14Read.fault, `ELOADCALL CR14 clist[0]: ${cr14Read.message}`);
            return null;
        }
        const cr14GT = this.memory[clistLoc];
        let cr14Check = null;
        if (cr14GT !== 0) {
            const cr14Parsed = this.parseGT(cr14GT);
            if (cr14Parsed.type === 1) {
                const cr14Entry = this.readNSEntry(cr14Parsed.index);
                if (cr14Entry) {
                    const chk = this.mLoad(cr14GT, 'X', undefined);
                    if (chk.ok) cr14Check = chk;
                }
            }
        }

        const savedSTO_ec = this.sto;
        const ecThreadBase = this.cr[12] && this.cr[12].word1;
        if (ecThreadBase) {
            const hdrRead_ec = this._threadRead(ecThreadBase, `ELOADCALL CR${d.crDst} thread-hdr`);
            if (!hdrRead_ec.ok) return null;
            const hdr_ec = this.parseLumpHeader(hdrRead_ec.value);
            const lumpSize_ec = hdr_ec.valid ? hdr_ec.lumpSize : 256;
            const sw_ec = (hdr_ec.valid && hdr_ec.typ === 2) ? hdr_ec.cw : 0;
            const sp_max_ec = lumpSize_ec - 12 - 1;
            const sp_min_ec = sp_max_ec - sw_ec + 1;
            const newSTO_ec = (savedSTO_ec - 2) & 0xFFF;
            if (newSTO_ec < sp_min_ec) {
                this.flags.V = true;
                this.output += `[STACK WARNING] ELOADCALL CR${d.crDst}: STO=${newSTO_ec} below sw limit sp_min=${sp_min_ec} (sw=${sw_ec}) — V flag set\n`;
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

        // Now write the loaded GT and set up CR6/CR14 for the callee context.
        if (!this._writeCR(d.crDst, slotGT, entry)) return null;
        if (cr14Check) {
            this._writeCR(6, slotGT, clistEntry);
            this._writeCR(14, cr14GT, cr14Check.entry);
            this.cr[6].m = 1;   // M set explicitly — CR14 does NOT need M=1; XR grants from CALL microcode are sufficient
        }

        const label = this.nsLabels[targetIdx] || 'abstraction';
        const ecIdxSuffix = ecMethodIdx > 0 ? `, #${ecMethodIdx}` : '';
        const desc = `ELOADCALL CR${d.crDst}, [CR${d.crSrc} + ${ecRow}]${ecIdxSuffix} -> ${label} (LOAD+TPERM+CALL)`;
        this.output += desc + '\n';
        const prevPC_ec = this.pc;
        if (cr14Check) {
            // Hardware method-table dispatch: method index from imm15[14:8] (ecMethodIdx).
            // ecMethodIdx=0: fast path — NIA = word 1 (pc=0).
            // ecMethodIdx=k>0: read table entry at lump word k; pc = entry - 1.
            // Entry value 0 = private method → FAULT.
            if (ecMethodIdx === 0) {
                this.pc = 0;
            } else {
                const ecMethodEntry = (this.memory[this.cr[14].word1 + ecMethodIdx] || 0) >>> 0;
                if (ecMethodEntry === 0) {
                    this.fault('PRIVATE_METHOD', `ELOADCALL CR${d.crDst}: method index ${ecMethodIdx} is private or unmapped (table entry = 0)`);
                    return null;
                }
                this.pc = ecMethodEntry - 1;
            }
        } else {
            this.fault('NO_CODE', `ELOADCALL CR${d.crDst}: target abstraction has no code capability`);
            return null;
        }
        return { pc: prevPC_ec, instr: d, desc, pipeline: this._eloadcallPipeline(d, label) };
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
            xlClistSize = this.parseNSWord1(this.cr[6].word2).clistCount;
        } else {
            const lumpBase = this.cr[d.crSrc].word1;
            const hdrRead = this._capRead(d.crSrc, lumpBase, 'R', `XLOADLAMBDA CR${d.crSrc} lump-hdr`);
            if (!hdrRead.ok) { this.fault(hdrRead.fault, hdrRead.message); return null; }
            const hdr = this.parseLumpHeader(hdrRead.value);
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

        let slotGT = this.memory[srcLoc + d.imm] || 0;
        if (slotGT === 0) {
            const _pc = this.programCapabilities;
            const _pce = _pc && _pc[d.imm];
            const _pcn = _pce ? (typeof _pce === 'string' ? _pce : (_pce.name || null)) : null;
            // ── Lazy-Resolve: NULL GT with pet name → suspend thread (Task #1519) ──
            if (_pcn) {
                let _resolvedNsIdx = -1;
                for (const [_ridx, _rlbl] of Object.entries(this.nsLabels)) {
                    if (String(_rlbl).toUpperCase() === _pcn.toUpperCase()) {
                        _resolvedNsIdx = parseInt(_ridx, 10);
                        break;
                    }
                }
                if (_resolvedNsIdx >= 0 && this.isNSEntryValid(_resolvedNsIdx)) {
                    const _resolvedGT = this.createGT(0, _resolvedNsIdx, {R:0,W:0,X:0,L:0,S:0,E:1}, 1);
                    this.memory[srcLoc + d.imm] = _resolvedGT >>> 0;
                    slotGT = _resolvedGT >>> 0;
                    this.output += `[LAZY-RESOLVE] NULL Slot ${d.imm} "${_pcn}" \u2192 NS[${_resolvedNsIdx}] resolved instantly.\n`;
                    // Fall through to continue XLOADLAMBDA processing
                } else {
                    this._pendingResolves.set(d.imm, {
                        petName: _pcn, slot: d.imm, instrName: 'XLOADLAMBDA', kind: 'NULL_GT',
                        pc: this.pc,
                        savedDRs: [...this.dr],
                        savedCRs: this.cr.map(c => ({ ...c })),
                        savedFlags: { ...this.flags },
                        savedSto: this.sto,
                    });
                    this._lazySuspended = true;
                    this.output += `[LAZY-RESOLVE] XLOADLAMBDA: c-list slot ${d.imm} "${_pcn}" is NULL \u2014 thread suspended; link Pet name '${_pcn}' to a live NS entry to resume.\n`;
                    this.emit('lazyResolvePending', { petName: _pcn, slot: d.imm, instrName: 'XLOADLAMBDA', kind: 'NULL_GT' });
                    return { lazySuspended: true, petName: _pcn, slot: d.imm, instrName: 'XLOADLAMBDA', kind: 'NULL_GT', pc: this.pc, instr: d, desc: `XLOADLAMBDA: waiting for '${_pcn}' (slot ${d.imm})` };
                }
            } else if (this.petNameMemory.has(d.imm)) {
                // petNameMemory: slot was registered via IO_PORT_PET_NAME_WR or markNamedSlots().
                // Fire Scheduler.IRQ(LAZY_RESOLVE) instead of a hard NULL_CAP fault.
                this._pendingResolves.set(d.imm, {
                    petName: `slot${d.imm}`, slot: d.imm, instrName: 'XLOADLAMBDA', kind: 'NULL_GT',
                    pc: this.pc,
                    savedDRs: [...this.dr],
                    savedCRs: this.cr.map(c => ({ ...c })),
                    savedFlags: { ...this.flags },
                    savedSto: this.sto,
                });
                this._lazySuspended = true;
                this.output += `[LAZY-RESOLVE] XLOADLAMBDA: c-list slot ${d.imm} is named (PetNameMemory) \u2014 firing Scheduler.IRQ(LAZY_RESOLVE, slot=${d.imm})\n`;
                this.emit('lazyResolvePending', { petName: `slot${d.imm}`, slot: d.imm, instrName: 'XLOADLAMBDA', kind: 'NULL_GT' });
                this._fireSchedulerIRQ('LAZY_RESOLVE', null, d.imm);
                return { lazySuspended: true, petName: `slot${d.imm}`, slot: d.imm, instrName: 'XLOADLAMBDA',
                         kind: 'NULL_GT', pc: this.pc, instr: d,
                         desc: `XLOADLAMBDA: named slot ${d.imm} (PetNameMemory) \u2014 Scheduler.IRQ(LAZY_RESOLVE) fired` };
            } else {
                this.fault('NULL_CAP', `XLOADLAMBDA: c-list offset ${d.imm} is empty`);
                return null;
            }
        }
        let slotParsed = this.parseGT(slotGT);
        const targetIdx = slotParsed.index;
        if (targetIdx >= this.nsCount || !this.isNSEntryValid(targetIdx)) {
            this.fault('BOUNDS', `XLOADLAMBDA: slot ${targetIdx} out of bounds`);
            return null;
        }
        let entry = this.readNSEntry(targetIdx);
        if (!entry) {
            this.fault('BOUNDS', `XLOADLAMBDA: slot ${targetIdx} is null`);
            return null;
        }
        // Mode 2 — Outform: the c-list slot holds a GT with type=2 (Outform).
        // Intercept before the absent-lump check so the lazy loader fires and
        // the slot GT is promoted to Inform before the LOAD+LAMBDA continues.
        if (slotParsed.type === 2) {
            const manifest2 = this.lazyManifest[targetIdx];
            if (manifest2 && !manifest2.loaded) {
                this.output += `[LOADER] XLOADLAMBDA: c-list [CR${d.crSrc} + ${d.imm}] is Outform GT (NS[${targetIdx}]) — dispatching Loader (Mode 2)...\n`;
                const loaded = this._dispatchLoaderLoad(targetIdx);
                if (!loaded) {
                    this.fault('CODE_NOT_RESIDENT', `XLOADLAMBDA: Outform lazy load failed for slot ${targetIdx}`);
                    return null;
                }
            }
            // Promote the slot GT from Outform→Inform so the TPERM check and
            // subsequent LAMBDA phase operate on a valid Inform GT.
            const nsW2_promote = this.memory[this.NS_TABLE_BASE + targetIdx * this.NS_ENTRY_WORDS + 2];
            const gt_seq_promote = (nsW2_promote >>> 25) & 0x7F;
            slotGT = this.createGT(gt_seq_promote, targetIdx, slotParsed.permissions, 1);
            slotParsed = this.parseGT(slotGT);
            // Re-read the NS entry so subsequent checks (_absentLumpIntercept,
            // validateMAC, _writeCR) see the promoted Inform state.
            entry = this.readNSEntry(targetIdx);
            this.output += `[LOADER] XLOADLAMBDA: Outform→Inform promotion complete for NS[${targetIdx}], proceeding with LOAD+LAMBDA\n`;
        }
        // ── Absent-lump intercept ─────────────────────────────────────────────
        const absentXL = this._absentLumpIntercept(entry, targetIdx, d, 'XLOADLAMBDA');
        if (absentXL) return absentXL;
        // ─────────────────────────────────────────────────────────────────────
        if (!this.validateMAC(entry)) {
            this.fault('SEAL', `XLOADLAMBDA: slot ${targetIdx} seal failed`);
            return null;
        }

        if (!this._writeCR(d.crDst, slotGT, entry)) return null;
        // M-bit: no explicit assignment needed here — intentional difference from ELOADCALL.
        // LAMBDA does not cross a domain boundary, so M is M-neutral per the ISA spec
        // (LAMBDA / REDUCE row: "M-neutral").  _writeCR already sets cr[crDst].m = 0
        // post-boot (mElevation = false), which is correct.  ELOADCALL must set CR6.m=1
        // and CR14.m=1 because it fuses a CALL which requires M-elevated c-list access;
        // XLOADLAMBDA fuses a LAMBDA which carries no such requirement.

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

    // ── Abstract Manager (Task #406) ─────────────────────────────────────────
    // Dispatches DREAD / DWRITE / CALL on Abstract GTs (type=0b11) without
    // mLoad.  Uses the M-window: _setMWindow copies the CR words to DR11–DR15
    // so the manager decodes from DR11 (not by raw bit-bashing the GT word).
    // Called from _execDread / _execDwrite / _execCall when GT type = 0b11.

    _abstractLedLabel(deviceData) {
        return `Abstract LED${deviceData}`;
    }

    _dispatchAbstractDread(crIdx, drIdx, instrOffset) {
        // Parse the abstract GT directly from the CR word (avoids clobbering DR11–DR15
        // as a side-effect; _setMWindow is only needed when calling a software
        // Abstract Manager, not for natively-dispatched device reads).
        this.cr[crIdx].m = 1;
        const info = this.parseAbstractGT(this.cr[crIdx].word0);
        if (!info.R) {
            this._clearMWindow(crIdx);
            this.fault('PERM_R', `DREAD: Abstract GT lacks R permission`);
            return null;
        }
        let result = null;
        if (info.ab_type === ChurchSimulator.AB_TYPE_IO) {
            if (info.device_class === ChurchSimulator.DEVICE_CLASS_LED) {
                const ledIdx = info.device_data;
                const value  = (this.ledBits >>> ledIdx) & 1;
                this._writeDR(drIdx, value);
                this._clearMWindow(crIdx);
                const label = this._abstractLedLabel(ledIdx);
                const desc  = `DREAD DR${drIdx} ← ${value} [${label} = ${value ? 'ON' : 'OFF'}]`;
                this.output += desc + '\n';
                this.pc++;
                return { pc: this.pc - 1, desc, pipeline: [
                    { stage: 'M-Window', desc: `CR${crIdx}(M=1) → DR11 = GT descriptor`, status: 'pass' },
                    { stage: 'DREAD',    desc: `Read ${label}`, perm: 'R', status: 'pass' },
                ]};
            }
            if (info.device_class === ChurchSimulator.DEVICE_CLASS_UART) {
                const regIdx = info.device_data;
                if (regIdx > 2) {
                    this._clearMWindow(crIdx);
                    this.fault('INVALID_OP', `DREAD: UART device_data=${regIdx} out of range [0..2]`);
                    return null;
                }
                const value = this.uartRegs[regIdx] >>> 0;
                this._writeDR(drIdx, value);
                this._clearMWindow(crIdx);
                const regName = ['TX', 'STATUS', 'RX'][regIdx];
                const desc = `DREAD DR${drIdx} ← ${value} [UART.${regName}]`;
                this.output += desc + '\n';
                this.pc++;
                return { pc: this.pc - 1, desc, pipeline: [
                    { stage: 'M-Window', desc: `CR${crIdx}(M=1) → DR11 = GT descriptor`, status: 'pass' },
                    { stage: 'DREAD',    desc: `Read UART.${regName}`, perm: 'R', status: 'pass' },
                ]};
            }
            if (info.device_class === ChurchSimulator.DEVICE_CLASS_BUTTON) {
                const regIdx = info.device_data;
                if (regIdx !== 0) {
                    this._clearMWindow(crIdx);
                    this.fault('INVALID_OP', `DREAD: Button device_data=${regIdx} out of range [0..0]`);
                    return null;
                }
                const value = this.buttonState >>> 0;
                this._writeDR(drIdx, value);
                this._clearMWindow(crIdx);
                const desc = `DREAD DR${drIdx} ← 0x${value.toString(16).toUpperCase()} [Button.state]`;
                this.output += desc + '\n';
                this.pc++;
                return { pc: this.pc - 1, desc, pipeline: [
                    { stage: 'M-Window', desc: `CR${crIdx}(M=1) → DR11 = GT descriptor`, status: 'pass' },
                    { stage: 'DREAD',    desc: `Read Button.state`, perm: 'R', status: 'pass' },
                ]};
            }
            if (info.device_class === ChurchSimulator.DEVICE_CLASS_TIMER) {
                const regIdx = info.device_data;
                if (regIdx > 4) {
                    this._clearMWindow(crIdx);
                    this.fault('INVALID_OP', `DREAD: Timer device_data=${regIdx} out of range [0..4]`);
                    return null;
                }
                const value = this.timerRegs[regIdx] >>> 0;
                this._writeDR(drIdx, value);
                this._clearMWindow(crIdx);
                const regName = ['TICKS_LO', 'TICKS_HI', 'TOD_EPOCH', 'ALARM_CMP', 'CTL'][regIdx];
                const desc = `DREAD DR${drIdx} ← ${value} [Timer.${regName}]`;
                this.output += desc + '\n';
                this.pc++;
                return { pc: this.pc - 1, desc, pipeline: [
                    { stage: 'M-Window', desc: `CR${crIdx}(M=1) → DR11 = GT descriptor`, status: 'pass' },
                    { stage: 'DREAD',    desc: `Read Timer.${regName}`, perm: 'R', status: 'pass' },
                ]};
            }
        }
        this._clearMWindow(crIdx);
        this.fault('INVALID_OP', `DREAD: Abstract GT ab_type=0x${info.ab_type.toString(16).toUpperCase()} device_class=0x${info.device_class.toString(16).toUpperCase()} not handled`);
        return null;
    }

    _dispatchAbstractDwrite(crIdx, drIdx, instrOffset) {
        // Parse the abstract GT directly from the CR word (avoids clobbering DR11–DR15
        // as a side-effect; _setMWindow is only needed when calling a software
        // Abstract Manager, not for natively-dispatched device writes).
        this.cr[crIdx].m = 1;
        const info = this.parseAbstractGT(this.cr[crIdx].word0);
        if (!info.W) {
            this._clearMWindow(crIdx);
            this.fault('PERM_W', `DWRITE: Abstract GT lacks W permission`);
            return null;
        }
        if (info.ab_type === ChurchSimulator.AB_TYPE_IO) {
            if (info.device_class === ChurchSimulator.DEVICE_CLASS_LED) {
                const ledIdx = info.device_data;
                const value  = this.dr[drIdx] >>> 0;
                if (value & 1) {
                    this.ledBits |= (1 << ledIdx);
                } else {
                    this.ledBits &= ~(1 << ledIdx);
                }
                this.ledMode = 'program';
                // Sync to thread lump DR zone so hardware-accurate DR home is maintained.
                if (drIdx < 16) {
                    const dw12 = this.cr[12];
                    const dwThreadBase = dw12 && dw12.word1;
                    if (dwThreadBase) {
                        const dwHomeAddr = (dwThreadBase + 1 + drIdx) >>> 0;
                        if (dwHomeAddr < this.memory.length) {
                            this.memory[dwHomeAddr] = value;
                        }
                    }
                }
                this._clearMWindow(crIdx);
                const label = this._abstractLedLabel(ledIdx);
                const desc  = `DWRITE DR${drIdx} → ${label} ← ${value} (${value & 1 ? 'ON' : 'OFF'})`;
                this.output += desc + '\n';
                this.pc++;
                return { pc: this.pc - 1, desc, pipeline: [
                    { stage: 'M-Window', desc: `CR${crIdx}(M=1) → DR11 = GT descriptor`, status: 'pass' },
                    { stage: 'DWRITE',   desc: `Write ${label} ← ${value}`, perm: 'W', status: 'pass' },
                ]};
            }
            if (info.device_class === ChurchSimulator.DEVICE_CLASS_UART) {
                const regIdx = info.device_data;
                if (regIdx > 2) {
                    this._clearMWindow(crIdx);
                    this.fault('INVALID_OP', `DWRITE: UART device_data=${regIdx} out of range [0..2]`);
                    return null;
                }
                const value = this.dr[drIdx] >>> 0;
                this.uartRegs[regIdx] = value;
                this._clearMWindow(crIdx);
                const regName = ['TX', 'STATUS', 'RX'][regIdx];
                const desc = `DWRITE DR${drIdx} → UART.${regName} ← ${value}`;
                this.output += desc + '\n';
                this.pc++;
                return { pc: this.pc - 1, desc, pipeline: [
                    { stage: 'M-Window', desc: `CR${crIdx}(M=1) → DR11 = GT descriptor`, status: 'pass' },
                    { stage: 'DWRITE',   desc: `Write UART.${regName} ← ${value}`, perm: 'W', status: 'pass' },
                ]};
            }
            if (info.device_class === ChurchSimulator.DEVICE_CLASS_TIMER) {
                const regIdx = info.device_data;
                if (regIdx > 4) {
                    this._clearMWindow(crIdx);
                    this.fault('INVALID_OP', `DWRITE: Timer device_data=${regIdx} out of range [0..4]`);
                    return null;
                }
                const value = this.dr[drIdx] >>> 0;
                this.timerRegs[regIdx] = value;
                this._clearMWindow(crIdx);
                const regName = ['TICKS_LO', 'TICKS_HI', 'TOD_EPOCH', 'ALARM_CMP', 'CTL'][regIdx];
                const desc = `DWRITE DR${drIdx} → Timer.${regName} ← ${value}`;
                this.output += desc + '\n';
                this.pc++;
                return { pc: this.pc - 1, desc, pipeline: [
                    { stage: 'M-Window', desc: `CR${crIdx}(M=1) → DR11 = GT descriptor`, status: 'pass' },
                    { stage: 'DWRITE',   desc: `Write Timer.${regName} ← ${value}`, perm: 'W', status: 'pass' },
                ]};
            }
            // ChurchHW: PetNameMemory write port (Task #1542).
            // DWRITE through this Abstract GT marks c-list slot (DR value & 0x3F) as named.
            // Emitted by the .petname <n> assembler pseudo-instruction via boot c-list slot 18.
            if (info.device_class === ChurchSimulator.DEVICE_CLASS_CHURCHHW) {
                const petSlot = this.dr[drIdx] & 0x3F;
                this._petNamedSlots.add(petSlot);
                this._clearMWindow(crIdx);
                const desc = `DWRITE DR${drIdx} → ChurchHW: c-list slot ${petSlot} marked as named (PetNameMemory)`;
                this.output += desc + '\n';
                this.pc++;
                return { pc: this.pc - 1, instr: d, desc, pipeline: [
                    { stage: 'M-Window', desc: `CR${crIdx}(M=1) → DR11 = ChurchHW GT descriptor`, status: 'pass' },
                    { stage: 'DWRITE',   desc: `ChurchHW: mark c-list slot ${petSlot} as named (PET_NAME_WR)`, perm: 'W', status: 'pass' },
                ]};
            }
        }
        this._clearMWindow(crIdx);
        this.fault('INVALID_OP', `DWRITE: Abstract GT ab_type=0x${info.ab_type.toString(16).toUpperCase()} device_class=0x${info.device_class.toString(16).toUpperCase()} not handled`);
        return null;
    }

    _dispatchAbstractCall(d, gt32) {
        // Abstract GT CALL: use M-window to decode GT from DR11, then route to
        // the appropriate Abstract Manager method.  M is already reset by _execCall
        // (CALL boundary rule).  This method sets CRn(M=1) just for the dispatch.
        const crIdx = d.crDst;
        this._setMWindow(crIdx);
        const info = this.parseAbstractGT(this.dr[11]);
        if (info.ab_type === ChurchSimulator.AB_TYPE_IO) {
            if (info.device_class === ChurchSimulator.DEVICE_CLASS_LED) {
                const ledIdx  = info.device_data;
                const method  = this.dr[1] & 0x3;   // DR1[1:0]: 0=Set 1=Clear 2=Toggle 3=State
                const METHOD_NAMES = ['Set','Clear','Toggle','State'];
                let ledResult;
                switch (method) {
                    case 0: this.ledBits |= (1 << ledIdx);  ledResult = 1; break;  // Set (turnOn)
                    case 1: this.ledBits &= ~(1 << ledIdx); ledResult = 0; break;  // Clear (turnOff)
                    case 2: this.ledBits ^= (1 << ledIdx);  ledResult = (this.ledBits >>> ledIdx) & 1; break; // Toggle
                    case 3: ledResult = (this.ledBits >>> ledIdx) & 1; break;       // State (read)
                }
                this.ledMode = 'program';
                this._writeDR(1, ledResult);
                this._clearMWindow(crIdx);   // RETURN resets M anyway; writeback idempotent
                const label = this._abstractLedLabel(ledIdx);
                const desc  = `CALL ${label}.${METHOD_NAMES[method]} → DR1=${ledResult}`;
                this.output += desc + '\n';
                this.pc++;
                return { pc: this.pc - 1, desc, pipeline: [
                    { stage: 'M-Window', desc: `CR${crIdx}(M=1) → DR11 = GT descriptor`, status: 'pass' },
                    { stage: 'CALL',     desc, status: 'pass' },
                ]};
            }
        }
        this._clearMWindow(crIdx);
        const abTypeHex = info.ab_type.toString(16).toUpperCase();
        const dcHex     = info.device_class.toString(16).toUpperCase();
        this.fault('INVALID_OP', `CALL: Abstract GT (ab_type=0x${abTypeHex} device_class=0x${dcHex}) has no CALL methods — use DREAD/DWRITE`);
        return null;
    }
    // ─────────────────────────────────────────────────────────────────────────

    _execDread(d) {
        const drIdx = d.crDst;
        const dataGT = this.cr[d.crSrc].word0;
        if (dataGT === 0) {
            this.fault('NULL_CAP', `DREAD: CR${d.crSrc} is NULL`);
            return null;
        }
        // Abstract GT intercept (type=0b11): bypass mLoad, route to Abstract Manager.
        // v2.0: gt_type is at bits[26:25] (was [24:23]).
        if (((dataGT >>> 25) & 0x3) === 3) {  // ★ v2.0: gt_type moved to [26:25]
            return this._dispatchAbstractDread(d.crSrc, drIdx, d.imm);
        }
        const srcCR = this.cr[d.crSrc];
        const loc = srcCR.word1;
        // Decode mode bit: imm[14]=1 → immediate; imm[14]=0 → indexed
        let offset;
        if (d.imm & 0x4000) {
            offset = d.imm & 0x3FFF;
        } else {
            const dreadBase = (d.imm >> 4) & 0x3FF;
            const dreadDRx  = d.imm & 0xF;
            // Use plain JS Number (no >>> 0) so the sum is not truncated to 32 bits.
            // Saturate at 0xFFFFFFFF to prevent wrap-around past the bounds check:
            // base=1, DRx=0xFFFFFFFF would otherwise give (1+4294967295)>>>0 = 0,
            // which could appear in-bounds. Saturating gives 0xFFFFFFFF which always
            // exceeds any 17-bit lump limit and correctly raises BOUNDS.
            const rawOff = dreadBase + (this.dr[dreadDRx] >>> 0);
            offset = rawOff > 0xFFFFFFFF ? 0xFFFFFFFF : rawOff;
        }
        const absAddr = (loc + offset) >>> 0;
        // CR14 exception: code register is X-only; permit DREAD with X permission in place of R.
        const dreadPerm = (d.crSrc === 14) ? 'X' : 'R';
        const check = this.mLoad(dataGT, dreadPerm, d.crSrc, absAddr);
        if (!check.ok) {
            this.fault(check.fault, `DREAD: CR${d.crSrc}: ${check.message}`);
            return null;
        }
        if (drIdx < 16) {
            const dr12 = this.cr[12];
            if (!dr12 || !dr12.word1) {
                this.fault('NULL_CAP', `DREAD: CR12 is null — cannot sync DR${drIdx} to thread lump DR zone`);
                return null;
            }
        }
        const value = this.memory[loc + offset];
        this._writeDR(drIdx, value);
        const label = this.nsLabels[check.index] || 'data';
        const devNsIdx = check.index;
        const readTag = devNsIdx === 12 ? ` [LED${offset} = ${value & 1 ? 'ON' : 'OFF'}]`
                      : devNsIdx === 11 ? ` [UART.${offset===0?'TX':offset===1?'STATUS':'RX'} = ${value >>> 0}]`
                      : devNsIdx === 13 ? ` [BTN = ${value >>> 0}]`
                      : devNsIdx === 14 ? ` [TIMER.${['TICKS_LO','TICKS_HI','TOD_EPOCH','ALARM_CMP','ALARM_CTL'][offset]||'reg'} = ${value >>> 0}]`
                      : '';
        const desc = `DREAD DR${drIdx} ← ${value >>> 0} (0x${(value >>> 0).toString(16).toUpperCase()}) ← [CR${d.crSrc} + ${offset}] (${label})${readTag}`;
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
        // Abstract GT intercept (type=0b11): bypass mLoad, route to Abstract Manager.
        // v2.0: gt_type is at bits[26:25] (was [24:23]).
        if (((dataGT >>> 25) & 0x3) === 3) {  // ★ v2.0: gt_type moved to [26:25]
            return this._dispatchAbstractDwrite(d.crSrc, drIdx, d.imm);
        }
        const srcCR = this.cr[d.crSrc];
        const loc = srcCR.word1;
        // Decode mode bit: imm[14]=1 → immediate; imm[14]=0 → indexed
        let offset;
        if (d.imm & 0x4000) {
            offset = d.imm & 0x3FFF;
        } else {
            const dwriteBase = (d.imm >> 4) & 0x3FF;
            const dwriteDRx  = d.imm & 0xF;
            // Saturating sum prevents 32-bit wrap before bounds check (see _execDread).
            const rawOff = dwriteBase + (this.dr[dwriteDRx] >>> 0);
            offset = rawOff > 0xFFFFFFFF ? 0xFFFFFFFF : rawOff;
        }
        const absAddr = (loc + offset) >>> 0;

        // IO_PORT_PET_NAME_WR intercept (Tasks #1531/#1532): a DWRITE whose computed address
        // equals 0xFFFFFF38 registers c-list slot (DR value & 0x3F) as named.  Named slots
        // fire Scheduler.IRQ(LAZY_RESOLVE) instead of a hard NULL_CAP when accessed while empty.
        // Mirrors hardware/core.py intercept: wr_addr = dmem_wr_data[5:0], wr_data = 1.
        // Bypasses mLoad — the hardware address range is not a real memory lump.
        if (absAddr === IO_PORT_PET_NAME_WR) {
            const slotIdx = (this.dr[drIdx] >>> 0) & 0x3F;
            this.petNameMemory.add(slotIdx);
            const desc = `DWRITE DR${drIdx} → IO_PORT_PET_NAME_WR: c-list slot ${slotIdx} marked as named`;
            this.output += desc + '\n';
            this.pc++;
            return { pc: this.pc - 1, instr: d, desc, pipeline: [
                { stage: 'DWRITE', desc: `Mark c-list slot ${slotIdx} as named (PET_NAME_WR)`, perm: 'W', status: 'pass' },
            ]};
        }

        const check = this.mLoad(dataGT, 'W', d.crSrc, absAddr);
        if (!check.ok) {
            this.fault(check.fault, `DWRITE: CR${d.crSrc}: ${check.message}`);
            return null;
        }
        const value = this.dr[drIdx] >>> 0;
        let dwHomeAddr = -1;
        if (drIdx < 16) {
            const dw12 = this.cr[12];
            const dwThreadBase = dw12 && dw12.word1;
            if (!dwThreadBase) {
                this.fault('NULL_CAP', `DWRITE: CR12 is null — cannot sync DR${drIdx} to thread lump DR zone`);
                return null;
            }
            dwHomeAddr = (dwThreadBase + 1 + drIdx) >>> 0;
            if (dwHomeAddr >= this.memory.length) {
                this.fault('BOUNDS', `DWRITE: DR${drIdx} home address 0x${dwHomeAddr.toString(16)} out of memory`);
                return null;
            }
        }
        this.memory[loc + offset] = value;
        if (dwHomeAddr >= 0) {
            this.memory[dwHomeAddr] = value;
        }

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
        const devTag = devNsIdx === 12 ? ` [→ LED${offset} ← ${value} (${value & 1 ? 'ON' : 'OFF'})]`
                     : devNsIdx === 11 ? ` [→ UART.${offset===0?'TX':'STATUS'} ← ${value}]`
                     : devNsIdx === 13 ? ' [→ BTN read-only]'
                     : devNsIdx === 14 ? ` [→ TIMER.${['TICKS_LO','TICKS_HI','TOD_EPOCH','ALARM_CMP','ALARM_CTL'][offset]||'reg'} ← ${value}]`
                     : '';
        const desc = `DWRITE DR${drIdx}, [CR${d.crSrc} + ${offset}] ← ${value} (0x${value.toString(16).toUpperCase()}) → ${label}${devTag}`;
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
        const pos = (d.imm >>> 5) & 0x1F;
        const width = d.imm & 0x1F;
        if (width === 0 || pos + width > 32) {
            this.fault('BOUNDS', `BFEXT: invalid bitfield pos=${pos} width=${width}`);
            return null;
        }
        const word = this.dr[d.crSrc] >>> 0;
        const mask = ((1 << width) - 1) >>> 0;
        const value = (word >>> pos) & mask;
        const drIdx = d.crDst;
        this._writeDR(drIdx, value);
        this.flags.N = ((value >>> 31) & 1) === 1;
        this.flags.Z = value === 0;
        this.flags.C = false;
        this.flags.V = false;
        const desc = `BFEXT DR${drIdx}, DR${d.crSrc}, pos=${pos}, w=${width} -> 0x${value.toString(16).toUpperCase()} [Z=${this.flags.Z?1:0} N=${this.flags.N?1:0} C=0 V=0]`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: [
            { stage: 'BFEXT', desc: `Extract bits [${pos}:${pos+width-1}] from DR${d.crSrc} into DR${drIdx}`, perm: '-', status: 'pass' },
        ]};
    }

    _execBfins(d) {
        const pos = (d.imm >>> 5) & 0x1F;
        const width = d.imm & 0x1F;
        if (width === 0 || pos + width > 32) {
            this.fault('BOUNDS', `BFINS: invalid bitfield pos=${pos} width=${width}`);
            return null;
        }
        const drIdx = d.crDst;
        const insertVal = this.dr[d.crSrc] >>> 0;
        const mask = (((1 << width) - 1) << pos) >>> 0;
        const oldWord = this.dr[drIdx] >>> 0;
        const newWord = ((oldWord & ~mask) | ((insertVal << pos) & mask)) >>> 0;
        this._writeDR(drIdx, newWord);
        this.flags.N = ((newWord >>> 31) & 1) === 1;
        this.flags.Z = newWord === 0;
        this.flags.C = false;
        this.flags.V = false;
        const desc = `BFINS DR${drIdx}, DR${d.crSrc}, pos=${pos}, w=${width} <- 0x${(insertVal & ((1 << width) - 1)).toString(16).toUpperCase()} [Z=${this.flags.Z?1:0} N=${this.flags.N?1:0} C=0 V=0]`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: [
            { stage: 'BFINS', desc: `Insert bits [${pos}:${pos+width-1}] from DR${d.crSrc} into DR${drIdx}`, perm: '-', status: 'pass' },
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
        this._writeDR(d.crDst, result);
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
        this._writeDR(d.crDst, result);
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
        this._writeDR(d.crDst, result);
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
        this._writeDR(d.crDst, result);
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

    _callBoundaryStages(d, label) {
        return [
            { stage: 'LOAD',  desc: `Read target GT from CR${d.crDst}`, perm: 'L', status: 'pass' },
            { stage: 'TPERM', desc: `Verify E permission on target`, perm: 'E', status: 'pass' },
            { stage: 'PUSH',  desc: `Push E-GT (word 0) + frame word (SZ=1): FLAGS|PC|SZ|STO`, status: 'pass' },
            { stage: 'CALL',  desc: `Enter ${label}, CR6/CR14 derived, PC\u21900`, status: 'pass' },
        ];
    }

    _callPipeline(d, label) {
        const stages = [];
        if (this._mwinWbFired) {
            stages.push({ stage: 'MWIN_WB', desc: `M-window writeback: DR11\u2013DR13 \u2192 CR15, M cleared`, status: 'pass' });
        }
        stages.push(...this._callBoundaryStages(d, label));
        return stages;
    }

    _returnPipeline(d, frame, mask) {
        const stages = [];
        if (this._mwinWbFired) {
            stages.push({ stage: 'MWIN_WB', desc: `M-window writeback: DR11–DR13 → CR15, M cleared`, status: 'pass' });
        }
        const frameTag = frame.sz === 0 ? 'LAMBDA' : 'CALL';
        stages.push({ stage: 'POP', desc: `Pop ${frame.sz === 0 ? '1-word LAMBDA' : '2-word CALL'} frame; restore FLAGS, STO←${frame.savedSTO}`, status: 'pass' });
        if (frame.sz === 1) {
            stages.push({ stage: 'E-GT', desc: 'Revalidate caller E-GT → re-derive CR6/CR14', perm: 'E', status: 'pass' });
        }
        stages.push({ stage: 'RETURN', desc: `PC→${frame.returnPC}${mask ? `, MASK=0b${mask.toString(2).padStart(12,'0')} (set=preserve)` : ''}`, status: 'pass' });
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

    // Push an NS.Type gate-log entry for the NS entry type check in _bootStep B:05
    // and B:06.  Called immediately after each mLoad succeeds so the outcome is always
    // recorded, whether the type is correct (Inform, type=1) or not.
    // bootStepName should be 'INIT_ABSTR' (B:05) or 'NUC_CLIST' (B:06).
    _auditNSType(nsIndex, label, actualType, actualTypeName, bootStepName) {
        const typePass = actualType === 1;
        this.auditLog.push({
            gate: 'NS.Type',
            label,
            nsIndex,
            requiredPerm: null,
            checks: {
                type: {
                    pass: typePass,
                    required: 'Inform',
                    actual: actualTypeName,
                },
            },
            b: null, f: null,
            result: typePass ? 'pass' : 'fail',
            stepCtx: this._currentInstrLabel || null,
            bootStepName: bootStepName || null,
        });
    }

    // Push a Lump.Header gate-log entry for a lump header read in _bootStep B:06.
    // Called immediately after parseLumpHeader() so the outcome is always recorded,
    // whether the header is valid or not.
    _auditLumpHeader(nsIndex, label, hdr) {
        const magicPass = hdr.valid;
        const ccPass    = magicPass && (hdr.cc > 0);
        // Hardware only checks MAGIC and CC from the lump header word at B:06 NUC_CLIST.
        // The typ field (bits [9:8]) is never validated by the hardware at this step;
        // the NS entry type check happens earlier via entryCheck.parsed.type.
        const checks = { magic: { pass: magicPass, rawMagic: hdr.magic } };
        if (magicPass) checks.cc = { pass: ccPass };
        this.auditLog.push({
            gate: 'Lump.Header',
            label,
            nsIndex,
            requiredPerm: null,
            checks,
            b: null, f: null,
            result: (magicPass && ccPass) ? 'pass' : 'fail',
            stepCtx: this._currentInstrLabel || null,
        });
    }

    _auditPipeline() {
        return this.auditLog.map(a => {
            const checks = a.checks || {};
            const checkList = Object.entries(checks).map(([k, v]) => ({
                name: k.toUpperCase(),
                pass: v.pass,
                perm: v.perm || null,
            }));
            // For NS.Type entries, prefix the stage and description with the
            // originating boot step name (INIT_ABSTR for B:05, NUC_CLIST for B:06)
            // so the audit panel shows a precise step label.
            let stage, desc;
            if (a.gate === 'NS.Type' && a.bootStepName) {
                stage = `${a.bootStepName} – NS.Type`;
                desc  = `${a.bootStepName} – NS.Type(NS[${a.nsIndex}]="${a.label}") ${a.result}`;
            } else if (a.desc !== undefined) {
                stage = a.gate;
                desc  = a.desc;
            } else if (a.nsIndex !== null && a.nsIndex !== undefined) {
                stage = a.gate;
                desc  = `${a.gate}(NS[${a.nsIndex}]="${a.label}"${a.requiredPerm ? ', '+a.requiredPerm : ''})`;
            } else {
                stage = a.gate;
                desc  = `${a.gate} — ${a.label}`;
            }
            return {
                stage,
                type: a.gate,
                desc,
                label: a.label,
                nsIndex: a.nsIndex,
                requiredPerm: a.requiredPerm,
                checks: checkList,
                status: a.result,
                b: a.b,
                f: a.f,
                bootStepName: a.bootStepName || null,
            };
        });
    }

    loadProgram(words, startAddr) {
        const abstrSlot = this.bootEntrySlot;  // active boot-entry slot (default 3 = Boot.Abstr, Task #247)
        const abstrBase = this.NS_TABLE_BASE + abstrSlot * this.NS_ENTRY_WORDS;
        const codeLoc = this.memory[abstrBase] || (abstrSlot * this.SLOT_SIZE);
        const baseAddr = this.bootComplete ? codeLoc : (startAddr || 0);

        // When booted, check whether the code fits in the existing lump.
        // If not, allocate a fresh LUMP in the extended-code area instead of
        // truncating — this handles large Assembly programs like led_turing_full.
        if (this.bootComplete && baseAddr < this.memory.length) {
            const hdrWord = this.memory[baseAddr] >>> 0;
            const hdr     = this.parseLumpHeader(hdrWord);
            if (hdr.valid) {
                const clistStart = hdr.lumpSize - hdr.cc;
                const maxCW      = Math.max(0, clistStart - 1);
                if (words.length > maxCW) {
                    // ── NEW-LUMP PATH ────────────────────────────────────────────────
                    // Code is too large to fit in the current lump (capacity: maxCW words).
                    // Build a properly-sized LUMP in the extended-code area so all
                    // instructions are accessible.  Leave cc=0 so the lazy C-List
                    // injection in _applyPendingSimLoad adds DEMO_CLIST automatically.
                    const DEMO_CC      = 18;   // DEMO_CLIST entries added by lazy injection
                    const EXTENDED_BASE = 0x0400; // well above boot lumps (~0x1C0), below NS table
                    let newLumpSize = 64;
                    while (newLumpSize < 1 + words.length + DEMO_CC) newLumpSize <<= 1;

                    if (EXTENDED_BASE + newLumpSize <= this.NS_TABLE_BASE) {
                        const n_minus_6  = Math.max(0, Math.log2(newLumpSize) - 6) | 0;
                        const newLumpBase = EXTENDED_BASE;

                        // Write lump header: cc=0 (lazy injection fills C-List later)
                        this.memory[newLumpBase] = this.packLumpHeader(n_minus_6, words.length, 0, 0);
                        // Write code words starting at word 1
                        for (let i = 0; i < words.length; i++) {
                            this.memory[newLumpBase + 1 + i] = words[i] >>> 0;
                        }

                        // Update NS slot 3: point to new lump, limit17 = words.length, cc=0
                        const nsBase        = this.NS_TABLE_BASE + abstrSlot * this.NS_ENTRY_WORDS;
                        const oldW1         = this.memory[nsBase + 1] >>> 0;
                        const oldW2         = this.memory[nsBase + 2] >>> 0;
                        const w1f           = this.parseNSWord1(oldW1);
                        const existingGtSeq = (oldW2 >>> 25) & 0x7F;
                        this.memory[nsBase + 0] = newLumpBase >>> 0;
                        this.memory[nsBase + 1] = this.packNSWord1(
                            words.length, w1f.b, w1f.g, w1f.gtType, 0
                        );
                        this.memory[nsBase + 2] = this.makeVersionSeals(existingGtSeq, newLumpBase, words.length);

                        // Update CR14 (code-region capability) to new lump location + NS words
                        const cr14 = this.cr[14];
                        if (cr14) {
                            cr14.word1 = newLumpBase >>> 0;
                            cr14.word2 = this.memory[nsBase + 1];
                            cr14.word3 = this.memory[nsBase + 2];
                        }
                        // Reset CR6 so the lazy C-List injection in _applyPendingSimLoad
                        // rebuilds it against the new lump base (it checks clistCount===0).
                        if (this.cr[6]) {
                            this.cr[6] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
                        }

                        this.output += `[loadProgram] New LUMP allocated at 0x${newLumpBase.toString(16)} (${newLumpSize} words) for ${words.length}-word program.\n`;
                        this.pc = 0;
                        this.halted = false;
                        this.running = false;
                        this.sto = 243;
                        this.callStack = [];
                        this.stepCount = 0;
                        this.lambdaActive = false;
                        this.lambdaReturnPC = 0;
                        this.lambdaCachedFrame = null;
                        this.faultLog = [];
                        this._instrHistory = [];
                        this.emit('programLoaded', { addr: newLumpBase, length: words.length });
                        this.emit('stateChange', this.getState());
                        return;
                    }
                    // Fall through to patch path if new lump would overflow memory
                    this.output += `[loadProgram] WARNING: program too large (${words.length} words) — truncated to ${maxCW} words.\n`;
                }
            }
        }

        // ── PATCH-IN-PLACE PATH ──────────────────────────────────────────────────
        // Code fits in the existing lump (or pre-boot load): write words directly.
        // +1: lump header occupies word 0; code starts at word 1.
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
                const clistStart = hdr.lumpSize - hdr.cc;
                const maxCW      = Math.max(0, clistStart - 1);
                const newCW      = Math.min(words.length, maxCW);
                const nsBase     = this.NS_TABLE_BASE + abstrSlot * this.NS_ENTRY_WORDS;
                const nsStoredBase = this.memory[nsBase + 0] >>> 0;
                const cr14Current  = this.cr[14];
                const cr14Base     = cr14Current ? (cr14Current.word1 >>> 0) : baseAddr;
                // Sync whenever the cw changed, the stored NS base diverged, OR CR14's
                // physical base diverged (e.g. after large-program run + reboot CR14.word1
                // is reset to the boot lump while NS slot 3 still points to EXTENDED_BASE).
                if (newCW !== hdr.cw || nsStoredBase !== baseAddr || cr14Base !== baseAddr) {
                    if (newCW !== hdr.cw) {
                        this.memory[baseAddr] = ((hdrWord & ~(0x1FFF << 10)) | ((newCW & 0x1FFF) << 10)) >>> 0;
                    }
                    const oldW1        = this.memory[nsBase + 1] >>> 0;
                    const oldW2        = this.memory[nsBase + 2] >>> 0;
                    const w1f          = this.parseNSWord1(oldW1);
                    const newLimit17   = newCW;
                    // Always keep NS slot 3 word0 pointing at the actual lump base
                    this.memory[nsBase + 0] = baseAddr >>> 0;
                    this.memory[nsBase + 1] = this.packNSWord1(newLimit17, w1f.b, w1f.g, w1f.gtType, w1f.clistCount);
                    const existingGtSeq    = (oldW2 >>> 25) & 0x7F;
                    this.memory[nsBase + 2] = this.makeVersionSeals(existingGtSeq, baseAddr, newLimit17);
                    const cr14 = this.cr[14];
                    if (cr14) {
                        // word1 is the physical base — must match NS slot 3 word0
                        cr14.word1 = baseAddr >>> 0;
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
        this.lambdaCachedFrame = null;
        this.faultLog = [];
        this._instrHistory = [];
        this.emit('programLoaded', { addr: baseAddr, length: words.length });
        this.emit('stateChange', this.getState());
    }

    loadLumpBinary(words, nsSlot) {
        const EXTENDED_BASE  = 0x0400;
        const _nsSlotRaw     = (nsSlot !== undefined && nsSlot !== null) ? Number(nsSlot) : NaN;
        const abstrSlot      = Number.isInteger(_nsSlotRaw) ? _nsSlotRaw : this.bootEntrySlot;

        if (!words || !words.length) {
            this.output += '[loadLumpBinary] ERROR: empty words array.\n';
            return false;
        }

        const _maxNsSlot = Math.floor(this.NS_TABLE_RESERVE / this.NS_ENTRY_WORDS) - 1;
        if (abstrSlot < 0 || abstrSlot > _maxNsSlot) {
            this.output += `[loadLumpBinary] ERROR: nsSlot ${abstrSlot} is out of range (0–${_maxNsSlot}).\n`;
            return false;
        }

        const MAX_LUMP_WORDS = 32768;   // n_minus_6=9 → 2^15; values 10–15 are unsupported

        const hdrWord = words[0] >>> 0;
        const hdr     = this.parseLumpHeader(hdrWord);
        if (!hdr.valid) {
            this.output += `[loadLumpBinary] ERROR: word 0 (0x${hdrWord.toString(16)}) is not a valid LUMP header (magic != 0x1F).\n`;
            return false;
        }

        if (hdr.n_minus_6 > 9 || hdr.lumpSize > MAX_LUMP_WORDS) {
            console.warn(`[loadLumpBinary] WARNING: n_minus_6=${hdr.n_minus_6} is out of range (max 9, lumpSize would be ${hdr.lumpSize} words). LUMP rejected.`);
            this.output += `[loadLumpBinary] ERROR: n_minus_6=${hdr.n_minus_6} is out of range (max 9); lumpSize ${hdr.lumpSize} exceeds MAX_LUMP_WORDS ${MAX_LUMP_WORDS}.\n`;
            return false;
        }

        const lumpSize = hdr.lumpSize;

        if (EXTENDED_BASE + lumpSize > this.NS_TABLE_BASE) {
            this.output += `[loadLumpBinary] ERROR: LUMP (${lumpSize} words) would overflow memory at 0x${EXTENDED_BASE.toString(16)}.\n`;
            return false;
        }

        for (let i = 0; i < lumpSize; i++) {
            this.memory[EXTENDED_BASE + i] = (i < words.length ? words[i] : 0) >>> 0;
        }

        const nsBase       = this.NS_TABLE_BASE + abstrSlot * this.NS_ENTRY_WORDS;
        const oldW1        = this.memory[nsBase + 1] >>> 0;
        const oldW2        = this.memory[nsBase + 2] >>> 0;
        const w1f          = this.parseNSWord1(oldW1);
        const existingGtSeq = (oldW2 >>> 25) & 0x7F;

        this.memory[nsBase + 0] = EXTENDED_BASE >>> 0;
        this.memory[nsBase + 1] = this.packNSWord1(hdr.cw, w1f.b, w1f.g, w1f.gtType, hdr.cc);
        this.memory[nsBase + 2] = this.makeVersionSeals(existingGtSeq, EXTENDED_BASE, hdr.cw);

        // CR14 update strategy depends on the target slot:
        //
        // • abstrSlot === this.bootEntrySlot — interactive execution path
        //   ("▶ Run" on a LUMP).  Always rebuild CR14 completely, including
        //   word0 (the R+X GT), so that mLoad's bounds check uses the correct
        //   NS slot limits regardless of what bootEntrySlot was before this call.
        //   If bootEntrySlot previously referenced a different slot the old word0
        //   GT would fail bounds checks — the "boots wrong slot / LUMP_MAGIC" bug.
        //
        // • abstrSlot !== this.bootEntrySlot (service install into another slot) —
        //   only update word1/word2/word3; word0 already encodes the correct GT.
        if (abstrSlot === this.bootEntrySlot) {
            // Interactive execution path ("▶ Run" on a LUMP, or any load into the
            // current boot-entry slot).  Rebuild CR14 word0 completely so mLoad's
            // bounds check uses this slot's limits, then confirm bootEntrySlot.
            const cr14 = this.cr[14];
            if (cr14) {
                cr14.word0 = this.createGT(0, this.bootEntrySlot, {R:1,W:0,X:1,L:0,S:0,E:0}, 1);
                cr14.word1 = EXTENDED_BASE >>> 0;
                cr14.word2 = this.memory[nsBase + 1];
                cr14.word3 = this.memory[nsBase + 2];
            }
            this.bootEntrySlot = abstrSlot;
        }

        // Set CR6 to point to the c-list that is already embedded in the lump.
        // The c-list occupies the last cc words of the lump slot:
        //   clistBase = EXTENDED_BASE + lumpSize - cc
        // When cc = 0 zero CR6 so any downstream lazy-injection path can take over.
        if (this.cr[6]) {
            if (hdr.cc > 0) {
                const clistBase = EXTENDED_BASE + lumpSize - hdr.cc;
                const cr6GT = this.createGT(0, abstrSlot, {R:0,W:0,X:0,L:0,S:0,E:1}, 1);
                this.cr[6] = {
                    word0: cr6GT,
                    word1: clistBase >>> 0,
                    word2: this.memory[nsBase + 1],
                    word3: this.memory[nsBase + 2],
                    m: 0,
                };
            } else {
                this.cr[6] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
            }
        }

        this.pc              = 0;
        this.halted          = false;
        this.running         = false;
        this.sto             = 243;
        this.callStack       = [];
        this.stepCount       = 0;
        this.lambdaActive    = false;
        this.lambdaReturnPC  = 0;
        this.lambdaCachedFrame = null;
        this.faultLog        = [];
        this._instrHistory   = [];

        this.output += `[loadLumpBinary] LUMP loaded at 0x${EXTENDED_BASE.toString(16)}: lumpSize=${lumpSize} cw=${hdr.cw} cc=${hdr.cc}.\n`;

        this.emit('programLoaded', { addr: EXTENDED_BASE, length: hdr.cw });
        this.emit('stateChange', this.getState());
        return true;
    }

    loadHardwareBinary(hwProgram, hwNamespace, hwClist, hwLabels, abstractions) {
        this.reset();

        this.memory = new Uint32Array(this._namespaceMemoryWords());
        this.NS_TABLE_BASE = this.memory.length - this.NS_TABLE_RESERVE;
        this.nsLabels = {};
        this.nsCount = 0;
        this.nsClistMap = {};

        // hwNamespace uses 4-word entries (loc, word1, word2, word3_reserved=0).
        const nsEntryCount = hwNamespace.length / 4;
        for (let i = 0; i < nsEntryCount; i++) {
            const loc  = hwNamespace[i * 4 + 0];
            const w1   = hwNamespace[i * 4 + 1];
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
        this.output += `LED flash: code at 0x${abstrLoc.toString(16).padStart(4,'0').toUpperCase()}, C-List (${abstrClistCount} GTs) at 0x${(abstrLoc + abstrClistStart).toString(16).padStart(4,'0').toUpperCase()}\n`;
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
        this.output += `\n--- CLOOMC Code (LED flash code region, at 0x${abstrLoc.toString(16).padStart(4,'0').toUpperCase()}) ---\n`;
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
        this._initThrdEntry = null;
        this._nucLumpData = null;
        this.callHomeStatus = null;
        this.callHomeTimestamp = null;
        this.ledBits = 0; this.ledMode = 'boot'; this.lastSignedReturn = null;
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

        this.memory = new Uint32Array(this._namespaceMemoryWords());
        this.NS_TABLE_BASE = this.memory.length - this.NS_TABLE_RESERVE;
        this.nsLabels = {};
        this.nsCount = 0;
        this.nsClistMap = {};

        const NS_WORDS = 256;  // 64 entries × 4 words
        const CLIST_WORDS = 64;
        const nsEntryCount = Math.floor(Math.min(nsWords.length, NS_WORDS) / 4);

        for (let i = 0; i < nsEntryCount; i++) {
            const loc = nsWords[i * 4 + 0] >>> 0;
            const w1  = nsWords[i * 4 + 1] >>> 0;
            const w2  = nsWords[i * 4 + 2] >>> 0;
            const base = this.NS_TABLE_BASE + i * this.NS_ENTRY_WORDS;
            this.memory[base + 0] = loc;
            this.memory[base + 1] = w1;
            this.memory[base + 2] = w2;
            // base + 3 (word3_reserved) stays zero
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
        this.output += `LED flash: code at 0x${abstrLoc.toString(16).padStart(4,'0').toUpperCase()}, C-List (${abstrClistCount} GTs) at 0x${(abstrLoc + abstrClistStart).toString(16).padStart(4,'0').toUpperCase()}\n`;
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
            this.output += `\n--- CLOOMC Code (LED flash code region, at 0x${abstrLoc.toString(16).padStart(4,'0').toUpperCase()}) ---\n`;
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
        this._initThrdEntry = null;
        this._nucLumpData = null;
        this.callHomeStatus = null;
        this.callHomeTimestamp = null;
        this.ledBits = 0; this.ledMode = 'boot'; this.lastSignedReturn = null;
        this.faultLog = [];
        this._instrHistory = [];
        this.stepCount = 0;
        this.callStack = [];
        this.sto = 243;  // sp_max reset

        this.emit('programLoaded', { addr: 0, length: hwBoot ? hwBoot.length : 0 });
        this.emit('stateChange', this.getState());
    }

    exportHardwareImage() {
        const NS_WORDS = 256;  // 64 entries × 4 words
        const CLIST_WORDS = 64;

        const nsWords = new Uint32Array(NS_WORDS);
        const nsEntries = Math.min(this.nsCount || 16, 64);
        for (let i = 0; i < nsEntries; i++) {
            const base = this.NS_TABLE_BASE + i * this.NS_ENTRY_WORDS;
            nsWords[i * 4 + 0] = this.memory[base + 0] >>> 0;
            nsWords[i * 4 + 1] = this.memory[base + 1] >>> 0;
            nsWords[i * 4 + 2] = this.memory[base + 2] >>> 0;
            nsWords[i * 4 + 3] = 0;  // word3_reserved
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
        while (this.running && !this.halted && !this.awaitingLump && !this._lazySuspended && this.bootComplete && steps < maxSteps) {
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

    // ── Lazy-load lump installation ───────────────────────────────────────────
    // Called by app.js after a successful GET /api/lump/<token_hex>.
    // lumpWords: Uint32Array or plain Array of 32-bit words (big-endian native).
    //   word[0]     — CRC-32 preamble (computed by server over the lump payload bytes)
    //   word[1..]   — actual lump binary (header + code + c-list)
    // Returns { ok, freeBase?, lumpSize?, message? }.
    receiveLump(lumpWords) {
        if (!this.awaitingLump) {
            return { ok: false, message: 'not awaiting a lump' };
        }
        const { nsIndex, retryPC } = this.awaitingLump;

        // ── CRC-32 verification ───────────────────────────────────────────────
        // word[0] is the stored CRC-32 (prepended by the server).
        // The CRC is computed over the raw lump payload bytes (words[1..]).
        // Algorithm: CRC-32/ISO-HDLC — matches hardware outform_iot.py CHECK_CRC32.
        if (lumpWords.length < 2) {
            this.awaitingLump = null;
            this.fault('LUMP_SIZE', `receiveLump: response too short (${lumpWords.length} words) for Slot ${nsIndex}`);
            return { ok: false, message: 'lump response too short' };
        }
        const crcStored   = (lumpWords[0] >>> 0);
        const lumpPayload = Array.isArray(lumpWords) ? lumpWords.slice(1) : Array.from(lumpWords).slice(1);
        const crcComputed = this._crc32Words(lumpPayload);
        if (crcComputed !== crcStored) {
            this.awaitingLump = null;
            this.fault('OUTFORM_CRC',
                `receiveLump: CRC-32 mismatch for Slot ${nsIndex} — ` +
                `stored=0x${crcStored.toString(16).padStart(8,'0')} ` +
                `computed=0x${crcComputed.toString(16).padStart(8,'0')}`);
            return { ok: false, message: 'CRC-32 mismatch' };
        }

        // Validate magic byte in lump header word0 (first word of the actual lump).
        const hdrWord = (lumpPayload[0] >>> 0);
        if ((hdrWord >>> 27) !== 0x1F) {
            this.awaitingLump = null;
            this.fault('LUMP_MAGIC', `receiveLump: bad magic 0x${((hdrWord>>>27)&0x1F).toString(16)} in fetched lump for Slot ${nsIndex}`);
            return { ok: false, message: 'invalid lump magic' };
        }

        const hdr = this.parseLumpHeader(hdrWord);
        const lumpSize = hdr.lumpSize;   // 64 for n_minus_6=0

        // Validate that the payload is consistent with the declared header size.
        // Truncated payloads (fewer words than declared) are rejected; extra words are ignored.
        if (lumpPayload.length < lumpSize) {
            this.awaitingLump = null;
            this.fault('LUMP_SIZE', `receiveLump: payload is ${lumpPayload.length} words, header declares ${lumpSize} (truncated)`);
            return { ok: false, message: 'truncated lump payload' };
        }
        // cw (code words) and cc (c-list slots) must fit within the declared lump size.
        const cw_check = hdr.cw;
        const cc_check = hdr.cc;
        if (cw_check + cc_check >= lumpSize) {
            this.awaitingLump = null;
            this.fault('LUMP_LAYOUT', `receiveLump: cw=${cw_check}+cc=${cc_check} >= lumpSize=${lumpSize} (layout overflow)`);
            return { ok: false, message: 'lump layout overflow' };
        }

        // Find the next aligned free slot (above all resident NS lumps).
        const freeBase = this._findFreeSlot(lumpSize);
        if (freeBase + lumpSize > this.NS_TABLE_BASE) {
            this.awaitingLump = null;
            this.fault('LUMP_OOM', `receiveLump: no free space for ${lumpSize}-word lump (high-water would hit NS table)`);
            return { ok: false, message: 'out of lump space' };
        }

        // Write lump words into memory.
        for (let i = 0; i < Math.min(lumpPayload.length, lumpSize); i++) {
            this.memory[freeBase + i] = (lumpPayload[i] >>> 0);
        }

        // Promote NS entry from Outform (gtType=2) → Inform (gtType=1).
        // GT type semantics: 0=NULL, 1=Inform, 2=Outform, 3=Abstract.
        // limit17 = lumpSize - cc - 1  (valid code range 0..limit17 inclusive).
        const cc      = hdr.cc;
        const cw      = hdr.cw;
        const limit17 = lumpSize - cc - 1;
        this.writeNSEntry(nsIndex, freeBase, limit17, 0, 0, 0, 1 /*gtType=Inform*/, 0, cc);

        const label = this.nsLabels[nsIndex] || 'entry_' + nsIndex;
        this.output += `\u2713 Installed: ${label} — ${lumpSize} words @ 0x${freeBase.toString(16)} [Slot ${nsIndex}]\n`;

        // Restore PC to the retry instruction and clear the suspend state.
        this.pc = retryPC;
        this.awaitingLump = null;

        return { ok: true, freeBase, lumpSize };
    }

    // Find the lowest aligned slot address above all resident NS lumps.
    // Skips slot 0 (Boot.NS — covers entire memory, not a physical lump),
    // and Outform entries (gtType=2 — no physical backing yet).
    // Uses the lump header's actual lumpSize rather than the NS limit17 field,
    // because limit17 encodes the code-region limit, not the full slot size.
    _findFreeSlot(lumpSize) {
        let highWater = 0;
        for (let i = 1; i < this.nsCount; i++) {   // skip slot 0 (namespace descriptor)
            const entry = this.readNSEntry(i);
            if (!entry) continue;
            const entryW1 = this.parseNSWord1(entry.word1_limit);
            if (entryW1.gtType === 2) continue;    // Outform: no physical backing
            const base = entry.word0_location >>> 0;
            if (base === 0 || base >= this.NS_TABLE_BASE) continue;  // sanity guard
            // Prefer reading the lump header for the true slot size.
            let lumpTop;
            const hdrWord = this.memory[base] >>> 0;
            const hdr     = this.parseLumpHeader(hdrWord);
            if (hdr.valid) {
                lumpTop = base + hdr.lumpSize;
            } else {
                // No valid lump header: assume at least SLOT_SIZE words allocated.
                // This is a safe overestimate that handles device-register NS entries
                // (which have small limit17 values that don't reflect their 64-word slot).
                lumpTop = base + this.SLOT_SIZE;
            }
            if (lumpTop > highWater) highWater = lumpTop;
        }
        // Align upward to lumpSize (always a power of 2).
        const mask    = lumpSize - 1;
        const aligned = (highWater + mask) & ~mask;
        return aligned >>> 0;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // resetNamedSlots() — resets petNameMemory to the hardware boot defaults.
    // Must be called by _injectClistNow() (app-run.js) at the start of every
    // program load so that named-slot entries from a previous program (program A)
    // cannot linger and incorrectly suppress NULL_CAP faults for slots that the
    // new program (program B) never declared.  Without this reset a stale entry
    // could cause LAZY_RESOLVE to fire on an anonymous NULL instead of halting.
    resetNamedSlots() {
        this.petNameMemory = new Set(BOOT_NAMED_SLOTS);
    }

    // markNamedSlots(slots) — out-of-band registration of named c-list slot indices.
    // Called by _injectClistNow() (app-run.js) after loading a program whose capabilities
    // block declares named slots.  Mirrors the DWRITE-to-IO_PORT_PET_NAME_WR hardware path
    // without requiring a real capability pointing to 0xFFFFFF38.
    // slots: array of 0-based c-list slot indices to mark as named.
    markNamedSlots(slots) {
        if (!slots) return;
        for (const s of slots) {
            if (typeof s === 'number' && s >= 0 && s < 64)
                this.petNameMemory.add(s);
        }
    }

    // isNamedSlot(slot) — returns true when the given c-list slot index is marked as named
    // in petNameMemory, i.e. NULL_CAP access should use LAZY_RESOLVE instead of hard fault.
    isNamedSlot(slot) {
        return this.petNameMemory.has(slot);
    }

    // _petNamedSlots — alias for petNameMemory, used by tests and external tooling.
    get _petNamedSlots() { return this.petNameMemory; }

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
            petNameMemory: Array.from(this.petNameMemory),
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
        const nsEntry = this.readNSEntry(parsed.index);
        const nsWord1 = nsEntry ? nsEntry.word1_limit : cr.word2;
        const lim = this.parseNSWord1(nsWord1);
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
            word2_limit_raw: nsWord1,
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
        const cc = 0;
        // Lump must be a power-of-2 block >= 64 words that fits header + code + c-list.
        let lumpSize = 64;
        while (lumpSize < 1 + codeLen + cc) lumpSize <<= 1;
        const n_minus_6 = Math.max(0, Math.ceil(Math.log2(lumpSize)) - 6);
        // NS entry limit17 = index of last valid code/data word = lumpSize - cc - 1.
        const lim17 = Math.min(lumpSize - cc - 1, 0x1FFFF);
        // Abstract GT word for NS entry word3: dom[27] | perm[30:28].
        // getPermBits returns (perm3 << 1) | dom; shifting by 27 places
        // dom at bit 27 and perm3 at bits [30:28] per the new GT layout.
        const abstractGtWord = (this.getPermBits(perms) << 27) >>> 0;
        this.writeNSEntry(idx, loc, lim17, 0, 0, 0, gtType, 0, cc || undefined, abstractGtWord);
        this.nsLabels[idx] = label;
        // Word 0: lump header (magic=0x1F, n_minus_6, cw=codeLen, cc, typ=0).
        // Previously a GT word was written here, which broke CALL dispatch and
        // lumpSaveLump because both require magic=0x1F at bits[31:27] of word 0.
        this.memory[loc] = this.packLumpHeader(n_minus_6, codeLen, cc, 0);
        for (let i = 0; i < codeLen; i++) {
            this.memory[loc + 1 + i] = words[i] >>> 0;
        }
        // Zero freespace and c-list region.
        for (let i = 1 + codeLen; i < lumpSize; i++) {
            this.memory[loc + i] = 0;
        }
        this.emit('stateChange', this.getState());
        return idx;
    }

    saveToNamespaceAt(idx, label, words, perms, gtType) {
        perms = perms || {R:0,W:0,X:1,L:0,S:0,E:0};
        gtType = (gtType !== undefined && gtType !== null) ? gtType : 1;
        const loc = idx * this.SLOT_SIZE;
        const codeLen = words.length;
        const cc = 0;
        // Lump must be a power-of-2 block >= 64 words that fits header + code + c-list.
        let lumpSize = 64;
        while (lumpSize < 1 + codeLen + cc) lumpSize <<= 1;
        const n_minus_6 = Math.max(0, Math.ceil(Math.log2(lumpSize)) - 6);
        // NS entry limit17 = index of last valid code/data word = lumpSize - cc - 1.
        const lim17 = Math.min(lumpSize - cc - 1, 0x1FFFF);
        // Zero the entire lump region before writing the new lump.
        for (let j = 0; j < lumpSize; j++) {
            if (loc + j < this.memory.length) this.memory[loc + j] = 0;
        }
        // Abstract GT word for NS entry word3: dom[27] | perm[30:28] (same as above).
        const abstractGtWord = (this.getPermBits(perms) << 27) >>> 0;
        this.writeNSEntry(idx, loc, lim17, 0, 0, 0, gtType, 0, cc || undefined, abstractGtWord);
        this.nsLabels[idx] = label;
        // Word 0: lump header (magic=0x1F, n_minus_6, cw=codeLen, cc, typ=0).
        // Previously a GT word was written here, which broke CALL dispatch and
        // lumpSaveLump because both require magic=0x1F at bits[31:27] of word 0.
        this.memory[loc] = this.packLumpHeader(n_minus_6, codeLen, cc, 0);
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
        this.writeNSEntry(idx, loc, lim17, parsed.b, parsed.g, parsed.gtType, (entry.word2_seals >>> 25) & 0x7F, undefined, entry.word3_abstract_gt || 0);
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
                raw: [this.memory[base], this.memory[base + 1], this.memory[base + 2], this.memory[base + 3]],
            });
        }
        return dump;
    }
}

// ── Task #1077: structured fault record codes ──────────────────────────────
// Mirrors _FAULT_CODES in app-run.js so fault() can embed a numeric hardware
// code directly in the fault entry without requiring the IDE to be loaded.
ChurchSimulator.FAULT_CODES = {
    PERM_R: 0x01, PERM_W: 0x02, PERM_X: 0x03, PERM_L: 0x04, PERM_S: 0x05, PERM_E: 0x06,
    NULL_CAP: 0x07, BOUNDS: 0x08, VERSION: 0x09, SEAL: 0x0A, INVALID_OP: 0x0B,
    TPERM_RSV: 0x0C, DOMAIN_PURITY: 0x0D, BIND: 0x0E, F_BIT: 0x0F,
    STACK_OVERFLOW: 0x10, ABSENT_OUTFORM: 0x11, STACK_CORRUPT: 0x12,
    STACK_UNDERFLOW: 0x13, OUTFORM_CRC: 0x15, OUTFORM_ALLOC: 0x16,
    OUTFORM_MINT: 0x17, OUTFORM_HDR: 0x18, RANGE: 0x10,
    // Software-only (no hardware code):
    PERM: null, BOOT: null, MATH_ERROR: null, DOMAIN_ERROR: null,
    HANDLER: null, PERMISSION: null, TYPE: null, THREAD: null,
    LUMP_MAGIC: null, LUMP_SIZE: null, LUMP_LAYOUT: null, LUMP_OOM: null,
    NO_CODE: null, PRIVATE_METHOD: null, CODE_NOT_RESIDENT: null, PRIV_REG: null,
    LAZY_RESOLVE_PENDING: null,
};

// Task #1530: Scheduler IRQ c-list — exposed for external test code.
// Mirrors hardware/boot_rom.py SCHEDULER_IRQ_CLIST.
// Parallel spec in simulator/system_abstractions.js SCHEDULER_IRQ_CLIST_SPEC.
ChurchSimulator.SCHEDULER_IRQ_CLIST = SCHEDULER_IRQ_CLIST;

// ── Lazy-Resolve: Pending GT sentinel (Task #1446) ─────────────────────────
// A pending GT carries the magic tag 0xFEED in bits[31:16] and a pet-name
// index in bits[15:0].  The name index references PENDING_GT_NAMES[].
// Sentinel values cannot appear as valid GTs:
//   • Valid GT bits[31:25] = permission bits (max 0x7F = 0b1111111)
//   • Valid GT bits[24:23] = type (0–3)
//   • The upper 16 bits of a max-permission Inform GT = 0b1111111_11 = 0x1FF << 7… 
//     but packed as (perm<<25)|(type<<23) the upper 16 bits can reach at most 0xFF80.
//   • 0xFEED (>= 0xFF80 for the top byte 0xFE = 0b11111110) is safely distinct.
ChurchSimulator.PENDING_GT_TAG   = 0xFEED;  // upper 16 bits of any pending sentinel
ChurchSimulator.PENDING_GT_NAMES = [];       // static registry: index → pet name string

// Restore PENDING_GT_NAMES from localStorage so pet names survive page reloads.
// The sentinel format (0xFEED____) is unchanged; only the name lookup table is
// re-populated from the persisted JSON string.
(function () {
    if (typeof localStorage === 'undefined') return;
    try {
        const saved = localStorage.getItem('church_pending_gt_names');
        if (saved) {
            const arr = JSON.parse(saved);
            if (Array.isArray(arr)) ChurchSimulator.PENDING_GT_NAMES = arr;
        }
    } catch (e) { /* ignore parse errors */ }
})();

ChurchSimulator.isPendingGT = function (word) {
    return ((word >>> 0) >>> 16) === 0xFEED;
};

ChurchSimulator.makePendingGT = function (petName) {
    const names = ChurchSimulator.PENDING_GT_NAMES;
    let idx = names.indexOf(petName);
    if (idx < 0) {
        idx = names.length;
        names.push(petName);
        // Persist the updated registry so pet names survive page reloads.
        if (typeof localStorage !== 'undefined') {
            try { localStorage.setItem('church_pending_gt_names', JSON.stringify(names)); }
            catch (e) { /* storage full or private-mode — non-fatal */ }
        }
    }
    if (idx > 0xFFFF) idx = 0xFFFF;  // clamp (won't happen in practice)
    return (0xFEED0000 | (idx & 0xFFFF)) >>> 0;
};

ChurchSimulator.pendingGTName = function (word) {
    const idx = (word >>> 0) & 0xFFFF;
    return ChurchSimulator.PENDING_GT_NAMES[idx] || ('pending#' + idx);
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChurchSimulator;
}
