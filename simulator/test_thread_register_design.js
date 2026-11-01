'use strict';
// Per-Thread initial register design: helper + editor integration.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const T = require('./thread-tuple-design');
const RD = require('./thread-register-design');
const source = fs.readFileSync(__dirname + '/app-lump-editor.js', 'utf8');

// Pure helper
assert.deepEqual(RD.parseWord(''), {value: null});
assert.deepEqual(RD.parseWord('  '), {value: null});
assert.deepEqual(RD.parseWord('0'), {value: 0});
assert.deepEqual(RD.parseWord('0x0'), {value: 0});
assert.deepEqual(RD.parseWord('0xffffffff'), {value: 0xFFFFFFFF});
assert.deepEqual(RD.parseWord('4294967295'), {value: 4294967295});
assert.ok(RD.parseWord('4294967296').error);
assert.ok(RD.parseWord('0x1FFFFFFFF').error);
assert.ok(RD.parseWord('-1').error);
assert.ok(RD.parseWord('12abc').error);
assert.equal(RD.informGT({slot: 23, seq: 5}), (0x4a000000 | (5 << 16) | 23) >>> 0);
const bad = RD.blankDraft(); bad.dr[3] = 'zz';
assert.throws(() => RD.initialization(bad), /DR3/);
assert.equal(bad.dr[3], 'zz', 'invalid draft preserved');
const ok = RD.blankDraft(); ok.dr[0] = '0'; ok.cr[2] = '0x10';
const init = RD.initialization(ok);
assert.equal(init.dataRegisters.length, 16); assert.equal(init.capabilityRegisters.length, 12);
assert.equal(init.dataRegisters[0], 0, 'zero is a value, not default');
assert.equal(init.dataRegisters[1], null, 'blank is null');
assert.equal(init.capabilityRegisters[2], 16);

