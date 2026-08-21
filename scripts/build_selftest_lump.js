#!/usr/bin/env node
// scripts/build_selftest_lump.js
//
// Assembles simulator/examples/post_flash_selftest.cloomc using the production
// ChurchAssembler (simulator/assembler.js), packs the result into a valid LUMP
// binary, and writes:
//
//   server/lumps/<token>.lump   — binary (big-endian 32-bit words)
//   server/lumps/<token>.json   — sidecar metadata
//
// The token is the CRC-32 of all binary bytes, lower-cased 8-hex-char string.
// The manifest.json entry is printed to stdout for manual insertion or patch.
//
// C-List (cc=1) — tail of the lump, 1 slot:
//   Slot 0  0x4A000006  E    SelfTest (NS slot 6) — one E-GT loaded into CR1 for TPERM/EXACT tests
//
// Usage:
//   node scripts/build_selftest_lump.js

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT        = path.resolve(__dirname, '..');
const ASSEMBLER   = path.join(ROOT, 'simulator', 'assembler.js');
const SOURCE      = path.join(ROOT, 'simulator', 'examples', 'post_flash_selftest.cloomc');
const LUMPS_DIR   = path.join(ROOT, 'server', 'lumps');
const MANIFEST    = path.join(LUMPS_DIR, 'manifest.json');

// ── Minimal browser stubs so assembler.js loads in Node.js ──────────────────
global.localStorage = {
    _store: {},
    getItem(k)    { return this._store[k] !== undefined ? this._store[k] : null; },
    setItem(k, v) { this._store[k] = String(v); },
    removeItem(k) { delete this._store[k]; },
};

// Execute assembler.js in this process context
const asmSrc = fs.readFileSync(ASSEMBLER, 'utf8');
// Wrap in IIFE to avoid top-level conflicts
const vm = require('vm');
vm.runInThisContext(asmSrc, { filename: 'assembler.js' });

if (typeof ChurchAssembler === 'undefined') {
    console.error('ERROR: ChurchAssembler not found after loading assembler.js');
    process.exit(1);
}

// ── Assemble the source ──────────────────────────────────────────────────────
const source = fs.readFileSync(SOURCE, 'utf8');
const asm    = new ChurchAssembler();
const result = asm.assemble(source);

if (result.errors.length > 0) {
    console.error('Assembly errors:');
    for (const e of result.errors) {
        console.error(`  Line ${e.line}: ${e.message}`);
    }
    process.exit(1);
}

const words = result.words;
console.log(`Assembled ${words.length} instruction words.`);

// ── C-List definition ─────────────────────────────────────────────────────────
//
// cc = 2.
// X-permission is NOT stored in a c-list (constructed dynamically by CALL into CR14,
// a privileged register blocked from TPERM by the assembler).
//
//   slot 0  SelfTest  E  NS slot 6  — E-GT for LOAD+TPERM tests and EXACT cross-comparison.
//           At SelfTest entry:
//             CR0  = E-GT for SelfTest  (Church domain, E-perm; from thread[+244])
//             CR1  = E-GT for SelfTest  (loaded via LOAD CR1, SelfTest from c-list[0])
//           CR0 and CR1 are bit-identical (0x4A000006) — EXACT cross-checks pass.
//           This immutable self-reference is preserved in the boot image.
//
//   slot 1  Next  E  NS slot 6  — Next.GT: continuation called at done: when all tests pass.
//           boot_image.py replaces this template word with the E-GT selected
//           by the ⚡ LightningBolt boot-entry control.
//
const CLIST = [
    { gt: 0x4A000006 }, // 0  SelfTest  E  NS slot 6  — E-GT for TPERM/EXACT tests
    { gt: 0x4A000006 }, // 1  Next      E  template; boot image follows ⚡ entry
];

