#!/usr/bin/env node
/*
 * Keep the shared hamburger menu aligned with landing.html's eight cards.
 * This is intentionally a source-level invariant: it catches an orphaned view
 * or standalone route before a browser test has to discover it.
 */
const fs = require('fs');

const menu = fs.readFileSync('simulator/index.html', 'utf8');
const landing = fs.readFileSync('landing.html', 'utf8');

const categories = ['Home', 'Code', 'Builder', 'Tutorial', 'Namespace',
  'Simulator', 'Abstractions', 'Architecture', 'Docs'];
const categoryMatches = categories.filter(name =>
  menu.includes(`ham-category">${name}</div>`));
if (categoryMatches.length !== categories.length) {
  throw new Error(`navigation categories missing: ${categories.filter(x => !categoryMatches.includes(x)).join(', ')}`);
}
if ((menu.match(/ham-category">/g) || []).length !== 9) {
  throw new Error('hamburger must have exactly the eight landing-card categories');
}

const landingCards = [...landing.matchAll(/data-card-id="([^"]+)"/g)].map(m => m[1]);
const expectedCardIds = ['code', 'builder', 'tutorial', 'namespace', 'dashboard',
  'abstractions', 'reference', 'docs'];
if (landingCards.join(',') !== expectedCardIds.join(',')) {
  throw new Error('landing card inventory changed; update this check with the approved taxonomy');
}

const viewIds = ['home', 'repl', 'editor', 'start', 'tutorial', 'dashboard',
  'namespace', 'hello-mum', 'abstractions', 'lumps', 'pipeline', 'trace',
  'reference', 'docs', 'builder', 'sitemap', 'gc', 'devices', 'github',
  'memory', 'gt-view'];
for (const view of viewIds) {
  const count = (menu.match(new RegExp(`id="hamItem-${view}"`, 'g')) || []).length;
  if (count !== 1) throw new Error(`view ${view} must have exactly one hamburger destination (found ${count})`);
}

for (const href of ['/', '/ctmm/', '/simulator/', '/docs/figures/Lumps Directory.html',
  '/six-laws/', '/patents/', '/docs/patent-unified.html',
  '/business/plan.html', '/business/deck.html']) {
  if (!menu.includes(`href="${href}"`)) throw new Error(`standalone route missing from menu: ${href}`);
}

console.log(`landing navigation OK: ${categories.length - 1} categories, ${viewIds.length} views, standalone routes covered`);