#!/usr/bin/env node
// scripts/update-lump.js
//
// One-command LUMP rebuild: assemble the .cloomc source, write the .lump
// binary, regenerate the sidecar JSON, and patch manifest.json — all
// atomically, all in one step.
//
// Usage:
//   node scripts/update-lump.js --token <hex>           # update lump
//   node scripts/update-lump.js --token <hex> --check   # drift check (no writes)
//   make update-lump TOKEN=<hex>                         # via Makefile
//
// --check flag
//   Assembles the source and compares the resulting binary against the current
//   .lump file.  Exits 0 if identical, 1 if different or missing.  Makes no
//   writes.  Designed for use in CI / pre-commit hooks.
//
// Source discovery (in order):
//   1. manifest entry's "source" field (explicit relative path from repo root)
//   2. simulator/examples/<token>.cloomc
//   3. simulator/examples/<abstraction-name-normalised>.cloomc
//      (lowercase, spaces → underscores, leading "abstraction:_" stripped)
//   4. server/lumps/<token>.cloomc
//
// C-list preservation:
//   The c-list GT words (cc entries at the lump tail) are read from the
//   existing binary and written unchanged into the new binary.  Only the
//   code words change; the capability layout is preserved.  If no existing
//   binary is present (first build) the c-list is initialised to all zeros.
//
// Out of scope (exits with clear message):
//   - Lumps with no discoverable .cloomc source
//   - Re-generating the boot image or NS table
//   - Batch update of all lumps simultaneously
//
// On failure the script exits non-zero and leaves all files unchanged.

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

// ── Argument parsing ──────────────────────────────────────────────────────────

const argv      = process.argv.slice(2);
const CHECK_MODE = argv.includes('--check');

let TOKEN = null;
for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--token' && argv[i + 1]) {
        TOKEN = argv[i + 1].toLowerCase().replace(/^0x/, '');
        i++;
    } else if (argv[i].startsWith('--token=')) {
        TOKEN = argv[i].slice('--token='.length).toLowerCase().replace(/^0x/, '');
    }
}

if (!TOKEN) {
    console.error('ERROR: --token <hex> is required.');
    console.error('Usage:');
    console.error('  node scripts/update-lump.js --token <hex>');
    console.error('  node scripts/update-lump.js --token <hex> --check');
    process.exit(1);
}

if (!/^[0-9a-f]{1,8}$/.test(TOKEN)) {
    console.error(`ERROR: token must be a hex string (got "${TOKEN}").`);
    process.exit(1);
}

// ── Paths ─────────────────────────────────────────────────────────────────────

const ROOT       = path.resolve(__dirname, '..');
const LUMPS_DIR  = path.join(ROOT, 'server', 'lumps');
const MANIFEST   = path.join(LUMPS_DIR, 'manifest.json');
const ASSEMBLER  = path.join(ROOT, 'simulator', 'assembler.js');
const EXAMPLES   = path.join(ROOT, 'simulator', 'examples');

// ── Load assembler ────────────────────────────────────────────────────────────

// Minimal browser stubs required by assembler.js
global.localStorage = {
    _store: {},
    getItem(k)    { return this._store[k] !== undefined ? this._store[k] : null; },
    setItem(k, v) { this._store[k] = String(v); },
    removeItem(k) { delete this._store[k]; },
};

const asmSrc = fs.readFileSync(ASSEMBLER, 'utf8');
vm.runInThisContext(asmSrc, { filename: 'assembler.js' });

if (typeof ChurchAssembler === 'undefined') {  // eslint-disable-line no-undef
    console.error('ERROR: ChurchAssembler not found after loading assembler.js');
    process.exit(1);
}

// ── Load manifest ─────────────────────────────────────────────────────────────

let manifest;
try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
} catch (e) {
    console.error(`ERROR: Could not read manifest.json: ${e.message}`);
    process.exit(1);
}

const entry = manifest.find(e => (e.token || '').toLowerCase() === TOKEN);
if (!entry) {
    console.error(`ERROR: Token "${TOKEN}" not found in manifest.json.`);
    console.error(`  Available tokens: ${manifest.map(e => e.token).join(', ')}`);
    process.exit(1);
}

