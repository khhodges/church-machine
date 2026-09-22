'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync(__dirname + '/app-run.js', 'utf8');

function extractFunction(name) {
    const start = source.indexOf('function ' + name + '(');
    assert(start >= 0, name + ' exists');
    const brace = source.indexOf('{', start);
    let depth = 0;
    for (let i = brace; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error('unterminated ' + name);
}

function storageObject(initial) {
    const bytes = new Map(Object.entries(initial));
    return {
        bytes,
        api: {
            getItem(key) { return bytes.has(key) ? bytes.get(key) : null; },
            setItem(key, value) { bytes.set(key, String(value)); },
            removeItem(key) { bytes.delete(key); },
        },
    };
}

// Startup restoration must treat source and localStorage as opaque bytes. This
// fixture intentionally matches both formerly automatic rewrite signatures.
{
    const legacy = [
        '; Church Machine Post-Flash Exhaustive Self-Test v1.0',
        'TPERM CR0, X',
        'BFEXT DR1, DR2, pos=4, w=8',
        'BFINS DR3, DR4, pos=0, w=4',
        '',
    ].join('\n');
    const rawDocument = '{"owner":{"type":"buffer"},"code":' +
        JSON.stringify(legacy) + ',"lang":"assembly","extra":"keep spacing"}';
    const stored = storageObject({
        church_editor_document_v1: rawDocument,
        church_editor_code: legacy,
        church_editor_lang: 'assembly',
        cm_sealed_lump: 'exact-existing-byte-string',
    });
    const before = Array.from(stored.bytes.entries());
    const editor = { value: 'preexisting', readOnly: true, classList: { remove() {} } };
    const selector = { value: '' };
    let migrations = 0;
    let examples = 0;
    const sandbox = {
        window: { _migrateBfextBfinsSyntax() { migrations++; return 'rewritten'; } },
        localStorage: stored.api,
        document: {
            getElementById(id) {
                if (id === 'asmEditor') return editor;
                if (id === 'langSelector') return selector;
                return null;
            },
            querySelectorAll() { return []; },
        },
        activeUserTabId: null,
        onLangChange() {},
        updateSavePseudoBtn() {},
        renderUserTabs() {},
        loadExample() { examples++; },
        _updateEditorCodeName() {},
    };
    sandbox.window.window = sandbox.window;
    vm.createContext(sandbox);
    vm.runInContext(
        "const _EDITOR_DOCUMENT_STATE_KEY = 'church_editor_document_v1';\n" +
        "const _EDITOR_OWNER_DRAFT_PREFIX = 'church_editor_owner_draft_v1:';\n" +
        extractFunction('_readEditorDocumentState') + '\n' +
        extractFunction('_readEditorOwnerDraft') + '\n' +
        extractFunction('_editorOwnerDraftKey') + '\n' +
        extractFunction('_clearEditorOwnerMarkers') + '\n' +
        extractFunction('loadEditorState'),
        sandbox
    );
    sandbox.loadEditorState();
    assert.strictEqual(editor.value, legacy);
    assert.strictEqual(migrations, 0);
    assert.strictEqual(examples, 0);
    assert.strictEqual(sandbox.window._editorStateHydrated, true);
    assert.strictEqual(sandbox.window._editorRestoredDocumentPresent, true);
    assert.deepStrictEqual(Array.from(stored.bytes.entries()), before);
}

// A startup LUMP document is still an owned source buffer. Restoration binds
// the exact token to the LUMP draft helper, but does not start a canonical open
// that could asynchronously take over the buffer.
{
    const lumpText = 'exact LUMP draft bytes\r\nBFEXT DR1, DR2, pos=4, w=8\r\n';
    const rawDocument = JSON.stringify({
        owner: { type: 'lump', id: '0xExact-Token' },
        code: lumpText,
        lang: 'assembly',
    });
    const stored = storageObject({
        church_editor_document_v1: rawDocument,
        church_editor_code: 'unrelated legacy bytes',
        church_editor_lang: 'assembly',
    });
    const before = Array.from(stored.bytes.entries());
    const editor = {
        value: '',
        readOnly: true,
        classList: { remove() {} },
        addEventListener() {},
    };
    const selector = { value: '' };
    let restoredToken = null;
    let canonicalOpens = 0;
    const sandbox = {
        window: {
            _restoreSavedLumpEditorOwnership(token, target) {
                restoredToken = token;
                assert.strictEqual(target, editor);
                this._editorOpenLumpToken = token;
            },
        },
        localStorage: stored.api,
        document: {
            getElementById(id) {
                if (id === 'asmEditor') return editor;
                if (id === 'langSelector') return selector;
                return null;
            },
            querySelectorAll() { return []; },
        },
        activeUserTabId: null,
        onLangChange() {},
        updateSavePseudoBtn() {},
        renderUserTabs() {},
        openLumpInEditor() { canonicalOpens++; },
        _updateEditorCodeName() {},
    };
    vm.createContext(sandbox);
    vm.runInContext(
        "const _EDITOR_DOCUMENT_STATE_KEY = 'church_editor_document_v1';\n" +
        "const _EDITOR_OWNER_DRAFT_PREFIX = 'church_editor_owner_draft_v1:';\n" +
        extractFunction('_readEditorDocumentState') + '\n' +
        extractFunction('_readEditorOwnerDraft') + '\n' +
        extractFunction('_editorOwnerDraftKey') + '\n' +
        extractFunction('_clearEditorOwnerMarkers') + '\n' +
        extractFunction('loadEditorState'),
        sandbox
    );
    sandbox.loadEditorState();
    assert.strictEqual(editor.value, lumpText);
    assert.strictEqual(restoredToken, '0xExact-Token');
    assert.strictEqual(canonicalOpens, 0);
    assert.strictEqual(sandbox.window._editorStateHydrated, true);
    assert.strictEqual(sandbox.window._editorRestoredDocumentPresent, true);
    assert.deepStrictEqual(Array.from(stored.bytes.entries()), before);
}

// Authority arriving after startup is advisory: it may offer an explicit
// accept action, but cannot replace or persist over the owned buffer itself.
(async function testAsyncContainment() {
    const stored = storageObject({
        church_editor_document_v1: '  exact pre-existing JSON bytes  ',
        church_editor_code: 'draft',
    });
    let resolveFetch;
    let banner = null;
    const buttons = {};
    let preservedDraft = null;
    let saves = 0;
    let inputListener = null;
    const editor = {
        value: 'draft',
        parentNode: { parentNode: { insertBefore(node) { banner = node; } } },
        addEventListener(type, listener) {
            if (type === 'input') inputListener = listener;
        },
        removeEventListener(type, listener) {
            if (type === 'input' && inputListener === listener) inputListener = null;
        },
    };
    const sandbox = {
        window: {
            _editorSourceFilePath: 'owned.cloomc',
            _editorNavigationEpoch: 0,
            _advanceEditorNavigationEpoch() {
                return ++this._editorNavigationEpoch;
            },
        },
        activeUserTabId: null,
        localStorage: stored.api,
        fetch() { return new Promise(resolve => { resolveFetch = resolve; }); },
        document: {
            getElementById(id) {
                if (id === '_authoritativeDraftBanner') return banner;
                if (id === 'asmEditor') return editor;
                return null;
            },
            createElement() {
                return {
                    remove() { banner = null; },
                    querySelector(selector) {
                        buttons[selector] = buttons[selector] || {
                            textContent: '',
                            onclick: null,
                            disabled: false,
                        };
                        return buttons[selector];
                    },
                    querySelectorAll(selector) {
                        if (selector !== 'button') return [];
                        return Object.keys(buttons)
                            .filter(key => /Accept|Keep|Restore/.test(key))
                            .map(key => buttons[key]);
                    },
                };
            },
        },
        _actionableResponseError() {},
        _writeEditorOwnerDraft(owner, text) {
            preservedDraft = { owner: { type: owner.type, id: owner.id }, text };
        },
        _clearEditorOwnerDraft() { preservedDraft = null; },
        saveEditorState() { saves++; },
        updateLineNumbers() {},
        console,
        Promise,
    };
    sandbox.window.window = sandbox.window;
    vm.createContext(sandbox);
    vm.runInContext(
        extractFunction('_currentEditorOwner') + '\n' +
        extractFunction('_clearAuthoritativeDraftBanner') + '\n' +
        extractFunction('_bindAuthoritativeBannerInvalidation') + '\n' +
        extractFunction('_offerEditorOwnerDraftRestore') + '\n' +
        extractFunction('_reconcileAuthoritativeEditor'),
        sandbox
    );

    const before = Array.from(stored.bytes.entries());
    sandbox._reconcileAuthoritativeEditor(
        { type: 'source', id: 'owned.cloomc' }, 'draft', editor);
    editor.value = 'typed while restore pending';
    resolveFetch({ ok: true, text: () => Promise.resolve('server source') });
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(editor.value, 'typed while restore pending');
    assert.strictEqual(banner, null);
    assert.deepStrictEqual(Array.from(stored.bytes.entries()), before);

    editor.value = 'draft';
    sandbox._reconcileAuthoritativeEditor(
        { type: 'source', id: 'owned.cloomc' }, 'draft', editor);
    resolveFetch({ ok: true, text: () => Promise.resolve('server source') });
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(editor.value, 'draft');
    assert.ok(banner, 'divergence is offered without replacing the buffer');
    assert.strictEqual(buttons['#_authoritativeBefore'].textContent, 'draft');
    assert.strictEqual(buttons['#_authoritativeAfter'].textContent, 'server source');
    assert.deepStrictEqual(Array.from(stored.bytes.entries()), before);

    // The preview is invalidated by any intervening byte change, even when the
    // owner remains the same.
    editor.value = 'draft plus one byte';
    inputListener();
    assert.strictEqual(editor.value, 'draft plus one byte');
    assert.strictEqual(banner, null);
    assert.strictEqual(inputListener, null);
    assert.strictEqual(buttons['#_authoritativeAccept'].disabled, true);
    assert.strictEqual(buttons['#_authoritativeAccept'].onclick, null);
    assert.strictEqual(preservedDraft, null);
    assert.strictEqual(saves, 0);

    // A fresh preview can be explicitly accepted. The exact replaced draft is
    // archived before the accepted source is persisted.
    editor.value = 'draft';
    sandbox._reconcileAuthoritativeEditor(
        { type: 'source', id: 'owned.cloomc' }, 'draft', editor);
    resolveFetch({ ok: true, text: () => Promise.resolve('server source') });
    await new Promise(resolve => setImmediate(resolve));
    buttons['#_authoritativeAccept'].onclick();
    assert.strictEqual(editor.value, 'server source');
    assert.deepStrictEqual(preservedDraft, {
        owner: { type: 'source', id: 'owned.cloomc' },
        text: 'draft',
    });
    assert.strictEqual(saves, 1);
    assert.strictEqual(inputListener, null);

    // The archived bytes are offered as an explicit recovery on a future
    // owner restore rather than silently becoming the default buffer.
    sandbox._offerEditorOwnerDraftRestore(
        { type: 'source', id: 'owned.cloomc' }, preservedDraft.text, editor);
    assert.ok(banner && banner._ownerDraftRecovery);
    assert.strictEqual(buttons['#_authoritativeBefore'].textContent, 'server source');
    assert.strictEqual(buttons['#_authoritativeAfter'].textContent, 'draft');
    buttons['#_authoritativeRestore'].onclick();
    assert.strictEqual(editor.value, 'draft');
    assert.strictEqual(preservedDraft, null);
    assert.strictEqual(saves, 2);
    assert.strictEqual(inputListener, null);
    console.log('Editor restore containment regressions: PASS');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});