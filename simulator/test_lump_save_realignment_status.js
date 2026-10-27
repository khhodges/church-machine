'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync(__dirname + '/lump-save-realignment.js', 'utf8');
function mount(state, storage = new Map()) {
    if (state !== undefined) storage.set('savedLumpRealignment', JSON.stringify(state));
    const nodes = [];
    const node = tag => ({
        tag, children: [], style: {}, attributes: {},
        setAttribute(key, value) { this.attributes[key] = value; },
        append(child) { this.children.push(child); },
        replaceChildren() { this.children = []; },
    });
    const context = {
        sessionStorage: {getItem: key => storage.get(key) || null,
            setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)},
        document: {
            body: {prepend: n => nodes.push(n)},
            getElementById: id => nodes.find(n => n.id === id),
            createElement: node,
            createTextNode: text => ({textContent:text}),
        },
    };
    context.window = context;
    vm.runInNewContext(code, context);
    return {context, host:nodes[0], storage};
}
const retryInput = {response:{token:'saved'}, metadata:{}};
const ready = mount({pending:false, privateReady:true,
    message:'Saved revision selected and verified in the selected design’s private simulator. Legacy execution remains stopped.',
    retryInput});
assert.equal(ready.host.hidden, true, 'saved success is never replayed as a popup');
assert.equal(ready.host.children.length, 0, 'no redundant success message or Close control');
assert.equal(ready.context._savedLumpRealignment.privateReady, true,
    'display correction preserves the execution barrier');
assert.equal(ready.context._savedLumpRealignment.retryInput.response.token, retryInput.response.token);
function dismissAndCheck(harness) {
    const state = harness.context._savedLumpRealignment;
    const before = JSON.stringify(state);
    const storedBefore = harness.storage.get('savedLumpRealignment');
    const close = harness.host.children.find(n => n.textContent === 'Close');
    assert(close, 'every displayed status has a Close button');
    assert.equal(close.type, 'button');
    assert.equal(close.attributes['aria-label'], 'Close saved revision notice');
    close.onclick();
    assert.equal(harness.host.hidden, true);
    assert.equal(harness.context._savedLumpRealignment, state);
    assert.equal(JSON.stringify(state), before, 'dismissal must not alter execution or retry state');
    assert.equal(harness.storage.get('savedLumpRealignment'), storedBefore,
        'dismissal must not alter persisted execution state');
    // Re-evaluate on the existing document, then on fresh documents sharing
    // the same storage: redraw/navigation and repeated full reloads.
    vm.runInNewContext(code, harness.context);
    assert.equal(harness.host.hidden, true, 'same notice stays dismissed on re-render');
    for (let i=0;i<3;i++) {
        const reloaded = mount(undefined, harness.storage);
        assert.equal(reloaded.host.hidden, true, 'same notice stays dismissed after reload '+i);
        assert.equal(reloaded.context._savedLumpRealignment.message, state.message);
        assert.equal(reloaded.storage.get('savedLumpRealignment'), storedBefore);
    }
}
for (let i=0;i<3;i++) {
    // Reproduce restoration without the separate dismissal key, which the
    // earlier close/reload-only regression did not cover.
    ready.storage.delete('savedLumpRealignmentDismissedNotice');
    const restored = mount(undefined,ready.storage);
    assert.equal(restored.host.hidden,true,'restored success stays absent without a dismissal marker');
    assert.equal(restored.context._savedLumpRealignment.privateReady,true);
}
const newRevision = mount({...ready.context._savedLumpRealignment,
    retryInput:{...retryInput,response:{token:'new-saved',lump_version:4}}}, new Map(ready.storage));
assert.equal(newRevision.host.hidden, true, 'another successful revision also needs no popup');
const failed = mount({pending:false, message:'LUMP saved; realignment incomplete. Connection failed.', retryInput});
assert.equal(failed.host.attributes['data-state'], 'previous');
assert.match(failed.host.children[0].textContent, /Previous preparation attempt — saved/);
assert.match(failed.host.children[0].textContent, /Current Namespace state has not been rechecked/);
assert.match(failed.host.children[0].textContent, /Connection failed/);
assert.equal(failed.host.children[1].textContent, 'Retry simulation preparation');
assert.match(failed.host.children[1].title, /Does not compile/);
assert.equal(typeof failed.host.children[1].onclick, 'function');
dismissAndCheck(failed);
failed.context.LumpSaveRealignment.begin();
assert.equal(failed.host.hidden, false, 'a new operation displays its own status');
assert.equal(failed.host.attributes['data-state'], 'pending');
assert.doesNotMatch(failed.host.children[0].textContent, /Previous preparation attempt/);
assert(Number.isFinite(Date.parse(failed.context._savedLumpRealignment.recordedAt)));
assert.equal(failed.host.children.filter(n => n.textContent === 'Retry simulation preparation').length, 0);
dismissAndCheck(failed);
assert.equal(mount(null).host.hidden, true);
const interrupted = mount({pending:true,message:'Preparing saved revision',retryInput:{
    response:{token:'saved',lump:'ide.Example.1.token.lump',lump_version:4},metadata:{}
},recordedAt:'2026-10-27T21:00:00.000Z'});
assert.match(interrupted.host.children[0].textContent,
    /ide.Example.1.token.lump \(saved revision 4\)/);
assert.match(interrupted.host.children[0].textContent, /Recorded 2026-10-27/);
assert.match(interrupted.host.children[0].textContent,
    /interrupted; completion is unconfirmed/);
assert.equal(interrupted.context._savedLumpRealignment.privateReady, undefined);
dismissAndCheck(interrupted);
const legacy = mount({pending:false,message:'Namespace has unsaved edits'});
assert.match(legacy.host.children[0].textContent, /saved revision unavailable/);
assert.match(legacy.host.children[0].textContent, /Previous report: Namespace has unsaved edits/);
assert(!legacy.host.children.some(n=>n.textContent==='Retry simulation preparation'),
    'missing retry identity cannot invent a destination or trigger preparation');
for (const state of [
    {pending:false, reason:'namespace-unassigned', message:'old wording', retryInput},
    {pending:false, message:'LUMP saved; realignment incomplete. This saved LUMP has no Namespace assignment. Select a destination before simulation.', retryInput},
]) {
    const unassigned = mount(state);
    assert.match(unassigned.host.children[0].textContent, /LUMP saved successfully/);
    assert.match(unassigned.host.children[0].textContent, /no destination Namespace slot selected/);
    assert.deepEqual(unassigned.host.children.filter(n => n.tag === 'button').map(n => n.textContent), ['Close']);
    assert.equal(unassigned.context._savedLumpRealignment.reason, 'namespace-unassigned');
    dismissAndCheck(unassigned);
}
console.log('PASS saved-revision notices: no success popup even without dismissal storage; pending/error dismissal, retry and execution state preserved');
