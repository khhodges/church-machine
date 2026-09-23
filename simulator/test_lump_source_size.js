'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const vm = require('vm');
const LumpContentFrame = require('./lump-content-frame.js');
const { lumpFramePackBE } = LumpContentFrame;
const ui = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');
const start = ui.indexOf('function _getLumpFieldSizeLayout(');
const end = ui.indexOf('function _renderLumpFieldSizeSummary(', start);
const context = vm.createContext({ TextDecoder, Uint8Array, ArrayBuffer, LumpContentFrame });
vm.runInContext(ui.slice(start, end), context);
const layoutOf = context._getLumpFieldSizeLayout;
const summaryOf = context._getSavedLumpWordUsageSummary;

function artifact(text, flags = 3) {
    const words = new Array(256).fill(0);
    words[0] = ((0x1f << 27) | (2 << 23) | (1 << 10) | 1) >>> 0;
    const api = Buffer.from('{"name":"Example"}');
    let bytes = Buffer.from(text, 'utf8');
    if (flags & 4) bytes = zlib.deflateRawSync(bytes);
    const frame = [((0xab << 24) | (flags << 16) | api.length) >>> 0,
        ...lumpFramePackBE(Array.from(api))];
    if (flags & 1) frame.push(bytes.length, ...lumpFramePackBE(Array.from(bytes)));
    words.splice(2, frame.length, ...frame);
    return words;
}

(async function () {
    const plain = artifact('MOV DR0, #1');
    assert.equal(layoutOf(plain).source, 4); // length word + ceil(11 bytes / 4)
    assert.equal(layoutOf(plain).api, 6); // frame header + ceil(18 bytes / 4)
    assert.equal(await summaryOf(plain),
        '256 words total, 13 used, 243 unused; header=1, code=1, API=6, source=4, cc=1 (stored words, including framing/padding)');
    assert.equal(layoutOf(artifact('λ😀')).source, 3); // six UTF-8 bytes
    const text = 'repeat '.repeat(100);
    const compressed = artifact(text, 7);
    assert.equal(layoutOf(compressed).source, 1 + Math.ceil(zlib.deflateRawSync(Buffer.from(text)).length / 4));
    assert(layoutOf(compressed).source < Math.ceil(Buffer.byteLength(text) / 4));
    assert(!(await summaryOf(compressed)).includes('unavailable'));
    assert.equal(layoutOf(artifact('ignored', 0)).source, 0);
    assert.equal(layoutOf(artifact('')).source, 1); // present empty frame length field
    const legacy = artifact('');
    legacy.fill(0, 2);
    assert.equal(layoutOf(legacy).source, 0);
    assert.equal(layoutOf(legacy).empty, 253);
    assert.equal(await summaryOf([]), 'word usage unavailable');
    assert.equal(await summaryOf(artifact('x').slice(0, 8)), 'word usage unavailable');
    assert.equal(await summaryOf(artifact('x', 0xff)), 'word usage unavailable');
    const malformed = artifact('x');
    malformed[7] = 10000; // source length exceeds allocated freespace
    assert.equal(await summaryOf(malformed), 'word usage unavailable');
    const invalidApi = artifact('x');
    invalidApi[3] = 0xffffffff;
    assert.equal(await summaryOf(invalidApi), 'word usage unavailable');
    const invalidCompressed = artifact('abc', 7);
    invalidCompressed[8] = 0xffffffff;
    assert.equal(await summaryOf(invalidCompressed), 'word usage unavailable');
    const unknownPayload = legacy.slice();
    unknownPayload[50] = 123;
    assert.equal(await summaryOf(unknownPayload), 'word usage unavailable');
    for (const typ of [1, 2, 3]) {
        const nonCode = legacy.slice();
        nonCode[0] |= typ << 8;
        assert.equal(await summaryOf(nonCode), 'word usage unavailable');
    }
    const saved = artifact('saved text');
    const before = saved.slice();
    globalThis.asmEditor = { value: 'different mutable draft' };
    const savedLayout = layoutOf(saved);
    assert.equal(1 + savedLayout.code + savedLayout.api + savedLayout.source +
        savedLayout.clist + savedLayout.empty, saved.length);
    assert((await summaryOf(saved)).includes('source=4'));
    assert.deepEqual(saved, before);
    // SelfTest's physical field dimensions, with a synthetic uncompressed frame.
    // Zero-valued code and C-list words still occupy their declared spans.
    const selfTestShape = new Array(2048).fill(0);
    selfTestShape[0] = ((0x1f << 27) | (5 << 23) | (500 << 10) | 1) >>> 0;
    const api = Buffer.from('{"name":"SelfTest"}'.padEnd(192, ' '));
    const physicalSource = Buffer.alloc(5592, 120);
    const frame = [((0xab << 24) | (3 << 16) | api.length) >>> 0,
        ...lumpFramePackBE(Array.from(api)), physicalSource.length,
        ...lumpFramePackBE(Array.from(physicalSource))];
    selfTestShape.splice(501, frame.length, ...frame);
    assert.equal(await summaryOf(selfTestShape),
        '2048 words total, 1950 used, 98 unused; header=1, code=500, API=49, source=1399, cc=1 (stored words, including framing/padding)');
    assert(ui.includes('await _getSavedLumpWordUsageSummary(serverWords)'));
    assert(!ui.includes("_lhFree2 + ' free"));
    console.log('PASS stored-word accounting: totals, compressed payload, UTF-8 padding, empty/absent, malformed/unknown, non-Code and draft isolation');
})().catch(error => { console.error(error); process.exitCode = 1; });