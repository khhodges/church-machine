#!/usr/bin/env node
// scripts/test_ide_intro_base_path.js
//
// Regression guard for the IDE Introduction SPA base-path and crawlability
// configuration.  All primary checks are source-level so the suite runs in CI
// without a prior build step.  If the built dist/public/index.html is already
// present (e.g. after a production build), additional dist-level checks run.
//
// Source-level checks (always run):
//   1. ARTIFACT_TOML — artifact.toml production build command references
//                      "build:production" (not plain "build").
//   2. PKG_SCRIPT    — package.json "build:production" script contains
//                      BASE_PATH=/ide-intro/.
//   3. SRC_CANONICAL — source index.html has a <link rel="canonical"> pointing
//                      to https://lab.cloomc.org/ide-intro/.
//   4. SRC_FAVICON   — source index.html favicon href is root-absolute (/favicon.svg)
//                      so Vite rewrites it to /ide-intro/favicon.svg at build time.
//   5. SITEMAP       — server/app.py sitemap_xml() includes /ide-intro/.
//
// Dist-level checks (run only when dist/public/index.html exists):
//   6. DIST_ASSETS   — built index.html asset references are prefixed /ide-intro/.
//   7. DIST_FAVICON  — built index.html favicon href is /ide-intro/favicon.svg
//                      (absolute, resolves correctly from nested SPA routes).
//   8. DIST_CANONICAL— built index.html <link rel="canonical"> points to
//                      https://lab.cloomc.org/ide-intro/.
//
// Exit codes:
//   0 — all applicable checks pass
//   1 — one or more checks failed

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT        = path.resolve(__dirname, '..');
const ARTIFACT    = path.join(ROOT, 'artifacts/church-machine-ide-introduction');
const TOML_PATH   = path.join(ARTIFACT, '.replit-artifact/artifact.toml');
const PKG_PATH    = path.join(ARTIFACT, 'package.json');
const SRC_HTML    = path.join(ARTIFACT, 'index.html');
const DIST_HTML   = path.join(ARTIFACT, 'dist/public/index.html');
const APP_PY      = path.join(ROOT, 'server/app.py');

let failures = 0;

function fail(msg) { console.error(`FAIL: ${msg}`); failures++; }
function pass(msg) { console.log(`ok:   ${msg}`); }
function skip(msg) { console.log(`skip: ${msg}`); }

// ── Check 1: artifact.toml uses build:production ──────────────────────────────
const toml = fs.readFileSync(TOML_PATH, 'utf8');
if (!toml.includes('build:production')) {
  fail('artifact.toml production build command does not reference "build:production" — BASE_PATH will default to "/" and assets will be root-absolute');
} else {
  pass('artifact.toml production build uses build:production');
}

// ── Check 2: package.json build:production sets BASE_PATH=/ide-intro/ ─────────
const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
const prodScript = pkg.scripts && pkg.scripts['build:production'];
if (!prodScript) {
  fail('package.json has no "build:production" script');
} else if (!prodScript.includes('BASE_PATH=/ide-intro/')) {
  fail(`package.json "build:production" does not set BASE_PATH=/ide-intro/: "${prodScript}"`);
} else {
  pass('package.json build:production sets BASE_PATH=/ide-intro/');
}

// ── Check 3: source index.html has canonical to /ide-intro/ ──────────────────
const srcHtml = fs.readFileSync(SRC_HTML, 'utf8');
const srcCanon = srcHtml.match(/<link\s[^>]*rel="canonical"[^>]*href="([^"]+)"/);
if (!srcCanon) {
  fail('source index.html missing <link rel="canonical">');
} else if (!srcCanon[1].startsWith('https://lab.cloomc.org/ide-intro')) {
  fail(`source index.html canonical "${srcCanon[1]}" does not point to https://lab.cloomc.org/ide-intro/`);
} else {
  pass(`source index.html canonical "${srcCanon[1]}" is correct`);
}

