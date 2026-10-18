const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(__dirname + '/namespace-design-v1.js', 'utf8');
const values = new Map();
const storage = {getItem: key => values.get(key), setItem: (key, value) => values.set(key, value)};
function start(localStorage = storage, linkedProfile) {
    const selector = {};
    const ctx = {localStorage, updateNamespace() {}, document: {
        readyState: 'loading', addEventListener() {},
        getElementById: id => id === 'namespaceDesignProfile' ? selector : null,
    }};
    ctx.window = ctx;
    if(linkedProfile) {
        ctx.URLSearchParams=URLSearchParams;ctx.URL=URL;
        ctx.location=new URL('https://example.invalid/simulator/?namespaceProfile='+linkedProfile+'#namespace');
        ctx.history={replaceState(_state,_title,url){ctx.location=new URL(url);}};
    }
    vm.runInNewContext(source, ctx);
    ctx.NamespaceDesignV1.render();
    return {api: ctx.NamespaceDesignV1, selector, context:ctx};
}
for (const profile of ['phase1', 'legacy', 'ascending']) {
    const first = start();
    first.api.setProfile(profile);
    const restarted = start();
    assert.equal(restarted.selector.value, profile);
    assert.equal(restarted.api.state.active, profile !== 'legacy');
}
const first = start();
first.api.state.loading = true;
first.api.setProfile('phase1');
assert.equal(start().selector.value, 'ascending', 'busy switches must not persist');
values.set('church_namespace_design_profile', 'invalid');
assert.equal(start().selector.value, 'ascending');
assert.equal(start({getItem() { throw Error('denied'); }}).selector.value, 'ascending');
values.set('church_namespace_design_profile','ascending');
const linked=start(storage,'phase1');
assert.equal(linked.selector.value,'phase1','explicit Phase 1 link overrides stale browser preference');
assert.equal(values.get('church_namespace_design_profile'),'ascending','opening link does not rewrite preferences');
assert.equal(start({getItem(){throw Error('denied');}},'phase1').selector.value,'phase1');
assert.equal(start(storage,'legacy').selector.value,'legacy');
linked.api.setProfile('ascending');
assert.equal(linked.context.location.search,'?namespaceProfile=ascending','profile switch updates explicit link for reload');
const phase1 = start().api;
phase1.state.profile = 'phase1';
phase1.state.document = {rows: [{slot:16, kind:'lump', policy:'Resident'}]};
phase1.policy(16, 'Lazy');
assert.equal(phase1.state.document.rows[0].policy, 'Resident');
const memorySource = fs.readFileSync(__dirname + '/app-memory.js', 'utf8');
const policyTemplate = memorySource.match(/<select id="_nsLoadPolicy"[\s\S]*?<\/select>/)[0];
const renderPolicy = new Function('phase1Design', 'loadPolicyDefault', 'sSelect',
    'return `' + policyTemplate + '`;');
const residentOnly = renderPolicy(true, 'Resident', '');
assert.match(residentOnly, /disabled/);
assert.match(residentOnly, /value="Resident"/);
assert.doesNotMatch(residentOnly, /value="(?:Lazy|Preload)"/);
assert.match(renderPolicy(false, 'Lazy', ''), /value="Lazy" selected/);
console.log('Namespace profile persistence and Resident policy: PASS');
