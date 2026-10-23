'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
function harness() {
    const dialogs = [];
    function element(tag) {
        return {tag, style: {}, children: [], handlers: {}, isConnected: true, textContent: '',
            appendChild(c) { this.children.push(c); }, setAttribute() {},
            addEventListener(n, f) { this.handlers[n] = f; }, showModal() { dialogs.push(this); },
            focus() {}, remove() { this.isConnected = false; }};
    }
    const window = {location: {href: 'http://ide.test/', origin: 'http://ide.test'},
        addEventListener() {}, removeEventListener() {}, console: {warn() {}}, fetch: async () => null};
    vm.runInNewContext(fs.readFileSync(__dirname + '/change-confirmation.js', 'utf8'),
        {window, document: {activeElement: element('e'), body: element('b'), createElement: element},
            Request, Response, Headers, URL, Uint32Array, Math, String});
    return {window, dialogs};
}
const texts = n => (n.textContent || '') + n.children.map(texts).join('');
(async () => {
    let h = harness();
    const rows = h.window._sourceDiffRows('a\nb\nc', 'a\nB\nc\nd');
    assert.deepStrictEqual([...rows.map(r => r.type)], ['same', 'mod', 'same', 'add']);
    assert.strictEqual(rows[1].oldText, 'b'); assert.strictEqual(rows[1].newText, 'B');
    assert.strictEqual(rows[3].oldNo, null); assert.strictEqual(rows[3].newNo, 4);
    assert.deepStrictEqual([...h.window._sourceDiffRows("x\ny", "y").map(r => r.type)], ['del', 'same']);
    // Large input stays bounded and complete.
    const big = Array.from({length: 5000}, (_, i) => 'L' + i);
    const big2 = big.slice().reverse();
    const t = Date.now();
    const br = h.window._sourceDiffRows(big.join('\n'), big2.join('\n'));
    assert(Date.now() - t < 3000);
    assert.strictEqual(br.filter(r => r.oldNo !== null).length, 5000);
    assert.strictEqual(br.filter(r => r.newNo !== null).length, 5000);
    // Dialog: exact text via textContent, button positions unchanged, approval works.
    const editor = {value: '<b>old</b>\n  tab\t'};
    const p = h.window.confirmSourceReplacement(editor, '<i>new</i>\n  tab\t', 'Replace');
    for (let i = 0; i < 50 && !h.dialogs.length; i++) await new Promise(r => setTimeout(r, 1));
    const d = h.dialogs[0];
    const all = texts(d.children[2]);
    assert(all.includes('<b>old</b>') && all.includes('<i>new</i>') && all.includes('  tab\t'));
    assert(all.includes('Before') && all.includes('After') && all.includes('-') && all.includes('+'));
    assert(all.includes('This review does not save or compile the replacement.'));
    assert(!all.includes('Before:\n'));
    assert.strictEqual(d.children[4].textContent, 'Confirm this change');
    d.children[4].onclick();
    assert.strictEqual(await p, true);
    // Generic changes still render as plain text.
    h = harness();
    h.window.confirmProtectedChange({title: 'T', changes: ['slot 10', 'slot 11']});
    for (let i = 0; i < 50 && !h.dialogs.length; i++) await new Promise(r => setTimeout(r, 1));
    assert.strictEqual(h.dialogs[0].children[2].children[0].textContent, 'slot 10\n\nslot 11');
    // Deletion review compares saved source against the entire recovery copy,
    // not against whichever text happens to be in the editor.
    h = harness();
    const saved = Array.from({length: 22}, (_, i) => 'saved ' + i).join('\n');
    const draft = saved + '\nIMPORTANT SELFTEST CHANGE\n' + Array(300).fill('test body').join('\n');
    h.window.confirmProtectedChange({
        title: 'Delete browser draft',
        comparisonLabels: {before: 'Saved source — kept', after: 'Browser draft — to delete'},
        changes: ['Before:\n' + saved, 'After:\n' + draft],
    });
    for (let i = 0; i < 50 && !h.dialogs.length; i++) await new Promise(r => setTimeout(r, 1));
    const comparison = texts(h.dialogs[0].children[2]);
    assert(comparison.includes('Saved source — kept'));
    assert(comparison.includes('Browser draft — to delete'));
    assert(comparison.includes('IMPORTANT SELFTEST CHANGE'));
    assert(comparison.includes('323'));
    h.dialogs[0].children[3].onclick(); // Reject; review must not require deletion.
    const lumps = fs.readFileSync(__dirname + '/app-lumps.js', 'utf8');
    assert(lumps.includes("'Before:\\n' + _recoveredSource"));
    assert(lumps.includes("'After:\\n' + _savedDraft"));
    assert(lumps.includes("'After:\\n' + _draftToReview"));
    console.log('Source diff confirmation tests passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
