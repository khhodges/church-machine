#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const run = fs.readFileSync(path.join(root, 'app-run.js'), 'utf8');
const faultCss = fs.readFileSync(path.join(root, 'styles-fault.css'), 'utf8');
const gateCss = fs.readFileSync(path.join(root, 'styles-gatelog.css'), 'utf8');

assert.match(run, /<textarea id="faultUserNoteInput"[\s\S]*maxlength="300"/,
    'fault note remains length-limited and is rendered as a multiline control');
assert.match(run, /oninput="_autoGrowFaultNote\(this\);[\s\S]*rec\.userNote=v[\s\S]*_saveFaultNote\(rec,v\)/,
    'auto-grow keeps the existing record update and persistence behavior');
assert.match(run, /function _autoGrowFaultNote\(input\)[\s\S]*input\.scrollHeight/,
    'fault note grows to its content height');
const autoGrowSource = run.match(/function _autoGrowFaultNote\(input\) \{[\s\S]*?\n\}/);
assert.ok(autoGrowSource, 'auto-grow helper is present');
const autoGrow = Function(`"use strict"; ${autoGrowSource[0]}; return _autoGrowFaultNote;`)();
const note = { scrollHeight: 84, style: { height: '20px' } };
autoGrow(note);
assert.equal(note.style.height, '84px', 'auto-grow applies the measured content height');
assert.match(run, /class="fault-summary-grid"/);
assert.match(run, /class="fault-diagnostic-grid"/);

assert.match(faultCss, /width:\s*min\(960px,\s*calc\(100vw - 2rem\)\)/,
    'dialog is wider while remaining viewport-responsive');
assert.match(faultCss, /@media \(min-width: 780px\)[\s\S]*grid-template-columns:\s*repeat\(2,/,
    'diagnostic cards use two columns on wide screens');
assert.match(faultCss, /\.fault-user-note-input\s*\{[\s\S]*overflow-wrap:\s*anywhere/,
    'long note tokens wrap');
assert.match(gateCss, /\.fault-trace-table\s*\{[\s\S]*table-layout:\s*fixed/,
    'trace table is constrained to the modal width');
assert.match(gateCss, /\.fault-trace-table tbody td\s*\{[\s\S]*overflow-wrap:\s*anywhere/,
    'trace diagnostics wrap instead of causing horizontal page overflow');

console.log('PASS fault dialog: multiline note, responsive columns, and wrapped diagnostics');