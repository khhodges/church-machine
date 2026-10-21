'use strict';
const assert = require('assert/strict');
const zlib = require('zlib');
const {execFileSync} = require('child_process');
const frame = require('./lump-content-frame');

(async () => {
    const api = {name: 'example.File', methods: {}};
    const source = '; Unicode source π\nRETURN\n';
    for (const profile of ['api', 'compact', 'full']) {
        const built = await frame.lumpBuildContentFrame(api, source, {profile});
        assert.equal(built.flags & 4, 0, 'new source must not be separately compressed');
        const words = new Array(256).fill(0);
        words[0] = (0xF9000401 >>> 0); // N=8, cw=1, cc=1
        words[1] = 0xF8000000;
        words[255] = 0x0A000002;
        words.splice(2, built.frameWords.length, ...built.frameWords);
        const raw = Buffer.alloc(words.length * 4);
        words.forEach((w, i) => raw.writeUInt32BE(w >>> 0, i * 4));
        const packed = await frame.lumpPackFile(raw);
        assert.deepEqual(zlib.gunzipSync(packed), raw);
        // Browser-generated gzip must be accepted by the actual server codec.
        const decoded = execFileSync('python3', ['-c',
            'import sys; from server.lump_file import unpack_lump; sys.stdout.buffer.write(unpack_lump(sys.stdin.buffer.read()))'],
            {input: packed});
        assert.deepEqual(decoded, raw);
    }
    // Legacy full and compact raw-DEFLATE source remains decodable.
    for (const flags of [5, 7]) {
        const apiBytes = Buffer.from(JSON.stringify(api));
        const zipped = zlib.deflateRawSync(Buffer.from(source));
        const words = new Array(256).fill(0);
        words[0] = 0xF9000401;
        words[1] = 0xF8000000;
        const content = [(0xAB000000 | flags << 16 | apiBytes.length) >>> 0,
            ...frame.lumpFramePackBE(Array.from(apiBytes)), zipped.length,
            ...frame.lumpFramePackBE(Array.from(zipped))];
        words.splice(2, content.length, ...content);
        assert.equal(await frame.lumpDecodeContentFrame(words), source);
    }
    await assert.rejects(frame.lumpPackFile(new Uint8Array(4)), /header/);
    console.log('Whole-LUMP gzip, Python interoperability, and legacy source decoding: PASS');
})().catch(error => {console.error(error); process.exitCode = 1;});
