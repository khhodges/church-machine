'use strict';

const assert = require('assert');
const CLOOMCCompiler = require('./cloomc_compiler.js');
const H = 'a'.repeat(64);
const I = 'b'.repeat(64);
const compiler = new CLOOMCCompiler();
const source = `@portable
abstraction Wallet {
  capabilities { church.Audit#3 T=a1b2c3d4 binary_hash=${H} identity_hash=${I} rights=L type=Inform row=1 }
  method run() { return(0); }
}`;
const result = compiler.compile(source, []);
assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
assert.equal(result.portableMode, 'portable');
assert.equal(result.capabilities[0].compiler_owned_self, true);
assert.deepEqual(result.capabilities[1].rights, ['L']);
assert.equal(result.capabilities[1].N, 'church.Audit#3');

const unpinned = compiler.compile(`@portable
abstraction Bad {
  capabilities { church.Audit#3 L }
  method run() { return(0); }
}`, []);
assert.ok(unpinned.errors.some(e => /pinned descriptor/.test(e.message)),
    'portable source must fail closed on an unpinned dependency');
const legacy = compiler.compile(`@legacy
abstraction Old {
  capabilities { Audit L }
  method run() { return(0); }
}`, []);
assert.equal(legacy.errors.length, 0, JSON.stringify(legacy.errors));
assert.equal(legacy.portableMode, 'explicit-legacy');
console.log('portable descriptor compiler tests passed');