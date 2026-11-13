'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const source = fs.readFileSync(__dirname + '/namespace-design-v1.js', 'utf8');
const dom = new JSDOM('<select id="namespaceDesignProfile"></select>', {runScripts:'outside-only'});
const w = dom.window;
w.copies = [{id:'test', name:'Saved & reviewed'}];
w.state = {loading:false, saving:false};
w.key = 'namespace:legacy';
w.selectionKey = () => w.key;
w.esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
w.eval(source.slice(source.indexOf('    function syncNamespacePicker()'),
    source.indexOf('    function render()')));
const selector = w.document.querySelector('select');
w.syncNamespacePicker();
const originalOption = selector.options[0];
const observer = new w.MutationObserver(()=>{});
observer.observe(selector, {subtree:true, childList:true, attributes:true});
for (let i=0; i<100; i++) w.syncNamespacePicker();
assert.equal(selector.options[0], originalOption, 'refresh retains native option nodes');
assert.equal(observer.takeRecords().length, 0, 'refresh leaves the open menu DOM untouched');
// Exercise actual change dispatch, followed by the normal renderer synchronization.
selector.addEventListener('change', () => {w.key='namespace:'+selector.value;});
for (const value of ['ascending','copy:test','phase1','legacy']) {
    selector.value=value;
    selector.dispatchEvent(new w.Event('change'));
    w.syncNamespacePicker();
    assert.equal(selector.value, value);
    assert.equal(selector.options[0], originalOption);
}
w.copies.push({id:'second', name:'Another Namespace'});
w.syncNamespacePicker();
assert.equal(selector.options.length, 5, 'catalog changes still populate options');
assert.equal(selector.value, 'legacy', 'catalog refresh preserves current choice');
w.state.loading=true;
w.syncNamespacePicker();
assert.equal(selector.disabled, true);
w.state.loading=false;
w.syncNamespacePicker();
assert.equal(selector.disabled, false);
observer.disconnect();
dom.window.close();
console.log('PASS Namespace picker: stable refresh, change selection, copy catalog, busy state');
