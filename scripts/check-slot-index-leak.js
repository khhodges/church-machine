#!/usr/bin/env node
'use strict';
// check-slot-index-leak.js — CI guard: no raw NS slot integer declarations
// outside the boot image layer (hardware/hw_types.py).
//
// Scans JavaScript source files for const/let/var declarations whose name
// ends with "_NS_SLOT" and is assigned an integer literal — the naming
// convention used by the four module-scope constants removed from simulator.js
// in the pet-name-first refactor.  Any such declaration in the JS layer is a
// policy violation; slot indices belong exclusively in hardware/hw_types.py.
//
// JS runtime code must resolve slot names via:
//   sim._slotByPetName(name)            → throws on miss (required slots)
//   sim._slotByPetName(name, fallback)  → returns fallback on miss (optional)
//   sim.nsLabels[idx]                   → reverse label lookup
//
// Exemptions are documented below.
//
// Exit: 0 if clean, 1 if violations found.

const fs   = require('fs');
const path = require('path');

// JavaScript directories to scan for leaks.
const SCAN_ROOTS = ['simulator', 'scripts', 'tests'];
const JS_EXT = '.js';

// A violating line:
//   • is a const/let/var declaration
//   • whose name ends with "_NS_SLOT"
//     (catches BOOT_ABSTR_NS_SLOT, SCHEDULER_NS_SLOT, etc.)
const DECL_RE   = /^\s*(const|let|var)\s+(\w+)\s*=\s*\d+/;
const SUFFIX_RE = /_NS_SLOT$/;

// Known test-fixture names that are legitimately not the real NS slot value:
//   EMPTY_NS_SLOT  — sentinel (99) meaning "nothing written here"
//   CUSTOM_NS_SLOT — e2e test fixture for a test-registered abstraction
//   TEST_NS_SLOT   — e2e test fixture used by tier1_catch_recovery spec
const EXEMPT_NAMES = new Set([
    'EMPTY_NS_SLOT', 'CUSTOM_NS_SLOT', 'TEST_NS_SLOT',
    // Fixed-slot values in this source-level fixture describe synthetic
    // Constants/data/thread lumps; they are not runtime policy declarations.
    'CONSTANTS_NS_SLOT', 'DATA_NS_SLOT', 'THREAD_NS_SLOT',
]);

function isViolation(line) {
    const m = DECL_RE.exec(line);
    if (!m) return false;
    const name = m[2];
    if (!SUFFIX_RE.test(name)) return false;
    if (EXEMPT_NAMES.has(name)) return false;
    return true;
}

function scanFile(absPath) {
    const relPath = path.relative(process.cwd(), absPath).replace(/\\/g, '/');
    const lines   = fs.readFileSync(absPath, 'utf8').split('\n');
    const hits    = [];
    lines.forEach((line, idx) => {
        if (isViolation(line)) {
            hits.push({ file: relPath, line: idx + 1, text: line.trim() });
        }
    });
    return hits;
}

function walk(dir) {
    let files = [];
    if (!fs.existsSync(dir)) return files;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files = files.concat(walk(full));
        } else if (entry.isFile() && entry.name.endsWith(JS_EXT)) {
            files.push(full);
        }
    }
    return files;
}

const root        = process.cwd();
const allFiles    = SCAN_ROOTS.flatMap(r => walk(path.join(root, r)));
const violations  = allFiles.flatMap(f => scanFile(f));

if (violations.length === 0) {
    console.log('check-slot-index-leak: OK — no raw *_NS_SLOT integer declarations in JS layer');
    process.exit(0);
} else {
    console.error('check-slot-index-leak: FAIL — *_NS_SLOT integer constants found outside boot image layer:');
    for (const v of violations) {
        console.error(`  ${v.file}:${v.line}: ${v.text}`);
    }
    console.error('');
    console.error('Move slot integer declarations to hardware/hw_types.py (the single source of truth).');
    console.error('Runtime JS code must use sim._slotByPetName(name[, fallback]) or sim.nsLabels.');
    process.exit(1);
}
