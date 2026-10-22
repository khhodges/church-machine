'use strict';
// Exact Python-generated factory words, not a JS re-encoding.
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {fixture} = require('../tests/simulator/cr6_contract_fixture');
const programs = JSON.parse(execFileSync('python3', ['-c', `
import json
from hardware.boot_rom import NUC_PROGRAM, WUKONG_NUC_PROGRAM
from hardware.wukong_top import _BRANCH_MINUS_1
from hardware.wukong_trace_symbols import WUKONG_CALLHOME_WORDS
assert tuple(WUKONG_NUC_PROGRAM) == WUKONG_CALLHOME_WORDS
print(json.dumps([NUC_PROGRAM, WUKONG_NUC_PROGRAM, [0, _BRANCH_MINUS_1]]))
`], {encoding: 'utf8'}));
let count = 0;
for (const words of programs) {
    const {sim, install, activate} = fixture(true);
    activate(install(30, words));
    words.forEach((word, pc) => {
        if (word >>> 27 !== 23) return;
        const magnitude = word & 0x3ffff;
        const target = pc + ((word & 0x40000) ? -magnitude : magnitude);
        assert(target >= 0 && target < words.length, 'factory branch stays within code');
        // Exercise the actual fetched conditional instruction with its taken
        // condition, then its untaken case. Other loop instructions are not mocked.
        const condition = (word >>> 23) & 15;
        assert([0, 1, 14].includes(condition));
        sim.flags.Z = condition === 0;
        sim.pc = pc;
        sim.step();
        assert.equal(sim.pc, target);
        if (condition !== 14) {
            sim.flags.Z = condition !== 0;
            sim.pc = pc;
            sim.step();
            assert.equal(sim.pc, pc + 1);
        }
        count++;
    });
}
// Legacy imm15 -1 is NOT translated or silently executed as a valid loop.
const old = fixture(true);
old.activate(old.install(30, [0xbf007fff]));
let fault;
old.sim.fault = (type, message) => { fault = {type, message}; old.sim.halted = true; };
old.sim.step();
assert.equal(fault?.type, 'BOUNDS');
assert.match(fault.message, /recompile/i);
console.log(`PASS: ${count} exact factory/guard branch words execute; legacy loop rejected`);
