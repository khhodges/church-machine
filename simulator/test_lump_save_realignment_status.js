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
assert.equal(ready.host.attributes['data-state'], 'success');
assert.equal(ready.host.children[0].textContent, 'Saved revision ready. Use Run or Step in Namespace. ');
assert.equal(ready.host.children.filter(n => n.textContent === 'Retry saved-revision alignment').length, 0);
assert.equal(ready.host.style.borderColor, '#4ade80');
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
dismissAndCheck(ready);
const newRevision = mount({...ready.context._savedLumpRealignment,
    retryInput:{...retryInput,response:{token:'new-saved',lump_version:4}}}, new Map(ready.storage));
assert.equal(newRevision.host.hidden, false, 'a genuinely different revision is not suppressed');
const failed = mount({pending:false, message:'LUMP saved; realignment incomplete. Connection failed.', retryInput});
assert.equal(failed.host.attributes['data-state'], 'error');
assert.match(failed.host.children[0].textContent, /Connection failed/);
assert.equal(failed.host.children[1].textContent, 'Retry saved-revision alignment');
assert.equal(typeof failed.host.children[1].onclick, 'function');
dismissAndCheck(failed);
failed.context.LumpSaveRealignment.begin();
assert.equal(failed.host.hidden, false, 'a new operation displays its own status');
assert.equal(failed.host.attributes['data-state'], 'pending');
assert.equal(failed.host.children.filter(n => n.textContent === 'Retry saved-revision alignment').length, 0);
dismissAndCheck(failed);
assert.equal(mount(null).host.hidden, true);
console.log('PASS saved-revision banner: persistent dismissal across repeated reloads, new revision/operation visibility, error retry, unchanged execution state');
