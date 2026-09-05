#!/usr/bin/env node
// scripts/test_build_selftest_lump_cleanup.js
//
// Regression test for the old-token cleanup logic in build_selftest_lump.js.
//
// The test seeds a temp lumps directory with a fake "old" PostFlashSelftest
// token entry in manifest.json plus a matching .lump stub file, then
// runs build_selftest_lump.js --lumps-dir <tempdir>.  It asserts that:
//
//   1. The old .lump file is deleted.
//   2. A new .lump is written for the freshly-computed token.
//   3. manifest.json contains exactly one PostFlashSelftest entry with the
//      new token.
//   4. The script exits with code 0.
//
// The happy-path (token unchanged) is also verified: when the pre-seeded token
// already matches the compiled output, old files must NOT be deleted.
//
// Run:
//   node scripts/test_build_selftest_lump_cleanup.js

'use strict';

const fs            = require('fs');
const path          = require('path');
const os            = require('os');
const { spawnSync } = require('child_process');

const ROOT   = path.resolve(__dirname, '..');
const SCRIPT = path.join(__dirname, 'build_selftest_lump.js');
const REAL_MANIFEST = path.join(ROOT, 'server', 'lumps', 'manifest.json');

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

function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'selftest_lump_cleanup_'));
}

function runScript(lumpsDir) {
    const result = spawnSync(
        process.execPath,
        [SCRIPT, '--lumps-dir', lumpsDir],
        { encoding: 'utf8', cwd: ROOT }
    );
    return {
        code:   result.status,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
    };
}

function seedTempDir(tmpDir, oldToken, manifest) {
    // Write manifest
    fs.writeFileSync(path.join(tmpDir, 'manifest.json'), JSON.stringify(manifest, null, 4) + '\n');
    // Write stub old-token files
    fs.writeFileSync(path.join(tmpDir, `${oldToken}.lump`), 'STUB_OLD_LUMP');
}

// ── Read real manifest to get a valid baseline ────────────────────────────────
let realManifest;
try {
    realManifest = JSON.parse(fs.readFileSync(REAL_MANIFEST, 'utf8'));
} catch (e) {
    console.error(`Cannot read real manifest: ${e.message}`);
    process.exit(1);
}

const realEntry = realManifest.find(e => e.abstraction === 'PostFlashSelftest');
if (!realEntry) {
    console.error('No PostFlashSelftest entry in real manifest — cannot derive expected token.');
    process.exit(1);
}
function builtToken() {
    const dir = makeTempDir();
    try {
        fs.writeFileSync(path.join(dir, 'manifest.json'), '[]\n');
        const result = runScript(dir);
        if (result.code !== 0) throw new Error(result.stderr);
        const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
        return manifest.find(entry => entry.abstraction === 'PostFlashSelftest').token;
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
const realToken = builtToken();

// ── Suite 1: different old token → old files must be removed ─────────────────
console.log('\nSuite 1: prior token differs → old .lump must be deleted');

let tmpDir1;
try {
    tmpDir1 = makeTempDir();
    const oldToken = 'deadbeef';

    // Seed manifest with the fake old token (all other entries from real manifest)
    const seededManifest = realManifest.map(e =>
        e.abstraction === 'PostFlashSelftest'
            ? Object.assign({}, e, { token: oldToken })
            : e
    );
    seedTempDir(tmpDir1, oldToken, seededManifest);

    const r = runScript(tmpDir1);

    assert(r.code === 0, 'script exits with code 0');

    const oldLump = path.join(tmpDir1, `${oldToken}.lump`);
    assert(!fs.existsSync(oldLump), `old .lump (${oldToken}.lump) is deleted`);

    // New files must exist
    const newLump = path.join(tmpDir1, `${realToken}.lump`);
    assert(fs.existsSync(newLump), `new .lump (${realToken}.lump) is written`);

    // Manifest must have exactly one PostFlashSelftest with the new token
    const updatedManifest = JSON.parse(fs.readFileSync(path.join(tmpDir1, 'manifest.json'), 'utf8'));
    const entries = updatedManifest.filter(e => e.abstraction === 'PostFlashSelftest');
    assert(entries.length === 1, 'manifest has exactly one PostFlashSelftest entry');
    assert(entries[0].token === realToken, `manifest PostFlashSelftest token is ${realToken}`);

    const logged = r.stdout + r.stderr;
    assert(
        logged.includes(`Removed old`) && logged.includes(oldToken),
        'script logs removal of old files'
    );
} finally {
    if (tmpDir1) try { fs.rmSync(tmpDir1, { recursive: true, force: true }); } catch (_) {}
}

// ── Suite 2: token unchanged → old files must NOT be deleted ─────────────────
console.log('\nSuite 2: prior token matches compiled output → no deletion');

let tmpDir2;
try {
    tmpDir2 = makeTempDir();

    // Seed manifest with the real (current) token
    const seededManifest = [...realManifest];
    seedTempDir(tmpDir2, realToken, seededManifest);

    // The "old" stub file for realToken doubles as the file that should survive
    // (the script will overwrite it with the real binary — just check it stays)

    const r = runScript(tmpDir2);

    assert(r.code === 0, 'script exits with code 0');

    // Log must NOT contain "Removed old"
    const logged = r.stdout + r.stderr;
    assert(
        !logged.includes('Removed old'),
        'script does not log any removal when token is unchanged'
    );

    // File for real token must still exist (script writes it fresh either way)
    const lumpPath = path.join(tmpDir2, `${realToken}.lump`);
    assert(fs.existsSync(lumpPath), `${realToken}.lump exists after unchanged-token run`);

    // Exactly one PostFlashSelftest entry
    const updatedManifest = JSON.parse(fs.readFileSync(path.join(tmpDir2, 'manifest.json'), 'utf8'));
    const entries = updatedManifest.filter(e => e.abstraction === 'PostFlashSelftest');
    assert(entries.length === 1, 'manifest still has exactly one PostFlashSelftest entry');
    assert(entries[0].token === realToken, 'manifest token unchanged');
} finally {
    if (tmpDir2) try { fs.rmSync(tmpDir2, { recursive: true, force: true }); } catch (_) {}
}

// ── Suite 3: no prior PostFlashSelftest entry → new files written cleanly ─────
console.log('\nSuite 3: no prior PostFlashSelftest entry → new files written, no error');

let tmpDir3;
try {
    tmpDir3 = makeTempDir();

    // Manifest without any PostFlashSelftest entry
    const stripped = realManifest.filter(e => e.abstraction !== 'PostFlashSelftest');
    fs.writeFileSync(path.join(tmpDir3, 'manifest.json'), JSON.stringify(stripped, null, 4) + '\n');

    const r = runScript(tmpDir3);

    assert(r.code === 0, 'script exits with code 0');

    const newLump = path.join(tmpDir3, `${realToken}.lump`);
    assert(fs.existsSync(newLump), `new .lump written when there was no prior entry`);

    const updatedManifest = JSON.parse(fs.readFileSync(path.join(tmpDir3, 'manifest.json'), 'utf8'));
    const entries = updatedManifest.filter(e => e.abstraction === 'PostFlashSelftest');
    assert(entries.length === 1, 'manifest gains exactly one PostFlashSelftest entry');
    assert(entries[0].token === realToken, 'new manifest entry has the correct token');
} finally {
    if (tmpDir3) try { fs.rmSync(tmpDir3, { recursive: true, force: true }); } catch (_) {}
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
    process.exit(1);
}
console.log('All tests passed.');
process.exit(0);
