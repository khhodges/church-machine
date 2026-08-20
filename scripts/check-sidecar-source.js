#!/usr/bin/env node
// scripts/check-sidecar-source.js
//
// Verifies that every sidecar JSON in server/lumps/ whose abstraction name
// has a matching canonical source file in simulator/examples/ carries the
// exact contents of that canonical source in its "source" field.
//
// Matching rule
// -------------
// The sidecar's "abstraction" value is converted to snake_case:
//   CapabilityTest   → capability_test
//   PostFlashSelftest → post_flash_selftest
//   Salvation        → salvation
//
// If simulator/examples/<snake>.cloomc exists the sidecar must have
//   "source": "<exact contents of simulator/examples/<snake>.cloomc>"
//
// Why this matters
// ----------------
// A rename or recompile pass can silently blank or stale the "source" field.
// This check catches both regressions before they reach production.
//
// Usage
// -----
//   node scripts/check-sidecar-source.js
//
// Test/integration overrides:
//   --sidecar-dir <path>   directory containing sidecar JSON files
//   --examples-dir <path>  directory containing canonical .cloomc files
//
// Exit codes:
//   0 — all matched sidecars contain their exact canonical source
//   1 — one or more violations found (details printed to stdout/stderr)

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT         = path.resolve(__dirname, '..');

function parsePathArg(name, fallback) {
    const marker = `--${name}`;
    const index = process.argv.indexOf(marker);
    if (index === -1) return fallback;
    const value = process.argv[index + 1];
    if (!value || value.startsWith('--')) {
        console.error(`Missing value for ${marker}`);
        process.exit(1);
    }
    return path.resolve(value);
}

const SIDECAR_DIR  = parsePathArg('sidecar-dir', path.join(ROOT, 'server', 'lumps'));
const EXAMPLES_DIR = parsePathArg('examples-dir', path.join(ROOT, 'simulator', 'examples'));

// Convert a CamelCase / PascalCase identifier to snake_case.
// Only the transition between a lower (or digit) char and an upper char
// inserts an underscore — this matches the naming convention used for
// the example .cloomc files.
function toSnake(name) {
    return name
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
        .toLowerCase();
}

// Build a Set of stem names (no extension) present in simulator/examples/.
function loadExampleStems() {
    const stems = new Set();
    if (!fs.existsSync(EXAMPLES_DIR)) return stems;
    for (const entry of fs.readdirSync(EXAMPLES_DIR)) {
        if (entry.endsWith('.cloomc')) {
            stems.add(entry.slice(0, -'.cloomc'.length));
        }
    }
    return stems;
}

const exampleStems = loadExampleStems();

let violations = 0;
let checked    = 0;

function displayPath(filePath) {
    const relative = path.relative(ROOT, filePath);
    return relative && !relative.startsWith('..') ? relative : filePath;
}

const sidecarFiles = fs.existsSync(SIDECAR_DIR)
    ? fs.readdirSync(SIDECAR_DIR).filter(f => f.endsWith('.json')).sort()
    : [];

for (const fname of sidecarFiles) {
    const fpath = path.join(SIDECAR_DIR, fname);
    let data;
    try {
        data = JSON.parse(fs.readFileSync(fpath, 'utf8'));
    } catch (_) {
        continue;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) continue;

    const abstraction = data.abstraction || '';
    // Skip sidecars with empty, qualified ("Abstraction:  Foo"), or
    // whitespace-only abstraction fields — they are not canonical lumps.
    if (!abstraction || abstraction.includes(':') || abstraction.includes('(')) continue;

    const stem = toSnake(abstraction);
    if (!exampleStems.has(stem)) continue; // no matching .cloomc — not subject to this check

    const relSidecar = path.relative(ROOT, fpath);
    checked++;

    const canonicalPath = path.join(EXAMPLES_DIR, `${stem}.cloomc`);
    let canonicalSource;
    try {
        canonicalSource = fs.readFileSync(canonicalPath, 'utf8');
    } catch (error) {
        console.error(`  FAIL ${relSidecar}`);
        console.error(`       could not read canonical source: ${displayPath(canonicalPath)}`);
        console.error(`       ${error.message}`);
        violations++;
        continue;
    }

    const source = data.source;
    if (typeof source !== 'string' || source.trim().length === 0) {
        console.error(`  FAIL ${relSidecar}`);
        console.error(`       "source" field is empty or absent`);
        console.error(`       canonical source: ${displayPath(canonicalPath)}`);
        violations++;
    } else if (source !== canonicalSource) {
        console.error(`  FAIL ${relSidecar}`);
        console.error(`       "source" does not match the canonical source`);
        console.error(`       canonical source: ${displayPath(canonicalPath)}`);
        console.error(`       sidecar source length: ${source.length}`);
        console.error(`       canonical source length: ${canonicalSource.length}`);
        violations++;
    } else {
        console.log(`  ok   ${relSidecar}`);
    }
}

console.log('');
if (violations > 0) {
    console.error(
        `check-sidecar-source: ${violations} violation(s) found (${checked} sidecar(s) checked).`
    );
    console.error('');
    console.error('A recompile or rename pass blanked or made the "source" field stale.');
    console.error('Repopulate it exactly from the matching simulator/examples/*.cloomc file,');
    console.error('or run the build script that generates the sidecar.');
    process.exit(1);
} else {
    console.log(
        `check-sidecar-source: all ${checked} sidecar(s) with a matching .cloomc file match exactly.`
    );
}
