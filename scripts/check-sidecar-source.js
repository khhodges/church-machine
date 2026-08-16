#!/usr/bin/env node
// scripts/check-sidecar-source.js
//
// Verifies that every sidecar JSON in server/lumps/ whose abstraction name
// has a matching canonical source file in simulator/examples/ carries a
// non-empty "source" field.
//
// Matching rule
// -------------
// The sidecar's "abstraction" value is converted to snake_case:
//   CapabilityTest   → capability_test
//   PostFlashSelftest → post_flash_selftest
//   Salvation        → salvation
//
// If simulator/examples/<snake>.cloomc exists the sidecar must have
//   "source": "<non-empty string>"
//
// Why this matters
// ----------------
// A rename or recompile pass can silently blank the "source" field.  This
// check catches that regression before it reaches production.
//
// Usage
// -----
//   node scripts/check-sidecar-source.js
//
// Exit codes:
//   0 — all matched sidecars have non-empty source
//   1 — one or more violations found (details printed to stdout/stderr)

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT         = path.resolve(__dirname, '..');
const SIDECAR_DIR  = path.join(ROOT, 'server', 'lumps');
const EXAMPLES_DIR = path.join(ROOT, 'simulator', 'examples');

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

    const source = data.source;
    if (typeof source === 'string' && source.trim().length > 0) {
        console.log(`  ok   ${relSidecar}`);
    } else {
        console.error(`  FAIL ${relSidecar}`);
        console.error(`       "source" field is empty or absent`);
        console.error(`       canonical source: simulator/examples/${stem}.cloomc`);
        violations++;
    }
}

console.log('');
if (violations > 0) {
    console.error(
        `check-sidecar-source: ${violations} violation(s) found (${checked} sidecar(s) checked).`
    );
    console.error('');
    console.error('A recompile or rename pass blanked the "source" field.');
    console.error('Repopulate it from the matching simulator/examples/*.cloomc file,');
    console.error('or run the build script that generates the sidecar.');
    process.exit(1);
} else {
    console.log(
        `check-sidecar-source: all ${checked} sidecar(s) with a matching .cloomc file pass.`
    );
}
