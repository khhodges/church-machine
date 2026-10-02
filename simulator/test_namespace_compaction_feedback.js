const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync(__dirname + '/app-memory.js', 'utf8');
const start = source.indexOf('async function _reloadCompactedNamespace(');
const end = source.indexOf('\nasync function checkNamespaceImageRefresh', start);
assert(start >= 0 && end > start);

(async () => {
    const calls = [];
    const state = { abstractions: [{ slot: 6, location: '0x110' }] };
    let feedback;
    const context = {
        window: {},
        sim: new Proxy({}, { get() { throw new Error('Must not touch running simulator'); } }),
        fetch: async url => {
            calls.push(url);
            return { ok: true, json: async () => state };
        },
        updateNamespace: () => calls.push('render'),
        refreshBootCapacity: async () => calls.push('capacity'),
        _imageRefreshResult: result => { feedback = result; },
    };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end), context);
    await context._reloadCompactedNamespace({ committed: true, operationId: 'review' });
    assert.strictEqual(context.window._nsState, state);
    assert.deepStrictEqual(calls, ['/api/boot-image/ns-state', 'render', 'capacity']);
    context.fetch = async () => { throw new Error('network interrupted'); };
    await context._reloadCompactedNamespace({ committed: true, operationId: 'review' });
    assert.strictEqual(feedback.committed, true);
    assert.strictEqual(feedback.operationId, 'review');
    assert.match(feedback.message, /do not repeat publication/);
    assert.strictEqual(context.window._nsState, state);
    console.log('Namespace compaction feedback: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });