'use strict';
// Isolated instruction-description regressions; no user program or LUMP is loaded.
const assert = require('node:assert/strict');
const ChurchSimulator = require('./simulator.js');
const PipelineVisualizer = require('./pipeline.js');

const sim = new ChurchSimulator();
sim.dr[1] = 0;
sim.dr[2] = 4096;
const sub = sim._execIsub({ crDst: 1, crSrc: 1, imm: 0x4000 });
assert.match(sub.desc, /0 - 0 = 0/);
const add = sim._execIadd({ crDst: 1, crSrc: 1, imm: 2 });
assert.match(add.desc, /0 \+ 4096 = 4096/);
assert.match(add.pipeline[0].desc, /pre-write DR1 \(0\) \+ DR2 \(4096\) = 4096/);
sim.dr[1] = 9999;
assert.match(add.desc, /0 \+ 4096 = 4096/); // immutable result after state changes

sim.dr[3] = 7;
const same = sim._execIadd({ crDst: 3, crSrc: 3, imm: 3 });
assert.match(same.desc, /7 \+ 7 = 14/);
const zero = sim._execIsub({ crDst: 0, crSrc: 3, imm: 0x4001 });
assert.match(zero.desc, /write discarded; DR0 remains 0/);
// step() resets DR0 at retirement; the direct helper intentionally skips that boundary.

sim.dr[4] = 0x80000000;
const field = sim._execBfext({ crDst: 5, crSrc: 4, imm: (31 << 5) | 1 });
assert.match(field.pipeline[0].desc, /bits \[31:31\]/);
sim.dr[6] = 1;
const insert = sim._execBfins({ crDst: 6, crSrc: 6, imm: (1 << 5) | 1 });
assert.match(insert.desc, /-> 0x3/);
assert.match(insert.pipeline[0].desc, /pre-write DR6/);
const returnStages = sim._returnPipeline({}, { sz: 0, savedSTO: 4, returnPC: 8 }, 0, 1);
assert.match(returnStages[0].desc, /2-word CALL/); // active indicator, not previous frame SZ
assert.ok(returnStages.some(stage => stage.stage === 'E-GT'));
assert.match(sim._tpermPipeline({ imm: 0 }, { permissions: {} }, true)[0].desc, /CLEAR existence/);

// REPL-produced illustrations must not masquerade as retired security gates.
const illustrative = PipelineVisualizer.prototype.buildSecurityTrace('CALL', { target: 'Target' });
assert.equal(illustrative.length, 1);
assert.equal(illustrative[0].status, 'info');
assert.doesNotMatch(illustrative[0].desc, /DR0 =|result in DR0/);
console.log('truthful simulator comments: isolated synthetic checks passed');