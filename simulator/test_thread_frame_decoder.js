'use strict';

const assert = require('assert');
const ThreadFrameDecoder = require('./thread-frame-decoder.js');

const layout = {
    valid: true,
    base: 100,
    protectedStoOffset: 17,
    stackStart: 212,
    stackEnd: 243,
};
const memory = new Uint32Array(400);
const at = offset => layout.base + offset;
const frameWord = (nia, sz, prevSTO) =>
    (((nia & 0x7FFF) << 13) | ((sz & 1) << 12) | (prevSTO & 0xFFF)) >>> 0;
const rootGT = 0x01010006;
const ordinaryGT = 0x01010007;

function putRoot(sto = 241, gt = rootGT) {
    memory[at(layout.protectedStoOffset)] = (1 << 12) | sto;
    memory[at(242)] = gt;
    memory[at(243)] = frameWord(0x7FFF, 1, 243);
}

function decode() {
    return ThreadFrameDecoder.decode({
        memory,
        base: layout.base,
        layout,
        parseGT: word => ({
            type: 1, typeName: 'Inform', index: word & 0xFFFF,
            gt_seq: (word >>> 16) & 0x1FF, permissions: { E: 1 },
        }),
        validateGT: () => ({ status: 'valid', message: 'live Inform E-GT' }),
    });
}

putRoot();
let result = decode();
assert.strictEqual(result.classification, 'root', 'a dormant Thread image has a root frame');
assert.strictEqual(result.frames.length, 1);
assert.strictEqual(result.frames[0].kind, 'root');
assert.strictEqual(result.frames[0].offset, 243);
assert.strictEqual(result.frames[0].egt, rootGT);

function assertInvalidCompanion(label, companion, parseGT, expectedCode) {
    putRoot(241, companion);
    const decoded = ThreadFrameDecoder.decode({
        memory, base: layout.base, layout,
        parseGT: parseGT || (word => ({
            type: 1, typeName: 'Inform', index: word & 0xFFFF,
            gt_seq: (word >>> 16) & 0x1FF, permissions: { E: 1 },
        })),
        validateGT: () => ({ status: 'valid' }),
    });
    assert(decoded.errors.some(error => error.code === expectedCode),
        `${label} companion is rejected as ${expectedCode}`);
    assert.strictEqual(decoded.classification, 'malformed',
        `${label} companion cannot classify a root`);
}

assertInvalidCompanion('parse failure', rootGT, () => {
    throw new Error('bad GT encoding');
}, 'GT_PARSE');
assertInvalidCompanion('NULL', 1, word => ({
    type: 0, typeName: 'NULL', permissions: {},
}), 'INVALID_EGT');
assertInvalidCompanion('Abstract', rootGT, word => ({
    type: 3, typeName: 'Abstract', permissions: {},
}), 'INVALID_EGT');
assertInvalidCompanion('wrong Outform type', rootGT, word => ({
    type: 2, typeName: 'Outform', permissions: { E: 1 },
}), 'INVALID_EGT');
assertInvalidCompanion('missing E permission', rootGT, word => ({
    type: 1, typeName: 'Inform', permissions: { R: 1 },
}), 'INVALID_EGT');

for (const status of ['missing', 'malformed', 'invalid', 'unavailable']) {
    putRoot(241, rootGT);
    const validation = ThreadFrameDecoder.decode({
        memory, base: layout.base, layout,
        parseGT: word => ({
            type: 1, typeName: 'Inform', permissions: { E: 1 },
        }),
        validateGT: () => ({ status, message: `validator says ${status}` }),
    });
    const expected = status === 'missing' ? 'MISSING_EGT' :
        status === 'malformed' ? 'MALFORMED_EGT' :
        status === 'invalid' ? 'INVALID_EGT' : 'UNAVAILABLE_EGT';
    assert(validation.errors.some(error => error.code === expected),
        `validateGT ${status} status fails closed as ${expected}`);
    assert.strictEqual(validation.classification, 'malformed');
}

// An ordinary two-word frame is below the sentinel and is reached via
// protected STO + 2, then prev_STO + 2.  The old UI scanner decoded these
// words in the opposite order and lost the root.
memory[at(layout.protectedStoOffset)] = (1 << 12) | 239;
memory[at(240)] = ordinaryGT;
memory[at(241)] = frameWord(0x0042, 1, 241);
result = decode();
assert.strictEqual(result.classification, 'ordinary');
assert.deepStrictEqual(result.frames.map(frame => frame.kind), ['ordinary', 'root']);
assert.deepStrictEqual(result.frames.map(frame => frame.offset), [241, 243]);

// Actionable malformed cases.
memory[at(layout.protectedStoOffset)] = (1 << 12) | 239;
memory[at(240)] = 0;
memory[at(241)] = frameWord(0x0042, 1, 241);
result = decode();
assert.strictEqual(result.classification, 'malformed');
assert(result.errors.some(error => error.code === 'ZERO_COMPANION'));

memory[at(240)] = ordinaryGT;
memory[at(241)] = frameWord(0x0042, 1, 238);
result = decode();
assert(result.errors.some(error => error.code === 'NON_DESCENDING' ||
    error.code === 'LOOP'));

memory[at(241)] = frameWord(0x0042, 1, 0xFFF);
result = decode();
assert(result.errors.some(error => error.code === 'OOB'));

memory[at(layout.protectedStoOffset)] = (1 << 12) | 239;
memory[at(241)] = frameWord(0x0042, 1, 241);
memory[at(243)] = frameWord(0x0042, 1, 241);
result = decode();
assert(result.errors.some(error => error.code === 'NON_DESCENDING' ||
    error.code === 'LOOP'));

// Freshness is deliberately delegated to the caller so the decoder remains
// usable with saved images that have no Namespace service.
memory[at(241)] = frameWord(0x0042, 1, 241);
result = ThreadFrameDecoder.decode({
    memory, base: layout.base, layout,
    parseGT: word => ({
        type: 1, index: word & 0xFFFF, gt_seq: 1, permissions: { E: 1 },
    }),
    validateGT: () => ({ status: 'stale', message: 'saved generation is stale' }),
});
assert(result.errors.some(error => error.code === 'STALE_EGT'));

// A second sentinel below the root is not silently treated as another root.
memory[at(layout.protectedStoOffset)] = (1 << 12) | 239;
memory[at(241)] = frameWord(0x0042, 1, 241);
memory[at(243)] = frameWord(0x7FFF, 1, 243);
memory[at(238)] = frameWord(0x7FFF, 1, 238);
result = decode();
assert(result.errors.some(error => error.code === 'DUPLICATE_ROOT'));

console.log('Thread frame decoder tests passed');