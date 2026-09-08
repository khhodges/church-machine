'use strict';

const assert = require('assert');

global.window = global;
delete require.cache[require.resolve('./lump-registry.js')];
require('./lump-registry.js');

const registry = global.LumpRegistry;
assert(registry, 'LumpRegistry should be exported on window');

registry.registerFromServer([
    { token: 'undated', abstraction: 'Legacy' },
    { token: 'older-server', abstraction: 'Older', compiled_at: 1700000000 },
    { token: 'tie-b', abstraction: 'Tie B', compiled_at: 1800000000 },
    { token: 'tie-a', abstraction: 'Tie A', compiled_at: 1800000000 },
]);

registry.registerMemory('newer-memory', 'Newer memory', [], []);
registry.resolve('newer-memory').sources.memory.registeredAt = 1900000000000;

// A server-backed entry must use persisted compile time, not fetch time or a
// newer memory registration attached to the same token.
registry.registerMemory('older-server', 'Older', [], []);
registry.resolve('older-server').sources.memory.registeredAt = 1950000000000;

assert.strictEqual(
    registry.timestampFor(registry.resolve('older-server')),
    1700000000000,
    'server compiled_at seconds should normalize to milliseconds');
assert.strictEqual(
    registry.timestampFor(registry.resolve('newer-memory')),
    1900000000000,
    'memory-only registeredAt should remain milliseconds');
assert.strictEqual(
    registry.timestampFor(registry.resolve('undated')),
    null,
    'undated server records should not use transient fetchedAt');

assert.deepStrictEqual(
    registry.list().map(entry => entry.token),
    ['newer-memory', 'tie-a', 'tie-b', 'older-server', 'undated'],
    'entries should sort newest-first, deterministically, with undated records last');

const filtered = registry.list().filter(entry => entry.abstraction.startsWith('Tie'));
assert.deepStrictEqual(
    filtered.map(entry => entry.token),
    ['tie-a', 'tie-b'],
    'filtering the sorted list should preserve descending canonical order');

console.log('Lump Registry date ordering tests passed');