'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const src = fs.readFileSync(__dirname + '/app-run.js', 'utf8');
const start = src.indexOf('function _wukongApplyStartupState(');
const end = src.indexOf('/** Fetch status', start);
const logs = [];
const ctx = vm.createContext({
    _wukongStartupTs: null, _wukongHWRunning: true,
    _wukongRunUnlocked: true, _wukongCmdLog: text => logs.push(text),
    _wukongUpdateBtn: () => {}
});
vm.runInContext(src.slice(start, end), ctx);
const apply = state => ctx._wukongApplyStartupState({
    received_ts: 123, startup_state: state
});
apply('halt_requested');
apply('awaiting_first_step');
assert.equal(ctx._wukongHWRunning, false);
assert.equal(logs.length, 2, 'same boot timestamp must not hide confirmation');
apply('fault_stopped');
assert.match(logs[2], /fault-stopped/);
assert.match(logs[2], /pause was not established/);
assert.equal(ctx._wukongRunUnlocked, false);
apply('fault_stopped');
assert.equal(logs.length, 3, 'both pollers must deduplicate the same state');
assert.equal((src.match(/_wukongApplyStartupState\((?:bi|bdata)\);/g) || []).length, 2);
console.log('Startup halt/fault UI transitions passed');