// ── Check 4: source index.html favicon is root-absolute (/favicon.svg) ────────
// Vite rewrites /favicon.svg → /ide-intro/favicon.svg at build time.
// A bare relative "favicon.svg" stays relative in the built output and
// resolves to the wrong path from nested SPA routes like /ide-intro/handout.
const srcFavicon = srcHtml.match(/<link\s[^>]*rel="icon"[^>]*href="([^"]+)"/);
if (!srcFavicon) {
  fail('source index.html missing <link rel="icon">');
} else if (srcFavicon[1] !== '/favicon.svg') {
  fail(`source index.html favicon href "${srcFavicon[1]}" must be "/favicon.svg" (root-absolute) so Vite rewrites it to /ide-intro/favicon.svg`);
} else {
  pass('source index.html favicon href is root-absolute /favicon.svg (Vite will rewrite to /ide-intro/favicon.svg)');
}

// ── Check 5: server/app.py sitemap includes /ide-intro/ ───────────────────────
const appPy = fs.readFileSync(APP_PY, 'utf8');
if (!appPy.includes('/ide-intro/')) {
  fail('server/app.py sitemap_xml() does not include /ide-intro/');
} else {
  pass('server/app.py sitemap includes /ide-intro/');
}

// ── Dist-level checks (optional — only if dist/public/index.html present) ─────
if (!fs.existsSync(DIST_HTML)) {
  skip('dist/public/index.html not present — skipping built-output checks');
  skip('  run: pnpm --filter @workspace/church-machine-ide-introduction run build:production');
} else {
  const distHtml = fs.readFileSync(DIST_HTML, 'utf8');

  // Check 6: asset paths prefixed /ide-intro/
  const scriptSrcs = [...distHtml.matchAll(/<script[^>]+\bsrc="([^"]+)"/g)].map(m => m[1]);
  const linkHrefs  = [...distHtml.matchAll(/<link[^>]+\bhref="([^"]+)"/g)].map(m => m[1]);
  const assetRefs  = [...scriptSrcs, ...linkHrefs].filter(h =>
    h.startsWith('/') && (h.includes('/assets/') || h.endsWith('.js') || h.endsWith('.css'))
  );
  const badAssets = assetRefs.filter(h => !h.startsWith('/ide-intro/'));
  if (badAssets.length > 0) {
    fail(`built asset references without /ide-intro/ prefix: ${badAssets.join(', ')}`);
    fail('  rebuild with: pnpm --filter @workspace/church-machine-ide-introduction run build:production');
  } else if (assetRefs.length === 0) {
    fail('no asset <script src> or <link href> found in built index.html');
  } else {
    pass(`all ${assetRefs.length} built asset reference(s) prefixed /ide-intro/`);
  }

  // Check 7: built favicon is /ide-intro/favicon.svg (absolute, not relative)
  const distFavicon = distHtml.match(/<link\s[^>]*rel="icon"[^>]*href="([^"]+)"/);
  if (!distFavicon) {
    fail('built index.html missing <link rel="icon">');
  } else if (distFavicon[1] !== '/ide-intro/favicon.svg') {
    fail(`built favicon href "${distFavicon[1]}" — expected "/ide-intro/favicon.svg" (absolute; resolves correctly from nested SPA routes)`);
  } else {
    pass('built favicon href is /ide-intro/favicon.svg (resolves from any SPA route)');
  }

  // Check 8: built canonical points to /ide-intro/
  const distCanon = distHtml.match(/<link\s[^>]*rel="canonical"[^>]*href="([^"]+)"/);
  if (!distCanon) {
    fail('built index.html missing <link rel="canonical">');
  } else if (!distCanon[1].startsWith('https://lab.cloomc.org/ide-intro')) {
    fail(`built canonical "${distCanon[1]}" does not point to https://lab.cloomc.org/ide-intro/`);
  } else {
    pass(`built canonical "${distCanon[1]}" is correct`);
  }
}

// ── Summary ────────────────────────────────────────────────────────────────────
if (failures > 0) {
  console.error(`\ntest_ide_intro_base_path: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\ntest_ide_intro_base_path: all checks passed');