// ── Source discovery ──────────────────────────────────────────────────────────

function normaliseName(name) {
    return (name || '')
        .toLowerCase()
        .replace(/^abstraction:\s*/i, '')
        .replace(/\s+\(.*?\)$/, '')
        .trim()
        .replace(/[\s:]+/g, '_')
        .replace(/[^a-z0-9_]/g, '');
}

function findSource(ent) {
    const candidates = [];

    // 1. Explicit "source" field in manifest
    if (ent.source) {
        candidates.push(path.resolve(ROOT, ent.source));
    }

    // 2. simulator/examples/<token>.cloomc
    candidates.push(path.join(EXAMPLES, `${TOKEN}.cloomc`));

    // 3. simulator/examples/<normalised-abstraction>.cloomc
    if (ent.abstraction) {
        const norm = normaliseName(ent.abstraction);
        if (norm) candidates.push(path.join(EXAMPLES, `${norm}.cloomc`));
    }

    // 4. server/lumps/<token>.cloomc
    candidates.push(path.join(LUMPS_DIR, `${TOKEN}.cloomc`));

    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    return null;
}

const sourcePath = findSource(entry);
if (!sourcePath) {
    console.error(`ERROR: No .cloomc source found for token "${TOKEN}" (${entry.abstraction || '?'}).`);
    console.error('  Tried:');
    const tried = [];
    if (entry.source) tried.push(`  ${path.resolve(ROOT, entry.source)}`);
    tried.push(`  ${path.join(EXAMPLES, `${TOKEN}.cloomc`)}`);
    if (entry.abstraction) tried.push(`  ${path.join(EXAMPLES, normaliseName(entry.abstraction) + '.cloomc')}`);
    tried.push(`  ${path.join(LUMPS_DIR, `${TOKEN}.cloomc`)}`);
    tried.forEach(t => console.error(t));
    console.error('  This lump may be binary-only (out of scope for update-lump).');
    console.error('  To add source support, set the "source" field in manifest.json.');
    process.exit(1);
}

console.log(`Token:  ${TOKEN}`);
console.log(`Source: ${path.relative(ROOT, sourcePath)}`);

// ── Assemble ──────────────────────────────────────────────────────────────────

let source;
try {
    source = fs.readFileSync(sourcePath, 'utf8');
} catch (e) {
    console.error(`ERROR: Could not read source file: ${e.message}`);
    process.exit(1);
}

const asm    = new ChurchAssembler(); // eslint-disable-line no-undef
const result = asm.assemble(source);

if (result.errors.length > 0) {
    console.error('Assembly errors:');
    for (const e of result.errors) {
        console.error(`  Line ${e.line}: ${e.message}`);
    }
    process.exit(1);
}

const newCodeWords = Array.from(result.words);
const newCW        = newCodeWords.length;

// ── Resolve lump file paths (from manifest filename / legacy token) ────────────

function lumpPath(ent) {
    const fn = ent.filename || `${(ent.token || '').toLowerCase()}.lump`;
    return path.join(LUMPS_DIR, fn);
}

function sidecarPath(ent) {
    const fn = ent.sidecar_file || `${(ent.token || '').toLowerCase()}.json`;
    return path.join(LUMPS_DIR, fn);
}

const existingLumpPath    = lumpPath(entry);
const existingSidecarPath = sidecarPath(entry);

// ── Read existing c-list from current binary ──────────────────────────────────

let existingCList = [];
const existingCC = typeof entry.cc === 'number' ? entry.cc : 0;

if (existingCC > 0 && fs.existsSync(existingLumpPath)) {
    const raw   = fs.readFileSync(existingLumpPath);
    const words = raw.length / 4;
    if (raw.length % 4 !== 0 || words < 1) {
        console.error('ERROR: Existing .lump file is malformed (not a multiple of 4 bytes).');
        process.exit(1);
    }
    const existingLumpSize = words;
    const clistStart = existingLumpSize - existingCC;
    for (let i = 0; i < existingCC; i++) {
        existingCList.push(raw.readUInt32BE((clistStart + i) * 4));
    }
} else if (existingCC > 0) {
    existingCList = new Array(existingCC).fill(0);
}

