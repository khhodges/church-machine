// Hardware register ingestion must never execute or mutate the software machine.
// Run: node simulator/test_wukong_cr_update.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync(__dirname + '/app-run.js', 'utf8');

function section(start, end) {
    const a = src.indexOf(start);
    const b = src.indexOf(end, a + start.length);
    if (a < 0 || b < 0) throw new Error('Missing production section: ' + start);
    return src.slice(a, b);
}

const dom = new JSDOM('<div id="wukong-hw-log"><div id="wukong-hw-log-body"></div></div><div id="editorConsole"></div>');
const sim = {
    cr: Array.from({length: 16}, (_, i) => ({word0: 0x100 + i, word1: i})),
    dr: Array.from({length: 16}, (_, i) => 0x200 + i),
    memory: new Uint32Array([0, 0xFFFF0000]),
    physicalPC: 123, pc: 45, flags: {Z: true},
    applyHardwareSnapshot() { throw new Error('hardware must not call simulator snapshot'); },
};
const before = JSON.stringify(sim);
const env = {
    sim, window: dom.window, document: dom.window.document,
    _WUKONG_EV_HAS_GT_PAYLOAD: new Set([1, 2, 4, 5, 6, 7, 10, 11]),
    _WUKONG_EV_TRACE_NAMES: {2: 'LOAD new GT', 6: 'CALL CR6', 8: 'CALL push'},
    _WUKONG_FAULT_NAMES: {},
    _WUKONG_HW_LOG_MAX: 300,
    _wukongHwFaulted: false, _wukongPrevFaultValid: false,
    _wukongCallDepth: 0,
    _wukongSetHwCursor() {}, _wukongSetPipelineHwNIA() {},
    _decodeGtLabel() { return 'board GT'; },
    _wukongTraceLocationText() { return 'board instruction'; },
    _wukongFlagsStr() { return '-'; },
    _wukongSyncFaultDisasmPanel() {},
    _wukongUpdateCallDepthBadge() {},
    _wukongUpdateToolbarBtn() {},
    _wukongHideFaultPanel() {},
};
vm.createContext(env);
vm.runInContext(
    section('const _wukongHardwareRegisters =', '\nlet _wukongLastEventSeq') +
    section('function _wukongApplyCRUpdate(data) {', '\n// Drain all trace events') +
    section('function _wukongNormalizeEvent(e) {', '\nfunction _wukongAppendTrace(data) {') +
    section('function _wukongAppendTrace(data) {', '\n// ── Board-command helpers'),
    env);
const board = vm.runInContext('_wukongHardwareRegisters', env);
const unchanged = () => assert.strictEqual(JSON.stringify(sim), before);

env._wukongApplyCRUpdate({cr6_gt: 0, cr14_gt: 0xCAFEBABE});
assert.strictEqual(board.cr[6], 0);
assert.strictEqual(board.cr[14], 0xCAFEBABE);
unchanged();
assert.match(dom.window.document.getElementById('wukong-hw-registers').textContent,
    /CR6=0x00000000.*CR14=0xCAFEBABE/);

const snapshot = {
    snapshot: true, seq: 4, nia: 17, reason: 1,
    cr: Array.from({length: 16}, (_, i) => [i + 10, 0, 0]),
    dr: Array.from({length: 16}, (_, i) => i + 20),
};
assert.strictEqual(env._wukongApplySnapshot(snapshot), true);
assert.strictEqual(board.cr[6], 16);
assert.strictEqual(board.dr[15], 35);
assert.match(dom.window.document.getElementById('wukong-hw-registers').textContent,
    /Snapshot #4 NIA=0x00000011/);
assert.match(dom.window.document.getElementById('wukong-hw-registers').textContent,
    /DR15=0x00000023/);
unchanged();
assert.strictEqual(env._wukongApplySnapshot({...snapshot, cr: snapshot.cr.slice(1)}), false);
assert.strictEqual(board.snapshot, snapshot);
unchanged();

// A LOAD lacking an event-correlated raw word cannot guess CR_dst from sim.memory.
env._wukongAppendTrace({ev_type: 2, nia: 1, payload_gt: 0xAABBCCDD});
assert.strictEqual(board.cr[15], 25);
env._wukongAppendTrace({ev_type: 2, nia: 1, payload_gt: 0xAABBCCDD,
    observed_instr_word: 0x00030000});
assert.strictEqual(board.cr[3], 0xAABBCCDD);
env._wukongAppendTrace({ev_type: 6, nia: 1, payload_gt: 0x11223344});
assert.strictEqual(board.cr[6], 0x11223344);
env._wukongAppendTrace({ev_type: 8, nia: 1, payload_gt: 0});
assert.strictEqual(board.cr[6], 0x11223344);
unchanged();
assert.ok(dom.window.document.querySelector('.wukong-hardware-trace[data-source="hardware"]'));
env._wukongClearHardwareRegisters();
assert.strictEqual(board.cr[6], null);
assert.strictEqual(board.dr, null);
assert.match(dom.window.document.getElementById('wukong-hw-registers').textContent,
    /CR6=unavailable[\s\S]*DR=unavailable/);
unchanged();
console.log('Hardware CR/DR isolation and board display tests passed');