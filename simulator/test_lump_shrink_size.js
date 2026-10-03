'use strict';
// Isolated in-memory binaries only: no repository artifacts are written.
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const zlib = require('zlib');
const frames = require('./lump-content-frame.js');

function fixture(flags, source = 'LOAD DR0, 1\n'.repeat(80), size = 1024) {
    const api = Buffer.from(JSON.stringify({
        name: 'Example', capabilities: [{petname: 'long.pet.name.'.repeat(30)}]
    }));
    const src = flags & 4 ? zlib.deflateRawSync(Buffer.from(source)) : Buffer.from(source);
    const frame = [(0xab000000 | flags << 16 | api.length) >>> 0,
        ...frames.lumpFramePackBE(api)];
    if (flags & 1) frame.push(src.length, ...frames.lumpFramePackBE(src));
    const words = Array(size).fill(0);
    words[0] = (0xf8000000 | (Math.log2(size) - 6) << 23 | 2 << 10 | 2) >>> 0;
    words[1] = 0x12345678;
    words[2] = 0x87654321;
    words.splice(3, frame.length, ...frame);
    words[size - 2] = 0xdeadbeef;
    words[size - 1] = 0xabcdef01;
    return {words, end: 3 + frame.length};
}

// Supply raw-deflate support consistently across Node versions.
global.DecompressionStream = class {
    constructor() {
        const chunks = [];
        const stream = new TransformStream({
            transform(chunk) { chunks.push(Buffer.from(chunk)); },
            flush(controller) { controller.enqueue(zlib.inflateRawSync(Buffer.concat(chunks))); }
        });
        this.readable = stream.readable;
        this.writable = stream.writable;
    }
};

const app = fs.readFileSync(require.resolve('./app-lumps.js'), 'utf8');
const patch = app.slice(app.indexOf('async function _patchCcFromBinary('),
    app.indexOf('// Computes { name, start, end }'));
async function button(words) {
    const btn = {};
    const note = {};
    const context = {
        LumpContentFrame: frames, _lumpBinaryHdrCache: {},
        _updateLumpFieldSizeSummary() {},
        document: {getElementById: id => id === 'lumpShrinkBtn_test' ? btn :
            id === 'lumpResizeNote_test' ? note : null},
        fetch: async () => ({ok: true, json: async () => ({words})})
    };
    vm.createContext(context);
    vm.runInContext(patch, context);
    await context._patchCcFromBinary('test', {token: 'test'}, 'test');
    assert.equal(btn.disabled, true);
    assert.equal(btn.onclick, null);
    btn.note = note.textContent;
    return btn;
}

(async () => {
    for (const flags of [0, 1, 3, 5, 7]) {
        const {words, end} = fixture(flags);
        const before = words.slice();
        const result = await frames.lumpMinimumAllocation(words);
        const expected = 2 ** Math.max(6, Math.ceil(Math.log2(end + 2)));
        assert.equal(result.verified, true, result.reason);
        assert.equal(result.minimumWords, expected);
        assert.ok(expected > 64, 'PetNames alone exceed the code-only minimum');
        assert.equal((await button(words)).textContent, `Minimum allocation: ${expected}w`);
        assert.deepEqual(words, before, 'inspection must preserve all bytes');
        const minimal = fixture(flags, undefined, expected).words;
        assert.equal((await button(minimal)).textContent, `Minimum allocation: ${expected}w`);
    }
    const invalid = [];
    let f = fixture(3); f.words[f.end] = 42; invalid.push(f.words);
    f = fixture(0); f.words[3] |= 0x080000; invalid.push(f.words);
    f = fixture(0); f.words[3] = 0xab00ffff; invalid.push(f.words);
    f = fixture(3); f.words[4 + Math.ceil((f.words[3] & 65535) / 4)] = 999999; invalid.push(f.words);
    f = fixture(0); f.words[4] = 0xffffffff; invalid.push(f.words);
    f = fixture(0); f.words[3] = 0; invalid.push(f.words);
    f = fixture(0); f.words.pop(); invalid.push(f.words);
    f = fixture(0); f.words.push(0); invalid.push(f.words);
    f = fixture(0); f.words[0] |= 0x200; invalid.push(f.words);
    for (const words of invalid) {
        assert.equal((await frames.lumpMinimumAllocation(words)).verified, false);
        const btn = await button(words);
        assert.equal(btn.textContent, 'Minimum unavailable');
        assert.match(btn.note, /^Layout unavailable: .+/);
        assert.ok(btn.title);
    }
    console.log('PASS safe allocation: API/Compact/Full, compressed source, malformed layouts, labels, immutable bytes');
})().catch(error => { console.error(error); process.exitCode = 1; });