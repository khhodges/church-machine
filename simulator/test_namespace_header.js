'use strict';

// Exercise the graduated HTML and real header renderers without live API writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const memory = fs.readFileSync(__dirname + '/app-memory.js', 'utf8');
const design = fs.readFileSync(__dirname + '/namespace-design-v1.js', 'utf8');
const start = html.indexOf('<div id="namespace" class="view">');
const end = html.indexOf('<section id="bootCapacityPanel"', start);
const dom = new JSDOM(html.slice(start, end) + '</div></div>', {
    url: 'https://namespace-header.test/', runScripts: 'outside-only',
});
const w = dom.window;
const doc = w.document;
const calls = [];
w.root = w;
w.esc = value => String(value ?? '').replace(/[&<>"']/g,
    ch => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[ch]));
w.profileLabel = () => 'New Layout — ascending table / four-word header';
w.state = {active:true, persisted:true, dirty:false, loading:false, saving:false, designId:''};
w.eval(memory.slice(memory.indexOf('function _namespaceHeaderIcon('),
    memory.indexOf('function _namespaceDesignSourceNotice(')));
w.eval(design.slice(design.indexOf('    function designStatus()'),
    design.indexOf('    function renderRows(')));

function status() {
    w.refreshHeader();
    return doc.querySelector('#namespaceHeaderStatus');
}
assert.match(status().textContent, /Saved design/);
assert.equal(doc.querySelector('#namespaceDesignStatus .nr-saved').dataset.status, 'saved');
assert.match(doc.querySelector('#namespaceDesignStatus').title, /Loaded from a saved design/);
w.state.dirty = true;
assert.match(status().textContent, /Unsaved local draft/);
assert.equal(doc.querySelector('.nr-saved').dataset.status, 'draft');
w.state.saving = true; w.state.bindingNow = true;
assert.match(status().textContent, /Binding…/);
assert(doc.querySelector('#reloadNamespaceSaved').disabled);
assert(doc.querySelector('#duplicateNamespace').disabled);
w.state.saving = false; w.state.dirty = false; w.state.persisted = false;
assert.match(status().textContent, /Generated defaults — not saved/);
w.state.persisted = null;
assert.match(status().textContent, /Saved status unknown/);
w.state.loading = true;
assert.match(status().textContent, /Loading design/);
w.state.loading = false; w.state.persisted = true;
w.state.designId = 'a'.repeat(32);
assert.match(status().textContent, /Independent copy · test\/approval status is not inherited/);
w.state.active = false; w._nsState = {abstractions:[]};
assert.match(status().textContent, /Saved assignments/);
assert.equal(doc.querySelector('#duplicateNamespace'), null, 'No unsupported legacy duplication');
w._nsPrefetchDirty = true;
assert.match(status().textContent, /Unsaved local draft/);
w.state.active = true; w._nsPrefetchDirty = false; status();

// This is the actual markup builder, not a copy of its presentation.
const toolbar = memory.slice(memory.indexOf('    const _statChip ='),
    memory.indexOf('    // Bank custody status'));
w.eval(`function headerMarkup(ascending) {
    const _cntMax=64, _cntResident=21, _cntLazy=0, _cntGarbage=0, _cntFree=42;
    const _nsSnapshot={counts:{assigned:21}};
    ${toolbar}
    return html;
}`);
w.eval(memory.slice(memory.indexOf('function _namespaceDesignSourceNotice('),
    memory.indexOf('function updateNamespace(')));
doc.querySelector('#namespaceTable').innerHTML = w.headerMarkup(true);
assert.equal(doc.querySelectorAll('.nr-summary dl > div').length, 6);
assert.deepEqual([...doc.querySelectorAll('.nr-summary dd')].map(el=>el.textContent),
    ['64','21','21','0','0','42']);
assert(doc.querySelector('#nsBindPlacementsBtn').hidden);
assert(doc.querySelector('#nsBoltDrag').draggable);
assert.equal(doc.querySelector('#namespaceHeaderDetails').open, false);
assert.equal(doc.querySelector('#nsPrepareLoadBtn').textContent.trim(), 'Prepare');
assert.equal(doc.querySelector('#nsLoadBtn').textContent.trim(), 'Load');
assert.match(doc.querySelector('#nsPrepareLoadBtn').getAttribute('onclick'), /prepareLoad\('prepare'\)/);
assert.match(doc.querySelector('#nsLoadBtn').getAttribute('onclick'), /prepareLoad\('load'\)/);
assert.match(doc.querySelector('#namespaceHeaderDetails').textContent, /Binding is not activation/);
assert.match(doc.querySelector('#namespaceDesignEditingNotice').textContent, /Bind Namespace Design saves/);
assert.equal(doc.querySelector('#nsSaveBtn').closest('[role="group"]').getAttribute('aria-label'),
    'Binding and FPGA preparation');

w.NamespaceSelection = {current:()=> 'namespace:copy:'+'a'.repeat(32)};
w.DevelopmentImageView = {show: key=>calls.push(['glass',key])};
w.NamespaceDesignV1 = {
    reloadSaved:()=>calls.push(['reload']), duplicateNamespace:()=>calls.push(['duplicate']),
    prepareLoad:()=>calls.push(['prepare']), selectShared:async key=>calls.push(['select',key]),
};
w.NamespaceAttention = {open:()=>calls.push(['attention'])};
w._nsTableAdd = ()=>calls.push(['add']);
w._nsTableSaveClick = ()=>calls.push(['save']);
w.alert = message=>calls.push(['boot-help',message]);
function click(id) {
    const button = doc.getElementById(id);
    w.Function('event', button.getAttribute('onclick')).call(button, {stopPropagation(){}});
}
for (const id of ['namespaceSwitchToGlass','reloadNamespaceSaved','duplicateNamespace',
    'nsPrepareLoadBtn','nsAttentionBtn','nsAddEntryBtn','nsSaveBtn','nsBoltDrag']) click(id);
assert.deepEqual(calls.map(call=>call[0]),
    ['glass','reload','duplicate','prepare','attention','add','save','boot-help']);
assert.equal(calls[0][1], 'namespace:copy:'+'a'.repeat(32));
const picker = doc.getElementById('namespaceDesignProfile');
picker.value = 'phase1';
w.Function(picker.getAttribute('onchange')).call(picker);
assert.deepEqual(calls.at(-1), ['select','namespace:phase1']);

doc.querySelector('#namespaceTable').innerHTML = w.headerMarkup(false);
assert.equal(doc.querySelector('#nsBindPlacementsBtn').hidden, false);
assert.match(doc.querySelector('#namespaceDesignEditingNotice').textContent, /Save Namespace Table saves row edits only/);
assert.match(doc.querySelector('#nsDesignSourceNotice').textContent, /not active CR15 state/);
dom.window.close();
console.log('PASS Namespace header: real markup, status variants, exact selection, existing action wiring, counts and legacy separation');
