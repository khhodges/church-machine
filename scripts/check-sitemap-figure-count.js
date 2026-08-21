#!/usr/bin/env node
// scripts/check-sitemap-figure-count.js
//
// Verifies three things about the "Technical Figures" section of
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
//   3. LABELS — No two <a href="/docs/figures/..."> entries share the same
//               visible link text.  Identical labels are indistinguishable to
//               users and indicate a copy-paste mistake.
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
// To fix a duplicate label, give each entry a unique visible label (e.g. add
// a subtitle that distinguishes the two figures).
//
// Exit codes:
//   0 — all checks pass
//   1 — count is stale, the span cannot be found, the link sets diverge, or
//       duplicate labels are found

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

// ── CHECK 2: link set  /  CHECK 3: unique labels ──────────────────────────
//
// We match the full anchor element so we can capture both the href (for the
// link-set check) and the visible text (for the duplicate-label check).
// The regex is intentionally simple: the sitemap anchors are single-line
// elements whose href attribute always appears before the closing >.
//
// Percent-encoded filenames (e.g. "Lumps%20Directory.html") are decoded so
// they compare correctly against the actual filenames on disk.

const ANCHOR_RE = /href="(\/docs\/figures\/[^"]+\.html)"[^>]*>([^<]*)</g;
const linkedSet = new Set();
// label → [href, href, …]  (tracks every file that uses each visible text)
const labelMap  = new Map();
let m;

while ((m = ANCHOR_RE.exec(html)) !== null) {
    const rawHref = m[1].replace(/^\/docs\/figures\//, '');
    const rawText = m[2]
        .replace(/&amp;/g,  '&')
        .replace(/&lt;/g,   '<')
        .replace(/&gt;/g,   '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g,  "'")
        .trim();

    // Decode percent-encoding so "Lumps%20Directory.html" matches the real name.
    let decoded;
    try { decoded = decodeURIComponent(rawHref); } catch (_) { decoded = rawHref; }
    linkedSet.add(decoded);

    if (rawText) {
        if (!labelMap.has(rawText)) labelMap.set(rawText, []);
        labelMap.get(rawText).push('/docs/figures/' + rawHref);
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

// ── CHECK 3: unique labels ────────────────────────────────────────────────
//
// Every <a href="/docs/figures/..."> in the sitemap must have a distinct
// visible label.  Two entries with identical text are indistinguishable to
// users and indicate a copy-paste mistake (e.g. the "Self-Describing Stack
// Frames" duplicate that prompted this check).

const duplicateLabels = [...labelMap.entries()]
    .filter(([, hrefs]) => hrefs.length > 1)
    .sort(([a], [b]) => a.localeCompare(b));

if (duplicateLabels.length > 0) {
    if (!failed) console.error('check-sitemap-figure-count: FAIL — duplicate link labels');
    console.error(`  ${duplicateLabels.length} label(s) appear more than once in the sitemap:`);
    for (const [label, hrefs] of duplicateLabels) {
        console.error(`    duplicate label: "${label}"`);
        for (const href of hrefs) {
            console.error(`      used by: ${href}`);
        }
    }
    console.error('');
    console.error('  Fix: give each entry in the "Technical Figures" list a unique visible label');
    console.error('  in simulator/index.html (e.g. add a subtitle that distinguishes them).');
    failed = true;
} else {
    console.log(`check-sitemap-figure-count: labels ok — all ${labelMap.size} linked figure labels are unique`);
}

process.exit(failed ? 1 : 0);
