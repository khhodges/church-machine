'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const canonical = fs.readFileSync(
    path.join(__dirname, 'examples', 'post_flash_selftest.cloomc'), 'utf8');
const appRun = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');

function assertTpermBranch(source, testNumber, cr, preset, branch, target) {
    const pattern = new RegExp(
        `Test ${testNumber}:[^\\n]*\\n\\s*TPERM ${cr}, ${preset}\\s*\\n\\s*${branch} ${target}\\b`);
    assert.match(source, pattern,
        `SelfTest ${testNumber} must use ${branch} after TPERM ${cr}, ${preset}`);
}

for (const source of [canonical, appRun]) {
    assert.match(source,
        /Test 58:[^\n]*0xABCD[\s\S]*?IADD DR1, DR1, #10995\s*\n\s*SHL DR1, DR1, #2\s*\n\s*IADD DR1, DR1, #1/,
        'SelfTest 58 must construct 0xABCD rather than 0xFFFF');
    assertTpermBranch(source, 67, 'CR1', 'E', 'BRANCHEQ', 'tI68');
    assertTpermBranch(source, 68, 'CR1', 'L', 'BRANCHNE', 'tI69');
    assertTpermBranch(source, 72, 'CR0', 'E', 'BRANCHEQ', 'tI73');
    assertTpermBranch(source, 78, 'CR0', 'LS', 'BRANCHNE', 'tK79');
    assertTpermBranch(source, 79, 'CR0', 'E', 'BRANCHEQ', 'tLstart');
    assert.doesNotMatch(source,
        /Test 78:[^\n]*\n\s*TPERM CR0, RW/,
        'continuing SelfTest must not issue a cross-domain RW request on an E-GT');
}

console.log('SelfTest TPERM branch-polarity regression passed');