'use strict';

// Focused, DOM-only regression coverage for the Open Lump failure boundary.
// This deliberately does not launch a browser or execute a LUMP.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');

function extractFunction(name) {
    const plainStart = source.indexOf('function ' + name + '(');
    const asyncStart = source.indexOf('async function ' + name + '(');
    const start = asyncStart !== -1 &&
            (plainStart === -1 || asyncStart < plainStart)
        ? asyncStart : plainStart;
    assert.notEqual(start, -1, 'missing production function ' + name);
    const brace = source.indexOf('{', start);
    let depth = 0;
    for (let i = brace; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error('unbalanced production function ' + name);
}

const RESOLVE_SRC = extractFunction('_resolveSavedLumpEditorSource');
const VALIDATE_WORDS_SRC = extractFunction('_isExactSavedLumpWordArray');
const FORMAT_BYTES_SRC = extractFunction('_formatSavedLumpExactBytes');
const TAIL_METADATA_SRC = extractFunction('_readSavedLumpExactTail');
const OPEN_SRC = extractFunction('openLumpInEditor');

// Missing source remains an explicit state, never a synthesized assembly
// listing or an implicit sidecar/catalog fallback.
{
    const context = vm.createContext({ console });
    vm.runInContext(RESOLVE_SRC, context);
    const missing = vm.runInContext(
        '_resolveSavedLumpEditorSource(null, null, true)', context);
    assert.equal(missing.origin, 'missing');
    assert.equal(missing.restored, false);
    assert.match(missing.source, /Embedded source is unavailable/);
    assert(!missing.source.includes('0xF8000000'));
}

// Raw words remain useful inspection data even when they are explicitly
// unverified.  Formatting is read-only and does not imply approval.
{
    const context = vm.createContext({ console });
    vm.runInContext(VALIDATE_WORDS_SRC + '\n' + FORMAT_BYTES_SRC, context);
    const text = vm.runInContext(
        '_formatSavedLumpExactBytes([0xF8000000, 0x01020304])', context);
    assert.match(text, /F8 00 00 00/);
    assert.match(text, /01 02 03 04/);
    assert.match(text, /provenance unverified/);
    assert.match(text, /not approved for execution/);
}

// A malformed file can contain complete words followed by 1–3 readable bytes.
// The tail is rendered as raw bytes, never as a fabricated partial word.
{
    const context = vm.createContext({ console });
    vm.runInContext(VALIDATE_WORDS_SRC + '\n' + FORMAT_BYTES_SRC, context);
    const text = vm.runInContext(
        '_formatSavedLumpExactBytes([0x01020304], "AABB", 6)', context);
    assert.match(text, /1 complete 32-bit word \+ 2 trailing raw bytes; 6 bytes total/);
    assert.match(text, /AA BB/);
    assert.match(text, /not a complete 32-bit word/);
    assert(!text.includes('word[1]'));
}

// A 1–3 byte file has no complete words at all.  Its exact tail remains
// inspectable and is not relabelled as a zero-valued word.
{
    const context = vm.createContext({ console });
    vm.runInContext(VALIDATE_WORDS_SRC + '\n' + FORMAT_BYTES_SRC, context);
    const text = vm.runInContext(
        '_formatSavedLumpExactBytes([], "AABBCC", 3)', context);
    assert.match(text, /0 complete 32-bit words \+ 3 trailing raw bytes; 3 bytes total/);
    assert.match(text, /No complete 32-bit words were returned/);
    assert.match(text, /AA BB CC/);
    assert(!text.includes('word[0]'));
}

// Tail metadata is accepted only when it is a bounded hex byte string whose
// length agrees with byte_count.  An auth/error envelope cannot become tail
// bytes merely by including a hex-looking field.
{
    const context = vm.createContext({ console });
    vm.runInContext(VALIDATE_WORDS_SRC + '\n' + TAIL_METADATA_SRC, context);
    const valid = vm.runInContext(
        '_readSavedLumpExactTail({raw_tail_hex:"AABB", byte_count:6}, [0x01020304])',
        context);
    assert.deepEqual(valid, { rawTailHex: 'AABB', byteCount: 6 });
    const invalidHex = vm.runInContext(
        '_readSavedLumpExactTail({raw_tail_hex:"auth-json", byte_count:2}, [])',
        context);
    assert.equal(invalidHex, null);
    const invalidLength = vm.runInContext(
        '_readSavedLumpExactTail({raw_tail_hex:"AABB", byte_count:5}, [])',
        context);
    assert.equal(invalidLength, null);
}

// A denied/authentication response is not an exact binary response.  Open
// Lump must not decode its JSON error body, must not probe the diagnostic-only
// source endpoint, and must still leave a read-only warning inspection.
{
    assert(OPEN_SRC.includes("_wj && !_wj.error && Array.isArray(_wj.words)"));
    const calls = [];
    const opened = {};
    const classes = new Set();
    const editor = {
        value: '',
        readOnly: false,
        parentNode: { parentNode: { insertBefore() {} }, insertBefore() {} },
        classList: {
            add(name) { classes.add(name); },
            remove(name) { classes.delete(name); },
        },
        addEventListener() {},
        removeEventListener() {},
    };
    const saved = {
        token: '00c0ffee',
        abstraction: 'Auth.Gated',
        ns_slot: null,
        capabilities: [],
        lump_type: 'code',
        content_type: 'code',
    };
    const entry = { token: saved.token, abstraction: saved.abstraction,
        sources: { server: saved } };
    const sandbox = {
        console,
        fetch: async function(url) {
            calls.push(url);
            if (url.endsWith('/words')) {
                return {
                    ok: false,
                    status: 401,
                    async text() {
                        return JSON.stringify({
                            error: 'unauthorized',
                            words: [0xDEADBEEF],
                        });
                    },
                };
            }
            throw new Error('diagnostic endpoint must not be requested');
        },
        switchView() {},
        localStorage: { removeItem() {}, getItem() { return null; } },
        document: {
            getElementById(id) {
                if (id === 'asmEditor') return editor;
                if (id === 'langSelector') return { value: '' };
                return null;
            },
            querySelectorAll() { return []; },
            querySelector() { return null; },
            createElement() {
                return {
                    className: '', id: '', textContent: '', innerHTML: '',
                    setAttribute() {}, getAttribute() { return null; },
                    addEventListener() {}, remove() {},
                    querySelector() { return null; },
                };
            },
        },
        window: null,
        LumpRegistry: {
            SESSION_EPOCH: 0,
            resolve(token) { return token === saved.token ? entry : null; },
            list() { return [entry]; },
            setCurrent() {},
        },
        _draftLsGet() { return null; },
        _migrateBfextBfinsSyntax(value) { return value; },
        _draftLsSet() {},
        _draftLsDel() {},
        _enterSavedLumpEditorMode(disasm, name, lump, token, inspection) {
            opened.disasm = disasm;
            opened.name = name;
            opened.lump = lump;
            opened.token = token;
            opened.inspection = inspection;
        },
        setTimeout,
    };
    sandbox.window = sandbox;
    const context = vm.createContext(new Proxy(sandbox, {
        get(target, prop, receiver) {
            if (prop in target) return Reflect.get(target, prop, receiver);
            if (typeof prop === 'string' && prop in globalThis) return globalThis[prop];
            if (typeof prop === 'string' && /^[_a-zA-Z]/.test(prop)) {
                return function() {};
            }
            return undefined;
        },
        set(target, prop, value, receiver) {
            return Reflect.set(target, prop, value, receiver);
        },
        has() { return true; },
    }));
    vm.runInContext(RESOLVE_SRC + '\n' + OPEN_SRC, context);
    vm.runInContext('openLumpInEditor("' + saved.token + '")', context)
        .then(function() {
            assert.deepEqual(calls, ['/api/lump/' + saved.token + '/words']);
            assert(opened.inspection &&
                /requires authorization/.test(opened.inspection.appendText));
            assert.match(opened.inspection.appendText,
                /No exact saved binary data is available/);
            assert(!opened.inspection.appendText.includes('DEADBEEF'));
            assert.equal(opened.lump._identityProvenance, 'unverified');
            assert.equal(editor.readOnly, true);
            assert(classes.has('cm-editor-sealed'));
            saved.token = '00c0ffef';
            entry.token = saved.token;
            calls.length = 0;
            sandbox.fetch = async function(url) {
                calls.push(url);
                return {
                    ok: true,
                    async json() {
                        return {
                            token: saved.token,
                            words: [0x01020304],
                            source: '; exact unverified source',
                            raw_tail_hex: 'AABB',
                            byte_count: 6,
                            trusted: false,
                            approved: false,
                            binary_valid: false,
                            validation_errors: ['trailing bytes'],
                        };
                    },
                };
            };
            return vm.runInContext('openLumpInEditor("' + saved.token + '")', context)
                .then(function() {
                    assert.deepEqual(calls, ['/api/lump/' + saved.token + '/words']);
                    assert.match(opened.inspection.appendText, /AA BB/);
                    assert.match(opened.inspection.appendText, /trailing raw bytes/);
                    assert(!opened.inspection.appendText.includes('word[1]'));
                    assert.equal(opened.lump._identityProvenance, 'unverified');
                    assert.equal(editor.value, '; exact unverified source');
                    assert.equal(editor.readOnly, true);
                    assert(classes.has('cm-editor-sealed'));
                    console.log('PASS saved LUMP safe read-only inspection boundaries');
                });
        })
        .catch(function(error) {
            console.error(error);
            process.exitCode = 1;
        });
}
