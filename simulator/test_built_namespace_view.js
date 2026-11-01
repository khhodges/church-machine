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
        { slot: 0, w0: 0x11, w1: 0x22, w2: 0x33, w3: 0x44, filename: null, artifactSha256: null, name: null },
        { slot: 12, w0: 0xDEADBEEF, w1: 1, w2: 2, w3: 3, filename: 'alice.lump', artifactSha256: 'ffee', name: 'Alice' },
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
    check('renders provenance name only where present', html.includes('Alice') && html.includes('alice.lump') && html.includes('absent'));
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

    console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
    if (failed) process.exit(1);
})();
