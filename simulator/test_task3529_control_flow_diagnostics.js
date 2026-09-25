'use strict';

const assert = require('assert');

global.window = {};
const ChurchSimulator = require('./simulator.js');

const RETURN_AL = ((3 << 27) | (14 << 23)) >>> 0;

function writeEntry(sim, slot, base, words) {
    const priorBoot = sim.bootComplete;
    sim.bootComplete = false;
    const nMinus6 = words.length > 62 ? 1 : 0;
    const lumpWords = 1 << (nMinus6 + 6);
    sim.memory[base] = ((0x1F << 27) | (nMinus6 << 23) |
        (words.length << 10) | 1) >>> 0;
    words.forEach((word, index) => {
        sim.memory[base + 1 + index] = word >>> 0;
    });
    sim.writeNSEntry(slot, base, lumpWords - 1, 0, 0, 1, 0, 1, 0);
    sim.bootComplete = priorBoot;
}

function descriptor(word0 = 0, word1 = 0) {
    return { word0: word0 >>> 0, word1: word1 >>> 0,
        word2: 0, word3: 0, m: 0 };
}

function fixture() {
    const sim = new ChurchSimulator();
    sim.bootComplete = true;
    writeEntry(sim, 4, 0x300, [RETURN_AL, RETURN_AL]);
    writeEntry(sim, 7, 0x700, [RETURN_AL, RETURN_AL]);
    writeEntry(sim, 8, 0x800, [RETURN_AL, RETURN_AL]);
    const seq = slot => sim.parseNSWord1(sim.readNSEntry(slot).word1_limit).gtSeq;
    sim.cr[12] = descriptor();
    sim.cr[14] = descriptor(sim.createGT(seq(4), 4, {R:1, X:1}, 1), 0x300);
    sim.cr[6] = descriptor(sim.createGT(seq(4), 4, {L:1}, 1), 0x33F);
    sim.cr[0] = descriptor(sim.createGT(seq(7), 7, {E:1}, 1));
    sim.pc = 0;
    return { sim, seq };
}

function protectedFixture() {
    const sim = new ChurchSimulator();
    sim.bootComplete = false;
    sim.withNamespaceWrite('synthetic diagnostic Thread', () => {
        sim.writeNSEntry(1, 0, 255, 0, 0, 1, 0, 0, 0);
        for (let slot = 2; slot <= 3; slot++) {
            sim.writeNSEntry(slot, slot * 256, 63, 0, 0, 1, 0, 1, 0);
        }
    });
    sim.memory[0] = ((0x1F << 27) | (2 << 23) |
        (32 << 10) | (2 << 8) | 12) >>> 0;
    sim.memory[512] = ((0x1F << 27) | (8 << 10) | 1) >>> 0;
    sim.memory[768] = ((0x1F << 27) | (8 << 10) | 1) >>> 0;
    sim.memory[513] = RETURN_AL;
    sim.memory[769] = RETURN_AL;
    const threadGT = sim.createGT(0, 1, {R:1, W:1}, 1);
    const callerX = sim.createGT(0, 2, {X:1}, 1);
    const callerL = sim.createGT(0, 2, {L:1}, 1);
    const callerE = sim.createGT(0, 2, {E:1}, 1);
    sim.cr[12] = descriptor(threadGT, 0);
    sim.cr[14] = descriptor(callerX, 512);
    sim.cr[6] = descriptor(callerL, 575);
    sim.memory[17] = sim._packProtectedIndicator(241, 1, {});
    sim.memory[242] = callerE;
    sim.memory[243] = sim._packFrameWordRaw(0x7FFF, 1, 243);
    sim.sto = 241;
    sim.pc = 1;
    sim.bootComplete = true;
    return {sim, callerE};
}

// Ordinary CALL from logical PC 0 records saved NIA 1, nested RETURNs remain valid.
{
    const { sim, seq } = fixture();
    assert(sim._execCall({crDst: 0, crSrc: 0, imm: 0}));
    assert.strictEqual(sim.callStack[0].returnPC, 1);
    sim.cr[0] = descriptor(sim.createGT(seq(8), 8, {E:1}, 1));
    sim.pc = 0;
    assert(sim._execCall({crDst: 0, crSrc: 0, imm: 0}));
    assert.strictEqual(sim.callStack.length, 2);
    assert(sim._execReturn({imm: 0}));
    assert(sim._execReturn({imm: 0}));
    assert.strictEqual(sim.callStack.length, 0);
    const events = sim.getControlFlowDiagnostics().events;
    assert.deepStrictEqual(events.slice(-8).map(event => `${event.kind}:${event.phase}`),
        ['CALL:pre', 'CALL:post', 'CALL:pre', 'CALL:post',
            'RETURN:pre', 'RETURN:post', 'RETURN:pre', 'RETURN:post']);
}

