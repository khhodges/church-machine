'use strict';
// Consumes the actual full-top UART capture decoded by wukong_bridge.py.
// Invoked by hardware/test_hardfault_candidate.py; no server or board needed.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const {snapshot, trace, base, origin} = JSON.parse(fs.readFileSync(0, 'utf8'));
const source = fs.readFileSync('simulator/app-run.js', 'utf8');
function section(start, end) {
    const a = source.indexOf(start), b = source.indexOf(end, a);
    assert(a >= 0 && b > a);
    return source.slice(a, b);
}
let renders = 0, refreshes = 0, cursor = null;
const context = vm.createContext({
    _wukongHardwareRegisters: {cr: [], dr: [], snapshot: null},
    _wukongRenderHardwareRegisters() { renders++; },
    _wukongSetHwCursor(nia) { cursor = nia; },
    _fetchAndShowLastFaultPanel() { refreshes++; },
    _WUKONG_EV_INSTR_NAME: {},
});
vm.runInContext(section('function _wukongApplySnapshot(', '// Drain all trace events'), context);
vm.runInContext(section('const _WUKONG_FAULT_NAMES =', 'function _wukongFlagsStr('), context);
assert.equal(context._wukongApplySnapshot(snapshot), true);
assert.equal(renders, 1);
assert.equal(refreshes, 1);
assert.equal(cursor, origin, 'NIA stays byte-addressed in the hardware view');
assert.deepEqual(context._wukongHardwareRegisters.dr, snapshot.dr);
assert.equal(context._wukongHardwareRegisters.cr[14], snapshot.cr[14][0]);
assert.notEqual(snapshot.cr[14][0], 0, 'architectural CR14 is not fault_cr14 placeholder');
assert.equal(snapshot.cr[14][1], base + 4, 'CR14 points after the LUMP header');
assert.equal((origin - snapshot.cr[14][1]) % 4, 0);
assert.equal((origin - snapshot.cr[14][1]) / 4, 17, 'code-relative word offset');
assert.equal((origin - base) / 4, 18,
    'header-relative +18 requires the independently known installed LUMP base');
assert.equal(context._wukongApplySnapshot({...snapshot, crc_valid: false}), false);
assert.equal(context._wukongApplySnapshot({...snapshot, cr: []}), false);
assert.equal(renders, 1);
const fault = context._wukongBuildHwFaultObj(trace);
assert.equal(fault.type, 'INVALID_OP');
assert.equal(fault.physicalPC, origin);
assert.equal(fault._origin, 'hardware');
assert.equal(fault.executionArtifact, undefined);
assert.equal(fault.crSnapshot.length, 0, 'trace alone must not invent CR14');

// The current wire protocol has no authenticated installation provenance.
// Even an identical word in a current saved artifact must NOT enable navigation.
const lumps = fs.readFileSync('simulator/app-lumps.js', 'utf8');
const a = lumps.indexOf('function _revealFaultInstruction(');
const b = lumps.indexOf('// Keep the last exact binary', a);
assert(a >= 0 && b > a);
const words = [(0xF8000000 | (19 << 10)) >>> 0, ...Array(19).fill(0xF7000000)];
let status = '';
const navigation = vm.createContext({
    window: {_faultNavigationBinary: {
        token: 'current', words, binaryHash: 'a'.repeat(64), filename: 'current.lump'
    }},
    document: {getElementById: () => ({})},
    assembler: {disassemble: () => 'WORD 0x7000000'},
    _setDisassemblyPresentationStatus(value) { status = value; },
    switchCodeTab() { assert.fail('unverified origin must not navigate'); },
});
vm.runInContext(lumps.slice(a, b), navigation);
for (const offset of [18, 72, 17, -1, 18.5]) {
    assert.equal(navigation._revealFaultInstruction(
        'current', offset, 0xF7000000, {
            artifact: fault.executionArtifact || null,
            codeWords: null, location: 'raw hardware NIA', pc: origin
        }), false);
}
assert.match(status, /unverified/);
console.log('Full Wukong snapshot: IDE retains raw hardware origin; unverified artifact navigation rejected');
