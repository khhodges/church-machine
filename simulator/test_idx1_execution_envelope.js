'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const Assembler = require('./assembler.js');
const Envelope = require('./idx1-execution-envelope.js');

async function main() {
    const compiled = new Assembler().assemble(
        'entry:\nBRANCH body\nprivate:\n.word 0\nbody:\nLOAD CR1, CR6, DR11\nRETURN',
        { profile: 'IDX1', sourceLayout: {
            fastEntry: 'entry', dispatch: [{ word: 'entry', kind: 'branch' },
                { word: 'private', kind: 'private' }],
        } });
    assert.deepEqual(compiled.errors, []);
    const payload = Buffer.alloc(256);
    payload.writeUInt32BE(((31 << 27) | (compiled.words.length << 10)) >>> 0);
    compiled.words.forEach((word, i) => payload.writeUInt32BE(word, 4 * (i + 1)));
    const framed = await Envelope.frame(payload, compiled.layout);
    assert.equal(framed.profile, 'IDX1');
    assert.equal(framed.executionDigest,
        crypto.createHash('sha256').update(Buffer.from(framed.bytes)).digest('hex'));
    assert(Object.isFrozen(framed));
    assert(Object.isFrozen(framed.words));
    assert(Object.isFrozen(framed.metadata.layout.extents[0]));
    assert.deepEqual(framed.dispatch.map(entry => [entry.kind, entry.target]),
        [['branch', 3], ['private', 0]]);
    const server = JSON.parse(execFileSync('python3', ['-c', `
import json, sys
from server.idx1_profile import parse_envelope
e = parse_envelope(bytes.fromhex(sys.stdin.read()))
print(json.dumps({"digest": e.execution_digest, "starts": e.instruction_starts,
                  "dispatch": e.dispatch, "fast": e.fast_entry}))
`], { input: Buffer.from(framed.bytes).toString('hex'), encoding: 'utf8' }));
    assert.equal(server.digest, framed.executionDigest);
    assert.deepEqual(server.starts, framed.metadata.layout.instructionStarts);
    assert.equal(server.fast, framed.metadata.layout.fastEntry);
    assert.deepEqual(server.dispatch,
        framed.dispatch.map(entry => [entry.selector, entry.word, entry.kind, entry.target]));

    // Untrusted bytes cannot alter a validated snapshot during an async hash.
    const race = Uint8Array.from(framed.bytes);
    const pending = Envelope.parse(race);
    race.fill(0);
    assert.equal((await pending).executionDigest, framed.executionDigest);
    const changed = Uint8Array.from(framed.bytes);
    changed[changed.length - 1] ^= 1;
    await assert.rejects(Envelope.parse(changed), /digest mismatch/);
    await assert.rejects(Envelope.parse(framed.bytes.slice(0, -1)), /framing/);
    await assert.rejects(Envelope.parse([...framed.bytes, 0]), /framing/);
    const wrongVersion = Uint8Array.from(framed.bytes);
    wrongVersion[11] = 2;
    await assert.rejects(Envelope.parse(wrongVersion), /version/);

    // Reframe arbitrary metadata, without the helper's canonical serializer,
    // to exercise duplicate-key, UTF-8 and numeric-language rejection.
    function reframe(text) {
        const metadata = Buffer.from(text), padding = (4 - metadata.length % 4) % 4;
        const out = Buffer.alloc(24 + metadata.length + padding + payload.length);
        Buffer.from(framed.bytes.slice(0, 8)).copy(out);
        out.writeUInt32BE(1, 8); out.writeUInt32BE(metadata.length, 12);
        out.writeUInt32BE(payload.length, 16);
        metadata.copy(out, 24); payload.copy(out, 24 + metadata.length + padding);
        return out;
    }
    const json = JSON.stringify(framed.metadata);
    await assert.rejects(Envelope.parse(reframe(json.replace('{', '{"schema":"wrong",'))), /Duplicate/);
    await assert.rejects(Envelope.parse(reframe('\ufeff' + json)), /JSON/);
    await assert.rejects(Envelope.parse(reframe(json.replace('"fastEntry":1', '"fastEntry":-0'))), /integer/);
    await assert.rejects(Envelope.parse(reframe(json.replace('"fastEntry":1', '"fastEntry":1.0'))), /JSON/);
    await assert.rejects(Envelope.parse(reframe(json.replace('"IDX1"', '"IDX\\ud800"'))), /surrogate/);
    await assert.rejects(Envelope.parse(reframe(json.replace('idx1.dispatch.v1', 'idx1.dispatch.v2'))), /features/);
    await assert.rejects(Envelope.parse(reframe(json.replace('"instructionStarts":[1,3,5]',
        '"instructionStarts":[1,3,4,5]'))), /map/);
    const badLayout = JSON.parse(JSON.stringify(compiled.layout));
    badLayout.fastEntry = 4;
    await assert.rejects(Envelope.frame(payload, badLayout), /fast entry/);
    console.log('IDX1 browser/Node envelope validation and Python parity tests passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });