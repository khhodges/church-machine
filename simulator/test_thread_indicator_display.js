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
  sim.includes('const nextPhysicalAddr = active ? this._nextPhysicalAddr() : -1;') &&
  sim.includes('physicalAddress: active && nextPhysicalAddr >= 0'),
  'physical instruction address is derived only for the active Thread'
);
check(
  /thread-identity-flags[\s\S]{0,500}flagsCode\.textContent = flagText/.test(run),
  'Thread cards render the current indicator flags'
);
check(
  /LUMP-relative NIA/.test(run) &&
  /Physical address/.test(run) &&
  /Executing code/.test(run) &&
  /Thread context/.test(run),
  'Thread cards distinguish context, executing code, and address spaces'
);
check(
  /Current FLAGS/.test(run) &&
  /Saved FLAGS/.test(run) &&
  /SWITCH does not write FLAGS/.test(run),
  'Thread cards identify live and retained FLAGS without attributing them to SWITCH'
);
check(
  /\.thread-identity-flags\s*\{/.test(css),
  'indicator flags have a dedicated compact card style'
);

if (process.exitCode) process.exit(process.exitCode);