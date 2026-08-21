#!/usr/bin/env node
// scripts/build_capability_test_lump.js
//
// Assembles simulator/examples/capability_test.cloomc using the production
// ChurchAssembler (simulator/assembler.js), packs the result into a valid LUMP
// binary, and writes:
//
//   server/lumps/<token>.lump   — binary (big-endian 32-bit words)
//   server/lumps/<token>.json   — sidecar metadata
//
// The token is the CRC-32 of all binary bytes, lower-cased 8-hex-char string.
//
// C-List (cc=5) — tail of the lump, 5 slots:
//   Slot 0  SelfTest   (NS slot 6, E)    — E-perm callable abstraction
//   Slot 1  LED_DEV    (NS slot 3, RW)   — hardware LED register file
//   Slot 2  UART_DEV   (NS slot 2, RW)   — hardware UART TX/STATUS/RX
//   Slot 3  BTN_DEV    (NS slot 4, R)    — hardware button state
//   Slot 4  TIMER_DEV  (NS slot 5, RW)   — hardware timer registers
//
// GT encoding (v2.0):
//   b_flag[31] | perm[30:28] | dom[27] | gt_type[26:25] | gt_seq[24:16] | slot[15:0]
//
//   Church E-perm:  dom=1, perm3=0b100=4, gt_type=Inform=0b01
//   Turing RW:      dom=0, perm3=0b011=3, gt_type=Inform=0b01
//   Turing R:       dom=0, perm3=0b001=1, gt_type=Inform=0b01
//
//   SelfTest  slot 6 → (4<<28)|(1<<27)|(1<<25)|6 = 0x4A000006
//   LED_DEV   slot 3 → (3<<28)|(0<<27)|(1<<25)|3 = 0x32000003
//   UART_DEV  slot 2 → (3<<28)|(0<<27)|(1<<25)|2 = 0x32000002
//   BTN_DEV   slot 4 → (1<<28)|(0<<27)|(1<<25)|4 = 0x12000004
//   TIMER_DEV slot 5 → (3<<28)|(0<<27)|(1<<25)|5 = 0x32000005
//
// Usage:
//   node scripts/build_capability_test_lump.js

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT        = path.resolve(__dirname, '..');
const ASSEMBLER   = path.join(ROOT, 'simulator', 'assembler.js');
const SOURCE      = path.join(ROOT, 'simulator', 'examples', 'capability_test.cloomc');
const LUMPS_DIR   = path.join(ROOT, 'server', 'lumps');
const MANIFEST    = path.join(LUMPS_DIR, 'manifest.json');

// ── Minimal browser stubs so assembler.js loads in Node.js ──────────────────
global.localStorage = {
    _store: {},
    getItem(k)    { return this._store[k] !== undefined ? this._store[k] : null; },
    setItem(k, v) { this._store[k] = String(v); },
    removeItem(k) { delete this._store[k]; },
};

const vm = require('vm');
vm.runInThisContext(fs.readFileSync(ASSEMBLER, 'utf8'), { filename: 'assembler.js' });

if (typeof ChurchAssembler === 'undefined') {
    console.error('ERROR: ChurchAssembler not found after loading assembler.js');
    process.exit(1);
}

// ── Assemble the source ──────────────────────────────────────────────────────
const source = fs.readFileSync(SOURCE, 'utf8');
const asm    = new ChurchAssembler();
const result = asm.assemble(source);

if (result.errors.length > 0) {
    console.error('Assembly errors in capability_test.cloomc:');
    for (const e of result.errors) {
        console.error(`  Line ${e.line}: ${e.message}`);
    }
    process.exit(1);
}

const words = result.words;
console.log(`Assembled ${words.length} instruction words.`);

