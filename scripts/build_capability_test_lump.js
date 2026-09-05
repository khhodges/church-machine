#!/usr/bin/env node
// scripts/build_capability_test_lump.js
//
// Assembles simulator/examples/capability_test.cloomc using the production
// ChurchAssembler (simulator/assembler.js), packs the result into a valid LUMP
// binary and writes server/lumps/CapabilityTest.2.<hash8>.lump.
//
// CapabilityTest's protected slot lookup token remains 00000a00. Content is
// named by sha256(dot_name_utf8 + lump_bytes)[:8], per lump_integrity.py.
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
const crypto = require('crypto');

const ROOT        = path.resolve(__dirname, '..');
const ASSEMBLER   = path.join(ROOT, 'simulator', 'assembler.js');
const SOURCE      = path.join(ROOT, 'simulator', 'examples', 'capability_test.cloomc');

// --out-dir <path>: redirect .lump/manifest writes to a different
// directory (used by CI to validate without touching server/lumps/).
const _outDirIdx  = process.argv.indexOf('--out-dir');
const LUMPS_DIR   = (_outDirIdx !== -1 && process.argv[_outDirIdx + 1])
    ? path.resolve(process.argv[_outDirIdx + 1])
    : path.join(ROOT, 'server', 'lumps');
const MANIFEST    = path.join(LUMPS_DIR, 'manifest.json');
const NS_STATE    = path.join(LUMPS_DIR, 'ns-state.json');
const IDENTITY_TOKEN = '00000a00';
const DOT_NAME = 'CapabilityTest';
const ISSUE_N = 2;
const IDENTITY_STRING = `${DOT_NAME}#${ISSUE_N}`;
const IDENTITY_HASH = crypto.createHash('sha256')
    .update(IDENTITY_STRING, 'utf8')
    .digest('hex');
const CHECK_ONLY = process.argv.includes('--check');
fs.mkdirSync(LUMPS_DIR, { recursive: true });

