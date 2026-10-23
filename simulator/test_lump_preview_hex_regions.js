'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {createHash, webcrypto} = require('node:crypto');
const {JSDOM} = require('jsdom');
const dom = new JSDOM('', {runScripts:'outside-only', url:'https://ide.test/'});
const w = dom.window;
Object.defineProperty(w.crypto, 'subtle', {value:{
    digest:(algorithm, bytes) => webcrypto.subtle.digest(algorithm, Buffer.from(new w.Uint8Array(bytes)))
}});
const code = fs.readFileSync(__dirname + '/app-lumps.js', 'utf8');
function fn(name) {
    const start = code.search(new RegExp('(?:async )?function ' + name + '\\('));
    const rest = code.slice(start + 1);
    const end = rest.search(/\n(?:async )?function /);
    return code.slice(start, end < 0 ? undefined : start + 1 + end);
}
for (const name of ['_closeLumpHistoryPreviewModal', '_savedGtDecodeHtml', '_openSavedGtDecode',
    '_savedGtButton', '_renderSavedLumpIdentity', '_showLumpHistoryPreviewModal',
    '_verifyBoundPreview', '_lumpHistoryPreview']) w.eval(fn(name));
w.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
w._fmtEscape = w._escHtml = value => String(value ?? '').replace(/</g, '&lt;');
w.LumpContentFrame = {lumpDecodeContentFrameApi:() => ({name:'ide.Test',
    capabilities:[{name:'SELF', rights:['E']}, {name:'ide.Missing', rights:['E']}]})};
w._lumpBinaryInspection = data => data;
w._selectSavedLumpCodeDisplay = () => ({kind:'unavailable', warning:'No source'});
w._lumpBootstrapRepairControls = () => '';
w.ChurchSimulator = function() {};
w.ChurchSimulator.prototype.parseGT = word => ({
    type:1, typeName:'Inform', permissions:{E:true}, gt_seq:(word >>> 16) & 511, index:word & 65535});
w.eval(fs.readFileSync(__dirname + '/lump-hex-regions.js', 'utf8'));
w.NamespaceProfileNames = require('./namespace-profile-names');
w.updateNamespace = () => {};
w.eval(fs.readFileSync(__dirname + '/namespace-design-v1.js', 'utf8'));
const api = w.NamespaceDesignV1;
const apiJson = Buffer.from('{"a":12345}');
const pack = buf => { const b = Buffer.alloc(Math.ceil(buf.length / 4) * 4); buf.copy(b);
    const out = []; for (let i = 0; i < b.length; i += 4) out.push(b.readUInt32BE(i)); return out; };
// cw=6 so the API frame starts at word 7 and straddles the row 0/1 boundary.
const words = [((31 << 27) | (6 << 10) | 2) >>> 0, 0x07230002, 1, 2, 3, 4, 5,
    (0xAB010000 | apiJson.length) >>> 0, ...pack(apiJson), 6, ...pack(Buffer.from('abcdef')),
    0x0BADF00D, ...Array(64 - 15 - 2).fill(0), 0, 0];
assert.equal(words.length, 64);
const bound = [...words.slice(0, -2), 0x4a030010, 0];
const hash = words => {
    const bytes = Buffer.alloc(words.length * 4);
    words.forEach((word, i) => bytes.writeUInt32BE(word, i * 4));
    return createHash('sha256').update(bytes).digest('hex');
};
const selection = {token:'4a000010', filename:'ide.Test.1.12345678.lump',
    binaryHash:hash(words), revision:1};
const saved = {filename:selection.filename, binary_hash:selection.binaryHash, words,
    token:selection.token, abstraction:'ide.Test'};
const item = {slot:16, filename:selection.filename, sourceHash:selection.binaryHash,
    sourceWords:words, words:bound, derivativeHash:hash(bound), status:'unresolved',
    reason:'Unresolved target; not activated.', rows:[
        {index:0, word:bound[62], newGT:bound[62], status:'bound'},
        {index:1, word:0, newGT:null, status:'unresolved'}]};
let currentItem = null, remoteFingerprint = 'selected';
const requests = [];
w.fetch = async (url, options = {}) => {
    requests.push({url, options});
    assert(!options.method || options.method === 'GET', 'inspection only reads');
    assert(!/compile|install|hardware|prepare/.test(url));
    return {ok:true, json:async() => url.startsWith('/api/namespace/')
        ? {ok:true, fingerprint:remoteFingerprint, bindingReport:{lists:currentItem ? [currentItem] : []}}
        : structuredClone(saved)};
};
function setup() {
    api.state.active = true;
    api.state.profile = 'phase1';
    api.state.fingerprint = 'selected';
    api.state.dirty = false;
    api.state.projection = {rows:[]};
    api.state.document = {rows:[{slot:16, sequence:3, kind:'lump', name:'ide.Test', selection}]};
}

