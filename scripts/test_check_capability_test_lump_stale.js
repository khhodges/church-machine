#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const build = path.join(root, 'scripts', 'build_capability_test_lump.js');
const check = path.join(root, 'scripts', 'check_capability_test_lump_stale.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'capability-test-stale-'));
fs.writeFileSync(path.join(tmp, 'manifest.json'), '[]\n');

let result = spawnSync(process.execPath, [build, '--out-dir', tmp], { encoding: 'utf8' });
assert.strictEqual(result.status, 0, result.stderr);
result = spawnSync(process.execPath, [check, '--out-dir', tmp], { encoding: 'utf8' });
assert.strictEqual(result.status, 0, result.stderr);

const manifest = JSON.parse(fs.readFileSync(path.join(tmp, 'manifest.json'), 'utf8'));
const entry = manifest.find(e => e.token === '00000a00');
assert(entry, 'build must preserve the protected CapabilityTest identity token');
assert.strictEqual(entry.ns_slot, 10);

const binary = path.join(tmp, entry.filename);
const bytes = fs.readFileSync(binary);
bytes[8] ^= 1;
fs.writeFileSync(binary, bytes);
result = spawnSync(process.execPath, [check, '--out-dir', tmp], { encoding: 'utf8' });
assert.notStrictEqual(result.status, 0, 'tampered binary must be detected as stale');
assert((result.stderr + result.stdout).includes('binary missing or stale'));

fs.rmSync(tmp, { recursive: true, force: true });
console.log('CapabilityTest freshness regressions passed.');