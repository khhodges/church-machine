'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync(__dirname + '/app-lumps.js', 'utf8');
const panel = { style: {}, innerHTML: 'identity evidence' };
const button = { style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
const context = {
    window: { _savedLumpEditorMode: true },
    document: { getElementById: id => id === 'savedLumpIdentityPanel' ? panel : button }
};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function toggleSavedLumpIdentity()'),
    source.indexOf('function _renderSavedLumpIdentityPanel(')), context);
context._syncSavedLumpIdentityVisibility();
assert.equal(button.attrs['aria-expanded'], 'true');
context.toggleSavedLumpIdentity();
assert.equal(panel.style.display, 'none');
assert.equal(button.attrs['aria-expanded'], 'false');
assert.equal(button.title, 'Show artifact identity');
assert.equal(panel.innerHTML, 'identity evidence');
context.toggleSavedLumpIdentity();
assert.equal(panel.style.display, '');
assert.equal(button.attrs['aria-expanded'], 'true');
context.window._savedLumpEditorMode = false;
context._syncSavedLumpIdentityVisibility();
assert.equal(button.style.display, 'none');
console.log('PASS identity shield hides/restores panel without changing evidence');