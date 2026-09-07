#!/usr/bin/env node
'use strict';
// Regression coverage for named canonical SelfTest artifacts and archival.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(__dirname, 'build_selftest_lump.js');
let passed = 0, failed = 0;
function check(ok, text) { console[ok ? 'log' : 'error'](`  ${ok ? 'PASS' : 'FAIL'}: ${text}`); ok ? passed++ : failed++; }
function temp() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'selftest-artifact-'));
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify([{
        token: 'deadbeef', abstraction: 'SelfTest', filename: 'SelfTest.1.old.lump',
        ns_slot: 37, binary_hash: 'old',
    }], null, 2));
    fs.writeFileSync(path.join(dir, 'ns-state.json'), JSON.stringify({
        abstractions: [{ name: 'SelfTest', slot: 37, seq: 17, location: '0x00ABCDEF',
            token: 'deadbeef', filename: 'SelfTest.1.old.lump' }],
    }, null, 2));
    fs.writeFileSync(path.join(dir, 'SelfTest.1.old.lump'), 'historic bytes');
    return dir;
}
function build(dir, extra = []) {
    return spawnSync(process.execPath, [BUILD, '--lumps-dir', dir, ...extra],
        { cwd: ROOT, encoding: 'utf8' });
}
let dir;
try {
    console.log('\nSuite: canonical named artifact preserves history');
    dir = temp();
    const r = build(dir, ['--lump-words', '8192']);
    check(r.status === 0, 'build succeeds with explicit 8192-word allocation');
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json')));
    const active = manifest.filter(e => e.abstraction === 'SelfTest' && !e.archived);
    const archived = manifest.find(e => e.filename === 'SelfTest.1.old.lump');
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'ns-state.json'))).abstractions[0];
    check(active.length === 1 && /^SelfTest\.1\.[0-9a-f]{8}\.lump$/.test(active[0].filename),
        'manifest has one named canonical SelfTest record');
    check(/^[0-9a-f]{8}$/.test(active[0].token) &&
        Number.isInteger(active[0].lump_version) &&
        !Object.hasOwn(active[0], 'ns_slot') && !Object.hasOwn(active[0], 'lump_size'),
    'manifest remains a locator/history-only canonical record');
    check(archived && archived.archived === true && fs.existsSync(path.join(dir, archived.filename)),
        'old manifest record and old binary remain archived history');
    check(state.token === active[0].token && state.filename === active[0].filename,
        'ns-state names the exact active artifact');
    check(/^[0-9a-f]{64}$/.test(state.identity_hash) &&
        /^[0-9a-f]{64}$/.test(state.binary_hash) &&
        state.ns_slot_policy === 'static' && state.load_policy === 'Resident' &&
        state.resident === true && state.boot_resident === true &&
        state.issue_n === active[0].lump_version && state.lump_version === active[0].lump_version &&
        state.limit === '0x01FFD' && state.location === '0x00ABCDEF',
    'ns-state carries complete fail-closed identity, residency, version, and limit binding');
    check(JSON.parse(fs.readFileSync(path.join(dir, 'ns-state.json'))).abstractions
        .filter(row => row.name === 'SelfTest').length === 1,
    'slot migration keeps exactly one SelfTest ns-state row');
    check(fs.existsSync(path.join(dir, active[0].filename)), 'named artifact was written');
    const bytes = fs.readFileSync(path.join(dir, active[0].filename));
    const selfGT = bytes.readUInt32BE(bytes.length - 8);
    const nextGT = bytes.readUInt32BE(bytes.length - 4);
    check(selfGT === nextGT && (selfGT & 0xFFFF) === 37 &&
        ((selfGT >>> 16) & 0x1FF) === 17,
    'Self and Next E-GTs use the selected slot and live ns-state sequence');
    const approvals = JSON.parse(fs.readFileSync(path.join(dir, 'approvals.json'))).approvals;
    const approval = approvals[state.binary_hash];
    check(approval && approval.token === active[0].token &&
        approval.identity_string === `SelfTest#${state.issue_n}` &&
        approval.identity_seal_location === 'approval' &&
        approval.identity_hash === state.identity_hash,
    'exact content-hash approval carries its derived identity seal metadata');
    const loaded = spawnSync(process.env.PYTHON || 'python3', [
        '-c',
        'import sys; from server.lump_approvals import read_approvals; read_approvals(sys.argv[1], missing_ok=False)',
        path.join(dir, 'approvals.json'),
    ], { cwd: ROOT, encoding: 'utf8' });
    check(loaded.status === 0,
        'builder approval shape loads through the production approval contract');
    const guarded = build(dir, ['--check', '--lump-words', '8192']);
    check(guarded.status === 0, 'check validates exact manifest/ns-state filename');
    const badState = JSON.parse(fs.readFileSync(path.join(dir, 'ns-state.json')));
    badState.abstractions[0].filename = 'wrong.lump';
    fs.writeFileSync(path.join(dir, 'ns-state.json'), JSON.stringify(badState));
    const stale = build(dir, ['--check', '--lump-words', '8192']);
    check(stale.status === 1 && (stale.stderr + stale.stdout).includes('ns-state canonical SelfTest binding is stale'),
        'check rejects an ns-state filename mismatch');
} finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);