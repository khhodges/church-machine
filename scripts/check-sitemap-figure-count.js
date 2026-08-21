#!/usr/bin/env node
// scripts/check-sitemap-figure-count.js
//
// Verifies that the figure count shown in the sitemap section of
// simulator/index.html matches the actual number of .html files
// in docs/figures/.
//
// Run via:
//   node scripts/check-sitemap-figure-count.js
//
// Also registered as the "check-sitemap-figure-count" suite in
// scripts/run-all-tests.sh and as a workflow in .replit.
//
// To fix a stale count, update the "(N)" span on the "Technical Figures"
// heading in simulator/index.html to reflect the real file count.
//
// Exit codes:
//   0 — count matches
//   1 — count is stale or the span cannot be found

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT        = path.resolve(__dirname, '..');
const FIGURES_DIR = path.join(ROOT, 'docs', 'figures');
const SITEMAP     = path.join(ROOT, 'simulator', 'index.html');

// ── count actual .html files in docs/figures/ ─────────────────────────────

if (!fs.existsSync(FIGURES_DIR)) {
    console.error(`check-sitemap-figure-count: docs/figures/ directory not found at ${FIGURES_DIR}`);
    process.exit(1);
}

const actualCount = fs.readdirSync(FIGURES_DIR)
    .filter(f => f.endsWith('.html'))
    .length;

// ── extract hardcoded count from the sitemap ──────────────────────────────

if (!fs.existsSync(SITEMAP)) {
    console.error(`check-sitemap-figure-count: sitemap not found at ${SITEMAP}`);
    process.exit(1);
}

const html = fs.readFileSync(SITEMAP, 'utf8');

// Match the "(N)" span that immediately follows "Technical Figures".
// The span has no id but is the only one adjacent to that heading text.
const match = html.match(/Technical Figures\s*<span[^>]*>\((\d+)\)<\/span>/);
if (!match) {
    console.error('check-sitemap-figure-count: FAIL');
    console.error('  Could not find the "Technical Figures (N)" count span in simulator/index.html.');
    console.error('  Expected pattern: Technical Figures <span ...>(N)</span>');
    process.exit(1);
}

const hardcoded = parseInt(match[1], 10);

// ── compare ───────────────────────────────────────────────────────────────

if (hardcoded === actualCount) {
    console.log(`check-sitemap-figure-count: ok — sitemap shows (${hardcoded}), docs/figures/ has ${actualCount} .html files`);
    process.exit(0);
} else {
    console.error('check-sitemap-figure-count: FAIL');
    console.error(`  Sitemap says: (${hardcoded})`);
    console.error(`  docs/figures/ has: ${actualCount} .html files`);
    console.error('');
    console.error(`  Fix: update the "(${hardcoded})" span on the "Technical Figures" heading`);
    console.error(`  in simulator/index.html to "(${actualCount})".`);
    process.exit(1);
}
