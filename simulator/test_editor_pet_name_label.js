'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync('simulator/app-run.js', 'utf8');
const start = source.indexOf('function _editorDisplayPetName(');
const end = source.indexOf('const _EDITOR_DOCUMENT_STATE_KEY', start);
const label = { setAttribute() {} };
const entry = { abstraction: 'ide.Alice', sources: { server: { dot_name: 'ide.Alice' } } };
const context = {
    window: { LumpRegistry: { resolve: token => token === '1eec355e' ? entry : null } },
    document: { getElementById: () => label },
    userTabs: [{ id: 'alice', name: '1eec355e' }],
    activeUserTabId: 'alice',
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
context._refreshEditorActionIdentity();
assert.strictEqual(label.textContent, 'ide.Alice');
assert.strictEqual(context.userTabs[0].name, '1eec355e', 'display must not rewrite the document');
assert.strictEqual(context._editorDisplayPetName('ide.Mallory'), 'ide.Mallory');
assert.strictEqual(context._editorDisplayPetName('Lump 0x1eec355e'), 'ide.Alice');
assert.strictEqual(context._editorDisplayPetName('deadbeef'), 'Pet Name unavailable');
context.window._editorOpenLumpMeta = { token: 'deadbeef', abstraction: 'ide.Mallory' };
assert.strictEqual(context._editorDisplayPetName('deadbeef'), 'ide.Mallory');
assert.strictEqual(context._editorDisplayPetName('aaaaaaaa'), 'Pet Name unavailable');
console.log('Editor Pet Name label checks passed');