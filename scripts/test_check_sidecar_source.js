#!/usr/bin/env node
// scripts/test_check_sidecar_source.js
//
// Regression tests for check-sidecar-source.js:
//   - exact canonical source passes
//   - changed and truncated non-empty source fail
//   - empty source still fails
//   - sidecars without a canonical source remain out of scope
//
// Run with:
//   node scripts/test_check_sidecar_source.js

'use strict';

const fs            = require('fs');
const os            = require('os');
const path          = require('path');
const { spawnSync } = require('child_process');

const GUARD = path.join(__dirname, 'check-sidecar-source.js');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'check-sidecar-source-'));
const sidecarDir = path.join(tempRoot, 'sidecars');
const examplesDir = path.join(tempRoot, 'examples');
const canonicalPath = path.join(examplesDir, 'capability_test.cloomc');
const sidecarPath = path.join(sidecarDir, 'CapabilityTest.1.json');
const unmatchedSidecarPath = path.join(sidecarDir, 'Unmatched.1.json');

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  PASS: ${message}`);
        passed++;
    } else {
        console.error(`  FAIL: ${message}`);
        failed++;
    }
}

function runGuard() {
    const result = spawnSync(
        process.execPath,
        [
            GUARD,
            '--sidecar-dir', sidecarDir,
            '--examples-dir', examplesDir,
        ],
        { encoding: 'utf8' }
    );
    return {
        code: result.status,
        output: `${result.stdout || ''}${result.stderr || ''}`,
    };
}

function writeSidecar(source, abstraction = 'CapabilityTest') {
    fs.writeFileSync(
        sidecarPath,
        JSON.stringify({ abstraction, source }, null, 2) + '\n',
        'utf8'
    );
}

function writeUnmatchedSidecar() {
    fs.writeFileSync(
        unmatchedSidecarPath,
        JSON.stringify({
            abstraction: 'NoCanonicalExample',
            source: 'intentionally unrelated',
        }, null, 2) + '\n',
        'utf8'
    );
}

function cleanup() {
    fs.rmSync(tempRoot, { recursive: true, force: true });
}

try {
    fs.mkdirSync(sidecarDir, { recursive: true });
    fs.mkdirSync(examplesDir, { recursive: true });

    const canonical = [
        '; CapabilityTest fixture',
        'capabilities {',
        '    SelfTest E',
        '}',
        '',
    ].join('\n');
    fs.writeFileSync(canonicalPath, canonical, 'utf8');

    console.log('\nSuite 1: exact canonical source passes');
    writeSidecar(canonical);
    let result = runGuard();
    assert(result.code === 0, 'exact source exits with code 0');
    assert(result.output.includes('match exactly'), 'success output confirms exact matching');

    console.log('\nSuite 2: changed non-empty source fails');
    writeSidecar(canonical.replace('SelfTest E', 'SelfTest L'));
    result = runGuard();
    assert(result.code === 1, 'changed source exits with code 1');
    assert(result.output.includes('"source" does not match the canonical source'),
        'changed source reports a canonical mismatch');
    assert(result.output.includes('CapabilityTest.1.json') &&
           result.output.includes('capability_test.cloomc'),
        'mismatch names both the sidecar and canonical source');

    console.log('\nSuite 3: truncated non-empty source fails');
    writeSidecar(canonical.slice(0, -2));
    result = runGuard();
    assert(result.code === 1, 'truncated source exits with code 1');
    assert(result.output.includes('sidecar source length') &&
           result.output.includes('canonical source length'),
        'truncated source reports both source lengths');

    console.log('\nSuite 4: empty source fails');
    writeSidecar('');
    result = runGuard();
    assert(result.code === 1, 'empty source exits with code 1');
    assert(result.output.includes('"source" field is empty or absent'),
        'empty source retains the existing failure message');

    console.log('\nSuite 5: unmatched sidecar is ignored');
    fs.unlinkSync(sidecarPath);
    writeUnmatchedSidecar();
    result = runGuard();
    assert(result.code === 0, 'sidecar without a canonical source exits with code 0');
    assert(result.output.includes('all 0 sidecar(s)'),
        'unmatched sidecar is excluded from the checked count');
} finally {
    cleanup();
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);
console.log('All tests passed.');