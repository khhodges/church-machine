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
// Use the simulator's own parseNSWord1() so bit-field positions exactly match
// the hardware-matching implementation in simulator.js (packNSWord1/parseNSWord1).
// Field layout: [31]=B, [30]=F, [29]=G, [28]=chainable, [27:26]=gtType,
//               [25:17]=clistCount, [16:0]=limit.
const GT_TYPE_NAMES = ['NULL', 'Inform', 'Outform', 'Abstract'];

const nsEntries = [];
for (let i = 0; i < sim.nsCount; i++) {
    const base = NS_TABLE_BASE + i * NS_ENTRY_WORDS;
    const w0 = sim.memory[base + 0] >>> 0;
    const w1 = sim.memory[base + 1] >>> 0;
    const w2 = sim.memory[base + 2] >>> 0;
    const label = sim.nsLabels[i] || '';
    const p = sim.parseNSWord1(w1);   // authoritative decode from simulator
    const version = (w2 >>> 25) & 0x7F;
    const seal    = w2 & 0xFFFF;
    nsEntries.push({
        slot: i, label, w0, w1, w2,
        location: w0,
        limit: p.limit,               // bits[16:0] — limit field
        gtType: p.gtType, typeName: GT_TYPE_NAMES[p.gtType] || '?',
        clistCount: p.clistCount,     // bits[25:17]
        chainable: p.chainable,       // bit[28]
        f: p.f,                       // bit[30] F-flag
        b: p.b,                       // bit[31] B-flag
        g: p.g,                       // bit[29] G-bit (GC liveness)
        version, seal,
    });
}

// ── 3. Lump header validity ───────────────────────────────────────────────────
// Taxonomy per task spec:
//   VALID   — magic=0x1F and field values in range
//   INVALID — bad magic or out-of-range fields; reason stated
//   ABSENT  — location=0 or slot is empty (no header to check)
//
// Map each NS slot → expected allocSize (from _initNamespaceTable slotSizes logic)
const slotExpectedSize = {};
slotExpectedSize[0] = SLOT_SIZE;   // Boot.NS (64w; location=0 → ABSENT)
slotExpectedSize[1] = 256;         // Boot.Thread
slotExpectedSize[2] = SLOT_SIZE;   // free/null slot (Task #247)
slotExpectedSize[3] = 256;         // Boot.Abstr
// Slots 4+ default to SLOT_SIZE (64)

const lumpHeaders = [];
for (const e of nsEntries) {
    const loc = e.location;

    // ABSENT: location=0 (spec: "location=0 or slot is empty")
    if (loc === 0) {
        lumpHeaders.push({
            slot: e.slot, label: e.label, location: loc,
            status: 'ABSENT',
            reason: 'location=0 — NS root lump descriptor; no standard lump header at word 0',
        });
        continue;
    }

    // Out-of-bounds: location beyond memory window (shouldn't happen in normal configs)
    if (loc >= MEM_WORDS) {
        lumpHeaders.push({
            slot: e.slot, label: e.label, location: loc,
            status: 'ABSENT',
            reason: `location 0x${loc.toString(16).toUpperCase()} is outside the ${MEM_WORDS}-word memory window`,
        });
        continue;
    }

    const hdrWord = sim.memory[loc] >>> 0;
    const hdr = sim.parseLumpHeader(hdrWord);
    const expectedSize = slotExpectedSize[e.slot] !== undefined ? slotExpectedSize[e.slot] : SLOT_SIZE;

    if (!hdr.valid) {
        lumpHeaders.push({
            slot: e.slot, label: e.label, location: loc,
            hdrWord: hdrWord.toString(16).toUpperCase().padStart(8,'0'),
            status: 'INVALID',
            reason: `magic=0x${hdr.magic.toString(16).toUpperCase()} (expected 0x1F); lump body not yet loaded`,
            hdr,
        });
        continue;
    }
    // Valid magic — check allocSize match
    const sizeOk = hdr.lumpSize === expectedSize;
    lumpHeaders.push({
        slot: e.slot, label: e.label, location: loc,
        hdrWord: hdrWord.toString(16).toUpperCase().padStart(8,'0'),
        status: 'VALID',
        hdr,
        expectedSize,
        sizeMatch: sizeOk,
        sizeNote: sizeOk ? null : `lumpSize=${hdr.lumpSize} but expected ${expectedSize}`,
    });
}

