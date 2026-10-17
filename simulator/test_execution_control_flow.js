'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ChurchAssembler = require('./assembler.js');
const { fixture } = require('../tests/simulator/cr6_contract_fixture.js');
const gateLogCss = fs.readFileSync(
    path.join(__dirname, 'styles-gatelog.css'), 'utf8');

const RETURN_AL = ((3 << 27) | (14 << 23)) >>> 0;
const CALL_AL_CR0 = ((2 << 27) | (14 << 23)) >>> 0;
// Current indexed CALL: CR6 row 1, method 1. Opcode 8 (ELOADCALL) is retired.
const CALL_AL_CR6_ROW1_METHOD1 =
    ((2 << 27) | (14 << 23) | (6 << 15) | (1 << 5) | 1) >>> 0;
const BRANCH_AL_PLUS1 = ((23 << 27) | (14 << 23) | 1) >>> 0;

// NOP and HALT have distinct encodings: NOP advances normally, while only the
// all-zero word terminates the active execution path.
{
    const assembler = new ChurchAssembler();
    const assembled = assembler.assemble('NOP\nHALT');
    assert.deepStrictEqual(assembler.errors, []);
    assert.notStrictEqual(assembled.words[0], 0, 'NOP is not the HALT sentinel');
    assert.strictEqual(assembled.words[1], 0, 'HALT remains all-zero');
    assert.strictEqual(assembler.disassemble(assembled.words[0]), 'NOP');

    const { sim, install, activate } = fixture();
    // Canonical SELF, Namespace seal/generation and RX/E+M descriptors are
    // established in private RAM; normal fetch/admission gates remain active.
    activate(install(30, assembled.words));
    const nop = sim.step();
    assert.ok(nop && nop.instr, 'NOP must fetch and retire in the executable fixture');
    assert.strictEqual(nop.instr.opcode, 0, 'NOP uses the ignored LOAD opcode');
    assert.strictEqual(nop.instr.cond, 15, 'NOP uses the never-execute condition');
    assert.strictEqual(nop.skipped, true, 'NOP does not execute as LOAD');
    assert.strictEqual(sim.pc, 1);
    assert.strictEqual(sim.halted, false);
    const halt = sim.step();
    assert.strictEqual(halt.opName, 'HALT');
    assert.strictEqual(sim.halted, true);
}

function makeCallFixture(calleeInstruction) {
    const { sim, install, activate } = fixture();
    // A real method-table entry dispatches method 1 to logical PC 1.
    const callee = install(31, [BRANCH_AL_PLUS1, calleeInstruction]);
    const caller = install(30, [CALL_AL_CR6_ROW1_METHOD1, 0], [callee.gt]);
    activate(caller);
    // This code only needs X. Start with the same least-privilege code view
    // RETURN reconstructs from the saved E companion, so exact restoration
    // remains an assertion rather than requiring RETURN to add R authority.
    const identity = sim.parseGT(caller.gt);
    sim.cr[14].word0 = sim.createGT(identity.gt_seq, identity.index, { X: 1 }, 1);
    return {
        sim, callerX: sim.cr[14].word0,
        callerPhysical: caller.base + 1,
        calleePhysical: callee.base + 2, callerContinuation: 1,
    };
}

function makeOrdinaryCallFixture() {
    const { sim, install, activate } = fixture();
    const callee = install(31, [BRANCH_AL_PLUS1, RETURN_AL, 0]);
    const caller = install(30, [CALL_AL_CR0, 0]);
    activate(caller);
    sim.cr[0].word0 = callee.gt;
    return { sim, calleePhysical: callee.base + 2 };
}

// The predictor must use the live CR14 base, exactly like _fetchInstruction,
// rather than a potentially different Namespace-table location.
{
    const { sim, install, activate } = fixture();
    const caller = install(30, [RETURN_AL]);
    activate(caller);
    // Deliberately divergent base only for this address-predictor check.
    sim.cr[14].word1 = caller.base + 0x80;
    sim.pc = 2;
    assert.strictEqual(sim._nextPhysicalAddr(), caller.base + 0x83,
        'next physical address follows live CR14.word1 + 1 + PC');
}

// Ordinary CALL uses the same dynamic CR14 transition and stops before the
// callee instruction rather than comparing against the stale caller LUMP.
{
    const { sim, calleePhysical } = makeOrdinaryCallFixture();
    const result = sim.run(10, new Set([calleePhysical]));
    assert.strictEqual(result.stopReason, 'breakpoint');
    assert.strictEqual(result.breakpointAddr, calleePhysical);
    assert.strictEqual(result.steps, 1);
    assert.strictEqual(sim.callStack.length, 1);
}