// ── C-List definition ─────────────────────────────────────────────────────────
//
// cc = 5  (one GT per declared capability).
//
// GT layout (v2.0):
//   [31]    b_flag  = 0
//   [30:28] perm3   — Church E: 0b100=4; Turing RW: 0b011=3; Turing R: 0b001=1
//   [27]    dom     — Church=1, Turing=0
//   [26:25] gt_type — Inform=0b01
//   [24:16] gt_seq  = 0
//   [15:0]  slot    = NS slot index
//
const CLIST = [
    { gt: 0x4A000006, name: 'SelfTest',   ns_slot: 6, rights: ['E'],
      note: 'SelfTest    Church E-perm Inform GT (NS slot 6)' },
    { gt: 0x32000003, name: 'LED_DEV',    ns_slot: 3, rights: ['R', 'W'],
      note: 'LED_DEV     Turing RW     Inform GT (NS slot 3, MMIO 0x40000000)' },
    { gt: 0x32000002, name: 'UART_DEV',   ns_slot: 2, rights: ['R', 'W'],
      note: 'UART_DEV    Turing RW     Inform GT (NS slot 2, MMIO 0x40000014)' },
    { gt: 0x12000004, name: 'BTN_DEV',    ns_slot: 4, rights: ['R'],
      note: 'BTN_DEV     Turing R-only Inform GT (NS slot 4, MMIO 0x40000028)' },
    { gt: 0x32000005, name: 'TIMER_DEV',  ns_slot: 5, rights: ['R', 'W'],
      note: 'TIMER_DEV   Turing RW     Inform GT (NS slot 5, MMIO 0x4000002C)' },
];

// ── Pack LUMP binary ─────────────────────────────────────────────────────────
//
// Layout (all big-endian 32-bit words):
//   Word 0           : header  — magic(5)|n_minus_6(4)|cw(13)|typ(2)|cc(8)
//   Words 1..cw      : instruction words
//   Words cw+1..     : zero-pad
//   Words lumpSize-cc..lumpSize-1 : c-list GT words (tail-packed)
//
const cw = words.length;
const cc = CLIST.length;   // 5
const totalNeeded = 1 + cw + cc;

let lumpSize = 64;
while (lumpSize < totalNeeded) lumpSize *= 2;

const n_minus_6 = Math.round(Math.log2(lumpSize)) - 6;

if (n_minus_6 < 0 || n_minus_6 > 15)  { console.error('n_minus_6 out of range:', n_minus_6); process.exit(1); }
if (cw < 0    || cw    > 0x1FFF)       { console.error('cw out of range:', cw); process.exit(1); }
if (cc < 0    || cc    > 0xFF)         { console.error('cc out of range:', cc); process.exit(1); }

const headerWord = (
    (0x1F               << 27) |
    ((n_minus_6 & 0xF)  << 23) |
    ((cw        & 0x1FFF) << 10) |
    ((0         & 0x3)  <<  8) |  // typ=0
    (cc & 0xFF)
) >>> 0;

const padded = new Uint32Array(lumpSize);
padded[0] = headerWord;
for (let i = 0; i < cw; i++) padded[1 + i] = words[i] >>> 0;

const clistBase = lumpSize - cc;
for (let i = 0; i < CLIST.length; i++) {
    padded[clistBase + i] = CLIST[i].gt >>> 0;
}

console.log(`LUMP header: 0x${headerWord.toString(16).toUpperCase().padStart(8,'0')}`);
console.log(`  n_minus_6=${n_minus_6} → lump_size=${lumpSize}`);
console.log(`  cw=${cw}  cc=${cc}  typ=0`);
console.log(`  c-list base word index: ${clistBase}`);

// ── Convert to big-endian bytes ──────────────────────────────────────────────
const bytes = Buffer.alloc(lumpSize * 4);
for (let i = 0; i < lumpSize; i++) {
    bytes.writeUInt32BE(padded[i] >>> 0, i * 4);
}

// ── Compute CRC-32 for the token ─────────────────────────────────────────────
function crc32(buf) {
    const table = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) {
                c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            }
            t[n] = c;
        }
        return t;
    })();
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
        crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

const token = crc32(bytes).toString(16).toLowerCase().padStart(8, '0');
console.log(`Token (CRC-32 of binary): ${token}`);

