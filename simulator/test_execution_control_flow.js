'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

global.window = {};
const ChurchSimulator = require('./simulator.js');
const ChurchAssembler = require('./assembler.js');

const RETURN_AL = ((3 << 27) | (14 << 23)) >>> 0;
const CALL_AL_CR0 = ((2 << 27) | (14 << 23)) >>> 0;
const ELOADCALL_AL_CR0_CR6_ROW1 =
    ((8 << 27) | (14 << 23) | (0 << 19) | (6 << 15) | 1) >>> 0;

// NOP and HALT have distinct encodings: NOP advances normally, while only the
// all-zero word terminates the active execution path.
{
    const assembler = new ChurchAssembler();
    const assembled = assembler.assemble('NOP\nHALT');
    assert.deepStrictEqual(assembler.errors, []);
    assert.notStrictEqual(assembled.words[0], 0, 'NOP is not the HALT sentinel');
    assert.strictEqual(assembled.words[1], 0, 'HALT remains all-zero');
    assert.strictEqual(assembler.disassemble(assembled.words[0]), 'NOP');

    const sim = new ChurchSimulator();
    sim.bootComplete = false;
    // CR14 fetches from base + 1 + PC, so place the raw program after the
    // synthetic LUMP-header position at memory word 0.
    sim.loadProgram(assembled.words, 1);
    sim.bootComplete = true;
    sim.cr[14] = {
        word0: sim.createGT(0, 1, { R: 1, X: 1 }, 1),
        word1: 0, word2: 1, word3: 0, m: 0,
    };
    const nop = sim.step();
    assert.strictEqual(nop.instr.opcode, 0, 'NOP uses the ignored LOAD opcode');
    assert.strictEqual(nop.instr.cond, 15, 'NOP uses the never-execute condition');
    assert.strictEqual(nop.skipped, true, 'NOP does not execute as LOAD');
    assert.strictEqual(sim.pc, 1);
    assert.strictEqual(sim.halted, false);
    const halt = sim.step();
    assert.strictEqual(halt.opName, 'HALT');
    assert.strictEqual(sim.halted, true);
}

function writeNsEntry(sim, slot, base, limit, cc) {
    const wasBooted = sim.bootComplete;
    sim.bootComplete = false;
    try {
        sim.writeNSEntry(slot, base, limit, 0, 0, 1, 0, cc, 0);
    } finally {
        sim.bootComplete = wasBooted;
    }
}

function writeLump(sim, slot, base, codeWords, cc = 1) {
    const lumpSize = 64;
    const cw = codeWords.length;
    sim.memory[base] = ((0x1F << 27) | (cw << 10) | cc) >>> 0;
    codeWords.forEach((word, index) => {
        sim.memory[base + 1 + index] = word >>> 0;
    });
    writeNsEntry(sim, slot, base, lumpSize - 1, cc);
    return { lumpSize, clistBase: base + lumpSize - cc };
}

function makeCallFixture(calleeInstruction) {
    const sim = new ChurchSimulator();
    sim.bootComplete = true;
    sim.cr[12] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };

    const caller = writeLump(sim, 4, 0x0300, [ELOADCALL_AL_CR0_CR6_ROW1], 2);
    // Method selector 0 enters at PC=1; word 0 is the method-table position.
    const callee = writeLump(sim, 6, 0x0600, [RETURN_AL, calleeInstruction], 1);
    const callerSeq = sim.parseNSWord1(sim.readNSEntry(4).word1_limit).gtSeq;
    const calleeSeq = sim.parseNSWord1(sim.readNSEntry(6).word1_limit).gtSeq;
    const callerRX = sim.createGT(callerSeq, 4, { R: 1, X: 1 }, 1);
    const callerL = sim.createGT(callerSeq, 4, { L: 1 }, 1);
    const calleeE = sim.createGT(calleeSeq, 6, { E: 1 }, 1);

    sim.memory[caller.clistBase + 1] = calleeE;
    sim.cr[14] = { word0: callerRX, word1: 0x0300, word2: 63, word3: 0, m: 0 };
    sim.cr[6] = { word0: callerL, word1: caller.clistBase, word2: 63, word3: 0, m: 0 };
    sim.pc = 0;
    return { sim, callerRX, calleePhysical: 0x0602, callerContinuation: 1 };
}

function makeOrdinaryCallFixture() {
    const sim = new ChurchSimulator();
    sim.bootComplete = true;
    sim.cr[12] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
    writeLump(sim, 4, 0x0300, [CALL_AL_CR0], 1);
    writeLump(sim, 7, 0x0700, [RETURN_AL, 0], 1);
    sim.cr[14] = {
        word0: sim.createGT(0, 4, { R: 1, X: 1 }, 1),
        word1: 0x0300, word2: 63, word3: 0, m: 0,
    };
    sim.cr[6] = {
        word0: sim.createGT(0, 4, { L: 1 }, 1),
        word1: 0x033F, word2: 63, word3: 0, m: 0,
    };
    sim.cr[0] = {
        word0: sim.createGT(0, 7, { E: 1 }, 1),
        word1: 0, word2: 0, word3: 0, m: 0,
    };
    sim.pc = 0;
    return sim;
}

