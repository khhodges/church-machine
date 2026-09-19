#!/usr/bin/env node
// Regression guard: the SelfTest builder must remain executable JavaScript.
// A truncated or unbalanced edit otherwise blocks boot-artifact regeneration.

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(__dirname, 'build_selftest_lump.js');
const result = spawnSync(process.execPath, ['--check', SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
});

const source = require('fs').readFileSync(
    path.join(ROOT, 'simulator', 'examples', 'post_flash_selftest.cloomc'), 'utf8');
if (/^\s*IADD\s+DR0\s*,\s*DR0\s*,\s*#(?:[1-9]|[1-7][0-9]|8[01])\s*$/mi.test(source)) {
    console.error('SelfTest source masks a failure by writing hardwired DR0');
    process.exit(1);
}
for (const test of [1, 42, 63, 81]) {
    if (!new RegExp(`^\\s*IADD\\s+DR1\\s*,\\s*DR0\\s*,\\s*#${test}\\s*$`, 'mi').test(source)) {
        console.error(`SelfTest source lacks representative DR1 status ${test}`);
        process.exit(1);
    }
}

if (result.status !== 0) {
    console.error(`SelfTest builder syntax check failed for ${SCRIPT}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status || 1);
}

console.log('SelfTest builder syntax check passed.');