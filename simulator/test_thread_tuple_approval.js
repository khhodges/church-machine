'use strict';
// Exercise the real approval handler without boot configuration or hardware actions.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const TT = require('./thread-tuple-design.js');
const src = fs.readFileSync(__dirname + '/app-lump-editor.js', 'utf8');
const handler = src.slice(src.indexOf('    window.lumpEditorTupleApprove ='),
    src.indexOf('    window.lumpEditorRenderResidentPanel ='));

(async () => {
    const state = { thread: {lumpPow2: 8, stackFrames: 16}, tuples: [TT.TEMPLATES.counter.make(0)] };
    const requests = [];
    let resolve;
    let consent = true;
    const ctx = {
        state, JSON, Error, _tupleMsg: null, render() {},
        _threadDesignKey: 'alice', _nsDrill: {entries: [{slot: 0, seq: 2, name: 'Test.NS'}]},
        threadBindings: () => [{key: 'alice', row: {slot: 23, seq: 5, name: 'Alice.Thread'}}],
        currentHeapWords: () => 194,
        _getStep1Payload: () => ({step1: {threadLumpWords: 256, threadStackWords: 32}}),
        window: { ThreadTupleDesign: TT, confirm: () => consent },
        fetch(url, options) {
            requests.push({url, options});
            return new Promise(r => { resolve = r; });
        }
    };
    vm.createContext(ctx);
    vm.runInContext(handler, ctx);
    consent = false;
    await ctx.window.lumpEditorTupleApprove();
    assert.equal(requests.length, 0);
    consent = true;
    const pending = ctx.window.lumpEditorTupleApprove();
    state.tuples[0].name = 'EditedAfterApproval';
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/boot-config/thread-tuples');
    const payload = JSON.parse(requests[0].options.body);
    assert.equal(payload.tuples[0].name, 'Counter');
    assert.equal(payload.sizeWords, 256);
    assert.deepStrictEqual(payload.target, {slot: 23, sequence: 5, namespaceSequence: 2,
        name: 'Alice.Thread', namespaceName: 'Test.NS'});
    resolve({ok: true, json: async () => ({ok: true})});
    await pending;
    assert.equal(ctx._tupleMsg.err, false);
    const failure = ctx.window.lumpEditorTupleApprove();
    resolve({ok: false, json: async () => ({error: 'Geometry changed'})});
    await failure;
    assert.equal(ctx._tupleMsg.err, true);
    assert.match(ctx._tupleMsg.text, /Geometry changed/);
    console.log('Tuple approval: cancellation, frozen snapshot, metadata-only request, and error handling passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
