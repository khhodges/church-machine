#!/usr/bin/env node
// scripts/check-sitemap-figure-count.js
//
// Verifies four things about the "Technical Figures" section of
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
//   4. TITLES — Each entry in the "Technical Figures" list uses link text that
//               exactly matches the <title> of the linked HTML file.  If a
//               file's title is updated but the sitemap label is not, this
//               check flags the mismatch with a clear diff.
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
// To fix a stale title, update the link text in the "Technical Figures" list
// in simulator/index.html to match the <title> of the linked HTML file.
//
// Exit codes:
//   0 — all checks pass
//   1 — count is stale, the span cannot be found, the link sets diverge,
//       duplicate labels are found, or any sitemap label mismatches its
//       file's <title>

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

// ── CHECK 4: Technical Figures section is complete and labels match <title> ──
//
// Every file in docs/figures/ must appear in the "Technical Figures" list
// section of simulator/index.html exactly once, and its visible link text must
// exactly match the file's own <title> element (after HTML-entity decoding on
// both sides).
//
// Three sub-failures are reported independently:
//   a) A docs/figures/ file is absent from the Technical Figures section.
//   b) A file appears more than once in the section.
//   c) A section entry's label differs from the file's <title>.
//
// Only the "Technical Figures" list section of simulator/index.html is
// examined, not other places in the page that also happen to link to the same
// files (hamburger nav, inline chips, etc.).

// Locate the Technical Figures heading using the same count-span pattern as
// CHECK 1 so we land on the correct occurrence even when other links in the
// page also contain the text "Technical Figures".
const tfHeadingMatch = html.match(/Technical Figures\s*<span[^>]*>\(\d+\)<\/span>/);
const tfHeadingIdx = tfHeadingMatch ? html.indexOf(tfHeadingMatch[0]) : -1;
if (tfHeadingIdx === -1) {
    // The count check above already handles a missing heading; skip this check.
    console.error('check-sitemap-figure-count: SKIP title check — Technical Figures heading not found');
} else {
    // Slice from the heading to end-of-file, then trim at the closing tags.
    // The list ends with the </div> that closes the flex column followed
    // immediately by the </div> that closes the outer wrapper.
    const afterHeading = html.slice(tfHeadingIdx);
    const sectionEndMatch = afterHeading.match(/\n[ \t]*<\/div>[ \t]*\n[ \t]*<\/div>/);
    const sectionHtml = sectionEndMatch
        ? afterHeading.slice(0, sectionEndMatch.index)
        : afterHeading;

    // Helper: decode the five common HTML entities.
    function decodeEntities(str) {
        return str
            .replace(/&amp;/g,  '&')
            .replace(/&lt;/g,   '<')
            .replace(/&gt;/g,   '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g,  "'")
            .trim();
    }

    // Collect every anchor in the section: filename (decoded) → [label, …]
    // We keep all labels for a filename so we can detect duplicates.
    const SECTION_ANCHOR_RE = /href="\/docs\/figures\/([^"]+\.html)"[^>]*>([^<]*)</g;
    // filename → [label, label, …]  (all occurrences within the section)
    const sectionEntries = new Map();
    let sm;
    while ((sm = SECTION_ANCHOR_RE.exec(sectionHtml)) !== null) {
        let filename;
        try { filename = decodeURIComponent(sm[1]); } catch (_) { filename = sm[1]; }
        const label = decodeEntities(sm[2]);
        if (!sectionEntries.has(filename)) sectionEntries.set(filename, []);
        sectionEntries.get(filename).push(label);
    }

    const sectionFileSet = new Set(sectionEntries.keys());

    // a) Files in docs/figures/ that are absent from the section.
    const missingFromSection = actualFiles.filter(f => !sectionFileSet.has(f)).sort();
    // b) Files that appear in the section but not in docs/figures/ (already
    //    caught by CHECK 2, but report here for completeness).
    const extraInSection = [...sectionFileSet].filter(f => !actualSet.has(f)).sort();
    // c) Files that appear more than once in the section.
    const duplicateInSection = [...sectionEntries.entries()]
        .filter(([, labels]) => labels.length > 1)
        .sort(([a], [b]) => a.localeCompare(b));
    // d) Label/title mismatches for section entries that exist on disk.
    const titleMismatches = [];
    for (const [filename, labels] of sectionEntries) {
        const figPath = path.join(FIGURES_DIR, filename);
        if (!fs.existsSync(figPath)) continue;  // caught by extraInSection above
        const figHtml = fs.readFileSync(figPath, 'utf8');
        const titleMatch = figHtml.match(/<title>([^<]*)<\/title>/i);
        const fileTitle = titleMatch ? decodeEntities(titleMatch[1]) : '(no <title> found)';
        // Check each label appearance individually.
        for (const label of labels) {
            if (label !== fileTitle) {
                titleMismatches.push({ filename, sitemapLabel: label, fileTitle });
            }
        }
    }

    const check4Failed = missingFromSection.length > 0 || extraInSection.length > 0
                      || duplicateInSection.length > 0 || titleMismatches.length > 0;

    if (check4Failed) {
        if (!failed) console.error('check-sitemap-figure-count: FAIL — Technical Figures section incomplete or labels stale');

        if (missingFromSection.length > 0) {
            console.error(`  ${missingFromSection.length} file(s) in docs/figures/ are absent from the Technical Figures list:`);
            for (const f of missingFromSection) {
                console.error(`    missing from section: ${f}`);
            }
            console.error('');
            console.error('  Fix: add an entry for each missing file to the "Technical Figures" list');
            console.error('  in simulator/index.html with link text matching the file\'s <title>.');
        }

        if (extraInSection.length > 0) {
            console.error(`  ${extraInSection.length} entry/entries in the Technical Figures list point to non-existent files:`);
            for (const f of extraInSection) {
                console.error(`    extra in section: ${f}`);
            }
        }

        if (duplicateInSection.length > 0) {
            console.error(`  ${duplicateInSection.length} file(s) appear more than once in the Technical Figures list:`);
            for (const [filename, labels] of duplicateInSection) {
                console.error(`    duplicate: ${filename} (${labels.length} entries: ${labels.map(l => `"${l}"`).join(', ')})`);
            }
        }

        if (titleMismatches.length > 0) {
            console.error(`  ${titleMismatches.length} sitemap label(s) differ from their file's <title>:`);
            for (const { filename, sitemapLabel, fileTitle } of titleMismatches) {
                console.error(`    file: ${filename}`);
                console.error(`      sitemap says: "${sitemapLabel}"`);
                console.error(`      file <title>: "${fileTitle}"`);
            }
            console.error('');
            console.error('  Fix: update the link text in the "Technical Figures" list');
            console.error('  in simulator/index.html to match each file\'s <title>,');
            console.error('  or update the file\'s <title> to match the sitemap label.');
        }

        failed = true;
    } else {
        console.log(`check-sitemap-figure-count: titles ok — all ${sectionEntries.size} Technical Figures section labels match their file's <title>`);
    }
}

process.exit(failed ? 1 : 0);
