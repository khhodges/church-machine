'use strict';

// Regression test for the reserved SelfTest Next capability alias.
// Run with: node simulator/test_next_capability.js

const assert = require('assert');
const CapabilityTokens = require('./capability_tokens.js');

const sim = {
    bootEntrySlot: 7,
    nsLabels: { 6: 'SelfTest', 7: 'LightningBoltTarget' },
};

const result = CapabilityTokens.resolveCapability(
    { name: 'Next', rights: ['E'] },
    { sim, lumps: [] }
);

assert.strictEqual(result.error, null);
assert.strictEqual(result.nsIndex, 7);
assert.strictEqual(result.source, 'lightning-bolt');
assert.deepStrictEqual(result.rights, ['E']);

console.log('PASS: capability "Next" resolves to the LightningBolt boot-entry GT');