// The predictor must use the live CR14 base, exactly like _fetchInstruction,
// rather than a potentially different Namespace-table location.
{
    const sim = new ChurchSimulator();
    sim.bootComplete = true;
    writeNsEntry(sim, 4, 0x0300, 63, 1);
    sim.cr[14] = {
        word0: sim.createGT(0, 4, { R: 1, X: 1 }, 1),
        word1: 0x0380,
        word2: 63,
        word3: 0,
        m: 0,
    };
    sim.pc = 2;
    assert.strictEqual(sim._nextPhysicalAddr(), 0x0383,
        'next physical address follows live CR14.word1 + 1 + PC');
}

// Ordinary CALL uses the same dynamic CR14 transition and stops before the
// callee instruction rather than comparing against the stale caller LUMP.
{
    const sim = makeOrdinaryCallFixture();
    const result = sim.run(10, new Set([0x0702]));
    assert.strictEqual(result.stopReason, 'breakpoint');
    assert.strictEqual(result.breakpointAddr, 0x0702);
    assert.strictEqual(result.steps, 1);
    assert.strictEqual(sim.callStack.length, 1);
}

// Run stops before its first instruction and does not consume the breakpoint.
{
    const { sim } = makeCallFixture(0);
    const breakpoints = new Set([0x0301]);
    const result = sim.run(10, breakpoints);
    assert.deepStrictEqual(result, {
        steps: 0,
        stopReason: 'breakpoint',
        breakpointAddr: 0x0301,
    });
    assert.strictEqual(sim.stepCount, 0, 'entry instruction did not execute');
    assert.strictEqual(breakpoints.has(0x0301), true,
        'persistent breakpoint remains installed');
}

// After ELOADCALL replaces CR14 and PC, Run resolves the callee address and
// pauses before its first instruction with an independent call frame.
{
    const { sim, calleePhysical } = makeCallFixture(0);
    const result = sim.run(10, new Set([calleePhysical]));
    assert.strictEqual(result.stopReason, 'breakpoint');
    assert.strictEqual(result.breakpointAddr, calleePhysical);
    assert.strictEqual(result.steps, 1, 'only ELOADCALL retired');
    assert.strictEqual(sim.callStack.length, 1, 'callee owns an independent frame');
    assert.strictEqual(sim.halted, false, 'callee HALT has not executed yet');
}

// Terminal HALT stops in the callee. It does not pop the frame, restore the
// caller, advance PC, or attempt an out-of-range continuation fetch.
{
    const { sim, calleePhysical } = makeCallFixture(0);
    const result = sim.run(10);
    assert.strictEqual(result.stopReason, 'halted');
    assert.strictEqual(result.steps, 2, 'ELOADCALL and HALT retired');
    assert.strictEqual(sim.halted, true);
    assert.strictEqual(sim.callStack.length, 1, 'HALT did not invent a RETURN');
    assert.strictEqual(sim.pc, 1, 'HALT left callee PC at its terminal instruction');
    assert.strictEqual(sim.physicalPC, calleePhysical);
    assert.strictEqual(sim.faultLog.length, 0, 'HALT is clean termination');
}

// A real RETURN remains distinct from HALT: it pops exactly the nested frame
// and restores both the caller continuation and caller CR14.
{
    const { sim, callerRX, callerContinuation } = makeCallFixture(RETURN_AL);
    const call = sim.step();
    assert.ok(call && call.instr && call.instr.opcode === 8);
    const ret = sim.step();
    assert.ok(ret && ret.instr && ret.instr.opcode === 3);
    assert.strictEqual(sim.callStack.length, 0);
    assert.strictEqual(sim.pc, callerContinuation);
    assert.strictEqual(sim.cr[14].word0 >>> 0, callerRX >>> 0);
    assert.strictEqual(sim.halted, false);
    assert.strictEqual(sim._nextPhysicalAddr(), 0x0302,
        'restored CR14 and PC produce the caller continuation');
}

// UI Step and Walk must perform their breakpoint check before calling step().
{
    const appRun = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
    for (const name of ['stepSim', 'walkNext']) {
        const start = appRun.indexOf(`function ${name}(`);
        const nextFunction = appRun.indexOf('\nfunction ', start + 1);
        const body = appRun.slice(start, nextFunction < 0 ? undefined : nextFunction);
        const checkAt = body.indexOf('_breakpointBeforeNextInstruction()');
        const stepAt = body.indexOf('sim.step()');
        assert.ok(checkAt >= 0 && stepAt >= 0 && checkAt < stepAt,
            `${name} checks the current physical breakpoint before executing`);
    }
    assert.ok(appRun.includes('function _consumeOneShotBreakpoint(addr)'),
        'all UI execution modes share one-shot breakpoint consumption');
    assert.ok(appRun.includes('_reportBreakpointPause(addr) {\n    _consumeOneShotBreakpoint(addr);'),
        'Step and Walk reporting consumes a fired one-shot breakpoint');
    assert.ok(appRun.includes("_consumeOneShotBreakpoint(breakpointAddr);\n                status = `Breakpoint"),
        'Run completion consumes a fired one-shot breakpoint');
}

console.log('execution control-flow regressions passed');