'use strict';
// Regression: the resident boot Thread LUMP is allowed to begin at word zero.
// Its base must never be used as a truthiness test.

const ChurchSimulator = require('./simulator.js');

const THREAD_SLOT = 1;
const CODE_SLOT = 2;
const LED_SLOT = 12; // Canonical simulator LED device namespace slot
const CALLEE_SLOT = 4;
const CODE_BASE = 0x0400;
const LED_BASE = 0x0500;
const CALLEE_BASE = 0x0600;
const THREAD_CAPS_OFFSET = 244;
const AL = 0xE;

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
    if (condition) {
        console.log(`PASS ${label}`);
        passed++;
    } else {
        console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
        failed++;
    }
}

function lumpHeader(cw, cc, nMinus6 = 0, typ = 0) {
    return ((0x1F << 27) | ((nMinus6 & 0xF) << 23) |
        ((cw & 0x1FFF) << 10) | ((typ & 3) << 8) | (cc & 0xFF)) >>> 0;
}

function instruction(sim, opcode, dst, src, imm) {
    return sim.encodeInstruction(opcode, AL, dst, src, imm);
}

function installLump(sim, slot, base, cw = 8, cc = 1) {
    sim.withNamespaceWrite('thread-base-zero fixture', () => {
        sim.writeNSEntry(slot, base, 63, 0, 0, 1, 0, cc, 0);
    });
    sim.memory[base] = lumpHeader(cw, cc);
}

function makeSim() {
    const sim = new ChurchSimulator();
    sim.bootComplete = false;

    // Slot 1's Thread LUMP is deliberately resident at address zero.
    sim.withNamespaceWrite('thread-base-zero fixture', () => {
        sim.writeNSEntry(THREAD_SLOT, 0, 255, 0, 0, 1, 0, 0, 0);
    });
    sim.memory[0] = lumpHeader(32, 12, 2, 2); // canonical 256-word Thread LUMP
    const threadGT = sim.createGT(0, THREAD_SLOT, {R: 1, W: 1}, 1);
    sim.cr[12] = { word0: threadGT, word1: 0, word2: 255, word3: 0, m: 0 };

    installLump(sim, CODE_SLOT, CODE_BASE, 8, 1);
    sim.withNamespaceWrite('thread-base-zero fixture', () => {
        sim.writeNSEntry(LED_SLOT, LED_BASE, 4, 0, 0, 1, 0, 0, 0);
    });
    installLump(sim, CALLEE_SLOT, CALLEE_BASE, 8, 1);

    const codeGT = sim.createGT(0, CODE_SLOT, {R: 1, X: 1}, 1);
    sim.cr[14] = { word0: codeGT, word1: CODE_BASE, word2: 63, word3: 0, m: 0 };
    const clistGT = sim.createGT(0, CODE_SLOT, {L: 1}, 1);
    sim.cr[6] = {
        word0: clistGT,
        word1: CODE_BASE + 63,
        word2: sim.packNSWord1(63, 0, 0, 0, 1),
        word3: 0,
        m: 0,
    };
    sim.memory[CODE_BASE + 63] = sim.createGT(0, LED_SLOT, {R: 1, W: 1}, 1);
    // Dormant Thread identity is the canonical downward CHURCH frame:
    // indicator STO=241, Enter E-GT at +242, packed frame at +243.
    const enterGT = sim.createGT(0, CODE_SLOT, {E: 1}, 1);
    sim.memory[17] = 0x1000 | 241;
    sim.memory[242] = enterGT;
    sim.memory[243] = 0x1000 | 243;
    sim.sto = 243;
    sim.bootComplete = true;
    return sim;
}

