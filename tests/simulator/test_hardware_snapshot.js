// Regression tests for atomic physical-Wukong snapshot application.
'use strict';

const assert = require('assert');
const ChurchSimulator = require('../../simulator/simulator.js');

function snapshot() {
    return {
        snapshot: true,
        version: 1,
        flags: 0x0D,
        m_flag: true,
        nia: 0x1234,
        sto: 0x55,
        thread_base: 0x220,
        stored_cr12_gt: 0xA1,
        stored_packed_pc: 0xB2,
        stored_mflag: 0xC3,
        cr: Array.from({length: 16}, (_, i) => [i + 1, i + 2, i + 3]),
        dr: Array.from({length: 16}, (_, i) => 0x100 + i),
    };
}

const sim = new ChurchSimulator();
sim.pc = 7;
sim.physicalPC = 9;
const breakpoints = new Set([0x1234]);
const result = sim.applyHardwareSnapshot(snapshot());

assert.deepStrictEqual(result, {ok: true});
assert.strictEqual(sim.pc, 7, 'hardware NIA must not replace logical simulator PC');
assert.strictEqual(sim.physicalPC, 0x1234);
assert.strictEqual(sim.cr[15].word0, 16);
assert.strictEqual(sim.cr[15].m, 1);
assert.strictEqual(sim.dr[15], 0x10F);
assert.deepStrictEqual(sim.flags, {N: true, Z: true, C: false, V: true});
assert.strictEqual(sim.sto, 0x55);
assert.strictEqual(sim.hardwareSnapshot.stored_cr12_gt, 0xA1);
assert.strictEqual(sim.hardwareSnapshot.stored_packed_pc, 0xB2);
assert.deepStrictEqual([...breakpoints], [0x1234]);

const before = JSON.stringify(sim.cr);
assert.strictEqual(sim.applyHardwareSnapshot({...snapshot(), cr: snapshot().cr.slice(0, 15)}).ok, false);
assert.strictEqual(JSON.stringify(sim.cr), before, 'invalid snapshot must not partially commit');
console.log('hardware snapshot tests: passed');