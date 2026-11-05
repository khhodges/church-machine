'use strict';
// Native-select write ownership, with synthetic status only. No hardware calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let ready, value = '', writes = 0;
const handlers = {};
const select = {
    get value() { return value; },
    set value(next) { writes++; value = next; },
    addEventListener(type, fn) { handlers[type] = fn; }
};
const storage = {};
const document = {
    activeElement: null,
    getElementById(id) { return id === 'programmingTargetSelect' ? select : null; },
    addEventListener(type, fn) { if (type === 'DOMContentLoaded') ready = fn; },
    querySelectorAll() { return []; }
};
const context = {document, Date, console,
    localStorage: {getItem: k => storage[k] || null,
                   setItem: (k, v) => { storage[k] = v; }}};
context.window = context;
vm.runInNewContext(fs.readFileSync('simulator/target-state.js', 'utf8'), context);
ready();
assert.equal(value, 'simulator-ram');
const initialWrites = writes;
const poll = () => context.TargetState.observeDevice(
    {uid: 'offline-board', sessionId: 'offline-session', connected: true});
for (let i = 0; i < 100; i++) poll();
assert.equal(writes, initialWrites, 'background polling must not rewrite selection');
document.activeElement = select;
value = 'wukong-runtime-ram'; // native selection in progress
poll();
assert.equal(value, 'wukong-runtime-ram', 'poll cannot overwrite user selection');
assert.equal(writes, initialWrites);
handlers.change();
assert.equal(context.TargetState.resolve().mode, 'wukong-runtime-ram');
assert.equal(JSON.parse(storage.church_programming_target_v1).mode, 'wukong-runtime-ram');
context.TargetState.select({mode: 'wukong-fpga-bitstream'});
assert.equal(value, 'wukong-runtime-ram', 'external changes wait until interaction ends');
document.activeElement = null;
handlers.blur();
assert.equal(value, 'wukong-fpga-bitstream');
assert.equal(writes, initialWrites + 1);
console.log('Target dropdown polling, selection, persistence and blur checks passed.');
