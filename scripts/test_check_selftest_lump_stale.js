#!/usr/bin/env node
'use strict';
// The guard must use the canonical named file, never 00000600.lump.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
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
    const approvalsPath = path.join(dir, 'approvals.json');
    const approvals = JSON.parse(fs.readFileSync(approvalsPath));
    const hash = Object.keys(approvals.approvals)[0];
    const approval = approvals.approvals[hash];
    for (const key of ['token', 'identity_string', 'identity_hash', 'identity_seal_location']) {
        delete approval[key];
    }
    fs.writeFileSync(approvalsPath, JSON.stringify(approvals));
    const bootstrapState = JSON.parse(fs.readFileSync(path.join(dir, 'ns-state.json')));
    bootstrapState.abstractions[0].identity_hash = 'obsolete-non-authoritative-name-hash';
    fs.writeFileSync(path.join(dir, 'ns-state.json'), JSON.stringify(bootstrapState));
    const validApprovals = fs.readFileSync(approvalsPath);
    r = run(GUARD);
    check(r.status === 0, 'current bootstrap approval needs no deferred identity-seal fields');
    check(r.stdout.includes('Selected SelfTest artifact: ' + approval.filename) &&
        r.stdout.includes('Proposed builder output (not selected or written):'),
        'diagnostics distinguish the selected file from proposed output');
    for (const [field, value] of [
        ['binary_hash', 'wrong'], ['filename', 'wrong.lump'],
        ['issue_n', approval.issue_n + 1], ['bootstrap_t', '00000000'],
        ['bootstrap_runtime_gt', approval.bootstrap_runtime_gt ^ 1],
        ['grants', ['R']], ['capability_type', 'abstract'],
        ['abstraction', 'Other'], ['dot_name', 'Other'],
    ]) {
        const invalid = JSON.parse(validApprovals);
        invalid.approvals[hash][field] = value;
        fs.writeFileSync(approvalsPath, JSON.stringify(invalid));
        const beforeCheck = fs.readFileSync(approvalsPath);
        r = run(GUARD);
        check(r.status !== 0 && r.stderr.includes('SelfTest hash-bound approval is missing or stale'),
            `rejects mismatched ${field}`);
        check(fs.readFileSync(approvalsPath).equals(beforeCheck), `does not repair ${field}`);
    }
    fs.writeFileSync(approvalsPath, JSON.stringify({ approvals: {} }));
    r = run(GUARD);
    check(r.status !== 0 && r.stderr.includes('no approval for selected binary hash'),
        'missing hash-bound approval remains a failure');
    fs.writeFileSync(approvalsPath, validApprovals);
    const binaryPath = path.join(dir, approval.filename);
    const validBinary = fs.readFileSync(binaryPath);
    const badSelf = Buffer.from(validBinary);
    const cc = badSelf.readUInt32BE(0) & 255;
    badSelf.writeUInt32BE(0, badSelf.length - cc * 4);
    fs.writeFileSync(binaryPath, badSelf);
    r = run(GUARD);
    check(r.status !== 0 && r.stderr.includes('row-zero SELF GT differs'),
        'rejects wrong SELF bytes even with otherwise valid approval metadata');
    fs.writeFileSync(binaryPath, validBinary);
    const protectedFiles = ['manifest.json', 'ns-state.json', 'approvals.json'];
    const before = protectedFiles.map(name => fs.readFileSync(path.join(dir, name)));
    const candidateDir = path.join(dir, 'review');
    r = run(BUILD, ['--candidate-dir', candidateDir]);
    check(r.status === 0, 'isolated unapproved candidate preparation succeeds');
    const review = JSON.parse(fs.readFileSync(path.join(candidateDir, 'review.json')));
    const candidate = fs.readFileSync(path.join(candidateDir, review.filename));
    check(review.status === 'unapproved-candidate' && review.installed === false,
        'review distinguishes preparation from approval and installation');
    check(candidate.readUInt32BE(4) === 0xBF000001 && (candidate.readUInt32BE(0) & 255) === 1,
        'candidate has method dispatch and SELF only');
    check(candidate.length === 8192 && review.words === 2048,
        'compressed candidate retains the 8 KiB allocation');
    const cw = (candidate.readUInt32BE(0) >>> 10) & 8191;
    let cursor = (cw + 1) * 4;
    const frame = candidate.readUInt32BE(cursor);
    check((frame >>> 24) === 0xAB && ((frame >>> 16) & 255) === 7,
        'source frame declares raw-deflate compression');
    cursor += 4 + Math.ceil((frame & 65535) / 4) * 4;
    const storedLength = candidate.readUInt32BE(cursor);
    const restored = zlib.inflateRawSync(candidate.subarray(cursor + 4, cursor + 4 + storedLength)).toString();
    check(restored === fs.readFileSync(path.join(ROOT, 'simulator/examples/post_flash_selftest.cloomc'), 'utf8'),
        'compressed source round-trips exactly');
    check(!/\bNext\b/.test(restored) && /capabilities\s*\{\s*SELF\s+E\s*;[^\n]*\n\s*\}/.test(restored),
        'embedded source declares only SELF, with no Next');
    check(candidate.readUInt32BE(cw * 4) === 0x1F000000 &&
        review.continuation === 'RETURN to caller; SELF-only C-list',
        'final instruction and review describe RETURN to caller');
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