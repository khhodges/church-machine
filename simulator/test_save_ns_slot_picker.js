'use strict';
// Run: node simulator/test_save_ns_slot_picker.js
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync('simulator/app-run.js', 'utf8');
function section(from, to) {
    const start = source.indexOf(from);
    const end = source.indexOf(to, start);
    assert(start >= 0 && end > start, `missing ${from}`);
    return source.slice(start, end);
}
const picker = section('function _collectSaveNamespaceSlotCandidates(', 'function _cloneLumpSaveCapabilities(');
const show = section('function showSaveToNamespace()', 'function onSlotChange()');
const onChange = section('function onSlotChange()', 'function closeSaveDialog()');
const close = section('function closeSaveDialog()', '// A stale-editor conflict');
const committed = {
    namespaceFingerprint: 'committed-fingerprint',
    abstractions: Array.from({ length: 16 }, (_, slot) => ({
        slot, name: slot === 14 ? 'ide.Alice' : slot === 15 ? 'ide.Mallory' :
            slot === 0 ? 'Boot.NS' : slot === 1 ? 'Boot.Thread' : `NS${slot}`,
        token: slot === 14 ? '4730c311' : slot === 15 ? '04b2913d' : `token-${slot}`,
    })),
};
const bootConfig = { slotLabels: { 14: 'Bridge.Preload', 16: 'Policy.Probe', 17: 'Other ghost' } };
const catalog = [{ ns_slot: 16, abstraction: 'Registry ghost' }];
const sim = { MAX_NS_ENTRIES: 256, readNSEntry: () => ({ label: 'Stale live label' }) };
const context = { sim, window: { bootConfig, LumpRegistry: {
    getServerList: () => catalog,
} }, document: {}, console };
vm.createContext(context);
vm.runInContext(picker, context);
const options = context._collectSaveNamespaceSlotCandidates(sim, committed);
assert.deepStrictEqual(Array.from(options, o => o.slot), Array.from({ length: 16 }, (_, i) => i));
assert.strictEqual(options[14].label, 'ide.Alice');
assert.strictEqual(options[15].label, 'ide.Mallory');
assert(options[0].disabled && options[1].disabled);
assert(options.slice(2).every(o => !o.disabled));
assert.throws(() => context._collectSaveNamespaceSlotCandidates(sim, {}), /incomplete/);
assert.throws(() => context._collectSaveNamespaceSlotCandidates(sim, {
    abstractions: [...committed.abstractions, { slot: 14, name: 'duplicate' }],
}), /invalid/);

