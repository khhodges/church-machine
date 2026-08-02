#!/usr/bin/env node
// scripts/build_wukong_callhome_lump.js
//
// Assembles simulator/examples/wukong_callhome.cloomc using the production
// ChurchAssembler (simulator/assembler.js), packs the result into a valid LUMP
// binary, and writes:
//
//   server/lumps/<token>.lump   — binary (big-endian 32-bit words)
//   server/lumps/<token>.json   — sidecar metadata
//
// The token is the CRC-32 of all binary bytes, lower-cased 8-hex-char string.
//
// C-List (cc=2) — tail of the lump, 2 slots:
//   Slot 0  0x4A000006  E    SelfTest (NS slot 6)  — validate CM hardware
//   Slot 1  0x4A000016  E    Tunnel   (NS slot 22) — CALL HOME
//
// Usage:
//   node scripts/build_wukong_callhome_lump.js

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT        = path.resolve(__dirname, '..');
const ASSEMBLER   = path.join(ROOT, 'simulator', 'assembler.js');
const SOURCE      = path.join(ROOT, 'simulator', 'examples', 'wukong_callhome.cloomc');
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
    console.error('Assembly errors in wukong_callhome.cloomc:');
    for (const e of result.errors) {
        console.error(`  Line ${e.line}: ${e.message}`);
    }
    process.exit(1);
}

const words = result.words;
console.log(`Assembled ${words.length} instruction words.`);

// ── C-List definition ─────────────────────────────────────────────────────────
//
// cc = 2  (POLA minimum: one E-GT per external abstraction accessed).
//   Slot 0: SelfTest E-GT (NS slot 6)  — ELOADCALL target for "SelfTest Run"
//   Slot 1: Tunnel   E-GT (NS slot 22) — ELOADCALL target for "Tunnel Register"
//
// GT word layout (v2.0):
//   b_flag[31] | perm[30:28] | dom[27] | gt_type[26:25] | gt_seq[24:16] | slot[15:0]
//   E-only perm: bit30=1, bit29=0, bit28=0 → perm=0b100
//   dom=1, GT_TYPE_INFORM=0b01
//   SelfTest slot  6 = 0x06 → GT = 0x4A000006
//   Tunnel   slot 22 = 0x16 → GT = 0x4A000016
//
const CLIST = [
    { gt: 0x4A000006, name: 'SelfTest', ns_slot:  6, grants: ['E'],
      note: 'SelfTest E-GT (NS slot 6)  — hardware correctness validator' },
    { gt: 0x4A000016, name: 'Tunnel',   ns_slot: 22, grants: ['E'],
      note: 'Tunnel E-GT   (NS slot 22) — IDE CALL HOME channel' },
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
const cc = CLIST.length;   // 2
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

// ── Write .lump binary ───────────────────────────────────────────────────────
const lumpPath    = path.join(LUMPS_DIR, `${token}.lump`);
const sidecarPath = path.join(LUMPS_DIR, `${token}.json`);

fs.writeFileSync(lumpPath, bytes);
console.log(`Written: ${lumpPath} (${bytes.length} bytes)`);

// ── Write sidecar .json ───────────────────────────────────────────────────────
const capabilities = CLIST.map(c => ({
    name:    c.name,
    grants:  c.grants,
    gt:      '0x' + c.gt.toString(16).padStart(8, '0'),
    ns_slot: c.ns_slot,
    note:    c.note,
}));

const sidecar = {
    token,
    abstraction:     'WukongCallHome',
    ns_slot:         7,
    ns_slot_policy:  'static',
    lump_size:       lumpSize,
    typ:             0,
    content_type:    'code',
    cw,
    cc,
    profile:         'IoT',
    language:        'assembly',
    description:     'Wukong boot coordinator: run SelfTest, CALL HOME via Tunnel.Register, ' +
                     'return to IDE if online or spin offline. Wukong NS slot 7.',
    capabilities,
    grants:          ['E'],
    author:          'Church Machine',
    version:         '1.0',
    lump_version:    0,
};

fs.writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2) + '\n');
console.log(`Written: ${sidecarPath}`);

// ── Print c-list slot assignments ─────────────────────────────────────────────
console.log('\nC-List GT slot assignments (cc=2, tail-packed):');
for (let i = 0; i < CLIST.length; i++) {
    const gt = '0x' + CLIST[i].gt.toString(16).padStart(8, '0');
    console.log(`  slot ${i}  ${gt}  ${CLIST[i].note}`);
}

// ── Update manifest.json ──────────────────────────────────────────────────────
const manifestEntry = {
    token,
    abstraction:     'WukongCallHome',
    ns_slot:         7,
    ns_slot_policy:  'static',
    variant_group:   null,
    lump_size:       lumpSize,
    cw,
    cc,
    grants:          ['E'],
    lump_version:    0,
};

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const existingIdx = manifest.findIndex(e => e.abstraction === 'WukongCallHome');
if (existingIdx !== -1) {
    console.log('\nExisting WukongCallHome entry found — replacing it.');
    manifest.splice(existingIdx, 1);
}
manifest.push(manifestEntry);
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 4) + '\n');
console.log(`Updated: ${MANIFEST}`);

console.log('\nManifest entry written:');
console.log(JSON.stringify(manifestEntry, null, 4));
console.log('\nDone.');
