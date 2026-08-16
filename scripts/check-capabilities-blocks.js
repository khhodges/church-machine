#!/usr/bin/env node
// scripts/check-capabilities-blocks.js
//
// Scans every .cloomc file in one or more directories (searched recursively).
// For any file that uses dot-notation operands (named LOAD, CALL Name.method,
// or ELOADCALL CRd, Name, method), the script verifies:
//
//   1. A  capabilities { }  block is present in the file.
//   2. Every referenced abstract name has an explicit permission entry
//      inside that block (e.g.  "Scheduler E"  or  "LED RW").
//
// What counts as a dot-notation reference:
//   CALL  Name.method          — Church-domain method call by name
//   ELOADCALL  CRd, Name, method — fused load+TPERM+call
//   LOAD  CRn, Name            — named namespace load (plain identifier,
//                                no dot, not a CR register)
//
// Names that contain a dot in the LOAD operand position (e.g. Boot.Nucs,
// Boot.Abstr) are pre-qualified boot-level references and are exempt.
//
// Usage:
//   node scripts/check-capabilities-blocks.js                        # scan simulator/examples (default)
//   node scripts/check-capabilities-blocks.js dir1 dir2 ...          # scan specific directories
//   node scripts/check-capabilities-blocks.js --glob '**/*.cloomc'   # scan whole repo tree
//   node scripts/check-capabilities-blocks.js --help                 # show this message
//
// Exclusions:
//   Paths matching any pattern in .capabilitiesignore (repo root) are skipped.
//   Each line is a glob pattern matched against the path relative to the repo root.
//   Blank lines and lines starting with # are ignored.
//
// Exit codes:
//   0  — all files pass
//   1  — one or more violations found (details printed to stdout)

'use strict';

const fs             = require('fs');
const path           = require('path');
const { spawnSync }  = require('child_process');

if (process.argv.includes('--help')) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n')
        .filter(l => l.startsWith('//'))
        .map(l => l.slice(3))
        .join('\n'));
    process.exit(0);
}

const ROOT = path.resolve(__dirname, '..');

// ── glob / ignore helpers ─────────────────────────────────────────────────────

// Convert a glob pattern (supporting * and **) to a RegExp.
// The pattern is matched against a forward-slash path relative to repo root.
function globToRegex(pattern) {
    const norm = pattern.split(path.sep).join('/').trim();
    let re = '';
    let i  = 0;
    while (i < norm.length) {
        if (norm[i] === '*' && norm[i + 1] === '*') {
            // **/ matches zero or more path segments
            if (norm[i + 2] === '/') {
                re += '(?:.+/)?';
                i += 3;
            } else {
                re += '.*';
                i += 2;
            }
        } else if (norm[i] === '*') {
            re += '[^/]*';
            i++;
        } else if (norm[i] === '?') {
            re += '[^/]';
            i++;
        } else {
            // Escape regex special chars
            re += norm[i].replace(/[.+^${}()|[\]\\]/g, '\\$&');
            i++;
        }
    }
    return new RegExp('^' + re + '$');
}

// Load ignore patterns from .capabilitiesignore at repo root.
function loadIgnorePatterns() {
    const ignorePath = path.join(ROOT, '.capabilitiesignore');
    if (!fs.existsSync(ignorePath)) return [];
    return fs.readFileSync(ignorePath, 'utf8')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'))
        .map(globToRegex);
}

// Return true if the relative path (forward-slash) matches any ignore pattern.
function isIgnored(relpath, ignorePatterns) {
    const fwd = relpath.split(path.sep).join('/');
    return ignorePatterns.some(rx => rx.test(fwd));
}

// ── file collection ───────────────────────────────────────────────────────────

// Recursively collect all .cloomc files under a directory.
function collectCloomcFiles(dir) {
    const results = [];
    if (!fs.existsSync(dir)) return results;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...collectCloomcFiles(full));
        } else if (entry.isFile() && entry.name.endsWith('.cloomc')) {
            results.push(full);
        }
    }
    return results;
}

// ── argument parsing ──────────────────────────────────────────────────────────

const argv = process.argv.slice(2);

// Extract --glob <pattern> if present.
let globPattern = null;
const globIdx = argv.indexOf('--glob');
if (globIdx !== -1) {
    if (globIdx + 1 >= argv.length) {
        console.error('check-capabilities-blocks: --glob requires a pattern argument');
        process.exit(1);
    }
    globPattern = argv[globIdx + 1];
}

// Positional (non-flag) arguments are explicit directory paths.
const argDirs = argv.filter((a, i) => {
    if (a.startsWith('-')) return false;
    if (i > 0 && argv[i - 1] === '--glob') return false;
    return true;
});

// ── resolve scan set ──────────────────────────────────────────────────────────

const ignorePatterns = loadIgnorePatterns();

let allFiles;

if (globPattern !== null) {
    // Glob mode: collect every .cloomc in the whole repo, then filter by pattern.
    const globRx = globToRegex(globPattern);
    const repoFiles = collectCloomcFiles(ROOT);
    allFiles = repoFiles.filter(f => {
        const rel = path.relative(ROOT, f).split(path.sep).join('/');
        return globRx.test(rel);
    });
} else {
    // Directory mode: scan specific (or default) directories.
    const scanDirs = argDirs.length > 0
        ? argDirs.map(d => path.resolve(ROOT, d))
        : [path.join(ROOT, 'simulator', 'examples')];

    allFiles = [];
    for (const dir of scanDirs) {
        allFiles.push(...collectCloomcFiles(dir));
    }
}

