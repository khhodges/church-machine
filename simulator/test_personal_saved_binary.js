'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const lumps = fs.readFileSync(__dirname + '/app-lumps.js', 'utf8');
const shell = fs.readFileSync(__dirname + '/app-shell.js', 'utf8');
const run = fs.readFileSync(__dirname + '/app-run.js', 'utf8');
function extract(source, name) {
    const start = source.indexOf('async function ' + name + '(') >= 0
        ? source.indexOf('async function ' + name + '(')
        : source.indexOf('function ' + name + '(');
    assert(start >= 0, name);
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(name);
}
const dom = new JSDOM('<div id="editor"><div class="editor-layout">' +
    '<textarea id="asmEditor"></textarea><section id="savedLumpDisassemblyPanel" style="display:none">' +
    '<span id="disassemblyPresentationStatus"></span><pre id="savedLumpDisassembly"></pre>' +
    '<div id="savedLumpIdentityPanel"></div></section></div></div>');
const doc = dom.window.document;
const editor = doc.getElementById('asmEditor');
const output = doc.getElementById('savedLumpDisassembly');
const panel = doc.getElementById('savedLumpDisassemblyPanel');
const words = [((31 << 27) | (2 << 10)) >>> 0, 0x08000001, 0];
const hash = 'a'.repeat(64);
const row = { abstraction: 'SelfTest', token: '4a000006', filename: 'SelfTest.v98.lump',
    binary_hash: hash, lump_version: 98 };
const tab = { id: 'personal-98', name: 'SelfTest Source', code: '; authored comment\nsource draft',
    sourceRevision: 98 };
let calls = [];
let pending = null;
const storage = new Map([['church_user_tabs', JSON.stringify([tab])]]);
storage.set('church_editor_code', 'STALE BOOTIMG SOURCE');
const context = vm.createContext({
    window: dom.window, document: doc, console, activeUserTabId: tab.id,
    assembler: { disassemble: () => 'instruction' },
    fetch: async (url, options) => {
        calls.push([url, options]);
        if (pending) return new Promise(resolve => { pending.push(resolve); });
        if (url === '/api/lumps/list') return { ok: true, json: async () => [row] };
        return { ok: true, json: async () => ({
            ...row, source: tab.code, words, byte_count: words.length * 4, raw_tail_hex: ''
        }) };
    },
    localStorage: { getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: key => storage.delete(key) },
    _syncSavedLumpIdentityVisibility() {},
});
vm.runInContext([
    extract(lumps, '_isExactSavedLumpWordArray'),
    extract(lumps, '_readSavedLumpExactTail'),
    extract(lumps, '_formatLumpHeaderDisassembly'),
    extract(lumps, '_lumpDispatchAnnotation'),
    extract(lumps, '_formatCanonicalSavedLumpWords'),
    extract(lumps, '_presentPersonalSavedBinary'),
    extract(run, 'loadEditorState'),
].join('\n'), context);
context.window._presentPersonalSavedBinary = context._presentPersonalSavedBinary;
context.userTabs = [tab];
context._readEditorDocumentState = () => ({
    owner: { type: 'personal', id: tab.id }, code: tab.code, lang: 'personal'
});
context._clearEditorOwnerMarkers = () => {};
context._updateEditorCodeName = () => {};
context.renderUserTabs = () => {};
assert(extract(run, 'loadEditorState').includes('window._presentPersonalSavedBinary(restoredPersonalTab)'));
assert(extract(shell, '_commitUserTabSelection').includes('window._presentPersonalSavedBinary(tab)'));
const snapshot = JSON.stringify([...storage]);
(async () => {
    // Restored My Programs owner, not a stale boot-image selection.
    context.window._bootImageInspectionWarning = 'BOOTIMG inputs changed';
    context.window._editorNavigationEpoch = 1;
    context.loadEditorState();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(editor.value, tab.code, 'restored personal draft outranks stale generic boot source');
    assert.match(calls[0][0], /\/api\/lumps\/list/);
    assert.match(calls[1][0], /exact_filename=SelfTest\.v98\.lump&binary_hash=/);
    assert.match(output.textContent, /Saved v98/);
    assert.match(output.textContent, /Embedded artifact source matches/);
    assert.match(output.textContent, /\[0001\].*0x08000001/);
    assert.doesNotMatch(output.textContent, /BOOTIMG/);
    assert.equal(editor.value, tab.code);
    assert.equal(JSON.stringify([...storage]), snapshot);
    assert.equal(context.window._editorOpenLumpToken, undefined);
    assert.equal(context.window._savedLumpEditorMode, false);
    assert(calls.every(call => call[1].cache === 'no-store'));

    // A receipt bypasses catalog resolution, but not exact word authentication.
    tab.savedBinary = row;
    calls = [];
    editor.value = '; authored comment\nchanged draft';
    assert.equal(await context._presentPersonalSavedBinary(tab), true);
    assert.equal(calls.length, 1);
    assert.match(output.textContent, /differs from the current editor draft/);
    assert.equal(editor.value, '; authored comment\nchanged draft');

    // Delayed A->B->A selection cannot paint the prior A response.
    pending = [];
    const late = context._presentPersonalSavedBinary(tab);
    context.window._editorNavigationEpoch = 2;
    context.activeUserTabId = 'other-tab';
    editor.value = 'other source';
    context.window._editorNavigationEpoch = 3;
    context.activeUserTabId = tab.id;
    editor.value = tab.code;
    const selected = context._presentPersonalSavedBinary(tab);
    pending[0]({ ok: true, json: async () => ({ ...row, words }) });
    assert.equal(await late, false);
    assert.match(output.textContent, /Finding a saved version/);
    pending[1]({ ok: true, json: async () =>
        ({ ...row, source: tab.code, words, byte_count: words.length * 4, raw_tail_hex: '' }) });
    assert.equal(await selected, true);
    pending = null;

    // Missing exact revision must not display an unrelated binary.
    delete tab.savedBinary;
    context.fetch = async () => ({ ok: true, json: async () => [
        { ...row, lump_version: 99 }, { ...row, abstraction: 'BOOTIMG' }
    ] });
    assert.equal(await context._presentPersonalSavedBinary(tab), false);
    assert.match(output.textContent, /SAVED BINARY UNAVAILABLE.*no unique exact saved Source v98/s);
    assert.doesNotMatch(output.textContent, /\[0001\]/);
    assert.equal(panel.style.display, 'flex');
    assert.equal(editor.value, tab.code);
    console.log('PASS personal saved binary: restored v98, exact receipt, stale boot, races, unavailable');
})().catch(err => { console.error(err); process.exitCode = 1; });