// Protected Thread evidence uses raw sentinel/companion/frame words, and a
// failed poison-root RETURN remains in the diagnostic ring across reset.
{
    const {sim, callerE} = protectedFixture();
    sim.cr[0] = descriptor(sim.createGT(0, 3, {E:1}, 1), 768);
    assert(sim._execCall({crDst: 0, imm: 0}));
    const callEvents = sim.getControlFlowDiagnostics().events
        .filter(event => event.kind === 'CALL').slice(-2);
    assert.strictEqual(callEvents[0].protectedThread.indicatorAddress, 17);
    assert.strictEqual(callEvents[0].protectedThread.frameAddress, 243);
    assert.strictEqual(callEvents[0].protectedThread.frameWord,
        sim._packFrameWordRaw(0x7FFF, 1, 243));
    assert.strictEqual(callEvents[0].protectedThread.decodedFrame.nia, 0x7FFF);
    assert.strictEqual(callEvents[1].protectedThread.companionWord, callerE);
    assert.strictEqual(callEvents[1].protectedThread.decodedFrame.nia, 2);
    assert(sim._execReturn({imm: 0}));
    assert.strictEqual(sim._execReturn({imm: 0}), null);
    const failedSequence = sim.getControlFlowDiagnostics().events.at(-1).sequence;
    sim.reset('protected-fixture-reset');
    assert(sim.getControlFlowDiagnostics().events.some(event =>
        event.sequence === failedSequence &&
        event.kind === 'RETURN' && event.detail.ok === false));
}

// Saved PC zero is ordinary data, not the root poison marker.
{
    const { sim } = fixture();
    sim.pc = -1;
    assert(sim._execCall({crDst: 0, crSrc: 0, imm: 0}));
    assert.strictEqual(sim.callStack[0].returnPC, 0);
    const returned = sim._execReturn({imm: 0});
    assert(returned);
    assert.strictEqual(sim.pc, 0);
    assert.strictEqual(sim.halted, false);
}

// Poison root behavior is unchanged and both sides of the failed RETURN exist.
{
    const { sim } = fixture();
    sim.callStack.push({
        returnPC: 0x7FFF, savedCRs: sim.cr.map(item => ({...item})),
        savedDRs: [...sim.dr], savedFlags: {...sim.flags}, savedSTO: sim.sto,
        sz: 1, frameWord: sim._packFrameWordRaw(0x7FFF, 1, sim.sto),
        frameAddress: sim.sto, sentinel: true, companionGT: 0,
    });
    const before = sim.callStack.length;
    assert.strictEqual(sim._execReturn({imm: 0}), null);
    assert.strictEqual(sim.halted, true);
    assert.strictEqual(sim.callStack.length, before);
    const tail = sim.getControlFlowDiagnostics().events.slice(-2);
    assert.deepStrictEqual(tail.map(event => event.phase), ['pre', 'post']);
    assert.strictEqual(tail[1].detail.ok, false);
}

// Reset captures the live descriptors before state clearing and survives reset.
{
    const { sim } = fixture();
    sim.cr[14].word0 = 0xDEADBEEF;
    const generation = sim.getControlFlowDiagnostics().resetGeneration;
    sim.reset('synthetic-test');
    const snapshot = sim.getControlFlowDiagnostics();
    const reset = snapshot.events.filter(event =>
        event.kind === 'RESET' && event.detail &&
        event.detail.reason === 'synthetic-test').pop();
    assert(reset);
    assert.strictEqual(reset.descriptors.cr14.word0, 0xDEADBEEF);
    assert.strictEqual(sim.cr[14].word0, 0);
    assert.strictEqual(snapshot.resetGeneration, generation + 1);
    assert.strictEqual(reset.resetGeneration, generation);
}

