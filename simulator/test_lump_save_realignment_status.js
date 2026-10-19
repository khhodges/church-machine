'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync(__dirname + '/lump-save-realignment.js', 'utf8');
function mount(state) {
    const nodes = [];
    const node = tag => ({
        tag, children: [], style: {}, attributes: {},
        setAttribute(key, value) { this.attributes[key] = value; },
        append(child) { this.children.push(child); },
        replaceChildren() { this.children = []; },
    });
    const context = {
        sessionStorage: {getItem: () => JSON.stringify(state), setItem() {}, removeItem() {}},
        document: {
            body: {prepend: n => nodes.push(n)},
            getElementById: id => nodes.find(n => n.id === id),
            createElement: node,
            createTextNode: text => ({textContent:text}),
        },
    };
    context.window = context;
    vm.runInNewContext(code, context);
    return {context, host:nodes[0]};
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
    const close = harness.host.children.find(n => n.textContent === 'Close');
    assert(close, 'every displayed status has a Close button');
    assert.equal(close.type, 'button');
    assert.equal(close.attributes['aria-label'], 'Close saved revision notice');
    close.onclick();
    assert.equal(harness.host.hidden, true);
    assert.equal(harness.context._savedLumpRealignment, state);
    assert.equal(JSON.stringify(state), before, 'dismissal must not alter execution or retry state');
}
dismissAndCheck(ready);
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
console.log('PASS saved-revision banner: restored success, error retry, pending state, dismissal without altering execution');
