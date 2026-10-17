'use strict';
// Separate intentional rejection probes; never mixed with normal replay faults.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Simulator = require('../simulator/simulator');
const image = fs.readFileSync(process.argv[2]);
const make = () => {
    const sim = Simulator.fromAscendingNamespaceImage(image,
        {word0: 0x02000001, word1: 0, word2: 1023, word3: 0, m: 1});
    assert(sim.startEntryThread());
    return sim;
};
const atSwitch = () => {
    const sim = make();
    for (let i = 0; i < 19; i++) assert(sim.step());
    assert.equal(sim.pc, 19);
    assert.equal(sim.cr[6].word0, 0x4A00000A);
    assert.equal(sim.cr[6].m, 1);
    return sim;
};
{
    const sim = atSwitch(), gt = sim.cr[6].word0;
    assert(sim.step(), 'E-only CR6 plus established M must support isolated LOAD');
    assert.equal(sim.cr[6].word0, gt, 'no permission bits minted');
    assert.equal(sim.cr[13].word0, 0x0200000B);
    assert.equal(sim.cr[13].m, 0, 'destination M consumed');
}
for (const change of [
    sim => { sim.cr[6].m = 0; },
    sim => { sim.cr[6].word0 = 0x0200000A; },
    sim => { sim.cr[13].m = 0; },
]) {
    const sim = atSwitch();
    change(sim);
    assert.equal(sim.step(), null);
    assert(sim.halted);
    assert(sim.faultLog.length);
}
{
    const sim = make();
    assert.equal(sim._mmioDeviceSlot(8), 2, 'UART uses device address, not historical slot');
    assert.equal(sim._mmioDeviceSlot(2), -1, 'Boot.Thread is not the old UART alias');
    assert.equal(sim._mmioDeviceSlot(12), -1, 'Thread.3 is not the old LED alias');
    assert.equal(sim._mmioDeviceSlot(3), 3);
    // Unknown addresses/oversized descriptors cannot silently read zero.
    const descriptor = 8 * 4, location = 0x40001000;
    const authority = sim.memory[descriptor + 1];
    sim.memory.set([location, authority, sim._integrity32(location, authority), 0], descriptor);
    assert.equal(sim.mLoad(0x32010008, 'R', 2).ok, false);
}
{
    const sim = make(), descriptor = 8 * 4;
    const location = sim.memory[descriptor];
    const authority = sim.packNSWord1(2, 2, 0, 0);
    sim.memory.set([location, authority, sim._integrity32(location, authority), 0], descriptor);
    assert.equal(sim.mLoad(0x32010008, 'R', 2).fault, 'VERSION');
}
console.log('PASS Phase 1 E/M gates, exact device routing, unknown-device and stale-generation rejections');
