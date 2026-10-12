'use strict';
const assert = require('node:assert/strict');
const Simulator = require('./simulator');
const Assembler = require('./assembler');

function fixture({oldOnly = false, generation = 0, authorized = true, collision = false,
    destinationSlots = 64} = {}) {
    const memory = new Uint32Array(16384);
    for (const base of [0, 8192]) {
        memory[base] = ((31 << 27) | ((base ? destinationSlots : 64) << 10) | (1 << 8)) >>> 0;
        memory[base + 1] = base;
        memory[base + 2] = 2;
    }
    const sim = Simulator.fromNamespaceImage(memory,
        {word0: 0x02000001, word1: 0, word2: 255, word3: 0, m: 1});
    function descriptor(ns, slot, base, limit, seq = 0) {
        const w1 = sim.packNSWord1(limit, seq, 0, 0);
        sim.memory.set([base, w1, sim._integrity32(base, w1), 0], ns + slot * 4);
    }
    function code(ns, text, extras = []) {
        const assembler = new Assembler(), assembled = assembler.assemble(text);
        assert.deepEqual(assembler.errors, []);
        const slot = ns && !collision ? 33 : 4;
        const base = ns + 512, gt = sim.createGT(0, slot, {E: 1}, 1);
        sim.memory[base] = sim.packLumpHeader(0, assembled.words.length, extras.length + 1, 0);
        sim.memory.set(assembled.words, base + 1);
        sim.memory.set([gt, ...extras], base + 63 - extras.length);
        descriptor(ns, slot, base, assembled.words.length);
        return gt;
    }
    descriptor(0, 1, 0, 255);
    descriptor(8192, 1, 8192, destinationSlots * 4 - 1);
    descriptor(0, 8, 8192, destinationSlots * 4 - 1);
    const bridge = code(0, 'SWITCH CR15, CR6, #1\nHALT',
        [sim.createGT(0, 8, {}, 1)]);
    const target = code(8192, 'IADD DR1, DR0, #202\nHALT');
    for (const [ns, enter] of [[0, bridge], [8192, target]]) {
        const base = ns + 256;
        sim.memory[base] = sim.packLumpHeader(2, 32, 12, 2);
        const layout = sim._threadLayoutAtBase(base) || require('./thread_design').layout(256, 32);
        sim.memory[base + layout.capsStart] = enter;
        sim._formatThreadRootSentinel(base, layout, enter, {image: true});
        descriptor(ns, ns || collision ? 2 : 11, base, 255, ns ? generation : 0);
    }
    assert(sim._activateChangeThread(collision ? 0x02000002 : 0x0200000b, {crDst: 12}, 0, true),
        JSON.stringify(sim.faultLog));
    sim.cr[15].m = authorized ? 1 : 0;
    sim.cr[13] = {word0: 0x02000002, word1: 256, word2: 255, word3: 0, m: 1};
    if (oldOnly) sim.memory.fill(0, 8192 + 8, 8192 + 12);
    return sim;
}
function reason(sim) { return sim.faultLog.map(f => f.rawDiagnosticReason || f.message).join('\n'); }
{
    const sim = fixture();
    assert.equal(sim.readNSEntry(2), null, 'strict destination-only entry Thread');
    assert.equal(sim.readNSEntry(33), null, 'strict destination-only executable');
    assert(sim.step(), reason(sim));
    assert.equal(sim.cr[15].word1, 8192);
    assert.equal(sim.cr[12].word1, 8448);
    assert.deepEqual(sim.cr[13], sim.emptyCapability());
    assert.equal(sim.cr[15].m, 0);
    assert(sim.step(), reason(sim));
    assert.equal(sim.dr[1], 202);
}
{
    const sim = fixture({collision: true});
    assert(sim.step(), reason(sim));
    assert.equal(sim.cr[12].word1, 8448, 'identical slot and generation never mean self-CHANGE');
    assert(sim.step(), reason(sim));
    assert.equal(sim.dr[1], 202);
}
{
    const sim = fixture({collision: true, destinationSlots: 32});
    assert.equal(sim.nsCount, 64);
    assert(sim.step(), reason(sim));
    assert.equal(sim.nsCount, 32, 'slot bounds follow the active header, not saved configuration');
    assert.equal(sim.MAX_NS_ENTRIES, 32);
    assert.equal(sim.readNSEntry(33), null);
    assert(sim.step(), reason(sim));
    assert.equal(sim.dr[1], 202);
}
{
    const sim = fixture();
    sim.cr[13].m = 1;
    const before = sim.cr.map(cr => ({...cr}));
    assert.equal(sim._execSwitch({crDst: 13, crSrc: 6, imm: 2}), null);
    assert(sim.halted, 'isolated-register LOAD fault remains a hard fault');
    assert.deepEqual(sim.cr, before);
}
{
    const sim = fixture({collision: true});
    const limit = sim.packNSWord1(255, 0, 0, 0);
    sim.memory.set([0, limit, sim._integrity32(0, limit), 0], 8 * 4);
    sim.dr[2] = 73;
    assert(sim.step(), reason(sim));
    assert.equal(sim.cr[15].word1, 0, 'single-Namespace handoff');
    assert.equal(sim.pc, 1, 'saved continuation is restored for same entry Thread');
    assert.equal(sim.dr[2], 73);
    assert.deepEqual(sim.cr[13], sim.emptyCapability());
}
{
    const sim = fixture();
    sim._nsClistCount = {33: 250};
    sim._nsUiTypeHint = {33: 3};
    sim._nsSymbolicEntries = {33: {implementationMissing: true}};
    assert.throws(() => { sim.nsHandlers = {33: () => true}; }, /inspection/);
    assert(sim.step(), reason(sim));
    assert.equal(sim.readNSEntry(33).clistCount, 1);
    assert.equal(sim.readNSEntry(33).gtType, 1);
    assert(sim.step(), reason(sim));
    assert.equal(sim.dr[1], 202);
}
{
    const sim = fixture();
    const layout = sim._threadLayoutAtBase(256);
    // Destination CR3 tries to restore a capability available only in the old
    // Namespace. The old table must not satisfy this carried capability.
    sim.memory[8448 + layout.capsStart + 3] = sim.createGT(0, 11, {}, 1);
    sim.step();
    assert(sim.halted);
    assert.match(reason(sim), /restore CR3/);
}
{
    const sim = fixture({oldOnly: true});
    sim.step();
    assert(sim.halted, 'old Namespace Thread must not satisfy missing destination Thread');
    assert.match(reason(sim), /null|absent|bounds/i);
    assert.equal(sim.cr[15].word1, 8192, 'fault does not roll back the installed root');
    assert.equal(sim.cr[13].m, 1, 'CR13 clearing is a success-path rule only');
    const layout = sim._threadLayoutAtBase(8448);
    const saved = sim._unpackProtectedIndicator(sim.memory[256 + 17]);
    const frame = sim._unpackFrameWord(sim.memory[256 + saved.sto + 2]);
    assert.equal(frame.returnPC, 1, 'outgoing save remains committed on incoming fault');
    assert(layout);
}
{
    const sim = fixture({generation: 1});
    sim.step();
    assert(sim.halted);
    assert.match(reason(sim), /seq|version/i);
    assert.equal(sim.parseNSWord1(sim.memory[8192 + 9]).gtSeq, 1,
        'hardware does not rewrite generations');
}
{
    const sim = fixture({authorized: false}), before = sim.memory.slice();
    sim.step();
    assert(sim.halted);
    assert.equal(sim.cr[15].word1, 0);
    assert.deepEqual(sim.memory, before);
}
{
    const sim = fixture(), before = sim.memory.slice();
    sim.cr[6].word0 = sim.createGT(0, 4, {}, 1);
    sim.step();
    assert(sim.halted);
    assert.match(reason(sim), /L|perm/i);
    assert.equal(sim.cr[15].word1, 0);
    assert.deepEqual(sim.memory, before);
}
console.log('New-format private-core SWITCH tests passed; IDE activation remains separate.');
module.exports = {fixture};
