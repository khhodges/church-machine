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
assert.strictEqual(reduced.error, null, 'compiler does not enforce runtime M-bit policy');

const expanded = CapabilityTokens.resolveCapability(
    { name: 'LED_DEV', rights: ['R', 'W', 'X'] },
    { sim, lumps: [] }
);
assert.strictEqual(expanded.error, null, 'registry grants do not become a compiler block');

const thread = CapabilityTokens.resolveCapability(
    { name: 'Thread.2', rights: [] },
    { sim, lumps: [] }
);
assert.strictEqual(thread.error, null, 'an authored empty Thread permission field is accepted');

const changedThread = CapabilityTokens.resolveCapability(
    { name: 'Thread.2', rights: ['E'] },
    { sim, lumps: [] }
);
assert.strictEqual(changedThread.error, null, 'Thread declarations are not blocked by the compiler');

const changedNamespace = CapabilityTokens.resolveCapability(
    { name: 'ExistingService', rights: ['X'] },
    { sim: { nsLabels: { 7: 'ExistingService' } }, lumps: [] }
);
assert.strictEqual(changedNamespace.error, null);

console.log('PASS: authored permission policy is deferred to the runtime M-bit mechanism');