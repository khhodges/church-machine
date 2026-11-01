'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/app-lump-editor.js', 'utf8');
function loadHandler(context, name) {
    const start = source.indexOf('    window.' + name + ' = function');
    assert(start >= 0, name);
    const end = source.indexOf('\n    };', start) + 7;
    vm.runInContext(source.slice(start, end), context);
}
(async () => {
    const statuses = {};
    let writes = 0, compiles = 0, savedTuples = 0;
    const navigation = [];
    const context = vm.createContext({
        window: {ThreadTupleDesign: {validate: () => []}},
        document: {getElementById: id => statuses[id] ||= {textContent: ''}},
        state: {tuples: [{name: 'AliceProgress'}]},
        _threadDesignKey: 'legacy',
        currentHeapWords: () => 194,
        _tupleApply: (result, message) => {
            assert.equal(result.error, null);
            assert.match(message, /Boot configuration and hardware are unchanged/);
            savedTuples++;
        },
        compileAndBuild: () => { compiles++; },
        switchBuilderViewTab: tab => navigation.push(tab),
        _getStep1Payload: () => ({step1: {threadLumpWords: 512}}),
        fetch: async (_url, options) => {
            if (options.method === 'POST') {
                writes++;
                return {ok: false, json: async () => ({ok: false, error: 'Review rejected'})};
            }
            return {ok: true, json: async () => ({config: {step1: {threadLumpWords: 256}}})};
        },
    });
    const start = source.indexOf('    function _postStep1(');
    const end = source.indexOf('\n    // ── Resident Lumps', start);
    vm.runInContext(source.slice(start, end), context);
    ['lumpEditorSaveThread', 'lumpEditorPostStep1', 'lumpEditorNextStep',
        'lumpEditorTupleSave'].forEach(name => loadHandler(context, name));
    context.window.lumpEditorTupleSave();
    assert.equal(savedTuples, 1);
    assert.equal(writes, 0);
    assert.equal(compiles, 0);
    assert.equal(navigation.length, 0);
    assert.equal(await context.window.lumpEditorSaveThread(), false);
    assert.equal(writes, 1);
    assert.equal(compiles, 0, 'review must not compile unrelated editor contents');
    assert.equal(navigation.length, 0, 'rejection stays on the Thread page');
    assert.match(statuses['le-t-step1-err'].textContent, /Review rejected/);
    context.window.lumpEditorNextStep('lump-resident');
    context.window.lumpEditorNextStep('lump-thread');
    assert.deepEqual(navigation, ['lump-resident', 'lump-thread']);
    assert.equal(writes, 1, 'browsing must not submit boot geometry');
    assert.equal(compiles, 0);
    console.log('PASS tuple save boundary: local save, rejected review, navigation without writes or compilation');
})().catch(error => { console.error(error); process.exitCode = 1; });
