'use strict';
const assert = require('node:assert/strict');
const R = require('./fmt-lump-readout');
const listeners = new Set();
const editor = {
    value: 'original source',
    addEventListener: (event, fn) => { assert.equal(event, 'input'); listeners.add(fn); },
    removeEventListener: (event, fn) => listeners.delete(fn)
};
const cards = ['api', 'compact', 'full'].map(profile => ({
    innerHTML: '', getAttribute: key => {
        assert.equal(key, 'data-fmt-profile'); return profile;
    }
}));
const container = {querySelectorAll: () => cards};
function snapshot(sourceText, cw) {
    const candidate = Object.freeze({cw, cc: 1, lumpSize: 1024,
        frame: Object.freeze({flags: 0, frameWords: Object.freeze(Array(19).fill(0))})});
    return Object.freeze({sourceText, candidates: Object.freeze({
        api: candidate, compact: candidate, full: candidate
    })});
}
const pending = snapshot(editor.value, 500);
R.bindEditorReadouts(container, editor, pending);
assert.ok(cards.every(c => c.innerHTML.includes('521 words used')));
editor.value = 'é';
listeners.forEach(fn => fn());
assert.ok(cards.every(c => c.innerHTML.includes('data-stale="true"')));
assert.ok(cards.every(c => c.innerHTML.includes('2 B plaintext')));
assert.ok(cards.every(c => !c.innerHTML.includes('521 words used')));
assert.ok(cards.every(c => !c.innerHTML.includes('words padding')));
assert.equal(pending.candidates.api.cw, 500, 'Never rewrite the reviewed binary');
assert.equal(pending.sourceText, 'original source', 'Never rewrite retained source');
editor.value = pending.sourceText;
listeners.forEach(fn => fn());
assert.ok(cards.every(c => c.innerHTML.includes('521 words used')), 'Undo restores matching counts');
editor.value = 'new source';
R.bindEditorReadouts(container, editor, snapshot(editor.value, 499));
assert.equal(listeners.size, 1, 'Reopening/reselecting must not accumulate listeners');
assert.ok(cards.every(c => c.innerHTML.includes('520 words used')), 'Fresh build updates counts');
editor.value = '';
listeners.forEach(fn => fn());
assert.ok(cards.every(c => c.innerHTML.includes('0 B plaintext')), 'Deleting all source invalidates counts');
console.log('PASS: live edit invalidation, UTF-8 bytes, undo, fresh builds and frozen snapshot safety');
