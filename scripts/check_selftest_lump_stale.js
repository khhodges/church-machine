#!/usr/bin/env node
// scripts/check_selftest_lump_stale.js
//
// CI guard: fail if server/lumps/d906a27f.lump (or whichever token the current
// source produces) is missing or does not match the assembled output of
// simulator/examples/post_flash_selftest.cloomc.
//
// How it works:
//   1. Assembles the source with the production ChurchAssembler.
//   2. Packs the result into the same LUMP binary layout used by
//      scripts/build_selftest_lump.js (identical header + c-list logic).
//   3. Computes the CRC-32 token of those bytes.
//   4. Checks that server/lumps/<token>.lump exists and its contents match
//      byte-for-byte what was just assembled.
//
// Exit codes:
//   0 — lump binary is present and up-to-date
//   1 — lump is missing or stale; run `node scripts/build_selftest_lump.js`
//
// Usage:
//   node scripts/check_selftest_lump_stale.js

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT      = path.resolve(__dirname, '..');
const ASSEMBLER = path.join(ROOT, 'simulator', 'assembler.js');
const SOURCE    = path.join(ROOT, 'simulator', 'examples', 'post_flash_selftest.cloomc');
const LUMPS_DIR = path.join(ROOT, 'server', 'lumps');

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
    console.error('Assembly errors in post_flash_selftest.cloomc:');
    for (const e of result.errors) {
        console.error(`  Line ${e.line}: ${e.message}`);
    }
    process.exit(1);
}

const words = result.words;

// ── C-List (must match build_selftest_lump.js exactly) ──────────────────────
const CLIST = [
    { gt: 0x00000000 },
    { gt: 0x48800001 },
    { gt: 0x48800006 },
    { gt: 0x48800003 },
    { gt: 0x48800004 },
    { gt: 0x48800005 },
    { gt: 0x00000000 },
    { gt: 0x40800001 },
];

// ── Pack LUMP binary ─────────────────────────────────────────────────────────
const cw = words.length;
const cc = CLIST.length;
const totalNeeded = 1 + cw + cc;

let lumpSize = 64;
while (lumpSize < totalNeeded) lumpSize *= 2;

const n_minus_6 = Math.round(Math.log2(lumpSize)) - 6;

const headerWord = (
    (0x1F               << 27) |
    ((n_minus_6 & 0xF)  << 23) |
    ((cw        & 0x1FFF) << 10) |
    ((0         & 0x3)  <<  8) |
    (cc & 0xFF)
) >>> 0;

const padded = new Uint32Array(lumpSize);
padded[0] = headerWord;
for (let i = 0; i < cw; i++) padded[1 + i] = words[i] >>> 0;

const clistBase = lumpSize - cc;
for (let i = 0; i < CLIST.length; i++) {
    padded[clistBase + i] = CLIST[i].gt >>> 0;
}

const bytes = Buffer.alloc(lumpSize * 4);
for (let i = 0; i < lumpSize; i++) {
    bytes.writeUInt32BE(padded[i] >>> 0, i * 4);
}

// ── CRC-32 ───────────────────────────────────────────────────────────────────
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

const token       = crc32(bytes).toString(16).toLowerCase().padStart(8, '0');
const lumpPath    = path.join(LUMPS_DIR, `${token}.lump`);
const sidecarPath = path.join(LUMPS_DIR, `${token}.json`);
const MANIFEST    = path.join(LUMPS_DIR, 'manifest.json');

// ── Check ────────────────────────────────────────────────────────────────────
console.log(`Source:         ${path.relative(ROOT, SOURCE)}`);
console.log(`Expected token: ${token}`);
console.log(`Expected lump:  server/lumps/${token}.lump`);
console.log(`Assembled:      cw=${cw}  cc=${cc}  lump_size=${lumpSize}`);

let stale = false;

// 1. Binary check ─────────────────────────────────────────────────────────────
if (!fs.existsSync(lumpPath)) {
    console.error(`\nFAIL: server/lumps/${token}.lump does not exist.`);
    console.error('      The source has been modified but the lump has not been rebuilt.');
    stale = true;
} else {
    const ondisk = fs.readFileSync(lumpPath);
    if (!ondisk.equals(bytes)) {
        console.error(`\nFAIL: server/lumps/${token}.lump exists but its contents differ from`);
        console.error('      what the current source assembles to.');
        console.error(`      On-disk size: ${ondisk.length} bytes, expected: ${bytes.length} bytes`);
        stale = true;
    } else {
        console.log(`OK:   server/lumps/${token}.lump — binary matches`);
    }
}

// 2. Sidecar JSON check ───────────────────────────────────────────────────────
if (!fs.existsSync(sidecarPath)) {
    console.error(`\nFAIL: server/lumps/${token}.json does not exist.`);
    console.error('      The sidecar metadata file is missing — rebuild with:');
    console.error('      node scripts/build_selftest_lump.js');
    stale = true;
} else {
    let sidecar;
    try {
        sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
    } catch (e) {
        console.error(`\nFAIL: server/lumps/${token}.json could not be parsed: ${e.message}`);
        stale = true;
        sidecar = null;
    }
    if (sidecar !== null) {
        if (sidecar.token !== token) {
            console.error(`\nFAIL: server/lumps/${token}.json has token "${sidecar.token}" but expected "${token}".`);
            stale = true;
        } else {
            console.log(`OK:   server/lumps/${token}.json — sidecar token matches`);
        }
    }
}

// 3. Manifest check ───────────────────────────────────────────────────────────
if (!fs.existsSync(MANIFEST)) {
    console.error('\nFAIL: server/lumps/manifest.json does not exist.');
    stale = true;
} else {
    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    } catch (e) {
        console.error(`\nFAIL: server/lumps/manifest.json could not be parsed: ${e.message}`);
        stale = true;
        manifest = null;
    }
    if (manifest !== null) {
        const entries = manifest.filter(e => e.abstraction === 'PostFlashSelftest');
        if (entries.length === 0) {
            console.error('\nFAIL: manifest.json has no PostFlashSelftest entry.');
            console.error('      Run: node scripts/build_selftest_lump.js');
            stale = true;
        } else if (entries.length > 1) {
            console.error(`\nFAIL: manifest.json has ${entries.length} PostFlashSelftest entries — expected exactly one.`);
            console.error('      Tokens found: ' + entries.map(e => e.token).join(', '));
            stale = true;
        } else if (entries[0].token !== token) {
            console.error(`\nFAIL: manifest.json PostFlashSelftest entry has token "${entries[0].token}" but expected "${token}".`);
            console.error('      Run: node scripts/build_selftest_lump.js');
            stale = true;
        } else {
            console.log(`OK:   manifest.json PostFlashSelftest entry — token matches`);
        }
    }
}

if (stale) {
    console.error('');
    console.error('Run:  node scripts/build_selftest_lump.js');
    console.error('Then commit the updated .lump, .json, and manifest.json.');
    process.exit(1);
}

console.log(`\nOK: all artifacts are up-to-date for token ${token}.`);
process.exit(0);
