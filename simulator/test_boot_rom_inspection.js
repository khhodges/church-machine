'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const memorySource = fs.readFileSync(path.join(__dirname, 'app-memory.js'), 'utf8');
const hwSource = fs.readFileSync(path.join(__dirname, 'hw_binary.js'), 'utf8');
const hwStart = hwSource.indexOf('const HW_BOOT_PROGRAM =');
const hwEnd = hwSource.indexOf('];', hwStart) + 2;
const helperStart = memorySource.indexOf('function _bootROMInspectionRows()');
const helperEndMarker = 'window._showBootROMInspector = _showBootROMInspector;';
const helperEnd = memorySource.indexOf(helperEndMarker, helperStart) + helperEndMarker.length;

assert(hwStart >= 0 && hwEnd > hwStart, 'authoritative browser boot program exists');
assert(helperStart >= 0 && helperEnd > helperStart, 'boot ROM inspector helpers exist');

let inserted = '';
let binaryFetches = 0;
let sourceLookups = 0;
let editorOpens = 0;
const context = {
    window: {},
    Array,
    String,
    Number,
    sim: {},
    _findSrcLump() {
        sourceLookups += 1;
        return { token: '00000000' };
    },
    openLumpInEditor() {
        editorOpens += 1;
        binaryFetches += 1;
    },
    document: {
        getElementById() { return null; },
        body: {
            insertAdjacentHTML(_position, html) { inserted = html; },
        },
    },
    fetch() {
        binaryFetches += 1;
        throw new Error('boot ROM inspection must not fetch a saved binary');
    },
};
vm.createContext(context);
vm.runInContext(
    hwSource.slice(hwStart, hwEnd) + '\n' +
    memorySource.slice(helperStart, helperEnd),
    context,
);

const labelOpenStart = memorySource.indexOf('function _nsLabelOpen(slotIdx)');
const labelOpenEnd = memorySource.indexOf(
    '// Dedicated read-only popup for a selected Thread instance.', labelOpenStart);
assert(labelOpenStart >= 0 && labelOpenEnd > labelOpenStart);
vm.runInContext(memorySource.slice(labelOpenStart, labelOpenEnd), context);

const rows = context._bootROMInspectionRows();
assert.deepStrictEqual(
    JSON.parse(JSON.stringify(rows.map(row => [row.op, row.operands, row.word]))),
    [
        ['LOAD', 'AL, CR15, CR15[0]', 0x077F8000],
        ['CHANGE', 'AL, CR12, CR15, #1', 0x27678001],
        ['CALL', 'AL, CR0, CR0', 0x17000000],
    ],
    'inspector renders the authoritative LOAD/CHANGE/CALL words and operands',
);
assert.strictEqual(context._showBootROMInspector(), true);
assert(inserted.includes('NS[0] is the Boot.NS Namespace-table entry (data)'));
assert(inserted.includes('not a saved LUMP identity'));
assert(inserted.includes('not evidence of observed hardware execution'));
assert(inserted.includes('0x077F8000'));
assert(inserted.includes('0x27678001'));
assert(inserted.includes('0x17000000'));
assert.strictEqual(binaryFetches, 0, 'opening slot zero performs no binary request');
context._nsLabelOpen(0);
assert.strictEqual(sourceLookups, 0,
    'slot-zero Namespace navigation does not resolve an ordinary saved LUMP');
assert.strictEqual(editorOpens, 0,
    'slot-zero Namespace navigation never opens token zero in the editor');
assert.strictEqual(binaryFetches, 0,
    'slot-zero Namespace entry performs no binary fetch');

assert(memorySource.indexOf('if (Number(slotIdx) === 0) {', memorySource.indexOf('function _nsLabelOpen')) <
    memorySource.indexOf('_findSrcLump(slotIdx, rawLabel)', memorySource.indexOf('function _nsLabelOpen')),
    'slot-zero label navigation intercepts before saved-LUMP lookup');
assert(memorySource.includes("if (Number(nsIdx) === 0) return null;"),
    'slot zero cannot resolve to an editor token');
assert(memorySource.includes('title="Hardwired boot ROM; not a saved LUMP version"'),
    'slot-zero version cell does not claim saved artifact identity');

console.log('Boot ROM inspection tests passed');