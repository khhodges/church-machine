'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { lumpFramePackBE, lumpSourceSizeSummary } = require('./lump-content-frame.js');

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
    assert.equal(await lumpSourceSizeSummary(artifact('MOV DR0, #1')), 'source 11 UTF-8 bytes');
    assert.equal(await lumpSourceSizeSummary(artifact('λ😀')), 'source 6 UTF-8 bytes');
    assert.equal(await lumpSourceSizeSummary(artifact('λ😀', 7)), 'source 6 UTF-8 bytes');
    assert.equal(await lumpSourceSizeSummary(artifact('ignored', 0)), 'source 0 UTF-8 bytes');
    assert.equal(await lumpSourceSizeSummary(artifact('')), 'source 0 UTF-8 bytes');
    assert.equal(await lumpSourceSizeSummary(artifact(' \n')), 'source 2 UTF-8 bytes');
    const legacy = artifact('');
    legacy.fill(0, 2);
    assert.equal(await lumpSourceSizeSummary(legacy), 'source 0 UTF-8 bytes');
    assert.equal(await lumpSourceSizeSummary([]), 'source unavailable');
    assert.equal(await lumpSourceSizeSummary(artifact('x').slice(0, 8)), 'source unavailable');
    assert.equal(await lumpSourceSizeSummary(artifact('x', 0xff)), 'source unavailable');
    const malformed = artifact('x');
    malformed[7] = 10000; // source length exceeds allocated freespace
    assert.equal(await lumpSourceSizeSummary(malformed), 'source unavailable');
    const saved = artifact('saved text');
    const before = saved.slice();
    globalThis.asmEditor = { value: 'different mutable draft' };
    assert.equal(await lumpSourceSizeSummary(saved), 'source 10 UTF-8 bytes');
    assert.deepEqual(saved, before);
    const ui = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');
    assert(ui.includes('await LumpContentFrame.lumpSourceSizeSummary(serverWords)'));
    assert(ui.includes("' free, ' + _sourceSizeSummary + ')'"));
    console.log('PASS saved source sizes: UTF-8, compressed, absent, empty, malformed, draft isolation and summary wiring');
})().catch(error => { console.error(error); process.exitCode = 1; });