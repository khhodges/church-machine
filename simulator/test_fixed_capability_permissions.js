'use strict';

const assert = require('assert');
const CapabilityTokens = require('./capability_tokens.js');

const sim = {
    nsLabels: { 3: 'LED_DEV', 11: 'Thread.2' },
    abstractionRegistry: {
        abstractions: {
            devices: {
                capabilities: [
                    { name: 'LED_DEV', target: 3, grants: ['R', 'W'] },
                ],
            },
        },
    },
};

const exact = CapabilityTokens.resolveCapability(
    { name: 'LED_DEV', rights: ['R', 'W'] },
    { sim, lumps: [] }
);
assert.strictEqual(exact.error, null, 'the authored permission set is accepted');

const reduced = CapabilityTokens.resolveCapability(
    { name: 'LED_DEV', rights: ['R'] },
    { sim, lumps: [] }
);
assert.match(reduced.error, /cannot redefine/, 'a reference cannot narrow the definition');

const expanded = CapabilityTokens.resolveCapability(
    { name: 'LED_DEV', rights: ['R', 'W', 'X'] },
    { sim, lumps: [] }
);
assert.match(expanded.error, /cannot redefine/, 'a reference cannot expand the definition');

const thread = CapabilityTokens.resolveCapability(
    { name: 'Thread.2', rights: [] },
    { sim, lumps: [] }
);
assert.strictEqual(thread.error, null, 'an authored empty Thread permission field is accepted');

const changedThread = CapabilityTokens.resolveCapability(
    { name: 'Thread.2', rights: ['E'] },
    { sim, lumps: [] }
);
assert.match(changedThread.error, /cannot redefine/, 'Thread definition permissions remain fixed');

const changedNamespace = CapabilityTokens.resolveCapability(
    { name: 'ExistingService', rights: ['X'] },
    { sim: { nsLabels: { 7: 'ExistingService' } }, lumps: [] }
);
assert.strictEqual(changedNamespace.error, null);

const definitions = [{name: 'Defined', authored_rights: ['R', 'W']}];
assert.strictEqual(CapabilityTokens.resolveCapability(
    {name: 'Defined', rights: ['W', 'R']}, {lumps: definitions}).error, null);
assert.match(CapabilityTokens.resolveCapability(
    {name: 'Defined', rights: ['X']}, {lumps: definitions}).error, /cannot redefine/);
assert.deepStrictEqual(definitions[0].authored_rights, ['R', 'W']);
assert.strictEqual(CapabilityTokens.resolveCapability(
    {name: 'NewIdea', rights: ['X']}, {lumps: []}).error, null,
    'a first symbolic definition does not require a live Namespace');
console.log('PASS: definitions are fixed; runtime M-bit operations are separate');