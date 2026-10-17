'use strict';
const assert = require('assert');
const lab = require('./alice_mallory_lab');
for (const name of ['tuple-alice', 'tuple-mallory']) {
    const s = lab.createScenario(name);
    while (s.attempts < s.limit) lab.step(s);
    assert.match(lab.outcome(s), /^PASS:/);
    const count = s.attempts;
    lab.step(s);
    assert.equal(s.attempts, count, 'cannot execute beyond proof boundary');
    s.sim.memory[s.tupleAddress + 6] ^= 1;
    assert.throws(() => lab.outcome(s), /./, 'corrupt tuple must not retain a PASS');
    console.log(name + ': passed, including tampered-evidence rejection');
}
