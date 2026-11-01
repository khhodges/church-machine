'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const T = require('./thread-tuple-design');
const source = fs.readFileSync(__dirname + '/app-lump-editor.js', 'utf8');
const storage = new Map();
const rows = [
    {slot: 0, name: 'Boot.NS'},
    {slot: 11, name: 'Thread.2', header_typ: 2, limit: '0xFF'},
    {slot: 12, name: 'Thread.3', header_typ: 2, limit: '0x1FF'},
    {slot: 20, name: 'Alice.Worker', header_typ: 2, limit: 255}
];
let writes = 0;
function open() {
    const window = {ThreadTupleDesign: T, ThreadRegisterDesign: require('./thread-register-design.js'),
        ThreadDesign: JSON.parse(fs.readFileSync(__dirname + '/../shared/thread_design.json')),
        addEventListener() {}};
    const ctx = vm.createContext({window, console, setTimeout,
        localStorage: {getItem: k => storage.get(k) || null, setItem: (k,v) => storage.set(k,v)},
        document: {getElementById: () => null, activeElement: null},
        fetch() { writes++; throw Error('Unexpected request'); }});
    vm.runInContext(source.replace(/\}\(\)\);\s*$/, `
        window.test = {loadState, saveState, threadBindings, _getStep1Payload, renderNSPanel,
            state: () => state, rows: r => { _nsDrill.entries = r; }};
    }());`), ctx);
    window.test.loadState();
    window.test.rows(rows);
    return window;
}
const key = row => T.bindingKey('Boot.NS', row);
storage.set('lump_editor_state', JSON.stringify({
    thread: {lumpPow2: 8, stackFrames: 17, count: 2}, tuples: [T.TEMPLATES.counter.make(0)]
}));
let w = open();
assert.equal(w.test.threadBindings().length, 3);
w.lumpEditorSelectThread(key(rows[1]));
assert.equal(w.test.state().tuples.length, 0, 'legacy tuples never assigned implicitly');
w.lumpEditorThreadLumpSize(10);
w.lumpEditorThreadStack(24);
w.test.state().tuples = [T.TEMPLATES.counter.make(4)];
w.test.state().tuples[0].name = 'AliceProgress';
w.lumpEditorTupleSave();
w.lumpEditorSelectThread(key(rows[2]));
assert.equal(w.test.state().thread.lumpPow2, 9);
assert.equal(w.test.state().tuples.length, 0);
w.lumpEditorThreadStack(30);
w.test.state().tuples = [T.TEMPLATES.custom.make(7)];
w.test.state().tuples[0].name = 'MalloryAttempts';
w.lumpEditorTupleSave();
// Fresh script instance models browser reload.
w = open();
assert.equal(w.test.state().tuples[0].name, 'MalloryAttempts');
assert.equal(w.test.state().thread.stackFrames, 30);
w.lumpEditorSelectThread(key(rows[1]));
assert.equal(w.test.state().thread.lumpPow2, 10);
assert.equal(w.test.state().thread.stackFrames, 24);
assert.equal(w.test.state().tuples[0].name, 'AliceProgress');
assert.equal(w.test.state().tuples[0].offset, 4);
assert.equal(w.test._getStep1Payload().step1.threadLumpWords, 256, 'individual draft cannot leak into global build');
w.lumpEditorSaveThread();
w.lumpEditorPostStep1();
assert.match(w.test.renderNSPanel(), /Edit shared boot layout/);
assert.doesNotMatch(w.test.renderNSPanel(), /lumpEditorThreadCount|lumpEditorPostStep1/);
w.lumpEditorThreadCount(3);
assert.equal(w.test.state().thread.count, 1, 'global count cannot edit an individual Thread');
assert.equal(writes, 0, 'switching, editing, local saves and bound review never submit builds');
w.lumpEditorSelectThread('legacy');
assert.match(w.test.renderNSPanel(), /lumpEditorThreadCount/);
w.lumpEditorThreadCount(3);
assert.equal(w.test._getStep1Payload().step1.threadCount, 3, 'visible global count matches submitted count');
assert.equal(w.test.state().thread.stackFrames, 17);
assert.equal(w.test.state().tuples[0].name, 'Counter');
rows[2] = {...rows[2], seq: 1};
w.test.rows(rows);
w.lumpEditorSelectThread(key(rows[2]));
assert.equal(w.test.state().tuples.length, 0, 'same-name reused slot cannot inherit Mallory');
assert.equal(w.test.state().thread.stackFrames, 16);
w.test.state().tuples = [T.TEMPLATES.counter.make(0)];
w.lumpEditorTupleSave();
rows[2] = {...rows[2], seal: 'new-artifact', filename: 'revision-2.lump'};
w.test.rows(rows);
w.lumpEditorSelectThread('legacy');
w.lumpEditorSelectThread(key(rows[2]));
assert.equal(w.test.state().tuples.length, 1, 'artifact revision within same binding retains draft');
assert.notEqual(T.bindingKey('Boot.NS', rows[2], 1), key(rows[2]), 'Namespace reuse has distinct ownership');
rows[1] = {...rows[1], name: 'Replacement.Thread'};
w.test.rows(rows);
w.lumpEditorSelectThread(key(rows[1]));
assert.equal(w.test.state().tuples.length, 0, 'replacement occupant cannot inherit Alice');
assert.notEqual(T.bindingKey('Other.NS', rows[2]), key(rows[2]));
console.log('PASS independent Thread designs: migration, Alice/Mallory, reload, replacement, build isolation');
