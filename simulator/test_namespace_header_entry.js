'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/app-shell.js', 'utf8');
const start = source.indexOf("    if (viewId === 'namespace') {", source.indexOf('function switchView('));
const end = source.indexOf("    if (viewId === 'memory')", start);
assert(start > 0 && end > start);
const pending = [], scrolls = [];
const context = {
    viewId: 'namespace', currentView: 'namespace', el: {scrollTop: 350},
    updateNamespace() {}, refreshBootCapacity() {},
    setTimeout: callback => pending.push(callback),
    window: {scrollTo: options => scrolls.push(options)},
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
pending.shift()();
assert.equal(context.el.scrollTop, 0);
assert.equal(scrolls[0].top, 0);
assert.equal(scrolls[0].behavior, 'instant');
vm.runInContext(source.slice(start, end), context);
context.currentView = 'editor';
pending.shift()();
assert.equal(scrolls.length, 1, 'Late Namespace timer must not scroll another page');
assert(source.includes("startView === 'namespace' && hashParams.ns !== undefined"),
    'Explicit slot links retain their separate row navigation');
console.log('PASS Namespace entry shows header, avoids late navigation jumps, preserves explicit slot links');