console.log('\n--- Thread base zero: CapabilityTest device write ---');
{
    const sim = makeSim();
    // CapabilityTest-shaped sequence: LOAD LED capability, calculate a value,
    // then DWRITE it to LED[0].  DWRITE's immediate #0 has bit 14 set.
    sim.memory[CODE_BASE + 1] = instruction(sim, 0, 3, 6, 0);       // LOAD CR3, CR6, 0
    sim.memory[CODE_BASE + 2] = instruction(sim, 21, 1, 0, 0x4001); // IADD DR1, DR0, #1
    sim.memory[CODE_BASE + 3] = instruction(sim, 17, 1, 3, 0x4000); // DWRITE DR1, CR3, #0
    sim.pc = 0; // physical fetch address = CR14.word1 + 1 + PC

    check('TBZ-01: active CR12 reports base zero', sim._activeThreadBase() === 0);
    sim.step();
    check('TBZ-02: LOAD does not fault with Thread base zero', !sim.halted, sim.faultLog.at(-1)?.message);
    check('TBZ-03: LOAD mirrors the LED capability into the Thread caps home',
        sim.memory[THREAD_CAPS_OFFSET + 3] === sim.cr[3].word0);
    sim.step();
    check('TBZ-04: IADD does not fault with Thread base zero', !sim.halted, sim.faultLog.at(-1)?.message);
    check('TBZ-05: IADD mirrors DR1 into the Thread DR home', sim.memory[2] === 1);
    sim.step();
    check('TBZ-06: DWRITE does not raise a false CR12-null fault', !sim.halted, sim.faultLog.at(-1)?.message);
    check('TBZ-07: DWRITE turns LED0 on', (sim.ledBits & 1) === 1);
    check('TBZ-08: DWRITE leaves DR1 mirrored at Thread[+2]', sim.memory[2] === 1);
}

console.log('\n--- Thread base zero: frame and capability persistence ---');
{
    const sim = makeSim();
    const callerGT = sim.createGT(0, CODE_SLOT, {R: 1, X: 1}, 1);
    const calleeGT = sim.createGT(0, CALLEE_SLOT, {E: 1}, 1);
    sim.cr[14] = { word0: callerGT, word1: CODE_BASE, word2: 63, word3: 0, m: 0 };
    sim.cr[0] = { word0: calleeGT, word1: CALLEE_BASE, word2: 63, word3: 0, m: 0 };
    sim.pc = 1;

    const call = sim._execCall({ crDst: 0, imm: 0 });
    check('TBZ-09: CALL accepts Thread base zero', call !== null && !sim.halted, sim.faultInfo?.message);
    check('TBZ-10: CALL persists both frame words at Thread base zero',
        sim.memory[241] === sim.callStack[0]?.frameWord &&
        sim.memory[240] === sim.callStack[0]?.savedCRs[6].word0);

    const returned = sim._execReturn({ imm: 0 });
    check('TBZ-11: RETURN restores capability homes at Thread base zero',
        returned !== null && !sim.halted &&
        sim.memory[THREAD_CAPS_OFFSET] === calleeGT, sim.faultLog.at(-1)?.message);
}

console.log('\n--- Thread base zero: deferred LAMBDA frame ---');
{
    const sim = makeSim();
    const lambdaGT = sim.createGT(0, CALLEE_SLOT, {X: 1}, 1);
    sim.cr[0] = { word0: lambdaGT, word1: CALLEE_BASE, word2: 63, word3: 0, m: 0 };
    sim.sto = 240;
    sim.memory[17] = 0x1000 | 240;
    const lambda = sim._execLambda({ crDst: 0 });
    const cachedFrame = sim.lambdaCachedFrame?.word;
    sim._flushLambdaCache();
    check('TBZ-12: LAMBDA flush persists its frame at Thread base zero',
        lambda !== null && !sim.halted && sim.memory[240] === cachedFrame, sim.faultInfo?.message);
}

console.log('\n--- Thread base zero: genuine null CR12 remains a fault ---');
{
    const sim = makeSim();
    sim.memory[CODE_BASE + 1] = instruction(sim, 0, 3, 6, 0);
    sim.memory[CODE_BASE + 2] = instruction(sim, 21, 1, 0, 0x4001);
    sim.memory[CODE_BASE + 3] = instruction(sim, 17, 1, 3, 0x4000);
    sim.pc = 0;
    sim.step();
    sim.step();
    sim.cr[12] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
    sim.step();
    check('TBZ-13: null CR12 faults explicitly rather than writing a Thread home',
        sim.halted && sim.faultLog.at(-1)?.type === 'NULL_CAP' &&
        /CR12 is null/.test(sim.faultLog.at(-1)?.message || ''),
        sim.faultLog.at(-1)?.message);
    check('TBZ-14: null CR12 prevents the LED write', (sim.ledBits & 1) === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);