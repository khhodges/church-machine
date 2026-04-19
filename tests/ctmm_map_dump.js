// ctmm_map_dump.js — Gather all CTMM memory-map data for docs/ctmm-memory-map.md
//
// Usage:
//   node tests/ctmm_map_dump.js
//
// Boots the simulator with the default 16384-word boot config (matching the
// standard IDE configuration), then emits a JSON report with:
//   - regions: top-level memory regions
//   - nsEntries: full NS table decode
//   - conflicts: address-overlap pairs
//   - lumpHeaders: header validity per NS slot
//   - disassembly: per-slot code word tables
//   - threadLump: thread lump internal layout
//   - stateAudit: classification of all ChurchSimulator this.* properties

'use strict';

global.window = {
    bootConfig: {
        step1: {
            totalNamespaceWords: 16384,
            namespaceLumpWords:   64,
            threadLumpWords:     256,
            abstractionLumpWords: 256,
        },
        step2: { lumps: [] },
        step3: { baseNamedNsCount: 17, emptySlotCount: 0 },
    }
};

const ChurchSimulator = require('../simulator/simulator.js');
const ChurchAssembler = require('../simulator/assembler.js');

const sim  = new ChurchSimulator();
const asm  = new ChurchAssembler();

// Boot fully
let iters = 0;
while (iters < 64 && !sim.bootComplete && !sim.halted) {
    sim._bootStep();
    iters++;
}

const MEM_WORDS = sim.memory.length;           // 16384
const NS_TABLE_BASE = sim.NS_TABLE_BASE;       // MEM_WORDS - 0x300
const NS_ENTRY_WORDS = sim.NS_ENTRY_WORDS;     // 3
const NS_TABLE_RESERVE = sim.NS_TABLE_RESERVE; // 0x300 = 768 words
const IO_BASE  = 0xFE00;   // historical 65536-word IO segment (not in 16384-word space)
const SLOT_SIZE = sim.SLOT_SIZE;               // 64

// ── 1. Top-level memory regions ───────────────────────────────────────────────
const regions = [
    { name: 'Lump area',        start: 0,              end: NS_TABLE_BASE - 2,  notes: 'All object lumps (NS, thread, abstraction, entry, code lumps, etc.)' },
    { name: 'Format tag word',  start: NS_TABLE_BASE - 1, end: NS_TABLE_BASE - 1, notes: 'BOOT_IMAGE_FORMAT_TAG (0xB0070229) — version sentinel' },
    { name: 'NS table',         start: NS_TABLE_BASE,   end: NS_TABLE_BASE + NS_TABLE_RESERVE - 1, notes: `Up to ${NS_TABLE_RESERVE / NS_ENTRY_WORDS} × 3-word entries` },
];
// MMIO: only relevant in the historical 65536-word space; note it anyway
const mmioNote = MEM_WORDS === 65536
    ? { name: 'IO segment', start: 0xFE00, end: 0xFEFF, notes: 'Memory-mapped device registers (UART, LED, Button, Timer)' }
    : { name: 'IO segment', start: 'N/A', end: 'N/A', notes: `IO segment at 0xFE00 is outside this ${MEM_WORDS}-word window; MMIO handled by NS entry location field pointing to physical peripheral address` };

// ── 2. NS table decode ────────────────────────────────────────────────────────
function parseNSWord1(w) {
    w = w >>> 0;
    const g          = (w >>> 31) & 1;
    const f          = (w >>> 30) & 1;
    const b          = (w >>> 29) & 1;
    const chainable  = (w >>> 28) & 1;
    const gtType     = (w >>> 26) & 0x3;
    const clistCount = (w >>> 17) & 0x1FF;
    const limit17    = w & 0x1FFFF;
    const typeNames  = ['NULL', 'Inform', 'Outform', 'Abstract'];
    return { g, f, b, chainable, gtType, typeName: typeNames[gtType], clistCount, limit17 };
}