// Minimal DOM: test the real modal opener, its async ownership, and cancel.
const elements = new Map();
function element(id) {
    if (!elements.has(id)) elements.set(id, {
        value: '', checked: false, disabled: false, style: { display: 'none' },
        dataset: {}, textContent: '', innerHTML: '', options: [], selectedIndex: 0,
        appendChild(child) { this.options.push(child); },
        insertBefore(child) { this.options.unshift(child); },
        focus() {}, remove() {}, setAttribute() {},
    });
    return elements.get(id);
}
const slotSel = element('saveNSSlot');
let slotValue = '';
Object.defineProperty(slotSel, 'value', {
    get() { return slotValue; },
    set(value) {
        slotValue = value;
        const index = this.options.findIndex(option => option.value === value);
        this.selectedIndex = index;
    },
});
Object.defineProperty(slotSel, 'innerHTML', {
    get() { return ''; },
    set() { this.options = []; this.value = ''; this.selectedIndex = 0; },
});
context.document = {
    activeElement: { isConnected: false },
    getElementById: element,
    querySelector: () => ({ textContent: '' }),
    createElement: () => ({ value: '', textContent: '', dataset: {}, disabled: false }),
    addEventListener() {}, removeEventListener() {},
};
context.window._pendingLumpData = null;
context.window._saveNSPreparedSnapshot = null;
context.window.LumpRegistry.resolve = () => ({ sources: { memory: { words: [1] } } });
context.window.LumpRegistry.getCurrent = () => 'editor-token';
context._captureLumpSaveSnapshot = () => ({ words: [1] });
context._restoreSaveOperationStatus = () => {};
context._makeModalFocusTrap = () => () => {};
context._saveNSTrap = null;
context._setSaveNSFeedback = (kind, message) => {
    element('saveNSStatus').textContent = message;
    element('saveNSConfirmBtn').disabled = kind === 'loading' || kind === 'error';
};
let requests = [];
context.fetch = (url, init) => {
    assert.strictEqual(url, '/api/boot-image/ns-state');
    assert.strictEqual(init.cache, 'no-store');
    return new Promise((resolve, reject) => requests.push({ resolve, reject }));
};
vm.runInContext(show + onChange + close, context);
const before = JSON.stringify({ committed, bootConfig, catalog });
const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
    context.showSaveToNamespace();
    assert(slotSel.disabled);
    assert(element('saveNSConfirmBtn').disabled);
    context.closeSaveDialog();
    requests.shift().resolve({ ok: true, json: async () => committed });
    await flush();
    assert.strictEqual(slotSel.options.length, 0, 'cancelled request cannot repopulate dialog');

    context.showSaveToNamespace();
    const previous = requests.shift();
    context.closeSaveDialog();
    context.showSaveToNamespace();
    const latest = requests.shift();
    latest.resolve({ ok: true, json: async () => committed });
    await flush();
    assert.strictEqual(slotSel.options.length, 17);
    assert.strictEqual(slotSel.options[15].textContent, '[14] ide.Alice');
    assert.strictEqual(slotSel.options[16].textContent, '[15] ide.Mallory');
    assert.strictEqual(slotSel.value, 'new', 'no implicit name-based replacement without an owner');
    assert.strictEqual(slotSel.options[1].disabled, true);
    assert.strictEqual(slotSel.options[2].disabled, true);
    assert.strictEqual(slotSel.options[15].disabled, false);
    previous.resolve({ ok: true, json: async () => ({
        namespaceFingerprint: 'stale',
        abstractions: [{ slot: 14, name: 'Bridge.Preload' }],
    }) });
    await flush();
    assert.strictEqual(slotSel.options[15].textContent, '[14] ide.Alice');
    slotSel.value = '14';
    slotSel.selectedIndex = 15;
    context.onSlotChange();
    assert.strictEqual(element('saveNSLabel').value, 'ide.Alice',
        'selection must not read stale live Namespace labels');
    context.closeSaveDialog();
    assert.strictEqual(JSON.stringify({ committed, bootConfig, catalog }), before,
        'opening and cancelling must not modify authority or boot config');

    // Reopen a compiled release from the exact committed Alice artifact. Its
    // new candidate token differs, but the editor's frozen base owner is Alice.
    context._captureLumpSaveSnapshot = () => ({
        words: [1], token: 'new-compiled-token',
        editorBaseIdentity: { token: '4730c311', abstraction: 'ide.Alice' },
    });
    context.showSaveToNamespace();
    requests.shift().resolve({ ok: true, json: async () => committed });
    await flush();
    assert.strictEqual(slotSel.value, '14', 'exact opened artifact replaces Alice in place');
    assert.strictEqual(element('saveNSLabel').value, 'ide.Alice');
    context.closeSaveDialog();
    assert.strictEqual(JSON.stringify({ committed, bootConfig, catalog }), before);

    // A stale editor owner must not be rebound by an equal name.
    context._captureLumpSaveSnapshot = () => ({
        words: [1], token: 'unbound',
        editorBaseIdentity: { token: 'revoked-token', abstraction: 'ide.Alice' },
    });
    context.showSaveToNamespace();
    requests.shift().resolve({ ok: true, json: async () => committed });
    await flush();
    assert.strictEqual(slotSel.value, 'choose', 'stale owner requires explicit destination selection');
    assert.match(element('saveNSStatus').textContent, /Choose the destination explicitly/);
    context.closeSaveDialog();

    context.showSaveToNamespace();
    requests.shift().reject(new Error('offline'));
    await flush();
    assert(slotSel.disabled);
    assert.match(element('saveNSStatus').textContent, /offline/);
    assert.strictEqual(slotSel.options.length, 0, 'no invented fallback on fetch error');
    context.closeSaveDialog();
    console.log('Save LUMP committed-slot picker checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });