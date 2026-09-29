'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const dir = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(dir, '../server/lumps/manifest.json')));
const names = ['ide.Alice', 'ide.Mallory'];
const rows = names.map(name => {
    const record = manifest.find(row => row.abstraction === name && !row.archived);
    assert(record);
    return {...record, binary_valid: true, binary_hash: record.token};
});
const elements = new Map();
function element(id) {
    if (!elements.has(id)) elements.set(id, {
        value: '', disabled: false, textContent: '', className: '',
        handlers: {}, children: [],
        addEventListener(type, fn) { this.handlers[type] = fn; },
        replaceChildren(...children) { this.children = children; this.value = children[0]?.value || ''; },
        classList: {contains(name) { return element(id).className === name; }},
    });
    return elements.get(id);
}
element('scenario').value = 'setup';
const context = {
    console, Uint32Array, ArrayBuffer, Set, Map, BigInt,
    document: {getElementById: element, createElement: () => ({})},
    fetch: async url => {
        if (url === '/api/lumps/list') return {ok: true, json: async () => rows};
        const row = rows.find(item => url.startsWith('/api/lump/' + item.token + '/words?exact_filename='));
        assert(row, 'only read-only exact saved binary GETs allowed: ' + url);
        const binary = fs.readFileSync(path.join(dir, '../server/lumps', row.filename));
        return {ok: true, json: async () => ({
            words: Array.from({length: binary.length / 4}, (_, index) => binary.readUInt32BE(index * 4)),
            binary_hash: row.binary_hash, validation_errors: [],
        })};
    },
};
context.window = context;
context.globalThis = context;
context.bootConfig = {step1: {
    totalNamespaceWords: 16384, namespaceLumpWords: 64, threadLumpWords: 512, threadCount: 3,
}};
vm.createContext(context);
for (const file of ['architecture_contracts.js', 'abstract_gt_manager.js', 'thread_design.js',
    'simulator.js', 'test_alice_mallory_thread_setup.js', 'alice_mallory_lab.js',
    'alice_mallory_lab_ui.js']) {
    vm.runInContext(fs.readFileSync(path.join(dir, file), 'utf8'), context, {filename: file});
}
async function main() {
    const scenario = element('scenario');
    const load = () => element('load').handlers.click();
    const step = () => element('step').handlers.click();
    const run = () => element('run').handlers.click();
    for (const [name, limit] of [['setup', 0], ['roundtrip', 5], ['alice', 17], ['mallory', 11]]) {
        scenario.value = name;
        await load();
        assert(!element('status').className, `${name}: ${element('status').textContent}`);
        assert.strictEqual(element('thread').children.length, 3);
        assert.strictEqual(element('step').disabled, limit === 0);
        if (name === 'roundtrip') {
            step();
            assert.match(element('trace').textContent, /Thread NS\[1\]/);
            element('thread').value = 11;
            element('thread').handlers.change();
            assert.match(element('registers').textContent, /saved private homes/);
            assert.match(element('registers').textContent, /CR11 0x[0-9a-f]{8}/);
            for (const i of [12, 13, 14, 15])
                assert.match(element('registers').textContent,
                    new RegExp(`CR${i} not stored \\(runtime/system CR\\)`));
            element('thread').value = 1;
            element('thread').handlers.change();
            assert.match(element('registers').textContent, /LIVE CPU banks/);
            assert.match(element('registers').textContent, /CR14 0x[0-9a-f]{8}/);
        }
        run();
        assert.match(element('status').textContent, /PASS|Setup validated/, name);
        assert.strictEqual(element('step').disabled, true);
        assert.strictEqual(element('run').disabled, true);
        if (name === 'mallory') {
            assert.match(element('trace').textContent, /FAULT: NO_CAPABILITY/);
            assert.match(element('execution').textContent, /bounded test boundary/);
        }
        await element('reset').handlers.click();
        assert.match(element('status').textContent, /In progress|Setup validated/);
        assert.match(element('trace').textContent, /No instructions attempted/);
        if (name === 'roundtrip') {
            scenario.value = 'alice';
            scenario.handlers.change();
            assert.strictEqual(element('reset').disabled, true,
                'selection invalidates old loaded test instead of changing reset target');
            assert.strictEqual(element('step').disabled, true);
            assert.strictEqual(element('thread').children.length, 0);
            assert.strictEqual(element('execution').textContent, 'No test loaded.');
            assert.strictEqual(element('registers').textContent, 'No test loaded.');
            assert.strictEqual(element('trace').textContent, 'No instructions attempted.');
        }
    }
    // A malformed or missing saved binary fails closed; it must not load a fixture.
    scenario.value = 'roundtrip';
    await load();
    step();
    assert.match(element('trace').textContent, /Thread NS\[1\]/);
    rows[0].binary_valid = false;
    const pending = load();
    assert.strictEqual(element('trace').textContent, 'No instructions attempted.',
        'reload clears old occurrence evidence before network request completes');
    assert.strictEqual(element('registers').textContent, 'No test loaded.');
    await pending;
    assert.match(element('status').textContent, /Load failed/);
    assert.strictEqual(element('step').disabled, true);
    assert.strictEqual(element('thread').children.length, 0);
    assert.strictEqual(element('execution').textContent, 'No test loaded.');
    assert.strictEqual(element('trace').textContent, 'No instructions attempted.');
    console.log('[PASS] browser scripts load; bounded Step/Run/Reset, 12 saved CR homes, scenario change, stale evidence clearing and missing-binary guard');
}
main().catch(err => { console.error(err); process.exitCode = 1; });