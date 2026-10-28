'use strict';
const assert = require('node:assert/strict');
const {fixture, checkContext} = require('./cr6_contract_fixture');
const Assembler = require('../../simulator/assembler');
const Compiler = require('../../simulator/cloomc_compiler');
const {buildLump} = require('../../simulator/lump_builder');
const {assembleLump} = require('../../simulator/lump_assembler');

{
    const image = assembleLump([[0x1f000000], [0x1f000000, 0x1f000000]]);
    assert.deepEqual(image.methodTable, [3, 4], 'numeric header-relative offsets');
    for (const selector of [1, 2]) {
        const {sim, install} = fixture();
        const domain = install(30, image.buf.slice(1));
        sim.cr[0].word0 = domain.gt;
        assert(sim._execCall({crDst: 0, imm: selector}));
        assert.equal(sim.pc, image.bodyOffsets[selector - 1]);
        checkContext(sim, domain);
    }
    const {compile, programs} = require('../../simulator/mint/protected-programs');
    const {mint, verifier} = programs();
    assert.equal(mint.words[0], mint.labels.create + 1);
    assert.deepEqual(mint.words.slice(1, 5), Array(4).fill(mint.labels.reject_method + 1));
    assert.equal(verifier.words[0], verifier.labels.verify + 1);
    assert.throws(() => compile('ENTRY missing\nHALT'), /Unknown dispatch label/);
}

for (const source of ['CALL CR1', 'CALLNE CR1',
    'capabilities { SELF E, Target E }\nCALL CR6[Target]']) {
    const result = new Assembler().assemble(source);
    assert(result.errors.some(e => /explicit.*method|selector.*unresolved/.test(e.message)),
        JSON.stringify(result.errors));
}
for (const source of ['CALL CR1, #0', 'CALL CR1, #2']) {
    const result = new Assembler().assemble(source);
    assert.deepEqual(result.errors, []);
    assert((result.words[0] & 0x7FFF) > 0);
}
assert.match(new Assembler().disassemble(0x17000000), /CALL.*CR0/,
    'historical direct-entry bytes remain inspectable');
for (const body of ['CALL CR1', 'call(CR1)', 'recall()', 'CALL 0, CR6, #1']) {
    const result = new Compiler().compile(
        `abstraction test.Caller {\ncapabilities { SELF E }\nmethod Run() {\n${body}\nRETURN\n}\n}`, []);
    assert(result.errors.some(e => /CALL requires/.test(e.message)), JSON.stringify(result.errors));
}
assert.throws(() => new Compiler().encode(2, 14, 1, 0, 0), /nonzero dispatch-table/);

{
    const indexed = new Assembler().assemble(
        'capabilities { SELF E, test.Target E }\nCALL CR6[test.Target], #0');
    assert.deepEqual(indexed.errors, []);
    assert.equal(indexed.words[0], 0x17040021, 'bracket target is one operand');
    for (const word of ['0x47000000', '0x47000020', '0x4f000000',
                       '0x17000000', '0x17040001']) {
        const result = new Compiler().compile(
            `abstraction test.Raw {\ncapabilities { SELF E }\nmethod Run [RAW ISA] {\n${word}\n}\n}`, []);
        assert(result.errors.some(e => /retired|dispatch-table/.test(e.message)), word);
    }
    const valid = new Compiler().compile(
        'abstraction test.Raw {\ncapabilities { SELF E }\nmethod Run [RAW ISA] {\n0x17080001\n0x1f000000\n}\n}', []);
    assert.deepEqual(valid.errors, [], 'nonzero raw CALL remains supported');
}

// Reload the exact compiled words in private RAM, not a rewritten fixture.
{
    const {sim, install} = fixture();
    function compiledCode(body) {
        const result = new Compiler().compile(
            `abstraction test.Reload {\ncapabilities { SELF E }\nmethod Run() {\n${body}\n}\n}`, []);
        assert.deepEqual(result.errors, []);
        const lump = buildLump(result);
        assert.deepEqual(lump.errors || [], []);
        return lump.words.slice(1, 1 + lump.cw);
    }
    const domain = install(30, compiledCode('RETURN'));
    const caller = install(31, compiledCode('LOAD CR1, CR6, #1\nCALL CR1, #0\nRETURN'), [domain.gt]);
    const callWord = sim.memory[caller.base + 3];
    assert.equal(callWord, 0x17080001);
    sim.cr[1].word0 = domain.gt;
    assert(sim._execCall({crDst: (callWord >>> 19) & 15, imm: callWord & 0x7FFF}));
    checkContext(sim, domain);
}

for (const selector of [0, -1, 32768, 65537]) {
    const {sim, install} = fixture();
    const domain = install(30, [2, 0x1f000000]);
    sim.cr[0].word0 = domain.gt;
    const before = JSON.stringify({cr: sim.cr, stack: sim.callStack, pc: sim.pc});
    let fault;
    sim.fault = (type, message) => { fault = {type, message}; };
    assert.equal(sim._execCall({crDst: 0, imm: selector}), null);
    assert.equal(fault.type, 'INVALID_OP');
    assert.match(fault.message, /dispatch-table selector/);
    assert.equal(JSON.stringify({cr: sim.cr, stack: sim.callStack, pc: sim.pc}), before);
}

for (const entry of [0, 1, 3, 0xbf000001]) {
    const {sim, install} = fixture();
    const domain = install(30, [entry, 0x1f000000]);
    sim.cr[0].word0 = domain.gt;
    const depth = sim.callStack.length;
    let fault;
    sim.fault = type => { fault = type; };
    assert.equal(sim._execCall({crDst: 0, imm: 1}), null);
    assert.equal(fault, entry === 0 ? 'PRIVATE_METHOD' : 'BOUNDS');
    assert.equal(sim.callStack.length, depth);
}

{
    const {sim, install} = fixture();
    const domain = install(30, [2, 0x1f000000]);
    sim.cr[0].word0 = domain.gt;
    assert(sim._execCall({crDst: 0, imm: 1}));
    assert.equal(sim.pc, 1, 'dispatch enters word 2, never table word 1');
    checkContext(sim, domain);
}
console.log('PASS mandatory CALL dispatch: valid entry, invalid selectors, private/bad offsets, CR6.M');
