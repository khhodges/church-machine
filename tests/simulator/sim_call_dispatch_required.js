'use strict';
const assert = require('node:assert/strict');
const {fixture, checkContext} = require('./cr6_contract_fixture');
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
