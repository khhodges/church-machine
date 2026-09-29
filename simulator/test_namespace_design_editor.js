'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const memory = fs.readFileSync(path.join(__dirname, 'app-memory.js'), 'utf8');
const lumps = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');
function fn(source, name) {
    const start = source.indexOf('function ' + name + '(');
    const asyncStart = source.indexOf('async function ' + name + '(');
    const pos = asyncStart >= 0 && (start < 0 || asyncStart < start) ? asyncStart : start;
    assert(pos >= 0, 'Missing production function ' + name);
    let depth = 0;
    const brace = source.indexOf('{', pos);
    for (let i = brace; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}' && --depth === 0) return source.slice(pos, i + 1);
    }
    throw new Error('Unbalanced production function ' + name);
}
const route = fn(memory, '_nsLabelOpen') + '\n' + fn(memory, '_nsOpenDesignSelection');
const open = fn(lumps, '_savedLumpRejectionReason') + '\n' +
    fn(lumps, '_savedLumpMethodLabel') + '\n' +
    fn(lumps, '_resolveSavedLumpEditorSource') + '\n' +
    fn(lumps, 'openLumpInEditor');
const selected = {
    token: '1eec355e', filename: 'ide.Alice.1.1eec355e.lump',
    binaryHash: 'a'.repeat(64), status: 'unresolved',
    diagnostic: 'Compiler approval is unavailable',
};
const createNode = () => ({
    className: '', style: {}, textContent: '', innerHTML: '', children: [],
    classList: { add() {}, remove() {}, toggle() {} },
    append(...nodes) { this.children.push(...nodes); },
    appendChild(node) { this.children.push(node); },
    setAttribute() {}, getAttribute() { return null; }, addEventListener() {},
    removeEventListener() {},
    remove() {}, querySelector() { return null; }
});
const notices = [], requests = [], views = [], newNames = [], overlays = [];
const inserted = new Map();
const editor = createNode();
editor.value = 'unsaved current source';
editor.parentNode = { parentNode: {
    insertBefore(node) { if (node.id) inserted.set(node.id, node); }
}, insertBefore(node) { if (node.id) inserted.set(node.id, node); } };
const sandbox = {
    console, setTimeout,
    sim: {
        nsLabels: { 14: 'ide.Alice', 15: 'Active.Service' },
        readNSEntry(slot) { return { label: this.nsLabels[slot], gtType: 1 }; },
        symbolicEntryAt(slot) { return slot === 14 ? this.symbolic : null; },
    },
    _isThreadNamespaceSlot() { return false; },
    _findSrcLump(slot) { return slot === 15 ? { token: '11223344' } : null; },
    _preserveEditorNavigationBuffer() {},
    _draftLsGet() { return null; },
    _captureEditorWriteGuard() { return { accepts() { return true; } }; },
    _selectSavedLumpCodeDisplay() { return { kind: 'disassembly', text: '; exact words' }; },
    _enterSavedLumpEditorMode(disasm, name, lump, token, inspection) {
        sandbox.opened = { name, lump, token, inspection };
    },
    _showFpgaToast(_title, message) { notices.push(message); },
    _getSavedLumpWordUsageSummary: async () => '2 words',
    _formatLumpHeaderDisassembly: () => 'header',
    _updateEditorCodeName() {},
    _setDisassemblyPresentationStatus() {},
    _syncSavedLumpIdentityVisibility() {},
    _formatSavedLumpInspectionSource() { return ''; },
    _formatSavedLumpExactBytes() { return 'exact bytes (unapproved)'; },
    _renderSavedLumpIdentityPanel() {},
    switchView(view) { views.push(view); },
    newAbstraction: async name => { newNames.push(name); return true; },
    localStorage: { removeItem() {}, getItem() { return null; } },
    document: {
        body: { appendChild(node) { overlays.push(node); } },
        getElementById(id) {
            if (id === 'asmEditor') return editor;
            if (id === 'langSelector') return { value: '' };
            return inserted.get(id) || null;
        },
        querySelectorAll() { return []; },
        querySelector() { return null; },
        createElement: createNode,
        createTextNode: text => ({ textContent: text }),
    },
    LumpRegistry: {
        // Same token can currently point to another revision. It must never
        // substitute that catalog source for the selected filename/hash.
        resolve(token) {
            return { sources: { server: {
                token, filename: 'other.same-token.lump', abstraction: 'Other.Service'
            } } };
        },
        list() { return []; },
        setCurrent() {},
    },
};
sandbox.window = sandbox;
const context = vm.createContext(new Proxy(sandbox, {
    get(target, prop, receiver) {
        if (prop in target) return Reflect.get(target, prop, receiver);
        if (typeof prop === 'string' && prop in globalThis) return globalThis[prop];
        if (typeof prop === 'string' && /^[_a-zA-Z]/.test(prop)) return function() {};
    },
    has() { return true; },
}));
vm.runInContext(open + '\n' + route, context);
async function run() {
    sandbox.sim.symbolic = {
        name: 'ide.Alice', implementationMissing: true, selection: selected
    };
    sandbox.fetch = async (url) => {
        requests.push(url);
        return { ok: true, json: async () => ({
            filename: selected.filename, binary_hash: selected.binaryHash,
            words: [0xF8000400, 0x01020304], source: 'embedded Alice source',
            trusted: false, approved: false, binary_valid: true,
            validation_errors: ['Approval record not found']
        }) };
    };
    await vm.runInContext('_nsLabelOpen(14)', context);
    assert.equal(requests.length, 1);
    assert.equal(requests[0], '/api/lump/1eec355e/words?exact_filename=' +
        encodeURIComponent(selected.filename) + '&binary_hash=' + selected.binaryHash);
    assert.equal(views.at(-1), 'editor');
    assert.equal(editor.value, 'embedded Alice source');
    assert.equal(sandbox.opened.lump.filename, selected.filename);
    assert.equal(sandbox.opened.lump._identityProvenance, 'unverified');
    assert.equal(sandbox.opened.inspection.unverified, true);
    assert.match(inserted.get('_lumpSourceIntegrityBanner').textContent,
        /Saved artifact rejection: Approval record not found/);
    assert.equal(newNames.length, 0);

    editor.value = 'my unsaved revision';
    sandbox.fetch = async url => {
        requests.push(url);
        return { ok: true, json: async () => ({
            filename: 'different.revision.lump', binary_hash: selected.binaryHash,
            words: [0xF8000400], source: 'wrong source'
        }) };
    };
    const oldViewCount = views.length;
    await vm.runInContext('_nsLabelOpen(14)', context);
    assert.equal(editor.value, 'my unsaved revision');
    assert.equal(views.length, oldViewCount);
    assert(notices.some(text => /exact saved filename or SHA-256/.test(text)));

    sandbox.fetch = async url => {
        requests.push(url);
        return { ok: true, json: async () => ({
            filename: selected.filename, binary_hash: selected.binaryHash,
            words: [0xF8000400, 0x01020304], trusted: false,
            approved: false, binary_valid: false,
            validation_errors: ['no embedded source']
        }) };
    };
    await vm.runInContext('_nsLabelOpen(14)', context);
    const noSource = inserted.get('_lumpSourceMissingBanner') ||
        inserted.get('_lumpSourceIntegrityBanner');
    assert(noSource, 'no-source result must explain the empty editor');
    const newButton = noSource.children.find(child =>
        child.textContent === 'Create source in New editor');
    assert(newButton, 'no-source result must offer the existing New editor route');
    assert.equal(editor.readOnly, true);
    await newButton.onclick();
    assert.deepEqual(newNames, ['ide.Alice']);
    newNames.length = 0;

    sandbox.sim.symbolic = {
        name: 'Future.Alice', implementationMissing: true,
        selection: { status: 'missing', diagnostic: 'Not in library' }
    };
    vm.runInContext('_nsLabelOpen(14)', context);
    assert.equal(requests.length, 3, 'missing selection must not fetch by token/name');
    const panel = overlays.at(-1).children[0];
    const create = panel.children.find(child => child.textContent === 'Create source in New editor');
    assert(create, 'missing selection must offer the New editor route');
    await create.onclick();
    assert.deepEqual(newNames, ['Future.Alice']);

    sandbox.sim.symbolic = null;
    sandbox.openLumpInEditor = async token => requests.push('ordinary:' + token);
    vm.runInContext('_nsLabelOpen(15)', context);
    assert.equal(requests.at(-1), 'ordinary:11223344');
    console.log('PASS exact design click → saved source, mismatch preservation, missing New, ordinary open');
}
run().catch(error => { console.error(error); process.exitCode = 1; });