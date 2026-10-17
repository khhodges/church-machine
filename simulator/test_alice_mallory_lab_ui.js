'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const dir = __dirname;
const {createHash, webcrypto} = require('crypto');
const {savedFixtures} = require('./test_alice_mallory_thread_setup');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, '../server/lumps/manifest.json')));
// Full multi-revision catalog in reverse order; pinned history is deliberately
// archived to prove we neither choose "latest" nor depend on active uniqueness.
const rows = manifest.slice().reverse().map(record => {
    if (!Object.values(savedFixtures).includes(record.filename)) return record;
    const raw = fs.readFileSync(path.join(dir, '../server/lumps', record.filename));
    return {...record, archived: true, binary_valid: true,
        binary_hash: createHash('sha256').update(raw).digest('hex')};
});
const requests = [];
let corruptWords = false;
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
    console, Uint32Array, ArrayBuffer, Set, Map, BigInt, crypto: webcrypto,
    document: {getElementById: element, createElement: () => ({})},
    fetch: async url => {
        requests.push(url);
        const parsed = new URL(url, 'https://example.test');
        if (parsed.pathname === '/api/lumps/list') return {ok: true, json: async () =>
            rows.filter(row => row.archived !== true ||
                parsed.searchParams.get('include_archived') === '1')};
        const filename = parsed.searchParams.get('exact_filename');
        assert(Object.values(savedFixtures).includes(filename), 'only exact pinned fixtures allowed');
        const row = rows.find(item => item.filename === filename &&
            parsed.pathname === '/api/lump/' + item.token + '/words');
        assert(row, 'only read-only exact saved binary GETs allowed: ' + url);
        const binary = fs.readFileSync(path.join(dir, '../server/lumps', row.filename));
        const words = Array.from({length: binary.length / 4},
            (_, index) => binary.readUInt32BE(index * 4));
        if (corruptWords) words[3] ^= 1;
        return {ok: true, json: async () => ({
            words,
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
    for (const [name, limit] of [['setup', 0], ['roundtrip', 5], ['alice', 18], ['mallory', 12]]) {
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
        assert.strictEqual((element('trace').textContent.match(/: retired/g) || []).length,
            limit - (name === 'mallory' ? 1 : 0), `${name}: actual retirements`);
        const trace = element('trace').textContent;
        step(); run();
        assert.strictEqual(element('trace').textContent, trace, 'bounded controls do not execute again');
        if (name === 'mallory') {
            assert.match(element('trace').textContent, /FAULT: NO_CAPABILITY/);
            assert.match(element('execution').textContent, /bounded test boundary/);
            assert.doesNotMatch(element('trace').textContent, /opcode 16/);
            assert.match(element('trace').textContent, /c-list index 2 is out of bounds/);
        }
        if (name === 'alice') {
            assert.match(element('trace').textContent, /opcode 17: retired/);
            assert.match(element('trace').textContent, /opcode 16: retired/);
            assert.match(element('registers').textContent, /Alice private resident word: 0x000002a7/);
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
    const pinned = rows.find(row => row.filename === savedFixtures['ide.Alice']);
    pinned.binary_valid = false;
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
    pinned.binary_valid = true;
    corruptWords = true;
    await load();
    assert.match(element('status').textContent, /Load failed.*pinned binary integrity mismatch/);
    corruptWords = false;
    pinned.filename = 'missing-pinned.lump';
    await load();
    assert.match(element('status').textContent, /Load failed.*exact valid saved fixture/);
    assert.strictEqual(element('step').disabled, true);
    assert(requests.every(url => url === '/api/lumps/list?include_archived=1' ||
        url.includes('/words?exact_filename=')),
        'no save, compile, Namespace or hardware endpoints used');
    console.log('[PASS] browser scripts load; bounded Step/Run/Reset, 12 saved CR homes, scenario change, stale evidence clearing and missing-binary guard');
}
main().catch(err => { console.error(err); process.exitCode = 1; });