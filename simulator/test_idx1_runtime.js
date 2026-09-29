'use strict';
const assert = require('node:assert/strict');
const Simulator = require('./simulator.js');
const Assembler = require('./assembler.js');
const Envelope = require('./idx1-execution-envelope.js');

async function fixture(expression = 'DR11', source = null, rights = { R: 1 }, options = {}) {
    const sim = new Simulator();
    sim.bootComplete = true;
    sim.halted = false;
    const compiled = new Assembler().assemble(source || `LOAD CR1, CR6, ${expression}\nHALT`, {
        profile: 'IDX1', sourceLayout: { fastEntry: options.fastEntry || 1, dispatch: [] },
    });
    assert.deepEqual(compiled.errors, []);
    const slot = 30, dataSlot = 31, base = 0x1800, dataBase = 0x1900;
    sim.nsCount = Math.max(sim.nsCount, 32);
    sim.withNamespaceWrite('disposable IDX1 fixture', () => {
        sim.writeNSEntry(slot, base, compiled.words.length, 0, 0, 1, 1, 3, 0);
        sim.writeNSEntry(dataSlot, dataBase, 15, 0, 0, 1, 1, 0, 0);
    });
    const selected = sim.createGT(1, dataSlot, rights, 1);
    const words = new Uint32Array(64);
    words[0] = sim.packLumpHeader(0, compiled.words.length, options.cc ?? 3, options.typ || 0);
    words.set(compiled.words, 1);
    words[61] = options.self ?? sim.createGT(1, slot, { E: 1 }, 1);
    words[63] = selected;
    sim.memory.set(words, base);
    const bytes = Buffer.alloc(words.length * 4);
    words.forEach((word, i) => bytes.writeUInt32BE(word, i * 4));
    const envelope = await Envelope.frame(bytes, compiled.layout);
    sim.registerSlotIdentity(slot, {
        dotName: 'DisposableIDX1', issueN: 1,
        identityHash: envelope.executionDigest, binaryHash: envelope.metadata.payloadSha256,
        executionDigest: envelope.executionDigest, authorized: true, gtSeq: 1,
    });
    const ns = sim.readNSEntry(slot);
    sim.cr[14] = { word0: sim.createGT(1, slot, { X: 1 }, 1),
        word1: base, word2: ns.word1_limit, word3: 0, m: 0 };
    sim.cr[6] = { word0: sim.createGT(1, slot, { L: 1 }, 1),
        word1: base + 61, word2: ns.word1_limit, word3: 0, m: 1 };
    // Use the simulator's freshly constructed canonical Thread, never a user
    // Thread snapshot or fabricated host-side CALL context.
    const thread = sim.readNSEntry(1);
    sim.cr[12] = { word0: sim.createGT(sim.parseNSWord1(thread.word1_limit).gtSeq, 1, { R: 1, W: 1 }, 1),
        word1: thread.word0_location, word2: thread.word1_limit, word3: 0, m: 0 };
    sim.pc = 0;
    sim.dr[11] = 2;
    if (options.admit !== false) await Simulator.admitIDX1Execution(sim, envelope.bytes, slot);
    return { sim, selected, base, slot, dataBase, envelope };
}
async function main() {
    const f = await fixture();
    const result = f.sim.step();
    assert(result, JSON.stringify(f.sim.faultLog));
    assert.equal(f.sim.cr[1].word0, f.selected);
    assert.equal(f.sim.pc, 2);
    assert.equal(f.sim.stepCount, 1);
    assert.equal(f.sim.step().opName, 'HALT');
    assert.throws(() => { f.sim.memory[f.base + 1] = 0; }, { code: 'IDX1_READ_ONLY' });
    const interior = await fixture();
    interior.sim.pc = 1;
    assert.equal(interior.sim.step(), null);
    assert.equal(interior.sim.cr[1].word0, 0);
    const overflow = await fixture('DR11 + 1');
    overflow.sim.dr[11] = 0xffffffff;
    const before = { ...overflow.sim.cr[1] };
    assert.equal(overflow.sim.step(), null);
    assert.deepEqual(overflow.sim.cr[1], before);
    assert.equal(overflow.sim.pc, 0);
    const underflow = await fixture('DR11 - 3');
    assert.equal(underflow.sim.step(), null);
    assert.equal(underflow.sim.pc, 0);
    const outside = await fixture();
    outside.sim.dr[11] = 3;
    assert.equal(outside.sim.step(), null);
    assert.equal(outside.sim.pc, 0);
    const changedRegister = await fixture();
    changedRegister.sim.dr[11] = 1; // Change AFTER admission; row 1 is NULL.
    assert.equal(changedRegister.sim.step(), null);
    assert.equal(changedRegister.sim.cr[1].word0, 0);
    const anyDR = await fixture('DR15');
    anyDR.sim.dr[15] = 2;
    assert(anyDR.sim.step());
    assert.equal(anyDR.sim.cr[1].word0, anyDR.selected);
    const literal = await fixture('DR0 + 2');
    literal.sim.dr[0] = 999;
    assert(literal.sim.step());
    assert.equal(literal.sim.cr[1].word0, literal.selected);
    assert.equal(literal.sim.pc, 1);
    const denied = await fixture('DR11 + 1');
    denied.sim.cr[6].word0 = 0;
    denied.sim.dr[11] = 0xffffffff;
    assert.equal(denied.sim.step(), null);
    assert.equal(denied.sim.faultLog[0].type, 'NULL_CAP');
    assert.throws(() => f.sim.clearSlotIdentity(f.slot), /immutable/);
    assert.throws(() => f.sim.registerSlotIdentity(f.slot, {}, { secure: false }), /immutable/);
    const namespaceAddress = f.sim._nsSlotBase(f.slot);
    assert.throws(() => { f.sim.memory[namespaceAddress + 1] ^= 0x200000; },
        { code: 'IDX1_READ_ONLY' });
    const read = await fixture('DR11', 'LOAD CR1, CR6, DR11\nDREAD DR2, CR1, DR3 + 1\nHALT');
    read.sim.memory[read.dataBase + 3] = 0xabcdef01;
    read.sim.dr[3] = 2;
    assert(read.sim.step(), JSON.stringify(read.sim.faultLog));
    assert(read.sim.step(), JSON.stringify(read.sim.faultLog));
    assert.equal(read.sim.dr[2] >>> 0, 0xabcdef01);
    assert.equal(read.sim.pc, 4);
    const write = await fixture('DR11', 'LOAD CR1, CR6, DR11\nDWRITE DR2, CR1, DR3 - 1\nHALT');
    assert(write.sim.step());
    write.sim.dr[2] = 123;
    write.sim.dr[3] = 2;
    assert.equal(write.sim.step(), null); // Selected fixture capability has R, not W.
    assert.equal(write.sim.memory[write.dataBase + 1], 0);
    const writable = await fixture('DR11',
        'LOAD CR1, CR6, DR11\nDWRITE DR2, CR1, DR3 - 1\nHALT', { W: 1 });
    assert(writable.sim.step());
    writable.sim.dr[2] = 123;
    writable.sim.dr[3] = 2;
    assert(writable.sim.step());
    assert.equal(writable.sim.memory[writable.dataBase + 1], 123);
    const branch = await fixture('DR11', 'BRANCH DR11\nHALT');
    assert(branch.sim.step());
    assert.equal(branch.sim.pc, 2);
    const badBranch = await fixture('DR11', 'BRANCH DR11\nHALT');
    badBranch.sim.dr[11] = 1;
    assert.equal(badBranch.sim.step(), null);
    assert.equal(badBranch.sim.pc, 0);
    const bits = await fixture('DR11', 'BFEXT DR2, DR3, DR11, 8\nBFINS DR2, DR3, DR11 - 8, 8\nHALT');
    bits.sim.dr[11] = 8;
    bits.sim.dr[3] = 0xabcdef01;
    assert(bits.sim.step());
    assert.equal(bits.sim.dr[2], 0xef);
    assert(bits.sim.step());
    assert.equal(bits.sim.dr[2], 1);
    assert.equal(bits.sim.flags.Z, false);
    const skipped = await fixture('DR11', 'LOADEQ CR1, CR6, DR11 + 1\nHALT');
    skipped.sim.cr[6].word0 = 0;
    skipped.sim.dr[11] = 0xffffffff;
    assert(skipped.sim.step().skipped);
    assert.equal(skipped.sim.pc, 2);
    const cross = await fixture('DR11', 'LOAD CR1, CR6, DR11\nRETURN');
    const callerSlot = 42, callerBase = 0x1c00;
    const callerCode = new Assembler().assemble('CALL CR3\nHALT').words;
    cross.sim.nsCount = Math.max(cross.sim.nsCount, callerSlot + 1);
    cross.sim.withNamespaceWrite('disposable legacy caller', () =>
        cross.sim.writeNSEntry(callerSlot, callerBase, 2, 0, 0, 1, 1, 1, 0));
    cross.sim.memory[callerBase] = cross.sim.packLumpHeader(0, 2, 1);
    cross.sim.memory.set(callerCode, callerBase + 1);
    cross.sim.memory[callerBase + 63] = cross.sim.createGT(1, callerSlot, { E: 1 }, 1);
    const callerEntry = cross.sim.readNSEntry(callerSlot);
    cross.sim.cr[14] = { word0: cross.sim.createGT(1, callerSlot, { X: 1 }, 1),
        word1: callerBase, word2: callerEntry.word1_limit, word3: 0, m: 0 };
    cross.sim.cr[6] = { word0: cross.sim.createGT(1, callerSlot, { L: 1 }, 1),
        word1: callerBase + 63, word2: callerEntry.word1_limit, word3: 0, m: 1 };
    const calleeEntry = cross.sim.readNSEntry(cross.slot);
    cross.sim.cr[3] = { word0: cross.sim.createGT(1, cross.slot, { E: 1 }, 1),
        word1: cross.base, word2: calleeEntry.word1_limit, word3: 0, m: 0 };
    assert(cross.sim.step(), JSON.stringify(cross.sim.faultLog));
    assert.equal(cross.sim.pc, 0); // IDX1 explicit fastEntry, not legacy PC=1.
    assert(cross.sim.step(), JSON.stringify(cross.sim.faultLog));
    assert.equal(cross.sim.pc, 2);
    assert(cross.sim.step(), JSON.stringify(cross.sim.faultLog));
    assert.equal(cross.sim.pc, 1);
    assert.equal(cross.sim.parseGT(cross.sim.cr[14].word0).index, callerSlot);
    assert.equal(cross.sim.cr[6].word1, callerBase + 63);
    console.log('IDX1 real simulator LOAD, exact arithmetic and entry/mutation gate tests passed');
}
module.exports = { fixture };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });