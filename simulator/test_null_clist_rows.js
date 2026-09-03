'use strict';

const assert = require('assert');
const ChurchAssembler = require('./assembler.js');
const CLOOMCCompiler = require('./cloomc_compiler.js');
const CapabilityTokens = require('./capability_tokens.js');

// An explicit NULL entry occupies a real row without becoming a resolvable name.
const assembler = new ChurchAssembler();
const assembled = assembler.assemble([
    'capabilities { M_BIT_DEV RW, NULL, IRQ E }',
    'IADD DR1, DR0, #0x2000',
    'DWRITE DR1, CR0, #0',
    'SWITCH CR13, CR6, #2',
].join('\n'));

assert.deepStrictEqual(assembled.errors, []);
assert.strictEqual(assembled.capabilities.length, 3);
assert.strictEqual(assembled.capabilities[1].null_row, true);
assert.strictEqual(assembler._capBlockSlots.M_BIT_DEV, 0);
assert.strictEqual(assembler._capBlockSlots.IRQ, 2);
assert.strictEqual(assembler._capBlockSlots.NULL, undefined);
assert.strictEqual(assembled.words[2] & 0x7FFF, 2);

// Every front-end that uses the shared CLOOMC parser gets the same NULL marker.
assert.deepStrictEqual(
    CLOOMCCompiler._parseCapItem('NULL'),
    { name: 'NULL', rights: [], null_row: true }
);

// Materialization preserves the row as the canonical zero GT while binding
// ordinary rows on either side without shifting them.
const words = new Uint32Array(3);
const materialized = CapabilityTokens.materialize(
    [
        { name: 'Left', rights: ['E'], nsIndex: 4 },
        { name: 'NULL', rights: [], null_row: true },
        { name: 'Right', rights: ['E'], nsIndex: 9 },
    ],
    words,
    0,
    { lumps: [
        { name: 'Left', ns_slot: 4, grants: ['E'] },
        { name: 'Right', ns_slot: 9, grants: ['E'] },
    ] }
);
assert.strictEqual(materialized.ok, true, materialized.errors.join('; '));
assert.notStrictEqual(words[0], 0);
assert.strictEqual(words[1], 0);
assert.notStrictEqual(words[2], 0);

const tampered = Array.from(words);
tampered[1] = 0x4A000009;
const validation = CapabilityTokens.validateClist(
    tampered, 0, materialized.resolvedCaps, {}
);
assert.strictEqual(validation.ok, false);
assert.match(validation.errors[0], /NULL row contains nonzero word/);

console.log('NULL C-list row regression: PASS');