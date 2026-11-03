#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const run = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'styles-fault.css'), 'utf8');
const m = run.slice(run.indexOf('function showFaultModal(f)'), run.indexOf('function _autoGrowFaultNote(input)'));
assert.match(m, /class="fault-diag-hero"/, 'diagnosis rendered first');
assert.ok(m.indexOf('fault-diag-hero">') < m.indexOf('class="fault-tabs"'), 'diagnosis precedes tabs');
for (const t of ['diag', 'trace', 'regs', 'evidence', 'note']) assert.ok(m.includes(`_tab('${t}'`), 'tab ' + t);
assert.match(m, /f\.programmerDiagnosis/);
assert.match(m, /overlay\._faultRecord = f/);
assert.match(m, /_wukongUseGoldenFaultReference\(\)/);
assert.match(m, /_isHw && !f\._diagnosticLoaded && typeof _wukongEnrichFaultReport === 'function'/);
assert.ok(!/#\$\{f\.step\}/.test(m.split('_traceFaultDetailsHtml =')[0] + '') || m.includes("Number.isInteger(f.step)"), 'missing step guarded');
const hwActions = m.slice(m.indexOf('const _actions = _isHw ?'), m.indexOf('` : `', m.indexOf('const _actions = _isHw ?')));
assert.ok(!/faultModalReboot|faultModalInvestigate|faultModalOpenEditor|faultModalOpenBinaryLump/.test(hwActions), 'hardware actions never reset or navigate the simulator');
assert.match(hwActions, /faultModalOpenLumpSummary/, 'hardware retains exact-build investigation');
assert.match(m, /_isHw && typeof _wukongFaultDiagnosis === 'function' \? _wukongFaultDiagnosis\(f\)/,
    'hardware gets the improved diagnosis immediately, before network enrichment');
assert.match(m, /Number\.isInteger\(f\.step\) && f\.step >= 0/);
assert.match(m, /Unavailable — no simulator step was captured/);
assert.ok(!/&#x1F/.test(m), 'no emoji entities');
assert.match(run, /function _faultPaginateActive\(dialog\)/);
assert.match(css, /\.fault-pane-body\s*\{[^}]*overflow:\s*hidden/);
assert.match(css, /\.fault-pane-overflow \.fault-pane-body\s*\{\s*overflow:\s*auto/, 'oversized unit stays reachable');
console.log('PASS compact fault modal: diagnosis-first tabs, pagination, hardware-safe actions');
