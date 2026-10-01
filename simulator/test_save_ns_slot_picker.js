'use strict';
// Historical filename retained: the programmer picker must no longer contain
// Namespace destinations or require a live/committed Namespace to open.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync('simulator/app-run.js', 'utf8');
const show = source.slice(source.indexOf('function showSaveToNamespace()'),
    source.indexOf('function onSlotChange()'));
const close = source.slice(source.indexOf('function closeSaveDialog()'),
    source.indexOf('// A stale-editor conflict'));
const nodes = new Map();
const element = id => {
    if (!nodes.has(id)) nodes.set(id, {
        style: {}, value: '', dataset: {}, textContent: '', focus() {}, remove() {}
    });
    return nodes.get(id);
};
const snapshot = { abstraction: 'ide.Alice', words: [1, 2],
    editorBaseIdentity: { abstraction: 'ide.Alice' } };
const context = {
    window: { LumpRegistry: {
        resolve: () => ({ sources: { memory: { words: [1, 2] } } }),
        getCurrent: () => 'candidate'
    } },
    document: { getElementById: element, querySelector: () => element('title'),
        activeElement: null, addEventListener() {}, removeEventListener() {} },
    _captureLumpSaveSnapshot: () => snapshot,
    _saveNSPickerRequestId: 0, _saveNSTrap: null,
    _makeModalFocusTrap: () => () => {},
    _setSaveNSFeedback() {}, _restoreSaveOperationStatus() {},
    fetch: () => { throw new Error('Save dialog must not fetch Namespace'); }
};
vm.createContext(context);
vm.runInContext(show + close, context);
context.showSaveToNamespace();
assert.strictEqual(element('saveNSLabel').value, 'ide.Alice');
assert.strictEqual(element('saveLumpMode').value, 'revision');
assert.strictEqual(context.window._saveNSPreparedSnapshot, snapshot);
context.closeSaveDialog();
assert.strictEqual(context.window._saveNSPreparedSnapshot, null);
const html = fs.readFileSync('simulator/index.html', 'utf8');
const modal = html.slice(html.indexOf('<div id="saveNSDialog"'),
    html.indexOf('<!-- ── Stale editor save conflict'));
for (const id of ['saveNSSlot', 'saveNSType', 'permR', 'permW', 'permX',
    'permL', 'permS', 'permE']) assert(!modal.includes(`id="${id}"`), id);
assert(modal.includes('saveLumpMode'));
assert(modal.includes('Pet Name'));
console.log('Artifact-only Save LUMP dialog checks passed');