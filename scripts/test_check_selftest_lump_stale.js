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