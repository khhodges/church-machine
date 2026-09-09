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
  /indicatorFlags: active[\s\S]{0,180}savedFrame\.flags/.test(sim),
  'Thread status rows expose live or saved indicator flags'
);
check(
  sim.includes('const bindingMatches = parsedGT && codeEntry && codeHeader') &&
  sim.includes('resolvedPhysicalAddress'),
  'physical instruction address requires a validated canonical code binding'
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
check(
  run.includes('openThreadContextModal(row.slot, card)') &&
  run.includes("aria-haspopup', 'dialog'"),
  'Thread rows open an accessible control modal instead of switching immediately'
);
check(
  /id="activeThreadStatus"[\s\S]{0,300}aria-haspopup="dialog"/.test(
    fs.readFileSync('simulator/index.html', 'utf8')) &&
  run.includes('openActiveThreadContextModal'),
  'the always-visible active Thread status also opens the same controls'
);
check(
  run.includes('sim.resetThreadToBaseline(row.slot)') &&
  run.includes('sim.selectConfiguredThread(requestedSlot)'),
  'modal Reset and dormant Run use simulator-owned baseline and canonical CHANGE'
);
check(
  run.includes('!_pendingSimLoad && !executing && !bootAnimating') &&
  !run.includes('Boot the machine before running a specific Thread') &&
  run.includes('if (!sim.bootComplete && !instantBoot())') &&
  run.includes('Run or clear the pending compiled program before resuming a Thread') &&
  run.includes('if (!row || _pendingSimLoad'),
  'Thread-specific Run boots on demand but stays disabled for pending compile or active execution'
);
check(
  sim.includes('this.memory.set(previousWords, baseline.base)') &&
  sim.includes('faultLogLength: this.faultLog.length') &&
  sim.includes('if (this._suppressFaultEffects) return'),
  'active Thread Reset rolls back without publishing transient CHANGE faults'
);
check(
  run.includes('_latestThreadFault(row.slot)') &&
  sim.includes('threadSlot: this._liveThreadOwned') &&
  run.includes('lastFault.step === sim.stepCount'),
  'fault details remain attributed to the owning Thread and current halt'
);
check(
  run.includes('document.querySelector(`[data-thread-slot="${originSlot}"]`)'),
  'modal focus returns to a rebuilt originating Thread row'
);

if (process.exitCode) process.exit(process.exitCode);