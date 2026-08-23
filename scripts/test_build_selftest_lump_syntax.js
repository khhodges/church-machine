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

if (result.status !== 0) {
    console.error(`SelfTest builder syntax check failed for ${SCRIPT}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status || 1);
}

console.log('SelfTest builder syntax check passed.');