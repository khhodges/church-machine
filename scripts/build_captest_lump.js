#!/usr/bin/env node
// scripts/build_captest_lump.js
//
// Assembles simulator/examples/capability_test.cloomc (the single source of
// truth for the CapTest abstraction, NS slot 10) and packs the result into a
// valid LUMP binary.  Writes:
//
//   server/lumps/00000a00.lump   -- big-endian binary (fixed numeric token)
//   server/lumps/00000a00.json   -- sidecar metadata
//
// Token 00000a00 follows the boot-resident numbering convention:
//   slot N  ->  token 0x0000_0N00  (SelfTest=0x600 slot 6; CapTest=0xa00 slot 10)
//
// C-list (cc = 5) -- packed at the lump tail, hardware GT words (v2.0 format):
//   [0]  0x4A000006  SelfTest   E    NS slot  6
//   [1]  0x32000003  LED_DEV    RW   NS slot  3
//   [2]  0x32000002  UART_DEV   RW   NS slot  2
//   [3]  0x12000004  BTN_DEV    R    NS slot  4
//   [4]  0x32000005  TIMER_DEV  RW   NS slot  5
//
// GT v2.0 layout:
//   [31]=b_flag  [30:28]=perm3  [27]=dom  [26:25]=gt_type  [24:16]=gt_seq  [15:0]=slot_id
//   Inform GT (type=1): t = (1<<25)
//   Church perm3 (dom=1): E=4, S=2, L=1
//   Turing perm3 (dom=0): X=4, W=2, R=1
//
// Usage:
//   node scripts/build_captest_lump.js

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT      = path.resolve(__dirname, '..');
const ASSEMBLER = path.join(ROOT, 'simulator', 'assembler.js');
const SOURCE    = path.join(ROOT, 'simulator', 'examples', 'capability_test.cloomc');
const LUMPS_DIR = path.join(ROOT, 'server', 'lumps');
const MANIFEST  = path.join(LUMPS_DIR, 'manifest.json');

const TOKEN = '00000a00';   // fixed numeric token for CapTest NS slot 10

// Minimal browser stubs so assembler.js loads in Node
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

// Assemble the source.
// The capabilities block names (SelfTest, LED_DEV, etc.) won't resolve against
// abstractionRegistry in this Node environment.  "unresolved" warnings are
// expected and harmless -- the build script supplies correct GT words in CLIST.
// Instruction words are not affected by capability-name resolution.
const source = fs.readFileSync(SOURCE, 'utf8');
const asm    = new ChurchAssembler();
const result = asm.assemble(source);

const hardErrors = result.errors.filter(e => !String(e.message).includes('unresolved'));
if (hardErrors.length) {
    console.error('Assembly errors:');
    for (const e of hardErrors) console.error(`  Line ${e.line}: ${e.message}`);
    process.exit(1);
}
if (result.errors.length) {
    console.warn('Assembly warnings (expected -- capabilities resolved by build script):');
    for (const e of result.errors) console.warn(`  Line ${e.line}: ${e.message}`);
}

const words = result.words;
console.log(`Assembled ${words.length} instruction words from ${path.relative(ROOT, SOURCE)}`);

// C-List GT values (cc = 5)
// createGT(gt_seq=0, slotId, perms, type=1):
//   p = (perm3 << 28) | (dom << 27)   t = (1 << 25)   result = p | t | slotId
//   SelfTest  E    dom=1 perm3=4  -> 0x48000000 | 0x02000000 |  6 = 0x4A000006
//   LED_DEV   RW   dom=0 perm3=3  -> 0x30000000 | 0x02000000 |  3 = 0x32000003
//   UART_DEV  RW   dom=0 perm3=3  -> 0x30000000 | 0x02000000 |  2 = 0x32000002
//   BTN_DEV   R    dom=0 perm3=1  -> 0x10000000 | 0x02000000 |  4 = 0x12000004
//   TIMER_DEV RW   dom=0 perm3=3  -> 0x30000000 | 0x02000000 |  5 = 0x32000005
const CLIST = [
    { gt: 0x4A000006, name: 'SelfTest',   perm: 'E',  nsSlot: 6 },
    { gt: 0x32000003, name: 'LED_DEV',    perm: 'RW', nsSlot: 3 },
    { gt: 0x32000002, name: 'UART_DEV',   perm: 'RW', nsSlot: 2 },
    { gt: 0x12000004, name: 'BTN_DEV',    perm: 'R',  nsSlot: 4 },
    { gt: 0x32000005, name: 'TIMER_DEV',  perm: 'RW', nsSlot: 5 },
];