// ── Pack LUMP binary ─────────────────────────────────────────────────────────
//
// Layout (all big-endian 32-bit words):
//   Word 0           : header  — magic(5)|n_minus_6(4)|cw(13)|typ(2)|cc(8)
//   Words 1..cw      : instruction words
//   Words cw+1..     : zero-pad
//   Words lumpSize-cc..lumpSize-1 : c-list (cc GT words, at lump tail)
//
// cw  = instruction word count (len(words))
// cc  = 2  (SelfTest self-reference plus LightningBolt-following Next.GT)
// typ = 0  (standard lump, not thread/outform)
// lump_size = next power-of-2 >= (1 + cw + cc)

const cw = words.length;
const cc = CLIST.length;   // 2
const totalNeeded = 1 + cw + cc;

let lumpSize = 64;
while (lumpSize < totalNeeded) lumpSize *= 2;

const n_minus_6 = Math.round(Math.log2(lumpSize)) - 6;

// Validate fields fit
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

// Write c-list GT values at the lump tail (words lumpSize-cc .. lumpSize-1)
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
// Standard CRC-32 (IEEE 802.3 polynomial 0xEDB88320)
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
//
// IMPORTANT: the "source" field must always be set to the exact text of the
// canonical .cloomc file for known-example abstractions (those whose abstraction
// name maps to a file in simulator/examples/).  Any recompile or rename pass that
// omits this field will be caught immediately by check-sidecar-source.js.
//
const capabilities = [
    { name: 'SelfTest', grants: ['E'], gt: '0x4A000006', ns_slot: 6, note: 'SelfTest E-GT — loaded into CR1 for TPERM and EXACT cross-checks (POLA minimum)' },
];

const sidecar = {
    token,
    abstraction: 'PostFlashSelftest',
    ns_slot: null,
    ns_slot_policy: 'dynamic',
    lump_size: lumpSize,
    typ: 0,
    content_type: 'code',
    cw,
    cc,
    profile: 'IoT',
    language: 'assembly',
    description: 'Post-Flash Exhaustive Self-Test — 81 hardware correctness tests (DR independence, ALU, shifts, branches, BFEXT/BFINS, TPERM, CHANGE, LOAD). DR0=0 on full pass, DR0=N on first failure.',
    // "source" must always reflect the exact text of simulator/examples/post_flash_selftest.cloomc.
    // Never leave this field empty — check-sidecar-source.js enforces it after every recompile.
    source,
    capabilities,
    grants: ['E'],
    author: 'Church Machine',
    version: '1.1',
    lump_version: 0,
};

fs.writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2) + '\n');
console.log(`Written: ${sidecarPath}`);

// ── Print c-list note ─────────────────────────────────────────────────────────
console.log(`\nC-List GT slot assignments (cc=${CLIST.length}, tail-packed):`);
const slotNames = [
    'SelfTest  E  NS-slot 6  — E-GT for TPERM/EXACT tests; boot_image.py overrides to mem-mgr GT',
    'Next      E  NS-slot 6  — template; boot_image.py follows the ⚡ boot entry',
];
for (let i = 0; i < CLIST.length; i++) {
    const gt = '0x' + CLIST[i].gt.toString(16).padStart(8, '0');
    console.log(`  slot ${i}  ${gt}  ${slotNames[i] || '(unnamed)'}`);
}

// ── Suggest manifest entry ───────────────────────────────────────────────────
const manifestEntry = {
    token,
    abstraction: 'PostFlashSelftest',
    ns_slot: null,
    ns_slot_policy: 'dynamic',
    variant_group: null,
    lump_size: lumpSize,
    cw,
    cc,
    grants: ['E'],
    lump_version: 0,
};

console.log('\nManifest entry to add to server/lumps/manifest.json:');
console.log(JSON.stringify(manifestEntry, null, 4));

// ── Optionally update manifest.json automatically ─────────────────────────────
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const existing = manifest.find(e => e.abstraction === 'PostFlashSelftest');
if (existing) {
    console.log('\nExisting PostFlashSelftest entry found — removing it before update.');
    const idx = manifest.indexOf(existing);
    manifest.splice(idx, 1);
}
manifest.push(manifestEntry);
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 4) + '\n');
console.log(`Updated: ${MANIFEST}`);

console.log('\nDone. Run python -m pytest tests/lump/test_lump_consistency.py -v to verify.');