const nsEntries = [];
for (let i = 0; i < sim.nsCount; i++) {
    const base = NS_TABLE_BASE + i * NS_ENTRY_WORDS;
    const w0 = sim.memory[base + 0] >>> 0;
    const w1 = sim.memory[base + 1] >>> 0;
    const w2 = sim.memory[base + 2] >>> 0;
    const label = sim.nsLabels[i] || '';
    const p = parseNSWord1(w1);
    const version = (w2 >>> 25) & 0x7F;
    const seal    = w2 & 0xFFFF;
    nsEntries.push({
        slot: i, label, w0, w1, w2,
        location: w0,
        limit17: p.limit17,
        gtType: p.gtType, typeName: p.typeName,
        clistCount: p.clistCount,
        chainable: p.chainable,
        f: p.f, b: p.b, g: p.g,
        version, seal,
        // Derive expected lump size from limit17 if it encodes a power-of-two slot
        // For the NS slot 0 the limit17 is the full memory extent.
        isMMIO: (w0 > NS_TABLE_BASE || w0 > MEM_WORDS) && w0 !== 0,
    });
}

// ── 3. Lump header validity ───────────────────────────────────────────────────
// For each NS entry, read memory[location] and parse the lump header.
// Map each NS slot → expected allocSize (from _initNamespaceTable slotSizes logic)
const THREAD_LUMP_SIZE = 256;
const BOOT_ABSTR_LUMP_SIZE = 256;
const NS_LUMP_SIZE = SLOT_SIZE; // 64
const slotExpectedSize = {};
slotExpectedSize[0] = NS_LUMP_SIZE;
slotExpectedSize[1] = THREAD_LUMP_SIZE;
slotExpectedSize[2] = SLOT_SIZE;   // Boot.Abstr director
slotExpectedSize[3] = BOOT_ABSTR_LUMP_SIZE; // Boot.Entry
// Others default to SLOT_SIZE (64)

const lumpHeaders = [];
for (const e of nsEntries) {
    const loc = e.location;
    // MMIO slots (location > memory bounds) are special; skip header check
    if (loc === 0 && e.slot !== 0) {
        lumpHeaders.push({ slot: e.slot, label: e.label, location: loc, status: 'ABSENT', reason: 'location=0 (null lump)' });
        continue;
    }
    if (loc >= MEM_WORDS) {
        lumpHeaders.push({ slot: e.slot, label: e.label, location: loc, status: 'MMIO', reason: `MMIO device at word address 0x${loc.toString(16).toUpperCase()} (outside ${MEM_WORDS}-word namespace memory)` });
        continue;
    }
    // Slot 0 (NS root) — its location is 0 (the NS lump), which starts at word 0
    const hdrWord = sim.memory[loc] >>> 0;
    const hdr = sim.parseLumpHeader(hdrWord);
    const expectedSize = slotExpectedSize[e.slot] !== undefined ? slotExpectedSize[e.slot] : SLOT_SIZE;

    if (!hdr.valid) {
        lumpHeaders.push({
            slot: e.slot, label: e.label, location: loc,
            hdrWord: hdrWord.toString(16).toUpperCase().padStart(8,'0'),
            status: 'INVALID', reason: `magic=0x${hdr.magic.toString(16).toUpperCase()} (expected 0x1F)`,
            hdr
        });
        continue;
    }
    // Check allocSize matches expected
    const sizeOk = hdr.lumpSize === expectedSize;
    const status = sizeOk ? 'VALID' : 'VALID_SIZE_MISMATCH';
    lumpHeaders.push({
        slot: e.slot, label: e.label, location: loc,
        hdrWord: hdrWord.toString(16).toUpperCase().padStart(8,'0'),
        status,
        hdr,
        expectedSize,
        sizeMatch: sizeOk,
        reason: sizeOk ? null : `n_minus_6=${hdr.n_minus_6} → lumpSize=${hdr.lumpSize} but expected ${expectedSize}`,
    });
}

