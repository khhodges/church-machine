#!/usr/bin/env node
/*
 * Regression guard for the compact header layout (brand-group and nav-cluster)
 */
const fs = require('fs');

function check(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${message}`);
  }
}

let html = fs.readFileSync('simulator/index.html', 'utf8');
let css = fs.readFileSync('simulator/styles-base.css', 'utf8');

check(
  /<div class="brand-group">\s*<h1/.test(html),
  'Header groups brand h1 into brand-group'
);
check(
  /<div class="nav-cluster view-buttons">/.test(html),
  'Header controls use the nav-cluster pattern for compact horizontal grouping'
);
check(
  /class="nav-cluster-btn cr-cycle-btn"/.test(html),
  'CR cycle button has been merged into the nav-cluster group'
);
check(
  /\.brand-group\s*\{\s*display:\s*flex;\s*flex-direction:\s*column;/.test(css),
  'Brand group forces vertical stacking of text'
);
check(
  /\.nav-cluster\s*\{\s*display:\s*flex;/.test(css),
  'Nav cluster enforces horizontal grouping'
);

if (process.exitCode) process.exit(process.exitCode);