'use strict';
// Isolated in-memory fixtures only: no boot image, artifacts, or user workload.
const assert = require('node:assert/strict');
const Simulator = require('./simulator.js');
const header = (cw, cc, n = 0, typ = 0) =>
    ((31 << 27) | (n << 23) | (cw << 10) | (typ << 8) | cc) >>> 0;
function fixture() {
    const s = new Simulator();
    s.bootComplete = false;
    s.withNamespaceWrite('synthetic RETURN regression', () => {
        s.writeNSEntry(1, 0, 255, 0, 0, 1, 0, 0, 0);
        for (let slot = 2; slot <= 4; slot++)
            s.writeNSEntry(slot, slot * 256, 63, 0, 0, 1, 0, 1, 0);
    });
    s.memory[0] = header(32, 12, 2, 2);
    s.cr[12] = { word0: s.createGT(0, 1, {R: 1, W: 1}, 1), word1: 0, word2: 255, word3: 0, m: 0 };
    for (let slot = 2; slot <= 4; slot++) s.memory[slot * 256] = header(8, 1);
    s.cr[14] = { word0: s.createGT(0, 2, {X: 1}, 1), word1: 512, word2: 63, word3: 0, m: 0 };
    s.cr[6] = { word0: s.createGT(0, 2, {L: 1}, 1), word1: 575, word2: 63, word3: 0, m: 1 };
    s.memory[17] = s._packProtectedIndicator(241, 1, {});
    s.memory[242] = s.createGT(0, 2, {E: 1}, 1);
    s.memory[243] = s._packFrameWordRaw(0x7FFF, 1, 243);
    s.sto = 241;
    s.pc = 1;
    s.bootComplete = true;
    return s;
}
function call(s, slot) {
    s.cr[0] = { word0: s.createGT(0, slot, {E: 1}, 1), word1: slot * 256, word2: 63, word3: 0, m: 0 };
    assert.ok(s._execCall({crDst: 0, imm: 0}));
}
function unchangedFault(s, type) {
    const before = { cr: structuredClone(s.cr), dr: [...s.dr], sto: s.sto,
        pc: s.pc, indicator: s.memory[17], depth: s.callStack.length };
    let event;
    s.on('fault', f => { event = f; });
    assert.equal(s._execReturn({imm: 0}), null);
    assert.equal(event?.type, type);
    assert.equal(s.halted, true);
    assert.deepEqual(s.cr, before.cr);
    assert.deepEqual(s.dr, before.dr);
    assert.equal(s.sto, before.sto);
    assert.equal(s.pc, before.pc);
    assert.equal(s.memory[17], before.indicator);
    assert.equal(s.callStack.length, before.depth);
    assert.deepEqual(event.crSnapshot, before.cr);
    assert.equal(event.tier3Recovery, false);
}
{
    const s = fixture();
    call(s, 3);
    s.pc = 2;
    call(s, 4);
    assert.ok(s._execReturn({imm: 0}));
    assert.equal(s.cr[14].word1, 768);
    assert.equal(s.pc, 3);
    assert.ok(s._execReturn({imm: 0}));
    assert.equal(s.cr[14].word1, 512);
    assert.equal(s.pc, 2);
    assert.equal(s.memory[17] & 0x1FFF, 0x1000 | 241);
    unchangedFault(s, 'STACK_UNDERFLOW');
}
{
    const s = fixture();
    call(s, 3);
    s.memory[241] = s._packFrameWordRaw(8, 1, 241);
    unchangedFault(s, 'BOUNDS');
}
{
    const s = fixture();
    call(s, 3);
    s.memory[240] = s.createGT(0, 2, {L: 1}, 1);
    unchangedFault(s, 'PERM_E');
}
{
    const s = fixture();
    // A CALL from a LAMBDA saves SZ=0, but the active frame is still CALL.
    s.cr[0] = {...s.cr[14]};
    assert.ok(s._execLambda({crDst: 0}));
    call(s, 3);
    assert.ok(s._execReturn({imm: 0}));
    assert.equal(s.cr[14].word1, 512);
    assert.equal((s.memory[17] >>> 12) & 1, 0);
    assert.ok(s._execReturn({imm: 0}));
    assert.equal(s.pc, 2);
    assert.equal((s.memory[17] >>> 12) & 1, 1);
}
{
    const s = fixture();
    s.cr[0] = {...s.cr[14]};
    assert.ok(s._execLambda({crDst: 0}));
    assert.ok(s._execReturn({imm: 0}));
    assert.equal(s.pc, 2);
}
for (const nia of [0x7FFE, 0x7FFF]) {
    const s = fixture();
    call(s, 3);
    s.memory[241] = s._packFrameWordRaw(nia, 1, 241, {N: true, Z: true, C: true, V: true});
    assert.equal(s._unpackFrameWord(s.memory[241]).returnPC, nia);
    // Sentinel/bounds rejection must precede M-window writeback.
    s._mwinWriteback = () => { throw new Error('invalid RETURN reached writeback'); };
    unchangedFault(s, nia === 0x7FFF ? 'STACK_UNDERFLOW' : 'BOUNDS');
}
{
    const s = fixture();
    call(s, 3);
    s.memory[241] = s._packFrameWordRaw(2, 1, 240);
    unchangedFault(s, 'STACK_CORRUPT');
}
{
    const s = fixture();
    call(s, 3);
    // Frame authority survives loss of the diagnostic shadow, even for PC=0.
    s.callStack = [];
    s.memory[241] = s._packFrameWordRaw(0, 1, 241);
    assert.ok(s._execReturn({imm: 0}));
    assert.equal(s.pc, 0);
    assert.equal(s.cr[14].word1, 512);
    assert.equal(s.cr[6].word1, 575);
    assert.equal(s.cr[6].m, 1);
    unchangedFault(s, 'STACK_UNDERFLOW');
}
console.log('PASS protected RETURN validation, nested CALL/LAMBDA, and immutable faults');