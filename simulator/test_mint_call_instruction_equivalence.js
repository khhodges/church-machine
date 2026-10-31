'use strict';
// Independent compiler qualification in private simulator RAM. Stop BEFORE CALL:
// no Mint allocator, catalog, saved artifact, server, RTL or board is exercised.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/simulator/cr6_contract_fixture');
const Compiler = require('./cloomc_compiler');
const Assembler = require('./assembler');
const {contracts, annotations} = require('../scripts/create_mint_contract_draft');

const api = {name: 'ide.Mint', passkey: 1,
    methods: {CREATE: [0, [['allocation', 1], ['permissions', 1]], [2, 'RW']]}};
const activation = 'call_adapter ide.Mint.CREATE = mint_create_words_v1;';
function compile(body, {row = 1, declaration = activation, selectedApi = api, prose = ''} = {}) {
    const imports = ['SELF E', ...Array.from({length: row - 1}, (_, i) => `test.Pad${i} R`), 'ide.Mint E'];
    return new Compiler().compile(`${prose}
abstraction test.Qualification {
capabilities { ${imports.join(', ')} }
${declaration}
method Run {
${body}
RETURN
}
}`, [], {callApiAuthorities: {'ide.Mint': {
        embedded: true, token: '12345678', selectedToken: '12345678',
        revision: 'a'.repeat(64), selectedRevision: 'a'.repeat(64), api: selectedApi
    }}});
}
const readable = words => `CALL ide.Mint.CREATE(words: ${words}, rights: RW);`;
function code(result) {
    assert.deepEqual(result.errors, []);
    return result.methods[0].code;
}

// These manual sequences are literal acceptance oracles, not adapter helpers.
const manuals = new Map([
    [8, 'IADD DR2, DR0, #12'],
    [16, 'IADD DR2, DR0, #20'],
    [1024, 'IADD DR2, DR0, #1028'],
    [4096, 'IADD DR2, DR0, #4100'],
    [8192, 'IADD DR2, DR0, #32\nSHL DR2, DR2, #8\nIADD DR2, DR2, #4'],
    [2147483648, 'IADD DR2, DR0, #128\nSHL DR2, DR2, #8\nSHL DR2, DR2, #8\nSHL DR2, DR2, #8\nIADD DR2, DR2, #4']
]);
for (const row of [1, 7, 31]) {
    for (const [words, setup] of manuals) {
        const manual = `${setup}\nIADD DR3, DR0, #3\nCALL CR6[ide.Mint], #0`;
        const actual = code(compile(readable(words), {row}));
        assert.deepEqual(actual, code(compile(manual, {row, declaration: ''})));
        const asm = new Assembler();
        asm.setLocalClistSlots({'IDE.MINT': row});
        const expected = asm.assemble(`${manual}\nRETURN`);
        assert.deepEqual(expected.errors, []);
        assert.deepEqual(actual, expected.words);
        const call = actual.at(-2);
        assert.equal(call >>> 27, 2, 'ordinary CALL');
        assert.equal((call >>> 19) & 15, 0, 'indexed CALL has no explicit destination');
        assert.equal((call >>> 15) & 15, 8, 'indexed flag selects implicit CR6, not CR0');
        assert.equal((call >>> 5) & 127, 1, 'public selector 0 becomes wire selector 1');
        assert.equal(call & 31, row, 'exact declared C-list row');
    }
}

// Run every accepted power of two through the actual instruction engine.
// This catches signed-immediate mistakes a second hand-written decoder could hide.
for (let exponent = 3; exponent <= 31; exponent++) {
    const words = 2 ** exponent;
    const instructions = code(compile(readable(words)));
    const f = fixture();
    const domain = f.install(30, instructions);
    f.activate(domain);
    f.sim.dr = Array.from({length: 16}, (_, i) => i ? (0xa5000000 + i) >>> 0 : 0);
    f.sim.cr[1] = {word0: 0xdeadbeef, word1: 0x12345678,
        word2: 0x87654321, word3: 0xfedcba98, m: 1};
    const beforeCR = structuredClone(f.sim.cr);
    const beforeDR = [...f.sim.dr];
    for (const instruction of instructions.slice(0, -2)) {
        const opcode = instruction >>> 27;
        assert([21, 24].includes(opcode), 'argument setup is IADD/SHL only');
        if (opcode === 21) {
            assert.equal(instruction & 0x2000, 0, 'IADD uses a nonnegative signed immediate');
        }
        assert(f.sim.step(), 'preparation instruction retires');
        assert.equal(f.sim.halted, false);
    }
    assert.equal(f.sim.pc, instructions.length - 2, 'stop before calling Mint');
    assert.equal(f.sim.dr[2] >>> 0, Number(BigInt(words) | 4n));
    assert.equal(f.sim.dr[3] >>> 0, 3);
    assert.deepEqual(f.sim.cr, beforeCR, 'CR1 proof and all capability registers preserved');
    for (let i = 0; i < 16; i++) {
        if (i !== 2 && i !== 3) assert.equal(f.sim.dr[i], beforeDR[i], `DR${i} preserved`);
    }
}

// Neighbours of the signed immediate boundary and unsigned domain must reject,
// not round, truncate, or accidentally compile as raw WORD data.
for (const words of ['0', '1', '4', '12', '-8', '8.5', '4095', '4097',
    '8191', '8193', '2147483647', '2147483649', '4294967296',
    '18446744073709551616', 'size', 'DR2', '4 + 4']) {
    assert(compile(readable(words)).errors.length, `must reject ${words}`);
}
for (const rights of ['R', 'W', 'X', 'LS', '3', '']) {
    assert(compile(readable(8).replace('rights: RW', `rights: ${rights}`)).errors.length);
}
for (const mutate of [
    a => { a.passkey = 0; },
    a => { a.methods.CREATE[0] = 1; },
    a => { a.methods.CREATE[1].reverse(); },
    a => { a.methods.CREATE[1][0][1] = 2; },
    a => { a.methods.CREATE[2] = [2, 'R']; },
    a => { delete a.methods.CREATE; }
]) {
    const changed = structuredClone(api);
    mutate(changed);
    assert(compile(readable(8), {selectedApi: changed}).errors.length, 'API mismatch rejected');
}
for (const declaration of ['', activation.replace('_v1', '_v2'),
    activation.replace('ide.Mint', 'other.Mint'), `${activation}\n${activation}`]) {
    assert(compile(readable(8), {declaration}).errors.length, 'adapter mismatch rejected');
}
const changedContracts = structuredClone(contracts);
changedContracts.CREATE.inputs.allocation.encoding = 'Supply 99; execute arbitrary packing.';
changedContracts.CREATE.inputs.permissions.encoding = 'Supply 7 instead of 3.';
for (const words of manuals.keys()) {
    const baseline = code(compile(readable(words)));
    for (const proseContracts of [contracts, changedContracts]) {
        assert.deepEqual(code(compile(readable(words), {
            // Caller annotations must name its own Run method, not the imported
            // CREATE. Callee input prose travels with the selected imported API.
            prose: annotations({Run: {...proseContracts.CREATE, inputs: {},
                purpose: proseContracts.CREATE.inputs.allocation.encoding}}),
            selectedApi: {...api, contracts: {CREATE: proseContracts.CREATE}}
        })), baseline, 'source and selected API prose cannot control instructions');
    }
}
console.log('PASS independent Mint instruction equivalence: all 29 sizes, immediate boundary, CR1/DR preservation, selectors, API/adapter rejection and inert contract prose. No allocation claim.');
