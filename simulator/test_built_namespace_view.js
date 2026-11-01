'use strict';
// Focused tests for the read-only "Namespace as built" page.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function check(name, v) { if (v) { passed++; console.log('PASS ' + name); } else { failed++; console.log('FAIL ' + name); } }

const src = fs.readFileSync(path.join(__dirname, 'app-lump-editor.js'), 'utf8');

function makeEnv() {
    const panel = { innerHTML: '', offsetParent: {} };
    const requests = [];
    const pending = [];
    const ctx = {
        console: { warn() {}, log() {}, error() {} },
        localStorage: { getItem() { return null; }, setItem() {} },
        document: { getElementById(id) { return id === 'lumpResidentPanel' ? panel : null; }, querySelector() { return null; }, querySelectorAll() { return []; } },
        addEventListener() {},
        AbortController: class { constructor() { this.signal = { aborted: false }; } abort() { this.signal.aborted = true; } },
        fetch(url, opts) {
            requests.push({ url, opts: opts || {} });
            return new Promise((resolve, reject) => pending.push({ resolve, reject, url }));
        },
        ThreadDesign: require('./thread_design.js'),
        ThreadTupleDesign: null,
        BOARD_PROFILES: { 'wukong-xc7a100t': { label: 'W', totalRamWords: 16384 } },
        Math, JSON, Number, String, Array, Object, Promise, Error, parseInt, isNaN,
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(src, ctx);
    return { ctx, panel, requests, pending };
}
function reply(p, status, body) {
    p.resolve({ status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) });
}
const tick = () => new Promise(r => setImmediate(r));

const evidence = {
    imageSha256: 'ab12cd', bytes: 131072, totalWords: 32768, maxEntries: 64, nsTableBase: 32512,
    thread: { lumpWords: 256 }, provenanceStatus: 'missing', builtNamespaceFingerprint: null,
    savedNamespaceMatchesBuilt: false,
    entries: [
        { slot: 0, w0: 0x11, w1: 0x22, w2: 0x33, w3: 0x44, filename: null, artifactSha256: null, name: null, nameSource: null, artifactStatus: 'unavailable', decoded: { location: 0x100, limit: 0x3F, sequence: 0, f: 1, g: 0, seal: 0xABC, accessGt: 'R' } },
        { slot: 5, w0: 5, w1: 6, w2: 7, w3: 8, filename: null, artifactSha256: null, name: 'UART', nameSource: 'matched-namespace', artifactStatus: 'not-applicable', decoded: { location: 0xF000, limit: 4, sequence: 2, f: 0, g: 1, seal: 0, accessGt: 'RW' } },
        { slot: 12, w0: 0xDEADBEEF, w1: 1, w2: 2, w3: 3, filename: 'alice.lump', artifactSha256: 'ffee', name: 'Alice', nameSource: 'build-record', artifactStatus: 'recorded', decoded: null },
    ],
};

