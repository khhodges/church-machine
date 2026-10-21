'use strict';
// Check the admitted bytes unchanged: no provisioning, opcode patches or grants.
const fs = require('fs'), assert = require('assert');
const Simulator = require('./simulator');
const sim = Simulator.fromAscendingNamespaceImage(fs.readFileSync(process.argv[2]),
    {word0:0x02000001,word1:0,word2:255,word3:0,m:1});
sim.beginBoot();
for(let i=0;i<3;i++) assert(sim._bootStep(), JSON.stringify(sim.faultLog));
let revealed = false;
let clearedBeforeReveal = false;
let beforeAttack = null;
const visited = new Set();
for (let i=0; i<150 && !sim.halted && !sim.faultLog.length; i++) {
    visited.add(sim.cr[14].word0 & 0xffff);
    sim.step();
    if (sim._currentThreadSlot === 11 && sim.pc === 5 &&
            (sim.cr[14].word0 & 0xffff) === 18 && sim.dr[1] === 0)
        clearedBeforeReveal = true;
    if (clearedBeforeReveal && sim._currentThreadSlot === 11 && sim.pc === 7 &&
            sim.dr[1] === 731 && sim.dr[3] === 0 && (sim.cr[14].word0 & 0xffff) === 18)
        revealed = true;
    if (sim._currentThreadSlot === 12 && beforeAttack === null) {
        assert(revealed, 'Mallory ran before Alice completed Reveal');
        const base = sim.memory[16*4];
        beforeAttack = Array.from(sim.memory.slice(base, base + 128));
    }
}
assert(revealed, 'Alice did not return the stashed value');
assert(visited.has(16) && visited.has(17), JSON.stringify([...visited]));
assert.equal(sim.faultLog.length, 1, JSON.stringify(sim.faultLog));
assert.equal(sim.faultLog[0].type, 'NO_CAPABILITY', JSON.stringify(sim.faultLog));
assert.equal(sim.faultLog[0].threadSlot, 12);
assert.equal(sim.faultLog[0].faultingAbstractionSlot, 17);
assert.equal(sim.faultLog[0].faultingMnemonic, 'LOAD');
assert.equal(sim.faultLog[0].pc, 1);
assert.deepEqual(Array.from(sim.memory.slice(sim.memory[16*4], sim.memory[16*4]+128)), beforeAttack);
assert.equal(sim.memory[sim.memory[16*4] + 9], 731, 'Alice storage changed');
console.log(JSON.stringify({revealed, firstFault:sim.faultLog[0].type, visited:[...visited]}));
