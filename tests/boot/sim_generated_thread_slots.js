// Regression coverage for the fallback simulator's generated Thread entries.
// The Python parity test compares image words; this also asserts visible labels.
'use strict';

const assert = require('assert');

function run(count) {
    global.window = {
        bootConfig: {
            step1: {
                totalNamespaceWords: 16384,
                namespaceLumpWords: 1024,
                threadLumpWords: 256,
                threadCount: count,
            },
        },
    };
    delete require.cache[require.resolve('../../simulator/simulator.js')];
    const ChurchSimulator = require('../../simulator/simulator.js');
    const sim = new ChurchSimulator();
    const expectedSlots = [];
    for (let n = 2; n <= count; n++) expectedSlots.push(9 + n);

    assert.strictEqual(sim.nsCount, 10 + count);
    for (let n = 2; n <= count; n++) {
        const slot = 9 + n;
        const entry = sim.readNSEntry(slot);
        assert(entry, `Thread#${n} descriptor missing at NS slot ${slot}`);
        assert.strictEqual(sim.nsLabels[slot], `Thread#${n}`);
        assert.strictEqual(sim.memory[entry.word0_location] >>> 27, 0x1F);
        assert.strictEqual(sim.memory[entry.word0_location + 244],
            sim.memory[244], `Thread#${n} CR0 must match Thread.1`);
    }
    assert.deepStrictEqual(
        Object.keys(sim.nsLabels).map(Number).filter(slot => slot >= 11 && sim.nsLabels[slot].startsWith('Thread#')),
        expectedSlots);
}

[1, 2, 5].forEach(run);
console.log('generated Thread Namespace slot tests passed');