(async () => {
    const env = makeEnv();
    check('initResidentPanel exists', typeof env.ctx.initResidentPanel === 'function');
    env.ctx.initResidentPanel();
    check('loads only built-namespace endpoint',
        env.requests.length === 1 && env.requests[0].url === '/api/boot-image/built-namespace');
    check('request is GET', (env.requests[0].opts.method || 'GET') === 'GET' && !env.requests[0].opts.body);
    reply(env.pending[0], 200, evidence);
    await tick(); await tick();
    const html = env.panel.innerHTML;
    check('renders raw words from evidence', html.includes('0xDEADBEEF') && html.includes('0x00000011'));
    check('renders provenance name only where present', html.includes('Alice') && html.includes('alice.lump') && html.includes('Unavailable') && !/>absent</.test(html));
    check('names column precedes raw words', html.indexOf('<th>Name</th>') > 0 && html.indexOf('<th>Name</th>') < html.indexOf('Raw words'));
    check('decoded fields rendered', html.includes('0x0000F000') && html.includes('RW'));
    check('name source shown', /saved Namespace \(fingerprint match\)/.test(html) && /build record/.test(html));
    check('N/A artifact explained', /N\/A \u2014 hardware device, no file/.test(html));
    check('unknown artifact says Not recorded', html.includes('Not recorded'));
    check('raw words and full hash in details', /<details/.test(html) && html.includes('ffee') && html.includes('0x00000044'));
    check('misleading single Thread summary removed, no JSON', !html.includes('lumpWords') && !html.includes('<h4>Thread</h4>'));
    check('labels built image vs live FPGA', /not the live physical FPGA/.test(html) && /saved Namespace may differ/.test(html));
    check('no write controls', !/Save|Load into Sim|Generate|Upload|<select|<input|draggable|Next/i.test(html.replace(/saved Namespace[^<]*/gi, '')));
    check('no catalog/config requests', env.requests.every(r => r.url === '/api/boot-image/built-namespace'));

    env.ctx.lumpEditorBuiltNamespaceRefresh();
    check('refresh clears stale table immediately', !env.panel.innerHTML.includes('0xDEADBEEF'));
    reply(env.pending[1], 404, { error: 'none' });
    await tick(); await tick();
    check('failed refresh shows error and no fallback table',
        /No built boot image/.test(env.panel.innerHTML) && !env.panel.innerHTML.includes('<table'));

    env.ctx.lumpEditorBuiltNamespaceRefresh();
    env.ctx.lumpEditorBuiltNamespaceRefresh();
    reply(env.pending[3], 422, { error: 'bad' });
    await tick(); await tick();
    reply(env.pending[2], 200, evidence);
    await tick(); await tick();
    check('stale earlier response cannot overwrite newer result',
        /invalid or unrecognizable/.test(env.panel.innerHTML) && !env.panel.innerHTML.includes('Alice'));

    const before = env.requests.length;
    ['lumpEditorRLSave', 'lumpEditorRLGenerate', 'lumpEditorRLUpload', 'lumpEditorRLHandleUpload',
     'lumpEditorBootEntryChange', 'lumpEditorBootBadgeClick', 'lumpEditorBootShowAllToggle', 'lumpEditorRLEmptySlots']
        .forEach(n => { try { env.ctx[n](3, { files: [{ name: 'x.bin' }] }); } catch (e) {} });
    check('obsolete resident handlers issue no requests', env.requests.length === before);


    // ── Per-Thread tabs ──
    const caps = (base, tgt) => Array.from({ length: 12 }, (_, i) => ({ register: 'CR' + i, offset: i, address: base + i, value: i === 0 ? 0 : (0xA0000000 + base + i) >>> 0, type: i === 0 ? 'NULL' : 'INFORM', targetSlot: i === 0 ? null : tgt, targetName: i === 1 ? 'UART' : null, sequence: i, targetStatus: i === 0 ? 'null' : (i === 1 ? 'resolved' : (i === 2 ? 'generation-mismatch' : 'name-unavailable')) }));
    const heapA = Array.from({ length: 100 }, (_, i) => i === 3 ? 0xCAFEBABE : 0);
    const ev2 = Object.assign({}, evidence, { entries: evidence.entries.slice(0, 2), threads: [
        { slot: 7, name: null, location: 0x1000, headerWord: 0x11110000, sizeWords: 256, stackWords: 32, error: null,
          zones: [{ name: 'heap', startOffset: 64, endOffset: 164, words: 100, absoluteStart: 0x1040, absoluteEnd: 0x10A4 }],
          heap: { startOffset: 64, endOffset: 164, words: 100, initialWords: heapA, nonzeroWords: 1, definitionsStatus: 'not-recorded' },
          capabilities: caps(0x1000, 5), runtimeRegisters: [12, 13, 14, 15] },
        { slot: 9, name: 'Worker', location: 0x2000, headerWord: 0x22220000, sizeWords: 512, stackWords: 64, error: null,
          zones: [], heap: { startOffset: 100, endOffset: 300, words: 200, initialWords: [0x77777777, 0], nonzeroWords: 1, definitionsStatus: 'not-recorded' },
          capabilities: caps(0x2000, 0), runtimeRegisters: [12, 13, 14, 15] },
        { slot: 11, name: null, location: 0x3000, headerWord: 0, sizeWords: 0, stackWords: 0, error: 'bad header', zones: [] },
    ] });
    env.ctx.lumpEditorBuiltNamespaceRefresh();
    reply(env.pending[env.pending.length - 1], 200, ev2);
    await tick(); await tick();
    let h2 = env.panel.innerHTML;
    check('tabs: Namespace + each thread', /role="tablist"/.test(h2) && h2.includes('>Namespace</button>') && h2.includes('>Thread NS[7]</button>') && h2.includes('>Worker</button>') && h2.includes('>Thread NS[11]</button>'));
    check('namespace tab selected by default with table', /aria-selected="true"[^>]*data-bn-tab="ns"/.test(h2) && h2.includes('<th>Name</th>'));
    check('aria-controls and tabindex', h2.includes('aria-controls="le-bn-tp-7"') && /tabindex="-1"[^>]*data-bn-tab="7"/.test(h2));
    check('no invented Alice/Mallory', !/Alice|Mallory/.test(h2));
    const nReq = env.requests.length;
    env.ctx.lumpEditorBnTab('7');
    h2 = env.panel.innerHTML;
    check('thread 7 heap + exact words incl zeros', h2.includes('0xCAFEBABE') && h2.includes('0x00000000') && /Not recorded in this build/.test(h2) && /does not prove/.test(h2));
    check('thread 7 GT table with target name and statuses', h2.includes('CR11') && h2.includes('UART') && /Generation mismatch/.test(h2) && /No target/.test(h2));
    check('CR12-15 runtime-only', /CR15<\/td><td colspan="6"><span class="le-bn-absent">Runtime-only/.test(h2));
    check('heap paginated', /Page 1 \/ 2/.test(h2) && !h2.includes('rel +130'));
    env.ctx.lumpEditorBnHeapPage(7, 1);
    check('heap page 2', /Page 2 \/ 2/.test(env.panel.innerHTML));
    env.ctx.lumpEditorBnTabKey({ key: 'ArrowRight', preventDefault() {} });
    h2 = env.panel.innerHTML;
    check('arrow key -> Worker, different heap', /aria-selected="true"[^>]*data-bn-tab="9"/.test(h2) && h2.includes('0x77777777') && !h2.includes('0xCAFEBABE') && h2.includes('512'));
    env.ctx.lumpEditorBnTabKey({ key: 'End', preventDefault() {} });
    h2 = env.panel.innerHTML;
    check('error thread shows error only', /bad header/.test(h2) && !h2.includes('CR0') && !h2.includes('Tuple heap'));
    env.ctx.lumpEditorBnTabKey({ key: 'Home', preventDefault() {} });
    check('Home -> Namespace', /aria-selected="true"[^>]*data-bn-tab="ns"/.test(env.panel.innerHTML));
    check('tab switching issues no requests', env.requests.length === nReq);
    env.ctx.lumpEditorBnTab('9');
    env.ctx.lumpEditorBuiltNamespaceRefresh();
    check('refresh clears thread contents', !env.panel.innerHTML.includes('0x77777777'));
    reply(env.pending[env.pending.length - 1], 200, ev2);
    await tick(); await tick();
    check('selected thread preserved across refresh', /aria-selected="true"[^>]*data-bn-tab="9"/.test(env.panel.innerHTML));
    env.ctx.lumpEditorBuiltNamespaceRefresh();
    reply(env.pending[env.pending.length - 1], 200, Object.assign({}, ev2, { threads: ev2.threads.slice(0, 1) }));
    await tick(); await tick();
    check('removed thread falls back to Namespace', /aria-selected="true"[^>]*data-bn-tab="ns"/.test(env.panel.innerHTML) && !env.panel.innerHTML.includes('Worker'));
    env.ctx.lumpEditorBuiltNamespaceRefresh();
    reply(env.pending[env.pending.length - 1], 500, {});
    await tick(); await tick();
    check('failure removes thread tabs', !env.panel.innerHTML.includes('Thread NS[7]') && !/role="tab"/.test(env.panel.innerHTML));

    console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
    if (failed) process.exit(1);
})();