// Run stops before its first instruction and does not consume the breakpoint.
{
    const { sim, callerPhysical } = makeCallFixture(0);
    const breakpoints = new Set([callerPhysical]);
    const result = sim.run(10, breakpoints);
    assert.deepStrictEqual(result, {
        steps: 0,
        stopReason: 'breakpoint',
        breakpointAddr: callerPhysical,
    });
    assert.strictEqual(sim.stepCount, 0, 'entry instruction did not execute');
    assert.strictEqual(breakpoints.has(callerPhysical), true,
        'persistent breakpoint remains installed');
}

// A second Run resumes past the instruction that caused the persistent
// breakpoint. The breakpoint remains armed for a later arrival.
{
    const { sim, callerPhysical } = makeCallFixture(0);
    const breakpoints = new Set([callerPhysical]);
    const first = sim.run(10, breakpoints);
    assert.strictEqual(first.stopReason, 'breakpoint');
    const second = sim.run(1, breakpoints);
    assert.strictEqual(second.stopReason, 'maxSteps',
        'resumed Run executes instead of re-triggering the same breakpoint');
    assert.strictEqual(second.steps, 1);
    assert.strictEqual(breakpoints.has(callerPhysical), true,
        'persistent breakpoint remains armed after resume');
}

// Step/Walk and Run share one breakpoint policy method. Consuming the resume
// token through the direct pre-execute check must affect the next Run too.
{
    const { sim, callerPhysical } = makeCallFixture(0);
    const breakpoints = new Set([callerPhysical]);
    assert.strictEqual(sim.checkBreakpointBeforeExecute(breakpoints), callerPhysical);
    const run = sim.run(1, breakpoints);
    assert.strictEqual(run.stopReason, 'maxSteps',
        'Run consumes the resume token armed through the shared UI policy');
    assert.strictEqual(run.steps, 1);
}

// Reset clears a pending Run resume so returning to the same address pauses
// again instead of inheriting a bypass from the prior machine state.
{
    const { sim, callerPhysical } = makeCallFixture(0);
    const breakpoints = new Set([callerPhysical]);
    assert.strictEqual(sim.run(10, breakpoints).stopReason, 'breakpoint');
    assert.strictEqual(sim._breakpointResumeAddr, callerPhysical);
    sim.reset();
    assert.strictEqual(sim._breakpointResumeAddr, null,
        'reset removes the pending one-time breakpoint bypass');
}

// After indexed CALL replaces CR14 and PC, Run resolves the callee address and
// pauses before its first instruction with an independent call frame.
{
    const { sim, calleePhysical } = makeCallFixture(0);
    const result = sim.run(10, new Set([calleePhysical]));
    assert.strictEqual(result.stopReason, 'breakpoint');
    assert.strictEqual(result.breakpointAddr, calleePhysical);
    assert.strictEqual(result.steps, 1, 'only indexed CALL retired');
    assert.strictEqual(sim.callStack.length, 1, 'callee owns an independent frame');
    assert.strictEqual(sim.halted, false, 'callee HALT has not executed yet');
}

// Terminal HALT stops in the callee. It does not pop the frame, restore the
// caller, advance PC, or attempt an out-of-range continuation fetch.
{
    const { sim, calleePhysical } = makeCallFixture(0);
    const result = sim.run(10);
    assert.strictEqual(result.stopReason, 'halted');
    assert.strictEqual(result.steps, 2, 'indexed CALL and HALT retired');
    assert.strictEqual(sim.halted, true);
    assert.strictEqual(sim.callStack.length, 1, 'HALT did not invent a RETURN');
    assert.strictEqual(sim.pc, 1, 'HALT left callee PC at its terminal instruction');
    assert.strictEqual(sim.physicalPC, calleePhysical);
    assert.strictEqual(sim.faultLog.length, 0, 'HALT is clean termination');
}

// A real RETURN remains distinct from HALT: it pops exactly the nested frame
// and restores both the caller continuation and caller CR14.
{
    const { sim, callerX, callerPhysical, callerContinuation } = makeCallFixture(RETURN_AL);
    const call = sim.step();
    assert.ok(call && call.instr && call.instr.opcode === 2);
    const ret = sim.step();
    assert.ok(ret && ret.instr && ret.instr.opcode === 3);
    assert.strictEqual(sim.callStack.length, 0);
    assert.strictEqual(sim.pc, callerContinuation);
    assert.strictEqual(sim.cr[14].word0 >>> 0, callerX >>> 0);
    assert.strictEqual(sim.halted, false);
    assert.strictEqual(sim._nextPhysicalAddr(), callerPhysical + 1,
        'restored CR14 and PC produce the caller continuation');
    assert.deepStrictEqual(
        sim.getControlFlowDiagnostics().events
            .filter(event => ['CALL', 'RETURN'].includes(event.kind))
            .map(event => [event.kind, event.phase, event.detail.ok]),
        [['CALL', 'pre', undefined], ['CALL', 'post', true],
         ['RETURN', 'pre', undefined], ['RETURN', 'post', true]],
        'successful CALL and RETURN both reach their diagnostic boundaries');
}