const R = require('./lump-hex-regions.js');
// --- classification ---
{
    const {regions, diagnostics} = R.classifyLumpWords(words);
    assert.deepEqual(diagnostics, []);
    assert.equal(regions[0], 'header');
    for (let i = 1; i <= 6; i++) assert.equal(regions[i], 'code');
    for (let i = 7; i <= 10; i++) assert.equal(regions[i], 'api', 'api ' + i);
    for (let i = 11; i <= 13; i++) assert.equal(regions[i], 'source', 'src ' + i);
    assert.equal(regions[14], 'other', 'nonzero free word stays raw other');
    assert.equal(regions[15], 'padding');
    assert.equal(regions[62], 'clist'); assert.equal(regions[63], 'clist');
    // Malformed frame: bad flags -> diagnostic, bytes remain raw/other, no api/source.
    const bad = words.slice(); bad[7] = (0xAB020000 | apiJson.length) >>> 0;
    const m = R.classifyLumpWords(bad);
    assert.match(m.diagnostics.join(), /Malformed content frame at word 7/);
    assert(!m.regions.includes('api') && !m.regions.includes('source'));
    assert.equal(m.regions[7], 'other'); assert.equal(m.regions[8], 'other');
    // Overrunning API length.
    const over = words.slice(); over[7] = 0xAB01FFF0;
    assert.match(R.classifyLumpWords(over).diagnostics.join(), /Malformed content frame/);
    // Invalid header magic: only header word classified.
    const inv = R.classifyLumpWords([0x12345678, 1, 0]);
    assert.deepEqual(inv.regions, ['header', 'other', 'other']);
    assert.match(inv.diagnostics.join(), /Invalid header magic/);
    // Truncated words relative to header size.
    assert.match(R.classifyLumpWords(words.slice(0, 20)).diagnostics.join(), /exceeds displayed/);
    assert(R.classifyLumpWords(words.slice(0, 20)).regions.slice(1).every(r => r === 'other'),
        'truncation must not move the C-list into earlier displayed words');
    // Uses only words: catalog-like metadata is ignored by signature.
    assert.equal(R.classifyLumpWords.length, 1);
}
(async () => {
    setup();
    currentItem = item;
    await api.preview(16);
    const opener = [...w.document.querySelectorAll('button')].find(b => b.textContent === 'Preview saved / bound bytes');
    if (opener) { let p; opener.onclick = () => { p = w.eval(opener.getAttribute('onclick')); }; opener.click(); await p; }
    const modal = w.document.getElementById('lumpHistoryPreviewModal');
    assert(modal, 'preview modal rendered');
    const table = [...modal.querySelectorAll('.lump-hex-table')].find(t => t.querySelector('td[data-region]'));
    assert(table, 'region-colored hex table rendered');
    const legend = modal.querySelector('.lump-hex-reg-legend');
    assert(legend, 'legend rendered');
    for (const k of ['Header', 'Code', 'API', 'Source', 'C-List', 'Padding', 'Other'])
        assert.match(legend.textContent, new RegExp(k));
    const rows = [...table.querySelectorAll('tbody tr')];
    // Mixed row boundary: row 0 holds header, code and api; row 1 holds api, source, other, padding.
    const regs = r => [...r.querySelectorAll('td[data-region]')].map(td => td.dataset.region);
    assert.deepEqual(regs(rows[0]), ['header', 'code', 'code', 'code', 'code', 'code', 'code', 'api']);
    assert.deepEqual(regs(rows[1]), ['api', 'api', 'api', 'source', 'source', 'source', 'other', 'padding']);
    // Hover labels: every classified cell has a non-color label.
    for (const td of table.querySelectorAll('td[data-region]')) assert.match(td.title, /\u2014 word \d+/);
    // Raw malformed/other byte stays inspectable as hex text.
    const otherCell = rows[1].querySelectorAll('td[data-region]')[6];
    assert.match(otherCell.textContent, /0B AD F0 0D/i);
    // Diff indicators preserved alongside region class (bound word 62 differs from saved).
    const changed = [...table.querySelectorAll('td.lump-hex-diff-changed')];
    for (const td of changed) assert(td.classList.contains('lump-hex-reg'), 'diff cell keeps region');
    const lastRegs = regs(rows[7]);
    assert.deepEqual(lastRegs.slice(6), ['clist', 'clist']);
    assert.match(modal.textContent, /Bound derivative|saved revision/);
    // Archived-vs-current diff: diff markers and region classes coexist.
    w.document.body.insertAdjacentHTML('beforeend', '<div id="lumpHistoryHexPreview_t"></div>');
    const current = words.slice(); current[3] = 0xDEADBEEF; current[9] = 0x41414141;
    w.fetch = async url => ({ok:true, json:async () => url.includes('/words/2')
        ? {words:words.slice(), filename:'a.lump'} : {words:current}});
    w._lumpHistoryPreviewIssueSummary = () => '';
    await w._lumpHistoryPreview('4a000010', 2, 6, 2, 64, 't', null, '4a000010', null, false, null, null);
    const dm = w.document.getElementById('lumpHistoryPreviewModal');
    if (!dm.querySelector('td[data-region]')) console.error(dm.textContent.slice(0, 600));
    const dt = [...dm.querySelectorAll('.lump-hex-table')].find(t => t.querySelector('td[data-region]'));
    const dc = [...dt.querySelectorAll('td.lump-hex-diff-changed')];
    assert.equal(dc.length, 2, 'two changed words');
    assert.deepEqual(dc.map(td => td.dataset.region), ['code', 'api']);
    for (const td of dc) {
        assert(td.querySelector('.lump-hex-diff-arch') && td.querySelector('.lump-hex-diff-cur'));
        assert(td.classList.contains('lump-hex-reg-' + td.dataset.region));
    }
    assert.match(dm.textContent, /2 words changed/);
    // Archived bytes, not current, drive classification.
    assert.match(dc[1].querySelector('.lump-hex-diff-cur').textContent, /41 41 41 41/);
    console.log('LUMP preview hex regions: classification, mixed rows, malformed frame, legend, hover labels, archived-vs-current diff checks passed');
})().catch(err => { console.error(err); process.exit(1); });
