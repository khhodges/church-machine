'use strict';
const assert = require('node:assert/strict');
global.window = {};
const Simulator = require('./simulator');

// Independent ISA expectations, not computed by another implementation.
// Keep type non-NULL even when toggling either type bit.
const base = 0x7e550123;
const vectors = [[base, base, true], [0xfe550123, 0xfe550123, true]];
for (let bit = 0; bit < 32; bit++) vectors.push([base, (base ^ (2 ** bit)) >>> 0, false]);

for (const [left, right, equal] of vectors) for (const cond of [14, 0, 1, 15]) {
    const sim = new Simulator();
    sim.bootComplete = false;
    sim.writeNSEntry(22, 0x400, 63, 0, 0, 1, 0, 0, 0);
    sim.markLive(22);
    sim.bootComplete = true;
    const cap = (word0, word1, word2, m) => ({word0, word1, word2, word3: 0, m});
    sim.cr[14] = cap(sim.createGT(0, 22, {R: 1, X: 1}, 1), 0x400, 0, 0);
    sim.cr[12] = cap(0, 0, 0, 0);
    sim.cr[2] = cap(left, 0x1234, 0x76543210, 1);
    sim.cr[3] = cap(right, 0x5678, 0x12345678, 0);
    sim.dr[7] = 0xdeadbeef;
    sim.memory[0x400] = ((31 << 27) | (1 << 10)) >>> 0;
    // Existing low-imm preset route only; not a decision on D3 encoding.
    sim.memory[0x401] = ((6 << 27) | (cond << 23) | (2 << 19) | (3 << 15) | 14) >>> 0;
    sim.pc = 0;
    const initial = {N: true, Z: false, C: true, V: true};
    sim.flags = {...initial};
    const cr = structuredClone(sim.cr), dr = Array.from(sim.dr), memory = sim.memory.slice();
    const faults = [];
    sim.fault = (...args) => faults.push(args);
    assert.ok(sim.step());
    assert.deepEqual(faults, []);
    assert.equal(sim.pc, 1);
    assert.deepEqual(sim.cr, cr);
    assert.deepEqual(Array.from(sim.dr), dr);
    assert.deepEqual(sim.memory, memory);
    assert.deepEqual(sim.flags, cond === 0 || cond === 15 ? initial :
        {N: !equal, Z: equal, C: false, V: false});
    if (cond === 14 || cond === 1)
        assert.match(sim.output, new RegExp(`credential ${equal ? 'match' : 'mismatch'} — Z=${+equal}`));
}
console.log('TPERM EXACT: equal, every word0 bit, preserved state and predicates passed');