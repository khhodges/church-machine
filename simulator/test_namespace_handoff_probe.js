'use strict';
// Default/strict mode exercises the approved slot-0-header, combined SWITCH
// contract. The historical tail-table investigation remains explicitly runnable.
if (!process.argv.includes('--legacy-probe')) {
    require('./test_namespace_runtime_core.js');
} else {
// Feasibility probe, not a release conformance pass. No file/board/UI writes.
// --require-handoff makes the known Namespace-selection gap a failing gate.
const assert = require('node:assert/strict');
global.window = {bootConfig: {step1: {
    totalNamespaceWords: 16384, namespaceLumpWords: 64,
    threadLumpWords: 512, threadCount: 3,
}}};
const Simulator = require('./simulator.js');
const Assembler = require('./assembler.js');

function assemble(text) {
    const a = new Assembler(), result = a.assemble(text);
    assert.deepEqual(a.errors, []);
    return result.words;
}

function fixture({destinationOnly = false, invalidFrame = false, authorized = true} = {}) {
    const sim = new Simulator();
    for (let i = 0; !sim.bootComplete && !sim.halted && i < 32; i++) sim._bootStep();
    assert(sim.bootComplete && !sim.halted);
    const slots = sim.configuredThreadSlots();
    const systemTable = 8192;
    const tableWords = sim.NS_TABLE_RESERVE;
    assert(systemTable + tableWords < sim.NS_TABLE_BASE);
    const target = slots[1], entry = sim.readNSEntry(target);
    const threadGT = sim.createGT(sim.parseNSWord1(entry.word1_limit).gtSeq, target, {}, 1);
    // The Namespace capability points to a separate table; this fixture makes
    // no claim about a complete portable Namespace LUMP/admission format.
    sim.withNamespaceWrite('isolated handoff fixture', () => {
        sim.writeNSEntry(34, systemTable, sim.MAX_NS_ENTRIES - 1, 0, 0, 1, 0, 0, 0);
    });
    const nsGT = sim.createGT(0, 34, {L: 1}, 1);
    function code(slot, base, text, extra = []) {
        const insns = assemble(text), words = Array(64).fill(0);
        words[0] = sim.packLumpHeader(0, insns.length, 1 + extra.length, 0);
        insns.forEach((w, i) => { words[i + 1] = w; });
        words[63 - extra.length] = Simulator.SELF_CAPABILITY_PLACEHOLDER;
        extra.forEach((w, i) => { words[64 - extra.length + i] = w; });
        const minted = sim._mintOrdinaryLumpIdentity(words, slot, base, {compilerOwnedSelf: true});
        assert(minted.ok, minted.message);
        sim.memory.set(minted.words, base);
        sim.withNamespaceWrite('isolated handoff code', () => {
            sim.writeNSEntry(slot, base, insns.length, 0, 0, 1,
                minted.entry.seq, 1, minted.entry.cacheToken);
        });
        return {gt: minted.selfGT, entry: sim.readNSEntry(slot),
            header: sim.parseLumpHeader(minted.words[0])};
    }
    const bridge = code(32, 4096, 'SWITCH CR15, CR6, #1\nCHANGE CR2\nHALT', [nsGT]);
    const incoming = code(33, 4160, 'IADD DR1, DR0, #202\nHALT');
    const base = entry.word0_location, layout = sim._threadLayoutAtBase(base);
    sim.memory.fill(0, base + layout.capsStart, base + layout.capsStart + 12);
    sim.memory[base + layout.capsStart] = incoming.gt;
    assert(sim._formatThreadRootSentinel(base, layout, incoming.gt, {image: true}));
    const root = layout.stackEnd - 2;
    sim.memory[base + root - 1] = incoming.gt;
    sim.memory[base + root] = sim._packFrameWord(0, 1, root);
    sim.memory[base + 17] = invalidFrame ? 0 : (1 << 12) | (root - 2);
    sim._writeCR(0, bridge.gt, bridge.entry);
    sim._installLumpHeaderContext(sim.parseGT(bridge.gt), 32, bridge.entry, bridge.header);
    sim.cr[2] = {word0: threadGT, word1: base, word2: entry.word1_limit, word3: 0, m: 0};
    sim.cr[15].m = authorized ? 1 : 0; // initial precondition, not regulator proof
    sim.pc = 0;
    // Two physically separate tables. Identical entries are a positive control,
    // not evidence that resolution uses the correct one.
    sim.memory.set(sim.memory.slice(sim.NS_TABLE_BASE,
        sim.NS_TABLE_BASE + tableWords), systemTable);
    const bootTarget = sim._nsSlotBase(target);
    const systemTarget = systemTable + tableWords - (target + 1) * 4;
    assert.equal(sim.memory[systemTarget], base);
    if (destinationOnly) sim.memory.fill(0, bootTarget, bootTarget + 4);
    return {sim, target, base, slots, systemTable, bootTarget, systemTarget};
}

function step(sim) { return sim.step(); }
function reason(sim) { return sim.faultLog.map(f => f.rawDiagnosticReason).join('\n'); }
function state(sim) {
    return {cr: sim.cr.map(c => ({...c})), dr: [...sim.dr], memory: sim.memory.slice()};
}
function switchFirst(f) {
    const {sim, systemTable} = f;
    const before = state(sim);
    assert(step(sim), reason(sim));
    assert.equal(sim.cr[15].word1, systemTable, 'SWITCH installs the distinct root');
    assert.equal(sim.cr[15].m, 0, 'SWITCH consumes destination M');
    assert.deepEqual(sim.cr.slice(0, 15), before.cr.slice(0, 15));
    assert.deepEqual([...sim.dr], before.dr);
    assert.equal(sim.pc, 1);
    return before;
}

{
    const f = fixture();
    switchFirst(f);
    assert(step(f.sim), reason(f.sim));
    assert.equal(f.sim._currentThreadSlot, f.target);
    assert.equal(f.sim.cr[15].word1, f.systemTable);
    assert.equal(f.sim.cr[15].m, 0);
    assert(step(f.sim), reason(f.sim));
    assert.equal(f.sim.dr[1], 202);
    assert.deepEqual(f.sim.faultLog, []);
    console.log('PASS control: mirrored tables permit SWITCH, CHANGE and target execution');
}
{
    const {sim} = fixture({authorized: false}), before = state(sim);
    step(sim);
    assert.match(reason(sim), /M=0/);
    assert.deepEqual(sim.cr, before.cr);
    assert.deepEqual([...sim.dr], before.dr);
    assert.deepEqual(sim.memory.slice(0, sim.NS_TABLE_BASE), before.memory.slice(0, sim.NS_TABLE_BASE));
    console.log('PASS denied M: no root/context publication');
}
{
    const f = fixture({invalidFrame: true});
    switchFirst(f);
    const before = state(f.sim);
    step(f.sim);
    assert.match(reason(f.sim), /frame/i);
    assert.equal(f.sim._currentThreadSlot, f.slots[0]);
    assert.equal(f.sim.cr[15].word1, f.systemTable, 'failed CHANGE does not roll SWITCH back');
    assert.deepEqual(f.sim.cr, before.cr);
    assert.deepEqual(f.sim.memory.slice(0, f.sim.NS_TABLE_BASE),
        before.memory.slice(0, f.sim.NS_TABLE_BASE));
    console.log('PASS boundary fault: new CR15 persists; old Thread not replaced');
}
{
    const f = fixture({destinationOnly: true});
    switchFirst(f);
    assert.equal(f.sim.memory[f.bootTarget], 0);
    assert.equal(f.sim.memory[f.systemTarget], f.base);
    step(f.sim);
    const active = f.sim._currentThreadSlot === f.target && !f.sim.halted;
    if (process.argv.includes('--require-handoff')) {
        assert(active, `HANDOFF BLOCKED: target exists only in selected System table; ${reason(f.sim)}`);
        assert(step(f.sim), reason(f.sim));
        assert.equal(f.sim.dr[1], 202);
    } else {
        assert.equal(active, false, 'known gap changed: promote this to a conformance test');
        assert.match(reason(f.sim), /Namespace|descriptor|absent|bounds/i);
        assert.equal(f.sim.readNSEntry(f.target), null,
            'resolution still consults fixed Boot table after CR15 changed');
        console.log('EXPECTED BLOCKER: destination-only Thread is not resolved through new CR15');
        console.log(reason(f.sim));
    }
}
console.log('Probe complete. Expected-blocker mode is NOT successful handoff certification.');
}
