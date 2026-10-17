const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createHash, webcrypto} = require('node:crypto');
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
    ArrayBuffer, crypto:webcrypto,
    document:{getElementById:el, createElement:() => ({})},
    location:{search:'?scenario=tuple-mallory-foreign-write'},
    bootConfig:{step1:{totalNamespaceWords:16384,namespaceLumpWords:64,threadLumpWords:512,threadCount:3}},
    fetch:async url => {
        const hash = raw => createHash('sha256').update(raw).digest('hex');
        const parsed = new URL(url, 'https://example.test');
        if (parsed.pathname === '/api/lumps/list') return {ok:true, json:async () =>
            rows.filter(row => row.archived !== true ||
                parsed.searchParams.get('include_archived') === '1').map(row =>
            Object.values(context.AliceMalloryTupleLab.savedFixtures).includes(row.filename)
                ? {...row, binary_valid:true, binary_hash:hash(fs.readFileSync(path.join(__dirname,'../server/lumps',row.filename)))}
                : row)};
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
    assert.equal(el('scenario').value, 'tuple-mallory-foreign-write');
    const html = fs.readFileSync(path.join(__dirname, 'alice-mallory-lab.html'), 'utf8');
    const scenarios = [
        ['tuple-alice', null, null],
        ['tuple-mallory', 'NULL_CAP', 16],
        ['tuple-mallory-own', null, 16],
        ['tuple-mallory-foreign-read', 'RANGE', 16],
        ['tuple-mallory-foreign-write', 'RANGE', 17],
        ['tuple-mallory-range-read', 'RANGE', 16],
        ['tuple-mallory-range-write', 'RANGE', 17],
    ];
    for (const [scenario, fault, opcode] of scenarios) {
        assert(html.includes(`<option value="${scenario}">`), 'scenario is selectable in real HTML');
        el('scenario').value = scenario;
        el('scenario').handlers.change();
        assert.equal(el('run').disabled, true);
        await el('load').handlers.click();
        assert.equal(el('status').className, '', el('status').textContent);
        for (const mode of ['run', 'step']) {
            if (mode === 'run') el('run').handlers.click();
            else {
                for (let i = 0; i < context.AliceMalloryLab.scenarios[scenario].limit; i++) {
                    assert.equal(el('step').disabled, false);
                    el('step').handlers.click();
                }
            }
            assert.equal(el('status').className, '', el('status').textContent);
            assert.match(el('status').textContent, /^PASS:/);
            assert.match(el('status').textContent, /Simulator evidence only/);
            assert.equal(el('run').disabled, true);
            assert.equal(el('step').disabled, true);
            assert.match(el('tuple-evidence').textContent, /unchanged.*true/);
            if (fault) {
                assert.match(el('trace').textContent, new RegExp(`FAULT: ${fault} Thread NS\\[12\\].*opcode ${opcode}`));
                assert.match(el('tuple-evidence').textContent, new RegExp(`First fault: ${fault}`));
                assert.match(el('tuple-evidence').textContent, /Data registers unchanged: true/);
                assert.equal(el('trace').textContent.split('\n').filter(line => line.includes(': retired')).length, 7);
                if (fault === 'RANGE') {
                    assert.match(el('status').textContent, /valid own CR5/);
                    assert.match(el('tuple-evidence').textContent, /outside valid range/);
                }
            } else {
                assert(!el('trace').textContent.includes('FAULT:'));
                if (scenario.endsWith('-own')) {
                    assert.match(el('status').textContent, /913.*679/);
                    assert.match(el('tuple-evidence').textContent, /DR4: 0x00000391/);
                }
            }
            const boundary = ['status', 'trace', 'tuple-evidence', 'execution'].map(id => el(id).textContent);
            el('run').handlers.click();
            el('step').handlers.click();
            assert.deepEqual(['status', 'trace', 'tuple-evidence', 'execution'].map(id => el(id).textContent), boundary);
            await el('reset').handlers.click();
            assert.match(el('tuple-evidence').textContent, /not entered/);
            assert.equal(el('run').disabled, false);
            assert(!el('trace').textContent.includes('FAULT:'));
        }
    }
    console.log('Tuple lab UI: all seven scenarios, Run/Step, first-fault display, reset, boundaries and deep-link passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
