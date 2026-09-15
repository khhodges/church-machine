'use strict';

const fs = require('fs');
const assert = require('assert');

const shell = fs.readFileSync('simulator/app-shell.js', 'utf8');
const run = fs.readFileSync('simulator/app-run.js', 'utf8');
const lumps = fs.readFileSync('simulator/app-lumps.js', 'utf8');

const start = shell.indexOf('function switchView(viewId)');
const end = shell.indexOf('\nfunction ', start + 1);
assert(start >= 0 && end > start, 'switchView is present');
const switchView = shell.slice(start, end);

assert(
    switchView.includes('!window._savedLumpEditorMode') &&
    switchView.includes('returning to Editor leaves the source/name visible'),
    'main-view navigation preserves the complete saved-LUMP editor workspace'
);
assert(
    lumps.includes('if (window._savedLumpEditorMode) exitSavedLumpEditorMode();'),
    'opening another LUMP still replaces the previous saved-LUMP workspace'
);
assert(
    run.includes('window.exitSavedLumpEditorMode();'),
    'explicit editor document changes still close saved-LUMP mode'
);

console.log('PASS saved-LUMP disassembly survives ordinary view navigation');