// Apply ignore patterns and deduplicate, then sort for stable output.
const files = [...new Set(
    allFiles
        .filter(f => !isIgnored(path.relative(ROOT, f), ignorePatterns))
        .sort()
)];

// ── analysis helpers ──────────────────────────────────────────────────────────

// Strip trailing inline comments and trim whitespace from a source line.
function stripComment(line) {
    return line.replace(/;.*$/, '').trim();
}

// Return the capabilities map parsed from a file's source, or null if the
// file contains no capabilities { } block.
//
// The map keys are abstract names; the values are permission strings
// (e.g. "E", "RW", "RX").  Trailing commas on entries are accepted.
function parseCapabilities(src) {
    const blockMatch = src.match(/capabilities\s*\{([^}]*)\}/);
    if (!blockMatch) return null;

    const map = new Map();
    for (const raw of blockMatch[1].split('\n')) {
        const line = raw.replace(/;.*$/, '').trim().replace(/,$/, '');
        if (!line) continue;
        const parts = line.split(/\s+/);
        if (parts.length >= 2 && /^[A-Za-z_][A-Za-z0-9_.]*$/.test(parts[0])
                               && /^[ERWXLSB]+$/.test(parts[1])) {
            map.set(parts[0], parts[1]);
        }
    }
    return map;
}

// Return the set of abstract names referenced by dot-notation operands in src.
// Names that are boot-level qualified references (containing a dot in the LOAD
// operand) are excluded; only plain identifiers are returned.
function extractReferencedNames(src) {
    const names = new Set();

    for (const raw of src.split('\n')) {
        const code = stripComment(raw);
        if (!code) continue;

        // CALL Name.method  — dot-notation dispatch
        const callDot = code.match(/^CALL\s+([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/);
        if (callDot) {
            names.add(callDot[1]);
            continue;
        }

        // ELOADCALL CRd, Name, method  — fused load+TPERM+call
        const eload = code.match(/^ELOADCALL\s+CR\d+\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\s*,/);
        if (eload) {
            names.add(eload[1]);
            continue;
        }

        // LOAD CRn, Name  — named namespace load (exactly two operands).
        // Excluded patterns:
        //   LOAD CR0, CR6, 4   — raw three-operand slot reference (second tok is CR-reg)
        //   LOAD CR1, Boot.Nucs — boot-level dotted name (contains '.')
        const loadNamed = code.match(/^LOAD\s+CR\d+\s*,\s*([A-Za-z_][A-Za-z0-9_.]*)\s*(?:,|$)/);
        if (loadNamed) {
            const name = loadNamed[1];
            if (/^CR\d+$/.test(name)) continue;  // raw CR-register operand
            if (name.includes('.'))   continue;   // dotted boot-level reference
            names.add(name);
        }
    }

    return names;
}

// ── main ──────────────────────────────────────────────────────────────────────

let violations = 0;

for (const filepath of files) {
    const relpath = path.relative(ROOT, filepath);
    const src     = fs.readFileSync(filepath, 'utf8');

    const referenced = extractReferencedNames(src);
    if (referenced.size === 0) {
        console.log(`  ok   (no dot-notation)  ${relpath}`);
        continue;
    }

    const caps = parseCapabilities(src);

    const missing = [];
    for (const name of referenced) {
        if (!caps || !caps.has(name)) {
            missing.push(name);
        }
    }

    if (missing.length === 0) {
        console.log(`  ok   ${relpath}`);
    } else {
        console.error(`  FAIL ${relpath}`);
        if (!caps) {
            console.error(`       missing capabilities block entirely`);
            console.error(`       referenced names: ${[...referenced].join(', ')}`);
        } else {
            console.error(`       missing entries in capabilities block: ${missing.join(', ')}`);
        }
        violations++;
    }
}

console.log('');
if (violations > 0) {
    console.error(`check-capabilities-blocks: ${violations} violation(s) found.`);
    console.error('');
    console.error('Every .cloomc file that uses named LOAD, CALL Name.method,');
    console.error('or ELOADCALL must declare a  capabilities { }  block listing');
    console.error('each referenced abstract name with its permission letters.');
    console.error('');
    console.error('Example:');
    console.error('  capabilities {');
    console.error('      Scheduler E');
    console.error('      LED RW');
    console.error('  }');
    process.exit(1);
} else {
    console.log(`check-capabilities-blocks: all ${files.length} file(s) pass.`);
}

// ── sidecar source guard ──────────────────────────────────────────────────────
// Ensure every sidecar whose abstraction has a canonical .cloomc source file
// carries a non-empty "source" field (catches silent blanking on recompile).
const sidecarResult = spawnSync(
    'node',
    [path.join(ROOT, 'scripts', 'check-sidecar-source.js')],
    { encoding: 'utf8', cwd: ROOT }
);
if (sidecarResult.stdout) process.stdout.write(sidecarResult.stdout);
if (sidecarResult.stderr) process.stderr.write(sidecarResult.stderr);
if (sidecarResult.status !== 0) {
    process.exit(sidecarResult.status || 1);
}

// ── audit_clist guard ─────────────────────────────────────────────────────────
// Ensure every empty c-list slot in every lump binary has a registered name.
const auditResult = spawnSync(
    'python',
    [path.join(ROOT, 'scripts', 'audit_clist.py'), '--check'],
    { encoding: 'utf8', cwd: ROOT }
);
if (auditResult.stdout) process.stdout.write(auditResult.stdout);
if (auditResult.stderr) process.stderr.write(auditResult.stderr);
if (auditResult.status !== 0) {
    process.exit(auditResult.status || 1);
}
