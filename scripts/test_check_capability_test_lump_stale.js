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
const entry = manifest.find(e => e.token === '4a00000a');
assert(entry, 'build must preserve the protected CapabilityTest identity token');
assert.strictEqual(entry.abstraction, 'CapabilityTest');

const binary = path.join(tmp, entry.filename);
const bytes = fs.readFileSync(binary);
const words = [];
for (let i = 0; i < bytes.length; i += 4) words.push(bytes.readUInt32BE(i));
const header = words[0] >>> 0;
const cw = (header >>> 10) & 0x1FFF;
const frameStart = 1 + cw;
const frameHeader = words[frameStart] >>> 0;
assert.strictEqual(frameHeader >>> 24, 0xAB);
const apiBytes = frameHeader & 0xFFFF;
const sourceLengthWord = frameStart + 1 + Math.ceil(apiBytes / 4);
const sourceLength = words[sourceLengthWord] >>> 0;
const sourceBytes = Buffer.alloc(sourceLength);
for (let i = 0; i < sourceLength; i++) {
    const word = words[sourceLengthWord + 1 + (i >> 2)] >>> 0;
    sourceBytes[i] = (word >>> (24 - (i & 3) * 8)) & 0xFF;
}
assert.strictEqual(
    sourceBytes.toString('utf8'),
    fs.readFileSync(path.join(root, 'simulator', 'examples', 'capability_test.cloomc'), 'utf8'),
    'active CapabilityTest binary must embed the canonical source exactly');
bytes[8] ^= 1;
fs.writeFileSync(binary, bytes);
result = spawnSync(process.execPath, [check, '--out-dir', tmp], { encoding: 'utf8' });
assert.notStrictEqual(result.status, 0, 'tampered binary must be detected as stale');
assert((result.stderr + result.stdout).includes('binary missing or stale'));

fs.rmSync(tmp, { recursive: true, force: true });
console.log('CapabilityTest freshness regressions passed.');