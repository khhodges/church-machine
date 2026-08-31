#!/usr/bin/env node
/*
 * Regression guard for the live CR14 code view.
 *
 * Run/Walk publish simulator state through stateChange. The dashboard listener
 * must refresh an open CR detail table, and the live NIA row must take priority
 * over an old gate-click highlight when choosing the scroll target.
 */
const fs = require('fs');
const shell = fs.readFileSync('simulator/app-shell.js', 'utf8');
const memory = fs.readFileSync('simulator/app-memory.js', 'utf8');

function check(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS: ${message}`);
}

check(
  /sim\.on\('stateChange', \(\) => \{ updateDashboard\(\)/.test(shell) &&
  /function updateDashboard\(\)[\s\S]{0,300}if \(selectedCR !== null\) updateCRDetail\(\)/.test(
    fs.readFileSync('simulator/app-tools.js', 'utf8')
  ),
  'stateChange refreshes the open dashboard CR detail through updateDashboard'
);
check(
  /const _liveNIA = Number\.isInteger\(sim\.physicalPC\)/.test(memory) &&
  /_liveNIA !== null[\s\S]{0,180}addr === _liveNIA/.test(memory),
  'CR code highlighting follows physical NIA'
);
check(
  /const liveTarget = contentEl\.querySelector\('\.code-pc-row'\)[\s\S]{0,220}code-gate-row/.test(memory),
  'live PC row takes scroll priority over stale gate highlight'
);
check(
  /behavior: liveTarget \? 'auto' : 'smooth'/.test(memory),
  'Run-mode NIA tracking is not stalled by overlapping smooth-scroll animations'
);

if (process.exitCode) process.exit(process.exitCode);