const newCC = existingCList.length;

// ── Pack new LUMP binary ──────────────────────────────────────────────────────

const totalNeeded = 1 + newCW + newCC;
let lumpSize = 64;
while (lumpSize < totalNeeded) lumpSize *= 2;

const n_minus_6 = Math.round(Math.log2(lumpSize)) - 6;

if (n_minus_6 < 0 || n_minus_6 > 15) {
    console.error(`ERROR: Assembled code is too large for a LUMP (n_minus_6=${n_minus_6}).`);
    process.exit(1);
}

const headerWord = (
    (0x1F              << 27) |
    ((n_minus_6 & 0xF) << 23) |
    ((newCW & 0x1FFF)  << 10) |
    ((0       & 0x3)   <<  8) |
    (newCC & 0xFF)
) >>> 0;

const padded = new Uint32Array(lumpSize);
padded[0] = headerWord;
for (let i = 0; i < newCW; i++) padded[1 + i] = newCodeWords[i] >>> 0;
const clistBase = lumpSize - newCC;
for (let i = 0; i < newCC; i++) padded[clistBase + i] = existingCList[i] >>> 0;

const newBytes = Buffer.alloc(lumpSize * 4);
for (let i = 0; i < lumpSize; i++) {
    newBytes.writeUInt32BE(padded[i] >>> 0, i * 4);
}

// ── --check mode: diff only, no writes ───────────────────────────────────────

if (CHECK_MODE) {
    if (!fs.existsSync(existingLumpPath)) {
        console.error(`DRIFT  ${TOKEN}  — .lump file does not exist at ${existingLumpPath}`);
        process.exit(1);
    }
    const currentBytes = fs.readFileSync(existingLumpPath);
    if (currentBytes.equals(newBytes)) {
        console.log(`ok     ${TOKEN}  cw=${newCW} cc=${newCC} lump_size=${lumpSize}`);
        process.exit(0);
    }
    // Report differences
    const curHdr = currentBytes.length >= 4 ? currentBytes.readUInt32BE(0) : 0;
    const curLumpSz = 1 << ((((curHdr >>> 23) & 0xF) + 6));
    const curCW     = (curHdr >>> 10) & 0x1FFF;
    const curCC     = curHdr & 0xFF;
    console.error(`DRIFT  ${TOKEN}  — binary differs from what source would produce`);
    console.error(`  current:   cw=${curCW} cc=${curCC} lump_size=${curLumpSz}`);
    console.error(`  assembled: cw=${newCW} cc=${newCC} lump_size=${lumpSize}`);
    console.error('');
    console.error(`Run  node scripts/update-lump.js --token ${TOKEN}  to rebuild.`);
    process.exit(1);
}

// ── Write files atomically ────────────────────────────────────────────────────

// All preparation succeeded — write files.

// 1. .lump binary
fs.writeFileSync(existingLumpPath, newBytes);

// 2. Sidecar JSON — update only cw / cc / lump_size; preserve all other fields
let sidecar = {};
if (fs.existsSync(existingSidecarPath)) {
    try {
        sidecar = JSON.parse(fs.readFileSync(existingSidecarPath, 'utf8'));
    } catch (_) { /* start fresh if malformed */ }
}
sidecar.cw        = newCW;
sidecar.cc        = newCC;
sidecar.lump_size = lumpSize;
fs.writeFileSync(existingSidecarPath, JSON.stringify(sidecar, null, 2) + '\n');

// 3. manifest.json — update only cw / cc / lump_size in the matching entry
const mEntry = manifest.find(e => (e.token || '').toLowerCase() === TOKEN);
mEntry.cw        = newCW;
mEntry.cc        = newCC;
mEntry.lump_size = lumpSize;
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 4) + '\n');

console.log(`Updated ${TOKEN}: cw=${newCW} cc=${newCC} lump_size=${lumpSize}`);