function stableRepositoryJson(value) {
    // Match the repository's Python-style JSON convention: two-space indent,
    // non-ASCII escaped, and no trailing newline. This prevents a focused
    // CapabilityTest rebuild from rewriting unrelated manifest/state records.
    return JSON.stringify(value, null, 2).replace(
        /[^\x00-\x7F]/g,
        char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
}

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
function contentFrame(name, text) {
    const api = Buffer.from(JSON.stringify({ name, methods: [] }), 'utf8');
    const src = Buffer.from(text, 'utf8');
    const data = Buffer.concat([
        Buffer.from([0xAB, 0x03, api.length >>> 8, api.length & 0xFF]), api,
        Buffer.alloc((4 - api.length % 4) % 4),
        Buffer.from([(src.length >>> 24) & 0xFF, (src.length >>> 16) & 0xFF,
            (src.length >>> 8) & 0xFF, src.length & 0xFF]), src,
        Buffer.alloc((4 - src.length % 4) % 4),
    ]);
    const frame = [];
    for (let i = 0; i < data.length; i += 4) frame.push(data.readUInt32BE(i));
    return frame;
}
const FRAME = contentFrame(DOT_NAME, source);

// ── C-List definition ─────────────────────────────────────────────────────────
//
// cc = 5  (one GT per declared capability).
//
// GT layout (v2.0):
//   [31]    b_flag  = 0
//   [30:28] perm3   — Church E: 0b100=4; Turing RW: 0b011=3; Turing W: 0b010=2; Turing R: 0b001=1
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
const totalNeeded = 1 + cw + FRAME.length + cc;

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
for (let i = 0; i < FRAME.length; i++) padded[1 + cw + i] = FRAME[i] >>> 0;

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

const binaryHash = crypto.createHash('sha256').update(bytes).digest('hex');
const contentId = crypto.createHash('sha256')
    .update(DOT_NAME, 'utf8')
    .update(bytes)
    .digest('hex')
    .slice(0, 8);
const token = IDENTITY_TOKEN;
const artifactStem = `${DOT_NAME}.${ISSUE_N}.${contentId}`;
console.log(`Identity token: ${token}`);
console.log(`Binary SHA-256: ${binaryHash}`);

if (CHECK_ONLY) {
    const expectedLump = path.join(LUMPS_DIR, `${artifactStem}.lump`);
    const failures = [];
    if (!fs.existsSync(expectedLump) ||
        !fs.readFileSync(expectedLump).equals(bytes)) {
        failures.push(`binary missing or stale: ${path.basename(expectedLump)}`);
    }
    let checkedManifest = null;
    try {
        checkedManifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    } catch (err) {
        failures.push('manifest is missing or invalid');
    }
    if (checkedManifest) {
        const bindings = checkedManifest.filter(e => e.token === IDENTITY_TOKEN);
        if (bindings.length !== 1 ||
            bindings[0].abstraction !== 'CapabilityTest' ||
            bindings[0].ns_slot !== 10 ||
            bindings[0].filename !== `${artifactStem}.lump` ||
            bindings[0].issue_n !== ISSUE_N ||
            bindings[0].identity_hash !== IDENTITY_HASH ||
            bindings[0].binary_hash !== binaryHash) {
            failures.push('manifest canonical slot-10 binding is stale');
        }
    }
    if (failures.length) {
        for (const failure of failures) console.error(`FAIL: ${failure}`);
        console.error('Run: node scripts/build_capability_test_lump.js');
        process.exit(1);
    }
    console.log('OK: CapabilityTest source, binary, and manifest are fresh.');
    process.exit(0);
}

// ── Remove old CapabilityTest lump files ────────────────────────────────────────────
const manifest = fs.existsSync(MANIFEST)
    ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
    : [];
const existingIdx = manifest.findIndex(e => e.token === IDENTITY_TOKEN);
if (existingIdx !== -1) {
    const oldLumpName = manifest[existingIdx].filename;
    if (oldLumpName && oldLumpName !== `${artifactStem}.lump`) {
        const oldLump = path.join(LUMPS_DIR, oldLumpName);
        if (fs.existsSync(oldLump))    { fs.unlinkSync(oldLump);    console.log(`Removed old: ${oldLump}`); }
    }
    console.log('\nExisting CapabilityTest entry found — replacing it.');
}

// ── Write .lump binary ───────────────────────────────────────────────────────
const lumpPath    = path.join(LUMPS_DIR, `${artifactStem}.lump`);

fs.writeFileSync(lumpPath, bytes);
console.log(`Written: ${lumpPath} (${bytes.length} bytes)`);

// ── Print c-list slot assignments ─────────────────────────────────────────────
console.log('\nC-List GT slot assignments (cc=5, tail-packed):');
for (let i = 0; i < CLIST.length; i++) {
    const gt = '0x' + CLIST[i].gt.toString(16).padStart(8, '0');
    console.log(`  slot ${i}  ${gt}  ${CLIST[i].note}`);
}

// ── Update manifest.json ──────────────────────────────────────────────────────
const manifestEntry = {
    ...(existingIdx !== -1 ? manifest[existingIdx] : {}),
    token,
    abstraction:     'CapabilityTest',
    filename:        `${artifactStem}.lump`,
    ns_slot:         10,
    ns_slot_policy:  'static',
    boot_resident:   true,
    variant_group:   'capabilitytest-history',
    lump_size:       lumpSize,
    cw,
    cc,
    grants:          ['E'],
    lump_version:    2,
    dot_name:        DOT_NAME,
    issue_n:         ISSUE_N,
    identity_hash:   IDENTITY_HASH,
    binary_hash:     binaryHash,
};

if (existingIdx !== -1) {
    manifest[existingIdx] = manifestEntry;
} else {
    manifest.push(manifestEntry);
}
fs.writeFileSync(MANIFEST, stableRepositoryJson(manifest));
console.log(`Updated: ${MANIFEST}`);

// Preserve the protected slot/token/sequence identity while rebinding its body.
if (fs.existsSync(NS_STATE)) {
    const nsState = JSON.parse(fs.readFileSync(NS_STATE, 'utf8'));
    const bindings = (nsState.abstractions || []).filter(
        e => e.name === 'CapabilityTest' && e.slot === 10 && e.token === IDENTITY_TOKEN);
    if (bindings.length !== 1) {
        throw new Error('ns-state must contain exactly one canonical CapabilityTest slot-10 binding');
    }
    bindings[0].filename = `${artifactStem}.lump`;
    bindings[0].issue_n = ISSUE_N;
    fs.writeFileSync(NS_STATE, stableRepositoryJson(nsState));
    console.log(`Updated: ${NS_STATE}`);
}

console.log('\nManifest entry written:');
console.log(JSON.stringify(manifestEntry, null, 4));
console.log('\nDone.');
