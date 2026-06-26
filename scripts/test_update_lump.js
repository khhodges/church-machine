#!/usr/bin/env node
// scripts/test_update_lump.js
//
// Tests for scripts/update-lump.js
//
// Runs the script against a temporary lump (isolated from the real manifest)
// to verify: error cases, --check mode, and round-trip update correctness.
// Finally, runs the 11-rule consistency gate against the real manifest to
// confirm the gate passes after any updates made by this test run.
//
// Run:  node scripts/test_update_lump.js

'use strict';

const fs   = require('fs');
const path = require('path');
const cp   = require('child_process');
const os   = require('os');
const vm   = require('vm');

const ROOT         = path.resolve(__dirname, '..');
const UPDATE_LUMP  = path.join(__dirname, 'update-lump.js');
const ASSEMBLER    = path.join(ROOT, 'simulator', 'assembler.js');

let pass = 0;
let fail = 0;

function check(label, cond, detail) {
    if (cond) {
        console.log(`PASS  ${label}`);
        pass++;
    } else {
        console.log(`FAIL  ${label}${detail ? '\n      ' + detail : ''}`);
        fail++;
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Run update-lump.js with the given args in the given cwd (overriding LUMPS_DIR
// is done by creating a fake env via a wrapper; instead we pass a custom ROOT
// by temporarily writing the test manifest to the real lumps dir + a unique
// test-only token that does not collide with production entries).
//
// We use a temp directory overlay: the script reads ROOT from __dirname, so we
// launch the script from a modified working directory where we have placed:
//   simulator/examples/<source>.cloomc
//   server/lumps/manifest.json  (our test manifest)
//   server/lumps/<token>.lump
//   server/lumps/<token>.json
//
// To avoid modifying the real repo files, we launch the script with a NODE_PATH
// that re-exports fs with patched readFileSync/writeFileSync calls.
// That is complex. The simpler approach: use a temp dir as ROOT by patching the
// script's path resolution — not feasible without forking the script.
//
// Simplest safe approach: use a UNIQUE test token that cannot collide with real
// manifest entries (we use "ffffffff"), inject it into a COPY of the manifest,
// and clean up afterwards, restoring the original manifest on exit.
//
// All writes are undone by the cleanup() function registered with process.on('exit').

const TEST_TOKEN   = 'ffffffff';
const LUMPS_DIR    = path.join(ROOT, 'server', 'lumps');
const MANIFEST_PATH = path.join(LUMPS_DIR, 'manifest.json');
const TEST_LUMP    = path.join(LUMPS_DIR, `${TEST_TOKEN}.lump`);
const TEST_SIDECAR = path.join(LUMPS_DIR, `${TEST_TOKEN}.json`);
const TEST_SOURCE  = path.join(ROOT, 'simulator', 'examples', `${TEST_TOKEN}.cloomc`);

// Save original manifest for restore
const originalManifest = fs.readFileSync(MANIFEST_PATH, 'utf8');

// Track all test-created files for cleanup
const createdFiles = [];

function cleanup() {
    fs.writeFileSync(MANIFEST_PATH, originalManifest, 'utf8');
    for (const f of createdFiles) {
        try { fs.unlinkSync(f); } catch (_) {}
    }
}
process.on('exit', cleanup);
process.on('SIGINT',  () => { cleanup(); process.exit(1); });
process.on('SIGTERM', () => { cleanup(); process.exit(1); });

// ── Load assembler for building reference lumps ───────────────────────────────

global.localStorage = {
    _store: {},
    getItem(k)    { return this._store[k] !== undefined ? this._store[k] : null; },
    setItem(k, v) { this._store[k] = String(v); },
    removeItem(k) { delete this._store[k]; },
};
vm.runInThisContext(fs.readFileSync(ASSEMBLER, 'utf8'), { filename: 'assembler.js' });

function packLump(words, clistWords) {
    const cw = words.length;
    const cc = clistWords.length;
    const totalNeeded = 1 + cw + cc;
    let lumpSize = 64;
    while (lumpSize < totalNeeded) lumpSize *= 2;
    const n_m6 = Math.round(Math.log2(lumpSize)) - 6;
    const hdr = (
        (0x1F        << 27) |
        ((n_m6 & 0xF)<< 23) |
        ((cw & 0x1FFF) << 10) |
        (cc & 0xFF)
    ) >>> 0;
    const padded = new Uint32Array(lumpSize);
    padded[0] = hdr;
    for (let i = 0; i < cw; i++) padded[1 + i] = words[i] >>> 0;
    const cb = lumpSize - cc;
    for (let i = 0; i < cc; i++) padded[cb + i] = clistWords[i] >>> 0;
    const buf = Buffer.alloc(lumpSize * 4);
    for (let i = 0; i < lumpSize; i++) buf.writeUInt32BE(padded[i] >>> 0, i * 4);
    return { buf, cw, cc, lump_size: lumpSize };
}

// ── Inject test entry into manifest ──────────────────────────────────────────

function setupTestEntry(opts = {}) {
    const source = opts.source || `simulator/examples/${TEST_TOKEN}.cloomc`;
    const manifest = JSON.parse(originalManifest);
    manifest.push({
        token:     TEST_TOKEN,
        abstraction: 'TestLump_update_lump_test',
        ns_slot:   null,
        lump_size: opts.lump_size || 64,
        cw:        opts.cw        || 1,
        cc:        opts.cc        || 0,
        source,
        grants: ['E'],
        lump_version: 0,
    });
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 4) + '\n', 'utf8');
}

// ── Write a trivial source and matching .lump + sidecar ───────────────────────

const SIMPLE_SOURCE = `; trivial test lump — one RETURN
RETURN
`;

const SIMPLE_SOURCE_V2 = `; trivial test lump v2 — two RETURNs
RETURN
RETURN
`;

function writeSource(src) {
    fs.writeFileSync(TEST_SOURCE, src, 'utf8');
    if (!createdFiles.includes(TEST_SOURCE)) createdFiles.push(TEST_SOURCE);
}

function buildAndWriteLump(src, clistWords = []) {
    const asm = new ChurchAssembler(); // eslint-disable-line no-undef
    const res = asm.assemble(src);
    if (res.errors.length) throw new Error('Assembly failed: ' + res.errors[0].message);
    const { buf, cw, cc, lump_size } = packLump(Array.from(res.words), clistWords);
    fs.writeFileSync(TEST_LUMP, buf);
    fs.writeFileSync(TEST_SIDECAR, JSON.stringify({ token: TEST_TOKEN, cw, cc, lump_size }, null, 2) + '\n');
    if (!createdFiles.includes(TEST_LUMP))    createdFiles.push(TEST_LUMP);
    if (!createdFiles.includes(TEST_SIDECAR)) createdFiles.push(TEST_SIDECAR);
    return { cw, cc, lump_size };
}

// ── Run update-lump.js as a subprocess ───────────────────────────────────────

function runUpdateLump(args) {
    return cp.spawnSync(process.execPath, [UPDATE_LUMP, ...args], {
        cwd: ROOT,
        encoding: 'utf8',
    });
}

// =============================================================================
// Tests
// =============================================================================

console.log('\n── Error cases ──────────────────────────────────────────────────');

// T1: Missing --token flag
{
    const r = runUpdateLump([]);
    check('T1: missing --token exits non-zero',
        r.status !== 0,
        r.stderr.trim()
    );
    check('T1: missing --token prints usage hint',
        r.stderr.includes('--token'),
    );
}

// T2: Token not in manifest
{
    const r = runUpdateLump(['--token', 'deadbeef']);
    check('T2: unknown token exits non-zero', r.status !== 0);
    check('T2: unknown token reports error', r.stderr.includes('not found in manifest'));
}

// T3: Token found but no source available (binary-only lump)
//     Pick a token with no source field and no .cloomc file on the search paths.
//     00000300 (LED flash) has cc=1 but no source file.
{
    const r = runUpdateLump(['--token', '00000300']);
    check('T3: binary-only lump exits non-zero', r.status !== 0);
    check('T3: binary-only lump explains out-of-scope', r.stderr.includes('out of scope'));
}

// T4: Assembly error in source
//     Write a source with a syntax error, build a lump, then run update-lump.
{
    setupTestEntry({ cw: 1, cc: 0 });
    writeSource('; bad source\nNOT_AN_OPCODE DR0, DR1\n');
    buildAndWriteLump('; minimal placeholder\nRETURN\n');  // existing lump is valid
    const r = runUpdateLump(['--token', TEST_TOKEN]);
    check('T4: assembly error exits non-zero', r.status !== 0);
    check('T4: assembly error reports line', r.stderr.includes('Assembly errors'));
}

console.log('\n── Check mode (--check) ─────────────────────────────────────────');

// T5: --check passes when binary matches source
{
    setupTestEntry({ cw: 1, cc: 0 });
    writeSource(SIMPLE_SOURCE);
    const { cw, cc, lump_size } = buildAndWriteLump(SIMPLE_SOURCE);
    const r = runUpdateLump(['--token', TEST_TOKEN, '--check']);
    check('T5: --check exits 0 when binary matches source', r.status === 0,
        `stdout: ${r.stdout.trim()}  stderr: ${r.stderr.trim()}`
    );
    check('T5: --check reports ok', r.stdout.includes('ok'));
}

// T6: --check fails and exits 1 when source has changed
{
    setupTestEntry({ cw: 2, cc: 0 });
    writeSource(SIMPLE_SOURCE_V2);   // source differs from what lump was built with
    buildAndWriteLump(SIMPLE_SOURCE); // lump built from old source
    const r = runUpdateLump(['--token', TEST_TOKEN, '--check']);
    check('T6: --check exits non-zero when binary differs from source', r.status !== 0);
    check('T6: --check reports DRIFT',  r.stderr.includes('DRIFT'));
    check('T6: --check makes no writes', (() => {
        const sc = JSON.parse(fs.readFileSync(TEST_SIDECAR, 'utf8'));
        return sc.cw !== 2;  // sidecar still has old value (1 word), not 2
    })());
}

// T7: --check fails when .lump file is missing
{
    setupTestEntry({ cw: 1, cc: 0 });
    writeSource(SIMPLE_SOURCE);
    buildAndWriteLump(SIMPLE_SOURCE);
    fs.unlinkSync(TEST_LUMP);  // remove the binary
    const r = runUpdateLump(['--token', TEST_TOKEN, '--check']);
    check('T7: --check exits non-zero when .lump missing', r.status !== 0);
    check('T7: --check reports DRIFT on missing file', r.stderr.includes('DRIFT'));
    // restore for cleanup
    buildAndWriteLump(SIMPLE_SOURCE);
}

console.log('\n── Update mode ──────────────────────────────────────────────────');

// T8: Update mode rewrites lump, sidecar, and manifest
{
    setupTestEntry({ cw: 1, cc: 0 });
    writeSource(SIMPLE_SOURCE);
    buildAndWriteLump(SIMPLE_SOURCE);
    // Now change source
    writeSource(SIMPLE_SOURCE_V2);
    const r = runUpdateLump(['--token', TEST_TOKEN]);
    check('T8: update mode exits 0', r.status === 0,
        `stdout: ${r.stdout.trim()}  stderr: ${r.stderr.trim()}`
    );
    check('T8: prints one-line summary', r.stdout.includes(`Updated ${TEST_TOKEN}`));

    const sc = JSON.parse(fs.readFileSync(TEST_SIDECAR, 'utf8'));
    check('T8: sidecar cw updated', sc.cw === 2);

    const mf = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const me = mf.find(e => (e.token || '').toLowerCase() === TEST_TOKEN);
    check('T8: manifest cw updated', me && me.cw === 2);

    // Binary must have 2 code words
    const bin = fs.readFileSync(TEST_LUMP);
    const hdr = bin.readUInt32BE(0);
    const binCW = (hdr >>> 10) & 0x1FFF;
    check('T8: binary header cw updated', binCW === 2);
}

// T9: Round-trip — after update, --check passes
{
    setupTestEntry({ cw: 1, cc: 0 });
    writeSource(SIMPLE_SOURCE_V2);
    buildAndWriteLump(SIMPLE_SOURCE);  // start with old binary
    runUpdateLump(['--token', TEST_TOKEN]);   // rebuild
    const r = runUpdateLump(['--token', TEST_TOKEN, '--check']);
    check('T9: --check passes after update', r.status === 0);
}

// T10: c-list words are preserved through update
{
    const clistGT = [0x48800003, 0x40800001];  // 2 GT words
    setupTestEntry({ cw: 2, cc: 2 });
    writeSource(SIMPLE_SOURCE);
    buildAndWriteLump(SIMPLE_SOURCE, clistGT);
    // Change source, rebuild
    writeSource(SIMPLE_SOURCE_V2);
    runUpdateLump(['--token', TEST_TOKEN]);
    // Verify c-list in new binary
    const bin = fs.readFileSync(TEST_LUMP);
    const hdr = bin.readUInt32BE(0);
    const n_m6 = (hdr >>> 23) & 0xF;
    const newLumpSize = 1 << (n_m6 + 6);
    const newCC = hdr & 0xFF;
    const clistBase = newLumpSize - newCC;
    const gt0 = bin.readUInt32BE(clistBase * 4);
    const gt1 = bin.readUInt32BE((clistBase + 1) * 4);
    check('T10: c-list GT[0] preserved after update', gt0 === clistGT[0],
        `expected 0x${clistGT[0].toString(16)} got 0x${gt0.toString(16)}`
    );
    check('T10: c-list GT[1] preserved after update', gt1 === clistGT[1],
        `expected 0x${clistGT[1].toString(16)} got 0x${gt1.toString(16)}`
    );
}

console.log('\n── Consistency gate ─────────────────────────────────────────────');

// T11: LUMP consistency gate passes after update
//      Clean up test files first so the gate does not see them.
{
    cleanup();
    const r = cp.spawnSync('python3', ['-m', 'pytest',
        'tests/lump/test_lump_consistency.py', '-v', '--tb=short'],
        { cwd: ROOT, encoding: 'utf8' });
    const passed = r.status === 0;
    check('T11: consistency gate passes after update', passed,
        passed ? '' : (r.stdout.slice(-800) + r.stderr.slice(-400))
    );
}

// =============================================================================
// Summary
// =============================================================================

console.log('');
console.log(`test_update_lump: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
