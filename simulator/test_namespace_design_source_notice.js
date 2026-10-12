'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(__dirname + '/app-memory.js', 'utf8');
const start = source.indexOf('function _namespaceDesignSourceNotice(');
const end = source.indexOf('\nfunction updateNamespace()', start);
assert(start >= 0 && end > start);
const context = vm.createContext({});
vm.runInContext(source.slice(start, end), context);
const state = {abstractions: [
    {slot: 0, name: 'Boot.NS'}, {slot: 1, name: 'Boot.Thread'},
    {slot: 2, name: 'UART_DEV'},
]};
const frozen = JSON.stringify(state);
const legacy = context._namespaceDesignSourceNotice(state);
assert.match(legacy, /Legacy layout/);
assert.match(legacy, /slot 0 metadata\/header, slot 1 Namespace self, slot 2 entry Thread/);
assert.match(legacy, /not active CR15 state/);
assert.match(legacy, /does not migrate the layout or activate an image/);
assert.strictEqual(JSON.stringify(state), frozen, 'rendering never renumbers saved rows');
for (const other of [null, {}, {abstractions: []}, {abstractions: [
    {slot: 1, name: 'Boot.NS'}, {slot: 2, name: 'Boot.Thread'},
]}]) {
    const notice = context._namespaceDesignSourceNotice(other);
    assert.match(notice, /not active CR15 state/);
    assert.doesNotMatch(notice, /Legacy layout/, 'do not infer legacy geometry without evidence');
}
assert(source.slice(end).includes('let html = _namespaceDesignSourceNotice(window._nsState);'));
console.log('PASS Namespace design source notice: legacy distinction, no false classification, no mutation');