// Editor harness
const storage = new Map();
const nsRows = [
    {slot: 0, name: 'Boot.NS', seq: 1},
    {slot: 9, name: 'Boot.Thread', header_typ: 2, limit: 255, seq: 0, boot: true},
    {slot: 11, name: 'Thread.2', header_typ: 2, limit: 255, seq: 2},
    {slot: 12, name: 'Thread.3', header_typ: 2, limit: 255, seq: 0},
    {slot: 31, name: 'ide.Alice', seq: 4}
];
let requests = [], replies = [], confirmAnswer = true;
function open(rows) {
    const window = {ThreadTupleDesign: T, ThreadRegisterDesign: RD,
        ThreadDesign: JSON.parse(fs.readFileSync(__dirname + '/../shared/thread_design.json')),
        addEventListener() {}, confirm: () => confirmAnswer};
    const ctx = vm.createContext({window, console, setTimeout,
        localStorage: {getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v)},
        document: {getElementById: () => null, activeElement: null},
        fetch(url, opts) { requests.push({url, opts: opts || {}}); const r = replies.shift();
            return Promise.resolve({ok: r.status < 300, status: r.status, json: () => Promise.resolve(r.body)}); }});
    vm.runInContext(source.replace(/\}\(\)\);\s*$/, `
        window.test = {loadState, saveState, state: () => state, msg: () => _regMsg,
            panel: () => renderRegisterPanel(), rows: r => { _nsDrill.entries = r; }};
    }());`), ctx);
    window.test.loadState();
    window.test.rows(rows);
    return window;
}
const key = row => T.bindingKey('Boot.NS', row, 1);
(async () => {
    let w = open(nsRows);
    w.lumpEditorSelectThread(key(nsRows[2]));
    w.lumpEditorRegSet('dr', 0, '0');
    w.lumpEditorRegSet('dr', 5, 'nope');
    w.lumpEditorRegSet('cr', 3, '0xDEAD');
    assert.match(w.test.panel(), /le-reg-bad/);
    assert.match(w.test.panel(), /CR15[\s\S]*not serialized/);
    w.lumpEditorSelectThread(key(nsRows[3]));
    assert.equal(w.test.state().regDraft.dr[0], '', 'other Thread untouched');
    w.lumpEditorRegSet('dr', 2, '7');
    w = open(nsRows);
    w.lumpEditorSelectThread(key(nsRows[2]));
    const d = w.test.state().regDraft;
    assert.equal(d.dr[0], '0'); assert.equal(d.dr[5], 'nope', 'invalid persisted as typed'); assert.equal(d.cr[3], '0xDEAD');
    w.lumpEditorSelectThread(key(nsRows[3]));
    assert.equal(w.test.state().regDraft.dr[2], '7');
    w.lumpEditorSelectThread('legacy');
    assert.equal(w.test.state().regDraft.dr[2], '', 'legacy separate');

    // invalid draft blocks save without request
    w.lumpEditorSelectThread(key(nsRows[2]));
    requests = [];
    await w.lumpEditorDesignSave();
    assert.equal(requests.length, 0);
    assert.match(w.test.msg().text, /Save rejected: DR5/);

    // Absent actor preset
    w.lumpEditorRegSet('dr', 5, '');
    await w.lumpEditorRegPreset('mallory');
    assert.match(w.test.msg().text, /Mallory .*not in the current Namespace/);
    assert.equal(w.test.state().regDraft.dr[1], '');
    // Alice preset uses actual slot/seq
    w.lumpEditorRegPreset('alice');
    assert.equal(w.test.state().regDraft.dr[1], '0xA11CE002');
    assert.equal(w.test.state().regDraft.cr[1], RD.hex8(RD.informGT({slot: 31, seq: 4})));
    assert.equal(requests.length, 0, 'preset neither saves nor builds');

    // Snapshot ownership: payload frozen at click
    replies.push({status: 200, body: {ok: true}});
    const p = w.lumpEditorDesignSave();
    w.lumpEditorRegSet('dr', 1, '0x1');
    await p;
    const sent = JSON.parse(requests[0].opts.body);
    assert.equal(requests[0].url, '/api/boot-config/thread-designs');
    assert.equal(sent.initialization.dataRegisters[1], 0xA11CE002);
    assert.equal(sent.initialization.dataRegisters[0], 0);
    assert.equal(sent.initialization.dataRegisters[2], null);
    assert.deepEqual(sent.target, {slot: 11, sequence: 2, namespaceSequence: 1, name: 'Thread.2', namespaceName: 'Boot.NS'});
    assert.ok(Array.isArray(sent.tuples) && sent.sizeWords === 256);
    assert.equal(requests.length, 1, 'save does not build');

    // Rejected save
    requests = []; replies.push({status: 422, body: {ok: false, error: 'preserve policy not allowed for fresh build'}});
    await w.lumpEditorDesignSave();
    assert.match(w.test.msg().text, /Save rejected: preserve policy/);

    // Load approved: requires confirm, replaces draft
    replies.push({status: 200, body: {config: {threadInitialDesigns: [Object.assign({}, sent)]}}});
    confirmAnswer = false;
    await w.lumpEditorDesignLoadApproved();
    assert.equal(w.test.state().regDraft.dr[1], '0x1', 'declined load keeps draft');
    confirmAnswer = true;
    replies.push({status: 200, body: {config: {threadInitialDesigns: [Object.assign({}, sent)]}}});
    await w.lumpEditorDesignLoadApproved();
    assert.equal(w.test.state().regDraft.dr[1], '0xA11CE002');

    // Build: rejected, then success; boot marker required
    requests = []; replies.push({status: 500, body: {ok: false, error: 'tuple overlap'}});
    await w.lumpEditorDesignBuild();
    assert.deepEqual(JSON.parse(requests[0].opts.body), {entrySlot: 9, forHardware: false});
    assert.match(w.test.msg().text, /Build failed: tuple overlap/);
    const w2 = open(nsRows.map(r => Object.assign({}, r, {boot: false})));
    requests = [];
    await w2.lumpEditorDesignBuild();
    assert.equal(requests.length, 0);
    assert.match(w2.test.msg().text, /Exactly one boot marker/);
    console.log('Thread register design: helper, persistence, presets, approval snapshot, load and build passed.');
})().catch(e => { console.error(e); process.exit(1); });