// ── 4. Address conflict detection ─────────────────────────────────────────────
// Build intervals [loc, loc+size-1] for all lumps in memory (skip MMIO/null)
const intervals = [];
for (const lh of lumpHeaders) {
    if (lh.status === 'ABSENT' || lh.status === 'MMIO') continue;
    const size = lh.hdr ? lh.hdr.lumpSize : SLOT_SIZE;
    intervals.push({ slot: lh.slot, label: lh.label, start: lh.location, end: lh.location + size - 1 });
}
// Add NS table as a region
intervals.push({ slot: 'NS_TABLE', label: 'NS table', start: NS_TABLE_BASE, end: NS_TABLE_BASE + NS_TABLE_RESERVE - 1 });
intervals.push({ slot: 'FMT_TAG', label: 'Format tag', start: NS_TABLE_BASE - 1, end: NS_TABLE_BASE - 1 });

const conflicts = [];
for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
        const a = intervals[i], b = intervals[j];
        const overlapStart = Math.max(a.start, b.start);
        const overlapEnd   = Math.min(a.end, b.end);
        if (overlapStart <= overlapEnd) {
            conflicts.push({
                slotA: a.slot, labelA: a.label, rangeA: `0x${a.start.toString(16).toUpperCase()}–0x${a.end.toString(16).toUpperCase()}`,
                slotB: b.slot, labelB: b.label, rangeB: `0x${b.start.toString(16).toUpperCase()}–0x${b.end.toString(16).toUpperCase()}`,
                overlapStart: `0x${overlapStart.toString(16).toUpperCase()}`,
                overlapEnd:   `0x${overlapEnd.toString(16).toUpperCase()}`,
                overlapWords: overlapEnd - overlapStart + 1,
            });
        }
    }
}

// ── 5. Code word decompilation ────────────────────────────────────────────────
const disassembly = [];
for (const lh of lumpHeaders) {
    if (lh.status !== 'VALID' && lh.status !== 'VALID_SIZE_MISMATCH') continue;
    if (!lh.hdr || lh.hdr.cw === 0) continue;
    const loc = lh.location;
    const cw  = lh.hdr.cw;
    const words = [];
    for (let w = 0; w < cw; w++) {
        const addr = loc + 1 + w;
        const word = addr < MEM_WORDS ? (sim.memory[addr] >>> 0) : 0;
        let mnemonic;
        try {
            mnemonic = word === 0 ? 'HALT (empty slot)' : asm.disassemble(word);
        } catch (_) {
            mnemonic = `??? 0x${word.toString(16).padStart(8,'0')}`;
        }
        words.push({ offset: w + 1, addr, hex: word.toString(16).toUpperCase().padStart(8,'0'), mnemonic, empty: word === 0 });
    }
    disassembly.push({ slot: lh.slot, label: lh.label, location: loc, cw, cc: lh.hdr.cc, words });
}

// ── 6. Thread lump layout ─────────────────────────────────────────────────────
const threadEntry = nsEntries.find(e => e.slot === 1);
const threadBase  = threadEntry ? threadEntry.location : null;

// ── 7. Simulator state audit ──────────────────────────────────────────────────
// Enumerate all own properties of the sim that are set by reset() / constructor()
// and classify them.

