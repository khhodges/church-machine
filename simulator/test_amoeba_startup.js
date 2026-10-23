'use strict';
// Disposable prototype: no saved Namespace, catalog, or hardware changes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
global.ChurchAssembler = require('./assembler');
const Compiler = require('./cloomc_compiler');
const {buildLump} = require('./lump_builder');
const {createAliceMalloryThreadFixture, installThreadDriver, threadGT} =
    require('./test_alice_mallory_thread_setup');

function compile(source) {
    const result = new Compiler().compile(source, []);
    assert.deepEqual(result.errors, []);
    const image = buildLump(result);
    return {image, code:image.words.slice(1, 1 + image.cw)};
}
const amoeba = compile(fs.readFileSync(__dirname + '/cloomc/amoeba_startup.cloomc', 'utf8'));
const application = compile(`abstraction test.StartupApplication {
    capabilities { SELF E }
    method Run {
        IADD DR1, DR0, #731
        RETURN
    }
}`);
const supervisor = compile(`abstraction test.StartupSupervisor {
    capabilities { SELF E }
    method Run {
        CHANGE CR2
        IADD DR2, DR0, #303
        HALT
    }
}`);

function scenario(mode) {
    const {sim, bodies, threadSlots, nextBase} = createAliceMalloryThreadFixture();
    const install = (slot, offset, compiled, label, caps = []) =>
        installThreadDriver(sim, slot, nextBase + offset, compiled.code, label, caps);
    const manager = install(32, 0, supervisor, 'Startup supervisor');
    const starter = install(33, 64, amoeba, 'Amoeba startup', [threadGT(sim, threadSlots[0])]);
    const app = install(34, 128, application, 'Startup application');
    const body = bodies[1], untouched = bodies[2];
    const other = Array.from(sim.memory.slice(untouched.base, untouched.base + untouched.layout.lumpSize));
    // Test privilege stands in for the not-yet-implemented Mint priming.
    // Discard all old actor registers, stacks, capabilities and heap.
    sim.memory.fill(0, body.base + 1, body.base + body.layout.lumpSize);
    if (mode !== 'empty') {
        const root = body.layout.stackEnd - 2;
        const sto = root - 2;
        sim.memory[body.base + root + 1] = starter.gt;
        sim.memory[body.base + root + 2] = sim._packFrameWordRaw(0x7fff, 1, body.layout.stackEnd);
        sim.memory[body.base + sto + 1] = starter.gt;
        // Public method table retained unchanged; initial continuation starts
        // at the compiler-generated Start body, not the dispatch data word.
        sim.memory[body.base + sto + 2] = sim._packFrameWordRaw(amoeba.code[0] - 1, 1, root);
        sim.memory[body.base + body.layout.protectedStoOffset] = sim._packProtectedIndicator(sto, 1, {}, 0);
        sim.memory[body.base + body.layout.capsStart] = starter.gt;
        sim.memory[body.base + body.layout.capsStart + 1] = mode === 'missing-app' ? 0 : app.gt;
    }
    const entry = sim.readNSEntry(manager.slot);
    sim._writeCR(0, manager.gt, entry);
    sim._installLumpHeaderContext(sim.parseGT(manager.gt), manager.slot, entry, manager.header);
    sim.pc = supervisor.code[0] - 1;
    sim._writeCR(2, threadGT(sim, body.slot), sim.readNSEntry(body.slot));
    const entered = [];
    let steps = 0;
    while (!sim.halted && steps++ < 100) {
        entered.push(sim.cr[14].word0 & 0xffff);
        sim.step();
    }
    assert(steps < 100, 'bounded prototype');
    assert.deepEqual(Array.from(sim.memory.slice(untouched.base, untouched.base + untouched.layout.lumpSize)), other,
        'unrelated Thread unchanged');
    if (mode === 'ready') {
        assert.equal(sim.faultLog.length, 0, JSON.stringify(sim.faultLog));
        assert(entered.includes(starter.slot), 'CHANGE enters Amoeba');
        assert(entered.includes(app.slot), 'Amoeba CALL enters application');
        assert.equal(sim.dr[2], 303, 'supervisor resumes');
        assert.equal(sim.memory[body.base + body.layout.drStart + 1], 731, 'application result retained in worker');
        assert(entered.indexOf(starter.slot) < entered.indexOf(app.slot));
    } else {
        assert(sim.faultLog.length > 0, 'missing prerequisite faults');
        assert(!entered.includes(app.slot), 'application cannot run without prerequisites');
        if (mode === 'empty') assert.equal(sim.faultLog.at(-1).threadResumeFailure.reason, 'empty-context');
    }
}
for (const mode of ['ready', 'empty', 'missing-app']) scenario(mode);
console.log('PASS Amoeba CLOOMC startup, application return, supervisor resume, empty Thread and missing application rejection');
