#!/usr/bin/env node
'use strict';

const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync('simulator/index.html', 'utf8');
const memory = fs.readFileSync('simulator/app-memory.js', 'utf8');
const tools = fs.readFileSync('simulator/app-tools.js', 'utf8');
const css = fs.readFileSync('simulator/styles-toolbar.css', 'utf8');

assert.match(html, /id="hw-led1"[^>]+role="img"[^>]+aria-label="Fault lamp off"/,
    'the red Fault lamp has an accessible initial state');
assert(memory.includes('Execution is halted; inspect the fault log or reset to continue.'),
    'halted status includes a one-sentence explanation');
assert(tools.includes('sim.faultLatch || sim.halted'),
    'a simulator fault or halt illuminates the red Fault lamp');
assert(tools.includes('hwConnected ? hwFaulted : (sim.faultLatch || sim.halted)'),
    'live hardware ignores stale simulator halt state');
assert(tools.includes("'Fault lamp on: execution is halted'"),
    'Fault lamp state is announced to assistive technology');
assert.match(css, /\.flag-status-explanation\s*\{/,
    'the explanation has a dedicated readable style');

console.log('PASS: red Fault lamp and halted explanation contracts');