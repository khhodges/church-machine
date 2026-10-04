#!/usr/bin/env node
'use strict';
// The guard must use the canonical named file, never 00000600.lump.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(__dirname, 'build_selftest_lump.js');
const GUARD = path.join(__dirname, 'check_selftest_lump_stale.js');
let passed = 0, failed = 0;
function check(ok, text) { console[ok ? 'log' : 'error'](`  ${ok ? 'PASS' : 'FAIL'}: ${text}`); ok ? passed++ : failed++; }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'selftest-stale-'));
function run(script, args = []) { return spawnSync(process.execPath, [script, '--lumps-dir', dir, ...args], { cwd: ROOT, encoding: 'utf8' }); }
try {
    fs.writeFileSync(path.join(dir, 'manifest.json'), '[]');
    fs.writeFileSync(path.join(dir, 'ns-state.json'), JSON.stringify({ abstractions: [{ name: 'SelfTest', slot: 41, seq: 3 }] }));
    let r = run(BUILD, ['--lump-words', '8192']);
    check(r.status === 0, 'fixture build succeeds');
    // A legacy file must neither be required nor alter the verdict.
    r = run(GUARD, ['--lump-words', '8192']);
    check(r.status === 0, 'guard passes without legacy 00000600.lump');
    fs.writeFileSync(path.join(dir, '00000600.lump'), 'intentionally unrelated legacy artifact');
    r = run(GUARD, ['--lump-words', '8192']);
    check(r.status === 0, 'guard ignores a legacy 00000600.lump');
    r = run(GUARD, ['--lump-words', '16384']);
    check(r.status === 0, 'prospective allocation/revision never changes active identity validation');
    const protectedFiles = ['manifest.json', 'ns-state.json', 'approvals.json'];
    const before = protectedFiles.map(name => fs.readFileSync(path.join(dir, name)));
    const candidateDir = path.join(dir, 'review');
    r = run(BUILD, ['--candidate-dir', candidateDir]);
    check(r.status === 0, 'isolated unapproved candidate preparation succeeds');
    const review = JSON.parse(fs.readFileSync(path.join(candidateDir, 'review.json')));
    const candidate = fs.readFileSync(path.join(candidateDir, review.filename));
    check(review.status === 'unapproved-candidate' && review.installed === false,
        'review distinguishes preparation from approval and installation');
    check(candidate.readUInt32BE(4) === 0xBF000001 && (candidate.readUInt32BE(0) & 255) === 2,
        'candidate has method dispatch and both capability rows');
    check(protectedFiles.every((name, i) => fs.readFileSync(path.join(dir, name)).equals(before[i])),
        'candidate preparation preserves manifest, Namespace and approvals');
    r = run(BUILD, ['--candidate-dir', candidateDir]);
    check(r.status !== 0, 'existing review candidate cannot be overwritten');
    const statePath = path.join(dir, 'ns-state.json');
    const state = JSON.parse(fs.readFileSync(statePath));
    state.abstractions[0].filename = 'missing.lump';
    fs.writeFileSync(statePath, JSON.stringify(state));
    r = run(GUARD, ['--lump-words', '8192']);
    check(r.status === 1 && (r.stderr + r.stdout).includes('ns-state canonical SelfTest binding is stale'),
        'guard fails when current ns-state filename is stale');
} finally {
    fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);