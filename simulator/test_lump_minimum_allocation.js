'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const {JSDOM} = require('jsdom');
const frames = require('./lump-content-frame');
const src = fs.readFileSync(__dirname + '/app-lumps.js', 'utf8');
function extract(name) {
    const marker = src.includes('async function ' + name + '(') ? 'async function ' : 'function ';
    const start = src.indexOf(marker + name + '(');
    let depth = 0;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
        if (src[i] === '{') depth++;
        if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw Error(name);
}
const dom = new JSDOM('<button id="lumpShrinkBtn_t"></button><span id="lumpResizeNote_t"></span>');
const context = vm.createContext({TextDecoder, Uint8Array, console,
    document:dom.window.document, LumpContentFrame:frames, _lumpBinaryHdrCache:{},
    _updateLumpFieldSizeSummary() {}});
vm.runInContext(['_getLumpFieldSizeLayout', '_getLumpMinimumAllocation', '_patchCcFromBinary']
    .map(extract).join('\n'), context);
async function checkUI(words, expected) {
    const original = words.slice();
    context._lumpBinaryHdrCache = {};
    context.fetch = async (url, options) => {
        assert.equal(options, undefined, 'inspection must not POST a resize');
        return {ok:true, json:async () => ({words})};
    };
    await context._patchCcFromBinary('token', {token:'token'}, 't');
    const button = dom.window.document.getElementById('lumpShrinkBtn_t');
    assert.equal(button.disabled, true);
    assert.equal(button.onclick, null);
    assert.equal(button.textContent, expected === null ? 'Minimum unavailable' : `Minimum allocation: ${expected}w`);
    assert.deepEqual(words, original, 'inspection preserves all exact words');
}
(async () => {
    for (const profile of ['api', 'compact', 'full']) {
        const frame = await frames.lumpBuildContentFrame({
            capabilities:Array.from({length:11}, (_, i) => ({name:'DeclaredTarget' + i, rights:['R']}))
        }, Array.from({length:150}, (_, i) => `LOAD CR1, CR6, #${i % 11} ; source line ${i}`).join('\n'),
        {profile});
        const words = Array(4096).fill(0);
        words[0] = ((31 << 27) | (6 << 23) | (37 << 10) | 11) >>> 0;
        words.splice(38, frame.frameWords.length, ...frame.frameWords);
        words.fill(0x4A000006, 4085);
        const required = 1 + 37 + frame.frameWords.length + 11;
        const minimum = Math.max(64, 2 ** Math.ceil(Math.log2(required)));
        assert(minimum > 64, 'fixture must catch the old code-only minimum');
        await checkUI(words, minimum);
        const unknown = words.slice();
        unknown[4084] = 1;
        await checkUI(unknown, null);
        const malformed = words.slice();
        malformed[38] = 0xAB00FFFF;
        await checkUI(malformed, null);
        await checkUI(words.slice(0, -1), null);
    }
    const legacy = Array(128).fill(0);
    legacy[0] = ((31 << 27) | (1 << 23) | (2 << 10) | 1) >>> 0;
    await checkUI(legacy, null);
    console.log('PASS minimum allocation: API/Compact/Full, unknown data, malformed/missing frames, truncation, disabled UI and unchanged bytes');
})().catch(error => {console.error(error); process.exitCode = 1;});