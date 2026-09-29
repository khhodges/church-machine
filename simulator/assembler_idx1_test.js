'use strict';
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const ChurchAssembler = require('./assembler.js');
const idx1 = require('./idx1.js');

function assemble(source, layout) {
    return new ChurchAssembler().assemble(source, { profile: 'IDX1', layout });
}
function code(length, fastEntry = 1) {
    return { extents: [{ startWord: 1, endWord: length + 1, kind: 'code' }],
        dispatch: [], fastEntry };
}
function good(source, length, layout = code(length)) {
    const out = assemble(source, layout);
    assert.deepEqual(out.errors, [], JSON.stringify(out.errors));
    assert.equal(out.words.length, length);
    return out;
}
function bad(source, layout = code(1), pattern) {
    const out = assemble(source, layout);
    assert.ok(out.errors.length, `Expected rejection: ${source}`);
    if (pattern) assert.match(out.errors.map(e => e.message).join('\n'), pattern);
}

const load = good('LOAD CR1, CR6, DR11 + 2', 2);
assert.deepEqual(load.words, [0x52B00002, 0x070B0000]);
assert.deepEqual(load.instructionStarts, [1]);
assert.equal(load.sourceMap[0].wordCount, 2);
assert.equal(load.sourceMap[0].byteStart, 4);
assert.equal(load.sourceMap[0].byteEnd, 12);
assert.equal(load.lineNums.length, 2);
assert.equal(load.layout.codeWords, 2);
assert.equal(load.layout.fastEntry, 1);
assert.deepEqual(good('CALL CR6[DR2 + 4], DR4 - 1', 3).words,
    [0x56200004, 0x17030000, 0x01400001]);
// Synthetic structure-only integration: serialize an ordinary 64-word inner
// LUMP around the assembler's exact output, then frame and parse it with the
// server validator. Neither framing nor parsing admits or executes the code.
const framedCall = good('CALL CR6[DR2 + 4], DR4 - 1\nRETURN', 4);
const parsed = JSON.parse(execFileSync('python3', ['-c', `
import hashlib, json, struct, sys
from server.idx1_profile import FEATURES, frame_envelope, parse_envelope
source = json.load(sys.stdin)
words, layout = source["words"], source["layout"]
header = (31 << 27) | (len(words) << 10)
payload = struct.pack(">I", header) + struct.pack(">" + "I" * len(words), *words)
payload += bytes(64 * 4 - len(payload))
meta = {"schema": "cm.idx1.execution/1", "isaProfile": "IDX1",
        "requiredFeatures": list(FEATURES),
        "payloadSha256": hashlib.sha256(payload).hexdigest(),
        "layout": layout}
decoded = parse_envelope(frame_envelope(payload, meta))
print(json.dumps({"starts": decoded.instruction_starts,
                  "codeWords": decoded.code_words,
                  "fastEntry": decoded.fast_entry,
                  "firstWords": list(struct.unpack_from(">3I", decoded.payload, 4))}))
`], { input: JSON.stringify({ words: framedCall.words, layout: framedCall.layout }),
    encoding: 'utf8' }));
assert.deepEqual(parsed, {
    starts: [1, 4], codeWords: 4, fastEntry: 1,
    firstWords: [0x56200004, 0x17030000, 0x01400001],
});
assert.deepEqual(good('CALL CR3, selector(1)', 1).words, [0x17180001]);
assert.deepEqual(good('CALL CR3, 1', 1).words, [0x17180002]);
assert.deepEqual(good('DREAD DR1, CR2, DR15 + 1048575', 2).words,
    [0x52FFFFFF, 0x87094000]);
assert.deepEqual(good('BFEXT DR1, DR2, DR3 + 2, 8', 2).words,
    [0x52300002, 0x97090008]);
assert.deepEqual(good('BRANCHNE DR0 - 2', 2).words,
    [0x53000002, 0xB8800000]);
assert.deepEqual(good('LOAD CR1, CR6, 2', 1).words, [0x070B0002]);
const mixed = good('start:\nLOAD CR1, CR6, DR1\nBRANCH end\nCALL CR6[DR2], DR3\nend:\nRETURN',
    7);
assert.deepEqual(mixed.instructionStarts, [1, 3, 4, 7]);
assert.deepEqual(mixed.labels, { start: 0, end: 6 });
assert.equal(mixed.words[2] & 0x7FFF, 4); // target word6 minus branch word2
assert.equal(mixed.sourceMap[2].wordCount, 3);
assert.deepEqual(mixed.words.slice(3, 6), idx1.encodePacket({
    w1: 0x17030000,
    role0: { register: 2, magnitude: 0, subtract: false },
    role1: { register: 3, magnitude: 0, subtract: false },
}));
bad('ELOADCALL CR0, CR6, 1', code(1), /retired/);
bad('XLOADLAMBDA CR0, CR6, 1', code(1), /retired/);
bad('BFEXT DR1, DR2, DR3, 0', code(2), /width/);
bad('LOAD CR1, CR6, DR16', code(2), /Invalid IDX1/);
bad('LOAD CR1, CR6, DR1 + 1048576', code(2), /magnitude/);
assert.deepEqual(good('CALL CR6[DR1 + 2], selector(DR2 - 0)', 3).words,
    [0x56100002, 0x17030000, 0x00200000]);
assert.match(assemble('RETURN').errors[0].message, /requires explicit layout/);
const data = good('BRANCH 2\n.word 0\nRETURN', 3,
    { extents: [{ startWord: 1, endWord: 2, kind: 'code' },
        { startWord: 2, endWord: 3, kind: 'data' },
        { startWord: 3, endWord: 4, kind: 'code' }],
    dispatch: [{ selector: 2, word: 2, kind: 'private' }], fastEntry: 1 });
assert.deepEqual(data.instructionStarts, [1, 3]);
assert.deepEqual(data.layout.dispatch, [{ selector: 2, word: 2, kind: 'private' }]);
const dispatch = good('BRANCH 1\nRETURN', 2,
    { ...code(2), dispatch: [{ selector: 1, word: 1, kind: 'branch' }] });
assert.equal(dispatch.layout.dispatch[0].kind, 'branch');
bad('BRANCHNE 1\nRETURN', { ...code(2),
    dispatch: [{ selector: 1, word: 1, kind: 'branch' }] }, /dispatch/);
bad('RETURN', { ...code(1), codeWords: 2 }, /codeWords/);
bad('RETURN', { ...code(1), instructionStarts: [2] }, /instructionStarts/);
bad('LOAD CR1, CR6, DR1', code(1), /extents/);
bad('LOAD CR1, CR6, DR1', { ...code(2), fastEntry: 2 }, /fastEntry/);
bad('LOAD CR1, CR6, DR1', { extents: [{ startWord: 1, endWord: 2, kind: 'code' },
    { startWord: 2, endWord: 3, kind: 'data' }], dispatch: [], fastEntry: 1 },
    /cuts an instruction|misclassifies/);
assert.deepEqual(new ChurchAssembler().assemble('LOAD CR1, CR6, 2').words, [0x070B0002]);
assert.deepEqual(new ChurchAssembler().assemble('CALL CR3, 1', { profile: 'LEGACY' }).words,
    [0x17180002]);
console.log('IDX1 assembler synthetic tests passed');