// ── 4. Address conflict detection ─────────────────────────────────────────────
// Build intervals [loc, loc+size-1] for all lumps in memory (skip MMIO/null)
const intervals = [];
for (const lh of lumpHeaders) {
    // Skip ABSENT slots (location=0 or out-of-bounds — no interval in memory)
    if (lh.status === 'ABSENT') continue;
    // For INVALID lumps (lazy/unloaded), still include the allocated slot range
    // (the NS entry claims a 64-word slot even though the header is not yet written)
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
    if (lh.status !== 'VALID') continue;
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

// ── 6b. DR zone assertion — memory[threadBase+1..+16] must match this.dr[] ───
// After boot (and after any DREAD/DWRITE), the DR home slots in the thread lump
// must be bit-for-bit equal to the simulator's this.dr[] register file.
// This is the CTMM invariant: the machine is defined by the memory.
const drZoneAssertions = [];
if (threadBase !== null) {
    for (let di = 0; di < 16; di++) {
        const memVal = sim.memory[threadBase + 1 + di] >>> 0;
        const regVal = sim.dr[di] >>> 0;
        drZoneAssertions.push({
            drIdx: di,
            memAddr: threadBase + 1 + di,
            memVal,
            regVal,
            match: memVal === regVal,
        });
    }
}
const drZoneAllMatch = drZoneAssertions.every(a => a.match);
if (!drZoneAllMatch) {
    const failures = drZoneAssertions.filter(a => !a.match);
    process.stderr.write(`CTMM INVARIANT VIOLATION: DR zone in memory does not match this.dr[] after boot.\n`);
    for (const f of failures) {
        process.stderr.write(`  DR${f.drIdx} @ mem[0x${f.memAddr.toString(16).toUpperCase()}]: memory=0x${f.memVal.toString(16).padStart(8,'0')} != dr=0x${f.regVal.toString(16).padStart(8,'0')}\n`);
    }
    process.exit(1);
}

// ── 7. Simulator state audit ──────────────────────────────────────────────────
// Enumerate all own properties of the sim that are set by reset() / constructor()
// and classify them.

const stateAudit = {
    inMemory: [
        { prop: 'memory[0 .. NS_TABLE_BASE-2]', desc: 'Object lumps (lump area)' },
        { prop: 'memory[NS_TABLE_BASE-1]', desc: 'Boot image format tag (0xB0070229)' },
        { prop: 'memory[NS_TABLE_BASE .. NS_TABLE_BASE+NS_TABLE_RESERVE-1]', desc: 'NS table (3 words × up to 256 entries)' },
        { prop: 'memory[threadBase+1 .. threadBase+16]', desc: 'DR zone — DR0–DR15 home slots in thread lump (FIXED: DREAD/DWRITE now write-through; RETURN syncs back)' },
        { prop: 'cr[i].word2 = nsEntry.word1_limit', desc: 'CR limit/meta field now stores raw NS entry word1 verbatim (FIXED: boot and CALL paths no longer pack cw−1/cc−1)' },
    ],
    hardwareRegisters: [
        { prop: 'this.pc',       desc: 'Program counter — hardware register, not in DMEM by design' },
        { prop: 'this.physicalPC', desc: 'Resolved physical PC — derived from pc + code base' },
        { prop: 'this.sto',      desc: 'Stack Top Offset — hardware register in thread lump address space' },
        { prop: 'this.flags',    desc: 'Condition flags (N,Z,C,V) — hardware register file' },
        { prop: 'this.running',  desc: 'Execution state machine (running/halted/stepping) — hardware control' },
        { prop: 'this.halted',   desc: 'HALT latch — hardware control' },
    ],
    gapsNotInMemory: [],
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
    drZoneAllMatch,
    drZoneAssertions,
    stateAudit,
};

process.stdout.write(JSON.stringify(report, null, 2));
