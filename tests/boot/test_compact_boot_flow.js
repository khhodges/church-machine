'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
global.window = {bootConfig: {step1: {
    totalNamespaceWords: 16384, namespaceLumpWords: 64,
    threadLumpWords: 512, threadCount: 3,
}}};
const Simulator = require('../../simulator/simulator');
const generated = spawnSync('python3',
    [path.join(__dirname, 'round_robin_image_fixture.py'), '--compact-boot'],
    {timeout: 30000});
assert.equal(generated.status, 0, String(generated.stderr));
const bytes = generated.stdout;
const s = new Simulator();
assert.equal(s.loadBootImage(bytes.buffer.slice(bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength)), true, s.lastBootImageError);
const base = s.readNSEntry(6).word0_location;
assert.equal(s.memory[base] & 255, 2, 'approved cc must survive generation');
const target = s.createGT(0, 221, {E: 1}, 1);
assert.equal(s.memory[base + 63] >>> 0, target >>> 0,
    'saved row 1 must not be replaced by the selected boot entry');
for (let i = 0; !s.bootComplete && i < 32; i++) s._bootStep();
assert.equal(s.bootComplete, true);
assert.equal(s.cr[6].word1, base + 62);
assert.equal(s.cr[6].m, 1);
const retired = [];
for (let i = 0; i < 6; i++) {
    const result = s.step();
    assert.ok(result, JSON.stringify(s.faultLog));
    retired.push(result.instr.opcode);
    assert.equal(s._currentThreadSlot, 1, 'no Thread switch repairs CR6');
}
assert.deepEqual(retired, [0, 2, 21, 3, 0, 21]);
assert.equal(s.cr[2].word0 >>> 0, target >>> 0, 'post-return LOAD uses saved list');
assert.equal(s.dr[3], 1, 'callee ran');
assert.equal(s.dr[4], 1, 'caller continued');
assert.equal(s.faultLog.length, 0);
console.log('PASS generated image -> boot -> LOAD -> CALL -> RETURN -> LOAD; zero faults, no CHANGE');
