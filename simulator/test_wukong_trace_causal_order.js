'use strict';
// Exercise the real render paths: history rows remain visible without touching
// live cursor, fault transitions, flags, or register state.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(__dirname + '/app-run.js', 'utf8');
function extract(name) {
    const start = source.indexOf('function ' + name + '(');
    assert(start >= 0);
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw Error('missing function end');
}
function element() {
    return {
        dataset: {}, childNodes: [],
        appendChild(n) { this.childNodes.push(n); },
        insertBefore(n) { this.childNodes.unshift(n); },
        cloneNode() { return this; },
        querySelector() { return null; },
    };
}
const rows = [];
const context = {
    document: { getElementById: () => ({ appendChild: row => rows.push(row) }), createElement: element,
        createTextNode: text => ({ nodeType: 3, nodeValue: text }) },
    _appendToLog: (target, row) => rows.push(row),
    _WUKONG_HW_LOG_MAX: 500,
    _WUKONG_EV_TRACE_NAMES: { 0: 'RESULT' },
    _WUKONG_EV_HAS_GT_PAYLOAD: new Set(),
    _WUKONG_FAULT_NAMES: {},
    _wukongFlagsStr: () => '-',
    _decodeGtLabel: () => null,
};
vm.createContext(context);
for (const name of ['_wukongHex', '_wukongNormalizeEvent', '_wukongFormatEvent',
    '_wukongAppendTrace', '_wukongApplySnapshot']) {
    vm.runInContext(extract(name), context);
}
const late = {ev_type: 0, nia: 4, seq: 100, is_current: false,
    bridge_session: 'trial-session', bridge_trace_counter: 1, fault_valid: false};
context._wukongAppendTrace(late);
assert.equal(rows.length, 2);
assert.match(rows[0].childNodes.map(n => n.nodeValue || '').join(''), /packet=1/);
assert.match(context._wukongFormatEvent(late), /session=trial-session/);
assert.match(context._wukongFormatEvent(late), /late\/history/);
// None of the live-state dependencies exist in this context. Calling one would
// throw; stale snapshots must also take the history-only path before mutation.
assert.equal(context._wukongApplySnapshot({...late, snapshot: true}), false);
assert.equal(rows.length, 4);
console.log('PASS: late trace/snapshot are visible history, never live recovery');
context._wukongCallDepth = 4;
const badge = {style: {}};
context.document.getElementById = () => badge;
context._wukongIsConnected = () => true;
vm.runInContext(extract('_wukongUpdateCallDepthBadge'), context);
vm.runInContext(extract('_wukongApplyCallDepth'), context);
context._wukongApplyCallDepth({ev_type: 8, call_depth: null});
assert.equal(context._wukongCallDepth, null);
assert.match(badge.textContent, /unknown/);
context._wukongApplyCallDepth({ev_type: 9, call_depth: null});
assert.equal(context._wukongCallDepth, null);
context._wukongApplyCallDepth({ev_type: 8});
assert.equal(context._wukongCallDepth, null);
context._wukongApplyCallDepth({call_depth: 2});
assert.equal(context._wukongCallDepth, 2);
assert.match(badge.textContent, /2/);
console.log('PASS: missing causal predecessors display unknown depth until reconciled');
