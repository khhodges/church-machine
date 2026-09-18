'use strict';

global.window = { bootConfig: {} };

const assert = require('assert');
const ChurchAssembler = require('../../simulator/assembler.js');
const ChurchSimulator = require('../../simulator/simulator.js');

const changedPermissionSource = [
    'capabilities {',
    '    Boot.Thread E',
    '}',
    'SWITCH CR12, CR6[Boot.Thread]',
].join('\n');

const compiled = new ChurchAssembler().assemble(changedPermissionSource);
assert.deepStrictEqual(
    compiled.errors,
    [],
    'a permission difference must reach runtime rather than fail compilation'
);
assert.strictEqual(compiled.words.length, 1, 'the unauthorized operation must be emitted');

const sim = new ChurchSimulator();
sim.memory[0] = compiled.words[0] >>> 0;
sim.pc = 0;
sim.halted = false;
sim.cr[12].m = 0;

const result = sim.step();
const fault = sim.faultLog[sim.faultLog.length - 1];
assert.strictEqual(result, null, 'the unauthorized SWITCH must not retire');
assert.ok(fault, 'runtime must record an M-bit authorization fault');
assert.strictEqual(fault.type, 'PERM_L');
assert.match(fault.message, /destination CR12 had M=0/);
assert.strictEqual(sim.pc, 0, 'a rejected SWITCH must not advance the machine');
assert.strictEqual(sim.cr[12].m, 0, 'runtime rejection must not elevate the destination M bit');

const permissionlessThreads = new ChurchAssembler().assemble([
    'capabilities {',
    '    Boot.Thread',
    '    Thread.2',
    '}',
    'SWITCH CR12, CR6[Boot.Thread]',
    'CHANGE CR12, CR6[Thread.2]',
].join('\n'));
assert.deepStrictEqual(
    permissionlessThreads.errors,
    [],
    'permissionless Thread SWITCH/CHANGE declarations remain valid'
);
assert.strictEqual(permissionlessThreads.words.length, 2);

console.log('[PASS] changed GT permissions compile and reach runtime M-bit rejection');
console.log('[PASS] permissionless Thread SWITCH/CHANGE declarations remain valid');