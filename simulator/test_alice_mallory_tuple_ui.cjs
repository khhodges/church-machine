const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const elements = new Map();
function el(id) {
    if (!elements.has(id)) elements.set(id, {
        value:'', textContent:'', className:'', disabled:false, children:[], handlers:{},
        addEventListener(type, fn) { this.handlers[type] = fn; },
        replaceChildren(...nodes) { this.children = nodes; this.value = nodes[0]?.value || ''; },
        classList:{contains(name) { return el(id).className === name; }},
    });
    return elements.get(id);
}
const rows = JSON.parse(fs.readFileSync(path.join(__dirname, '../server/lumps/manifest.json')));
const context = {console, TextEncoder, TextDecoder, URLSearchParams, Uint32Array,
    document:{getElementById:el, createElement:() => ({})},
    location:{search:'?scenario=tuple-mallory'},
    bootConfig:{step1:{totalNamespaceWords:16384,namespaceLumpWords:64,threadLumpWords:512,threadCount:3}},
    fetch:async url => {
        const hash = raw => createHash('sha256').update(raw).digest('hex');
        if (url === '/api/lumps/list') return {ok:true, json:async () => rows.map(row =>
            Object.values(context.AliceMalloryTupleLab.savedFixtures).includes(row.filename)
                ? {...row, binary_valid:true, binary_hash:hash(fs.readFileSync(path.join(__dirname,'../server/lumps',row.filename)))}
                : row)};
        const parsed = new URL(url, 'https://example.test');
        assert(parsed.pathname.startsWith('/api/lump/'), 'read-only binary endpoint');
        const filename = parsed.searchParams.get('exact_filename');
        assert(Object.values(context.AliceMalloryTupleLab.savedFixtures).includes(filename));
        const raw = fs.readFileSync(path.join(__dirname, '../server/lumps', filename));
        return {ok:true,json:async () => ({words:Array.from({length:raw.length/4},(_,i)=>raw.readUInt32BE(i*4)),
            binary_hash:hash(raw), validation_errors:[]})};
    }};
context.window = context;
context.globalThis = context;
vm.createContext(context);
for (const filename of ['architecture_contracts.js','abstract_gt_manager.js','thread_design.js',
    'simulator.js','test_alice_mallory_thread_setup.js','thread-heap-record.js',
    'alice_mallory_tuple_lab.js','alice_mallory_lab.js','alice_mallory_lab_ui.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname,filename),'utf8'), context, {filename});
(async () => {
    assert.equal(el('scenario').value, 'tuple-mallory');
    for (const scenario of ['tuple-alice', 'tuple-mallory']) {
        el('scenario').value = scenario;
        await el('load').handlers.click();
        assert.equal(el('status').className, '', el('status').textContent);
        el('run').handlers.click();
        assert.match(el('status').textContent, /^PASS:/);
        assert.equal(el('run').disabled, true);
        assert.match(el('tuple-evidence').textContent, /unchanged.*true/);
        await el('reset').handlers.click();
        assert.match(el('tuple-evidence').textContent, /not entered/);
    }
    console.log('Tuple lab UI: load, run, evidence, reset and deep-link passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
