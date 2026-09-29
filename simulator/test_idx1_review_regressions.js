'use strict';
const assert = require('node:assert/strict');
const { fixture } = require('./test_idx1_runtime.js');
const Simulator = require('./simulator.js');
const Assembler = require('./assembler.js');
const Envelope = require('./idx1-execution-envelope.js');
const Runtime = require('./idx1-runtime.js');

function cap(sim, slot, rights, base, limit) {
    const entry = sim.readNSEntry(slot);
    return { word0: sim.createGT(sim.parseNSWord1(entry.word1_limit).gtSeq, slot, rights, 1),
        word1: base ?? entry.word0_location, word2: limit ?? entry.word1_limit, word3: 0, m: 0 };
}
function namespace(sim, slot, base, limit, cc = 0) {
    sim.nsCount = Math.max(sim.nsCount, slot + 1);
    sim.withNamespaceWrite('disposable regression fixture', () =>
        sim.writeNSEntry(slot, base, limit, 0, 0, 1, 1, cc, 0));
}
function legacyCaller(sim, call = false) {
    const base = 0x3000, slot = 44;
    // Scheduler/microcode instruction: the user assembler deliberately fences
    // privileged CHANGE, but existing legacy scheduler bytes can execute it.
    const code = { words: [((4 << 27) | (14 << 23) | (15 << 19) | (6 << 15) | 43) >>> 0, 0] };
    if (call) code.words = new Assembler().assemble('CALL CR3\nHALT').words;
    namespace(sim, slot, base, code.words.length, 1);
    sim.memory[base] = sim.packLumpHeader(0, code.words.length, 1, 0);
    sim.memory.set(code.words, base + 1);
    sim.memory[base + 63] = sim.createGT(1, slot, { E: 1 }, 1);
    sim.cr[14] = cap(sim, slot, { X: 1 });
    sim.pc = 0;
    sim._currentThreadSlot = 1;
    sim._liveThreadOwned = true;
    sim.sto = sim._readProtectedSto();
}
function incomingThread(f, nia = 0x7fff) {
    const sim = f.sim, base = 0x2800, slot = 43;
    const original = sim.readNSEntry(1).word0_location;
    const layout = sim._threadLayoutAtBase(original);
    namespace(sim, slot, base, layout.lumpSize - 1, 12);
    sim.memory.set(sim.memory.slice(original, original + layout.lumpSize), base);
    // A fresh Thread fixture with no inherited general-capability authority.
    sim.memory.fill(0, base + layout.capsStart, base + layout.capsEnd + 1);
    sim.memory[base + 12] = 2; // DR11.
    const root = sim._formatThreadRootSentinel(base, layout,
        sim.createGT(1, f.slot, { E: 1 }, 1), { image: true });
    sim.memory[base + root.frameAddress] = sim._packFrameWordRaw(nia, 1, root.frameAddress);
    return { base, layout };
}
function state(sim, incoming) {
    const outgoing = sim.readNSEntry(1).word0_location;
    return {
        cr: sim.cr.map(r => ({ ...r })), dr: Array.from(sim.dr),
        pc: sim.pc, sto: sim.sto, flags: { ...sim.flags },
        currentThread: sim._currentThreadSlot, liveThreadOwned: sim._liveThreadOwned,
        callStack: JSON.parse(JSON.stringify(sim.callStack)),
        outgoing: Array.from(sim.memory.slice(outgoing, outgoing + 256)),
        incoming: Array.from(sim.memory.slice(incoming.base, incoming.base + incoming.layout.lumpSize)),
    };
}
async function main() {
    // Hardwired DR0: neither its live value nor home receives the computed
    // result, and each successful packet retires once.
    for (const op of ['BFEXT DR0, DR3, DR11, 8', 'DREAD DR0, CR1, DR11']) {
        const f = await fixture('DR11', `${op}\nIADD DR2, DR0, #7\nHALT`);
        f.sim.cr[1] = cap(f.sim, 31, { R: 1 });
        f.sim.memory[f.dataBase + 2] = 0xffffffff;
        f.sim.dr[3] = 0xffffffff;
        const count = f.sim.executionStats.successful;
        assert(f.sim.step());
        assert.equal(f.sim.dr[0], 0);
        assert.equal(f.sim.memory[f.sim._activeThreadBase() + 1], 0);
        assert.equal(f.sim.executionStats.successful, count + 1);
        assert(f.sim.step());
        assert.equal(f.sim.dr[2], 7);
        assert.equal(f.sim.executionStats.successful, count + 2);
    }
    // Canonical Thread heap subview, including its exact end.
    for (const operation of ['DREAD', 'DWRITE']) {
        const f = await fixture('DR11', `${operation} DR2, CR5, DR11\nHALT`);
        const base = f.sim._activeThreadBase(), layout = f.sim._threadLayoutAtBase(base);
        f.sim.cr[5] = cap(f.sim, 1, { R: 1, W: 1 }, base + layout.heapStart, layout.heapWords - 1);
        f.sim.dr[11] = layout.heapWords - 1;
        f.sim.dr[2] = 123;
        f.sim.memory[base + layout.heapEnd] = 123;
        assert(f.sim.step(), JSON.stringify(f.sim.faultLog));
        assert.equal(f.sim.dr[2], 123);
        f.sim.pc = 0;
        f.sim.dr[11]++;
        assert.equal(f.sim.step(), null);
        assert.equal(f.sim.pc, 0);
    }
    const codeRead = await fixture('DR11', 'DREAD DR2, CR14, DR11\nHALT');
    codeRead.sim.dr[11] = 1;
    assert(codeRead.sim.step());
    assert.equal(codeRead.sim.dr[2], codeRead.envelope.words[1]);

    // Non-abstraction inner types cannot even produce validated envelopes.
    for (const typ of [1, 2, 3])
        await assert.rejects(fixture('DR11', null, { R: 1 }, { typ }), /typ=0/);
    // cc=0 is deliberately unsupported, before any executable binding.
    await assert.rejects(fixture('DR11', null, { R: 1 }, { cc: 0 }), /cc=0/);
    await assert.rejects(fixture('DR11', null, { R: 1 }, { self: 1 }), /SELF/);
    for (const self of [
        codeRead.sim.createGT(1, 31, { E: 1 }, 1),
        codeRead.sim.createGT(0, 30, { E: 1 }, 1),
        codeRead.sim.createGT(1, 30, { L: 1 }, 1),
    ]) await assert.rejects(fixture('DR11', null, { R: 1 }, { self }), /SELF/);
    for (const legacy of [true, false]) {
        const f = await fixture('DR11', 'CALL CR3\nHALT');
        const slot = 43, base = 0x2800, bytes = Buffer.alloc(256);
        bytes.writeUInt32BE(f.sim.packLumpHeader(0, 1, 0, 0));
        namespace(f.sim, slot, base, 1);
        f.sim.memory[base] = bytes.readUInt32BE(0);
        const compiled = new Assembler().assemble('HALT', {
            profile: 'IDX1', sourceLayout: { fastEntry: 1, dispatch: [] },
        });
        const envelope = await Envelope.frame(bytes, compiled.layout);
        f.sim.registerSlotIdentity(slot, { dotName: 'UnsupportedCC0', issueN: 1,
            identityHash: envelope.executionDigest, binaryHash: envelope.metadata.payloadSha256,
            executionDigest: envelope.executionDigest, authorized: true, gtSeq: 1 });
        await assert.rejects(Simulator.admitIDX1Execution(f.sim, envelope.bytes, slot), /cc=0/);
        assert.equal(Runtime.isInstalled(f.sim, slot), false);
        if (legacy) legacyCaller(f.sim, true);
        f.sim.cr[3] = cap(f.sim, slot, { E: 1 });
        const thread = { base: f.sim._activeThreadBase(), layout: { lumpSize: 256 } };
        const before = state(f.sim, thread), stack = f.sim.callStack.length;
        assert.equal(f.sim.step(), null);
        assert.match(f.sim.faultLog.at(-1).message, /no installed executable binding/);
        assert.deepEqual(state(f.sim, thread), before);
        assert.equal(f.sim.callStack.length, stack);
    }

    // Existing and newly introduced Namespace aliases cannot fetch W1 or data
    // as legacy code. This also rejects CALL/CHANGE binding resolution.
    for (const existing of [false, true]) for (const pc of [1, 3]) {
        const f = await fixture('DR11', 'LOAD CR1, CR6, DR11\nHALT\n.word 0',
            { R: 1 }, { admit: !existing });
        namespace(f.sim, 43, f.base, 4, 3);
        if (existing) await Simulator.admitIDX1Execution(f.sim, f.envelope.bytes, f.slot);
        f.sim.cr[14] = cap(f.sim, 43, { X: 1 });
        f.sim.pc = pc;
        const before = Array.from(f.sim.dr);
        assert.equal(f.sim.step(), null);
        assert.match(f.sim.faultLog.at(-1).message, /alias/);
        assert.deepEqual(Array.from(f.sim.dr), before);
    }

    // Valid typ=Thread geometry can still physically alias protected code.
    // Home rejection must precede DR change and DREAD's payload read/evidence.
    for (const operation of ['BFEXT DR15, DR3, DR11, 8', 'DREAD DR15, CR1, DR11']) {
        const f = await fixture('DR11', `${operation}\nHALT`);
        const aliasBase = f.base - 16;
        namespace(f.sim, 43, aliasBase, 255, 12);
        f.sim.memory[aliasBase] = f.sim.packLumpHeader(2, 32, 12, 2);
        f.sim.cr[12] = cap(f.sim, 43, {});
        f.sim.cr[1] = cap(f.sim, 31, { R: 1 });
        f.sim.dr[3] = 0xffffffff;
        f.sim.dr[15] = 123;
        const before = Array.from(f.sim.dr);
        assert.equal(f.sim.step(), null);
        assert.deepEqual(Array.from(f.sim.dr), before);
        assert.equal(f.sim.pc, 0);
        assert(!f.sim.lastStepEvidence.effects.some(effect =>
            effect.kind === 'data-read' || effect.kind === 'register-write'));
    }
    // A legacy CHANGE must validate IDX1 packet starts before saving the old
    // Thread or changing either bank. Include W1, typed data and no admission.
    for (const scenario of [
        { source: 'LOAD CR1, CR6, DR11\nHALT', nia: 1 },
        { source: 'LOAD CR1, CR6, DR11\nHALT\n.word 0', nia: 3 },
        { source: 'LOAD CR1, CR6, DR11\nHALT', nia: 0, admit: false },
    ]) {
        const f = await fixture('DR11', scenario.source, { R: 1 }, { admit: scenario.admit });
        const incoming = incomingThread(f, scenario.nia);
        legacyCaller(f.sim);
        const before = state(f.sim, incoming);
        assert.equal(f.sim.step(), null);
        assert.match(f.sim.faultLog.at(-1).message, /CHANGE resume rejected/);
        assert.deepEqual(state(f.sim, incoming), before);
    }
    const fresh = await fixture('DR11', 'HALT\nLOAD CR1, CR6, DR11\nHALT',
        { R: 1 }, { fastEntry: 2 });
    incomingThread(fresh);
    legacyCaller(fresh.sim);
    assert(fresh.sim.step(), JSON.stringify(fresh.sim.faultLog));
    assert.equal(fresh.sim.pc, 1);
    assert.equal(fresh.sim.cr[14].word1, fresh.base);
    assert(fresh.sim.step(), JSON.stringify(fresh.sim.faultLog));
    assert.equal(fresh.sim.cr[1].word0, fresh.selected);
    console.log('IDX1 seven critical review regression groups passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });