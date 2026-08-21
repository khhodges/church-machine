#!/usr/bin/env node
// scripts/test_build_lump_sidecar_source.js
//
// CI guard: for each of the three canonical LUMP build scripts, this test:
//   1. Runs the build script in a throw-away temp directory (--out-dir)
//   2. Immediately verifies that the generated sidecar's "source" field
//      exactly matches the canonical .cloomc source file
//
// The verification is done directly (not via check-sidecar-source.js's
// toSnake discovery, which does not handle all abstraction-name/filename
// combinations such as WukongCallHome → wukong_callhome.cloomc).
//
// A future edit to any build script that accidentally drops or stales the
// "source" field will be caught here in CI rather than by manual inspection.
//
// Exit 0 if every build/check pair passes; non-zero otherwise.

'use strict';

const fs             = require('fs');
const path           = require('path');
const os             = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// Each entry records:
//   rel        — path to the build script (relative to ROOT)
//   abstraction — the "abstraction" field the sidecar will carry
//   sourceFile  — the canonical .cloomc file the sidecar "source" must match
const BUILD_SCRIPTS = [
    {
        rel:          'scripts/build_capability_test_lump.js',
        abstraction:  'CapabilityTest',
        sourceFile:   'simulator/examples/capability_test.cloomc',
    },
    {
        rel:          'scripts/build_selftest_lump.js',
        abstraction:  'PostFlashSelftest',
        sourceFile:   'simulator/examples/post_flash_selftest.cloomc',
    },
    {
        rel:          'scripts/build_wukong_callhome_lump.js',
        abstraction:  'WukongCallHome',
        sourceFile:   'simulator/examples/wukong_callhome.cloomc',
    },
    {
        rel:          'scripts/build_event_router_lump.js',
        abstraction:  'EventRouter',
        sourceFile:   'simulator/cloomc/EventRouter.cloomc',
    },
];

let failures = 0;

for (const entry of BUILD_SCRIPTS) {
    const scriptPath = path.join(ROOT, entry.rel);
    const canonicalPath = path.join(ROOT, entry.sourceFile);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lump-build-ci-'));

    try {
        // Seed an empty manifest so the build script can read and update it.
        fs.writeFileSync(path.join(tmpDir, 'manifest.json'), '[]\n', 'utf8');

        console.log(`\n── ${entry.rel} ──`);

        // Step 1: run the build script, redirecting output to tmpDir.
        try {
            execFileSync(process.execPath, [scriptPath, '--out-dir', tmpDir], {
                cwd: ROOT,
                stdio: 'inherit',
            });
        } catch (_err) {
            console.error(`  FAIL  build script exited non-zero: ${entry.rel}`);
            failures++;
            continue;
        }

        // Step 2: find the sidecar JSON that matches the expected abstraction.
        const sidecarFiles = fs.readdirSync(tmpDir)
            .filter(f => f.endsWith('.json') && f !== 'manifest.json');

        if (sidecarFiles.length === 0) {
            console.error(`  FAIL  no sidecar .json found in temp dir for: ${entry.rel}`);
            failures++;
            continue;
        }

        // Find the sidecar whose abstraction field matches.
        let matchedSidecar = null;
        for (const fname of sidecarFiles) {
            const fpath = path.join(tmpDir, fname);
            let data;
            try {
                data = JSON.parse(fs.readFileSync(fpath, 'utf8'));
            } catch (_) {
                continue;
            }
            if (data && data.abstraction === entry.abstraction) {
                matchedSidecar = data;
                break;
            }
        }

        if (!matchedSidecar) {
            console.error(
                `  FAIL  no sidecar with abstraction="${entry.abstraction}" found for: ${entry.rel}`
            );
            console.error(`       sidecar files in tmpDir: ${sidecarFiles.join(', ')}`);
            failures++;
            continue;
        }

        // Step 3: read the canonical source and compare.
        let canonicalSource;
        try {
            canonicalSource = fs.readFileSync(canonicalPath, 'utf8');
        } catch (err) {
            console.error(
                `  FAIL  could not read canonical source ${entry.sourceFile}: ${err.message}`
            );
            failures++;
            continue;
        }

        const { source } = matchedSidecar;
        if (typeof source !== 'string' || source.trim().length === 0) {
            console.error(`  FAIL  sidecar "source" field is empty or absent`);
            console.error(`       abstraction: ${entry.abstraction}`);
            console.error(`       canonical source: ${entry.sourceFile}`);
            failures++;
        } else if (source !== canonicalSource) {
            console.error(`  FAIL  sidecar "source" does not match the canonical source`);
            console.error(`       abstraction: ${entry.abstraction}`);
            console.error(`       canonical: ${entry.sourceFile}`);
            console.error(
                `       lengths: sidecar=${source.length}, canonical=${canonicalSource.length}`
            );
            failures++;
        } else {
            console.log(`  PASS  source field verified for: ${entry.rel}`);
        }
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

console.log('');
if (failures > 0) {
    console.error(`test-build-lump-sidecar-source: ${failures} failure(s).`);
    process.exit(1);
} else {
    console.log(
        `test-build-lump-sidecar-source: all ${BUILD_SCRIPTS.length} build/check pair(s) passed.`
    );
}
