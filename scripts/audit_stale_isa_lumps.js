#!/usr/bin/env node
// scripts/audit_stale_isa_lumps.js
//
// Repo-wide staleness audit: disassembles every server/lumps/*.lump file with
// the current simulator/assembler.js opcode table and flags any that contain
// "???" words (i.e. instruction words encoded under the pre-v2.0 opcode
// numbering, old opcodes 10-19, since renumbered to 16-25 in the v2.0 ISA).
//
// Classifies each stale lump as:
//   LIVE     — referenced by manifest.json (current filename for an
//              abstraction) and/or wired into the boot namespace table
//              (non-null ns_slot on its manifest entry)
//   ORPHANED — not referenced by manifest.json at all
//
// Usage:
//   node scripts/audit_stale_isa_lumps.js            # human-readable report
//   node scripts/audit_stale_isa_lumps.js --json      # machine-readable JSON

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT      = path.resolve(__dirname, '..');
const LUMPS_DIR = path.join(ROOT, 'server', 'lumps');
const ASSEMBLER = path.join(ROOT, 'simulator', 'assembler.js');
const MANIFEST  = path.join(LUMPS_DIR, 'manifest.json');

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

const asm = new ChurchAssembler();

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const manifestByFilename = new Map();
for (const entry of manifest) {
    const fn = entry.filename || `${(entry.token || '').toLowerCase()}.lump`;
    manifestByFilename.set(fn, entry);
}

function parseLump(filePath) {
    const raw = fs.readFileSync(filePath);
    if (raw.length % 4 !== 0 || raw.length < 4) {
        return { error: `malformed (not a multiple of 4 bytes, ${raw.length} bytes)` };
    }
    const totalWords = raw.length / 4;
    const words = new Array(totalWords);
    for (let i = 0; i < totalWords; i++) words[i] = raw.readUInt32BE(i * 4);

    const header = words[0];
    const opcode = (header >>> 27) & 0x1F;
    if (opcode !== 0x1F) {
        return { error: `no lump header magic at word 0 (opcode=0x${opcode.toString(16)})` };
    }
    const cw = (header >>> 10) & 0x1FFF;
    const cc = header & 0xFF;

    if (1 + cw + cc > totalWords) {
        return { error: `header cw=${cw} cc=${cc} exceeds file size (${totalWords} words)` };
    }

    const codeWords = words.slice(1, 1 + cw);
    return { codeWords, cw, cc, totalWords };
}

function findStaleWords(codeWords) {
    const stale = [];
    for (let i = 0; i < codeWords.length; i++) {
        const line = asm.disassemble(codeWords[i], {});
        if (line.startsWith('???')) {
            stale.push({ offset: i, word: codeWords[i], line });
        }
    }
    return stale;
}

const lumpFiles = fs.readdirSync(LUMPS_DIR).filter(f => f.endsWith('.lump')).sort();

const results = {
    liveStale: [],
    orphanedStale: [],
    clean: [],
    errors: [],
};

for (const filename of lumpFiles) {
    const filePath = path.join(LUMPS_DIR, filename);
    const parsed = parseLump(filePath);
    if (parsed.error) {
        results.errors.push({ filename, error: parsed.error });
        continue;
    }
    const stale = findStaleWords(parsed.codeWords);
    const manifestEntry = manifestByFilename.get(filename);
    const isLive = !!manifestEntry;
    const nsSlot = manifestEntry && typeof manifestEntry.ns_slot === 'number' ? manifestEntry.ns_slot : null;

    const record = {
        filename,
        token: manifestEntry ? manifestEntry.token : path.basename(filename, '.lump'),
        abstraction: manifestEntry ? manifestEntry.abstraction : null,
        ns_slot: nsSlot,
        cw: parsed.cw,
        cc: parsed.cc,
        staleCount: stale.length,
        staleOffsets: stale.map(s => s.offset),
    };

    if (stale.length === 0) {
        results.clean.push(record);
    } else if (isLive) {
        results.liveStale.push(record);
    } else {
        results.orphanedStale.push(record);
    }
}

if (process.argv.includes('--json')) {
    console.log(JSON.stringify(results, null, 2));
    process.exit(0);
}

console.log(`Scanned ${lumpFiles.length} lump files in server/lumps/\n`);

console.log(`=== LIVE/REFERENCED — stale (${results.liveStale.length}) ===`);
for (const r of results.liveStale) {
    console.log(`  ${r.filename}  token=${r.token}  abstraction=${r.abstraction}  ns_slot=${r.ns_slot}  stale_words=${r.staleCount}  offsets=[${r.staleOffsets.join(',')}]`);
}

console.log(`\n=== ORPHANED — stale (${results.orphanedStale.length}) ===`);
for (const r of results.orphanedStale) {
    console.log(`  ${r.filename}  token=${r.token}  stale_words=${r.staleCount}`);
}

console.log(`\n=== ERRORS (${results.errors.length}) ===`);
for (const r of results.errors) {
    console.log(`  ${r.filename}: ${r.error}`);
}

console.log(`\nClean: ${results.clean.length}   Live-stale: ${results.liveStale.length}   Orphaned-stale: ${results.orphanedStale.length}   Errors: ${results.errors.length}   Total: ${lumpFiles.length}`);
