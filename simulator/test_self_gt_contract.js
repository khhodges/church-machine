'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const {execFileSync} = require('child_process');
const Sim = require('./simulator.js');
for (const tier of [0, 1, 2]) {
    const compiled = JSON.parse(execFileSync(process.execPath, ['server/compile_worker.js'], {
        input: JSON.stringify({source: 'abstraction ide.Owner {\nmethod Run() {\nRETURN\n}\n}',
            language: 'javascript', tier}), encoding: 'utf8'}));
    assert(compiled.ok, compiled.error);
    const words = compiled.words, cc = words[0] & 255;
    assert.equal(words[words.length - cc], 0);
    const sim = new Sim();
    for (const [slot, seq] of [[20, 0], [21, 511]]) {
        const result = sim._mintOrdinaryLumpIdentity(words, slot, 4096,
            {compilerOwnedSelf: true, destinationSequence: seq});
        assert(result.ok, result.message);
        assert.equal(result.words[words.length - cc] >>> 0, (0x4a000000 | seq << 16 | slot) >>> 0);
        assert.equal(words[words.length - cc], 0, 'saved words remain immutable');
        const corrupt = words.slice();
        corrupt[corrupt.length - cc] = 0x4a000009;
        assert.equal(sim._mintOrdinaryLumpIdentity(corrupt, slot, 4096,
            {compilerOwnedSelf: true, destinationSequence: seq}).ok, false);
    }
}
// All three inspection surfaces consume the selected exact word array.
let shown, identityWords, buttons = [];
const elements = {lumpHistoryPreviewModal:{dataset:{}}, selfBindingToggle:{}};
const context = vm.createContext({
    document:{getElementById:id => elements[id]},
    _fmtEscape:String,
    _renderSavedLumpIdentity:(data, words) => {identityWords=words; return '';},
    _savedGtButton:(word,row) => {buttons.push([word,row]); return String(word);},
    _showLumpHistoryPreviewModal:(version,html) => {shown=html;},
});
vm.runInContext(fs.readFileSync('simulator/self-binding-inspection.js','utf8'), context);
const item = {sourceWords:[0xf8000001,0],boundWords:[0xf8000001,0x4bff0015],
    slot:21,sequence:511,status:'bound',namespaceFingerprint:'namespace',
    sourceHash:'source',derivativeHash:'bound',filename:'exact.lump'};
context._openBoundLumpInspection(item);
assert.strictEqual(identityWords,item.boundWords);
assert.deepEqual(buttons,[[0x4bff0015,0]]);
assert(shown.includes('not installed or running'));
buttons=[];
elements.selfBindingToggle.onclick();
assert.strictEqual(identityWords,item.sourceWords);
assert.deepEqual(buttons,[[0,0]]);
assert(shown.includes('Original saved revision'));
console.log('PASS SELF profiles, simulator installation, rebind identity and exact inspection bytes');