// Pack LUMP binary
const cw = words.length;
const cc = CLIST.length;   // 5
let lumpSize = 64;
while (lumpSize < 1 + cw + cc) lumpSize *= 2;

const n_minus_6 = Math.round(Math.log2(lumpSize)) - 6;
if (n_minus_6 < 0 || n_minus_6 > 15) { console.error('n_minus_6 out of range:', n_minus_6); process.exit(1); }

const headerWord = (
    (0x1F              << 27) |
    ((n_minus_6 & 0xF) << 23) |
    ((cw & 0x1FFF)     << 10) |
    ((0 & 0x3)         <<  8) |   // typ = 0
    (cc & 0xFF)
) >>> 0;

const padded = new Uint32Array(lumpSize);
padded[0] = headerWord;
for (let i = 0; i < cw; i++) padded[1 + i] = words[i] >>> 0;
const clistBase = lumpSize - cc;
for (let i = 0; i < cc; i++) padded[clistBase + i] = CLIST[i].gt >>> 0;

console.log(`Header: 0x${headerWord.toString(16).toUpperCase().padStart(8,'0')}  lump_size=${lumpSize}  cw=${cw}  cc=${cc}  clistBase=${clistBase}`);

const bytes = Buffer.alloc(lumpSize * 4);
for (let i = 0; i < lumpSize; i++) bytes.writeUInt32BE(padded[i] >>> 0, i * 4);

// Write .lump binary
fs.writeFileSync(path.join(LUMPS_DIR, `${TOKEN}.lump`), bytes);
console.log(`Written: server/lumps/${TOKEN}.lump  (${bytes.length} bytes)`);

// Write sidecar .json
const sidecar = {
    token: TOKEN,
    abstraction: 'CapTest',
    ns_slot: 10,
    ns_slot_policy: 'static',
    lump_size: lumpSize,
    typ: 0,
    content_type: 'code',
    cw,
    cc,
    profile: 'example',
    language: 'assembly',
    description: 'Capability self-test: LOAD, TPERM, LOADEQ/LOADNE, SWITCH, Turing ISA, ELOADCALL -- exercises real boot-namespace caps.',
    capabilities: CLIST.map(c => ({
        name: c.name,
        grants: c.perm === 'RW' ? ['R','W'] : [c.perm],
        gt: '0x' + c.gt.toString(16).padStart(8,'0'),
        ns_slot: c.nsSlot,
    })),
    grants: ['E'],
    author: 'Church Machine',
    version: '2.0',
    lump_version: 0,
    source: 'simulator/examples/capability_test.cloomc',
};
fs.writeFileSync(path.join(LUMPS_DIR, `${TOKEN}.json`), JSON.stringify(sidecar, null, 2) + '\n');
console.log(`Written: server/lumps/${TOKEN}.json`);

// Update manifest.json
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const stale = manifest.filter(e => e.token === TOKEN || /captest|capabilitytest/i.test(e.abstraction || ''));
for (const s of stale) {
    console.log(`Removing stale manifest entry: ${s.token} / ${s.abstraction}`);
    manifest.splice(manifest.indexOf(s), 1);
}
manifest.push({
    token: TOKEN,
    abstraction: 'CapTest',
    ns_slot: 10,
    ns_slot_policy: 'static',
    boot_resident: false,
    variant_group: null,
    lump_size: lumpSize,
    cw,
    cc,
    grants: ['E'],
    lump_version: 0,
    source: 'simulator/examples/capability_test.cloomc',
});
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 4) + '\n');
console.log(`Updated: server/lumps/manifest.json`);

console.log('\nC-List GT assignments:');
for (const [i, c] of CLIST.entries()) {
    console.log(`  [${i}]  0x${c.gt.toString(16).padStart(8,'0')}  ${c.name.padEnd(12)} ${c.perm.padEnd(3)}  NS slot ${c.nsSlot}`);
}
console.log('\nDone. Run: python -m pytest tests/lump/test_lump_consistency.py -v');
