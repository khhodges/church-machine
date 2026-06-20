#!/usr/bin/env node
// scripts/build_event_router_lump.js
//
// Compiles simulator/cloomc/EventRouter.cloomc using CLOOMCCompiler,
// packs the result into a valid LUMP binary with buildLump(), and writes:
//
//   server/lumps/<token>.lump   — binary (big-endian 32-bit words)
//   server/lumps/<token>.json   — sidecar metadata
//
// The token is the CRC-32 of all binary bytes (lower-cased 8-hex-char string).
// Also updates server/lumps/manifest.json with the new entry.
//
// EventRouter — NS slot 52, boot_resident true, ns_slot_policy "static".
// Public methods:  Add, Remove, Resolve, List, Methods  (5)
// Private helpers: FindEvent, BindEvent, UnbindEvent, AllBoundEvents  (4)
//
// cc=0 — no external capabilities needed (routing table is internal state).
//
// Usage:
//   node scripts/build_event_router_lump.js

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT        = path.resolve(__dirname, '..');
const COMPILER    = path.join(ROOT, 'simulator', 'cloomc_compiler.js');
const LUMP_BUILDER = path.join(ROOT, 'simulator', 'lump_builder.js');
const SOURCE      = path.join(ROOT, 'simulator', 'cloomc', 'EventRouter.cloomc');
const LUMPS_DIR   = path.join(ROOT, 'server', 'lumps');
const MANIFEST    = path.join(LUMPS_DIR, 'manifest.json');

const NS_SLOT = 52;

// ── Minimal browser stubs so cloomc_compiler.js loads in Node.js ─────────────
global.localStorage = {
    _store: {},
    getItem(k)    { return this._store[k] !== undefined ? this._store[k] : null; },
    setItem(k, v) { this._store[k] = String(v); },
    removeItem(k) { delete this._store[k]; },
};

// Load CLOOMCCompiler (Node-style export)
const CLOOMCCompiler = require(COMPILER);
const { buildLump }  = require(LUMP_BUILDER);

// ── Compile EventRouter.cloomc ───────────────────────────────────────────────
const source = fs.readFileSync(SOURCE, 'utf8');
const compiler = new CLOOMCCompiler();
const result = compiler.compile(source, []);

if (result.errors && result.errors.length > 0) {
    console.error('Compilation errors:');
    for (const e of result.errors) {
        console.error(`  Line ${e.line}: ${e.message}`);
    }
    process.exit(1);
}

console.log(`Compiled ${result.methods.length} methods:`);
for (const m of result.methods) {
    const vis = m.visibility === 'private' ? '(private)' : '(public) ';
    console.log(`  ${vis} ${m.name}  — ${(m.code || []).length} words`);
}

// ── Pack LUMP binary via buildLump ────────────────────────────────────────────
const packed = buildLump(result, { allocationWords: 64 });
console.log(`\nLUMP packed:`);
console.log(`  lumpSize=${packed.lumpSize}  cw=${packed.cw}  cc=${packed.cc}`);
console.log(`  clistStart=${packed.clistStart}`);

// ── Convert to big-endian bytes ───────────────────────────────────────────────
const lumpSize = packed.lumpSize;
const bytes = Buffer.alloc(lumpSize * 4);
for (let i = 0; i < lumpSize; i++) {
    bytes.writeUInt32BE(packed.words[i] >>> 0, i * 4);
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
console.log(`\nToken (CRC-32 of binary): ${token}`);

// ── Build human-readable header word ─────────────────────────────────────────
const headerHex = packed.words[0].toString(16).toUpperCase().padStart(8, '0');
console.log(`LUMP header: 0x${headerHex}`);

// ── Write .lump binary ───────────────────────────────────────────────────────
const lumpPath    = path.join(LUMPS_DIR, `${token}.lump`);
const sidecarPath = path.join(LUMPS_DIR, `${token}.json`);

fs.writeFileSync(lumpPath, bytes);
console.log(`\nWritten: ${lumpPath} (${bytes.length} bytes)`);

// ── Collect method metadata ───────────────────────────────────────────────────
let codeOffset = result.methods.length;  // dispatch table size = method count
const methodEntries = [];
for (const m of result.methods) {
    const len = (m.code || []).length;
    methodEntries.push({
        name: m.name,
        visibility: m.visibility || 'public',
        offset: codeOffset,
        length: len,
        description: methodDesc(m.name),
    });
    if (!m.aliasOf) codeOffset += len;
}

function methodDesc(name) {
    const descs = {
        Add:          'Register an event→handler mapping. DR0=eventGT, DR1=handlerGT. Returns 0=ok, 1=table_full.',
        Remove:       'Unregister an event GT. DR0=eventGT. Returns 0=ok, 1=not_found.',
        Resolve:      'Look up the handler GT for an event GT. DR0=eventGT. Returns handlerGT or 0 if not registered.',
        List:         'Return the count of currently registered event→handler pairs.',
        Methods:      'Return 5 — the count of public methods on this abstraction.',
        FindEvent:    '(private) Linear scan for eventGT in the routing table. Returns slot index or -1.',
        BindEvent:    '(private) Write an eventGT→handlerGT pair into a free slot. Returns 0.',
        UnbindEvent:  '(private) Zero the routing-table entry for an event. Returns 0.',
        AllBoundEvents: '(private) Count non-zero routing table entries. Returns count.',
    };
    return descs[name] || '';
}

// ── Write sidecar .json ───────────────────────────────────────────────────────
const sidecar = {
    token,
    abstraction: 'EventRouter',
    ns_slot: NS_SLOT,
    ns_slot_policy: 'static',
    boot_resident: true,
    lump_size: lumpSize,
    cw: packed.cw,
    cc: packed.cc,
    methods: methodEntries,
    grants: ['E'],
    author: 'SIPantic',
    version: '1.0.0',
    lump_version: 0,
    description: 'Event-to-handler routing table. Maps event Golden Tokens to handler capabilities. Public: Add, Remove, Resolve, List, Methods. Private helpers enforce internal access control (dispatch entry=0).',
};

fs.writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2) + '\n');
console.log(`Written: ${sidecarPath}`);

// ── Update manifest.json ──────────────────────────────────────────────────────
const manifestEntry = {
    token,
    abstraction: 'EventRouter',
    ns_slot: NS_SLOT,
    ns_slot_policy: 'static',
    boot_resident: true,
    lump_size: lumpSize,
    cw: packed.cw,
    cc: packed.cc,
    grants: ['E'],
    author: 'SIPantic',
    version: '1.0.0',
    lump_version: 0,
    methods: methodEntries,
    description: 'Event-to-handler routing table. Maps event Golden Tokens to handler capabilities.',
};

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const existingIdx = manifest.findIndex(e => e.abstraction === 'EventRouter' || e.ns_slot === NS_SLOT);
if (existingIdx >= 0) {
    console.log(`\nReplacing existing EventRouter entry at manifest index ${existingIdx}.`);
    manifest.splice(existingIdx, 1);
}
manifest.push(manifestEntry);
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 4) + '\n');
console.log(`Updated: ${MANIFEST}`);

console.log('\nDone. Run python -m pytest tests/lump/test_lump_consistency.py -v to verify.');
console.log(`\nManifest entry summary:`);
console.log(`  token=${token}  ns_slot=${NS_SLOT}  lump_size=${lumpSize}  cw=${packed.cw}  cc=${packed.cc}`);
