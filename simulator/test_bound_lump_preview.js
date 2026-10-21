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
w.NamespaceProfileNames = require('./namespace-profile-names');
w.updateNamespace = () => {};
w.eval(fs.readFileSync(__dirname + '/namespace-design-v1.js', 'utf8'));
const api = w.NamespaceDesignV1;
const words = [((31 << 27) | (1 << 10) | 2) >>> 0, 0x07230002, ...Array(60).fill(0), 0, 0];
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
const text = () => w.document.body.textContent;
(async () => {
    setup();
    await api.preview(16);
    assert.match(text(), /Original saved revision/);
    assert(w.document.getElementById('lumpPreviewBound').disabled);
    currentItem = item; // Bind has finished on the server.
    api.inspect(16);
    const designDialog = w.document.getElementById('namespaceDesignDialog');
    assert(designDialog, 'start from the real Namespace inspection dialog');
    const previewButton = [...designDialog.querySelectorAll('button')].find(button =>
        button.textContent === 'Preview saved / bound bytes');
    assert(previewButton);
    // outside-only JSDOM does not compile inline handlers; attach the actual
    // rendered handler, then dispatch the button's click normally.
    let opening;
    previewButton.onclick = () => { opening = w.eval(previewButton.getAttribute('onclick')); };
    previewButton.click();
    await opening;
    assert.equal(w.document.getElementById('namespaceDesignDialog'), null,
        'the higher-z-index design overlay must not obscure or intercept the preview');
    assert.equal(w.document.activeElement,
        w.document.querySelector('#lumpHistoryPreviewModal .lump-history-preview-close'));
    assert.match(text(), /Bound derivative — read-only/);
    assert.match(text(), /generation 3/);
    assert.match(text(), /unresolved/);
    const buttons = [...w.document.querySelectorAll('.saved-gt-word')];
    assert.equal(buttons.length, 4, 'both C-list and full hex have two rows');
    assert(buttons[0].getAttribute('onclick').includes(String(bound[62])));
    assert(buttons[2].getAttribute('onclick').includes(String(bound[62])));
    w.eval(buttons[0].getAttribute('onclick'));
    assert.match(w.document.getElementById('savedGtDecode').textContent, /4A030010/);
    assert.match(w.document.getElementById('savedGtDecode').textContent, /Bound derivative SHA-256/);
    await w.document.getElementById('lumpPreviewSaved').onclick();
    assert.match(text(), /Original saved revision — read-only/);
    assert.match(w.document.querySelector('.saved-gt-word').getAttribute('onclick'), /\(0,0\)/);
    await w.document.getElementById('lumpPreviewBound').onclick();
    w._closeLumpHistoryPreviewModal();
    // No client-side bound cache: reopening (and a new document object) reads persisted evidence.
    setup();
    await api.preview(16);
    assert.match(text(), /Bound derivative — read-only/);
    api.capacity(128); // marks draft dirty and invalidates both byte and decode views
    assert.equal(w.document.getElementById('lumpHistoryPreviewModal'), null);
    await api.preview(16);
    assert(w.document.getElementById('lumpPreviewBound').disabled);
    assert.match(text(), /unsaved changes/);
    setup();
    remoteFingerprint = 'new-generation';
    await api.preview(16);
    assert(w.document.getElementById('lumpPreviewBound').disabled);
    assert.match(text(), /Saved Namespace changed/);
    remoteFingerprint = 'selected';
    currentItem = {...item, status:'blocked', words:undefined, reason:'Legacy artifact requires recompilation.'};
    await api.preview(16);
    assert.match(text(), /Legacy artifact/);
    assert.match(text(), /Original saved revision — read-only/);
    currentItem = {...item, derivativeHash:'0'.repeat(64)};
    await api.preview(16);
    assert.match(text(), /SHA-256 mismatch/);
    assert(w.document.getElementById('lumpPreviewBound').disabled);
    assert.deepEqual(saved.words, words);
    assert(requests.length > 10);
    console.log('Bound preview: transition, reopen, partial, stale, blocked, integrity and read-only checks passed');
    dom.window.close();
})().catch(error => {console.error(error); process.exitCode = 1; dom.window.close();});
