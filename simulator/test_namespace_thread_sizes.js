'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const alerts = [], writes = [];
const scope = {
    document: {getElementById: () => null},
    localStorage: {getItem: () => 'ascending'},
    ThreadDesign: require('./thread_design'),
    alert: text => alerts.push(text),
    fetch: (...args) => { writes.push(args); throw Error('Unexpected network write'); },
};
scope.window = scope;
vm.runInNewContext(fs.readFileSync(__dirname + '/namespace-design-v1.js', 'utf8'), scope);
const api = scope.NamespaceDesignV1;
const boot = {slot: 2, name: 'Boot.Thread', kind: 'thread', words: 256};
const thread = {slot: 32, name: 'ide.B1.FreeThread', kind: 'thread', words: 256,
    preparedThread: {entrySlot: 21, actorSlot: 22, entryNia: 0}};
api.state.document = {rows: [boot, thread]};
for (const size of scope.ThreadDesign.supportedBodyWords) {
    api.threadSize(32, String(size));
    assert.equal(thread.words, size);
    assert.equal(boot.words, 256);
    assert.equal(thread.preparedThread.entrySlot, 21);
}
assert.equal(api.state.dirty, true);
api.threadSize(32, '513');
assert.equal(thread.words, 8192);
assert.equal(alerts.length, 1);
api.state.saving = true;
api.threadSize(32, '512');
assert.equal(thread.words, 8192);
assert.equal(writes.length, 0, 'size editing is draft-only');
console.log('PASS: supported Thread sizes, unchanged sibling and binding, invalid input and save guard; no network writes');
