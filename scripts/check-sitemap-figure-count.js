#!/usr/bin/env node
// scripts/check-sitemap-figure-count.js
//
// Verifies two things about the "Technical Figures" section of
// simulator/index.html:
//
//   1. COUNT — The "(N)" span on the "Technical Figures" heading matches the
//              actual number of .html files in docs/figures/.
//
//   2. LINKS — Every .html file in docs/figures/ has at least one matching
//              <a href="/docs/figures/FILENAME"> anywhere in
//              simulator/index.html (extra links in the sitemap that point to
//              non-existent files are also reported).
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
// To fix a missing link, add an <a href="/docs/figures/FILENAME"> anywhere in
// simulator/index.html (the sitemap "Technical Figures" list is the canonical
// place).
//
// Exit codes:
//   0 — both checks pass
//   1 — count is stale, the span cannot be found, or the link sets diverge

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT        = path.resolve(__dirname, '..');
const FIGURES_DIR = path.join(ROOT, 'docs', 'figures');
const SITEMAP     = path.join(ROOT, 'simulator', 'index.html');

// ── read actual .html files in docs/figures/ ──────────────────────────────

if (!fs.existsSync(FIGURES_DIR)) {
    console.error(`check-sitemap-figure-count: docs/figures/ directory not found at ${FIGURES_DIR}`);
    process.exit(1);
}

const actualFiles = fs.readdirSync(FIGURES_DIR)
    .filter(f => f.endsWith('.html'))
    .sort();

const actualCount = actualFiles.length;

// ── read sitemap ──────────────────────────────────────────────────────────

if (!fs.existsSync(SITEMAP)) {
    console.error(`check-sitemap-figure-count: sitemap not found at ${SITEMAP}`);
    process.exit(1);
}

const html = fs.readFileSync(SITEMAP, 'utf8');

// ── CHECK 1: count ────────────────────────────────────────────────────────

// Match the "(N)" span that immediately follows "Technical Figures".
const countMatch = html.match(/Technical Figures\s*<span[^>]*>\((\d+)\)<\/span>/);
if (!countMatch) {
    console.error('check-sitemap-figure-count: FAIL');
    console.error('  Could not find the "Technical Figures (N)" count span in simulator/index.html.');
    console.error('  Expected pattern: Technical Figures <span ...>(N)</span>');
    process.exit(1);
}

const hardcoded = parseInt(countMatch[1], 10);
let failed = false;

if (hardcoded !== actualCount) {
    console.error('check-sitemap-figure-count: FAIL — count mismatch');
    console.error(`  Sitemap says: (${hardcoded})`);
    console.error(`  docs/figures/ has: ${actualCount} .html files`);
    console.error('');
    console.error(`  Fix: update the "(${hardcoded})" span on the "Technical Figures" heading`);
    console.error(`  in simulator/index.html to "(${actualCount})".`);
    failed = true;
} else {
    console.log(`check-sitemap-figure-count: count ok — (${hardcoded}) matches ${actualCount} files`);
}

// ── CHECK 2: link set ─────────────────────────────────────────────────────

// Collect every /docs/figures/*.html href mentioned anywhere in the file.
// Using the filename as given in the href (URL-encoded spaces become %20, etc.).
const HREF_RE = /href="\/docs\/figures\/([^"]+\.html)"/g;
const linkedSet = new Set();
let m;
while ((m = HREF_RE.exec(html)) !== null) {
    // Decode percent-encoding in case any href uses encoded characters.
    try {
        linkedSet.add(decodeURIComponent(m[1]));
    } catch (_) {
        linkedSet.add(m[1]);
    }
}

const actualSet  = new Set(actualFiles);
const missing    = actualFiles.filter(f => !linkedSet.has(f)).sort();
const extra      = [...linkedSet].filter(f => !actualSet.has(f)).sort();

if (missing.length > 0) {
    if (!failed) console.error('check-sitemap-figure-count: FAIL — link set mismatch');
    console.error(`  ${missing.length} file(s) in docs/figures/ have no <a href="/docs/figures/..."> link in simulator/index.html:`);
    for (const f of missing) {
        console.error(`    missing link: ${f}`);
    }
    console.error('');
    console.error('  Fix: add an <a href="/docs/figures/FILENAME"> anywhere in simulator/index.html');
    console.error('  (the sitemap "Technical Figures" list is the canonical place).');
    failed = true;
} else {
    console.log(`check-sitemap-figure-count: links ok — all ${actualCount} docs/figures/ files are linked`);
}

if (extra.length > 0) {
    if (!failed) console.error('check-sitemap-figure-count: FAIL — link set mismatch');
    console.error(`  ${extra.length} href(s) in simulator/index.html point to non-existent docs/figures/ files:`);
    for (const f of extra) {
        console.error(`    extra link: ${f}`);
    }
    failed = true;
}

process.exit(failed ? 1 : 0);
