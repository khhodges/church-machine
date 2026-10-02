'use strict';
const assert = require('node:assert/strict');
global.window = {};
const S = require('./simulator');
// All non-NULL vectors, including B, permission, generation and slot changes.
for (const reference of [0x1a000002, 0x1a000003, 0x1a010002, 0x3a000002, 0x9a000002]) {
    for (const cond of [14, 15]) {
        const s = new S();
        s.bootComplete = false;
        s.writeNSEntry(22, 0x400, 63, 0, 0, 1, 0, 0, 0);
        s.bootComplete = true;
        s.markLive(22);
        const cap = word0 => ({word0, word1: 0, word2: 0, word3: 0, m: 0});
        s.cr[14] = {...cap(s.createGT(0, 22, {R: 1, X: 1}, 1)), word1: 0x400};
        s.cr[12] = cap(0);
        s.cr[1] = cap(0x1a000002);
        s.cr[2] = cap(reference);
        s.memory[0x400] = ((31 << 27) | (1 << 10)) >>> 0;
        s.memory[0x401] = ((6 << 27) | (cond << 23) | (1 << 19) | (2 << 15) | 14) >>> 0;
        s.pc = 0;
        s.flags = {N: true, Z: true, C: true, V: true};
        const beforeCR = JSON.stringify(s.cr), beforeDR = Array.from(s.dr);
        const memory = s.memory.slice();
        s.fault = (type, message) => assert.fail(`${type}: ${message}`);
        const result = s.step();
        assert.ok(result);
        assert.equal(s.pc, 1);
        assert.equal(JSON.stringify(s.cr), beforeCR);
        assert.deepEqual(Array.from(s.dr), beforeDR);
        assert.deepEqual(s.memory, memory);
        assert.deepEqual(s.flags, cond === 15
            ? {N: true, Z: true, C: true, V: true}
            : {N: reference !== 0x1a000002, Z: reference === 0x1a000002, C: false, V: false});
    }
}
console.log('PASS TPERM EXACT: real step, equality, full-word mismatches, false predicate, no data writes');