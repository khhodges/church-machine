'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync(__dirname + '/app-run.js', 'utf8');
const start = source.indexOf('function showFaultModal(f)');
const end = source.indexOf('function faultModalDismiss', start);
const modal = source.slice(start, end);

assert(start >= 0 && end > start, 'fault modal implementation is present');
assert(modal.includes('_offset >= 0') && modal.includes('_offset < _limit'),
    'fault source attribution checks the captured CR14 range');
assert(modal.includes('unmapped address ${pcHex} (outside the captured code capability)'),
    'out-of-range fetches are identified as unmapped');
assert(modal.includes('const nsIdxForViewLump = locationNs'),
    'View LUMP is offered only for a validated instruction location');
assert(modal.includes('if (!locationNs || locationNs.offset === undefined'),
    'source-line lookup is offered only for a validated instruction location');
assert(modal.includes('No captured source location is available for this fault'),
    'Edit Code is disabled when the fault has no validated source location');
assert(modal.includes("'<button class=\"btn btn-muted\" disabled"),
    'unmapped faults do not emit an enabled Edit Code action');
assert(!modal.includes('onclick="faultModalOpenEditor(null)"'),
    'an unmapped instruction row does not fall back to the generic editor');
assert(modal.includes("const _instructionNavHint = _editLineNum"),
    'instruction navigation remains available for mapped source or a validated LUMP');

console.log('PASS fault unmapped location');