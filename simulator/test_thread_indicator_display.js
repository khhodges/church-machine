#!/usr/bin/env node
/*
 * Regression guard for the compact indicator state shown in the Thread cards.
 */
const fs = require('fs');
const sim = fs.readFileSync('simulator/simulator.js', 'utf8');
const run = fs.readFileSync('simulator/app-run.js', 'utf8');
const css = fs.readFileSync('simulator/styles-toolbar.css', 'utf8');

function check(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${message}`);
  }
}

check(
  /indicatorFlags: active[\s\S]{0,180}savedIndicator\.flags/.test(sim),
  'Thread status rows expose live or saved indicator flags'
);
check(
  /thread-identity-flags[\s\S]{0,500}flagsCode\.textContent = flagText/.test(run),
  'Thread cards render the current indicator flags'
);
check(
  /\.thread-identity-flags\s*\{/.test(css),
  'indicator flags have a dedicated compact card style'
);

if (process.exitCode) process.exit(process.exitCode);