// Fault fast-boot records the recovery reset before register clearing and moves
// subsequent evidence into a new generation. No boot ROM or workload runs.
{
    const { sim } = fixture();
    sim.cr[14].word0 = 0xA5A5A5A5;
    const generation = sim.getControlFlowDiagnostics().resetGeneration;
    sim._fastBoot(2);
    const snapshot = sim.getControlFlowDiagnostics();
    const reset = snapshot.events.filter(event =>
        event.kind === 'RESET' && event.detail &&
        event.detail.reason === '_fastBoot(2)').pop();
    assert(reset);
    assert.strictEqual(reset.descriptors.cr14.word0, 0xA5A5A5A5);
    assert.strictEqual(reset.resetGeneration, generation);
    assert.strictEqual(snapshot.resetGeneration, generation + 1);
    assert.strictEqual(sim.cr[14].word0, 0);
    assert.strictEqual(sim.bootComplete, false);
    assert.strictEqual(sim.halted, false);
}

// A zero word at the pre-boot fetch address is captured as evidence rather than
// confused with missing evidence. The fixture does not execute that word.
{
    const sim = new ChurchSimulator();
    sim.bootComplete = false;
    sim.physicalPC = 0;
    sim.memory[0] = 0;
    const generation = sim.getControlFlowDiagnostics().resetGeneration;
    sim._returnToBoot('preboot-zero-fixture');
    const snapshot = sim.getControlFlowDiagnostics();
    const reset = snapshot.events.filter(event =>
        event.kind === 'RESET' && event.detail &&
        event.detail.reason === 'preboot-zero-fixture').pop();
    assert(reset);
    assert.strictEqual(reset.instructionWord, 0);
    assert.strictEqual(reset.bootComplete, false);
    assert.strictEqual(reset.resetGeneration, generation);
    assert.strictEqual(snapshot.resetGeneration, generation + 1);
}

// Snapshots are detached, ring/code evidence are bounded, and sink failures isolate.
{
    const { sim } = fixture();
    sim.setControlFlowDiagnosticSink(() => { throw new Error('broken sink'); });
    sim.setControlFlowDiagnosticContextProvider(() => ({executionIdentity: 'synthetic'}));
    const first = sim._execCall({crDst: 0, crSrc: 0, imm: 0});
    assert(first, 'broken optional sink must not alter CALL outcome');
    sim.cr[0] = descriptor();
    for (let i = 0; i < 140; i++) {
        sim.halted = false;
        sim._execCall({crDst: 0, crSrc: 0, imm: 0});
    }
    const snapshot = sim.getControlFlowDiagnostics();
    assert(snapshot.events.length <= 256);
    assert(snapshot.codeEvidence.length <= 32);
    assert(snapshot.codeEvidence.every(item =>
        Array.isArray(item.codeWords) && Array.isArray(item.cListWords)));
    const liveSequence = snapshot.events[0].sequence;
    snapshot.events[0].sequence = -1;
    snapshot.codeEvidence[0].codeWords[0] = 0;
    const again = sim.getControlFlowDiagnostics();
    assert.strictEqual(again.events[0].sequence, liveSequence);
    assert.notStrictEqual(again.codeEvidence[0].codeWords[0], 0);
}

// Full declared executable evidence includes words beyond the old 64-word cap,
// along with declared/truncation metadata and a separately computed fetch.
{
    const sim = new ChurchSimulator();
    sim.bootComplete = true;
    const words = new Array(80).fill(RETURN_AL);
    words[75] = 0x12345678;
    writeEntry(sim, 9, 0x900, words);
    sim.cr[14] = descriptor(sim.createGT(0, 9, {X:1}, 1), 0x900);
    sim.pc = 75;
    sim.physicalPC = 7; // deliberately stale
    sim.recordControlFlowDiagnostic('UI_STOP', {reason: 'synthetic'});
    const snapshot = sim.getControlFlowDiagnostics();
    const event = snapshot.events.at(-1);
    const code = snapshot.codeEvidence.find(item => item.key === event.codeIdentity);
    assert(code);
    assert.strictEqual(code.declaredCodeWords, 80);
    assert.strictEqual(code.codeTruncated, false);
    assert.strictEqual(code.codeWords[75], 0x12345678);
    assert.strictEqual(event.currentFetchAddress, 0x900 + 1 + 75);
    assert.strictEqual(event.currentFetchInstructionWord, 0x12345678);
    assert.strictEqual(event.physicalPC, 7);
}

console.log('task3529 control-flow diagnostics tests passed');