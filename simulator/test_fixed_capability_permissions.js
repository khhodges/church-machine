'use strict';
const assert = require('assert');
const Tokens = require('./capability_tokens.js');
const config = {node: 'global.local', aliases: {RemoteUART: 'global.remote.UART_TX'},
    definitions: {'global.remote.UART_TX': ['W']}};
const check = cap => Tokens.checkLeafOwnership(cap, config);
for (const rights of [['W'], ['R', 'W'], ['R']]) {
    const result = check({name: 'UART_TX', rights});
    assert.strictEqual(result.error, null);
    assert.strictEqual(result.ownership, 'local');
    assert.strictEqual(result.canonical, 'global.local.UART_TX');
}
assert.strictEqual(check({name: 'NewLeaf', rights: ['X']}).ownership, 'local');
assert.strictEqual(check({name: 'RemoteUART', rights: ['W']}).error, null);
assert.match(check({name: 'RemoteUART', rights: ['R', 'W']}).error, /Foreign leaf/);
assert.match(check({name: 'UART_TX', canonical_leaf: 'global.remote.UART_TX',
    rights: ['R', 'W']}).error, /Foreign leaf/);
assert.strictEqual(check({name: 'UART_TX', canonical_leaf: 'global.remote.UART_TX',
    rights: ['W']}).ownership, 'foreign');
assert.match(check({name: 'global.locality.UART_TX', rights: ['W']}).error, /Foreign leaf/);
assert.match(check({name: 'global.local.child.UART_TX', rights: ['W']}).error, /Foreign leaf/);
assert.match(check({name: 'RemoteUART', N: 'global.local.UART_TX#1', rights: ['W']}).error, /conflicts/);
for (const bad of [null, {}, {node: ''}, {node: 'a..b'}, {node: 'a', aliases: []}]) {
    assert.match(Tokens.checkLeafOwnership({name: 'UART_TX', rights: ['W']}, bad).error,
        /Configure/);
}
for (const name of ['SELF', '__SELF__']) {
    assert.strictEqual(check({name, rights: []}).error, null);
    assert.strictEqual(check({name, rights: ['E']}).error, null);
    assert.match(check({name, rights: ['R', 'W']}).error, /compiler-owned E/);
}
assert.strictEqual(Tokens.resolveCapability({name: 'UART_TX', rights: ['R', 'W']},
    {ideHierarchy: config, lumps: [{name: 'UART_TX', authored_rights: ['W']}]}).error, null);
assert.deepStrictEqual(config.definitions['global.remote.UART_TX'], ['W']);
for (const name of ['Thread.1', 'Thread#1', 'Boot.Thread']) {
    const local = {node: 'global.local', aliases: {[name]: 'global.local.Thread1'}};
    assert.strictEqual(Tokens.checkLeafOwnership({name, rights: []}, local).error, null);
    const foreign = {...local, node: 'global.other', definitions: {'global.local.Thread1': []}};
    assert.strictEqual(Tokens.checkLeafOwnership({name, rights: []}, foreign).error, null);
    assert.match(Tokens.checkLeafOwnership({name, rights: ['R']}, foreign).error, /Foreign leaf/);
    assert.strictEqual(Tokens.checkLeafOwnership({name: 'UART_TX', rights: ['W']}, local).error, null);
}
assert.match(Tokens.checkLeafOwnership({name: 'Thread.1', rights: []},
    {node: 'global.local'}).error, /Configure an exact alias/);
for (const aliases of [{'Thread..1': 'global.local.Thread1'}, {'Thread.1': 'global.local.1'}]) {
    assert.match(Tokens.checkLeafOwnership({name: 'UART_TX', rights: ['W']},
        {node: 'global.local', aliases}).error, /Configure/);
}
console.log('PASS IDE leaf ownership, canonical imports, configuration, legacy Thread aliases and SELF');