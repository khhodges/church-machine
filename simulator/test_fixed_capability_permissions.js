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
assert.match(reduced.error, /authored permissions are RW and cannot be changed/);

const expanded = CapabilityTokens.resolveCapability(
    { name: 'LED_DEV', rights: ['R', 'W', 'X'] },
    { sim, lumps: [] }
);
assert.match(expanded.error, /authored permissions are RW and cannot be changed/);

const thread = CapabilityTokens.resolveCapability(
    { name: 'Thread.2', rights: [] },
    { sim, lumps: [] }
);
assert.strictEqual(thread.error, null, 'an authored empty Thread permission field is accepted');

const changedThread = CapabilityTokens.resolveCapability(
    { name: 'Thread.2', rights: ['E'] },
    { sim, lumps: [] }
);
assert.match(changedThread.error, /permission field empty/);

const changedNamespace = CapabilityTokens.resolveCapability(
    { name: 'ExistingService', rights: ['X'] },
    { sim: { nsLabels: { 7: 'ExistingService' } }, lumps: [] }
);
assert.match(changedNamespace.error, /authored permissions are E and cannot be changed/);

console.log('PASS: existing GT permissions are immutable for consuming programs');