// ── Remove old CapabilityTest lump files ────────────────────────────────────────────
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const existingIdx = manifest.findIndex(e => e.abstraction === 'CapabilityTest');
if (existingIdx !== -1) {
    const oldToken = manifest[existingIdx].token;
    if (oldToken && oldToken !== token) {
        const oldLump     = path.join(LUMPS_DIR, `${oldToken}.lump`);
        const oldSidecar  = path.join(LUMPS_DIR, `${oldToken}.json`);
        if (fs.existsSync(oldLump))    { fs.unlinkSync(oldLump);    console.log(`Removed old: ${oldLump}`); }
        if (fs.existsSync(oldSidecar)) { fs.unlinkSync(oldSidecar); console.log(`Removed old: ${oldSidecar}`); }
    }
    console.log('\nExisting CapabilityTest entry found — replacing it.');
    manifest.splice(existingIdx, 1);
}

// ── Write .lump binary ───────────────────────────────────────────────────────
const lumpPath    = path.join(LUMPS_DIR, `${token}.lump`);
const sidecarPath = path.join(LUMPS_DIR, `${token}.json`);

fs.writeFileSync(lumpPath, bytes);
console.log(`Written: ${lumpPath} (${bytes.length} bytes)`);

// ── Write sidecar .json ───────────────────────────────────────────────────────
//
// IMPORTANT: the "source" field must always be set to the exact text of the
// canonical .cloomc file for known-example abstractions (those whose abstraction
// name maps to a file in simulator/examples/).  Any recompile or rename pass that
// omits this field will be caught immediately by check-sidecar-source.js.
//
const capabilitiesJson = CLIST.map(c => ({
    name:    c.name,
    rights:  c.rights,
    gt:      '0x' + c.gt.toString(16).padStart(8, '0'),
    ns_slot: c.ns_slot,
    note:    c.note,
}));

const sidecar = {
    token,
    abstraction:     'CapabilityTest',
    filename:        `${token}.lump`,
    sidecar_file:    `${token}.json`,
    ns_slot:         10,
    ns_slot_policy:  'static',
    boot_resident:   true,
    lump_size:       lumpSize,
    typ:             0,
    content_type:    'code',
    cw,
    cc,
    status:          'wip',
    profile:         'example',
    language:        'assembly',
    description:     'Capability self-test: LOAD, TPERM, LOADEQ/LOADNE, SWITCH, Turing ISA, ELOADCALL — ' +
                     'exercises real A7 v1.2 boot-namespace caps (UART_DEV, LED_DEV, BTN_DEV, TIMER_DEV, SelfTest).',
    // "source" must always reflect the exact text of simulator/examples/capability_test.cloomc.
    // Never leave this field empty — check-sidecar-source.js enforces it after every recompile.
    source:          source,
    source_file:     'simulator/examples/capability_test.cloomc',
    capabilities:    capabilitiesJson,
    grants:          ['E'],
    author:          'Church Machine',
    version:         '2.0',
    lump_version:    1,
};

fs.writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2) + '\n');
console.log(`Written: ${sidecarPath}`);

// ── Print c-list slot assignments ─────────────────────────────────────────────
console.log('\nC-List GT slot assignments (cc=5, tail-packed):');
for (let i = 0; i < CLIST.length; i++) {
    const gt = '0x' + CLIST[i].gt.toString(16).padStart(8, '0');
    console.log(`  slot ${i}  ${gt}  ${CLIST[i].note}`);
}

// ── Update manifest.json ──────────────────────────────────────────────────────
const manifestEntry = {
    token,
    abstraction:     'CapabilityTest',
    ns_slot:         10,
    ns_slot_policy:  'static',
    boot_resident:   true,
    variant_group:   null,
    lump_size:       lumpSize,
    cw,
    cc,
    grants:          ['E'],
    lump_version:    1,
};

manifest.push(manifestEntry);
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 4) + '\n');
console.log(`Updated: ${MANIFEST}`);

console.log('\nManifest entry written:');
console.log(JSON.stringify(manifestEntry, null, 4));
console.log('\nDone.');