// Physical breakpoints are decoded by address, not by the current logical PC.
// This keeps all three Church control-flow opcodes directly selectable even
// when the instruction has not executed yet.
{
    const { sim, install, activate } = fixture();
    const words = [
        ((2 << 27) | (14 << 23)) >>> 0, // CALL
        ((3 << 27) | (14 << 23)) >>> 0, // RETURN
        ((4 << 27) | (14 << 23) | (12 << 19) | (12 << 15)) >>> 0, // CHANGE
    ];
    const caller = install(30, words);
    activate(caller);

    for (const [offset, operation] of [[0, 'CALL'], [1, 'RETURN'], [2, 'CHANGE']]) {
        sim.pc = offset;
        sim.physicalPC = caller.base + 1 + offset;
        sim.halted = false;
        sim._breakpointResumeAddr = null;
        const address = caller.base + 1 + offset;
        const breakpoints = new Set([address]);
        const result = sim.run(1, breakpoints);
        assert.strictEqual(result.stopReason, 'breakpoint',
            `${operation} pauses before its physical instruction`);
        assert.strictEqual(result.breakpointAddr, address);
        assert.strictEqual(sim.stepCount, 0,
            `${operation} does not execute while paused`);
        assert.strictEqual(breakpoints.has(address), true,
            `${operation} breakpoint remains persistent`);
    }
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
    const walkStart = appRun.indexOf('function walkNext(');
    const walkEnd = appRun.indexOf('\nfunction ', walkStart + 1);
    const walkBody = appRun.slice(walkStart, walkEnd);
    assert.ok(walkBody.indexOf('_applyPendingSimLoad()') >= 0 &&
              walkBody.indexOf('_applyPendingSimLoad()') <
              walkBody.indexOf('_breakpointBeforeNextInstruction()'),
        'Walk applies pending editor code before breakpoint evaluation');
    assert.ok(walkBody.includes("_handleExecutionSuspension(result, 'walk', finishWalk)"),
        'Walk shares Step suspension handling and stops its timer before async resolution');
    assert.ok(appRun.includes('function _consumeOneShotBreakpoint(addr)'),
        'all UI execution modes share one-shot breakpoint consumption');
    assert.ok(appRun.includes('function _reportBreakpointPause(addr)') &&
              appRun.includes('_consumeOneShotBreakpoint(addr);'),
        'all UI pause reporting shares one-shot breakpoint consumption');
    assert.ok(appRun.includes(
        'return sim.checkBreakpointBeforeExecute(simBreakpoints, simUniversalBreakpoints);'),
        'Step and Walk delegate address and universal breakpoint policy to the simulator');
    assert.ok(appRun.includes(
        'sim.run(batchMax, breakpoints, simUniversalBreakpoints)'),
        'Run delegates universal breakpoint policy to the simulator');
    assert.ok(appRun.includes('(((23 << 27) | (branchOffset & 0x7FFF))') &&
              !appRun.includes('(((17 << 27) | (branchOffset & 0x7FFF))'),
        'high-level method tables encode canonical opcode 23 BRANCH, never opcode 17 DWRITE');
    assert.ok(appRun.includes('const breakpoints = simBreakpoints;'),
        'Run keeps the live breakpoint Set across asynchronous batches');
    assert.ok(!appRun.includes('sim._breakpointResumeAddr ='),
        'UI paths do not mutate simulator-owned breakpoint resume state');
    assert.ok(!appRun.includes('let _breakpointResumeAddr'),
        'the UI must not maintain a second resume-state token');
    assert.ok(appRun.includes("_consumeOneShotBreakpoint(breakpointAddr);\n                status = `Breakpoint"),
        'Run completion consumes a fired one-shot breakpoint');
    assert.ok(gateLogCss.includes('.nia-row-last td { border-bottom:') &&
              gateLogCss.includes('.nia-row-next .nia-disasm code { font-family:'),
        'last/next NIA rows keep their standard text colors');
    assert.ok(!gateLogCss.includes('.nia-row-last td { color: #7a7060;') &&
              !gateLogCss.includes('.nia-row-next td { color: #7a7060;') &&
              !gateLogCss.includes('.nia-row-last .nia-disasm code { color: #7a7060;') &&
              !gateLogCss.includes('.nia-row-next .nia-disasm code { color: #7a7060;'),
        'breakpoint NIA styling does not dim last/next instruction text');
}

console.log('execution control-flow regressions passed');