const stateAudit = {
    inMemory: [
        { prop: 'memory[0 .. NS_TABLE_BASE-2]', desc: 'Object lumps (lump area)' },
        { prop: 'memory[NS_TABLE_BASE-1]', desc: 'Boot image format tag (0xB0070229)' },
        { prop: 'memory[NS_TABLE_BASE .. NS_TABLE_BASE+NS_TABLE_RESERVE-1]', desc: 'NS table (3 words × up to 256 entries)' },
    ],
    hardwareRegisters: [
        { prop: 'this.pc',       desc: 'Program counter — hardware register, not in DMEM by design' },
        { prop: 'this.physicalPC', desc: 'Resolved physical PC — derived from pc + code base' },
        { prop: 'this.sto',      desc: 'Stack Top Offset — hardware register in thread lump address space' },
        { prop: 'this.flags',    desc: 'Condition flags (N,Z,C,V) — hardware register file' },
        { prop: 'this.running',  desc: 'Execution state machine (running/halted/stepping) — hardware control' },
        { prop: 'this.halted',   desc: 'HALT latch — hardware control' },
    ],
    gapsNotInMemory: [
        {
            prop: 'this.dr[0..15]',
            desc: 'Data registers DR0–DR15',
            gap: 'Thread lump spec says +1..+16 are DR0–DR15, but DREAD/DWRITE never read or write those addresses. The DR array is only in this.dr[].',
            expectedAddr: 'threadBase+1 .. threadBase+16',
        },
        {
            prop: 'this.cr[i].word1 / .word2 / .word3',
            desc: 'CR location, limit, and seal fields',
            gap: 'CALL microcode packs cw−1 into cr.word2 at call time; getFormattedCR() reads the cache. But the NS table (memory[NS_TABLE_BASE + slot*3 + 1]) stores the full NS W1 limit (lumpSize−cc−1). Both should agree because the memory is the ground truth. CRs 0–11 persist only their GT (word0) in the thread lump caps zone; word1/2/3 should be derived from the NS entry on demand.',
            expectedAddr: 'readNSEntry(cr.gtIndex) for word1/word2/word3',
        },
    ],
    ideMetadata: [
        { prop: 'this.nsLabels',       desc: 'Symbolic names for NS slots — IDE display aid, not CTMM state' },
        { prop: 'this.nsClistMap',     desc: 'Cached c-list relationships — IDE display aid' },
        { prop: 'this.nsHandlers',     desc: 'Abstraction dispatch handlers — IDE simulation aid' },
        { prop: 'this.bootStep',       desc: 'Boot state machine step counter — simulator control, not CTMM state' },
        { prop: 'this.bootComplete',   desc: 'Boot completion flag — simulator control' },
        { prop: 'this.mElevation',     desc: 'M-bit elevation flag — transient hardware signal, not stored in DMEM' },
        { prop: 'this.gcPolarity',     desc: 'GC G-bit polarity — simulator GC internal' },
        { prop: 'this.ledBits/ledMode',desc: 'LED display state — UI aid (MMIO registers are in memory; this is a display cache)' },
        { prop: 'this.callStack[]',    desc: 'JS mirror of call frames (actual frames written to thread lump memory via _threadWrite) — valid shadow for speed, ground truth is in thread lump' },
        { prop: 'this.output',         desc: 'Debug log string — IDE trace, not CTMM state' },
        { prop: 'this.faultLog',       desc: 'Fault history — IDE audit, not CTMM state' },
        { prop: 'this.auditLog',       desc: 'Capability audit log — IDE audit' },
        { prop: 'this._instrHistory',  desc: 'Instruction trace ring — IDE display' },
        { prop: 'this.stepCount',      desc: 'Instruction counter — simulator telemetry' },
        { prop: 'this.lastSignedReturn', desc: 'Signed-return readout — IDE display cache' },
        { prop: 'this.lambdaActive / lambdaReturnPC / lambdaCachedFrame', desc: 'LAMBDA micro-instruction state — transient hardware signal' },
        { prop: 'this.lastCapability', desc: 'Last used capability — IDE display cache' },
        { prop: 'this.lazyManifest',   desc: 'Lazy loader manifest — IDE loader aid' },
        { prop: 'this._loaderSlot',    desc: 'Lazy loader NS slot — IDE loader aid' },
        { prop: 'this.awaitingLump',   desc: 'Pending lazy-load slot — IDE loader aid' },
        { prop: 'this.nsCount',        desc: 'NS entry count — derived from NS table scan; technically redundant with memory' },
    ],
};

// ── Output ────────────────────────────────────────────────────────────────────
const report = {
    memWords: MEM_WORDS,
    nsTableBase: NS_TABLE_BASE,
    nsTableReserve: NS_TABLE_RESERVE,
    slotSize: SLOT_SIZE,
    bootComplete: sim.bootComplete,
    nsCount: sim.nsCount,
    threadBase,
    regions,
    mmioNote,
    nsEntries,
    lumpHeaders,
    conflicts,
    disassembly,
    stateAudit,
};

process.stdout.write(JSON.stringify(report, null, 2));
