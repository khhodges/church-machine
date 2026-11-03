const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync(require('path').join(__dirname, 'app-run.js'), 'utf8');
const start = source.indexOf('function _openRetainedHardwareFault(');
const end = source.indexOf('\n}\n', start) + 2;
let opened;
const snap = {source: 'hardware', call_depth: null, cr: [[1, 2, 3]], dr: [4]};
const context = {
    _lastFaultSnapshotData: snap,
    _wukongFaultSnapshotMatches: s => s === snap,
    _wukongBuildHwFaultObj: s => ({message: 'BOUNDS', _hardwareTrace: s}),
    _wukongFaultDiagnosis: f => ({snapshot: f._acceptedSnapshot}),
    showFaultModal: f => { opened = f; },
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
assert.equal(context._openRetainedHardwareFault({}), false);
assert.equal(opened, undefined);
assert.equal(context._openRetainedHardwareFault(), true);
assert.strictEqual(opened._acceptedSnapshot, snap);
assert.equal(opened._diagnosticLoaded, true);
assert.match(opened.message, /inspection only/);
assert.equal(opened.crSnapshot[0].word1, 2);
assert.equal(opened.drSnapshot[0], 4);
assert.strictEqual(snap.call_depth, null);
assert.notStrictEqual(opened.drSnapshot, snap.dr);
console.log('Retained report reuses exact evidence without network or hardware operations.');
