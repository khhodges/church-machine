'use strict';

// The opt-in protected adapter must not reintroduce Lambda-return erasure.
require('../tests/mint_phase1/protected_lambda_cleanup.test.js');

// Isolated ISA evidence, NOT Mint service execution. Provisioning ends before
// the first step. Cleanup is performed only by fetched, assembled instructions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {Sim, fixture, checkContext} = require('../tests/simulator/cr6_contract_fixture');
const source = fs.readFileSync(path.join(__dirname, 'cloomc/mint.cloomc'), 'utf8');
const controlled = [0, 1, 2, 3, 4, 7, 8, 9, 10, 11];
const zero = {word0: 0, word1: 0, word2: 0, word3: 0, m: 0};

for (const method of ['CREATE', 'DESTROY', 'MakeOutform', 'MakeInform']) {
    const body = source.match(new RegExp(`method ${method} \\{([\\s\\S]*?)^\\}`, 'm'))[1];
    const returnInstruction = body.match(/^\s*RETURNAL #\d+/m)[0].trim();
    const mask = method === 'DESTROY' ? 0 : 2;
    const {sim, compile, activate} = fixture(true);
    // Restore the real fault handler (the shared fixture normally asserts).
    sim.fault = Sim.prototype.fault;
    sim.programCapabilities = null;
    sim.petNameMemory.clear();
    const data = compile(33, 'IADD DR4, DR0, #0\nRETURNAL');
    const gt = rights => sim.createGT(sim.parseGT(data.gt).gt_seq, data.slot, rights, 1);
    sim.withNamespaceWrite('TEST ONLY: private Mint cleanup evidence', () =>
        sim.writeNSEntry(34, sim.NS_TABLE_BASE, sim.nsCount * 4 - 1, 0, 0, 1, 0, 0, 0));
    const nsGT = sim.createGT(0, 34, {R: 1, W: 1}, 1);
    const values = controlled.map(reg => reg === 9 ? gt({X: 1})
        : reg === 10 ? nsGT : reg === 8 ? gt({R: 1, W: 1})
        : [1, 3].includes(reg) ? gt({R: 1}) : data.gt);
    const loads = controlled.map((reg, i) => `LOAD CR${reg}, CR6, #${i + 1}`).join('\n');
    const callee = compile(31, `${loads}
IADD DR1, DR0, #77
${returnInstruction}`, values);
    const caller = compile(30, `${loads}
LOAD CR11, CR6, #11
CALL CR11, #0
HALT`, [...values, callee.gt]);
    activate(caller);
    sim.pc = 1; // Initial entry after method routing table, before any execution.
    const heap = {...sim.cr[5], m: 0};
    const thread = {...sim.cr[12], m: 0};
    const reserved = {...sim.cr[13], m: 0};
    const namespace = {...sim.cr[15], m: 0};
    const threadBase = sim._activeThreadBase();
    const layout = sim._threadLayoutAtBase(threadBase);
    let returned = false, called = false;
    for (let budget = 80; budget > 0 && !returned; budget--) {
        const before = sim.cr.map(cr => ({...cr}));
        const result = sim.step();
        assert.equal(sim.halted, false, JSON.stringify(sim.faultLog));
        assert.ok(result, 'instruction must retire');
        if (result.instr.opcode === 2) {
            called = true;
            for (const reg of controlled) assert.notEqual(before[reg].word0, 0);
        }
        if (result.instr.opcode !== 3) continue;
        assert.ok(called, 'RETURN must pop a frame made by an executed CALL');
        assert.equal(result.instr.imm & 0xfff, mask);
        controlled.forEach((reg, i) => {
            assert.equal(before[reg].word0 >>> 0, values[i] >>> 0);
            assert.deepEqual(sim.cr[reg], mask & (1 << reg) ? {...before[reg], m: 0} : zero,
                `${method}: CR${reg} must follow keep-current, never restore-caller semantics`);
            if (!(mask & (1 << reg))) {
                assert.equal(sim.memory[threadBase + layout.capsStart + reg], 0,
                    `${method}: cleared CR${reg} must not survive in its Thread home`);
            }
        });
        assert.equal(sim.dr[1], 77, 'RETURN mask is not data-register scrubbing');
        assert.deepEqual(sim.cr[5], heap);
        assert.deepEqual(sim.cr[12], thread);
        assert.deepEqual(sim.cr[13], reserved);
        assert.deepEqual(sim.cr[15], namespace);
        checkContext(sim, caller);
        returned = true;
    }
    assert.ok(returned, `${method}: native RETURN must execute`);
}
console.log('PASS: all four Mint exit masks erase actual CR descriptors and Thread homes via native CALL/RETURN');

// Probe SZ=0 RETURN independently of the unresolved X-target entry binding.
// Ordinary LAMBDA currently falls through. Explicit *fixture instructions*
// route to a RETURN once, then distinguish the saved continuation with DR11.
// This is not a proposed Mint dispatch workaround. No host sets PC/registers,
// pops a frame, flushes a cache, or calls an instruction handler after entry.
const slotReturn = source.slice(source.indexOf('create_data_slot_return:')).match(/^\s*(RETURNAL[^\n]*)/m)[1];
assert.equal(slotReturn.trim(), 'RETURNAL');
const afterSlot = source.slice(source.indexOf('create_data_slot_after_clear:'),
    source.indexOf('create_data_account_and_issue:'));
// Previously proposed clearing masks must now prove preservation too.
for (const mask of [0, 2, 2207, 4093, 4095]) {
    for (const spill of [false, true]) {
        const {sim, compile, activate} = fixture(true);
        sim.fault = Sim.prototype.fault;
        sim.programCapabilities = null;
        sim.petNameMemory.clear();
        // An actual CALL spills the Lambda frame to protected RAM. This is
        // stack-path evidence only; CALL remains forbidden in Mint's update interval.
        const leaf = compile(32, 'IADD DR4, DR0, #0\nRETURNAL #4095');
        const token = rights => sim.createGT(sim.parseGT(leaf.gt).gt_seq, leaf.slot, rights, 1);
        sim.withNamespaceWrite('TEST ONLY: Lambda cleanup Namespace view', () =>
            sim.writeNSEntry(34, sim.NS_TABLE_BASE, sim.nsCount * 4 - 1, 0, 0, 1, 0, 0, 0));
        const nsGT = sim.createGT(0, 34, {R: 1, W: 1}, 1);
        const values = controlled.map(reg => reg === 9 ? token({X: 1})
            : reg === 10 ? nsGT : reg === 8 ? token({R: 1, W: 1})
            : [1, 3].includes(reg) ? token({R: 1}) : leaf.gt);
        const loads = controlled.map((reg, i) => `LOAD CR${reg}, CR6, #${i + 1}`).join('\n');
        const stopLabels = [...new Set([...afterSlot.matchAll(/\bTODO_\w+/g)].map(m => m[0]))];
        const checks = afterSlot + '\n' + stopLabels.map((label, i) =>
            `${label}:\nIADD DR10, DR0, #${100 + i}\nHALT`).join('\n');
        const domain = compile(30, `${loads}
IADD DR11, DR0, #0
LAMBDA CR9
saved_continuation:
MCMP DR11, #1
BRANCHEQ finished
IADD DR11, DR0, #1
${spill ? 'CALL CR0, #0' : ''}
LOAD CR3, CR6, #1
LOAD CR6, CR6, #1
${mask === 0 ? slotReturn : `RETURNAL #${mask}`}
finished:
${checks}`, values);
        activate(domain);
        sim.pc = 1;
        const base = sim._activeThreadBase();
        const layout = sim._threadLayoutAtBase(base);
        let savedPC, savedSTO, savedContext, frameAddress, returned = false, finished = false;
        for (let budget = 100; budget > 0 && !finished; budget--) {
            const before = sim.cr.map(cr => ({...cr}));
            const homesBefore = Array.from(sim.memory.slice(base + layout.capsStart,
                base + layout.capsStart + 12));
            const pc = sim.pc, sto = sim.sto;
            const lambdaReturn = savedPC !== undefined &&
                sim._unpackProtectedIndicator(sim.memory[base + 17]).sz === 0;
            const result = sim.step();
            assert.equal(sim.faultLog.length, 0, JSON.stringify(sim.faultLog));
            assert.ok(result, 'fixture instruction must retire');
            if (result.instr?.opcode === 7) {
                savedPC = pc + 1;
                savedSTO = sto;
                savedContext = before;
                frameAddress = sim.lambdaCachedFrame.addr;
                assert.equal(sim._unpackFrameWord(sim.lambdaCachedFrame.word).returnPC, savedPC);
                assert.equal(sim.pc, savedPC, 'record the unresolved entry behavior, do not emulate dispatch');
            }
            if (spill && result.instr?.opcode === 2) {
                assert.equal(sim.lambdaCachedFrame, null, 'native CALL must flush the cached frame');
                assert.equal(sim._unpackFrameWord(sim.memory[base + frameAddress]).returnPC, savedPC);
            }
            if (result.instr?.opcode === 3 && lambdaReturn) {
                assert.equal(result.instr.imm & 0xfff, mask);
                assert.equal(sim.pc, savedPC, 'Lambda resumes its saved continuation');
                assert.equal(sim.sto, savedSTO);
                assert.equal(sim.lambdaActive, false);
                for (const reg of controlled) {
                    assert.notEqual(before[reg].word0, 0);
                }
                assert.deepEqual(sim.cr, before, 'SZ=0 preserves ALL current descriptors and M bits, including CR6');
                assert.notEqual(sim.cr[3].word0, savedContext[3].word0,
                    'body changes survive; no pre-Lambda snapshot restoration');
                assert.notEqual(sim.cr[6].word1, savedContext[6].word1,
                    'current CR6 is neither restored nor reconstructed');
                assert.deepEqual(Array.from(sim.memory.slice(base + layout.capsStart,
                    base + layout.capsStart + 12)), homesBefore, 'Lambda must not scrub capability homes');
                assert.equal(sim.cr[14].word1, domain.base);
                assert.match(result.pipeline.at(-1).desc, /all CR descriptors\/M bits preserved; MASK ignored/);
                returned = true;
            }
            if (sim.halted) {
                assert.ok(returned, `must return before reaching the fixture stop (mask=${mask}, spill=${spill})\n${sim.output}`);
                // No mask can make Lambda erase private authority. The test-only
                // boundary marker must identify the first retained-authority gate,
                // never release or a fabricated Mint success.
                assert.equal(sim.dr[10], 100 + stopLabels.indexOf('TODO_CREATE_DESTINATION_AUTHORITY_RETAINED'));
                finished = true;
            }
        }
        assert.ok(returned && finished, 'bounded native Lambda return and continuation must finish');
    }
}
console.log('PASS: Lambda ignores every tested mask, preserves all CRs/homes, and resumes cached or spilled stack continuations');
console.log('BLOCKED: Lambda RETURN cannot implement Mint early cleanup; legal erasure and X-entry bindings remain unresolved');
